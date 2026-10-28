import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-te-bridge-key, x-te-connection-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getSecretKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;

  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed.default || null;
  } catch {
    return null;
  }
}

function num(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function epochMilliseconds(milliseconds: unknown, seconds: unknown) {
  const precise = Number(milliseconds);
  if (Number.isSafeInteger(precise) && precise > 0) return precise;
  const legacySeconds = Number(seconds);
  if (Number.isSafeInteger(legacySeconds) && legacySeconds > 0) {
    return legacySeconds * 1000;
  }
  return 0;
}

function isoFromEpochMilliseconds(value: number) {
  return Number.isSafeInteger(value) && value > 0
    ? new Date(value).toISOString()
    : new Date().toISOString();
}

function tradeDateFromMilliseconds(value: number) {
  return isoFromEpochMilliseconds(value).slice(0, 10);
}

function direction(value: unknown) {
  return String(value || "").toLowerCase() === "sell" ? "Sell" : "Buy";
}

async function authenticateBridge(
  supabase: ReturnType<typeof createClient>,
  req: Request,
  payload: any,
) {
  const bridgeKey = req.headers.get("x-te-bridge-key") || "";
  const connectionId =
    req.headers.get("x-te-connection-id") || payload?.connection_id || "";
  if (!bridgeKey || !connectionId) throw new Error("Missing bridge credentials");

  const tokenHash = await sha256Hex(bridgeKey);
  const { data: account, error } = await supabase
    .from("trading_accounts")
    .select("*")
    .eq("id", connectionId)
    .eq("bridge_token_hash", tokenHash)
    .eq("bridge_enabled", true)
    .single();

  if (error || !account) throw new Error("Invalid or disabled bridge");
  if (
    account.platform !== "MT4" ||
    account.broker !== "Deriv" ||
    !["demo", "real"].includes(account.account_type)
  ) {
    throw new Error("This bridge is only for linked Deriv MT4 accounts");
  }

  const incomingType = String(payload?.account?.account_type || "").toLowerCase();
  if (!["demo", "real"].includes(incomingType)) {
    throw new Error("Only MT4 demo and real accounts are supported");
  }
  if (account.account_type !== incomingType) {
    throw new Error(
      `Account-type mismatch: T-IOS expects ${account.account_type}, MT4 reports ${incomingType}`,
    );
  }

  const incomingLogin = String(payload?.account?.login || "");
  if (
    !account.mt4_login ||
    !incomingLogin ||
    String(account.mt4_login) !== incomingLogin
  ) {
    throw new Error("MT4 login does not match this T-IOS connection");
  }

  const incomingServer = String(payload?.account?.server || "");
  if (
    !incomingServer ||
    (account.mt4_server && account.mt4_server !== incomingServer)
  ) {
    throw new Error("MT4 server does not match this T-IOS connection");
  }

  const incomingCompany = String(payload?.account?.company || "");
  if (
    !incomingServer.toLowerCase().includes("deriv") &&
    !incomingCompany.toLowerCase().includes("deriv")
  ) {
    throw new Error("The connected MT4 server could not be verified as Deriv");
  }

  const terminalServerTimeMs = Number(payload?.account?.terminal_server_time_msc);
  if (!Number.isSafeInteger(terminalServerTimeMs) || terminalServerTimeMs <= 0) {
    throw new Error("MT4 server clock is unavailable");
  }

  const serverToUtcOffsetMs = Date.now() - terminalServerTimeMs;
  if (Math.abs(serverToUtcOffsetMs) > 50400000) {
    throw new Error("MT4 server clock differs from T-IOS by more than 14 hours");
  }

  if (
    !account.mt4_sync_started_at ||
    !Number.isFinite(Date.parse(account.mt4_sync_started_at))
  ) {
    throw new Error("The trade sync cutoff is not configured");
  }

  return { ...account, server_to_utc_offset_ms: serverToUtcOffsetMs };
}

async function updateSnapshot(
  supabase: ReturnType<typeof createClient>,
  account: any,
  payload: any,
) {
  const incoming = payload.account || {};
  const update: Record<string, unknown> = {
    broker: "Deriv",
    platform: "MT4",
    account_type: String(incoming.account_type || account.account_type).toLowerCase(),
    mt4_login: String(incoming.login || account.mt4_login || ""),
    mt4_server: String(incoming.server || account.mt4_server || ""),
    currency: String(incoming.currency || account.currency || "USD"),
    broker_company: String(incoming.company || account.broker_company || "Deriv"),
    current_balance: num(incoming.balance),
    current_equity: num(incoming.equity),
    floating_pnl: num(incoming.floating_pnl),
    margin: num(incoming.margin),
    free_margin: num(incoming.free_margin),
    margin_level: num(incoming.margin_level),
    open_positions: Math.max(0, Math.trunc(num(incoming.open_positions))),
    connection_status: "connected",
    last_sync_at: new Date().toISOString(),
    sync_error: null,
    updated_at: new Date().toISOString(),
  };

  if (num(account.starting_balance) === 0 && num(incoming.balance) !== 0) {
    update.starting_balance = num(incoming.balance);
  }

  const { error } = await supabase
    .from("trading_accounts")
    .update(update)
    .eq("id", account.id)
    .eq("user_id", account.user_id);
  if (error) throw error;
}

async function findExistingTrade(
  supabase: ReturnType<typeof createClient>,
  account: any,
  ticket: string,
) {
  const { data, error } = await supabase
    .from("trades")
    .select("id, risk_amount, stop_loss, position_status")
    .eq("account_id", account.id)
    .eq("source", "mt4")
    .eq("external_trade_id", ticket)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertPositions(
  supabase: ReturnType<typeof createClient>,
  account: any,
  positions: any[],
  syncStartedAtMs: number,
  serverToUtcOffsetMs: number,
) {
  for (const position of positions) {
    const ticket = String(position.ticket || "");
    const rawOpenMs = epochMilliseconds(position.open_time_msc, position.open_time);
    const openTimeMs = rawOpenMs ? rawOpenMs + serverToUtcOffsetMs : 0;
    if (!ticket || !openTimeMs || openTimeMs < syncStartedAtMs) continue;

    const existing = await findExistingTrade(supabase, account, ticket);
    // A closed order must never be moved back to open by a stale terminal snapshot.
    if (existing?.position_status === "closed") continue;

    const initialStop = num(position.initial_stop_loss) || null;
    const currentStop = num(position.stop_loss) || null;
    const incomingRisk = Math.max(0, num(position.risk_amount));
    const row: Record<string, unknown> = {
      user_id: account.user_id,
      account_id: account.id,
      source: "mt4",
      external_trade_id: ticket,
      trade_date: String(position.trade_date || tradeDateFromMilliseconds(openTimeMs)),
      instrument: String(position.symbol || ""),
      direction: direction(position.direction),
      entry_price: num(position.entry_price),
      current_stop_loss: currentStop,
      take_profit: num(position.take_profit) || null,
      volume: num(position.volume),
      opened_at: isoFromEpochMilliseconds(openTimeMs),
      position_status: "open",
      sync_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (!existing) {
      row.stop_loss = initialStop;
      row.risk_amount = incomingRisk;
      row.exit_price = null;
      row.closed_at = null;
      row.pnl = 0;
      row.r_multiple = 0;
      row.commission = 0;
      row.swap = 0;
      row.fee = 0;
      row.notes = "Synced from Deriv MT4";
    } else {
      // Preserve the first valid initial stop/risk across later stop changes.
      if (num(existing.risk_amount) <= 0 && incomingRisk > 0) {
        row.risk_amount = incomingRisk;
      }
      if (!num(existing.stop_loss) && initialStop) row.stop_loss = initialStop;
    }

    const { error } = await supabase.from("trades").upsert(row, {
      onConflict: "account_id,source,external_trade_id",
    });
    if (error) throw error;
  }
}

async function upsertClosedOrders(
  supabase: ReturnType<typeof createClient>,
  account: any,
  orders: any[],
  syncStartedAtMs: number,
  serverToUtcOffsetMs: number,
) {
  for (const order of orders) {
    const ticket = String(order.ticket || "");
    const rawOpenMs = epochMilliseconds(order.open_time_msc, order.open_time);
    const rawCloseMs = epochMilliseconds(order.close_time_msc, order.close_time);
    const openTimeMs = rawOpenMs ? rawOpenMs + serverToUtcOffsetMs : 0;
    const closeTimeMs = rawCloseMs ? rawCloseMs + serverToUtcOffsetMs : 0;
    if (
      !ticket ||
      !openTimeMs ||
      !closeTimeMs ||
      openTimeMs < syncStartedAtMs ||
      closeTimeMs < syncStartedAtMs
    ) {
      continue;
    }

    const existing = await findExistingTrade(supabase, account, ticket);
    const incomingRisk = Math.max(0, num(order.risk_amount));
    const existingRisk = Math.max(0, num(existing?.risk_amount));
    const riskAmount = existingRisk > 0 ? existingRisk : incomingRisk;
    const initialStop =
      num(existing?.stop_loss) ||
      num(order.initial_stop_loss) ||
      num(order.stop_loss) ||
      null;
    const profit = num(order.profit);

    const row: Record<string, unknown> = {
      user_id: account.user_id,
      account_id: account.id,
      source: "mt4",
      external_trade_id: ticket,
      trade_date: String(order.trade_date || tradeDateFromMilliseconds(openTimeMs)),
      instrument: String(order.symbol || ""),
      direction: direction(order.direction),
      entry_price: num(order.entry_price),
      exit_price: num(order.exit_price),
      stop_loss: initialStop,
      current_stop_loss: num(order.stop_loss) || null,
      take_profit: num(order.take_profit) || null,
      risk_amount: riskAmount,
      pnl: profit,
      r_multiple: riskAmount > 0 ? profit / riskAmount : 0,
      volume: num(order.volume),
      commission: num(order.commission),
      swap: num(order.swap),
      fee: num(order.fee),
      opened_at: isoFromEpochMilliseconds(openTimeMs),
      closed_at: isoFromEpochMilliseconds(closeTimeMs),
      position_status: "closed",
      sync_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      notes: existing ? undefined : "Synced from Deriv MT4",
    };

    const { error } = await supabase.from("trades").upsert(row, {
      onConflict: "account_id,source,external_trade_id",
    });
    if (error) throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = getSecretKey();
  if (!supabaseUrl || !secretKey) {
    return json({ error: "Supabase function secrets are not configured" }, 500);
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const rawBody = await req.text();
    if (rawBody.length > 262144) return json({ error: "Payload too large" }, 413);
    const payload = JSON.parse(rawBody);
    const account = await authenticateBridge(supabase, req, payload);
    const event = String(payload.event || "snapshot");

    if (!["snapshot", "sync", "positions", "orders"].includes(event)) {
      return json({ error: "Unsupported sync event" }, 400);
    }

    const positions = Array.isArray(payload.positions) ? payload.positions : [];
    const orders = Array.isArray(payload.orders) ? payload.orders : [];
    if (positions.length > 500) return json({ error: "Too many positions in one sync" }, 413);
    if (orders.length > 100) return json({ error: "Too many orders in one sync" }, 413);

    const syncStartedAtMs = Date.parse(account.mt4_sync_started_at);
    const serverToUtcOffsetMs = account.server_to_utc_offset_ms;

    await updateSnapshot(supabase, account, payload);

    if (event === "sync" || event === "positions") {
      await upsertPositions(
        supabase,
        account,
        positions,
        syncStartedAtMs,
        serverToUtcOffsetMs,
      );
    }
    if (event === "sync" || event === "orders") {
      await upsertClosedOrders(
        supabase,
        account,
        orders,
        syncStartedAtMs,
        serverToUtcOffsetMs,
      );
    }

    return json({
      ok: true,
      event,
      account_id: account.id,
      received_positions: positions.length,
      received_orders: orders.length,
      sync_started_at_msc: syncStartedAtMs,
      server_to_utc_offset_ms: serverToUtcOffsetMs,
      server_time_msc: Date.now(),
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, 401);
  }
});