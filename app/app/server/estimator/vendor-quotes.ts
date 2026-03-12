// server/estimator/vendor-quotes.ts
// =============================================================================
// VENDOR QUOTES INTEGRATION
// =============================================================================
//
// Master Priority Item #20
//
// Purpose:
//   1. Register vendor/supplier quotes against estimate line items
//   2. Track quote validity periods and expiry
//   3. Compare multiple quotes per item (min 3 quotes per CIQS best practice)
//   4. Calculate quote coverage (% of estimate backed by firm quotes)
//   5. Flag items without quotes for budget risk assessment
//   6. Support quote escalation for projects spanning multiple bid periods
//   7. Generate vendor quote register for tender documentation
//
// Standards: CIQS, CCDC 10 (Stipulated Price Tender Call)
// =============================================================================

import type { EstimateSummary, EstimateLineItem } from './estimate-engine';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export type QuoteStatus = 'received' | 'pending' | 'expired' | 'accepted' | 'rejected' | 'withdrawn';

export interface VendorQuote {
  quoteId: string;                 // Unique identifier
  vendorName: string;              // Company name
  vendorContact?: string;          // Contact person
  vendorEmail?: string;
  vendorPhone?: string;

  // What this quote covers
  csiDivision: string;             // CSI division
  csiSubdivision: string;          // CSI subdivision
  lineItemDescription: string;     // Maps to estimate line item
  scopeDescription: string;        // Vendor's scope description

  // Pricing
  quotedAmount: number;            // Total quoted price (CAD)
  quotedUnitRate?: number;         // $/unit if applicable
  quotedUnit?: string;             // Unit of measure
  quotedQuantity?: number;         // Quantity quoted
  includesLabor: boolean;          // L/M/E breakdown
  includesMaterial: boolean;
  includesEquipment: boolean;
  laborAmount?: number;
  materialAmount?: number;
  equipmentAmount?: number;

  // Validity
  quoteDate: string;               // ISO date received
  validUntil: string;              // ISO date expiry
  status: QuoteStatus;
  conditions?: string;             // Special conditions or exclusions
  exclusions?: string[];           // What's NOT included

  // Comparison
  estimateAmount?: number;         // Corresponding estimate line item cost
  varianceAmount?: number;         // Quote - estimate (auto-calculated)
  variancePercent?: number;        // (quote - estimate) / estimate * 100
}

export interface QuoteComparison {
  csiDivision: string;
  csiSubdivision: string;
  lineItemDescription: string;
  estimateAmount: number;
  quotes: VendorQuote[];
  lowestQuote: number;
  highestQuote: number;
  averageQuote: number;
  recommendedQuote?: VendorQuote;  // Lowest compliant quote
  quoteCount: number;
  meetsMinimum: boolean;           // >= 3 quotes per CIQS best practice
}

