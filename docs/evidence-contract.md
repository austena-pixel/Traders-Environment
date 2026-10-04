# Stage 1A — shared evidence contract

Implemented against `main` at `012e6b3f6ed27b5f1c04d82e314cc66279d85ee1`.

## Current architecture found in the repository

- `index.html` is the current H-IOS entry point. `h-ios.html` is a separate older
  dashboard, not a redirect. Both routes remain intact.
- `g-ios.html`, `t-ios.html`, `s-ios.html` and `health-ios.html` are standalone pages.
- `hios-connection-layer.js` contains the working Goals/H-IOS signal contracts,
  permissions, requests, connector and browser transport. Its generated-file
  comment refers to source folders absent from this checkout. This stage does
  not edit that bundle or recreate those folders.
- T-IOS already publishes `hios.evidence.v1` playbook-review evidence inline.
  `index.html` already receives it. Other inline signal and selected-evidence
  request/response flows also exist. Their presence is not a claim that later
  stages have been verified or completed.
- Supabase session users supply `currentUser.id`; database records use `user_id`
  UUIDs referencing `auth.users`. Schema inspection was read-only.
- Goals, product connections, evidence buses and Health-IOS state use browser
  localStorage. Existing browser stores are not consistently user-scoped. No
  storage keys or records are migrated by this stage.

## Shared API

Load `core/evidence-contract.js` as a classic script before use. This matches the
current pages and avoids introducing a bundler or changing script execution order.
It exposes `window.HIOSEvidenceContract`; CommonJS export supports Node tests.
Only the existing evidence receiver in `index.html` is wired to it in Stage 1A.

- `SCHEMA`: `hios.evidence.v1` (the existing identifier encodes schema version 1).
- `SCHEMA_VERSION`: `1`. Independent of H-IOS V0–V9, product P0–P5 and model versions.
- `validateEvidence(value)`: `{ valid, errors }`, without changing the input.
- `createEvidence(fields)`: validates and returns a detached JSON copy. Defaults
  only `schema`; the caller must explicitly supply identity and occurrence time.
  Throws `TypeError` on invalid input, without including evidence values in errors.

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | Yes | Non-empty stable evidence identifier; preserve when retransmitting |
| `schema` | Yes on received evidence | Exact supported schema identifier |
| `sourceProductId` | Yes | Existing product ID, e.g. `tios`; no fixed product list |
| `domain` | Yes | Product-owned domain, e.g. `trading` |
| `userId` | Yes | Supabase auth user UUID; never an email or guessed local identity |
| `evidenceType` | Yes | Product-owned description of what the evidence represents |
| `observedAt` | Yes | Real ISO date/time with timezone, supplied by the producer |
| `subject` | Yes | `{ type, id }` identifying the source subject, e.g. a trade |
| `observation` | Yes | Plain JSON object containing structured domain evidence |
| `evaluation` | No | Product interpretation as a plain JSON object |
| `source` | No | Existing source/page label, e.g. `t-ios` |
| `sourceProductName`, `evidenceFamily` | No | Existing non-empty descriptive strings |
| `model` | No | Product-owned model metadata object or existing `null` |
| `context` | No | Plain JSON object for relevant source context, e.g. account ID |

Provenance uses existing fields: source product, subject reference, optional
`source`, `model`, `context` and observation references such as `reviewId`.
There is no mandatory score, model, metric, goal ID or universal progress formula.
Additional JSON fields are preserved. The contract checks structure, not domain
semantics, evidence truth, permissions, connection status or authenticated ownership.

Example (synthetic values only):

```js
const evidence = HIOSEvidenceContract.createEvidence({
  id: 'example-review-event-1',
  sourceProductId: 'tios',
  domain: 'trading',
  userId: '00000000-0000-4000-8000-000000000001',
  evidenceType: 'rule_compliance_assessment',
  observedAt: '2026-10-04T14:00:00+02:00',
  subject: { type: 'trade', id: 'example-trade-1' },
  observation: { reviewId: 'example-review-1' }
});
```

## Compatibility and boundaries

The existing format and transport are retained. `verifyHiosStructuredEvidence`
now delegates to shared validation. T-IOS publication and saving code is untouched.
Legacy valid T-IOS output remains accepted. Newly received malformed records
(including missing user IDs, invalid dates and array payloads) are rejected;
previously stored evidence and receipts are not rewritten or revalidated.

Use explicit nulls for unavailable domain values inside payloads. Undefined,
non-finite numbers, functions, class instances, accessors, sparse arrays and cycles
are rejected because JSON transport would lose or alter their meaning.

`observedAt` retains its current producer meaning; the existing T-IOS publisher
sets it at publication. A later connector must deliberately distinguish original
activity time from re-publication when appropriate. This stage does not change it.

Validation is not authorization. A UUID can be forged. Later connectors/routers
must compare evidence ownership with the authenticated session and enforce
connection/disconnection and selected-request scope before use. This stage does
not claim to fix the existing browser-local ownership or routing limitations.
G-IOS and Health-IOS must not invent authenticated IDs for local-only data.

No new transport, request bus, product activity, database schema, data migration,
UI change, scoring or automated planning is introduced. Stop here before Stage 1B.

## Repeatable tests

```sh
node --test tests/evidence-contract.test.cjs
```

Tests cover required/optional fields, invalid inputs, timezones/calendar dates,
JSON safety, copying, unchanged legacy signal/request behavior, and the actual
T-IOS publisher plus H-IOS receiver functions with synthetic users and in-memory
storage (including duplicate receipt and invalid-evidence rejection).

Local Chromium smoke checks also passed: unchanged login text against the base
commit, dashboard rendering after simulated sign-in, Auto Zoom toggle, G-IOS
daily-task Done updating H-IOS focus across tabs, and the older H-IOS and Health
routes rendering. No page JavaScript errors occurred in this isolated test.
Authentication was mocked and external requests blocked; this does not verify
live Supabase sign-in or authenticated trading writes. All six HTML pages' inline
scripts passed syntax checks. The existing pages and communication bundle were
otherwise left unchanged.
