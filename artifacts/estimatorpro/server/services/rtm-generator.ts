// server/services/rtm-generator.ts
// ═══════════════════════════════════════════════════════════════════════════
// QA/QC Master Plan §15 Requirements Traceability Matrix (RTM)
// Maps every requirement to test cases → ensures complete coverage
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID as _randomUUID } from 'crypto';

// ─── TYPES ───────────────────────────────────────────────────────────────

export type RequirementType = 'functional' | 'non-functional' | 'compliance' | 'performance' | 'security';
export type TestType = 'unit' | 'integration' | 'e2e' | 'security' | 'performance' | 'UAT' | 'compliance';
export type CoverageStatus = 'covered' | 'partial' | 'not_covered' | 'deferred';

export interface Requirement {
  id: string;
  description: string;
  type: RequirementType;
  priority: 'critical' | 'high' | 'medium' | 'low';
  source: string;
  testCaseIds: string[];
  testTypes: TestType[];
  coverageStatus: CoverageStatus;
  notes: string;
}

export interface RTMReport {
  generatedAt: string;
  releaseVersion: string;
  totalRequirements: number;
  covered: number;
  partial: number;
  notCovered: number;
  deferred: number;
  coveragePercent: number;
  gaps: Requirement[];
  requirements: Requirement[];
}

// ─── PRE-POPULATED REQUIREMENTS ──────────────────────────────────────────
// EstimatorPro v14.4 core requirements mapped to QA/QC Master Plan sections

