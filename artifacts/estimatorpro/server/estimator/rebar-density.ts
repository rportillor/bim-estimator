// server/estimator/rebar-density.ts
// =============================================================================
// REBAR DENSITY TABLES
// =============================================================================
//
// Master Priority Item #25
//
// Purpose:
//   1. Provide standard rebar density tables (kg/m³ of concrete) by element type
//   2. Calculate rebar tonnage from concrete volumes automatically
//   3. Support Canadian bar sizes (10M, 15M, 20M, 25M, 30M, 35M)
//   4. Apply element-specific densities (slabs vs walls vs columns vs beams)
//   5. Adjust for seismic requirements (higher density in seismic zones)
//   6. Generate rebar BOQ with bar size distribution
//   7. Cross-reference with CSA A23.3 reinforcing requirements
//
// Standards: CSA A23.3-19, CSA G30.18, CIQS quantity surveying practices
// =============================================================================

import type { EstimateSummary as _EstimateSummary } from './estimate-engine';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export type ConcreteElementType =
  | 'slab-on-grade'
  | 'suspended-slab'
  | 'flat-plate'
  | 'post-tensioned-slab'
  | 'foundation-wall'
  | 'shear-wall'
  | 'retaining-wall'
  | 'column-tied'
  | 'column-spiral'
  | 'beam-rectangular'
  | 'beam-deep'
  | 'strip-footing'
  | 'spread-footing'
  | 'pile-cap'
  | 'mat-foundation'
  | 'grade-beam'
  | 'stair'
  | 'elevator-pit'
  | 'transfer-slab';

export type SeismicZone = 'low' | 'moderate' | 'high';

export interface RebarBarSize {
  designation: string;        // Canadian: "10M", "15M", etc.
  nominalDiameter: number;    // mm
  crossSectionArea: number;   // mm²
  massPerMetre: number;       // kg/m
  imperialEquiv: string;      // US equivalent: "#3", "#4", etc.
}

export interface RebarDensityEntry {
  elementType: ConcreteElementType;
  elementName: string;
  densityLow: number;         // kg/m³ of concrete — light reinforcing
  densityMid: number;         // kg/m³ — typical
  densityHigh: number;        // kg/m³ — heavy reinforcing
  seismicAdder: number;       // Additional kg/m³ for high seismic
  typicalBarSizes: string[];  // Common bar sizes for this element
  notes?: string;
}

export interface RebarCalculation {
  elementType: ConcreteElementType;
  elementName: string;
  concreteVolume: number;     // m³
  densityUsed: number;        // kg/m³
  rebarTonnage: number;       // tonnes
  barSizeDistribution: {
    barSize: string;
    percentOfTotal: number;
    tonnage: number;
    estimatedLength: number;  // metres
  }[];
  unitCostPerTonne: number;   // CAD supply + place
  totalRebarCost: number;
}

export interface RebarSummary {
  projectName: string;
  totalConcreteVolume: number;
  totalRebarTonnage: number;
  averageDensity: number;         // kg/m³ overall
  totalRebarCost: number;
  costPerTonne: number;           // Average
  calculations: RebarCalculation[];
  barSizeTotals: {
    barSize: string;
    totalTonnage: number;
    percentOfTotal: number;
  }[];
  seismicZone: SeismicZone;
  generatedAt: string;
}

// ─── Canadian Bar Sizes (CSA G30.18) ─────────────────────────────────────────

const CANADIAN_BAR_SIZES: RebarBarSize[] = [
  { designation: '10M', nominalDiameter: 11.3, crossSectionArea: 100, massPerMetre: 0.785, imperialEquiv: '#3' },
  { designation: '15M', nominalDiameter: 16.0, crossSectionArea: 200, massPerMetre: 1.570, imperialEquiv: '#5' },
  { designation: '20M', nominalDiameter: 19.5, crossSectionArea: 300, massPerMetre: 2.355, imperialEquiv: '#6' },
  { designation: '25M', nominalDiameter: 25.2, crossSectionArea: 500, massPerMetre: 3.925, imperialEquiv: '#8' },
  { designation: '30M', nominalDiameter: 29.9, crossSectionArea: 700, massPerMetre: 5.495, imperialEquiv: '#9' },
  { designation: '35M', nominalDiameter: 35.7, crossSectionArea: 1000, massPerMetre: 7.850, imperialEquiv: '#11' },
  { designation: '45M', nominalDiameter: 43.7, crossSectionArea: 1500, massPerMetre: 11.775, imperialEquiv: '#14' },
  { designation: '55M', nominalDiameter: 56.4, crossSectionArea: 2500, massPerMetre: 19.625, imperialEquiv: '#18' },
];

