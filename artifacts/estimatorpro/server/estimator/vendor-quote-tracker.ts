// server/estimator/vendor-quote-tracker.ts
// =============================================================================
// VENDOR QUOTE TRACKER + SUB BID PACKAGES
// =============================================================================
//
// Closes QS Level 5 gaps:
//   4.5  Vendor Quote Tracking (quote date, validity, binding flag, overrides)
//   4.7  Sub Bid Packages by Division (trade package structuring)
//
// Vendor quotes override rate-table pricing when available.
// Expired quotes flagged automatically.
//
// Consumes: EstimateSummary, EstimateLineItem from estimate-engine.ts
// Consumed by: budget-structure.ts (firm pricing), qs-level5-routes.ts
// =============================================================================

import type { EstimateSummary } from './estimate-engine';


// ─── VENDOR QUOTE TYPES ─────────────────────────────────────────────────────

export interface VendorQuote {
  id: string;
  projectId: string;
  lineItemCode: string;     // CSI rate code this quote applies to
  vendor: string;
  vendorContact?: string;
  vendorEmail?: string;
  quoteDate: string;        // ISO date
  validityDays: number;     // usually 30, 60, 90
  expiryDate: string;       // computed: quoteDate + validityDays
  quotedAmount: number;     // total $ for scope
  quotedUnitRate?: number;  // $/unit if per-unit pricing
  quotedUnit?: string;
  isBinding: boolean;       // firm quote vs budgetary
  scopeNotes: string;       // description of what's included/excluded
  inclusions: string[];     // explicit items included
  exclusions: string[];     // explicit items excluded
  status: 'active' | 'expired' | 'superseded' | 'withdrawn';
  attachmentRef?: string;   // document reference
  createdAt: string;
  updatedAt: string;
}

export type BidPackageStatus = 'draft' | 'issued' | 'received' | 'evaluated' | 'awarded' | 'rejected';

