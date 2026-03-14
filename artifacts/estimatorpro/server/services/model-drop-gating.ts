/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  MODEL DROP GATING — SOP Part 2
 *  EstimatorPro v14.35 — Project-agnostic
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Quality gate that checks minimum metadata completeness before a model
 *  is accepted into the BIM coordination workflow. A model that fails gating
 *  is rejected with a clear list of remediation items.
 *
 *  Gate checks:
 *    1. Element count sanity (not empty, not suspiciously small)
 *    2. Level assignment coverage (% of elements with valid level)
 *    3. Material assignment (no "By Category" / "Default" placeholders)
 *    4. SystemType for MEP (all MEP elements have system assignment)
 *    5. Classification completeness (Uniformat/MasterFormat codes present)
 *    6. BEP naming compliance (file name, element naming)
 *
 *  Standards: ISO 19650, CIQS, project BEP
 *  Consumed by: bim-coordination-router.ts, construction-workflow-processor.ts
 *  Depends on:  bep-rules-engine.ts, discipline-sop.ts
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { type BEPRuleSet, MOORINGS_BEP, runBEPValidation } from './bep-rules-engine';
import type { DisciplineCode } from './discipline-sop';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type GateVerdict = 'ACCEPTED' | 'CONDITIONAL' | 'REJECTED';

export interface GateThresholds {
  minElementCount: number;
  minLevelCoverage: number;       // 0-1, e.g. 0.9 = 90% must have level
  minMaterialCoverage: number;    // 0-1
  minSystemTypeCoverage: number;  // 0-1 (MEP only)
  minBEPScore: number;            // 0-100
  maxPlaceholderPercent: number;  // 0-1, e.g. 0.05 = max 5% placeholders
}

export interface GateResult {
  verdict: GateVerdict;
  discipline: DisciplineCode;
  modelId: string;
  dropDate: string;
  checks: GateCheck[];
  overallScore: number;            // 0-100
  remediationItems: string[];
  acceptedWithConditions: string[];
  summary: string;
}

