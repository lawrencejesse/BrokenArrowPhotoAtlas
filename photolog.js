/* ============================================================
   Photo Log Atlas Builder — Photo Log Generator
   Broken Arrow Consulting
   Builds a two-up printable photo log — no GPS required.
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
  gap: 0.1in;
  overflow: hidden;
}

.pl-header { flex-shrink: 0; }

.pl-title {
  font-size: 17pt;
  font-weight: 800;
  color: #BF9555;
  text-transform: uppercase;
  letter-spacing: -0.01em;
  margin: 0;
  line-height: 1.1;
}

.pl-gradient-rule {
  width: 100%;
  height: 2.5px;
  background: linear-gradient(90deg, #5E9B72, #5E8B8A, #7E6D94, #947068, #BF9555);
  margin: 0.06in 0 0.05in;
}

.pl-header-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.2in;
}

.pl-subtitle {
  font-size: 10pt;
  font-weight: 600;
  color: #333;
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.pl-meta {
  font-size: 8.5pt;
  font-weight: 500;
  color: #666;
  margin: 0;
  white-space: nowrap;
}

.pl-content {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 0.18in;
  overflow: hidden;
  min-height: 0;
}

.pl-photo-block {
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
  padding: 0.05in 0.02in 0.03in;
  border-top: 1.5px solid #ddd;
}

.pl-cap-label {
  font-weight: 800;
  color: #BF9555;
}

.pl-footer {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid #e0e0e0;
  padding-top: 0.05in;
  font-size: 7.5pt;
  color: #888;
}

.pl-footer-credit {
  font-size: 6.5pt;
  color: #bbb;
}

.pl-logo {
  max-height: 28pt;
  max-width: 120pt;
  object-fit: contain;
  display: block;
  margin-bottom: 0.05in;
}

.pl-company {
  font-size: 8pt;
  font-weight: 600;
  color: #555;
  margin: 0.03in 0 0;
}

@media screen {
  body { background: #94a3b8; }
  .pl-page {
    margin: 24px auto;
    background: #fff;
    box-shadow: 0 8px 32px rgba(0,0,0,0.22);
  }
}`;

/* ---- Build one photo log page (pair of photos) ----------- */

function buildPhotoLogPage(pair, pageNum, totalPages, titleSafe, subtitleSafe, metaSafe, branding, watermark) {
  const [a, b] = pair;
  const br = branding || {};
  const logoHtml    = br.logoDataUrl
    ? `<img class="pl-logo" src="${escHtml(br.logoDataUrl)}" alt="Logo">`
    : '';
  const companyHtml = (br.companyName || br.projectName)
    ? `<p class="pl-company">${escHtml(br.companyName || '')}${br.companyName && br.projectName ? '\u2014' : ''}${escHtml(br.projectName || '')}</p>`
    : '';
  const creditHtml  = br.showFooter
    ? `<span class="pl-footer-credit">Created with Broken Arrow Photo Atlas</span>`
    : '';

  function captionHtml(item) {
    const c = item.caption;
    const numPart  = `<span class="pl-cap-label">PHOTO:</span> ${escHtml(c.photo)}`;
    const datePart = c.date     ? `&nbsp;&nbsp;<span class="pl-cap-label">DATE:</span> ${escHtml(c.date)}`     : '';
    const altPart  = c.altitude ? `&nbsp;&nbsp;<span class="pl-cap-label">ALT:</span> ${escHtml(c.altitude)}`  : '';
    const notePart = c.comment  ? `<br><span class="pl-cap-label">NOTE:</span> ${escHtml(c.comment)}` : '';
    return `<div class="pl-caption"><div>${numPart}${datePart}${altPart}</div>${notePart ? `<div>${notePart}</div>` : ''}</div>`;
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
    ${logoHtml}
    <h1 class="pl-title">${titleSafe}</h1>
    <div class="pl-gradient-rule"></div>
    <div class="pl-header-row">
      ${subtitleSafe ? `<p class="pl-subtitle">${subtitleSafe}</p>` : ''}
      ${metaSafe ? `<p class="pl-meta">${metaSafe}</p>` : ''}
    </div>
    ${companyHtml}
  </div>
  <div class="pl-content">
    ${blockHtml(a, false)}
    ${b ? blockHtml(b, false) : blockHtml(null, true)}
  </div>
  <div class="pl-footer">
    <span>${titleSafe}</span>
    ${creditHtml}
    <span>Page ${pageNum} of ${totalPages}</span>
  </div>
  ${wmHtml}
</section>`;
}

/* ---- Render full photo log HTML document ----------------- */

function renderPhotoLogHtml(photoData, settings, watermark) {
  if (watermark === undefined) watermark = true;
  const titleSafe    = escHtml(settings.title    || 'Photo Log');
  const subtitleSafe = escHtml(settings.subtitle || '');

  /* Compute date range from non-empty date strings */
  const dates = photoData.map(p => p.caption.date).filter(Boolean);
  let dateRangeSafe = '';
  if (dates.length === 1) {
    dateRangeSafe = escHtml(dates[0]);
  } else if (dates.length > 1) {
    dateRangeSafe = escHtml(`${dates[0]} \u2013 ${dates[dates.length - 1]}`);
  }

  const countPart = `${photoData.length} photo${photoData.length !== 1 ? 's' : ''}`;
  const metaSafe  = escHtml(countPart) + (dateRangeSafe ? ` &nbsp;|&nbsp; ${dateRangeSafe}` : '');

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
    projectName: settings.projectName || '',
    logoDataUrl: settings.logoDataUrl || '',
    accentColor,
    showFooter:  !!settings.showFooter
  };

  const pagesHtml = pairs.map((pair, idx) =>
    buildPhotoLogPage(pair, idx + 1, totalPages, titleSafe, subtitleSafe, metaSafe, branding, watermark)
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
