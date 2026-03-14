/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  DELTA TRACKER — SOP Part 10
 *  EstimatorPro v14.35 — Project-agnostic
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Tracks changes between clash detection runs (model drops):
 *    1. Delta classification: Resolved / Persistent / New / Regression
 *    2. Strict matching: exact element ID pair + test ID
 *    3. Fuzzy matching: same zone + discipline pair + proximity (confidence score)
 *    4. Regression detection: P1-P2 issues that reappear after being resolved
 *    5. Per-drop summary for trend analytics
 *
 *  Standards: CIQS, ISO 19650 change management
 *  Consumed by: trend-analytics.ts, governance-engine.ts, bim-coordination-router.ts
 *  Depends on:  spatial-clash-engine.ts (RawClash), dedup-engine.ts (ClashGroup)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { RawClash } from './spatial-clash-engine';
import type { ClashGroup } from './dedup-engine';
import type { ClashSeverity } from './clash-detection-engine';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type DeltaClassification = 'NEW' | 'PERSISTENT' | 'RESOLVED' | 'REGRESSION';

export interface DeltaRecord {
  clashId: string;
  classification: DeltaClassification;
  matchConfidence: number;          // 0.0-1.0
  matchMethod: 'strict' | 'fuzzy' | 'none';
  previousClashId: string | null;   // Matched clash from previous run
  severity: ClashSeverity;
  testId: string;
  zone: string;
  description: string;
  regressionNote: string | null;    // Only for REGRESSION items
}

export interface DeltaSummary {
  runId: string;
  previousRunId: string;
  runDate: string;
  newCount: number;
  persistentCount: number;
  resolvedCount: number;
  regressionCount: number;
  totalCurrent: number;
  totalPrevious: number;
  netChange: number;
  bySeverity: Record<ClashSeverity, {
    new: number; persistent: number; resolved: number; regression: number;
  }>;
  byZone: Record<string, {
    new: number; persistent: number; resolved: number; regression: number;
  }>;
  regressions: DeltaRecord[];      // All regression items (require root-cause analysis)
}

