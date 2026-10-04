# Stage 2A-2 — Execution Evolution / Trend Intelligence

Stage 2A-2 extends the canonical `tios.execution-intelligence.v1` model with a conservative execution trend.

## Method

T-IOS orders active execution reviews by their associated trade occurrence chronology. It compares:

- the latest 3 reviewed trades; with
- the immediately preceding 3 reviewed trades.

At least 6 comparable reviewed trades are required. With fewer than 6, the trend is `insufficient-evidence`.

## Classification

The overall trend is based on the change in execution adherence between the two equal 3-trade windows:

- `improving`: recent adherence is at least 10 percentage points higher;
- `worsening`: recent adherence is at least 10 percentage points lower;
- `stable`: the difference is smaller than 10 percentage points;
- `insufficient-evidence`: fewer than 6 reviewed trades or no comparable adherence.

The 10-point threshold prevents a single changed checkbox across two 18-check windows from being treated as a meaningful overall trend.

## Evidence retained

The trend contains both windows' exact review IDs and trade IDs, adherence, average score, misses, trades with errors and A+ counts. It also compares every execution criterion and identifies the strongest positive and negative criterion changes within the two windows.

These are current-window changes only. Stage 2A-2 does not label any criterion a persistent personal strength or weakness.

## Interface

The existing T-IOS Execution Intelligence note now reports the recent trend when at least 6 reviewed trades exist. No separate duplicate intelligence page was added.

The diagnostic remains:

```js
TIOSExecutionIntelligenceDiagnostic()
```

The returned object now includes `.trend`.

## Deliberately unchanged

- no Supabase schema/RLS/table changes;
- no automatic goal, task or deadline changes;
- no persistent-strength/weakness classification;
- no new H-IOS specialized-intelligence contract;
- no cross-domain reasoning;
- Stage 1A–1E behavior remains intact.
