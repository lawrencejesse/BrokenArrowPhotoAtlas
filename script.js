/* ============================================================
   Photo Log Atlas Builder — Broken Arrow Consulting
   Browser-side EXIF extraction, review table, and exports.
   ============================================================ */

'use strict';

/* ---- State ----------------------------------------------- */

let photos = [];
let boundaryGeoJson = null;

const atlasSettings = {
  title: '',
  subtitle: 'Aerial Photo Summary',
  labelField: 'photoNumber',
  mapZoom: 16,
  layout: 'landscape',
  boundaryStyle: { color: '#ffff00', weight: 2, fillOpacity: 0.05 }
};

/* ---- DOM refs -------------------------------------------- */

const photoFilesInput   = document.getElementById('photo-files');
const photoFolderInput  = document.getElementById('photo-folder');
const qgisPathInput     = document.getElementById('qgis-path');
const extractBtn        = document.getElementById('extract-btn');
const selectionSummary  = document.getElementById('selection-summary');
const extractStatus     = document.getElementById('extract-status');
const extractWarnings   = document.getElementById('extract-warnings');

const step2El           = document.getElementById('step-2');
const step3El           = document.getElementById('step-3');
const step4El           = document.getElementById('step-4');

const reviewTbody       = document.getElementById('review-tbody');
const includedCountEl   = document.getElementById('included-count');
const selectAllBtn      = document.getElementById('select-all-btn');
const deselectAllBtn    = document.getElementById('deselect-all-btn');
const gotoSettingsBtn   = document.getElementById('goto-settings-btn');

const atlasTitleInput   = document.getElementById('atlas-title');
const atlasSubtitleInput= document.getElementById('atlas-subtitle');
const labelFieldSelect  = document.getElementById('label-field');
const mapZoomSlider     = document.getElementById('map-zoom');
const zoomDisplay       = document.getElementById('zoom-display');
const boundaryFileInput = document.getElementById('boundary-file');
const boundaryStatus    = document.getElementById('boundary-status');
const gotoGenerateBtn   = document.getElementById('goto-generate-btn');

const generatePreviewInfo = document.getElementById('generate-preview-info');
const generateAtlasBtn  = document.getElementById('generate-atlas-btn');
const generateError     = document.getElementById('generate-error');

const downloadCsvBtn    = document.getElementById('download-csv');
const downloadGeojsonBtn= document.getElementById('download-geojson');

/* ---- File selection -------------------------------------- */

let pendingFiles = [];

function onFilesChosen(fileList) {
  const images = Array.from(fileList).filter(f => f.type.startsWith('image/'));
  pendingFiles = images;
  if (images.length === 0) {
    selectionSummary.textContent = 'No image files found in selection.';
    selectionSummary.classList.remove('hidden');
    extractBtn.disabled = true;
    return;
  }
  selectionSummary.textContent = `${images.length} image file${images.length !== 1 ? 's' : ''} selected.`;
  selectionSummary.classList.remove('hidden');
  extractBtn.disabled = false;
}

photoFilesInput.addEventListener('change', () => onFilesChosen(photoFilesInput.files));
photoFolderInput.addEventListener('change', () => onFilesChosen(photoFolderInput.files));

/* ---- EXIF extraction ------------------------------------- */

