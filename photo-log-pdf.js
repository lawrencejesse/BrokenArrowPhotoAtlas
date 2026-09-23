/* Direct, browser-local PDF export for the two-photo log. */
'use strict';

const PDF_PAGE = { width: 612, height: 792, margin: 38 };

function pdfLibrary() {
  if (typeof window !== 'undefined' && window.PDFLib) return window.PDFLib;
  if (typeof require === 'function') return require('pdf-lib');
  throw new Error('PDF library did not load. Refresh the page and try again.');
}

function printableText(value, font, replaced) {
  let output = '';
  for (const char of String(value ?? '')) {
    if (char === '\r') continue;
    if (char === '\n' || char === '\t') { output += char === '\t' ? ' ' : char; continue; }
    try { font.encodeText(char); output += char; }
    catch (_) { output += '?'; replaced.count += 1; }
  }
  return output;
}

function wrapPdfText(text, font, size, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    let current = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { current = candidate; continue; }
      if (current) { lines.push(current); current = ''; }
      for (const char of word) {
        if (font.widthOfTextAtSize(current + char, size) > maxWidth && current) {
          lines.push(current); current = '';
        }
        current += char;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function topY(top, height = 0) { return PDF_PAGE.height - top - height; }

function drawContainedImage(page, image, x, top, width, height) {
  const scale = Math.min(width / image.width, height / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  page.drawImage(image, { x: x + (width - w) / 2, y: topY(top + (height - h) / 2, h), width: w, height: h });
}

async function createPhotoLogPdf(entries, settings, imageBytesForEntry, options = {}) {
  if (!entries.length) throw new Error('Select at least one photo.');
  const lib = pdfLibrary();
  const doc = await lib.PDFDocument.create();
  const regular = await doc.embedFont(lib.StandardFonts.Helvetica);
  const bold = await doc.embedFont(lib.StandardFonts.HelveticaBold);
  const replaced = { count: 0 };
  const clean = value => printableText(value, regular, replaced);
  const accent = /^#[0-9a-f]{6}$/i.test(settings.accentColor || '') ? settings.accentColor : '#BF9555';
  const color = lib.rgb(parseInt(accent.slice(1, 3), 16) / 255, parseInt(accent.slice(3, 5), 16) / 255, parseInt(accent.slice(5, 7), 16) / 255);
  const ink = lib.rgb(0.09, 0.12, 0.16);
  const muted = lib.rgb(0.35, 0.38, 0.42);
  const safeEntries = entries.map(entry => ({
    ...entry,
    photoLabel: clean(entry.photoLabel),
    date: clean(entry.date),
    commentLines: wrapPdfText(clean(entry.comment), regular, 9.5, 510)
  }));
  if (safeEntries.some(entry => entry.commentLines.length > 9)) {
    throw new Error('One caption is too long for a photo log page. Shorten it to about nine lines.');
  }

  const groups = [];
  for (let i = 0; i < safeEntries.length;) {
    const first = safeEntries[i++];
    const second = safeEntries[i];
    if (first.commentLines.length <= 4 && second && second.commentLines.length <= 4) {
      groups.push([first, second]); i++;
    } else {
      groups.push([first]);
    }
  }

  const dates = safeEntries.map(e => e.date).filter(Boolean);
  const dateRange = dates.length ? (dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} - ${dates.at(-1)}`) : '';
  const header = [clean(settings.projectName), clean(settings.title), dateRange];
  let logo = null;
  if (options.logoBytes) {
    try {
      logo = options.logoType === 'image/png'
        ? await doc.embedPng(options.logoBytes) : await doc.embedJpg(options.logoBytes);
    } catch (_) { throw new Error('The branding logo could not be added to the PDF. Try a JPEG or PNG.'); }
  }

  let done = 0;
  for (let pageIndex = 0; pageIndex < groups.length; pageIndex++) {
    const group = groups[pageIndex];
    const page = doc.addPage([PDF_PAGE.width, PDF_PAGE.height]);
    const headerWidth = 170;
    ['CLIENT', 'LOCATION', 'DATE'].forEach((label, i) => {
      const x = PDF_PAGE.margin + i * 180;
      page.drawText(label, { x, y: topY(27, 8), size: 8, font: bold, color });
      const original = header[i] || '-';
      let value = original;
      while (value.length > 1 && regular.widthOfTextAtSize(value, 10) > headerWidth) value = value.slice(0, -1);
      if (value !== original) value = value.slice(0, -1) + '...';
      page.drawText(value, { x, y: topY(43, 10), size: 10, font: regular, color: ink });
    });
    page.drawLine({ start: { x: 38, y: topY(73) }, end: { x: 574, y: topY(73) }, thickness: 1.4, color });

    for (let slot = 0; slot < group.length; slot++) {
      const entry = group[slot];
      const single = group.length === 1;
      const panelTop = single ? 93 : (slot === 0 ? 91 : 401);
      const panelHeight = single ? 607 : 299;
      const imageTop = panelTop + 20;
      const imageHeight = single ? 446 : 213;
      const imageWidth = 518;
      page.drawRectangle({ x: 38, y: topY(panelTop, panelHeight), width: 536, height: panelHeight,
        color: lib.rgb(0.98, 0.98, 0.97), borderColor: lib.rgb(0.87, 0.88, 0.87), borderWidth: 0.6 });
      const imageBytes = await imageBytesForEntry(entry, done);
      const image = await doc.embedJpg(imageBytes);
      drawContainedImage(page, image, 47, imageTop, imageWidth, imageHeight);
      const textTop = imageTop + imageHeight + 9;
      const label = `PHOTO ${entry.photoLabel || done + 1}${entry.date ? `  |  ${entry.date}` : ''}`;
      page.drawText(label, { x: 48, y: topY(textTop, 10), size: 9.5, font: bold, color });
      entry.commentLines.forEach((line, lineIndex) => {
        if (line) page.drawText(line, { x: 48, y: topY(textTop + 17 + lineIndex * 12, 10), size: 9.5, font: regular, color: ink });
      });
      done++;
      options.onProgress?.(done, entries.length);
    }

    if (settings.companyName) page.drawText(clean(settings.companyName).slice(0, 70),
      { x: 38, y: 25, size: 8, font: regular, color: muted });
    if (logo) drawContainedImage(page, logo, 282, 739, 48, 25);
    page.drawText(`Page ${pageIndex + 1} of ${groups.length}`, { x: 494, y: 25, size: 8, font: regular, color: muted });
    if (options.watermark) {
      page.drawText('PREVIEW', { x: 137, y: 390, size: 76, font: bold, color: lib.rgb(0.55, 0.18, 0.15),
        opacity: 0.22, rotate: lib.degrees(35) });
    }
  }
  const bytes = await doc.save();
  return { blob: new Blob([bytes], { type: 'application/pdf' }), replacedCharacters: replaced.count, pages: groups.length };
}

async function browserJpegBytes(photo) {
  let image;
  try {
    image = await loadImage(photo.objectUrl);
  } catch {
    throw new Error(`This browser could not open ${photo.fileName || 'a photo'}. Try a JPEG or PNG copy of that image.`);
  }
  const side = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = Math.min(1, 1800 / side);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('This browser could not prepare an image for PDF.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error(`Could not convert ${photo.fileName || 'a photo'} to JPEG.`);
  return new Uint8Array(await blob.arrayBuffer());
}

async function buildBrowserPhotoLogPdf(included, settings, watermark, onProgress) {
  const entries = included.map(photo => ({
    source: photo,
    photoLabel: String(photo[settings.labelField] ?? photo.photoNumber ?? ''),
    date: photo.date || '',
    comment: photo.comment || ''
  }));
  let logoBytes = null;
  let logoType = null;
  if (settings.logoDataUrl) {
    const response = await fetch(settings.logoDataUrl);
    logoType = response.headers.get('content-type')?.split(';')[0];
    logoBytes = new Uint8Array(await response.arrayBuffer());
  }
  return createPhotoLogPdf(entries, settings, entry => browserJpegBytes(entry.source),
    { watermark, onProgress, logoBytes, logoType });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createPhotoLogPdf, wrapPdfText };
