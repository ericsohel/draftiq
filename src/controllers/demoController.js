/**
 * GET /demo/valuations
 *
 * Public, unauthenticated showcase endpoint that powers the live widget on
 * ericsohel.com. Returns the top N players by current dollar value under
 * default league settings (10-team, $260 cap).
 *
 * Safety posture:
 *  - The full payload is cached in-process for DEMO_CACHE_TTL_MS, so the
 *    valuation engine runs at most once per TTL regardless of traffic.
 *  - Cache-Control lets browsers/CDNs cache downstream of us too.
 *  - CORS is '*' for this route only — the payload is public data by design,
 *    independent of the ALLOWED_ORIGIN configured for licensed routes.
 *  - Failures are negative-cached briefly so a broken engine can't be used
 *    to make the process do work on every request.
 */

const { runValuations, normalizeLeagueSettings } = require('../services/valuationEngine');
const log = require('../logger').child({ component: 'demo' });

const DEMO_CACHE_TTL_MS = Number(process.env.DEMO_CACHE_TTL_MS || 15 * 60 * 1000);
const DEMO_ERROR_TTL_MS = 60 * 1000;
const DEMO_TOP_N = 10;

let cache = { payload: null, expiresAt: 0 };

function buildPayload() {
  const { valuations } = runValuations(normalizeLeagueSettings({}), {});
  if (!valuations.length) return null;
  const top = valuations.slice(0, DEMO_TOP_N).map((v) => ({
    rank: v.rank,
    name: v.name,
    dollarValue: v.dollarValue,
    statGroup: v.statGroup,
  }));
  return {
    success: true,
    demo: true,
    note: `Top ${DEMO_TOP_N} by auction value under default 10-team/$260 settings. Cached ${Math.round(DEMO_CACHE_TTL_MS / 60000)}m — for live draft data, get a key at /developer-portal.`,
    computedAt: new Date().toISOString(),
    playerCount: valuations.length,
    top,
  };
}

function getDemoValuations(_req, res) {
  // Public data; open CORS on this route regardless of ALLOWED_ORIGIN.
  res.set('Access-Control-Allow-Origin', '*');

  const now = Date.now();
  if (now >= cache.expiresAt) {
    try {
      cache = { payload: buildPayload(), expiresAt: now + DEMO_CACHE_TTL_MS };
    } catch (err) {
      log.error('demo valuation failed', { error: err.message, stack: err.stack });
      cache = { payload: null, expiresAt: now + DEMO_ERROR_TTL_MS };
    }
    if (!cache.payload) cache.expiresAt = now + DEMO_ERROR_TTL_MS;
  }

  if (!cache.payload) {
    return res.status(503).json({
      success: false,
      error: 'Demo data unavailable. Stats have not been ingested yet.',
      code: 'STATS_UNAVAILABLE',
    });
  }

  res.set('Cache-Control', `public, max-age=${Math.floor(DEMO_CACHE_TTL_MS / 1000)}`);
  return res.json(cache.payload);
}

/** Test hook — clears the in-process cache between test cases. */
function resetDemoCache() {
  cache = { payload: null, expiresAt: 0 };
}

module.exports = { getDemoValuations, resetDemoCache, DEMO_TOP_N };
