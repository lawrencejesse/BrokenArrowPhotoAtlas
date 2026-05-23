#!/usr/bin/env python3
"""Render a map-based photo log from EXIF GeoJSON."""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_NORTH_ARROW = SCRIPT_DIR / "assets" / "NorthArrow_02.svg"
DEFAULT_PHOTO_ARROW = SCRIPT_DIR / "assets" / "NorthArrow_11.svg"


def file_uri(path_text: str) -> str:
    path = Path(path_text.replace("\\", "/"))
    if not path.is_absolute():
        path = path.resolve()
    return path.as_uri()


def as_float(value: object, default: float = 0.0) -> float:
    try:
        if value in (None, ""):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def fmt_alt(value: object) -> str:
    altitude = as_float(value, default=float("nan"))
    if altitude != altitude:
        return ""
    return f"{altitude:.0f} m"


def load_svg(path: Path, fill: str, outline: str) -> str:
    if not path.exists():
        return ""
    svg = path.read_text(encoding="utf-8")
    return (
        svg.replace("param(fill)", fill)
        .replace("param(outline)", outline)
        .replace("\n", "")
    )


def caption_for(feature: dict) -> dict:
    props = feature.get("properties", {})
    photo_number = props.get("photoNumber") or props.get("fileName") or ""
    date = props.get("date") or props.get("DateTimeOriginal") or props.get("CreateDate") or ""
    altitude = fmt_alt(props.get("RelativeAltitude") or props.get("GPSAltitude") or props.get("AbsoluteAltitude"))
    comment = props.get("comment") or ""
    return {
        "photo": html.escape(str(photo_number)),
        "date": html.escape(str(date)),
        "altitude": html.escape(str(altitude)),
        "comment": html.escape(str(comment)),
    }


def feature_payload(feature: dict, index: int) -> dict:
    props = feature.get("properties", {})
    coords = feature.get("geometry", {}).get("coordinates", [None, None])
    lon = as_float(coords[0], default=as_float(props.get("longitude") or props.get("GpsLongitude")))
    lat = as_float(coords[1], default=as_float(props.get("latitude") or props.get("GpsLatitude")))
    yaw = as_float(props.get("FlightYawDegree") or props.get("GimbalYawDegree"))
    photo_path = props.get("path") or props.get("fileName") or ""
    return {
        "id": f"photo-{index + 1}",
        "lat": lat,
        "lon": lon,
        "yaw": yaw,
        "src": file_uri(str(photo_path)),
        "fileName": str(props.get("fileName") or Path(str(photo_path)).name),
        "caption": caption_for(feature),
    }


