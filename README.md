# Broken Arrow Photo Atlas

Browser-based photo log and map atlas builder for field, drone, inspection, and consulting photo documentation.

The app extracts EXIF metadata and renders deliverables in the browser. Photo bytes stay on the user's device. Accounts are optional: signed-in users can save the small draft metadata needed to resume a session, and company workspaces can share sessions and billing.

## Product Lanes

- **Guest:** Build a full watermarked preview with no account; pay $15 CAD for a clean export.
- **Personal account:** Save draft metadata online and recover purchases across sessions.
- **Company workspace:** Invite employees, share saved sessions, and centralize billing.
- **Paid company:** One active Stripe team subscription includes clean exports for all current organization members.

Clerk handles sign-in, organizations, invitations, and roles. PostgreSQL stores only draft metadata, payment records, and billing entitlements. Stripe remains the source of truth for charges and subscriptions.

## What It Does

- Select individual photos or a full folder of photos.
- Extract GPS, date, altitude, and yaw metadata locally.
- Review, reorder, include/exclude, and caption photos.
- Generate a map atlas or a classic two-photo log.
- Add optional branding, project title, company name, accent color, logo, and footer.
- Export CSV, GeoJSON, printable HTML, and review draft GeoJSON.
- Unlock clean exports through Stripe Checkout or an active company plan.

## Saved Session Privacy

Downloaded and online sessions can contain:

- photo order and include/exclude choices
- captions/comments
- GPS and yaw metadata
- relative photo names/paths
- file size/date matching hints
- atlas/photo-log settings

They never contain photo bytes. When resuming, the user selects the original photo folder and the app matches those local files to the saved metadata. Online saving is explicit, not automatic.

## Payment Reliability Model

- A purchase record is created before Stripe Checkout begins.
- Stripe session creation uses an idempotency key, so retries do not create duplicate sessions.
- The purchase is bound to privacy-preserving SHA-256 hashes of the photo-set manifest.
- Stripe webhooks record completed payments even if the browser closes.
- Browser polling remains as a fast confirmation path, but it is no longer the only record of payment.
- A stored recovery token is valid for 30 days on the same browser. Signed-in purchases can also be associated with the active personal or company workspace.
- Normal caption, order, branding, layout, and small photo-set revisions remain covered; a mostly different photo set requires a new unlock.

The generated file is still created client-side. This is a customer-reliability paywall, not DRM; determined users can modify browser code. That is an intentional tradeoff for a private, fast $15 workflow tool.

## Local Development

```bash
npm install
npm test
npm start
```

Open `http://localhost:5000`. Without production secrets, the guest builder still works, while accounts and payments fail closed.

## Environment Variables

Core production configuration:

```text
DATABASE_URL
PUBLIC_APP_URL=https://photolog.brokenarrow.pro
STRIPE_SECRET_KEY
STRIPE_PRICE_ID
STRIPE_WEBHOOK_SECRET
```

Optional account and company features:

```text
CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
CLERK_AUTHORIZED_PARTIES=https://photolog.brokenarrow.pro,https://photolog.replit.app
STRIPE_TEAM_PRICE_ID
```

`STRIPE_PRICE_ID` retains the current early-access fallback if omitted, but explicitly setting it is safer. `STRIPE_TEAM_PRICE_ID` must point to a recurring Stripe Price. Never place secret values in `.replit`, source files, or GitHub.

## Stripe Webhook

Create a Stripe webhook endpoint at:

```text
https://photolog.brokenarrow.pro/api/stripe/webhook
```

Subscribe it to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Store the endpoint signing secret as `STRIPE_WEBHOOK_SECRET` in Replit Secrets.

## Project Structure

```text
app.js             Express application and API routes
server.js          Process entry point
lib/auth.js        Clerk authentication/workspace adapter
lib/payment.js     Payment fingerprints, tokens, and entitlement rules
lib/store.js       PostgreSQL and test-memory storage adapters
accounts.js        Optional account, saved-session, and billing UI
script.js          Browser workflow, EXIF, drafts, and checkout recovery
atlas.js           Printable map atlas renderer
photolog.js        Printable photo log renderer
test/app.test.js   Payment, webhook, team, privacy, and isolation tests
docs/              Deployment and architecture notes
```

## Production Rollout

Do not merge and publish this branch directly over the live checkout. Follow [the staged Replit rollout](docs/REPLIT_ROLLOUT.md), beginning with rotating the exposed legacy admin token, creating the database and Clerk tenant, and running Stripe entirely in test mode.
