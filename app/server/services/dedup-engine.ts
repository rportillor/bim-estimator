/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  DEDUPLICATION ENGINE — SOP Part 7
 *  EstimatorPro v14.35 — Project-agnostic
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Removes duplicate clash records and groups related clashes by root cause.
 *
 *  Strategies:
 *    1. Exact duplicates:  Same element ID pair (A,B) = (B,A) across tests
 *    2. Near duplicates:   Same root-cause element appearing in multiple clashes
 *    3. Root-cause groups: Cluster clashes by offending element, zone, discipline
 *    4. Attribution:       Identify the single offending element across a group
 *
 *  Standards: CIQS Standard Method, BIM coordination best practices
 *  Principle: Report root causes, not individual symptoms
 *
 *  Consumed by: clash-detection-engine.ts, issue-log.ts, bim-coordination-router.ts
 *  Depends on:  spatial-clash-engine.ts (RawClash type)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { RawClash } from './spatial-clash-engine';
import type { ClashSeverity, Discipline } from './clash-detection-engine';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** A group of clashes sharing a common root cause */
export interface ClashGroup {
  groupId: string;
  rootCauseElementId: string;
  rootCauseElementName: string;
  rootCauseDiscipline: Discipline;
  rootCauseType: string;
  zone: string;                    // Level_Zone from storey
  gridRef: string;                 // Nearest grid intersection
  highestSeverity: ClashSeverity;
  clashCount: number;
  clashes: RawClash[];
  affectedDisciplines: Discipline[];
  affectedElements: string[];       // IDs of all victim elements
  description: string;
  suggestedAction: string;
}

