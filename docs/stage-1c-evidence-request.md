# Stage 1C — Goals-IOS selected evidence request through H-IOS

Implemented from Stage 1B commit `045a3f12341746c72815ef3776293421fd9150b3`.

## Scope completed

Stage 1C proves the request half of the Goals-IOS → H-IOS → Traders-IOS path:

1. A user defines a Goals-IOS progress phase and selects the evidence metrics that phase needs.
2. For Traders-IOS, Goals-IOS removes duplicate/empty metric names and does not issue a request when no evidence is selected.
3. Goals-IOS sends that selected T-IOS request to the H-IOS Communication Centre as `evidence.requested`.
4. The H-IOS router validates request structure, source, target, selected metric list, timestamp, routing metadata and the current Traders-IOS connected state.
5. Only after H-IOS accepts the request is the existing `hios_goal_evidence_requests_v1` compatibility store updated. The request records its H-IOS signal ID and routed status.
6. H-IOS can receive the live connector signal or replay its queued pending request after H-IOS opens, then records the existing verified request receipt and acknowledges the connector request.
7. Traders-IOS continues to evaluate only `request.metrics`; it does not expand a Goals-IOS request to unrelated trading information.

## Connection behavior

If Traders-IOS is removed from H-IOS, the shared router rejects the request and Goals-IOS does not write a T-IOS evidence request to the compatibility store. Re-adding Traders-IOS permits later requests.

## Deliberately unchanged

- No Supabase schema, table, RLS or data migration changes.
- No Goals-IOS, H-IOS or Traders-IOS visual redesign.
- Health-IOS and Students-IOS request behavior is not migrated in this stage.
- Stage 1C does not redesign the T-IOS response format.
- Stage 1D remains the response path back through H-IOS to Goals-IOS.
- Stage 1E remains structured H-IOS → Goals-IOS reorientation.

## Repeatable checks

```sh
node --test tests/evidence-contract.test.cjs
```

Stage 1C tests cover selected-only metrics, H-IOS routing metadata, request receipt/acknowledgement, T-IOS selected-metric response scope, empty-selection handling and disconnected-target rejection.
