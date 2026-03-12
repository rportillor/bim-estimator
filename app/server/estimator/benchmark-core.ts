// server/estimator/benchmark-core.ts
// =============================================================================
// BENCHMARK & VALIDATION ENGINE — CORE (Category-Agnostic)
// =============================================================================
//
// Implements QS Level 5 Phase 7: Validation & Quality Assurance
//
// Architecture:
//   This is the CORE validation engine. It is project-category-agnostic.
//   Actual benchmark data lives in separate BENCHMARK PACKS:
//     - benchmark-pack-building.ts     (46 building types, $/m² GFA)
//     - benchmark-pack-civil.ts        (roads, bridges, earthworks)
//     - benchmark-pack-pipeline.ts     (water, sewer, gas, electrical)
//     - benchmark-pack-infrastructure.ts (transit, treatment, power)
//     - benchmark-pack-mining.ts       (processing, camps, tailings)
//
//   Each pack is a self-contained, licensable module that registers with
//   this core engine via the BenchmarkPack interface.
//
// Standards: CIQS, AACE, RSMeans Canadian
// =============================================================================

import type { EstimateSummary } from './estimate-engine';
import type { BudgetStructure } from './budget-structure';

// ─── Core Interfaces (the CONTRACT for all benchmark packs) ──────────────────

/**
 * Project category — each maps to a separate licensable benchmark pack.
 */
export type ProjectCategory = 'building' | 'civil' | 'pipeline' | 'infrastructure' | 'mining';

/**
 * How the project is measured for benchmarking purposes.
 * Buildings use $/m² GFA. Civil uses $/lane-km or $/m³. Pipelines use $/linear m.
 * The core engine doesn't care — it uses whatever metric the pack provides.
 */
export type BenchmarkMetric =
  | 'cost-per-m2-gfa'          // Buildings: $/m² gross floor area
  | 'cost-per-m2-footprint'    // Single-storey: $/m² building footprint
  | 'cost-per-linear-m'        // Pipelines, tunnels: $/linear metre
  | 'cost-per-lane-km'         // Roads: $/lane-kilometre
  | 'cost-per-m3'              // Earthworks, reservoirs: $/m³
  | 'cost-per-unit'            // Utilities: $/lot, $/connection
  | 'cost-per-hectare'         // Landscaping, land development: $/hectare
  | 'cost-per-tonne'           // Mining/processing: $/tonne capacity
  | 'cost-per-mw'              // Power: $/MW installed capacity
  | 'cost-per-mld'             // Water treatment: $/megalitres per day
  | 'lump-sum';                // Unique projects: total cost range only

/**
 * A single benchmark range for one project type.
 * The measurement unit and metric are set at the pack level.
 */
export interface BenchmarkRange {
  projectType: string;        // Unique key within the pack (e.g., 'residential-midrise')
  typeName: string;           // Human-readable name
  costLow: number;            // Low end of range (in the pack's metric)
  costMid: number;            // Median
  costHigh: number;           // High end
  source: string;             // Data source citation
  year: number;               // Price level year
  notes?: string;             // Additional context
}

/**
 * Expected CSI divisions for a project type.
 * Used by the completeness check.
 */
export interface ExpectedDivisions {
  projectType: string;
  divisions: string[];         // CSI division codes expected
}

/**
 * Division proportion benchmark — what % of direct cost is normal for each division.
 */
export interface DivisionProportion {
  division: string;
  divisionName: string;
  expectedPercentLow: number;
  expectedPercentHigh: number;
}

/**
 * THE BENCHMARK PACK INTERFACE — the contract every pack must implement.
 * This is what makes each pack a separately licensable module.
 */
export interface BenchmarkPack {
  category: ProjectCategory;
  categoryName: string;           // e.g., "Building Construction"
  version: string;                // Pack version for licensing
  metric: BenchmarkMetric;        // How this category measures cost
  metricLabel: string;            // e.g., "$/m² GFA", "$/lane-km"
  measurementUnit: string;        // e.g., "m²", "lane-km", "linear m"
  projectTypes: string[];         // All project type keys in this pack
  benchmarks: BenchmarkRange[];   // Cost ranges per type
  expectedDivisions: ExpectedDivisions[];  // Required divisions per type
  divisionProportions: DivisionProportion[]; // Typical division splits
  getProjectTypeName(type: string): string;  // Lookup display name
}

