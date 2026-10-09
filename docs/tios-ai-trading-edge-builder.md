# T-IOS AI Trading Edge Builder

This Level 1 Technical Instruments feature translates conversational instructions into reviewable edits to the existing document builder. Clearer strategy definitions support Profitable Trading Edge development; reusable rules, reflections and scoring structures support Execution Quality. Generating an instrument does not demonstrate profitability, predictive validity or execution quality.

## Editing flow

Open **AI Builder Chat** in Playbooks, Rules or Psychological Reflection. The conversation replaces the entire manual workspace, including its ribbon, white document and status bar. Messages scroll within that workspace and the composer stays at the bottom; the Live Model remains beside it. Instrument buttons in the chat let the user switch between Playbook, Rules and Psychological Reflection. **Manual editor** restores the manual workspace.

**Attach images** accepts PNG, JPG/JPEG and WebP pictures (or paste/drop them into the chat). Up to three reference images can be used in one conversation; original files must be no larger than 12 MiB each. Preview thumbnails have Remove controls before sending. You can send pictures on their own or with instructions. The browser reduces large pictures to at most 2,048 pixels on their longest edge and 650 KB each. Readable text in charts, diagrams and handwritten notes guides proposed rules. Unreadable labels or missing definitions lead to targeted questions; a chart example is not proof of profitability.

The current document, session conversation and submitted reference images provide context. The assistant asks targeted questions about unclear requirements or proposes structured operations. The Live Model shows the unsaved result. **Review document** opens the same proposal as a read-only document, with Apply and Discard controls; **Back to AI chat** restores the conversation and its draft without saving. Manual tools and Save are locked during that preview; Auto Zoom stays usable. **Apply Changes** saves through the existing scoped document library. **Discard Changes** and returning to the manual editor restore the prior document. **Undo AI change** reverses the last application in this session when no newer changes would be overwritten.

Conversation history and reference pictures are held in memory for this builder session. Every follow-up resends the same bounded reference set, even when the original upload is older than the recent text history. The continuing conversation moves to a newly created instrument after Apply. Pictures are not embedded in the saved instrument or uploaded to a persistent media store; approved rules persist after reload, but the chat pictures do not. Conversation state is separate by user, account, instrument type and document. New chat resets the current conversation and its pictures, including uploads still being processed. Navigation discards an unapproved preview; account changes and sign-out cancel requests and clear conversation context. This feature does not provide persistent general-purpose AI chat.

## One instrument structure

`documentHtml` remains the canonical representation. The AI receives a bounded plain-data summary of that document, never executable HTML. Strict JSON output contains insert, update, remove, move or group operations that refer to stable block identifiers. A detached document applies and validates those operations before touching the editor. Unchanged blocks retain their content, media, styling and ordering.

The integration supports headings, prose, rules, conditional choice groups, notes, written reflection prompts and the existing 0–10 score fields. Images, tables and other compound manual content are preserved; new image/table generation and edits to opaque compound blocks are outside this version. The initial AI context is limited to 200 blocks and 48,000 context characters; individual generated block labels are limited to 1,200 characters. Manual editing remains available for larger documents.

## Conditional logic and scoring

| Structure | Evaluation in Execution Quality |
| --- | --- |
| Independent rule | One checkbox contributes one criterion. |
| AND group | Every applicable member must be met; the group contributes one criterion. |
| OR group | At least one member must be met; multiple members may be selected. |
| Exclusive group | Exactly one option; radio buttons prevent selecting both Balance and Imbalance. |
| Dependent condition | Applies only when its referenced prerequisite is met. Non-applicable conditions are excluded from the current denominator. |
| Missing/invalid prerequisite | Blocks condition scoring until the instrument is repaired. |
| Score field | Existing per-trade response field, with a maximum of 10. Three fields produce a maximum of 30; 8 + 9 + 7 produces 24/30 = 80%. |

Conditional groups are stored in document attributes and parsed by the existing Live Model and Execution Quality mapping. AND/OR/exclusive groups are not merely descriptive chat text. They evaluate the recorded check states; this feature does not automatically verify conditions against live market data. These form-match percentages are separate from psychological score totals and trading outcomes.

## Backend and user isolation

`POST /api/tios-ai-builder` validates origin, content type, request size, bounded history and instrument context. It validates the bearer access token against this project's Supabase Auth service, rejects anonymous sessions, reserves a durable per-user quota, then requests a strict structured response from Vercel AI Gateway. The server and browser independently validate the response. There is no generated-code execution and no simulated AI fallback.

Only the active document summary, recent builder conversation and the current reference images are sent to the provider. The custom T-IOS builder uses the configured external foundation model; this feature does not train a new model. The server cannot enumerate the browser's document library and does not fetch trading history. No prompts, strategies, conversation text or pictures are stored in the usage table or application request logs. The table is in an unexposed schema, has RLS enabled and denies direct anonymous/authenticated access. Its explicitly callable security-definer RPC checks `auth.uid()`, reserves only that user's allowance, and does not accept a user ID argument. The security advisor's signed-in-definer notice is expected for this restricted quota reservation function; anonymous execution is revoked.

