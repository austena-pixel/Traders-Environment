# T-IOS market data verification — 10 October 2026

This extends the module in `f5340b79ead859de7b436dedcb383cf1482df54b`. MT5 execution records are authoritative for actual trades. TradingView remains the analysis interface. No broker price is adjusted to match TradingView; no trading commands or execution-score adjustments are introduced.

## Implemented

- **Charts → Market Data Verification** in the independently scrolling settings rail, retaining single/multiple charts, saved defaults, expand controls and the large chart viewport.
- Separate Volatility 75 (1s) and standard Volatility 75 identities. Conservative suffix matching accepts exact instrument stems followed by broker suffixes such as `.0`, `_pro` or `#1`. The account's exact detected symbol is displayed and selectable; a suffix never merges the two markets.
- H4, H1 and M5 completed-candle requests for an exact UTC opening. Requests expire after 15 minutes. Authenticated users can queue at most ten pending requests per account.
- A separate **read-only candle companion** and `mt5-market-data` Edge Function share the existing MT5 account link/key authentication. The existing `mt5-sync` version 3 and trade bridge are unchanged. The new endpoint checks the enabled bridge, hashed key, account login, server and demo/real identity. It accepts only its account's pending requests.
- Immutable original MT5 OHLC, raw broker timestamp, explicit broker UTC offset, terminal retrieval time, server retrieval time and available bar volume/spread metadata. Repeated delivery does not overwrite the first accepted candle.
- Manual MT5 fallback and manual TradingView observations, with separate observed symbol/timeframe/opening, observation timestamps, explicit identity confirmation and notes. No widget OHLC extraction, scraping, private endpoint, synthetic TradingView feed or symbol-change listener is used.
- Server-calculated individual **MT5 − TradingView** differences, equal-price / consistent-offset / different-shape interpretation, identity checks and stale-data checks. Every saved comparison remains non-authoritative. Equal manual values are **Unverified Market Data**, different identity/prices are **Mismatch**, and missing/incomplete/stale/unconfirmed observations are **Insufficient Data**. **Verified Mapping** is a separate name-mapping indication, not a price-history verdict.
- Comparison history with pagination, original prices, differences, source timestamps and linked position/deal IDs.
- **Market evidence** actions on supported MT5 trades in Journal Records and the day-trade list. Links use the existing authenticated owner/account/trade and position; all associated deals, including partial closes, are recorded without creating trades. Existing entries, reflections, reviews, scores and three-timeframe screenshots are preserved.
- The chart footer now says **T-IOS configured** and warns that the widget display may differ after toolbar changes. **Reset instrument** reloads that chart to its saved symbol/timeframe, or its configured settings when no saved chart exists. T-IOS does not claim to know the widget's current instrument.
- A conservative future Strategy Intelligence evidence gate. Source provenance, unsupported conditions and lookahead risk remain explicit. OHLC cannot establish conditions before its candle closes. Legacy entry clocks remain unverified; the current database cannot certify authoritative at-entry reconstruction. No automatic backtest, signal or trading feature is enabled.

## Database and deployment

Migrations `20261010122700_market_data_verification.sql` and `20261010124654_preserve_precise_feed_differences.sql` were applied to **Traders Environment** (`tmxosoyqflmwqzjgnkez`). It adds four RLS tables: `mt5_market_symbols`, `mt5_candle_requests`, `mt5_market_candles`, and `market_feed_comparisons`.

Authenticated clients have owner-scoped reads; only requests and comparisons allow client inserts. Broker records cannot be inserted by clients. Evidence cannot be updated or deleted by clients. Invoker triggers verify account/trade/candle ownership, copy trusted broker OHLC, derive deal links and recalculate status/differences. No privileged definer function was added.

The `mt5-market-data` function was deployed ACTIVE, version 1. Its platform JWT check is disabled because MT5 uses custom bridge-key authentication; the function fails closed without the enabled link, matching key hash, login, server and account type. Secrets remain server-side or in the owner's MT5 inputs.

Existing record counts after rolled-back QA: **83 trades, 157 deals, 5 screenshot evidence rows**, unchanged. New evidence tables contain no fabricated broker candles or persisted QA comparisons.

## Verification performed

