/* ============================================================
   Photo Log Atlas Builder — Photo Log Generator
   Broken Arrow Consulting
   Builds a single-column printable photo log — no GPS required.
   Relies on globals from atlas.js: toDataUrl, storeAtlasDownload, escHtml
   ============================================================ */

'use strict';

const PHOTO_LOG_CSS = `
@page { size: Letter portrait; margin: 0.4in; }

body {
  margin: 0;
  background: #fff;
  color: #111;
  font-family: 'Inter', Arial, Helvetica, sans-serif;
}

*, *::before, *::after { box-sizing: border-box; }

.pl-page {
  width: 7.7in;
  height: 10.2in;
  page-break-after: always;
  break-after: page;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ---- Header ---------------------------------------------- */

.pl-header {
  flex-shrink: 0;
  margin-bottom: 0.12in;
  padding: 0.2in 0.4in 0;
}

.pl-header-fields {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 0.15in;
}

.pl-header-field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.02in;
}

.pl-header-field.center {
  align-items: center;
  text-align: center;
}

.pl-header-field.right {
  align-items: flex-end;
  text-align: right;
}

.pl-field-label {
  font-size: 7pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #BF9555;
  margin: 0;
  line-height: 1;
}

.pl-field-value {
  font-size: 11pt;
  font-weight: 700;
  color: #111;
  margin: 0;
  line-height: 1.2;
}

.pl-field-value.empty {
  color: #bbb;
  font-weight: 400;
  font-size: 9pt;
}

/* ---- Content (stacked photos) ---------------------------- */

.pl-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.15in;
  overflow: hidden;
  min-height: 0;
  padding: 0 0.4in;
}

.pl-photo-block {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.pl-photo-block.empty { visibility: hidden; }

.pl-photo {
  flex: 1;
  border: 1.5px solid #222;
  background: #e5e7eb;
  overflow: hidden;
  min-height: 0;
}

.pl-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.pl-caption {
  flex-shrink: 0;
  font-size: 8.5pt;
  font-weight: 500;
  line-height: 1.55;
  padding: 0.05in 0.04in 0.04in;
  border-top: 1.5px solid #ddd;
}

.pl-cap-label {
  font-weight: 800;
  color: #BF9555;
}

/* ---- Footer ---------------------------------------------- */

.pl-footer {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  border-top: 1px solid #e0e0e0;
  margin-top: 0.08in;
  padding: 0.05in 0.4in 0.2in;
}

.pl-footer-brand {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.02in;
}

.pl-logo {
  max-height: 26pt;
  max-width: 110pt;
  object-fit: contain;
  display: block;
}

.pl-company {
  font-size: 8pt;
  font-weight: 600;
  color: #555;
  margin: 0;
}

.pl-footer-page {
  font-size: 8pt;
  font-weight: 500;
  color: #888;
  text-align: right;
  white-space: nowrap;
}

@media screen {
  body { background: #94a3b8; }
  .pl-page {
    margin: 24px auto;
    background: #fff;
    box-shadow: 0 8px 32px rgba(0,0,0,0.22);
  }
}`;

/* ---- Build one photo log page (pair of photos, stacked) -- */

