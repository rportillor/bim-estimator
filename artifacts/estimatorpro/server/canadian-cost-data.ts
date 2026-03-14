// server/canadian-cost-data.ts
//
// Canadian Provincial & Regional Construction Cost Factors
// ─────────────────────────────────────────────────────────
//
// Source baseline: Statistics Canada Table 34-10-0175 (Building Construction Price Index)
//                  BCPI Q4 2025 release — January 27, 2026
//                  RSMeans Canadian Construction Cost Data (2025 edition)
//                  CIQS Regional Cost Analysis (2025)
//                  Gordian/RSMeans Q4 2025 CCI update (Historical Index = 304.2)
//
// compositeIndex: Weighted factor applied to base rates in estimate-engine.ts.
//   1.00 = Greater Toronto Area baseline
//   Factors reflect relative cost of labour, materials, equipment, and transportation.
//
// materialIndex / laborIndex / equipmentIndex: Granular factors for
//   advanced analysis (budget-structure.ts escalation, labor-burden.ts).
//
// All factors represent Q1 2026 pricing relative to GTA baseline.
//
// ─── Key market movements validated against BCPI Q4 2025 ────────────────────
//
//  Toronto (GTA baseline):      +0.5% Q4 2025 residential (modest, slow market)
//  Ottawa non-residential:      +0.6% Q4 2025
//  London, ON non-residential:  +2.3% Q4 2025 (labour pressure — highest in Canada)
//  Vancouver non-residential:   -0.1% Q4 2025 (only CMA to decline — softening)
//  Quebec composite:            +3.8% through Q4 2025 (sustained wage pressure)
//  Residential YoY composite:   +3.0% (15-CMA composite)
//  Non-residential YoY:         +4.1% (15-CMA composite)
//  Labour wages nationally:     +4.1% YoY; +4.5% projected 2026 (RSMeans 2025)
//
// ─── 2025–2026 Tariff caution ────────────────────────────────────────────────
//
//  Canada's counter-tariffs on U.S. steel and aluminum (March 2025+) continue
//  to create material cost volatility. Key BCPI YoY movements:
//    Structural steel       (Div 05): +3.1%
//    Metal fabrications     (Div 05): +1.6%
//    Plumbing piping/fixtures (Div 22): +4.2%
//    HVAC equipment         (Div 23): +3.4%
//    Electrical materials   (Div 26): -1.7% Q4 (alternate sourcing relief)
//    Lumber/wood            (Div 06): -0.6% Q4
//    Concrete               (Div 03): -0.3% Q4 (demand softening)
//  Price protection clauses of 30–60 days now standard in metal-intensive tenders.
//  Obtain firm supplier quotes for all steel, plumbing, and HVAC material packages.

export interface RegionalCostFactor {
  compositeIndex: number;
  materialIndex: number;
  laborIndex: number;
  equipmentIndex: number;
  transportFactor: number;
  remoteFactor: number;       // Additional premium for remote/fly-in sites
  hstGstRate: number;         // Combined sales tax rate
  taxDescription: string;     // e.g., "13% HST" or "5% GST + 9.975% QST"
  bcpiSource?: string;        // BCPI data reference note
}

// ─── Provincial / Regional Cost Factors ─────────────────────────────────────
//
// Keys use the format consumed by estimate-engine.ts:
//   "Ontario - Kawartha Lakes" → The Moorings project region
//   "Ontario - GTA"            → Greater Toronto Area (baseline = 1.00)
//
// Factor methodology:
//   compositeIndex = 0.40 × materialIndex + 0.45 × laborIndex + 0.15 × equipmentIndex
//   (weighted per CIQS typical Canadian building cost structure)
//
// Index changes from prior year calibration:
//   Quebec regions:             +0.02 to +0.03 (sustained above-GTA wage growth)
//   BC Vancouver:               -0.01 (Q4 2025 cost softening vs GTA)
//   Ontario Southwestern:       +0.01 (London-area growth outpacing GTA)