// ─── Rebar Density Tables ────────────────────────────────────────────────────
// Values in kg/m³ of concrete. Based on CIQS historical data, Ontario ICI projects.

const REBAR_DENSITY_TABLE: RebarDensityEntry[] = [
  // Slabs
  { elementType: 'slab-on-grade', elementName: 'Slab on Grade', densityLow: 40, densityMid: 65, densityHigh: 90, seismicAdder: 10,
    typicalBarSizes: ['10M', '15M'], notes: 'Mesh alternative: 150×150 MW25.8' },
  { elementType: 'suspended-slab', elementName: 'Suspended Slab (one-way)', densityLow: 80, densityMid: 110, densityHigh: 150, seismicAdder: 20,
    typicalBarSizes: ['15M', '20M', '25M'] },
  { elementType: 'flat-plate', elementName: 'Flat Plate Slab (two-way)', densityLow: 90, densityMid: 130, densityHigh: 170, seismicAdder: 25,
    typicalBarSizes: ['15M', '20M', '25M'], notes: 'Higher at column strips' },
  { elementType: 'post-tensioned-slab', elementName: 'Post-Tensioned Slab', densityLow: 25, densityMid: 45, densityHigh: 65, seismicAdder: 15,
    typicalBarSizes: ['10M', '15M'], notes: 'Mild steel only; PT strand separate' },
  { elementType: 'transfer-slab', elementName: 'Transfer Slab', densityLow: 150, densityMid: 200, densityHigh: 280, seismicAdder: 40,
    typicalBarSizes: ['25M', '30M', '35M'], notes: 'Very heavy reinforcement' },

  // Walls
  { elementType: 'foundation-wall', elementName: 'Foundation Wall', densityLow: 60, densityMid: 85, densityHigh: 120, seismicAdder: 15,
    typicalBarSizes: ['15M', '20M'] },
  { elementType: 'shear-wall', elementName: 'Shear Wall (lateral)', densityLow: 100, densityMid: 150, densityHigh: 220, seismicAdder: 35,
    typicalBarSizes: ['15M', '20M', '25M', '30M'], notes: 'Boundary elements increase density' },
  { elementType: 'retaining-wall', elementName: 'Retaining Wall', densityLow: 70, densityMid: 100, densityHigh: 140, seismicAdder: 15,
    typicalBarSizes: ['15M', '20M', '25M'] },

  // Columns
  { elementType: 'column-tied', elementName: 'Column (tied)', densityLow: 150, densityMid: 220, densityHigh: 320, seismicAdder: 40,
    typicalBarSizes: ['25M', '30M', '35M'], notes: 'ρ typically 1.5-4% per CSA A23.3' },
  { elementType: 'column-spiral', elementName: 'Column (spiral)', densityLow: 170, densityMid: 250, densityHigh: 350, seismicAdder: 50,
    typicalBarSizes: ['25M', '30M', '35M'], notes: 'Spiral confinement adds ~15%' },

  // Beams
  { elementType: 'beam-rectangular', elementName: 'Beam (rectangular)', densityLow: 120, densityMid: 170, densityHigh: 240, seismicAdder: 30,
    typicalBarSizes: ['20M', '25M', '30M'] },
  { elementType: 'beam-deep', elementName: 'Deep Beam / Transfer Beam', densityLow: 180, densityMid: 250, densityHigh: 350, seismicAdder: 45,
    typicalBarSizes: ['25M', '30M', '35M'] },

  // Foundations
  { elementType: 'strip-footing', elementName: 'Strip Footing', densityLow: 50, densityMid: 75, densityHigh: 110, seismicAdder: 10,
    typicalBarSizes: ['15M', '20M'] },
  { elementType: 'spread-footing', elementName: 'Spread Footing', densityLow: 60, densityMid: 90, densityHigh: 130, seismicAdder: 15,
    typicalBarSizes: ['20M', '25M'] },
  { elementType: 'pile-cap', elementName: 'Pile Cap', densityLow: 100, densityMid: 150, densityHigh: 220, seismicAdder: 25,
    typicalBarSizes: ['20M', '25M', '30M'] },
  { elementType: 'mat-foundation', elementName: 'Mat Foundation (raft)', densityLow: 110, densityMid: 160, densityHigh: 230, seismicAdder: 30,
    typicalBarSizes: ['25M', '30M', '35M'], notes: 'Top and bottom mats' },
  { elementType: 'grade-beam', elementName: 'Grade Beam', densityLow: 80, densityMid: 120, densityHigh: 170, seismicAdder: 20,
    typicalBarSizes: ['20M', '25M'] },

  // Other
  { elementType: 'stair', elementName: 'Stair (cast-in-place)', densityLow: 80, densityMid: 110, densityHigh: 150, seismicAdder: 15,
    typicalBarSizes: ['15M', '20M'] },
  { elementType: 'elevator-pit', elementName: 'Elevator Pit', densityLow: 90, densityMid: 130, densityHigh: 180, seismicAdder: 20,
    typicalBarSizes: ['15M', '20M', '25M'] },
];

