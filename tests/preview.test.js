'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../preview-server');

test('preview isolates payments, analytics, and private app files', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(base);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(page.headers.get('x-robots-tag'), /noindex/);
    assert.match(html, /MOBILE PDF DEVELOPMENT PREVIEW/);
    assert.doesNotMatch(html, /googletagmanager\.com/);
    assert.match(html, /script\.js/);
    const analytics = await fetch(base + '/analytics.js');
    assert.doesNotMatch(await analytics.text(), /G-ZFZDHL01B0|gtag\(/);
    for (const [route, method] of [
      ['/api/create-checkout-session', 'POST'],
      ['/api/verify-session?session_id=cs_live_example', 'GET'],
      ['/api/admin-unlock?token=example', 'GET']
    ]) {
      const response = await fetch(base + route, { method });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).paid, false);
    }
    for (const route of ['/server.js', '/.replit', '/package.json', '/docs/MOBILE_PDF_RELEASE.md']) {
      assert.equal((await fetch(base + route)).status, 404);
    }
    for (const route of ['/script.js', '/atlas.js', '/photolog.js', '/styles.css', '/logo.svg']) {
      assert.equal((await fetch(base + route)).status, 200);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
