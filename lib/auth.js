'use strict';

const { clerkMiddleware, getAuth } = require('@clerk/express');

function parseAuthorizedParties(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function createAuth(options = {}) {
  const resolver = options.authResolver;
  const publishableKey = options.publishableKey ?? process.env.CLERK_PUBLISHABLE_KEY;
  const secretKey = options.secretKey ?? process.env.CLERK_SECRET_KEY;
  const enabled = typeof resolver === 'function' || !!(publishableKey && secretKey);
  const authorizedParties = parseAuthorizedParties(
    options.authorizedParties ?? process.env.CLERK_AUTHORIZED_PARTIES
  );

  let middleware = (_req, _res, next) => next();
  if (!resolver && enabled) {
    const clerkOptions = authorizedParties.length ? { authorizedParties } : {};
    middleware = clerkMiddleware(clerkOptions);
  }

  function read(req) {
    if (resolver) return resolver(req) || { isAuthenticated: false };
    if (!enabled) return { isAuthenticated: false };
    return getAuth(req);
  }

  function requireUser(req, res, next) {
    const auth = read(req);
    if (!auth.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: 'Sign in to use this feature.' });
    }
    req.photoAtlasAuth = auth;
    return next();
  }

  function workspace(auth) {
    if (!auth?.isAuthenticated || !auth.userId) return null;
    if (auth.orgId) {
      return {
        ownerKey: `org:${auth.orgId}`,
        subjectKey: `org:${auth.orgId}`,
        type: 'organization',
        orgId: auth.orgId,
        userId: auth.userId
      };
    }
    return {
      ownerKey: `user:${auth.userId}`,
      subjectKey: `user:${auth.userId}`,
      type: 'personal',
      orgId: null,
      userId: auth.userId
    };
  }

  function isOrgAdmin(auth) {
    if (!auth?.orgId) return false;
    if (auth.orgRole === 'org:admin') return true;
    try {
      return typeof auth.has === 'function' && auth.has({ role: 'org:admin' });
    } catch (_) {
      return false;
    }
  }

  return {
    enabled,
    publishableKey: publishableKey || '',
    middleware,
    read,
    requireUser,
    workspace,
    isOrgAdmin
  };
}

module.exports = { createAuth, parseAuthorizedParties };
