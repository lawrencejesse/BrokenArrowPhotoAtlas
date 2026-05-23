# PRD - Photo Log Atlas Builder

## Product Summary

Photo Log Atlas Builder is a browser-based field utility that turns geotagged drone or field photos into a clean, printable, map-based photo log.

The tool starts from the existing WebExifExtractor app and adds a printable HTML atlas generator. The goal is to help environmental consultants, drone operators, and field inspectors make report-ready photo logs without fighting QGIS print atlas, Word tables, or manual screenshot workflows.

## Core Promise

Upload geotagged photos, review/edit the photo log, optionally add a boundary, and generate a printable photo atlas with one page per photo.

Each atlas page shows:

- the main photo
- a satellite map centered on the photo location
- only the current photo point
- a yaw-oriented arrow marker
- a north arrow
- a caption built from EXIF/GeoJSON fields and user comments

## Target Users

Primary:

- environmental consultants
- reclamation / remediation field staff
- drone operators supporting environmental reports
- GIS analysts who need fast photo appendices

Secondary:

- insurance inspectors
- right-of-way inspectors
- agricultural scouts
- utility / infrastructure inspectors

The first sales language should focus on environmental consultants because that is the market Jesse knows best.

## Jobs To Be Done

1. As a consultant, I want to turn geotagged field photos into a clean map-based photo log quickly.
2. As a drone operator, I want a client-friendly PDF/photo appendix from a folder of oblique images.
3. As a GIS user, I want a QGIS-ready GeoJSON photo layer with paths and comments.
4. As a report writer, I want one printable page per photo with the relevant location map and caption.

## Product Scope

### MVP Includes

- select individual photos
- select a folder of photos
- extract EXIF metadata client-side
- show editable photo table
- allow user to include/exclude photos
- allow user to add/edit comments
- download CSV
- download GeoJSON
- configure atlas title/subtitle
- choose which field to use as the photo label
- adjust map zoom
- optionally upload a GeoJSON boundary overlay
- generate printable HTML atlas
- browser print/save-to-PDF workflow
- simple usage tracking without collecting sensitive photo/location data

### V1.1 / Near-Term Adds

- KML boundary upload support
- boundary style controls
- alternate layouts
- watermark/no-watermark paid gate
- Stripe checkout / paid export
- sample/demo dataset button
- clearer privacy notice around basemap tile requests

### Not In MVP

- user accounts
- saved projects
- cloud storage of photos
- server-side PDF rendering
- subscriptions
- multi-user workspace
- complex basemap catalog
- full QGIS feature parity

## Current Existing App

Existing app:

`https://photoexif-jl.replit.app/`

Existing GitHub repo:

`https://github.com/lawrencejesse/WebExifExtractorV3geojson`

Current behavior:

- user selects a folder of photos
- app extracts EXIF metadata in-browser using `exifr`
- app displays a table
- app exports CSV or GeoJSON
- app includes a text field where the user can paste a local folder path so QGIS can find image files

## Important UX Change

The current app is useful but a bit technical. The new version should feel more guided.

The user should be able to either:

- select individual photos, or
- select a folder

The local directory/path field should become optional and clearly labeled as a QGIS export feature.

For the printable HTML atlas, the app does not need a manually pasted local directory path because the browser already has access to the selected photo files during the current session and can generate local object URLs for preview/print.

However, for QGIS GeoJSON export, a local path field is still useful. Keep it, but make it optional and hide it under an "Advanced / QGIS export" section.

## Output Modes

### Free Output

- CSV download
- GeoJSON download
- basic printable atlas preview or basic HTML export

### Paid / Beta Output

Potential low-price product:

- `$5` beta atlas export
- later `$9` standard photo atlas export

Paid export could unlock:

- polished atlas layout
- no watermark
- boundary overlay
- title/subtitle customization
- label field choice
- map zoom control

### Custom Upsell

Call-to-action below the tool:

Need a client-ready PDF with branding, custom basemap, orthomosaic backdrop, or report appendix cleanup? Hire Broken Arrow.

Potential custom prices:

- `$99+` for small branded photo-log cleanup
- higher for custom basemaps, orthomosaics, ROW/lease overlays, or full report appendix support

## Privacy Requirements

Photos should be processed locally in the browser for MVP.

Do not upload full-resolution photos to a backend in the MVP.

Usage tracking must not collect:

- photo file names
- coordinates
- client names
- uploaded boundary content
- EXIF metadata payloads

If using public basemap tiles, include a notice:

> Satellite basemap tiles are requested from external map tile providers around the photo locations. For sensitive client work, use a local/custom basemap workflow.

## Success Criteria

The MVP is successful if a user can:

1. select 5-20 photos
2. extract EXIF data
3. edit comments
4. optionally upload a GeoJSON boundary
5. generate a clean printable HTML atlas
6. save it as PDF from browser print
7. use the output in a report with little or no QGIS/Word cleanup

## Business Success Criteria

The product is commercially interesting if:

- at least one user pays for an atlas export
- environmental/GIS users understand the value in under 30 seconds
- the tool creates custom service inquiries
- the free utility drives trust in Broken Arrow's field/GIS workflow skill