export interface DedupResult {
  uniqueClashes: RawClash[];
  groups: ClashGroup[];
  duplicatesRemoved: number;
  nearDuplicatesMerged: number;
  summary: {
    inputCount: number;
    uniqueCount: number;
    groupCount: number;
    avgGroupSize: number;
    topOffenders: Array<{ elementId: string; name: string; clashCount: number }>;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. EXACT DEDUPLICATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a canonical key for an element pair (order-independent).
 */
function pairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}||${idB}` : `${idB}||${idA}`;
}

/**
 * Remove exact duplicate clashes (same element pair found by multiple tests).
 * Keeps the clash with the highest severity.
 */
export function removeExactDuplicates(clashes: RawClash[]): {
  unique: RawClash[];
  removed: number;
} {
  const severityRank: Record<ClashSeverity, number> = {
    critical: 5,
    high: 4,
    medium: 3,
    low: 2,
    info: 1,
  };

  const seen = new Map<string, RawClash>();

  for (const clash of clashes) {
    const key = pairKey(clash.elementA.id || clash.elementA.elementId, clash.elementB.id || clash.elementB.elementId);
    const existing = seen.get(key);

    if (!existing || severityRank[clash.severity] > severityRank[existing.severity]) {
      seen.set(key, clash);
    }
  }

  return {
    unique: Array.from(seen.values()),
    removed: clashes.length - seen.size,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. ROOT-CAUSE ATTRIBUTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Identify which element in a clash is the "offender" (root cause).
 *
 * Heuristic priority:
 *   1. MEP element clashing with structure → MEP is offender (must reroute)
 *   2. Smaller element → more likely offender (easier to move)
 *   3. Element appearing in more clashes → offender (systemic issue)
 *   4. Non-structural → offender (structure is harder to move)
 */
function identifyOffender(
  clash: RawClash,
  clashCountByElement: Map<string, number>,
): { offenderId: string; victimId: string } {
  const elA = clash.elementA;
  const elB = clash.elementB;
  const idA = elA.id || elA.elementId;
  const idB = elB.id || elB.elementId;

  // Rule 1: Structure always wins (other side is offender)
  if (elA.discipline === 'structural' && elB.discipline !== 'structural') {
    return { offenderId: idB, victimId: idA };
  }
  if (elB.discipline === 'structural' && elA.discipline !== 'structural') {
    return { offenderId: idA, victimId: idB };
  }

  // Rule 2: Architectural wins over MEP
  if (elA.discipline === 'architectural' && !['structural', 'architectural'].includes(elB.discipline)) {
    return { offenderId: idB, victimId: idA };
  }
  if (elB.discipline === 'architectural' && !['structural', 'architectural'].includes(elA.discipline)) {
    return { offenderId: idA, victimId: idB };
  }

  // Rule 3: Higher clash count = offender
  const countA = clashCountByElement.get(idA) || 0;
  const countB = clashCountByElement.get(idB) || 0;
  if (countA > countB) return { offenderId: idA, victimId: idB };
  if (countB > countA) return { offenderId: idB, victimId: idA };

  // Rule 4: Smaller volume = offender (easier to reroute)
  const volA = elA.dimensions?.volume || 0;
  const volB = elB.dimensions?.volume || 0;
  if (volA < volB) return { offenderId: idA, victimId: idB };

  // Default: A is offender
  return { offenderId: idA, victimId: idB };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. ROOT-CAUSE GROUPING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Group clashes by their root-cause element.
 * Clashes sharing the same offending element in the same zone
 * are grouped together as a single issue.
 */
export function groupByRootCause(clashes: RawClash[]): ClashGroup[] {
  // First pass: count clashes per element for attribution
  const clashCountByElement = new Map<string, number>();
  for (const c of clashes) {
    const idA = c.elementA.id || c.elementA.elementId;
    const idB = c.elementB.id || c.elementB.elementId;
    clashCountByElement.set(idA, (clashCountByElement.get(idA) || 0) + 1);
    clashCountByElement.set(idB, (clashCountByElement.get(idB) || 0) + 1);
  }

  // Second pass: attribute offender and build group keys
  const groups = new Map<string, { offender: any; clashes: RawClash[]; victims: Set<string> }>();

  for (const clash of clashes) {
    const { offenderId } = identifyOffender(clash, clashCountByElement);
    const offender = (clash.elementA.id || clash.elementA.elementId) === offenderId
      ? clash.elementA : clash.elementB;
    const victim = (clash.elementA.id || clash.elementA.elementId) === offenderId
      ? clash.elementB : clash.elementA;

    // Group key: offender ID + zone
    const zone = offender.storey || 'UNKNOWN';
    const groupKey = `${offenderId}||${zone}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        offender,
        clashes: [],
        victims: new Set<string>(),
      });
    }

    const group = groups.get(groupKey)!;
    group.clashes.push(clash);
    group.victims.add(victim.id || victim.elementId);
  }

  // Convert to ClashGroup array
  const severityRank: Record<ClashSeverity, number> = {
    critical: 5, high: 4, medium: 3, low: 2, info: 1,
  };

  const result: ClashGroup[] = [];
  let groupIdx = 1;

  for (const [key, group] of groups) {
    const offender = group.offender;
    const zone = offender.storey || 'UNKNOWN';
    const highestSeverity = group.clashes.reduce<ClashSeverity>(
      (max, c) => severityRank[c.severity] > severityRank[max] ? c.severity : max,
      'info',
    );

    const affectedDisciplines = [
      ...new Set(
        group.clashes.flatMap(c => [c.elementA.discipline, c.elementB.discipline])
      ),
    ];

    const gridRef = extractGridRef(offender);

    result.push({
      groupId: `GRP-${String(groupIdx++).padStart(4, '0')}`,
      rootCauseElementId: offender.id || offender.elementId,
      rootCauseElementName: offender.name,
      rootCauseDiscipline: offender.discipline,
      rootCauseType: offender.elementType,
      zone,
      gridRef,
      highestSeverity,
      clashCount: group.clashes.length,
      clashes: group.clashes,
      affectedDisciplines,
      affectedElements: Array.from(group.victims),
      description: buildGroupDescription(offender, group.clashes, zone),
      suggestedAction: buildSuggestedAction(offender, group.clashes),
    });
  }

  // Sort by severity then clash count
  result.sort((a, b) => {
    const sevDiff = severityRank[b.highestSeverity] - severityRank[a.highestSeverity];
    return sevDiff !== 0 ? sevDiff : b.clashCount - a.clashCount;
  });

  return result;
}

