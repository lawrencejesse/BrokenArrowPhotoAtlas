# Implementation Handoff - Photo Log Atlas Builder

## Starting Point

Start from the existing WebExifExtractorV3geojson Replit project.

Current live app:

`https://photoexif-jl.replit.app/`

Current repo:

`https://github.com/lawrencejesse/WebExifExtractorV3geojson`

Recommended project approach:

- clone/duplicate the existing Replit project
- do not overwrite the current live extractor until the atlas version is stable
- keep the app browser-first

## Existing Local Prototype To Reference

Prototype folder:

`C:\Users\broke\Documents\Mapping\BrokenArrow\demos\photo_atlas_renderer`

Files:

- `render_photo_atlas.py`
- `render_photo_atlas_pdf.mjs`
- `render_photo_atlas_preview.mjs`
- `assets\NorthArrow_02.svg`
- `assets\NorthArrow_11.svg`

The Python script is not necessarily meant to run in Replit. Treat it as a reference implementation for:

- page layout
- caption logic
- photo marker logic
- north arrow SVG use
- Leaflet map setup
- Esri imagery basemap

For the Replit web app, port the logic to JavaScript so atlas generation happens in the browser.

## Recommended Technical Architecture

### Frontend

- plain HTML/CSS/JavaScript is acceptable
- keep using `exifr` for browser-side EXIF extraction
- use Leaflet for maps
- use Esri World Imagery as default basemap
- use client-side object URLs for selected photos in the printable atlas

### Backend

Avoid a backend for v1 unless needed for Stripe.

Do not upload photos to a server in MVP.

### PDF

MVP should generate printable HTML only.

Users can print/save to PDF from the browser.

Do not build server-side Playwright PDF rendering in MVP.

## Key Libraries

Already used:

- `exifr` for EXIF parsing

Add:

- `leaflet`

Possible later:

- `togeojson` for KML support
- Stripe JS / Replit Stripe integration for paid export

## Build Order

### Phase 1 - Improve Photo Input

Add two input modes:

1. Select individual photos
2. Select folder

Implementation:

```html
<input type="file" id="photo-files" accept="image/*" multiple>
<input type="file" id="photo-folder" webkitdirectory directory multiple>
```

Keep only image files.

### Phase 2 - Better Review Table

After EXIF extraction, display a table with:

- include checkbox
- photo number
- file name
- date
- lat
- lon
- relative altitude
- yaw
- editable comment

Store extracted data in a JS array like:

```js
const photos = [
  {
    include: true,
    photoNumber: 1,
    fileName: file.name,
    date: formattedDate,
    comment: "",
    objectUrl: URL.createObjectURL(file),
    localQgisPath: "",
    latitude: 50.0,
    longitude: -102.0,
    relativeAltitude: 96,
    flightYawDegree: 11.1,
    exif: {}
  }
];
```

The `objectUrl` is used for the printable HTML atlas.

The optional QGIS path is used only for GeoJSON/CSV export.

### Phase 3 - QGIS Export Path As Advanced Option

Move the existing local path paste workflow into an advanced section.

Label:

`Advanced: QGIS photo path`

Purpose:

When exporting GeoJSON for QGIS, this lets QGIS find the local photos.

Do not require this path for atlas generation.

### Phase 4 - Atlas Settings

Add settings state:

```js
const atlasSettings = {
  title: "",
  subtitle: "Aerial Photo Summary",
  labelField: "photoNumber",
  mapZoom: 16,
  boundaryGeoJson: null,
  boundaryStyle: {
    color: "#ffff00",
    weight: 2,
    fillOpacity: 0.05
  }
};
```

Controls:

- title input
- subtitle input
- label field dropdown
- map zoom slider
- optional GeoJSON boundary upload

### Phase 5 - Generate Printable Atlas HTML

Build an HTML string from included photos.

Open it in a new tab or create a downloadable `.html` file.

The generated HTML should include:

- inline CSS for print layout
- Leaflet CSS/JS links
- serialized photo data
- serialized optional boundary GeoJSON
- embedded SVG strings for north arrow and photo arrow

Important:

- object URLs may not survive after downloading/opening later, depending on browser behavior
- for MVP, opening the atlas immediately in a new tab is easiest
- if downloadable HTML must work later, consider embedding images as base64 data URLs, but that can make files large

Recommended first behavior:

1. Generate atlas in a new tab.
2. User prints/saves PDF from that tab.

Add download HTML later if object URL persistence is acceptable or images are embedded.

## Atlas Layout Reference

Use landscape letter.

CSS concept:

```css
@page {
  size: Letter landscape;
  margin: 0.35in;
}

.photo-page {
  width: 10.3in;
  height: 7.75in;
  page-break-after: always;
  display: grid;
  grid-template-columns: 5.92in 3.9in;
  grid-template-rows: 4.3in 0.35in 2.55in;
  gap: 0.16in 0.22in;
  padding: 0.08in;
}
```

Left side:

- photo frame in top-left
- caption under photo
- title/subtitle at bottom-left

Right side:

- map fills entire right column

## Leaflet Map Logic

Default basemap:

```js
L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { attribution: "Tiles &copy; Esri", maxZoom: 20 }
)
```

For each photo page:

- create a map centered on photo lat/lon
- zoom from user slider
- add only the current photo marker
- add optional boundary GeoJSON
- add scale bar
- add north arrow control

Current photo marker:

- use `FlightYawDegree`
- fallback to `GimbalYawDegree`
- fallback to `0`

## SVG Assets

Use these from the local prototype:

- `assets/NorthArrow_02.svg` for north arrow
- `assets/NorthArrow_11.svg` for photo/yaw arrow

The QGIS SVG files contain `param(fill)` and `param(outline)` tokens.

Before embedding in browser HTML, replace them:

```js
svgText
  .replaceAll("param(fill)", "#111111")
  .replaceAll("param(outline)", "#ffffff")
```

For photo arrow, recommended colors:

- fill: `#f4ef4a`
- outline: `#1f3bd8`

## GeoJSON Export

Downloaded GeoJSON should still support QGIS photo logs.

Each feature should include:

- point geometry from lat/lon
- `photoNumber`
- `fileName`
- `date`
- `comment`
- `path` if user supplied QGIS path
- `RelativeAltitude`
- `FlightYawDegree`
- relevant EXIF fields

If no QGIS local path is supplied:

- set `path` to file name or omit full path
- do not force user to paste path

## Boundary Upload

MVP boundary support:

- GeoJSON only
- read with `FileReader`
- parse JSON
- validate `FeatureCollection`, `Feature`, or geometry object
- display on atlas maps

Future:

- KML support with `togeojson`

## Usage Tracking

The product should track usage so Jesse can know whether people actually use it.

Tracking must be privacy-safe.

Do not track:

- coordinates
- file names
- EXIF payloads
- comments
- boundary geometry
- client/project titles

Track only coarse events and counts.

Recommended event payload examples:

```js
track("photos_selected", {
  countBucket: "1-10"
});

track("exif_extracted", {
  totalPhotos: 12,
  gpsPhotos: 11,
  yawPhotos: 9
});

track("atlas_generated", {
  includedCount: 10,
  boundaryUsed: true,
  zoom: 16
});
```

If using Google Analytics / Plausible / PostHog:

- do not send raw counts if that feels sensitive
- count buckets are enough

Suggested events:

- `photos_selected`
- `exif_extracted`
- `csv_downloaded`
- `geojson_downloaded`
- `boundary_uploaded`
- `atlas_preview_generated`
- `atlas_print_opened`
- `atlas_html_downloaded`
- `stripe_checkout_started`
- `stripe_checkout_completed`
- `custom_cta_clicked`

## Stripe / Pricing Implementation

Do not make payment the first build step.

First make the atlas work.

Then add Stripe.

Potential gate:

Free:

- EXIF extraction
- CSV/GeoJSON download
- atlas preview with watermark

Paid:

- polished atlas export
- no watermark
- boundary overlay
- title/subtitle fields
- map zoom control

Suggested beta price:

- `$5`

Suggested standard price later:

- `$9`

If full Stripe integration slows the build down, use a simple Stripe Payment Link first and manually/directly unlock or route users to the paid export version.

## User-Facing Privacy Copy

Short version:

> Photos are processed in your browser and are not uploaded to our server in this version. If you use the satellite basemap, map tiles are requested from the basemap provider around your photo locations.

Longer version can go in an info panel.

## Acceptance Tests

### EXIF Extraction

- User can select individual photos.
- User can select a folder.
- App extracts GPS coordinates from demo DJI photos.
- App extracts `FlightYawDegree` where present.
- App shows count of mapped photos.

### Comments

- User can type a comment for each photo.
- Comments appear in generated atlas.
- Comments appear in exported GeoJSON/CSV.

### Atlas

- App generates one page per included photo.
- Main photo displays.
- Map centers on current photo.
- Only current photo marker appears.
- Marker rotates by yaw.
- North arrow appears.
- Boundary overlay appears if uploaded.
- Browser print preview shows landscape pages.

### Export

- CSV downloads.
- GeoJSON downloads.
- Printable atlas opens in new tab or downloads.

### Privacy

- No photos are uploaded in MVP.
- Usage tracking does not include coordinates or file names.

