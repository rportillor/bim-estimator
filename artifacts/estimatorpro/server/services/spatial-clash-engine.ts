/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  SPATIAL CLASH ENGINE — SOP Part 7 Core
 *  EstimatorPro v14.35 — Project-agnostic
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  The geometric heart of the clash detection SOP.
 *  Performs spatial intersection tests between BIM element pairs using:
 *    1. Broad phase:  AABB overlap (O(n log n) sweep-and-prune)
 *    2. Narrow phase: Penetration depth / clearance distance calculation
 *    3. Tolerance:    Apply per-test tolerance from specs (never hardcoded)
 *    4. Reporting:    Generate raw clash records for downstream processing
 *
 *  Standards: CIQS Standard Method, CSI MasterFormat 2018
 *  Principle: All tolerances from project specs or user input — null → GAP/RFI
 *
 *  Consumed by:  clash-detection-engine.ts, bim-coordination-router.ts
 *  Depends on:   clash-test-templates.ts (templates, selection sets)
 *  Author:       EstimatorPro AI QS Engine
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { randomUUID } from 'crypto';
import type {
  AABB,
  ResolvedElement,
  ClashCategory,
  ClashSeverity,
  ClearanceRequirements,
} from './clash-detection-engine';
import {
  type ClashTestTemplate,
  resolveSelectionSet,
  getSelectionSet,
  getEnabledTemplates,
} from './clash-test-templates';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. GEOMETRY UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Check if two AABBs overlap (hard clash) */
export function aabbOverlaps(a: AABB, b: AABB): boolean {
  return (
    a.minX < b.maxX && a.maxX > b.minX &&
    a.minY < b.maxY && a.maxY > b.minY &&
    a.minZ < b.maxZ && a.maxZ > b.minZ
  );
}

/** Compute overlap volume between two AABBs (0 if no overlap) */
export function aabbOverlapVolume(a: AABB, b: AABB): number {
  const dx = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const dy = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  const dz = Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ));
  return dx * dy * dz;
}

/** Minimum distance between two AABBs (0 if they overlap) */
export function aabbMinDistance(a: AABB, b: AABB): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  const dz = Math.max(0, Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ));
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Centroid of an AABB */
export function aabbCentroid(box: AABB): { x: number; y: number; z: number } {
  return {
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
    z: (box.minZ + box.maxZ) / 2,
  };
}

/** Expand AABB by a clearance distance (meters) on all sides */
export function expandAABB(box: AABB, clearance_m: number): AABB {
  return {
    minX: box.minX - clearance_m,
    minY: box.minY - clearance_m,
    minZ: box.minZ - clearance_m,
    maxX: box.maxX + clearance_m,
    maxY: box.maxY + clearance_m,
    maxZ: box.maxZ + clearance_m,
  };
}

