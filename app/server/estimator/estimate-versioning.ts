// server/estimator/estimate-versioning.ts
// =============================================================================
// ESTIMATE VERSIONING & REVISION TRACKING
// =============================================================================
//
// Implements QS Level 5 Phase 8 — Finalization: Version Control
//
// Purpose:
//   1. Snapshot an estimate at a point in time (revision)
//   2. Compare two revisions to identify changes
//   3. Track revision history with metadata (who, when, why)
//   4. Generate change reports showing what moved between versions
//   5. Support CCDC 2 "Changes in the Work" documentation
//
// Architecture:
//   EstimateSnapshot  — Full frozen copy of an estimate at a revision
//   RevisionMetadata  — Who, when, why, what changed
//   ChangeRecord      — Individual change between two revisions
//   VersionHistory    — Complete history for a project
//
// Standards: CCDC 2 / CIQS / AACE RP 56R-08
// =============================================================================

import type { EstimateSummary, EstimateLineItem, FloorSummary as FloorEstimate } from './estimate-engine';
import type { BudgetStructure } from './budget-structure';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export type RevisionStatus = 'draft' | 'issued' | 'superseded' | 'final';

export interface RevisionMetadata {
  revisionNumber: number;         // Sequential: 1, 2, 3...
  revisionLabel: string;          // e.g., "Rev A", "Rev B", "R01"
  status: RevisionStatus;
  createdAt: string;              // ISO datetime
  createdBy: string;              // Name of estimator
  reason: string;                 // Why this revision was created
  description: string;            // Summary of changes
  aaceClass?: number;             // AACE class at this revision (1-5)
  documentRefs?: string[];        // Drawing/doc references for this revision
}

export interface EstimateSnapshot {
  metadata: RevisionMetadata;
  projectName: string;
  projectType: string;

  // Cost summary
  directCost: number;
  grandTotal: number;
  costPerUnit: number;            // $/m², $/lane-km, etc.
  projectQuantity: number;
  measurementUnit: string;

  // Division breakdown (for comparison)
  divisionTotals: Map<string, number>;
  divisionLineItemCounts: Map<string, number>;

  // Floor breakdown
  floorTotals: Map<string, number>;

  // Line item detail (frozen copy for deep diff)
  lineItems: SnapshotLineItem[];

  // Budget structure snapshot
  budgetLayers: {
    directCost: number;
    generalConditions: number;
    overheadProfit: number;
    designContingency: number;
    constructionContingency: number;
    escalation: number;
    taxes: number;
    grandTotal: number;
  };

  totalLineItems: number;
  verifiedItems: number;
  estimatedItems: number;
}

/**
 * Frozen line item — captures the state at snapshot time.
 * Intentionally a plain object (not referencing the live estimate).
 */
export interface SnapshotLineItem {
  id: string;                     // Composite: floor|division|subdivision|description hash
  floorLabel: string;
  csiDivision: string;
  csiSubdivision: string;
  description: string;
  quantity: number;
  unit: string;
  unitRate: number;
  laborCost: number;
  materialCost: number;
  equipmentCost: number;
  totalCost: number;
  verificationStatus: string;
}

// ─── Change Tracking ─────────────────────────────────────────────────────────

export type ChangeType = 'added' | 'removed' | 'modified' | 'unchanged';
export type ChangeCategory = 'line-item' | 'quantity' | 'rate' | 'scope' | 'budget';

export interface ChangeRecord {
  changeType: ChangeType;
  category: ChangeCategory;
  csiDivision: string;
  floorLabel: string;
  description: string;
  previousValue: number;
  currentValue: number;
  difference: number;              // Current - previous
  percentChange: number;           // (diff/prev) * 100, or Infinity if prev = 0
  detail: string;                  // Human-readable explanation
}

export interface RevisionComparison {
  fromRevision: string;            // Label of the older revision
  toRevision: string;              // Label of the newer revision
  fromDate: string;
  toDate: string;

