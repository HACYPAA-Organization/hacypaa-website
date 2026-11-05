# HACYPAA XI security remediation checkpoint

Local implementation and verification: November 3-5, 2026. Guided local testing and manual browser checks were completed on November 4; sending-only-compatible email delivery tracking was added on November 5. Production release has not been authorized.

**These changes are local and have not changed production.** No deployment, production database modification, credential rotation, merge, push, real charge, real Printify order, or real email was performed. Release approval has not been requested or granted.

## Sources and isolation

- Reviewed the original audit archive, primary findings, independent review, red-team evidence and relevant reproduction code. All 30 packaged checksums verified. Supplied attack scripts were not executed against production.
- Audited commit: `f0ba3f48b5b9ed6ad363448df2664eff79f9cbda`.
- Current launch release reviewed: `43e51a4b9451b6f663a6c8b64aba3412be721e94`.
- Isolated repository: `audit-remediation-20261103`, branch `security/audit-remediation-nov3`. Changes remain uncommitted; its push URL is disabled locally pending review.
- Original project and November 3 release checkout preserved. Existing untracked release logs/generated types were excluded from this copy. Final comparison found the original project's `assets/images/face-your-fears-2026.png` differs from the release; no image edit is part of this remediation. Preserve that separate difference when integrating work.
- Tests use local D1, synthetic attendees, synthetic signed Stripe events/JWTs and mocked vendors. Separate development/test configurations disable fulfillment and omit production queue bindings and usable cloud database IDs.

## Checklist

“Fixed and Tested” means implemented and regression tested **locally**, not deployed or independently verified in production. Configuration and historical-data gates remain separate.

| Finding | Exposure in current launch release | Local status |
| --- | --- | --- |
| F01: Test payments to fulfillment | Already partly resolved: consumer rejected test rows; producer/configuration safeguards incomplete | Fixed and Tested |
| F04: Dietary field mapping | Confirmed: accommodation details copied into dietary restrictions | Fixed and Tested |
| F02: Registration/API abuse | Partial limiting and privileged diagnostics existed; bot and recipient controls incomplete | Fixed and Tested |
| F03: Dashboard/export limit | Confirmed: lists and exports stopped at 500 | Fixed and Tested |
| F05: Administrative history | Confirmed: edits lacked actor history; deletion removed history | Fixed and Tested |
| F06: Confirmation email failures | Confirmed: no durable retry/delivery tracking | Fixed and Tested |
| F07: Fulfillment reconciliation | Confirmed: accepted order plus database failure could be submitted again | Fixed and Tested |
| F08: Administrative scripts | CSP and pinned CDN versions existed; integrity checks absent | Fixed and Tested |
| F09: Malformed requests | Confirmed: invalid roots/nested values could produce 500 | Fixed and Tested |

## F01 — Live-only fulfillment

**Cause and current exposure.** A signed test event could enter the order/queue producer. The November 3 release already checked `livemode === 1` inside its consumer, blocking the original audited test-to-Printify path there. The user's deployment receipt shows live Stripe configuration. This does not establish that historical test orders never reached Printify or independently verify all currently active settings.

**Implemented.** Require live event/session mode before provider lookups, writes or queueing. Validate retrieved session identity/mode again. Require explicit live fulfillment configuration and a live-format server key. Keep independent consumer, payload and claim-query guards. Disable fulfillment and production bindings in separate local/test configurations.

**Tests.** Signed test/missing-mode/mismatched-mode events, live success, direct test rows, invalid configuration and payload rejection pass with mocked providers. No real order was submitted.

**Remaining.** Cloudflare access was initially unavailable. After the user authenticated Wrangler on November 4, read-only inspection confirmed active version 355c4ad0-037b-4670-bc18-e5f4fbde1690 and its published bindings, matching the November 3 receipt. The production database has 15 test-mode orders: 7 submitted with Printify IDs and 8 pending; no live-mode order rows were present in this snapshot. Read-only Printify lookups verified that all 7 referenced orders were already canceled, with no production/fulfillment timestamps or shipments. Billing history was not inspected, so no assertion about charges/refunds is made. Active secret values were not retrieved from Cloudflare; confirm webhook/key mode associations before release. No cloud sandbox resources were provisioned; future hosted testing needs separate credentials, database, queues and shop.

## F04 — Independent attendee fields

**Cause and current exposure.** The handler read `dietary_restrictions` from `accommodationDetails`, discarding the independently submitted dietary text.

