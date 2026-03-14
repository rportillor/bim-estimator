/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  CLAUDE COST MONITOR — Test Suite
 *  Tests: singleton, cost tracking, budget checks, usage reporting
 * ══════════════════════════════════════════════════════════════════════════════
 */

// Mock the db module before any imports
jest.mock('../../db', () => ({
  db: {},
}));

jest.mock('drizzle-orm', () => ({
  sql: jest.fn(),
}));

import { ClaudeCostMonitor } from '../claude-cost-monitor';

// Helper: create a fresh monitor for isolated tests.
// We avoid the shared singleton so tests don't interfere with each other.
function createMonitor(): ClaudeCostMonitor {
  return new ClaudeCostMonitor();
}

describe('ClaudeCostMonitor', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── Singleton ───────────────────────────────────────────────────────
  test('getInstance returns same instance', () => {
    const a = ClaudeCostMonitor.getInstance();
    const b = ClaudeCostMonitor.getInstance();
    expect(a).toBe(b);
  });

  // ─── getTodaysUsage ──────────────────────────────────────────────────
  test('fresh monitor reports zero usage', async () => {
    const monitor = createMonitor();
    const usage = await monitor.getTodaysUsage();
    expect(usage.totalCost).toBe(0);
    expect(usage.totalTokens).toBe(0);
    expect(usage.apiCalls).toBe(0);
    expect(usage.limit).toBe(50);
    expect(usage.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // ─── trackApiCall ────────────────────────────────────────────────────
  test('trackApiCall records cost and returns daily total', async () => {
    const monitor = createMonitor();
    const result = await monitor.trackApiCall(
      'claude-sonnet-4-20250514',
      2000,  // input tokens
      1000,  // output tokens
      'doc-123',
      'document_analysis',
    );

    // cost = (2000 * 0.015 + 1000 * 0.075) / 1000 = (30 + 75) / 1000 = 0.105
    expect(result.cost).toBeCloseTo(0.105, 4);
    expect(result.dailyTotal).toBeCloseTo(0.105, 4);
  });

  test('trackApiCall accumulates costs across multiple calls', async () => {
    const monitor = createMonitor();
    await monitor.trackApiCall('claude-sonnet-4-20250514', 1000, 500);
    const second = await monitor.trackApiCall('claude-sonnet-4-20250514', 1000, 500);

    // each call: (1000*0.015 + 500*0.075) / 1000 = (15 + 37.5) / 1000 = 0.0525
    expect(second.dailyTotal).toBeCloseTo(0.105, 4);
  });

  test('trackApiCall uses fallback pricing for unknown model', async () => {
    const monitor = createMonitor();
    const result = await monitor.trackApiCall('unknown-model', 1000, 1000);
    // falls back to claude-sonnet-4-20250514 pricing
    // (1000*0.015 + 1000*0.075) / 1000 = 0.09
    expect(result.cost).toBeCloseTo(0.09, 4);
  });

  test('trackApiCall uses claude-3-7-sonnet pricing when specified', async () => {
    const monitor = createMonitor();
    const result = await monitor.trackApiCall(
      'claude-3-7-sonnet-20250219',
      1000,
      1000,
    );
    // (1000*0.003 + 1000*0.015) / 1000 = 0.018
    expect(result.cost).toBeCloseTo(0.018, 4);
  });

  // ─── checkBudgetBeforeCall ───────────────────────────────────────────
  test('checkBudgetBeforeCall allows call within budget', async () => {
    const monitor = createMonitor();
    const check = await monitor.checkBudgetBeforeCall(1000);
    expect(check.allowed).toBe(true);
    expect(check.remainingBudget).toBe(50);
  });

  test('checkBudgetBeforeCall denies call that would exceed budget', async () => {
    const monitor = createMonitor();
    monitor.setDailyLimit(0.01); // very low limit

    const check = await monitor.checkBudgetBeforeCall(10000);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('exceed daily budget');
    expect(check.remainingBudget).toBe(0.01);
  });

  test('checkBudgetBeforeCall denies call after emergencyStop', async () => {
    const monitor = createMonitor();
    monitor.emergencyStop();

    // The budget check happens first; with no prior usage and a large budget
    // the budget check itself passes, but then monitoring-active check fails.
    // However, we need to trigger the budget branch to NOT fire first.
    // With 0 usage and default $50 limit, budget check passes, then
    // isMonitoringActive=false triggers the second guard.
    const check = await monitor.checkBudgetBeforeCall(100);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('monitoring disabled');
  });

  // ─── setDailyLimit ───────────────────────────────────────────────────
  test('setDailyLimit changes the budget', async () => {
    const monitor = createMonitor();
    monitor.setDailyLimit(10);
    const usage = await monitor.getTodaysUsage();
    expect(usage.limit).toBe(10);
  });

  // ─── resetMonitoring ─────────────────────────────────────────────────
  test('resetMonitoring re-enables monitoring after emergencyStop', async () => {
    const monitor = createMonitor();
    monitor.emergencyStop();

    // Verify it's disabled
    let check = await monitor.checkBudgetBeforeCall(100);
    expect(check.allowed).toBe(false);

    // Reset and verify it's enabled again
    monitor.resetMonitoring();
    check = await monitor.checkBudgetBeforeCall(100);
    expect(check.allowed).toBe(true);
  });

  // ─── getUsageReport ──────────────────────────────────────────────────
  test('getUsageReport returns structured report', async () => {
    const monitor = createMonitor();
    await monitor.trackApiCall('claude-sonnet-4-20250514', 500, 500, 'doc-1', 'summarize');
    await monitor.trackApiCall('claude-3-7-sonnet-20250219', 1000, 200, 'doc-2', 'translate');

    const report = await monitor.getUsageReport();

    expect(report.today).toBeDefined();
    expect(report.today.apiCalls).toBe(2);

    expect(report.last7Days).toHaveLength(7);

    expect(report.topOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'summarize', calls: 1 }),
        expect.objectContaining({ operation: 'translate', calls: 1 }),
      ]),
    );

    expect(report.costByModel).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: 'claude-sonnet-4-20250514', calls: 1 }),
        expect.objectContaining({ model: 'claude-3-7-sonnet-20250219', calls: 1 }),
      ]),
    );
  });

  // ─── Budget overrun disables monitoring ──────────────────────────────
  test('exceeding daily limit disables monitoring', async () => {
    const monitor = createMonitor();
    monitor.setDailyLimit(0.001); // extremely low limit

    // This call will exceed the $0.001 limit
    await monitor.trackApiCall('claude-sonnet-4-20250514', 1000, 1000);

    // Next budget check should fail because monitoring was auto-disabled
    const check = await monitor.checkBudgetBeforeCall(100);
    expect(check.allowed).toBe(false);
  });
});
