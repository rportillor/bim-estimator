/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  PENETRATIONS MATRIX — SOP Part 12
 *  EstimatorPro v14.35 — Project-agnostic; projectName must be passed by caller
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Level-by-level penetrations matrix with 5 statuses:
 *    OK / SLEEVE_MISSING / FIRESTOP_UNDEFINED / RATING_UNKNOWN / SIZE_UNKNOWN
 *
 *  Features:
 *    1. Matrix view: rows = levels, columns = discipline pairs
 *    2. Status aggregation with color coding
 *    3. CSV export for weekly reporting
 *    4. Trend comparison between model drops
 *
 *  Standards: NBC 2020 (3.1.8, 3.1.9), OBC 2024, NFPA, ULC S115
 *  Consumed by: bim-coordination-router.ts, bcf-export.ts
 *  Depends on:  discipline-tests.ts (PenetrationRecord, PenetrationStatus)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { PenetrationRecord, PenetrationStatus } from './discipline-tests';
import type { Discipline } from './clash-detection-engine';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface PenetrationMatrixCell {
  level: string;
  disciplinePair: string;          // e.g. 'MECH_vs_STR'
  total: number;
  byStatus: Record<PenetrationStatus, number>;
  worstStatus: PenetrationStatus;
  rfisRequired: number;
  penetrationIds: string[];
}

export interface PenetrationMatrixRow {
  level: string;
  totalPenetrations: number;
  totalOK: number;
  totalIssues: number;
  rfisRequired: number;
  cells: PenetrationMatrixCell[];
}

export interface PenetrationMatrix {
  generatedDate: string;
  projectName: string;
  levels: string[];
  disciplinePairs: string[];
  rows: PenetrationMatrixRow[];
  globalSummary: {
    total: number;
    byStatus: Record<PenetrationStatus, number>;
    byDiscipline: Record<string, number>;
    rfisRequired: number;
    completionPercent: number;     // OK / total * 100
  };
}