**Implemented.** Independently validate, store and retrieve both fields. Existing records are unchanged.

**Tests.** Actual local D1 request/storage/admin retrieval covers distinct values, one empty field, both empty fields and invalid types. Migration preservation confirms no silent rewrite. Passed.

**Historical assessment performed read-only November 4.** The aggregate query found 1 registration, 1 empty dietary field, and 0 matching nonempty dietary/accommodation values. An empty field does not establish that the attendee had no restriction or whether the row is a test. Discarded text cannot be reconstructed from this row. `conference-api/review/dietary-impact-readonly.sql` preserves the query. No identities were retrieved, and no guessing, overwriting or attendee contact occurred. Individual review and any recovery/contact process remain subject to committee approval.

## F02 — Bot and API abuse protection

**Cause and current exposure.** Existing IP limiting and privileged diagnostics did not verify human submissions, limit recipient-targeted email abuse across IPs or throttle public session-status lookup. CORS alone did not prevent simple cross-origin POSTs.

**Implemented.** Require allowed Origin, JSON content type, shared IP limit and server-verified Turnstile action/hostname for public writes. Add a hashed-recipient hourly quota across email-related routes. Fail closed when protection/configuration is unavailable; bypass is explicit and test-only. Retain Supabase JWT/MFA/allowlist/super-admin checks for upstream diagnostics. Limit session-status and reject receipts from unrelated merchant integrations. Public clients obtain fresh verification tokens per operation.

**Tests.** Origin/MIME rejection, path switching, limiter failure, missing/invalid/replayed tokens, action/hostname validation, recipient limits across IPs, unauthorized diagnostics, unrelated receipts and verified legitimate registration pass. Client tests cover fresh tokens, retained fields, cancellation and failure without a POST.

**Required setup.** The user created a Managed Turnstile widget for hacypaa.us, with pre-clearance disabled; its public `TURNSTILE_SITE_KEY` is configured locally. Private `TURNSTILE_SECRET_KEY` installation and production configuration remain pending explicit release approval. Defaults are 30 public operations per IP/minute and 10 recipient operations/hour; review legitimate group registration use during acceptance. Cloudflare IP limits are approximate, not a global botnet guarantee.

## F03 — Pagination and full exports

**Cause and current exposure.** A fixed 500-row query supplied lists and exports, hiding older attendees and understating totals.

**Implemented.** Validated table-bound keyset cursors, a membership snapshot, real totals/status counts, Previous/Next controls and full CSV/PDF page traversal. Abort partial exports when membership changes, permission is lost or a cursor loops. Edits refresh the current page; explicit Refresh resets it.

**Tests.** Local D1 tests use 601 registrations and 601 panelists, including the oldest confirmed attendee. Verify complete unique membership, counts and invalid cursors. Client export traversal and incomplete/looping export rejection pass.

**Remaining.** Field values can change during an export; membership stabilization is not a database-wide transaction snapshot. The user verified browser CSV/PDF exports with 601 synthetic registrations and panelists, including the compact registration roster.

## F05 — Administrative audit history

**Cause and current exposure.** Payment status edits lacked attributable events, and deletion erased history.

**Implemented.** Atomic status/history writes with authenticated actor UUID, previous/new status, hashed subject reference and concurrency revisions. Deletion retains minimal status/receipt/deletion facts independently of the attendee row. New history excludes attendee names, email, dietary/accessibility text, free-text notes and payment handles. Immutable history expires under a proposed 365-day policy with scheduled pruning.

**Tests.** Actual D1 tests cover actor attribution, transitions, no-op updates, rollback on audit insertion failure, retained history after deletion, omitted attendee PII, immutability and expiry. Passed.

**Remaining.** Review the proposed retention period before release. Actor UUIDs and hashes are pseudonymous data. An overall attendee/export retention policy remains undecided; existing attendee records were not purged.

## F06 — Confirmation email outbox

**Cause and current exposure.** Confirmation could commit while email failure was swallowed, leaving no durable retry or visible delivery state.

**Implemented.** Persist the mail job in the status/history transaction. Use leases, backoff and a stable Resend idempotency key. Automatic retries stop after 23 hours or bounded attempts; ambiguous jobs require review. Authorized admins can retry, explicitly resend or refresh delivery state; repeated requests are deduplicated and resends have a cooldown. Distinguish accepted from delivered. Cancellation/deletion cancels/removes pending jobs. Proposed 15-minute scheduled processing is bounded. Migrations do not backfill historical mail jobs or trigger bulk mail.