export interface QuoteRegisterSummary {
  projectName: string;
  totalLineItems: number;
  itemsWithQuotes: number;
  itemsWithoutQuotes: number;
  quoteCoveragePercent: number;    // % of estimate value backed by quotes
  totalEstimateAmount: number;
  totalQuotedAmount: number;       // Sum of accepted/recommended quotes
  totalVariance: number;
  quotesReceived: number;
  quotesExpired: number;
  quotesPending: number;
  comparisons: QuoteComparison[];
  unquotedItems: { csiDivision: string; description: string; estimateAmount: number }[];
  expiringQuotes: VendorQuote[];   // Quotes expiring within 30 days
  generatedAt: string;
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Register a vendor quote and auto-calculate variance against estimate.
 */
export function registerQuote(
  quote: Omit<VendorQuote, 'varianceAmount' | 'variancePercent'>,
  estimate: EstimateSummary
): VendorQuote {
  // Find matching estimate line item
  let estimateAmount = 0;
  for (const floor of estimate.floors) {
    for (const item of floor.lineItems) {
      if (item.csiDivision === quote.csiDivision &&
          item.csiSubdivision === quote.csiSubdivision) {
        estimateAmount += item.totalCost;
      }
    }
  }

  const varianceAmount = quote.quotedAmount - estimateAmount;
  const variancePercent = estimateAmount !== 0
    ? (varianceAmount / estimateAmount) * 100 : 0;

  return {
    ...quote,
    estimateAmount,
    varianceAmount: Math.round(varianceAmount * 100) / 100,
    variancePercent: Math.round(variancePercent * 100) / 100,
  };
}

/**
 * Check if a quote has expired based on its validUntil date.
 */
export function isQuoteExpired(quote: VendorQuote, asOfDate?: string): boolean {
  const checkDate = asOfDate ? new Date(asOfDate) : new Date();
  return new Date(quote.validUntil) < checkDate;
}

/**
 * Check if a quote is expiring within a number of days.
 */
export function isQuoteExpiringSoon(quote: VendorQuote, days: number, asOfDate?: string): boolean {
  const checkDate = asOfDate ? new Date(asOfDate) : new Date();
  const expiryDate = new Date(quote.validUntil);
  const daysUntilExpiry = (expiryDate.getTime() - checkDate.getTime()) / (1000 * 60 * 60 * 24);
  return daysUntilExpiry >= 0 && daysUntilExpiry <= days;
}

/**
 * Compare quotes for the same scope item. Groups by CSI division+subdivision.
 */
export function compareQuotes(
  quotes: VendorQuote[],
  estimate: EstimateSummary
): QuoteComparison[] {
  // Group quotes by CSI division + subdivision
  const groups = new Map<string, VendorQuote[]>();
  for (const q of quotes) {
    if (q.status === 'withdrawn' || q.status === 'rejected') continue;
    const key = q.csiDivision + '|' + q.csiSubdivision;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(q);
  }

  const comparisons: QuoteComparison[] = [];
  for (const [key, groupQuotes] of groups) {
    const parts = key.split('|');
    const div = parts[0];
    const sub = parts[1];

    // Find estimate amount for this item
    let estimateAmount = 0;
    let description = groupQuotes[0].lineItemDescription;
    for (const floor of estimate.floors) {
      for (const item of floor.lineItems) {
        if (item.csiDivision === div && item.csiSubdivision === sub) {
          estimateAmount += item.totalCost;
          description = item.description;
        }
      }
    }

    const amounts = groupQuotes
      .filter(q => q.status !== 'expired')
      .map(q => q.quotedAmount);

    const lowest = amounts.length > 0 ? Math.min(...amounts) : 0;
    const highest = amounts.length > 0 ? Math.max(...amounts) : 0;
    const average = amounts.length > 0 ? amounts.reduce((s, a) => s + a, 0) / amounts.length : 0;

    // Recommend lowest non-expired, non-rejected quote
    const validQuotes = groupQuotes
      .filter(q => q.status === 'received' || q.status === 'accepted')
      .sort((a, b) => a.quotedAmount - b.quotedAmount);

    comparisons.push({
      csiDivision: div,
      csiSubdivision: sub,
      lineItemDescription: description,
      estimateAmount,
      quotes: groupQuotes,
      lowestQuote: lowest,
      highestQuote: highest,
      averageQuote: Math.round(average * 100) / 100,
      recommendedQuote: validQuotes.length > 0 ? validQuotes[0] : undefined,
      quoteCount: groupQuotes.length,
      meetsMinimum: groupQuotes.length >= 3,
    });
  }

  return comparisons.sort((a, b) => a.csiDivision.localeCompare(b.csiDivision));
}

/**
 * Generate a complete quote register summary.
 */
export function generateQuoteRegister(
  quotes: VendorQuote[],
  estimate: EstimateSummary,
  projectName: string
): QuoteRegisterSummary {
  const comparisons = compareQuotes(quotes, estimate);

  // Find all estimate line items
  const allItems = new Map<string, { div: string; sub: string; desc: string; cost: number }>();
  for (const floor of estimate.floors) {
    for (const item of floor.lineItems) {
      const key = item.csiDivision + '|' + item.csiSubdivision;
      if (!allItems.has(key)) {
        allItems.set(key, { div: item.csiDivision, sub: item.csiSubdivision, desc: item.description, cost: 0 });
      }
      allItems.get(key)!.cost += item.totalCost;
    }
  }

  // Items with and without quotes
  const quotedKeys = new Set(comparisons.map(c => c.csiDivision + '|' + c.csiSubdivision));
  const unquotedItems: QuoteRegisterSummary['unquotedItems'] = [];
  for (const [key, item] of allItems) {
    if (!quotedKeys.has(key)) {
      unquotedItems.push({ csiDivision: item.div, description: item.desc, estimateAmount: item.cost });
    }
  }

  const totalEstimate = Array.from(allItems.values()).reduce((s, i) => s + i.cost, 0);
  const quotedAmount = comparisons.reduce((s, c) =>
    s + (c.recommendedQuote ? c.recommendedQuote.quotedAmount : 0), 0);
  const quotedEstimateAmount = comparisons.reduce((s, c) => s + c.estimateAmount, 0);

  // Expiring quotes (within 30 days)
  const expiringQuotes = quotes.filter(q =>
    isQuoteExpiringSoon(q, 30) && q.status !== 'expired' && q.status !== 'rejected');

  return {
    projectName,
    totalLineItems: allItems.size,
    itemsWithQuotes: quotedKeys.size,
    itemsWithoutQuotes: unquotedItems.length,
    quoteCoveragePercent: totalEstimate > 0
      ? Math.round((quotedEstimateAmount / totalEstimate) * 10000) / 100 : 0,
    totalEstimateAmount: totalEstimate,
    totalQuotedAmount: quotedAmount,
    totalVariance: quotedAmount - quotedEstimateAmount,
    quotesReceived: quotes.filter(q => q.status === 'received').length,
    quotesExpired: quotes.filter(q => q.status === 'expired').length,
    quotesPending: quotes.filter(q => q.status === 'pending').length,
    comparisons,
    unquotedItems: unquotedItems.sort((a, b) => b.estimateAmount - a.estimateAmount),
    expiringQuotes,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Format the quote register as a human-readable report.
 */
export function formatQuoteRegisterReport(summary: QuoteRegisterSummary): string {
  const f = (n: number) => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const out: string[] = [];

  out.push('====================================================================');
  out.push('  VENDOR QUOTE REGISTER');
  out.push('  Project: ' + summary.projectName);
  out.push('====================================================================');
  out.push('');
  out.push('  Coverage: ' + summary.quoteCoveragePercent.toFixed(1) + '% of estimate backed by quotes');
  out.push('  Items with quotes: ' + summary.itemsWithQuotes + ' / ' + summary.totalLineItems);
  out.push('  Quotes received: ' + summary.quotesReceived + ' | Expired: ' + summary.quotesExpired + ' | Pending: ' + summary.quotesPending);
  out.push('  Estimate total: ' + f(summary.totalEstimateAmount));
  out.push('  Quoted total:   ' + f(summary.totalQuotedAmount));
  out.push('  Variance:       ' + f(summary.totalVariance));
  out.push('');

  if (summary.expiringQuotes.length > 0) {
    out.push('  ── EXPIRING SOON (within 30 days) ──');
    for (const q of summary.expiringQuotes) {
      out.push('    ' + q.vendorName + ' | ' + q.lineItemDescription + ' | Expires: ' + q.validUntil.substring(0, 10));
    }
    out.push('');
  }

  out.push('  ── Quote Comparisons ──');
  for (const c of summary.comparisons) {
    const minFlag = c.meetsMinimum ? '' : ' ⚠️ <3 quotes';
    out.push('  Div ' + c.csiDivision + '.' + c.csiSubdivision + ' — ' + c.lineItemDescription + minFlag);
    out.push('    Estimate: ' + f(c.estimateAmount) + ' | Quotes: ' + c.quoteCount +
      ' | Low: ' + f(c.lowestQuote) + ' | High: ' + f(c.highestQuote) + ' | Avg: ' + f(c.averageQuote));
    if (c.recommendedQuote) {
      out.push('    Recommended: ' + c.recommendedQuote.vendorName + ' at ' + f(c.recommendedQuote.quotedAmount));
    }
  }
  out.push('');

  if (summary.unquotedItems.length > 0) {
    out.push('  ── Unquoted Items (budget risk) ──');
    for (const u of summary.unquotedItems.slice(0, 15)) {
      out.push('    Div ' + u.csiDivision + ' | ' + u.description + ' | ' + f(u.estimateAmount));
    }
    if (summary.unquotedItems.length > 15) {
      out.push('    ... and ' + (summary.unquotedItems.length - 15) + ' more unquoted items');
    }
  }

  out.push('');
  out.push('====================================================================');
  return out.join('\n');
}
