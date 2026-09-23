'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { createPhotoLogPdf } = require('../photo-log-pdf');

const image = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.jpg')));
const settings = { title: 'Demonstration site', projectName: 'Test client', companyName: 'Broken Arrow Consulting', accentColor: '#BF9555' };

test('three photos without GPS produce a valid two-page PDF', async () => {
  const entries = [1, 2, 3].map(number => ({ photoLabel: String(number), date: '2026-09-23', comment: `Observation ${number}` }));
  const result = await createPhotoLogPdf(entries, settings, async () => image, { watermark: true });
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  assert.equal(Buffer.from(bytes.slice(0, 4)).toString(), '%PDF');
  assert.equal(result.pages, 2);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 2);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 612, height: 792 });
  if (process.env.PDF_QA_OUTPUT) fs.writeFileSync(process.env.PDF_QA_OUTPUT, bytes);
});

test('long captions get a full page and unsupported symbols are reported', async () => {
  const entries = [
    { photoLabel: '1', comment: 'A fairly long field observation. '.repeat(30) + '🌱' },
    { photoLabel: '2', comment: 'Second observation.' }
  ];
  const result = await createPhotoLogPdf(entries, settings, async () => image, { watermark: false });
  assert.equal(result.pages, 2);
  assert.equal(result.replacedCharacters, 1);
});

test('oversized caption is rejected rather than clipped', async () => {
  const entries = [{ photoLabel: '1', comment: 'Long note. '.repeat(300) }];
  await assert.rejects(createPhotoLogPdf(entries, settings, async () => image), /caption is too long/);
});
