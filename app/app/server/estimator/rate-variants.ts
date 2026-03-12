// server/estimator/rate-variants.ts
// =============================================================================
// RATE VARIANTS — HIGH / MID / LOW ESTIMATION
// =============================================================================
//
// Master Priority Item #24
//
// Purpose:
//   1. Generate three-point estimate variants (optimistic/most likely/pessimistic)
//   2. Apply variance factors by CSI division (some divisions more volatile)
//   3. Calculate expected value using PERT/weighted average
//   4. Quantify estimate range (spread) and confidence
//   5. Support AACE Class 1-5 accuracy ranges
//   6. Feed into risk analysis and contingency calculation
//
// Three-Point Method: PERT = (Low + 4×Mid + High) / 6
// Standard Deviation: σ = (High - Low) / 6
//
// Standards: AACE RP 18R-97, CIQS estimating practices
// =============================================================================

import type { EstimateSummary, EstimateLineItem } from './estimate-engine';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface DivisionVarianceFactor {
  csiDivision: string;
  divisionName: string;
  lowFactor: number;               // Multiplier for optimistic (e.g., 0.85)
  highFactor: number;              // Multiplier for pessimistic (e.g., 1.25)
  volatility: 'low' | 'medium' | 'high';  // How variable is this division typically
  notes?: string;
}

export interface RateVariantLineItem {
  csiDivision: string;
  csiSubdivision: string;
  description: string;
  unit: string;
  quantity: number;
  midRate: number;                 // Most likely (from estimate engine)
  lowRate: number;                 // Optimistic
  highRate: number;                // Pessimistic
  midCost: number;
  lowCost: number;
  highCost: number;
  pertCost: number;                // PERT weighted: (L + 4M + H) / 6
  standardDeviation: number;       // (H - L) / 6
}

export interface RateVariantSummary {
  projectName: string;
  lowTotal: number;                // Optimistic total
  midTotal: number;                // Most likely total
  highTotal: number;               // Pessimistic total
  pertTotal: number;               // PERT weighted total
  estimateRange: number;           // High - Low
  estimateRangePercent: number;    // (High - Low) / Mid * 100
  standardDeviation: number;       // Project-level σ
  confidenceInterval68: { low: number; high: number }; // PERT ± 1σ (68% CI)
  confidenceInterval95: { low: number; high: number }; // PERT ± 2σ (95% CI)
  lineItems: RateVariantLineItem[];
  divisionSummary: {
    division: string;
    divisionName: string;
    lowCost: number;
    midCost: number;
    highCost: number;
    pertCost: number;
    spread: number;
  }[];
  aaceClassRange?: string;         // e.g., "Class 3: -10% to +15%"
  generatedAt: string;
}

// ─── Division Variance Factors ───────────────────────────────────────────────
// Based on historical project data — how much do rates typically vary?

