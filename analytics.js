/* Broken Arrow Photo Atlas analytics.
   Workflow events only: never send filenames, captions, coordinates, EXIF,
   client names, project names, or image data. */

'use strict';

(function initAnalytics() {
  const MEASUREMENT_ID = 'G-ZFZDHL01B0';
  const ATTRIBUTION_KEY = 'ba_photo_atlas_first_touch_v1';
  const LEAD_TOKEN_PATTERN = /^lead_[a-z0-9_-]{1,64}$/i;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };

  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false
  });

  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  function captureFirstTouch() {
    const existing = readStorage(ATTRIBUTION_KEY);
    if (existing) {
      try { return JSON.parse(existing); } catch (_) { /* replace invalid data */ }
    }

    const params = new URLSearchParams(window.location.search);
    const attribution = {};
    ['utm_source', 'utm_medium', 'utm_campaign'].forEach(key => {
      const value = params.get(key);
      if (value) attribution[key] = value.slice(0, 100);
    });

    const content = params.get('utm_content');
    if (content && LEAD_TOKEN_PATTERN.test(content)) {
      attribution.lead_token = content;
    }

    if (Object.keys(attribution).length) {
      writeStorage(ATTRIBUTION_KEY, JSON.stringify(attribution));
    }
    return attribution;
  }

  const firstTouch = captureFirstTouch();

  function track(eventName, properties = {}) {
    if (!eventName || typeof window.gtag !== 'function') return;
    window.gtag('event', eventName, {
      ...firstTouch,
      ...properties
    });
  }

  function trackOnce(storageKey, eventName, properties = {}) {
    if (!storageKey || readStorage(storageKey)) return false;
    track(eventName, properties);
    writeStorage(storageKey, String(Date.now()));
    return true;
  }

  function photoCountBucket(count) {
    if (count <= 5) return '1-5';
    if (count <= 15) return '6-15';
    if (count <= 30) return '16-30';
    return '31+';
  }

  function coverageBucket(covered, total) {
    if (!total || covered <= 0) return 'none';
    if (covered >= total) return 'all';
    return 'some';
  }

  function shortHash(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function trackPurchase(sessionId) {
    if (!sessionId) return false;
    return trackOnce(`ba_ga_purchase_${sessionId}`, 'purchase', {
      transaction_id: `ba_${shortHash(sessionId)}`,
      currency: 'CAD',
      value: 15,
      items: [{
        item_id: 'photo_atlas_site',
        item_name: 'Photo Log Atlas Site Export',
        price: 15,
        quantity: 1
      }]
    });
  }

  window.baAnalytics = {
    track,
    trackOnce,
    trackPurchase,
    photoCountBucket,
    coverageBucket
  };
})();
