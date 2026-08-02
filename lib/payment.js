'use strict';

const { createHash, randomBytes, timingSafeEqual } = require('crypto');

const PROJECT_MATCH_THRESHOLD = 0.75;
const MAX_MANIFEST_ITEMS = 2000;

function makePurchaseToken() {
  return randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function tokenMatches(token, expectedHash) {
  const actual = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalizeManifestHashes(items) {
  if (!Array.isArray(items) || !items.length || items.length > MAX_MANIFEST_ITEMS) return null;
  const normalized = [...new Set(items.map(item => String(item || '').toLowerCase()))];
  if (!normalized.length || normalized.some(item => !/^[a-f0-9]{64}$/.test(item))) return null;
  return normalized.sort();
}

function validateProjectKey(value) {
  const projectKey = String(value || '').toLowerCase();
  return /^[a-f0-9]{64}$/.test(projectKey) ? projectKey : null;
}

function validateIdempotencyKey(value) {
  const key = String(value || '');
  return /^[a-zA-Z0-9_-]{16,100}$/.test(key) ? key : null;
}

function manifestsMatch(purchase, currentProjectKey, currentManifestHashes) {
  if (!purchase || !currentProjectKey) return false;
  if (purchase.projectKey === currentProjectKey) return true;

  const stored = Array.isArray(purchase.manifestHashes) ? purchase.manifestHashes : [];
  const current = Array.isArray(currentManifestHashes) ? currentManifestHashes : [];
  if (!stored.length || !current.length) return false;

  const currentSet = new Set(current);
  const overlap = stored.reduce((count, item) => count + (currentSet.has(item) ? 1 : 0), 0);
  return (
    overlap / stored.length >= PROJECT_MATCH_THRESHOLD &&
    overlap / current.length >= PROJECT_MATCH_THRESHOLD
  );
}

function isTeamEntitled(account, now = new Date()) {
  if (!account) return false;
  const status = account.subscriptionStatus;
  if (status === 'active' || status === 'trialing') return true;
  if (status !== 'past_due' || !account.currentPeriodEnd) return false;
  return new Date(account.currentPeriodEnd).getTime() > now.getTime();
}

function stripeId(value) {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id || null;
}

function subscriptionPeriodEnd(subscription) {
  const unix = subscription?.current_period_end
    || subscription?.items?.data?.[0]?.current_period_end
    || null;
  return unix ? new Date(unix * 1000) : null;
}

module.exports = {
  MAX_MANIFEST_ITEMS,
  PROJECT_MATCH_THRESHOLD,
  hashToken,
  isTeamEntitled,
  makePurchaseToken,
  manifestsMatch,
  normalizeManifestHashes,
  stripeId,
  subscriptionPeriodEnd,
  tokenMatches,
  validateIdempotencyKey,
  validateProjectKey
};
