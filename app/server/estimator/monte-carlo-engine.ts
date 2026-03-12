// server/estimator/monte-carlo-engine.ts
// =============================================================================
// MONTE CARLO RANGE ESTIMATING ENGINE
// =============================================================================
//
// Closes QS Level 5 gap:
//   5.4  Range Estimating / Monte Carlo (low/likely/high per line item,
//        P50/P80/P90 confidence, risk-adjusted contingency)
//
// Method: Triangular distribution per AACE RP 41R-08
// Each line item gets low/likely/high estimates → simulation produces
// probability distribution of total project cost.
//
// Consumes: EstimateSummary from estimate-engine.ts, RiskItem from budget-structure.ts
// Consumed by: budget-structure.ts (contingency derivation), qs-level5-routes.ts
// =============================================================================

import type { EstimateSummary, EstimateLineItem } from './estimate-engine';


// ─── TYPES ──────────────────────────────────────────────────────────────────

export interface RangeEstimate {
  lineItemCode: string;
  description: string;
  floor: string;
  baseCost: number;          // from estimate engine
  lowMultiplier: number;     // e.g., 0.85 = -15% of base
  likelyMultiplier: number;  // e.g., 1.00 = base cost
  highMultiplier: number;    // e.g., 1.25 = +25% of base
  lowCost: number;
  likelyCost: number;
  highCost: number;
}

export interface SimulationConfig {
  projectId: string;
  iterations: number;        // typically 5000-10000
  seed?: number;             // for reproducibility
  confidenceLevels: number[];// e.g., [50, 80, 90, 95]
  rangeOverrides?: Record<string, { low: number; likely: number; high: number }>;
}

export interface HistogramBin {
  rangeStart: number;
  rangeEnd: number;
  count: number;
  percentage: number;
}

export interface ConfidenceResult {
  percentile: number;        // e.g., 50, 80, 90
  value: number;             // $ at this percentile
  contingencyFromBase: number;
  contingencyPercent: number;
}

export interface MonteCarloResult {
  projectId: string;
  iterations: number;
  baseEstimate: number;      // deterministic base from estimate engine
  mean: number;
  standardDeviation: number;
  minimum: number;
  maximum: number;
  confidenceLevels: ConfidenceResult[];
  histogram: HistogramBin[];
  rangeEstimates: RangeEstimate[];
  recommendedContingency: number;    // P80 - base
  recommendedContingencyPercent: number;
  generatedAt: string;
}


// ─── DEFAULT RANGE FACTORS BY CSI DIVISION ──────────────────────────────────
// Based on AACE RP 41R-08 typical ranges for Class 3-5 estimates

const DEFAULT_RANGES: Record<string, { low: number; high: number }> = {
  '01': { low: 0.90, high: 1.15 },  // General: relatively predictable
  '02': { low: 0.80, high: 1.30 },  // Existing Conditions: high uncertainty
  '03': { low: 0.90, high: 1.20 },  // Concrete: established rates
  '04': { low: 0.90, high: 1.20 },  // Masonry
  '05': { low: 0.85, high: 1.25 },  // Metals: market volatility
  '06': { low: 0.88, high: 1.18 },  // Wood: material price fluctuation
  '07': { low: 0.88, high: 1.22 },  // Envelope
  '08': { low: 0.85, high: 1.20 },  // Openings: specialty items
  '09': { low: 0.90, high: 1.15 },  // Finishes: well-established
  '10': { low: 0.85, high: 1.25 },  // Specialties: wide range
  '11': { low: 0.80, high: 1.35 },  // Equipment: vendor-dependent
  '12': { low: 0.80, high: 1.30 },  // Furnishings: allowance-heavy
  '13': { low: 0.75, high: 1.40 },  // Special Construction: highest uncertainty
  '14': { low: 0.90, high: 1.15 },  // Elevators: fixed-price contracts
  '21': { low: 0.90, high: 1.15 },  // Fire Suppression: regulated
  '22': { low: 0.88, high: 1.18 },  // Plumbing
  '23': { low: 0.85, high: 1.25 },  // HVAC: equipment complexity
  '25': { low: 0.85, high: 1.25 },  // Automation
  '26': { low: 0.88, high: 1.20 },  // Electrical
  '27': { low: 0.85, high: 1.20 },  // Communications
  '28': { low: 0.85, high: 1.25 },  // Security
  '31': { low: 0.80, high: 1.35 },  // Earthwork: soil conditions
  '32': { low: 0.85, high: 1.25 },  // Site Improvements
  '33': { low: 0.80, high: 1.30 },  // Utilities: unknown underground
  '34': { low: 0.85, high: 1.25 },  // Transportation
  '35': { low: 0.75, high: 1.40 },  // Marine: high risk
};
const DEFAULT_RANGE = { low: 0.85, high: 1.25 };


// ─── RANDOM NUMBER GENERATION (Mulberry32 PRNG for reproducibility) ─────────

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


// ─── TRIANGULAR DISTRIBUTION SAMPLING ───────────────────────────────────────

