# TradingView Charts workspace

Open **Charts** directly below Dashboard in the T-IOS sidebar. A verified Charts
profile is required before any TradingView widget is mounted. Choose **Single
Chart** for one large chart or **Multiple Charts** for three independent charts.
Single Chart is the initial default; the three-timeframe method is optional. In Multiple Charts mode, use **Number of charts** to choose 2–6 active charts. Three remains the default. Adding charts retains existing charts and provides editable new chart defaults. Reducing the count asks for confirmation before discarding removed charts' settings. Save preferences to persist the selected chart count and settings.

Use each chart's Instrument, Timeframe and Responsibility controls to configure
its defaults. Instrument codes use TradingView's `EXCHANGE:SYMBOL` format, such
as `FX:EURUSD`, `NASDAQ:AAPL` or `BINANCE:BTCUSDT`. **Apply** changes the chart's
instrument; changing the timeframe updates that chart immediately. Labels can
be empty and never affect widget initialization. **Save preferences** stores the
selected layout and both layouts' settings in the authenticated user's account.
Switching layouts preserves each layout's defaults, including unsaved edits
within the current T-IOS session. Refresh or sign-out restores the last saved
preferences.

Multiple Chart defaults are H4 / Market Context, H1 / Setup Development and M5 /
Entry Execution. Cards use equal columns when the workspace is wide enough and
stack with their own full chart areas on smaller screens. **Expand** enlarges
one chart without recreating it; **Return to layout** closes it. Escape also
closes it when focus is in T-IOS. Keyboard events inside a cross-origin chart
are controlled by TradingView, so the Return button remains available.

## Charts account entry

The centered **Welcome to T-IOS Charts** dialog offers **Sign in to Charts** and
**Create Charts account**. Both reuse the existing H-IOS/T-IOS Supabase session;
neither collects a password or authenticates a personal TradingView account.
The application verifies the session with `auth.getUser()` and checks
`chart_workspace_profiles` independently of `chart_workspace_preferences`.
Older preferences alone never count as registration.

Sign in reads the current user's profile and reports when it does not exist.
Create explicitly inserts a profile belonging to that verified user. It then
opens the layout chooser: Single chart or three Context/Setup/Entry charts.
Existing symbols, chart counts, timeframes, responsibilities, theme and timezone
are preserved. The selected layout is saved using the existing revision guard.
No widget is mounted before this save succeeds. A profile with an unfinished
layout resumes setup next time; a returning profile with saved preferences opens
its workspace directly. Users can change and save their layout afterward.

Profile checks, creation and preference saves fail closed. Duplicate creation
in another tab loads the established profile rather than overwriting it.
Preference conflicts load the latest saved configuration for confirmation.
Account changes dispose the previous Charts state immediately and reload T-IOS
using the newly shared H-IOS session. Supabase queries run outside the synchronous
Auth callback. Late results cannot update another user's workspace.

The profile table has one row per Auth user, owner-only SELECT/INSERT policies,
and only authenticated SELECT/INSERT grants. There is no automatic profile
backfill, no extra credential store and no client UPDATE/DELETE/TRUNCATE grant.
A row currently represents an active registration; revocation/status controls
are not implemented. The additive migration also records the previously
dashboard-created table in source control. Existing preference and trade rows
are unchanged.

## Saved native analysis (2026-10-10)

Each chart has **TradingView** and **Saved analysis** switches. TradingView remains
the initial engine. Saved analysis is an opt-in native workspace using pinned
Lightweight Charts 5.2.0, with the Apache-2.0 license, NOTICE, logo and link
retained. It is a renderer, not the Advanced Charts library or a personal
TradingView account. Existing TradingView drawings cannot be imported or saved
through the standard embed.

