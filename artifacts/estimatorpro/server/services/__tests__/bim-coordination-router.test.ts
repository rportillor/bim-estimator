/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  BIM COORDINATION ROUTER — Test Suite
 *  Tests the exported Express Router and its registered routes.
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ── Mock storage before any imports ──────────────────────────────────────────
jest.mock('../../storage', () => ({
  storage: {
    getProject: jest.fn(),
    getBimElements: jest.fn(),
    getDocumentsByProject: jest.fn(),
  },
}));

import { bimCoordinationRouter } from '../bim-coordination-router';

// ── Helpers to inspect Express router stack ──────────────────────────────────

type Layer = { route?: { path: string; methods: Record<string, boolean> } };

function getRoutes(): { method: string; path: string }[] {
  const stack: Layer[] = (bimCoordinationRouter as any).stack ?? [];
  const routes: { method: string; path: string }[] = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        routes.push({ method: method.toUpperCase(), path: layer.route.path });
      }
    }
  }
  return routes;
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('bim-coordination-router.ts', () => {
  test('exports bimCoordinationRouter', () => {
    expect(bimCoordinationRouter).toBeDefined();
  });

  test('router is an Express Router with a stack', () => {
    expect(bimCoordinationRouter).toHaveProperty('stack');
    expect(Array.isArray((bimCoordinationRouter as any).stack)).toBe(true);
  });

  test('router exposes get, post, put, delete methods', () => {
    expect(typeof bimCoordinationRouter.get).toBe('function');
    expect(typeof bimCoordinationRouter.post).toBe('function');
    expect(typeof bimCoordinationRouter.put).toBe('function');
    expect(typeof bimCoordinationRouter.delete).toBe('function');
  });

  test('router has registered routes', () => {
    const routes = getRoutes();
    expect(routes.length).toBeGreaterThan(0);
  });

  // ── POST routes ──────────────────────────────────────────────────────────
  test('registers POST /clash-run', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'POST', path: '/clash-run' });
  });

  test('registers POST /issues', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'POST', path: '/issues' });
  });

  test('registers POST /bcf-export', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'POST', path: '/bcf-export' });
  });

  test('registers POST /delta', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'POST', path: '/delta' });
  });

  test('registers POST /discipline-test', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'POST', path: '/discipline-test' });
  });

  test('registers POST /meeting-pack', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'POST', path: '/meeting-pack' });
  });

  test('registers POST /model-gate', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'POST', path: '/model-gate' });
  });

  // ── GET routes ───────────────────────────────────────────────────────────
  test('registers GET /clashes/:runId', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'GET', path: '/clashes/:runId' });
  });

  test('registers GET /issues', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'GET', path: '/issues' });
  });

  test('registers GET /viewpoints/:groupId', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'GET', path: '/viewpoints/:groupId' });
  });

  test('registers GET /trends', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'GET', path: '/trends' });
  });

  test('registers GET /schedule-linkage', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'GET', path: '/schedule-linkage' });
  });

  test('registers GET /milestones', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'GET', path: '/milestones' });
  });

  test('registers GET /penetrations', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'GET', path: '/penetrations' });
  });

  test('registers GET /governance', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'GET', path: '/governance' });
  });

  test('registers GET /gaps', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'GET', path: '/gaps' });
  });

  test('registers GET /sla', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'GET', path: '/sla' });
  });

  test('registers GET /summary', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'GET', path: '/summary' });
  });

  // ── PUT routes ───────────────────────────────────────────────────────────
  test('registers PUT /issues/:id', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'PUT', path: '/issues/:id' });
  });

  test('registers PUT /issues/:id/status', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'PUT', path: '/issues/:id/status' });
  });

  // ── Constructability routes ──────────────────────────────────────────────
  test('registers POST /constructability/:projectId', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'POST', path: '/constructability/:projectId' });
  });

  test('registers GET /constructability/:projectId', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'GET', path: '/constructability/:projectId' });
  });

  test('registers GET /constructability/:projectId/work-areas', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'GET', path: '/constructability/:projectId/work-areas' });
  });

  test('registers GET /constructability/:projectId/temp-works', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'GET', path: '/constructability/:projectId/temp-works' });
  });

  test('registers GET /constructability/:projectId/trade-sequence', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'GET', path: '/constructability/:projectId/trade-sequence' });
  });

  test('registers GET /constructability/:projectId/safety', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'GET', path: '/constructability/:projectId/safety' });
  });

  test('registers GET /constructability/:projectId/summary', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'GET', path: '/constructability/:projectId/summary' });
  });

  test('registers DELETE /constructability/:projectId', () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: 'DELETE', path: '/constructability/:projectId' });
  });

  // ── Route count sanity check ─────────────────────────────────────────────
  test('total registered route count matches expected (~29 routes)', () => {
    const routes = getRoutes();
    // 21 core routes + 8 constructability routes = 29
    expect(routes.length).toBeGreaterThanOrEqual(29);
  });
});
