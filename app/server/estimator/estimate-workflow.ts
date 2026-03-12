// server/estimator/estimate-workflow.ts
// =============================================================================
// ESTIMATE WORKFLOW — LIFECYCLE, MAKER-CHECKER, BID-LEVELING, ALTERNATES
// =============================================================================
//
// Closes QS Level 5 gaps:
//   3.8  Maker-Checker Dual Review Workflow
//   8.1  Estimate Versioning (Draft → Review → Approved → Frozen)
//   8.2  Bid-Leveling Sheets by CSI Division
//   8.3  Alternate/Option Pricing (add/deduct VE options)
//
// The estimate lifecycle follows professional QS practice:
//   Draft → Under Review → Approved → Frozen
//   - Only "Frozen" estimates can be issued for tender
//   - Frozen estimates are immutable — changes require new version
//   - Maker-checker: estimator submits, reviewer approves/rejects
//
// Consumes: EstimateSummary from estimate-engine.ts
// Consumed by: qs-level5-routes.ts, boe-generator.ts
// =============================================================================

import type { EstimateSummary } from './estimate-engine';


// ─── LIFECYCLE TYPES ────────────────────────────────────────────────────────

export type EstimateStatus = 'draft' | 'under_review' | 'approved' | 'frozen' | 'superseded';

export interface EstimateVersion {
  versionId: string;
  projectId: string;
  versionNumber: number;        // 1, 2, 3, ...
  status: EstimateStatus;
  estimateSnapshot: EstimateSummary;
  maker: string;                 // estimator who created
  checker?: string;              // reviewer who approved
  submitDate?: string;           // when submitted for review
  reviewDate?: string;           // when reviewed
  approveDate?: string;          // when approved
  freezeDate?: string;           // when frozen
  reviewComments?: string;
  rejectionReason?: string;
  changeDescription: string;     // what changed from prior version
  createdAt: string;
  updatedAt: string;
}

export interface VersionDiff {
  fromVersion: number;
  toVersion: number;
  grandTotalChange: number;
  grandTotalChangePercent: number;
  addedDivisions: string[];
  removedDivisions: string[];
  lineItemCountChange: number;
  majorChanges: Array<{
    csiDivision: string;
    description: string;
    previousCost: number;
    currentCost: number;
    change: number;
    changePercent: number;
  }>;
  generatedAt: string;
}


// ─── MAKER-CHECKER REVIEW ───────────────────────────────────────────────────

export interface ReviewAction {
  versionId: string;
  action: 'submit' | 'approve' | 'reject' | 'freeze' | 'reopen';
  actor: string;
  timestamp: string;
  comments?: string;
}

export interface ReviewHistory {
  versionId: string;
  actions: ReviewAction[];
}


// ─── BID-LEVELING TYPES ────────────────────────────────────────────────────

export interface BidderEntry {
  bidderName: string;
  bidDate: string;
  totalBidAmount: number;
  divisionBreakdown: Record<string, number>;  // csiDivision → amount
  qualifications: string[];
  exclusions: string[];
  addenda: string[];           // which addenda acknowledged
  bondIncluded: boolean;
}

export interface BidLevelingRow {
  csiDivision: string;
  csiDivisionName: string;
  estimateAmount: number;
  bidAmounts: Record<string, number>;  // bidderName → amount
  lowBid: number;
  highBid: number;
  averageBid: number;
  spreadPercent: number;
  estimateVarianceFromLow: number;
}

export interface BidLevelingSheet {
  projectId: string;
  estimate: { total: number; versionNumber: number };
  bidders: BidderEntry[];
  levelingRows: BidLevelingRow[];
  summary: {
    estimateTotal: number;
    bidTotals: Record<string, number>;
    lowestBidder: string;
    lowestBidAmount: number;
    highestBidder: string;
    highestBidAmount: number;
    averageBid: number;
    spreadPercent: number;
    estimateVsLowBid: number;
    estimateVsLowBidPercent: number;
  };
  generatedAt: string;
}


// ─── ALTERNATE / OPTION PRICING ─────────────────────────────────────────────

export interface AlternatePrice {
  id: string;
  projectId: string;
  alternateNumber: string;      // "Alt-1", "Alt-2", etc.
  description: string;
  type: 'add' | 'deduct';
  baseItems: string[];           // CSI codes affected
  addDeductAmount: number;       // positive for add, negative for deduct
  rationale: string;
  linkedDrawingRef?: string;
  status: 'proposed' | 'accepted' | 'rejected';
  createdAt: string;
}


// ─── IN-MEMORY STORAGE ──────────────────────────────────────────────────────

