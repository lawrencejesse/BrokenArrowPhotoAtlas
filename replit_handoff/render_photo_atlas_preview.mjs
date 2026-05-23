import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , htmlPathArg, pngPathArg] = process.argv;

if (!htmlPathArg || !pngPathArg) {
  console.error('Usage: node render_photo_atlas_preview.mjs <input.html> <output.png>');
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
const pngPath = path.resolve(pngPathArg);

const browser = await playwright.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });

await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.photoAtlasReady === true, { timeout: 15000 });
await page.waitForTimeout(3000);

const firstPage = page.locator('.photo-page').first();
await firstPage.screenshot({ path: pngPath });

await browser.close();
