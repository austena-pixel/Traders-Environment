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
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
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
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

async function authenticateBridge(
  supabase: ReturnType<typeof createClient>,
  req: Request,
  payload: any,
) {
  const bridgeKey = req.headers.get("x-te-bridge-key") || "";
  const connectionId =
    req.headers.get("x-te-connection-id") ||
    payload?.connection_id ||
    "";

  if (!bridgeKey || !connectionId) {
    throw new Error("Missing bridge credentials");
  }

  const tokenHash = await sha256Hex(bridgeKey);

  const { data: account, error } = await supabase
    .from("trading_accounts")
    .select("*")
    .eq("id", connectionId)
    .eq("bridge_token_hash", tokenHash)
    .eq("bridge_enabled", true)
    .single();

  if (error || !account) {
    throw new Error("Invalid or disabled bridge");
  }

  if (
    account.platform !== "MT5" ||
    account.broker !== "Deriv" ||
    !["demo", "real"].includes(account.account_type)
  ) {
    throw new Error("This bridge is only for linked Deriv MT5 accounts");
  }

  const incomingType = String(payload?.account?.account_type || "").toLowerCase();

  if (!["demo", "real"].includes(incomingType)) {
    throw new Error("Only MT5 demo and real accounts are supported");
  }

  if (account.account_type !== incomingType) {
    throw new Error(
      `Account-type mismatch: TE expects ${account.account_type}, MT5 reports ${incomingType}`,
    );
  }

  const incomingLogin = String(payload?.account?.login || "");
  if (!account.mt5_login || !incomingLogin || String(account.mt5_login) !== incomingLogin) {
    throw new Error("MT5 login does not match this TE connection");
  }

  const incomingServer = String(payload?.account?.server || "");
  if (!incomingServer || (account.mt5_server && account.mt5_server !== incomingServer)) {
    throw new Error("MT5 server does not match this TE connection");
  }
  const incomingCompany = String(payload?.account?.company || "");
  if (
    !incomingServer.toLowerCase().includes("deriv") &&
    !incomingCompany.toLowerCase().includes("deriv")
  ) {
    throw new Error("The connected MT5 server could not be verified as Deriv");
  }

  const terminalServerTimeMs = Number(payload?.account?.terminal_server_time_msc);
  if (!Number.isSafeInteger(terminalServerTimeMs) || terminalServerTimeMs <= 0) {
    throw new Error("MT5 server clock is unavailable");
  }
  const serverToUtcOffsetMs = Date.now() - terminalServerTimeMs;
  if (Math.abs(serverToUtcOffsetMs) > 50400000) {
    throw new Error("MT5 server clock differs from T-IOS by more than 14 hours");
  }

  if (!account.mt5_sync_started_at || !Number.isFinite(Date.parse(account.mt5_sync_started_at))) {
    throw new Error("The trade sync cutoff is not configured");
  }

  return { ...account, server_to_utc_offset_ms: serverToUtcOffsetMs };
}

async function updateSnapshot(
  supabase: ReturnType<typeof createClient>,
  account: any,
  payload: any,
) {
  const a = payload.account || {};

  const update: Record<string, unknown> = {
    broker: "Deriv",
    platform: "MT5",
    account_type: String(a.account_type || account.account_type).toLowerCase(),
    mt5_login: String(a.login || account.mt5_login || ""),
    mt5_server: String(a.server || account.mt5_server || ""),
    currency: String(a.currency || account.currency || "USD"),
    broker_company: String(a.company || account.broker_company || "Deriv"),
    current_balance: num(a.balance),
    current_equity: num(a.equity),
    floating_pnl: num(a.floating_pnl),
    margin: num(a.margin),
    free_margin: num(a.free_margin),
    margin_level: num(a.margin_level),
    open_positions: Math.max(0, Math.trunc(num(a.open_positions))),
    connection_status: "connected",
    last_sync_at: new Date().toISOString(),
    sync_error: null,
    updated_at: new Date().toISOString(),
  };

  if (num(account.starting_balance) === 0 && num(a.balance) !== 0) {
    update.starting_balance = num(a.balance);
  }

  const { error } = await supabase
    .from("trading_accounts")
    .update(update)
    .eq("id", account.id)
    .eq("user_id", account.user_id);

  if (error) throw error;
}