const versionStore = new Map<string, EstimateVersion[]>();  // projectId → versions
const reviewStore = new Map<string, ReviewAction[]>();       // versionId → actions
const bidderStore = new Map<string, BidderEntry[]>();        // projectId → bidders
const alternateStore = new Map<string, AlternatePrice[]>();  // projectId → alternates


// ─── VERSION LIFECYCLE ──────────────────────────────────────────────────────

export function createVersion(
  projectId: string,
  estimate: EstimateSummary,
  maker: string,
  changeDescription: string,
): EstimateVersion {
  const existing = versionStore.get(projectId) ?? [];
  const versionNumber = existing.length + 1;
  const now = new Date().toISOString();

  // Supersede previous version if exists
  if (existing.length > 0) {
    const prev = existing[existing.length - 1];
    if (prev.status !== 'frozen') {
      prev.status = 'superseded';
      prev.updatedAt = now;
    }
  }

  const version: EstimateVersion = {
    versionId: `EV-${projectId}-v${versionNumber}`,
    projectId,
    versionNumber,
    status: 'draft',
    estimateSnapshot: estimate,
    maker,
    changeDescription,
    createdAt: now,
    updatedAt: now,
  };

  existing.push(version);
  versionStore.set(projectId, existing);
  return version;
}

export function getVersions(projectId: string): EstimateVersion[] {
  return versionStore.get(projectId) ?? [];
}

export function getVersion(versionId: string): EstimateVersion | undefined {
  for (const versions of versionStore.values()) {
    const found = versions.find(v => v.versionId === versionId);
    if (found) return found;
  }
  return undefined;
}

export function getLatestVersion(projectId: string): EstimateVersion | undefined {
  const versions = versionStore.get(projectId) ?? [];
  return versions.length > 0 ? versions[versions.length - 1] : undefined;
}


// ─── MAKER-CHECKER ACTIONS ──────────────────────────────────────────────────

function recordAction(action: ReviewAction): void {
  const existing = reviewStore.get(action.versionId) ?? [];
  existing.push(action);
  reviewStore.set(action.versionId, existing);
}

export function submitForReview(versionId: string, actor: string, comments?: string): EstimateVersion | undefined {
  const version = getVersion(versionId);
  if (!version || version.status !== 'draft') return undefined;

  version.status = 'under_review';
  version.submitDate = new Date().toISOString();
  version.updatedAt = version.submitDate;

  recordAction({ versionId, action: 'submit', actor, timestamp: version.submitDate, comments });
  return version;
}

export function approveEstimate(versionId: string, checker: string, comments?: string): EstimateVersion | undefined {
  const version = getVersion(versionId);
  if (!version || version.status !== 'under_review') return undefined;
  if (version.maker === checker) return undefined; // maker cannot approve own work

  version.status = 'approved';
  version.checker = checker;
  version.reviewDate = new Date().toISOString();
  version.approveDate = version.reviewDate;
  version.reviewComments = comments;
  version.updatedAt = version.reviewDate;

  recordAction({ versionId, action: 'approve', actor: checker, timestamp: version.reviewDate, comments });
  return version;
}

export function rejectEstimate(versionId: string, checker: string, reason: string): EstimateVersion | undefined {
  const version = getVersion(versionId);
  if (!version || version.status !== 'under_review') return undefined;

  version.status = 'draft';
  version.checker = checker;
  version.reviewDate = new Date().toISOString();
  version.rejectionReason = reason;
  version.updatedAt = version.reviewDate;

  recordAction({ versionId, action: 'reject', actor: checker, timestamp: version.reviewDate, comments: reason });
  return version;
}

export function freezeEstimate(versionId: string, actor: string): EstimateVersion | undefined {
  const version = getVersion(versionId);
  if (!version || version.status !== 'approved') return undefined;

  version.status = 'frozen';
  version.freezeDate = new Date().toISOString();
  version.updatedAt = version.freezeDate;

  recordAction({ versionId, action: 'freeze', actor, timestamp: version.freezeDate });
  return version;
}

export function reopenEstimate(versionId: string, actor: string, reason: string): EstimateVersion | undefined {
  const version = getVersion(versionId);
  if (!version || (version.status !== 'approved' && version.status !== 'frozen')) return undefined;

  version.status = 'draft';
  version.updatedAt = new Date().toISOString();

  recordAction({ versionId, action: 'reopen', actor, timestamp: version.updatedAt, comments: reason });
  return version;
}

export function getReviewHistory(versionId: string): ReviewAction[] {
  return reviewStore.get(versionId) ?? [];
}


// ─── VERSION DIFF ───────────────────────────────────────────────────────────

