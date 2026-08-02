'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../app');
const { MemoryStore } = require('../lib/store');
const { hashToken } = require('../lib/payment');

function fakeAuth(req) {
  const userId = req.get('x-test-user');
  if (!userId) return { isAuthenticated: false };
  const orgId = req.get('x-test-org') || null;
  const orgRole = req.get('x-test-role') || (orgId ? 'org:member' : null);
  return {
    isAuthenticated: true,
    userId,
    orgId,
    orgRole,
    has: ({ role }) => role === orgRole
  };
}

function createFakeStripe() {
  let sequence = 0;
  const sessions = new Map();
  const sessionsByKey = new Map();
  const subscriptions = new Map();
  const customers = new Map();

  return {
    sessions,
    subscriptionRecords: subscriptions,
    checkout: {
      sessions: {
        async create(params, options = {}) {
          if (options.idempotencyKey && sessionsByKey.has(options.idempotencyKey)) {
            return sessions.get(sessionsByKey.get(options.idempotencyKey));
          }
          sequence += 1;
          const id = `cs_test_${sequence}`;
          const session = {
            id,
            url: `https://checkout.test/${id}`,
            amount_total: params.mode === 'payment' ? 1500 : null,
            currency: 'cad',
            payment_status: 'unpaid',
            mode: params.mode,
            metadata: params.metadata || {},
            success_url: params.success_url,
            client_reference_id: params.client_reference_id || null,
            payment_intent: `pi_test_${sequence}`,
            line_items: { data: params.line_items.map(item => ({ price: { id: item.price } })) },
            customer: params.customer || null,
            subscription: params.mode === 'subscription' ? `sub_test_${sequence}` : null
          };
          sessions.set(id, session);
          if (options.idempotencyKey) sessionsByKey.set(options.idempotencyKey, id);
          return session;
        },
        async retrieve(id) {
          const session = sessions.get(id);
          if (!session) throw new Error('No such checkout session');
          return session;
        }
      }
    },
    customers: {
      async create(params) {
        const id = `cus_test_${customers.size + 1}`;
        const customer = { id, ...params };
        customers.set(id, customer);
        return customer;
      }
    },
    subscriptions: {
      async retrieve(id) {
        const subscription = subscriptions.get(id);
        if (!subscription) throw new Error('No such subscription');
        return subscription;
      }
    },
    billingPortal: {
      sessions: {
        async create() { return { url: 'https://billing.test/portal' }; }
      }
    },
    webhooks: {
      constructEvent(body, signature) {
        if (signature !== 'valid') throw new Error('Bad signature');
        return JSON.parse(Buffer.from(body).toString('utf8'));
      }
    }
  };
}

async function withServer(run, options = {}) {
  const store = options.store || new MemoryStore();
  const stripe = options.stripe || createFakeStripe();
  const app = createApp({
    store,
    stripe,
    allowMemoryStore: true,
    authResolver: fakeAuth,
    logger: { error() {}, warn() {}, log() {} },
    env: {
      STRIPE_SECRET_KEY: 'sk_test_fake',
      STRIPE_WEBHOOK_SECRET: 'whsec_fake',
      STRIPE_PRICE_ID: 'price_site',
      STRIPE_TEAM_PRICE_ID: 'price_team',
      CLERK_PUBLISHABLE_KEY: 'pk_test_fake',
      CLERK_SECRET_KEY: 'sk_clerk_fake',
      PUBLIC_APP_URL: 'http://127.0.0.1'
    }
  });
  await app.locals.photoAtlas.ready;
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ baseUrl, store, stripe });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function jsonRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, body };
}

const projectA = 'a'.repeat(64);
const projectB = 'b'.repeat(64);
const manifestA = ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64), '4'.repeat(64)];
const manifestB = ['5'.repeat(64), '6'.repeat(64), '7'.repeat(64), '8'.repeat(64)];

test('serves only intended public files and reports configured health', async () => {
  await withServer(async ({ baseUrl }) => {
    const home = await fetch(`${baseUrl}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Saved sessions &amp; company billing/);

    assert.equal((await fetch(`${baseUrl}/package.json`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/server.js`)).status, 404);

    const health = await jsonRequest(baseUrl, '/api/health');
    assert.equal(health.response.status, 200);
    assert.equal(health.body.ok, true);
  });
});