async function upsertPositions(
  supabase: ReturnType<typeof createClient>,
  account: any,
  positions: any[],
  syncStartedAtMs: number,
  serverToUtcOffsetMs: number,
) {
  for (const p of positions || []) {
    const positionId = String(p.position_id || "");
    const rawOpenTimeMs = epochMilliseconds(p.open_time_msc, p.open_time);
    const openTimeMs = rawOpenTimeMs ? rawOpenTimeMs + serverToUtcOffsetMs : 0;
    if (!positionId || !openTimeMs || openTimeMs < syncStartedAtMs) continue;

    const { data: existing } = await supabase
      .from("trades")
      .select("id, stop_loss, risk_amount")
      .eq("account_id", account.id)
      .eq("mt5_position_id", positionId)
      .eq("source", "mt5")
      .maybeSingle();

    const direction = String(p.direction || "Buy").toLowerCase() === "sell"
      ? "Sell"
      : "Buy";
    const payload: Record<string, unknown> = {
      user_id: account.user_id,
      account_id: account.id,
      source: "mt5",
      mt5_position_id: positionId,
      trade_date: String(p.trade_date || tradeDateFromMilliseconds(openTimeMs)),
      instrument: String(p.symbol || ""),
      direction,
      entry_price: num(p.entry_price),
      current_stop_loss: num(p.stop_loss) || null,
      take_profit: num(p.take_profit) || null,
      volume: num(p.volume),
      opened_at: isoFromEpochMilliseconds(openTimeMs),
      position_status: "open",
      sync_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const incomingRisk = Math.max(0, num(p.risk_amount));
    const incomingStop = num(p.stop_loss) || null;

    if (!existing) {
      payload.stop_loss = incomingStop;
      payload.risk_amount = incomingRisk;
      payload.pnl = 0;
      payload.r_multiple = 0;
      payload.commission = 0;
      payload.swap = 0;
      payload.fee = 0;
      payload.notes = "Synced from Deriv MT5";
    } else {
      // Preserve the FIRST valid initial risk/stop. If the trade row was
      // created earlier from deal history with zero risk, backfill it from
      // the first live position snapshot that contains a valid SL.
      if (num(existing.risk_amount) <= 0 && incomingRisk > 0) {
        payload.risk_amount = incomingRisk;
      }
      if (!num(existing.stop_loss) && incomingStop) {
        payload.stop_loss = incomingStop;
      }
    }

    const { error } = await supabase
      .from("trades")
      .upsert(payload, {
        onConflict: "account_id,mt5_position_id",
      });

    if (error) throw error;
  }
}

async function upsertDeals(
  supabase: ReturnType<typeof createClient>,
  account: any,
  deals: any[],
  syncStartedAtMs: number,
  serverToUtcOffsetMs: number,
) {
  const touchedPositions = new Set<string>();

  for (const d of deals || []) {
    const dealId = String(d.deal_id || "");
    const positionId = String(d.position_id || "");
    const rawDealTimeMs = epochMilliseconds(d.deal_time_msc, d.deal_time);
    const dealTimeMs = rawDealTimeMs ? rawDealTimeMs + serverToUtcOffsetMs : 0;
    const entryType = String(d.entry_type || "").toLowerCase();
    const side = String(d.side || "").toLowerCase();

    if (
      !dealId || !positionId || !dealTimeMs || dealTimeMs < syncStartedAtMs ||
      !["in", "out", "out_by", "inout"].includes(entryType) ||
      !["buy", "sell"].includes(side)
    ) continue;

    touchedPositions.add(positionId);

    const row = {
      user_id: account.user_id,
      account_id: account.id,
      deal_id: dealId,
      position_id: positionId,
      entry_type: entryType,
      side: side === "sell" ? "Sell" : "Buy",
      symbol: String(d.symbol || ""),
      volume: num(d.volume),
      price: num(d.price),
      stop_loss: num(d.stop_loss) || null,
      risk_amount: Math.max(0, num(d.risk_amount)),
      profit: num(d.profit),
      commission: num(d.commission),
      swap: num(d.swap),
      fee: num(d.fee),
      deal_time: isoFromEpochMilliseconds(dealTimeMs),
      trade_date: String(d.trade_date || tradeDateFromMilliseconds(dealTimeMs)),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("mt5_deals")
      .upsert(row, {
        onConflict: "account_id,deal_id",
      });

    if (error) throw error;
  }

  for (const positionId of touchedPositions) {
    await rebuildTradeFromDeals(
      supabase,
      account,
      positionId,
      syncStartedAtMs,
    );
  }
}

async function rebuildTradeFromDeals(
  supabase: ReturnType<typeof createClient>,
  account: any,
  positionId: string,
  syncStartedAtMs: number,
) {
  const { data: deals, error } = await supabase
    .from("mt5_deals")
    .select("*")
    .eq("account_id", account.id)
    .eq("position_id", positionId)
    .order("deal_time", { ascending: true });

  if (error) throw error;
  const linkedDeals = (deals || []).filter((d: any) => {
    const dealTime = Date.parse(String(d.deal_time || ""));
    return Number.isFinite(dealTime) && dealTime >= syncStartedAtMs;
  });
  if (!linkedDeals.length) return;

  const opening = linkedDeals.filter((d: any) =>
    ["in", "inout"].includes(String(d.entry_type).toLowerCase())
  );

  const closing = linkedDeals.filter((d: any) =>
    ["out", "out_by"].includes(String(d.entry_type).toLowerCase())
  );

  if (!opening.length) return;

  const openVolume = opening.reduce(
    (s: number, d: any) => s + num(d.volume),
    0,
  );

  const closeVolume = closing.reduce(
    (s: number, d: any) => s + num(d.volume),
    0,
  );

  const avgEntry = openVolume
    ? opening.reduce(
        (s: number, d: any) => s + num(d.price) * num(d.volume),
        0,
      ) / openVolume
    : 0;

  const avgExit = closeVolume
    ? closing.reduce(
        (s: number, d: any) => s + num(d.price) * num(d.volume),
        0,
      ) / closeVolume
    : null;

  const fullyClosed =
    openVolume > 0 &&
    closeVolume >= openVolume - 1e-8;

  // Match the MT5 History "Profit" column exactly.
  // Commission, swap and fee stay available as separate fields instead of
  // being silently folded into the displayed trade P&L.
  const mt5Profit = linkedDeals.reduce(
    (s: number, d: any) => s + num(d.profit),
    0,
  );

  const totalCommission = linkedDeals.reduce(
    (s: number, d: any) => s + num(d.commission),
    0,
  );

  const totalSwap = linkedDeals.reduce(
    (s: number, d: any) => s + num(d.swap),
    0,
  );

  const totalFee = linkedDeals.reduce(
    (s: number, d: any) => s + num(d.fee),
    0,
  );

  const firstOpen = opening[0];
  const lastClose = closing.length
    ? closing[closing.length - 1]
    : null;

  const direction =
    String(firstOpen.side).toLowerCase() === "sell"
      ? "Sell"
      : "Buy";

  const { data: existing } = await supabase
    .from("trades")
    .select("id, risk_amount, stop_loss")
    .eq("account_id", account.id)
    .eq("mt5_position_id", positionId)
    .eq("source", "mt5")
    .maybeSingle();

  const existingRisk = Math.max(0, num(existing?.risk_amount));
  const openingRisk = opening
    .map((d: any) => Math.max(0, num(d.risk_amount)))
    .find((v: number) => v > 0) || 0;
  const openingStop = opening
    .map((d: any) => num(d.stop_loss))
    .find((v: number) => v > 0) || 0;

  // Never replace a valid original risk with a later/moved stop. If an older
  // row has no risk yet, recover it from the opening deal metadata supplied
  // by the v1.07 MT5 bridge.
  const riskAmount = existingRisk > 0 ? existingRisk : openingRisk;
  const initialStop = num(existing?.stop_loss) || openingStop || null;

  const row: Record<string, unknown> = {
    user_id: account.user_id,
    account_id: account.id,
    source: "mt5",
    mt5_position_id: positionId,
    mt5_open_deal_id: String(firstOpen.deal_id),
    mt5_close_deal_id: lastClose ? String(lastClose.deal_id) : null,
    trade_date: firstOpen.trade_date,
    instrument: firstOpen.symbol,
    direction,
    entry_price: avgEntry || null,
    exit_price: fullyClosed ? avgExit : null,
    volume: openVolume,
    commission: totalCommission,
    swap: totalSwap,
    fee: totalFee,
    opened_at: firstOpen.deal_time,
    closed_at: fullyClosed && lastClose ? lastClose.deal_time : null,
    position_status: fullyClosed ? "closed" : "open",
    pnl: fullyClosed ? mt5Profit : 0,
    r_multiple:
      fullyClosed && riskAmount > 0
        ? mt5Profit / riskAmount
        : 0,
    sync_updated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (!existing) {
    row.risk_amount = riskAmount;
    row.stop_loss = initialStop;
    row.notes = "Synced from Deriv MT5";
  } else {
    if (existingRisk <= 0 && riskAmount > 0) {
      row.risk_amount = riskAmount;
    }
    if (!num(existing.stop_loss) && initialStop) {
      row.stop_loss = initialStop;
    }
  }

  const { error: upsertError } = await supabase
    .from("trades")
    .upsert(row, {
      onConflict: "account_id,mt5_position_id",
    });

  if (upsertError) throw upsertError;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "POST required" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = getSecretKey();

  if (!supabaseUrl || !secretKey) {
    return json(
      { error: "Supabase function secrets are not configured" },
      500,
    );
  }

  const supabase = createClient(
    supabaseUrl,
    secretKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

  try {
    const rawPayload = await req.text();
    if (rawPayload.length > 262144) {
      return json({ error: "Payload too large" }, 413);
    }
    const payload = JSON.parse(rawPayload);
    const account = await authenticateBridge(
      supabase,
      req,
      payload,
    );

    const event = String(payload.event || "snapshot");
    if (!["snapshot", "sync", "positions", "deals"].includes(event)) {
      return json({ error: "Unsupported sync event" }, 400);
    }
    if (Array.isArray(payload.positions) && payload.positions.length > 500) {
      return json({ error: "Too many positions in one sync" }, 413);
    }
    if (Array.isArray(payload.deals) && payload.deals.length > 100) {
      return json({ error: "Too many deals in one sync" }, 413);
    }

    const syncStartedAtMs = Date.parse(account.mt5_sync_started_at);
    const serverToUtcOffsetMs = account.server_to_utc_offset_ms;

    await updateSnapshot(
      supabase,
      account,
      payload,
    );

    if (event === "sync" || event === "positions") {
      await upsertPositions(
        supabase,
        account,
        Array.isArray(payload.positions)
          ? payload.positions
          : [],
        syncStartedAtMs,
        serverToUtcOffsetMs,
      );
    }

    if (event === "sync" || event === "deals") {
      await upsertDeals(
        supabase,
        account,
        Array.isArray(payload.deals)
          ? payload.deals
          : [],
        syncStartedAtMs,
        serverToUtcOffsetMs,
      );
    }

    return json({
      ok: true,
      event,
      account_id: account.id,
      received_positions:
        Array.isArray(payload.positions)
          ? payload.positions.length
          : 0,
      received_deals:
        Array.isArray(payload.deals)
          ? payload.deals.length
          : 0,
      sync_started_at_msc: syncStartedAtMs,
      server_to_utc_offset_ms: serverToUtcOffsetMs,
      server_time_msc: Date.now(),
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);

    return json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      401,
    );
  }
});
