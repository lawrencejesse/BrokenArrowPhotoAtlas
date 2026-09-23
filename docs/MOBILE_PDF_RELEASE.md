# Mobile PDF release isolation

- Production URL: https://photolog.brokenarrow.pro/
- Source baseline: `pre-mobile-pdf` / `310f3b7b33da168fd3e94b70b5387c7b368eaafe`.
- Development branch: `feature/mobile-pdf`.
- Local preview: `npm run preview`, then http://localhost:5011/.
- Mobile PDF implementation has not started. Preview currently runs the existing HTML workflow.

## Baseline verified 2026-09-23

Live `script.js`, `atlas.js`, `photolog.js`, `styles.css`, and `analytics.js` match the baseline after normalizing line endings. Live HTML matches except for Replit's injected feedback widget.

This verifies public frontend assets, not deployed server code or secrets. Confirm the current Replit deployment before treating the tag as a complete production rollback.

Repository deployment configuration at baseline: Replit autoscale; Node 20 module; `node server.js`; application port 5000. Actual hosting settings and secret values are not copied here.

## Hosted preview

Create a separate Replit app from `feature/mobile-pdf`; do not change the production app's branch, domain, secrets, or deployment. In that separate app only, replace `.replit` with `preview.replit.toml`. Preview deployment command: `npm run preview`; set `PREVIEW_HOST=0.0.0.0` and the platform's `PORT`. Assign a separate preview hostname. Do not add production Stripe keys or an admin token.

The preview entry point disables every payment API, omits production analytics, adds a visible preview banner, and marks pages noindex. It retains watermarked HTML output. Test-mode checkout is a later step, using a separate Stripe sandbox; no checkout is available yet.

## Release gate

Add PDF alongside HTML. Before merging: verify existing atlas/photo-log output and draft save/resume; test PDF layout and sharing on real iPhone and Android; verify checkout and paid recovery in a sandbox. Review the PR, tag the release, and confirm the prior Replit deployment is restorable before deploying production.

If rollback is needed, restore the previous Replit deployment and verify its assets. Rebuilding the source tag is a fallback only after verifying its server code and configuration match the intended production baseline.