def render_html(
    features: list[dict],
    title: str,
    subtitle: str,
    north_arrow_svg: str,
    photo_arrow_svg: str,
) -> str:
    payload = [feature_payload(feature, idx) for idx, feature in enumerate(features)]
    data_json = json.dumps(payload)
    north_svg_json = json.dumps(north_arrow_svg)
    photo_svg_json = json.dumps(photo_arrow_svg)
    title_safe = html.escape(title)
    subtitle_safe = html.escape(subtitle)

    pages = []
    for item in payload:
        cap = item["caption"]
        pages.append(
            f"""
<section class="photo-page">
  <div class="main-photo frame">
    <img src="{html.escape(item['src'])}" alt="{html.escape(item['fileName'])}">
  </div>
  <div class="caption-block">
    <div><span>PHOTO:</span> {cap['photo']}</div>
    <div><span>DATE:</span> {cap['date']}</div>
    <div><span>ALTITUDE:</span> {cap['altitude']}</div>
    <div><span>COMMENT:</span> {cap['comment']}</div>
  </div>
  <div class="report-title">
    <h1>{title_safe}</h1>
    <div class="rule"></div>
    <h2>{subtitle_safe}</h2>
  </div>
  <div class="map map-overview frame" id="{item['id']}-overview"></div>
</section>
"""
        )

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title_safe} Photo Log</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <style>
    @page {{ size: Letter landscape; margin: 0.35in; }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: #ffffff;
      color: #000000;
      font-family: Arial, Helvetica, sans-serif;
      letter-spacing: 0;
    }}
    .photo-page {{
      width: 10.3in;
      height: 7.75in;
      page-break-after: always;
      display: grid;
      grid-template-columns: 5.92in 3.9in;
      grid-template-rows: 4.3in 0.35in 2.55in;
      gap: 0.16in 0.22in;
      position: relative;
      padding: 0.08in;
      overflow: hidden;
    }}
    .frame {{
      border: 2px solid #111;
      background: #e5e7eb;
      overflow: hidden;
    }}
    .main-photo {{
      grid-column: 1;
      grid-row: 1;
    }}
    .main-photo img {{
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }}
    .caption-block {{
      grid-column: 1;
      grid-row: 2 / span 1;
      align-self: start;
      font-size: 12pt;
      line-height: 1.35;
      font-weight: 700;
      padding-top: 0.05in;
      text-transform: uppercase;
    }}
    .caption-block span {{
      font-weight: 800;
    }}
    .report-title {{
      grid-column: 1;
      grid-row: 3;
      align-self: end;
      padding-bottom: 0.02in;
    }}
    .report-title h1 {{
      margin: 0;
      color: #1d2ac7;
      font-size: 20pt;
      line-height: 1.1;
      font-weight: 800;
      text-transform: uppercase;
    }}
    .report-title .rule {{
      width: 3.25in;
      height: 2px;
      margin: 0.07in 0 0.06in;
      background: #67c7d5;
    }}
    .report-title h2 {{
      margin: 0;
      color: #000;
      font-size: 14pt;
      line-height: 1.1;
      font-weight: 800;
      text-transform: uppercase;
    }}
    .map-overview {{
      grid-column: 2;
      grid-row: 1 / span 3;
    }}
    .map {{
      width: 100%;
      height: 100%;
    }}
    .leaflet-control-attribution {{
      font-size: 6px;
    }}
    .photo-arrow {{
      width: 30px;
      height: 38px;
      transform-origin: 50% 50%;
      filter: drop-shadow(0 0 2px #fff) drop-shadow(0 0 2px #fff) drop-shadow(0 1px 2px rgba(0,0,0,0.55));
    }}
    .photo-arrow svg {{
      width: 100%;
      height: 100%;
      display: block;
    }}
    .north-arrow {{
      width: 42px;
      height: 66px;
      padding: 3px;
      background: rgba(255, 255, 255, 0.72);
      border-radius: 2px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.35);
    }}
    .north-arrow svg {{
      width: 100%;
      height: 100%;
      display: block;
    }}
    @media screen {{
      body {{ background: #cbd5e1; }}
      .photo-page {{
        margin: 24px auto;
        background: #fff;
        box-shadow: 0 10px 30px rgba(0,0,0,0.18);
      }}
    }}
  </style>
</head>
<body>
{''.join(pages)}
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const photoData = {data_json};
const northArrowSvg = {north_svg_json};
const photoArrowSvg = {photo_svg_json};

function imageryLayer() {{
  return L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{{z}}/{{y}}/{{x}}",
    {{ attribution: "Tiles &copy; Esri", maxZoom: 20 }}
  );
}}

function arrowIcon(yaw) {{
  return L.divIcon({{
    className: "",
    iconSize: [30, 38],
    iconAnchor: [15, 19],
    html: `<div class="photo-arrow" style="transform: rotate(${{yaw}}deg);">${{photoArrowSvg}}</div>`
  }});
}}

function initMap(elId, item, zoom) {{
  const map = L.map(elId, {{
    zoomControl: false,
    attributionControl: true,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    tap: false
  }}).setView([item.lat, item.lon], zoom);
  imageryLayer().addTo(map);
  L.marker([item.lat, item.lon], {{ icon: arrowIcon(item.yaw) }}).addTo(map);
  const north = L.control({{ position: "topright" }});
  north.onAdd = function() {{
    const div = L.DomUtil.create("div", "north-arrow");
    div.innerHTML = northArrowSvg;
    return div;
  }};
  north.addTo(map);
  L.control.scale({{ imperial: false, position: "bottomleft" }}).addTo(map);
  setTimeout(() => map.invalidateSize(), 250);
  return map;
}}

for (const item of photoData) {{
  initMap(`${{item.id}}-overview`, item, 16);
}}

window.photoAtlasReady = true;
</script>
</body>
</html>
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a map-based photo log HTML atlas from EXIF GeoJSON.")
    parser.add_argument("--geojson", required=True, help="Input EXIF GeoJSON file.")
    parser.add_argument("--out", required=True, help="Output HTML file.")
    parser.add_argument("--title", default="Map Based Photo Log", help="Main report title.")
    parser.add_argument("--subtitle", default="Aerial Photo Summary", help="Subtitle shown below the title.")
    parser.add_argument("--north-arrow-svg", default=str(DEFAULT_NORTH_ARROW), help="SVG for the north arrow.")
    parser.add_argument("--photo-arrow-svg", default=str(DEFAULT_PHOTO_ARROW), help="SVG for the photo point arrow.")
    args = parser.parse_args()

    geojson_path = Path(args.geojson)
    with geojson_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    features = [
        feature
        for feature in data.get("features", [])
        if feature.get("geometry", {}).get("type") == "Point"
    ]
    if not features:
        raise SystemExit("No point features found in GeoJSON.")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    north_arrow_svg = load_svg(Path(args.north_arrow_svg), fill="#111111", outline="#ffffff")
    photo_arrow_svg = load_svg(Path(args.photo_arrow_svg), fill="#f4ef4a", outline="#1f3bd8")
    out_path.write_text(
        render_html(features, args.title, args.subtitle, north_arrow_svg, photo_arrow_svg),
        encoding="utf-8",
    )
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
