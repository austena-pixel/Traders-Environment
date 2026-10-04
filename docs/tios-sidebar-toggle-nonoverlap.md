# T-IOS Sidebar Toggle — Non-overlap Revision

This revision fixes the two overlap cases identified in live screenshots.

## Open sidebar

The collapse control remains approximately 65% inside / 35% outside the vertical sidebar divider, but it is moved upward into the brand-height zone.

Its 48px height now runs from 22px to 70px, keeping it clear of:
- the brand's bottom horizontal divider;
- the trading-account card below;
- the nearby T-IOS brand copy.

## Closed sidebar

A 56px desktop control rail is retained on the far left while the full sidebar is hidden.

The reopen control sits inside that rail at 8px from the left and 22px from the top. The main page begins after the rail, so the control cannot overlay:
- the Personal Trader Intelligence hero;
- page headings;
- cards or calendar content.

A subtle divider/background makes the rail intentional while still allowing almost the full screen width for T-IOS.

No trading, navigation, data, or intelligence logic changed.