export interface DropSnapshot {
  runId: string;
  runDate: string;
  clashes: RawClash[];
  groups: ClashGroup[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// MATCHING KEYS
// ═══════════════════════════════════════════════════════════════════════════════

/** Strict key: exact element pair + test */
function strictKey(clash: RawClash): string {
  const idA = clash.elementA.id || clash.elementA.elementId;
  const idB = clash.elementB.id || clash.elementB.elementId;
  const sorted = idA < idB ? `${idA}||${idB}` : `${idB}||${idA}`;
  return `${clash.testId}::${sorted}`;
}

/** Fuzzy key: zone + discipline pair + test type */
function fuzzyKey(clash: RawClash): string {
  const discA = clash.elementA.discipline;
  const discB = clash.elementB.discipline;
  const sorted = discA < discB ? `${discA}_${discB}` : `${discB}_${discA}`;
  const zone = clash.elementA.storey || 'UNKNOWN';
  return `${clash.testId}::${zone}::${sorted}`;
}

/** Proximity check between two clash locations (meters) */
function locationDistance(a: RawClash, b: RawClash): number {
  const dx = a.location.x - b.location.x;
  const dy = a.location.y - b.location.y;
  const dz = a.location.z - b.location.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DELTA COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════════

/** Proximity threshold for fuzzy matching (meters) */
const FUZZY_PROXIMITY_THRESHOLD_M = 2.0;

/** Minimum confidence for fuzzy match to be accepted */
const FUZZY_MIN_CONFIDENCE = 0.5;

/**
 * Compute delta between two clash detection runs.
 *
 * @param current    Clashes from the latest run
 * @param previous   Clashes from the previous run
 * @param runId      ID for the current run
 * @param prevRunId  ID for the previous run
 * @param resolvedIssueIds  Set of issue IDs that were previously RESOLVED
 */
export function computeDelta(
  current: RawClash[],
  previous: RawClash[],
  runId: string,
  prevRunId: string,
  resolvedIssueIds: Set<string> = new Set(),
): DeltaSummary {
  const now = new Date().toISOString();

  // Index previous clashes
  const prevByStrict = new Map<string, RawClash>();
  const prevByFuzzy = new Map<string, RawClash[]>();
  const matchedPrevIds = new Set<string>();

  for (const clash of previous) {
    prevByStrict.set(strictKey(clash), clash);
    const fKey = fuzzyKey(clash);
    if (!prevByFuzzy.has(fKey)) prevByFuzzy.set(fKey, []);
    prevByFuzzy.get(fKey)!.push(clash);
  }

  const records: DeltaRecord[] = [];

  // Classify each current clash
  for (const clash of current) {
    const sKey = strictKey(clash);
    const fKey = fuzzyKey(clash);
    const zone = clash.elementA.storey || 'UNKNOWN';

    // Try strict match first
    const strictMatch = prevByStrict.get(sKey);
    if (strictMatch) {
      matchedPrevIds.add(strictMatch.id);

      // Check if this was previously resolved → REGRESSION
      if (resolvedIssueIds.has(strictMatch.id)) {
        records.push({
          clashId: clash.id,
          classification: 'REGRESSION',
          matchConfidence: 1.0,
          matchMethod: 'strict',
          previousClashId: strictMatch.id,
          severity: clash.severity,
          testId: clash.testId,
          zone,
          description: clash.description,
          regressionNote: `P${severityToP(clash.severity)} regression — was RESOLVED, now reappeared. Root-cause analysis required.`,
        });
      } else {
        records.push({
          clashId: clash.id,
          classification: 'PERSISTENT',
          matchConfidence: 1.0,
          matchMethod: 'strict',
          previousClashId: strictMatch.id,
          severity: clash.severity,
          testId: clash.testId,
          zone,
          description: clash.description,
          regressionNote: null,
        });
      }
      continue;
    }

    // Try fuzzy match
    const fuzzyCandidates = prevByFuzzy.get(fKey) || [];
    let bestMatch: RawClash | null = null;
    let bestConfidence = 0;

    for (const candidate of fuzzyCandidates) {
      if (matchedPrevIds.has(candidate.id)) continue;

      const dist = locationDistance(clash, candidate);
      if (dist > FUZZY_PROXIMITY_THRESHOLD_M) continue;

      // Confidence: inverse of distance, capped at 1.0
      const distConf = Math.max(0, 1 - dist / FUZZY_PROXIMITY_THRESHOLD_M);

      // Type similarity bonus
      const typeMatch = clash.elementA.elementType === candidate.elementA.elementType ? 0.2 : 0;
      const confidence = Math.min(1.0, distConf * 0.8 + typeMatch);

      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestMatch = candidate;
      }
    }

    if (bestMatch && bestConfidence >= FUZZY_MIN_CONFIDENCE) {
      matchedPrevIds.add(bestMatch.id);

      const isRegression = resolvedIssueIds.has(bestMatch.id);
      records.push({
        clashId: clash.id,
        classification: isRegression ? 'REGRESSION' : 'PERSISTENT',
        matchConfidence: Math.round(bestConfidence * 100) / 100,
        matchMethod: 'fuzzy',
        previousClashId: bestMatch.id,
        severity: clash.severity,
        testId: clash.testId,
        zone,
        description: clash.description,
        regressionNote: isRegression
          ? `Fuzzy-matched regression (confidence ${(bestConfidence * 100).toFixed(0)}%) — verify root cause`
          : null,
      });
    } else {
      // No match → NEW
      records.push({
        clashId: clash.id,
        classification: 'NEW',
        matchConfidence: 0,
        matchMethod: 'none',
        previousClashId: null,
        severity: clash.severity,
        testId: clash.testId,
        zone,
        description: clash.description,
        regressionNote: null,
      });
    }
  }

  // Previous clashes not matched → RESOLVED
  for (const prevClash of previous) {
    if (!matchedPrevIds.has(prevClash.id)) {
      records.push({
        clashId: prevClash.id,
        classification: 'RESOLVED',
        matchConfidence: 1.0,
        matchMethod: 'none',
        previousClashId: prevClash.id,
        severity: prevClash.severity,
        testId: prevClash.testId,
        zone: prevClash.elementA.storey || 'UNKNOWN',
        description: `RESOLVED: ${prevClash.description}`,
        regressionNote: null,
      });
    }
  }

  // Build summary
  const summary = buildDeltaSummary(records, runId, prevRunId, now, current.length, previous.length);
  return summary;
}

function buildDeltaSummary(
  records: DeltaRecord[],
  runId: string,
  prevRunId: string,
  runDate: string,
  totalCurrent: number,
  totalPrevious: number,
): DeltaSummary {
  const counts = { NEW: 0, PERSISTENT: 0, RESOLVED: 0, REGRESSION: 0 };
  const bySeverity: Record<string, any> = {};
  const byZone: Record<string, any> = {};
  const regressions: DeltaRecord[] = [];

  for (const r of records) {
    counts[r.classification]++;

    // By severity
    if (!bySeverity[r.severity]) {
      bySeverity[r.severity] = { new: 0, persistent: 0, resolved: 0, regression: 0 };
    }
    bySeverity[r.severity][r.classification.toLowerCase()]++;

    // By zone
    if (!byZone[r.zone]) {
      byZone[r.zone] = { new: 0, persistent: 0, resolved: 0, regression: 0 };
    }
    byZone[r.zone][r.classification.toLowerCase()]++;

    if (r.classification === 'REGRESSION') regressions.push(r);
  }

  return {
    runId,
    previousRunId: prevRunId,
    runDate,
    newCount: counts.NEW,
    persistentCount: counts.PERSISTENT,
    resolvedCount: counts.RESOLVED,
    regressionCount: counts.REGRESSION,
    totalCurrent,
    totalPrevious,
    netChange: totalCurrent - totalPrevious,
    bySeverity: bySeverity as any,
    byZone: byZone as any,
    regressions,
  };
}

function severityToP(severity: ClashSeverity): number {
  const map: Record<ClashSeverity, number> = { critical: 1, high: 2, medium: 3, low: 4, info: 5 };
  return map[severity] || 3;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DROP HISTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Manages a history of drop snapshots for trend analysis.
 */
export class DropHistory {
  private snapshots: DropSnapshot[] = [];
  private deltas: DeltaSummary[] = [];

  addSnapshot(snapshot: DropSnapshot, resolvedIssueIds?: Set<string>): DeltaSummary | null {
    const prev = this.snapshots.length > 0
      ? this.snapshots[this.snapshots.length - 1]
      : null;

    this.snapshots.push(snapshot);

    if (prev) {
      const delta = computeDelta(
        snapshot.clashes,
        prev.clashes,
        snapshot.runId,
        prev.runId,
        resolvedIssueIds,
      );
      this.deltas.push(delta);
      return delta;
    }

    return null;
  }

  getDeltas(): DeltaSummary[] {
    return [...this.deltas];
  }

  getSnapshots(): DropSnapshot[] {
    return [...this.snapshots];
  }

  getLatestDelta(): DeltaSummary | null {
    return this.deltas.length > 0 ? this.deltas[this.deltas.length - 1] : null;
  }
}