export interface SubBidPackage {
  id: string;
  projectId: string;
  packageNumber: string;    // e.g., "BP-03" for Div 03 Concrete
  csiDivisions: string[];   // which divisions this package covers
  description: string;
  trade: string;             // e.g., "Concrete Subcontractor"
  scopeSummary: string;
  estimatedValue: number;   // from estimate engine
  status: BidPackageStatus;
  invitedVendors: string[];
  receivedQuotes: string[]; // VendorQuote IDs
  awardedVendor?: string;
  awardedAmount?: number;
  dueDate?: string;         // bid due date
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteAnalysis {
  projectId: string;
  totalQuotes: number;
  activeQuotes: number;
  expiredQuotes: number;
  bindingQuotes: number;
  budgetaryQuotes: number;
  quotedValueTotal: number;
  estimateValueTotal: number;
  varianceTotal: number;
  variancePercent: number;
  quoteCoverage: number;    // % of estimate covered by quotes
  expiringWithin30Days: VendorQuote[];
  generatedAt: string;
}


// ─── IN-MEMORY STORAGE ──────────────────────────────────────────────────────

const quoteStore = new Map<string, VendorQuote>();
const packageStore = new Map<string, SubBidPackage>();

// ─── VENDOR QUOTE CRUD ──────────────────────────────────────────────────────

export function addQuote(quote: Omit<VendorQuote, 'id' | 'expiryDate' | 'status' | 'createdAt' | 'updatedAt'>): VendorQuote {
  const now = new Date().toISOString();
  const qDate = new Date(quote.quoteDate);
  const expiry = new Date(qDate.getTime() + quote.validityDays * 86400000);

  const vq: VendorQuote = {
    ...quote,
    id: `VQ-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    expiryDate: expiry.toISOString().split('T')[0],
    status: expiry > new Date() ? 'active' : 'expired',
    createdAt: now,
    updatedAt: now,
  };
  quoteStore.set(vq.id, vq);
  return vq;
}

export function getQuote(id: string): VendorQuote | undefined {
  const q = quoteStore.get(id);
  if (q) refreshQuoteStatus(q);
  return q;
}

export function getQuotesByProject(projectId: string): VendorQuote[] {
  const quotes = [...quoteStore.values()].filter(q => q.projectId === projectId);
  quotes.forEach(refreshQuoteStatus);
  return quotes;
}

export function getQuotesByLineItem(projectId: string, lineItemCode: string): VendorQuote[] {
  return getQuotesByProject(projectId).filter(q => q.lineItemCode === lineItemCode);
}

export function getActiveQuotesByProject(projectId: string): VendorQuote[] {
  return getQuotesByProject(projectId).filter(q => q.status === 'active');
}

export function updateQuote(id: string, patch: Partial<VendorQuote>): VendorQuote | undefined {
  const existing = quoteStore.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };

  // Recompute expiry if quoteDate or validityDays changed
  if (patch.quoteDate || patch.validityDays) {
    const qDate = new Date(updated.quoteDate);
    const expiry = new Date(qDate.getTime() + updated.validityDays * 86400000);
    updated.expiryDate = expiry.toISOString().split('T')[0];
  }
  refreshQuoteStatus(updated);
  quoteStore.set(id, updated);
  return updated;
}

export function deleteQuote(id: string): boolean {
  return quoteStore.delete(id);
}

function refreshQuoteStatus(q: VendorQuote): void {
  if (q.status === 'superseded' || q.status === 'withdrawn') return;
  const now = new Date();
  const expiry = new Date(q.expiryDate);
  q.status = expiry >= now ? 'active' : 'expired';
}


// ─── SUB BID PACKAGE CRUD ───────────────────────────────────────────────────

export function createBidPackage(
  pkg: Omit<SubBidPackage, 'id' | 'status' | 'receivedQuotes' | 'createdAt' | 'updatedAt'>
): SubBidPackage {
  const now = new Date().toISOString();
  const bp: SubBidPackage = {
    ...pkg,
    id: `BP-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    status: 'draft',
    receivedQuotes: [],
    createdAt: now,
    updatedAt: now,
  };
  packageStore.set(bp.id, bp);
  return bp;
}

export function getBidPackage(id: string): SubBidPackage | undefined {
  return packageStore.get(id);
}

export function getBidPackagesByProject(projectId: string): SubBidPackage[] {
  return [...packageStore.values()].filter(bp => bp.projectId === projectId);
}

export function updateBidPackage(id: string, patch: Partial<SubBidPackage>): SubBidPackage | undefined {
  const existing = packageStore.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  packageStore.set(id, updated);
  return updated;
}

export function deleteBidPackage(id: string): boolean {
  return packageStore.delete(id);
}

export function linkQuoteToBidPackage(packageId: string, quoteId: string): boolean {
  const bp = packageStore.get(packageId);
  if (!bp) return false;
  if (!bp.receivedQuotes.includes(quoteId)) {
    bp.receivedQuotes.push(quoteId);
    bp.updatedAt = new Date().toISOString();
  }
  return true;
}


// ─── AUTO-GENERATE BID PACKAGES FROM ESTIMATE ───────────────────────────────

export function generateBidPackagesFromEstimate(
  projectId: string,
  estimate: EstimateSummary,
): SubBidPackage[] {
  const divisionCosts = new Map<string, { name: string; cost: number; items: number }>();

  for (const floor of estimate.floors) {
    for (const li of floor.lineItems) {
      const existing = divisionCosts.get(li.csiDivision) ?? { name: li.csiDivisionName, cost: 0, items: 0 };
      existing.cost += li.totalCost;
      existing.items += 1;
      divisionCosts.set(li.csiDivision, existing);
    }
  }

  const TRADE_MAP: Record<string, string> = {
    '01': 'General Contractor', '02': 'Demolition Contractor', '03': 'Concrete Subcontractor',
    '04': 'Masonry Subcontractor', '05': 'Structural Steel Erector', '06': 'Carpentry Subcontractor',
    '07': 'Roofing & Waterproofing', '08': 'Glazing & Door Supplier', '09': 'Finishing Trades',
    '10': 'Specialties Supplier', '11': 'Equipment Supplier', '12': 'Furnishing Supplier',
    '13': 'Special Construction', '14': 'Elevator Contractor', '21': 'Fire Protection Contractor',
    '22': 'Plumbing Contractor', '23': 'HVAC Contractor', '25': 'Controls Contractor',
    '26': 'Electrical Contractor', '27': 'Communications Contractor', '28': 'Security Contractor',
    '31': 'Excavation Contractor', '32': 'Site Work Contractor', '33': 'Underground Utilities',
    '34': 'Transportation', '35': 'Marine Contractor',
  };

  const packages: SubBidPackage[] = [];
  for (const [div, data] of divisionCosts) {
    if (data.cost <= 0) continue;
    packages.push(createBidPackage({
      projectId,
      packageNumber: `BP-${div}`,
      csiDivisions: [div],
      description: `Div ${div} — ${data.name}`,
      trade: TRADE_MAP[div] ?? `Div ${div} Specialty`,
      scopeSummary: `${data.items} line items, ${data.name}`,
      estimatedValue: Math.round(data.cost * 100) / 100,
      invitedVendors: [],
      dueDate: undefined,
      notes: `Auto-generated from estimate on ${new Date().toISOString().split('T')[0]}`,
    }));
  }

  return packages;
}


// ─── QUOTE ANALYSIS ─────────────────────────────────────────────────────────

export function analyzeQuotes(projectId: string, estimate: EstimateSummary): QuoteAnalysis {
  const quotes = getQuotesByProject(projectId);
  const now = new Date();
  const thirtyDays = new Date(now.getTime() + 30 * 86400000);

  const active = quotes.filter(q => q.status === 'active');
  const expired = quotes.filter(q => q.status === 'expired');
  const binding = active.filter(q => q.isBinding);
  const budgetary = active.filter(q => !q.isBinding);
  const expiringWithin30Days = active.filter(q => new Date(q.expiryDate) <= thirtyDays);

  const quotedTotal = active.reduce((s, q) => s + q.quotedAmount, 0);

  return {
    projectId,
    totalQuotes: quotes.length,
    activeQuotes: active.length,
    expiredQuotes: expired.length,
    bindingQuotes: binding.length,
    budgetaryQuotes: budgetary.length,
    quotedValueTotal: Math.round(quotedTotal * 100) / 100,
    estimateValueTotal: Math.round(estimate.grandTotal * 100) / 100,
    varianceTotal: Math.round((quotedTotal - estimate.grandTotal) * 100) / 100,
    variancePercent: estimate.grandTotal > 0
      ? Math.round(((quotedTotal - estimate.grandTotal) / estimate.grandTotal) * 10000) / 100
      : 0,
    quoteCoverage: estimate.grandTotal > 0
      ? Math.round((quotedTotal / estimate.grandTotal) * 10000) / 100
      : 0,
    expiringWithin30Days,
    generatedAt: now.toISOString(),
  };
}
