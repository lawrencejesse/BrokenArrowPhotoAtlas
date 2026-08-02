/* ============================================================
   Photo Log Atlas Builder — Broken Arrow Consulting
   Browser-side EXIF extraction, review table, and exports.
   ============================================================ */

'use strict';

/* ---- State ----------------------------------------------- */

let photos = [];
let boundaryGeoJson = null;
let paid = false;
let paidSource = 'none';
let teamEntitled = false;
window.paidExportUnlocked = false;
window.pendingCleanExportDownload = false;

const DRAFT_SCHEMA_VERSION = 1;
const RECOVERY_DRAFT_KEY = 'ba_photo_atlas_recovery_draft_v1';
const PENDING_SESSION_KEY = 'ba_photo_atlas_pending_session_id';
const PAID_SESSION_KEY = 'ba_photo_atlas_paid_session_id';
const PAYMENT_RECOVERY_MS = 30 * 24 * 60 * 60 * 1000;
const PROJECT_MATCH_THRESHOLD = 0.75;
const EXIF_PARSE_OPTIONS = {
  tiff: true,
  ifd0: true,
  exif: true,
  gps: true,
  xmp: true,
  userComment: true,
  mergeOutput: true
};
const AUTO_BEARING_FIELDS = [
  'FlightYawDegree',
  'GPSImgDirection',
  'GPSDestBearing',
  'GimbalYawDegree',
  'CameraYaw',
  'CameraYawDegree',
  'PoseHeadingDegrees',
  'AbsoluteYaw',
  'RelativeYaw',
  'Yaw'
];
const SPECIAL_BEARING_FIELDS = [
  { value: 'auto', label: 'Auto detect' },
  { value: 'userCommentYaw', label: 'UserComment: Yaw' }
];

const atlasSettings = {
  title: '',
  subtitle: 'Aerial Photo Summary',
  labelField: 'photoNumber',
  bearingField: 'auto',
  showAltitude: true,
  mapZoom: 16,
  layout: 'landscape',
  boundaryStyle: { color: '#ffff00', weight: 2, fillOpacity: 0.05 },
  companyName: '',
  projectName: '',
  logoDataUrl: '',
  accentColor: '#BF9555',
  showFooter: false
};

let pendingDraft = null;
let pendingDraftName = '';
let lastDraftSavedAt = null;
let autosaveTimer = null;
let suppressBeforeUnloadWarning = false;
let currentSelectionMethod = '';
let currentProjectKey = '';
let currentProjectManifest = [];
let currentProjectFingerprint = '';
let currentManifestHashes = [];
let paidProjectKey = '';

/* ---- Payment helpers ------------------------------------- */

function setPaid(val, projectKey = currentProjectKey, source = 'purchase') {
  if (!val && teamEntitled) {
    val = true;
    projectKey = 'team';
    source = 'team';
  }
  paid = val;
  paidSource = val ? source : 'none';
  window.paidExportUnlocked = val;
  paidProjectKey = val ? projectKey : '';
  updateExportUI();
}

function checkoutStorageRecord(sessionId, projectKey, projectManifest, payment = {}) {
  return {
    sessionId,
    projectKey,
    projectManifest,
    projectFingerprint: payment.projectFingerprint || currentProjectFingerprint || '',
    manifestHashes: payment.manifestHashes || currentManifestHashes || [],
    purchaseToken: payment.purchaseToken || '',
    savedAt: Date.now()
  };
}

function rememberPaidSession(sessionId, projectKey = currentProjectKey, projectManifest = currentProjectManifest, payment = {}) {
  if (!sessionId) return;
  try {
    localStorage.setItem(PAID_SESSION_KEY, JSON.stringify(
      checkoutStorageRecord(sessionId, projectKey, projectManifest, payment)
    ));
    localStorage.removeItem(PENDING_SESSION_KEY);
  } catch (_) { /* localStorage may be unavailable */ }
}

function rememberPendingSession(sessionId, projectKey = currentProjectKey, projectManifest = currentProjectManifest, payment = {}) {
  if (!sessionId) return;
  try {
    localStorage.setItem(PENDING_SESSION_KEY, JSON.stringify(
      checkoutStorageRecord(sessionId, projectKey, projectManifest, payment)
    ));
  } catch (_) { /* localStorage may be unavailable */ }
}

function getStoredCheckoutSession(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return '';
    let sessionId = raw;
    let projectKey = '';
    let projectManifest = [];
    let projectFingerprint = '';
    let manifestHashes = [];
    let purchaseToken = '';
    let savedAt = Date.now();
    try {
      const parsed = JSON.parse(raw);
      sessionId = parsed.sessionId || '';
      projectKey = parsed.projectKey || parsed.exportKey || '';
      projectManifest = Array.isArray(parsed.projectManifest) ? parsed.projectManifest : [];
      projectFingerprint = parsed.projectFingerprint || '';
      manifestHashes = Array.isArray(parsed.manifestHashes) ? parsed.manifestHashes : [];
      purchaseToken = parsed.purchaseToken || '';
      savedAt = Number(parsed.savedAt) || 0;
    } catch (_) { /* older storage used a plain session id */ }
    if (!sessionId || Date.now() - savedAt > PAYMENT_RECOVERY_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return {
      sessionId, projectKey, projectManifest, projectFingerprint,
      manifestHashes, purchaseToken
    };
  } catch (_) {
    return null;
  }
}

async function verifyCheckoutSession(sessionId, payment = {}) {
  if (!sessionId) return false;
  const projectFingerprint = payment.projectFingerprint || currentProjectFingerprint;
  const manifestHashes = payment.manifestHashes || currentManifestHashes;
  const purchaseToken = payment.purchaseToken || '';
  const hasDurableRecovery = projectFingerprint && manifestHashes.length && purchaseToken;
  const r = hasDurableRecovery
    ? await fetch('/api/verify-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          purchaseToken,
          projectKey: projectFingerprint,
          manifestHashes
        })
      })
    : await fetch(`/api/verify-session?session_id=${encodeURIComponent(sessionId)}`);
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || 'Could not verify checkout session');
  return !!json.paid;
}

function showPaidRecoveryMessage(downloaded) {
  const hint = document.getElementById('export-hint');
  if (!hint) return;
  if (downloaded === true) {
    hint.textContent = 'Payment confirmed - your clean file is downloading now.';
  } else if (window._lastAtlasArgs || window._lastPhotoLogArgs) {
    hint.textContent = 'Payment verified - click Download Printable HTML to save your clean file.';
  } else {
    hint.textContent = 'Payment verified. If this page was reloaded, select the matching photo folder, extract EXIF, regenerate, and the clean export will unlock again.';
  }
}

function showStepOneRecoveryMessage(message) {
  const status = document.getElementById('draft-status');
  if (!status) return;
  status.textContent = message;
  status.className = 'draft-status warning';
  status.classList.remove('hidden');
}

function unlockPaidExport(sessionId, options = {}) {
  const projectKey = options.projectKey || currentProjectKey;
  const projectManifest = options.projectManifest || currentProjectManifest;
  const payment = {
    projectFingerprint: options.projectFingerprint,
    manifestHashes: options.manifestHashes,
    purchaseToken: options.purchaseToken
  };
  rememberPaidSession(sessionId, projectKey, projectManifest, payment);
  window.baAnalytics?.trackPurchase(sessionId);
  if (currentProjectKey && !storedProjectMatchesCurrent({ projectKey, projectManifest })) {
    showPaidRecoveryMessage(false);
    return;
  }
  if (!currentProjectKey) {
    const message = options.recoveryMessage || 'Payment verified. Select the matching photo folder and extract EXIF to rebuild your clean export.';
    if (!loadStoredRecoveryDraft(message)) showStepOneRecoveryMessage(message);
    showPaidRecoveryMessage(false);
    return;
  }
  setPaid(true, projectKey, 'purchase');
  let downloaded = false;
  if (options.autoDownload) {
    downloaded = window.autoDownloadCleanExport?.() === true;
    if (!downloaded && !window.autoDownloadCleanExport) {
      window.pendingCleanExportDownload = true;
    }
  }
  showPaidRecoveryMessage(downloaded);
}

function updateExportUI() {
  const btn   = document.getElementById('unlock-export-btn');
  const badge = document.getElementById('export-unlocked-badge');
  const hint  = document.getElementById('export-hint');
  const teamBadge = document.getElementById('team-entitlement-badge');
  if (!btn) return;
  if (paid) {
    btn.classList.add('hidden');
    if (badge) badge.classList.remove('hidden');
    if (teamBadge) teamBadge.classList.toggle('hidden', paidSource !== 'team');
    if (hint) hint.textContent = paidSource === 'team'
      ? 'Your company plan includes this clean export.'
      : 'Export unlocked — download the clean, print-ready file below.';
  } else {
    btn.classList.remove('hidden');
    if (badge) badge.classList.add('hidden');
    if (teamBadge) teamBadge.classList.add('hidden');
    if (hint)  hint.textContent = 'Preview includes a watermark. Unlock once per session for a clean, print-ready download.';
  }
}

window.baSetTeamEntitlement = function(enabled) {
  teamEntitled = !!enabled;
  if (teamEntitled) {
    setPaid(true, 'team', 'team');
  } else if (paidSource === 'team') {
    setPaid(false, '', 'none');
  } else {
    updateExportUI();
  }
};