// ─── Bar Size Distribution by Element ────────────────────────────────────────
// Typical distribution of bar sizes within each element type

const BAR_DISTRIBUTION: Record<ConcreteElementType, Record<string, number>> = {
  'slab-on-grade':       { '10M': 0.60, '15M': 0.40 },
  'suspended-slab':      { '15M': 0.35, '20M': 0.45, '25M': 0.20 },
  'flat-plate':          { '15M': 0.30, '20M': 0.45, '25M': 0.25 },
  'post-tensioned-slab': { '10M': 0.50, '15M': 0.50 },
  'transfer-slab':       { '25M': 0.35, '30M': 0.40, '35M': 0.25 },
  'foundation-wall':     { '15M': 0.55, '20M': 0.45 },
  'shear-wall':          { '15M': 0.20, '20M': 0.30, '25M': 0.30, '30M': 0.20 },
  'retaining-wall':      { '15M': 0.30, '20M': 0.40, '25M': 0.30 },
  'column-tied':         { '25M': 0.40, '30M': 0.35, '35M': 0.25 },
  'column-spiral':       { '25M': 0.35, '30M': 0.35, '35M': 0.30 },
  'beam-rectangular':    { '20M': 0.30, '25M': 0.45, '30M': 0.25 },
  'beam-deep':           { '25M': 0.30, '30M': 0.40, '35M': 0.30 },
  'strip-footing':       { '15M': 0.45, '20M': 0.55 },
  'spread-footing':      { '20M': 0.50, '25M': 0.50 },
  'pile-cap':            { '20M': 0.25, '25M': 0.45, '30M': 0.30 },
  'mat-foundation':      { '25M': 0.35, '30M': 0.40, '35M': 0.25 },
  'grade-beam':          { '20M': 0.45, '25M': 0.55 },
  'stair':               { '15M': 0.50, '20M': 0.50 },
  'elevator-pit':        { '15M': 0.30, '20M': 0.40, '25M': 0.30 },
};

// ─── Cost Data (Ontario 2025) ────────────────────────────────────────────────
// Supply + fabrication + delivery + placement (CAD per tonne)

const REBAR_COST_PER_TONNE: Record<string, number> = {
  '10M': 2450,   // Lighter bars — more labor per tonne to place
  '15M': 2250,
  '20M': 2100,
  '25M': 1950,
  '30M': 1850,
  '35M': 1800,
  '45M': 1750,
  '55M': 1700,
};

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Get Canadian bar size data.
 */
export function getBarSize(designation: string): RebarBarSize | undefined {
  return CANADIAN_BAR_SIZES.find(b => b.designation === designation);
}

/**
 * Get rebar density for an element type.
 */
export function getDensity(elementType: ConcreteElementType): RebarDensityEntry | undefined {
  return REBAR_DENSITY_TABLE.find(d => d.elementType === elementType);
}

/**
 * Calculate rebar for a single concrete element.
 */