export function computeVersionDiff(projectId: string, fromVersion: number, toVersion: number): VersionDiff | undefined {
  const versions = versionStore.get(projectId) ?? [];
  const from = versions.find(v => v.versionNumber === fromVersion);
  const to = versions.find(v => v.versionNumber === toVersion);
  if (!from || !to) return undefined;

  const fromDivCosts = new Map<string, number>();
  const toDivCosts = new Map<string, number>();

  for (const f of from.estimateSnapshot.floors) {
    for (const li of f.lineItems) {
      fromDivCosts.set(li.csiDivision, (fromDivCosts.get(li.csiDivision) ?? 0) + li.totalCost);
    }
  }
  for (const f of to.estimateSnapshot.floors) {
    for (const li of f.lineItems) {
      toDivCosts.set(li.csiDivision, (toDivCosts.get(li.csiDivision) ?? 0) + li.totalCost);
    }
  }

  const allDivs = new Set([...fromDivCosts.keys(), ...toDivCosts.keys()]);
  const added = [...allDivs].filter(d => !fromDivCosts.has(d));
  const removed = [...allDivs].filter(d => !toDivCosts.has(d));

  const majorChanges: VersionDiff['majorChanges'] = [];
  for (const div of allDivs) {
    const prev = fromDivCosts.get(div) ?? 0;
    const curr = toDivCosts.get(div) ?? 0;
    const change = curr - prev;
    const pct = prev > 0 ? (change / prev) * 100 : (curr > 0 ? 100 : 0);
    if (Math.abs(pct) > 5 || Math.abs(change) > 1000) {
      majorChanges.push({
        csiDivision: div,
        description: to.estimateSnapshot.floors[0]?.lineItems.find(li => li.csiDivision === div)?.csiDivisionName ?? `Div ${div}`,
        previousCost: Math.round(prev * 100) / 100,
        currentCost: Math.round(curr * 100) / 100,
        change: Math.round(change * 100) / 100,
        changePercent: Math.round(pct * 100) / 100,
      });
    }
  }

  const gtChange = to.estimateSnapshot.grandTotal - from.estimateSnapshot.grandTotal;

  return {
    fromVersion,
    toVersion,
    grandTotalChange: Math.round(gtChange * 100) / 100,
    grandTotalChangePercent: from.estimateSnapshot.grandTotal > 0
      ? Math.round((gtChange / from.estimateSnapshot.grandTotal) * 10000) / 100
      : 0,
    addedDivisions: added,
    removedDivisions: removed,
    lineItemCountChange: to.estimateSnapshot.lineItemCount - from.estimateSnapshot.lineItemCount,
    majorChanges: majorChanges.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)),
    generatedAt: new Date().toISOString(),
  };
}


// ─── BID-LEVELING ───────────────────────────────────────────────────────────

export function addBidder(projectId: string, bidder: BidderEntry): BidderEntry {
  const existing = bidderStore.get(projectId) ?? [];
  existing.push(bidder);
  bidderStore.set(projectId, existing);
  return bidder;
}

export function getBidders(projectId: string): BidderEntry[] {
  return bidderStore.get(projectId) ?? [];
}

export function deleteBidder(projectId: string, bidderName: string): boolean {
  const existing = bidderStore.get(projectId) ?? [];
  const filtered = existing.filter(b => b.bidderName !== bidderName);
  bidderStore.set(projectId, filtered);
  return filtered.length < existing.length;
}

