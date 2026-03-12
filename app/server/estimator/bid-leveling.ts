// server/estimator/bid-leveling.ts
//
// Bid-Leveling and Tender Reconciliation Module
// Creates CSI Division–by-bidder comparison matrices, normalises bids to the
// same scope basis, and flags significant variances.
//
// Standards:
//   AACE RP 30R-03 — Implementing Project Constructability
//   CCDC 23 — A Guide to Calling Bids and Awarding Construction Contracts
//   CIQS — Standard Method of Cost Estimating
//
// Workflow:
//   1. Engineer's Estimate (from buildEstimateForModel) → baseline
//   2. Bidder submissions (structured as BidPackage[]) → normalize to same divisions
//   3. Matrix output: Division × Bidder with variance flags
//   4. Scope gap analysis: items in engineer's estimate but missing from bid
//   5. Recommendation report

import type { EstimateSummary, FloorSummary } from './estimate-engine';
import type { BudgetStructure } from './budget-structure';

// ─── Bid Package Input ──────────────────────────────────────────────────────

export interface BidLineItem {
  csiDivision: string;         // 2-digit CSI division
  csiSubdivision?: string;     // Full CSI code if available
  description: string;
  amount: number;              // Bidder's total for this line
  unit?: string;
  quantity?: number;
  unitRate?: number;
  inclusions?: string;         // What the bidder says is included
  exclusions?: string;         // What the bidder explicitly excludes
}

export interface BidPackage {
  bidderName: string;
  bidderCompany: string;
  bidDate: string;             // ISO date
  bidExpiryDate?: string;
  totalBidAmount: number;      // Lump sum bid
  lineItems: BidLineItem[];
  qualifications: string[];    // Bidder's qualifications/exclusions
  alternates?: { description: string; amount: number; type: 'add' | 'deduct' }[];
  bondIncluded: boolean;
  insuranceCertificate: boolean;
  addendaAcknowledged: string[]; // List of addenda numbers acknowledged
}

// ─── Bid Leveling Configuration ─────────────────────────────────────────────

export interface BidLevelConfig {
  varianceThreshold?: number;  // % — flag if bidder is this far from engineer (default 15)
  significantGapThreshold?: number; // $ — flag if scope gap > this amount (default 10000)
  normaliseBids?: boolean;     // Adjust bids for missing scope (default true)
  includeAlternates?: boolean; // Include alternates in comparison (default false)
}

// ─── Output Structures ──────────────────────────────────────────────────────

export interface DivisionComparison {
  csiDivision: string;
  divisionName: string;
  engineerEstimate: number;
  bidders: {
    bidderName: string;
    amount: number;
    variance: number;          // $ difference from engineer
    variancePercent: number;   // % difference from engineer
    flagged: boolean;          // Exceeds threshold
    scopeGaps: string[];       // Items in engineer but not in bid
  }[];
  lowestBid: number;
  highestBid: number;
  spread: number;              // Highest - Lowest
  spreadPercent: number;
}

export interface BidderSummary {
  bidderName: string;
  bidderCompany: string;
  totalBidAmount: number;
  normalisedAmount: number;    // After scope normalisation
  varianceFromEngineer: number;
  variancePercent: number;
  scopeGaps: number;           // Count of missing scope items
  scopeGapValue: number;       // $ value of missing scope
  qualificationCount: number;
  bondIncluded: boolean;
  insuranceCertificate: boolean;
  addendaAcknowledged: number;
  ranking: number;             // 1 = lowest normalised bid
}

export interface ScopeGap {
  csiDivision: string;
  description: string;
  engineerAmount: number;
  bidderName: string;
  gapType: 'missing-division' | 'missing-item' | 'partial-scope' | 'explicit-exclusion';
  estimatedImpact: number;
}

export interface BidLevelingReport {
  projectName: string;
  engineerEstimate: number;
  engineerBudget?: number;     // With markups
  bidCount: number;
  divisionMatrix: DivisionComparison[];
  bidderSummaries: BidderSummary[];
  scopeGaps: ScopeGap[];
  recommendations: string[];
  methodology: 'CCDC 23 Bid Leveling / CIQS Standard Method';
  generatedAt: string;
}

// ─── CSI Division Name Lookup ───────────────────────────────────────────────