function buildPhotoLogPage(pair, pageNum, totalPages, branding, headerFields, watermark) {
  const [a, b] = pair;
  const br = branding || {};

  const logoHtml = br.logoDataUrl
    ? `<img class="pl-logo" src="${escHtml(br.logoDataUrl)}" alt="Logo">`
    : '';
  const companyHtml = br.companyName
    ? `<p class="pl-company">${escHtml(br.companyName)}</p>`
    : '';

  function fieldHtml(label, value, alignClass) {
    const cls = alignClass ? ` ${alignClass}` : '';
    const valCls = value ? '' : ' empty';
    const display = value || '—';
    return `<div class="pl-header-field${cls}">
  <p class="pl-field-label">${escHtml(label)}</p>
  <p class="pl-field-value${valCls}">${escHtml(display)}</p>
</div>`;
  }

  function captionHtml(item) {
    const c = item.caption;
    const numPart  = `<span class="pl-cap-label">PHOTO:</span> ${escHtml(c.photo)}`;
    const altPart  = c.altitude ? `&nbsp;&nbsp;<span class="pl-cap-label">ALT:</span> ${escHtml(c.altitude)}` : '';
    const notePart = c.comment  ? `<br>${escHtml(c.comment)}` : '';
    return `<div class="pl-caption"><div>${numPart}${altPart}</div>${notePart ? `<div>${notePart}</div>` : ''}</div>`;
  }

  function blockHtml(item, isEmpty) {
    if (isEmpty) return `<div class="pl-photo-block empty"><div class="pl-photo"></div></div>`;
    return `
<div class="pl-photo-block">
  <div class="pl-photo">
    <img src="${escHtml(item.src)}" alt="${escHtml(item.fileName)}" loading="eager">
  </div>
  ${captionHtml(item)}
</div>`;
  }

  const wmHtml = (typeof WATERMARK_HTML !== 'undefined' && watermark) ? WATERMARK_HTML : '';

  return `
<section class="pl-page">
  <div class="pl-header">
    <div class="pl-header-fields">
      ${fieldHtml('Client', headerFields.client, '')}
      ${fieldHtml('Location', headerFields.location, 'center')}
      ${fieldHtml('Date', headerFields.date, 'right')}
    </div>
  </div>
  <div class="pl-content">
    ${blockHtml(a, false)}
    ${b ? blockHtml(b, false) : blockHtml(null, true)}
  </div>
  <div class="pl-footer">
    <div class="pl-footer-brand">
      ${logoHtml}
      ${companyHtml}
    </div>
    <div class="pl-footer-page">Page ${pageNum} of ${totalPages}</div>
  </div>
  ${wmHtml}
</section>`;
}

/* ---- Render full photo log HTML document ----------------- */

function renderPhotoLogHtml(photoData, settings, watermark) {
  if (watermark === undefined) watermark = true;

  /* Compute date range from non-empty date strings */
  const dates = photoData.map(p => p.caption.date).filter(Boolean);
  let dateRange = '';
  if (dates.length === 1) {
    dateRange = dates[0];
  } else if (dates.length > 1) {
    dateRange = `${dates[0]} \u2013 ${dates[dates.length - 1]}`;
  }

  const headerFields = {
    client:   settings.companyName || '',
    location: settings.title       || '',
    date:     dateRange
  };

  const pairs = [];
  for (let i = 0; i < photoData.length; i += 2) {
    pairs.push([photoData[i], photoData[i + 1] || null]);
  }
  const totalPages = pairs.length;

  const accentColor = (settings.accentColor && /^#[0-9A-Fa-f]{6}$/.test(settings.accentColor))
    ? settings.accentColor : '#BF9555';
  const brandedCss = PHOTO_LOG_CSS.replaceAll('#BF9555', accentColor)
    + (watermark && typeof WATERMARK_CSS !== 'undefined' ? WATERMARK_CSS : '');

  const branding = {
    companyName: settings.companyName || '',
    logoDataUrl: settings.logoDataUrl || '',
    accentColor
  };

  const titleSafe = escHtml(settings.subtitle || settings.title || 'Photo Log');

  const pagesHtml = pairs.map((pair, idx) =>
    buildPhotoLogPage(pair, idx + 1, totalPages, branding, headerFields, watermark)
  ).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titleSafe}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${brandedCss}</style>
</head>
<body>
${pagesHtml}
</body>
</html>`;
}

/* ---- Public entry point ---------------------------------- */

async function buildPhotoLog(included, settings, watermark) {
  if (watermark === undefined) watermark = true;
  const dataUrls = await Promise.all(included.map(p => toDataUrl(p.objectUrl)));

  const photoData = included.map((p, i) => {
    const labelVal = p[settings.labelField] ?? p.photoNumber;
    const altStr   = p.relativeAltitude != null
      ? `${parseFloat(p.relativeAltitude).toFixed(0)} m`
      : '';
    return {
      id:       `photo-${i + 1}`,
      src:      dataUrls[i],
      fileName: p.fileName,
      caption: {
        photo:    String(labelVal ?? ''),
        date:     p.date    ?? '',
        altitude: altStr,
        comment:  p.comment ?? ''
      }
    };
  });

  window._lastPhotoLogArgs = { photoData, settings };
  window._lastAtlasArgs    = null;

  const htmlStr = renderPhotoLogHtml(photoData, settings, watermark);
  const blob    = new Blob([htmlStr], { type: 'text/html;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);

  const newTab = window.open(blobUrl, '_blank');
  if (!newTab) {
    console.warn('window.open was blocked — user must allow popups for this site.');
  }

  storeAtlasDownload(htmlStr, settings.title || 'photo_log');
}