// ─── Pack Registry ───────────────────────────────────────────────────────────

const registeredPacks = new Map<ProjectCategory, BenchmarkPack>();

/**
 * Register a benchmark pack with the core engine.
 * Called by each pack module on import.
 */
export function registerBenchmarkPack(pack: BenchmarkPack): void {
  registeredPacks.set(pack.category, pack);
}

/**
 * Get a registered pack by category.
 */
export function getBenchmarkPack(category: ProjectCategory): BenchmarkPack | undefined {
  return registeredPacks.get(category);
}

/**
 * List all registered pack categories.
 */
export function getRegisteredCategories(): ProjectCategory[] {
  return Array.from(registeredPacks.keys());
}

/**
 * Get all registered packs.
 */
export function getAllPacks(): BenchmarkPack[] {
  return Array.from(registeredPacks.values());
}

// ─── Finding & Report Interfaces ─────────────────────────────────────────────

export interface BenchmarkFinding {
  id: string;
  severity: 'pass' | 'info' | 'warning' | 'critical';
  category: 'cost-benchmark' | 'division-proportion' | 'completeness' | 'data-quality';
  title: string;
  detail: string;
  recommendation?: string;
}

export interface BenchmarkReport {
  projectName: string;
  projectCategory: ProjectCategory;
  projectType: string;
  projectTypeName: string;
  metric: BenchmarkMetric;
  metricLabel: string;

  // Quantity and cost per unit
  projectQuantity: number;         // m², lane-km, linear m, etc.
  measurementUnit: string;
  actualCostPerUnit: number;       // Direct cost / quantity
  budgetCostPerUnit: number;       // Grand total / quantity
  benchmarkRange: BenchmarkRange | null;
  costStatus: 'below' | 'within' | 'above' | 'no-benchmark';

  // Data quality
  totalLineItems: number;
  verifiedItems: number;
  estimatedItems: number;
  incompleteItems: number;
  dataQualityScore: number;

  // Findings
  findings: BenchmarkFinding[];
  passCount: number;
  infoCount: number;
  warningCount: number;
  criticalCount: number;
  overallStatus: 'pass' | 'review' | 'fail';

  packVersion: string;
  generatedAt: string;
}

export interface BenchmarkConfig {
  projectCategory: ProjectCategory;
  projectType: string;
  projectQuantity: number;         // In the metric's unit (m², lane-km, etc.)
  projectName?: string;
  tolerancePercent?: number;       // Default ±15%
}

// ─── Core Validation Engine ──────────────────────────────────────────────────

/**
 * Run benchmark validation using the appropriate pack for the project category.
 * This function is category-agnostic — it delegates to whatever pack is registered.
 */
