# Stage 1D — T-IOS evidence response through H-IOS to Goals-IOS

Implemented from Stage 1C commit `80e3090fbf365868387011741f93f53f3570e37a`.

## Scope completed

Stage 1D completes the selected-evidence round trip:

1. Traders-IOS reads the active routed Goals-IOS request and calculates only the metrics listed in `request.metrics`.
2. Traders-IOS packages those results in `hios.goal-evidence-response.v1` and emits `evidence.responded` through the H-IOS Communication Centre.
3. The H-IOS router checks the response source, request ID, selected metric scope, delivered/unavailable split, evidence payload, status, timestamp, active request and current product connection before routing it.
4. The routed response is stored durably in the existing H-IOS communication queue so it survives page navigation. H-IOS can record a response receipt without consuming it.
5. Goals-IOS consumes the routed response, verifies it again against its active T-IOS request, updates the existing response/request compatibility stores and materializes only the delivered requested metrics into `hios_product_goal_evidence_v1`.
6. Goals-IOS acknowledges the routed response after applying it. Duplicate live/replay delivery cannot create duplicate evidence rows.

For example, if a phase requests only `execution_errors`, a response containing `discipline_score` is rejected by H-IOS.

## Important architectural change

Before Stage 1D, Traders-IOS directly wrote goal-evidence rows and response state into stores read by Goals-IOS. Stage 1D removes that direct response-side write for routed T-IOS requests. Traders-IOS now produces the response; H-IOS validates/routes it; Goals-IOS applies the verified result.

The older general T-IOS signal publisher remains for unrelated legacy signals, but the selected goal-evidence response path no longer uses it to bypass H-IOS.

## Connection and persistence behavior

- Removing Traders-IOS still prevents new evidence responses from routing.
- A response can be generated while H-IOS or Goals-IOS is not the visible page because the H-IOS communication queue persists it.
- Returning to Goals-IOS replays the pending routed response and then marks it handled.
- Existing prior evidence is preserved; Stage 1D performs no migration or deletion.

## Deliberately unchanged

- No Supabase schema, table, RLS or data migration changes.
- No UI redesign.
- No automatic goal reorientation. That remains Stage 1E.
- Health-IOS and Students-IOS are outside this response-path migration.

## Repeatable checks

```sh
node --test tests/evidence-contract.test.cjs
```

Stage 1D tests cover a one-metric `execution_errors` request, response routing, no direct T-IOS write into G-IOS evidence stores, Goals-IOS application, response acknowledgement, replay deduplication and rejection of out-of-scope metrics.
