# T-IOS Desktop Readability and Collapsible Sidebar

Implemented after Stage 2A-2B.

## Desktop sidebar

T-IOS now has a desktop-only sidebar collapse control. Collapsing the sidebar removes its grid width so the active page can use the full browser width. A reopen control remains available at the top-left of the viewport.

The collapsed/open state is remembered in browser localStorage under:

`tios_desktop_sidebar_collapsed_v1`

The existing mobile drawer behavior remains unchanged.

## Readability

The previous desktop-wide CSS rule that forced the whole T-IOS page to `zoom: 0.90` has been removed. Desktop now renders at the browser's normal 100% scale.

The smallest labels in the Execution workflow and sidebar were also increased modestly, especially:

- execution criterion headings and descriptions;
- reflection / help text;
- execution score labels;
- trade-card metadata;
- sidebar group/submenu labels;
- account-switcher labels.

No trading, evidence, intelligence, Supabase, or Stage 1/2 behavior was changed.