- Full existing Node regression suite plus comparison/bridge tests: **95 tests passed**. Coverage includes evidence contracts, Playbooks/Rules, Execution structures and scoring, journal library behavior, period reviews, chart preferences and H-IOS communication.
- **3 DOM integration tests passed**: calculations, manual fallback, trade linkage, immutable save payload, history, market mismatch, saved-symbol reset, single/multiple layouts, retained chart frames, independent controls, draft preservation, user-session cleanup, and opening market evidence from the day-trade modal without resetting its draft. These are DOM tests, not a live browser/visual review.
- Known completed **fixture candles**, not live broker samples: exact UTC identity, all OHLC deltas, equal prices, nonuniform changes, consistent offsets, H4/H1/M5, explicit historical clock offsets, incomplete candles, invalid values and stale retrievals.
- Real Supabase transaction tests with two existing marked QA users: own-row inserts/reads, other-user invisibility, cross-account write rejection, broker-price forgery rejection, server-recomputed statuses/differences, partial/multiple deal links and unchanged trade entries. All QA rows were rolled back. Test script: `tests/market-feed-verification.sql`.
- Live deployed endpoint: missing/wrong bridge credentials return 401; unsupported method returns 405. No supplied key is echoed. Anonymous REST access to all four new tables is blocked.
- Security advisors: no finding concerns the new tables/functions. Existing project advisories concern public execution of `handle_new_user`, authenticated execution of the AI quota function, a private usage table with no client policies, and disabled compromised-password checks. References: [anonymous definer functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated definer functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [private table policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- JavaScript syntax and inline scripts parse; Git whitespace checks pass.

## Live mapping evidence and remaining limits

The connected account's stored executions include **26 trades** with `Volatility 75 (1s) Index.0` and **one** with `Volatility 75 Index.0`. TradingView's official public pages separately identify [the 1-second market](https://www.tradingview.com/symbols/DERIV-VOLATILITY_75_1S_INDEX/) and [the standard 2-second market](https://www.tradingview.com/symbols/DERIV-VOLATILITY_75_INDEX/). This verifies historical name association only.

The last MT5 trade-bridge heartbeat was **25 September 2026 at 19:17 UTC**. The live terminal, current suffix catalogue, actual historical candle delivery, historical clock setting and real MT5-versus-TradingView price parity remain unverified. The companion source has not been compiled or executed in MetaEditor/MT5 in this environment. Browser/visual QA is unavailable here; DOM interaction tests do not substitute for it.

The official embedded widget [does not provide a data/export API](https://www.tradingview.com/widget-docs/faq/data/). The [Advanced Chart widget settings](https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/) do not document a reliable symbol-change event for this embed. The licensed Advanced Charts library is a different integration and supplies no TradingView data itself. Automatic TradingView OHLC comparison is therefore unsupported; the shipped alternative is honest manual observation.

Clock confirmation records an explicit terminal configuration, not independent verification of historical UTC offset. The broker's offset must be checked for the requested date; automatic current-clock conversion cannot prove a historical offset. Full at-entry strategy reconstruction remains blocked until execution timestamps are independently verified.

## Using it

1. Open T-IOS **Charts**, show controls and expand **Market Data Verification**. Select the linked MT5 account, instrument, exact symbol, timeframe and completed candle opening in UTC.
2. Manual comparison works immediately: select **Manual MT5 observation**, enter both charts' original OHLC, specify each observation time and TradingView's observed identity, then save. Differences do not alter trades or scores.
3. For broker candles, download `mt5/TradersEnvironmentMarketData.mq5` from the setup section. Compile it in MetaEditor and attach it to a second chart on the same account. Keep the existing trade bridge running. Configure the existing Connection ID and Bridge Key privately, allow WebRequest to the Supabase project, and explicitly confirm `BrokerCandleUTCOffsetMinutes` for the requested date. Its default `99999` rejects unconfirmed clocks. Do not assume UTC merely from the symbol name.
4. Request the exact completed MT5 candle. Start with one H1 candle, then check H4 and M5. The original broker values will populate once the companion returns accepted data. Enter TradingView observations manually.
5. From a supported journal trade, click **Market evidence** to link the existing trade and its deal identifiers. The last completed UTC candle before the recorded entry is a convenience selection; inspect the historical broker clock and exact opening. At-entry certainty remains unverified.

## Reproducing tests

`node --test tests/*.test.cjs tests/mt5-market-data.test.mjs`

DOM QA requires `jsdom@26.1.0` in the local test environment:
`NODE_PATH=/path/to/test/node_modules node --test tests/market-feed-ui.dom.cjs`

Run `tests/market-feed-verification.sql` with the authorised project SQL connection. It requires two existing users marked `tios_charts_qa`, uses only temporary transaction data, and ends with rollback.
