// server/estimator/benchmark-engine.ts
// =============================================================================
// BENCHMARK ENGINE — COST/m² COMPARISON + DIVISION COMPLETENESS CHECK
// =============================================================================
//
// Closes QS Level 5 gaps:
//   7.3  Cost/m² Benchmarking (GFA comparison against database)
//   7.5  Completeness Check (expected divisions by building type)
//
// Benchmarks: Canadian 2025 cost data (RSMeans / Altus / BTY references)
// Flags estimates outside ±15% of expected range.
//
// Consumes: EstimateSummary from estimate-engine.ts
// Consumed by: boe-generator.ts, qs-level5-routes.ts
// =============================================================================

import type { EstimateSummary } from './estimate-engine';


// ─── BENCHMARK DATABASE (Canadian 2025, $/m² GFA) ──────────────────────────

export type BuildingType =
  | 'residential_lowrise'
  | 'residential_midrise'
  | 'residential_highrise'
  | 'commercial_office'
  | 'commercial_retail'
  | 'institutional_education'
  | 'institutional_healthcare'
  | 'industrial_warehouse'
  | 'industrial_manufacturing'
  | 'mixed_use';

export interface BenchmarkRange {
  buildingType: BuildingType;
  displayName: string;
  lowPerM2: number;       // $/m² GFA (direct cost only)
  midPerM2: number;
  highPerM2: number;
  source: string;
  notes: string;
}

export const BENCHMARK_DATABASE: Record<BuildingType, BenchmarkRange> = {
  residential_lowrise: {
    buildingType: 'residential_lowrise',
    displayName: 'Residential — Low-Rise (1-3 storeys)',
    lowPerM2: 2800, midPerM2: 3400, highPerM2: 4200,
    source: 'Altus Group Canadian Cost Guide 2025 / RSMeans',
    notes: 'Wood frame, Part 9 OBC, standard finishes',
  },
  residential_midrise: {
    buildingType: 'residential_midrise',
    displayName: 'Residential — Mid-Rise (4-8 storeys)',
    lowPerM2: 3200, midPerM2: 3900, highPerM2: 4800,
    source: 'Altus Group Canadian Cost Guide 2025',
    notes: 'Concrete/steel, Part 3 OBC, elevator required',
  },
  residential_highrise: {
    buildingType: 'residential_highrise',
    displayName: 'Residential — High-Rise (9+ storeys)',
    lowPerM2: 3800, midPerM2: 4700, highPerM2: 5800,
    source: 'Altus Group / BTY Group 2025',
    notes: 'Concrete, high-performance envelope, multiple elevators',
  },
  commercial_office: {
    buildingType: 'commercial_office',
    displayName: 'Commercial — Office',
    lowPerM2: 3200, midPerM2: 4200, highPerM2: 5500,
    source: 'Altus Group Canadian Cost Guide 2025',
    notes: 'Class A office, raised floors, advanced HVAC',
  },
  commercial_retail: {
    buildingType: 'commercial_retail',
    displayName: 'Commercial — Retail',
    lowPerM2: 2200, midPerM2: 3000, highPerM2: 4000,
    source: 'RSMeans Square Foot Costs 2025',
    notes: 'Shell + tenant improvements, varies widely',
  },
  institutional_education: {
    buildingType: 'institutional_education',
    displayName: 'Institutional — Education (K-12, Post-Secondary)',
    lowPerM2: 4500, midPerM2: 5500, highPerM2: 7000,
    source: 'Ontario Infrastructure Cost Data 2025',
    notes: 'Laboratory/workshop premiums, accessibility, durability',
  },
  institutional_healthcare: {
    buildingType: 'institutional_healthcare',
    displayName: 'Institutional — Healthcare',
    lowPerM2: 5500, midPerM2: 7000, highPerM2: 9500,
    source: 'Ontario Infrastructure Cost Data 2025',
    notes: 'Highest MEP density, infection control, redundancy',
  },
  industrial_warehouse: {
    buildingType: 'industrial_warehouse',
    displayName: 'Industrial — Warehouse/Distribution',
    lowPerM2: 1400, midPerM2: 1900, highPerM2: 2600,
    source: 'RSMeans Square Foot Costs 2025',
    notes: 'Pre-engineered metal building, minimal finishes',
  },
  industrial_manufacturing: {
    buildingType: 'industrial_manufacturing',
    displayName: 'Industrial — Manufacturing',
    lowPerM2: 2200, midPerM2: 3000, highPerM2: 4200,
    source: 'RSMeans / Altus 2025',
    notes: 'Process equipment excluded, structural premiums',
  },
  mixed_use: {
    buildingType: 'mixed_use',
    displayName: 'Mixed-Use (Residential + Commercial)',
    lowPerM2: 3000, midPerM2: 3800, highPerM2: 5000,
    source: 'Altus Group / BTY Group 2025',
    notes: 'Blended rate depends on residential/commercial split',
  },
};


