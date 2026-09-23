# Mobile PDF release isolation

- Production URL: https://photolog.brokenarrow.pro/
- Source baseline: `pre-mobile-pdf` / `310f3b7b33da168fd3e94b70b5387c7b368eaafe`.
- Development branch: `feature/mobile-pdf`.
- Local preview: `npm run preview`, then http://localhost:5011/.
- Direct PDF photo log is on `feature/mobile-pdf`, alongside the existing HTML workflow. It has not been deployed or tested on a physical phone.
- On Android, the Google Photos picker can hand the browser a copy without GPS metadata. The mobile preview offers **Choose Original Files (GPS)** so a user can browse to the OpenCamera files through the file manager. Confirm this on a real Android phone before release; the website cannot recover GPS from a redacted copy. Android documents location metadata redaction in its [media access guidance](https://developer.android.com/training/data-storage/shared/media).

## Baseline verified 2026-09-23

Live `script.js`, `atlas.js`, `photolog.js`, `styles.css`, and `analytics.js` match the baseline after normalizing line endings. Live HTML matches except for Replit's injected feedback widget.

This verifies public frontend assets, not deployed server code or secrets. Confirm the current Replit deployment before treating the tag as a complete production rollback.

Repository deployment configuration at baseline: Replit autoscale; Node 20 module; `node server.js`; application port 5000. Actual hosting settings and secret values are not copied here.

## Hosted preview

Use the separate `preview/mobile-pdf` branch for a new Replit app. That branch has its own `.replit` and start command, already set to launch the payment-disabled preview. Keep the production app on `main`. Do not copy production Stripe keys or an admin token into the preview. The preview app should get its own Replit hostname.

The preview entry point disables every payment API, omits production analytics, adds a visible preview banner, and marks pages noindex. Watermarked PDF and HTML output work without payment. Test-mode checkout is a later step, using a separate Stripe sandbox; no checkout is available yet.

## Release gate

Before merging: verify existing atlas/photo-log output and draft save/resume; test PDF saving and sharing on a real iPhone and Android; verify checkout and paid recovery in a sandbox. Review the PR, tag the release, and confirm the prior Replit deployment is restorable before deploying production. Merge `feature/mobile-pdf`, never `preview/mobile-pdf`.

If rollback is needed, restore the previous Replit deployment and verify its assets. Rebuilding the source tag is a fallback only after verifying its server code and configuration match the intended production baseline.
