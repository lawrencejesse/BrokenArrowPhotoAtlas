# Replit Production Rollout

This branch changes the payment trust boundary and adds optional accounts. Roll it out in stages so a live customer can never be charged by an unverified path.

## 0. Immediate Security Cleanup

1. Delete or rotate the old `ADMIN_TOKEN` in Replit Secrets and deployment settings.
2. Do not recreate the query-string admin bypass. Query secrets leak into browser history, analytics, screenshots, and logs.
3. The old value remains in Git history. Purging public history is a separate, destructive repository operation and should be planned explicitly.
4. Review and remove the previously committed Stripe event sample from Git history if it contains real customer or payment details. Removing it in this branch prevents future serving but does not erase earlier commits.

## 1. Prepare the Branch in Replit

1. Keep production on `main`.
2. In Replit, fetch GitHub and switch the workspace to `agent/accounts-team-billing`.
3. Ask Replit Agent to add **Clerk Auth**, not Replit Auth, to the existing PhotoAtlas app.
4. The Clerk tenant should use Photo Atlas branding and keep personal accounts enabled.
5. Enable Clerk Organizations with optional membership, the default `org:admin` and `org:member` roles, organization creation, and member invitations.
6. Confirm the generated Clerk environment variables map to `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. Preserve the existing API routes and plain-JavaScript frontend rather than replacing the app framework.

Suggested Replit Agent request:

> Add branded Clerk authentication to this existing PhotoAtlas app. Sign-in must remain optional. Enable optional personal accounts plus Organizations, invitations, and the default admin/member roles. Preserve the current guest workflow and local-only photo processing. Use the existing account controls and Express auth adapter on this branch; do not redesign or deploy the app.

## 2. Add the Replit Database

1. Open Replit's Database tool and add PostgreSQL to the development app.
2. Confirm `DATABASE_URL` is present in development.
3. Start the app once. `lib/store.js` creates the required tables idempotently.
4. Save and resume a test session. Confirm the database contains metadata but no image bytes or base64 photo data.
5. Remember that Replit development and production databases are separate. Confirm production database creation during Publish.

## 3. Configure Stripe Test Mode

Create or select:

- the existing one-time $15 CAD site-export Price
- one recurring company/team Price
- a Customer Portal configuration that permits subscription management

Add test-mode secrets:

```text
STRIPE_SECRET_KEY
STRIPE_PRICE_ID
STRIPE_TEAM_PRICE_ID
```

Create a test webhook pointing at the branch preview or development endpoint and set `STRIPE_WEBHOOK_SECRET`. Subscribe to the five events listed in the README.

## 4. Acceptance Tests

Run `npm test`, then manually verify all of these in a non-production environment:

1. Guest can load photos, edit, and generate a watermarked preview without signing in.
2. Guest completes a test payment and receives exactly one clean download.
3. Closing both tabs immediately after payment still permits recovery from the same browser.
4. A paid session cannot unlock a substantially different photo folder.
5. A popup-blocked or failed checkout creates no charge and shows a useful message.
6. Personal user can save, list, resume, overwrite, and delete a metadata session.
7. A member of Company A cannot read Company B sessions.
8. Company admin can invite a member and start/manage billing.
9. Company member receives clean exports while the company subscription is active.
10. A personal workspace or another company does not inherit that entitlement.
11. `package.json`, `.replit`, server source, and attached files all return 404 from the public deployment.
12. Stripe webhook events can be replayed without duplicate entitlements or charges.

## 5. Publish Safely

1. Merge only after the test-mode checklist passes.
2. Publish to a Replit production database.
3. Add production Clerk and Stripe secrets; do not copy test accounts or test payment data into production.
4. Create the production Stripe webhook at `https://photolog.brokenarrow.pro/api/stripe/webhook`.
5. Check `/api/health`; it should return HTTP 200 with database, Stripe, webhook, and accounts enabled.
6. Complete one low-value live purchase yourself and refund it in Stripe.
7. Invite one internal company test member and verify company access before onboarding a client.

## Rollback

Keep the previous production deployment available until the live smoke test succeeds. If health, webhook delivery, or account isolation fails, roll back the deployment; Stripe remains the source of truth and the database keeps completed-payment records for reconciliation.
