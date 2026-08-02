'use strict';

const express = require('express');
const path = require('path');
const { randomUUID } = require('crypto');
const { createAuth } = require('./lib/auth');
const { createStore } = require('./lib/store');
const {
  hashToken,
  isTeamEntitled,
  manifestsMatch,
  normalizeManifestHashes,
  stripeId,
  subscriptionPeriodEnd,
  tokenMatches,
  validateIdempotencyKey,
  validateProjectKey
} = require('./lib/payment');

const DEFAULT_STRIPE_PRICE_ID = 'price_1TdahYKFeei8JqvyZd29hF3r';
const MAX_DRAFT_BYTES = 1_500_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value, maxLength = 200) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function getBaseUrl(req, env) {
  if (env.PUBLIC_APP_URL) return env.PUBLIC_APP_URL.replace(/\/$/, '');
  if (env.REPLIT_DOMAINS) {
    const domain = env.REPLIT_DOMAINS.split(',')[0].trim();
    if (domain) return `https://${domain}`;
  }
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.get('host')).split(',')[0].trim();
  return `${proto}://${host}`;
}

function getRequestOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.get('host')).split(',')[0].trim();
  return `${proto}://${host}`;
}

function requireSameOrigin(env) {
  return (req, res, next) => {
    const origin = req.get('origin');
    if (!origin) return next();
    try {
      const allowed = new Set([
        getRequestOrigin(req),
        env.PUBLIC_APP_URL,
        ...String(env.CLERK_AUTHORIZED_PARTIES || '').split(','),
        ...String(env.REPLIT_DOMAINS || '').split(',').map(domain => domain.trim() ? `https://${domain.trim()}` : '')
      ].filter(Boolean).map(value => new URL(value).origin));
      if (allowed.has(new URL(origin).origin)) return next();
    } catch (_) {
      // Fall through to a standard forbidden response.
    }
    return res.status(403).json({ error: 'Cross-origin request blocked.' });
  };
}

function subscriptionSnapshot(subscription) {
  return {
    stripeCustomerId: stripeId(subscription.customer),
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
    currentPeriodEnd: subscriptionPeriodEnd(subscription),
    cancelAtPeriodEnd: !!subscription.cancel_at_period_end
  };
}

