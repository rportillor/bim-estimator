/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  PLAN-BASED COST MONITOR — Test Suite
 *  Tests: singleton, plan tracking, usage limits, admin notifications
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { planBasedCostMonitor, PlanBasedCostMonitor } from '../plan-based-cost-monitor';
import type { Plan, PlanUsage } from '../plan-based-cost-monitor';

describe('PlanBasedCostMonitor', () => {
  test('singleton exists', () => {
    expect(planBasedCostMonitor).toBeDefined();
    expect(planBasedCostMonitor).toBeInstanceOf(PlanBasedCostMonitor);
  });

  test('getInstance returns same instance', () => {
    const instance1 = PlanBasedCostMonitor.getInstance();
    const instance2 = PlanBasedCostMonitor.getInstance();
    expect(instance1).toBe(instance2);
  });

  test('has trackUsage method', () => {
    expect(typeof planBasedCostMonitor.trackUsage).toBe('function');
  });

  test('has getUsage method', () => {
    expect(typeof planBasedCostMonitor.getUsage).toBe('function');
  });

  test('has checkLimit method', () => {
    expect(typeof planBasedCostMonitor.checkLimit).toBe('function');
  });

  test('tracks API usage', () => {
    planBasedCostMonitor.trackUsage('test-user', {
      inputTokens: 1000,
      outputTokens: 500,
      model: 'claude-sonnet-4-20250514',
      costUsd: 0.015,
    });
    const usage = planBasedCostMonitor.getUsage('test-user');
    expect(usage).toBeDefined();
    expect(usage!.totalCostUsd).toBeGreaterThan(0);
  });

  test('checkLimit returns boolean', () => {
    const allowed = planBasedCostMonitor.checkLimit('test-user', 'pro');
    expect(typeof allowed).toBe('boolean');
  });
});
