/* ============================================================
   Photo Log Atlas Builder — Atlas Generator
   Broken Arrow Consulting
   Builds a printable landscape HTML atlas from photos[].
   ============================================================ */

'use strict';

/* ---- Public entry point ---------------------------------- */

async function buildAtlas(included, settings, boundary) {
  let northSvg = '';
  let photoSvg = '';

  try {
    const [nRes, pRes] = await Promise.all([
      fetch('replit_handoff/assets/NorthArrow_02.svg'),
      fetch('replit_handoff/assets/NorthArrow_11.svg')
    ]);
    const [nRaw, pRaw] = await Promise.all([nRes.text(), pRes.text()]);

    northSvg = nRaw
      .replaceAll('param(fill)', '#111111')
      .replaceAll('param(outline)', '#ffffff')
      .replace(/\n|\r/g, '');

    photoSvg = pRaw
      .replaceAll('param(fill)', '#f4ef4a')
      .replaceAll('param(outline)', '#1f3bd8')
      .replace(/\n|\r/g, '');
  } catch (e) {
    console.warn('Could not load SVG assets, using fallback markers.', e);
  }

  const photoData = included.map((p, i) => {
    const labelVal = p[settings.labelField] ?? p.photoNumber;
    const altStr = p.relativeAltitude != null
      ? `${parseFloat(p.relativeAltitude).toFixed(0)} m`
      : '';
    return {
      id:    `photo-${i + 1}`,
      lat:   p.latitude,
      lon:   p.longitude,
      yaw:   p.flightYawDegree ?? p.gimbalYawDegree ?? 0,
      src:   p.objectUrl,
      fileName: p.fileName,
      caption: {
        photo:    String(labelVal ?? ''),
        date:     p.date ?? '',
        altitude: altStr,
        comment:  p.comment ?? ''
      }
    };
  });

  const htmlStr = renderAtlasHtml(photoData, northSvg, photoSvg, settings, boundary);

  const blob    = new Blob([htmlStr], { type: 'text/html;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);

  const newTab = window.open(blobUrl, '_blank');
  if (!newTab) {
    console.warn('window.open was blocked — user must allow popups for this site.');
  }

  storeAtlasDownload(htmlStr, settings.title || 'photo_atlas');
}

/* ---- Store atlas for download ---------------------------- */

let atlasHtmlContent = '';

function storeAtlasDownload(html, titleBase) {
  atlasHtmlContent = html;
  const safe = (titleBase || 'photo_atlas')
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .trim()
    .replace(/\s+/g, '_') || 'photo_atlas';

  const dlBtn = document.getElementById('download-atlas-html');
  if (dlBtn) {
    dlBtn.dataset.filename = `${safe}.html`;
    dlBtn.disabled = false;
  }

  const printInstr = document.getElementById('print-instructions');
  if (printInstr) printInstr.classList.remove('hidden');
}

/* ---- Download atlas HTML --------------------------------- */

(function wireDownloadBtn() {
  const dlBtn = document.getElementById('download-atlas-html');
  if (!dlBtn) return;
  dlBtn.addEventListener('click', () => {
    if (!atlasHtmlContent) return;
    const filename = dlBtn.dataset.filename || 'photo_atlas.html';
    const blob = new Blob([atlasHtmlContent], { type: 'text/html;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
})();

/* ---- HTML renderer --------------------------------------- */

function safeJson(obj) {
  return JSON.stringify(obj).replace(/<\/script>/gi, '<\\/script>');
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderAtlasHtml(photoData, northSvg, photoSvg, settings, boundary) {
  const titleSafe    = escHtml(settings.title    || '');
  const subtitleSafe = escHtml(settings.subtitle || '');
  const hasTitle     = titleSafe.length > 0;

  const pages = photoData.map(item => {
    const cap = item.caption;
    return `
<section class="photo-page">
  <div class="main-photo frame">
    <img src="${escHtml(item.src)}" alt="${escHtml(item.fileName)}" loading="eager">
  </div>
  <div class="caption-block">
    <div><span class="cap-label">PHOTO:</span> ${escHtml(cap.photo)}</div>
    <div><span class="cap-label">DATE:</span> ${escHtml(cap.date)}</div>
    ${cap.altitude ? `<div><span class="cap-label">ALTITUDE:</span> ${escHtml(cap.altitude)}</div>` : ''}
    ${cap.comment  ? `<div><span class="cap-label">COMMENT:</span> ${escHtml(cap.comment)}</div>`  : ''}
  </div>
  <div class="report-title">
    ${hasTitle
      ? `<h1 class="report-h1">${titleSafe}</h1>
         <div class="gradient-rule"></div>
         <h2 class="report-h2">${subtitleSafe}</h2>`
      : `<div class="gradient-rule"></div>
         <h2 class="report-h2">${subtitleSafe || 'Photo Log'}</h2>`
    }
  </div>
  <div class="map frame" id="${escHtml(item.id)}-map"></div>
</section>`;
  }).join('\n');

  const boundaryJson = boundary ? safeJson(boundary) : 'null';
  const photoJson    = safeJson(photoData);
  const northJson    = safeJson(northSvg);
  const photoSvgJson = safeJson(photoSvg);
  const zoomVal      = parseInt(settings.mapZoom, 10) || 16;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titleSafe || 'Photo Log'}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap');
@page { size: Letter landscape; margin: 0.35in; }
*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  background: #fff;
  color: #111;
  font-family: 'Inter', Arial, Helvetica, sans-serif;
}

.photo-page {
  width: 10.3in;
  height: 7.75in;
  page-break-after: always;
  break-after: page;
  display: grid;
  grid-template-columns: 5.92in 3.9in;
  grid-template-rows: 4.3in 0.4in 2.55in;
  gap: 0.16in 0.22in;
  padding: 0.08in;
  overflow: hidden;
  position: relative;
}

.frame {
  border: 1.5px solid #222;
  background: #e5e7eb;
  overflow: hidden;
}

.main-photo {
  grid-column: 1;
  grid-row: 1;
}
.main-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.caption-block {
  grid-column: 1;
  grid-row: 2;
  align-self: start;
  font-size: 9.5pt;
  line-height: 1.35;
  font-weight: 600;
  padding-top: 0.04in;
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.25in;
}
.caption-block div { white-space: nowrap; }
.cap-label { font-weight: 800; }

.report-title {
  grid-column: 1;
  grid-row: 3;
  align-self: end;
  padding-bottom: 0.04in;
}
.report-h1 {
  margin: 0;
  color: #BF9555;
  font-size: 20pt;
  line-height: 1.1;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: -0.01em;
}
.gradient-rule {
  width: 3.5in;
  height: 2.5px;
  margin: 0.07in 0 0.06in;
  background: linear-gradient(90deg, #5E9B72, #5E8B8A, #7E6D94, #947068, #BF9555);
}
.report-h2 {
  margin: 0;
  color: #1E2430;
  font-size: 13pt;
  line-height: 1.1;
  font-weight: 700;
  text-transform: uppercase;
}

.map {
  grid-column: 2;
  grid-row: 1 / span 3;
  width: 100%;
  height: 100%;
}

.leaflet-control-attribution { font-size: 6px !important; }

.photo-arrow {
  width: 28px;
  height: 34px;
  transform-origin: 50% 50%;
  filter: drop-shadow(0 0 2px #fff) drop-shadow(0 1px 2px rgba(0,0,0,0.6));
}
.photo-arrow svg { width: 100%; height: 100%; display: block; }

.north-arrow-ctrl {
  width: 40px;
  height: 62px;
  padding: 3px;
  background: rgba(255,255,255,0.78);
  border-radius: 2px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.35);
}
.north-arrow-ctrl svg { width: 100%; height: 100%; display: block; }

@media screen {
  body { background: #94a3b8; }
  .photo-page {
    margin: 24px auto;
    background: #fff;
    box-shadow: 0 8px 32px rgba(0,0,0,0.22);
  }
}
</style>
</head>
<body>
${pages}
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<script>
(function() {
  'use strict';
  var photoData    = ${photoJson};
  var northSvg     = ${northJson};
  var photoSvgStr  = ${photoSvgJson};
  var mapZoom      = ${zoomVal};
  var boundaryData = ${boundaryJson};

  function imageryLayer() {
    return L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community', maxZoom: 20 }
    );
  }

  function arrowIcon(yaw) {
    return L.divIcon({
      className: '',
      iconSize:   [28, 34],
      iconAnchor: [14, 17],
      html: '<div class="photo-arrow" style="transform:rotate(' + yaw + 'deg)">' + photoSvgStr + '<\/div>'
    });
  }

  function initMap(elId, item) {
    var mapEl = document.getElementById(elId);
    if (!mapEl) return;
    var map = L.map(elId, {
      zoomControl:      false,
      attributionControl: true,
      dragging:         false,
      scrollWheelZoom:  false,
      doubleClickZoom:  false,
      boxZoom:          false,
      keyboard:         false,
      tap:              false
    }).setView([item.lat, item.lon], mapZoom);

    imageryLayer().addTo(map);

    L.marker([item.lat, item.lon], { icon: arrowIcon(item.yaw) }).addTo(map);

    if (boundaryData) {
      try {
        L.geoJSON(boundaryData, {
          style: { color: '#ffff00', weight: 2, fillOpacity: 0.05 }
        }).addTo(map);
      } catch (e) { console.warn('boundary layer error', e); }
    }

    var northCtrl = L.control({ position: 'topright' });
    northCtrl.onAdd = function() {
      var div = L.DomUtil.create('div', 'north-arrow-ctrl');
      div.innerHTML = northSvg;
      return div;
    };
    northCtrl.addTo(map);

    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

    setTimeout(function() { map.invalidateSize(); }, 100);
    setTimeout(function() { map.invalidateSize(); }, 600);
  }

  function initAll() {
    photoData.forEach(function(item) {
      initMap(item.id + '-map', item);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
<\/script>
</body>
</html>`;
}