function asFloat(val, fallback = null) {
  if (val === null || val === undefined || val === '') return fallback;
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

function extractGps(exif) {
  let lat = null;
  let lon = null;

  if (typeof exif.latitude === 'number') lat = exif.latitude;
  if (typeof exif.longitude === 'number') lon = exif.longitude;

  if (lat === null && exif.GPSLatitude) {
    const raw = exif.GPSLatitude;
    if (Array.isArray(raw) && raw.length === 3) {
      lat = raw[0] + raw[1] / 60 + raw[2] / 3600;
      if (exif.GPSLatitudeRef === 'S') lat = -lat;
    } else {
      lat = asFloat(raw);
    }
  }
  if (lon === null && exif.GPSLongitude) {
    const raw = exif.GPSLongitude;
    if (Array.isArray(raw) && raw.length === 3) {
      lon = raw[0] + raw[1] / 60 + raw[2] / 3600;
      if (exif.GPSLongitudeRef === 'W') lon = -lon;
    } else {
      lon = asFloat(raw);
    }
  }

  return { lat, lon };
}

function formatDate(d) {
  if (!d) return '';
  try {
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    const day = String(dt.getDate()).padStart(2, '0');
    const month = dt.toLocaleString('en-GB', { month: 'short' });
    const year = dt.getFullYear();
    return `${day}-${month}-${year}`;
  } catch { return String(d); }
}

function getDate(exif) {
  for (const key of ['DateTimeOriginal', 'CreateDate', 'DateCreated']) {
    if (exif[key]) return formatDate(exif[key]);
  }
  return '';
}

extractBtn.addEventListener('click', async () => {
  if (!pendingFiles.length) return;

  extractBtn.disabled = true;
  extractBtn.textContent = 'Extracting…';
  extractStatus.classList.add('hidden');
  extractWarnings.classList.remove('hidden');
  extractWarnings.classList.add('hidden');

  const qgisBase = qgisPathInput.value.trim().replace(/[\\\/]+$/, '');

  const results = await Promise.all(pendingFiles.map(async (file, idx) => {
    try {
      const exif = await exifr.parse(file, true) || {};
      const { lat, lon } = extractGps(exif);
      const relAlt = asFloat(exif.RelativeAltitude ?? exif.GPSAltitude ?? exif.AbsoluteAltitude);
      const yaw = asFloat(exif.FlightYawDegree ?? exif.GimbalYawDegree);
      const gimbalYaw = asFloat(exif.GimbalYawDegree);
      const path = qgisBase ? `${qgisBase}/${file.name}` : null;
      return {
        include: true,
        photoNumber: idx + 1,
        fileName: file.name,
        date: getDate(exif),
        comment: '',
        objectUrl: URL.createObjectURL(file),
        localQgisPath: path,
        latitude: lat,
        longitude: lon,
        relativeAltitude: relAlt,
        flightYawDegree: yaw,
        gimbalYawDegree: gimbalYaw,
        exif
      };
    } catch (err) {
      console.warn('EXIF parse error', file.name, err);
      return {
        include: true,
        photoNumber: idx + 1,
        fileName: file.name,
        date: '',
        comment: '',
        objectUrl: URL.createObjectURL(file),
        localQgisPath: qgisBase ? `${qgisBase}/${file.name}` : file.name,
        latitude: null,
        longitude: null,
        relativeAltitude: null,
        flightYawDegree: null,
        gimbalYawDegree: null,
        exif: {}
      };
    }
  }));

  photos = results;

  const total   = photos.length;
  const gps     = photos.filter(p => p.latitude !== null && p.longitude !== null).length;
  const yaw     = photos.filter(p => p.flightYawDegree !== null).length;
  const noGps   = total - gps;
  const noYaw   = yaw < total ? total - yaw : 0;

  extractStatus.textContent = `Loaded ${total} photo${total !== 1 ? 's' : ''}. ${gps} have GPS coordinates. ${yaw} have flight yaw.`;
  extractStatus.classList.remove('hidden');

  const warnings = [];
  if (noGps > 0) warnings.push(`${noGps} photo${noGps !== 1 ? 's' : ''} have no GPS — they will be excluded from the atlas map.`);
  if (noYaw > 0) warnings.push(`${noYaw} photo${noYaw !== 1 ? 's' : ''} have no yaw — their atlas markers will point north.`);
  if (warnings.length) {
    extractWarnings.innerHTML = warnings.map(w => `<div>${w}</div>`).join('');
    extractWarnings.classList.remove('hidden');
  }

  extractBtn.textContent = 'Re-extract EXIF';
  extractBtn.disabled = false;

  populateLabelFieldDropdown();
  renderReviewTable();
  step2El.classList.remove('hidden');
  step2El.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ---- Review table ---------------------------------------- */

function updateIncludedCount() {
  const n = photos.filter(p => p.include).length;
  includedCountEl.textContent = `${n} of ${photos.length} photos included`;
}

function renderReviewTable() {
  reviewTbody.innerHTML = '';
  photos.forEach((photo, i) => {
    const tr = document.createElement('tr');
    if (!photo.include) tr.classList.add('excluded');

    const fmtCoord = v => v !== null ? v.toFixed(6) : '—';
    const fmtNum   = v => v !== null ? v.toFixed(1) : '—';

    tr.innerHTML = `
      <td class="col-include"><input type="checkbox" class="include-checkbox" data-idx="${i}" ${photo.include ? 'checked' : ''}></td>
      <td class="col-num">${photo.photoNumber}</td>
      <td class="col-name"><span class="file-name-cell">${esc(photo.fileName)}</span></td>
      <td class="col-date">${esc(photo.date)}</td>
      <td class="col-coord">${fmtCoord(photo.latitude)}</td>
      <td class="col-coord">${fmtCoord(photo.longitude)}</td>
      <td class="col-alt">${fmtNum(photo.relativeAltitude)}</td>
      <td class="col-yaw">${fmtNum(photo.flightYawDegree)}</td>
      <td class="col-comment"><textarea class="comment-input" data-idx="${i}" rows="1" placeholder="Add a comment…">${esc(photo.comment)}</textarea></td>
    `;

    tr.querySelector('.include-checkbox').addEventListener('change', e => {
      photos[i].include = e.target.checked;
      tr.classList.toggle('excluded', !photos[i].include);
      updateIncludedCount();
    });

    tr.querySelector('.comment-input').addEventListener('input', e => {
      photos[i].comment = e.target.value;
    });

    reviewTbody.appendChild(tr);
  });
  updateIncludedCount();
}

selectAllBtn.addEventListener('click', () => {
  photos.forEach(p => p.include = true);
  renderReviewTable();
});

deselectAllBtn.addEventListener('click', () => {
  photos.forEach(p => p.include = false);
  renderReviewTable();
});

gotoSettingsBtn.addEventListener('click', () => {
  step3El.classList.remove('hidden');
  step3El.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ---- Atlas settings -------------------------------------- */

function populateLabelFieldDropdown() {
  const defaultOptions = ['photoNumber', 'fileName', 'date'];
  const exifKeys = new Set();
  photos.forEach(p => Object.keys(p.exif || {}).forEach(k => exifKeys.add(k)));

  const allOptions = [...defaultOptions];
  exifKeys.forEach(k => { if (!defaultOptions.includes(k)) allOptions.push(k); });

  labelFieldSelect.innerHTML = '';
  allOptions.forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = key;
    if (key === 'photoNumber') opt.selected = true;
    labelFieldSelect.appendChild(opt);
  });
}

mapZoomSlider.addEventListener('input', () => {
  zoomDisplay.textContent = mapZoomSlider.value;
  atlasSettings.mapZoom = parseInt(mapZoomSlider.value, 10);
});

boundaryFileInput.addEventListener('change', () => {
  const file = boundaryFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      const type = parsed.type;
      if (!['FeatureCollection', 'Feature', 'Polygon', 'MultiPolygon', 'LineString', 'MultiLineString', 'GeometryCollection'].includes(type)) {
        throw new Error(`Unexpected GeoJSON type: ${type}`);
      }
      boundaryGeoJson = parsed;
      boundaryStatus.textContent = `Boundary loaded: ${file.name}`;
      boundaryStatus.className = 'boundary-status ok';
      boundaryStatus.classList.remove('hidden');
    } catch (err) {
      boundaryGeoJson = null;
      boundaryStatus.textContent = `Could not read boundary file. Check that it is valid GeoJSON. (${err.message})`;
      boundaryStatus.className = 'boundary-status error';
      boundaryStatus.classList.remove('hidden');
    }
  };
  reader.readAsText(file);
});

function getLayoutValue() {
  const checked = document.querySelector('input[name="atlas-layout"]:checked');
  return checked ? checked.value : 'landscape';
}

gotoGenerateBtn.addEventListener('click', () => {
  atlasSettings.title    = atlasTitleInput.value.trim();
  atlasSettings.subtitle = atlasSubtitleInput.value.trim();
  atlasSettings.labelField = labelFieldSelect.value;
  atlasSettings.mapZoom  = parseInt(mapZoomSlider.value, 10);
  atlasSettings.layout   = getLayoutValue();

  const included = photos.filter(p => p.include && p.latitude !== null && p.longitude !== null);
  generatePreviewInfo.textContent = `${included.length} photo${included.length !== 1 ? 's' : ''} with GPS will be included in the atlas.`;
  generateError.classList.add('hidden');

  step4El.classList.remove('hidden');
  step4El.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ---- Atlas generation ------------------------------------ */

generateAtlasBtn.addEventListener('click', async () => {
  atlasSettings.title    = atlasTitleInput.value.trim();
  atlasSettings.subtitle = atlasSubtitleInput.value.trim();
  atlasSettings.labelField = labelFieldSelect.value;
  atlasSettings.mapZoom  = parseInt(mapZoomSlider.value, 10);
  atlasSettings.layout   = getLayoutValue();

  const included = photos.filter(p => p.include && p.latitude !== null && p.longitude !== null);
  if (included.length === 0) {
    generateError.textContent = 'No included photos have GPS coordinates. Check that your photos are geotagged and at least one is selected.';
    generateError.classList.remove('hidden');
    return;
  }
  generateError.classList.add('hidden');

  if (typeof buildAtlas === 'function') {
    generateAtlasBtn.disabled = true;
    generateAtlasBtn.textContent = 'Building atlas…';

    try {
      await buildAtlas(included, atlasSettings, boundaryGeoJson);
    } catch (err) {
      console.error('Atlas generation error', err);
      generateError.textContent = `Atlas generation failed: ${err.message}`;
      generateError.classList.remove('hidden');
      generateAtlasBtn.disabled = false;
      generateAtlasBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg> Generate Printable Atlas`;
      return;
    }

    generateAtlasBtn.disabled = false;
    generateAtlasBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg> Regenerate Atlas`;
  }

  const step5El = document.getElementById('step-5');
  step5El.classList.remove('hidden');
  downloadCsvBtn.disabled = false;
  downloadGeojsonBtn.disabled = false;
  step5El.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ---- CSV export ------------------------------------------ */

downloadCsvBtn.addEventListener('click', () => {
  const included = photos.filter(p => p.include);
  if (included.length === 0) { alert('No photos selected for export.'); return; }

  const headers = ['photoNumber', 'fileName', 'date', 'comment', 'path', 'latitude', 'longitude', 'relativeAltitude', 'flightYawDegree'];
  const rows = [headers.join(',')];

  included.forEach(p => {
    const cols = headers.map(h => {
      const val = h === 'path' ? p.localQgisPath : p[h];
      const str = val === null || val === undefined ? '' : String(val);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"` : str;
    });
    rows.push(cols.join(','));
  });

  triggerDownload(rows.join('\n'), 'photo_log.csv', 'text/csv');
});

/* ---- GeoJSON export -------------------------------------- */

downloadGeojsonBtn.addEventListener('click', () => {
  const included = photos.filter(p => p.include);
  if (included.length === 0) { alert('No photos selected for export.'); return; }

  const features = included.map(p => {
    const props = {
      photoNumber:      p.photoNumber,
      fileName:         p.fileName,
      date:             p.date,
      comment:          p.comment,
      ...(p.localQgisPath ? { path: p.localQgisPath } : {}),
      RelativeAltitude: p.relativeAltitude,
      FlightYawDegree:  p.flightYawDegree,
      GimbalYawDegree:  p.gimbalYawDegree
    };

    const exifKeys = ['Make', 'Model', 'GPSAltitude', 'AbsoluteAltitude',
                      'GimbalPitchDegree', 'GimbalRollDegree', 'FlightPitchDegree',
                      'FlightRollDegree', 'CalibratedFocalLength', 'CalibratedOpticalCenterX',
                      'CalibratedOpticalCenterY', 'DateTimeOriginal', 'ExifImageWidth',
                      'ExifImageHeight', 'Orientation'];
    exifKeys.forEach(k => {
      if (p.exif[k] !== undefined && p.exif[k] !== null) props[k] = p.exif[k];
    });

    if (p.latitude !== null && p.longitude !== null) {
      return {
        type: 'Feature',
        properties: props,
        geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] }
      };
    }
    return {
      type: 'Feature',
      properties: props,
      geometry: null
    };
  });

  const geojson = { type: 'FeatureCollection', features };
  triggerDownload(JSON.stringify(geojson, null, 2), 'photo_log.geojson', 'application/json');
});

/* ---- Helpers --------------------------------------------- */

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
