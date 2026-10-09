# H-IOS intelligence development — homepage foundation

The canonical homepage is `index.html`. This is an incremental UI change; the
older standalone `h-ios.html` route and the internal T-IOS/G-IOS pages are unchanged.

## Implemented

- Concise Priority Intelligence using the existing daily-task and dated-commitment
  calculations. Calendar, daily progress and product navigation retain their
  existing calculations and storage keys.
- Daily Progress Status now occupies the upper-left panel. Its old controls/counts have
  been removed, with Sign out retained in the product sidebar. Auto Zoom follows
  the moved progress panel and the intelligence panel without changing calendar
  width. Category progress remains scrollable when many categories are active.
  The heading and description marked B in the follow-up screenshot are removed
  to reduce the height of the top row; the progress calculations and toggle remain.
  The subsequent circled category breakdown is removed from the homepage;
  **Overall Today** still combines tasks across active categories. Goals-IOS
  retains its category views. The zoomed intelligence pane can expand outside
  its outer container and paints in front of the calendar, while its own list
  continues to scroll internally and its bottom stays within the viewport.
- The combined former B/D sidebar contains a vertical Intelligence Development
  list grouped by product. T-IOS holds Trading Edge and Execution Quality rows;
  G-IOS holds Goals Intelligence; H-IOS holds Cross-Intelligence. Each product has
  a **View available capabilities** button listing existing tools and proposed
  advanced capabilities for its domains. The former Today's Focus panel is
  replaced; daily-task totals remain in Priority Intelligence.
- A fixed viewport workspace. The intelligence list marked A scrolls by wheel,
  touch or keyboard within its own region. Daily category progress and product
  navigation have separate scroll areas. The document and main calendar layout
  do not scroll. On smaller screens the calendar and intelligence panes stack
  inside the remaining viewport; calendar task lists scroll inside their cells.
  The calendar date grid can scroll internally on short mobile screens so its
  dates retain a readable minimum height.
- Four independently assessed domains, one continuous progress bar for the
  current level, a native modal
  details drawer, evidence overview, capability presentation and transparency.
- The six proposed maturity stages remain available in the details drawer.
  Within-level progress requires a separate, current assessment for the same
  level and an explained basis. It is not inferred from the number of levels,
  record counts or product scores. Missing progress is explicitly pending rather
  than displayed as an assessed 0%.
- Explicit **Not yet assessed** states. Unknown assessment is distinct from an
  established Level 0. No record count, existing execution score or subscription
  is converted into a maturity level.
- Existing source tools are available independently of maturity and according
  to product connection state. Proposed advanced capabilities await assessment.
- Notification drawer and an empty state. No synthetic development events are
  generated. Unread counts only use supplied, supported, authenticated-user events.
- New evidence inspection reads only structurally valid T-IOS
  `rule_compliance_assessment` records whose `userId` matches the active Supabase
  session. Duplicate IDs are excluded. Other products' unscoped browser stores
  are not used to claim evidence quality or personal maturity.

The existing `hiosVerified` receipt flag means format/receipt verification. It is
not used to claim reliability verification. Locally received execution records
are explicitly labelled as source records, with reliability assessment pending.
The UI does not authenticate their provenance or establish their truth.

## Future adapter boundary

`core/intelligence-development.js` contains the catalog and conservative display
selectors. `hios-intelligence.js` owns presentation and session lifecycle.

`window.HIOSIntelligenceUI.connect(provider)` optionally accepts:

- `load({userId})`: returns a snapshot (or a Promise).
- `subscribe({userId}, onSnapshot)`: optionally returns an unsubscribe function.

No provider is installed by this change. A future provider must authenticate the
session and verify permissions, provenance, domain validation and reliability
**upstream**. Client identity equality is a session-isolation check, not an
authorization system. Do not wire an unverified browser store into this boundary.

Snapshot shape:

```js
{
  schema: 'hios.intelligence-development.v1',
  userId: '<authenticated user UUID>',
  maturity: {},         // keyed by domain ID
  evidenceQuality: {},  // keyed by domain ID
  readiness: {},        // keyed by capability ID
  entitlements: {},     // keyed by capability ID; independent of maturity
  notifications: [],    // actual intelligence events
  adaptation: {}        // reserved; no automated actions are implemented
}
```

Domain IDs: `trading-edge`, `execution`, `goals`, `cross`. Proposed capability
IDs are `<domain>.future.0` and `<domain>.future.1`, matching the catalog's order.
These IDs should remain stable when the catalog grows.

Assessments require `assessmentId`, `assessedAt` and `validUntil`. Maturity also
requires an integer `level` in 0–5. Optional string arrays `nextRequirements`,
`understanding`, `supportingEvidence`, `uncertainty` and `additionalEvidence`
populate transparency only while the assessment is current. Quality assessment
may include `summary`, `reliabilityVerified` and `unverified` counts, which must
refer to the engine's assessed domain, never raw unrelated record totals.

Maturity may optionally include `levelProgress`:

```js
{
  assessmentId: '<current progress assessment>',
  assessedAt: '<assessment timestamp>',
  validUntil: '<expiry timestamp>',
  level: '<integer matching the assessed current level>',
  percent: '<finite number from 0 to 100>',
  basis: '<explanation of the assessed requirements or coverage>'
}
```

This is a display contract for a future domain-specific assessment engine.
No progress engine or scientifically validated percentage scale is implemented.
The percentage represents assessed progress within one level, not overall
personal intelligence. Stale, mismatched or unsupported values remain pending.

Readiness statuses are `unavailable`, `collecting`, `preliminary`, `available`
and `suspended`. Availability additionally requires `permissionGranted: true`
and `safetyValidated: true`. An optional `requiredPlan: 'pro'` displays
**Ready — Pro Required** only for otherwise ready capabilities without a current
`granted: true` entitlement assessment. This is a display foundation, not a
payment, subscription or access-enforcement implementation.

Notifications require a stable `id`, `userId`, real `occurredAt` timestamp and
one supported type: `maturity-established`, `capability-available`,
`conclusion-revised`, `evidence-required`, `capability-suspended`. Optional
`title`, `description`, `readAt` are display fields. Read markers are saved under
`hios_intelligence_read_v1:<userId>` for this browser. Future cross-device unread
state must come from the event service. Evidence receipt does not create a
notification. Expired assessments return to pending without fabricated events.

Account changes clear the new in-memory state, close the drawer and ignore
late callbacks from the previous session. Existing user records are not migrated.

## Still requires backend development and validation

Domain-specific maturity criteria and promotion/demotion rules; semantic evidence
verification; prediction validation; assessed personal conclusions and correction
workflow; capability readiness evaluation; real intelligence event production;
subscription entitlement enforcement; bidirectional contextual intelligence and
authorized adaptation with outcome evaluation. The six-level framework is proposed,
not a scientifically validated universal scale.

Existing Goals-IOS/browser connection stores remain browser-local and are not
consistently user-scoped. This change does not broaden their use or solve those
pre-existing storage limitations. New evidence inspection and notification state
are user-scoped. Live sign-in and real account writes are outside isolated UI tests.

## Verification

```sh
node --test tests/evidence-contract.test.cjs tests/intelligence-development.test.cjs tests/stage-2a1-execution-intelligence.test.cjs tests/stage-2a2-execution-trend.test.cjs tests/stage-2a2b-reflection-structure.test.cjs tests/execution-journal-creation.test.cjs tests/execution-journal-library-visibility.test.cjs tests/execution-reflection-structures.test.cjs
HIOS_TEST_BROWSER=/path/to/chromium node tests/intelligence-development.browser.cjs
HIOS_TEST_BROWSER=/path/to/chromium node tests/hios-evidence-loop.browser.cjs
```

Browser tests require Playwright (as do the existing browser tests), simulate
authentication, seed synthetic data only in an isolated local origin and block
external writes. They exercise responsive rendering, modal keyboard behavior,
product groups and capability lists, source ownership, pending/expired states,
genuine-event counting, cross-session
callbacks, calendar interactions, product navigation, G-IOS task completion and
Auto Zoom, independent wheel/keyboard scrolling with a fixed document and
single-level progress. They do not establish live Supabase authentication or
engine validity.

The 2026-10-09 verification cleanup resolves the earlier Stage 1C fixture failure
by using the canonical `hios_goal_evidence_requests_v1` store. Execution model
fixtures now load the actual reflection, scoring and chronology helpers. They
distinguish saved user structures from historical and recommended legacy reviews.
Older markup checks now follow the current instrument mapping controls.

The expanded foundation suite has 57 passing checks. It covers selected-metric
scope, stale response rejection, saved structure identity and account isolation,
incompatible criterion labels, qualitative response exclusion and missing scores.
Text-only reflections cannot establish a quantitative execution trend.

The new evidence-loop browser test has nine passing checks across real H-IOS,
G-IOS and T-IOS tabs on an isolated origin. It follows a selected request through
the actual storage transport, canonical execution calculations, response receipts
and the Keep/Apply decision buttons. Goals, selected evidence and deadlines remain
intact. Stale responses and disconnected requests are rejected; text-only reviews
return unavailable quantitative metrics. This test blocks external traffic and
performs no account writes or paid AI requests.

Receipt/status updates in the request store no longer trigger another T-IOS
response. A response superseded before G-IOS receives it is rejected and
acknowledged without applying its evidence. Per-signal acknowledgement receipts prevent an older cross-tab queue
snapshot from making a handled signal pending again, including when a received
signal arrives before its queue/receipt is visible in the receiving tab. Consumers
can pass the received signal to acknowledgement; its ID, format, allowed source
and request type must match. An unknown ID without that signal is rejected.
Receipts are retired when
their rows leave the existing 100-request queue. These are browser-local routing
protections, not authenticated provenance checks or a server-backed transaction
system. No Supabase schema, policy or user-data migration is part of this cleanup.
