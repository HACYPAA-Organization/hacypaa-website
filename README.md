# HACYPAA XI Website

Official website and conference services for **HACYPAA XI — Divine Paradox**, the Heartland Area Conference of Young People in Alcoholics Anonymous, planned for 2027 in the Independence / Kansas City, Missouri area.

- **Website:** [hacypaa.us](https://hacypaa.us/)
- **Pre-registration:** [hacypaa.us/registration/](https://hacypaa.us/registration/)
- **Committee admin portal:** [hacypaa.us/admin/](https://hacypaa.us/admin/)
- **API:** [checkout-api.tgp-services.workers.dev](https://checkout-api.tgp-services.workers.dev/health)

The public website uses HTML, CSS, and JavaScript, with no frontend build step. A separate Cloudflare Worker handles registration, panelist applications, admin API access, merchandise checkout, and fulfillment.

## Features

- Conference information, hotel information, program updates, event recaps, and committee involvement.
- Pre-registration with contact information, home group, fellowship, accessibility and dietary details, volunteer interest, scholarship donation interest, and preferred payment method.
- Registration emails containing a registration code and private payment-report link, with a resend option.
- Committee dashboard for reviewing registrations and confirming, unconfirming, cancelling, or restoring them.
- Panelist interest form, admin application list, and CSV export.
- Supabase admin sign-in, password setup/reset, authenticator enrollment, and multi-factor authentication.
- Merchandise catalog, product variants, persistent shopping cart, Stripe checkout integration, and queued Printify order submission.
- Discord community widget, mobile navigation, shared site styling, and page metadata.
- Compatibility redirect for registration QR codes already printed on flyers.

## Architecture

| Component | Responsibility |
| --- | --- |
| GitHub Pages | Hosts the public website and static admin interface at `hacypaa.us` |
| Cloudflare Worker: `checkout-api` | Handles browser API requests, Stripe webhooks, and fulfillment queue messages |
| Cloudflare D1: `hacypaa-orders` | Stores registrations, payment reports, panelist applications, merchandise orders, and processed Stripe events |
| Cloudflare Queues | Processes merchandise fulfillment through `hacypaa-fulfillment`; failed jobs can reach `hacypaa-fulfillment-dlq` |
| Supabase | Authenticates committee admins and provides the active admin allowlist |
| Resend | Sends registration, payment-report, and confirmation emails |
| Stripe | Provides merchandise checkout and payment verification |
| Printify | Supplies trusted merchandise prices and receives fulfillment orders |

The Worker uses the D1 binding `ORDERS_DB` and queue producer binding `FULFILLMENT_QUEUE`. These resources are configured in [conference-api/wrangler.jsonc](conference-api/wrangler.jsonc).

## Website routes

| Route | Purpose |
| --- | --- |
| `/` | Homepage and conference overview |
| `/about/` | About HACYPAA |
| `/hotel/` | Planned host hotel and reservation updates |
| `/program/` | Program information and schedule updates |
| `/events/` | Event information and recaps |
| `/get-involved/` | Committee information, Discord widget, and panelist interest form |
| `/merch/` | Merchandise catalog, cart, and checkout |
| `/registration/` | Pre-registration form |
| `/payment/` | Payment-report form accessed through an emailed private token link |
| `/admin/` | Authenticated committee dashboard |
| `/registration.html` | Legacy redirect to `/registration/` for printed QR codes |

Conference dates, the complete program, and hotel booking details should be updated after committee approval. The current public pages include information that is still being finalized.

### Printed registration QR codes

Keep [registration.html](registration.html) in the repository root. Existing printed QR codes point to `https://hacypaa.us/registration.html`, which redirects visitors to the current registration page.

The JavaScript redirect preserves query parameters and the URL fragment. A meta refresh and manual link provide fallbacks.

## Registration and payment flow

1. The attendee submits the pre-registration form.
2. The Worker saves the registration in D1 and attempts to email a registration code and private `/payment/?token=...` link through Resend.
3. The attendee uses the emailed link to report a Venmo or Cash App payment.
4. A committee admin verifies payment and confirms the registration in the dashboard. The Worker attempts to send a confirmation email when the registration changes to `confirmed`.

The registration questionnaire also supports **Cash** as a preferred payment method. The online payment-report form currently supports **Venmo** and **Cash App**; selecting a preference does not process a payment.

The configured base pre-registration price is currently **$25 USD** (`PREREG_PRICE_CENTS=2500`). Scholarship donation interest is recorded as a preference; it does not add an amount to the registration price.

Submission keys support safe retries without creating another registration. Payment-access tokens are stored as SHA-256 hashes. The private payment link is sent by email rather than returned in the registration submission response.

After a registration is saved, the attendee can resend the payment email. A successful resend replaces the previous private token; requests have a 60-second cooldown after a recorded successful send. A registration can be saved even if email delivery fails, so check both the saved record and email delivery when troubleshooting.

## Panelist applications

The form on `/get-involved/` collects contact information, sobriety date, step preferences, sponsorship and step-work information, location, home group, and topic preferences.

Applications are stored in `panelist_volunteers`. Authorized admins can view applications and export the loaded list as CSV. The current interface provides viewing and export; panelist status editing is not implemented in the dashboard.

Migration [0007_create_panelist_volunteers.sql](conference-api/migrations/0007_create_panelist_volunteers.sql) must be applied to the database used by the deployed Worker before this form can save applications.

## Admin access

The admin portal uses Supabase email/password authentication and a TOTP authenticator. The Worker verifies the Supabase JWT, requires an `aal2` session, and checks for an active entry in Supabase's `admin_users` table.

| Role | Registration dashboard | Panelist dashboard and CSV export |
| --- | --- | --- |
| `super_admin` | Yes | Yes |
| `prereg_admin` | Yes | No |
| `volunteer_admin` | No | Yes |

An admin's allowlist entry must have a `user_id` matching their Supabase Auth user ID, a supported `role`, and `active=true`. Creating or inviting a Supabase Auth user alone does not grant dashboard access.

Supabase project setup, the `admin_users` table, and its access policies are managed outside this repository. The D1 migrations do not provision Supabase. The older D1 `prereg_admins` table is not the current dashboard access allowlist.

The registration and panelist list endpoints currently return up to 500 records each. The panelist CSV exports the records loaded by that endpoint.

## Merchandise checkout and fulfillment

The browser catalog is defined in [assets/js/merch-products.js](assets/js/merch-products.js). The cart is stored in browser local storage.

Checkout sends product IDs, variant IDs, and quantities to the Worker. The Worker retrieves product data from Printify and uses those prices to create a Stripe checkout session. After checkout, the browser verifies the session with the API before clearing the cart.

The Stripe webhook verifies the signature and handles paid HACYPAA merchandise sessions. It stores the order and line items in D1, then queues fulfillment. The queue consumer submits orders to Printify, records submission results, and retries failures. Processed-event records and order claims help prevent duplicate processing.

**Current configuration:** [assets/js/checkout.js](assets/js/checkout.js) contains a Stripe **test** publishable key. Before accepting real merchandise payments, configure matching Stripe live keys and the live webhook signing secret, then verify the complete checkout and fulfillment flow. A deployed website alone does not establish that checkout is ready for real payments.

## Repository guide

| Path | Contents |
| --- | --- |
| [index.html](index.html) and page directories | Public website pages |
| [registration.html](registration.html) | Printed-QR compatibility redirect |
| [admin/index.html](admin/index.html) | Committee dashboard and sign-in interface |
| [assets/css/](assets/css/) | Shared styling and merchandise styles |
| [assets/images/](assets/images/) | Branding, posters, favicon, and social images |
| [assets/js/](assets/js/) | Navigation, forms, admin authentication, catalog, cart, and checkout |
| [conference-api/src/index.js](conference-api/src/index.js) | Worker routes, data access, email, and fulfillment logic |
| [conference-api/migrations/](conference-api/migrations/) | Versioned D1 schema migrations |
| [conference-api/test/index.spec.js](conference-api/test/index.spec.js) | Worker tests |
| [conference-api/package.json](conference-api/package.json) | Worker dependencies and npm commands |
| [scripts/check_site.py](scripts/check_site.py) | Static HTML and local-link validation |
| [.github/workflows/check-site.yml](.github/workflows/check-site.yml) | Website validation and Worker tests in GitHub Actions |
| [CNAME](CNAME) | GitHub Pages custom domain |

## Local development

### Requirements

- Git.
- Python 3 for website previews and validation.
- Node.js 22 and npm for the Worker; Node.js 22 is used in CI.
- Access to the relevant Cloudflare, Supabase, Resend, Stripe, and Printify settings when testing integrations.

Clone the repository:

```powershell
git clone https://github.com/HACYPAA-Organization/hacypaa-website.git
cd hacypaa-website
```

### Preview the website

From the repository root:

```powershell
python -m http.server 5500
```

Open [http://127.0.0.1:5500/](http://127.0.0.1:5500/). VS Code Live Server on port `5500` also works. Serve the repository root because navigation and asset URLs use root-relative paths.

### Run the API

In a separate terminal, from the repository root:

```powershell
cd conference-api
npm ci
```

Create an untracked `conference-api/.dev.vars` file containing the settings needed for the integrations you are testing. Use test credentials and test recipients. For local registration emails, override `PUBLIC_SITE_URL` with `http://127.0.0.1:5500` so the emailed payment link opens the local website.

Then, from `conference-api`:

```powershell
npx wrangler d1 migrations apply hacypaa-orders --local
npm run dev
```

Registration, payment-report, panelist, and admin scripts use `http://127.0.0.1:8787` when the website hostname is `localhost` or `127.0.0.1`. The Worker allows browser requests from those website origins on port `5500` and from the public `hacypaa.us` origins.

**Local checkout distinction:** `checkout.js` uses a fixed deployed API URL, including during local website previews. Configure a test API endpoint when testing merchandise checkout locally. Local D1 does not isolate external Supabase, Resend, Stripe, or Printify calls.

## Configuration

The following public settings are currently in `conference-api/wrangler.jsonc`:

| Setting | Current value / purpose |
| --- | --- |
| `PREREG_PRICE_CENTS` | `2500`; base registration amount in cents |
| `PUBLIC_SITE_URL` | `https://hacypaa.us`; base URL for emailed payment links |
| `PREREG_FROM_EMAIL` | `HACYPAA XI Registration <registration@mail.hacypaa.us>`; Resend sender |

Configure these additional Worker settings for the features in use:

| Setting | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Registration and payment email delivery; secret |
| `SUPABASE_URL` | Supabase project URL for JWT verification and allowlist lookup |
| `SUPABASE_SECRET_KEY` | Server-side access to the Supabase admin allowlist; secret |
| `STRIPE_SECRET_KEY` | Merchandise checkout and session verification; secret |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification; secret |
| `PRINTIFY_API_TOKEN` | Printify product lookup and order submission; secret |
| `PRINTIFY_SHOP_ID` | Printify shop used for merchandise |

Local values belong in `.dev.vars`; deployed secrets belong in Cloudflare Worker secrets. `.dev.vars` is ignored by Git and does not update production. For example, from `conference-api`:

```powershell
npx wrangler secret put RESEND_API_KEY
```

This command updates the deployed Worker secret and deploys a new Worker version. Use it when intentionally changing production configuration.

Browser configuration lives in [assets/js/supabase-config.js](assets/js/supabase-config.js) and [assets/js/checkout.js](assets/js/checkout.js). Supabase publishable keys and Stripe publishable keys are browser configuration; privileged Supabase keys, Stripe secret keys, and other service secrets must stay server-side.

## Validation

From the repository root:

```powershell
python scripts/check_site.py
git diff --check
```

The website checker validates HTML structure, language, titles, descriptions, favicon and social metadata, duplicate IDs, and local link/fragment targets. It does not test external links, API availability, email delivery, or real form submissions.

For Worker changes, from `conference-api`:

```powershell
npm ci
npm test -- --run
```

The test suite covers request validation, CORS, registration and email behavior, payment-link resends, Supabase authorization and role restrictions, panelist submissions, and fulfillment behavior.

GitHub Actions runs website validation and Worker tests on pushes to `main` and on pull requests. The workflow does not apply production migrations or deploy the Worker.

## Deployment

### Website

Commit and push the intended static-site changes to `main`. GitHub Pages publishes the website through the repository's Pages deployment. Confirm that the Pages workflow succeeds and verify the affected pages at `https://hacypaa.us`.

Preserve `CNAME` and the root `registration.html` compatibility redirect.

### Worker and database

Run these commands from `conference-api`, using a Cloudflare login authorized for the configured resources:

```powershell
npm ci
npm test -- --run
npx wrangler whoami
npx wrangler d1 migrations list hacypaa-orders --remote
npx wrangler d1 migrations apply hacypaa-orders --remote
npm run deploy
npx wrangler d1 migrations list hacypaa-orders --remote
```

Review pending migrations before applying them. `--remote` targets the production database; `--local` targets the development database. Add new schema changes as new numbered migration files.

**A Git push or Worker deployment does not apply D1 migrations.** Apply required production migrations before releasing code that depends on the new schema. A successful health response also does not verify that a form can save to D1.

After a release, verify the changed workflow end to end: submit the relevant form with test details, confirm the record appears in the appropriate admin view, and check any email or payment behavior affected by the change. Avoid submitting real fulfillment orders solely to test deployment.

## Troubleshooting

| Symptom | First checks |
| --- | --- |
| Registration or panelist application cannot be saved | Worker logs, `ORDERS_DB` binding, and unapplied remote migrations; panelists require migration `0007` |
| Registration saved but no email arrived | Resend key, verified sender/domain, spam folder, and the resend option |
| An older payment link stops working after a resend | Open the link from the newest successfully sent payment email |
| Admin sign-in succeeds but dashboard access is denied | Completed MFA, matching Supabase `user_id`, `active=true`, supported role, and Worker Supabase configuration |
| A volunteer admin cannot view registrations | `volunteer_admin` permits the panelist view only |
| Local forms cannot reach the API | Website origin on port `5500`, Worker running on port `8787`, and local D1 migrations |
| Wrangler reports account authorization errors | Run `npx wrangler whoami` and `npx wrangler d1 list` from `conference-api`; verify access to the configured database |
| A printed QR code opens a missing page | Confirm root `registration.html` exists and the latest Pages deployment succeeded |
| A paid merchandise order is not submitted to Printify | Stripe webhook delivery, stored D1 order, queue/dead-letter queue, Printify credentials, and Worker logs |

For live Worker logs, run `npx wrangler tail` from `conference-api`.

## Reference documentation

- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/)

Documentation reviewed against `main` on October 10, 2026.