Native analysis currently supports Volatility 75 (1s) and Volatility 75, M1, M3,
M5, M15, M30, H1, H2, H4 and D1. Its instrument/timeframe controls are independent
of the TradingView defaults in the left panel. Tools include price levels,
two-point trend lines, rectangular zones, text notes, and SMA/EMA overlays with
saved period and colour. Add an item by selecting its tool and clicking the
chart; open **Saved analysis** below the chart to remove individual items.
Nothing adds default indicators or clears drawings on refresh, layout changes,
navigation, Reload analysis, or instrument/timeframe changes. Drawings are
instrument-scoped and use UTC time/price anchors across timeframes. Single and
each Multiple chart keep independent state, including the selected engine and
native instrument/timeframe. Removed chart panes retain their analysis records.

`core/chart-analysis.js` validates state and saves every edit automatically to
`chart_workspace_analysis`, separate from the existing v1 preferences contract.
The table references a registered Charts profile, has owner-only RLS and only
authenticated SELECT, INSERT(user_id,content) and UPDATE(content) permissions.
Revision and timestamps are controlled by a SECURITY INVOKER trigger. Anonymous
Auth writes, owner reassignment, forged revisions, DELETE and TRUNCATE are denied.
Bounded validated JSON holds pane state, per-instrument drawings/indicators, and
timeframe-specific visible time ranges. Empty arrays represent real removals.

Before a network request, every edit/removal is recorded synchronously in an
account-scoped browser recovery journal. Account saves read the latest revision
and replay only pending operations before a compare-and-update. A stale tab
cannot restore an old complete snapshot over a newer removal. Interrupted,
offline or conflicting saves retain the journal for retry and refresh recovery;
the status says **Analysis saved to your Charts account** only after a successful
account read/save. If local storage is unavailable and a save is still pending,
the UI tells the user to keep the page open and a navigation warning is enabled.
Switching users disposes their charts/feed and never reads another user's cache.

`core/deriv-chart-feed.js` resolves the two distinct public market identities
from the exact Deriv catalogue display names, caching the verified public mapping
for 30 minutes to avoid repetitive lookups on refresh. Matching panes share a
candle subscription. Historical OHLC and live OHLC updates are validated, with
`open_time` as the live candle anchor. UTC source times and public source/parity
labels remain visible. This feed does not authenticate MT5 or establish parity
with MT5/TradingView. Time ranges and old drawing anchors request earlier real
candles automatically (up to ten initial history batches); **Load earlier candles**
offers further user-directed history. Provider availability/retention still
governs whether old candles can render. Saved analysis remains in the account
and item list even when data is unavailable or its anchor is outside loaded
history. No fabricated candles or automatic reconnect loops are used.

Native verification: 15 persistence/indicator contract scenarios, 9 feed adapter
scenarios and 9 real native DOM/lifecycle scenarios passed. The 23 live SQL
checks validate owned creation/read, exact drawing/indicator/view restoration,
removal persistence, stale revision denial, account isolation, unsafe content
rejection and grants. All SQL fixtures roll back; before/after hashes of profiles,
preferences and existing analysis match. Existing Charts/recording regressions
also pass. The development environment received 1,000 real R_75 M5 candles and
two live OHLC updates; catalogue lookups and an earlier-history probe returned
RateLimit. Native source/API shape and cooldown behavior are tested; no sustained
feed or MT5 parity claim is made. No interactive browser or computed-layout QA
was available; DOM rendering tests use a chart API fixture and verify the real
vendored runtime exports separately. A visual check in the user's signed-in
browser remains necessary.

Relevant primary references:

- https://tradingview.github.io/lightweight-charts/docs/product-comparison
- https://tradingview.github.io/lightweight-charts/docs/plugins/series-primitives
- https://developers.deriv.com/docs/data/ticks-history/
- https://supabase.com/docs/reference/javascript/update

## Compact left controls panel

Charts now uses a scrollable left controls panel beside the main chart display. Layout, chart count, appearance, timezone, per-chart instrument/timeframe/responsibility settings, and Save preferences live in the panel. Use **Hide controls** to reclaim the full chart width and **Show controls** to restore it. On narrow screens, the panel stacks above the chart and begins collapsed. Individual chart configurations are collapsible, keeping the working chart area unobstructed. Existing chart frames remain mounted when the controls panel is hidden or shown.