const CSI_DIVISION_NAMES: Record<string, string> = {
  '01': 'General Requirements', '02': 'Existing Conditions', '03': 'Concrete',
  '04': 'Masonry', '05': 'Metals', '06': 'Wood/Plastics/Composites',
  '07': 'Thermal & Moisture Protection', '08': 'Openings', '09': 'Finishes',
  '10': 'Specialties', '11': 'Equipment', '12': 'Furnishings',
  '13': 'Special Construction', '14': 'Conveying Equipment',
  '21': 'Fire Suppression', '22': 'Plumbing', '23': 'HVAC',
  '25': 'Integrated Automation', '26': 'Electrical', '27': 'Communications',
  '28': 'Electronic Safety/Security', '31': 'Earthwork',
  '32': 'Exterior Improvements', '33': 'Utilities',
  '34': 'Transportation', '35': 'Waterway/Marine',
  '40': 'Process Integration', '41': 'Material Processing',
  '42': 'Process Heating/Cooling', '43': 'Process Gas/Liquid',
  '44': 'Pollution/Waste Control',
};

// ─── Core Engine ────────────────────────────────────────────────────────────

/**
 * Generate a comprehensive bid-leveling report from engineer's estimate
 * and one or more bidder packages.
 */
export function generateBidLeveling(
  estimate: EstimateSummary,
  bids: BidPackage[],
  config: BidLevelConfig = {},
  budget?: BudgetStructure
): BidLevelingReport {
  const varianceThreshold = config.varianceThreshold ?? 15;
  const gapThreshold = config.significantGapThreshold ?? 10000;
  const normaliseBids = config.normaliseBids ?? true;

  // --- Build engineer's estimate by division ---
  const engineerByDiv = new Map<string, number>();
  for (const floor of estimate.floors) {
    for (const item of floor.lineItems) {
      const div = item.csiDivision;
      engineerByDiv.set(div, (engineerByDiv.get(div) || 0) + item.totalCost);
    }
  }

  // --- Build each bidder's amounts by division ---
  const biddersByDiv = new Map<string, Map<string, number>>(); // div → bidder → amount
  for (const bid of bids) {
    const bidderDiv = new Map<string, number>();
    for (const item of bid.lineItems) {
      const div = item.csiDivision.substring(0, 2);
      bidderDiv.set(div, (bidderDiv.get(div) || 0) + item.amount);
    }
    biddersByDiv.set(bid.bidderName, bidderDiv);
  }

  // --- All divisions across engineer + all bidders ---
  const allDivisions = new Set<string>();
  for (const div of engineerByDiv.keys()) allDivisions.add(div);
  for (const [, divMap] of biddersByDiv) {
    for (const div of divMap.keys()) allDivisions.add(div);
  }
  const sortedDivisions = Array.from(allDivisions).sort();

  // --- Scope gap detection ---
  const scopeGaps: ScopeGap[] = [];

  // --- Division comparison matrix ---
  const divisionMatrix: DivisionComparison[] = sortedDivisions.map(div => {
    const engineerAmt = engineerByDiv.get(div) || 0;
    const divName = CSI_DIVISION_NAMES[div] || 'Division ' + div;

    const bidders = bids.map(bid => {
      const bidderDiv = biddersByDiv.get(bid.bidderName);
      const bidderAmt = bidderDiv?.get(div) || 0;
      const variance = bidderAmt - engineerAmt;
      const variancePct = engineerAmt > 0 ? (variance / engineerAmt) * 100 : (bidderAmt > 0 ? 100 : 0);
      const flagged = Math.abs(variancePct) > varianceThreshold;

      // Detect scope gaps
      const gaps: string[] = [];
      if (engineerAmt > 0 && bidderAmt === 0) {
        gaps.push('Division entirely missing from bid');
        scopeGaps.push({
          csiDivision: div,
          description: divName + ' — division missing from ' + bid.bidderName,
          engineerAmount: engineerAmt,
          bidderName: bid.bidderName,
          gapType: 'missing-division',
          estimatedImpact: engineerAmt,
        });
      }

      // Check for explicit exclusions matching this division
      for (const qual of bid.qualifications) {
        const qualLower = qual.toLowerCase();
        const divNameLower = divName.toLowerCase();
        if (qualLower.includes(divNameLower) || qualLower.includes('div ' + div) || qualLower.includes('division ' + div)) {
          gaps.push('Explicitly excluded: ' + qual);
          if (!scopeGaps.find(g => g.bidderName === bid.bidderName && g.csiDivision === div && g.gapType === 'explicit-exclusion')) {
            scopeGaps.push({
              csiDivision: div,
              description: qual,
              engineerAmount: engineerAmt,
              bidderName: bid.bidderName,
              gapType: 'explicit-exclusion',
              estimatedImpact: engineerAmt - bidderAmt,
            });
          }
        }
      }

      // Partial scope: bidder has something but significantly less
      if (bidderAmt > 0 && engineerAmt > 0 && bidderAmt < engineerAmt * 0.5) {
        gaps.push('Partial scope — bidder amount is <50% of engineer estimate');
        scopeGaps.push({
          csiDivision: div,
          description: divName + ' — partial scope from ' + bid.bidderName,
          engineerAmount: engineerAmt,
          bidderName: bid.bidderName,
          gapType: 'partial-scope',
          estimatedImpact: engineerAmt - bidderAmt,
        });
      }

      return { bidderName: bid.bidderName, amount: bidderAmt, variance, variancePercent: variancePct, flagged, scopeGaps: gaps };
    });

    const bidAmounts = bidders.map(b => b.amount).filter(a => a > 0);
    const lowestBid = bidAmounts.length > 0 ? Math.min(...bidAmounts) : 0;
    const highestBid = bidAmounts.length > 0 ? Math.max(...bidAmounts) : 0;
    const spread = highestBid - lowestBid;
    const spreadPct = lowestBid > 0 ? (spread / lowestBid) * 100 : 0;

    return { csiDivision: div, divisionName: divName, engineerEstimate: engineerAmt, bidders, lowestBid, highestBid, spread, spreadPercent: spreadPct };
  });

  // --- Bidder summaries with normalisation ---
  const bidderSummaries: BidderSummary[] = bids.map(bid => {
    const bidderGaps = scopeGaps.filter(g => g.bidderName === bid.bidderName);
    const scopeGapValue = bidderGaps.reduce((s, g) => s + g.estimatedImpact, 0);
    const normalisedAmount = normaliseBids ? bid.totalBidAmount + scopeGapValue : bid.totalBidAmount;
    const varianceFromEngineer = normalisedAmount - estimate.grandTotal;
    const variancePct = estimate.grandTotal > 0 ? (varianceFromEngineer / estimate.grandTotal) * 100 : 0;

    return {
      bidderName: bid.bidderName,
      bidderCompany: bid.bidderCompany,
      totalBidAmount: bid.totalBidAmount,
      normalisedAmount,
      varianceFromEngineer,
      variancePercent: variancePct,
      scopeGaps: bidderGaps.length,
      scopeGapValue,
      qualificationCount: bid.qualifications.length,
      bondIncluded: bid.bondIncluded,
      insuranceCertificate: bid.insuranceCertificate,
      addendaAcknowledged: bid.addendaAcknowledged.length,
      ranking: 0, // set below
    };
  });

  // Rank by normalised amount
  bidderSummaries.sort((a, b) => a.normalisedAmount - b.normalisedAmount);
  bidderSummaries.forEach((s, i) => { s.ranking = i + 1; });

  // --- Recommendations ---
  const recommendations: string[] = [];

  if (bidderSummaries.length > 0) {
    const lowest = bidderSummaries[0];
    recommendations.push('Lowest normalised bid: ' + lowest.bidderName + ' (' + lowest.bidderCompany + ') at $' +
      lowest.normalisedAmount.toLocaleString('en-CA') + ' (' +
      (lowest.variancePercent >= 0 ? '+' : '') + lowest.variancePercent.toFixed(1) + '% vs engineer).');
  }

  const highGapBidders = bidderSummaries.filter(b => b.scopeGaps > 2);
  if (highGapBidders.length > 0) {
    recommendations.push('CAUTION: ' + highGapBidders.map(b => b.bidderName).join(', ') +
      ' have significant scope gaps (>2 divisions). Require clarification before award.');
  }

  const noBond = bidderSummaries.filter(b => !b.bondIncluded);
  if (noBond.length > 0) {
    recommendations.push('Bond not included: ' + noBond.map(b => b.bidderName).join(', ') + '. Request bonding confirmation.');
  }

  const bigSpreadDivs = divisionMatrix.filter(d => d.spreadPercent > 50 && d.engineerEstimate > gapThreshold);
  if (bigSpreadDivs.length > 0) {
    recommendations.push('High bid spread (>50%) in: ' +
      bigSpreadDivs.map(d => d.divisionName + ' (Div ' + d.csiDivision + ')').join(', ') +
      '. Investigate scope interpretation differences.');
  }

  if (scopeGaps.filter(g => g.estimatedImpact > gapThreshold).length > 0) {
    recommendations.push('Significant scope gaps (>$' + gapThreshold.toLocaleString() + ') found. ' +
      'Issue addendum for scope clarification before contract award.');
  }

  return {
    projectName: 'Bid Leveling Analysis',
    engineerEstimate: estimate.grandTotal,
    engineerBudget: budget?.GRAND_TOTAL,
    bidCount: bids.length,
    divisionMatrix,
    bidderSummaries,
    scopeGaps,
    recommendations,
    methodology: 'CCDC 23 Bid Leveling / CIQS Standard Method',
    generatedAt: new Date().toISOString(),
  };
}

