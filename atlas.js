/* ============================================================
   Photo Log Atlas Builder — Atlas Generator
   Broken Arrow Consulting
   Builds a printable landscape HTML atlas from photos[].
   ============================================================ */

'use strict';

/* ---- Helper: blob URL → Base64 data URL ------------------ */

const OUTPUT_IMAGE_MAX_DIMENSION = 2200;
const OUTPUT_IMAGE_QUALITY = 0.84;

function imageBlobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function toDataUrl(blobUrl) {
  try {
    const res = await fetch(blobUrl);
    const blob = await res.blob();
    const tempUrl = URL.createObjectURL(blob);
    try {
      const img = await loadImage(tempUrl);
      const maxSide = Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
      const scale = Math.min(1, OUTPUT_IMAGE_MAX_DIMENSION / maxSide);
      if (scale >= 1) return await imageBlobToDataUrl(blob);

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', OUTPUT_IMAGE_QUALITY);
    } finally {
      URL.revokeObjectURL(tempUrl);
    }
  } catch (e) {
    console.warn('Could not encode photo as data URL, falling back to blob URL:', blobUrl, e);
    return blobUrl;
  }
}

async function photosToDataUrls(included) {
  const dataUrls = [];
  for (const photo of included) {
    dataUrls.push(await toDataUrl(photo.objectUrl));
  }
  return dataUrls;
}

/* ---- Public entry point ---------------------------------- */

