/* ============================================================
   Photo Log Atlas Builder — Atlas Generator
   Broken Arrow Consulting
   Builds a printable landscape HTML atlas from photos[].
   ============================================================ */

'use strict';

/* ---- Helper: blob URL → Base64 data URL ------------------ */

async function toDataUrl(blobUrl) {
  try {
    const res  = await fetch(blobUrl);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn('Could not encode photo as data URL, falling back to blob URL:', blobUrl, e);
    return blobUrl;
  }
}

/* ---- Public entry point ---------------------------------- */

async function buildAtlas(included, settings, boundary) {
  let northSvg = '';
  let photoSvg = '';

  try {
    const [nRes, pRes] = await Promise.all([
      fetch('replit_handoff/assets/NorthArrow_02.svg'),
      fetch('replit_handoff/assets/NorthArrow_11.svg')
    ]);
    if (!nRes.ok || !pRes.ok) throw new Error('SVG asset fetch failed');
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

  const dataUrls = await Promise.all(included.map(p => toDataUrl(p.objectUrl)));

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
      src:   dataUrls[i],
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

/* Shared CSS: arrows, frame, fonts, screen preview */
const SHARED_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  background: #fff;
  color: #111;
  font-family: 'Inter', Arial, Helvetica, sans-serif;
}

.frame {
  border: 1.5px solid #222;
  background: #e5e7eb;
  overflow: hidden;
}

.main-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cap-label { font-weight: 800; }

.report-h1 {
  margin: 0;
  color: #BF9555;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: -0.01em;
  line-height: 1.1;
}

.report-h2 {
  margin: 0;
  color: #1E2430;
  font-weight: 700;
  text-transform: uppercase;
  line-height: 1.15;
}

.gradient-rule {
  height: 2.5px;
  background: linear-gradient(90deg, #5E9B72, #5E8B8A, #7E6D94, #947068, #BF9555);
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
}`;

/* Landscape layout CSS */
const LANDSCAPE_CSS = `
@page { size: Letter landscape; margin: 0.35in; }

.photo-page {
  width: 10.3in;
  height: 7.75in;
  page-break-after: always;
  break-after: page;
  display: grid;
  grid-template-columns: 5.92in 3.9in;
  grid-template-rows: 4.3in 0.42in 2.68in;
  gap: 0.14in 0.22in;
  padding: 0.06in;
  overflow: hidden;
}

.main-photo { grid-column: 1; grid-row: 1; }

.caption-block {
  grid-column: 1;
  grid-row: 2;
  align-self: center;
  font-size: 9.5pt;
  line-height: 1.3;
  font-weight: 600;
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.28in;
}
.caption-block div { white-space: nowrap; }

.report-title {
  grid-column: 1;
  grid-row: 3;
  align-self: end;
  padding-bottom: 0.05in;
}
.report-h1 { font-size: 19pt; }
.gradient-rule { width: 3.5in; margin: 0.07in 0 0.06in; }
.report-h2 { font-size: 12.5pt; }

.map { grid-column: 2; grid-row: 1 / span 3; width: 100%; height: 100%; }`;

/* Portrait layout CSS */
const PORTRAIT_CSS = `
@page { size: Letter portrait; margin: 0.35in; }

.photo-page {
  width: 7.8in;
  height: 10.3in;
  page-break-after: always;
  break-after: page;
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: 4fr 3fr 1fr;
  gap: 0.09in 0;
  padding: 0.04in;
  overflow: hidden;
}

.main-photo { grid-column: 1; grid-row: 1; }

.map { grid-column: 1; grid-row: 2; width: 100%; height: 100%; }

.bottom-strip {
  grid-column: 1;
  grid-row: 3;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.04in;
  overflow: hidden;
}

.caption-row {
  display: flex;
  align-items: center;
  gap: 0;
  font-size: 9pt;
  font-weight: 600;
  color: #111;
}

.caption-row .cap-item { white-space: nowrap; }
.caption-row .cap-sep {
  padding: 0 0.14in;
  color: #aaa;
  font-weight: 300;
}
.caption-row .cap-label { color: #BF9555; font-weight: 800; }

.gradient-rule { width: 100%; height: 2.5px; margin: 0; }

.title-row {
  display: flex;
  align-items: baseline;
  gap: 0.2in;
}

.report-h1 { font-size: 14pt; margin: 0; }
.report-h2 { font-size: 11pt; margin: 0; font-weight: 600; color: #444; text-transform: none; letter-spacing: 0; }`;

/* Build one landscape page */
function buildLandscapePage(item, titleSafe, subtitleSafe, hasTitle) {
  const cap = item.caption;
  const titleBlock = hasTitle
    ? `<h1 class="report-h1">${titleSafe}</h1>
       <div class="gradient-rule"></div>
       <h2 class="report-h2">${subtitleSafe}</h2>`
    : `<div class="gradient-rule"></div>
       <h2 class="report-h2">${subtitleSafe || 'Photo Log'}</h2>`;
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
  <div class="report-title">${titleBlock}</div>
  <div class="map frame" id="${escHtml(item.id)}-map"></div>
</section>`;
}

/* Build one portrait page */
function buildPortraitPage(item, titleSafe, subtitleSafe) {
  const cap = item.caption;
  const altSep = cap.altitude ? `<span class="cap-sep">|</span><div class="cap-item"><span class="cap-label">ALTITUDE:</span> ${escHtml(cap.altitude)}</div>` : '';
  const comSep = cap.comment  ? `<span class="cap-sep">|</span><div class="cap-item"><span class="cap-label">COMMENT:</span> ${escHtml(cap.comment)}</div>`  : '';
  return `
<section class="photo-page">
  <div class="main-photo frame">
    <img src="${escHtml(item.src)}" alt="${escHtml(item.fileName)}" loading="eager">
  </div>
  <div class="map frame" id="${escHtml(item.id)}-map"></div>
  <div class="bottom-strip">
    <div class="caption-row">
      <div class="cap-item"><span class="cap-label">PHOTO:</span> ${escHtml(cap.photo)}</div>
      <span class="cap-sep">|</span>
      <div class="cap-item"><span class="cap-label">DATE:</span> ${escHtml(cap.date)}</div>
      ${altSep}${comSep}
    </div>
    <div class="gradient-rule"></div>
    <div class="title-row">
      <h1 class="report-h1">${titleSafe}</h1>
      ${subtitleSafe ? `<h2 class="report-h2">${subtitleSafe}</h2>` : ''}
    </div>
  </div>
</section>`;
}

function renderAtlasHtml(photoData, northSvg, photoSvg, settings, boundary) {
  const titleSafe    = escHtml(settings.title    || '');
  const subtitleSafe = escHtml(settings.subtitle || '');
  const hasTitle     = titleSafe.length > 0;
  const isPortrait   = settings.layout === 'portrait';

  const layoutCss = isPortrait ? PORTRAIT_CSS : LANDSCAPE_CSS;
  const buildPage = isPortrait ? buildPortraitPage : buildLandscapePage;

  const pages = photoData.map(item =>
    buildPage(item, titleSafe, subtitleSafe, hasTitle)
  ).join('\n');

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
<style>${SHARED_CSS}${layoutCss}
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

    setTimeout(function() { map.invalidateSize(); }, 150);
    setTimeout(function() { map.invalidateSize(); }, 700);
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
