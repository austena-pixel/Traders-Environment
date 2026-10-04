# T-IOS Execution Fixed Workspace

The desktop Execution page now behaves as a fixed-height workspace.

## Fixed areas

The browser page itself no longer scrolls while Execution is active on desktop.

The following stay in place:
- Execution page heading and actions;
- Reviewed / Average / A+ / Unreviewed summary cards;
- Trades panel frame and filters.

## Independent scroll areas

A — Trades:
- only the trade list scrolls vertically;
- the Trades heading, search/filter row and help box remain inside the fixed panel.

B — Execution review:
- the entire review content scrolls inside its own panel;
- scrolling B does not move A, the summary cards, or the page header.

Both scroll areas use contained overscroll so wheel/trackpad movement does not propagate to the browser page.

## Responsive behavior

This fixed workspace applies from 861px upward.

The previous <=1150px rule that stacked the Execution panes is overridden while in the desktop workspace, so A and B remain side-by-side down to the mobile breakpoint.

At <=860px, the existing mobile/normal document scrolling remains unchanged.

No trading, intelligence, Supabase, evidence, or sidebar logic changed.
