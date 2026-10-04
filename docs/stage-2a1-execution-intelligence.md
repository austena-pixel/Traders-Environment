# Stage 2A-1 — T-IOS Execution Intelligence Model

Implemented after live verification of Stage 1E.

## Purpose

Stage 2A-1 establishes the first canonical Specialized Intelligence model inside Traders-IOS. It does not add autonomous planning, trend conclusions, persistent personality claims, or cross-domain reasoning.

The model is derived only from existing T-IOS execution reviews and execution checks.

## Model

Schema:

`tios.execution-intelligence.v1`

The model contains:

- active account scope;
- reviewed-trade and total-trade sample counts;
- evidence coverage;
- total execution checks, complied checks and criterion misses;
- number of reviewed trades containing at least one miss;
- A+ execution count;
- average execution score;
- overall execution adherence and error rate;
- per-criterion checks, compliance, misses and affected trades;
- current strongest and weakest criteria for the present sample;
- exact review/trade identifiers supporting the snapshot;
- a conservative maturity state: needs evidence, building, or active.

"Current strongest/weakest" is deliberately a snapshot description. Stage 2A-1 does not call a criterion a persistent strength or weakness. Persistent-pattern logic belongs to a later stage.

## Canonical use

The existing T-IOS Intelligence Execution card now reads its reviewed-trade count and average execution score from this model.

The existing Behaviour Intelligence summary derives its repeated execution deviation from this model.

The H-IOS-requestable metrics `execution_adherence` and `execution_errors` also read from this same model, preventing the UI and H-IOS evidence path from using separate calculations.

For compatibility, `execution_errors` retains its existing external metric name and `errors` unit. Internally its value is the count of failed execution criteria, not the number of trades.

## Diagnostic

In a logged-in T-IOS browser session:

```js
TIOSExecutionIntelligenceDiagnostic()
```

returns a copy of the current canonical execution-intelligence snapshot.

## Deliberately unchanged

- No Supabase schema, RLS, table or data migration.
- No automatic goal/task/deadline changes.
- No trend engine yet.
- No persistent strengths/weaknesses classification yet.
- No H-IOS Specialized Intelligence contract yet.
- No unrelated UI redesign.
- Existing Stage 1A–1E routing remains intact.
