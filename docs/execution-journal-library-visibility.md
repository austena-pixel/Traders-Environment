# Execution Journal Library Visibility Fix

A created Execution Journal was successfully stored, but it could disappear from view when the selected trade already had an execution review.

The cause was UI-only: reviewed trades hid the saved-journal selector and showed only the historical journal attached to that trade.

## Updated behavior

The Execution editor now always shows **My Journals** with a live saved-journal count and selector.

When viewing an already-reviewed trade:
- the main review still renders the exact historical journal used for that trade;
- My Journals remains visible;
- selecting a different journal changes the active journal for future/unreviewed trades only;
- it does not rewrite the historical review.

When viewing an unreviewed trade:
- the currently selected My Journals entry becomes the active journal used for that new review.

Creating a journal now confirms that it is visible under My Journals.

No review data, Supabase tables, or historical evidence were changed.