(function recoverPaymentUnlock() {
  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const sessionId = hashParams.get('session_id') || params.get('session_id');
  const purchaseToken = hashParams.get('purchase_token') || params.get('purchase_token') || '';

  if (sessionId) {
    const clean = new URL(window.location.href);
    clean.searchParams.delete('session_id');
    clean.searchParams.delete('purchase_token');
    clean.searchParams.delete('checkout');
    clean.hash = '';
    window.history.replaceState({}, '', clean.toString());

    const pending = getStoredCheckoutSession(PENDING_SESSION_KEY);
    const payment = pending && pending.sessionId === sessionId
      ? pending
      : { purchaseToken };
    if (!payment.projectFingerprint || !payment.manifestHashes?.length) {
      rememberPendingSession(sessionId, '', [], { purchaseToken });
      const message = 'Payment return found. Select the matching photo folder and extract EXIF to verify and unlock it.';
      if (!loadStoredRecoveryDraft(message)) showStepOneRecoveryMessage(message);
      showPaidRecoveryMessage(false);
      return;
    }

    verifyCheckoutSession(sessionId, payment)
      .then(isPaid => {
        if (!isPaid) return;
        const projectKey = pending && pending.sessionId === sessionId ? pending.projectKey : currentProjectKey;
        const projectManifest = pending && pending.sessionId === sessionId ? pending.projectManifest : currentProjectManifest;
        unlockPaidExport(sessionId, {
          autoDownload: true,
          projectKey,
          projectManifest,
          projectFingerprint: payment.projectFingerprint,
          manifestHashes: payment.manifestHashes,
          purchaseToken: payment.purchaseToken,
          recoveryMessage: 'Payment verified. If your original tab is still open, return to it. If it refreshed, select the matching photo folder here and extract EXIF to rebuild your clean export.'
        });
      })
      .catch(err => console.warn('Stripe return verification failed:', err));
    return;
  }

  try {
    if (!currentProjectKey) return;
    const rememberedSession = getStoredCheckoutSession(PAID_SESSION_KEY) || getStoredCheckoutSession(PENDING_SESSION_KEY);
    if (!rememberedSession) return;
    verifyCheckoutSession(rememberedSession.sessionId, rememberedSession)
      .then(isPaid => { if (isPaid) unlockPaidExport(rememberedSession.sessionId, { autoDownload: false, ...rememberedSession }); })
      .catch(err => console.warn('Stored checkout verification failed:', err));
  } catch (_) { /* localStorage may be unavailable */ }
})();

/* ---- DOM refs -------------------------------------------- */

const unlockExportBtn     = document.getElementById('unlock-export-btn');
const exportUnlockedBadge = document.getElementById('export-unlocked-badge');
const exportHint          = document.getElementById('export-hint');
const startNewBtn         = document.getElementById('start-new-btn');

const photoFilesInput   = document.getElementById('photo-files');
const photoFolderInput  = document.getElementById('photo-folder');
const draftFileInput    = document.getElementById('draft-file');
const qgisPathInput     = document.getElementById('qgis-path');
const extractBtn        = document.getElementById('extract-btn');
const selectionSummary  = document.getElementById('selection-summary');
const draftStatus       = document.getElementById('draft-status');
const extractStatus     = document.getElementById('extract-status');
const extractWarnings   = document.getElementById('extract-warnings');

const step1El           = document.getElementById('step-1');
const step2El           = document.getElementById('step-2');
const step3El           = document.getElementById('step-3');
const step4El           = document.getElementById('step-4');
const step5El           = document.getElementById('step-5');

const reviewTbody       = document.getElementById('review-tbody');
const includedCountEl   = document.getElementById('included-count');
const saveDraftBtn      = document.getElementById('save-draft-btn');
const selectAllBtn      = document.getElementById('select-all-btn');
const deselectAllBtn    = document.getElementById('deselect-all-btn');
const gotoSettingsBtn   = document.getElementById('goto-settings-btn');
const photoPreviewModal = document.getElementById('photo-preview-modal');
const photoPreviewImage = document.getElementById('photo-preview-image');
const photoPreviewMeta  = document.getElementById('photo-preview-meta');
const photoPreviewComment = document.getElementById('photo-preview-comment');
const photoPreviewCloseBtn = document.getElementById('photo-preview-close-btn');
const deliverablePreviewModal = document.getElementById('deliverable-preview-modal');
const deliverablePreviewImage = document.getElementById('deliverable-preview-image');
const deliverablePreviewTitle = document.getElementById('deliverable-preview-title');
const deliverablePreviewCloseBtn = document.getElementById('deliverable-preview-close-btn');

const atlasTitleInput   = document.getElementById('atlas-title');
const atlasSubtitleInput= document.getElementById('atlas-subtitle');
const labelFieldSelect  = document.getElementById('label-field');
const bearingFieldSelect= document.getElementById('bearing-field');
const showAltitudeInput = document.getElementById('show-altitude');
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
const downloadDraftBtn  = document.getElementById('download-draft');

/* ---- File selection -------------------------------------- */

let pendingFiles = [];

