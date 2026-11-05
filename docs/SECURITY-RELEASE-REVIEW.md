# HACYPAA XI proposed security release

November 5, 2026. **Awaiting explicit production approval.** This document is a review plan, not evidence that production changes have occurred.

## Current result

All nine audit findings have local fixes and regression tests. The user verified admin library loading, CSV/PDF exports with 601 synthetic records, the compact registration roster, and sign-out/MFA sign-in through the unchanged Supabase frontend. The read-only preview API does not validate backend JWT authorization; the Worker tests cover that separately.

- Worker tests: 149/149 passed across 8 files, including 38 mail/webhook tests.
- Public verification/export client tests: 8/8 passed.
- Vendor checkout/integrity regression: 1/1 passed, including staged upstream whitespace and rejection of application whitespace.
- Compact PDF tests: 3/3 passed; 601 short synthetic registrations generated 26 pages.
- Website validation: 12 HTML files and 262 links passed after the roster addition.
- Administrative integrity/CSP checks, JavaScript syntax and local Worker dry build passed.
- No charges, fulfillment orders or real emails were created by automated tests. No production record was changed during investigation.

## Verified production snapshot

Read-only Cloudflare inspection confirmed active Worker version `355c4ad0-037b-4670-bc18-e5f4fbde1690`, matching the November 3 release receipt. Registration remains $25. Migrations 0001-0010 are applied; 0011-0014 remain pending.

The database contains 15 historical test-mode orders: 8 pending and 7 submitted with provider IDs. Read-only Printify lookups verified all 7 referenced orders were already canceled, with null production/fulfillment timestamps and zero shipments. No attempted orders lacked provider IDs. These checks do not establish billing history or constitute a full shop-wide orphan-order inventory.

There is 1 registration with an empty dietary field. Its intended value cannot be inferred, and no identity was retrieved. Any correction or contact requires a separately approved recovery process.

## Proposed database changes

| Migration | Effect | Existing-data behavior |
| --- | --- | --- |
| 0011_security_recipient_quotas.sql | Add hashed-recipient hourly counters | No attendee records rewritten |
| 0012_registration_admin_history.sql | Add status revisions, actor UUID and minimal retained history | No bulk attendee deletion or historical identity inference |
| 0013_confirmation_mail_outbox.sql | Add durable mail jobs, leases and signed-event delivery fields | No historical confirmation jobs backfilled; no bulk email triggered; migration is still pending |
| 0014_printify_submission_intent.sql | Add durable intent and reconciliation progress | Existing provider IDs marked accepted; unresolved attempted orders held as ambiguous |

These migrations add tables/columns. No destructive down migration is proposed. Existing registration records, payments and the standard $25 price are preserved.

## Proposed configuration

| Setting | Proposed value/purpose |
| --- | --- |
| ENVIRONMENT | production |
| FULFILLMENT_MODE | live; also requires live Stripe key/event/session/row checks |
| BOT_PROTECTION_MODE | required; no production bypass |
| TURNSTILE_SITE_KEY | 0x4AAAAAAF0Dum-EVV3kRFkp; public widget identifier |
| TURNSTILE_SECRET_KEY | New private binding entered directly through Wrangler; never committed or pasted in chat |
| RESEND_WEBHOOK_SECRET | New private webhook signing secret; entered directly through Wrangler, separate from both Sending API keys |
| Resend webhook | POST https://checkout-api.tgp-services.workers.dev/resend/webhook; authenticated delivery events for tagged confirmation jobs |
| ADMIN_AUDIT_RETENTION_DAYS | 365; proposed policy included in release approval |
| Cron | Every 15 minutes for bounded mail retries, reconciliation and expired security-history cleanup |

The user created a Turnstile widget using the requested Managed configuration for hacypaa.us with pre-clearance disabled. The root hostname covers www. The public key is saved locally and Wrangler types were generated. The private key has not been installed by the assistant. Existing Stripe, Printify, Resend and Supabase credentials are not being rotated.

Both displayed Resend API keys have Sending access, as confirmed by the user. Keep those scopes and leave the Supabase authentication key unchanged. Signed Resend events update stored confirmation delivery status; administrative refresh needs no provider read permission. Subscribe only to `email.sent`, `email.delivery_delayed`, `email.delivered`, `email.failed`, `email.bounced`, `email.suppressed` and `email.complained`. No open/click tracking is requested. Unrelated, untagged messages are ignored without retaining their contact details. The new endpoint/subscription and signing-secret installation are not yet configured in production.

Provider acceptance and delivery are represented separately; retries do not assume delivery. If a delivery event is unavailable, the email remains sent/unknown rather than being marked delivered or automatically resent. An overall attendee/export retention policy remains a committee decision; the proposed 365 days applies to the new minimal audit history.

## Git and publication scope

The local branch is `security/audit-remediation-nov4`. Its current parent commit is `dbfe444` (Fix face fears flier). A read-only remote check found main at `43e51a4b9451b6f663a6c8b64aba3412be721e94`.

**Publishing the current local branch would also publish that separately committed flyer fix.** It is not overwritten by this remediation. Its inclusion must be explicit in release approval. The explicit release list contains 55 reviewed files. The local vendor-byte repair must pass integrity, Git checkout and staged whitespace checks before committing. Only identified security/export/configuration files should be staged; generated types, local credentials, databases, backups, preview scripts and review evidence must be excluded. No force push is proposed.

The public registration, volunteer, payment, merchandise checkout and admin entry scripts now have new URL versions so updated HTML requests the new code rather than reusing the old script URLs. Existing open tabs may require reloading.

## Proposed sequence after approval

1. Inspect the final branch, diff and explicit staging list. Confirm the Turnstile private key and planned Resend webhook configuration are available and remote main has not changed. Keep both email API keys at Sending access. Stop if unrelated changes or conflicts appear.
2. Record a fresh D1 Time Travel recovery bookmark immediately before migrations. Store it outside the published tree. Do not restore automatically if a step fails.
3. Create the reviewed local commit. Prepare the Resend webhook subscription and install only its new private signing secret and the new Turnstile secret; preserve existing API/authentication credentials. Coordinate webhook enablement with the new Worker so events do not target an unimplemented endpoint.
4. Apply only migrations 0011-0014 and verify the schema before deploying the Worker. Stop on any migration failure.
5. Deploy the reviewed Worker/configuration and publish the corresponding frontend in a coordinated window. Both sides must be ready: new frontend verification needs the config endpoint, and strict backend verification needs the new frontend token submission. A brief form/checkout interruption is possible while GitHub Pages updates.
6. Verify the active version, public configuration, frontend script versions, health, signed webhook configuration and authorized admin reads. Recheck preserved record counts and empty historical outbox. Regenerate binding types after secret/configuration setup. Do not create a real charge, order or bulk email as part of this verification.

An explicit approval must cover the four production migrations, two new private secret bindings, the Resend webhook subscription, Cron/365-day audit retention, Worker deployment, Git publication and the existing flyer commit if the current branch is published. No approval is inferred from local tests passing.

Rollback requires a separate review. Reverting to an old consumer can lose the new reconciliation/idempotency protections; restoring a whole database can discard intervening writes. Retain the additive schema and protect new live transactions while reviewing any recovery.
