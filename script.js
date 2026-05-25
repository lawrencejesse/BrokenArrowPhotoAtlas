/* ============================================================
   Photo Log Atlas Builder — Broken Arrow Consulting
   Browser-side EXIF extraction, review table, and exports.
   ============================================================ */

'use strict';

/* ---- State ----------------------------------------------- */

let photos = [];
let boundaryGeoJson = null;
let paid = false;
window.paidExportUnlocked = false;

const atlasSettings = {
  title: '',
  subtitle: 'Aerial Photo Summary',
  labelField: 'photoNumber',
  mapZoom: 16,
  layout: 'landscape',
  boundaryStyle: { color: '#ffff00', weight: 2, fillOpacity: 0.05 },
  companyName: '',
  projectName: '',
  logoDataUrl: '',
  accentColor: '#BF9555',
  showFooter: false
};

/* ---- Payment helpers ------------------------------------- */

function setPaid(val) {
  paid = val;
  window.paidExportUnlocked = val;
  updateExportUI();
}

function updateExportUI() {
  const btn   = document.getElementById('unlock-export-btn');
  const badge = document.getElementById('export-unlocked-badge');
  const hint  = document.getElementById('export-hint');
  if (!btn) return;
  if (paid) {
    btn.classList.add('hidden');
    if (badge) badge.classList.remove('hidden');
    if (hint)  hint.textContent = 'Export unlocked — download the clean, print-ready file below.';
  } else {
    btn.classList.remove('hidden');
    if (badge) badge.classList.add('hidden');
    if (hint)  hint.textContent = 'Preview includes a watermark. Unlock once per session for a clean, print-ready download.';
  }
}