export interface PenetrationDelta {
  level: string;
  previousTotal: number;
  currentTotal: number;
  previousOK: number;
  currentOK: number;
  newPenetrations: number;
  resolvedPenetrations: number;
  direction: 'improving' | 'stable' | 'degrading';
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const STATUS_SEVERITY: Record<PenetrationStatus, number> = {
  OK: 0,
  SIZE_UNKNOWN: 1,
  RATING_UNKNOWN: 2,
  FIRESTOP_UNDEFINED: 3,
  SLEEVE_MISSING: 4,
};

function worstOf(statuses: PenetrationStatus[]): PenetrationStatus {
  if (statuses.length === 0) return 'OK';
  return statuses.reduce((worst, s) =>
    STATUS_SEVERITY[s] > STATUS_SEVERITY[worst] ? s : worst
  , 'OK' as PenetrationStatus);
}

function disciplinePairKey(discA: Discipline, discB: Discipline): string {
  const map: Record<Discipline, string> = {
    structural: 'STR', architectural: 'ARC', mechanical: 'MECH',
    electrical: 'ELEC', plumbing: 'PLBG', fire_protection: 'FP',
    site: 'SITE', other: 'OTHER',
  };
  const a = map[discA] || discA.toUpperCase();
  const b = map[discB] || discB.toUpperCase();
  return a < b ? `${a}_vs_${b}` : `${b}_vs_${a}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MATRIX BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

export function buildPenetrationMatrix(
  penetrations: PenetrationRecord[],
  projectName: string = '',
): PenetrationMatrix {
  // Collect unique levels and discipline pairs
  const levelSet = new Set<string>();
  const pairSet = new Set<string>();

  for (const p of penetrations) {
    levelSet.add(p.level);
    const pair = disciplinePairKey(p.hostElement.discipline, p.penetratingElement.discipline);
    pairSet.add(pair);
  }

  const levels = Array.from(levelSet).sort();
  const disciplinePairs = Array.from(pairSet).sort();

  // Build matrix
  const rows: PenetrationMatrixRow[] = [];

  for (const level of levels) {
    const levelPens = penetrations.filter(p => p.level === level);
    const cells: PenetrationMatrixCell[] = [];

    for (const pair of disciplinePairs) {
      const cellPens = levelPens.filter(p =>
        disciplinePairKey(p.hostElement.discipline, p.penetratingElement.discipline) === pair
      );

      const byStatus: Record<PenetrationStatus, number> = {
        OK: 0, SLEEVE_MISSING: 0, FIRESTOP_UNDEFINED: 0, RATING_UNKNOWN: 0, SIZE_UNKNOWN: 0,
      };
      for (const cp of cellPens) byStatus[cp.status]++;

      cells.push({
        level,
        disciplinePair: pair,
        total: cellPens.length,
        byStatus,
        worstStatus: worstOf(cellPens.map(cp => cp.status)),
        rfisRequired: cellPens.filter(cp => cp.rfiRequired).length,
        penetrationIds: cellPens.map(cp => cp.id),
      });
    }

    const totalOK = levelPens.filter(p => p.status === 'OK').length;
    rows.push({
      level,
      totalPenetrations: levelPens.length,
      totalOK,
      totalIssues: levelPens.length - totalOK,
      rfisRequired: levelPens.filter(p => p.rfiRequired).length,
      cells,
    });
  }

  // Global summary
  const globalByStatus: Record<PenetrationStatus, number> = {
    OK: 0, SLEEVE_MISSING: 0, FIRESTOP_UNDEFINED: 0, RATING_UNKNOWN: 0, SIZE_UNKNOWN: 0,
  };
  const byDiscipline: Record<string, number> = {};

  for (const p of penetrations) {
    globalByStatus[p.status]++;
    const pair = disciplinePairKey(p.hostElement.discipline, p.penetratingElement.discipline);
    byDiscipline[pair] = (byDiscipline[pair] || 0) + 1;
  }

  return {
    generatedDate: new Date().toISOString(),
    projectName,
    levels,
    disciplinePairs,
    rows,
    globalSummary: {
      total: penetrations.length,
      byStatus: globalByStatus,
      byDiscipline,
      rfisRequired: penetrations.filter(p => p.rfiRequired).length,
      completionPercent: penetrations.length > 0
        ? Math.round((globalByStatus.OK / penetrations.length) * 100)
        : 100,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CSV EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export function exportPenetrationMatrixCSV(matrix: PenetrationMatrix): string {
  const headers = ['Level', 'Total', 'OK', 'Issues', 'RFIs', ...matrix.disciplinePairs];
  const rows = matrix.rows.map(row => {
    const cellValues = matrix.disciplinePairs.map(pair => {
      const cell = row.cells.find(c => c.disciplinePair === pair);
      if (!cell || cell.total === 0) return '';
      return `${cell.byStatus.OK}/${cell.total}`;
    });
    return [row.level, String(row.totalPenetrations), String(row.totalOK),
      String(row.totalIssues), String(row.rfisRequired), ...cellValues];
  });

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// DELTA COMPARISON
// ═══════════════════════════════════════════════════════════════════════════════

export function comparePenetrationMatrices(
  current: PenetrationMatrix,
  previous: PenetrationMatrix,
): PenetrationDelta[] {
  const allLevels = new Set([...current.levels, ...previous.levels]);
  const deltas: PenetrationDelta[] = [];

  for (const level of allLevels) {
    const curRow = current.rows.find(r => r.level === level);
    const prevRow = previous.rows.find(r => r.level === level);

    const curTotal = curRow?.totalPenetrations || 0;
    const prevTotal = prevRow?.totalPenetrations || 0;
    const curOK = curRow?.totalOK || 0;
    const prevOK = prevRow?.totalOK || 0;

    const curIssues = curTotal - curOK;
    const prevIssues = prevTotal - prevOK;

    let direction: PenetrationDelta['direction'] = 'stable';
    if (curIssues < prevIssues) direction = 'improving';
    else if (curIssues > prevIssues) direction = 'degrading';

    deltas.push({
      level,
      previousTotal: prevTotal,
      currentTotal: curTotal,
      previousOK: prevOK,
      currentOK: curOK,
      newPenetrations: Math.max(0, curTotal - prevTotal),
      resolvedPenetrations: Math.max(0, prevIssues - curIssues),
      direction,
    });
  }

  return deltas.sort((a, b) => a.level.localeCompare(b.level));
}