Delivery tracking uses `POST /resend/webhook` and a separate private `RESEND_WEBHOOK_SECRET`. Verify Svix HMAC-SHA256 signatures over the exact bounded raw body using Web Crypto, reject timestamps outside five minutes, and apply the existing rate limiter. Only tagged, attempted confirmation jobs can be updated; mismatched provider IDs, canceled/deleted jobs and unrelated Supabase auth messages are ignored. Atomic timestamp/event checks prevent duplicate or stale updates and keep older emails from replacing the latest resend's registration summary. A signed provider event can close an accepted-but-uncertain job even when the HTTP send response or tracking write failed. Administrative refresh reads the stored state without a Resend GET request. Sending-only API keys remain sufficient; no authentication key permission change is required.

**Tests.** All 38 focused mail/webhook tests passed with local D1. Coverage includes failure/recovery, concurrency, accepted-but-unrecorded mail, retry-window expiry, explicit resend deduplication, authorization, cancellation/deletion, scheduled retry, the published independent Svix signature vector, tampered/stale requests, all seven delivery events, duplicate/out-of-order events, early callbacks, atomic tracking failure and provider retry, latest-resend summaries, unrelated auth mail, body limits and limiter/configuration failures. The full Worker suite passed 149/149 across eight files. Provider requests are mocked; no real email was sent.

**Remaining.** The user confirmed both displayed Resend API keys have Sending access; an earlier read-only lookup using local configuration also returned the provider's sending-only restriction. Keep those permissions. The new webhook subscription and private signing-secret binding require explicit production approval, as does the schedule. Without delivery events, accepted emails remain shown as sent rather than falsely marked delivered; missing events are not proof of failure and do not trigger automatic duplicate resends. Needs-review jobs require human decisions. No actual email delivery was tested. The two delivery-event columns were added to pending migration 0013, which was not applied in the November 4 production snapshot; migrations 0001-0010 remain unchanged.

## F07 — Printify reconciliation

**Cause and current exposure.** Provider POST and database update were separate operations; accepted-but-unrecorded orders could be posted again.

**Implemented.** Persist intent before POST. Only an order with no prior attempt takes the initial submission path. Later attempts reconcile existing remote history by stable identity, recover the ID without reposting and hold unresolved ambiguity for review. Validate pagination and persist progress across bounded scans, including histories beyond 200 orders. Scheduled reconciliation can recover tracking without creating orders. Previously attempted unresolved orders migrate to ambiguous state.

**Tests.** Nine focused tests pass: acceptance plus database failure, lost response/eventual listing, legacy ambiguity, duplicate provider responses, concurrent consumers, queue replay and large paginated histories. Assertions verify one POST or no POST as appropriate; all external calls mocked.

**Remaining.** A provider result may remain unobservable after network failure. Manual review/dead-letter monitoring is intentional; no unconditional exactly-once guarantee is claimed. Read-only production queries found zero attempted orders without a provider ID. Seven tracked historical test orders were looked up in Printify and were already canceled. This is not a shop-wide orphan-order inventory. Existing remote orders, database rows and shop settings were not changed.

## F08 — Pinned administrative scripts and CSP

**Cause and current exposure.** CDN paths pinned versions without integrity checks. The launch already had a CSP.

**Implemented.** Self-host the same Supabase 2.117.2, jsPDF 4.2.1 and AutoTable 5.0.9 versions with licenses. Verify npm package integrity and corresponding files; record sources/hashes in `assets/vendor/admin-dependencies.json`. Add SHA-384 script integrity attributes. Restrict admin scripts/styles to the site and retain necessary API/Supabase connections. Automated checks cover hashes, manifest/HTML agreement, local sources and CSP constraints. Existing authentication logic and production npm dependencies were preserved.

**Tests.** Static integrity/CSP checks pass. Production npm dependency audit reports zero advisories. Initial automated browser attempts did not complete, so testing continued manually in the user's local browser. The user confirmed all three libraries loaded, test PDF generation worked, and the existing registration/panelist CSV and PDF checks passed against synthetic records. The reported inline-script CSP error was matched by exact hash to Live Server's injected reload code, not a website script. The preview API uses fake data and does not test real backend JWT authorization; the Worker tests cover that separately.

**Manual acceptance.** The user confirmed the authenticated dashboard, 601-row pagination and existing registration/panelist CSV/PDF exports, compact roster application/check, and sign-out followed by sign-in with MFA. Admin writes are intentionally blocked by the read-only browser fixture; actual backend authorization/status/email behavior is tested by the local Worker suite. These results do not verify active production configuration or historical records.

