# T-IOS Sidebar Toggle Position and Motion — Revision 2

This revision follows the user's marked desktop position.

## Placement

The collapse toggle now sits at approximately 68% of the viewport/sidebar height.

The open-sidebar divider overlap is calculated from the 42px control width:
- about 65% remains inside the sidebar;
- about 35% (15px) protrudes to the right of the sidebar divider.

The reopen control mirrors the same vertical position at the left edge.

## Motion

The previous state change could look visually static. This revision adds:
- a short directional press pulse on click;
- a 340ms sidebar slide;
- a 340ms grid-width transition so the content expands/shrinks visibly;
- a slightly longer travel distance so the sidebar fully clears the divider.

No navigation, trading, intelligence, or data behavior changed.