function resetCurrentWorkflow() {
  if (photos.length) {
    window.baAnalytics?.track('start_new_photo_log');
  }
  clearTimeout(autosaveTimer);
  clearRecoveryDraftFromStorage();
  photos.forEach(photo => {
    if (photo.objectUrl) URL.revokeObjectURL(photo.objectUrl);
  });
  photos = [];
  pendingFiles = [];
  pendingDraft = null;
  pendingDraftName = '';
  boundaryGeoJson = null;
  currentProjectKey = '';
  currentProjectManifest = [];
  currentProjectFingerprint = '';
  currentManifestHashes = [];
  paidProjectKey = '';
  currentSelectionMethod = '';
  window._lastAtlasArgs = null;
  window._lastPhotoLogArgs = null;
  window.pendingCleanExportDownload = false;

  [photoFilesInput, photoFolderInput, draftFileInput, boundaryFileInput].forEach(input => {
    if (input) input.value = '';
  });

  setPaid(false, '');
  applySettingsToInputs({
    title: '',
    subtitle: 'Aerial Photo Summary',
    labelField: 'photoNumber',
    bearingField: 'auto',
    showAltitude: true,
    mapZoom: 16,
    layout: 'landscape',
    mode: 'atlas',
    companyName: '',
    projectName: '',
    logoDataUrl: '',
    accentColor: '#BF9555',
    showFooter: false
  });

  if (reviewTbody) reviewTbody.innerHTML = '';
  if (includedCountEl) includedCountEl.textContent = '0 of 0 photos included';
  if (selectionSummary) selectionSummary.classList.add('hidden');
  if (draftStatus) draftStatus.classList.add('hidden');
  if (extractStatus) extractStatus.classList.add('hidden');
  if (extractWarnings) {
    extractWarnings.innerHTML = '';
    extractWarnings.classList.add('hidden');
  }
  if (boundaryStatus) {
    boundaryStatus.textContent = '';
    boundaryStatus.classList.add('hidden');
  }
  const logoFileInput = document.getElementById('logo-file');
  const logoPreviewEl = document.getElementById('logo-preview');
  const clearLogoBtnEl = document.getElementById('clear-logo-btn');
  if (logoFileInput) logoFileInput.value = '';
  if (logoPreviewEl) {
    logoPreviewEl.src = '';
    logoPreviewEl.classList.add('hidden');
  }
  if (clearLogoBtnEl) clearLogoBtnEl.classList.add('hidden');
  if (generatePreviewInfo) generatePreviewInfo.textContent = '';
  if (generateError) generateError.classList.add('hidden');
  if (downloadCsvBtn) downloadCsvBtn.disabled = true;
  if (downloadGeojsonBtn) downloadGeojsonBtn.disabled = true;
  if (downloadDraftBtn) downloadDraftBtn.disabled = true;
  const htmlDownloadBtn = document.getElementById('download-atlas-html');
  if (htmlDownloadBtn) {
    htmlDownloadBtn.disabled = true;
    delete htmlDownloadBtn.dataset.filename;
  }
  const printInstructions = document.getElementById('print-instructions');
  if (printInstructions) printInstructions.classList.add('hidden');
  const atlasLoadingNote = document.getElementById('atlas-loading-note');
  if (atlasLoadingNote) atlasLoadingNote.classList.add('hidden');

  [step2El, step3El, step4El, step5El].forEach(step => {
    if (step) step.classList.add('hidden');
  });

  extractBtn.textContent = 'Extract EXIF';
  extractBtn.disabled = true;
  updateExportUI();
  window.dispatchEvent(new CustomEvent('ba:new-project'));
  step1El?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

if (startNewBtn) {
  startNewBtn.addEventListener('click', resetCurrentWorkflow);
}

function onFilesChosen(fileList, selectionMethod) {
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
  currentSelectionMethod = selectionMethod;
  window.baAnalytics?.track('photos_selected', {
    selection_method: selectionMethod,
    photo_count_bucket: window.baAnalytics.photoCountBucket(images.length)
  });
}

photoFilesInput.addEventListener('change', () => onFilesChosen(photoFilesInput.files, 'individual'));
photoFolderInput.addEventListener('change', () => onFilesChosen(photoFolderInput.files, 'folder'));

function normalizeRelativePath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function relativePathTail(path) {
  const parts = normalizeRelativePath(path).split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join('/') : '';
}

function getRelativePath(file) {
  return file.webkitRelativePath || file.name;
}

function getDraftFeatures(draft) {
  return Array.isArray(draft?.features) ? draft.features : [];
}

function readSettingsFromInputs() {
  atlasSettings.title    = atlasTitleInput?.value.trim() || '';
  atlasSettings.subtitle = atlasSubtitleInput?.value.trim() || '';
  atlasSettings.labelField = labelFieldSelect?.value || 'photoNumber';
  atlasSettings.bearingField = bearingFieldSelect?.value || 'auto';
  atlasSettings.showAltitude = showAltitudeInput ? showAltitudeInput.checked : true;
  atlasSettings.mapZoom  = parseInt(mapZoomSlider?.value, 10) || 16;
  atlasSettings.layout   = getLayoutValue();
  atlasSettings.mode     = getOutputMode();
  readBrandingSettings();
}

function applySettingsToInputs(settings = {}) {
  if (atlasTitleInput && settings.title !== undefined) atlasTitleInput.value = settings.title || '';
  if (atlasSubtitleInput && settings.subtitle !== undefined) atlasSubtitleInput.value = settings.subtitle || '';
  if (labelFieldSelect && settings.labelField) labelFieldSelect.value = settings.labelField;
  if (bearingFieldSelect && settings.bearingField) bearingFieldSelect.value = settings.bearingField;
  if (showAltitudeInput && settings.showAltitude !== undefined) showAltitudeInput.checked = settings.showAltitude !== false;
  if (mapZoomSlider && settings.mapZoom) {
    mapZoomSlider.value = settings.mapZoom;
    zoomDisplay.textContent = settings.mapZoom;
  }
  if (settings.layout) {
    const layout = document.querySelector(`input[name="atlas-layout"][value="${settings.layout}"]`);
    if (layout) layout.checked = true;
  }
  if (settings.mode) {
    const mode = document.querySelector(`input[name="output-mode"][value="${settings.mode}"]`);
    if (mode) mode.checked = true;
  }
  const companyInput = document.getElementById('company-name');
  const projectInput = document.getElementById('project-name');
  const footerInput = document.getElementById('show-footer');
  if (companyInput && settings.companyName !== undefined) companyInput.value = settings.companyName || '';
  if (projectInput && settings.projectName !== undefined) projectInput.value = settings.projectName || '';
  if (footerInput && settings.showFooter !== undefined) footerInput.checked = !!settings.showFooter;
  if (settings.accentColor && /^#[0-9A-Fa-f]{6}$/.test(settings.accentColor)) {
    accentColorPicker.value = settings.accentColor;
    accentColorHex.value = settings.accentColor.toUpperCase();
  }
  readSettingsFromInputs();
}

function draftPropertiesForPhoto(p) {
  return {
    photoNumber: p.photoNumber,
    fileName: p.fileName,
    relativePath: p.relativePath || p.fileName,
    fileSize: p.fileSize || null,
    lastModified: p.lastModified || null,
    date: p.date || '',
    comment: p.comment || '',
    include: p.include !== false,
    ...(p.localQgisPath ? { path: p.localQgisPath } : {}),
    RelativeAltitude: p.relativeAltitude,
    FlightYawDegree: p.flightYawDegree,
    GimbalYawDegree: p.gimbalYawDegree,
    bearingDegree: p.bearingDegree,
    bearingSource: p.bearingSource || '',
    bearingManual: !!p.bearingManual
  };
}

function buildReviewDraft() {
  readSettingsFromInputs();
  const features = photos.map(p => {
    const geometry = p.latitude !== null && p.longitude !== null
      ? { type: 'Point', coordinates: [p.longitude, p.latitude] }
      : null;
    return {
      type: 'Feature',
      properties: draftPropertiesForPhoto(p),
      geometry
    };
  });
  return {
    type: 'FeatureCollection',
    metadata: {
      app: 'Broken Arrow Photo Atlas',
      draftSchemaVersion: DRAFT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      projectKey: currentProjectKey || (photos.length ? buildProjectKey(buildProjectManifest()) : ''),
      projectManifest: currentProjectManifest.length ? currentProjectManifest : buildProjectManifest(),
      settings: { ...atlasSettings, logoDataUrl: '' },
      hasBoundary: !!boundaryGeoJson
    },
    features
  };
}

window.baBuildCloudDraft = function() {
  if (!photos.length) return null;
  const draft = buildReviewDraft();
  return {
    title: atlasTitleInput?.value.trim() || atlasSettings.title || '',
    projectName: document.getElementById('project-name')?.value.trim() || atlasSettings.projectName || '',
    projectKey: currentProjectKey || buildProjectKey(buildProjectManifest()),
    photoCount: photos.length,
    draft
  };
};

window.baLoadCloudDraft = function(draft, name = 'saved session') {
  if (!draft || draft.type !== 'FeatureCollection' || !Array.isArray(draft.features)) return false;
  if ((photos.length || pendingFiles.length) && !window.confirm('Replace the current unsaved workflow with this saved session?')) {
    return false;
  }
  if (photos.length || pendingFiles.length) resetCurrentWorkflow();
  pendingDraft = draft;
  pendingDraftName = name;
  applySettingsToInputs(draft.metadata?.settings || {});
  if (draftStatus) {
    draftStatus.textContent = `Loaded ${name}. Select the matching photo folder, then extract EXIF to restore captions and settings.`;
    draftStatus.className = 'draft-status warning';
    draftStatus.classList.remove('hidden');
  }
  return true;
};

function getDraftFilename() {
  const datePart = new Date().toLocaleDateString('en-CA');
  const surfaceLocation = atlasTitleInput?.value.trim() || atlasSettings.title || 'photo_atlas';
  const base = surfaceLocation
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .trim()
    .replace(/\s+/g, '_') || 'photo_atlas';
  return `${base}_${datePart}_review_draft.geojson`;
}

function simpleHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function buildProjectManifest() {
  return photos.filter(p => p.include !== false).map(p => [
    normalizeRelativePath(p.relativePath || p.fileName),
    p.fileSize || '',
    p.date || ''
  ].join('|')).sort();
}

function buildProjectKey(manifest = currentProjectManifest) {
  return simpleHash(manifest.join('\n'));
}

async function sha256Hex(value) {
  if (!window.crypto?.subtle) throw new Error('Secure payment recovery is not supported by this browser.');
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function makeClientRequestId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = window.crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function paymentManifestItem(item) {
  const [pathPart, ...restParts] = String(item || '').split('|');
  const normalized = normalizeRelativePath(pathPart);
  const parts = normalized.split('/').filter(Boolean);
  const stablePath = parts.length > 1 ? parts.slice(1).join('/') : (parts[0] || normalized);
  return `${stablePath}|${restParts.join('|')}`;
}

async function refreshPaymentFingerprint(manifest = currentProjectManifest) {
  if (!manifest.length) {
    currentManifestHashes = [];
    currentProjectFingerprint = '';
    return null;
  }
  const hashes = await Promise.all(manifest.map(item => sha256Hex(paymentManifestItem(item))));
  currentManifestHashes = [...new Set(hashes)].sort();
  currentProjectFingerprint = await sha256Hex(currentManifestHashes.join('\n'));
  return {
    projectFingerprint: currentProjectFingerprint,
    manifestHashes: currentManifestHashes
  };
}

window.baGetPaymentContext = function() {
  if (!currentProjectFingerprint || !currentManifestHashes.length) return null;
  return {
    projectKey: currentProjectFingerprint,
    manifestHashes: [...currentManifestHashes]
  };
};

window.baApplyAccountProjectEntitlement = function(result) {
  if (result?.source === 'team' && result.entitled) {
    window.baSetTeamEntitlement?.(true);
  } else if (result?.source === 'purchase' && result.entitled) {
    setPaid(true, currentProjectKey, 'account_purchase');
  } else if (paidSource === 'account_purchase') {
    setPaid(false, '', 'none');
  }
};

function projectManifestVariants(item) {
  const [pathPart, ...restParts] = String(item || '').split('|');
  const rest = restParts.join('|');
  const normalized = normalizeRelativePath(pathPart);
  const parts = normalized.split('/').filter(Boolean);
  const basename = parts.length ? parts[parts.length - 1] : normalized;
  const tail = parts.length > 1 ? parts.slice(1).join('/') : '';
  return [
    `${normalized}|${rest}`,
    tail ? `${tail}|${rest}` : '',
    basename ? `${basename}|${rest}` : ''
  ].filter(Boolean);
}

function storedProjectMatchesCurrent(stored) {
  if (!stored || !currentProjectKey) return false;
  if (stored.projectKey === currentProjectKey) return true;

  const storedManifest = Array.isArray(stored.projectManifest) ? stored.projectManifest : [];
  if (!storedManifest.length || !currentProjectManifest.length) return false;

  const current = new Set(currentProjectManifest.flatMap(projectManifestVariants));
  const overlap = storedManifest.filter(item =>
    projectManifestVariants(item).some(variant => current.has(variant))
  ).length;
  const storedRatio = overlap / storedManifest.length;
  const currentRatio = overlap / currentProjectManifest.length;
  return storedRatio >= PROJECT_MATCH_THRESHOLD && currentRatio >= PROJECT_MATCH_THRESHOLD;
}

async function applyStoredPaymentForCurrentProject() {
  if (!currentProjectKey) return;
  const rememberedSession = getStoredCheckoutSession(PAID_SESSION_KEY) || getStoredCheckoutSession(PENDING_SESSION_KEY);
  const canServerMatch = !!(
    rememberedSession?.purchaseToken
    && currentProjectFingerprint
    && currentManifestHashes.length
  );
  if (!canServerMatch && !storedProjectMatchesCurrent(rememberedSession)) {
    setPaid(false, '');
    return;
  }
  try {
    const isPaid = await verifyCheckoutSession(rememberedSession.sessionId, {
      purchaseToken: rememberedSession.purchaseToken,
      projectFingerprint: currentProjectFingerprint,
      manifestHashes: currentManifestHashes
    });
    if (isPaid) {
      unlockPaidExport(rememberedSession.sessionId, {
        autoDownload: false,
        ...rememberedSession
      });
    } else {
      setPaid(false, '');
    }
  } catch (err) {
    console.warn('Stored checkout verification failed:', err);
  }
}

function saveRecoveryDraftToStorage() {
  if (!photos.length) return false;
  try {
    localStorage.setItem(RECOVERY_DRAFT_KEY, JSON.stringify(buildReviewDraft()));
    lastDraftSavedAt = new Date();
    return true;
  } catch (err) {
    console.warn('Could not save recovery draft:', err);
    return false;
  }
}

function clearRecoveryDraftFromStorage() {
  try {
    localStorage.removeItem(RECOVERY_DRAFT_KEY);
  } catch (_) { /* localStorage may be unavailable */ }
  lastDraftSavedAt = null;
}

function autosaveRecoveryDraft(delay = 900) {
  if (!photos.length) return false;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    saveRecoveryDraftToStorage();
  }, delay);
  return true;
}