const DIVISION_VARIANCE: DivisionVarianceFactor[] = [
  { csiDivision: '02', divisionName: 'Existing Conditions', lowFactor: 0.80, highFactor: 1.40, volatility: 'high', notes: 'Demolition/hazmat highly variable' },
  { csiDivision: '03', divisionName: 'Concrete', lowFactor: 0.90, highFactor: 1.15, volatility: 'medium', notes: 'Material stable, labor moderate' },
  { csiDivision: '04', divisionName: 'Masonry', lowFactor: 0.88, highFactor: 1.18, volatility: 'medium', notes: 'Labor intensive, productivity varies' },
  { csiDivision: '05', divisionName: 'Metals', lowFactor: 0.85, highFactor: 1.25, volatility: 'high', notes: 'Steel pricing volatile, fabrication lead times' },
  { csiDivision: '06', divisionName: 'Wood/Plastics/Composites', lowFactor: 0.88, highFactor: 1.20, volatility: 'medium', notes: 'Lumber pricing cycles' },
  { csiDivision: '07', divisionName: 'Thermal & Moisture', lowFactor: 0.90, highFactor: 1.15, volatility: 'low', notes: 'Relatively stable' },
  { csiDivision: '08', divisionName: 'Openings', lowFactor: 0.88, highFactor: 1.20, volatility: 'medium', notes: 'Custom sizes add variance' },
  { csiDivision: '09', divisionName: 'Finishes', lowFactor: 0.85, highFactor: 1.25, volatility: 'high', notes: 'Specification-dependent, wide range' },
  { csiDivision: '10', divisionName: 'Specialties', lowFactor: 0.90, highFactor: 1.15, volatility: 'low' },
  { csiDivision: '11', divisionName: 'Equipment', lowFactor: 0.85, highFactor: 1.30, volatility: 'high', notes: 'Specialty equipment, long lead' },
  { csiDivision: '12', divisionName: 'Furnishings', lowFactor: 0.85, highFactor: 1.25, volatility: 'medium' },
  { csiDivision: '14', divisionName: 'Conveying Equipment', lowFactor: 0.92, highFactor: 1.12, volatility: 'low', notes: 'Manufacturer-quoted, stable' },
  { csiDivision: '21', divisionName: 'Fire Suppression', lowFactor: 0.90, highFactor: 1.15, volatility: 'low' },
  { csiDivision: '22', divisionName: 'Plumbing', lowFactor: 0.88, highFactor: 1.18, volatility: 'medium' },
  { csiDivision: '23', divisionName: 'HVAC', lowFactor: 0.85, highFactor: 1.25, volatility: 'high', notes: 'Equipment + controls variance' },
  { csiDivision: '26', divisionName: 'Electrical', lowFactor: 0.88, highFactor: 1.20, volatility: 'medium', notes: 'Copper pricing, conduit labor' },
  { csiDivision: '27', divisionName: 'Communications', lowFactor: 0.85, highFactor: 1.25, volatility: 'medium' },
  { csiDivision: '28', divisionName: 'Electronic Safety', lowFactor: 0.88, highFactor: 1.20, volatility: 'medium' },
  { csiDivision: '31', divisionName: 'Earthwork', lowFactor: 0.75, highFactor: 1.50, volatility: 'high', notes: 'Geotechnical surprises, rock, water' },
  { csiDivision: '32', divisionName: 'Exterior Improvements', lowFactor: 0.88, highFactor: 1.20, volatility: 'medium' },
  { csiDivision: '33', divisionName: 'Utilities', lowFactor: 0.80, highFactor: 1.35, volatility: 'high', notes: 'Underground conditions vary' },
];

// ─── Core Calculation ────────────────────────────────────────────────────────

/**
 * Get variance factor for a CSI division. Returns default if not found.
 */
export function getVarianceFactor(csiDivision: string): DivisionVarianceFactor {
  const found = DIVISION_VARIANCE.find(d => d.csiDivision === csiDivision);
  return found || {
    csiDivision,
    divisionName: 'Division ' + csiDivision,
    lowFactor: 0.90,
    highFactor: 1.15,
    volatility: 'medium' as const,
  };
}

/**
 * Generate three-point estimate variants for an entire estimate.
 */
