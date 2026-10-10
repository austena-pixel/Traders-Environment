# Multi-Timeframe Setup Evidence

Setup pictures are optional for each individual trade. Opening a trade without
saved evidence shows **Create setup pictures**, without adding chart slots or
writing evidence records. Choosing Create adds three independent chart slots,
initially H4 / Context, H1 / Setup and M5 / Entry. The empty setup persists after
refresh and sign-in. Existing evidence opens directly without requiring creation
again. The timeframe and responsibility are editable per trade and save on
change. No chart is required, and removing an image keeps its
labels. This feature does not perform AI evaluation, change execution scores or
change continuous trade numbering.

## Opening the feature

- Journal Records: use the trade's **Setup pictures** button.
- Edit Trade: the same three cards appear beneath Trade Notes.
- Execution Quality: use **Setup pictures** for the selected individual trade.
- After saving a new trade, use **Setup pictures** in its day list or Journal row.
  A draft trade cannot upload until it has a persisted trade ID.

Choose **Create setup pictures** when you want to add chart evidence. You can
keep trading and completing reflections without creating a setup or uploading
any pictures. Click an empty card to select an image. Uploaded cards have View,
Replace and Remove actions. Cards share three equal desktop columns and stack on small
screens. The full image viewer supports Fit, 100% native resolution, zoom
buttons, wheel zoom, touch pinch, drag panning, keyboard panning and Escape.
Closing the viewer restores focus and leaves journal and reflection drafts
untouched.

## Persistence and access

The additive Supabase migration introduces `public.trade_setup_evidence` and
the private `trade-setup-evidence` Storage bucket. Existing tables and data are
not changed. The browser uses the existing signed-in Supabase client and its
authenticated Storage download method; it never uses public image URLs or
stores private image bytes/tokens in browser-local evidence records.

Each row is uniquely identified by `(trade_id, slot)` and also records its
owner, editable timeframe and analytical responsibility, schema version,
original filename/type/size, pixel dimensions, upload time and object paths.
Trade ownership is checked for both metadata and files, including writes.
Soft-deleted trades are inaccessible through these policies. Ownership, trade
ID and slot are immutable; server-managed revisions protect updates against
concurrent stale writes.

Object layout:

```text
<user UUID>/<trade UUID>/<slot>/<upload UUID>/original.<png|jpg|webp>
<user UUID>/<trade UUID>/<slot>/<upload UUID>/preview.<webp|png|jpg>
```

Original bytes and resolution are preserved. Preview images are generated
locally at up to 720 pixels on the longest side. Accepted sources are PNG,
JPEG and WebP up to 12 MiB, 60 million pixels and 16,384 pixels per side.
Storage applies MIME and size limits. Metadata enforces complete image
records, path ownership, slot bounds and dimensions.

Opening a trade list issues no evidence queries or image downloads. Opening
a trade's evidence loads its three metadata records and available previews.
Full originals download only on a View action. Preview object URLs are kept
in a bounded session cache and revoked on account switching/sign-out. Viewer
object URLs are revoked when it closes.

Replacements upload to new paths first, then atomically update the metadata
pointer using its revision. Previous files are removed through the Storage
API only after a successful metadata update. A failed upload keeps the
previous image. If an update response is lost, a fresh metadata read must
confirm that staged files are unreferenced before cleanup. Failed cleanup
may leave an unreferenced private file; it never erases the current image.

## Future strategy intelligence

Slot identity stays independent of editable timeframe names. Each original is
available through the authenticated trade ID with explicit timeframe and
responsibility, so future analysis can inspect one timeframe or join all
three to existing trade Playbook/Rules records. Upload time is not a claimed
market capture time. No market observations, verified strategy conditions or
AI conclusions are invented by this implementation.

## Verification

Run `node --test tests/*.test.cjs` for existing deterministic regressions.
Existing `instrument-reflections.browser.cjs` and
`period-rule-reviews.browser.cjs` check reflection persistence, Rules,
Playbooks, numeric scores, drafts and continuous numbering.

`tests/trade-evidence.browser.cjs` checks the feature against real Supabase
Auth, Storage, REST and RLS using two disposable fixture users, one fixture
account and two fixture trades. Supply private fixture JSON on stdin; never
commit credentials, tokens or browser state. Required environment variables
are `TIOS_TEST_BROWSER` (Chromium executable), `TIOS_SUPABASE_JS` (a local copy
of the project's Supabase browser SDK) and the appropriate Playwright module
path. `TIOS_TEST_SCREENSHOT_DIR` optionally writes private QA screenshots.
The test forwards the browser's real Supabase requests through the host
network when the QA environment restricts direct browser egress.

Fresh-login verification clears only the disposable browser's local sign-in
state, verifies that T-IOS returns to its signed-out home page, and establishes
a fresh password session against Supabase Auth. It does not revoke remote
Auth sessions. Set `persistenceOnly: true` in the private fixture input to run
this final read-only persistence check against previously uploaded fixture
images, without resetting metadata or deleting files.

Verification for this change passed the 78 existing deterministic checks,
76 reflection/scoring/Playbook browser scenarios and 19 period-Rules browser
checks. Live feature checks confirmed PNG/JPEG/WebP storage, per-trade slot
isolation, label persistence, refresh, full-image zoom/panning, safe replacement
and removal, responsive layout, preserved journal drafts and denial of foreign
and anonymous access. Fresh authenticated sessions restored each trade's
separate viewable images and labels.

The optional-creation update passed 20 live evidence checks plus the 78 code
checks and 76 reflection/scoring/Playbook browser scenarios. Opening Journal
or Edit Trade created no evidence records. Explicit creation persisted empty
slots through refresh, worked independently per trade and on mobile, and kept
older or concurrently saved labels intact.

The fixture JSON shape is `{ "users": [{ "id": "...", "email": "...",
"password": "..." }, { "id": "...", "email": "...", "password": "..." }],
"account": "...", "trades": ["...", "..."] }`. Fixtures must be confirmed
accounts explicitly marked as QA records. The test removes uploaded fixture
files through the Storage API. Remove only the known disposable fixture
database records after verification; never use existing customer data.
