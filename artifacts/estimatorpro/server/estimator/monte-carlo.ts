// server/estimator/monte-carlo.ts
//
// Monte Carlo Cost Simulation Engine
// Generates probabilistic cost ranges (P10, P25, P50, P75, P90) by running
// N iterations of the estimate with randomised rate and quantity inputs.
//
// Standards:
//   AACE RP 41R-08 — Risk Analysis and Contingency Determination
//   AACE RP 42R-08 — Risk Analysis and Contingency Determination Using Parametric Estimating
//   AACE RP 44R-08 — Risk Analysis and Contingency Determination Using Expected Value
//
// Inputs:
//   1. EstimateSummary — base estimate (mid-point)
//   2. DivisionVarianceFactor[] — per-division low/high multipliers (from rate-variants.ts)
//   3. RiskItem[] — discrete risk events with probability and impact range
//
// Algorithm:
//   For each iteration:
//     1. For each line item, sample a rate multiplier from PERT distribution
//        bounded by [divisionLow, divisionHigh]
//     2. For each risk item, sample Bernoulli(probability), if triggered
//        sample uniform(impactLow, impactHigh)
//     3. Sum to get iteration total
//   Sort iteration totals → extract percentiles
//
// The PERT distribution is used (not triangular) because it weights the most-likely
// value more heavily, which better models construction cost uncertainty.

import type { EstimateSummary, EstimateLineItem } from './estimate-engine';
import type { RiskItem } from './budget-structure';
import type { DivisionVarianceFactor } from './rate-variants';
import { getVarianceFactor, DIVISION_VARIANCE_FACTORS } from './rate-variants';

// Build a lookup map for division variance factors (used in tornado chart)
const DIVISION_VARIANCE_MAP = new Map(
  DIVISION_VARIANCE_FACTORS.map(d => [d.csiDivision, d])
);

// ─── Configuration ──────────────────────────────────────────────────────────

export interface MonteCarloConfig {
  iterations?: number;         // default 5000
  seed?: number;               // for reproducibility (simple LCG)
  confidenceLevels?: number[]; // default [10, 25, 50, 75, 90]
  includeRiskEvents?: boolean; // default true
  riskItems?: RiskItem[];
  quantityVariance?: number;   // default multiplier variance on quantities (default 0.05 = ±5%)
  /** Per-division quantity variance overrides (e.g., { '31': 0.30, '03': 0.05 }) */
  divisionQuantityVariance?: Record<string, number>;
  /** Productivity risk factor — models weather, site access, trade stacking impacts */
  productivityVariance?: {
    optimistic: number;        // e.g., 0.05 = 5% productivity gain possible
    pessimistic: number;       // e.g., 0.15 = 15% productivity loss possible
  };
}

// ─── Output ─────────────────────────────────────────────────────────────────

export interface MonteCarloResult {
  projectName: string;
  iterations: number;
  baseEstimate: number;            // Mid-point (deterministic) total
  percentiles: {
    P10: number;
    P25: number;
    P50: number;                   // Median — usually close to PERT weighted
    P75: number;
    P90: number;
  };
  customPercentiles: { level: number; value: number }[];
  mean: number;
  standardDeviation: number;
  coefficientOfVariation: number;  // σ/μ — lower is less uncertain
  skewness: number;                // positive = right-skewed (typical for cost)
  riskContribution: {
    baseVariance: number;          // $ from rate/quantity variance
    riskEventVariance: number;     // $ from discrete risk events
    totalVariance: number;
  };
  divisionSensitivity: {           // Which divisions drive the most variance
    division: string;
    divisionName: string;
    baseCost: number;
    varianceContribution: number;  // Approximate % of total variance
  }[];
  histogram: { binMin: number; binMax: number; count: number; percent: number }[];
  /** Tornado chart data — ranked list of divisions by variance contribution (top drivers) */
  tornadoChart: {
    division: string;
    divisionName: string;
    baseCost: number;
    lowImpact: number;         // Cost at pessimistic end for this division (others at mean)
    highImpact: number;        // Cost at optimistic end
    swing: number;             // |high - low| — total impact range
    variancePercent: number;   // % of total variance
    cumulativePercent: number; // Running cumulative % (for Pareto)
  }[];
  methodology: 'AACE RP 41R-08 Monte Carlo (PERT distribution)';
  generatedAt: string;
}

