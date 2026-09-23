'use strict';

(function initMobilePdf() {
  const create = document.getElementById('create-photo-log-pdf');
  const save = document.getElementById('save-photo-log-pdf');
  const share = document.getElementById('share-photo-log-pdf');
  const note = document.getElementById('pdf-generate-note');
  const status = document.getElementById('pdf-export-status');
  const htmlButton = document.getElementById('generate-atlas-btn');
  const phoneLayout = window.matchMedia('(max-width: 760px)').matches;
  let pdf = null;
  let filename = '';

  function invalidate(reason) {
    pdf = null;
    save.disabled = true;
    share.disabled = true;
    save.classList.add('hidden');
    share.classList.add('hidden');
    if (!status.classList.contains('hidden')) {
      status.textContent = reason === 'payment'
        ? 'Export unlocked. Create the PDF again for a clean copy.'
        : 'Photos or settings changed. Create the PDF again to include your edits.';
    }
  }
  window.invalidateMobilePdf = invalidate;

  function updateMode() {
    const selected = getOutputMode() === 'photolog';
    create.classList.toggle('hidden', !selected);
    note.classList.toggle('hidden', !selected);
    htmlButton.classList.toggle('mobile-hide-html', selected);
    if (!selected) invalidate();
  }

  document.querySelectorAll('input[name="output-mode"]').forEach(radio => radio.addEventListener('change', updateMode));
  document.getElementById('review-tbody').addEventListener('input', invalidate);
  document.getElementById('review-tbody').addEventListener('change', invalidate);
  document.getElementById('review-tbody').addEventListener('drop', invalidate);
  document.getElementById('review-tbody').addEventListener('click', event => {
    if (event.target.closest('.move-up, .move-down')) invalidate();
  });
  document.getElementById('step-3').addEventListener('input', invalidate);
  document.getElementById('step-3').addEventListener('change', invalidate);
  document.getElementById('photo-preview-comment')?.addEventListener('input', invalidate);
  for (const id of ['select-all-btn', 'deselect-all-btn', 'batch-fill-btn', 'extract-btn']) {
    document.getElementById(id)?.addEventListener('click', invalidate);
  }
  function preferPhotoLog() {
    const radio = document.getElementById('mode-photolog');
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (phoneLayout && photos.length === 0 && !pendingDraft) preferPhotoLog();
  document.getElementById('start-new-btn')?.addEventListener('click', () => {
    invalidate();
    if (phoneLayout) preferPhotoLog();
  });
  for (const id of ['photo-files', 'photo-folder']) {
    document.getElementById(id)?.addEventListener('change', () => {
      invalidate();
      if (phoneLayout && !extractBtn.disabled) extractBtn.click();
    });
  }
  updateMode();

  function currentSettings() {
    atlasSettings.title = atlasTitleInput.value.trim();
    atlasSettings.subtitle = atlasSubtitleInput.value.trim();
    atlasSettings.labelField = labelFieldSelect.value;
    atlasSettings.showAltitude = showAltitudeInput ? showAltitudeInput.checked : true;
    atlasSettings.mode = getOutputMode();
    readBrandingSettings();
    return { ...atlasSettings };
  }

  create.addEventListener('click', async () => {
    const included = photos.filter(photo => photo.include);
    if (!included.length) {
      generateError.textContent = 'Select at least one photo for the PDF.';
      generateError.classList.remove('hidden');
      return;
    }
    if (getOutputMode() !== 'photolog') return;
    invalidate();
    generateError.classList.add('hidden');
    create.disabled = true;
    const originalLabel = create.textContent;
    create.textContent = 'Preparing PDF...';
    note.textContent = `Preparing 0 of ${included.length} photos on this device...`;
    try {
      const settings = currentSettings();
      const result = await buildBrowserPhotoLogPdf(included, settings, !paid, (done, total) => {
        note.textContent = `Preparing ${done} of ${total} photos on this device...`;
      });
      pdf = result.blob;
      const safeName = (settings.title || 'photo_log').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_') || 'photo_log';
      filename = `${safeName}.pdf`;
      save.disabled = false;
      save.classList.remove('hidden');
      const file = new File([pdf], filename, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        share.disabled = false;
        share.classList.remove('hidden');
      }
      status.textContent = `${result.pages} PDF page${result.pages === 1 ? '' : 's'} ready${paid ? '' : ' with preview watermark'}. Save or share the file.${result.replacedCharacters ? ` ${result.replacedCharacters} unsupported symbol(s) became question marks.` : ''}`;
      status.classList.remove('hidden');
      note.textContent = 'PDF created on this device. Photos were not uploaded.';
      step5El.classList.remove('hidden');
      step5El.classList.add('pdf-only-export');
      step5El.querySelector('.step-desc').textContent = 'Your PDF preview is ready to save or share. Unlock a clean copy for $15 CAD/site.';
      document.getElementById('print-instructions')?.classList.add('hidden');
      downloadCsvBtn.disabled = false;
      downloadGeojsonBtn.disabled = false;
      if (downloadDraftBtn) downloadDraftBtn.disabled = false;
      if (unlockExportBtn && !paid) unlockExportBtn.disabled = false;
      updateExportUI();
      step5El.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.baAnalytics?.track('pdf_generated', { output_mode: 'photo_log', watermark_status: paid ? 'clean' : 'watermarked' });
    } catch (error) {
      console.error('PDF generation failed', error);
      generateError.textContent = `Could not create PDF: ${error.message || error}`;
      generateError.classList.remove('hidden');
      note.textContent = 'Check the error and try again with fewer photos if needed.';
    } finally {
      create.disabled = false;
      create.textContent = originalLabel;
    }
  });

  save.addEventListener('click', () => {
    if (!pdf) return;
    const url = URL.createObjectURL(pdf);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });

  share.addEventListener('click', async () => {
    if (!pdf || !navigator.share) return;
    const file = new File([pdf], filename, { type: 'application/pdf' });
    try { await navigator.share({ files: [file], title: filename }); }
    catch (error) {
      if (error.name !== 'AbortError') status.textContent = 'Sharing was unavailable. Use Save PDF instead.';
    }
  });
})();
