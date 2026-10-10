# TradingView Charts workspace

Open **Charts** directly below Dashboard in the T-IOS sidebar. Choose **Single
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

## Compact left controls panel

Charts now uses a scrollable left controls panel beside the main chart display. Layout, chart count, appearance, timezone, per-chart instrument/timeframe/responsibility settings, and Save preferences live in the panel. Use **Hide controls** to reclaim the full chart width and **Show controls** to restore it. On narrow screens, the panel stacks above the chart and begins collapsed. Individual chart configurations are collapsible, keeping the working chart area unobstructed. Existing chart frames remain mounted when the controls panel is hidden or shown.

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
Use the T-IOS controls to save instrument/timeframe defaults. No account login,
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