export function generateRateVariants(
  estimate: EstimateSummary,
  customVariance?: DivisionVarianceFactor[]
): RateVariantSummary {
  const varianceFactors = customVariance || DIVISION_VARIANCE;
  const factorMap = new Map<string, DivisionVarianceFactor>();
  for (const vf of varianceFactors) factorMap.set(vf.csiDivision, vf);

  const lineItems: RateVariantLineItem[] = [];
  let lowTotal = 0;
  let midTotal = 0;
  let highTotal = 0;

  // Division aggregation
  const divAgg = new Map<string, { low: number; mid: number; high: number; name: string }>();

  for (const floor of estimate.floors) {
    for (const item of floor.lineItems) {
      const factor = getVarianceFactor(item.csiDivision);
      const lowRate = item.totalRate * factor.lowFactor;
      const highRate = item.totalRate * factor.highFactor;
      // Use item.quantity (includes waste) for all three variants — same basis as mid (totalCost)
      const lowCost = item.quantity * lowRate;
      const highCost = item.quantity * highRate;
      const pertCost = (lowCost + 4 * item.totalCost + highCost) / 6;
      const stdDev = (highCost - lowCost) / 6;

      lineItems.push({
        csiDivision: item.csiDivision,
        csiSubdivision: item.csiSubdivision,
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        midRate: item.totalRate,
        lowRate: Math.round(lowRate * 100) / 100,
        highRate: Math.round(highRate * 100) / 100,
        midCost: item.totalCost,
        lowCost: Math.round(lowCost * 100) / 100,
        highCost: Math.round(highCost * 100) / 100,
        pertCost: Math.round(pertCost * 100) / 100,
        standardDeviation: Math.round(stdDev * 100) / 100,
      });

      lowTotal += lowCost;
      midTotal += item.totalCost;
      highTotal += highCost;

      // Division aggregation
      if (!divAgg.has(item.csiDivision)) {
        divAgg.set(item.csiDivision, { low: 0, mid: 0, high: 0, name: factor.divisionName });
      }
      const da = divAgg.get(item.csiDivision)!;
      da.low += lowCost;
      da.mid += item.totalCost;
      da.high += highCost;
    }
  }

  const pertTotal = (lowTotal + 4 * midTotal + highTotal) / 6;
  const projectStdDev = (highTotal - lowTotal) / 6;

  const divisionSummary = Array.from(divAgg.entries())
    .map(([div, agg]) => ({
      division: div,
      divisionName: agg.name,
      lowCost: Math.round(agg.low * 100) / 100,
      midCost: Math.round(agg.mid * 100) / 100,
      highCost: Math.round(agg.high * 100) / 100,
      pertCost: Math.round((agg.low + 4 * agg.mid + agg.high) / 6 * 100) / 100,
      spread: Math.round((agg.high - agg.low) * 100) / 100,
    }))
    .sort((a, b) => b.spread - a.spread);

  return {
    projectName: '',  // EstimateSummary does not carry project name
    lowTotal: Math.round(lowTotal * 100) / 100,
    midTotal: Math.round(midTotal * 100) / 100,
    highTotal: Math.round(highTotal * 100) / 100,
    pertTotal: Math.round(pertTotal * 100) / 100,
    estimateRange: Math.round((highTotal - lowTotal) * 100) / 100,
    estimateRangePercent: midTotal > 0 ? Math.round(((highTotal - lowTotal) / midTotal) * 10000) / 100 : 0,
    standardDeviation: Math.round(projectStdDev * 100) / 100,
    confidenceInterval68: {
      low: Math.round((pertTotal - projectStdDev) * 100) / 100,
      high: Math.round((pertTotal + projectStdDev) * 100) / 100,
    },
    confidenceInterval95: {
      low: Math.round((pertTotal - 2 * projectStdDev) * 100) / 100,
      high: Math.round((pertTotal + 2 * projectStdDev) * 100) / 100,
    },
    lineItems,
    divisionSummary,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Format rate variant summary as report.
 */
export function formatRateVariantReport(summary: RateVariantSummary): string {
  const f = (n: number) => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const out: string[] = [];

  out.push('====================================================================');
  out.push('  THREE-POINT ESTIMATE ANALYSIS');
  out.push('  Project: ' + summary.projectName);
  out.push('====================================================================');
  out.push('');
  out.push('  Low (optimistic):    ' + f(summary.lowTotal));
  out.push('  Mid (most likely):   ' + f(summary.midTotal));
  out.push('  High (pessimistic):  ' + f(summary.highTotal));
  out.push('  PERT expected:       ' + f(summary.pertTotal));
  out.push('');
  out.push('  Range: ' + f(summary.estimateRange) + ' (' + summary.estimateRangePercent.toFixed(1) + '% of mid)');
  out.push('  Std deviation: ' + f(summary.standardDeviation));
  out.push('  68% confidence: ' + f(summary.confidenceInterval68.low) + ' to ' + f(summary.confidenceInterval68.high));
  out.push('  95% confidence: ' + f(summary.confidenceInterval95.low) + ' to ' + f(summary.confidenceInterval95.high));
  out.push('');

  out.push('  ── Division Spread (largest variance first) ──');
  for (const d of summary.divisionSummary.slice(0, 10)) {
    out.push('  Div ' + d.division + ' ' + d.divisionName);
    out.push('    Low: ' + f(d.lowCost) + ' | Mid: ' + f(d.midCost) + ' | High: ' + f(d.highCost) + ' | Spread: ' + f(d.spread));
  }

  out.push('');
  out.push('====================================================================');
  return out.join('\n');
}

/** Pre-populated division variance factors */
export const DIVISION_VARIANCE_FACTORS = DIVISION_VARIANCE;
