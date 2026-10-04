# Stage 1E — H-IOS to Goals-IOS structured reorientation

Implemented from Stage 1D commit `ca24c8997bf14150b0378f2c2a60f453f740a33a`.

## Scope completed

Stage 1E closes the first controlled adaptation loop without introducing autonomous goal rewriting.

The controlled example is intentionally narrow:

- Goals-IOS requests `execution_errors` for a Trading progress stage.
- Traders-IOS returns the requested metric through the Stage 1D path.
- If the verified response reports more than zero execution errors, the shared H-IOS Communication Centre creates one `hios.goal-reorientation-request.v1`.
- The request includes the exact evidence basis and one proposed adjustment: a `working-emphasis` to reduce execution errors before increasing pace.
- The proposal explicitly sets `requiresUserApproval: true` and `preserveGoalStructure: true`.
- Goals-IOS receives/replays the proposal and shows it in the existing Personal Intelligence area.
- The user can **Apply working emphasis** or **Keep current plan**.
- Applying changes only the active progress phase's `workingEmphasis` metadata. It does not create, delete, rename or reschedule goals/tasks.
- Goals-IOS acknowledges the H-IOS request with the user's decision.

## Why this is Stage 1, not advanced autonomous intelligence

This is one deterministic, testable rule based on one requested metric. H-IOS is not yet ranking the user's whole life, rewriting goals, creating tasks, changing deadlines or making broad autonomous conclusions.

The purpose is to prove the architecture:

```
specialized evidence
→ Goals-IOS requested evidence
→ H-IOS validates/evaluates
→ structured reorientation request
→ user decision in Goals-IOS
→ working-plan emphasis
→ future execution/evidence
```

## User-control safeguard

A meaningful plan adjustment is never applied just because evidence exists. The H-IOS proposal remains pending until the user explicitly accepts it. Rejecting/keeping the current plan leaves the progress model unchanged.

## Duplicate and freshness safeguard

For one evidence request, H-IOS keeps at most one pending `execution_errors` reorientation proposal. If T-IOS sends newer execution evidence for that same request, H-IOS refreshes the pending proposal's evidence basis instead of leaving the old value frozen or creating a duplicate card. If refreshed execution errors reach zero before the user decides, the pending proposal is withdrawn.

## Deliberately unchanged

- No Supabase schema/table/RLS/data changes.
- No goal/task/deadline rewriting.
- No automatic priority engine.
- No unrelated interface redesign.
- Existing Stage 1A–1D evidence/request/response paths remain intact.
- Health-IOS and Students-IOS are not included in this controlled Stage 1E rule.

## Repeatable checks

```sh
node --test tests/evidence-contract.test.cjs
```

Stage 1E tests cover proposal generation from non-zero execution errors, zero-error no-op behavior, duplicate prevention and explicit user acceptance that changes only the phase working emphasis.