Pilot limits are six requests per minute and forty per UTC day per signed-in user, enforced transactionally across Function instances. Requests are limited to 2.9 MB of JSON, with the text/context portion still limited to 96 KB, twelve history messages and 6,500 output tokens. Image validation allows at most three PNG/JPEG/WebP data URLs, each up to 750 KB decoded and 2 MB decoded in total. The server checks base64 encoding, MIME signatures and limits; external image URLs and active image formats are rejected. Browser optimization targets a lower 650 KB per picture to leave room for text/context. These are operational usage controls, not evidence maturity thresholds. Failed provider requests consume a reservation to limit abuse. There are no automatic retries that might spend credits without a further user request.

AI requests use the configured model and deployment OIDC authentication. The current `x-vercel-oidc-token` supplied by Vercel is read on each Function invocation; a configured server-only `AI_GATEWAY_API_KEY` can be used for an intentional alternate setup. No AI credential or privileged Supabase key is placed in frontend source.

## Configuration and release checks

| Vercel setting | Purpose |
| --- | --- |
| `SUPABASE_URL` | Existing Traders Environment project URL. |
| `SUPABASE_PUBLISHABLE_KEY` | Existing public key for Auth validation and the authenticated quota RPC. No service-role key is needed. |
| `AI_GATEWAY_MODEL` | Exact live-catalog model ID; initial configuration uses `openai/gpt-4.1-mini`, which supports images and structured output. |
| Project OIDC enabled | Vercel supplies short-lived deployment authentication. |
| `AI_GATEWAY_API_KEY` | Optional server-only alternative when OIDC is unsuitable. Never paste this into a chat or committed source. |
| `TIOS_AI_VERIFY_ON_BUILD` | Set to `1` only for an explicitly requested release verification; reset to `0` afterward. |

Apply the tracked `tios-ai-builder-usage.sql` through a Supabase migration. The release script performs one synthetic image generation when enabled, using a tracked chart with a risk percentage present only in its pixels, and writes a public readiness report containing only its timestamp, model, safe result message and success/error status. It reads no user data. The script distinguishes an available provider from code-only verification and reports account, credit, quota or authentication errors without exposing diagnostics or credentials. `GET /api/tios-ai-builder` reports configuration presence; it does not itself prove that a paid model request succeeds.

If Gateway returns a credit, account-verification or budget error, the owner must resolve that in the Vercel AI Gateway dashboard. Recognized errors distinguish adding a valid payment method for verification, adding credits for an unusable balance, and reviewing an exhausted spend budget. Unknown account restrictions retain a general owner-action message. Raw provider diagnostics and credentials are never shown. The UI reports this state and keeps all manual product functionality available. AI keys, if needed, belong in encrypted server-side Vercel environment variables.

Official implementation references: [Vercel OIDC](https://vercel.com/docs/oidc), [AI Gateway OIDC](https://vercel.com/docs/ai-gateway/authentication-and-byok/oidc), [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision), [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), and [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser).

## Backtesting preparation and limits

Where supplied by the trader, a condition retains its type, verification category, field, comparison operator, value, unit, timeframe and named parameters. Logical relationships and stable condition IDs are preserved. AI applications produce an incremented strategy revision and a unique revision ID, retained through reload. Objective metadata means potentially machine-verifiable, not verified evidence. Subjective observations and undefined requirements remain labelled accordingly. Changing a condition's wording manually marks its technical metadata for review; old parameters are not silently interpreted as the new definition.

Future work includes machine-verifiable strategy compilation, reconciliation of all manual edits with formal parameters, immutable snapshots for every strategy revision, historical market-data integrations, realistic backtest costs, robustness analysis and validated edge assessment. No backtesting engine or live trade execution is included in this release. Undo is session-local and protects newer manual edits rather than attempting automatic conflict merges. Account-wide subscriptions and production spend budgets are separate rollout decisions.

## Verification

The Node suite checks schema, logic, input bounds, image-only input, image signatures, count/size limits, multimodal payloads, authentication, quota enforcement, provider errors, refusal/truncation and credential non-disclosure. The browser suite uses the real API handler, editors, stores and Execution Quality with isolated Auth/model fixtures. It checks creation, follow-ups, edits, grouping, movement, discard, undo, stale edits, safe text handling, condition evaluation, scoring, reload, instrument switching, responsive layouts with attachments, preview removal, image optimization, image-only clarification, follow-up references before and after Apply, session-only image clearing on reload, cancellation, asynchronous upload clearing and account/document isolation. Existing writing/reflection regressions cover manual functions, styling, historical responses and scoring. External provider operation is checked separately by the release script; fixture responses are never used by production code.