function autosaveRecoveryDraftNow() {
  clearTimeout(autosaveTimer);
  return saveRecoveryDraftToStorage();
}

function getRecoveryDraftFromStorage() {
  try {
    const raw = localStorage.getItem(RECOVERY_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) return null;
    return parsed;
  } catch (err) {
    console.warn('Could not read recovery draft:', err);
    return null;
  }
}

function loadStoredRecoveryDraft(message) {
  if (pendingDraft || photos.length) return false;
  const draft = getRecoveryDraftFromStorage();
  if (!draft) return false;
  pendingDraft = draft;
  pendingDraftName = 'saved recovery draft';
  applySettingsToInputs(draft.metadata?.settings || {});
  if (draftStatus) {
    draftStatus.textContent = message || 'Found a saved recovery draft. Select the matching photo folder and extract EXIF to continue.';
    draftStatus.className = 'draft-status warning';
    draftStatus.classList.remove('hidden');
  }
  return true;
}

function downloadReviewDraft() {
  if (!photos.length) {
    alert('Select and extract photos before saving a review draft.');
    return false;
  }
  const draft = buildReviewDraft();
  autosaveRecoveryDraftNow();
  suppressBeforeUnloadWarning = true;
  triggerDownload(JSON.stringify(draft, null, 2), getDraftFilename(), 'application/geo+json');
  window.baAnalytics?.track('review_draft_downloaded', {
    photo_count_bucket: window.baAnalytics.photoCountBucket(photos.length)
  });
  setTimeout(() => { suppressBeforeUnloadWarning = false; }, 1000);
  return true;
}

function featureKeyMaps(draft) {
  const byRelativePath = new Map();
  const byRelativeTail = new Map();
  const byNameSize = new Map();
  const byFileName = new Map();
  const duplicateTails = new Set();
  const duplicates = new Set();

  getDraftFeatures(draft).forEach((feature, order) => {
    const props = feature.properties || {};
    const wrapped = { feature, props, order };
    const rel = normalizeRelativePath(props.relativePath || props.path || props.fileName);
    if (rel) byRelativePath.set(rel, wrapped);
    const tail = relativePathTail(props.relativePath || props.path || props.fileName);
    if (tail) {
      if (byRelativeTail.has(tail)) duplicateTails.add(tail);
      byRelativeTail.set(tail, wrapped);
    }
    const name = String(props.fileName || '').toLowerCase();
    if (name && props.fileSize) byNameSize.set(`${name}|${props.fileSize}`, wrapped);
    if (name) {
      if (byFileName.has(name)) duplicates.add(name);
      byFileName.set(name, wrapped);
    }
  });

  duplicateTails.forEach(tail => byRelativeTail.delete(tail));
  duplicates.forEach(name => byFileName.delete(name));
  return { byRelativePath, byRelativeTail, byNameSize, byFileName };
}

function matchDraftFeature(photo, maps) {
  const rel = normalizeRelativePath(photo.relativePath || photo.fileName);
  const tail = relativePathTail(photo.relativePath || photo.fileName);
  const name = String(photo.fileName || '').toLowerCase();
  return maps.byRelativePath.get(rel)
    || maps.byRelativeTail.get(tail)
    || maps.byNameSize.get(`${name}|${photo.fileSize}`)
    || maps.byFileName.get(name)
    || null;
}

function applyDraftToPhotos(draft) {
  if (!draft || !photos.length) return;
  const maps = featureKeyMaps(draft);
  const draftCount = getDraftFeatures(draft).length;
  let matched = 0;
  const matchedDraftOrders = new Set();

  photos.forEach(photo => {
    const match = matchDraftFeature(photo, maps);
    if (!match) {
      photo.include = false;
      photo._draftOrder = Number.MAX_SAFE_INTEGER;
      return;
    }
    matched += 1;
    matchedDraftOrders.add(match.order);
    const props = match.props;
    photo._draftOrder = match.order;
    photo.include = props.include !== false;
    photo.photoNumber = Number(props.photoNumber) || photo.photoNumber;
    photo.comment = props.comment || '';
    photo.date = props.date || photo.date || '';
    photo.localQgisPath = props.path || photo.localQgisPath || null;
    photo.relativeAltitude = asFloat(props.RelativeAltitude, photo.relativeAltitude);
    photo.bearingDegree = normalizeBearing(props.bearingDegree ?? props.BearingDegree ?? props.FlightYawDegree ?? photo.bearingDegree);
    photo.bearingSource = props.bearingSource || props.BearingSource || props.DirectionSource || photo.bearingSource || '';
    photo.bearingManual = !!props.bearingManual || photo.bearingSource === 'Manual';
    photo.flightYawDegree = photo.bearingDegree;
    photo.gimbalYawDegree = asFloat(props.GimbalYawDegree, photo.gimbalYawDegree);
    if (match.feature.geometry?.type === 'Point') {
      const coords = match.feature.geometry.coordinates || [];
      photo.longitude = asFloat(coords[0], photo.longitude);
      photo.latitude = asFloat(coords[1], photo.latitude);
    }
  });

  photos.sort((a, b) => {
    if (a._draftOrder !== b._draftOrder) return a._draftOrder - b._draftOrder;
    return a.photoNumber - b.photoNumber;
  });
  photos.forEach((p, idx) => {
    delete p._draftOrder;
    if (!p.photoNumber) p.photoNumber = idx + 1;
  });

  applySettingsToInputs(draft.metadata?.settings || {});
  if (draftStatus) {
    const total = photos.length;
    const missing = Math.max(0, draftCount - matchedDraftOrders.size);
    const extra = Math.max(0, total - matched);
    const parts = [
      `Draft applied: matched ${matchedDraftOrders.size} of ${draftCount} draft photo${draftCount !== 1 ? 's' : ''}.`
    ];
    if (extra) parts.push(`${extra} extra selected photo${extra !== 1 ? 's were' : ' was'} excluded.`);
    if (missing) parts.push(`${missing} draft photo${missing !== 1 ? 's are' : ' is'} still missing from the selected folder.`);
    draftStatus.textContent = parts.join(' ');
    draftStatus.className = missing ? 'draft-status warning' : 'draft-status';
    draftStatus.classList.remove('hidden');
  }
  autosaveRecoveryDraftNow();
}

draftFileInput.addEventListener('change', () => {
  const file = draftFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
        throw new Error('Draft must be a GeoJSON FeatureCollection.');
      }
      pendingDraft = parsed;
      pendingDraftName = file.name;
      window.baAnalytics?.track('draft_resumed', {
        draft_photo_count_bucket: window.baAnalytics.photoCountBucket(getDraftFeatures(parsed).length)
      });
      if (draftStatus) {
        draftStatus.textContent = photos.length
          ? `Loaded draft ${file.name}. Applying to selected photos...`
          : `Loaded draft ${file.name}. Now select the matching photo folder and extract EXIF. The app will match relative filenames and exclude extra folder photos by default.`;
        draftStatus.className = 'draft-status';
        draftStatus.classList.remove('hidden');
      }
      if (photos.length) {
        applyDraftToPhotos(pendingDraft);
        renderReviewTable();
      }
    } catch (err) {
      pendingDraft = null;
      pendingDraftName = '';
      if (draftStatus) {
        draftStatus.textContent = `Could not read draft file. ${err.message}`;
        draftStatus.className = 'draft-status error';
        draftStatus.classList.remove('hidden');
      }
    }
  };
  reader.readAsText(file);
});

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