## F09 — Input validation

**Cause and current exposure.** Handlers assumed object JSON roots and coerced unchecked nested values.

**Implemented.** A bounded object reader rejects null/arrays/primitives and invalid fields before coercion. Validate cart and panelist step types. Return client errors: 400 malformed input, 413 oversized public body, 415 unsupported public content type. Raw signed webhook parsing stays intact.

**Tests.** Invalid roots across public writes, hostile nested values and oversized input are covered; existing happy paths also pass.

**Remaining.** Future routes need the same validation and shared protection.

## Verification checkpoint

| Check | Result |
| --- | --- |
| Launch baseline | 36/36 passed |
| Final Worker regression suite | 149/149 passed across 8 test files on November 5 |
| Client verification/export tests | 8/8 passed |
| Windows Git vendor checkout regression | 1/1 passed |
| Compact registration PDF tests | 3/3 passed; 601 synthetic rows on 26 pages |
| Website validation | 12 HTML files and 262 links passed after the roster addition |
| Dependency integrity/CSP/test isolation checks | Passed |
| JavaScript syntax | 35 source, test and validation files passed on November 5 |
| Git whitespace check | Passed |
| Worker local bundle (`wrangler deploy --dry-run`) | Passed; no deployment performed |
| Wrangler binding types | Generated successfully |
| Production npm audit (`--omit=dev`) | Zero advisories; does not assess all development dependencies |
| Manual browser checks | Libraries, existing exports, compact roster, sign-out and MFA sign-in passed against synthetic preview |
| Read-only production inspection | Active version/bindings and migrations verified; dietary/order aggregates read; 7 historical test orders verified canceled in Printify |

Migration preservation tests seed existing-style rows, apply the four new migrations, retain old attendee values/history, create zero bulk confirmation jobs and mark attempted unresolved orders ambiguous. Mocked vendors prevent charges, shipments and delivered emails.

## Read-only production assessment on November 4

The user completed Cloudflare OAuth; subsequent version inspection and SELECT queries were performed with existing access. Only read requests were issued to Printify using existing local API configuration. The connected Printify app exposes product creation, not this store's administrative order history. API responses were reduced to order IDs, statuses and production/shipment timestamps; addresses and contact details were not retained.

- Active Worker version: `355c4ad0-037b-4670-bc18-e5f4fbde1690`, created November 3, matching the release receipt. Published price remains 2500 cents and site URL remains https://hacypaa.us.
- Published secret bindings exist for Stripe, Printify, Resend and Supabase. Secret values were not retrieved from Cloudflare. The new fulfillment/environment/bot mode variables and Turnstile bindings are not yet part of that version.
- Migrations 0001 through 0010 are applied. New migrations 0011 through 0014 remain unapplied.
- Registration aggregate: 1 stored row; its dietary field is empty. No identities were queried or inferred.
- Order aggregate: 8 test-mode pending rows with no provider IDs; 7 test-mode submitted rows with provider IDs; no live-mode rows in the snapshot. Zero attempted orders lacked provider IDs.
- All 7 referenced Printify orders, created August 27 through September 2, were already canceled. Both order and line-item production/fulfillment timestamps were null, and shipment counts were zero. No cancellation, refund or other mutation was requested. This status check does not establish billing history.

Evidence is held in local review files `production-version-readonly.json`, `production-aggregate-readonly-20261104.sql/.json`, and `printify-test-order-status-readonly-20261104.json`. These are excluded from the proposed repository patch. The original audit exposure was real in the sense that test-mode records had matching remote Printify orders; the reviewed current release adds a non-live consumer guard and the local remediation adds producer/configuration guards. No active production/shipment was indicated for the seven inspected orders.

## Next review and release gates — no execution authorized

1. Review this diff and migrations `0011_security_recipient_quotas.sql`, `0012_registration_admin_history.sql`, `0013_confirmation_mail_outbox.sql`, `0014_printify_submission_intent.sql`. Applied migrations 0001-0010 were not rewritten; pending 0013 includes the delivery-event fields.
2. Complete controlled browser testing: MFA, dashboards, status/email actions, all exports, and public registration/volunteer/payment-recovery/merchandise flows, including mobile, cancellation and expired token recovery. Use isolated credentials/services.
3. Obtain authorized read access for active Worker/webhook settings, aggregate dietary assessment, pending mail and ambiguous fulfillment. Keep attendee data out of review messages.
4. Review retention, Turnstile hostnames/keys, the signed Resend webhook subscription/secret, proposed Cron trigger and ownership of needs-review/dead-letter work. Keep both Resend API keys at Sending access. No extra paid service was provisioned.
5. Prepare backup/recovery and coordinated frontend/backend release. Verification requires matching frontend tokens; deploying one half alone can block legitimate submissions. Missing bot configuration intentionally fails closed.
6. Only after explicit approval: execute a separately reviewed migration/configuration/release process. Do not use the old merchandise publish helper for this remediation.

