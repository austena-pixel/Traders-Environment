import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ADMIN_EMAILS = new Set(["emmanuelmatome528@gmail.com", "austena401@gmail.com"]);
const ACTIVITY_DAYS = 14;
const ACTIVITY_LOOKBACK_DAYS = 30;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

async function countRows(client: ReturnType<typeof createClient>, table: string, filter?: (query: any) => any) {
  let query: any = client.from(table).select("*", { count: "exact", head: true });
  if (filter) query = filter(query);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

function utcDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = getSecretKey();
  if (!supabaseUrl || !secretKey) return json({ error: "Admin analytics is not configured." }, 500);

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Sign in to H·IOS Admin first." }, 401);

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user?.email) return json({ error: "Your H·IOS session could not be verified. Sign in again." }, 401);
  if (!ADMIN_EMAILS.has(user.email.toLowerCase())) return json({ error: "This account does not have H·IOS administrator access." }, 403);

  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const activityStart = new Date(today);
    activityStart.setUTCDate(activityStart.getUTCDate() - (ACTIVITY_DAYS - 1));
    const lookbackStart = new Date(today);
    lookbackStart.setUTCDate(lookbackStart.getUTCDate() - (ACTIVITY_LOOKBACK_DAYS - 1));

    const [
      profiles,
      accounts,
      trades,
      mt5Deals,
      connectedAccounts,
      chartUsers,
      recentProfilesResult,
      recentTradesResult,
    ] = await Promise.all([
      countRows(admin, "profiles"),
      countRows(admin, "trading_accounts"),
      countRows(admin, "trades", (query) => query.eq("is_deleted", false)),
      countRows(admin, "mt5_deals"),
      countRows(admin, "trading_accounts", (query) => query.eq("bridge_enabled", true).eq("connection_status", "connected")),
      countRows(admin, "chart_workspace_profiles"),
      admin.from("profiles").select("created_at").gte("created_at", lookbackStart.toISOString()).order("created_at", { ascending: true }).limit(5000),
      admin.from("trades").select("created_at,instrument").eq("is_deleted", false).gte("created_at", lookbackStart.toISOString()).order("created_at", { ascending: true }).limit(10000),
    ]);

    if (recentProfilesResult.error) throw recentProfilesResult.error;
    if (recentTradesResult.error) throw recentTradesResult.error;

    const activity = new Map<string, { signups: number; trades: number }>();
    for (let offset = 0; offset < ACTIVITY_DAYS; offset += 1) {
      const day = new Date(activityStart);
      day.setUTCDate(day.getUTCDate() + offset);
      activity.set(utcDay(day), { signups: 0, trades: 0 });
    }

    for (const row of recentProfilesResult.data || []) {
      const day = String(row.created_at || "").slice(0, 10);
      const point = activity.get(day);
      if (point) point.signups += 1;
    }

    const marketCounts = new Map<string, number>();
    for (const row of recentTradesResult.data || []) {
      const day = String(row.created_at || "").slice(0, 10);
      const point = activity.get(day);
      if (point) point.trades += 1;

      const market = String(row.instrument || "Unspecified").trim() || "Unspecified";
      marketCounts.set(market, (marketCounts.get(market) || 0) + 1);
    }

    return json({
      generatedAt: new Date().toISOString(),
      totals: { profiles, accounts, trades, mt5Deals, connectedAccounts, chartUsers },
      activity: [...activity.entries()].map(([day, values]) => ({ day, ...values })),
      topMarkets: [...marketCounts.entries()].map(([market, count]) => ({ market, count })).sort((a, b) => b.count - a.count).slice(0, 6),
      marketWindowDays: ACTIVITY_LOOKBACK_DAYS,
      recentTradesLimited: (recentTradesResult.data || []).length === 10000,
    });
  } catch (error) {
    console.error("H·IOS Admin analytics query failed:", error);
    return json({ error: "T·IOS analytics could not be loaded. Try again in a moment." }, 500);
  }
});
