# UI Flow - Photo Log Atlas Builder

## Design Principle

Make the app feel like a guided workflow, not a raw EXIF dump.

The existing extractor is useful, but the new version should help a non-GIS user understand what to do next.

Recommended top-level flow:

1. Photos
2. Review
3. Atlas Settings
4. Generate
5. Export / Upgrade

## Page Layout

Use a single-page app with step sections.

Avoid a landing-page hero. The first screen should be the tool.

Suggested header:

**Photo Log Atlas Builder**

Subtext:

Create a printable map-based photo log from geotagged drone or field photos.

## Step 1 - Photos

### Controls

Primary buttons:

- `Select Photos`
- `Select Folder`

Support both because users think differently:

- some users want to grab only a few photos
- some users want to process an entire field folder

Implementation notes:

- individual photos: normal `<input type="file" multiple accept="image/*">`
- folder: `<input type="file" webkitdirectory directory multiple>`

### Advanced / QGIS Export Path

Add collapsed section:

**Advanced: QGIS photo path**

Field:

`Local folder path for QGIS photo links`

Helper text:

Optional. Only needed if you want the downloaded GeoJSON to include full local photo paths for QGIS photo logs.

This replaces the current workflow where the user must paste the local folder path up front.

### Extract Button

Button:

`Extract EXIF`

After extraction, show:

- number of images selected
- number with GPS coordinates
- number missing GPS
- number with yaw/heading

Example:

`Loaded 18 photos. 17 have GPS coordinates. 15 have flight yaw.`

## Step 2 - Review Photo Log

Show an editable table.

Columns:

- Include checkbox
- Photo #
- File name
- Date
- Latitude
- Longitude
- Relative altitude
- Yaw / heading
- Comment

### Comment Field

The comment cell should be editable with a text input or textarea.

This comment should flow into:

- generated atlas caption
- downloaded GeoJSON
- downloaded CSV

### Include / Exclude

Each row should have an include checkbox.

Only included photos appear in the atlas.

All photos may still be exported in CSV/GeoJSON if the user chooses, but default exports should respect the included rows.

### Sorting

Default sort:

- photo number / file order

Nice-to-have:

- sort by date
- sort by file name

## Step 3 - Atlas Settings

### Project Text

Fields:

- `Atlas title`
- `Subtitle`

Example:

- Title: `Knutson NW-23-15-33W1M`
- Subtitle: `2025 Aerial Photo Summary`

### Photo Label Field

Dropdown:

`Photo label field`

Default:

`photoNumber`

Options should include available fields from the extracted data, such as:

- `photoNumber`
- `fileName`
- `date`
- `RelativeAltitude`
- any other metadata key detected

Later advanced option:

`Label template`

Example:

`Photo {photoNumber} - {date}`

Do not build template logic first unless easy.

### Caption Fields

Default caption fields:

- Photo
- Date
- Altitude
- Comment

Optional later:

- allow the user to toggle caption fields on/off

### Map Settings

Controls:

- `Map zoom` slider
- default: `16`
- range: `14` to `18`

Helper:

Lower zoom shows more context. Higher zoom shows more site detail.

### Boundary Overlay

Upload:

`Optional project boundary`

MVP:

- support GeoJSON

Later:

- support KML

Default style:

- stroke color: yellow
- stroke width: 2 px
- fill opacity: 0.05 or 0

Helper:

Upload a lease boundary, surveyed ROW, pasture boundary, project area, or inspection polygon.

### Privacy Notice

Place near map settings:

Satellite basemap tiles are loaded from external map providers around the photo locations. For sensitive client work, use custom/local basemap support.

## Step 4 - Generate Atlas

Button:

`Generate Printable Atlas`

After clicking:

- build atlas from included rows
- create one page per photo
- show preview of first page
- provide export/download options

### Atlas Page Layout

Landscape letter page.

Left:

- main photo
- caption block below
- title/subtitle near bottom

Right:

- satellite map
- current photo marker only
- marker rotated by `FlightYawDegree`
- north arrow
- optional boundary overlay
- scale bar

### Current Photo Marker

Use stylized arrowhead.

Heading source order:

1. `FlightYawDegree`
2. `GimbalYawDegree`
3. default north

Only show the current photo point on the map.

Do not show all photo points by default because it makes the map confusing.

## Step 5 - Export / Upgrade

### Free Buttons

- `Download CSV`
- `Download GeoJSON`
- `Download Printable HTML`

### Print To PDF

Show short instructions:

1. Open printable HTML.
2. Press `Ctrl+P`.
3. Choose `Save as PDF`.
4. Use landscape orientation.
5. Enable background graphics.

### Paid Gate Option

If adding Stripe:

Free users can:

- extract EXIF
- download CSV/GeoJSON
- preview atlas

Paid users can:

- download polished printable HTML atlas
- remove watermark
- use boundary overlay
- unlock title/subtitle customization

Start simple. Do not require accounts.

Possible Replit/Stripe flow:

1. user clicks `Unlock Atlas Export`
2. Stripe Checkout opens
3. after payment, app stores a local unlock token for that browser/session
4. user can download the atlas

For v1, a Stripe Payment Link could be enough if full integration takes too long.

## Empty / Error States

### No Photos Selected

Message:

Select geotagged photos or a folder to begin.

### Photos Missing GPS

Message:

Some photos do not have GPS coordinates and cannot be mapped. They can still be included in CSV export, but not in the map atlas.

### Photos Missing Yaw

Message:

Some photos do not have yaw/heading. Their map arrows will point north by default.

### Boundary Upload Fails

Message:

Could not read the boundary file. Try a GeoJSON file first. KML support is coming later.

## Suggested Event Tracking

Track events without sensitive data:

- `photos_selected`
- `exif_extracted`
- `csv_downloaded`
- `geojson_downloaded`
- `atlas_preview_generated`
- `atlas_html_downloaded`
- `boundary_uploaded`
- `stripe_checkout_started`
- `stripe_checkout_completed`
- `custom_cta_clicked`

Do not track coordinates, file names, comments, or EXIF data.