/* ---- Check for Stripe return or admin bypass ------------- */
(function checkPaymentReturn() {
  const params    = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');
  const adminTok  = params.get('admin');

  /* Clear stale signals that should never persist across fresh page loads.
     stripe_same_tab and pending_stripe_session are read later in this IIFE
     and must NOT be removed here. */
  localStorage.removeItem('stripe_verified_session');
  localStorage.removeItem('stripe_unlocked');

  if (adminTok) {
    const clean = new URL(window.location.href);
    clean.searchParams.delete('admin');
    window.history.replaceState({}, '', clean.toString());
    fetch(`/api/admin-unlock?token=${encodeURIComponent(adminTok)}`)
      .then(r => r.json())
      .then(data => { if (data.ok) setPaid(true); })
      .catch(err  => console.warn('Admin unlock failed:', err));
  }

  function verifySession(id, { signalOriginalTab = false } = {}) {
    fetch(`/api/verify-session?session_id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(data => {
        if (data.paid) {
          localStorage.removeItem('pending_stripe_session');
          /* Persist the payment so the user doesn't lose it on page refresh */
          localStorage.setItem('stripe_verified_session', id);
          if (signalOriginalTab) {
            /* Signal the original tab via the storage event (instant cross-tab) */
            localStorage.setItem('stripe_unlocked', '1');
            window.close();
            /* If window.close() is blocked, redirect back to the app —
               stripe_verified_session is already stored so it will auto-unlock */
            setTimeout(() => { window.location.replace('/'); }, 600);
          } else {
            setPaid(true);
            window.autoDownloadCleanExport?.();
          }
        }
      })
      .catch(err => console.warn('Session verification failed:', err));
  }

  if (sessionId) {
    const clean = new URL(window.location.href);
    clean.searchParams.delete('session_id');
    window.history.replaceState({}, '', clean.toString());
    /* stripe_same_tab is set when popup was blocked and we navigated this tab to Stripe.
       In that case we want to unlock THIS tab, not signal a parent. */
    const sameTab = localStorage.getItem('stripe_same_tab') === '1';
    localStorage.removeItem('stripe_same_tab');
    verifySession(sessionId, { signalOriginalTab: !sameTab });
    return;
  }

  const pending = localStorage.getItem('pending_stripe_session');
  if (pending) verifySession(pending);
})();

/* ---- DOM refs -------------------------------------------- */

const unlockExportBtn     = document.getElementById('unlock-export-btn');
const exportUnlockedBadge = document.getElementById('export-unlocked-badge');
const exportHint          = document.getElementById('export-hint');

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

  let dragSrcIdx = null;

  photos.forEach((photo, i) => {
    const tr = document.createElement('tr');
    if (!photo.include) tr.classList.add('excluded');
    tr.draggable = true;

    const fmtCoord = v => v !== null ? v.toFixed(6) : '—';
    const fmtNum   = v => v !== null ? v.toFixed(1) : '—';

    const handleSvg = `<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="4" cy="2.5" r="1.2"/><circle cx="10" cy="2.5" r="1.2"/><circle cx="4" cy="7" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="4" cy="11.5" r="1.2"/><circle cx="10" cy="11.5" r="1.2"/></svg>`;

    tr.innerHTML = `
      <td class="col-drag"><span class="drag-handle" title="Drag to reorder">${handleSvg}</span></td>
      <td class="col-include"><input type="checkbox" class="include-checkbox" data-idx="${i}" ${photo.include ? 'checked' : ''}></td>
      <td class="col-thumb"><img class="row-thumb" src="${photo.objectUrl}" alt="" loading="lazy" draggable="false"></td>
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

    /* --- Drag-and-drop handlers --- */
    tr.addEventListener('dragstart', e => {
      dragSrcIdx = i;
      tr.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    tr.addEventListener('dragend', () => {
      tr.classList.remove('dragging');
      reviewTbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over'));
    });

    tr.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      reviewTbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over'));
      if (dragSrcIdx !== i) tr.classList.add('drag-over');
    });

    tr.addEventListener('dragleave', () => {
      tr.classList.remove('drag-over');
    });

    tr.addEventListener('drop', e => {
      e.preventDefault();
      if (dragSrcIdx === null || dragSrcIdx === i) return;
      const moved = photos.splice(dragSrcIdx, 1)[0];
      photos.splice(i, 0, moved);
      /* Renumber sequentially after reorder */
      photos.forEach((p, idx) => { p.photoNumber = idx + 1; });
      renderReviewTable();
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

function getOutputMode() {
  const checked = document.querySelector('input[name="output-mode"]:checked');
  return checked ? checked.value : 'atlas';
}

/* ---- Branding inputs ------------------------------------- */

const logoFileInput      = document.getElementById('logo-file');
const logoPreview        = document.getElementById('logo-preview');
const clearLogoBtn       = document.getElementById('clear-logo-btn');
const accentColorPicker  = document.getElementById('accent-color-picker');
const accentColorHex     = document.getElementById('accent-color-hex');

logoFileInput.addEventListener('change', () => {
  const file = logoFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    atlasSettings.logoDataUrl = e.target.result;
    logoPreview.src = e.target.result;
    logoPreview.classList.remove('hidden');
    clearLogoBtn.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
});

clearLogoBtn.addEventListener('click', () => {
  atlasSettings.logoDataUrl = '';
  logoPreview.src = '';
  logoPreview.classList.add('hidden');
  clearLogoBtn.classList.add('hidden');
  logoFileInput.value = '';
});

accentColorPicker.addEventListener('input', () => {
  accentColorHex.value = accentColorPicker.value.toUpperCase();
  atlasSettings.accentColor = accentColorPicker.value;
});

accentColorHex.addEventListener('input', () => {
  const val = accentColorHex.value.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
    accentColorPicker.value = val;
    atlasSettings.accentColor = val;
  }
});

function readBrandingSettings() {
  atlasSettings.companyName = document.getElementById('company-name').value.trim();
  atlasSettings.projectName = document.getElementById('project-name').value.trim();
  atlasSettings.accentColor = (/^#[0-9A-Fa-f]{6}$/.test(accentColorHex.value.trim()))
    ? accentColorHex.value.trim() : '#BF9555';
  atlasSettings.showFooter  = document.getElementById('show-footer').checked;
}

/* Show/hide map-specific settings when output mode changes */
document.querySelectorAll('input[name="output-mode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const isAtlas = getOutputMode() === 'atlas';
    const mapSettings = document.getElementById('map-atlas-only-settings');
    if (mapSettings) mapSettings.classList.toggle('hidden', !isAtlas);
    const btnLabel = document.getElementById('generate-btn-label');
    if (btnLabel) btnLabel.textContent = isAtlas ? 'Generate Printable Atlas' : 'Generate Photo Log';
    const step4Desc = document.getElementById('step-4-desc');
    if (step4Desc) step4Desc.textContent = isAtlas
      ? 'Build your printable map atlas. Each included photo gets its own page with a satellite map, caption, and location marker.'
      : 'Build your printable photo log. Photos are paired two per page with captions — no GPS required.';
  });
});

/* Batch caption fill — field definitions drive both the dropdown and the apply logic */
const BATCH_FILL_FIELDS = [
  { value: 'comment',        label: 'Comment / Notes' },
  { value: 'date',           label: 'Date' },
  { value: 'localQgisPath',  label: 'QGIS Photo Path' },
];

(function initBatchFillDropdown() {
  const sel = document.getElementById('batch-fill-field');
  BATCH_FILL_FIELDS.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.value;
    opt.textContent = f.label;
    sel.appendChild(opt);
  });
})();

document.getElementById('batch-fill-btn').addEventListener('click', () => {
  const field = document.getElementById('batch-fill-field').value;
  const value = document.getElementById('batch-fill-value').value;
  if (!photos.length) return;
  photos.forEach(p => { p[field] = value; });
  renderReviewTable();
  document.getElementById('batch-fill-value').value = '';
});

gotoGenerateBtn.addEventListener('click', () => {
  atlasSettings.title    = atlasTitleInput.value.trim();
  atlasSettings.subtitle = atlasSubtitleInput.value.trim();
  atlasSettings.labelField = labelFieldSelect.value;
  atlasSettings.mapZoom  = parseInt(mapZoomSlider.value, 10);
  atlasSettings.layout   = getLayoutValue();
  atlasSettings.mode     = getOutputMode();
  readBrandingSettings();

  const isAtlas = atlasSettings.mode === 'atlas';
  const included = isAtlas
    ? photos.filter(p => p.include && p.latitude !== null && p.longitude !== null)
    : photos.filter(p => p.include);

  const step4Desc = document.getElementById('step-4-desc');
  if (step4Desc) step4Desc.textContent = isAtlas
    ? 'Build your printable map atlas. Each included photo gets its own page with a satellite map, caption, and location marker.'
    : 'Build your printable photo log. Photos are paired two per page with captions — no GPS required.';

  const btnLabel = document.getElementById('generate-btn-label');
  if (btnLabel) btnLabel.textContent = isAtlas ? 'Generate Printable Atlas' : 'Generate Photo Log';

  generatePreviewInfo.textContent = isAtlas
    ? `${included.length} photo${included.length !== 1 ? 's' : ''} with GPS will be included in the atlas.`
    : `${included.length} photo${included.length !== 1 ? 's' : ''} will be included in the photo log.`;
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
  atlasSettings.mode     = getOutputMode();
  readBrandingSettings();

  const isAtlas = atlasSettings.mode === 'atlas';

  const included = isAtlas
    ? photos.filter(p => p.include && p.latitude !== null && p.longitude !== null)
    : photos.filter(p => p.include);

  if (included.length === 0) {
    generateError.textContent = isAtlas
      ? 'No included photos have GPS coordinates. Check that your photos are geotagged and at least one is selected.'
      : 'No photos are selected. Check at least one photo in the review table.';
    generateError.classList.remove('hidden');
    return;
  }
  generateError.classList.add('hidden');

  const svgIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>`;

  generateAtlasBtn.disabled = true;
  generateAtlasBtn.innerHTML = svgIcon + (isAtlas ? ' Building atlas…' : ' Building photo log…');

  try {
    if (isAtlas && typeof buildAtlas === 'function') {
      await buildAtlas(included, atlasSettings, boundaryGeoJson, !paid);
    } else if (!isAtlas && typeof buildPhotoLog === 'function') {
      await buildPhotoLog(included, atlasSettings, !paid);
    }
  } catch (err) {
    console.error('Generation error', err);
    generateError.textContent = `Generation failed: ${err.message}`;
    generateError.classList.remove('hidden');
    generateAtlasBtn.disabled = false;
    generateAtlasBtn.innerHTML = svgIcon + ` <span id="generate-btn-label">${isAtlas ? 'Generate Printable Atlas' : 'Generate Photo Log'}</span>`;
    return;
  }

  generateAtlasBtn.disabled = false;
  generateAtlasBtn.innerHTML = svgIcon + ` <span id="generate-btn-label">${isAtlas ? 'Regenerate Atlas' : 'Regenerate Photo Log'}</span>`;

  const step5El = document.getElementById('step-5');
  step5El.classList.remove('hidden');
  downloadCsvBtn.disabled = false;
  downloadGeojsonBtn.disabled = false;
  if (unlockExportBtn && !paid) unlockExportBtn.disabled = false;
  updateExportUI();
  step5El.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ---- Unlock export (Stripe Checkout) --------------------- */

if (unlockExportBtn) {
  unlockExportBtn.addEventListener('click', async () => {
    /* Open a blank tab immediately (synchronous, in the click handler)
       so the popup blocker treats it as a user gesture — then navigate
       it to the Stripe URL once we have it. */
    const stripeTab = window.open('', '_blank');

    unlockExportBtn.disabled = true;
    unlockExportBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Connecting to Stripe\u2026';

    const resetBtn = () => {
      unlockExportBtn.disabled = false;
      unlockExportBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Unlock Clean Export \u2014 $12 CAD';
    };

    try {
      const res  = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:       atlasSettings.title       || '',
          projectName: atlasSettings.projectName || ''
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start checkout');
      if (data.sessionId) localStorage.setItem('pending_stripe_session', data.sessionId);
      if (stripeTab) {
        stripeTab.location.href = data.url;
      } else {
        /* Popup was blocked — flag that we're navigating THIS tab so the
           success return knows to unlock directly instead of signalling a parent */
        localStorage.setItem('stripe_same_tab', '1');
        window.location.href = data.url;
      }

      /* Wait for the popup to signal payment completion */
      localStorage.removeItem('stripe_unlocked');
      unlockExportBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Waiting for payment\u2026';

      function handleUnlock() {
        window.removeEventListener('storage', onStorageUnlock);
        clearInterval(pollInterval);
        localStorage.removeItem('stripe_unlocked');
        localStorage.removeItem('pending_stripe_session');
        setPaid(true);
        window.autoDownloadCleanExport?.();
      }

      /* Primary: storage event fires instantly in this tab when the popup writes
         stripe_unlocked to localStorage */
      function onStorageUnlock(e) {
        if (e.key === 'stripe_unlocked' && e.newValue === '1') handleUnlock();
      }
      window.addEventListener('storage', onStorageUnlock);

      /* Fallback: poll every second in case the storage event is suppressed
         (e.g. same-tab flow or unusual browser behaviour) */
      const pollInterval = setInterval(() => {
        if (localStorage.getItem('stripe_unlocked') === '1') handleUnlock();
      }, 1000);

      /* Stop listening after 15 minutes to avoid running forever */
      setTimeout(() => {
        window.removeEventListener('storage', onStorageUnlock);
        clearInterval(pollInterval);
        if (!window.paidExportUnlocked) resetBtn();
      }, 15 * 60 * 1000);

    } catch (err) {
      if (stripeTab) stripeTab.close();
      alert(`Payment error: ${err.message}`);
      resetBtn();
    }
  });
}

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
