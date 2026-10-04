# Execution Journal Creation Fix

The prior flexible-reflection update still tied journal creation too closely to the selected trade. When a reviewed trade was selected, the UI hid the New Structure action. Since T-IOS usually opens on an already reviewed trade, users could appear unable to create another journal.

## Changes

- Added an always-visible **+ New Journal** button to the Execution page header.
- A new journal can now be created regardless of whether the selected trade is reviewed or unreviewed.
- The in-panel **+ New Journal** action also remains visible for reviewed trades.
- The recommended journal can also be added while viewing a historical review.
- Historical reviews remain locked to the structure they were completed with.
- Saving a new journal makes it active for future/unreviewed trades.
- Builder language now consistently says Execution Journal rather than internal "structure" terminology.
- The journal modal now has a stronger z-index so it stays above the fixed Execution workspace.

No Supabase schema or historical execution review was changed.
