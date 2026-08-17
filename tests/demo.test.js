'use strict';

/**
 * Tests for the public /demo/valuations showcase endpoint.
 *
 * The valuation engine is mocked so the 200 path is deterministic without
 * seeded stats, and so cache behavior (one engine run per TTL) is provable
 * via mock call counts.
 */

process.env.RATE_LIMIT_DISABLED = 'true';

jest.mock('../src/services/valuationEngine', () => ({
  runValuations: jest.fn(),
  normalizeLeagueSettings: jest.fn((s) => s),
  getExclusionDiagnostics: jest.fn(() => null),
}));

const request = require('supertest');
const app = require('../src/app');
const { runValuations } = require('../src/services/valuationEngine');
const { resetDemoCache, DEMO_TOP_N } = require('../src/controllers/demoController');

function fakeValuations(n) {
  return Array.from({ length: n }, (_, i) => ({
    playerId: `mlb-${i + 1}`,
    name: `Player ${i + 1}`,
    dollarValue: 50 - i,
    projectedValue: 50 - i,
    rank: i + 1,
    zScore: 3 - i * 0.1,
    zScores: {},
    statGroup: i % 2 === 0 ? 'hitting' : 'pitching',
  }));
}

beforeEach(() => {
  resetDemoCache();
  runValuations.mockReset();
});

describe('GET /api/v1/demo/valuations', () => {
  test('returns top N with trimmed fields and no auth', async () => {
    runValuations.mockReturnValue({ valuations: fakeValuations(25), meta: {} });

    const res = await request(app).get('/api/v1/demo/valuations');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.demo).toBe(true);
    expect(res.body.playerCount).toBe(25);
    expect(res.body.top).toHaveLength(DEMO_TOP_N);
    // Trimmed shape only — no zScores/projections leaked to the public payload.
    expect(res.body.top[0]).toEqual({
      rank: 1,
      name: 'Player 1',
      dollarValue: 50,
      statGroup: 'hitting',
    });
  });

  test('is CORS-open and browser-cacheable', async () => {
    runValuations.mockReturnValue({ valuations: fakeValuations(12), meta: {} });

    const res = await request(app).get('/api/v1/demo/valuations');

    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['cache-control']).toMatch(/public, max-age=\d+/);
  });

  test('serves from cache — engine runs once across repeated requests', async () => {
    runValuations.mockReturnValue({ valuations: fakeValuations(12), meta: {} });

    const first = await request(app).get('/api/v1/demo/valuations');
    const second = await request(app).get('/api/v1/demo/valuations');
    const third = await request(app).get('/api/v1/demo/valuations');

    expect(runValuations).toHaveBeenCalledTimes(1);
    expect(second.body.computedAt).toBe(first.body.computedAt);
    expect(third.body.computedAt).toBe(first.body.computedAt);
  });

  test('503 with STATS_UNAVAILABLE when no stats are ingested', async () => {
    runValuations.mockReturnValue({ valuations: [], meta: {} });

    const res = await request(app).get('/api/v1/demo/valuations');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('STATS_UNAVAILABLE');
    // Still CORS-open so the site widget can read the error state.
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  test('503 when the engine throws, without leaking the error', async () => {
    runValuations.mockImplementation(() => {
      throw new Error('boom');
    });

    const res = await request(app).get('/api/v1/demo/valuations');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('STATS_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('boom');
  });

  test('failure is negative-cached — engine is not re-run per request', async () => {
    runValuations.mockImplementation(() => {
      throw new Error('boom');
    });

    await request(app).get('/api/v1/demo/valuations');
    await request(app).get('/api/v1/demo/valuations');

    expect(runValuations).toHaveBeenCalledTimes(1);
  });
});