function sampleTriangular(low: number, likely: number, high: number, rand: () => number): number {
  if (low >= high) return likely;
  const u = rand();
  const fc = (likely - low) / (high - low);

  if (u < fc) {
    return low + Math.sqrt(u * (high - low) * (likely - low));
  } else {
    return high - Math.sqrt((1 - u) * (high - low) * (high - likely));
  }
}


// ─── BUILD RANGE ESTIMATES ──────────────────────────────────────────────────

export function buildRangeEstimates(
  estimate: EstimateSummary,
  overrides?: Record<string, { low: number; likely: number; high: number }>,
): RangeEstimate[] {
  const allItems = estimate.floors.flatMap(f => f.lineItems);
  return allItems.map(item => {
    const override = overrides?.[item.csiCode];
    const divRange = DEFAULT_RANGES[item.csiDivision] ?? DEFAULT_RANGE;

    const lowMult = override?.low ?? divRange.low;
    const likelyMult = override?.likely ?? 1.0;
    const highMult = override?.high ?? divRange.high;

    return {
      lineItemCode: item.csiCode,
      description: item.description,
      floor: item.floor,
      baseCost: item.totalCost,
      lowMultiplier: lowMult,
      likelyMultiplier: likelyMult,
      highMultiplier: highMult,
      lowCost: Math.round(item.totalCost * lowMult * 100) / 100,
      likelyCost: Math.round(item.totalCost * likelyMult * 100) / 100,
      highCost: Math.round(item.totalCost * highMult * 100) / 100,
    };
  });
}


// ─── RUN MONTE CARLO SIMULATION ─────────────────────────────────────────────

export function runMonteCarloSimulation(
  estimate: EstimateSummary,
  config: SimulationConfig,
): MonteCarloResult {
  const ranges = buildRangeEstimates(estimate, config.rangeOverrides);
  const iterations = Math.max(1000, Math.min(config.iterations, 50000));
  const rand = mulberry32(config.seed ?? Date.now());

  // Run simulation
  const totals: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    let total = 0;
    for (const range of ranges) {
      total += sampleTriangular(range.lowCost, range.likelyCost, range.highCost, rand);
    }
    totals[i] = total;
  }

  // Sort for percentile calculation
  totals.sort((a, b) => a - b);

  const mean = totals.reduce((s, v) => s + v, 0) / iterations;
  const variance = totals.reduce((s, v) => s + (v - mean) ** 2, 0) / iterations;
  const stdDev = Math.sqrt(variance);

  // Confidence levels
  const confidenceLevels: ConfidenceResult[] = (config.confidenceLevels ?? [50, 80, 90, 95]).map(p => {
    const idx = Math.min(Math.floor((p / 100) * iterations), iterations - 1);
    const value = totals[idx];
    return {
      percentile: p,
      value: Math.round(value * 100) / 100,
      contingencyFromBase: Math.round((value - estimate.grandTotal) * 100) / 100,
      contingencyPercent: estimate.grandTotal > 0
        ? Math.round(((value - estimate.grandTotal) / estimate.grandTotal) * 10000) / 100
        : 0,
    };
  });

  // Histogram (20 bins)
  const min = totals[0];
  const max = totals[iterations - 1];
  const binCount = 20;
  const binWidth = (max - min) / binCount;
  const histogram: HistogramBin[] = [];

  for (let b = 0; b < binCount; b++) {
    const rangeStart = min + b * binWidth;
    const rangeEnd = b === binCount - 1 ? max + 1 : min + (b + 1) * binWidth;
    const count = totals.filter(v => v >= rangeStart && v < rangeEnd).length;
    histogram.push({
      rangeStart: Math.round(rangeStart * 100) / 100,
      rangeEnd: Math.round(rangeEnd * 100) / 100,
      count,
      percentage: Math.round((count / iterations) * 10000) / 100,
    });
  }

  // P80 as recommended contingency target
  const p80 = confidenceLevels.find(c => c.percentile === 80);
  const recContingency = p80 ? p80.contingencyFromBase : 0;

  return {
    projectId: config.projectId,
    iterations,
    baseEstimate: Math.round(estimate.grandTotal * 100) / 100,
    mean: Math.round(mean * 100) / 100,
    standardDeviation: Math.round(stdDev * 100) / 100,
    minimum: Math.round(min * 100) / 100,
    maximum: Math.round(max * 100) / 100,
    confidenceLevels,
    histogram,
    rangeEstimates: ranges,
    recommendedContingency: Math.round(Math.max(recContingency, 0) * 100) / 100,
    recommendedContingencyPercent: estimate.grandTotal > 0
      ? Math.round((Math.max(recContingency, 0) / estimate.grandTotal) * 10000) / 100
      : 0,
    generatedAt: new Date().toISOString(),
  };
}


// ─── IN-MEMORY STORAGE ──────────────────────────────────────────────────────

const resultStore = new Map<string, MonteCarloResult>();

export function storeResult(result: MonteCarloResult): MonteCarloResult {
  resultStore.set(result.projectId, result);
  return result;
}
export function getResult(projectId: string): MonteCarloResult | undefined {
  return resultStore.get(projectId);
}
export function deleteResult(projectId: string): boolean {
  return resultStore.delete(projectId);
}