test('checkout is idempotent and unlock is bound to token and photo manifest', async () => {
  await withServer(async ({ baseUrl, stripe }) => {
    const requestId = 'request_1234567890abcdef';
    const checkoutBody = JSON.stringify({
      title: '12-34 Test', projectName: 'Demo', projectKey: projectA,
      manifestHashes: manifestA, requestId
    });
    const first = await jsonRequest(baseUrl, '/api/create-checkout-session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: checkoutBody
    });
    const second = await jsonRequest(baseUrl, '/api/create-checkout-session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: checkoutBody
    });
    assert.equal(first.response.status, 200);
    assert.equal(second.body.sessionId, first.body.sessionId);
    assert.equal(stripe.sessions.size, 1);

    const session = stripe.sessions.get(first.body.sessionId);
    assert.match(session.success_url, /#session_id=\{CHECKOUT_SESSION_ID\}&purchase_token=/);
    session.payment_status = 'paid';

    const insecureFallback = await jsonRequest(baseUrl, `/api/verify-session?session_id=${session.id}`);
    assert.equal(insecureFallback.response.status, 400);

    const wrongToken = await jsonRequest(baseUrl, '/api/verify-session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id, purchaseToken: 'wrong-token-value',
        projectKey: projectA, manifestHashes: manifestA
      })
    });
    assert.equal(wrongToken.response.status, 404);

    const wrongProject = await jsonRequest(baseUrl, '/api/verify-session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id, purchaseToken: requestId,
        projectKey: projectB, manifestHashes: manifestB
      })
    });
    assert.equal(wrongProject.response.status, 409);

    const verified = await jsonRequest(baseUrl, '/api/verify-session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id, purchaseToken: requestId,
        projectKey: projectA, manifestHashes: manifestA
      })
    });
    assert.equal(verified.response.status, 200);
    assert.equal(verified.body.paid, true);
  });
});

test('browser API mutations reject foreign origins', async () => {
  await withServer(async ({ baseUrl }) => {
    const blocked = await jsonRequest(baseUrl, '/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({})
    });
    assert.equal(blocked.response.status, 403);

    const allowed = await jsonRequest(baseUrl, '/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({})
    });
    assert.equal(allowed.response.status, 400);
  });
});

test('Stripe webhook records payment independently of the browser', async () => {
  await withServer(async ({ baseUrl, store, stripe }) => {
    const purchase = await store.createPurchase({
      id: '11111111-1111-4111-8111-111111111111',
      idempotencyKey: 'request_webhook_123456789',
      projectKey: projectA,
      manifestHashes: manifestA,
      tokenHash: hashToken('request_webhook_123456789')
    });
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', line_items: [{ price: 'price_site', quantity: 1 }],
      metadata: { app: 'photo_atlas', kind: 'site_export', purchase_id: purchase.id },
      client_reference_id: purchase.id
    });
    session.payment_status = 'paid';
    await store.attachCheckoutSession(purchase.id, session);

    const event = {
      id: 'evt_test_paid_1', type: 'checkout.session.completed',
      data: { object: session }
    };
    const result = await fetch(`${baseUrl}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 'valid' },
      body: JSON.stringify(event)
    });
    assert.equal(result.status, 200);
    assert.equal((await store.findPurchaseById(purchase.id)).status, 'paid');

    const duplicate = await fetch(`${baseUrl}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 'valid' },
      body: JSON.stringify(event)
    });
    assert.equal(duplicate.status, 200);
  });
});

test('organization entitlement covers members without creating site checkout', async () => {
  await withServer(async ({ baseUrl, store, stripe }) => {
    await store.upsertBillingAccount({
      subjectKey: 'org:org_acme',
      subscriptionStatus: 'active',
      currentPeriodEnd: new Date(Date.now() + 86_400_000)
    });
    const result = await jsonRequest(baseUrl, '/api/create-checkout-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': 'user_one',
        'x-test-org': 'org_acme',
        'x-test-role': 'org:member'
      },
      body: JSON.stringify({
        projectKey: projectA,
        manifestHashes: manifestA,
        requestId: 'request_team_1234567890'
      })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.entitled, true);
    assert.equal(stripe.sessions.size, 0);
  });
});

