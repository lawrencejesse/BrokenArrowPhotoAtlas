'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');
const { PostgresStore } = require('../lib/store');

async function withPostgresStore(run) {
  const memoryDb = newDb();
  const adapter = memoryDb.adapters.createPg();
  const pool = new adapter.Pool();
  const store = new PostgresStore(null, pool);
  await store.init();
  try {
    await run(store);
  } finally {
    await store.close();
  }
}

test('PostgreSQL store persists purchase, billing, and draft lifecycle', async () => {
  await withPostgresStore(async store => {
    const input = {
      id: '33333333-3333-4333-8333-333333333333',
      idempotencyKey: 'postgres_request_123456',
      subjectKey: 'org:org_sql',
      createdByUserId: 'user_sql',
      projectKey: 'a'.repeat(64),
      manifestHashes: ['1'.repeat(64), '2'.repeat(64)],
      tokenHash: 'f'.repeat(64)
    };
    const created = await store.createPurchase(input);
    const replay = await store.createPurchase({ ...input, id: '44444444-4444-4444-8444-444444444444' });
    assert.equal(replay.id, created.id);

    await store.attachCheckoutSession(created.id, {
      id: 'cs_sql_1', url: 'https://checkout.test/sql', amount_total: 1500, currency: 'cad'
    });
    await store.markPurchasePaid({
      purchaseId: created.id,
      sessionId: 'cs_sql_1',
      paymentIntentId: 'pi_sql_1',
      amountTotal: 1500,
      currency: 'cad'
    });
    assert.equal((await store.findPurchaseBySession('cs_sql_1')).status, 'paid');
    assert.equal((await store.findPaidPurchases('org:org_sql')).length, 1);

    const billing = await store.upsertBillingAccount({
      subjectKey: 'org:org_sql',
      stripeCustomerId: 'cus_sql_1',
      stripeSubscriptionId: 'sub_sql_1',
      subscriptionStatus: 'active',
      currentPeriodEnd: new Date(Date.now() + 86_400_000)
    });
    assert.equal(billing.subscriptionStatus, 'active');
    assert.equal((await store.findBillingByCustomer('cus_sql_1')).subjectKey, 'org:org_sql');

    const draftPayload = {
      type: 'FeatureCollection',
      metadata: { app: 'Broken Arrow Photo Atlas' },
      features: []
    };
    const draft = await store.saveDraft({
      ownerKey: 'org:org_sql',
      createdByUserId: 'user_sql',
      title: 'SQL test session',
      projectName: 'Database QA',
      projectKey: 'local-key',
      photoCount: 2,
      draft: draftPayload
    });
    assert.equal((await store.listDrafts('org:org_sql')).length, 1);
    assert.deepEqual((await store.getDraft('org:org_sql', draft.id)).draft, draftPayload);

    const updated = await store.saveDraft({
      id: draft.id,
      ownerKey: 'org:org_sql',
      createdByUserId: 'user_other',
      title: 'Updated SQL session',
      projectName: 'Database QA',
      projectKey: 'local-key',
      photoCount: 3,
      draft: draftPayload
    });
    assert.equal(updated.title, 'Updated SQL session');
    assert.equal((await store.getDraft('org:org_sql', draft.id)).createdByUserId, 'user_sql');
    assert.equal(await store.deleteDraft('org:org_sql', draft.id), true);
    assert.equal(await store.getDraft('org:org_sql', draft.id), null);

    assert.equal(await store.eventAlreadyProcessed('evt_sql_1'), false);
    await store.recordStripeEvent('evt_sql_1', 'checkout.session.completed');
    assert.equal(await store.eventAlreadyProcessed('evt_sql_1'), true);
  });
});
