# Broken Arrow Photo Atlas

Browser-based photo log and map atlas builder for field, drone, inspection, and consulting photo documentation.

The app extracts EXIF metadata locally in the browser, lets users review and caption photos, then generates printable HTML that can be saved to PDF from the browser. Photos are not uploaded or stored by the app.

## What It Does

- Select individual photos or a full folder of photos.
- Extract GPS, date, altitude, and yaw metadata in the browser.
- Review, reorder, include/exclude, and caption photos.
- Generate either:
  - Map Atlas: one GPS photo per page with satellite map context.
  - Photo Log: two photos per page, no GPS required.
- Add optional branding, project title, company name, accent color, logo, and footer.
- Export CSV, GeoJSON, printable HTML, and review draft GeoJSON.
- Unlock clean, non-watermarked exports through Stripe Checkout.

## Review Draft Workflow

Review drafts are small GeoJSON save files. They store the project metadata needed to resume or hand off a job:

- photo order
- include/exclude choices
- captions/comments
- GPS and yaw metadata
- relative photo names/paths
- file size/date matching hints
- atlas/photo log settings

Drafts do not store image bytes. To resume a draft, the user selects the same photo folder, then loads the draft GeoJSON. This keeps the app lightweight and avoids storing client photo libraries.

This supports a junior/senior review workflow:

1. Junior selects photos, fills captions, and saves a review draft.
2. Junior sends the draft plus the original photo folder or shared-drive link to a reviewer.
3. Reviewer selects the same folder, resumes the draft, edits as needed, and generates the final export.
4. Payment is only needed when unlocking a clean final export.

## Payment Recovery Model

The Stripe unlock is tied to a site/photo-set manifest, not to every caption or layout detail. This means one payment can cover normal revision work for the same site:

- caption edits
- reordering
- include/exclude tweaks
- branding changes
- landscape/portrait changes
- atlas/photo-log mode changes
- small photo swaps

A mostly different photo folder is treated as a new job and requires a new unlock. This keeps the workflow friendly for consultants without turning one payment into unlimited unrelated sites.

## Local Development

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm start
```

Open:

```text
http://localhost:5000
```

## Stripe Configuration

The server expects these environment variables:

```text
STRIPE_SECRET_KEY
STRIPE_PRICE_ID
ADMIN_TOKEN
```

`STRIPE_PRICE_ID` is optional because the app has a built-in early-access fallback price for the current $15 CAD/site unlock. Set `STRIPE_PRICE_ID` in Replit Secrets when you need to override that default without changing code.

If `STRIPE_SECRET_KEY` is missing, checkout endpoints return a configuration error and the browser app remains usable for watermarked previews.

## Project Structure

```text
index.html       Main UI
styles.css       App styles
script.js        Browser workflow, EXIF extraction, drafts, payment recovery
atlas.js         Printable map atlas renderer
photolog.js      Printable photo log renderer
server.js        Express static server and Stripe endpoints
ROADMAP.md       Product ideas and future workflow notes
```

## Deployment Checklist

Before deploying to live customers:

1. Deploy with Stripe test keys.
2. Generate a watermarked preview.
3. Save a review draft.
4. Complete a Stripe test checkout.
5. Confirm the clean HTML downloads.
6. Refresh/reopen the app.
7. Reload the same photo folder and draft.
8. Confirm payment recovery unlocks the same site.
9. Load a different photo folder and confirm it requires a new unlock.