const requirements: Requirement[] = [
  // ── FUNCTIONAL REQUIREMENTS ──
  { id: 'REQ-001', description: 'Upload and process PDF construction drawings', type: 'functional', priority: 'critical', source: 'SOP Part 3', testCaseIds: ['E2E-02', 'U-PDF-001'], testTypes: ['e2e', 'unit'], coverageStatus: 'covered', notes: 'pdf-extraction-service.ts, batch-processor.ts' },
  { id: 'REQ-002', description: 'Extract dimensions, materials, and specifications from drawings via AI', type: 'functional', priority: 'critical', source: 'SOP Part 4', testCaseIds: ['AI-01', 'AI-02', 'E2E-02'], testTypes: ['e2e', 'integration'], coverageStatus: 'covered', notes: 'ai-processor.ts, prompt-library.ts' },
  { id: 'REQ-003', description: 'Generate BIM model from extracted data', type: 'functional', priority: 'critical', source: 'SOP Part 5', testCaseIds: ['E2E-03', 'BIM-01'], testTypes: ['e2e', 'integration'], coverageStatus: 'covered', notes: 'bim-generator.ts, storey-resolver.ts' },
  { id: 'REQ-004', description: 'Calculate quantities from BIM model (QTO)', type: 'functional', priority: 'critical', source: 'SOP Part 5', testCaseIds: ['QTO-A01', 'QTO-V01', 'QTO-C01'], testTypes: ['unit', 'integration'], coverageStatus: 'covered', notes: 'real-qto-processor.ts, geometry-validator.ts' },
  { id: 'REQ-005', description: 'Produce BOQ with CSI MasterFormat divisions', type: 'functional', priority: 'critical', source: 'SOP Part 6', testCaseIds: ['E2E-04', 'L3-INT'], testTypes: ['e2e', 'unit'], coverageStatus: 'covered', notes: 'estimate-engine.ts, 34 CSI divisions' },
  { id: 'REQ-006', description: 'Cost estimation with labor/material/equipment breakdown', type: 'functional', priority: 'critical', source: 'SOP Part 7', testCaseIds: ['E2E-04', 'L2-UNIT'], testTypes: ['e2e', 'unit'], coverageStatus: 'covered', notes: 'cost-estimation-engine.ts, rate tables' },
  { id: 'REQ-007', description: 'Run compliance checks against NBC/OBC/CSA codes', type: 'functional', priority: 'critical', source: 'SOP Part 8', testCaseIds: ['COM-05', 'COM-07', 'E2E-04'], testTypes: ['e2e', 'compliance'], coverageStatus: 'covered', notes: 'rules-engine.ts, 113 YAML rules' },
  { id: 'REQ-008', description: 'Generate RFIs for missing/conflicting data', type: 'functional', priority: 'high', source: 'SOP Part 8', testCaseIds: ['COM-09', 'COM-10'], testTypes: ['integration', 'compliance'], coverageStatus: 'covered', notes: 'rfi-generator.ts, rfi-service.ts' },
  { id: 'REQ-009', description: 'Clash detection between building systems', type: 'functional', priority: 'high', source: 'Stream A', testCaseIds: ['E2E-06', 'CLASH-01'], testTypes: ['e2e', 'integration'], coverageStatus: 'covered', notes: 'clash-detection-engine.ts, 1175 lines' },
  { id: 'REQ-010', description: '3D BIM model viewer with element selection', type: 'functional', priority: 'high', source: 'UI Requirements', testCaseIds: ['BIM-07', 'BIM-08'], testTypes: ['e2e'], coverageStatus: 'covered', notes: 'viewer-3d.tsx, hybrid-3d-viewer.tsx' },
  { id: 'REQ-011', description: 'Export reports: BOQ Full, Bid-Level, Executive Summary, Clash', type: 'functional', priority: 'high', source: 'SOP Part 8', testCaseIds: ['EXP-01', 'EXP-02'], testTypes: ['integration'], coverageStatus: 'covered', notes: 'report-generator.ts, 7 report types' },
  { id: 'REQ-012', description: 'No hardcoded/default values — prompt user or generate RFI', type: 'functional', priority: 'critical', source: 'QS Principle', testCaseIds: ['L1-STATIC'], testTypes: ['unit'], coverageStatus: 'covered', notes: 'Zero hardcoded values verified in audit' },
  { id: 'REQ-013', description: 'Canadian provincial cost factors and tax rates', type: 'functional', priority: 'high', source: 'SOP Part 7', testCaseIds: ['L4-SYS'], testTypes: ['unit'], coverageStatus: 'covered', notes: '13 provinces/territories in rate tables' },
  { id: 'REQ-014', description: 'Waste factor calculation per construction type', type: 'functional', priority: 'medium', source: 'CIQS Standard', testCaseIds: ['L2-UNIT'], testTypes: ['unit'], coverageStatus: 'covered', notes: 'estimate-engine.ts waste factor logic' },

  // ── NON-FUNCTIONAL REQUIREMENTS ──
  { id: 'NFR-001', description: 'Page load time P50 < 2 seconds', type: 'non-functional', priority: 'high', source: '§9.2', testCaseIds: ['PF-01'], testTypes: ['performance'], coverageStatus: 'covered', notes: 'Lighthouse CI config, performance-monitor.ts' },
  { id: 'NFR-002', description: 'API response time P50 < 200ms', type: 'non-functional', priority: 'high', source: '§9.2', testCaseIds: ['PF-API'], testTypes: ['performance'], coverageStatus: 'partial', notes: 'Health endpoints tested, full load test needed' },
  { id: 'NFR-003', description: 'WebGL viewer FPS > 30 on reference model', type: 'non-functional', priority: 'medium', source: '§9.3 PF-08', testCaseIds: ['PF-08'], testTypes: ['performance'], coverageStatus: 'partial', notes: 'Three.js optimizations present, runtime benchmark needed' },
  { id: 'NFR-004', description: 'WCAG 2.1 AA accessibility compliance', type: 'non-functional', priority: 'medium', source: '§5.4', testCaseIds: ['A11Y-01'], testTypes: ['e2e'], coverageStatus: 'partial', notes: 'Static checks done, axe-core integration needed' },

  // ── SECURITY REQUIREMENTS ──
  { id: 'SEC-REQ-001', description: 'No hardcoded secrets in source code', type: 'security', priority: 'critical', source: '§8.2 SEC-21', testCaseIds: ['SEC-02a'], testTypes: ['security'], coverageStatus: 'covered', notes: 'Verified in security test suite' },
  { id: 'SEC-REQ-002', description: 'SQL injection prevention (parameterized queries)', type: 'security', priority: 'critical', source: '§8.1 SEC-03', testCaseIds: ['SEC-03a'], testTypes: ['security'], coverageStatus: 'covered', notes: 'Drizzle ORM, no raw SQL concat' },
  { id: 'SEC-REQ-003', description: 'Prompt injection defense for AI features', type: 'security', priority: 'high', source: '§8.2 SEC-20', testCaseIds: ['SEC-20a', 'AI-11'], testTypes: ['security'], coverageStatus: 'covered', notes: 'Adversarial corpus, system role separation' },
  { id: 'SEC-REQ-004', description: 'CSP, HSTS, X-Frame-Options headers', type: 'security', priority: 'high', source: '§8.2 SEC-13', testCaseIds: ['SEC-13a'], testTypes: ['security'], coverageStatus: 'covered', notes: 'csp-security.ts middleware' },

  // ── COMPLIANCE REQUIREMENTS ──
  { id: 'CMP-001', description: 'Citation integrity — all claims cite source clause', type: 'compliance', priority: 'critical', source: '§17.3', testCaseIds: ['AI-01', 'AI-02', 'AI-03'], testTypes: ['compliance'], coverageStatus: 'covered', notes: 'prompt-library.ts evidence ref requirement' },
  { id: 'CMP-002', description: 'QS Level 5 compliance (42 sub-items)', type: 'compliance', priority: 'critical', source: 'CIQS/RICS', testCaseIds: ['QS-L5'], testTypes: ['compliance'], coverageStatus: 'covered', notes: 'qs-level5-supplement.ts, compliance panel' },
  { id: 'CMP-003', description: 'Evidence traceability for all BOQ line items', type: 'compliance', priority: 'critical', source: 'CIQS Standard', testCaseIds: ['L7-TRACE'], testTypes: ['unit', 'compliance'], coverageStatus: 'covered', notes: 'Traceability matrix tests in final-qa-test.ts' },
];