// ─── Pseudo-Random Number Generator (LCG — seedable, deterministic) ─────────

class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  /** Returns a number in [0, 1) */
  next(): number {
    // Linear Congruential Generator (Numerical Recipes parameters)
    this.state = (this.state * 1664525 + 1013904223) & 0x7FFFFFFF;
    return this.state / 0x7FFFFFFF;
  }
}

// ─── PERT Distribution Sampler ──────────────────────────────────────────────
//
// The PERT distribution is a re-parameterised Beta distribution.
// Given low (a), mode (m), high (b) and shape λ (default 4):
//   α = 1 + λ(m-a)/(b-a),  β = 1 + λ(b-m)/(b-a)
//   Sample from Beta(α, β), rescale to [a, b]

function samplePERT(rng: SeededRandom, low: number, mode: number, high: number, lambda: number = 4): number {
  if (high <= low) return mode;
  const range = high - low;
  const alpha = 1 + lambda * (mode - low) / range;
  const beta = 1 + lambda * (high - mode) / range;
  const u = sampleBeta(rng, alpha, beta);
  return low + u * range;
}

/**
 * Sample from Beta(α, β) using Jöhnk's algorithm for general shapes.
 * For α≥1 and β≥1 (typical in PERT with λ≥4), we use the relationship
 * Beta(α,β) = Gamma(α) / (Gamma(α) + Gamma(β)).
 */
function sampleBeta(rng: SeededRandom, alpha: number, beta: number): number {
  // Use Gamma ratio method — numerically stable for typical PERT shapes
  const x = sampleGamma(rng, alpha);
  const y = sampleGamma(rng, beta);
  return x / (x + y);
}

/**
 * Sample from Gamma(shape, 1) using Marsaglia & Tsang's method (shape ≥ 1)
 * and Ahrens-Dieter shift for shape < 1.
 */
