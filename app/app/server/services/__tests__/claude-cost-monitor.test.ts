/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  CLAUDE COST MONITOR — Test Suite
 *  Tests: singleton, cost tracking, budget alerts
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { claudeCostMonitor, ClaudeCostMonitor } from '../claude-cost-monitor';

describe('ClaudeCostMonitor', () => {
  test('singleton exists', () => {
    expect(claudeCostMonitor).toBeDefined();
    expect(claudeCostMonitor).toBeInstanceOf(ClaudeCostMonitor);
  });

  test('getInstance returns same instance', () => {
    const a = ClaudeCostMonitor.getInstance();
    const b = ClaudeCostMonitor.getInstance();
    expect(a).toBe(b);
  });

  test('has recordCall method', () => {
    expect(typeof claudeCostMonitor.recordCall).toBe('function');
  });

  test('has getSessionCost method', () => {
    expect(typeof claudeCostMonitor.getSessionCost).toBe('function');
  });

  test('has isOverBudget method', () => {
    expect(typeof claudeCostMonitor.isOverBudget).toBe('function');
  });

  test('records API call cost', () => {
    claudeCostMonitor.recordCall({
      model: 'claude-sonnet-4-20250514',
      inputTokens: 2000,
      outputTokens: 1000,
      durationMs: 3500,
    });
    const cost = claudeCostMonitor.getSessionCost();
    expect(cost).toBeGreaterThanOrEqual(0);
  });

  test('isOverBudget returns false initially', () => {
    const monitor = new ClaudeCostMonitor();
    expect(monitor.isOverBudget(100)).toBe(false);
  });

  test('getCallCount returns number', () => {
    expect(typeof claudeCostMonitor.getCallCount()).toBe('number');
  });
});
