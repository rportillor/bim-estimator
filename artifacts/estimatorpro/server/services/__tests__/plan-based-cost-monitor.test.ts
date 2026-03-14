/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  PLAN-BASED COST MONITOR — Test Suite
 *  Tests: singleton, plan tracking, usage limits, admin notifications
 * ══════════════════════════════════════════════════════════════════════════════
 */

// Mock the db module (imported but not directly used in current methods)
jest.mock('../../db', () => ({
  db: {},
}));

// Mock the dynamic import of claude-cost-monitor used inside private helpers
jest.mock('../claude-cost-monitor', () => ({
  claudeCostMonitor: {
    getTodaysUsage: jest.fn().mockResolvedValue({ totalTokens: 0 }),
  },
}));

import { planBasedCostMonitor, PlanBasedCostMonitor } from '../plan-based-cost-monitor';
import type { Plan, PlanUsage, AdminNotification } from '../plan-based-cost-monitor';

describe('PlanBasedCostMonitor', () => {
  // Reset singleton notifications between tests by acknowledging all
  beforeEach(() => {
    // Clear unacknowledged notifications so tests are independent
    const notes = planBasedCostMonitor.getAdminNotifications();
    notes.forEach((n: AdminNotification) => planBasedCostMonitor.acknowledgeNotification(n.id));
  });

  // ── Singleton ──────────────────────────────────────────────────────────────

  test('singleton export exists and is a PlanBasedCostMonitor', () => {
    expect(planBasedCostMonitor).toBeDefined();
    expect(planBasedCostMonitor).toBeInstanceOf(PlanBasedCostMonitor);
  });

  test('getInstance returns the same instance every time', () => {
    const a = PlanBasedCostMonitor.getInstance();
    const b = PlanBasedCostMonitor.getInstance();
    expect(a).toBe(b);
  });

  // ── Exported method existence ──────────────────────────────────────────────

  test('has getCurrentPlan method', () => {
    expect(typeof planBasedCostMonitor.getCurrentPlan).toBe('function');
  });

  test('has checkPlanUsage method', () => {
    expect(typeof planBasedCostMonitor.checkPlanUsage).toBe('function');
  });

  test('has trackPlanUsage method', () => {
    expect(typeof planBasedCostMonitor.trackPlanUsage).toBe('function');
  });

  test('has getAdminNotifications method', () => {
    expect(typeof planBasedCostMonitor.getAdminNotifications).toBe('function');
  });

  test('has acknowledgeNotification method', () => {
    expect(typeof planBasedCostMonitor.acknowledgeNotification).toBe('function');
  });

  test('has getAdminUsageSummary method', () => {
    expect(typeof planBasedCostMonitor.getAdminUsageSummary).toBe('function');
  });

  test('has updatePlan method', () => {
    expect(typeof planBasedCostMonitor.updatePlan).toBe('function');
  });

  // ── getCurrentPlan ─────────────────────────────────────────────────────────

  test('getCurrentPlan returns a valid Plan', async () => {
    const plan: Plan = await planBasedCostMonitor.getCurrentPlan();
    expect(plan).toBeDefined();
    expect(plan).toHaveProperty('name');
    expect(plan).toHaveProperty('monthlyTokens');
    expect(plan).toHaveProperty('dailyTokens');
    expect(plan).toHaveProperty('costPerToken');
    expect(typeof plan.monthlyTokens).toBe('number');
  });

  // ── checkPlanUsage ─────────────────────────────────────────────────────────

  test('checkPlanUsage returns allowed, usage, and alerts', async () => {
    const result = await planBasedCostMonitor.checkPlanUsage(100, 'standard');
    expect(result).toHaveProperty('allowed');
    expect(result).toHaveProperty('usage');
    expect(result).toHaveProperty('alerts');
    expect(typeof result.allowed).toBe('boolean');
  });

  test('checkPlanUsage allows usage within limits', async () => {
    const result = await planBasedCostMonitor.checkPlanUsage(100, 'standard');
    expect(result.allowed).toBe(true);
    expect(result.usage.tokensRemaining).toBeGreaterThan(0);
  });

  test('checkPlanUsage returns correct usage shape', async () => {
    const { usage } = await planBasedCostMonitor.checkPlanUsage(500, 'pro');
    expect(usage.planName).toBe('pro');
    expect(usage.monthlyLimit).toBe(500000);
    expect(usage.dailyLimit).toBe(16667);
    expect(typeof usage.costIncurred).toBe('number');
    expect(typeof usage.usagePercentage).toBe('number');
  });

  test('checkPlanUsage rejects usage exceeding monthly limit', async () => {
    // Request more tokens than the standard plan allows (100K)
    const result = await planBasedCostMonitor.checkPlanUsage(200000, 'standard');
    expect(result.allowed).toBe(false);
    expect(result.usage.tokensRemaining).toBeLessThan(0);
  });

  test('checkPlanUsage generates alert at 75%+ usage', async () => {
    // 80K of 100K standard = 80%
    const result = await planBasedCostMonitor.checkPlanUsage(80000, 'standard');
    expect(result.usage.alert75Triggered).toBe(true);
    expect(result.alerts.length).toBeGreaterThanOrEqual(1);
    expect(result.alerts[0].severity).toBe('warning');
  });

  test('checkPlanUsage generates critical alert at 90%+ usage', async () => {
    // 95K of 100K standard = 95%
    const result = await planBasedCostMonitor.checkPlanUsage(95000, 'standard');
    const criticalAlerts = result.alerts.filter((a: AdminNotification) => a.severity === 'critical');
    expect(criticalAlerts.length).toBeGreaterThanOrEqual(1);
  });

  test('checkPlanUsage generates budget_exceeded alert over 100%', async () => {
    const result = await planBasedCostMonitor.checkPlanUsage(150000, 'standard');
    const exceeded = result.alerts.filter((a: AdminNotification) => a.type === 'budget_exceeded');
    expect(exceeded.length).toBeGreaterThanOrEqual(1);
  });

  test('checkPlanUsage falls back to standard when given unknown plan key', async () => {
    const result = await planBasedCostMonitor.checkPlanUsage(100, 'nonexistent-plan');
    expect(result.usage.planName).toBe('standard');
    expect(result.usage.monthlyLimit).toBe(100000);
  });

  // ── trackPlanUsage ─────────────────────────────────────────────────────────

  test('trackPlanUsage returns PlanUsage', async () => {
    const usage: PlanUsage = await planBasedCostMonitor.trackPlanUsage(
      200, 'pro', 'test-operation'
    );
    expect(usage).toBeDefined();
    expect(usage.planName).toBe('pro');
    expect(typeof usage.tokensUsed).toBe('number');
    expect(typeof usage.costIncurred).toBe('number');
  });

  // ── Admin notifications ────────────────────────────────────────────────────

  test('getAdminNotifications returns unacknowledged notifications', async () => {
    // Trigger an alert
    await planBasedCostMonitor.checkPlanUsage(150000, 'enterprise');
    const notes = planBasedCostMonitor.getAdminNotifications();
    expect(Array.isArray(notes)).toBe(true);
  });

  test('acknowledgeNotification marks a notification as acknowledged', async () => {
    await planBasedCostMonitor.updatePlan('org-1', 'pro', false);
    const before = planBasedCostMonitor.getAdminNotifications();
    expect(before.length).toBeGreaterThan(0);

    const id = before[0].id;
    planBasedCostMonitor.acknowledgeNotification(id);

    const after = planBasedCostMonitor.getAdminNotifications();
    const found = after.find((n: AdminNotification) => n.id === id);
    expect(found).toBeUndefined();
  });

  // ── updatePlan ─────────────────────────────────────────────────────────────

  test('updatePlan creates a plan_change notification', async () => {
    await planBasedCostMonitor.updatePlan('org-42', 'enterprise', true);
    const notes = planBasedCostMonitor.getAdminNotifications();
    const planChange = notes.find((n: AdminNotification) => n.type === 'plan_change');
    expect(planChange).toBeDefined();
    expect(planChange!.message).toContain('ENTERPRISE');
    expect(planChange!.message).toContain('Codes License');
    expect(planChange!.severity).toBe('info');
  });

  // ── getAdminUsageSummary ───────────────────────────────────────────────────

  test('getAdminUsageSummary returns plans, alerts, totalCost, totalTokens', async () => {
    const summary = await planBasedCostMonitor.getAdminUsageSummary();
    expect(summary).toHaveProperty('plans');
    expect(summary).toHaveProperty('alerts');
    expect(summary).toHaveProperty('totalCost');
    expect(summary).toHaveProperty('totalTokens');
    expect(Array.isArray(summary.plans)).toBe(true);
    expect(typeof summary.totalCost).toBe('number');
    expect(typeof summary.totalTokens).toBe('number');
  });

  // ── Codes license plan variants ────────────────────────────────────────────

  test('codes license plan has higher token limits than base plan', async () => {
    const base = await planBasedCostMonitor.checkPlanUsage(100, 'pro');
    const codes = await planBasedCostMonitor.checkPlanUsage(100, 'pro-codes');
    expect(codes.usage.monthlyLimit).toBeGreaterThan(base.usage.monthlyLimit);
    expect(codes.usage.codesLicense).toBe(true);
    expect(base.usage.codesLicense).toBe(false);
  });
});
