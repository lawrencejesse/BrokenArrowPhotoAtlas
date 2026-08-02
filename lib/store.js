'use strict';

const { randomUUID } = require('crypto');
const { Pool } = require('pg');

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS photo_atlas_purchases (
  id UUID PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  subject_key TEXT,
  created_by_user_id TEXT,
  project_key TEXT NOT NULL,
  manifest_hashes TEXT[] NOT NULL DEFAULT '{}',
  token_hash TEXT NOT NULL,
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_checkout_url TEXT,
  stripe_payment_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  amount_total INTEGER,
  currency TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS photo_atlas_purchases_subject_idx
  ON photo_atlas_purchases (subject_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS photo_atlas_billing_accounts (
  subject_key TEXT PRIMARY KEY,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  subscription_status TEXT,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS photo_atlas_saved_drafts (
  id UUID PRIMARY KEY,
  owner_key TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  project_name TEXT NOT NULL DEFAULT '',
  project_key TEXT NOT NULL DEFAULT '',
  photo_count INTEGER NOT NULL DEFAULT 0,
  draft JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS photo_atlas_saved_drafts_owner_idx
  ON photo_atlas_saved_drafts (owner_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS photo_atlas_stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

function mapPurchase(row) {
  if (!row) return null;
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    subjectKey: row.subject_key,
    createdByUserId: row.created_by_user_id,
    projectKey: row.project_key,
    manifestHashes: row.manifest_hashes || [],
    tokenHash: row.token_hash,
    checkoutSessionId: row.stripe_checkout_session_id,
    checkoutUrl: row.stripe_checkout_url,
    paymentIntentId: row.stripe_payment_intent_id,
    status: row.status,
    amountTotal: row.amount_total,
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paidAt: row.paid_at
  };
}

function mapBilling(row) {
  if (!row) return null;
  return {
    subjectKey: row.subject_key,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    subscriptionStatus: row.subscription_status,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: !!row.cancel_at_period_end,
    updatedAt: row.updated_at
  };
}

function mapDraftSummary(row) {
  return {
    id: row.id,
    title: row.title,
    projectName: row.project_name,
    projectKey: row.project_key,
    photoCount: row.photo_count,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

class PostgresStore {
  constructor(connectionString, pool = null) {
    this.kind = 'postgres';
    this.pool = pool || new Pool({
      connectionString,
      max: Math.max(1, Number(process.env.PGPOOL_MAX) || 5),
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000
    });
  }

  async init() {
    await this.pool.query(SCHEMA_SQL);
  }

  async health() {
    await this.pool.query('SELECT 1');
    return true;
  }

  async createPurchase(input) {
    const result = await this.pool.query(
      `INSERT INTO photo_atlas_purchases (
        id, idempotency_key, subject_key, created_by_user_id,
        project_key, manifest_hashes, token_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = NOW()
      RETURNING *`,
      [
        input.id || randomUUID(), input.idempotencyKey, input.subjectKey || null,
        input.createdByUserId || null, input.projectKey, input.manifestHashes,
        input.tokenHash
      ]
    );
    return mapPurchase(result.rows[0]);
  }

  async attachCheckoutSession(purchaseId, session) {
    const result = await this.pool.query(
      `UPDATE photo_atlas_purchases
       SET stripe_checkout_session_id = $2, stripe_checkout_url = $3,
           amount_total = COALESCE($4, amount_total), currency = COALESCE($5, currency),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [purchaseId, session.id, session.url || null, session.amount_total ?? null, session.currency || null]
    );
    return mapPurchase(result.rows[0]);
  }

  async findPurchaseById(id) {
    const result = await this.pool.query('SELECT * FROM photo_atlas_purchases WHERE id = $1', [id]);
    return mapPurchase(result.rows[0]);
  }

  async findPurchaseBySession(sessionId) {
    const result = await this.pool.query(
      'SELECT * FROM photo_atlas_purchases WHERE stripe_checkout_session_id = $1',
      [sessionId]
    );
    return mapPurchase(result.rows[0]);
  }

  async findPaidPurchases(subjectKey, limit = 200) {
    const result = await this.pool.query(
      `SELECT * FROM photo_atlas_purchases
       WHERE subject_key = $1 AND status = 'paid'
       ORDER BY paid_at DESC NULLS LAST, updated_at DESC
       LIMIT $2`,
      [subjectKey, limit]
    );
    return result.rows.map(mapPurchase);
  }

  async markPurchasePaid({ purchaseId, sessionId, paymentIntentId, amountTotal, currency }) {
    const result = await this.pool.query(
      `UPDATE photo_atlas_purchases
       SET status = 'paid', stripe_checkout_session_id = COALESCE($2, stripe_checkout_session_id),
           stripe_payment_intent_id = COALESCE($3, stripe_payment_intent_id),
           amount_total = COALESCE($4, amount_total), currency = COALESCE($5, currency),
           paid_at = COALESCE(paid_at, NOW()), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [purchaseId, sessionId || null, paymentIntentId || null, amountTotal ?? null, currency || null]
    );
    return mapPurchase(result.rows[0]);
  }

  async eventAlreadyProcessed(eventId) {
    const result = await this.pool.query(
      'SELECT 1 FROM photo_atlas_stripe_events WHERE event_id = $1',
      [eventId]
    );
    return result.rowCount > 0;
  }

  async recordStripeEvent(eventId, eventType) {
    await this.pool.query(
      `INSERT INTO photo_atlas_stripe_events (event_id, event_type)
       VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING`,
      [eventId, eventType]
    );
  }

  async getBillingAccount(subjectKey) {
    const result = await this.pool.query(
      'SELECT * FROM photo_atlas_billing_accounts WHERE subject_key = $1',
      [subjectKey]
    );
    return mapBilling(result.rows[0]);
  }

  async findBillingByCustomer(customerId) {
    const result = await this.pool.query(
      'SELECT * FROM photo_atlas_billing_accounts WHERE stripe_customer_id = $1',
      [customerId]
    );
    return mapBilling(result.rows[0]);
  }

  async upsertBillingAccount(input) {
    const result = await this.pool.query(
      `INSERT INTO photo_atlas_billing_accounts (
        subject_key, stripe_customer_id, stripe_subscription_id,
        subscription_status, current_period_end, cancel_at_period_end
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (subject_key) DO UPDATE SET
        stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, photo_atlas_billing_accounts.stripe_customer_id),
        stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, photo_atlas_billing_accounts.stripe_subscription_id),
        subscription_status = COALESCE(EXCLUDED.subscription_status, photo_atlas_billing_accounts.subscription_status),
        current_period_end = COALESCE(EXCLUDED.current_period_end, photo_atlas_billing_accounts.current_period_end),
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        updated_at = NOW()
      RETURNING *`,
      [
        input.subjectKey, input.stripeCustomerId || null, input.stripeSubscriptionId || null,
        input.subscriptionStatus || null, input.currentPeriodEnd || null,
        !!input.cancelAtPeriodEnd
      ]
    );
    return mapBilling(result.rows[0]);
  }

  async listDrafts(ownerKey) {
    const result = await this.pool.query(
      `SELECT id, title, project_name, project_key, photo_count, created_by_user_id, created_at, updated_at
       FROM photo_atlas_saved_drafts WHERE owner_key = $1
       ORDER BY updated_at DESC LIMIT 100`,
      [ownerKey]
    );
    return result.rows.map(mapDraftSummary);
  }

  async getDraft(ownerKey, id) {
    const result = await this.pool.query(
      `SELECT id, title, project_name, project_key, photo_count, created_by_user_id, draft, created_at, updated_at
       FROM photo_atlas_saved_drafts WHERE owner_key = $1 AND id = $2`,
      [ownerKey, id]
    );
    const row = result.rows[0];
    return row ? { ...mapDraftSummary(row), draft: row.draft } : null;
  }

  async saveDraft(input) {
    const id = input.id || randomUUID();
    const result = await this.pool.query(
      `INSERT INTO photo_atlas_saved_drafts (
        id, owner_key, created_by_user_id, title, project_name,
        project_key, photo_count, draft
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title, project_name = EXCLUDED.project_name,
        project_key = EXCLUDED.project_key, photo_count = EXCLUDED.photo_count,
        draft = EXCLUDED.draft, updated_at = NOW()
      WHERE photo_atlas_saved_drafts.owner_key = EXCLUDED.owner_key
      RETURNING id, title, project_name, project_key, photo_count, created_by_user_id, created_at, updated_at`,
      [
        id, input.ownerKey, input.createdByUserId, input.title || '', input.projectName || '',
        input.projectKey || '', input.photoCount || 0, input.draft
      ]
    );
    return result.rows[0] ? mapDraftSummary(result.rows[0]) : null;
  }

  async deleteDraft(ownerKey, id) {
    const result = await this.pool.query(
      'DELETE FROM photo_atlas_saved_drafts WHERE owner_key = $1 AND id = $2',
      [ownerKey, id]
    );
    return result.rowCount > 0;
  }

  async close() {
    await this.pool.end();
  }
}

class MemoryStore {
  constructor() {
    this.kind = 'memory';
    this.purchases = new Map();
    this.purchaseByIdempotency = new Map();
    this.purchaseBySession = new Map();
    this.billing = new Map();
    this.drafts = new Map();
    this.events = new Set();
  }

  async init() {}
  async health() { return true; }

  async createPurchase(input) {
    const existingId = this.purchaseByIdempotency.get(input.idempotencyKey);
    if (existingId) return { ...this.purchases.get(existingId) };
    const now = new Date();
    const purchase = {
      id: input.id || randomUUID(),
      ...input,
      subjectKey: input.subjectKey || null,
      createdByUserId: input.createdByUserId || null,
      checkoutSessionId: null,
      checkoutUrl: null,
      paymentIntentId: null,
      status: 'pending',
      amountTotal: null,
      currency: null,
      createdAt: now,
      updatedAt: now,
      paidAt: null
    };
    this.purchases.set(purchase.id, purchase);
    this.purchaseByIdempotency.set(purchase.idempotencyKey, purchase.id);
    return { ...purchase };
  }

  async attachCheckoutSession(purchaseId, session) {
    const purchase = this.purchases.get(purchaseId);
    if (!purchase) return null;
    purchase.checkoutSessionId = session.id;
    purchase.checkoutUrl = session.url || null;
    purchase.amountTotal = session.amount_total ?? purchase.amountTotal;
    purchase.currency = session.currency || purchase.currency;
    purchase.updatedAt = new Date();
    this.purchaseBySession.set(session.id, purchase.id);
    return { ...purchase };
  }

  async findPurchaseById(id) {
    const purchase = this.purchases.get(id);
    return purchase ? { ...purchase } : null;
  }

  async findPurchaseBySession(sessionId) {
    const id = this.purchaseBySession.get(sessionId);
    return id ? { ...this.purchases.get(id) } : null;
  }

  async findPaidPurchases(subjectKey, limit = 200) {
    return [...this.purchases.values()]
      .filter(item => item.subjectKey === subjectKey && item.status === 'paid')
      .sort((a, b) => (b.paidAt || b.updatedAt) - (a.paidAt || a.updatedAt))
      .slice(0, limit)
      .map(item => ({ ...item }));
  }

  async markPurchasePaid(input) {
    const purchase = this.purchases.get(input.purchaseId);
    if (!purchase) return null;
    purchase.status = 'paid';
    purchase.checkoutSessionId = input.sessionId || purchase.checkoutSessionId;
    purchase.paymentIntentId = input.paymentIntentId || purchase.paymentIntentId;
    purchase.amountTotal = input.amountTotal ?? purchase.amountTotal;
    purchase.currency = input.currency || purchase.currency;
    purchase.paidAt ||= new Date();
    purchase.updatedAt = new Date();
    if (purchase.checkoutSessionId) this.purchaseBySession.set(purchase.checkoutSessionId, purchase.id);
    return { ...purchase };
  }

  async eventAlreadyProcessed(eventId) { return this.events.has(eventId); }
  async recordStripeEvent(eventId) { this.events.add(eventId); }
  async getBillingAccount(subjectKey) { return this.billing.get(subjectKey) || null; }
  async findBillingByCustomer(customerId) {
    return [...this.billing.values()].find(item => item.stripeCustomerId === customerId) || null;
  }
  async upsertBillingAccount(input) {
    const previous = this.billing.get(input.subjectKey) || {};
    const value = { ...previous, ...input, updatedAt: new Date() };
    this.billing.set(input.subjectKey, value);
    return { ...value };
  }

  async listDrafts(ownerKey) {
    return [...this.drafts.values()]
      .filter(item => item.ownerKey === ownerKey)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ draft, ownerKey: ignoredOwner, ...summary }) => summary);
  }

  async getDraft(ownerKey, id) {
    const draft = this.drafts.get(id);
    if (!draft || draft.ownerKey !== ownerKey) return null;
    const { ownerKey: ignoredOwner, ...safeDraft } = draft;
    return { ...safeDraft };
  }

  async saveDraft(input) {
    const previous = input.id ? this.drafts.get(input.id) : null;
    if (previous && previous.ownerKey !== input.ownerKey) return null;
    const now = new Date();
    const value = {
      id: input.id || randomUUID(),
      ownerKey: input.ownerKey,
      createdByUserId: input.createdByUserId,
      title: input.title || '',
      projectName: input.projectName || '',
      projectKey: input.projectKey || '',
      photoCount: input.photoCount || 0,
      draft: input.draft,
      createdAt: previous?.createdAt || now,
      updatedAt: now
    };
    this.drafts.set(value.id, value);
    const { draft, ownerKey: ignoredOwner, ...summary } = value;
    return summary;
  }

  async deleteDraft(ownerKey, id) {
    const draft = this.drafts.get(id);
    if (!draft || draft.ownerKey !== ownerKey) return false;
    return this.drafts.delete(id);
  }

  async close() {}
}

function createStore(options = {}) {
  const connectionString = options.connectionString || process.env.DATABASE_URL;
  return connectionString ? new PostgresStore(connectionString) : new MemoryStore();
}

module.exports = { createStore, MemoryStore, PostgresStore, SCHEMA_SQL };