export function calculateElementRebar(
  elementType: ConcreteElementType,
  concreteVolume: number,
  seismicZone: SeismicZone,
  densityOverride?: 'low' | 'mid' | 'high'
): RebarCalculation | null {
  const densityEntry = getDensity(elementType);
  if (!densityEntry) return null;

  // Select density
  let density = densityEntry.densityMid;
  if (densityOverride === 'low') density = densityEntry.densityLow;
  if (densityOverride === 'high') density = densityEntry.densityHigh;

  // Apply seismic adder
  if (seismicZone === 'high') density += densityEntry.seismicAdder;
  if (seismicZone === 'moderate') density += densityEntry.seismicAdder * 0.5;

  const tonnage = (concreteVolume * density) / 1000; // kg → tonnes

  // Bar size distribution
  const dist = BAR_DISTRIBUTION[elementType] || { '20M': 1.0 };
  const barSizeDistribution = Object.entries(dist).map(([barSize, pct]) => {
    const barTonnage = tonnage * pct;
    const barData = getBarSize(barSize);
    const estLength = barData ? (barTonnage * 1000) / barData.massPerMetre : 0;
    return {
      barSize,
      percentOfTotal: pct * 100,
      tonnage: Math.round(barTonnage * 1000) / 1000,
      estimatedLength: Math.round(estLength),
    };
  });

  // Weighted average cost per tonne
  let weightedCost = 0;
  for (const bar of barSizeDistribution) {
    const costPerT = REBAR_COST_PER_TONNE[bar.barSize] || 2100;
    weightedCost += costPerT * (bar.percentOfTotal / 100);
  }

  return {
    elementType,
    elementName: densityEntry.elementName,
    concreteVolume,
    densityUsed: Math.round(density * 10) / 10,
    rebarTonnage: Math.round(tonnage * 1000) / 1000,
    barSizeDistribution,
    unitCostPerTonne: Math.round(weightedCost),
    totalRebarCost: Math.round(tonnage * weightedCost * 100) / 100,
  };
}

/**
 * Generate complete rebar summary from element list.
 */