Rollback must preserve submission-intent and mail-idempotency safeguards. Blindly reverting the consumer could revive duplicate submission risk. No destructive down migration or production rollback was performed.

## November 4 verification

November 4 follow-up: applying the patch with Windows `core.autocrlf=true` converted the three vendor scripts from LF to CRLF. The application helper compared normalized text and therefore missed the byte change; the unchanged integrity check correctly rejected the local files. The exact verified bytes were restored, `assets/vendor/.gitattributes` now forces LF for vendor scripts, and the new Git checkout regression passed. That test enables CRLF conversion, proves conversion on a control file, then verifies exact vendor hashes/sizes after checkout. CI includes it. Integrity hashes and validation were not weakened. The separate repair helper checks preconditions and backs up affected files before copying. Production remains unchanged; the subsequent manual browser acceptance is recorded above.

## Compact registration roster

Added at the user's request during browser testing. A new Roster PDF button exports all registrations into a landscape table with repeated column headings and page numbers. Columns are registration code, attendee, payment status, amount due, amount paid and balance. Missing payments remain unrecorded; a confirmed status does not invent a payment, and negative balances preserve overpayment credit. The existing individual registration sheets remain available under Registration sheets PDF.

The real pinned jsPDF/AutoTable libraries generated all 601 synthetic registrations on 26 shared pages in regression testing. Three tests passed for completeness, page density, missing/zero/overpayments, long-name wrapping, unchanged input records and empty-list handling. The existing 8 client tests, static integrity/CSP checks, JavaScript syntax and updated 12-page/262-link website validation also passed. CI includes the new PDF tests. Two pre-existing detailed-PDF typos in the submission timestamp and unknown-status fallback were corrected, along with the payment-method label spelling.

This is a local addition. No database schema, saved registrations, vendor dependency bytes or production settings were changed. The user confirmed completion of the compact roster update/check. Subsequent sign-out and MFA sign-in returned to the 601-record synthetic dashboard.

## Primary technical references

Final release preparation on November 4 added new URL versions for the five changed public/admin entry scripts. The previous URLs could reuse cached pre-remediation code after an HTML update. This changes script references only; vendor bytes, backend logic and security requirements are unchanged. The user-created Turnstile public sitekey is configured locally and Worker types were regenerated. The private key, migrations, Cron/configuration and publication still require the explicit production approval described in `SECURITY-RELEASE-REVIEW.md`.

- D1 atomic batches: https://developers.cloudflare.com/d1/worker-api/d1-database/
- Rate limiter limitations: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- Turnstile verification: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Queue guarantees: https://developers.cloudflare.com/queues/reference/delivery-guarantees/
- Printify order API: https://developers.printify.com/
- Resend idempotency: https://resend.com/docs/dashboard/emails/idempotency-keys
- Resend signed delivery events: https://resend.com/docs/webhooks/verify-webhooks-requests
- Svix signing format and independent test vector: https://docs.svix.com/receiving/verifying-payloads/how-manual
- Cloudflare Web Crypto: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/

## November 5 staging whitespace repair

The first staging helper applied Git whitespace checks to new upstream vendor scripts and reported trailing whitespace in bundled license comments. That was a release-helper error: changing pinned upstream bytes breaks SRI. Subsequent whitespace-only edits changed the three working copies; their staged copies still matched the verified originals. The integrity check correctly rejected the changed working files.

The repair restores the three exact verified scripts after backing up affected files. Vendor JavaScript attributes now retain LF and disable whitespace lint only for those scripts. The unchanged integrity hashes remain mandatory. The Git regression now stages the actual vendor scripts, checks the staged diff, proves application whitespace still fails, and verifies exact bytes after Windows-style checkout. It passed. The staging helper now supports the already-reviewed staged paths and disables its pager; unrelated staged paths or changed reviewed source stop the helper. No application/Worker behavior or dependency versions changed, and the user's 149/149 backend result remains applicable.