function createApp(options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  const app = express();
  const store = options.store || createStore({ connectionString: env.DATABASE_URL });
  const durableStore = options.allowMemoryStore === true || store.kind === 'postgres';
  const auth = createAuth({
    authResolver: options.authResolver,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    secretKey: env.CLERK_SECRET_KEY,
    authorizedParties: env.CLERK_AUTHORIZED_PARTIES
  });
  const stripe = options.stripe || (env.STRIPE_SECRET_KEY ? require('stripe')(env.STRIPE_SECRET_KEY) : null);
  const sitePriceId = env.STRIPE_PRICE_ID || DEFAULT_STRIPE_PRICE_ID;
  const teamPriceId = env.STRIPE_TEAM_PRICE_ID || '';
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET || '';
  const logger = options.logger || console;
  let databaseReady = false;
  let databaseError = null;

  const ready = Promise.resolve()
    .then(() => store.init())
    .then(() => { databaseReady = true; })
    .catch(err => {
      databaseError = err;
      logger.error('[Database] initialization failed:', err.message);
    });

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(auth.middleware);
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  async function requireDatabase(_req, res, next) {
    await ready;
    if (!databaseReady || !durableStore) {
      return res.status(503).json({
        error: 'Account and payment records are temporarily unavailable. No charge has been created.'
      });
    }
    return next();
  }

  async function updateSubscription(subscription, fallbackSubjectKey = null) {
    const customerId = stripeId(subscription.customer);
    let subjectKey = subscription.metadata?.subject_key || fallbackSubjectKey;
    if (!subjectKey && customerId) {
      subjectKey = (await store.findBillingByCustomer(customerId))?.subjectKey || null;
    }
    if (!subjectKey) throw new Error(`No billing subject for subscription ${subscription.id}`);
    return store.upsertBillingAccount({ subjectKey, ...subscriptionSnapshot(subscription) });
  }

  async function markSitePurchasePaid(session) {
    if (session.metadata?.app !== 'photo_atlas' || session.metadata?.kind !== 'site_export') return null;
    const purchaseId = session.metadata.purchase_id || session.client_reference_id;
    if (!purchaseId || session.payment_status !== 'paid') return null;
    return store.markPurchasePaid({
      purchaseId,
      sessionId: session.id,
      paymentIntentId: stripeId(session.payment_intent),
      amountTotal: session.amount_total,
      currency: session.currency
    });
  }

  async function processStripeEvent(event) {
    if (await store.eventAlreadyProcessed(event.id)) return;
    const object = event.data.object;

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      if (object.metadata?.kind === 'site_export') {
        await markSitePurchasePaid(object);
      } else if (object.metadata?.kind === 'team_subscription' && object.subscription) {
        const subscription = await stripe.subscriptions.retrieve(stripeId(object.subscription));
        await updateSubscription(subscription, object.metadata.subject_key || null);
      }
    }

    if (
      event.type === 'customer.subscription.created'
      || event.type === 'customer.subscription.updated'
      || event.type === 'customer.subscription.deleted'
    ) {
      await updateSubscription(object);
    }

    await store.recordStripeEvent(event.id, event.type);
  }

  app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    await ready;
    if (!stripe || !webhookSecret || !databaseReady || !durableStore) {
      return res.status(503).send('Stripe webhook is not configured.');
    }
    const signature = req.get('stripe-signature');
    if (!signature) return res.status(400).send('Missing Stripe signature.');

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch (err) {
      logger.warn('[Stripe] webhook signature:', err.message);
      return res.status(400).send(`Webhook error: ${err.message}`);
    }
    try {
      await processStripeEvent(event);
      return res.json({ received: true });
    } catch (err) {
      logger.error('[Stripe] webhook processing:', err.message);
      return res.status(500).send('Webhook processing failed.');
    }
  });

  app.use(express.json({ limit: '2mb' }));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', requireSameOrigin(env));

  app.get('/api/config', async (_req, res) => {
    await ready;
    const dataReady = databaseReady && durableStore;
    res.json({
      accountsEnabled: auth.enabled && dataReady,
      clerkPublishableKey: auth.enabled ? auth.publishableKey : '',
      cloudDraftsEnabled: auth.enabled && dataReady,
      teamBillingEnabled: auth.enabled && dataReady && !!teamPriceId,
      photosStayLocal: true
    });
  });

  app.get('/api/health', async (_req, res) => {
    await ready;
    let database = databaseReady && durableStore;
    if (database) {
      try { await store.health(); } catch (_) { database = false; }
    }
    const healthy = database && !!stripe && !!webhookSecret;
    res.status(healthy ? 200 : 503).json({
      ok: healthy,
      database,
      stripe: !!stripe,
      stripeWebhook: !!webhookSecret,
      accounts: auth.enabled,
      error: databaseError ? 'database_initialization_failed' : undefined
    });
  });

  app.post('/api/create-checkout-session', requireDatabase, async (req, res) => {
    if (!stripe || !webhookSecret) {
      return res.status(503).json({ error: 'Payments are temporarily unavailable. No charge has been created.' });
    }

    const projectKey = validateProjectKey(req.body?.projectKey);
    const manifestHashes = normalizeManifestHashes(req.body?.manifestHashes);
    const idempotencyKey = validateIdempotencyKey(req.body?.requestId);
    if (!projectKey || !manifestHashes || !idempotencyKey) {
      return res.status(400).json({ error: 'The photo-set payment fingerprint is missing or invalid.' });
    }

    const requestAuth = auth.read(req);
    const workspace = auth.workspace(requestAuth);
    if (workspace?.type === 'organization') {
      const billing = await store.getBillingAccount(workspace.subjectKey);
      if (isTeamEntitled(billing)) {
        return res.json({ entitled: true, entitlement: 'team' });
      }
    }

    const purchase = await store.createPurchase({
      id: randomUUID(),
      idempotencyKey,
      subjectKey: workspace?.subjectKey || null,
      createdByUserId: workspace?.userId || null,
      projectKey,
      manifestHashes,
      tokenHash: hashToken(idempotencyKey)
    });

    if (purchase.projectKey !== projectKey) {
      return res.status(409).json({ error: 'This checkout request was already used for another photo set.' });
    }

    try {
      let session;
      if (purchase.checkoutSessionId) {
        session = await stripe.checkout.sessions.retrieve(purchase.checkoutSessionId);
      } else {
        const baseUrl = getBaseUrl(req, env);
        const title = cleanText(req.body?.title, 120);
        const projectName = cleanText(req.body?.projectName, 120);
        const descriptionParts = [title, projectName].filter(Boolean);
        const description = descriptionParts.length
          ? `Photo Atlas — ${descriptionParts.join(' / ')}`
          : 'Photo Atlas clean export';

        session = await stripe.checkout.sessions.create({
          mode: 'payment',
          line_items: [{ price: sitePriceId, quantity: 1 }],
          success_url: `${baseUrl}/?checkout=success#session_id={CHECKOUT_SESSION_ID}&purchase_token=${encodeURIComponent(idempotencyKey)}`,
          cancel_url: `${baseUrl}/?checkout=cancelled`,
          client_reference_id: purchase.id,
          metadata: {
            app: 'photo_atlas',
            kind: 'site_export',
            purchase_id: purchase.id,
            project_key: projectKey
          },
          payment_intent_data: {
            description,
            metadata: {
              app: 'photo_atlas',
              purchase_id: purchase.id,
              ...(title ? { surface_location: title } : {}),
              ...(projectName ? { project: projectName } : {})
            }
          }
        }, { idempotencyKey: `photo-atlas:${purchase.id}` });
        await store.attachCheckoutSession(purchase.id, session);
      }

      return res.json({
        url: session.url,
        sessionId: session.id,
        purchaseToken: idempotencyKey,
        entitled: false
      });
    } catch (err) {
      logger.error('[Stripe] create-checkout-session:', err.message);
      return res.status(502).json({ error: 'Stripe could not start checkout. No charge has been created.' });
    }
  });

  app.post('/api/verify-session', requireDatabase, async (req, res) => {
    if (!stripe) return res.status(503).json({ error: 'Payments are temporarily unavailable.', paid: false });
    const sessionId = cleanText(req.body?.sessionId, 255);
    const purchaseToken = String(req.body?.purchaseToken || '');
    const projectKey = validateProjectKey(req.body?.projectKey);
    const manifestHashes = normalizeManifestHashes(req.body?.manifestHashes);
    if (!sessionId || !purchaseToken || !projectKey || !manifestHashes) {
      return res.status(400).json({ error: 'Missing payment recovery details.', paid: false });
    }

    let purchase = await store.findPurchaseBySession(sessionId);
    if (!purchase || !tokenMatches(purchaseToken, purchase.tokenHash)) {
      return res.status(404).json({ error: 'Payment record not found.', paid: false });
    }
    if (!manifestsMatch(purchase, projectKey, manifestHashes)) {
      return res.status(409).json({ error: 'This payment belongs to a different photo set.', paid: false });
    }

    if (purchase.status !== 'paid') {
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (
          session.payment_status === 'paid'
          && session.metadata?.app === 'photo_atlas'
          && session.metadata?.purchase_id === purchase.id
        ) {
          purchase = await markSitePurchasePaid(session) || purchase;
        }
      } catch (err) {
        logger.warn('[Stripe] verify-session retrieval failed:', err.message);
      }
    }

    return res.json({ paid: purchase.status === 'paid', projectMatched: true });
  });

  // Temporary compatibility for tabs that began Checkout before this branch was deployed.
  app.get('/api/verify-session', async (req, res) => {
    if (!stripe) return res.status(503).json({ error: 'Payments are temporarily unavailable.', paid: false });
    const sessionId = cleanText(req.query.session_id, 255);
    if (!sessionId) return res.status(400).json({ error: 'Missing session_id', paid: false });
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items'] });
      if (session.metadata?.app === 'photo_atlas') {
        return res.status(400).json({ error: 'Secure payment recovery details are required.', paid: false });
      }
      const expectedPrice = session.line_items?.data?.some(item => item.price?.id === sitePriceId);
      const paid = session.mode === 'payment' && session.payment_status === 'paid' && !!expectedPrice;
      return res.json({ paid, legacyRecovery: true });
    } catch (err) {
      logger.warn('[Stripe] legacy verify-session:', err.message);
      return res.status(404).json({ error: 'Checkout session not found.', paid: false });
    }
  });

  app.get('/api/account', auth.requireUser, requireDatabase, async (req, res) => {
    const workspace = auth.workspace(req.photoAtlasAuth);
    const billing = await store.getBillingAccount(workspace.subjectKey);
    res.json({
      workspace: { type: workspace.type, orgId: workspace.orgId },
      teamEntitled: workspace.type === 'organization' && isTeamEntitled(billing),
      subscriptionStatus: workspace.type === 'organization' ? billing?.subscriptionStatus || null : null,
      cancelAtPeriodEnd: !!billing?.cancelAtPeriodEnd,
      currentPeriodEnd: billing?.currentPeriodEnd || null
    });
  });

  app.post('/api/account/project-entitlement', auth.requireUser, requireDatabase, async (req, res) => {
    const projectKey = validateProjectKey(req.body?.projectKey);
    const manifestHashes = normalizeManifestHashes(req.body?.manifestHashes);
    if (!projectKey || !manifestHashes) {
      return res.status(400).json({ error: 'Invalid photo-set fingerprint.' });
    }
    const workspace = auth.workspace(req.photoAtlasAuth);
    if (workspace.type === 'organization') {
      const billing = await store.getBillingAccount(workspace.subjectKey);
      if (isTeamEntitled(billing)) {
        return res.json({ entitled: true, source: 'team' });
      }
    }
    const purchases = await store.findPaidPurchases(workspace.subjectKey);
    const matching = purchases.find(purchase => manifestsMatch(purchase, projectKey, manifestHashes));
    return res.json({ entitled: !!matching, source: matching ? 'purchase' : null });
  });

  app.get('/api/drafts', auth.requireUser, requireDatabase, async (req, res) => {
    const workspace = auth.workspace(req.photoAtlasAuth);
    const isAdmin = auth.isOrgAdmin(req.photoAtlasAuth);
    const drafts = (await store.listDrafts(workspace.ownerKey)).map(draft => {
      const { createdByUserId, ...safeDraft } = draft;
      return { ...safeDraft, canDelete: createdByUserId === workspace.userId || isAdmin };
    });
    res.json({ drafts });
  });

  app.get('/api/drafts/:id', auth.requireUser, requireDatabase, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid draft ID.' });
    const workspace = auth.workspace(req.photoAtlasAuth);
    const draft = await store.getDraft(workspace.ownerKey, req.params.id);
    if (!draft) return res.status(404).json({ error: 'Saved session not found.' });
    const { createdByUserId, ...safeDraft } = draft;
    return res.json(safeDraft);
  });

  app.put(['/api/drafts', '/api/drafts/:id'], auth.requireUser, requireDatabase, async (req, res) => {
    const id = req.params.id || null;
    if (id && !UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid draft ID.' });
    const draft = req.body?.draft;
    if (!draft || draft.type !== 'FeatureCollection' || !Array.isArray(draft.features)) {
      return res.status(400).json({ error: 'Invalid Photo Atlas session.' });
    }
    const draftBytes = Buffer.byteLength(JSON.stringify(draft), 'utf8');
    if (draftBytes > MAX_DRAFT_BYTES) {
      return res.status(413).json({ error: 'This session metadata is too large to save online.' });
    }
    const workspace = auth.workspace(req.photoAtlasAuth);
    const saved = await store.saveDraft({
      id,
      ownerKey: workspace.ownerKey,
      createdByUserId: workspace.userId,
      title: cleanText(req.body?.title, 160),
      projectName: cleanText(req.body?.projectName, 160),
      projectKey: cleanText(req.body?.projectKey, 128),
      photoCount: Math.min(Number(req.body?.photoCount) || draft.features.length, 100000),
      draft
    });
    if (!saved) return res.status(409).json({ error: 'That saved session belongs to another workspace.' });
    const { createdByUserId, ...safeDraft } = saved;
    return res.json({ draft: safeDraft });
  });

  app.delete('/api/drafts/:id', auth.requireUser, requireDatabase, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid draft ID.' });
    const workspace = auth.workspace(req.photoAtlasAuth);
    const draft = await store.getDraft(workspace.ownerKey, req.params.id);
    if (!draft) return res.status(404).end();
    if (draft.createdByUserId !== workspace.userId && !auth.isOrgAdmin(req.photoAtlasAuth)) {
      return res.status(403).json({ error: 'Only the session creator or a company administrator can delete it.' });
    }
    const removed = await store.deleteDraft(workspace.ownerKey, req.params.id);
    return res.status(removed ? 204 : 404).end();
  });

  app.post('/api/billing/team-checkout', auth.requireUser, requireDatabase, async (req, res) => {
    if (!stripe || !webhookSecret || !teamPriceId) {
      return res.status(503).json({ error: 'Team billing is not configured yet.' });
    }
    const workspace = auth.workspace(req.photoAtlasAuth);
    if (workspace.type !== 'organization') {
      return res.status(400).json({ error: 'Create or select a company workspace first.' });
    }
    if (!auth.isOrgAdmin(req.photoAtlasAuth)) {
      return res.status(403).json({ error: 'Only a company administrator can change billing.' });
    }
    const billing = await store.getBillingAccount(workspace.subjectKey);
    if (isTeamEntitled(billing)) {
      return res.status(409).json({ error: 'This company already has an active team plan.', manageBilling: true });
    }
    const requestId = validateIdempotencyKey(req.body?.requestId);
    if (!requestId) return res.status(400).json({ error: 'Missing billing request ID.' });

    try {
      let customerId = billing?.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          description: 'Photo Atlas company account',
          metadata: { app: 'photo_atlas', subject_key: workspace.subjectKey, clerk_org_id: workspace.orgId }
        }, { idempotencyKey: `photo-atlas-customer:${workspace.orgId}` });
        customerId = customer.id;
        await store.upsertBillingAccount({ subjectKey: workspace.subjectKey, stripeCustomerId: customerId });
      }
      const baseUrl = getBaseUrl(req, env);
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: teamPriceId, quantity: 1 }],
        allow_promotion_codes: true,
        success_url: `${baseUrl}/?team_checkout=success`,
        cancel_url: `${baseUrl}/?team_checkout=cancelled`,
        metadata: {
          app: 'photo_atlas', kind: 'team_subscription',
          subject_key: workspace.subjectKey, clerk_org_id: workspace.orgId
        },
        subscription_data: {
          metadata: {
            app: 'photo_atlas', subject_key: workspace.subjectKey, clerk_org_id: workspace.orgId
          }
        }
      }, { idempotencyKey: `photo-atlas-team:${workspace.orgId}:${Math.floor(Date.now() / 86_400_000)}` });
      return res.json({ url: session.url });
    } catch (err) {
      logger.error('[Stripe] team checkout:', err.message);
      return res.status(502).json({ error: 'Stripe could not start team checkout. No charge has been created.' });
    }
  });

  app.post('/api/billing/portal', auth.requireUser, requireDatabase, async (req, res) => {
    if (!stripe) return res.status(503).json({ error: 'Billing is temporarily unavailable.' });
    const workspace = auth.workspace(req.photoAtlasAuth);
    if (workspace.type !== 'organization' || !auth.isOrgAdmin(req.photoAtlasAuth)) {
      return res.status(403).json({ error: 'Only a company administrator can manage billing.' });
    }
    const billing = await store.getBillingAccount(workspace.subjectKey);
    if (!billing?.stripeCustomerId) return res.status(404).json({ error: 'No company billing account exists yet.' });
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: billing.stripeCustomerId,
        return_url: getBaseUrl(req, env)
      });
      return res.json({ url: session.url });
    } catch (err) {
      logger.error('[Stripe] billing portal:', err.message);
      return res.status(502).json({ error: 'Stripe could not open the billing portal.' });
    }
  });

  const root = __dirname;
  app.use('/assets', express.static(path.join(root, 'assets'), { fallthrough: false, maxAge: '1h' }));
  app.use('/replit_handoff/assets', express.static(path.join(root, 'replit_handoff/assets'), {
    fallthrough: false, maxAge: '1h'
  }));

  const publicFiles = [
    'index.html', 'styles.css', 'script.js', 'accounts.js', 'atlas.js',
    'photolog.js', 'analytics.js', 'logo.svg', 'generated-icon.png'
  ];
  publicFiles.forEach(file => {
    app.get(`/${file}`, (_req, res) => res.sendFile(path.join(root, file)));
  });
  app.get('/', (_req, res) => res.sendFile(path.join(root, 'index.html')));
  app.use((_req, res) => res.status(404).send('Not found'));
  app.use((err, _req, res, _next) => {
    logger.error('[HTTP]', err.message);
    res.status(err.status === 404 ? 404 : 500).send(err.status === 404 ? 'Not found' : 'Server error');
  });

  app.locals.photoAtlas = { auth, durableStore, ready, store };
  return app;
}

module.exports = { createApp, cleanText, getBaseUrl, getRequestOrigin, subscriptionSnapshot };
