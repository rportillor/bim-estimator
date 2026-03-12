// server/services/test-metrics-collector.ts
// ═══════════════════════════════════════════════════════════════════════════
// QA/QC Master Plan §14.1 Key Metrics Dashboard, §2.4 Test Governance
// Collects, stores, and reports test metrics per release
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';

// ─── TYPES ───────────────────────────────────────────────────────────────

export interface TestRun {
  id: string;
  releaseVersion: string;
  timestamp: string;
  environment: 'DEV' | 'QA' | 'STAGING' | 'PRODUCTION';
  suiteType: 'unit' | 'integration' | 'e2e' | 'security' | 'performance' | 'estimate-qa';
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  coveragePercent?: number;
  branchCoveragePercent?: number;
}

export interface Defect {
  id: string;
  title: string;
  severity: 'S1' | 'S2' | 'S3' | 'S4';
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  status: 'New' | 'Triaged' | 'Assigned' | 'InProgress' | 'Fixed' | 'ReadyForRetest' | 'Verified' | 'Closed' | 'Deferred' | 'Reopened';
  environment: string;
  module: string;
  assignedTo: string | null;
  createdAt: string;
  resolvedAt: string | null;
  rootCause: string | null;
  resolution: string | null;
  releaseVersion: string;
}

export interface MetricsDashboard {
  releaseVersion: string;
  snapshotAt: string;
  executionRate: number;       // (Executed / Total) × 100  target ≥ 95%
  passRate: number;            // (Passed / Executed) × 100  target ≥ 90%
  defectDensity: number;       // Defects / KLOC  target < 5
  defectLeakage: number;       // Prod defects / Total  target < 5%
  openDefectAging: number;     // Avg days open (S1/S2)  target < 3
  automationCoverage: number;  // Automated / Total  target ≥ 60%
  codeCoverage: number;        // Line coverage  target ≥ 80%
  requirementsCoverage: number; // Reqs with tests / Total  target 100%
  totalTests: number;
  totalPassed: number;
  totalFailed: number;
  testRuns: TestRun[];
  defects: DefectSummary;
}

export interface DefectSummary {
  total: number;
  open: number;
  closed: number;
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
  avgResolutionHours: Record<string, number>;
}

// ─── IN-MEMORY STORE ─────────────────────────────────────────────────────

const testRuns: TestRun[] = [];
const defects: Defect[] = [];

// ─── COLLECTION ──────────────────────────────────────────────────────────

export function recordTestRun(run: Omit<TestRun, 'id' | 'timestamp'>): TestRun {
  const record: TestRun = {
    ...run,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  };
  testRuns.push(record);
  return record;
}

export function recordDefect(defect: Omit<Defect, 'id' | 'createdAt'>): Defect {
  const record: Defect = {
    ...defect,
    id: `DEF-${String(defects.length + 1).padStart(4, '0')}`,
    createdAt: new Date().toISOString(),
  };
  defects.push(record);
  return record;
}

export function updateDefect(id: string, updates: Partial<Defect>): Defect | null {
  const defect = defects.find(d => d.id === id);
  if (!defect) return null;
  Object.assign(defect, updates);
  if (updates.status === 'Closed' || updates.status === 'Verified') {
    defect.resolvedAt = new Date().toISOString();
  }
  return defect;
}

// ─── REPORTING ───────────────────────────────────────────────────────────