test('signed-in purchase can be recovered in the same personal workspace without browser token', async () => {
  await withServer(async ({ baseUrl, store }) => {
    const purchase = await store.createPurchase({
      id: '22222222-2222-4222-8222-222222222222',
      idempotencyKey: 'request_account_123456789',
      subjectKey: 'user:user_one',
      createdByUserId: 'user_one',
      projectKey: projectA,
      manifestHashes: manifestA,
      tokenHash: hashToken('request_account_123456789')
    });
    await store.markPurchasePaid({ purchaseId: purchase.id, sessionId: 'cs_account_paid' });

    const recovered = await jsonRequest(baseUrl, '/api/account/project-entitlement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-user': 'user_one' },
      body: JSON.stringify({ projectKey: projectA, manifestHashes: manifestA })
    });
    assert.equal(recovered.response.status, 200);
    assert.deepEqual(recovered.body, { entitled: true, source: 'purchase' });

    const otherUser = await jsonRequest(baseUrl, '/api/account/project-entitlement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-user': 'user_two' },
      body: JSON.stringify({ projectKey: projectA, manifestHashes: manifestA })
    });
    assert.deepEqual(otherUser.body, { entitled: false, source: null });
  });
});

test('saved draft sessions are isolated by active workspace', async () => {
  await withServer(async ({ baseUrl }) => {
    const draft = {
      type: 'FeatureCollection',
      metadata: { app: 'Broken Arrow Photo Atlas' },
      features: [{ type: 'Feature', properties: { fileName: 'IMG_001.jpg' }, geometry: null }]
    };
    const save = await jsonRequest(baseUrl, '/api/drafts', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': 'user_one',
        'x-test-org': 'org_acme'
      },
      body: JSON.stringify({ title: 'Acme Site', photoCount: 1, draft })
    });
    assert.equal(save.response.status, 200);

    const sameOrg = await jsonRequest(baseUrl, '/api/drafts', {
      headers: { 'x-test-user': 'user_two', 'x-test-org': 'org_acme' }
    });
    assert.equal(sameOrg.body.drafts.length, 1);
    assert.equal(sameOrg.body.drafts[0].canDelete, false);

    const memberDelete = await jsonRequest(baseUrl, `/api/drafts/${save.body.draft.id}`, {
      method: 'DELETE',
      headers: { 'x-test-user': 'user_two', 'x-test-org': 'org_acme', 'x-test-role': 'org:member' }
    });
    assert.equal(memberDelete.response.status, 403);

    const personal = await jsonRequest(baseUrl, '/api/drafts', {
      headers: { 'x-test-user': 'user_one' }
    });
    assert.equal(personal.body.drafts.length, 0);

    const otherOrg = await jsonRequest(baseUrl, `/api/drafts/${save.body.draft.id}`, {
      headers: { 'x-test-user': 'user_one', 'x-test-org': 'org_other' }
    });
    assert.equal(otherOrg.response.status, 404);
  });
});

test('only organization admins can start team billing and subscription webhook grants members access', async () => {
  await withServer(async ({ baseUrl }) => {
    const memberAttempt = await jsonRequest(baseUrl, '/api/billing/team-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': 'user_member',
        'x-test-org': 'org_team',
        'x-test-role': 'org:member'
      },
      body: JSON.stringify({ requestId: 'request_member_12345678' })
    });
    assert.equal(memberAttempt.response.status, 403);

    const adminAttempt = await jsonRequest(baseUrl, '/api/billing/team-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': 'user_admin',
        'x-test-org': 'org_team',
        'x-test-role': 'org:admin'
      },
      body: JSON.stringify({ requestId: 'request_admin_123456789' })
    });
    assert.equal(adminAttempt.response.status, 200);
    assert.match(adminAttempt.body.url, /^https:\/\/checkout\.test\//);

    const subscriptionEvent = {
      id: 'evt_subscription_active_1',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_team_1',
          customer: 'cus_test_1',
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 86_400,
          cancel_at_period_end: false,
          metadata: { app: 'photo_atlas', subject_key: 'org:org_team' }
        }
      }
    };
    const webhook = await fetch(`${baseUrl}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 'valid' },
      body: JSON.stringify(subscriptionEvent)
    });
    assert.equal(webhook.status, 200);

    const memberAccount = await jsonRequest(baseUrl, '/api/account', {
      headers: {
        'x-test-user': 'user_member',
        'x-test-org': 'org_team',
        'x-test-role': 'org:member'
      }
    });
    assert.equal(memberAccount.response.status, 200);
    assert.equal(memberAccount.body.teamEntitled, true);
  });
});