function normalizeBearing(value) {
  const n = asFloat(value);
  if (n === null) return null;
  return ((n % 360) + 360) % 360;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = deg => deg * Math.PI / 180;
  const toDeg = rad => rad * 180 / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaLambda = toRad(lon2 - lon1);
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  return normalizeBearing(toDeg(Math.atan2(y, x)));
}

function parseUserCommentYaw(exif) {
  const comment = exif.UserComment ?? exif.userComment ?? exif.UserComments;
  if (!comment) return null;
  const text = Array.isArray(comment) ? comment.join(' ') : String(comment);
  const match = text.match(/\b(?:yaw|heading|bearing|direction)\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
  return match ? normalizeBearing(match[1]) : null;
}

function getExifValue(exif, field) {
  if (!field) return undefined;
  if (Object.prototype.hasOwnProperty.call(exif, field)) return exif[field];

  const normalized = field.toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = Object.keys(exif || {}).find(k =>
    k.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized
  );
  return key ? exif[key] : undefined;
}

function resolveBearing(exif, selectedField = 'auto') {
  if (selectedField && selectedField !== 'auto') {
    if (selectedField === 'userCommentYaw') {
      const yaw = parseUserCommentYaw(exif);
      return { value: yaw, source: yaw === null ? '' : 'UserComment: Yaw' };
    }
    const value = normalizeBearing(getExifValue(exif, selectedField));
    return { value, source: value === null ? '' : selectedField };
  }

  for (const field of AUTO_BEARING_FIELDS) {
    const value = normalizeBearing(getExifValue(exif, field));
    if (value !== null) return { value, source: field };
  }

  const commentYaw = parseUserCommentYaw(exif);
  if (commentYaw !== null) return { value: commentYaw, source: 'UserComment: Yaw' };

  return { value: null, source: '' };
}

function applyBearingFieldToPhotos() {
  const selectedField = bearingFieldSelect?.value || 'auto';
  atlasSettings.bearingField = selectedField;
  photos.forEach(photo => {
    if (photo.bearingManual) return;
    const resolved = resolveBearing(photo.exif || {}, selectedField);
    photo.bearingDegree = resolved.value;
    photo.bearingSource = resolved.source;
    photo.flightYawDegree = resolved.value;
  });
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
      const exif = await exifr.parse(file, EXIF_PARSE_OPTIONS) || {};
      const { lat, lon } = extractGps(exif);
      const relAlt = asFloat(exif.RelativeAltitude ?? exif.GPSAltitude ?? exif.AbsoluteAltitude);
      const bearing = resolveBearing(exif, atlasSettings.bearingField);
      const gimbalYaw = asFloat(exif.GimbalYawDegree);
      const path = qgisBase ? `${qgisBase}/${file.name}` : null;
      const relativePath = getRelativePath(file);
      return {
        include: true,
        photoNumber: idx + 1,
        fileName: file.name,
        relativePath,
        fileSize: file.size,
        lastModified: file.lastModified,
        date: getDate(exif),
        comment: '',
        objectUrl: URL.createObjectURL(file),
        localQgisPath: path,
        latitude: lat,
        longitude: lon,
        relativeAltitude: relAlt,
        flightYawDegree: bearing.value,
        bearingDegree: bearing.value,
        bearingSource: bearing.source,
        bearingManual: false,
        gimbalYawDegree: gimbalYaw,
        exif
      };
    } catch (err) {
      console.warn('EXIF parse error', file.name, err);
      const relativePath = getRelativePath(file);
      return {
        include: true,
        photoNumber: idx + 1,
        fileName: file.name,
        relativePath,
        fileSize: file.size,
        lastModified: file.lastModified,
        date: '',
        comment: '',
        objectUrl: URL.createObjectURL(file),
        localQgisPath: qgisBase ? `${qgisBase}/${file.name}` : file.name,
        latitude: null,
        longitude: null,
        relativeAltitude: null,
        flightYawDegree: null,
        bearingDegree: null,
        bearingSource: '',
        bearingManual: false,
        gimbalYawDegree: null,
        exif: {}
      };
    }
  }));

  photos = results;

  const total   = photos.length;
  const gps     = photos.filter(p => p.latitude !== null && p.longitude !== null).length;
  const bearing = photos.filter(p => p.bearingDegree !== null).length;
  const noGps   = total - gps;
  const noBearing = bearing < total ? total - bearing : 0;

  window.baAnalytics?.track('exif_extracted', {
    selection_method: currentSelectionMethod || 'unknown',
    photo_count_bucket: window.baAnalytics.photoCountBucket(total),
    gps_coverage: window.baAnalytics.coverageBucket(gps, total),
    direction_coverage: window.baAnalytics.coverageBucket(bearing, total)
  });

  extractStatus.textContent = `Loaded ${total} photo${total !== 1 ? 's' : ''}. ${gps} have GPS coordinates. ${bearing} have photo direction.`;
  extractStatus.classList.remove('hidden');

  const warnings = [];
  if (noGps > 0) warnings.push(`${noGps} photo${noGps !== 1 ? 's' : ''} have no GPS — they will be excluded from the atlas map.`);
  if (noBearing > 0) warnings.push(`${noBearing} photo${noBearing !== 1 ? 's' : ''} have no direction — their atlas markers will point north unless you choose another direction field.`);
  if (warnings.length) {
    extractWarnings.innerHTML = warnings.map(w => `<div>${w}</div>`).join('');
    extractWarnings.classList.remove('hidden');
  }

  extractBtn.textContent = 'Re-extract EXIF';
  extractBtn.disabled = false;

  populateLabelFieldDropdown();
  populateBearingFieldDropdown();
  if (pendingDraft) applyDraftToPhotos(pendingDraft);
  currentProjectManifest = buildProjectManifest();
  currentProjectKey = buildProjectKey(currentProjectManifest);
  try {
    await refreshPaymentFingerprint(currentProjectManifest);
  } catch (err) {
    console.warn('Could not build secure payment fingerprint:', err);
  }
  autosaveRecoveryDraftNow();
  await applyStoredPaymentForCurrentProject();
  await window.baAccounts?.checkCurrentProjectEntitlement?.();
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

    const fmtCoord = v => v !== null ? v.toFixed(4) : '-';
    const fmtCoordFull = v => v !== null ? v.toFixed(7) : '-';
    const fmtNum   = v => v !== null ? v.toFixed(1) : '—';

    const handleSvg = `<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="4" cy="2.5" r="1.2"/><circle cx="10" cy="2.5" r="1.2"/><circle cx="4" cy="7" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="4" cy="11.5" r="1.2"/><circle cx="10" cy="11.5" r="1.2"/></svg>`;

    tr.innerHTML = `
      <td class="col-drag"><span class="drag-handle" title="Drag to reorder">${handleSvg}</span></td>
      <td class="col-include"><input type="checkbox" class="include-checkbox" data-idx="${i}" ${photo.include ? 'checked' : ''}></td>
      <td class="col-thumb"><img class="row-thumb" src="${photo.objectUrl}" alt="Preview ${esc(photo.fileName)}" title="Click to preview and comment" loading="lazy" draggable="false"></td>
      <td class="col-num">${photo.photoNumber}</td>
      <td class="col-yaw" title="${esc(photo.bearingSource || 'No direction source')}">
        <div class="direction-cell">
          <span>${fmtNum(photo.bearingDegree)}</span>
          <span class="direction-source">${esc(photo.bearingSource || '')}</span>
          <button type="button" class="btn-ghost direction-set-btn" data-idx="${i}">Set</button>
        </div>
      </td>
      <td class="col-name"><span class="file-name-cell">${esc(photo.fileName)}</span></td>
      <td class="col-comment"><textarea class="comment-input" data-idx="${i}" rows="1" placeholder="Add a comment...">${esc(photo.comment)}</textarea></td>
      <td class="col-date">${esc(photo.date)}</td>
      <td class="col-coord" title="${fmtCoordFull(photo.latitude)}">${fmtCoord(photo.latitude)}</td>
      <td class="col-coord" title="${fmtCoordFull(photo.longitude)}">${fmtCoord(photo.longitude)}</td>
      <td class="col-alt">${fmtNum(photo.relativeAltitude)}</td>
    `;

    tr.querySelector('.include-checkbox').addEventListener('change', e => {
      photos[i].include = e.target.checked;
      tr.classList.toggle('excluded', !photos[i].include);
      updateIncludedCount();
      autosaveRecoveryDraft();
    });

    tr.querySelector('.comment-input').addEventListener('input', e => {
      photos[i].comment = e.target.value;
      autosaveRecoveryDraft();
    });

    tr.querySelector('.direction-set-btn').addEventListener('click', () => {
      openDirectionModal(i);
    });

    tr.querySelector('.row-thumb').addEventListener('click', () => {
      openPhotoPreview(i);
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
      autosaveRecoveryDraftNow();
      renderReviewTable();
    });

    reviewTbody.appendChild(tr);
  });
  updateIncludedCount();
}