// ─── RTM GENERATION ──────────────────────────────────────────────────────

export function generateRTM(releaseVersion: string): RTMReport {
  const covered = requirements.filter(r => r.coverageStatus === 'covered').length;
  const partial = requirements.filter(r => r.coverageStatus === 'partial').length;
  const notCovered = requirements.filter(r => r.coverageStatus === 'not_covered').length;
  const deferred = requirements.filter(r => r.coverageStatus === 'deferred').length;

  const gaps = requirements.filter(r => r.coverageStatus !== 'covered');

  return {
    generatedAt: new Date().toISOString(),
    releaseVersion,
    totalRequirements: requirements.length,
    covered,
    partial,
    notCovered,
    deferred,
    coveragePercent: Math.round((covered / requirements.length) * 100 * 10) / 10,
    gaps,
    requirements,
  };
}

export function getRequirement(id: string): Requirement | undefined {
  return requirements.find(r => r.id === id);
}

export function getGaps(): Requirement[] {
  return requirements.filter(r => r.coverageStatus !== 'covered');
}

export function getRequirementsByType(type: RequirementType): Requirement[] {
  return requirements.filter(r => r.type === type);
}

export function getRequirementsByPriority(priority: string): Requirement[] {
  return requirements.filter(r => r.priority === priority);
}

export function getAllRequirements(): Requirement[] {
  return [...requirements];
}

export function getCoverageByType(): Record<string, { total: number; covered: number; percent: number }> {
  const result: Record<string, { total: number; covered: number; percent: number }> = {};
  for (const type of ['functional', 'non-functional', 'security', 'compliance', 'performance']) {
    const byType = requirements.filter(r => r.type === type);
    const covered = byType.filter(r => r.coverageStatus === 'covered').length;
    result[type] = { total: byType.length, covered, percent: byType.length > 0 ? Math.round((covered / byType.length) * 100) : 0 };
  }
  return result;
}