export function generateRebarSummary(
  elements: { elementType: ConcreteElementType; concreteVolume: number }[],
  projectName: string,
  seismicZone: SeismicZone
): RebarSummary {
  const calculations: RebarCalculation[] = [];
  let totalVolume = 0;
  let totalTonnage = 0;
  let totalCost = 0;
  const barTotals = new Map<string, number>();

  for (const elem of elements) {
    const calc = calculateElementRebar(elem.elementType, elem.concreteVolume, seismicZone);
    if (!calc) continue;

    calculations.push(calc);
    totalVolume += elem.concreteVolume;
    totalTonnage += calc.rebarTonnage;
    totalCost += calc.totalRebarCost;

    for (const bar of calc.barSizeDistribution) {
      barTotals.set(bar.barSize, (barTotals.get(bar.barSize) || 0) + bar.tonnage);
    }
  }

  const barSizeTotals = Array.from(barTotals.entries())
    .map(([barSize, tonnage]) => ({
      barSize,
      totalTonnage: Math.round(tonnage * 1000) / 1000,
      percentOfTotal: totalTonnage > 0 ? Math.round((tonnage / totalTonnage) * 10000) / 100 : 0,
    }))
    .sort((a, b) => {
      const order = CANADIAN_BAR_SIZES.map(bs => bs.designation);
      return order.indexOf(a.barSize) - order.indexOf(b.barSize);
    });

  return {
    projectName,
    totalConcreteVolume: Math.round(totalVolume * 100) / 100,
    totalRebarTonnage: Math.round(totalTonnage * 1000) / 1000,
    averageDensity: totalVolume > 0 ? Math.round((totalTonnage * 1000 / totalVolume) * 10) / 10 : 0,
    totalRebarCost: Math.round(totalCost * 100) / 100,
    costPerTonne: totalTonnage > 0 ? Math.round((totalCost / totalTonnage) * 100) / 100 : 0,
    calculations,
    barSizeTotals,
    seismicZone,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Format rebar summary as human-readable report.
 */
export function formatRebarReport(summary: RebarSummary): string {
  const f = (n: number) => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const out: string[] = [];

  out.push('====================================================================');
  out.push('  REBAR DENSITY & QUANTITY ANALYSIS');
  out.push('  Project: ' + summary.projectName);
  out.push('====================================================================');
  out.push('');
  out.push('  Seismic zone: ' + summary.seismicZone);
  out.push('  Total concrete: ' + summary.totalConcreteVolume.toFixed(1) + ' m\u00B3');
  out.push('  Total rebar: ' + summary.totalRebarTonnage.toFixed(3) + ' tonnes');
  out.push('  Average density: ' + summary.averageDensity.toFixed(1) + ' kg/m\u00B3');
  out.push('  Total rebar cost: ' + f(summary.totalRebarCost) + ' (' + f(summary.costPerTonne) + '/tonne avg)');
  out.push('');

  out.push('  \u2500\u2500 Bar Size Breakdown \u2500\u2500');
  for (const bar of summary.barSizeTotals) {
    out.push('    ' + bar.barSize + ': ' + bar.totalTonnage.toFixed(3) + ' t (' + bar.percentOfTotal.toFixed(1) + '%)');
  }
  out.push('');

  out.push('  \u2500\u2500 Element Detail \u2500\u2500');
  for (const calc of summary.calculations) {
    out.push('  ' + calc.elementName);
    out.push('    Volume: ' + calc.concreteVolume.toFixed(1) + ' m\u00B3 | Density: ' + calc.densityUsed.toFixed(0) +
      ' kg/m\u00B3 | Rebar: ' + calc.rebarTonnage.toFixed(3) + ' t | Cost: ' + f(calc.totalRebarCost));
  }

  out.push('');
  out.push('====================================================================');
  return out.join('\n');
}

/** Pre-populated Canadian bar sizes */
export const CANADIAN_BARS = CANADIAN_BAR_SIZES;

/** Pre-populated rebar density table */
export const DENSITY_TABLE = REBAR_DENSITY_TABLE;

/** Pre-populated rebar cost data (Ontario 2025) */
export const REBAR_COSTS = REBAR_COST_PER_TONNE;

// ─── ADV-1: Convenience wrapper for estimate-engine.ts ───────────────────────
// rebarDensityFor(elementType, seismicZone?) → kg/m³ (mid-range density)
// Replaces the 4 hardcoded multipliers (100, 90, 120, 110) that were in
// estimate-engine.ts with CSA G30.18-calibrated values from REBAR_DENSITY_TABLE.
//
// elementType mapping:
//   'wall'   → suspended shear wall mid-density
//   'slab'   → suspended-slab mid-density
//   'column' → column-tied mid-density
//   'beam'   → beam-rectangular mid-density
//   'footing'→ spread-footing mid-density
//   'stair'  → stair mid-density
// ─────────────────────────────────────────────────────────────────────────────

const ELEMENT_TYPE_MAP: Record<string, ConcreteElementType> = {
  'wall':    'shear-wall',
  'slab':    'suspended-slab',
  'column':  'column-tied',
  'beam':    'beam-rectangular',
  'footing': 'spread-footing',
  'stair':   'stair',
};

/**
 * Return rebar density (kg/m³) for a named element class, applying seismic adder.
 * Uses mid-range density from REBAR_DENSITY_TABLE (CSA G30.18 calibrated).
 * Falls back to 100 kg/m³ if type is unknown — this fallback triggers a warning.
 */
export function rebarDensityFor(
  elementClass: 'wall' | 'slab' | 'column' | 'beam' | 'footing' | 'stair' | string,
  seismicZone?: 'low' | 'moderate' | 'high'
): number {
  const concreteType = ELEMENT_TYPE_MAP[elementClass];
  if (!concreteType) {
    console.warn(`[rebar-density] Unknown element class "${elementClass}" — using 100 kg/m³ fallback. Add to ELEMENT_TYPE_MAP.`);
    return 100;
  }
  const entry = getDensity(concreteType);
  if (!entry) {
    console.warn(`[rebar-density] No density entry for ConcreteElementType "${concreteType}" — using 100 kg/m³ fallback.`);
    return 100;
  }
  let density = entry.densityMid;
  if (seismicZone === 'high')     density += entry.seismicAdder;
  if (seismicZone === 'moderate') density += entry.seismicAdder * 0.5;
  return density;
}