  // Summary
  previousDirectCost: number;
  currentDirectCost: number;
  directCostChange: number;
  directCostChangePercent: number;

  previousGrandTotal: number;
  currentGrandTotal: number;
  grandTotalChange: number;
  grandTotalChangePercent: number;

  // Division-level changes
  divisionChanges: {
    division: string;
    previousCost: number;
    currentCost: number;
    difference: number;
    percentChange: number;
  }[];

  // Detailed changes
  changes: ChangeRecord[];
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  unchangedCount: number;

  generatedAt: string;
}

export interface VersionHistory {
  projectName: string;
  snapshots: EstimateSnapshot[];
  currentRevision: number;
}

// ─── Snapshot Creation ───────────────────────────────────────────────────────

/**
 * Create a frozen snapshot of an estimate at the current point in time.
 */
export function createSnapshot(
  estimate: EstimateSummary,
  budget: BudgetStructure,
  metadata: RevisionMetadata,
  projectQuantity: number,
  measurementUnit: string
): EstimateSnapshot {
  // Build division totals
  const divisionTotals = new Map<string, number>();
  const divisionLineItemCounts = new Map<string, number>();
  const floorTotals = new Map<string, number>();
  const lineItems: SnapshotLineItem[] = [];

  let verifiedItems = 0;
  let estimatedItems = 0;

  for (const floor of estimate.floors) {
    let floorTotal = 0;

    for (const item of floor.lineItems) {
      // Division aggregation
      divisionTotals.set(item.csiDivision,
        (divisionTotals.get(item.csiDivision) || 0) + item.totalCost);
      divisionLineItemCounts.set(item.csiDivision,
        (divisionLineItemCounts.get(item.csiDivision) || 0) + 1);

      floorTotal += item.totalCost;

      // Verification tracking
      if (item.verificationStatus === 'verified') verifiedItems++;
      else if (item.verificationStatus === 'estimated') estimatedItems++;

      // Freeze line item
      const id = floor.floorLabel + '|' + item.csiDivision + '|' +
        item.csiSubdivision + '|' + simpleHash(item.description);

      lineItems.push({
        id,
        floorLabel: floor.floorLabel,
        csiDivision: item.csiDivision,
        csiSubdivision: item.csiSubdivision,
        description: item.description,
        quantity: item.baseQuantity,
        unit: item.unit,
        unitRate: item.totalRate,
        laborCost: item.laborCost,
        materialCost: item.materialCost,
        equipmentCost: item.equipmentCost,
        totalCost: item.totalCost,
        verificationStatus: item.verificationStatus,
      });
    }

    floorTotals.set(floor.floorLabel, floorTotal);
  }

  return {
    metadata,
    projectName: '',  // EstimateSummary does not carry project name — set by caller
    projectType: '',  // EstimateSummary does not carry building type — set by caller
    directCost: estimate.grandTotal,
    grandTotal: budget.GRAND_TOTAL,
    costPerUnit: projectQuantity > 0 ? estimate.grandTotal / projectQuantity : 0,
    projectQuantity,
    measurementUnit,
    divisionTotals,
    divisionLineItemCounts,
    floorTotals,
    lineItems,
    budgetLayers: {
      directCost: budget.directCost.subtotal,
      generalConditions: budget.generalConditions.subtotal,
      overheadProfit: budget.overheadProfit.subtotal,
      designContingency: budget.contingency.designContingency,
      constructionContingency: budget.contingency.constructionContingency,
      escalation: budget.escalation.amount,
      taxes: budget.taxes.subtotal,
      grandTotal: budget.GRAND_TOTAL,
    },
    totalLineItems: lineItems.length,
    verifiedItems,
    estimatedItems,
  };
}

// ─── Revision Comparison ─────────────────────────────────────────────────────

/**
 * Compare two snapshots and generate a detailed change report.
 * Identifies added, removed, and modified line items.
 */