## Deriv synthetic-index stage 1

The left Charts sidebar now includes an optional Deriv symbol chooser for each chart.
The two separate instruments are:

- **Volatility 75 (1s) Index** — `DERIV:VOLATILITY_75_1S_INDEX` ↔ observed Deriv MT5 `Volatility 75 (1s) Index.0`
- **Volatility 75 Index** — `DERIV:VOLATILITY_75_INDEX` ↔ observed Deriv MT5 `Volatility 75 Index.0`

These are name mappings only: historical candle equivalence, feed synchronization and order-price parity have **not** been verified.
The Charts sidebar keeps **My markets** above Layout. Click the section to open its saved-market list. Select a saved market to load it into the chosen chart; when using multiple charts, choose the target chart first. Adding a market from a chart opens the list so the new entry is visible. The **Add market** button at the top of each chart saves that chart's current instrument, and **Remove** beside each saved market deletes it from the list. Deriv symbols use their known market names and other symbols are saved by their `EXCHANGE:SYMBOL`. The list starts with Volatility 75 (1s) and Volatility 75, supports up to 30 markets, and is stored per user in this browser. It does not sync across devices. Existing chart defaults, saved market lists, journals, MT5 bridge connections and trade data are preserved.
The manual TradingView instrument field remains available for other symbols. No automatic order execution, chart capture, chart-to-trade pairing, or MT5 API changes are included.

## Official widget boundary

This feature uses TradingView's free **Advanced Real-Time Chart embed widget**,
loaded with the official external-embedding script. It does not use the licensed
Advanced Charts library. Attribution and native branding remain visible.
Symbol selection, intervals, supported indicators and drawings, chart navigation
and TradingView's popup action are provided by the widget.

TradingView supplies the market data; availability, licensing and delays vary
by instrument. A TradingView paid account does not upgrade embedded widget
feeds. Widgets do not expose a market-data API, personal account layouts or
custom Pine strategies. Changes made inside the widget, including drawings,
indicators and toolbar symbol/interval changes, remain in that widget session.
Use the T-IOS controls to save instrument/timeframe defaults. No personal TradingView login,
programmatic capture, TradingView credentials or speculative evaluations are
implemented. Existing optional Setup pictures remain unchanged.

Official references:

- https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/
- https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/demos/technical-analysis/
- https://www.tradingview.com/widget-docs/faq/many-widgets/
- https://www.tradingview.com/widget-docs/faq/general/
- https://www.tradingview.com/widget-docs/faq/data/
- https://www.tradingview.com/widget-docs/tutorials/iframe/set-widget-size/

## Architecture and persistence

`t-ios.html` adds only sidebar/page markup, module references and navigation /
sign-out hooks. `tios-charts.js` owns the UI and asynchronous preference state;
`tios-charts.css` scopes layout and scrolling to Charts. The pure contract in
`core/chart-workspace.js` validates the versioned preferences and creates the
official widget settings.

Each widget runs in a dedicated `tradingview-chart.html` iframe host. That host
creates the official embed script, preserves attribution and reports browser
load/error events. Disposing the host disposes its complete document, native
embed listeners, nested chart frame and network activity. No undocumented
TradingView destroy or settings API is used. The host receives only the symbol,
interval, theme, timezone and random instance identifier. Private responsibility
labels and user identity never enter widget requests or host URLs.

Charts are lazy-loaded only after the user opens Charts. Inactive layouts and
navigation away dispose their widgets. Unchanged Apply/Save actions and label
edits do not recreate charts. Autosized widgets follow their parent dimensions,
including sidebar transitions and individual expansion. Connection messages
sit outside the chart so they never cover native controls.