/** Penetration depth in meters (max axis penetration). Returns 0 if no overlap. */
export function aabbPenetrationDepth(a: AABB, b: AABB): number {
  if (!aabbOverlaps(a, b)) return 0;
  const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  return Math.min(overlapX, overlapY, overlapZ);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. BROAD PHASE — SWEEP-AND-PRUNE
// ═══════════════════════════════════════════════════════════════════════════════

interface _IndexedElement {
  index: number;
  element: ResolvedElement;
}

/**
 * Sweep-and-prune on the X-axis to find potential overlap pairs.
 * Returns pairs of indices into the input arrays.
 */
export function sweepAndPrune(
  setA: ResolvedElement[],
  setB: ResolvedElement[],
  clearance_m: number,
): Array<[number, number]> {
  // Create events: start and end of each AABB on X-axis (expanded by clearance)
  interface Event {
    x: number;
    isStart: boolean;
    set: 'A' | 'B';
    idx: number;
  }

  const events: Event[] = [];

  for (let i = 0; i < setA.length; i++) {
    const box = expandAABB(setA[i].bbox, clearance_m);
    events.push({ x: box.minX, isStart: true, set: 'A', idx: i });
    events.push({ x: box.maxX, isStart: false, set: 'A', idx: i });
  }
  for (let j = 0; j < setB.length; j++) {
    const box = expandAABB(setB[j].bbox, clearance_m);
    events.push({ x: box.minX, isStart: true, set: 'B', idx: j });
    events.push({ x: box.maxX, isStart: false, set: 'B', idx: j });
  }

  events.sort((a, b) => a.x - b.x || (a.isStart ? -1 : 1));

  const activeA = new Set<number>();
  const activeB = new Set<number>();
  const pairs: Array<[number, number]> = [];

  for (const evt of events) {
    if (evt.isStart) {
      if (evt.set === 'A') {
        // Check against all active B elements
        for (const bIdx of activeB) {
          pairs.push([evt.idx, bIdx]);
        }
        activeA.add(evt.idx);
      } else {
        for (const aIdx of activeA) {
          pairs.push([aIdx, evt.idx]);
        }
        activeB.add(evt.idx);
      }
    } else {
      if (evt.set === 'A') activeA.delete(evt.idx);
      else activeB.delete(evt.idx);
    }
  }

  return pairs;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. NARROW PHASE — PER-PAIR EVALUATION
// ═══════════════════════════════════════════════════════════════════════════════

/** Raw clash result before filtering/dedup */
export interface RawClash {
  id: string;
  testId: string;                  // Which ClashTestTemplate generated this
  category: ClashCategory;
  severity: ClashSeverity;
  elementA: ResolvedElement;
  elementB: ResolvedElement;
  overlapVolume_m3: number;
  clearanceRequired_mm: number;
  clearanceActual_mm: number;
  penetrationDepth_mm: number;
  location: { x: number; y: number; z: number };
  description: string;
  codeReferences: string[];
  toleranceSource: 'spec' | 'user_input' | 'gap';
  isHard: boolean;
}

/**
 * Evaluate a single element pair against a test template.
 * Returns a RawClash if the pair violates the template's rules, or null.
 */
export function evaluatePair(
  elA: ResolvedElement,
  elB: ResolvedElement,
  template: ClashTestTemplate,
  projectClearances: ClearanceRequirements,
): RawClash | null {
  const boxA = elA.bbox;
  const boxB = elB.bbox;

  // Resolve tolerance
  let tolerance_mm = template.tolerance_mm;
  let toleranceSource: 'spec' | 'user_input' | 'gap' = 'spec';

  if (tolerance_mm === null) {
    // Try to resolve from project clearances
    tolerance_mm = resolveToleranceFromProject(template, elA, elB, projectClearances);
    if (tolerance_mm !== null) {
      toleranceSource = 'user_input';
    } else {
      toleranceSource = 'gap';
      tolerance_mm = 0; // Use 0 but flag as GAP
    }
  }

  const tolerance_m = tolerance_mm / 1000;

  if (template.category === 'hard') {
    // Hard clash: physical overlap (tolerance = 0)
    if (!aabbOverlaps(boxA, boxB)) return null;

    const overlapVol = aabbOverlapVolume(boxA, boxB);
    const penDepth = aabbPenetrationDepth(boxA, boxB);
    const loc = aabbCentroid({
      minX: Math.max(boxA.minX, boxB.minX),
      minY: Math.max(boxA.minY, boxB.minY),
      minZ: Math.max(boxA.minZ, boxB.minZ),
      maxX: Math.min(boxA.maxX, boxB.maxX),
      maxY: Math.min(boxA.maxY, boxB.maxY),
      maxZ: Math.min(boxA.maxZ, boxB.maxZ),
    });

    const severity = resolveSeverity(template, elA, elB);

    return {
      id: randomUUID(),
      testId: template.id,
      category: 'hard',
      severity,
      elementA: elA,
      elementB: elB,
      overlapVolume_m3: Math.round(overlapVol * 1e6) / 1e6,
      clearanceRequired_mm: 0,
      clearanceActual_mm: 0,
      penetrationDepth_mm: Math.round(penDepth * 1000 * 100) / 100,
      location: loc,
      description: `Hard clash: ${elA.name} (${elA.elementType}) intersects ${elB.name} (${elB.elementType}) — penetration ${(penDepth * 1000).toFixed(1)}mm`,
      codeReferences: template.codeReferences,
      toleranceSource,
      isHard: true,
    };
  }

  // Soft / code / tolerance clash: check clearance
  const distance_m = aabbMinDistance(boxA, boxB);
  const distance_mm = distance_m * 1000;
  const _expandedA = expandAABB(boxA, tolerance_m);

  // Also check if they physically overlap (which is worse than soft clash)
  if (aabbOverlaps(boxA, boxB)) {
    const overlapVol = aabbOverlapVolume(boxA, boxB);
    const penDepth = aabbPenetrationDepth(boxA, boxB);
    const _loc = aabbCentroid(boxA);
    const severity = resolveSeverity(template, elA, elB);

    return {
      id: randomUUID(),
      testId: template.id,
      category: template.category,
      severity: upgradeSeverity(severity), // Physical overlap in a soft test = upgrade
      elementA: elA,
      elementB: elB,
      overlapVolume_m3: Math.round(overlapVol * 1e6) / 1e6,
      clearanceRequired_mm: tolerance_mm,
      clearanceActual_mm: 0,
      penetrationDepth_mm: Math.round(penDepth * 1000 * 100) / 100,
      location: aabbCentroid(boxA),
      description: `${template.name}: Physical overlap detected where ${tolerance_mm}mm clearance required — ${elA.name} vs ${elB.name}`,
      codeReferences: template.codeReferences,
      toleranceSource,
      isHard: true,
    };
  }

  // Check if within tolerance zone
  if (distance_mm < tolerance_mm) {
    const loc = {
      x: (aabbCentroid(boxA).x + aabbCentroid(boxB).x) / 2,
      y: (aabbCentroid(boxA).y + aabbCentroid(boxB).y) / 2,
      z: (aabbCentroid(boxA).z + aabbCentroid(boxB).z) / 2,
    };
    const severity = resolveSeverity(template, elA, elB);

    return {
      id: randomUUID(),
      testId: template.id,
      category: template.category,
      severity,
      elementA: elA,
      elementB: elB,
      overlapVolume_m3: 0,
      clearanceRequired_mm: tolerance_mm,
      clearanceActual_mm: Math.round(distance_mm * 100) / 100,
      penetrationDepth_mm: 0,
      location: loc,
      description: `${template.name}: Clearance ${distance_mm.toFixed(1)}mm < required ${tolerance_mm}mm — ${elA.name} vs ${elB.name}`,
      codeReferences: template.codeReferences,
      toleranceSource,
      isHard: false,
    };
  }

  return null; // No clash
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. TOLERANCE RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Attempt to resolve a test's null tolerance from project clearance data.
 * Maps test template context to ClearanceRequirements fields.
 */
function resolveToleranceFromProject(
  template: ClashTestTemplate,
  elA: ResolvedElement,
  elB: ResolvedElement,
  clearances: ClearanceRequirements,
): number | null {
  // Map by discipline pair and element type
  const disciplines = [elA.discipline, elB.discipline].sort().join('_');
  const types = [elA.elementType.toLowerCase(), elB.elementType.toLowerCase()];

  if (types.some(t => t.includes('duct')) && disciplines.includes('structural')) {
    return clearances.ductToStructural_mm;
  }
  if (types.some(t => t.includes('pipe')) && disciplines.includes('structural')) {
    return clearances.pipeToStructural_mm;
  }
  if (types.some(t => t.includes('duct'))) {
    return clearances.ductToDuct_mm;
  }
  if (types.some(t => t.includes('pipe'))) {
    return clearances.pipeToPipe_mm;
  }
  if (types.some(t => t.includes('panel') || t.includes('switchgear'))) {
    return clearances.panelFrontClearance_mm;
  }
  if (types.some(t => t.includes('conduit'))) {
    return clearances.conduitToConduit_mm;
  }
  if (types.some(t => t.includes('sprinkler'))) {
    return clearances.sprinklerToCeiling_mm;
  }
  if (types.some(t => t.includes('damper'))) {
    return clearances.fireDamperAccessClearance_mm;
  }
  if (types.some(t => t.includes('corridor'))) {
    return clearances.corridorMinWidth_mm;
  }
  if (types.some(t => t.includes('equipment'))) {
    return clearances.equipmentServiceClearance_mm;
  }

  return null; // Cannot resolve → GAP
}

/** Resolve severity including template overrides */
function resolveSeverity(
  template: ClashTestTemplate,
  elA: ResolvedElement,
  elB: ResolvedElement,
): ClashSeverity {
  for (const rule of template.severityOverrides) {
    const target = [elA, elB];
    for (const el of target) {
      const val = resolveField(el as any, rule.field);
      if (val !== undefined && matchesSeverityRule(val, rule.operator, rule.value)) {
        return rule.overrideSeverity;
      }
    }
  }
  return template.defaultSeverity;
}

function resolveField(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

function matchesSeverityRule(
  fieldVal: any,
  operator: string,
  ruleVal: string | number | string[],
): boolean {
  switch (operator) {
    case 'eq': return String(fieldVal).toLowerCase() === String(ruleVal).toLowerCase();
    case 'in': return Array.isArray(ruleVal) && ruleVal.includes(String(fieldVal));
    case 'gt': return Number(fieldVal) > Number(ruleVal);
    case 'lt': return Number(fieldVal) < Number(ruleVal);
    case 'contains': return String(fieldVal).toLowerCase().includes(String(ruleVal).toLowerCase());
    default: return false;
  }
}

function upgradeSeverity(severity: ClashSeverity): ClashSeverity {
  const order: ClashSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
  const idx = order.indexOf(severity);
  return idx < order.length - 1 ? order[idx + 1] : 'critical';
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. FULL TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

export interface SpatialClashRunOptions {
  templates?: ClashTestTemplate[];  // Override which tests to run
  projectClearances: ClearanceRequirements;
  maxPairsPerTest?: number;         // Safety limit (default 500,000)
}

export interface SpatialClashRunResult {
  rawClashes: RawClash[];
  testsRun: number;
  pairsEvaluated: number;
  gapTolerances: Array<{ testId: string; testName: string; description: string }>;
  warnings: string[];
  timings: Record<string, number>;
}

/**
 * Run the full spatial clash engine across all enabled templates.
 *
 * @param elements  All resolved BIM elements for the model
 * @param options   Clearance data and optional overrides
 */
export function runSpatialClashTests(
  elements: ResolvedElement[],
  options: SpatialClashRunOptions,
): SpatialClashRunResult {
  const startTime = Date.now();
  const templates = options.templates || getEnabledTemplates();
  const maxPairs = options.maxPairsPerTest || 500_000;

  const rawClashes: RawClash[] = [];
  const gapTolerances: Array<{ testId: string; testName: string; description: string }> = [];
  const warnings: string[] = [];
  const timings: Record<string, number> = {};
  let totalPairs = 0;

  // Index elements by ID for fast lookup
  const elemMap = new Map<string, ResolvedElement>();
  for (const el of elements) {
    elemMap.set(el.id || el.elementId, el);
  }

  for (const template of templates) {
    const testStart = Date.now();

    // Resolve selection sets
    const setADef = getSelectionSet(template.setA);
    const setBDef = getSelectionSet(template.setB);

    if (!setADef || !setBDef) {
      warnings.push(`Test ${template.id}: Missing selection set definition — skipped`);
      continue;
    }

    const resolvedA = resolveSelectionSet(setADef, elements as any[]);
    const resolvedB = resolveSelectionSet(setBDef, elements as any[]);
    warnings.push(...resolvedA.warnings, ...resolvedB.warnings);

    const setAElements = resolvedA.matchedIds
      .map(id => elemMap.get(id))
      .filter((e): e is ResolvedElement => !!e);
    const setBElements = resolvedB.matchedIds
      .map(id => elemMap.get(id))
      .filter((e): e is ResolvedElement => !!e);

    if (setAElements.length === 0 || setBElements.length === 0) {
      timings[template.id] = Date.now() - testStart;
      continue;
    }

    // Check for GAP tolerances
    if (template.tolerance_mm === null) {
      const resolvedTol = resolveToleranceFromProject(
        template,
        setAElements[0],
        setBElements[0],
        options.projectClearances,
      );
      if (resolvedTol === null) {
        gapTolerances.push({
          testId: template.id,
          testName: template.name,
          description: `No tolerance value available for ${template.name} — using 0mm (results flagged as GAP, RFI required)`,
        });
      }
    }

    // Broad phase
    const clearance_m = (template.tolerance_mm || 0) / 1000;
    const candidatePairs = sweepAndPrune(setAElements, setBElements, clearance_m);

    if (candidatePairs.length > maxPairs) {
      warnings.push(
        `Test ${template.id}: ${candidatePairs.length} candidate pairs exceeds limit ${maxPairs} — truncated`
      );
    }

    const pairsToEval = candidatePairs.slice(0, maxPairs);
    totalPairs += pairsToEval.length;

    // Narrow phase
    for (const [aIdx, bIdx] of pairsToEval) {
      // Skip self-test duplicate (same element)
      if (setAElements[aIdx].id === setBElements[bIdx].id) continue;

      const clash = evaluatePair(
        setAElements[aIdx],
        setBElements[bIdx],
        template,
        options.projectClearances,
      );
      if (clash) {
        rawClashes.push(clash);
      }
    }

    timings[template.id] = Date.now() - testStart;
  }

  timings['_total'] = Date.now() - startTime;

  return {
    rawClashes,
    testsRun: templates.length,
    pairsEvaluated: totalPairs,
    gapTolerances,
    warnings,
    timings,
  };
}