export const CANADIAN_PROVINCIAL_FACTORS: Record<string, RegionalCostFactor> = {

  // ══════════════════════════════════════════════════════════════════════════════
  // ONTARIO
  // ══════════════════════════════════════════════════════════════════════════════

  'Ontario - GTA': {
    // Baseline = 1.00. Toronto residential construction slowed in 2025 (high inventory,
    // affordability issues). Non-residential stable with government spending support.
    compositeIndex: 1.00,
    materialIndex: 1.00,
    laborIndex: 1.00,
    equipmentIndex: 1.00,
    transportFactor: 1.00,
    remoteFactor: 1.00,
    hstGstRate: 0.13,
    taxDescription: '13% HST',
    bcpiSource: 'BCPI Q4 2025 Toronto CMA — baseline reference',
  },

  'Ontario - Kawartha Lakes': {
    // Fenelon Falls / City of Kawartha Lakes — ~150 km NE of GTA.
    // UA Local 401 Zone 12 West (Oshawa/Peterborough/Belleville) ICI rates.
    // Lower labour wage scale than GTA per collective agreement schedule.
    // Transport premium for Fenelon Falls applies to heavy materials.
    compositeIndex: 0.92,
    materialIndex: 0.97,
    laborIndex: 0.88,              // UA Local 401 Zone 12 West ~88% of GTA ICI
    equipmentIndex: 0.93,
    transportFactor: 1.06,
    remoteFactor: 1.00,
    hstGstRate: 0.13,
    taxDescription: '13% HST',
    bcpiSource: 'UA Local 401 Zone 12 West ICI schedule May 2025; BCPI interpolation',
  },

  'Ontario - Ottawa': {
    // BCPI Q4 2025: Ottawa non-residential +0.6% vs GTA +0.5% — negligible difference.
    // Federal government construction maintains strong labour demand.
    compositeIndex: 0.97,
    materialIndex: 0.98,
    laborIndex: 0.96,
    equipmentIndex: 0.97,
    transportFactor: 1.02,
    remoteFactor: 1.00,
    hstGstRate: 0.13,
    taxDescription: '13% HST',
    bcpiSource: 'BCPI Q4 2025 Ottawa-Gatineau (Ontario part) CMA',
  },

  'Ontario - Southwestern': {
    // London, Windsor, Kitchener-Waterloo, Hamilton corridor.
    // BCPI Q4 2025: London +2.3% Q4 (highest non-residential growth in Canada).
    // Composite nudged from 0.90 → 0.91 reflecting narrowing gap with GTA.
    compositeIndex: 0.91,
    materialIndex: 0.95,
    laborIndex: 0.87,
    equipmentIndex: 0.92,
    transportFactor: 1.03,
    remoteFactor: 1.00,
    hstGstRate: 0.13,
    taxDescription: '13% HST',
    bcpiSource: 'BCPI Q4 2025 London CMA (+2.3% Q4 — leading indicator)',
  },

  'Ontario - Northern': {
    // Sudbury, Thunder Bay, Sault Ste. Marie, North Bay.
    // Limited skilled trades; distance premium; extended supply chains.
    compositeIndex: 1.08,
    materialIndex: 1.05,
    laborIndex: 1.06,
    equipmentIndex: 1.10,
    transportFactor: 1.15,
    remoteFactor: 1.10,
    hstGstRate: 0.13,
    taxDescription: '13% HST',
    bcpiSource: 'CIQS Regional Cost Analysis 2025 — Northern Ontario',
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // BRITISH COLUMBIA
  // ══════════════════════════════════════════════════════════════════════════════

  'British Columbia - Vancouver': {
    // BCPI Q4 2025: Vancouver non-residential -0.1% — only CMA to decline.
    // Slower construction starts; some labour cost relief vs prior year.
    // Composite reduced from 1.12 to 1.11 reflecting relative softening.
    compositeIndex: 1.11,
    materialIndex: 1.09,
    laborIndex: 1.17,
    equipmentIndex: 1.05,
    transportFactor: 1.05,
    remoteFactor: 1.00,
    hstGstRate: 0.12,
    taxDescription: '5% GST + 7% PST',
    bcpiSource: 'BCPI Q4 2025 Vancouver CMA (−0.1% Q4 non-residential)',
  },

  'British Columbia - Interior': {
    // Kelowna, Kamloops, Prince George, Vernon.
    compositeIndex: 1.02,
    materialIndex: 1.05,
    laborIndex: 0.98,
    equipmentIndex: 1.02,
    transportFactor: 1.08,
    remoteFactor: 1.05,
    hstGstRate: 0.12,
    taxDescription: '5% GST + 7% PST',
    bcpiSource: 'RSMeans CCI 2025 — BC Interior interpolation',
  },

  'British Columbia - Northern': {
    // Prince Rupert, Fort Nelson, Dawson Creek. Resource project construction.
    compositeIndex: 1.18,
    materialIndex: 1.12,
    laborIndex: 1.15,
    equipmentIndex: 1.18,
    transportFactor: 1.20,
    remoteFactor: 1.15,
    hstGstRate: 0.12,
    taxDescription: '5% GST + 7% PST',
    bcpiSource: 'CIQS Regional Cost Analysis 2025 — BC Northern',
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // ALBERTA
  // ══════════════════════════════════════════════════════════════════════════════

  'Alberta - Calgary': {
    // Energy sector recovery sustaining commercial construction.
    // No PST — lowest tax rate in Canada for construction inputs.
    compositeIndex: 1.05,
    materialIndex: 1.03,
    laborIndex: 1.08,
    equipmentIndex: 1.02,
    transportFactor: 1.03,
    remoteFactor: 1.00,
    hstGstRate: 0.05,
    taxDescription: '5% GST (no PST)',
    bcpiSource: 'BCPI Q4 2025 Calgary CMA',
  },

  'Alberta - Edmonton': {
    // Slightly lower costs than Calgary; industrial and refinery construction active.
    compositeIndex: 1.03,
    materialIndex: 1.02,
    laborIndex: 1.05,
    equipmentIndex: 1.00,
    transportFactor: 1.04,
    remoteFactor: 1.00,
    hstGstRate: 0.05,
    taxDescription: '5% GST (no PST)',
    bcpiSource: 'BCPI Q4 2025 Edmonton CMA',
  },

  'Alberta - Fort McMurray': {
    // Oil sands construction zone. Camp-based labour; extreme weather premiums.
    // Highest continuous-construction labour rates in western Canada.
    compositeIndex: 1.35,
    materialIndex: 1.20,
    laborIndex: 1.45,
    equipmentIndex: 1.25,
    transportFactor: 1.25,
    remoteFactor: 1.20,
    hstGstRate: 0.05,
    taxDescription: '5% GST (no PST)',
    bcpiSource: 'CIQS Regional Cost Analysis 2025 — Alberta Oil Sands',
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // QUEBEC
  // ══════════════════════════════════════════════════════════════════════════════

  'Quebec - Montreal': {
    // BCPI Q4 2025: Quebec composite +3.8% through Q4 2025 — fastest growth in
    // Canada. Driven by CCQ (Commission de la construction du Québec) collective
    // agreement wage escalation and higher insurance costs.
    // Composite increased from 0.95 → 0.97 (labour gap vs GTA narrowing).
    compositeIndex: 0.97,
    materialIndex: 0.94,
    laborIndex: 0.99,
    equipmentIndex: 0.96,
    transportFactor: 1.00,
    remoteFactor: 1.00,
    hstGstRate: 0.14975,
    taxDescription: '5% GST + 9.975% QST',
    bcpiSource: 'BCPI Q4 2025 Montreal CMA (+3.8% composite YoY)',
  },

  'Quebec - Quebec City': {
    // Similar trajectory to Montreal; composite increased from 0.90 → 0.91.
    compositeIndex: 0.91,
    materialIndex: 0.93,
    laborIndex: 0.89,
    equipmentIndex: 0.93,
    transportFactor: 1.03,
    remoteFactor: 1.00,
    hstGstRate: 0.14975,
    taxDescription: '5% GST + 9.975% QST',
    bcpiSource: 'BCPI Q4 2025 Quebec City CMA',
  },

  'Quebec - Northern': {
    // James Bay, Labrador border, Chibougamau. Fly-in/drive-in camps standard.
    // Composite increased from 1.25 → 1.28 consistent with Quebec wage growth.
    compositeIndex: 1.28,
    materialIndex: 1.16,
    laborIndex: 1.28,
    equipmentIndex: 1.24,
    transportFactor: 1.30,
    remoteFactor: 1.25,
    hstGstRate: 0.14975,
    taxDescription: '5% GST + 9.975% QST',
    bcpiSource: 'CIQS Regional Cost Analysis 2025 — Quebec Northern',
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // PRAIRIE PROVINCES
  // ══════════════════════════════════════════════════════════════════════════════

  'Saskatchewan - Saskatoon': {
    // BCPI Q4 2025: Saskatoon non-residential +1.3% (above national average).
    // Potash and uranium mining construction driving demand.
    compositeIndex: 0.95,
    materialIndex: 0.98,
    laborIndex: 0.92,
    equipmentIndex: 0.95,
    transportFactor: 1.08,
    remoteFactor: 1.00,
    hstGstRate: 0.11,
    taxDescription: '5% GST + 6% PST',
    bcpiSource: 'BCPI Q4 2025 Saskatoon CMA (+1.3% Q4)',
  },

  'Saskatchewan - Northern': {
    // Remote mining communities; uranium belt; camp labour.
    compositeIndex: 1.15,
    materialIndex: 1.10,
    laborIndex: 1.12,
    equipmentIndex: 1.15,
    transportFactor: 1.22,
    remoteFactor: 1.15,
    hstGstRate: 0.11,
    taxDescription: '5% GST + 6% PST',
    bcpiSource: 'CIQS Regional Cost Analysis 2025 — Saskatchewan Northern',
  },

  'Manitoba - Winnipeg': {
    // RST (retail sales tax) applies to most building materials in Manitoba.
    compositeIndex: 0.92,
    materialIndex: 0.95,
    laborIndex: 0.90,
    equipmentIndex: 0.92,
    transportFactor: 1.05,
    remoteFactor: 1.00,
    hstGstRate: 0.12,
    taxDescription: '5% GST + 7% RST',
    bcpiSource: 'BCPI Q4 2025 Winnipeg CMA',
  },

  'Manitoba - Northern': {
    // Thompson, Flin Flon, Churchill. Mine and hydro construction.
    compositeIndex: 1.20,
    materialIndex: 1.12,
    laborIndex: 1.18,
    equipmentIndex: 1.20,
    transportFactor: 1.28,
    remoteFactor: 1.20,
    hstGstRate: 0.12,
    taxDescription: '5% GST + 7% RST',
    bcpiSource: 'CIQS Regional Cost Analysis 2025 — Manitoba Northern',
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // ATLANTIC PROVINCES
  // ══════════════════════════════════════════════════════════════════════════════

  'Nova Scotia - Halifax': {
    // BCPI Q4 2025: Moncton +0.8%; Halifax tracks similar trajectory.
    // Significant federal/naval infrastructure investment offsetting lower local demand.
    compositeIndex: 0.88,
    materialIndex: 0.95,
    laborIndex: 0.82,
    equipmentIndex: 0.90,
    transportFactor: 1.10,
    remoteFactor: 1.00,
    hstGstRate: 0.15,
    taxDescription: '15% HST',
    bcpiSource: 'BCPI Q4 2025 Halifax CMA interpolation',
  },

  'New Brunswick - Moncton': {
    // BCPI Q4 2025: Moncton non-residential +0.8% Q4.
    compositeIndex: 0.85,
    materialIndex: 0.93,
    laborIndex: 0.78,
    equipmentIndex: 0.88,
    transportFactor: 1.12,
    remoteFactor: 1.00,
    hstGstRate: 0.15,
    taxDescription: '15% HST',
    bcpiSource: 'BCPI Q4 2025 Moncton CMA',
  },

  'Prince Edward Island': {
    // Island ferry transport adds to material costs. Limited trade availability.
    compositeIndex: 0.83,
    materialIndex: 0.95,
    laborIndex: 0.75,
    equipmentIndex: 0.85,
    transportFactor: 1.15,
    remoteFactor: 1.05,
    hstGstRate: 0.15,
    taxDescription: '15% HST',
    bcpiSource: 'RSMeans CCI 2025 — PEI interpolation',
  },

  'Newfoundland - St. Johns': {
    // Offshore energy sector drives skilled trade demand; ferry supply chain.
    compositeIndex: 0.90,
    materialIndex: 1.00,
    laborIndex: 0.85,
    equipmentIndex: 0.88,
    transportFactor: 1.18,
    remoteFactor: 1.05,
    hstGstRate: 0.15,
    taxDescription: '15% HST',
    bcpiSource: "BCPI Q4 2025 St. John's CMA",
  },

  'Newfoundland - Labrador': {
    // Labrador City, Wabush, Churchill Falls. Fly-in/drive-in camp construction.
    compositeIndex: 1.30,
    materialIndex: 1.18,
    laborIndex: 1.30,
    equipmentIndex: 1.25,
    transportFactor: 1.35,
    remoteFactor: 1.25,
    hstGstRate: 0.15,
    taxDescription: '15% HST',
    bcpiSource: 'CIQS Regional Cost Analysis 2025 — Labrador',
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // TERRITORIES
  // ══════════════════════════════════════════════════════════════════════════════

  'Yukon - Whitehorse': {
    // Permafrost challenges; air freight for most materials outside barge season.
    compositeIndex: 1.25,
    materialIndex: 1.18,
    laborIndex: 1.25,
    equipmentIndex: 1.22,
    transportFactor: 1.30,
    remoteFactor: 1.15,
    hstGstRate: 0.05,
    taxDescription: '5% GST (no territorial tax)',
    bcpiSource: 'CIQS Regional Cost Analysis 2025 — Yukon',
  },

  'Northwest Territories - Yellowknife': {
    // Barge season July–September is primary supply window for heavy materials.
    // Diamond mining and government construction; extreme cold weather premium.
    compositeIndex: 1.40,
    materialIndex: 1.25,
    laborIndex: 1.45,
    equipmentIndex: 1.35,
    transportFactor: 1.40,
    remoteFactor: 1.25,
    hstGstRate: 0.05,
    taxDescription: '5% GST (no territorial tax)',
    bcpiSource: 'CIQS Regional Cost Analysis 2025 — NWT',
  },

  'Nunavut - Iqaluit': {
    // Air-only supply chain for virtually all materials. Extreme cold (-50°C).
    // Federal government primary client. Highest construction costs in Canada.
    compositeIndex: 1.85,
    materialIndex: 1.55,
    laborIndex: 1.95,
    equipmentIndex: 1.70,
    transportFactor: 1.80,
    remoteFactor: 1.60,
    hstGstRate: 0.05,
    taxDescription: '5% GST (no territorial tax)',
    bcpiSource: 'CIQS Regional Cost Analysis 2025 — Nunavut Iqaluit',
  },

  'Nunavut - Remote Community': {
    // Beyond Iqaluit — accessible by seasonal ice road or air only year-round.
    // Maximum remoteness premium. All materials air-freighted.
    compositeIndex: 2.20,
    materialIndex: 1.80,
    laborIndex: 2.30,
    equipmentIndex: 2.00,
    transportFactor: 2.20,
    remoteFactor: 2.00,
    hstGstRate: 0.05,
    taxDescription: '5% GST (no territorial tax)',
    bcpiSource: 'CIQS Regional Cost Analysis 2025 — Nunavut Remote Communities',
  },
};

// ─── Convenience functions ──────────────────────────────────────────────────

/**
 * Get composite index for a region, with fallback to 1.0 (GTA baseline).
 * Callers should log a warning when region is not found — do not silently
 * apply GTA rates to an unrecognized region.
 */
export function getRegionalFactor(region: string): number {
  return CANADIAN_PROVINCIAL_FACTORS[region]?.compositeIndex ?? 1.0;
}

/**
 * Get full regional data, or null if region not found.
 */
export function getRegionalData(region: string): RegionalCostFactor | null {
  return CANADIAN_PROVINCIAL_FACTORS[region] ?? null;
}

/**
 * List all available regions.
 */
export function getAvailableRegions(): string[] {
  return Object.keys(CANADIAN_PROVINCIAL_FACTORS);
}

/**
 * Get applicable tax rate for a region.
 */
export function getRegionalTaxRate(region: string): { rate: number; description: string } {
  const data = CANADIAN_PROVINCIAL_FACTORS[region];
  if (data) {
    return { rate: data.hstGstRate, description: data.taxDescription };
  }
  return { rate: 0.13, description: '13% HST (Ontario fallback — region not found)' };
}

/**
 * Returns the BCPI data source note for a region, if available.
 */
export function getRegionalSourceNote(region: string): string | null {
  return CANADIAN_PROVINCIAL_FACTORS[region]?.bcpiSource ?? null;
}

// ─── Summary ────────────────────────────────────────────────────────────────

export const REGION_COUNT = Object.keys(CANADIAN_PROVINCIAL_FACTORS).length;

// ─── Data currency ───────────────────────────────────────────────────────────
//
// Calibrated against:
//   Statistics Canada BCPI Q4 2025 — released January 27, 2026
//   RSMeans CCI Q4 2025 (Historical Index = 304.2)
//   UA Local 401 ICI Collective Agreement — effective May 1, 2025
//   UA Local 787 HVACR ICI Rates — 2025
//   Government of Canada Job Bank wage data — Q4 2025
//
// Next recommended review: Q2 2026 (April 2026 BCPI release)
// For projects >$500K metal-intensive content: obtain current supplier quotes.
