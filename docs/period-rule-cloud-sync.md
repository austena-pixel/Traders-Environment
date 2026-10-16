# T-IOS Period Rules cloud synchronization — staged feature branch

## Purpose
The existing `tios.period-rule-review.v1` records stay compatible with the browser period-review renderer and keep daily, weekly, monthly and named intraday-window answers separate from per-trade execution checks. The local browser copy is kept for resilience; the cloud copy is scoped to signed-in users and trading accounts.

## Changes
- The SQL migration creates `public.tios_period_rule_reviews` with owner/account RLS and payload validation.
- `technical-instruments/period-rule-cloud.js` reconciles local and remote records by stable review key and `savedAt`.
- T-IOS attempts reconciliation after login and account switch and after each period review save.
- The UI says a record is **saved and synced** only after the remote write has been checked; failures report **saved on this device**.
- Existing trade-level execution review/check tables and score computation are not changed.
- New unit tests cover offline saves, record restoration, new remote versions, malformed or foreign rows, and account boundaries.

## Required verification before deployment
1. Apply the migration to an isolated or staging Supabase environment first; never apply it to production as part of merely reviewing the branch.
2. Run `node --test tests/period-rule-cloud.test.cjs tests/period-rule-reviews.test.cjs tests/journal-period-reviews.test.cjs`.
3. Run the authenticated two-user browser flow, including RLS rejection of cross-user and cross-account reads and writes.
4. Test on two devices using the same account, with offline edits and reconnect. Do not assume concurrent edits on the same review are merged; last saved timestamp is presently the conflict selector.
5. Confirm unchanged trade-specific Execution Quality scores and existing journal review history.
6. Complete the separate reusable Execution Journal templates cloud-sync work before declaring the entire Technical Instruments → Execution Quality integration complete.

## Known restrictions
- This slice does not yet migrate browser-local reusable execution journal structure definitions.
- The cloud table stores full period-review JSON; repeated keys from stale devices can still collide. A future revision should introduce server-side optimistic concurrency before enabling collaborative editing across multiple simultaneous devices.
- Local browser data remains available when cloud access fails. Clearing that browser's storage **before its pending changes are synchronized** may lose those local-only changes.
- Migration hasn't been applied to the production database; until deployed, cloud queries will fail safely and local saves remain available.