// ─── EXPECTED DIVISIONS BY BUILDING TYPE ────────────────────────────────────

const EXPECTED_DIVISIONS: Record<BuildingType, {
  required: string[];    // must be present
  typical: string[];     // usually present
  optional: string[];    // may or may not appear
}> = {
  residential_lowrise: {
    required: ['01', '02', '03', '06', '07', '08', '09', '22', '23', '26', '31', '32'],
    typical: ['04', '05', '10', '21', '27', '33'],
    optional: ['14', '28'],
  },
  residential_midrise: {
    required: ['01', '02', '03', '05', '07', '08', '09', '14', '21', '22', '23', '26', '31', '32', '33'],
    typical: ['04', '06', '10', '27', '28'],
    optional: ['25'],
  },
  residential_highrise: {
    required: ['01', '02', '03', '05', '07', '08', '09', '14', '21', '22', '23', '26', '27', '28', '31', '32', '33'],
    typical: ['04', '10', '25'],
    optional: ['06', '11', '13'],
  },
  commercial_office: {
    required: ['01', '02', '03', '05', '07', '08', '09', '14', '21', '22', '23', '25', '26', '27', '28', '31', '32', '33'],
    typical: ['04', '10', '11', '12'],
    optional: ['06', '13'],
  },
  commercial_retail: {
    required: ['01', '02', '03', '07', '08', '09', '22', '23', '26', '31', '32'],
    typical: ['05', '06', '10', '21', '27', '33'],
    optional: ['14', '25', '28'],
  },
  institutional_education: {
    required: ['01', '02', '03', '05', '07', '08', '09', '10', '11', '14', '21', '22', '23', '26', '27', '28', '31', '32', '33'],
    typical: ['04', '06', '12', '25'],
    optional: ['13'],
  },
  institutional_healthcare: {
    required: ['01', '02', '03', '05', '07', '08', '09', '10', '11', '14', '21', '22', '23', '25', '26', '27', '28', '31', '32', '33'],
    typical: ['04', '06', '12', '13'],
    optional: [],
  },
  industrial_warehouse: {
    required: ['01', '02', '03', '05', '07', '08', '09', '22', '23', '26', '31', '32'],
    typical: ['33', '21'],
    optional: ['10', '14', '27', '28'],
  },
  industrial_manufacturing: {
    required: ['01', '02', '03', '05', '07', '08', '09', '22', '23', '26', '31', '32', '33'],
    typical: ['10', '11', '14', '21', '27'],
    optional: ['25', '28', '40', '41', '42', '43', '44'],
  },
  mixed_use: {
    required: ['01', '02', '03', '05', '07', '08', '09', '14', '21', '22', '23', '26', '31', '32', '33'],
    typical: ['04', '06', '10', '27', '28'],
    optional: ['11', '12', '25'],
  },
};


// ─── BENCHMARK COMPARISON ───────────────────────────────────────────────────

export interface BenchmarkComparison {
  projectId: string;
  buildingType: BuildingType;
  grossFloorArea: number;        // m²
  estimateDirectCost: number;
  costPerM2: number;
  benchmarkRange: BenchmarkRange;
  status: 'below_range' | 'within_range' | 'above_range';
  varianceFromMid: number;       // $ total
  varianceFromMidPercent: number; // %
  varianceFromLow: number;
  varianceFromHigh: number;
  flags: string[];               // warning messages
  generatedAt: string;
}

export function compareToBenchmark(
  projectId: string,
  estimate: EstimateSummary,
  buildingType: BuildingType,
  grossFloorArea: number,
): BenchmarkComparison {
  const benchmark = BENCHMARK_DATABASE[buildingType];
  const costPerM2 = grossFloorArea > 0 ? estimate.grandTotal / grossFloorArea : 0;

  const flags: string[] = [];
  let status: BenchmarkComparison['status'] = 'within_range';

  // Below range = more than 15% below low
  const lowThreshold = benchmark.lowPerM2 * 0.85;
  const highThreshold = benchmark.highPerM2 * 1.15;

  if (costPerM2 < lowThreshold) {
    status = 'below_range';
    flags.push(`Cost/m² ($${costPerM2.toFixed(0)}) is ${((1 - costPerM2 / benchmark.lowPerM2) * 100).toFixed(1)}% below expected low ($${benchmark.lowPerM2}). May indicate incomplete scope or missing divisions.`);
  } else if (costPerM2 > highThreshold) {
    status = 'above_range';
    flags.push(`Cost/m² ($${costPerM2.toFixed(0)}) is ${((costPerM2 / benchmark.highPerM2 - 1) * 100).toFixed(1)}% above expected high ($${benchmark.highPerM2}). Review for over-specification or rate anomalies.`);
  }

  // Check if close to boundaries (±10%)
  if (status === 'within_range') {
    if (costPerM2 < benchmark.lowPerM2 * 1.05) {
      flags.push(`Cost/m² is near the low end of expected range — verify all scope items are included.`);
    } else if (costPerM2 > benchmark.highPerM2 * 0.95) {
      flags.push(`Cost/m² is near the high end of expected range — consider value engineering opportunities.`);
    }
  }

  const varianceFromMid = estimate.grandTotal - benchmark.midPerM2 * grossFloorArea;

  return {
    projectId,
    buildingType,
    grossFloorArea,
    estimateDirectCost: Math.round(estimate.grandTotal * 100) / 100,
    costPerM2: Math.round(costPerM2 * 100) / 100,
    benchmarkRange: benchmark,
    status,
    varianceFromMid: Math.round(varianceFromMid * 100) / 100,
    varianceFromMidPercent: benchmark.midPerM2 * grossFloorArea > 0
      ? Math.round((varianceFromMid / (benchmark.midPerM2 * grossFloorArea)) * 10000) / 100
      : 0,
    varianceFromLow: Math.round((estimate.grandTotal - benchmark.lowPerM2 * grossFloorArea) * 100) / 100,
    varianceFromHigh: Math.round((estimate.grandTotal - benchmark.highPerM2 * grossFloorArea) * 100) / 100,
    flags,
    generatedAt: new Date().toISOString(),
  };
}