// ─── Report Formatter ───────────────────────────────────────────────────────

export function formatBidLevelingReport(report: BidLevelingReport): string {
  const out: string[] = [];
  const f = (n: number) => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const pct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';

  out.push('═══════════════════════════════════════════════════════════════');
  out.push('  BID LEVELING & TENDER RECONCILIATION REPORT');
  out.push('  Methodology: ' + report.methodology);
  out.push('  Generated: ' + report.generatedAt);
  out.push('═══════════════════════════════════════════════════════════════');
  out.push('');

  // --- Summary ---
  out.push('─── Summary ───');
  out.push('');
  out.push('  Engineer Estimate (direct):  ' + f(report.engineerEstimate));
  if (report.engineerBudget) {
    out.push('  Engineer Budget (all-in):    ' + f(report.engineerBudget));
  }
  out.push('  Bids Received:               ' + report.bidCount);
  out.push('');

  // --- Bidder Ranking ---
  out.push('─── Bidder Ranking (Normalised) ───');
  out.push('');
  out.push('  Rank  Bidder                    Bid Amount      Normalised      Variance    Gaps');
  out.push('  ────  ──────                    ──────────      ──────────      ────────    ────');
  for (const b of report.bidderSummaries) {
    out.push('  ' +
      String(b.ranking).padEnd(6) +
      b.bidderName.padEnd(26) +
      f(b.totalBidAmount).padStart(14) + '  ' +
      f(b.normalisedAmount).padStart(14) + '  ' +
      pct(b.variancePercent).padStart(10) + '  ' +
      String(b.scopeGaps).padStart(4)
    );
  }
  out.push('');

  // --- Division Matrix ---
  out.push('─── Division × Bidder Comparison ───');
  out.push('');
  const bidderNames = report.bidderSummaries.map(b => b.bidderName);
  const headerRow = '  Div   Division Name                     Engineer      ' + bidderNames.map(n => n.substring(0, 14).padStart(14)).join('  ');
  out.push(headerRow);
  out.push('  ───   ─────────────                     ────────      ' + bidderNames.map(() => '──────────────').join('  '));

  for (const div of report.divisionMatrix) {
    if (div.engineerEstimate === 0 && div.bidders.every(b => b.amount === 0)) continue;
    let line = '  ' + div.csiDivision.padEnd(6) + div.divisionName.padEnd(30).substring(0, 30) + '  ' + f(div.engineerEstimate).padStart(14);
    for (const b of div.bidders) {
      const flag = b.flagged ? '*' : ' ';
      line += '  ' + (f(b.amount) + flag).padStart(14);
    }
    out.push(line);
  }
  out.push('');
  out.push('  * = variance exceeds threshold');
  out.push('');

  // --- Scope Gaps ---
  if (report.scopeGaps.length > 0) {
    out.push('─── Scope Gaps ───');
    out.push('');
    for (const gap of report.scopeGaps) {
      out.push('  [' + gap.gapType.toUpperCase() + '] ' + gap.bidderName + ' — Div ' + gap.csiDivision + ': ' + gap.description);
      out.push('    Engineer amount: ' + f(gap.engineerAmount) + '  |  Estimated impact: ' + f(gap.estimatedImpact));
      out.push('');
    }
  }

  // --- Recommendations ---
  out.push('─── Recommendations ───');
  out.push('');
  for (const rec of report.recommendations) {
    out.push('  • ' + rec);
  }
  out.push('');

  out.push('─── End of Bid Leveling Report ───');
  return out.join('\n');
}