/** Extract nearest grid reference from element properties */
function extractGridRef(element: any): string {
  if (element.properties?.gridRef) return element.properties.gridRef;
  if (element.properties?.nearestGrid) return element.properties.nearestGrid;

  // Derive from location if available
  const loc = element.bbox
    ? { x: (element.bbox.minX + element.bbox.maxX) / 2, y: (element.bbox.minY + element.bbox.maxY) / 2 }
    : null;
  if (loc) return `@${loc.x.toFixed(1)},${loc.y.toFixed(1)}`;
  return 'UNKNOWN';
}

/** Build a human-readable group description */
function buildGroupDescription(offender: any, clashes: RawClash[], zone: string): string {
  const discSet = new Set(
    clashes.flatMap(c => [c.elementA.discipline, c.elementB.discipline])
      .filter(d => d !== offender.discipline)
  );
  const victims = Array.from(discSet).join(', ');
  return `${offender.name} (${offender.elementType}) in ${zone} causes ${clashes.length} clash(es) with ${victims || 'same discipline'}`;
}

/** Suggest a resolution action based on offender type */
function buildSuggestedAction(offender: any, clashes: RawClash[]): string {
  const disc = offender.discipline;
  const hasStructural = clashes.some(
    c => c.elementA.discipline === 'structural' || c.elementB.discipline === 'structural'
  );

  if (hasStructural && disc !== 'structural') {
    return `Reroute ${offender.elementType} to avoid structural conflicts — coordinate with structural engineer`;
  }
  if (disc === 'mechanical') {
    return `Review duct routing and elevation — consider raising/lowering or rerouting around conflicts`;
  }
  if (disc === 'electrical') {
    return `Reroute conduit/cable tray — verify vertical separation hierarchy (electrical above mechanical)`;
  }
  if (disc === 'plumbing' || disc === 'fire_protection') {
    return `Adjust pipe routing and support locations — verify slope requirements maintained`;
  }
  return `Review element placement and coordinate with affected disciplines`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. MAIN DEDUP PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Full deduplication pipeline:
 *   1. Remove exact duplicates
 *   2. Group by root cause
 *   3. Generate summary statistics
 */
export function deduplicateClashes(rawClashes: RawClash[]): DedupResult {
  // Step 1: Exact dedup
  const { unique, removed } = removeExactDuplicates(rawClashes);

  // Step 2: Root-cause grouping
  const groups = groupByRootCause(unique);

  // Step 3: Near-duplicate count (clashes absorbed into groups)
  const nearDuplicatesMerged = unique.length - groups.length;

  // Step 4: Top offenders
  const offenderCount = new Map<string, { name: string; count: number }>();
  for (const g of groups) {
    const existing = offenderCount.get(g.rootCauseElementId);
    if (existing) {
      existing.count += g.clashCount;
    } else {
      offenderCount.set(g.rootCauseElementId, {
        name: g.rootCauseElementName,
        count: g.clashCount,
      });
    }
  }

  const topOffenders = Array.from(offenderCount.entries())
    .map(([elementId, { name, count }]) => ({ elementId, name, clashCount: count }))
    .sort((a, b) => b.clashCount - a.clashCount)
    .slice(0, 10);

  return {
    uniqueClashes: unique,
    groups,
    duplicatesRemoved: removed,
    nearDuplicatesMerged,
    summary: {
      inputCount: rawClashes.length,
      uniqueCount: unique.length,
      groupCount: groups.length,
      avgGroupSize: groups.length > 0 ? Math.round((unique.length / groups.length) * 10) / 10 : 0,
      topOffenders,
    },
  };
}