selectAllBtn.addEventListener('click', () => {
  photos.forEach(p => p.include = true);
  autosaveRecoveryDraftNow();
  renderReviewTable();
});

deselectAllBtn.addEventListener('click', () => {
  photos.forEach(p => p.include = false);
  autosaveRecoveryDraftNow();
  renderReviewTable();
});

saveDraftBtn.addEventListener('click', downloadReviewDraft);

gotoSettingsBtn.addEventListener('click', () => {
  step3El.classList.remove('hidden');
  step3El.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

let photoPreviewIdx = null;

function openPhotoPreview(idx) {
  const photo = photos[idx];
  if (!photo || !photoPreviewModal || !photoPreviewImage || !photoPreviewComment) return;

  photoPreviewIdx = idx;
  photoPreviewImage.src = photo.objectUrl;
  photoPreviewMeta.textContent = `Photo ${photo.photoNumber} - ${photo.fileName}`;
  photoPreviewComment.value = photo.comment || '';
  photoPreviewModal.classList.remove('hidden');
  photoPreviewComment.focus();
}

function closePhotoPreview() {
  if (!photoPreviewModal || !photoPreviewImage) return;
  photoPreviewModal.classList.add('hidden');
  photoPreviewImage.removeAttribute('src');
  photoPreviewIdx = null;
}

if (photoPreviewComment) {
  photoPreviewComment.addEventListener('input', e => {
    if (photoPreviewIdx === null || !photos[photoPreviewIdx]) return;
    photos[photoPreviewIdx].comment = e.target.value;
    const rowComment = reviewTbody.querySelector(`.comment-input[data-idx="${photoPreviewIdx}"]`);
    if (rowComment) rowComment.value = e.target.value;
    autosaveRecoveryDraft();
  });
}

if (photoPreviewCloseBtn) {
  photoPreviewCloseBtn.addEventListener('click', closePhotoPreview);
}

if (photoPreviewModal) {
  photoPreviewModal.addEventListener('click', e => {
    if (e.target === photoPreviewModal) closePhotoPreview();
  });
}

function openDeliverablePreview(button) {
  if (!button || !deliverablePreviewModal || !deliverablePreviewImage || !deliverablePreviewTitle) return;
  const src = button.dataset.previewSrc;
  const title = button.dataset.previewTitle || 'Deliverable Preview';
  if (!src) return;
  deliverablePreviewImage.src = src;
  deliverablePreviewImage.alt = `${title} large preview`;
  deliverablePreviewTitle.textContent = title;
  deliverablePreviewModal.classList.remove('hidden');
}

function closeDeliverablePreview() {
  if (!deliverablePreviewModal || !deliverablePreviewImage) return;
  deliverablePreviewModal.classList.add('hidden');
  deliverablePreviewImage.removeAttribute('src');
}

document.querySelectorAll('.deliverable-preview-btn').forEach(button => {
  button.addEventListener('click', () => openDeliverablePreview(button));
});

if (deliverablePreviewCloseBtn) {
  deliverablePreviewCloseBtn.addEventListener('click', closeDeliverablePreview);
}

if (deliverablePreviewModal) {
  deliverablePreviewModal.addEventListener('click', e => {
    if (e.target === deliverablePreviewModal) closeDeliverablePreview();
  });
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && photoPreviewModal && !photoPreviewModal.classList.contains('hidden')) {
    closePhotoPreview();
  }
  if (e.key === 'Escape' && deliverablePreviewModal && !deliverablePreviewModal.classList.contains('hidden')) {
    closeDeliverablePreview();
  }
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

function isNumericExifField(key) {
  return photos.some(p => normalizeBearing(getExifValue(p.exif || {}, key)) !== null);
}

function populateBearingFieldDropdown() {
  if (!bearingFieldSelect) return;

  const current = atlasSettings.bearingField || bearingFieldSelect.value || 'auto';
  const exifKeys = new Set();
  photos.forEach(p => Object.keys(p.exif || {}).forEach(k => exifKeys.add(k)));

  const known = AUTO_BEARING_FIELDS.filter(k => exifKeys.has(k) && isNumericExifField(k));
  const numeric = [...exifKeys]
    .filter(k => !known.includes(k) && isNumericExifField(k))
    .sort((a, b) => a.localeCompare(b));

  bearingFieldSelect.innerHTML = '';
  SPECIAL_BEARING_FIELDS.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.value;
    opt.textContent = item.label;
    bearingFieldSelect.appendChild(opt);
  });

  if (known.length) {
    const group = document.createElement('optgroup');
    group.label = 'Common direction fields';
    known.forEach(key => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = key;
      group.appendChild(opt);
    });
    bearingFieldSelect.appendChild(group);
  }

  if (numeric.length) {
    const group = document.createElement('optgroup');
    group.label = 'Other numeric EXIF fields';
    numeric.forEach(key => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = key;
      group.appendChild(opt);
    });
    bearingFieldSelect.appendChild(group);
  }

  bearingFieldSelect.value = [...bearingFieldSelect.options].some(o => o.value === current)
    ? current
    : 'auto';
  atlasSettings.bearingField = bearingFieldSelect.value;
  applyBearingFieldToPhotos();
}

if (bearingFieldSelect) {
  bearingFieldSelect.addEventListener('change', () => {
    applyBearingFieldToPhotos();
    autosaveRecoveryDraftNow();
    renderReviewTable();
  });
}

/* ---- Manual photo direction editor ----------------------- */

const directionModal = document.getElementById('direction-modal');
const directionPhoto = document.getElementById('direction-photo');
const directionPhotoMeta = document.getElementById('direction-photo-meta');
const directionSubtitle = document.getElementById('direction-modal-subtitle');
const directionReadout = document.getElementById('direction-bearing-readout');
const directionSaveBtn = document.getElementById('direction-save-btn');
const directionResetBtn = document.getElementById('direction-reset-btn');
const directionCancelBtn = document.getElementById('direction-cancel-btn');
const directionCloseBtn = document.getElementById('direction-close-btn');

let directionEditIdx = null;
let directionMap = null;
let directionBaseLayer = null;
let directionTargetMarker = null;
let directionLine = null;
let pendingManualBearing = null;

function imageryTileLayer() {
  return L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Tiles &copy; Esri' }
  );
}

function setDirectionReadout(value, source) {
  if (!directionReadout) return;
  if (value === null || value === undefined) {
    directionReadout.textContent = 'No manual direction set yet.';
    return;
  }
  directionReadout.textContent = `${value.toFixed(1)} deg${source ? ` (${source})` : ''}`;
}

function updateDirectionPreview(photo, targetLatLng) {
  if (!directionMap || !photo) return;
  const origin = [photo.latitude, photo.longitude];
  const target = [targetLatLng.lat, targetLatLng.lng];
  pendingManualBearing = calculateBearing(photo.latitude, photo.longitude, targetLatLng.lat, targetLatLng.lng);

  if (directionTargetMarker) {
    directionTargetMarker.setLatLng(target);
  } else {
    directionTargetMarker = L.circleMarker(target, {
      radius: 6,
      color: '#BF9555',
      weight: 2,
      fillColor: '#BF9555',
      fillOpacity: 0.85
    }).addTo(directionMap);
  }

  if (directionLine) {
    directionLine.setLatLngs([origin, target]);
  } else {
    directionLine = L.polyline([origin, target], {
      color: '#BF9555',
      weight: 3,
      dashArray: '6,6'
    }).addTo(directionMap);
  }

  setDirectionReadout(pendingManualBearing, 'manual preview');
  if (directionSaveBtn) directionSaveBtn.disabled = false;
}

function closeDirectionModal() {
  directionEditIdx = null;
  pendingManualBearing = null;
  if (directionModal) directionModal.classList.add('hidden');
}

function openDirectionModal(idx) {
  const photo = photos[idx];
  if (!photo) return;
  if (photo.latitude === null || photo.longitude === null) {
    alert('This photo does not have GPS coordinates, so direction cannot be set on a map.');
    return;
  }
  if (typeof L === 'undefined') {
    alert('Map tools could not load. Check your internet connection and try again.');
    return;
  }

  directionEditIdx = idx;
  pendingManualBearing = null;
  if (directionPhoto) directionPhoto.src = photo.objectUrl;
  if (directionPhotoMeta) {
    directionPhotoMeta.textContent = `${photo.fileName} | ${photo.latitude.toFixed(6)}, ${photo.longitude.toFixed(6)}`;
  }
  if (directionSubtitle) {
    directionSubtitle.textContent = 'Click the map where the camera was facing. Save to override this photo only.';
  }
  setDirectionReadout(photo.bearingDegree, photo.bearingSource || 'current');
  if (directionSaveBtn) directionSaveBtn.disabled = true;
  if (directionModal) directionModal.classList.remove('hidden');

  setTimeout(() => {
    const center = [photo.latitude, photo.longitude];
    if (!directionMap) {
      directionMap = L.map('direction-map', {
        zoomControl: true,
        attributionControl: true
      });
      directionBaseLayer = imageryTileLayer().addTo(directionMap);
      directionMap.on('click', e => {
        if (directionEditIdx === null) return;
        updateDirectionPreview(photos[directionEditIdx], e.latlng);
      });
    } else if (!directionBaseLayer) {
      directionBaseLayer = imageryTileLayer().addTo(directionMap);
    }

    directionMap.setView(center, 17);
    directionMap.eachLayer(layer => {
      if (layer instanceof L.Marker || layer instanceof L.CircleMarker || layer instanceof L.Polyline) {
        directionMap.removeLayer(layer);
      }
    });
    L.marker(center).addTo(directionMap);
    directionTargetMarker = null;
    directionLine = null;
    directionMap.invalidateSize();
  }, 0);
}

