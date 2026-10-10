# TradingView sign-in from Charts

**TradingView login ↗** is visible in the first chart header, including when controls are collapsed on mobile or the Instruments view is open. The settings sidebar also starts with a **TradingView account** section and **Sign in to TradingView ↗**. Both links open the official `https://www.tradingview.com/accounts/signin/` page in a new tab using `noopener noreferrer`.

Sign-in happens on TradingView's website. This is not an account connection to the embedded charts. T-IOS does not handle TradingView credentials, inspect its session, show a connected status, or sync saved layouts, drawings, subscriptions or market data permissions. The interface states the distinction next to the sidebar link and describes it for both links.

The existing **Open TradingView ↗** link now opens the first chart's T-IOS configured symbol. Applying or resetting that chart updates the link. It passes only the symbol, with no private responsibility, T-IOS user, trading account or trade identifiers. TradingView toolbar changes remain unobservable; the link does not claim to follow those changes. Signing in does not rebuild a chart or change preferences or customer records.

The official widget constructor and [widget FAQ](https://www.tradingview.com/widget-docs/faq/general/) do not document an account sign-in integration. The FAQ states that widgets do not set cookies or track user information beyond the listed connection metadata. The [data FAQ](https://www.tradingview.com/widget-docs/faq/data/) explains that paid TradingView plans do not upgrade embedded widget data. This implementation uses supported website navigation instead of undocumented authentication or iframe access.

Validation: 103 Node tests and 14 DOM tests pass, including desktop/mobile access, both sidebar modes, official sign-in targets, external-link privacy, configured-symbol/reset consistency, no chart rebuild on link activation, and no database writes. JavaScript syntax, the existing Vercel provider check and whitespace checks pass. DOM tests do not perform a real TradingView login; live browser layout and the complete user authentication flow remain unverified.
