import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , htmlPathArg, pdfPathArg] = process.argv;

if (!htmlPathArg || !pdfPathArg) {
  console.error('Usage: node render_photo_atlas_pdf.mjs <input.html> <output.pdf>');
  process.exit(1);
}

let playwright;
try {
  playwright = await import('playwright');
} catch {
  console.error('Playwright is not installed.');
  process.exit(1);
}

const htmlPath = path.resolve(htmlPathArg);
const pdfPath = path.resolve(pdfPathArg);

const browser = await playwright.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });

page.on('console', message => {
  if (['error', 'warning'].includes(message.type())) {
    console.warn(`browser ${message.type()}: ${message.text()}`);
  }
});
page.on('pageerror', error => console.warn(`browser pageerror: ${error.message}`));
page.on('requestfailed', request => {
  const url = request.url();
  if (url.includes('unpkg') || url.includes('arcgisonline') || url.startsWith('file:')) {
    console.warn(`request failed: ${url} :: ${request.failure()?.errorText ?? 'unknown'}`);
  }
});

await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
try {
  await page.waitForFunction(() => window.photoAtlasReady === true, { timeout: 15000 });
  await page.waitForTimeout(3000);
} catch {
  console.warn('Map JavaScript did not report ready before timeout. Rendering current page state.');
}

await page.pdf({
  path: pdfPath,
  format: 'Letter',
  landscape: true,
  printBackground: true,
  preferCSSPageSize: true,
  margin: {
    top: '0.35in',
    right: '0.35in',
    bottom: '0.35in',
    left: '0.35in',
  },
});

await browser.close();