// ─── DIVISION COMPLETENESS CHECK ────────────────────────────────────────────

export interface CompletenessCheck {
  projectId: string;
  buildingType: BuildingType;
  presentDivisions: string[];
  missingRequired: string[];
  missingTypical: string[];
  missingOptional: string[];
  completenessScore: number;     // 0-100%
  estimatedDataQuality: number;  // % of line items with 'verified' status
  flags: string[];
  generatedAt: string;
}

export function checkCompleteness(
  projectId: string,
  estimate: EstimateSummary,
  buildingType: BuildingType,
): CompletenessCheck {
  const expected = EXPECTED_DIVISIONS[buildingType];
  const presentDivs = new Set<string>();
  let verifiedCount = 0;
  let totalCount = 0;

  for (const floor of estimate.floors) {
    for (const li of floor.lineItems) {
      presentDivs.add(li.csiDivision);
      totalCount++;
      if (li.verificationStatus === 'verified') verifiedCount++;
    }
  }

  const present = [...presentDivs];
  const missingRequired = expected.required.filter(d => !presentDivs.has(d));
  const missingTypical = expected.typical.filter(d => !presentDivs.has(d));
  const missingOptional = expected.optional.filter(d => !presentDivs.has(d));

  // Score: required = 60%, typical = 30%, optional = 10%
  const reqScore = expected.required.length > 0
    ? ((expected.required.length - missingRequired.length) / expected.required.length) * 60
    : 60;
  const typScore = expected.typical.length > 0
    ? ((expected.typical.length - missingTypical.length) / expected.typical.length) * 30
    : 30;
  const optScore = expected.optional.length > 0
    ? ((expected.optional.length - missingOptional.length) / expected.optional.length) * 10
    : 10;

  const completenessScore = Math.round((reqScore + typScore + optScore) * 100) / 100;
  const dataQuality = totalCount > 0 ? Math.round((verifiedCount / totalCount) * 10000) / 100 : 0;

  const flags: string[] = [];
  if (missingRequired.length > 0) {
    flags.push(`CRITICAL: Missing ${missingRequired.length} required division(s) for ${buildingType}: Div ${missingRequired.join(', ')}`);
  }
  if (missingTypical.length > 0) {
    flags.push(`WARNING: Missing ${missingTypical.length} typically-present division(s): Div ${missingTypical.join(', ')}`);
  }
  if (dataQuality < 70) {
    flags.push(`DATA QUALITY: Only ${dataQuality}% of line items have 'verified' status — review incomplete measurements`);
  }

  return {
    projectId,
    buildingType,
    presentDivisions: present.sort(),
    missingRequired,
    missingTypical,
    missingOptional,
    completenessScore,
    estimatedDataQuality: dataQuality,
    flags,
    generatedAt: new Date().toISOString(),
  };
}


// ─── IN-MEMORY STORAGE ──────────────────────────────────────────────────────

const benchmarkStore = new Map<string, BenchmarkComparison>();
const completenessStore = new Map<string, CompletenessCheck>();

export function storeBenchmark(projectId: string, result: BenchmarkComparison): BenchmarkComparison {
  benchmarkStore.set(projectId, result);
  return result;
}
export function getBenchmark(projectId: string): BenchmarkComparison | undefined {
  return benchmarkStore.get(projectId);
}
export function storeCompleteness(projectId: string, result: CompletenessCheck): CompletenessCheck {
  completenessStore.set(projectId, result);
  return result;
}
export function getCompleteness(projectId: string): CompletenessCheck | undefined {
  return completenessStore.get(projectId);
}