if (directionSaveBtn) {
  directionSaveBtn.addEventListener('click', () => {
    if (directionEditIdx === null || pendingManualBearing === null) return;
    const photo = photos[directionEditIdx];
    photo.bearingDegree = pendingManualBearing;
    photo.flightYawDegree = pendingManualBearing;
    photo.bearingSource = 'Manual';
    photo.bearingManual = true;
    window.baAnalytics?.track('manual_direction_set');
    autosaveRecoveryDraftNow();
    renderReviewTable();
    closeDirectionModal();
  });
}

if (directionResetBtn) {
  directionResetBtn.addEventListener('click', () => {
    if (directionEditIdx === null) return;
    const photo = photos[directionEditIdx];
    const resolved = resolveBearing(photo.exif || {}, atlasSettings.bearingField || 'auto');
    photo.bearingDegree = resolved.value;
    photo.flightYawDegree = resolved.value;
    photo.bearingSource = resolved.source;
    photo.bearingManual = false;
    autosaveRecoveryDraftNow();
    renderReviewTable();
    closeDirectionModal();
  });
}

[directionCancelBtn, directionCloseBtn].forEach(btn => {
  if (btn) btn.addEventListener('click', closeDirectionModal);
});

if (directionModal) {
  directionModal.addEventListener('click', e => {
    if (e.target === directionModal) closeDirectionModal();
  });
}

mapZoomSlider.addEventListener('input', () => {
  zoomDisplay.textContent = mapZoomSlider.value;
  atlasSettings.mapZoom = parseInt(mapZoomSlider.value, 10);
  autosaveRecoveryDraft();
});

function isSupportedBoundaryGeoJson(geojson) {
  return geojson && ['FeatureCollection', 'Feature', 'Polygon', 'MultiPolygon', 'LineString', 'MultiLineString', 'Point', 'MultiPoint', 'GeometryCollection'].includes(geojson.type);
}

function kmlCoordinatesToLngLat(text) {
  return String(text || '').trim().split(/\s+/)
    .map(pair => {
      const [lon, lat] = pair.split(',').map(Number);
      return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
    })
    .filter(Boolean);
}

function kmlElementName(el) {
  return (el.localName || el.nodeName || '').replace(/^.*:/, '');
}

function childElementsByName(el, name) {
  return Array.from(el.children || []).filter(child => kmlElementName(child) === name);
}

function firstChildByName(el, name) {
  return childElementsByName(el, name)[0] || null;
}

function hasKmlGeometryAncestor(el, stopEl) {
  let parent = el.parentElement;
  while (parent && parent !== stopEl) {
    if (['Point', 'LineString', 'Polygon', 'MultiGeometry'].includes(kmlElementName(parent))) return true;
    parent = parent.parentElement;
  }
  return false;
}

function parseKmlGeometry(el) {
  const name = kmlElementName(el);
  if (name === 'Point') {
    const coords = kmlCoordinatesToLngLat(firstChildByName(el, 'coordinates')?.textContent);
    return coords.length ? { type: 'Point', coordinates: coords[0] } : null;
  }
  if (name === 'LineString') {
    const coords = kmlCoordinatesToLngLat(firstChildByName(el, 'coordinates')?.textContent);
    return coords.length >= 2 ? { type: 'LineString', coordinates: coords } : null;
  }
  if (name === 'Polygon') {
    const rings = [];
    childElementsByName(el, 'outerBoundaryIs').forEach(boundary => {
      const coords = kmlCoordinatesToLngLat(firstChildByName(firstChildByName(boundary, 'LinearRing') || boundary, 'coordinates')?.textContent);
      if (coords.length >= 4) rings.push(coords);
    });
    childElementsByName(el, 'innerBoundaryIs').forEach(boundary => {
      const coords = kmlCoordinatesToLngLat(firstChildByName(firstChildByName(boundary, 'LinearRing') || boundary, 'coordinates')?.textContent);
      if (coords.length >= 4) rings.push(coords);
    });
    return rings.length ? { type: 'Polygon', coordinates: rings } : null;
  }
  if (name === 'MultiGeometry') {
    const geometries = Array.from(el.children || []).map(parseKmlGeometry).filter(Boolean);
    return geometries.length ? { type: 'GeometryCollection', geometries } : null;
  }
  return null;
}

function parseKmlBoundary(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) throw new Error('KML XML could not be parsed.');
  const placemarks = Array.from(doc.getElementsByTagName('*')).filter(el => kmlElementName(el) === 'Placemark');
  const features = [];
  placemarks.forEach(placemark => {
    const name = firstChildByName(placemark, 'name')?.textContent?.trim() || '';
    Array.from(placemark.getElementsByTagName('*')).forEach(child => {
      if (!['Point', 'LineString', 'Polygon', 'MultiGeometry'].includes(kmlElementName(child))) return;
      if (hasKmlGeometryAncestor(child, placemark)) return;
      const geometry = parseKmlGeometry(child);
      if (geometry) features.push({ type: 'Feature', properties: name ? { name } : {}, geometry });
    });
  });
  if (!features.length) throw new Error('No supported KML geometry found.');
  return { type: 'FeatureCollection', features };
}

function parseBoundaryFileText(text, fileName) {
  const lowerName = String(fileName || '').toLowerCase();
  if (lowerName.endsWith('.kml')) return parseKmlBoundary(text);
  const parsed = JSON.parse(text);
  if (!isSupportedBoundaryGeoJson(parsed)) throw new Error(`Unexpected GeoJSON type: ${parsed?.type}`);
  return parsed;
}

boundaryFileInput.addEventListener('change', () => {
  const file = boundaryFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = parseBoundaryFileText(e.target.result, file.name);
      boundaryGeoJson = parsed;
      boundaryStatus.textContent = `Boundary loaded: ${file.name}`;
      boundaryStatus.className = 'boundary-status ok';
      boundaryStatus.classList.remove('hidden');
      autosaveRecoveryDraftNow();
    } catch (err) {
      boundaryGeoJson = null;
      boundaryStatus.textContent = `Could not read boundary file. Check that it is valid GeoJSON or KML. (${err.message})`;
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
    autosaveRecoveryDraftNow();
  };
  reader.readAsDataURL(file);
});

clearLogoBtn.addEventListener('click', () => {
  atlasSettings.logoDataUrl = '';
  logoPreview.src = '';
  logoPreview.classList.add('hidden');
  clearLogoBtn.classList.add('hidden');
  logoFileInput.value = '';
  autosaveRecoveryDraftNow();
});

accentColorPicker.addEventListener('input', () => {
  accentColorHex.value = accentColorPicker.value.toUpperCase();
  atlasSettings.accentColor = accentColorPicker.value;
  autosaveRecoveryDraft();
});

accentColorHex.addEventListener('input', () => {
  const val = accentColorHex.value.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
    accentColorPicker.value = val;
    atlasSettings.accentColor = val;
    autosaveRecoveryDraft();
  }
});

function readBrandingSettings() {
  atlasSettings.companyName = document.getElementById('company-name').value.trim();
  atlasSettings.projectName = document.getElementById('project-name').value.trim();
  atlasSettings.accentColor = (/^#[0-9A-Fa-f]{6}$/.test(accentColorHex.value.trim()))
    ? accentColorHex.value.trim() : '#BF9555';
  atlasSettings.showFooter  = document.getElementById('show-footer').checked;
}

[
  atlasTitleInput,
  atlasSubtitleInput,
  labelFieldSelect,
  showAltitudeInput,
  document.getElementById('company-name'),
  document.getElementById('project-name'),
  document.getElementById('show-footer')
].forEach(input => {
  if (!input) return;
  const eventName = input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input';
  input.addEventListener(eventName, () => {
    readSettingsFromInputs();
    autosaveRecoveryDraft();
  });
});

/* Show/hide map-specific settings when output mode changes */
document.querySelectorAll('input[name="output-mode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const isAtlas = getOutputMode() === 'atlas';
    const mapSettings = document.getElementById('map-atlas-only-settings');
    if (mapSettings) mapSettings.classList.toggle('hidden', !isAtlas);
    const atlasLoadingNote = document.getElementById('atlas-loading-note');
    if (atlasLoadingNote) atlasLoadingNote.classList.toggle('hidden', !isAtlas);
    const btnLabel = document.getElementById('generate-btn-label');
    if (btnLabel) btnLabel.textContent = isAtlas ? 'Generate Printable Atlas' : 'Generate Photo Log';
    const step4Desc = document.getElementById('step-4-desc');
    if (step4Desc) step4Desc.textContent = isAtlas
      ? 'Build your printable map atlas. Each included photo gets its own page with a satellite map, caption, and location marker.'
      : 'Build your printable photo log. Photos are paired two per page with captions — no GPS required.';
    autosaveRecoveryDraftNow();
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
  autosaveRecoveryDraftNow();
  renderReviewTable();
  document.getElementById('batch-fill-value').value = '';
});