export function compareRevisions(
  previous: EstimateSnapshot,
  current: EstimateSnapshot
): RevisionComparison {
  const changes: ChangeRecord[] = [];

  // Index line items by ID
  const prevMap = new Map<string, SnapshotLineItem>();
  const currMap = new Map<string, SnapshotLineItem>();
  for (const item of previous.lineItems) prevMap.set(item.id, item);
  for (const item of current.lineItems) currMap.set(item.id, item);

  // Find added items (in current but not in previous)
  for (const [id, item] of currMap) {
    if (!prevMap.has(id)) {
      changes.push({
        changeType: 'added',
        category: 'scope',
        csiDivision: item.csiDivision,
        floorLabel: item.floorLabel,
        description: item.description,
        previousValue: 0,
        currentValue: item.totalCost,
        difference: item.totalCost,
        percentChange: Infinity,
        detail: 'New line item: ' + item.description + ' (' + item.quantity + ' ' + item.unit + ')',
      });
    }
  }

  // Find removed items (in previous but not in current)
  for (const [id, item] of prevMap) {
    if (!currMap.has(id)) {
      changes.push({
        changeType: 'removed',
        category: 'scope',
        csiDivision: item.csiDivision,
        floorLabel: item.floorLabel,
        description: item.description,
        previousValue: item.totalCost,
        currentValue: 0,
        difference: -item.totalCost,
        percentChange: -100,
        detail: 'Removed: ' + item.description,
      });
    }
  }

  // Find modified items (same ID, different values)
  for (const [id, currItem] of currMap) {
    const prevItem = prevMap.get(id);
    if (!prevItem) continue;

    // Check quantity change
    if (Math.abs(currItem.quantity - prevItem.quantity) > 0.001) {
      const diff = currItem.quantity - prevItem.quantity;
      const pct = prevItem.quantity !== 0 ? (diff / prevItem.quantity) * 100 : Infinity;
      changes.push({
        changeType: 'modified',
        category: 'quantity',
        csiDivision: currItem.csiDivision,
        floorLabel: currItem.floorLabel,
        description: currItem.description,
        previousValue: prevItem.quantity,
        currentValue: currItem.quantity,
        difference: diff,
        percentChange: pct,
        detail: 'Quantity: ' + prevItem.quantity.toFixed(2) + ' → ' + currItem.quantity.toFixed(2) + ' ' + currItem.unit,
      });
    }

    // Check rate change
    if (Math.abs(currItem.unitRate - prevItem.unitRate) > 0.01) {
      const diff = currItem.unitRate - prevItem.unitRate;
      const pct = prevItem.unitRate !== 0 ? (diff / prevItem.unitRate) * 100 : Infinity;
      changes.push({
        changeType: 'modified',
        category: 'rate',
        csiDivision: currItem.csiDivision,
        floorLabel: currItem.floorLabel,
        description: currItem.description,
        previousValue: prevItem.unitRate,
        currentValue: currItem.unitRate,
        difference: diff,
        percentChange: pct,
        detail: 'Rate: $' + prevItem.unitRate.toFixed(2) + ' → $' + currItem.unitRate.toFixed(2) + '/' + currItem.unit,
      });
    }

    // If total changed but neither qty nor rate did (e.g., L/M/E split change)
    if (Math.abs(currItem.totalCost - prevItem.totalCost) > 1 &&
        Math.abs(currItem.quantity - prevItem.quantity) < 0.001 &&
        Math.abs(currItem.unitRate - prevItem.unitRate) < 0.01) {
      changes.push({
        changeType: 'modified',
        category: 'line-item',
        csiDivision: currItem.csiDivision,
        floorLabel: currItem.floorLabel,
        description: currItem.description,
        previousValue: prevItem.totalCost,
        currentValue: currItem.totalCost,
        difference: currItem.totalCost - prevItem.totalCost,
        percentChange: prevItem.totalCost !== 0
          ? ((currItem.totalCost - prevItem.totalCost) / prevItem.totalCost) * 100 : Infinity,
        detail: 'Cost adjustment: $' + prevItem.totalCost.toFixed(2) + ' → $' + currItem.totalCost.toFixed(2),
      });
    }
  }

  // Division-level comparison
  const allDivisions = new Set<string>();
  for (const [d] of previous.divisionTotals) allDivisions.add(d);
  for (const [d] of current.divisionTotals) allDivisions.add(d);

  const divisionChanges = Array.from(allDivisions).sort().map(div => {
    const prev = previous.divisionTotals.get(div) || 0;
    const curr = current.divisionTotals.get(div) || 0;
    return {
      division: div,
      previousCost: prev,
      currentCost: curr,
      difference: curr - prev,
      percentChange: prev !== 0 ? ((curr - prev) / prev) * 100 : (curr > 0 ? Infinity : 0),
    };
  }).filter(d => Math.abs(d.difference) > 1); // Only divisions that changed

  // Budget-level comparison
  const directCostChange = current.directCost - previous.directCost;
  const grandTotalChange = current.grandTotal - previous.grandTotal;

  return {
    fromRevision: previous.metadata.revisionLabel,
    toRevision: current.metadata.revisionLabel,
    fromDate: previous.metadata.createdAt,
    toDate: current.metadata.createdAt,
    previousDirectCost: previous.directCost,
    currentDirectCost: current.directCost,
    directCostChange,
    directCostChangePercent: previous.directCost !== 0
      ? (directCostChange / previous.directCost) * 100 : 0,
    previousGrandTotal: previous.grandTotal,
    currentGrandTotal: current.grandTotal,
    grandTotalChange,
    grandTotalChangePercent: previous.grandTotal !== 0
      ? (grandTotalChange / previous.grandTotal) * 100 : 0,
    divisionChanges,
    changes,
    addedCount: changes.filter(c => c.changeType === 'added').length,
    removedCount: changes.filter(c => c.changeType === 'removed').length,
    modifiedCount: changes.filter(c => c.changeType === 'modified').length,
    unchangedCount: previous.lineItems.length - changes.filter(c => c.changeType !== 'added').length,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Version History Management ──────────────────────────────────────────────

/**
 * Initialize a version history for a project.
 */
export function createVersionHistory(projectName: string): VersionHistory {
  return { projectName, snapshots: [], currentRevision: 0 };
}

/**
 * Add a snapshot to the version history.
 * Automatically supersedes the previous revision.
 */
export function addRevision(
  history: VersionHistory,
  snapshot: EstimateSnapshot
): VersionHistory {
  // Mark previous as superseded
  if (history.snapshots.length > 0) {
    const prev = history.snapshots[history.snapshots.length - 1];
    prev.metadata.status = 'superseded';
  }

  history.snapshots.push(snapshot);
  history.currentRevision = snapshot.metadata.revisionNumber;
  return history;
}

/**
 * Get the current (latest) snapshot from history.
 */
export function getCurrentSnapshot(history: VersionHistory): EstimateSnapshot | null {
  return history.snapshots.length > 0 ? history.snapshots[history.snapshots.length - 1] : null;
}

/**
 * Get a specific revision by number.
 */
export function getRevision(history: VersionHistory, revisionNumber: number): EstimateSnapshot | null {
  return history.snapshots.find(s => s.metadata.revisionNumber === revisionNumber) || null;
}

/**
 * Compare two revisions within a history.
 */
export function compareHistoryRevisions(
  history: VersionHistory,
  fromRevision: number,
  toRevision: number
): RevisionComparison | null {
  const from = getRevision(history, fromRevision);
  const to = getRevision(history, toRevision);
  if (!from || !to) return null;
  return compareRevisions(from, to);
}

// ─── Report Formatting ───────────────────────────────────────────────────────

/**
 * Format a revision comparison as a human-readable report.
 * Suitable for CCDC 2 "Changes in the Work" documentation.
 */
export function formatComparisonReport(comparison: RevisionComparison): string {
  const f = (n: number) => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  const out: string[] = [];

  out.push('====================================================================');
  out.push('  ESTIMATE REVISION COMPARISON REPORT');
  out.push('  ' + comparison.fromRevision + ' → ' + comparison.toRevision);
  out.push('====================================================================');
  out.push('');
  out.push('  From: ' + comparison.fromRevision + ' (' + comparison.fromDate.substring(0, 10) + ')');
  out.push('  To:   ' + comparison.toRevision + ' (' + comparison.toDate.substring(0, 10) + ')');
  out.push('');

  // Summary
  out.push('  DIRECT COST:  ' + f(comparison.previousDirectCost) + ' → ' + f(comparison.currentDirectCost) +
    ' (' + pct(comparison.directCostChangePercent) + ')');
  out.push('  GRAND TOTAL:  ' + f(comparison.previousGrandTotal) + ' → ' + f(comparison.currentGrandTotal) +
    ' (' + pct(comparison.grandTotalChangePercent) + ')');
  out.push('');

  // Division changes
  if (comparison.divisionChanges.length > 0) {
    out.push('  ── Division Changes ──');
    for (const d of comparison.divisionChanges) {
      const sign = d.difference >= 0 ? '+' : '';
      out.push('    Div ' + d.division + ': ' + f(d.previousCost) + ' → ' + f(d.currentCost) +
        ' (' + sign + f(d.difference) + ', ' + pct(d.percentChange) + ')');
    }
    out.push('');
  }

  // Change summary
  out.push('  ── Change Summary ──');
  out.push('    Added:     ' + comparison.addedCount + ' line items');
  out.push('    Removed:   ' + comparison.removedCount + ' line items');
  out.push('    Modified:  ' + comparison.modifiedCount + ' line items');
  out.push('');

  // Top changes by absolute impact
  if (comparison.changes.length > 0) {
    const sorted = comparison.changes.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
    const top = sorted.slice(0, 10);
    out.push('  ── Top Changes by Cost Impact ──');
    for (const c of top) {
      const icon = c.changeType === 'added' ? '➕' : c.changeType === 'removed' ? '➖' : '📝';
      const sign = c.difference >= 0 ? '+' : '';
      out.push('    ' + icon + ' Div ' + c.csiDivision + ' | ' + c.floorLabel +
        ' | ' + sign + f(c.difference));
      out.push('      ' + c.detail);
    }
    if (sorted.length > 10) out.push('    ... and ' + (sorted.length - 10) + ' more changes');
    out.push('');
  }

  out.push('====================================================================');
  return out.join('\n');
}

/**
 * Format a version history summary.
 */
export function formatVersionHistoryReport(history: VersionHistory): string {
  const f = (n: number) => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const out: string[] = [];

  out.push('====================================================================');
  out.push('  ESTIMATE VERSION HISTORY');
  out.push('  Project: ' + history.projectName);
  out.push('====================================================================');
  out.push('');

  if (history.snapshots.length === 0) {
    out.push('  No revisions recorded.');
    out.push('====================================================================');
    return out.join('\n');
  }

  for (const snap of history.snapshots) {
    const m = snap.metadata;
    const status = m.status === 'superseded' ? '(superseded)' :
                   m.status === 'final' ? '★ FINAL' :
                   m.status === 'issued' ? '(issued)' : '(draft)';
    out.push('  ' + m.revisionLabel + ' ' + status);
    out.push('    Date: ' + m.createdAt.substring(0, 10) + ' | By: ' + m.createdBy);
    out.push('    Reason: ' + m.reason);
    out.push('    Direct: ' + f(snap.directCost) + ' | Grand Total: ' + f(snap.grandTotal));
    out.push('    Items: ' + snap.totalLineItems + ' | Verified: ' + snap.verifiedItems);
    if (m.aaceClass) out.push('    AACE Class: ' + m.aaceClass);
    out.push('');
  }

  out.push('  Current revision: ' + history.currentRevision);
  out.push('====================================================================');
  return out.join('\n');
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Simple hash for creating stable line item IDs.
 * Not cryptographic — just for comparison between snapshots.
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}
