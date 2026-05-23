# Photo Atlas Renderer

Prototype renderer for turning WebExifExtractor GeoJSON into a map-based photo
log. It creates one landscape letter page per photo with:

- the source photo
- a caption built from GeoJSON properties
- one map overview centered on the photo point
- a yaw-oriented arrow using `FlightYawDegree`

## Build HTML

```powershell
C:\Users\broke\anaconda3\envs\geospatial_scripts\python.exe `
  C:\Users\broke\Documents\Mapping\BrokenArrow\demos\photo_atlas_renderer\render_photo_atlas.py `
  --geojson "<path-to-exif_data.geojson>" `
  --out "<path-to-photo_atlas.html>" `
  --title "Project Name" `
  --subtitle "Aerial Photo Summary"
```

## Render PDF

```powershell
node `
  C:\Users\broke\Documents\Mapping\BrokenArrow\demos\photo_atlas_renderer\render_photo_atlas_pdf.mjs `
  "<path-to-photo_atlas.html>" `
  "<path-to-photo_atlas.pdf>"
```

## Privacy Note

The current prototype uses Leaflet from a public CDN and Esri World Imagery map
tiles. Rendering or opening the HTML with maps enabled will request tiles around
the photo coordinates from external servers.

For sensitive client work, use one of these safer options before production use:

- render against a local orthomosaic or cached basemap tiles
- create the PDF from QGIS when a client basemap must not leave the machine
- get explicit approval before using public satellite tile services