gotoGenerateBtn.addEventListener('click', () => {
  atlasSettings.title    = atlasTitleInput.value.trim();
  atlasSettings.subtitle = atlasSubtitleInput.value.trim();
  atlasSettings.labelField = labelFieldSelect.value;
  atlasSettings.bearingField = bearingFieldSelect?.value || 'auto';
  atlasSettings.showAltitude = showAltitudeInput ? showAltitudeInput.checked : true;
  atlasSettings.mapZoom  = parseInt(mapZoomSlider.value, 10);
  atlasSettings.layout   = getLayoutValue();
  atlasSettings.mode     = getOutputMode();
  readBrandingSettings();
  autosaveRecoveryDraftNow();

  const isAtlas = atlasSettings.mode === 'atlas';
  const included = isAtlas
    ? photos.filter(p => p.include && p.latitude !== null && p.longitude !== null)
    : photos.filter(p => p.include);

  const step4Desc = document.getElementById('step-4-desc');
  if (step4Desc) step4Desc.textContent = isAtlas
    ? 'Build your printable map atlas. Each included photo gets its own page with a satellite map, caption, and location marker.'
    : 'Build your printable photo log. Photos are paired two per page with captions — no GPS required.';

  const atlasLoadingNote = document.getElementById('atlas-loading-note');
  if (atlasLoadingNote) atlasLoadingNote.classList.toggle('hidden', !isAtlas);

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
  atlasSettings.bearingField = bearingFieldSelect?.value || 'auto';
  atlasSettings.showAltitude = showAltitudeInput ? showAltitudeInput.checked : true;
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
    const message = String(err?.message || err || '');
    const largePhotoHint = /invalid string length|out of memory|allocation/i.test(message)
      ? 'Generation failed because the selected photos are too large for the browser to pack into one printable HTML file. Try fewer photos, resize/compress the photos first, or split the atlas into smaller batches.'
      : `Generation failed: ${message}`;
    window.baAnalytics?.track('generation_failed', {
      output_mode: isAtlas ? 'atlas' : 'photo_log',
      failure_reason: /invalid string length|out of memory|allocation/i.test(message) ? 'large_photos' : 'other',
      photo_count_bucket: window.baAnalytics.photoCountBucket(included.length)
    });
    generateError.textContent = largePhotoHint;
    generateError.classList.remove('hidden');
    generateAtlasBtn.disabled = false;
    generateAtlasBtn.innerHTML = svgIcon + ` <span id="generate-btn-label">${isAtlas ? 'Generate Printable Atlas' : 'Generate Photo Log'}</span>`;
    return;
  }

  window.baAnalytics?.track('deliverable_generated', {
    output_mode: isAtlas ? 'atlas' : 'photo_log',
    layout: atlasSettings.layout,
    photo_count_bucket: window.baAnalytics.photoCountBucket(included.length),
    boundary_used: boundaryGeoJson ? 'yes' : 'no',
    watermark_status: paid ? 'clean' : 'watermarked'
  });

  generateAtlasBtn.disabled = false;
  generateAtlasBtn.innerHTML = svgIcon + ` <span id="generate-btn-label">${isAtlas ? 'Regenerate Atlas' : 'Regenerate Photo Log'}</span>`;

  const step5El = document.getElementById('step-5');
  step5El.classList.remove('hidden');
  downloadCsvBtn.disabled = false;
  downloadGeojsonBtn.disabled = false;
  if (downloadDraftBtn) downloadDraftBtn.disabled = false;
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
    if (photos.length) {
      currentProjectManifest = buildProjectManifest();
      currentProjectKey = buildProjectKey(currentProjectManifest);
      const draft = buildReviewDraft();
      saveRecoveryDraftToStorage();
      triggerDownload(JSON.stringify(draft, null, 2), getDraftFilename(), 'application/geo+json');
    }

    unlockExportBtn.disabled = true;
    unlockExportBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Connecting to Stripe\u2026';

    const resetBtn = () => {
      unlockExportBtn.disabled = false;
      unlockExportBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Unlock Clean Export \u2014 $15 CAD/site';
    };

    try {
      await refreshPaymentFingerprint(currentProjectManifest);
      const requestId = makeClientRequestId();
      const checkoutOptions = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:       atlasSettings.title       || '',
          projectName: atlasSettings.projectName || '',
          projectKey: currentProjectFingerprint,
          manifestHashes: currentManifestHashes,
          requestId
        })
      };
      let data;
      if (window.baAccounts?.isSignedIn()) {
        data = await window.baAccounts.accountFetch('/api/create-checkout-session', checkoutOptions);
      } else {
        const res = await fetch('/api/create-checkout-session', checkoutOptions);
        data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not start checkout');
      }
      if (data.entitled) {
        stripeTab?.close();
        window.baSetTeamEntitlement?.(true);
        window.autoDownloadCleanExport?.();
        return;
      }
      const payment = {
        projectFingerprint: currentProjectFingerprint,
        manifestHashes: currentManifestHashes,
        purchaseToken: data.purchaseToken
      };
      rememberPendingSession(data.sessionId, currentProjectKey, currentProjectManifest, payment);
      window.baAnalytics?.track('begin_checkout', {
        currency: 'CAD',
        value: 15,
        items: [{
          item_id: 'photo_atlas_site',
          item_name: 'Photo Log Atlas Site Export',
          price: 15,
          quantity: 1
        }]
      });

      if (!stripeTab) {
        /* Popup was blocked — abort entirely rather than navigating away and
           losing the user's photo session. Show a clear message instead. */
        const hint = document.getElementById('export-hint');
        if (hint) {
          hint.innerHTML = '<strong style="color:#f87171">Popup blocked.</strong> Please allow popups for this site in your browser, then click the button again.';
        }
        resetBtn();
        return;
      }

      stripeTab.location.href = data.url;

      unlockExportBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Waiting for payment\u2026';

      function handleUnlock() {
        clearInterval(serverPoll);
        rememberPaidSession(sessionId, currentProjectKey, currentProjectManifest, payment);
        window.baAnalytics?.trackPurchase(sessionId);
        setPaid(true, currentProjectKey, 'purchase');
        const downloaded = window.autoDownloadCleanExport?.();
        const hint = document.getElementById('export-hint');
        if (hint) {
          hint.textContent = downloaded === false
            ? 'Export unlocked — click Download Printable HTML below to save your clean file.'
            : 'Payment confirmed — your clean file is downloading now.';
        }
      }

      /* Poll our own server every 2 seconds asking "has this session been paid?"
         No cross-tab communication needed — completely independent of the popup. */
      const sessionId = data.sessionId;
      const serverPoll = setInterval(async () => {
        try {
          const paidNow = await verifyCheckoutSession(sessionId, payment);
          if (paidNow) handleUnlock();
        } catch (_) { /* ignore transient network errors, keep polling */ }
      }, 2000);

      /* Stop polling after 15 minutes */
      setTimeout(() => {
        clearInterval(serverPoll);
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

  const headers = ['photoNumber', 'fileName', 'date', 'comment', 'path', 'latitude', 'longitude', 'relativeAltitude', 'bearingDegree', 'bearingSource', 'bearingManual', 'flightYawDegree'];
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
  window.baAnalytics?.track('csv_downloaded', {
    photo_count_bucket: window.baAnalytics.photoCountBucket(included.length)
  });
});

if (downloadDraftBtn) {
  downloadDraftBtn.addEventListener('click', downloadReviewDraft);
}

window.addEventListener('beforeunload', e => {
  if (!photos.length || suppressBeforeUnloadWarning) return;
  autosaveRecoveryDraftNow();
  e.preventDefault();
  e.returnValue = '';
});

/* ---- GeoJSON export -------------------------------------- */

downloadGeojsonBtn.addEventListener('click', () => {
  const included = photos.filter(p => p.include);
  if (included.length === 0) { alert('No photos selected for export.'); return; }

  const features = included.map(p => {
    const props = {
      photoNumber:      p.photoNumber,
      fileName:         p.fileName,
      relativePath:     p.relativePath || p.fileName,
      fileSize:         p.fileSize || null,
      lastModified:     p.lastModified || null,
      date:             p.date,
      comment:          p.comment,
      include:          p.include !== false,
      ...(p.localQgisPath ? { path: p.localQgisPath } : {}),
      RelativeAltitude: p.relativeAltitude,
      bearingDegree:    p.bearingDegree,
      bearingSource:    p.bearingSource || '',
      bearingManual:    !!p.bearingManual,
      FlightYawDegree:  p.flightYawDegree,
      GimbalYawDegree:  p.gimbalYawDegree
    };

    const exifKeys = ['Make', 'Model', 'GPSAltitude', 'AbsoluteAltitude',
                      'GPSImgDirection', 'GPSImgDirectionRef', 'GPSDestBearing',
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
  window.baAnalytics?.track('geojson_downloaded', {
    photo_count_bucket: window.baAnalytics.photoCountBucket(included.length)
  });
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

loadStoredRecoveryDraft('Found an autosaved review draft. Select the matching photo folder and extract EXIF to restore comments, selected photos, order, and settings.');