function sampleGamma(rng: SeededRandom, shape: number): number {
  if (shape < 1) {
    // Ahrens-Dieter: Gamma(shape) = Gamma(shape+1) * U^(1/shape)
    return sampleGamma(rng, shape + 1) * Math.pow(rng.next(), 1 / shape);
  }

  // Marsaglia & Tsang (2000)
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  while (true) {
    let x: number, v: number;
    do {
      x = sampleNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = rng.next();

    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Standard normal via Box-Muller transform */
function sampleNormal(rng: SeededRandom): number {
  const u1 = rng.next();
  const u2 = rng.next();
  return Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
}

// ─── Core Simulation ────────────────────────────────────────────────────────

/**
 * Run Monte Carlo simulation on an estimate.
 * Returns full probabilistic analysis with percentiles and sensitivity data.
 */
export function runMonteCarloSimulation(
  estimate: EstimateSummary,
  config: MonteCarloConfig = {}
): MonteCarloResult {
  const iterations = config.iterations ?? 5000;
  const seed = config.seed ?? Date.now();
  const levels = config.confidenceLevels ?? [10, 25, 50, 75, 90];
  const includeRisk = config.includeRiskEvents ?? true;
  const riskItems = config.riskItems ?? [];
  const qtyVariance = config.quantityVariance ?? 0.05;

  const rng = new SeededRandom(seed);
  const baseTotal = estimate.grandTotal;

  // Flatten all line items across floors
  const allItems: { item: EstimateLineItem; variance: DivisionVarianceFactor }[] = [];
  for (const floor of estimate.floors) {
    for (const item of floor.lineItems) {
      allItems.push({ item, variance: getVarianceFactor(item.csiDivision) });
    }
  }

  // Track per-division variance contribution
  const divisionVariance = new Map<string, { name: string; baseCost: number; squaredDiffs: number }>();
  for (const { item, variance: _variance } of allItems) {
    const key = item.csiDivision;
    const existing = divisionVariance.get(key);
    if (existing) {
      existing.baseCost += item.totalCost;
    } else {
      divisionVariance.set(key, {
        name: item.csiDivisionName,
        baseCost: item.totalCost,
        squaredDiffs: 0,
      });
    }
  }

  // Run iterations — track base-only totals separately for proper variance decomposition
  const results: number[] = new Array(iterations);
  const baseOnlyResults: number[] = new Array(iterations);

  for (let i = 0; i < iterations; i++) {
    let iterTotal = 0;
    const divIterTotals = new Map<string, number>();

    // 1. Vary each line item using PERT distribution
    for (const { item, variance } of allItems) {
      const low = variance.lowFactor;
      const high = variance.highFactor;
      const mode = 1.0; // base rate = most likely

      const rateFactor = samplePERT(rng, low, mode, high);

      // Per-division quantity variance (default ±qtyVariance uniform)
      const divQtyVariance = (config.divisionQuantityVariance?.[item.csiDivision]) ?? qtyVariance;
      const qtyFactor = samplePERT(rng, 1 - divQtyVariance, 1.0, 1 + divQtyVariance);

      // Productivity risk factor (if enabled)
      let prodFactor = 1.0;
      if (config.productivityVariance) {
        const pv = config.productivityVariance;
        prodFactor = samplePERT(rng, 1 - pv.pessimistic, 1.0, 1 + pv.optimistic);
      }

      const iterCost = item.totalCost * rateFactor * qtyFactor * prodFactor;
      iterTotal += iterCost;

      // Track division totals for sensitivity
      const div = item.csiDivision;
      divIterTotals.set(div, (divIterTotals.get(div) || 0) + iterCost);
    }

    // Track base-only result (before risk events) for variance decomposition
    baseOnlyResults[i] = iterTotal;

    // 2. Add discrete risk events (Bernoulli trigger, uniform impact)
    if (includeRisk && riskItems.length > 0) {
      for (const risk of riskItems) {
        if (rng.next() < risk.probability) {
          const impact = risk.impactLow + rng.next() * (risk.impactHigh - risk.impactLow);
          iterTotal += impact;
        }
      }
    }

    results[i] = iterTotal;

    // Accumulate squared diffs for division sensitivity
    for (const [div, iterDivTotal] of divIterTotals) {
      const d = divisionVariance.get(div);
      if (d) {
        const diff = iterDivTotal - d.baseCost;
        d.squaredDiffs += diff * diff;
      }
    }
  }

  // Sort results for percentile extraction
  results.sort((a, b) => a - b);

  // --- Statistics ---
  const mean = results.reduce((s, v) => s + v, 0) / iterations;
  const sumSqDiff = results.reduce((s, v) => s + (v - mean) ** 2, 0);
  const stdDev = iterations > 1 ? Math.sqrt(sumSqDiff / (iterations - 1)) : 0;
  const cv = mean > 0 ? stdDev / mean : 0;

  // Skewness (Fisher's)
  const m3 = stdDev > 0 ? results.reduce((s, v) => s + ((v - mean) / stdDev) ** 3, 0) / iterations : 0;
  const skewness = m3;

  // --- Percentiles ---
  function percentile(p: number): number {
    const idx = Math.floor((p / 100) * (iterations - 1));
    return results[Math.min(idx, iterations - 1)];
  }

  const percentiles = {
    P10: percentile(10),
    P25: percentile(25),
    P50: percentile(50),
    P75: percentile(75),
    P90: percentile(90),
  };

  const customPercentiles = levels
    .filter(l => ![10, 25, 50, 75, 90].includes(l))
    .map(l => ({ level: l, value: percentile(l) }));

  // --- Risk variance decomposition (dual-run method) ---
  // Proper decomposition: compute variance of base-only runs and total runs separately
  const baseMean = baseOnlyResults.reduce((s, v) => s + v, 0) / iterations;
  const baseSumSqDiff = baseOnlyResults.reduce((s, v) => s + (v - baseMean) ** 2, 0);
  const baseVarianceCalc = iterations > 1 ? baseSumSqDiff / (iterations - 1) : 0;
  const totalVarianceCalc = stdDev * stdDev;
  const riskEventVarianceCalc = Math.max(0, totalVarianceCalc - baseVarianceCalc);

  // --- Division sensitivity ---
  const totalSquaredDiffs = Array.from(divisionVariance.values()).reduce((s, d) => s + d.squaredDiffs, 0);
  const divisionSensitivity = Array.from(divisionVariance.entries())
    .map(([div, d]) => ({
      division: div,
      divisionName: d.name,
      baseCost: d.baseCost,
      varianceContribution: totalSquaredDiffs > 0
        ? (d.squaredDiffs / totalSquaredDiffs) * 100
        : 0,
    }))
    .sort((a, b) => b.varianceContribution - a.varianceContribution);

  // --- Histogram (20 bins) ---
  const binCount = 20;
  const minResult = results[0];
  const maxResult = results[iterations - 1];
  const binWidth = (maxResult - minResult) / binCount || 1;
  const histogram: MonteCarloResult['histogram'] = [];

  for (let b = 0; b < binCount; b++) {
    const binMin = minResult + b * binWidth;
    const binMax = binMin + binWidth;
    const count = results.filter(v => v >= binMin && (b === binCount - 1 ? v <= binMax : v < binMax)).length;
    histogram.push({
      binMin,
      binMax,
      count,
      percent: (count / iterations) * 100,
    });
  }

  // --- Tornado chart (sensitivity ranking by swing) ---
  const tornadoChart = divisionSensitivity.map(d => {
    const dv = divisionVariance.get(d.division);
    const baseCost = dv?.baseCost ?? 0;
    const factor = DIVISION_VARIANCE_MAP.get(d.division);
    const lowFactor = factor?.lowFactor ?? 0.90;
    const highFactor = factor?.highFactor ?? 1.15;
    const lowImpact = baseCost * lowFactor;
    const highImpact = baseCost * highFactor;
    return {
      division: d.division,
      divisionName: d.divisionName,
      baseCost,
      lowImpact,
      highImpact,
      swing: highImpact - lowImpact,
      variancePercent: d.varianceContribution,
      cumulativePercent: 0, // computed below
    };
  }).sort((a, b) => b.swing - a.swing);

  // Compute cumulative Pareto percentages
  const totalSwing = tornadoChart.reduce((s, t) => s + t.swing, 0);
  let cumulative = 0;
  for (const t of tornadoChart) {
    t.variancePercent = totalSwing > 0 ? (t.swing / totalSwing) * 100 : 0;
    cumulative += t.variancePercent;
    t.cumulativePercent = cumulative;
  }

  return {
    projectName: 'Monte Carlo Simulation',
    iterations,
    baseEstimate: baseTotal,
    percentiles,
    customPercentiles,
    mean,
    standardDeviation: stdDev,
    coefficientOfVariation: cv,
    skewness,
    riskContribution: {
      baseVariance: baseVarianceCalc,
      riskEventVariance: riskEventVarianceCalc,
      totalVariance: totalVarianceCalc,
    },
    divisionSensitivity,
    histogram,
    tornadoChart,
    methodology: 'AACE RP 41R-08 Monte Carlo (PERT distribution)',
    generatedAt: new Date().toISOString(),
  };
}

// ─── Report Formatter ───────────────────────────────────────────────────────

export function formatMonteCarloReport(result: MonteCarloResult): string {
  const out: string[] = [];
  const f = (n: number) => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const pct = (n: number) => n.toFixed(1) + '%';

  out.push('═══════════════════════════════════════════════════════════════');
  out.push('  MONTE CARLO COST SIMULATION REPORT');
  out.push('  Methodology: ' + result.methodology);
  out.push('  Iterations: ' + result.iterations.toLocaleString());
  out.push('  Generated: ' + result.generatedAt);
  out.push('═══════════════════════════════════════════════════════════════');
  out.push('');

  // --- Key Metrics ---
  out.push('─── Probabilistic Cost Summary ───');
  out.push('');
  out.push('  Base Estimate (deterministic):  ' + f(result.baseEstimate));
  out.push('');
  out.push('  P10  (optimistic):              ' + f(result.percentiles.P10));
  out.push('  P25  (low expected):            ' + f(result.percentiles.P25));
  out.push('  P50  (median):                  ' + f(result.percentiles.P50));
  out.push('  P75  (high expected):           ' + f(result.percentiles.P75));
  out.push('  P90  (pessimistic):             ' + f(result.percentiles.P90));
  out.push('');
  out.push('  Mean:                           ' + f(result.mean));
  out.push('  Standard Deviation:             ' + f(result.standardDeviation));
  out.push('  Coefficient of Variation:       ' + pct(result.coefficientOfVariation * 100));
  out.push('  Skewness:                       ' + result.skewness.toFixed(3));
  out.push('');

  // --- Range ---
  const range = result.percentiles.P90 - result.percentiles.P10;
  const rangePct = result.baseEstimate > 0 ? (range / result.baseEstimate * 100) : 0;
  out.push('  80% Confidence Range (P10–P90): ' + f(range) + ' (' + pct(rangePct) + ' of base)');
  out.push('');

  // --- Risk Decomposition ---
  out.push('─── Variance Decomposition ───');
  out.push('');
  const totalVar = result.riskContribution.totalVariance;
  if (totalVar > 0) {
    const basePct = (result.riskContribution.baseVariance / totalVar * 100).toFixed(1);
    const riskPct = (result.riskContribution.riskEventVariance / totalVar * 100).toFixed(1);
    out.push('  Rate/Quantity Variance:  ' + basePct + '%');
    out.push('  Discrete Risk Events:   ' + riskPct + '%');
  }
  out.push('');

  // --- Division Sensitivity (top 10) ---
  out.push('─── Division Sensitivity (Top 10 Variance Contributors) ───');
  out.push('');
  out.push('  Div   Division Name                      Base Cost      Variance %');
  out.push('  ───   ─────────────                      ─────────      ──────────');
  const top10 = result.divisionSensitivity.slice(0, 10);
  for (const d of top10) {
    out.push('  ' + d.division.padEnd(6) + d.divisionName.padEnd(35) + f(d.baseCost).padStart(14) + '     ' + pct(d.varianceContribution).padStart(8));
  }
  out.push('');

  // --- Histogram (text-based) ---
  out.push('─── Cost Distribution Histogram ───');
  out.push('');
  const maxCount = Math.max(...result.histogram.map(h => h.count));
  const barScale = 40; // max bar width
  for (const bin of result.histogram) {
    const barLen = maxCount > 0 ? Math.round((bin.count / maxCount) * barScale) : 0;
    const bar = '█'.repeat(barLen);
    const label = f(bin.binMin).padStart(14) + ' – ' + f(bin.binMax).padStart(14);
    const countStr = String(bin.count).padStart(5);
    out.push('  ' + label + ' │' + bar + ' ' + countStr + ' (' + bin.percent.toFixed(1) + '%)');
  }
  out.push('');

  // --- Tornado Chart (Sensitivity) ---
  if (result.tornadoChart.length > 0) {
    out.push('─── Sensitivity Tornado Chart (Top Variance Drivers) ───');
    out.push('');
    out.push('  Div   Division Name                      Swing          Var%    Cum%');
    out.push('  ───   ─────────────                      ─────          ────    ────');
    const top = result.tornadoChart.slice(0, 10);
    const maxSwing = Math.max(...top.map(t => t.swing));
    for (const t of top) {
      const barLen = maxSwing > 0 ? Math.round((t.swing / maxSwing) * 25) : 0;
      const bar = '█'.repeat(barLen);
      out.push('  ' + t.division.padEnd(6) + t.divisionName.padEnd(35) +
        f(t.swing).padStart(14) + '  ' +
        pct(t.variancePercent).padStart(6) + '  ' +
        pct(t.cumulativePercent).padStart(6));
      out.push('  ' + ' '.repeat(6) + bar);
    }
    out.push('');
  }

  // --- Recommendation ---
  out.push('─── Recommendation ───');
  out.push('');
  out.push('  Budget at P50 (median):              ' + f(result.percentiles.P50));
  out.push('  Budget at P75 (recommended):         ' + f(result.percentiles.P75));
  out.push('  Budget at P90 (conservative):        ' + f(result.percentiles.P90));
  out.push('');
  out.push('  AACE RP 41R-08 recommends budgeting at P50–P75 for normal risk');
  out.push('  tolerance, or P80–P90 for risk-averse clients/public sector.');
  out.push('');
  out.push('─── End of Monte Carlo Report ───');

  return out.join('\n');
}
