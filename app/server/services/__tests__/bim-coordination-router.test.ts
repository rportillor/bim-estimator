/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  BIM COORDINATION ROUTER — Test Suite
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { bimCoordinationRouter } from '../bim-coordination-router';

describe('bim-coordination-router.ts', () => {
  test('router is defined', () => {
    expect(bimCoordinationRouter).toBeDefined();
  });

  test('router has route registration methods', () => {
    expect(typeof bimCoordinationRouter.get).toBe('function');
    expect(typeof bimCoordinationRouter.post).toBe('function');
    expect(typeof bimCoordinationRouter.put).toBe('function');
  });

  test('router is an Express Router instance', () => {
    // Express routers have stack property
    expect(bimCoordinationRouter).toHaveProperty('stack');
  });

  test('router has registered routes', () => {
    const stack = (bimCoordinationRouter as any).stack;
    expect(Array.isArray(stack)).toBe(true);
    expect(stack.length).toBeGreaterThan(0);
  });
});
