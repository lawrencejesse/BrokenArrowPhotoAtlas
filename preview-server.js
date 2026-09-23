'use strict';

// Separate entry point: preview never loads Stripe or production server.js.
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const app = express();
const root = __dirname;

app.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api', (req, res) => res.status(503).json({
  error: 'Payments are disabled in this preview. No charge was made.',
  paid: false,
  ok: false
}));
app.get('/analytics.js', (req, res) => res.type('js').send('// Analytics disabled in preview.'));
app.get(['/', '/index.html'], (req, res) => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/<script\b[^>]*src="https:\/\/www\.googletagmanager\.com[^>]*><\/script>/g, '')
    .replace('<body>', '<body><aside style="padding:12px;background:#fff3cd;color:#332701;text-align:center;font:600 15px system-ui">MOBILE PDF DEVELOPMENT PREVIEW &middot; Payments disabled &middot; Existing HTML workflow only</aside>');
  res.type('html').send(html);
});
// Serve app assets only. Do not expose source, configuration, or baseline notes.
for (const file of ['script.js', 'atlas.js', 'photolog.js', 'styles.css', 'logo.svg', 'generated-icon.png']) {
  app.get('/' + file, (req, res) => res.sendFile(path.join(root, file)));
}
app.use('/assets', express.static(path.join(root, 'assets'), { dotfiles: 'deny' }));
app.use((req, res) => res.sendStatus(404));

if (require.main === module) {
  const port = Number(process.env.PORT || 5011);
  const host = process.env.PREVIEW_HOST || '127.0.0.1';
  app.listen(port, host, () => console.log(`PhotoLog preview: http://${host}:${port}`));
}
module.exports = app;