The additive migration creates `public.chart_workspace_preferences`, with one
row per authenticated user, bounded validated JSON, schema version, timestamps
and server-controlled revision. Explicit authenticated SELECT/INSERT/UPDATE
permissions and RLS restrict every operation to `auth.uid()`. Anonymous access
is denied; ownership is immutable. A revision condition on updates prevents
stale devices from overwriting newer settings. A failed preference load does
not silently replace saved data with defaults. Conflict handling offers an
explicit Reload saved preferences action.

Separate Single and Multiple arrays use stable chart IDs, symbols, TradingView
interval codes and analytical responsibilities. Arrays support bounded future
chart counts without changing the storage shape. No existing trade, journal,
account, rule, playbook, reflection, image bucket or scoring table is modified.
Future intelligence can join these declared responsibilities with separately
uploaded per-trade evidence; this feature makes no market observations or AI
claims.

## Account-entry verification (2026-10-10)

`tests/charts-account-entry.dom.cjs` exercises the real Charts DOM/state machine
with deterministic Supabase transport fixtures. Run it and the existing Charts
regressions with `node --test tests/*.dom.cjs` in a runtime providing `jsdom`.
The separate `tests/charts-account-entry.sql` runs against the real database;
its PL/pgSQL subtransaction unconditionally rolls back all profile fixtures.
It uses existing Auth IDs without changing Auth records or saved preferences.

Validation: 22 account-entry DOM scenarios, 14 existing Charts/feed/Instruments
DOM scenarios, 103 existing contract tests and 14 live profile RLS/grant checks
passed. Coverage includes first-time users, preferences without profiles,
returning profiles, profile-only partial setup, independent layouts, account
switching, stale requests, duplicate creation, conflicts, failed reads/saves,
private label isolation and the Auth callback. Database profile counts and saved
preference hashes were unchanged after verification. No new Charts security
advisor findings appeared. This run did not perform an interactive browser or
visual screenshot check; DOM verification does not assert computed layout.

## Verification

Run `node --test tests/*.test.cjs`, plus the existing reflection and period-Rules
browser suites for regression checks. `tests/charts-workspace.browser.cjs` walks
the real UI → Supabase Auth/REST/RLS → restored UI flow and loads the actual
TradingView widget and chart canvases. It uses two confirmed disposable Auth
users marked `tios_charts_qa`, each with a fixture account. Credentials arrive
privately on stdin; never commit tokens, credentials or browser state.

Input shape: `{ "users": [{ "id": "...", "email": "...", "password": "..." },
{ "id": "...", "email": "...", "password": "..." }] }`.

Environment:

- `TIOS_TEST_BROWSER`: installed Chromium executable.
- `TIOS_SUPABASE_JS`: local copy of the app's Supabase browser SDK.
- `TIOS_TEST_SCREENSHOT_DIR`: optional private QA screenshots.
- `TIOS_TEST_NETWORK_BROKER=1`: forwards real HTTP requests through the host
  connection in restricted environments; responses and authorization stay real.
- `TIOS_TEST_PROXY=1`: uses the environment's existing HTTPS proxy for browser
  connections, including TradingView's real market-data WebSocket. QA contexts
  accept that proxy's certificate; production code does not change TLS behavior.
- `TIOS_TEST_BASE_URL`: optional deployed T-IOS URL for deployment verification.

The test may reset only the explicitly marked fixture user's chart defaults
on a rerun. Cleanup must remove only those disposable users and accounts after
verification. It must never use existing customer data.

On 2026-10-10, verification passed 82 deterministic checks (including the four
new contract checks), 66 existing reflection/Playbook/scoring browser scenarios,
19 existing period-Rules checks and 19 real Charts browser checks. Real chart
canvases and the native indicator search rendered; both layouts, independent
controls, expansion, sidebar resizing, mobile stacking, saved defaults, refresh,
sign-out/fresh sign-in, revision conflicts and account isolation worked. Real
Supabase RLS denied foreign and anonymous access; server constraints rejected
malformed data and ownership changes. No new Charts advisor findings appeared.
