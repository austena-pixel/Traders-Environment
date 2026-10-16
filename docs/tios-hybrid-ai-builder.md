# Hybrid AI Trading Edge Builder

The Builder has one proposal compiler, one approval workflow and two request engines. Local operations run in the browser. Trading interpretation and image analysis continue through the existing authenticated `/api/tios-ai-builder` → Supabase quota RPC → Vercel AI Gateway path. This change does not add a database service, change the AI model or alter account storage permissions.

## Local instructions

The parser accepts complete instructions with exact labels or `block ID` references. It never searches by a fuzzy substring. Repeated labels ask for a block ID. `Rule 2` resolves an exact `Rule 2` label first; otherwise it means the second individual rule in document order, including rules inside groups. The proposal explains the actual resolved target before approval.

Examples:

- `Change only the MARKET CONTEXT 4H heading to red`
- `Change paragraph "My notes." to #336699`
- `Align heading "Entry Conditions" to the center`
- `Set font size of heading "Entry Conditions" to 24 px`
- `Make Rule 2 bold` / `Make Rule 2 not bold`
- `Underline the heading "MARKET CONTEXT"` / `Remove underline from heading "MARKET CONTEXT"`
- `Bold Rule 2` / `Italicize Rule 2` / `Italicise Rule 2`
- `Set spacing of heading "Entry Conditions" to compact`
- `Set border of heading "Entry Conditions" to thin`
- `Set preset of heading "Entry Conditions" to card`
- `Set layout of block b_3 to columns-2` (supported lists/choice layouts)
- `Add a heading called "Entry Conditions"`
- `Create a rule: "Maximum risk per trade is 1%"`
- `Insert a heading called "Risk" before heading "Entry Conditions"`
- `Rename Rule 2 to "Risk Management"`
- `Remove MARKET CONTEXT 4H section`
- `Move heading "Risk" before heading "Entry Conditions"`
- `Undo the last approved change`

Omitting insertion placement appends to the active instrument; the proposal says so. Quote literal content containing words such as before/after or another editing instruction. Font sizes are bounded to 8–72 whole pixels; point values must convert to whole pixels. Supported properties use the application's existing alignment, spacing, border, preset and layout values. Complex wrappers and nested execution-group moves require clarification or the Manual editor. Section deletion stops at the next heading of the same or higher level and refuses ambiguous wrappers. Dependency validation can reject a deletion or movement that would break the execution structure.

Formatting modifies attributes on existing DOM blocks, preserving condition IDs, metadata, hierarchy, group membership and prerequisites. Label-only renaming retains those attributes too; if a rule's visible text no longer matches its machine definition it is marked for review, without rewriting the technical condition. Newly supplied rule text has no inferred machine parameters. Use AI reasoning to interpret or reconcile those definitions when needed.

## Routing and clarification

`ai-builder-local.js` is a pure, bounded instruction parser. It returns a local proposal, a local clarification, an undo request or an AI route. `ai-builder-schema.js` validates both engines' proposals. `ai-builder-document.js` compiles them on a detached DOM; failure cannot modify the active document. Both engines then use the existing Workspace snapshot, Live Model preview, Apply/Discard, version history and scoped save functions.

An edit-first compound instruction asks for explicit scope rather than applying part of it. A reasoning-first instruction such as `Analyze my Rules and prepare one coherent proposal including the color change` sends the entire instruction through AI. Local parsing, compilation and validation failures never trigger an automatic AI retry. The UI identifies local processing versus AI reasoning before submission. Existing reference images do not turn an exact text edit into a paid call; unsent attachments remain unsent during local editing.

`Create five rules` asks for names locally. After names are supplied, it asks for one `Name: condition` line per rule. No placeholders or trading conditions are invented. Clarification state is scoped to the current user, trading account, instrument type and document, and clears on account/user changes or New chat. The server shares the initial rules preflight as defense in depth for older clients.

Local sending and clarification remain enabled during an AI cooldown. Only the AI route observes the client countdown; the server always authenticates and reserves quota for paid generation. Sending an `engine: local` field to the API is invalid and cannot bypass quota. Local editing still verifies the authenticated session and uses existing stale-write and account-scope checks. No Supabase quota RPC or Builder API request occurs for local processing.

Typed Undo prepares a read-only preview and needs Apply. The existing Undo AI change button remains an explicit undo action and also reverses approved local changes. Undo rejects newer manual or cross-tab edits.

## Verification

Run `node --test tests/ai-builder.test.cjs tests/ai-builder-local.test.cjs` and `node tests/ai-builder.browser.cjs` with Playwright and a compatible Chromium available. `TIOS_TEST_BROWSER` can select an existing browser binary; `TIOS_QA_OUTPUT` selects screenshot output outside the repository. Browser fixtures isolate external auth/model responses while exercising the real client, API handler, compiler, stores, Live Model and Execution Quality. Counters assert that local operations make zero Builder API calls, quota reservations or provider calls. `tests/ai-builder-quota.sql` checks the live quota function in a rollback-only transaction.

These changes support instrument definition and consistent execution. They do not establish or promise a profitable edge; methodology performance still needs separate evidence and validation.