export function runBenchmark(
  estimate: EstimateSummary,
  budget: BudgetStructure,
  config: BenchmarkConfig
): BenchmarkReport {
  const pack = registeredPacks.get(config.projectCategory);
  if (!pack) {
    return createErrorReport(config, 'No benchmark pack registered for category: ' + config.projectCategory +
      '. Available packs: ' + Array.from(registeredPacks.keys()).join(', '));
  }

  const tolerance = config.tolerancePercent ?? 15;
  const findings: BenchmarkFinding[] = [];
  let findingId = 1;

  const directCost = estimate.grandTotal;
  const budgetTotal = budget.GRAND_TOTAL;
  const qty = config.projectQuantity;

  // ── 1. COST PER UNIT BENCHMARK ──

  const actualCostPerUnit = qty > 0 ? directCost / qty : 0;
  const budgetCostPerUnit = qty > 0 ? budgetTotal / qty : 0;
  const benchmark = pack.benchmarks.find(b => b.projectType === config.projectType) || null;

  let costStatus: 'below' | 'within' | 'above' | 'no-benchmark' = 'no-benchmark';

  if (benchmark) {
    const toleranceLow = benchmark.costLow * (1 - tolerance / 100);
    const toleranceHigh = benchmark.costHigh * (1 + tolerance / 100);

    if (actualCostPerUnit < toleranceLow) {
      costStatus = 'below';
      findings.push({
        id: 'BM-' + (findingId++), severity: 'warning', category: 'cost-benchmark',
        title: 'Cost/' + pack.measurementUnit + ' below benchmark range',
        detail: 'Direct cost of $' + actualCostPerUnit.toFixed(0) + '/' + pack.measurementUnit +
          ' is below the ' + benchmark.typeName + ' range of $' + benchmark.costLow +
          '-$' + benchmark.costHigh + '/' + pack.measurementUnit +
          ' (with ' + tolerance + '% tolerance: $' + toleranceLow.toFixed(0) +
          '-$' + toleranceHigh.toFixed(0) + ').',
        recommendation: 'Review for missing scope, under-sized quantities, or rates below market.',
      });
    } else if (actualCostPerUnit > toleranceHigh) {
      costStatus = 'above';
      findings.push({
        id: 'BM-' + (findingId++), severity: 'warning', category: 'cost-benchmark',
        title: 'Cost/' + pack.measurementUnit + ' above benchmark range',
        detail: 'Direct cost of $' + actualCostPerUnit.toFixed(0) + '/' + pack.measurementUnit +
          ' is above the ' + benchmark.typeName + ' range of $' + benchmark.costLow +
          '-$' + benchmark.costHigh + '/' + pack.measurementUnit +
          ' (with ' + tolerance + '% tolerance: $' + toleranceLow.toFixed(0) +
          '-$' + toleranceHigh.toFixed(0) + ').',
        recommendation: 'Review for double-counted items, excessive quantities, or premium specifications.',
      });
    } else {
      costStatus = 'within';
      findings.push({
        id: 'BM-' + (findingId++), severity: 'pass', category: 'cost-benchmark',
        title: 'Cost/' + pack.measurementUnit + ' within benchmark range',
        detail: 'Direct cost of $' + actualCostPerUnit.toFixed(0) + '/' + pack.measurementUnit +
          ' is within the ' + benchmark.typeName + ' range of $' + benchmark.costLow +
          '-$' + benchmark.costHigh + '/' + pack.measurementUnit + '.',
      });
    }
  } else {
    findings.push({
      id: 'BM-' + (findingId++), severity: 'info', category: 'cost-benchmark',
      title: 'No benchmark available for project type: ' + config.projectType,
      detail: 'This project type does not have a benchmark range in the ' +
        pack.categoryName + ' pack (v' + pack.version + '). Cost reasonableness cannot be assessed.',
    });
  }

  // ── 2. DIVISION PROPORTIONALITY ──

  const divTotals = new Map<string, number>();
  for (const floor of estimate.floors) {
    for (const item of floor.lineItems) {
      divTotals.set(item.csiDivision, (divTotals.get(item.csiDivision) || 0) + item.totalCost);
    }
  }

  for (const bench of pack.divisionProportions) {
    const divTotal = divTotals.get(bench.division) || 0;
    const divPercent = directCost > 0 ? divTotal / directCost : 0;

    if (divTotal > 0 && divPercent < bench.expectedPercentLow) {
      findings.push({
        id: 'BM-' + (findingId++), severity: 'info', category: 'division-proportion',
        title: 'Div ' + bench.division + ' (' + bench.divisionName + ') below typical range',
        detail: (divPercent * 100).toFixed(1) + '% of direct cost (expected ' +
          (bench.expectedPercentLow * 100).toFixed(0) + '-' +
          (bench.expectedPercentHigh * 100).toFixed(0) + '%).',
        recommendation: 'Verify scope and quantities for this division.',
      });
    } else if (divTotal > 0 && divPercent > bench.expectedPercentHigh) {
      findings.push({
        id: 'BM-' + (findingId++), severity: 'warning', category: 'division-proportion',
        title: 'Div ' + bench.division + ' (' + bench.divisionName + ') above typical range',
        detail: (divPercent * 100).toFixed(1) + '% of direct cost (expected ' +
          (bench.expectedPercentLow * 100).toFixed(0) + '-' +
          (bench.expectedPercentHigh * 100).toFixed(0) + '%).',
        recommendation: 'Review for over-measurement, double counting, or premium specifications.',
      });
    }
  }

  // ── 3. COMPLETENESS CHECK ──

  const expectedEntry = pack.expectedDivisions.find(e => e.projectType === config.projectType);
  const expectedDivs = expectedEntry ? expectedEntry.divisions : [];
  const presentDivs = new Set(divTotals.keys());

  for (const div of expectedDivs) {
    if (!presentDivs.has(div)) {
      findings.push({
        id: 'BM-' + (findingId++), severity: 'warning', category: 'completeness',
        title: 'Expected division missing: Div ' + div,
        detail: 'Division ' + div + ' is typically present for ' +
          (pack.getProjectTypeName(config.projectType) || config.projectType) +
          ' projects but has no line items.',
        recommendation: 'Confirm intentionally excluded or add missing scope.',
      });
    }
  }

  for (const [div] of divTotals) {
    if (!expectedDivs.includes(div) && parseInt(div) > 1) {
      findings.push({
        id: 'BM-' + (findingId++), severity: 'info', category: 'completeness',
        title: 'Additional division present: Div ' + div,
        detail: 'Division ' + div + ' is not typically expected for this project type but has line items.',
      });
    }
  }

  // ── 4. DATA QUALITY ──

  let totalItems = 0;
  let verifiedItems = 0;
  let estimatedItems = 0;
  const incompleteItems = estimate.incompleteElements;

  for (const floor of estimate.floors) {
    for (const item of floor.lineItems) {
      totalItems++;
      if (item.verificationStatus === 'verified') verifiedItems++;
      else if (item.verificationStatus === 'estimated') estimatedItems++;
    }
  }

  const dataQualityScore = totalItems > 0 ? (verifiedItems / totalItems) * 100 : 0;

  if (dataQualityScore < 30) {
    findings.push({
      id: 'BM-' + (findingId++), severity: 'critical', category: 'data-quality',
      title: 'Low data quality score: ' + dataQualityScore.toFixed(0) + '%',
      detail: 'Only ' + verifiedItems + ' of ' + totalItems + ' line items verified. ' +
        estimatedItems + ' estimated.',
      recommendation: 'Suitable for AACE Class 4-5 (conceptual/screening) only.',
    });
  } else if (dataQualityScore < 65) {
    findings.push({
      id: 'BM-' + (findingId++), severity: 'warning', category: 'data-quality',
      title: 'Moderate data quality: ' + dataQualityScore.toFixed(0) + '%',
      detail: verifiedItems + ' of ' + totalItems + ' verified (' + estimatedItems + ' estimated).',
      recommendation: 'Suitable for AACE Class 3. Additional documentation needed for Class 1-2.',
    });
  } else {
    findings.push({
      id: 'BM-' + (findingId++), severity: 'pass', category: 'data-quality',
      title: 'Good data quality: ' + dataQualityScore.toFixed(0) + '%',
      detail: verifiedItems + ' of ' + totalItems + ' verified.',
    });
  }

  if (incompleteItems > 0) {
    findings.push({
      id: 'BM-' + (findingId++), severity: 'info', category: 'data-quality',
      title: incompleteItems + ' incomplete elements skipped',
      detail: 'Insufficient data for estimation; skipped per CIQS no-default-values principle.',
    });
  }

  // ── COMPILE REPORT ──

  const passCount = findings.filter(f => f.severity === 'pass').length;
  const infoCount = findings.filter(f => f.severity === 'info').length;
  const warningCount = findings.filter(f => f.severity === 'warning').length;
  const criticalCount = findings.filter(f => f.severity === 'critical').length;

  let overallStatus: 'pass' | 'review' | 'fail' = 'pass';
  if (criticalCount > 0) overallStatus = 'fail';
  else if (warningCount > 2) overallStatus = 'review';

  return {
    projectName: config.projectName || '',
    projectCategory: config.projectCategory,
    projectType: config.projectType,
    projectTypeName: pack.getProjectTypeName(config.projectType) || config.projectType,
    metric: pack.metric,
    metricLabel: pack.metricLabel,
    projectQuantity: qty,
    measurementUnit: pack.measurementUnit,
    actualCostPerUnit,
    budgetCostPerUnit,
    benchmarkRange: benchmark,
    costStatus,
    totalLineItems: totalItems,
    verifiedItems, estimatedItems, incompleteItems,
    dataQualityScore,
    findings,
    passCount, infoCount, warningCount, criticalCount,
    overallStatus,
    packVersion: pack.version,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Report Formatter ────────────────────────────────────────────────────────

export function formatBenchmarkReport(report: BenchmarkReport): string {
  const f = (n: number) => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const out: string[] = [];

  out.push('====================================================================');
  out.push('  BENCHMARK VALIDATION REPORT');
  out.push('  Category: ' + report.projectCategory.toUpperCase() + ' | Pack v' + report.packVersion);
  out.push('====================================================================');
  out.push('');
  out.push('  Project Type: ' + report.projectTypeName);
  out.push('  Project Quantity: ' + report.projectQuantity.toLocaleString() + ' ' + report.measurementUnit);
  out.push('  Direct Cost/' + report.measurementUnit + ': ' + f(report.actualCostPerUnit));
  out.push('  Budget Total/' + report.measurementUnit + ': ' + f(report.budgetCostPerUnit));
  if (report.benchmarkRange) {
    out.push('  Benchmark Range: ' + f(report.benchmarkRange.costLow) + ' - ' +
      f(report.benchmarkRange.costHigh) + ' ' + report.metricLabel);
  }
  out.push('  Status: ' + report.costStatus.toUpperCase());
  out.push('');
  out.push('  Data Quality: ' + report.dataQualityScore.toFixed(0) + '% (' +
    report.verifiedItems + '/' + report.totalLineItems + ' verified)');
  out.push('');

  const icon = { pass: '✅', info: 'ℹ️', warning: '⚠️', critical: '❌' };
  for (const finding of report.findings) {
    out.push('  ' + icon[finding.severity] + ' [' + finding.id + '] ' + finding.title);
    out.push('     ' + finding.detail);
    if (finding.recommendation) out.push('     → ' + finding.recommendation);
    out.push('');
  }

  out.push('  SUMMARY: ' + report.passCount + ' pass, ' + report.infoCount + ' info, ' +
    report.warningCount + ' warnings, ' + report.criticalCount + ' critical');
  out.push('  OVERALL: ' + report.overallStatus.toUpperCase());
  out.push('====================================================================');
  return out.join('\n');
}

// ─── Error Report (when pack not found) ──────────────────────────────────────

function createErrorReport(config: BenchmarkConfig, message: string): BenchmarkReport {
  return {
    projectName: config.projectName || '',
    projectCategory: config.projectCategory,
    projectType: config.projectType,
    projectTypeName: config.projectType,
    metric: 'lump-sum',
    metricLabel: 'N/A',
    projectQuantity: config.projectQuantity,
    measurementUnit: 'N/A',
    actualCostPerUnit: 0, budgetCostPerUnit: 0,
    benchmarkRange: null,
    costStatus: 'no-benchmark',
    totalLineItems: 0, verifiedItems: 0, estimatedItems: 0, incompleteItems: 0,
    dataQualityScore: 0,
    findings: [{ id: 'BM-ERR', severity: 'critical', category: 'cost-benchmark', title: 'Pack Not Found', detail: message }],
    passCount: 0, infoCount: 0, warningCount: 0, criticalCount: 1,
    overallStatus: 'fail',
    packVersion: 'N/A',
    generatedAt: new Date().toISOString(),
  };
}