async function buildAtlas(included, settings, boundary, watermark) {
  if (watermark === undefined) watermark = true;
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

  const dataUrls = await photosToDataUrls(included);

  const photoData = included.map((p, i) => {
    const labelVal = p[settings.labelField] ?? p.photoNumber;
    const altStr = settings.showAltitude !== false && p.relativeAltitude != null
      ? `${parseFloat(p.relativeAltitude).toFixed(0)} m`
      : '';
    return {
      id:    `photo-${i + 1}`,
      lat:   p.latitude,
      lon:   p.longitude,
      yaw:   p.bearingDegree ?? p.flightYawDegree ?? p.gimbalYawDegree ?? 0,
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

  window._lastAtlasArgs    = { photoData, northSvg, photoSvg, settings, boundary };
  window._lastPhotoLogArgs = null;

  const htmlStr = renderAtlasHtml(photoData, northSvg, photoSvg, settings, boundary, watermark);

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

function buildDownloadHtml(clean) {
  if (!atlasHtmlContent) return null;
  if (clean) {
    if (window._lastAtlasArgs) {
      const a = window._lastAtlasArgs;
      return renderAtlasHtml(a.photoData, a.northSvg, a.photoSvg, a.settings, a.boundary, false);
    } else if (window._lastPhotoLogArgs) {
      const p = window._lastPhotoLogArgs;
      return renderPhotoLogHtml(p.photoData, p.settings, false);
    }
  }
  return atlasHtmlContent;
}

function triggerHtmlDownload(html, filename) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function trackHtmlDownload(clean, automatic) {
  const args = window._lastAtlasArgs || window._lastPhotoLogArgs;
  const photoCount = args?.photoData?.length || 0;
  window.baAnalytics?.track('printable_html_downloaded', {
    output_mode: window._lastAtlasArgs ? 'atlas' : 'photo_log',
    export_type: clean ? 'clean' : 'watermarked',
    download_method: automatic ? 'automatic' : 'manual',
    photo_count_bucket: window.baAnalytics.photoCountBucket(photoCount)
  });
}

/* Called automatically after payment is confirmed.
   Returns true if a file was downloaded, false if there was nothing to render. */
window.autoDownloadCleanExport = function() {
  const html = buildDownloadHtml(true);
  if (!html) return false;
  const dlBtn   = document.getElementById('download-atlas-html');
  const filename = (dlBtn && dlBtn.dataset.filename) || 'photo_atlas.html';
  triggerHtmlDownload(html, filename);
  trackHtmlDownload(true, true);
  return true;
};

if (window.pendingCleanExportDownload) {
  window.pendingCleanExportDownload = false;
  window.autoDownloadCleanExport();
}

(function wireDownloadBtn() {
  const dlBtn = document.getElementById('download-atlas-html');
  if (!dlBtn) return;
  dlBtn.addEventListener('click', () => {
    const html = buildDownloadHtml(window.paidExportUnlocked);
    if (!html) return;
    triggerHtmlDownload(html, dlBtn.dataset.filename || 'photo_atlas.html');
    trackHtmlDownload(window.paidExportUnlocked, false);
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

.report-logo {
  max-height: 26pt;
  max-width: 110pt;
  object-fit: contain;
  display: block;
  margin-bottom: 0.05in;
}

.portrait-logo {
  max-height: 16pt;
  max-width: 70pt;
  display: inline-block;
  vertical-align: middle;
  margin-right: 0.08in;
  margin-bottom: 0;
}

.report-company {
  font-size: 8pt;
  font-weight: 600;
  color: #555;
  margin-top: 0.04in;
  text-transform: none;
  letter-spacing: 0;
  display: block;
}

.page-footer {
  font-size: 6.5pt;
  color: #bbb;
  margin-top: 0.06in;
  font-weight: 400;
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
  line-height: 1.4;
  font-weight: 600;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 0.28in;
  padding-top: 0.1in;
}
.caption-block div { white-space: nowrap; }
.caption-block .cap-comment {
  flex-basis: 100%;
  white-space: normal;
  word-break: break-word;
  margin-top: 0.02in;
}

.report-title {
  grid-column: 1;
  grid-row: 3;
  align-self: end;
  padding-bottom: 0.05in;
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.1in;
}

.report-title-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.landscape-logo {
  max-height: 32pt;
  max-width: 100pt;
  object-fit: contain;
  flex-shrink: 0;
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
  flex-wrap: wrap;
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
.caption-row .cap-comment {
  flex-basis: 100%;
  white-space: normal;
  word-break: break-word;
  margin-top: 0.03in;
  font-weight: 500;
}

.gradient-rule { width: 100%; height: 2.5px; margin: 0; }

.title-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 0.1in;
}

.title-row-text {
  display: flex;
  flex-direction: column;
  gap: 0.03in;
  flex: 1;
  min-width: 0;
}

.portrait-logo {
  max-height: 32pt;
  max-width: 100pt;
  object-fit: contain;
  flex-shrink: 0;
}

.report-h1 { font-size: 14pt; margin: 0; }
.report-h2 { font-size: 11pt; margin: 0; font-weight: 600; color: #444; text-transform: none; letter-spacing: 0; }`;

/* ---- Watermark ------------------------------------------- */

const WATERMARK_CSS = `
.photo-page { position: relative; }
.pl-page    { position: relative; }
.watermark  {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 9999;
  overflow: hidden;
}
.watermark-text {
  display: block;
  font-size: 54pt;
  font-weight: 900;
  color: rgba(191, 149, 85, 0.32);
  transform: rotate(-35deg);
  white-space: nowrap;
  user-select: none;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-family: 'Inter', Arial, Helvetica, sans-serif;
}`;

const WATERMARK_HTML = '<div class="watermark" aria-hidden="true"><span class="watermark-text">PREVIEW \u2014 Broken Arrow Photo Atlas</span></div>';

/* Build one landscape page */
function buildLandscapePage(item, titleSafe, subtitleSafe, hasTitle, branding, watermark) {
  const cap = item.caption;
  const br  = branding || {};
  const logoHtml    = br.logoDataUrl
    ? `<img class="report-logo" src="${escHtml(br.logoDataUrl)}" alt="Logo">`
    : '';
  const companyHtml = (br.companyName || br.projectName)
    ? `<div class="report-company">${escHtml(br.companyName || '')}${br.companyName && br.projectName ? '&nbsp;\u2014&nbsp;' : ''}${escHtml(br.projectName || '')}</div>`
    : '';
  const footerHtml  = br.showFooter
    ? `<div class="page-footer">Created with Broken Arrow Photo Atlas</div>`
    : '';

  const landscapeLogoHtml = br.logoDataUrl
    ? `<img class="landscape-logo" src="${escHtml(br.logoDataUrl)}" alt="Logo">`
    : '';
  const titleBlock = hasTitle
    ? `<div class="report-title-text"><h1 class="report-h1">${titleSafe}</h1>
       <div class="gradient-rule"></div>
       <h2 class="report-h2">${subtitleSafe}</h2>${footerHtml}</div>${landscapeLogoHtml}`
    : `<div class="report-title-text"><div class="gradient-rule"></div>
       <h2 class="report-h2">${subtitleSafe || 'Photo Log'}</h2>${footerHtml}</div>${landscapeLogoHtml}`;
  const wmHtml = watermark ? WATERMARK_HTML : '';
  return `
<section class="photo-page">
  <div class="main-photo frame">
    <img src="${escHtml(item.src)}" alt="${escHtml(item.fileName)}" loading="eager">
  </div>
  <div class="caption-block">
    <div><span class="cap-label">PHOTO:</span> ${escHtml(cap.photo)}</div>
    <div><span class="cap-label">DATE:</span> ${escHtml(cap.date)}</div>
    ${cap.altitude ? `<div><span class="cap-label">ALTITUDE:</span> ${escHtml(cap.altitude)}</div>` : ''}
    ${cap.comment  ? `<div class="cap-comment"><span class="cap-label">COMMENT:</span> ${escHtml(cap.comment)}</div>`  : ''}
  </div>
  <div class="report-title">${titleBlock}</div>
  <div class="map frame" id="${escHtml(item.id)}-map"></div>
  ${wmHtml}
</section>`;
}

/* Build one portrait page */
function buildPortraitPage(item, titleSafe, subtitleSafe, hasTitle, branding, watermark) {
  const cap = item.caption;
  const br  = branding || {};
  const logoHtml    = br.logoDataUrl
    ? `<img class="report-logo portrait-logo" src="${escHtml(br.logoDataUrl)}" alt="Logo">`
    : '';
  const companyHtml = (br.companyName || br.projectName)
    ? `<span class="report-company">${escHtml(br.companyName || '')}${br.companyName && br.projectName ? '\u2014' : ''}${escHtml(br.projectName || '')}</span>`
    : '';
  const footerHtml  = br.showFooter
    ? `<div class="page-footer">Created with Broken Arrow Photo Atlas</div>`
    : '';

  const altSep = cap.altitude ? `<span class="cap-sep">|</span><div class="cap-item"><span class="cap-label">ALTITUDE:</span> ${escHtml(cap.altitude)}</div>` : '';
  const comSep = cap.comment  ? `<div class="cap-comment"><span class="cap-label">COMMENT:</span> ${escHtml(cap.comment)}</div>` : '';
  const wmHtml2 = watermark ? WATERMARK_HTML : '';
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
      <div class="title-row-text">
        <h1 class="report-h1">${titleSafe}</h1>
        ${subtitleSafe ? `<h2 class="report-h2">${subtitleSafe}</h2>` : ''}
      </div>
      ${logoHtml}
    </div>
    ${footerHtml}
  </div>
  ${wmHtml2}
</section>`;
}

function renderAtlasHtml(photoData, northSvg, photoSvg, settings, boundary, watermark) {
  if (watermark === undefined) watermark = true;
  const titleSafe    = escHtml(settings.title    || '');
  const subtitleSafe = escHtml(settings.subtitle || '');
  const hasTitle     = titleSafe.length > 0;
  const isPortrait   = settings.layout === 'portrait';

  const accentColor = (settings.accentColor && /^#[0-9A-Fa-f]{6}$/.test(settings.accentColor))
    ? settings.accentColor : '#BF9555';
  const layoutCss    = isPortrait ? PORTRAIT_CSS : LANDSCAPE_CSS;
  const brandedCss   = (SHARED_CSS + layoutCss).replaceAll('#BF9555', accentColor)
    + (watermark ? WATERMARK_CSS : '');

  const branding = {
    companyName: settings.companyName || '',
    projectName: settings.projectName || '',
    logoDataUrl: settings.logoDataUrl || '',
    accentColor,
    showFooter:  !!settings.showFooter
  };

  const buildPage = isPortrait ? buildPortraitPage : buildLandscapePage;

  const pages = photoData.map(item =>
    buildPage(item, titleSafe, subtitleSafe, hasTitle, branding, watermark)
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
<style>${brandedCss}
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
