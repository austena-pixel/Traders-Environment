# Stage 2A-2B — User-Defined Execution Reflection Foundation

## Core decision

The six checks currently shown under T-IOS Execution are not permanent T-IOS rules. They are now explicitly defined as the **T-IOS Recommended Execution Reflection · v1**.

The current editor still uses this recommended structure. A later editor can let each user create/select their own reflection structures.

## Historical integrity without a database migration

Each saved execution check already contains its criterion key, label and sort order. T-IOS now derives a deterministic reflection-structure signature from the rows actually stored with each review.

Old reviews therefore keep the structure they were completed with. Nothing is rewritten, and no Supabase schema/RLS/table change is required.

## Template-aware scoring

Execution score and grade are calculated from the checks actually saved with that review, not from a hard-coded six-item list.

Current grade convention:
- no misses = A+;
- one miss = A;
- two or more misses = B.

The default six-check editor behaves exactly as before, while a future custom review can have a different number of checks.

## Comparable Specialized Intelligence

The canonical execution intelligence model now scopes current criterion analysis to the latest reflection structure and records:
- total reviewed trades;
- comparable reviewed trades;
- incompatible reviews excluded from current analysis;
- the current structure's fingerprint and criteria.

Trend intelligence also compares only identical reflection structures. If a user switches to a new custom structure and does not yet have six comparable reviews, the trend becomes `insufficient-evidence` instead of comparing unlike checklists.

## H-IOS evidence

Execution adherence and execution-error responses retain their existing Stage 1 metric names, but their details now include the reflection template ID and reflection fingerprint that produced the metric.

## Interface clarification

The Execution editor now explicitly labels the current checklist as:
**T-IOS Recommended Execution Reflection · v1**

and tells users it is a recommended starting structure rather than a permanent checklist.

## Not included yet

- custom reflection builder/editor UI;
- template selection UI;
- Supabase schema changes;
- persistent strength/weakness conclusions;
- automatic goal/task changes;
- cross-domain reasoning.