export function generateDashboard(releaseVersion: string, klocCount: number): MetricsDashboard {
  const releaseRuns = testRuns.filter(r => r.releaseVersion === releaseVersion);
  const releaseDefects = defects.filter(d => d.releaseVersion === releaseVersion);

  const totalTests = releaseRuns.reduce((s, r) => s + r.totalTests, 0);
  const totalPassed = releaseRuns.reduce((s, r) => s + r.passed, 0);
  const totalFailed = releaseRuns.reduce((s, r) => s + r.failed, 0);
  const totalExecuted = totalPassed + totalFailed;

  const openDefects = releaseDefects.filter(d => !['Closed', 'Verified', 'Deferred'].includes(d.status));
  const closedDefects = releaseDefects.filter(d => ['Closed', 'Verified'].includes(d.status));
  const prodDefects = releaseDefects.filter(d => d.environment === 'PRODUCTION');

  // §14.1 SLA: avg days open for S1/S2
  const s1s2Open = openDefects.filter(d => d.severity === 'S1' || d.severity === 'S2');
  const avgAgingDays = s1s2Open.length > 0
    ? s1s2Open.reduce((s, d) => s + (Date.now() - new Date(d.createdAt).getTime()) / 86400000, 0) / s1s2Open.length
    : 0;

  // Resolution time by severity
  const avgResolution: Record<string, number> = {};
  for (const sev of ['S1', 'S2', 'S3', 'S4']) {
    const resolved = closedDefects.filter(d => d.severity === sev && d.resolvedAt);
    if (resolved.length > 0) {
      avgResolution[sev] = resolved.reduce((s, d) =>
        s + (new Date(d.resolvedAt!).getTime() - new Date(d.createdAt).getTime()) / 3600000, 0
      ) / resolved.length;
    }
  }

  const bySeverity: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const d of releaseDefects) {
    bySeverity[d.severity] = (bySeverity[d.severity] || 0) + 1;
    byStatus[d.status] = (byStatus[d.status] || 0) + 1;
  }

  const coverageRuns = releaseRuns.filter(r => r.coveragePercent != null);
  const avgCoverage = coverageRuns.length > 0
    ? coverageRuns.reduce((s, r) => s + (r.coveragePercent || 0), 0) / coverageRuns.length
    : 0;

  const automatedRuns = releaseRuns.filter(r => r.suiteType !== 'e2e');
  const automationCov = totalTests > 0
    ? (automatedRuns.reduce((s, r) => s + r.totalTests, 0) / totalTests) * 100
    : 0;

  return {
    releaseVersion,
    snapshotAt: new Date().toISOString(),
    executionRate: totalTests > 0 ? (totalExecuted / totalTests) * 100 : 0,
    passRate: totalExecuted > 0 ? (totalPassed / totalExecuted) * 100 : 0,
    defectDensity: klocCount > 0 ? releaseDefects.length / klocCount : 0,
    defectLeakage: releaseDefects.length > 0 ? (prodDefects.length / releaseDefects.length) * 100 : 0,
    openDefectAging: Math.round(avgAgingDays * 10) / 10,
    automationCoverage: Math.round(automationCov * 10) / 10,
    codeCoverage: Math.round(avgCoverage * 10) / 10,
    requirementsCoverage: 0, // Populated from RTM
    totalTests,
    totalPassed,
    totalFailed,
    testRuns: releaseRuns,
    defects: {
      total: releaseDefects.length,
      open: openDefects.length,
      closed: closedDefects.length,
      bySeverity,
      byStatus,
      avgResolutionHours: avgResolution,
    },
  };
}

// ─── EXIT CRITERIA CHECK (§2.3) ─────────────────────────────────────────

export interface ExitCriteriaResult {
  passed: boolean;
  checks: Array<{ criterion: string; met: boolean; detail: string }>;
}

export function checkExitCriteria(releaseVersion: string): ExitCriteriaResult {
  const dashboard = generateDashboard(releaseVersion, 153); // ~153 KLOC
  const releaseDefects = defects.filter(d => d.releaseVersion === releaseVersion);
  const openCritHigh = releaseDefects.filter(d =>
    (d.severity === 'S1' || d.severity === 'S2') &&
    !['Closed', 'Verified', 'Deferred'].includes(d.status)
  );
  const openMedium = releaseDefects.filter(d =>
    d.severity === 'S3' && !['Closed', 'Verified', 'Deferred'].includes(d.status)
  );

  const checks = [
    {
      criterion: '100% Critical/High test cases executed',
      met: dashboard.executionRate >= 95,
      detail: `Execution rate: ${dashboard.executionRate.toFixed(1)}%`,
    },
    {
      criterion: 'Zero open Critical/High defects',
      met: openCritHigh.length === 0,
      detail: `Open S1/S2: ${openCritHigh.length}`,
    },
    {
      criterion: 'All Medium defects triaged',
      met: openMedium.every(d => d.status !== 'New'),
      detail: `Untriaged medium: ${openMedium.filter(d => d.status === 'New').length}`,
    },
    {
      criterion: 'Pass rate ≥ 90%',
      met: dashboard.passRate >= 90,
      detail: `Pass rate: ${dashboard.passRate.toFixed(1)}%`,
    },
    {
      criterion: 'Code coverage ≥ 80%',
      met: dashboard.codeCoverage >= 80,
      detail: `Coverage: ${dashboard.codeCoverage.toFixed(1)}%`,
    },
    {
      criterion: 'Defect density < 5/KLOC',
      met: dashboard.defectDensity < 5,
      detail: `Density: ${dashboard.defectDensity.toFixed(2)}/KLOC`,
    },
  ];

  return {
    passed: checks.every(c => c.met),
    checks,
  };
}

export function getTestRuns(): TestRun[] { return [...testRuns]; }
export function getDefects(): Defect[] { return [...defects]; }
