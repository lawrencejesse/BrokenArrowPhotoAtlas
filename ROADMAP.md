# Photo Log Atlas Builder — Product Roadmap

Feature ideas for future development. Not prioritized by date — just captured while they're fresh.

---

## 1. Thumbnail Review Panel

**Problem:** Users write captions into the table without being able to see the photo they're captioning. This slows down the workflow and increases errors.

**Idea:**
- Add a thumbnail strip or lightbox beside (or above) the review table so the user can see each image while filling in captions, comments, and other fields.
- Clicking a row in the table highlights the corresponding thumbnail, and vice versa.
- Could be a side-panel that opens on demand, or an inline expandable row — whichever feels less cluttered on a small screen.
- Stretch goal: allow caption/comment to be typed directly in the thumbnail view so the user never has to switch contexts.

---

## 2. Click-to-Set Bearing Tool

**Problem:** Many consumer cameras and phone apps only capture lat/long — no compass bearing or photo orientation. Without bearing data, the map arrow on the atlas page can't be drawn.

**Idea:**
- For any photo that has lat/long but no bearing, show an interactive mini-map in the review step.
- The photo's GPS location is pinned at the center.
- The user clicks on the map in the direction the camera was pointing. The app calculates the bearing angle between the photo pin and the clicked point and writes it back into the working dataset (and eventually the saved GeoJSON — see item 3).
- Visually, this could look like a 360° circle around the pin. As the user moves their cursor, a dashed line previews the bearing before they click to confirm.
- The stored bearing feeds directly into the existing map-arrow rendering on atlas pages.

---

## 3. Persistent GeoJSON / Draft-and-Review Workflow

**Problem:** Right now, all caption work is lost when the browser is closed. There's no way for a junior to do the first pass and hand it to a senior for review without starting over. We also don't want to charge twice for a draft + final export.

**Core idea — Save enriched GeoJSON:**
- After EXIF extraction and any user edits (captions, comments, bearing, include flags), allow the user to export the *enriched* GeoJSON — not just raw EXIF, but everything they've filled in.
- Filename format: `{surface-location}_{YYYY-MM-DD}.geojson` so drafts are easy to sort and find.

**Resume workflow:**
- On load, give the user the option to point to a *folder of photos* AND an existing *enriched GeoJSON* from a previous session.
- The app matches photos to GeoJSON entries (by filename or some stable key) and pre-fills all captions, comments, bearing, and include flags — leapfrogging them past the data-entry step.
- Any new photos in the folder that aren't in the GeoJSON get appended as fresh entries.

**Review / watermark logic:**
- Drafts in review still show the watermark — that's fine and expected.
- The payment unlock happens once, at final export. Junior does the draft, senior reviews and tweaks, one unlock, done.
- Keep it simple: the GeoJSON *is* the save file. No accounts, no cloud sync, no database — just a file the team can email or drop in a shared folder.

---

## Notes

- All three features are independent and can be built in any order.
- The GeoJSON persistence feature (item 3) has the highest leverage — it unblocks the review workflow and makes the bearing data (item 2) durable across sessions.
- The thumbnail panel (item 1) is likely the quickest win for user satisfaction during the captioning step.
