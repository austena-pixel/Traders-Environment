# Flexible Execution Reflection Structures

The permanent Execution checklist has been removed from the active editor.

## User-controlled structures

Each user/account can now keep multiple named reflection structures and select which one to use for a new execution review.

A structure can contain any mix of:

- checklist items — measurable yes/no execution conditions;
- reflection sentences — free-text prompts for qualitative reflection.

Users can create, edit, reorder and delete structure definitions.

Deleting a structure definition does not delete historical reviews.

## Recommended structure

The former T-IOS execution list is no longer automatically imposed.

A **Use Recommended** button lets the user add a reusable copy of the T-IOS recommended structure when desired. That recommended copy contains the six prior checklist concepts plus the prior written reflection prompts.

## Historical integrity

Reviewed trades continue to render the exact criterion rows saved with that review. Their structure is locked to the historical review so a later template edit cannot silently rewrite history.

A historical structure can be copied into the user's reusable structure library.

Existing legacy text fields (What Went Well, Execution Errors, Next Adjustment and Additional Notes) remain visible only when an older saved review contains them.

## Scoring

Only checklist items contribute to Execution Score / A+ / A / B.

Free-text reflection prompts are stored as qualitative evidence and are excluded from numeric scoring.

A text-only reflection can therefore be saved without manufacturing a 0% or 100% execution score.

## Persistence

Reusable structure definitions are scoped to the signed-in user and selected trading account in browser localStorage. Completed review responses continue to use the existing Supabase execution-review/check tables, so no Supabase schema/RLS/table change was required.

A later cloud-sync stage can move reusable structure definitions into Supabase without changing the completed-review evidence format.