export function generateBidLevelingSheet(projectId: string, estimate: EstimateSummary): BidLevelingSheet | undefined {
  const bidders = bidderStore.get(projectId);
  if (!bidders || bidders.length === 0) return undefined;

  // Build estimate division costs
  const estDivCosts = new Map<string, { name: string; cost: number }>();
  for (const floor of estimate.floors) {
    for (const li of floor.lineItems) {
      const ex = estDivCosts.get(li.csiDivision) ?? { name: li.csiDivisionName, cost: 0 };
      ex.cost += li.totalCost;
      estDivCosts.set(li.csiDivision, ex);
    }
  }

  const allDivs = new Set<string>();
  estDivCosts.forEach((_, d) => allDivs.add(d));
  bidders.forEach(b => Object.keys(b.divisionBreakdown).forEach(d => allDivs.add(d)));

  const levelingRows: BidLevelingRow[] = [...allDivs].sort().map(div => {
    const estAmount = estDivCosts.get(div)?.cost ?? 0;
    const bidAmounts: Record<string, number> = {};
    const bidValues: number[] = [];

    for (const bidder of bidders) {
      const amt = bidder.divisionBreakdown[div] ?? 0;
      bidAmounts[bidder.bidderName] = Math.round(amt * 100) / 100;
      if (amt > 0) bidValues.push(amt);
    }

    const low = bidValues.length > 0 ? Math.min(...bidValues) : 0;
    const high = bidValues.length > 0 ? Math.max(...bidValues) : 0;
    const avg = bidValues.length > 0 ? bidValues.reduce((s, v) => s + v, 0) / bidValues.length : 0;

    return {
      csiDivision: div,
      csiDivisionName: estDivCosts.get(div)?.name ?? `Div ${div}`,
      estimateAmount: Math.round(estAmount * 100) / 100,
      bidAmounts,
      lowBid: Math.round(low * 100) / 100,
      highBid: Math.round(high * 100) / 100,
      averageBid: Math.round(avg * 100) / 100,
      spreadPercent: low > 0 ? Math.round(((high - low) / low) * 10000) / 100 : 0,
      estimateVarianceFromLow: Math.round((estAmount - low) * 100) / 100,
    };
  });

  // Summary
  const bidTotals: Record<string, number> = {};
  for (const bidder of bidders) {
    bidTotals[bidder.bidderName] = Math.round(bidder.totalBidAmount * 100) / 100;
  }

  const allTotals = Object.values(bidTotals);
  const lowestTotal = Math.min(...allTotals);
  const highestTotal = Math.max(...allTotals);
  const lowestBidder = Object.entries(bidTotals).find(([, v]) => v === lowestTotal)?.[0] ?? '';
  const highestBidder = Object.entries(bidTotals).find(([, v]) => v === highestTotal)?.[0] ?? '';

  return {
    projectId,
    estimate: { total: Math.round(estimate.grandTotal * 100) / 100, versionNumber: 0 },
    bidders,
    levelingRows,
    summary: {
      estimateTotal: Math.round(estimate.grandTotal * 100) / 100,
      bidTotals,
      lowestBidder,
      lowestBidAmount: Math.round(lowestTotal * 100) / 100,
      highestBidder,
      highestBidAmount: Math.round(highestTotal * 100) / 100,
      averageBid: Math.round((allTotals.reduce((s, v) => s + v, 0) / allTotals.length) * 100) / 100,
      spreadPercent: lowestTotal > 0 ? Math.round(((highestTotal - lowestTotal) / lowestTotal) * 10000) / 100 : 0,
      estimateVsLowBid: Math.round((estimate.grandTotal - lowestTotal) * 100) / 100,
      estimateVsLowBidPercent: lowestTotal > 0
        ? Math.round(((estimate.grandTotal - lowestTotal) / lowestTotal) * 10000) / 100
        : 0,
    },
    generatedAt: new Date().toISOString(),
  };
}


// ─── ALTERNATE PRICING ──────────────────────────────────────────────────────

export function addAlternate(alt: Omit<AlternatePrice, 'id' | 'createdAt'>): AlternatePrice {
  const ap: AlternatePrice = {
    ...alt,
    id: `ALT-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    createdAt: new Date().toISOString(),
  };
  const existing = alternateStore.get(alt.projectId) ?? [];
  existing.push(ap);
  alternateStore.set(alt.projectId, existing);
  return ap;
}

export function getAlternates(projectId: string): AlternatePrice[] {
  return alternateStore.get(projectId) ?? [];
}

export function updateAlternateStatus(
  projectId: string,
  alternateId: string,
  status: AlternatePrice['status'],
): AlternatePrice | undefined {
  const alts = alternateStore.get(projectId) ?? [];
  const alt = alts.find(a => a.id === alternateId);
  if (alt) alt.status = status;
  return alt;
}

export function deleteAlternate(projectId: string, alternateId: string): boolean {
  const existing = alternateStore.get(projectId) ?? [];
  const filtered = existing.filter(a => a.id !== alternateId);
  alternateStore.set(projectId, filtered);
  return filtered.length < existing.length;
}

export function computeAlternateImpact(projectId: string, baseTotal: number): {
  baseTotal: number;
  acceptedAdds: number;
  acceptedDeducts: number;
  adjustedTotal: number;
  alternates: AlternatePrice[];
} {
  const alts = getAlternates(projectId);
  const accepted = alts.filter(a => a.status === 'accepted');
  const adds = accepted.filter(a => a.type === 'add').reduce((s, a) => s + a.addDeductAmount, 0);
  const deducts = accepted.filter(a => a.type === 'deduct').reduce((s, a) => s + Math.abs(a.addDeductAmount), 0);

  return {
    baseTotal: Math.round(baseTotal * 100) / 100,
    acceptedAdds: Math.round(adds * 100) / 100,
    acceptedDeducts: Math.round(deducts * 100) / 100,
    adjustedTotal: Math.round((baseTotal + adds - deducts) * 100) / 100,
    alternates: alts,
  };
}