export interface GateCheck {
  name: string;
  passed: boolean;
  score: number;                   // 0-100
  threshold: number;
  actual: number;
  detail: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT THRESHOLDS
// ═══════════════════════════════════════════════════════════════════════════════

export const DEFAULT_THRESHOLDS: GateThresholds = {
  minElementCount: 10,
  minLevelCoverage: 0.90,
  minMaterialCoverage: 0.85,
  minSystemTypeCoverage: 0.90,
  minBEPScore: 70,
  maxPlaceholderPercent: 0.05,
};

const PLACEHOLDER_PATTERNS = [
  /^by category$/i,
  /^default$/i,
  /^<by category>$/i,
  /^<default>$/i,
  /^none$/i,
  /^n\/a$/i,
  /^tbd$/i,
  /^placeholder$/i,
];

// ═══════════════════════════════════════════════════════════════════════════════
// GATING ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run the model drop gate on a set of elements for a discipline.
 */
export function runModelDropGate(
  modelId: string,
  elements: Record<string, any>[],
  discipline: DisciplineCode,
  thresholds: GateThresholds = DEFAULT_THRESHOLDS,
  bep: BEPRuleSet = MOORINGS_BEP,
): GateResult {
  const checks: GateCheck[] = [];
  const remediationItems: string[] = [];
  const conditions: string[] = [];

  const isMEP = ['MECH', 'PLBG', 'FP', 'ELEC'].includes(discipline);
  const total = elements.length;

  // ── Check 1: Element Count ──────────────────────────────────────────────
  const countCheck: GateCheck = {
    name: 'Element Count',
    passed: total >= thresholds.minElementCount,
    score: total >= thresholds.minElementCount ? 100 : Math.round((total / thresholds.minElementCount) * 100),
    threshold: thresholds.minElementCount,
    actual: total,
    detail: `${total} elements (minimum: ${thresholds.minElementCount})`,
  };
  checks.push(countCheck);
  if (!countCheck.passed) remediationItems.push(`Model has only ${total} elements — expected at least ${thresholds.minElementCount} for ${discipline}`);

  if (total === 0) {
    return {
      verdict: 'REJECTED',
      discipline,
      modelId,
      dropDate: new Date().toISOString(),
      checks,
      overallScore: 0,
      remediationItems: ['Model is empty — no elements found'],
      acceptedWithConditions: [],
      summary: 'REJECTED: Empty model',
    };
  }

  // ── Check 2: Level Assignment Coverage ──────────────────────────────────
  const withLevel = elements.filter(el => {
    const level = el.Level || el.level || el.storey || el.properties?.Level || '';
    return String(level).trim().length > 0;
  }).length;
  const levelCoverage = withLevel / total;
  const levelCheck: GateCheck = {
    name: 'Level Assignment',
    passed: levelCoverage >= thresholds.minLevelCoverage,
    score: Math.round(levelCoverage * 100),
    threshold: Math.round(thresholds.minLevelCoverage * 100),
    actual: Math.round(levelCoverage * 100),
    detail: `${withLevel}/${total} elements have level (${(levelCoverage * 100).toFixed(1)}%, min: ${(thresholds.minLevelCoverage * 100).toFixed(0)}%)`,
  };
  checks.push(levelCheck);
  if (!levelCheck.passed) remediationItems.push(`${total - withLevel} elements missing Level assignment — assign to correct building level`);

  // ── Check 3: Material Assignment ────────────────────────────────────────
  const withMaterial = elements.filter(el => {
    const mat = el.Material || el.material || el.properties?.Material || '';
    const strMat = String(mat).trim();
    return strMat.length > 0 && !PLACEHOLDER_PATTERNS.some(p => p.test(strMat));
  }).length;
  const matCoverage = withMaterial / total;
  const matCheck: GateCheck = {
    name: 'Material Assignment',
    passed: matCoverage >= thresholds.minMaterialCoverage,
    score: Math.round(matCoverage * 100),
    threshold: Math.round(thresholds.minMaterialCoverage * 100),
    actual: Math.round(matCoverage * 100),
    detail: `${withMaterial}/${total} elements have valid material (${(matCoverage * 100).toFixed(1)}%)`,
  };
  checks.push(matCheck);
  if (!matCheck.passed) remediationItems.push(`${total - withMaterial} elements have placeholder or missing material — assign real materials`);

  // ── Check 4: SystemType (MEP only) ──────────────────────────────────────
  if (isMEP) {
    const withSystem = elements.filter(el => {
      const sys = el.SystemType || el.systemType || el.properties?.SystemType || '';
      return String(sys).trim().length > 0;
    }).length;
    const sysCoverage = withSystem / total;
    const sysCheck: GateCheck = {
      name: 'SystemType Assignment',
      passed: sysCoverage >= thresholds.minSystemTypeCoverage,
      score: Math.round(sysCoverage * 100),
      threshold: Math.round(thresholds.minSystemTypeCoverage * 100),
      actual: Math.round(sysCoverage * 100),
      detail: `${withSystem}/${total} MEP elements have SystemType (${(sysCoverage * 100).toFixed(1)}%)`,
    };
    checks.push(sysCheck);
    if (!sysCheck.passed) remediationItems.push(`${total - withSystem} MEP elements missing SystemType — assign to correct system`);
  }

  // ── Check 5: Placeholder Detection ──────────────────────────────────────
  const placeholders = elements.filter(el => {
    const mat = String(el.Material || el.material || el.properties?.Material || '').trim();
    return PLACEHOLDER_PATTERNS.some(p => p.test(mat));
  }).length;
  const placeholderPercent = placeholders / total;
  const placeholderCheck: GateCheck = {
    name: 'Placeholder Materials',
    passed: placeholderPercent <= thresholds.maxPlaceholderPercent,
    score: Math.round((1 - placeholderPercent) * 100),
    threshold: Math.round((1 - thresholds.maxPlaceholderPercent) * 100),
    actual: Math.round((1 - placeholderPercent) * 100),
    detail: `${placeholders}/${total} elements have placeholder materials (${(placeholderPercent * 100).toFixed(1)}%, max: ${(thresholds.maxPlaceholderPercent * 100).toFixed(0)}%)`,
  };
  checks.push(placeholderCheck);
  if (!placeholderCheck.passed) remediationItems.push(`${placeholders} elements still have placeholder materials (By Category/Default) — replace with real materials`);

  // ── Check 6: BEP Compliance ─────────────────────────────────────────────
  const bepResult = runBEPValidation(elements, discipline, bep);
  const bepCheck: GateCheck = {
    name: 'BEP Compliance',
    passed: bepResult.score >= thresholds.minBEPScore,
    score: bepResult.score,
    threshold: thresholds.minBEPScore,
    actual: bepResult.score,
    detail: `BEP score: ${bepResult.score}/100 (${bepResult.errors.length} errors, ${bepResult.warnings.length} warnings)`,
  };
  checks.push(bepCheck);
  if (!bepCheck.passed) {
    remediationItems.push(`BEP compliance score ${bepResult.score} below threshold ${thresholds.minBEPScore} — fix ${bepResult.errors.length} error(s)`);
  }

  // ── Compute verdict ─────────────────────────────────────────────────────
  const failedCritical = checks.filter(c => !c.passed && ['Element Count', 'Level Assignment'].includes(c.name));
  const failedOther = checks.filter(c => !c.passed && !['Element Count', 'Level Assignment'].includes(c.name));
  const overallScore = Math.round(checks.reduce((s, c) => s + c.score, 0) / checks.length);

  let verdict: GateVerdict;
  if (failedCritical.length > 0) {
    verdict = 'REJECTED';
  } else if (failedOther.length > 0) {
    verdict = 'CONDITIONAL';
    for (const c of failedOther) {
      conditions.push(`${c.name}: ${c.detail} — remediate within 48 hours`);
    }
  } else {
    verdict = 'ACCEPTED';
  }

  return {
    verdict,
    discipline,
    modelId,
    dropDate: new Date().toISOString(),
    checks,
    overallScore,
    remediationItems,
    acceptedWithConditions: conditions,
    summary: `${verdict}: ${discipline} model — score ${overallScore}/100, ${checks.filter(c => c.passed).length}/${checks.length} checks passed`,
  };
}
