'use strict';
const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

function getBaseUrl(req) {
  if (process.env.REPLIT_DOMAINS) {
    const domain = process.env.REPLIT_DOMAINS.split(',')[0];
    return `https://${domain}`;
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host  = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

app.post('/api/create-checkout-session', async (req, res) => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId   = process.env.STRIPE_PRICE_ID;

  if (!secretKey || !priceId) {
    return res.status(503).json({
      error: 'Stripe is not configured. Add STRIPE_SECRET_KEY and STRIPE_PRICE_ID to your Replit Secrets.'
    });
  }

  try {
    const stripe  = require('stripe')(secretKey);
    const baseUrl = getBaseUrl(req);
    const successUrl = `${baseUrl}/?session_id={CHECKOUT_SESSION_ID}`;
    console.log('[Stripe] baseUrl:', baseUrl);
    console.log('[Stripe] success_url:', successUrl);
    console.log('[Stripe] REPLIT_DOMAINS env:', process.env.REPLIT_DOMAINS);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url:  `${baseUrl}/`
    });
    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[Stripe] create-checkout-session:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/verify-session', async (req, res) => {
  const { session_id } = req.query;
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!session_id) return res.status(400).json({ error: 'Missing session_id' });
  if (!secretKey)  return res.status(503).json({ error: 'Stripe not configured', paid: false });

  try {
    const stripe  = require('stripe')(secretKey);
    const session = await stripe.checkout.sessions.retrieve(session_id);
    res.json({ paid: session.payment_status === 'paid' });
  } catch (err) {
    console.error('[Stripe] verify-session:', err.message);
    res.status(500).json({ error: err.message, paid: false });
  }
});

app.get('/api/admin-unlock', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  const { token }  = req.query;
  if (!adminToken || !token || token !== adminToken) {
    return res.status(401).json({ ok: false });
  }
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Photo Log Atlas Builder listening on port ${PORT}`);
});
