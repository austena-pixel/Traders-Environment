# Stage 1B — one real T-IOS evidence connection

Implemented from Stage 1A commit `5c06c949fb3dd941b66d6d40bcdd308ae054e1e9`.

## Scope completed

Stage 1B proves one small end-to-end path only:

1. A successful T-IOS Playbook review save remains a normal Supabase save.
2. After the save succeeds, T-IOS builds `hios.evidence.v1` evidence with the shared `HIOSEvidenceContract`.
3. T-IOS publishes that evidence through `HIOSConnectionLayer.connect('t-ios')` as `evidence.observed`.
4. The shared communication router checks source permission, the existing H-IOS product add/remove state, and the shared evidence contract before routing.
5. H-IOS subscribes to the routed T-IOS evidence and records it through the existing verified-evidence receipt path.
6. The previous bounded `hios_structured_evidence_bus_v1` remains as a compatibility/catch-up store. Receipt IDs prevent the live route and catch-up route from recording the same evidence twice.

The evidence occurrence time for this activity comes from the saved Playbook review's `reviewedAt` value when available, rather than being inferred from storage.

## Connection/disconnection behavior

The existing H-IOS product list `hios_added_products_v1` remains the source of truth. When Traders-IOS is removed from H-IOS, the shared router rejects new `t-ios` evidence and T-IOS does not append it to the structured evidence bus. Re-adding Traders-IOS allows later evidence to route again. Existing verified evidence is not deleted.

Disconnecting T-IOS does not block the trading interface or the Supabase Playbook review save. Evidence publication happens only after the existing review and review-check writes succeed.

## Deliberately unchanged

- No Supabase schema, table, RLS, or data migration changes.
- No trading UI redesign.
- No expansion to every T-IOS activity.
- No G-IOS request routing or H-IOS reorientation work; those remain later stages.
- Existing Goals-IOS/H-IOS signal contracts continue to work.

## Repeatable checks

```sh
node --test tests/evidence-contract.test.cjs
```

The tests cover the Stage 1A contract plus this Stage 1B connector path, duplicate receipt protection, disconnection rejection, and preservation of the Playbook review save-before-publish order.
