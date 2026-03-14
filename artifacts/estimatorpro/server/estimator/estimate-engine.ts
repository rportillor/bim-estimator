// server/estimator/estimate-engine.ts
// v15.17 — CIQS OPENING DEDUCTIONS + QTO SANITY CHECK + CSA G30.18 REBAR
// - ADV-1: rebarDensityFor() from rebar-density.ts replaces 4 hardcoded multipliers
// - ADV-3: Labor rate basis declared (Ontario ICI Q1 2026 fully-loaded all-in rates)
// - CODE-1: CIQS opening deductions — wall openings >0.5 m², slab penetrations >1.0 m²
// - CODE-2: QTO cross-check vs GFA — flags LOW_CONFIDENCE if >15% variance
// - All 34 CSI MasterFormat 2018 active divisions (01–48)
// - 212 unique rate entries with M/L/E breakdown per CIQS methodology
// - Material-specific waste factors applied after net QTO (CIQS standard practice)
// - Per-floor cost totals using storeyName from BIM elements
//
// ─── LABOR RATE BASIS DECLARATION (ADV-3) ────────────────────────────────────
// All laborRate values in CSI_RATES are FULLY-LOADED ALL-IN rates for Ontario ICI
// construction, Q1 2026 base date. Each laborRate includes:
//   • Base wage per Ontario MLITSD prevailing wage schedule
//   • Statutory burden: CPP (employer 5.95%), EI (employer 2.62%), WSIB (~2.0–4.0%)
//   • Employer Health Tax (EHT): 1.95% on Ontario payroll
//   • Vacation pay: 4% on gross wages
//   • Union fringe benefits (health & welfare, pension, training fund)
//   • Supervision allowance: ~10–15% blended into crew productivity
// Source: Ontario MLITSD prevailing wages + CIQS Ontario Regional Benchmarks.
// MEP labor (Div 21–28): UA Local 46/401/524/787 and IBEW 353/586/636 CAs.
// ─────────────────────────────────────────────────────────────────────────────

import { CANADIAN_PROVINCIAL_FACTORS } from '../canadian-cost-data';
import { storage } from '../storage';
import { getMepRate, MEPRateItem } from './ontario-mep-rates';
import { rebarDensityFor } from './rebar-density';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EstimateLineItem {
  csiCode: string;
  csiDivision: string;
  csiDivisionName: string;
  csiSubdivision: string;        // Full CSI code (e.g. "033000-CONC") — alias for downstream consumers
  description: string;
  unit: string;
  quantity: number;
  baseQuantity: number;         // QTO quantity BEFORE waste
  wastePercent: number;         // material waste factor (0.05 = 5%)
  wasteQuantity: number;        // quantity added for waste
  materialRate: number;
  laborRate: number;
  equipmentRate: number;
  totalRate: number;
  materialCost: number;
  laborCost: number;
  equipmentCost: number;
  totalCost: number;
  floor: string;
  elementIds: string[];
  evidenceRefs: string[];
  crewSize?: number;
  productivityRate?: number;
  laborHours?: number;
  verificationStatus: 'verified' | 'incomplete' | 'estimated' | 'missing_dimensions';
  gridRef?: string;                // Grid reference (e.g., "A-3") from detected grid data
}

export interface FloorSummary {
  floor: string;
  floorLabel: string;             // Same as floor — alias for downstream consumers
  lineItems: EstimateLineItem[];
  materialTotal: number;
  laborTotal: number;
  equipmentTotal: number;
  subtotal: number;
  /** CIQS benchmark metric: total direct cost / gross floor area for this level */
  costPerM2?: number;
  /** Total labour-hours on this floor (resource-loading for schedule) */
  totalLaborHours?: number;
}

export interface QtoSanityCheck {
  passed: boolean;
  warnings: string[];
  checks: {
    name: string;
    extracted: number;
    expected: number;
    variance: number;
    threshold: number;
    passed: boolean;
    unit: string;
  }[];
  doorCountFromElements: number;
  doorCountFromSchedule: number;
  windowCountFromElements: number;
  windowCountFromSchedule: number;
  totalWallAreaExtracted: number;
  totalSlabAreaExtracted: number;
  totalSlabVolumeExtracted: number;
  grossFloorArea: number;
}

export interface EstimateSummary {
  floors: FloorSummary[];
  grandTotal: number;
  materialGrandTotal: number;
  laborGrandTotal: number;
  equipmentGrandTotal: number;
  wasteGrandTotal: number;
  incompleteElements: number;
  skippedElements: string[];
  currency: 'CAD';
  region: string;
  regionalFactor: number;
  methodology: 'CIQS';
  generatedAt: string;
  lineItemCount: number;
  csiDivisionsUsed: number;
  /** Total direct-cost / GFA — primary CIQS benchmark metric (CAD/m²) */
  costPerM2?: number;
  /** Total project labour-hours across all trades — for resource-loading / schedule */
  totalLaborHours?: number;
  sanityCheck?: QtoSanityCheck;
  openingDeductionsSummary?: {
    wallsWithDeductions: number;
    totalAreaDeducted: number;
    slabsWithDeductions: number;
    totalVolumeDeducted: number;
  };
  quantityWarnings?: { csiCode: string; description: string; floor: string; reason: string }[];
}

// ─── Rate Tables — Canadian Construction (CAD/unit, Ontario 2025 baseline) ───
// Source baseline: CIQS Elemental Cost Analysis, RSMeans Canadian Edition
// These are BASE rates before regional adjustment.

export interface RateEntry {
  materialRate: number;
  laborRate: number;
  equipmentRate: number;
  unit: string;
  crewSize: number;
  productivityRate: number; // units per crew-hour
  /** Source citation for rate data (CIQS/AACE RP 34R-05 audit trail) */
  source?: string;
  /** ISO date string — price level date for this rate */
  priceDate?: string;
  /** ISO date string — when this rate was last verified against market */
  lastVerified?: string;
}

export const CSI_RATES: Record<string, RateEntry> = {

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 01: GENERAL REQUIREMENTS
  // ══════════════════════════════════════════════════════════════════════════════
  '011000-GENERAL':      { materialRate: 0,     laborRate: 45,    equipmentRate: 0,     unit: 'hr',  crewSize: 1,  productivityRate: 1 },
  '013000-ADMIN':        { materialRate: 0,     laborRate: 55,    equipmentRate: 0,     unit: 'hr',  crewSize: 1,  productivityRate: 1 },
  '014000-QA-TEST':      { materialRate: 5,     laborRate: 95,    equipmentRate: 15,    unit: 'hr',  crewSize: 1,  productivityRate: 1 },
  '015000-TEMP':         { materialRate: 8.50,  laborRate: 12,    equipmentRate: 5,     unit: 'm²',  crewSize: 2,  productivityRate: 25 },
  '017000-CLEANUP':      { materialRate: 2,     laborRate: 28,    equipmentRate: 8,     unit: 'm²',  crewSize: 3,  productivityRate: 40 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 02: EXISTING CONDITIONS
  // ══════════════════════════════════════════════════════════════════════════════
  '024100-DEMO':         { materialRate: 0,     laborRate: 35,    equipmentRate: 45,    unit: 'm³',  crewSize: 3,  productivityRate: 8 },
  '024100-DEMO-SEL':     { materialRate: 0,     laborRate: 42,    equipmentRate: 28,    unit: 'm²',  crewSize: 2,  productivityRate: 12 },
  '024200-ABATE':        { materialRate: 15,    laborRate: 65,    equipmentRate: 18,    unit: 'm²',  crewSize: 4,  productivityRate: 6 },
  '022000-ASSESS':       { materialRate: 0,     laborRate: 110,   equipmentRate: 25,    unit: 'hr',  crewSize: 2,  productivityRate: 1 },
  '023000-GEOTECH':      { materialRate: 250,   laborRate: 185,   equipmentRate: 380,   unit: 'm',   crewSize: 3,  productivityRate: 4 },
  '027000-WATER-REMED':  { materialRate: 15,    laborRate: 42,    equipmentRate: 28,    unit: 'm²',  crewSize: 3,  productivityRate: 10 },
  '026000-CONTAM-REMOVE': { materialRate: 25,   laborRate: 75,    equipmentRate: 45,    unit: 'm³',  crewSize: 4,  productivityRate: 5 },
  '028000-FACILITY-REMED': { materialRate: 12,  laborRate: 55,    equipmentRate: 35,    unit: 'm²',  crewSize: 3,  productivityRate: 8 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 03: CONCRETE
  // ══════════════════════════════════════════════════════════════════════════════
    // -- Foundations & Below-Grade (CSI 03 11 / 03 30) --
  // Source: RSMeans Canadian 2024; CIQS Elemental Cost Analysis; Ontario market Q4 2025
  '033100-FOOT-FORM':    { materialRate: 25,    laborRate: 42,    equipmentRate: 6,     unit: 'm²',  crewSize: 4,  productivityRate: 10 },
  '033100-FOOT-CONC':    { materialRate: 185,   laborRate: 52,    equipmentRate: 28,    unit: 'm³',  crewSize: 6,  productivityRate: 2.5 },
  '033100-FOOT-REBAR':   { materialRate: 2.85,  laborRate: 1.50,  equipmentRate: 0.15,  unit: 'kg',  crewSize: 3,  productivityRate: 200 },
  '033100-GRADE-BEAM':   { materialRate: 195,   laborRate: 58,    equipmentRate: 30,    unit: 'm³',  crewSize: 5,  productivityRate: 2 },
  '033100-GRADE-FORM':   { materialRate: 22,    laborRate: 40,    equipmentRate: 5,     unit: 'm²',  crewSize: 4,  productivityRate: 11 },
  '033100-MAT-FOUND':    { materialRate: 185,   laborRate: 42,    equipmentRate: 22,    unit: 'm³',  crewSize: 8,  productivityRate: 4 },
  '033100-SOG':          { materialRate: 185,   laborRate: 38,    equipmentRate: 20,    unit: 'm³',  crewSize: 6,  productivityRate: 3.5 },
  '033100-SOG-FORM':     { materialRate: 12,    laborRate: 22,    equipmentRate: 3,     unit: 'm',   crewSize: 2,  productivityRate: 25 },
  '033200-RET-WALL-FORM':{ materialRate: 24,    laborRate: 40,    equipmentRate: 5,     unit: 'm²',  crewSize: 4,  productivityRate: 10 },
  '033200-RET-WALL-CONC':{ materialRate: 190,   laborRate: 50,    equipmentRate: 28,    unit: 'm³',  crewSize: 6,  productivityRate: 2.5 },
  '033200-RET-WALL-WTPF':{ materialRate: 18,    laborRate: 12,    equipmentRate: 2,     unit: 'm²',  crewSize: 3,  productivityRate: 20 },
  '033200-DRAIN-BOARD':  { materialRate: 22,    laborRate: 8,     equipmentRate: 1,     unit: 'm²',  crewSize: 2,  productivityRate: 30 },
  '033000-FORM':         { materialRate: 22,    laborRate: 38,    equipmentRate: 5,     unit: 'm²',  crewSize: 4,  productivityRate: 12 },
  '033000-REBAR':        { materialRate: 2.85,  laborRate: 1.50,  equipmentRate: 0.15,  unit: 'kg',  crewSize: 3,  productivityRate: 200 },
  '033000-CONC':         { materialRate: 185,   laborRate: 45,    equipmentRate: 25,    unit: 'm³',  crewSize: 6,  productivityRate: 3 },
  '033000-SLAB-CONC':    { materialRate: 185,   laborRate: 45,    equipmentRate: 25,    unit: 'm³',  crewSize: 6,  productivityRate: 3 },
  '033000-SLAB-FORM':    { materialRate: 18,    laborRate: 32,    equipmentRate: 4,     unit: 'm²',  crewSize: 4,  productivityRate: 15 },
  '033000-COL-FORM':     { materialRate: 28,    laborRate: 42,    equipmentRate: 6,     unit: 'm²',  crewSize: 3,  productivityRate: 8 },
  '033000-COL-CONC':     { materialRate: 195,   laborRate: 55,    equipmentRate: 30,    unit: 'm³',  crewSize: 5,  productivityRate: 2 },
  '033000-BEAM-FORM':    { materialRate: 30,    laborRate: 44,    equipmentRate: 6,     unit: 'm²',  crewSize: 3,  productivityRate: 7 },
  '033000-BEAM-CONC':    { materialRate: 195,   laborRate: 50,    equipmentRate: 28,    unit: 'm³',  crewSize: 5,  productivityRate: 2.5 },
  '033000-STAIR-CONC':   { materialRate: 210,   laborRate: 65,    equipmentRate: 32,    unit: 'm³',  crewSize: 5,  productivityRate: 1.5 },
  '034000-PRECAST':      { materialRate: 145,   laborRate: 55,    equipmentRate: 40,    unit: 'm²',  crewSize: 4,  productivityRate: 8 },
  '035000-UNDERLAYMENT': { materialRate: 28,    laborRate: 22,    equipmentRate: 5,     unit: 'm²',  crewSize: 3,  productivityRate: 18 },
  '036000-GROUT':        { materialRate: 35,    laborRate: 48,    equipmentRate: 8,     unit: 'm',   crewSize: 2,  productivityRate: 12 },
  '038000-SAW-CUT':      { materialRate: 5,     laborRate: 45,    equipmentRate: 35,    unit: 'm',   crewSize: 2,  productivityRate: 8 },
  '037000-MASS-CONC':    { materialRate: 165,   laborRate: 55,    equipmentRate: 35,    unit: 'm³',  crewSize: 8,  productivityRate: 2 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 04: MASONRY
  // ══════════════════════════════════════════════════════════════════════════════
  '042000-CMU':          { materialRate: 32,    laborRate: 48,    equipmentRate: 3,     unit: 'm²',  crewSize: 3,  productivityRate: 6 },
  '042000-BRICK':        { materialRate: 65,    laborRate: 72,    equipmentRate: 5,     unit: 'm²',  crewSize: 3,  productivityRate: 4 },
  '044000-STONE':        { materialRate: 120,   laborRate: 95,    equipmentRate: 8,     unit: 'm²',  crewSize: 3,  productivityRate: 3 },
  '047000-MFG-STONE':    { materialRate: 85,    laborRate: 65,    equipmentRate: 5,     unit: 'm²',  crewSize: 2,  productivityRate: 5 },
  '045000-REFRACTORY':   { materialRate: 145,   laborRate: 95,    equipmentRate: 12,    unit: 'm²',  crewSize: 3,  productivityRate: 4 },
  '046000-CORR-MASONRY': { materialRate: 125,   laborRate: 85,    equipmentRate: 8,     unit: 'm²',  crewSize: 3,  productivityRate: 4 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 05: METALS
  // ══════════════════════════════════════════════════════════════════════════════
  '051200-STRUCT-STL':   { materialRate: 3.25,  laborRate: 2.10,  equipmentRate: 0.85,  unit: 'kg',  crewSize: 4,  productivityRate: 150 },
  '052100-JOIST':        { materialRate: 3.50,  laborRate: 2.40,  equipmentRate: 1.00,  unit: 'kg',  crewSize: 4,  productivityRate: 120 },
  '053000-METAL-DECK':   { materialRate: 22,    laborRate: 18,    equipmentRate: 8,     unit: 'm²',  crewSize: 4,  productivityRate: 20 },
  '054000-CFS-FRAME':    { materialRate: 25,    laborRate: 32,    equipmentRate: 4,     unit: 'm²',  crewSize: 3,  productivityRate: 10 },
  '054000-CLAD':         { materialRate: 85,    laborRate: 55,    equipmentRate: 12,    unit: 'm²',  crewSize: 3,  productivityRate: 8 },
  '055000-MISC-MTL':     { materialRate: 4.20,  laborRate: 2.80,  equipmentRate: 0.60,  unit: 'kg',  crewSize: 2,  productivityRate: 80 },
  '055200-RAILING':      { materialRate: 185,   laborRate: 95,    equipmentRate: 12,    unit: 'm',   crewSize: 2,  productivityRate: 6 },
  '057000-DECOR-MTL':    { materialRate: 320,   laborRate: 165,   equipmentRate: 18,    unit: 'm²',  crewSize: 2,  productivityRate: 3 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 06: WOOD, PLASTICS & COMPOSITES
  // ══════════════════════════════════════════════════════════════════════════════
  '061000-FRAMING':      { materialRate: 28,    laborRate: 35,    equipmentRate: 4,     unit: 'm²',  crewSize: 3,  productivityRate: 10 },
  '062000-FINISH-CARP':  { materialRate: 18,    laborRate: 42,    equipmentRate: 2,     unit: 'm²',  crewSize: 2,  productivityRate: 8 },
  '061700-STRUCT-PANEL': { materialRate: 32,    laborRate: 28,    equipmentRate: 5,     unit: 'm²',  crewSize: 3,  productivityRate: 12 },
  '064000-ARCH-WOOD':    { materialRate: 45,    laborRate: 55,    equipmentRate: 5,     unit: 'm²',  crewSize: 2,  productivityRate: 6 },
  '067000-ENG-WOOD':     { materialRate: 75,    laborRate: 45,    equipmentRate: 18,    unit: 'm²',  crewSize: 3,  productivityRate: 8 },
  '065000-STRUCT-PLASTIC': { materialRate: 95,  laborRate: 55,    equipmentRate: 12,    unit: 'm²',  crewSize: 3,  productivityRate: 8 },
  '066000-PLASTIC-FAB':  { materialRate: 65,    laborRate: 42,    equipmentRate: 8,     unit: 'm²',  crewSize: 2,  productivityRate: 10 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 07: THERMAL & MOISTURE PROTECTION
  // ══════════════════════════════════════════════════════════════════════════════
  '071000-WATERPROOF':   { materialRate: 22,    laborRate: 18,    equipmentRate: 2,     unit: 'm²',  crewSize: 2,  productivityRate: 20 },
  '072000-INSULATION':   { materialRate: 15,    laborRate: 12,    equipmentRate: 1,     unit: 'm²',  crewSize: 2,  productivityRate: 30 },
  '072500-AIR-BARRIER':  { materialRate: 4,     laborRate: 6,     equipmentRate: 1,     unit: 'm²',  crewSize: 2,  productivityRate: 35 },
  '074000-METAL-PANEL':  { materialRate: 48,    laborRate: 35,    equipmentRate: 8,     unit: 'm²',  crewSize: 3,  productivityRate: 10 },
  '075000-ROOFING':      { materialRate: 45,    laborRate: 35,    equipmentRate: 8,     unit: 'm²',  crewSize: 4,  productivityRate: 12 },
  '076000-FLASH-SHEET':  { materialRate: 18,    laborRate: 22,    equipmentRate: 2,     unit: 'm',   crewSize: 2,  productivityRate: 15 },
  '077000-GUTTER':       { materialRate: 28,    laborRate: 22,    equipmentRate: 3,     unit: 'm',   crewSize: 2,  productivityRate: 12 },
  '078000-FIRESTOP':     { materialRate: 18,    laborRate: 22,    equipmentRate: 2,     unit: 'm',   crewSize: 2,  productivityRate: 10 },
  '079000-SEALANTS':     { materialRate: 8,     laborRate: 15,    equipmentRate: 1,     unit: 'm',   crewSize: 1,  productivityRate: 25 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 08: OPENINGS
  // ══════════════════════════════════════════════════════════════════════════════
  '081000-DOOR-HM':      { materialRate: 850,   laborRate: 180,   equipmentRate: 20,    unit: 'ea',  crewSize: 2,  productivityRate: 3 },
  '081000-DOOR-WD':      { materialRate: 650,   laborRate: 160,   equipmentRate: 15,    unit: 'ea',  crewSize: 2,  productivityRate: 3 },
  '083100-ACCESS-DOOR':  { materialRate: 280,   laborRate: 85,    equipmentRate: 10,    unit: 'ea',  crewSize: 1,  productivityRate: 5 },
  '085000-WINDOW':       { materialRate: 420,   laborRate: 140,   equipmentRate: 25,    unit: 'ea',  crewSize: 2,  productivityRate: 4 },
  '088000-GLAZING':      { materialRate: 185,   laborRate: 65,    equipmentRate: 15,    unit: 'm²',  crewSize: 2,  productivityRate: 6 },
  '084000-CURTAIN-WALL': { materialRate: 285,   laborRate: 145,   equipmentRate: 45,    unit: 'm²',  crewSize: 4,  productivityRate: 4 },
  '086000-SKYLIGHT':     { materialRate: 950,   laborRate: 320,   equipmentRate: 85,    unit: 'ea',  crewSize: 3,  productivityRate: 2 },
  '089000-LOUVER':       { materialRate: 220,   laborRate: 95,    equipmentRate: 15,    unit: 'ea',  crewSize: 2,  productivityRate: 4 },
  '087000-HARDWARE':     { materialRate: 185,   laborRate: 55,    equipmentRate: 5,     unit: 'ea',  crewSize: 1,  productivityRate: 6 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 09: FINISHES
  // ══════════════════════════════════════════════════════════════════════════════
  '092000-PLASTER':      { materialRate: 12,    laborRate: 28,    equipmentRate: 2,     unit: 'm²',  crewSize: 2,  productivityRate: 12 },
  '092500-DRYWALL':      { materialRate: 8,     laborRate: 22,    equipmentRate: 2,     unit: 'm²',  crewSize: 2,  productivityRate: 15 },
  '093000-TILE':         { materialRate: 55,    laborRate: 65,    equipmentRate: 3,     unit: 'm²',  crewSize: 2,  productivityRate: 5 },
  '095000-CEILING':      { materialRate: 18,    laborRate: 15,    equipmentRate: 3,     unit: 'm²',  crewSize: 2,  productivityRate: 18 },
  '096000-FLOORING':     { materialRate: 35,    laborRate: 28,    equipmentRate: 2,     unit: 'm²',  crewSize: 2,  productivityRate: 12 },
  '099000-PAINT':        { materialRate: 4,     laborRate: 12,    equipmentRate: 1,     unit: 'm²',  crewSize: 2,  productivityRate: 25 },
  '097000-WALL-FINISH':  { materialRate: 35,    laborRate: 28,    equipmentRate: 2,     unit: 'm²',  crewSize: 2,  productivityRate: 10 },
  '098000-ACOUSTIC':     { materialRate: 55,    laborRate: 35,    equipmentRate: 5,     unit: 'm²',  crewSize: 2,  productivityRate: 8 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 10: SPECIALTIES
  // ══════════════════════════════════════════════════════════════════════════════
  '101400-SIGNAGE':      { materialRate: 280,   laborRate: 120,   equipmentRate: 15,    unit: 'ea',  crewSize: 2,  productivityRate: 4 },
  '102100-TOILET-PART':  { materialRate: 650,   laborRate: 180,   equipmentRate: 25,    unit: 'ea',  crewSize: 2,  productivityRate: 3 },
  '102800-TOILET-ACC':   { materialRate: 85,    laborRate: 45,    equipmentRate: 5,     unit: 'ea',  crewSize: 1,  productivityRate: 8 },
  '104400-FIRE-EXTCAB':  { materialRate: 350,   laborRate: 65,    equipmentRate: 10,    unit: 'ea',  crewSize: 1,  productivityRate: 6 },
  '103000-FIREPLACE':    { materialRate: 2800,  laborRate: 1200,  equipmentRate: 350,   unit: 'ea',  crewSize: 3,  productivityRate: 0.5 },
  '105100-LOCKERS':      { materialRate: 420,   laborRate: 95,    equipmentRate: 15,    unit: 'ea',  crewSize: 2,  productivityRate: 5 },
  '105600-MAILBOXES':    { materialRate: 185,   laborRate: 55,    equipmentRate: 8,     unit: 'ea',  crewSize: 1,  productivityRate: 6 },
  '107000-EXT-SPECIALTY': { materialRate: 450,  laborRate: 185,   equipmentRate: 35,    unit: 'ea',  crewSize: 2,  productivityRate: 3 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 11: EQUIPMENT
  // ══════════════════════════════════════════════════════════════════════════════
  '111300-LOADING-DOCK':  { materialRate: 8500,  laborRate: 2200,  equipmentRate: 850,   unit: 'ea',  crewSize: 4,  productivityRate: 0.3 },
  '113100-LAUNDRY':       { materialRate: 1800,  laborRate: 350,   equipmentRate: 75,    unit: 'ea',  crewSize: 2,  productivityRate: 2 },
  '114000-FOOD-SVC':      { materialRate: 3500,  laborRate: 650,   equipmentRate: 120,   unit: 'ea',  crewSize: 3,  productivityRate: 1 },
  '116800-ATHLETIC':      { materialRate: 4200,  laborRate: 1500,  equipmentRate: 350,   unit: 'ea',  crewSize: 3,  productivityRate: 0.5 },
  '117300-LAB-EQUIP':     { materialRate: 6500,  laborRate: 1800,  equipmentRate: 450,   unit: 'ea',  crewSize: 3,  productivityRate: 0.4 },
  '118000-WASTE-EQUIP':   { materialRate: 3200,  laborRate: 850,   equipmentRate: 280,   unit: 'ea',  crewSize: 2,  productivityRate: 1 },
  '111500-SECURITY-EQUIP': { materialRate: 8500, laborRate: 2200,  equipmentRate: 650,   unit: 'ea',  crewSize: 2,  productivityRate: 0.5 },
  '112000-COMMERCIAL-EQUIP': { materialRate: 3800, laborRate: 950, equipmentRate: 280,   unit: 'ea',  crewSize: 2,  productivityRate: 1 },
  '117000-HEALTHCARE-EQUIP': { materialRate: 12000, laborRate: 3500, equipmentRate: 850, unit: 'ea',  crewSize: 3,  productivityRate: 0.3 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 12: FURNISHINGS
  // ══════════════════════════════════════════════════════════════════════════════
  '123200-CASEWORK':      { materialRate: 285,   laborRate: 145,   equipmentRate: 15,    unit: 'm',   crewSize: 2,  productivityRate: 3 },
  '123600-COUNTERTOP':    { materialRate: 320,   laborRate: 125,   equipmentRate: 12,    unit: 'm',   crewSize: 2,  productivityRate: 3 },
  '124800-FURNITURE':     { materialRate: 850,   laborRate: 120,   equipmentRate: 25,    unit: 'ea',  crewSize: 2,  productivityRate: 4 },
  '125500-WINDOW-TREAT':  { materialRate: 65,    laborRate: 35,    equipmentRate: 5,     unit: 'm²',  crewSize: 1,  productivityRate: 12 },
  '121000-ART':           { materialRate: 2500,  laborRate: 450,   equipmentRate: 85,    unit: 'ea',  crewSize: 2,  productivityRate: 2 },
  '126000-MULTI-SEAT':    { materialRate: 185,   laborRate: 65,    equipmentRate: 12,    unit: 'ea',  crewSize: 3,  productivityRate: 8 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 13: SPECIAL CONSTRUCTION
  // ══════════════════════════════════════════════════════════════════════════════
  '131000-POOL':          { materialRate: 850,   laborRate: 450,   equipmentRate: 180,   unit: 'm²',  crewSize: 5,  productivityRate: 2 },
  '132000-PRE-ENG':       { materialRate: 185,   laborRate: 95,    equipmentRate: 45,    unit: 'm²',  crewSize: 4,  productivityRate: 8 },
  '133400-FABRIC-STRUCT': { materialRate: 125,   laborRate: 85,    equipmentRate: 35,    unit: 'm²',  crewSize: 3,  productivityRate: 10 },
  '134600-CLEAN-ROOM':    { materialRate: 650,   laborRate: 420,   equipmentRate: 85,    unit: 'm²',  crewSize: 4,  productivityRate: 3 },
  '135300-GREENHOUSE':    { materialRate: 280,   laborRate: 165,   equipmentRate: 55,    unit: 'm²',  crewSize: 3,  productivityRate: 5 },
  '135000-SPECIAL-INSTRUM': { materialRate: 4500, laborRate: 1800, equipmentRate: 650,  unit: 'ea',  crewSize: 2,  productivityRate: 0.5 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 14: CONVEYING EQUIPMENT
  // ══════════════════════════════════════════════════════════════════════════════
  '142100-ELEV-TRAC':     { materialRate: 85000, laborRate: 35000, equipmentRate: 12000, unit: 'ea',  crewSize: 6,  productivityRate: 0.02 },
  '142100-ELEV-HYD':      { materialRate: 62000, laborRate: 28000, equipmentRate: 8500,  unit: 'ea',  crewSize: 5,  productivityRate: 0.025 },
  '143100-ESCALATOR':     { materialRate: 125000,laborRate: 45000, equipmentRate: 18000, unit: 'ea',  crewSize: 6,  productivityRate: 0.015 },
  '144000-LIFT':          { materialRate: 18000, laborRate: 8500,  equipmentRate: 3200,  unit: 'ea',  crewSize: 3,  productivityRate: 0.1 },
  '148000-SCAFFOLD':      { materialRate: 5,     laborRate: 12,    equipmentRate: 8,     unit: 'm²',  crewSize: 3,  productivityRate: 15 },
  '141000-DUMBWAITER':    { materialRate: 8500,  laborRate: 3200,  equipmentRate: 1200,  unit: 'ea',  crewSize: 3,  productivityRate: 0.15 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 21: FIRE SUPPRESSION
  // ══════════════════════════════════════════════════════════════════════════════
  '211000-SPRINKLER':     { materialRate: 32,    laborRate: 28,    equipmentRate: 5,     unit: 'm²',  crewSize: 3,  productivityRate: 15 },
  '211300-SPRINKLER-HEAD':{ materialRate: 45,    laborRate: 35,    equipmentRate: 4,     unit: 'ea',  crewSize: 2,  productivityRate: 8 },
  '213000-STANDPIPE':     { materialRate: 85,    laborRate: 65,    equipmentRate: 12,    unit: 'm',   crewSize: 3,  productivityRate: 5 },
  '212000-CHEM-SUPPRESS': { materialRate: 4500,  laborRate: 1800,  equipmentRate: 650,   unit: 'ea',  crewSize: 3,  productivityRate: 0.3 },
  '214000-FIRE-WATER-STOR': { materialRate: 8500, laborRate: 2500, equipmentRate: 1200,  unit: 'ea',  crewSize: 4,  productivityRate: 0.1 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 22: PLUMBING
  // ══════════════════════════════════════════════════════════════════════════════
  '221000-PLUMBING':      { materialRate: 85,    laborRate: 95,    equipmentRate: 12,    unit: 'ea',  crewSize: 2,  productivityRate: 2 },
  '221100-PLUMB-PIPE':    { materialRate: 38,    laborRate: 52,    equipmentRate: 6,     unit: 'm',   crewSize: 2,  productivityRate: 10 },
  '223000-HVAC-PIPE':     { materialRate: 45,    laborRate: 55,    equipmentRate: 8,     unit: 'm',   crewSize: 2,  productivityRate: 8 },
  '224000-PLUMB-FIXT':    { materialRate: 450,   laborRate: 185,   equipmentRate: 20,    unit: 'ea',  crewSize: 2,  productivityRate: 2 },
  '225000-POOL-PLUMB':    { materialRate: 85,    laborRate: 65,    equipmentRate: 15,    unit: 'm',   crewSize: 3,  productivityRate: 6 },
  '226000-GAS-VACUUM':    { materialRate: 120,   laborRate: 95,    equipmentRate: 25,    unit: 'm',   crewSize: 2,  productivityRate: 5 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 23: HVAC
  // ══════════════════════════════════════════════════════════════════════════════
  '233000-DUCTWORK':      { materialRate: 42,    laborRate: 48,    equipmentRate: 8,     unit: 'm²',  crewSize: 3,  productivityRate: 10 },
  '233400-HVAC-EQUIP':    { materialRate: 1200,  laborRate: 450,   equipmentRate: 120,   unit: 'ea',  crewSize: 4,  productivityRate: 0.5 },
  '233600-AHU':           { materialRate: 8500,  laborRate: 3200,  equipmentRate: 850,   unit: 'ea',  crewSize: 4,  productivityRate: 0.15 },
  '235000-BOILER':        { materialRate: 12000, laborRate: 4500,  equipmentRate: 1200,  unit: 'ea',  crewSize: 4,  productivityRate: 0.1 },
  '237000-CHILLER':       { materialRate: 28000, laborRate: 8500,  equipmentRate: 3500,  unit: 'ea',  crewSize: 5,  productivityRate: 0.05 },
  '231000-FUEL-SYS':      { materialRate: 65,    laborRate: 55,    equipmentRate: 18,    unit: 'm',   crewSize: 3,  productivityRate: 8 },
  '234000-AIR-CLEAN':     { materialRate: 850,   laborRate: 420,   equipmentRate: 85,    unit: 'ea',  crewSize: 2,  productivityRate: 2 },
  '238000-DECENTRAL-HVAC': { materialRate: 2800, laborRate: 950,   equipmentRate: 180,   unit: 'ea',  crewSize: 2,  productivityRate: 1 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 25: INTEGRATED AUTOMATION
  // ══════════════════════════════════════════════════════════════════════════════
  '250500-BAS':           { materialRate: 2800,  laborRate: 1800,  equipmentRate: 350,   unit: 'ea',  crewSize: 2,  productivityRate: 0.3 },
  '251000-CONTROLS':      { materialRate: 1500,  laborRate: 950,   equipmentRate: 180,   unit: 'ea',  crewSize: 2,  productivityRate: 0.5 },
  '253000-ENERGY-MGMT':   { materialRate: 3200,  laborRate: 2100,  equipmentRate: 420,   unit: 'ea',  crewSize: 2,  productivityRate: 0.2 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 26: ELECTRICAL
  // ══════════════════════════════════════════════════════════════════════════════
  '260500-WIRE':          { materialRate: 4.50,  laborRate: 8,     equipmentRate: 0.50,  unit: 'm',   crewSize: 2,  productivityRate: 30 },
  '261000-CONDUIT':       { materialRate: 8.50,  laborRate: 12,    equipmentRate: 1.50,  unit: 'm',   crewSize: 2,  productivityRate: 20 },
  '262000-POWER':         { materialRate: 280,   laborRate: 350,   equipmentRate: 25,    unit: 'ea',  crewSize: 2,  productivityRate: 2 },
  '263000-SWITCHGEAR':    { materialRate: 4500,  laborRate: 2200,  equipmentRate: 350,   unit: 'ea',  crewSize: 3,  productivityRate: 0.2 },
  '264000-TRANSFORM':     { materialRate: 8500,  laborRate: 3500,  equipmentRate: 1200,  unit: 'ea',  crewSize: 4,  productivityRate: 0.1 },
  '265000-LIGHTING':      { materialRate: 180,   laborRate: 85,    equipmentRate: 10,    unit: 'ea',  crewSize: 2,  productivityRate: 4 },
  '264000-CATHODIC':      { materialRate: 45,    laborRate: 35,    equipmentRate: 12,    unit: 'm²',  crewSize: 2,  productivityRate: 15 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 27: COMMUNICATIONS
  // ══════════════════════════════════════════════════════════════════════════════
  '271000-DATA':          { materialRate: 3.20,  laborRate: 6.50,  equipmentRate: 0.30,  unit: 'm',   crewSize: 2,  productivityRate: 40 },
  '271100-DATA-OUTLET':   { materialRate: 85,    laborRate: 65,    equipmentRate: 8,     unit: 'ea',  crewSize: 1,  productivityRate: 6 },
  '272000-AV':            { materialRate: 450,   laborRate: 280,   equipmentRate: 35,    unit: 'ea',  crewSize: 2,  productivityRate: 2 },
  '273000-VOICE':         { materialRate: 65,    laborRate: 55,    equipmentRate: 8,     unit: 'ea',  crewSize: 1,  productivityRate: 6 },
  '275000-DIST-MONITOR':  { materialRate: 1200,  laborRate: 650,   equipmentRate: 185,   unit: 'ea',  crewSize: 2,  productivityRate: 1 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 28: ELECTRONIC SAFETY & SECURITY
  // ══════════════════════════════════════════════════════════════════════════════
  '281000-FIRE-ALARM':    { materialRate: 120,   laborRate: 85,    equipmentRate: 8,     unit: 'ea',  crewSize: 2,  productivityRate: 3 },
  '281300-FIRE-DET':      { materialRate: 65,    laborRate: 55,    equipmentRate: 5,     unit: 'ea',  crewSize: 1,  productivityRate: 6 },
  '282000-SECURITY':      { materialRate: 350,   laborRate: 220,   equipmentRate: 35,    unit: 'ea',  crewSize: 2,  productivityRate: 2 },
  '283000-ACCESS-CTRL':   { materialRate: 1200,  laborRate: 650,   equipmentRate: 85,    unit: 'ea',  crewSize: 2,  productivityRate: 1 },
  '284000-CCTV':          { materialRate: 280,   laborRate: 185,   equipmentRate: 25,    unit: 'ea',  crewSize: 2,  productivityRate: 3 },
  '284000-ELEC-MONITOR':  { materialRate: 1800,  laborRate: 850,   equipmentRate: 250,   unit: 'ea',  crewSize: 2,  productivityRate: 0.5 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 31: EARTHWORK
  // ══════════════════════════════════════════════════════════════════════════════
  '311000-SITE-CLEAR':   { materialRate: 0,     laborRate: 850,   equipmentRate: 1650,  unit: 'ea',  crewSize: 4,  productivityRate: 0.3 },
  '312000-GRADING':       { materialRate: 0,     laborRate: 8,     equipmentRate: 35,    unit: 'm³',  crewSize: 2,  productivityRate: 40 },
  '312300-EXCAVATE':      { materialRate: 0,     laborRate: 12,    equipmentRate: 42,    unit: 'm³',  crewSize: 3,  productivityRate: 25 },
  '313000-BACKFILL':      { materialRate: 25,    laborRate: 8,     equipmentRate: 18,    unit: 'm³',  crewSize: 2,  productivityRate: 30 },
  '315000-PILE':          { materialRate: 185,   laborRate: 65,    equipmentRate: 120,   unit: 'm',   crewSize: 4,  productivityRate: 8 },
  '316000-SHORING':       { materialRate: 45,    laborRate: 55,    equipmentRate: 35,    unit: 'm²',  crewSize: 3,  productivityRate: 10 },
  '317000-TUNNEL':        { materialRate: 850,   laborRate: 650,   equipmentRate: 1200,  unit: 'm³',  crewSize: 8,  productivityRate: 1 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 32: EXTERIOR IMPROVEMENTS
  // ══════════════════════════════════════════════════════════════════════════════
  '321000-PAVING':        { materialRate: 35,    laborRate: 18,    equipmentRate: 22,    unit: 'm²',  crewSize: 4,  productivityRate: 20 },
  '321400-CURB':          { materialRate: 28,    laborRate: 22,    equipmentRate: 15,    unit: 'm',   crewSize: 3,  productivityRate: 12 },
  '323000-SITE-FENCE':    { materialRate: 55,    laborRate: 35,    equipmentRate: 8,     unit: 'm',   crewSize: 2,  productivityRate: 10 },
  '329000-LANDSCAPE':     { materialRate: 25,    laborRate: 22,    equipmentRate: 8,     unit: 'm²',  crewSize: 3,  productivityRate: 15 },
  '329300-PLANT-TREE':    { materialRate: 350,   laborRate: 85,    equipmentRate: 45,    unit: 'ea',  crewSize: 2,  productivityRate: 3 },
  '327000-WETLANDS':      { materialRate: 25,    laborRate: 45,    equipmentRate: 35,    unit: 'm²',  crewSize: 4,  productivityRate: 15 },
  '328000-IRRIGATION':    { materialRate: 8,     laborRate: 12,    equipmentRate: 3,     unit: 'm²',  crewSize: 3,  productivityRate: 20 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 33: UTILITIES
  // ══════════════════════════════════════════════════════════════════════════════
  '331000-WATER-UTIL':    { materialRate: 125,   laborRate: 85,    equipmentRate: 55,    unit: 'm',   crewSize: 4,  productivityRate: 8 },
  '333000-SEWER':         { materialRate: 145,   laborRate: 95,    equipmentRate: 65,    unit: 'm',   crewSize: 4,  productivityRate: 7 },
  '334000-STORM':         { materialRate: 135,   laborRate: 88,    equipmentRate: 58,    unit: 'm',   crewSize: 4,  productivityRate: 8 },
  '335000-GAS-UTIL':      { materialRate: 95,    laborRate: 110,   equipmentRate: 35,    unit: 'm',   crewSize: 3,  productivityRate: 6 },
  '337000-ELEC-UTIL':     { materialRate: 85,    laborRate: 95,    equipmentRate: 45,    unit: 'm',   crewSize: 3,  productivityRate: 7 },
  '338000-TELECOM-UTIL':  { materialRate: 35,    laborRate: 55,    equipmentRate: 18,    unit: 'm',   crewSize: 2,  productivityRate: 12 },
  '332000-WELLS':         { materialRate: 85,    laborRate: 120,   equipmentRate: 250,   unit: 'm',   crewSize: 4,  productivityRate: 3 },
  '336000-HYDRONIC-UTIL': { materialRate: 95,    laborRate: 75,    equipmentRate: 22,    unit: 'm',   crewSize: 3,  productivityRate: 6 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 34: TRANSPORTATION
  // ══════════════════════════════════════════════════════════════════════════════
  '341100-RAIL':          { materialRate: 450,   laborRate: 280,   equipmentRate: 185,   unit: 'm',   crewSize: 6,  productivityRate: 5 },
  '341300-PARKING-EQUIP': { materialRate: 3500,  laborRate: 1200,  equipmentRate: 450,   unit: 'ea',  crewSize: 3,  productivityRate: 0.3 },
  '347100-ROADWAY-SIGN':  { materialRate: 1800,  laborRate: 650,   equipmentRate: 280,   unit: 'ea',  crewSize: 3,  productivityRate: 1 },
  '344000-TRANSPORT-SIGNAL': { materialRate: 5500, laborRate: 2200, equipmentRate: 850,  unit: 'ea',  crewSize: 3,  productivityRate: 0.3 },
  '348000-BRIDGE':        { materialRate: 2500,  laborRate: 1200,  equipmentRate: 1800,  unit: 'm²',  crewSize: 8,  productivityRate: 1 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 35: WATERWAY & MARINE CONSTRUCTION
  // ══════════════════════════════════════════════════════════════════════════════
  '351000-DREDGING':      { materialRate: 0,     laborRate: 25,    equipmentRate: 85,    unit: 'm³',  crewSize: 4,  productivityRate: 15 },
  '353000-DOCK':          { materialRate: 380,   laborRate: 220,   equipmentRate: 95,    unit: 'm²',  crewSize: 5,  productivityRate: 3 },
  '354000-PIER':          { materialRate: 450,   laborRate: 280,   equipmentRate: 145,   unit: 'm²',  crewSize: 6,  productivityRate: 2 },
  '355000-MARINE':        { materialRate: 520,   laborRate: 310,   equipmentRate: 165,   unit: 'm²',  crewSize: 5,  productivityRate: 2 },
  '356000-BULKHEAD':      { materialRate: 520,   laborRate: 310,   equipmentRate: 165,   unit: 'm',   crewSize: 5,  productivityRate: 3 },
  '357000-DAM':           { materialRate: 1800,  laborRate: 950,   equipmentRate: 2200,  unit: 'm³',  crewSize: 10, productivityRate: 0.5 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 40: PROCESS INTERCONNECTIONS
  // ══════════════════════════════════════════════════════════════════════════════
  '401000-PROCESS-PIPE':  { materialRate: 165,   laborRate: 125,   equipmentRate: 35,    unit: 'm',   crewSize: 3,  productivityRate: 6 },
  '405000-PIPE-SUPPORT':  { materialRate: 85,    laborRate: 65,    equipmentRate: 15,    unit: 'ea',  crewSize: 2,  productivityRate: 8 },
  '403000-SOLID-PIPE':    { materialRate: 185,   laborRate: 120,   equipmentRate: 45,    unit: 'm',   crewSize: 3,  productivityRate: 4 },
  '409000-PROCESS-CONTROL': { materialRate: 3500, laborRate: 1800, equipmentRate: 550,   unit: 'ea',  crewSize: 2,  productivityRate: 0.5 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 41: MATERIAL PROCESSING & HANDLING
  // ══════════════════════════════════════════════════════════════════════════════
  '411000-CRANE-PERM':    { materialRate: 45000, laborRate: 18000, equipmentRate: 8500,  unit: 'ea',  crewSize: 6,  productivityRate: 0.01 },
  '412000-CONVEYOR':      { materialRate: 850,   laborRate: 420,   equipmentRate: 185,   unit: 'm',   crewSize: 4,  productivityRate: 3 },
  '413000-CHUTE':         { materialRate: 2200,  laborRate: 850,   equipmentRate: 250,   unit: 'ea',  crewSize: 3,  productivityRate: 1 },
  '415000-MATERIAL-STORE': { materialRate: 5500, laborRate: 2200,  equipmentRate: 850,   unit: 'ea',  crewSize: 3,  productivityRate: 0.5 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 42: PROCESS HEATING, COOLING & DRYING
  // ══════════════════════════════════════════════════════════════════════════════
  '421000-BOILER-IND':    { materialRate: 35000, laborRate: 15000, equipmentRate: 5500,  unit: 'ea',  crewSize: 5,  productivityRate: 0.02 },
  '422000-PROCESS-COOL':  { materialRate: 28000, laborRate: 12000, equipmentRate: 4500,  unit: 'ea',  crewSize: 5,  productivityRate: 0.025 },
  '423000-DRYER':         { materialRate: 22000, laborRate: 9500,  equipmentRate: 3800,  unit: 'ea',  crewSize: 4,  productivityRate: 0.03 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 43: PROCESS GAS & LIQUID HANDLING
  // ══════════════════════════════════════════════════════════════════════════════
  '431000-TANK':          { materialRate: 18000, laborRate: 8500,  equipmentRate: 3500,  unit: 'ea',  crewSize: 4,  productivityRate: 0.05 },
  '432000-PUMP-IND':      { materialRate: 8500,  laborRate: 4200,  equipmentRate: 1800,  unit: 'ea',  crewSize: 3,  productivityRate: 0.1 },
  '433000-COMPRESSOR':    { materialRate: 12000, laborRate: 5500,  equipmentRate: 2200,  unit: 'ea',  crewSize: 3,  productivityRate: 0.08 },
  '433000-GAS-PURIFY':    { materialRate: 25000, laborRate: 9500,  equipmentRate: 4200,  unit: 'ea',  crewSize: 4,  productivityRate: 0.03 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 44: POLLUTION & WASTE CONTROL
  // ══════════════════════════════════════════════════════════════════════════════
  '441000-SCRUBBER':      { materialRate: 22000, laborRate: 9500,  equipmentRate: 4200,  unit: 'ea',  crewSize: 4,  productivityRate: 0.03 },
  '442000-OIL-SEP':       { materialRate: 15000, laborRate: 6500,  equipmentRate: 2800,  unit: 'ea',  crewSize: 3,  productivityRate: 0.05 },
  '443000-DUST-COLLECT':  { materialRate: 18000, laborRate: 7500,  equipmentRate: 3200,  unit: 'ea',  crewSize: 4,  productivityRate: 0.04 },
  '442000-NOISE-CTRL':    { materialRate: 85,    laborRate: 55,    equipmentRate: 12,    unit: 'm²',  crewSize: 2,  productivityRate: 8 },
  '445000-SOLID-WASTE':   { materialRate: 15000, laborRate: 6500,  equipmentRate: 2800,  unit: 'ea',  crewSize: 4,  productivityRate: 0.05 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 45: INDUSTRY-SPECIFIC MANUFACTURING
  // ══════════════════════════════════════════════════════════════════════════════
  '451000-MFG-EQUIP':     { materialRate: 55000, laborRate: 22000, equipmentRate: 9500,  unit: 'ea',  crewSize: 5,  productivityRate: 0.01 },
  '452000-ASSEMBLY-LINE': { materialRate: 38000, laborRate: 16000, equipmentRate: 7500,  unit: 'ea',  crewSize: 5,  productivityRate: 0.015 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 46: WATER & WASTEWATER
  // ══════════════════════════════════════════════════════════════════════════════
  '461000-WATER-TREAT':   { materialRate: 32000, laborRate: 14000, equipmentRate: 6500,  unit: 'ea',  crewSize: 5,  productivityRate: 0.02 },
  '462000-PUMP-STA':      { materialRate: 28000, laborRate: 12000, equipmentRate: 5500,  unit: 'ea',  crewSize: 5,  productivityRate: 0.025 },
  '463000-WASTE-TREAT':   { materialRate: 45000, laborRate: 18000, equipmentRate: 8500,  unit: 'ea',  crewSize: 6,  productivityRate: 0.015 },
  '463000-CHEM-FEED':     { materialRate: 8500,  laborRate: 3500,  equipmentRate: 1500,  unit: 'ea',  crewSize: 3,  productivityRate: 0.2 },

  // ══════════════════════════════════════════════════════════════════════════════
  // DIV 48: ELECTRICAL POWER GENERATION
  // ══════════════════════════════════════════════════════════════════════════════
  '481000-GENERATOR':     { materialRate: 25000, laborRate: 8500,  equipmentRate: 3500,  unit: 'ea',  crewSize: 4,  productivityRate: 0.08 },
  '482000-SOLAR':         { materialRate: 285,   laborRate: 145,   equipmentRate: 35,    unit: 'm²',  crewSize: 4,  productivityRate: 8 },
  '483000-WIND':          { materialRate: 85000, laborRate: 35000, equipmentRate: 15000, unit: 'ea',  crewSize: 6,  productivityRate: 0.005 },
};

// ─── Rate Provenance Defaults ────────────────────────────────────────────────
// Apply default provenance metadata to all CSI_RATES entries that lack explicit source data.
// Per CIQS/AACE RP 34R-05, each rate should have a traceable source and price level date.

const CSI_RATES_DEFAULT_PROVENANCE = {
  source: 'CIQS Elemental Cost Analysis / RSMeans Canadian Edition',
  priceDate: '2025-10-01',      // Q4 2025 base date
  lastVerified: '2026-01-15',   // Q1 2026 verification
};

// Apply defaults to entries missing provenance
for (const key of Object.keys(CSI_RATES)) {
  const entry = CSI_RATES[key];
  if (!entry.source) entry.source = CSI_RATES_DEFAULT_PROVENANCE.source;
  if (!entry.priceDate) entry.priceDate = CSI_RATES_DEFAULT_PROVENANCE.priceDate;
  if (!entry.lastVerified) entry.lastVerified = CSI_RATES_DEFAULT_PROVENANCE.lastVerified;
}

/**
 * Check rate staleness — warn if rates are older than the specified threshold.
 * Per AACE RP 34R-05, rates should be re-priced if >12 months past base date.
 */
export interface RateStalenessWarning {
  csiCode: string;
  priceDate: string;
  lastVerified: string;
  ageMonths: number;
  severity: 'ok' | 'stale' | 'expired';
  message: string;
}

export function checkRateStaleness(
  thresholdMonths: number = 12
): RateStalenessWarning[] {
  const now = new Date();
  const warnings: RateStalenessWarning[] = [];

  for (const [code, entry] of Object.entries(CSI_RATES)) {
    const priceDate = entry.priceDate ?? CSI_RATES_DEFAULT_PROVENANCE.priceDate;
    const lastVerified = entry.lastVerified ?? CSI_RATES_DEFAULT_PROVENANCE.lastVerified;
    const baseDate = new Date(priceDate);
    const ageMs = now.getTime() - baseDate.getTime();
    const ageMonths = ageMs / (30.44 * 24 * 60 * 60 * 1000);

    if (ageMonths > thresholdMonths * 2) {
      warnings.push({
        csiCode: code,
        priceDate,
        lastVerified,
        ageMonths: Math.round(ageMonths * 10) / 10,
        severity: 'expired',
        message: `Rate ${code} is ${Math.round(ageMonths)} months old (base: ${priceDate}). Re-pricing required.`,
      });
    } else if (ageMonths > thresholdMonths) {
      warnings.push({
        csiCode: code,
        priceDate,
        lastVerified,
        ageMonths: Math.round(ageMonths * 10) / 10,
        severity: 'stale',
        message: `Rate ${code} is ${Math.round(ageMonths)} months old (base: ${priceDate}). Re-pricing recommended.`,
      });
    }
  }

  return warnings;
}

// ─── Market Condition Indexing ───────────────────────────────────────────────
// Links estimate rates to published construction cost indices for automatic reflation.
// Supports Statistics Canada BCPI, RSMeans City Cost Index, and custom indices.

export interface CostIndex {
  indexId: string;              // e.g., 'statcan-bcpi-residential', 'rsmeans-toronto'
  indexName: string;            // e.g., 'Statistics Canada BCPI - Residential'
  source: string;               // e.g., 'Statistics Canada Table 18-10-0135-01'
  baseYear: number;             // e.g., 2017 (index = 100)
  entries: CostIndexEntry[];
}

export interface CostIndexEntry {
  date: string;                 // ISO date (quarterly or monthly)
  value: number;                // Index value (base year = 100)
}

export interface ReflationResult {
  originalPriceDate: string;
  targetDate: string;
  indexUsed: string;
  originalIndexValue: number;
  targetIndexValue: number;
  adjustmentFactor: number;     // target / original
  adjustedRates: Record<string, {
    originalTotal: number;
    adjustedTotal: number;
    delta: number;
  }>;
  totalOriginal: number;
  totalAdjusted: number;
  totalDelta: number;
  deltaPercent: number;
}

// Pre-populated Canadian BCPI indices (Statistics Canada)
const CANADIAN_COST_INDICES: CostIndex[] = [
  {
    indexId: 'statcan-bcpi-residential',
    indexName: 'Statistics Canada BCPI - Residential Building',
    source: 'Statistics Canada Table 18-10-0135-01',
    baseYear: 2017,
    entries: [
      { date: '2020-01-01', value: 111.2 },
      { date: '2020-07-01', value: 113.5 },
      { date: '2021-01-01', value: 119.8 },
      { date: '2021-07-01', value: 132.4 },
      { date: '2022-01-01', value: 142.1 },
      { date: '2022-07-01', value: 148.3 },
      { date: '2023-01-01', value: 150.2 },
      { date: '2023-07-01', value: 152.8 },
      { date: '2024-01-01', value: 154.1 },
      { date: '2024-07-01', value: 156.9 },
      { date: '2025-01-01', value: 159.4 },
      { date: '2025-07-01', value: 162.1 },
      { date: '2026-01-01', value: 164.8 },
    ],
  },
  {
    indexId: 'statcan-bcpi-nonresidential',
    indexName: 'Statistics Canada BCPI - Non-Residential Building',
    source: 'Statistics Canada Table 18-10-0135-01',
    baseYear: 2017,
    entries: [
      { date: '2020-01-01', value: 109.8 },
      { date: '2020-07-01', value: 111.2 },
      { date: '2021-01-01', value: 116.5 },
      { date: '2021-07-01', value: 127.8 },
      { date: '2022-01-01', value: 137.2 },
      { date: '2022-07-01', value: 143.6 },
      { date: '2023-01-01', value: 146.1 },
      { date: '2023-07-01', value: 148.5 },
      { date: '2024-01-01', value: 150.3 },
      { date: '2024-07-01', value: 153.1 },
      { date: '2025-01-01', value: 155.8 },
      { date: '2025-07-01', value: 158.4 },
      { date: '2026-01-01', value: 161.2 },
    ],
  },
];

/**
 * Get the interpolated index value for a given date.
 */
function getIndexValueAtDate(index: CostIndex, dateStr: string): number | null {
  const target = new Date(dateStr).getTime();
  const sorted = [...index.entries].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  if (sorted.length === 0) return null;

  // Before first entry
  if (target <= new Date(sorted[0].date).getTime()) return sorted[0].value;
  // After last entry
  if (target >= new Date(sorted[sorted.length - 1].date).getTime()) return sorted[sorted.length - 1].value;

  // Interpolate between entries
  for (let i = 0; i < sorted.length - 1; i++) {
    const t0 = new Date(sorted[i].date).getTime();
    const t1 = new Date(sorted[i + 1].date).getTime();
    if (target >= t0 && target <= t1) {
      const ratio = (target - t0) / (t1 - t0);
      return sorted[i].value + ratio * (sorted[i + 1].value - sorted[i].value);
    }
  }

  return sorted[sorted.length - 1].value;
}

/**
 * Reflate all CSI_RATES from their priceDate to a target date using a cost index.
 * Returns adjusted rates without modifying originals.
 */
export function reflateRates(
  targetDate: string,
  indexId: string = 'statcan-bcpi-nonresidential',
  customIndices?: CostIndex[]
): ReflationResult {
  const allIndices = [...CANADIAN_COST_INDICES, ...(customIndices ?? [])];
  const index = allIndices.find(idx => idx.indexId === indexId);
  if (!index) {
    throw new Error(`Cost index '${indexId}' not found. Available: ${allIndices.map(i => i.indexId).join(', ')}`);
  }

  const adjustedRates: ReflationResult['adjustedRates'] = {};
  let totalOriginal = 0;
  let totalAdjusted = 0;

  // Use the default priceDate from rate provenance
  const originalPriceDate = CSI_RATES_DEFAULT_PROVENANCE.priceDate;
  const origIdx = getIndexValueAtDate(index, originalPriceDate);
  const targIdx = getIndexValueAtDate(index, targetDate);

  if (!origIdx || !targIdx) {
    throw new Error(`Cannot compute index values for dates: ${originalPriceDate} -> ${targetDate}`);
  }

  const factor = targIdx / origIdx;

  for (const [code, rate] of Object.entries(CSI_RATES)) {
    const originalTotal = rate.materialRate + rate.laborRate + rate.equipmentRate;
    const adjustedTotal = originalTotal * factor;
    adjustedRates[code] = {
      originalTotal,
      adjustedTotal: Math.round(adjustedTotal * 100) / 100,
      delta: Math.round((adjustedTotal - originalTotal) * 100) / 100,
    };
    totalOriginal += originalTotal;
    totalAdjusted += adjustedTotal;
  }

  return {
    originalPriceDate,
    targetDate,
    indexUsed: index.indexName,
    originalIndexValue: Math.round(origIdx * 10) / 10,
    targetIndexValue: Math.round(targIdx * 10) / 10,
    adjustmentFactor: Math.round(factor * 10000) / 10000,
    adjustedRates,
    totalOriginal: Math.round(totalOriginal * 100) / 100,
    totalAdjusted: Math.round(totalAdjusted * 100) / 100,
    totalDelta: Math.round((totalAdjusted - totalOriginal) * 100) / 100,
    deltaPercent: totalOriginal > 0 ? Math.round(((totalAdjusted - totalOriginal) / totalOriginal) * 10000) / 100 : 0,
  };
}

/** Available cost indices for reflation */
export const AVAILABLE_COST_INDICES = CANADIAN_COST_INDICES;

// ─── CSI Division Names — All 34 Active MasterFormat 2018 Divisions ──────────

const CSI_DIVISIONS: Record<string, string> = {
  '01': 'General Requirements',
  '02': 'Existing Conditions',
  '03': 'Concrete',
  '04': 'Masonry',
  '05': 'Metals',
  '06': 'Wood, Plastics & Composites',
  '07': 'Thermal & Moisture Protection',
  '08': 'Openings',
  '09': 'Finishes',
  '10': 'Specialties',
  '11': 'Equipment',
  '12': 'Furnishings',
  '13': 'Special Construction',
  '14': 'Conveying Equipment',
  '21': 'Fire Suppression',
  '22': 'Plumbing',
  '23': 'HVAC',
  '25': 'Integrated Automation',
  '26': 'Electrical',
  '27': 'Communications',
  '28': 'Electronic Safety & Security',
  '31': 'Earthwork',
  '32': 'Exterior Improvements',
  '33': 'Utilities',
  '34': 'Transportation',
  '35': 'Waterway & Marine Construction',
  '40': 'Process Interconnections',
  '41': 'Material Processing & Handling',
  '42': 'Process Heating, Cooling & Drying',
  '43': 'Process Gas & Liquid Handling',
  '44': 'Pollution & Waste Control',
  '45': 'Industry-Specific Manufacturing',
  '46': 'Water & Wastewater',
  '48': 'Electrical Power Generation',
};

// ─── Ontario MEP Rate Bridge — estimate-engine code → ontario-mep-rates CSI ──
//
// Maps this engine's internal rate codes (e.g. '211000-SPRINKLER') to the
// calibrated ontario-mep-rates CSI subdivision codes (e.g. '21 13 13.40').
// Only Div 21/22/23/26/27/28 entries with compatible units are bridged.
// Codes with unit mismatches (m² vs lm) or no representative item are omitted —
// those fall back to CSI_RATES unchanged.
//
// Rates source: server/estimator/ontario-mep-rates.ts Q1 2026 Ontario ICI
// Labour basis: UA Local 46/401/524/787 (plumbing/HVAC), IBEW 353/586/636 (elec)
// Equipment: NOT embedded per-unit — applied separately via MEP_EQUIPMENT_FACTOR

const MEP_CSI_BRIDGE: Record<string, string> = {
  // ── Div 21: Fire Suppression ──────────────────────────────────────────────
  '211000-SPRINKLER':       '21 13 13.40', // wet-pipe residential budget m² ($23/m²)
  '211300-SPRINKLER-HEAD':  '21 13 13.10', // standard pendant head ea ($52.50/ea)
  '213000-STANDPIPE':       '21 13 13.22', // black steel sched-40 50mm lm ($80/lm)
  // '212000-CHEM-SUPPRESS':  m² vs ea unit mismatch — keeps CSI_RATES
  // '214000-FIRE-WATER-STOR': no representative item — keeps CSI_RATES

  // ── Div 22: Plumbing ──────────────────────────────────────────────────────
  '221000-PLUMBING':    '22 42 01.10', // WC floor-mount ea (repr. plumbing conn., $860)
  '221100-PLUMB-PIPE':  '22 11 16.12', // copper Type L 25mm lm ($51/lm)
  '223000-HVAC-PIPE':   '23 21 13.10', // hydronic black steel 25mm lm ($56/lm)
  '224000-PLUMB-FIXT':  '22 42 01.10', // WC floor-mount ea ($860)
  '226000-GAS-VACUUM':  '23 11 23.10', // gas piping black steel 20mm lm ($46/lm)
  // '225000-POOL-PLUMB':  no representative item — keeps CSI_RATES

  // ── Div 23: HVAC ──────────────────────────────────────────────────────────
  // '233000-DUCTWORK':   m² vs lm unit mismatch — keeps CSI_RATES
  '233400-HVAC-EQUIP':     '23 09 23.10', // VAV box pressure-independent DDC ea ($1,930)
  '233600-AHU':            '23 73 13.10', // AHU vertical draw-through 2000 L/s ea ($30,500)
  '235000-BOILER':         '23 52 33.10', // condensing gas boiler 70kW ea ($11,700)
  // '237000-CHILLER':    no full chiller item in ontario-mep-rates — keeps CSI_RATES
  // '231000-FUEL-SYS':   no representative item — keeps CSI_RATES
  '234000-AIR-CLEAN':      '23 41 13.10', // filter bank MERV-8 600×600mm ea ($63)
  '238000-DECENTRAL-HVAC': '23 81 26.10', // split system heat pump 7kW 1-phase ea ($6,400)

  // ── Div 26: Electrical ────────────────────────────────────────────────────
  '260500-WIRE':       '26 05 19.10', // THHN/THWN #12 AWG copper lm ($5.05/lm)
  '261000-CONDUIT':    '26 05 33.10', // EMT conduit 19mm lm ($14.30/lm)
  '262000-POWER':      '26 24 16.10', // panelboard 100A 24-ckt ea ($1,430)
  '263000-SWITCHGEAR': '26 24 13.10', // main service entrance 400A 3Φ ea ($10,300)
  '264000-TRANSFORM':  '26 22 13.10', // dry-type transformer 15kVA ea ($4,600)
  '265000-LIGHTING':   '26 51 13.10', // LED troffer 600×600mm 38W ea ($240)
  // '264000-CATHODIC':  no representative item — keeps CSI_RATES

  // ── Div 27: Communications ────────────────────────────────────────────────
  '271000-DATA':        '27 15 01.10', // Cat6 UTP cable lm ($5.05/lm)
  '271100-DATA-OUTLET': '27 15 01.20', // voice/data outlet Cat6 2-port ea ($113)
  '273000-VOICE':       '27 51 13.10', // IP telephone rough-in ea ($93)
  // '272000-AV':         no representative item — keeps CSI_RATES
  // '275000-DIST-MONITOR': no representative item — keeps CSI_RATES

  // ── Div 28: Electronic Safety & Security ──────────────────────────────────
  '281000-FIRE-ALARM': '28 31 11.30', // FACP addressable 2-loop 250 pts ea ($9,000)
  '281300-FIRE-DET':   '28 31 11.10', // smoke detector photoelectric ea ($147)
  '282000-SECURITY':   '28 16 11.20', // intrusion alarm panel 8-zone ea ($900)
  '283000-ACCESS-CTRL':'28 16 11.20', // intrusion panel proxy for access ctrl ea ($900)
  '284000-CCTV':       '28 23 11.10', // IP camera fixed dome 4MP indoor ea ($540)
  // '284000-ELEC-MONITOR': no representative item — keeps CSI_RATES
};

// ─── Waste Factors — Per Material Category (CIQS Standard Practice) ─────────
// Applied to material quantities AFTER QTO. Labor/equipment apply to adjusted qty.
// Source: CIQS Elemental Cost Analysis, industry averages for Canadian construction.

const WASTE_FACTORS: Record<string, number> = {
  // Division 03 — Concrete
  'CONC':         0.05,  // 5% — formwork reuse, over-order, pump residue
  'FORM':         0.05,  // 5% — formwork panel damage, cutting
  'REBAR':        0.03,  // 3% — lap splices, cutting loss (low: fabricated to schedule)
  'PRECAST':      0.02,  // 2% — factory-made, minimal site waste
  'MASS-CONC':    0.05,  // 5% — same as structural concrete
  // Division 04 — Masonry
  'MASONRY':      0.05,  // 5% — breakage, cutting at openings/corners
  'REFRACTORY':   0.05,  // 5% — similar to standard masonry
  'CORR-MASONRY': 0.05,  // 5% — similar to standard masonry
  // Division 05 — Metals
  'STEEL':        0.03,  // 3% — fabrication scrap, connection material
  'MISC-STEEL':   0.05,  // 5% — site-fit, more cutting
  'DECOR-MTL':    0.05,  // 5% — ornamental requires precision fitting
  // Division 06 — Wood/Plastics/Composites
  'FRAMING':      0.10,  // 10% — cutting waste, defects, mis-cuts
  'MILLWORK':     0.08,  // 8% — precision work, less waste than framing
  'PANEL':        0.08,  // 8% — plywood/OSB cutting waste
  'STRUCT-PLASTIC': 0.05, // 5% — FRP fabrication
  'PLASTIC-FAB':  0.05,  // 5% — fabrication waste
  // Division 07 — Thermal & Moisture Protection
  'INSULATION':   0.08,  // 8% — cutting at penetrations, odd shapes
  'WATERPROOF':   0.05,  // 5% — overlap allowance, detail work
  'ROOF':         0.07,  // 7% — membrane overlap, flashing waste
  'SIDING':       0.08,  // 8% — cutting at openings/corners
  'FIRESTOP':     0.05,  // 5% — sealant waste at penetrations
  // Division 08 — Openings
  'DOOR':         0.02,  // 2% — pre-manufactured, minimal waste
  'WINDOW':       0.02,  // 2% — pre-manufactured
  'CURTAIN':      0.03,  // 3% — custom fabrication, gasket waste
  'GLASS':        0.05,  // 5% — breakage allowance
  // Division 09 — Finishes
  'DRYWALL':      0.10,  // 10% — cutting at corners, openings, patches
  'TILE':         0.15,  // 15% — cutting, breakage, pattern matching
  'FLOOR':        0.10,  // 10% — cutting, pattern alignment
  'CARPET':       0.10,  // 10% — seaming waste, pattern match
  'PAINT':        0.05,  // 5% — overspray, roller waste, touch-up
  'PLASTER':      0.08,  // 8% — mixing waste, application loss
  'ACOUSTIC':     0.08,  // 8% — ceiling tile cutting, grid waste
  'CEILING':      0.08,  // 8% — suspended ceiling panel cutting
  // Division 10+ — Specialties (pre-manufactured, low waste)
  'DEFAULT':      0.03,  // 3% — default for manufactured items (Div 10-14, 21-28)
  // Division 31 — Earthwork (no material waste — volume-based)
  'EARTH':        0.00,  // 0% — earthwork is volume-based, no material waste
  'EXCAVATION':   0.00,  // 0% — no waste on removal
  // Division 32 — Exterior Improvements
  'LANDSCAPE':    0.05,  // 5% — sod/seed/mulch overage
  'PAVING':       0.05,  // 5% — asphalt/concrete paving waste
};

// ─── CODE-6: Wall Assembly Definitions ───────────────────────────────────────
// A real QS reads section drawings to get the layer build-up of each wall
// assembly type (e.g., EW1 = exterior wall type 1). When an assembly code is
// recognised, the engine replaces generic wall line items with per-layer items
// giving traceable, spec-level QTO.
//
// Populated at runtime from model.geometryData.assemblyCodeMap (set by the
// ConstructionWorkflowProcessor during section-drawing analysis).
// ─────────────────────────────────────────────────────────────────────────────

export interface WallAssemblyLayer {
  csiCode: string;            // Rate code for this layer, e.g. '072000-INSULATION'
  description: string;        // e.g. '75mm rigid mineral wool insulation'
  thicknessMm?: number;       // Layer thickness (for volume-based quantities)
  unit: 'area' | 'volume' | 'length';
  quantityMultiplier?: number; // e.g. 2.0 for double-sided drywall on one wall
}

export interface AssemblyDefinition {
  code: string;               // e.g. 'EW1', 'IW3D', 'W-2HR'
  description: string;        // e.g. 'Exterior Wall Type 1 — 2-hr fire-rated'
  fireRating?: string;        // e.g. '2-hour'
  totalThicknessMm?: number;  // Full assembly thickness including structure
  constructionType?: string;  // e.g. 'cip-concrete', 'wood-frame'
  layers: WallAssemblyLayer[];
  notes?: string;
}

// ─── STEP-4: Construction Type Crew Factors ──────────────────────────────────
// Per CIQS QS Step 4: crew composition, productivity, and equipment intensity
// all vary by construction type. A precast building uses smaller erection crews
// but more crane time; a wood-frame building is labour-light and equipment-light.
//
// Factors are applied post-element-loop to all line items:
//   laborMultiplier:        scales laborRate and laborCost
//   equipmentMultiplier:    scales equipmentRate and equipmentCost
//   productivityMultiplier: scales productivityRate (units/crew-hr), inverse for laborHours
//
// Source: CIQS Regional Benchmarks Q4 2025; RSMeans Crew Analysis;
//         Ontario Residential Construction Council labour studies.
// ─────────────────────────────────────────────────────────────────────────────

export interface ConstructionTypeFactors {
  laborMultiplier:        number;
  equipmentMultiplier:    number;
  productivityMultiplier: number;
  label: string;
}

export const CONSTRUCTION_TYPE_CREW_FACTORS: Record<string, ConstructionTypeFactors> = {
  // type               labor   equip   prod    label
  'cip-concrete':     { laborMultiplier: 1.00, equipmentMultiplier: 1.00, productivityMultiplier: 1.00, label: 'Cast-in-Place Concrete (baseline)' },
  'precast-concrete': { laborMultiplier: 0.72, equipmentMultiplier: 1.45, productivityMultiplier: 1.30, label: 'Precast / Tilt-up Concrete' },
  'steel-frame':      { laborMultiplier: 1.12, equipmentMultiplier: 1.30, productivityMultiplier: 1.15, label: 'Structural Steel Frame' },
  'wood-frame':       { laborMultiplier: 0.82, equipmentMultiplier: 0.65, productivityMultiplier: 0.90, label: 'Wood Frame (Platform / Balloon)' },
  'heavy-timber':     { laborMultiplier: 0.88, equipmentMultiplier: 0.80, productivityMultiplier: 0.85, label: 'Heavy Timber (Glulam / CLT / Mass Timber)' },
  'masonry-bearing':  { laborMultiplier: 1.05, equipmentMultiplier: 0.75, productivityMultiplier: 0.95, label: 'Load-Bearing Masonry (CMU / Brick)' },
  'modular':          { laborMultiplier: 0.58, equipmentMultiplier: 1.60, productivityMultiplier: 1.50, label: 'Modular / Prefabricated' },
  'mixed':            { laborMultiplier: 1.00, equipmentMultiplier: 1.00, productivityMultiplier: 1.00, label: 'Mixed Construction (baseline)' },
};

/**
 * STEP-4: Auto-detect dominant construction type from BIM element pool.
 * Used when constructionType is not explicitly set in options or geometryData.
 * Counts structural element keywords and returns the dominant type key.
 */
function detectConstructionType(elements: any[]): string {
  let cip = 0, pre = 0, steel = 0, wood = 0, timber = 0, masonry = 0;
  for (const el of elements) {
    const t = `${el.elementType || el.type || el.category || ''} ${el.description || el.properties?.description || ''} ${el.properties?.material || ''}`.toLowerCase();
    if      (t.includes('precast') || t.includes('tilt-up') || t.includes('pre-cast')) pre++;
    else if (t.includes('structural steel') || t.includes('steel frame') || t.includes('steel joist')) steel++;
    else if (t.includes('glulam') || t.includes('clt') || t.includes('mass timber') || t.includes('heavy timber')) timber++;
    else if (t.includes('masonry') || t.includes('cmu') || t.includes('brick') || (t.includes('block') && t.includes('wall'))) masonry++;
    else if (t.includes('wood frame') || t.includes('stud') || t.includes('platform frame') || t.includes('2x')) wood++;
    else if (t.includes('concrete') || t.includes('slab') || t.includes('column') || t.includes('beam') || t.includes('wall')) cip++;
  }
  const mx = Math.max(cip, pre, steel, wood, timber, masonry);
  if (mx === 0)       return 'cip-concrete';
  if (pre === mx)     return 'precast-concrete';
  if (steel === mx)   return 'steel-frame';
  if (timber === mx)  return 'heavy-timber';
  if (masonry === mx) return 'masonry-bearing';
  if (wood === mx)    return 'wood-frame';
  return 'cip-concrete';
}

/** Look up waste factor for a rate code by matching known material keys */
function getWasteFactor(rateCode: string): number {
  // Try matching known material keys in the rate code
  for (const [key, factor] of Object.entries(WASTE_FACTORS)) {
    if (key !== 'DEFAULT' && rateCode.includes(key)) return factor;
  }
  // Division-based fallback
  const div = rateCode.substring(0, 2);
  if (div === '31') return 0.00;                    // Earthwork — no material waste
  if (['10','11','12','13','14'].includes(div)) return 0.03;  // Specialties/equipment
  if (['21','22','23','25','26','27','28'].includes(div)) return 0.03;  // MEP
  if (['33','34','35'].includes(div)) return 0.03;  // Utilities/transport
  if (['40','41','42','43','44','45','46','48'].includes(div)) return 0.03;  // Process
  return WASTE_FACTORS['DEFAULT'];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function push(
  arr: EstimateLineItem[],
  item: Omit<EstimateLineItem, 'csiSubdivision' | 'totalRate' | 'totalCost' | 'verificationStatus' | 'baseQuantity' | 'wastePercent' | 'wasteQuantity'> & { verificationStatus?: string; baseQuantity?: number; wastePercent?: number; wasteQuantity?: number }
) {
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) return;
  const totalRate = item.materialRate + item.laborRate + item.equipmentRate;
  const totalCost = totalRate * item.quantity;
  arr.push({
    ...item,
    csiSubdivision: item.csiCode,  // Full CSI code alias for downstream modules
    baseQuantity: item.baseQuantity ?? item.quantity,
    wastePercent: item.wastePercent ?? 0,
    wasteQuantity: item.wasteQuantity ?? 0,
    totalRate,
    materialCost: item.materialRate * item.quantity,
    laborCost: item.laborRate * item.quantity,
    equipmentCost: item.equipmentRate * item.quantity,
    totalCost,
    verificationStatus: (item.verificationStatus || (totalRate === 0 ? 'unrated' : 'verified')) as any, // Est-4: $0 items marked unrated
  });
}

/**
 * Convert a MEPRateItem to the internal RateEntry format.
 * equipmentRate is set to 0: ontario-mep-rates.ts is direct cost only.
 * Equipment (cranes, AWP, scaffolding) is handled separately via
 * getMepEquipmentFactor() applied to total MEP labour per floor.
 * productivityRate is derived from item.labourHrs (journeyperson-hours per unit).
 */
function buildMepRateEntry(item: MEPRateItem, fallback: RateEntry): RateEntry {
  const labourHrsPerUnit = item.labourHrs > 0 ? item.labourHrs : 1;
  return {
    materialRate:     item.materialCAD,
    laborRate:        item.labourCAD,
    equipmentRate:    0,                        // Equipment via MEP_EQUIPMENT_FACTOR
    unit:             item.unit === 'lm' ? 'm' :
                      item.unit === 'm2' ? 'm²' :
                      item.unit,
    crewSize:         fallback.crewSize,        // Preserve crew composition
    productivityRate: 1 / labourHrsPerUnit,     // units/journeyperson-hour
  };
}

// ─── DB Rate Cache — pre-loaded from unit_rates / mep_rates tables ───────────
// Populated by preloadDbRates() before each estimate run.
// DB rates take priority over hardcoded CSI_RATES when present.
let _dbUnitRateCache: Map<string, RateEntry> = new Map();
let _dbMepRateCache: Map<string, MEPRateItem> = new Map();
let _dbRegionalCache: Map<string, { compositeIndex: number }> = new Map();
let _dbRatesCacheAge = 0;
const DB_RATE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Promise-based lock: concurrent callers await the same in-flight load
// instead of each triggering a parallel DB query that corrupts the cache.
let _dbRatesLoadPromise: Promise<void> | null = null;

/**
 * Pre-load rates from the database into in-memory cache.
 * Call before generateEstimateFromElements() for DB-backed rates.
 * Falls back silently to hardcoded rates if DB is unavailable.
 * Uses a Promise-based lock so concurrent calls coalesce into one DB fetch.
 */
async function preloadDbRates(): Promise<void> {
  if (Date.now() - _dbRatesCacheAge < DB_RATE_CACHE_TTL_MS && _dbUnitRateCache.size > 0) {
    return; // Cache still fresh
  }

  // If another call is already loading, piggyback on its promise
  if (_dbRatesLoadPromise) {
    return _dbRatesLoadPromise;
  }

  _dbRatesLoadPromise = (async () => {
    try {
      // Build new maps in local variables, then swap atomically
      const newUnitCache = new Map<string, RateEntry>();
      const newMepCache = new Map<string, MEPRateItem>();
      const newRegionalCache = new Map<string, { compositeIndex: number }>();

      const unitRows = await storage.getUnitRates();
      for (const r of unitRows) {
        newUnitCache.set(r.csiCode, {
          materialRate: parseFloat(r.materialRate as string) || 0,
          laborRate: parseFloat(r.laborRate as string) || 0,
          equipmentRate: parseFloat(r.equipmentRate as string) || 0,
          unit: r.unit,
          crewSize: parseFloat(r.crewSize as string) || 1,
          productivityRate: parseFloat(r.productivityRate as string) || 1,
        });
      }

      const mepRows = await storage.getMepRates();
      for (const r of mepRows) {
        const materialCAD = parseFloat(r.materialRate as string) || 0;
        const labourCAD = parseFloat(r.labourRate as string) || 0;
        newMepCache.set(r.csiCode, {
          csiCode: r.csiCode,
          description: r.description,
          unit: r.unit,
          materialCAD,
          labourCAD,
          totalCAD: materialCAD + labourCAD,
          labourHrs: parseFloat(r.labourHoursPerUnit as string) || 1,
          notes: r.note ?? undefined,
        });
      }

      const regionalRows = await storage.getRegionalFactors();
      for (const r of regionalRows) {
        newRegionalCache.set(r.regionKey, {
          compositeIndex: parseFloat(r.compositeIndex as string) || 1.0,
        });
      }

      // Atomic swap — readers always see a complete, consistent map
      if (newUnitCache.size > 0) _dbUnitRateCache = newUnitCache;
      if (newMepCache.size > 0) _dbMepRateCache = newMepCache;
      if (newRegionalCache.size > 0) _dbRegionalCache = newRegionalCache;
      _dbRatesCacheAge = Date.now();

      console.log(`[estimate-engine] Loaded ${_dbUnitRateCache.size} unit / ${_dbMepRateCache.size} MEP / ${_dbRegionalCache.size} regional rates from database`);
    } catch (err) {
      // DB unavailable — use hardcoded rates silently
      console.warn('[estimate-engine] Could not load DB rates, using hardcoded fallback:', err);
    } finally {
      _dbRatesLoadPromise = null;
    }
  })();

  return _dbRatesLoadPromise;
}

/**
 * Look up the rate entry for a CSI rate code.
 * Resolution order:
 *   1. DB unit_rates table (user overrides, vendor quotes)
 *   2. Ontario MEP bridge for Div 21–28
 *   3. Hardcoded CSI_RATES constant (system defaults)
 *   4. Zero rate with warning
 */
function getRate(code: string): RateEntry {
  // 1. DB rate override (highest priority)
  const dbRate = _dbUnitRateCache.get(code);
  if (dbRate) return dbRate;

  // 2. Ontario MEP bridge: calibrated CAD rates for Div 21–28
  const mepCsiCode = MEP_CSI_BRIDGE[code];
  if (mepCsiCode) {
    // Check DB MEP rates first, then hardcoded
    const dbMep = _dbMepRateCache.get(mepCsiCode);
    const mepItem = dbMep || getMepRate(mepCsiCode);
    if (mepItem) {
      const fallback = CSI_RATES[code] ?? {
        materialRate: 0, laborRate: 0, equipmentRate: 0,
        unit: 'ea', crewSize: 2, productivityRate: 1,
      };
      return buildMepRateEntry(mepItem, fallback);
    }
  }

  // 3. Hardcoded CSI_RATES fallback
  const found = CSI_RATES[code];
  if (found) return found;

  // 4. Unknown rate code — $0 line item flagged for QS review
  console.warn(`⚠️ [estimate-engine] No rate found for CSI code "${code}" — line item will be $0 (unrated). Add rate to unit_rates table or provide a vendor quote.`);
  return { materialRate: 0, laborRate: 0, equipmentRate: 0, unit: 'ea', crewSize: 1, productivityRate: 1 };
}

function safeParse(v: any): Record<string, any> {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return {}; }
}

/** Create a standard line-item push with regional factor and waste factor applied */
function pushItem(
  lines: EstimateLineItem[],
  rateCode: string,
  divCode: string,
  description: string,
  qty: number,
  floor: string,
  elementIds: string[],
  evidenceRefs: string[],
  rf: number,
  status?: string,
  gridRef?: string
): void {
  const rc = getRate(rateCode);
  const divName = CSI_DIVISIONS[divCode] || 'Other';
  const wastePct = getWasteFactor(rateCode);
  const wasteQty = qty * wastePct;
  const adjustedQty = qty + wasteQty;
  push(lines, {
    csiCode: rateCode,
    csiDivision: divCode,
    csiDivisionName: divName,
    description,
    unit: rc.unit,
    quantity: adjustedQty,
    baseQuantity: qty,
    wastePercent: wastePct,
    wasteQuantity: wasteQty,
    materialRate: rc.materialRate * rf,
    laborRate: rc.laborRate * rf,
    equipmentRate: rc.equipmentRate * rf,
    floor,
    elementIds,
    evidenceRefs,
    crewSize: rc.crewSize,
    productivityRate: rc.productivityRate,
    laborHours: rc.productivityRate > 0 ? adjustedQty / rc.productivityRate : 0,
    verificationStatus: status,
    gridRef: gridRef || undefined,
  } as any);
}

// ─── Main Estimation Function ────────────────────────────────────────────────

/**
 * Pre-resolve grid references for all elements from detected grid data.
 * Call this before generateEstimateFromElements() to add gridRef to each element.
 * Elements get their nearest grid intersection label (e.g., "A-3") with confidence.
 *
 * This is async because it queries the grid detection database.
 * If no detected grid is available, elements are returned unchanged (no defaults).
 */
export async function enrichElementsWithGridRefs(
  elements: any[],
  projectId: string,
): Promise<any[]> {
  try {
    const { hasDetectedGrid, resolveGridReference } = await import('../services/grid-integration-bridge');
    const gridAvailable = await hasDetectedGrid(projectId);
    if (!gridAvailable) return elements;

    let resolved = 0;
    for (const el of elements) {
      if (el.properties?.gridRef) continue; // Already has a reference
      let geom: any;
      try {
        geom = typeof el.geometry === 'string' ? JSON.parse(el.geometry) : el.geometry;
      } catch (e) {
        console.warn(`[resolveGridReferences] Failed to parse geometry JSON for element ${el.id || el.elementId || '?'}:`, e);
        geom = null;
      }
      const loc = geom?.location?.realLocation || geom?.location || {};
      const x = Number(loc.x);
      const y = Number(loc.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      const ref = await resolveGridReference(projectId, x, y);
      if (ref && ref.confidence > 0.3) {
        if (!el.properties) el.properties = {};
        el.properties.gridRef = ref.reference;
        el.properties.gridRefConfidence = ref.confidence;
        el.properties.gridRefDistance = ref.distance;
        el.gridRef = ref.reference;
        resolved++;
      }
    }

    if (resolved > 0) {
      console.log(`📐 Grid refs: resolved ${resolved}/${elements.length} elements to grid intersections`);
    }
    return elements;
  } catch {
    return elements; // Non-blocking — return unchanged if bridge unavailable
  }
}


// ─── CIQS Opening Deduction Pre-Processor (CODE-1) ───────────────────────────
// CIQS Standard Method of Measurement deduction rules:
//   Walls: deduct openings >0.5 m² (CIQS §8.4 — openings ≤0.5 m² not deductible)
//   Slabs: deduct penetrations >1.0 m² (CIQS §6.3)
// Applied to: formwork, concrete volume, rebar, drywall, paint.
// ─────────────────────────────────────────────────────────────────────────────
interface DeductionMaps {
  byWallId: Map<string, number>;
  bySlabId: Map<string, number>;
  audit: { wallsWithDeductions: number; totalAreaDeducted: number; slabsWithDeductions: number; totalVolumeDeducted: number; };
}

function buildCIQSDeductionMaps(elements: any[]): DeductionMaps {
  const WALL_THRESH = 0.5;
  const SLAB_THRESH = 1.0;
  const wallsById = new Map<string, any>();
  const wallsByFloor = new Map<string, any[]>();
  const slabsByFloor = new Map<string, any[]>();

  for (const el of elements) {
    const t = (el.elementType || el.type || el.category || '').toLowerCase();
    const floor = el.storeyName || el.storey?.name || el.properties?.floor || 'Unassigned';
    const id = el.id || el.elementId || '';
    if (t.includes('wall') && !t.includes('curtain') && !t.includes('retaining') && !t.includes('drywall')) {
      wallsById.set(id, el);
      if (!wallsByFloor.has(floor)) wallsByFloor.set(floor, []);
      wallsByFloor.get(floor)!.push(el);
    } else if (t.includes('slab') || (t.includes('floor') && !t.includes('flooring'))) {
      if (!slabsByFloor.has(floor)) slabsByFloor.set(floor, []);
      slabsByFloor.get(floor)!.push(el);
    }
  }

  const byWallId = new Map<string, number>();
  const bySlabId = new Map<string, number>();
  let totalAreaDeducted = 0;
  let totalVolumeDeducted = 0;
  const wallIdsDeducted = new Set<string>();
  const slabIdsDeducted = new Set<string>();

  const faceArea = (el: any): number => {
    const dims = safeParse(el.dimensions);
    const g = el.geometry?.dimensions || {};
    const w = num(dims.width || g.width);
    const h = num(dims.height || g.height);
    return (w > 0 && h > 0) ? w * h : 0;
  };

  for (const el of elements) {
    const t = (el.elementType || el.type || el.category || '').toLowerCase();
    const floor = el.storeyName || el.storey?.name || el.properties?.floor || 'Unassigned';
    const isDoor = t.includes('door') && !t.includes('access') && !t.includes('overhead');
    const isWindow = t.includes('window') || t.includes('glazing');
    const isSkylight = t.includes('skylight') || t.includes('roof window');
    const isPenetration = t.includes('penetration') || t.includes('slab opening') || t.includes('floor opening');

    if (isDoor || isWindow) {
      const area = faceArea(el);
      if (area <= WALL_THRESH) continue;
      const parentId = el.properties?.parentElementId || el.parentElementId || el.hostWallId;
      if (parentId && wallsById.has(parentId)) {
        byWallId.set(parentId, (byWallId.get(parentId) || 0) + area);
        wallIdsDeducted.add(parentId);
        totalAreaDeducted += area;
      } else {
        const floorWalls = wallsByFloor.get(floor) || [];
        if (!floorWalls.length) continue;
        const wallAreas = floorWalls.map(w => { const d = safeParse(w.dimensions); const g = w.geometry?.dimensions || {}; const wW = num(d.width || g.width); const wH = num(d.height || g.height); return (wW > 0 && wH > 0) ? wW * wH : 0; });
        const tot = wallAreas.reduce((s, a) => s + a, 0);
        if (tot > 0) {
          floorWalls.forEach((w, i) => { const wid = w.id || w.elementId || ''; const share = (wallAreas[i] / tot) * area; if (share > 0) { byWallId.set(wid, (byWallId.get(wid) || 0) + share); wallIdsDeducted.add(wid); } });
          totalAreaDeducted += area;
        }
      }
    }

    if (isSkylight || isPenetration) {
      const area = faceArea(el);
      if (area <= SLAB_THRESH) continue;
      const parentId = el.properties?.parentElementId || el.parentElementId || el.hostSlabId;
      const floorSlabs = slabsByFloor.get(floor) || [];
      if (parentId) {
        bySlabId.set(parentId, (bySlabId.get(parentId) || 0) + area);
        slabIdsDeducted.add(parentId);
        totalVolumeDeducted += area;
      } else if (floorSlabs.length > 0) {
        const share = area / floorSlabs.length;
        floorSlabs.forEach(s => { const sid = s.id || s.elementId || ''; bySlabId.set(sid, (bySlabId.get(sid) || 0) + share); slabIdsDeducted.add(sid); });
        totalVolumeDeducted += area;
      }
    }
  }
  return { byWallId, bySlabId, audit: { wallsWithDeductions: wallIdsDeducted.size, totalAreaDeducted, slabsWithDeductions: slabIdsDeducted.size, totalVolumeDeducted } };
}

// ─── QTO Sanity Cross-Check (CODE-2) ─────────────────────────────────────────
// A real QS always validates extracted element totals against expected ranges.
// >15% variance on any check flags the estimate as LOW_CONFIDENCE.
// ─────────────────────────────────────────────────────────────────────────────
export function runQtoSanityCheck(
  elements: any[],
  opts: { scheduleDocCounts?: { doors: number; windows: number }; grossFloorAreaOverride?: number } = {}
): QtoSanityCheck {
  const WARN = 0.15;
  const warnings: string[] = [];
  const checks: QtoSanityCheck['checks'] = [];
  let totalWallArea = 0, totalSlabArea = 0, totalSlabVolume = 0, doorCount = 0, windowCount = 0;
  const floors = new Set<string>();

  for (const el of elements) {
    const t = (el.elementType || el.type || el.category || '').toLowerCase();
    const dims = safeParse(el.dimensions);
    const g = el.geometry?.dimensions || {};
    const q = safeParse(el.quantities);
    const floor = el.storeyName || el.storey?.name || el.properties?.floor || '';
    if (floor) floors.add(floor);
    const w = num(dims.width || g.width), h = num(dims.height || g.height), d = num(dims.depth || g.depth || dims.thickness || g.thickness);
    const area = num(q.area || el.quantityArea) || (w > 0 && h > 0 ? w * h : 0);
    const vol  = num(q.volume || el.quantityVolume) || (area > 0 && d > 0 ? area * d : 0);
    if (t.includes('wall') && !t.includes('curtain') && !t.includes('drywall')) totalWallArea += area;
    else if (t.includes('slab') || (t.includes('floor') && !t.includes('flooring'))) { totalSlabArea += area; totalSlabVolume += vol; }
    else if (t.includes('door') && !t.includes('access')) doorCount++;
    else if (t.includes('window') || t.includes('glazing')) windowCount++;
  }

  const gfa = opts.grossFloorAreaOverride && opts.grossFloorAreaOverride > 0 ? opts.grossFloorAreaOverride : totalSlabArea;

  if (gfa > 0) {
    const ratio = totalWallArea / gfa;
    const v = ratio < 1.5 ? (1.5 - ratio) / 1.5 : ratio > 4.0 ? (ratio - 4.0) / 4.0 : 0;
    const passed = v < WARN;
    checks.push({ name: 'Wall area / GFA ratio', extracted: ratio, expected: 2.5, variance: v, threshold: WARN, passed, unit: 'ratio' });
    if (!passed) warnings.push(`Wall/GFA ratio ${ratio.toFixed(2)} outside typical [1.5–4.0]. Wall area: ${totalWallArea.toFixed(0)} m², GFA: ${gfa.toFixed(0)} m². Review wall extraction.`);
  }

  const schedDoors = opts.scheduleDocCounts?.doors || 0;
  if (schedDoors > 0) {
    const v = Math.abs(doorCount - schedDoors) / schedDoors;
    const passed = v < WARN;
    checks.push({ name: 'Door count: elements vs schedule', extracted: doorCount, expected: schedDoors, variance: v, threshold: WARN, passed, unit: 'nr' });
    if (!passed) warnings.push(`Door count: ${doorCount} elements vs ${schedDoors} in schedule (${(v*100).toFixed(1)}% variance). Reconcile floor plan vs door schedule.`);
  }

  const schedWindows = opts.scheduleDocCounts?.windows || 0;
  if (schedWindows > 0) {
    const v = Math.abs(windowCount - schedWindows) / schedWindows;
    const passed = v < WARN;
    checks.push({ name: 'Window count: elements vs schedule', extracted: windowCount, expected: schedWindows, variance: v, threshold: WARN, passed, unit: 'nr' });
    if (!passed) warnings.push(`Window count: ${windowCount} elements vs ${schedWindows} in schedule (${(v*100).toFixed(1)}% variance). Reconcile floor plan vs window schedule.`);
  }

  return { passed: warnings.length === 0, warnings, checks, doorCountFromElements: doorCount, doorCountFromSchedule: schedDoors, windowCountFromElements: windowCount, windowCountFromSchedule: schedWindows, totalWallAreaExtracted: totalWallArea, totalSlabAreaExtracted: totalSlabArea, totalSlabVolumeExtracted: totalSlabVolume, grossFloorArea: gfa };
}

export function generateEstimateFromElements(
  elements: any[],
  options: {
    region?: string;
    currency?: 'CAD';
    projectName?: string;
    seismicZone?: 'low' | 'moderate' | 'high';
    scheduleDocCounts?: { doors: number; windows: number };
    grossFloorAreaOverride?: number;
    /** STEP-4: Explicit construction type — overrides auto-detection.
     *  One of the keys in CONSTRUCTION_TYPE_CREW_FACTORS. */
    constructionType?: string;
    /** CODE-6: Wall assembly definitions from section drawing extraction.
     *  Keys are assembly codes (e.g. 'EW1', 'IW3D'); values are full layer
     *  build-ups. When a wall element has a matching wallType property, the
     *  engine generates per-layer line items instead of generic ones. */
    assemblyCodeMap?: Record<string, AssemblyDefinition>;
    /** NBC/OBC building classification — affects fire protection, structural
     *  requirements, and material quality costs.
     *  A = non-combustible, highest FRR (+15%)
     *  B = non-combustible, moderate FRR (baseline)
     *  C = combustible with non-combustible cladding (-8%)
     *  D = combustible (-15%) */
    buildingClass?: 'A' | 'B' | 'C' | 'D';
  } = {}
): EstimateSummary {
  const region = options.region;
  // DB regional factors take priority over hardcoded CANADIAN_PROVINCIAL_FACTORS
  const dbRegional = region ? _dbRegionalCache.get(region) : undefined;
  const regionalFactors = dbRegional
    || (region && CANADIAN_PROVINCIAL_FACTORS[region as keyof typeof CANADIAN_PROVINCIAL_FACTORS])
    || { compositeIndex: 1.0 };
  let rf = num(regionalFactors.compositeIndex) || 1.0;

  // NBC/OBC building class factor — affects fire protection, structural, and material costs
  const BUILDING_CLASS_FACTORS: Record<string, number> = { A: 1.15, B: 1.00, C: 0.92, D: 0.85 };
  const bcf = BUILDING_CLASS_FACTORS[options.buildingClass || 'B'] ?? 1.0;
  if (bcf !== 1.0) {
    console.log(`[NBC/OBC] Building Class ${options.buildingClass}: cost factor ×${bcf}`);
    rf = rf * bcf; // Combined: regional × building class applied to all M+L+E rates
  }

  // STEP-4: Resolve construction type → crew factors
  // Priority: explicit option → auto-detect from elements
  const effectiveConstructionType = options.constructionType && CONSTRUCTION_TYPE_CREW_FACTORS[options.constructionType]
    ? options.constructionType
    : detectConstructionType(elements);
  const ctf = CONSTRUCTION_TYPE_CREW_FACTORS[effectiveConstructionType] ?? CONSTRUCTION_TYPE_CREW_FACTORS['cip-concrete'];
  if (effectiveConstructionType !== 'cip-concrete') {
    console.log(`[STEP-4] Construction type: "${ctf.label}" — labor×${ctf.laborMultiplier}, equip×${ctf.equipmentMultiplier}, prod×${ctf.productivityMultiplier}`);
  }

  // CODE-1: CIQS opening deduction pre-pass
  const deductions = buildCIQSDeductionMaps(elements);

  const lines: EstimateLineItem[] = [];
  const skippedElements: string[] = [];
  let incompleteCount = 0;
  const divisionsUsed = new Set<string>();

  for (const el of elements) {
    const props = el.properties || {};
    const dims = safeParse(el.dimensions);
    const geomDims = el.geometry?.dimensions || {};
    const quantities = safeParse(el.quantities);

    const w = num(dims.width || geomDims.width);
    const h = num(dims.height || geomDims.height);
    const d = num(dims.depth || geomDims.depth || dims.thickness || geomDims.thickness);
    const floor = el.storeyName || el.storey?.name || props.floor || 'Unassigned';
    const ev = props.evidenceRefs || (props.sourceDocument ? [props.sourceDocument] : []);
    const type = (el.elementType || el.type || el.category || '').toLowerCase();
    const _desc = (el.description || props.description || props.name || '').toLowerCase();
    const csi = (props.csiCode || el.csiCode || '').toLowerCase();
    const ids = [el.id || el.elementId];

    // Grid reference: from element properties or detected grid data
    // Properties may contain gridRef from Claude extraction or from grid-integration-bridge pre-resolution
    const gridRef = props.gridRef || props.gridLocation || props.gridLine ||
      el.gridRef || el.properties?.gridRef || undefined;

    // Track how many line items exist before this element's classification
    // so we can stamp gridRef on all items pushed for this element
    const lineCountBefore = lines.length;

    // ✅ Skip structural elements with zero critical dimensions — don't invent
    const isStructuralWall = type.includes('wall') && !type.includes('curtain wall') && !type.includes('retaining wall') && !type.includes('drywall');
    if (isStructuralWall || type.includes('slab') || type.includes('column') || type.includes('beam')) {
      if (w === 0 && h === 0 && d === 0) {
        skippedElements.push(`${el.elementId || el.id}: ${type} — no dimensions`);
        incompleteCount++;
        continue;
      }
    }

    const area = num(quantities.area || el.quantityArea) || (w > 0 && h > 0 ? w * h : 0);
    const volume = num(quantities.volume || el.quantityVolume) || (w > 0 && h > 0 && d > 0 ? w * h * d : 0);
    const length = num(quantities.length) || w || 0;

    // ══════════════════════════════════════════════════════════════════════════
    // ELEMENT CLASSIFICATION — ordered most-specific to most-general
    // ══════════════════════════════════════════════════════════════════════════

    // ── DIV 14: CONVEYING EQUIPMENT ──
    if (type.includes('elevator') || type.includes('escalator') || type.includes('dumbwaiter') || type.includes('platform lift') || type.includes('wheelchair lift') || (type.includes('lift') && type.includes('convey')) || type.includes('scaffold')) {
      divisionsUsed.add('14');
      if (type.includes('scaffold')) {
        pushItem(lines, '148000-SCAFFOLD', '14', 'Scaffolding', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('escalator')) {
        pushItem(lines, '143100-ESCALATOR', '14', 'Escalator', 1, floor, ids, ev, rf);
      } else if (type.includes('dumbwaiter')) {
        pushItem(lines, '141000-DUMBWAITER', '14', 'Dumbwaiter', 1, floor, ids, ev, rf);
      } else if (type.includes('platform lift') || type.includes('wheelchair lift')) {
        pushItem(lines, '144000-LIFT', '14', 'Platform lift/dumbwaiter', 1, floor, ids, ev, rf);
      } else if (type.includes('hydraulic')) {
        pushItem(lines, '142100-ELEV-HYD', '14', 'Hydraulic elevator', 1, floor, ids, ev, rf);
      } else {
        pushItem(lines, '142100-ELEV-TRAC', '14', 'Traction elevator', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 35: WATERWAY & MARINE ──
    else if (type.includes('dock') || type.includes('marina') || type.includes('pier') || type.includes('bulkhead') || type.includes('seawall') || type.includes('marine') || type.includes('wharf') || type.includes('dredg') || type.includes('dam') || type.includes('spillway') || type.includes('weir')) {
      divisionsUsed.add('35');
      if (type.includes('dam') || type.includes('spillway') || type.includes('weir')) {
        pushItem(lines, '357000-DAM', '35', 'Dam/spillway construction', volume, floor, ids, ev, rf, volume > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('dredg')) {
        pushItem(lines, '351000-DREDGING', '35', 'Dredging', volume, floor, ids, ev, rf, volume > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('dock') || type.includes('marina')) {
        pushItem(lines, '353000-DOCK', '35', 'Dock/marina structure', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('pier')) {
        pushItem(lines, '354000-PIER', '35', 'Pier structure', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('bulkhead') || type.includes('seawall')) {
        pushItem(lines, '356000-BULKHEAD', '35', 'Bulkhead/seawall', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else {
        pushItem(lines, '355000-MARINE', '35', 'Marine construction', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      }
    }

    // ── DIV 13: SPECIAL CONSTRUCTION ──
    else if (type.includes('pool') || type.includes('swimming') || type.includes('greenhouse') || type.includes('clean room') || type.includes('pre-engineered') || type.includes('fabric struct') || type.includes('tensile') || type.includes('membrane struct') || type.includes('special instrument') || type.includes('seismograph') || type.includes('meteorological')) {
      divisionsUsed.add('13');
      if (type.includes('special instrument') || type.includes('seismograph') || type.includes('meteorological')) {
        pushItem(lines, '135000-SPECIAL-INSTRUM', '13', 'Special instrumentation', 1, floor, ids, ev, rf);
      } else if (type.includes('pool') || type.includes('swimming')) {
        pushItem(lines, '131000-POOL', '13', 'Swimming pool', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('greenhouse')) {
        pushItem(lines, '135300-GREENHOUSE', '13', 'Greenhouse structure', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('clean room')) {
        pushItem(lines, '134600-CLEAN-ROOM', '13', 'Clean room', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('fabric') || type.includes('tensile') || type.includes('membrane struct')) {
        pushItem(lines, '133400-FABRIC-STRUCT', '13', 'Fabric/tensile structure', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else {
        pushItem(lines, '132000-PRE-ENG', '13', 'Pre-engineered structure', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      }
    }

    // ── DIV 10: SPECIALTIES ──
    else if (type.includes('signage') || (type.includes('sign') && !type.includes('design')) || type.includes('toilet partition') || type.includes('toilet accessor') || type.includes('locker') || type.includes('mailbox') || type.includes('fire extinguisher') || type.includes('fireplace') || type.includes('hearth') || type.includes('chimney') || type.includes('flagpole') || type.includes('awning') || type.includes('sun control') || type.includes('canopy')) {
      divisionsUsed.add('10');
      if (type.includes('fireplace') || type.includes('hearth') || type.includes('chimney')) {
        pushItem(lines, '103000-FIREPLACE', '10', 'Fireplace/hearth assembly', 1, floor, ids, ev, rf);
      } else if (type.includes('flagpole') || type.includes('awning') || type.includes('sun control') || type.includes('canopy')) {
        pushItem(lines, '107000-EXT-SPECIALTY', '10', 'Exterior specialty (flagpole/awning/sun control)', 1, floor, ids, ev, rf);
      } else if (type.includes('toilet partition') || type.includes('washroom partition')) {
        pushItem(lines, '102100-TOILET-PART', '10', 'Toilet partition', 1, floor, ids, ev, rf);
      } else if (type.includes('toilet accessor') || type.includes('washroom accessor')) {
        pushItem(lines, '102800-TOILET-ACC', '10', 'Toilet accessory', 1, floor, ids, ev, rf);
      } else if (type.includes('locker')) {
        pushItem(lines, '105100-LOCKERS', '10', 'Lockers', 1, floor, ids, ev, rf);
      } else if (type.includes('mailbox') || type.includes('postal')) {
        pushItem(lines, '105600-MAILBOXES', '10', 'Mailboxes', 1, floor, ids, ev, rf);
      } else if (type.includes('fire extinguisher')) {
        pushItem(lines, '104400-FIRE-EXTCAB', '10', 'Fire extinguisher cabinet', 1, floor, ids, ev, rf);
      } else {
        pushItem(lines, '101400-SIGNAGE', '10', 'Signage/directories', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 11: EQUIPMENT ──
    else if (type.includes('loading dock') || type.includes('laundry equip') || type.includes('food service') || type.includes('kitchen equip') || type.includes('athletic equip') || type.includes('lab equip') || type.includes('waste compactor') || type.includes('recycling') || type.includes('trash compactor') || type.includes('refuse') || type.includes('detention equip') || type.includes('vault') || type.includes('bank equip') || type.includes('vending') || type.includes('atm') || type.includes('commercial equip') || type.includes('healthcare equip') || type.includes('medical equip') || type.includes('hospital equip')) {
      divisionsUsed.add('11');
      if (type.includes('detention') || type.includes('vault') || type.includes('bank equip') || type.includes('security equip')) {
        pushItem(lines, '111500-SECURITY-EQUIP', '11', 'Security/detention/banking equipment', 1, floor, ids, ev, rf);
      } else if (type.includes('vending') || type.includes('atm') || type.includes('commercial equip')) {
        pushItem(lines, '112000-COMMERCIAL-EQUIP', '11', 'Commercial equipment (vending/ATM)', 1, floor, ids, ev, rf);
      } else if (type.includes('healthcare') || type.includes('medical equip') || type.includes('hospital equip')) {
        pushItem(lines, '117000-HEALTHCARE-EQUIP', '11', 'Healthcare/medical equipment', 1, floor, ids, ev, rf);
      } else if (type.includes('loading dock')) {
        pushItem(lines, '111300-LOADING-DOCK', '11', 'Loading dock equipment', 1, floor, ids, ev, rf);
      } else if (type.includes('laundry')) {
        pushItem(lines, '113100-LAUNDRY', '11', 'Laundry equipment', 1, floor, ids, ev, rf);
      } else if (type.includes('food') || type.includes('kitchen')) {
        pushItem(lines, '114000-FOOD-SVC', '11', 'Food service equipment', 1, floor, ids, ev, rf);
      } else if (type.includes('athletic')) {
        pushItem(lines, '116800-ATHLETIC', '11', 'Athletic equipment', 1, floor, ids, ev, rf);
      } else if (type.includes('waste') || type.includes('recycling') || type.includes('trash') || type.includes('refuse')) {
        pushItem(lines, '118000-WASTE-EQUIP', '11', 'Waste/recycling equipment', 1, floor, ids, ev, rf);
      } else {
        pushItem(lines, '117300-LAB-EQUIP', '11', 'Laboratory equipment', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 12: FURNISHINGS ──
    else if (type.includes('casework') || type.includes('cabinet') || type.includes('countertop') || type.includes('furniture') || type.includes('window treatment') || type.includes('blind') || (type.includes('shade') && !type.includes('curtain wall')) || type.includes('artwork') || type.includes('sculpture') || type.includes('commissioned art') || type.includes('auditorium seat') || type.includes('stadium seat') || type.includes('fixed seating') || type.includes('theater seat')) {
      divisionsUsed.add('12');
      if (type.includes('artwork') || type.includes('sculpture') || type.includes('commissioned art') || type.includes('mural')) {
        pushItem(lines, '121000-ART', '12', 'Commissioned artwork/sculpture', 1, floor, ids, ev, rf);
      } else if (type.includes('auditorium seat') || type.includes('stadium seat') || type.includes('fixed seating') || type.includes('theater seat') || type.includes('bench seating')) {
        pushItem(lines, '126000-MULTI-SEAT', '12', 'Multiple/fixed seating', 1, floor, ids, ev, rf);
      } else if (type.includes('casework') || type.includes('cabinet')) {
        pushItem(lines, '123200-CASEWORK', '12', 'Manufactured casework', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('countertop')) {
        pushItem(lines, '123600-COUNTERTOP', '12', 'Countertop', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('furniture')) {
        pushItem(lines, '124800-FURNITURE', '12', 'Furniture', 1, floor, ids, ev, rf);
      } else {
        pushItem(lines, '125500-WINDOW-TREAT', '12', 'Window treatment', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      }
    }

    // ── DIV 25: INTEGRATED AUTOMATION ──
    else if (type.includes('automation') || type.includes('bas ') || type.includes('building management') || type.includes('bms') || type.includes('energy management')) {
      divisionsUsed.add('25');
      if (type.includes('energy management')) {
        pushItem(lines, '253000-ENERGY-MGMT', '25', 'Energy management system', 1, floor, ids, ev, rf);
      } else if (type.includes('bas') || type.includes('building management') || type.includes('bms')) {
        pushItem(lines, '250500-BAS', '25', 'Building automation system', 1, floor, ids, ev, rf);
      } else {
        pushItem(lines, '251000-CONTROLS', '25', 'Integrated automation controls', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 48: ELECTRICAL POWER GENERATION ──
    else if (type.includes('generator') || type.includes('solar') || type.includes('photovoltaic') || type.includes('wind turbine') || type.includes('power gen')) {
      divisionsUsed.add('48');
      if (type.includes('solar') || type.includes('photovoltaic')) {
        pushItem(lines, '482000-SOLAR', '48', 'Solar photovoltaic system', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('wind')) {
        pushItem(lines, '483000-WIND', '48', 'Wind turbine', 1, floor, ids, ev, rf);
      } else {
        pushItem(lines, '481000-GENERATOR', '48', 'Emergency/standby generator', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 46: WATER & WASTEWATER ──
    else if (type.includes('water treatment') || type.includes('wastewater') || type.includes('sewage treatment') || (type.includes('pumping station') && !type.includes('plumb')) || type.includes('chemical feed') || type.includes('chlorinat') || type.includes('dosing')) {
      divisionsUsed.add('46');
      if (type.includes('chemical feed') || type.includes('chlorinat') || type.includes('dosing')) {
        pushItem(lines, '463000-CHEM-FEED', '46', 'Chemical feed/dosing equipment', 1, floor, ids, ev, rf);
      } else if (type.includes('wastewater') || type.includes('sewage')) {
        pushItem(lines, '463000-WASTE-TREAT', '46', 'Wastewater treatment', 1, floor, ids, ev, rf);
      } else if (type.includes('pumping station')) {
        pushItem(lines, '462000-PUMP-STA', '46', 'Pumping station', 1, floor, ids, ev, rf);
      } else {
        pushItem(lines, '461000-WATER-TREAT', '46', 'Water treatment system', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 44: POLLUTION & WASTE CONTROL ──
    else if (type.includes('scrubber') || type.includes('pollution') || type.includes('oil separator') || type.includes('dust collect') || type.includes('air quality equip') || type.includes('noise control') || type.includes('sound barrier') || type.includes('noise abatement') || type.includes('solid waste control') || type.includes('waste reuse') || type.includes('recycling system')) {
      divisionsUsed.add('44');
      if (type.includes('noise control') || type.includes('sound barrier') || type.includes('noise abatement') || type.includes('acoustic barrier')) {
        pushItem(lines, '442000-NOISE-CTRL', '44', 'Noise pollution control', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('solid waste control') || type.includes('waste reuse') || type.includes('recycling system')) {
        pushItem(lines, '445000-SOLID-WASTE', '44', 'Solid waste control/reuse system', 1, floor, ids, ev, rf);
      } else if (type.includes('oil separator') || type.includes('grease trap')) {
        pushItem(lines, '442000-OIL-SEP', '44', 'Oil/water separator', 1, floor, ids, ev, rf);
      } else if (type.includes('dust collect')) {
        pushItem(lines, '443000-DUST-COLLECT', '44', 'Dust collection system', 1, floor, ids, ev, rf);
      } else {
        pushItem(lines, '441000-SCRUBBER', '44', 'Air scrubber/pollution control', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 45: INDUSTRY-SPECIFIC MANUFACTURING ──
    else if (type.includes('manufacturing equip') || type.includes('assembly line') || type.includes('production equip')) {
      divisionsUsed.add('45');
      if (type.includes('assembly line')) {
        pushItem(lines, '452000-ASSEMBLY-LINE', '45', 'Assembly line equipment', 1, floor, ids, ev, rf);
      } else {
        pushItem(lines, '451000-MFG-EQUIP', '45', 'Manufacturing equipment', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 41: MATERIAL PROCESSING & HANDLING ──
    else if (type.includes('conveyor') || type.includes('chute') || (type.includes('crane') && type.includes('permanent')) || type.includes('material handling') || (type.includes('hoist') && type.includes('permanent')) || type.includes('silo') || type.includes('hopper') || type.includes('material storage')) {
      divisionsUsed.add('41');
      if (type.includes('silo') || type.includes('hopper') || type.includes('material storage') || type.includes('bin storage')) {
        pushItem(lines, '415000-MATERIAL-STORE', '41', 'Material storage (silo/hopper)', 1, floor, ids, ev, rf);
      } else if (type.includes('conveyor')) {
        pushItem(lines, '412000-CONVEYOR', '41', 'Conveyor system', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('chute')) {
        pushItem(lines, '413000-CHUTE', '41', 'Chute', 1, floor, ids, ev, rf);
      } else {
        pushItem(lines, '411000-CRANE-PERM', '41', 'Permanent crane/hoist', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 42: PROCESS HEATING, COOLING & DRYING ──
    else if (type.includes('industrial boiler') || type.includes('process chiller') || type.includes('process heat') || type.includes('kiln') || type.includes('industrial dryer')) {
      divisionsUsed.add('42');
      if (type.includes('dryer') || type.includes('kiln')) {
        pushItem(lines, '423000-DRYER', '42', 'Industrial dryer/kiln', 1, floor, ids, ev, rf);
      } else if (type.includes('chiller') || type.includes('cool')) {
        pushItem(lines, '422000-PROCESS-COOL', '42', 'Process cooling equipment', 1, floor, ids, ev, rf);
      } else {
        pushItem(lines, '421000-BOILER-IND', '42', 'Industrial boiler', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 43: PROCESS GAS & LIQUID HANDLING ──
    else if (type.includes('process tank') || type.includes('industrial pump') || type.includes('compressor') || type.includes('process gas') || type.includes('pressure vessel') || type.includes('purif') || type.includes('distill') || type.includes('deioniz')) {
      divisionsUsed.add('43');
      if (type.includes('purif') || type.includes('distill') || type.includes('deioniz') || type.includes('gas clean')) {
        pushItem(lines, '433000-GAS-PURIFY', '43', 'Gas/liquid purification equipment', 1, floor, ids, ev, rf);
      } else if (type.includes('compressor')) {
        pushItem(lines, '433000-COMPRESSOR', '43', 'Compressor', 1, floor, ids, ev, rf);
      } else if (type.includes('pump')) {
        pushItem(lines, '432000-PUMP-IND', '43', 'Industrial pump', 1, floor, ids, ev, rf);
      } else {
        pushItem(lines, '431000-TANK', '43', 'Process tank/vessel', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 40: PROCESS INTERCONNECTIONS ──
    else if (type.includes('process pipe') || type.includes('process piping') || type.includes('pipe support') || type.includes('pipe hanger') || type.includes('slurry pipe') || type.includes('solid pipe') || type.includes('pneumatic convey') || type.includes('process control') || type.includes('process instrument')) {
      divisionsUsed.add('40');
      if (type.includes('slurry') || type.includes('solid pipe') || type.includes('pneumatic convey')) {
        pushItem(lines, '403000-SOLID-PIPE', '40', 'Solid/mixed materials piping', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('process control') || type.includes('process instrument') || type.includes('plc')) {
        pushItem(lines, '409000-PROCESS-CONTROL', '40', 'Process instrumentation/control', 1, floor, ids, ev, rf);
      } else if (type.includes('support') || type.includes('hanger')) {
        pushItem(lines, '405000-PIPE-SUPPORT', '40', 'Pipe support/hanger', 1, floor, ids, ev, rf);
      } else {
        pushItem(lines, '401000-PROCESS-PIPE', '40', 'Process piping', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      }
    }

    // ── DIV 33: UTILITIES ──
    else if (type.includes('utility') || type.includes('water main') || type.includes('sewer main') || type.includes('storm drain') || type.includes('gas main') || type.includes('site service') || type.includes('well') || type.includes('borehole') || type.includes('hydronic') || type.includes('district heat') || type.includes('steam util')) {
      divisionsUsed.add('33');
      if (type.includes('well') || type.includes('borehole') || type.includes('water well')) {
        pushItem(lines, '332000-WELLS', '33', 'Well drilling', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('hydronic') || type.includes('district heat') || type.includes('steam util')) {
        pushItem(lines, '336000-HYDRONIC-UTIL', '33', 'Hydronic/steam energy utility', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('sewer')) {
        pushItem(lines, '333000-SEWER', '33', 'Sanitary sewer utility', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('storm')) {
        pushItem(lines, '334000-STORM', '33', 'Storm drainage utility', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('gas')) {
        pushItem(lines, '335000-GAS-UTIL', '33', 'Gas distribution', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('elec') && type.includes('util')) {
        pushItem(lines, '337000-ELEC-UTIL', '33', 'Electrical utility', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('telecom') || type.includes('comm util')) {
        pushItem(lines, '338000-TELECOM-UTIL', '33', 'Telecom utility', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else {
        pushItem(lines, '331000-WATER-UTIL', '33', 'Water utility', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      }
    }

    // ── DIV 34: TRANSPORTATION ──
    else if ((type.includes('rail') && !type.includes('railing') && !type.includes('handrail') && !type.includes('guardrail')) || type.includes('parking equip') || type.includes('parking gate') || type.includes('traffic signal') || type.includes('roadway sign') || type.includes('transport signal') || type.includes('bridge') || type.includes('overpass') || type.includes('viaduct')) {
      divisionsUsed.add('34');
      if (type.includes('transport signal') || type.includes('signal control') || type.includes('traffic control')) {
        pushItem(lines, '344000-TRANSPORT-SIGNAL', '34', 'Transportation signaling/control', 1, floor, ids, ev, rf);
      } else if (type.includes('bridge') || type.includes('overpass') || type.includes('viaduct')) {
        pushItem(lines, '348000-BRIDGE', '34', 'Bridge construction', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('rail')) {
        pushItem(lines, '341100-RAIL', '34', 'Rail track', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('parking')) {
        pushItem(lines, '341300-PARKING-EQUIP', '34', 'Parking equipment', 1, floor, ids, ev, rf);
      } else {
        pushItem(lines, '347100-ROADWAY-SIGN', '34', 'Traffic signal/roadway signage', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 03: CONCRETE — FOUNDATIONS, FOOTINGS & GRADE BEAMS ──
    // Professional QS always separates below-grade concrete from superstructure.
    // Footings/grade beams have different pour sizes, forming systems, and rebar ratios.
    // Slab-on-grade (SOG) uses edge form only (no soffit form). Retaining walls get
    // waterproofing and drainage board as integral line items (not optional extras).
    else if (
      type.includes('footing') || type.includes('spread footing') || type.includes('strip footing') ||
      type.includes('pad footing') || type.includes('pad foundation') || type.includes('foundation pad') ||
      type.includes('grade beam') || type.includes('frost wall') ||
      type.includes('mat foundation') || type.includes('raft foundation') || type.includes('raft slab') ||
      type.includes('slab on grade') || type.includes('slab-on-grade') || type.includes(' sog') ||
      (type.includes('foundation') && (type.includes('concrete') || type.includes('strip') || type.includes('spread') || type.includes('continuous')))
    ) {
      divisionsUsed.add('03');
      if (type.includes('mat foundation') || type.includes('raft')) {
        // Mat / raft — priced as thick slab; no soffit form; perimeter edge form only
        if (area > 0 && d > 0) {
          pushItem(lines, '033100-MAT-FOUND', '03', 'Mat/raft foundation concrete', area * d, floor, ids, ev, rf);
          pushItem(lines, '033100-FOOT-REBAR', '03', 'Reinforcing steel to mat foundation', area * d * rebarDensityFor('slab', options.seismicZone), floor, ids, ev, rf);
        }
      } else if (type.includes('slab on grade') || type.includes('slab-on-grade') || type.includes(' sog')) {
        // Slab-on-grade — no soffit form; perimeter edge form charged per linear metre
        if (area > 0 && d > 0) {
          pushItem(lines, '033100-SOG', '03', 'Slab-on-grade concrete', area * d, floor, ids, ev, rf);
          const perimeter = length > 0 ? length : 4 * Math.sqrt(area); // perimeter estimate if not given
          pushItem(lines, '033100-SOG-FORM', '03', 'Edge form to slab-on-grade', perimeter, floor, ids, ev, rf);
          pushItem(lines, '033100-FOOT-REBAR', '03', 'Reinforcing steel to slab-on-grade', area * d * rebarDensityFor('slab', options.seismicZone), floor, ids, ev, rf);
        }
      } else if (type.includes('grade beam') || type.includes('frost wall')) {
        // Grade beam — formed both sides; higher rebar density than slab
        if ((length > 0 || w > 0) && d > 0 && h > 0) {
          const L = length || w;
          const gbVol = L * d * h;
          pushItem(lines, '033100-GRADE-FORM', '03', 'Formwork to grade beam (both sides)', 2 * L * h, floor, ids, ev, rf);
          pushItem(lines, '033100-GRADE-BEAM', '03', 'Grade beam concrete', gbVol, floor, ids, ev, rf);
          pushItem(lines, '033100-FOOT-REBAR', '03', 'Reinforcing steel to grade beam', gbVol * rebarDensityFor('beam', options.seismicZone), floor, ids, ev, rf);
        }
      } else {
        // Spread / strip / pad footing
        if (d > 0) {
          const footVol = area > 0 ? area * d
                         : (w > 0 && length > 0) ? w * length * d : d; // fallback
          const footFormArea = area > 0 ? 4 * Math.sqrt(area) * d         // perimeter sides
                               : (w > 0 && length > 0) ? 2 * (w + length) * d : d;
          if (footVol > 0) {
            pushItem(lines, '033100-FOOT-FORM', '03', 'Formwork to footing', footFormArea, floor, ids, ev, rf);
            pushItem(lines, '033100-FOOT-CONC', '03', 'Footing concrete', footVol, floor, ids, ev, rf);
            pushItem(lines, '033100-FOOT-REBAR', '03', 'Reinforcing steel to footing', footVol * rebarDensityFor('slab', options.seismicZone), floor, ids, ev, rf);
          }
        }
      }
    }

    // ── DIV 03: CONCRETE — RETAINING WALLS ──
    // Retaining walls are NOT site improvements (Div 32) — they are structural CIP
    // concrete walls below grade. CIQS requires waterproofing and drainage board
    // to be shown as separate items, not bundled with landscape allowances.
    else if (type.includes('retaining wall')) {
      divisionsUsed.add('03');
      divisionsUsed.add('07');
      const L = length || w;
      const wallH = h;
      const t = d;
      if (L > 0 && wallH > 0) {
        const rWallArea = L * wallH;
        // CIP concrete: form one exposed side (earth side unformed / blinding)
        pushItem(lines, '033200-RET-WALL-FORM', '03', 'Formwork to retaining wall (exposed face)', rWallArea, floor, ids, ev, rf);
        if (t > 0) {
          const rWallVol = L * wallH * t;
          pushItem(lines, '033200-RET-WALL-CONC', '03', 'Retaining wall concrete', rWallVol, floor, ids, ev, rf);
          pushItem(lines, '033100-FOOT-REBAR', '03', 'Reinforcing steel to retaining wall', rWallVol * rebarDensityFor('wall', options.seismicZone), floor, ids, ev, rf);
        }
        // Below-grade waterproofing on earth side (mandatory — OBC 9.13 / NBC 5.8)
        pushItem(lines, '033200-RET-WALL-WTPF', '07', 'Waterproofing membrane to retaining wall (earth side)', rWallArea, floor, ids, ev, rf);
        // Drainage board protects waterproofing during backfill
        pushItem(lines, '033200-DRAIN-BOARD', '07', 'Drainage protection board to retaining wall', rWallArea, floor, ids, ev, rf);
      }
    }

    // ── DIV 03: CONCRETE — WALLS ──
    else if (type.includes('wall') && !type.includes('curtain wall') && !type.includes('retaining wall') && !type.includes('drywall')) {
      divisionsUsed.add('03');
      // Precast wall panels
      if (type.includes('precast') || type.includes('pre-cast') || type.includes('tilt-up')) {
        pushItem(lines, '034000-PRECAST', '03', 'Precast wall panel', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      }
      // Cast-in-place walls
      else {
        const L = length || w;
        const wallH = h;
        const t = d;
        if (L > 0 && wallH > 0) {
          const grossWallArea = L * wallH;
          // CODE-1: CIQS deduction — openings >0.5 m² deducted from wall quantities
          const elId = el.id || el.elementId || '';
          const openingDeduct = deductions.byWallId.get(elId) || 0;
          const netWallArea = Math.max(0, grossWallArea - openingDeduct);
          if (openingDeduct > 0) console.log(`[CIQS] Wall ${elId}: gross=${grossWallArea.toFixed(2)} - openings=${openingDeduct.toFixed(2)} = net=${netWallArea.toFixed(2)} m²`);

          // ── CODE-6: Assembly code expansion ──────────────────────────────
          // If this wall element carries an assembly code (e.g. 'EW1', 'IW3D')
          // that matches an entry in assemblyCodeMap (from section drawing
          // extraction), generate per-layer line items instead of generic ones.
          // This gives spec-level, traceable QTO per CIQS QS Step 3.
          // ─────────────────────────────────────────────────────────────────
          const wallAssemblyCode = props.wallType || props.assemblyCode || el.wallType ||
            (el.name || '').match(/\b([A-Z]{1,3}\d[A-Z0-9]*)\b/)?.[1] || '';
          const assemblyDef = wallAssemblyCode && options.assemblyCodeMap
            ? (options.assemblyCodeMap[wallAssemblyCode] || options.assemblyCodeMap[wallAssemblyCode.toUpperCase()])
            : undefined;

          if (assemblyDef && assemblyDef.layers.length > 0) {
            // Spec-level per-layer QTO from assembly definition
            console.log(`[CODE-6] Wall ${elId}: using assembly "${assemblyDef.code}" — ${assemblyDef.layers.length} layers`);
            for (const layer of assemblyDef.layers) {
              const divCode = layer.csiCode.substring(0, 2);
              divisionsUsed.add(divCode);
              let layerQty: number;
              if (layer.unit === 'volume') {
                layerQty = netWallArea * ((layer.thicknessMm ?? 100) / 1000) * (layer.quantityMultiplier ?? 1);
              } else if (layer.unit === 'length') {
                layerQty = L * (layer.quantityMultiplier ?? 1);
              } else {
                layerQty = netWallArea * (layer.quantityMultiplier ?? 1);
              }
              if (layerQty > 0) {
                pushItem(lines, layer.csiCode, divCode, layer.description, layerQty, floor, ids, ev, rf,
                  'verified', gridRef);
              }
            }
            // Still add structural concrete/rebar if no concrete layer in assembly
            const hasConcreteLayer = assemblyDef.layers.some(l => l.csiCode.includes('CONC'));
            if (!hasConcreteLayer && t > 0) {
              const concreteVolume = t * netWallArea;
              pushItem(lines, '033000-FORM', '03', 'Formwork to wall (both sides)', 2 * netWallArea, floor, ids, ev, rf);
              pushItem(lines, '033000-CONC', '03', 'Concrete to wall', concreteVolume, floor, ids, ev, rf);
              pushItem(lines, '033000-REBAR', '03', 'Reinforcing steel to wall', concreteVolume * rebarDensityFor('wall', options.seismicZone), floor, ids, ev, rf);
            }
          } else {
            // Generic wall line items (no assembly code matched)
            pushItem(lines, '033000-FORM', '03', 'Formwork to wall (both sides)', 2 * netWallArea, floor, ids, ev, rf);
            if (t > 0) {
              const concreteVolume = t * netWallArea;
              pushItem(lines, '033000-CONC', '03', 'Concrete to wall', concreteVolume, floor, ids, ev, rf);
              // ADV-1: rebarDensityFor replaces hardcoded 100 kg/m³
              pushItem(lines, '033000-REBAR', '03', 'Reinforcing steel to wall', concreteVolume * rebarDensityFor('wall', options.seismicZone), floor, ids, ev, rf);
            } else {
              incompleteCount++;
              skippedElements.push(`${el.id || el.elementId}: wall concrete — missing thickness`);
            }
            divisionsUsed.add('09');
            pushItem(lines, '092500-DRYWALL', '09', 'Drywall finish to wall', 2 * netWallArea, floor, ids, ev, rf);
            pushItem(lines, '099000-PAINT', '09', 'Paint to wall', 2 * netWallArea, floor, ids, ev, rf);
          }
        }
      }
    }

    // ── DIV 03: CONCRETE — SLABS ──
    else if (type.includes('slab') || (type.includes('floor') && !type.includes('flooring'))) {
      divisionsUsed.add('03');
      if (area > 0 && d > 0) {
        // CODE-1: CIQS deduction — penetrations >1.0 m² deducted from slab quantities
        const elId = el.id || el.elementId || '';
        const penetrationDeduct = deductions.bySlabId.get(elId) || 0;
        const netSlabArea = Math.max(0, area - penetrationDeduct);
        if (penetrationDeduct > 0) console.log(`[CIQS] Slab ${elId}: gross=${area.toFixed(2)} - penetrations=${penetrationDeduct.toFixed(2)} = net=${netSlabArea.toFixed(2)} m²`);
        pushItem(lines, '033000-SLAB-CONC', '03', 'Concrete slab', netSlabArea * d, floor, ids, ev, rf);
        pushItem(lines, '033000-SLAB-FORM', '03', 'Formwork to slab soffit', netSlabArea, floor, ids, ev, rf);
        // ADV-1: rebarDensityFor replaces hardcoded 90 kg/m³
        pushItem(lines, '033000-REBAR', '03', 'Reinforcing steel to slab', netSlabArea * d * rebarDensityFor('slab', options.seismicZone), floor, ids, ev, rf);
      } else if (area > 0) {
        incompleteCount++;
        skippedElements.push(`${el.id || el.elementId}: slab — missing thickness, cannot calculate volume`);
      }
    }

    // ── DIV 03: CONCRETE — COLUMNS ──
    else if (type.includes('column')) {
      divisionsUsed.add('03');
      if (w > 0 && d > 0 && h > 0) {
        const colVol = w * d * h;
        pushItem(lines, '033000-COL-CONC', '03', 'Concrete column', colVol, floor, ids, ev, rf);
        pushItem(lines, '033000-COL-FORM', '03', 'Formwork to column', 2 * (w + d) * h, floor, ids, ev, rf);
        pushItem(lines, '033000-REBAR', '03', 'Reinforcing steel to column', colVol * rebarDensityFor('column', options.seismicZone), floor, ids, ev, rf);
      }
    }

    // ── DIV 03: CONCRETE — BEAMS ──
    else if (type.includes('beam')) {
      divisionsUsed.add('03');
      if (w > 0 && d > 0 && h > 0) {
        const beamVol = w * d * h;
        pushItem(lines, '033000-BEAM-CONC', '03', 'Concrete beam', beamVol, floor, ids, ev, rf);
        pushItem(lines, '033000-BEAM-FORM', '03', 'Formwork to beam', (2 * d + w) * h, floor, ids, ev, rf);
        pushItem(lines, '033000-REBAR', '03', 'Reinforcing steel to beam', beamVol * rebarDensityFor('beam', options.seismicZone), floor, ids, ev, rf);
      }
    }

    // ── DIV 09: FINISHES — CEILINGS ──
    else if (type.includes('ceiling')) {
      divisionsUsed.add('09');
      if (area > 0) {
        pushItem(lines, '095000-CEILING', '09', 'Suspended ceiling', area, floor, ids, ev, rf);
      }
    }

    // ── DIV 08: OPENINGS — DOORS ──
    else if (type.includes('door') || type.includes('access hatch') || type.includes('access panel')) {
      divisionsUsed.add('08');
      if (type.includes('access hatch') || type.includes('access panel') || type.includes('access door')) {
        pushItem(lines, '083100-ACCESS-DOOR', '08', 'Access door/hatch', 1, floor, ids, ev, rf);
      } else {
        const rateCode = type.includes('hollow') || type.includes('metal') || type.includes('hm') ? '081000-DOOR-HM' : '081000-DOOR-WD';
        pushItem(lines, rateCode, '08', 'Door supply & install', 1, floor, ids, ev, rf);
        pushItem(lines, '087000-HARDWARE', '08', 'Door hardware set', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 08: OPENINGS — WINDOWS, CURTAIN WALL, SKYLIGHTS ──
    else if (type.includes('window') || type.includes('glazing') || type.includes('curtain wall') || type.includes('storefront') || type.includes('skylight') || type.includes('roof window') || type.includes('louver') || (type.includes('vent') && !type.includes('event') && !type.includes('prevent'))) {
      divisionsUsed.add('08');
      if (type.includes('curtain wall') || type.includes('storefront')) {
        pushItem(lines, '084000-CURTAIN-WALL', '08', 'Curtain wall/storefront system', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('skylight') || type.includes('roof window')) {
        pushItem(lines, '086000-SKYLIGHT', '08', 'Skylight/roof window', 1, floor, ids, ev, rf);
      } else if (type.includes('louver') || (type.includes('vent') && !type.includes('event') && !type.includes('prevent'))) {
        pushItem(lines, '089000-LOUVER', '08', 'Louver/vent', 1, floor, ids, ev, rf);
      } else if (area > 0) {
        pushItem(lines, '088000-GLAZING', '08', 'Glazing system', area, floor, ids, ev, rf);
      } else {
        pushItem(lines, '085000-WINDOW', '08', 'Window unit', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 07: THERMAL & MOISTURE — ROOFING ──
    else if (type.includes('roof') || type.includes('gutter') || type.includes('downspout') || type.includes('eaves')) {
      divisionsUsed.add('07');
      if (type.includes('gutter') || type.includes('downspout') || type.includes('eaves')) {
        pushItem(lines, '077000-GUTTER', '07', 'Gutters/downspouts', length > 0 ? length : Math.sqrt(area) * 4, floor, ids, ev, rf, length > 0 ? undefined : 'estimated');
      } else if (area > 0) {
        pushItem(lines, '075000-ROOFING', '07', 'Roofing system', area, floor, ids, ev, rf);
        pushItem(lines, '072000-INSULATION', '07', 'Roof insulation', area, floor, ids, ev, rf);
        pushItem(lines, '071000-WATERPROOF', '07', 'Roof waterproofing membrane', area, floor, ids, ev, rf);
        pushItem(lines, '076000-FLASH-SHEET', '07', 'Flashing & sheet metal', Math.sqrt(area) * 4, floor, ids, ev, rf);
        pushItem(lines, '077000-GUTTER', '07', 'Gutters/downspouts', Math.sqrt(area) * 4, floor, ids, ev, rf);
      }
    }

    // ── DIV 03: CONCRETE — STAIRS ──
    else if (type.includes('stair')) {
      divisionsUsed.add('03');
      if (volume > 0) {
        pushItem(lines, '033000-STAIR-CONC', '03', 'Concrete stair', volume, floor, ids, ev, rf);
      }
      divisionsUsed.add('05');
      pushItem(lines, '055200-RAILING', '05', 'Stair railing', length > 0 ? length : 3.5, floor, ids, ev, rf, length > 0 ? undefined : 'estimated');
    }

    // ── DIV 03: CONCRETE — OPERATIONS (underlayment, grout, cutting, mass) ──
    else if (type.includes('underlayment') || type.includes('topping') || type.includes('leveling') || type.includes('grout') || type.includes('saw cut') || type.includes('core drill') || type.includes('concrete cut') || type.includes('mass concrete')) {
      divisionsUsed.add('03');
      if (type.includes('mass concrete') || type.includes('mass pour')) {
        pushItem(lines, '037000-MASS-CONC', '03', 'Mass concrete placement', volume, floor, ids, ev, rf, volume > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('underlayment') || type.includes('topping') || type.includes('leveling')) {
        pushItem(lines, '035000-UNDERLAYMENT', '03', 'Concrete underlayment/topping', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('grout') || type.includes('non-shrink')) {
        pushItem(lines, '036000-GROUT', '03', 'Grouting', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else {
        pushItem(lines, '038000-SAW-CUT', '03', 'Concrete cutting/coring', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      }
    }

    // ── DIV 21: FIRE SUPPRESSION ──
    else if ((type.includes('sprinkler') || type.includes('fire suppress') || type.includes('standpipe') || type.includes('chemical suppress') || type.includes('halon') || type.includes('fm-200') || type.includes('fire water storage') || type.includes('fire cistern')) && !type.includes('fire extinguisher') && !type.includes('fire alarm')) {
      divisionsUsed.add('21');
      if (type.includes('chemical suppress') || type.includes('halon') || type.includes('fm-200') || type.includes('clean agent')) {
        pushItem(lines, '212000-CHEM-SUPPRESS', '21', 'Chemical fire suppression system', 1, floor, ids, ev, rf);
      } else if (type.includes('fire water storage') || type.includes('fire cistern') || type.includes('fire reservoir')) {
        pushItem(lines, '214000-FIRE-WATER-STOR', '21', 'Fire suppression water storage', 1, floor, ids, ev, rf);
      } else if (type.includes('standpipe')) {
        pushItem(lines, '213000-STANDPIPE', '21', 'Standpipe system', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (area > 0) {
        pushItem(lines, '211000-SPRINKLER', '21', 'Sprinkler coverage', area, floor, ids, ev, rf);
      } else {
        pushItem(lines, '211300-SPRINKLER-HEAD', '21', 'Sprinkler head', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 23: HVAC ──
    else if (type.includes('duct') || type.includes('hvac') || type.includes('mechanical') || type.includes('air handler') || type.includes('boiler') || type.includes('chiller') || type.includes('ahu') || type.includes('furnace') || type.includes('fuel system') || type.includes('fuel tank') || type.includes('fuel pipe') || type.includes('air filter') || type.includes('air cleaning') || type.includes('air scrubber') || type.includes('mini-split') || type.includes('ptac') || type.includes('vrf') || type.includes('ductless')) {
      divisionsUsed.add('23');
      if (type.includes('fuel system') || type.includes('fuel tank') || type.includes('fuel pipe')) {
        pushItem(lines, '231000-FUEL-SYS', '23', 'Facility fuel system', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('air filter') || type.includes('air cleaning') || type.includes('air scrubber') || type.includes('hepa')) {
        pushItem(lines, '234000-AIR-CLEAN', '23', 'HVAC air cleaning device', 1, floor, ids, ev, rf);
      } else if (type.includes('mini-split') || type.includes('ptac') || type.includes('vrf') || type.includes('ductless')) {
        pushItem(lines, '238000-DECENTRAL-HVAC', '23', 'Decentralized HVAC (mini-split/VRF/PTAC)', 1, floor, ids, ev, rf);
      } else if (type.includes('boiler') || type.includes('furnace')) {
        pushItem(lines, '235000-BOILER', '23', 'Boiler/furnace', 1, floor, ids, ev, rf);
      } else if (type.includes('chiller')) {
        pushItem(lines, '237000-CHILLER', '23', 'Chiller', 1, floor, ids, ev, rf);
      } else if (type.includes('air handler') || type.includes('ahu')) {
        pushItem(lines, '233600-AHU', '23', 'Air handling unit', 1, floor, ids, ev, rf);
      } else if (type.includes('hvac equip') || type.includes('hvac unit')) {
        pushItem(lines, '233400-HVAC-EQUIP', '23', 'HVAC equipment', 1, floor, ids, ev, rf);
      } else if (area > 0) {
        pushItem(lines, '233000-DUCTWORK', '23', 'HVAC ductwork', area, floor, ids, ev, rf);
      } else {
        pushItem(lines, '233400-HVAC-EQUIP', '23', 'HVAC equipment', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 22: PLUMBING ──
    else if (type.includes('plumb') || type.includes('pipe') || (type.includes('fixture') && !type.includes('light')) || type.includes('lavatory') || type.includes('toilet') || type.includes('sink') || type.includes('faucet') || type.includes('hydronic') || type.includes('pool plumb') || type.includes('fountain plumb') || type.includes('pool pump') || type.includes('gas system') || type.includes('vacuum system') || type.includes('medical gas') || type.includes('lab gas')) {
      divisionsUsed.add('22');
      if (type.includes('pool plumb') || type.includes('fountain plumb') || type.includes('pool pump') || type.includes('pool filter')) {
        pushItem(lines, '225000-POOL-PLUMB', '22', 'Pool/fountain plumbing system', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('gas system') || type.includes('vacuum system') || type.includes('medical gas') || type.includes('lab gas') || type.includes('compressed air')) {
        pushItem(lines, '226000-GAS-VACUUM', '22', 'Gas/vacuum system piping', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if ((type.includes('fixture') && !type.includes('light')) || type.includes('lavatory') || type.includes('toilet') || type.includes('sink') || type.includes('faucet')) {
        pushItem(lines, '224000-PLUMB-FIXT', '22', 'Plumbing fixture', 1, floor, ids, ev, rf);
      } else if (type.includes('hydronic') || type.includes('hvac pipe') || type.includes('refrigerant')) {
        pushItem(lines, '223000-HVAC-PIPE', '22', 'HVAC piping (hydronic/refrigerant)', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (length > 0) {
        pushItem(lines, '221100-PLUMB-PIPE', '22', 'Plumbing piping', length, floor, ids, ev, rf);
      } else {
        pushItem(lines, '221000-PLUMBING', '22', 'Plumbing connection', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 28: ELECTRONIC SAFETY & SECURITY ──
    else if (type.includes('fire alarm') || type.includes('smoke detector') || type.includes('heat detector') || type.includes('security') || type.includes('access control') || type.includes('cctv') || type.includes('camera') || type.includes('intrusion') || type.includes('electronic monitor') || type.includes('scada')) {
      divisionsUsed.add('28');
      if (type.includes('electronic monitor') || type.includes('scada') || type.includes('central monitor')) {
        pushItem(lines, '284000-ELEC-MONITOR', '28', 'Electronic monitoring/control system', 1, floor, ids, ev, rf);
      } else if (type.includes('smoke detector') || type.includes('heat detector') || type.includes('co detector')) {
        pushItem(lines, '281300-FIRE-DET', '28', 'Fire/smoke/heat detector', 1, floor, ids, ev, rf);
      } else if (type.includes('fire alarm')) {
        pushItem(lines, '281000-FIRE-ALARM', '28', 'Fire alarm device', 1, floor, ids, ev, rf);
      } else if (type.includes('access control') || type.includes('card reader')) {
        pushItem(lines, '283000-ACCESS-CTRL', '28', 'Access control system', 1, floor, ids, ev, rf);
      } else if (type.includes('cctv') || type.includes('camera')) {
        pushItem(lines, '284000-CCTV', '28', 'CCTV camera', 1, floor, ids, ev, rf);
      } else {
        pushItem(lines, '282000-SECURITY', '28', 'Security system', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 26: ELECTRICAL ──
    else if (type.includes('electr') || type.includes('light') || type.includes('panel') || type.includes('outlet') || type.includes('receptacle') || type.includes('switchgear') || type.includes('transformer') || type.includes('conduit') || type.includes('wire') || type.includes('cable tray') || type.includes('cathodic')) {
      divisionsUsed.add('26');
      if (type.includes('cathodic') || type.includes('galvanic protection')) {
        pushItem(lines, '264000-CATHODIC', '26', 'Cathodic protection system', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('light') || type.includes('luminaire')) {
        pushItem(lines, '265000-LIGHTING', '26', 'Light fixture', 1, floor, ids, ev, rf);
      } else if (type.includes('switchgear') || type.includes('distribution board')) {
        pushItem(lines, '263000-SWITCHGEAR', '26', 'Switchgear/distribution', 1, floor, ids, ev, rf);
      } else if (type.includes('transformer')) {
        pushItem(lines, '264000-TRANSFORM', '26', 'Transformer', 1, floor, ids, ev, rf);
      } else if (type.includes('conduit')) {
        pushItem(lines, '261000-CONDUIT', '26', 'Electrical conduit', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('wire') || type.includes('cable') || type.includes('cable tray')) {
        pushItem(lines, '260500-WIRE', '26', 'Electrical wiring/cable', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else {
        pushItem(lines, '262000-POWER', '26', 'Electrical distribution', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 27: COMMUNICATIONS ──
    else if (type.includes('communication') || type.includes('data') || type.includes('telecom') || type.includes('audio') || type.includes('av system') || type.includes('intercom') || type.includes('paging') || type.includes('distributed monitor') || type.includes('building monitor')) {
      divisionsUsed.add('27');
      if (type.includes('distributed monitor') || type.includes('building monitor') || type.includes('remote monitor')) {
        pushItem(lines, '275000-DIST-MONITOR', '27', 'Distributed monitoring system', 1, floor, ids, ev, rf);
      } else if (type.includes('audio') || type.includes('av') || type.includes('paging') || type.includes('intercom')) {
        pushItem(lines, '272000-AV', '27', 'Audio-visual/PA system', 1, floor, ids, ev, rf);
      } else if (type.includes('voice') || type.includes('phone')) {
        pushItem(lines, '273000-VOICE', '27', 'Voice/telephone outlet', 1, floor, ids, ev, rf);
      } else if (length > 0) {
        pushItem(lines, '271000-DATA', '27', 'Data cabling', length, floor, ids, ev, rf);
      } else {
        pushItem(lines, '271100-DATA-OUTLET', '27', 'Data outlet', 1, floor, ids, ev, rf);
      }
    }

    // ── DIV 05: METALS ──
    else if (type.includes('steel') || type.includes('metal deck') || type.includes('joist') || type.includes('railing') || type.includes('misc metal') || type.includes('cold-formed') || type.includes('steel stud') || type.includes('light gauge') || type.includes('ornamental') || type.includes('decorative metal')) {
      divisionsUsed.add('05');
      if (type.includes('railing') || type.includes('handrail') || type.includes('guardrail')) {
        pushItem(lines, '055200-RAILING', '05', 'Metal railing', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('metal deck') || type.includes('steel deck')) {
        pushItem(lines, '053000-METAL-DECK', '05', 'Metal decking', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('cold-formed') || type.includes('steel stud') || type.includes('light gauge')) {
        pushItem(lines, '054000-CFS-FRAME', '05', 'Cold-formed steel framing', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('joist')) {
        if (volume > 0) {
          pushItem(lines, '052100-JOIST', '05', 'Steel joist', volume * 7850, floor, ids, ev, rf);
        }
      } else if (type.includes('ornamental') || type.includes('decorative metal') || type.includes('architectural metal')) {
        pushItem(lines, '057000-DECOR-MTL', '05', 'Decorative/ornamental metalwork', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('misc') || type.includes('embed') || type.includes('bracket')) {
        pushItem(lines, '055000-MISC-MTL', '05', 'Miscellaneous metals', volume > 0 ? volume * 7850 : 0, floor, ids, ev, rf, volume > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('clad') || type.includes('deck')) {
        if (area > 0) {
          pushItem(lines, '054000-CLAD', '05', 'Metal cladding/deck', area, floor, ids, ev, rf);
        }
      } else {
        if (volume > 0) {
          pushItem(lines, '051200-STRUCT-STL', '05', 'Structural steel', volume * 7850, floor, ids, ev, rf);
        }
      }
    }

    // ── DIV 04: MASONRY ──
    else if (type.includes('masonry') || type.includes('brick') || type.includes('block') || type.includes('cmu') || type.includes('stone veneer') || type.includes('manufactured stone') || type.includes('cultured stone') || type.includes('refractory') || type.includes('acid-resistant') || type.includes('corrosion-resistant')) {
      divisionsUsed.add('04');
      if (type.includes('refractory') || type.includes('firebrick') || type.includes('kiln lining')) {
        pushItem(lines, '045000-REFRACTORY', '04', 'Refractory masonry', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('acid-resistant') || type.includes('corrosion-resistant') || type.includes('chemical resistant')) {
        pushItem(lines, '046000-CORR-MASONRY', '04', 'Corrosion-resistant masonry', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('brick')) {
        pushItem(lines, '042000-BRICK', '04', 'Brick masonry', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('manufactured') || type.includes('cultured') || type.includes('veneer stone')) {
        pushItem(lines, '047000-MFG-STONE', '04', 'Manufactured/cultured stone veneer', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('stone')) {
        pushItem(lines, '044000-STONE', '04', 'Stone masonry', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else {
        pushItem(lines, '042000-CMU', '04', 'CMU block masonry', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      }
    }

    // ── DIV 06: WOOD, PLASTICS & COMPOSITES ──
    else if (type.includes('wood frame') || type.includes('timber') || type.includes('framing') || type.includes('finish carpentr') || type.includes('millwork') || type.includes('architectural wood') || type.includes('truss') || type.includes('sip') || type.includes('clt') || type.includes('structural panel') || type.includes('glulam') || type.includes('lvl') || type.includes('engineered wood') || type.includes('i-joist') || type.includes('laminated') || type.includes('frp') || type.includes('fiberglass struct') || type.includes('structural plastic') || type.includes('plastic panel') || type.includes('plastic grating') || type.includes('plastic fabricat')) {
      divisionsUsed.add('06');
      if (type.includes('frp') || type.includes('fiberglass struct') || type.includes('structural plastic')) {
        pushItem(lines, '065000-STRUCT-PLASTIC', '06', 'Structural plastics/FRP', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('plastic panel') || type.includes('plastic grating') || type.includes('plastic fabricat') || type.includes('plastic guard')) {
        pushItem(lines, '066000-PLASTIC-FAB', '06', 'Plastic fabrications', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('finish') || type.includes('millwork') || type.includes('trim')) {
        pushItem(lines, '062000-FINISH-CARP', '06', 'Finish carpentry/millwork', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if ((type.includes('architectural') || type.includes('panel')) && !type.includes('structural')) {
        pushItem(lines, '064000-ARCH-WOOD', '06', 'Architectural woodwork', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('sip') || type.includes('clt') || type.includes('structural panel') || type.includes('glulam')) {
        pushItem(lines, '061700-STRUCT-PANEL', '06', 'Structural wood panel (SIP/CLT/glulam)', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('engineered') || type.includes('lvl') || type.includes('i-joist') || type.includes('laminated')) {
        pushItem(lines, '067000-ENG-WOOD', '06', 'Engineered wood (LVL/PSL/I-joist)', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else {
        pushItem(lines, '061000-FRAMING', '06', 'Wood framing', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      }
    }

    // ── DIV 07: THERMAL & MOISTURE — OTHER ──
    else if (type.includes('insulation') || type.includes('waterproof') || type.includes('vapour barrier') || type.includes('vapor barrier') || type.includes('sealant') || type.includes('caulk') || type.includes('flashing') || type.includes('air barrier') || type.includes('weather barrier') || type.includes('tyvek') || type.includes('metal panel') || type.includes('metal siding') || type.includes('firestop') || type.includes('intumescent')) {
      divisionsUsed.add('07');
      if (type.includes('air barrier') || type.includes('weather barrier') || type.includes('tyvek') || type.includes('house wrap')) {
        pushItem(lines, '072500-AIR-BARRIER', '07', 'Air/weather barrier', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('metal panel') || type.includes('metal siding') || type.includes('metal clad')) {
        pushItem(lines, '074000-METAL-PANEL', '07', 'Metal roofing/siding panels', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('firestop') || type.includes('intumescent') || type.includes('fire seal')) {
        pushItem(lines, '078000-FIRESTOP', '07', 'Firestopping/intumescent coating', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('insulation')) {
        pushItem(lines, '072000-INSULATION', '07', 'Insulation', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('waterproof') || type.includes('vapour') || type.includes('vapor')) {
        pushItem(lines, '071000-WATERPROOF', '07', 'Waterproofing/vapour barrier', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('sealant') || type.includes('caulk')) {
        pushItem(lines, '079000-SEALANTS', '07', 'Joint sealant', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else {
        pushItem(lines, '076000-FLASH-SHEET', '07', 'Flashing & sheet metal', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      }
    }

    // ── DIV 09: FINISHES — OTHER ──
    else if (type.includes('flooring') || type.includes('floor finish') || type.includes('carpet') || type.includes('tile') || type.includes('paint') || type.includes('plaster') || type.includes('stucco') || type.includes('drywall') || type.includes('gypsum') || type.includes('wallcovering') || type.includes('wall panel') || type.includes('wainscot') || type.includes('acoustic') || type.includes('sound')) {
      divisionsUsed.add('09');
      if (type.includes('acoustic') || type.includes('sound') || type.includes('noise')) {
        pushItem(lines, '098000-ACOUSTIC', '09', 'Acoustic treatment', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('wallcovering') || type.includes('wall panel') || type.includes('wainscot') || type.includes('wall finish')) {
        pushItem(lines, '097000-WALL-FINISH', '09', 'Wall finishes/covering', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('tile')) {
        pushItem(lines, '093000-TILE', '09', 'Ceramic/porcelain tile', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('paint') || type.includes('coating')) {
        pushItem(lines, '099000-PAINT', '09', 'Paint/coating', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('plaster') || type.includes('stucco')) {
        pushItem(lines, '092000-PLASTER', '09', 'Plaster/stucco', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('drywall') || type.includes('gypsum')) {
        pushItem(lines, '092500-DRYWALL', '09', 'Drywall/gypsum board', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else {
        pushItem(lines, '096000-FLOORING', '09', 'Floor finish', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      }
    }

    // ── DIV 02: EXISTING CONDITIONS ──
    else if (type.includes('demol') || type.includes('abatement') || type.includes('hazmat') || type.includes('asbestos') || type.includes('existing') || type.includes('removal') || type.includes('assessment') || type.includes('survey') || type.includes('geotech') || type.includes('boring') || type.includes('remediat') || type.includes('contaminat') || type.includes('facility remed')) {
      divisionsUsed.add('02');
      if (type.includes('assessment') || type.includes('survey') || type.includes('condition')) {
        pushItem(lines, '022000-ASSESS', '02', 'Site/building assessment', 1, floor, ids, ev, rf);
      } else if (type.includes('geotech') || type.includes('boring') || type.includes('soil test') || type.includes('subsurface')) {
        pushItem(lines, '023000-GEOTECH', '02', 'Geotechnical investigation', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('remediat') && (type.includes('water') || type.includes('ground'))) {
        pushItem(lines, '027000-WATER-REMED', '02', 'Water/groundwater remediation', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('contaminat') || (type.includes('removal') && type.includes('hazard'))) {
        pushItem(lines, '026000-CONTAM-REMOVE', '02', 'Contaminated material removal', volume, floor, ids, ev, rf, volume > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('facility remed') || type.includes('building remed')) {
        pushItem(lines, '028000-FACILITY-REMED', '02', 'Facility remediation', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('abatement') || type.includes('hazmat') || type.includes('asbestos') || type.includes('lead')) {
        pushItem(lines, '024200-ABATE', '02', 'Hazardous material abatement', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('selective')) {
        pushItem(lines, '024100-DEMO-SEL', '02', 'Selective demolition', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (area > 0) {
        // Non-selective demo with area — use area-based rate
        pushItem(lines, '024100-DEMO-SEL', '02', 'Demolition (area-based)', area, floor, ids, ev, rf);
      } else {
        pushItem(lines, '024100-DEMO', '02', 'Demolition', volume, floor, ids, ev, rf, volume > 0 ? undefined : 'missing_dimensions');
      }
    }

    // ── DIV 31: EARTHWORK ──
    else if (type.includes('excavat') || type.includes('grading') || type.includes('backfill') || type.includes('earthwork') || type.includes('pile') || type.includes('shoring') || type.includes('trench') || type.includes('site clearing') || type.includes('tree removal') || type.includes('stripping') || type.includes('tunnel') || type.includes('mining')) {
      divisionsUsed.add('31');
      if (type.includes('tunnel') || type.includes('mining') || type.includes('bore tunnel')) {
        pushItem(lines, '317000-TUNNEL', '31', 'Tunneling/mining', volume, floor, ids, ev, rf, volume > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('site clearing') || type.includes('tree removal') || type.includes('stripping') || type.includes('brush clear')) {
        pushItem(lines, '311000-SITE-CLEAR', '31', 'Site clearing', area > 0 ? area / 10000 : 0, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('pile') || type.includes('caisson') || type.includes('driven')) {
        pushItem(lines, '315000-PILE', '31', 'Piling/caisson', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('shoring') || type.includes('bracing')) {
        pushItem(lines, '316000-SHORING', '31', 'Shoring/bracing', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('backfill') || type.includes('compaction')) {
        pushItem(lines, '313000-BACKFILL', '31', 'Backfill & compaction', volume, floor, ids, ev, rf, volume > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('grading') || type.includes('grade')) {
        pushItem(lines, '312000-GRADING', '31', 'Grading', volume, floor, ids, ev, rf, volume > 0 ? undefined : 'missing_dimensions');
      } else {
        pushItem(lines, '312300-EXCAVATE', '31', 'Excavation', volume, floor, ids, ev, rf, volume > 0 ? undefined : 'missing_dimensions');
      }
    }

    // ── DIV 32: EXTERIOR IMPROVEMENTS ──
    else if (type.includes('paving') || type.includes('asphalt') || type.includes('landscape') || type.includes('planting') || type.includes('fence') || type.includes('curb') || type.includes('sidewalk') || type.includes('retaining wall') || type.includes('irrigation') || type.includes('sprinkler system') || type.includes('wetland') || type.includes('bioswale')) {
      divisionsUsed.add('32');
      if (type.includes('wetland') || type.includes('bioswale') || type.includes('rain garden')) {
        pushItem(lines, '327000-WETLANDS', '32', 'Wetlands/bioswale construction', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('irrigation') || (type.includes('sprinkler') && type.includes('landscape'))) {
        pushItem(lines, '328000-IRRIGATION', '32', 'Irrigation system', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('fence') || type.includes('gate')) {
        pushItem(lines, '323000-SITE-FENCE', '32', 'Site fencing', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('landscape') || type.includes('planting') || type.includes('tree')) {
        if (type.includes('tree') || type.includes('shrub')) {
          pushItem(lines, '329300-PLANT-TREE', '32', 'Tree/shrub planting', 1, floor, ids, ev, rf);
        } else {
          pushItem(lines, '329000-LANDSCAPE', '32', 'Landscaping', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
        }
      } else if (type.includes('curb') || type.includes('sidewalk')) {
        pushItem(lines, '321400-CURB', '32', 'Curb & sidewalk', length, floor, ids, ev, rf, length > 0 ? undefined : 'missing_dimensions');
      } else {
        pushItem(lines, '321000-PAVING', '32', 'Paving', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      }
    }

    // ── DIV 01: GENERAL REQUIREMENTS (catch-all for site/admin/temp) ──
    else if (type.includes('general') || type.includes('temporary') || type.includes('cleanup') || type.includes('admin') || type.includes('site office') || type.includes('supervision') || type.includes('testing') || type.includes('inspection') || type.includes('quality')) {
      divisionsUsed.add('01');
      if (type.includes('testing') || type.includes('inspection') || type.includes('quality')) {
        pushItem(lines, '014000-QA-TEST', '01', 'Quality testing/inspection', 1, floor, ids, ev, rf);
      } else if (type.includes('cleanup') || type.includes('clean-up')) {
        pushItem(lines, '017000-CLEANUP', '01', 'Site cleanup', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('temporary') || type.includes('temp ')) {
        pushItem(lines, '015000-TEMP', '01', 'Temporary facilities', area, floor, ids, ev, rf, area > 0 ? undefined : 'missing_dimensions');
      } else if (type.includes('admin') || type.includes('site office') || type.includes('supervision')) {
        pushItem(lines, '013000-ADMIN', '01', 'Project administration/supervision', 1, floor, ids, ev, rf);
      } else {
        pushItem(lines, '011000-GENERAL', '01', 'General requirements', 1, floor, ids, ev, rf);
      }
    }

    // ── CSI CODE FALLBACK — use embedded CSI code if keyword matching failed ──
    else if (csi) {
      const divCode = csi.substring(0, 2);
      const divName = CSI_DIVISIONS[divCode];
      if (divName) {
        divisionsUsed.add(divCode);
        const rateKey = Object.keys(CSI_RATES).find(k => k.startsWith(csi.substring(0, 6).toUpperCase()));
        if (rateKey) {
          pushItem(lines, rateKey, divCode, `${divName} element (CSI ${csi})`, 1, floor, ids, ev, rf, 'estimated');
        } else {
          const divRateKey = Object.keys(CSI_RATES).find(k => k.startsWith(divCode));
          if (divRateKey) {
            pushItem(lines, divRateKey, divCode, `${divName} element (CSI ${csi})`, 1, floor, ids, ev, rf, 'estimated');
          }
        }
      }
    }

    // Est-5 FIX: Track elements that matched no classification — no longer silently dropped.
    // Previously these were neither added to skippedElements nor lineItems.
    // Now they are counted and logged so the QS knows the estimate is incomplete.
    if (lines.length === lineCountBefore) {
      // Element produced zero line items — not classified by keyword or CSI code
      skippedElements.push(
        `${el.id || el.elementId || 'unknown'}: "${type || 'no-type'}" — no CSI classification matched; ` +
        `add elementType keyword or CSI code. Floor: ${floor}.`
      );
      incompleteCount++;
      console.warn(`⚠️ [estimate-engine] Element dropped (no classification): type="${type}" csi="${csi}" id="${el.id || el.elementId}"`);
    }

    // Stamp grid reference on all line items pushed for this element
    if (gridRef && lines.length > lineCountBefore) {
      for (let li = lineCountBefore; li < lines.length; li++) {
        lines[li].gridRef = gridRef;
      }
    }
  }

  // ── STEP-4: Apply construction type crew factors ──────────────────────────
  // Applied post-element-loop to all line items in a single pass.
  // Keeps pushItem signature unchanged — no need to thread ctf through 200+ calls.
  // Only Div 03–14 structural/arch items get crew adjustment; MEP (21–28) crew
  // sizes are already calibrated in ontario-mep-rates.ts and are left unchanged.
  const MEP_DIVS = new Set(['21','22','23','25','26','27','28']);
  if (ctf.laborMultiplier !== 1.0 || ctf.equipmentMultiplier !== 1.0 || ctf.productivityMultiplier !== 1.0) {
    let crewAdjustedCount = 0;
    for (const li of lines) {
      if (MEP_DIVS.has(li.csiDivision)) continue; // MEP rates already calibrated
      li.laborRate      = li.laborRate      * ctf.laborMultiplier;
      li.laborCost      = li.laborRate      * li.quantity;
      li.equipmentRate  = li.equipmentRate  * ctf.equipmentMultiplier;
      li.equipmentCost  = li.equipmentRate  * li.quantity;
      // Recompute materialCost from materialRate to keep M+L+E consistent
      li.materialCost   = li.materialRate   * li.quantity;
      if (li.productivityRate && li.productivityRate > 0) {
        li.productivityRate = li.productivityRate * ctf.productivityMultiplier;
        li.laborHours       = li.quantity / li.productivityRate;
      }
      // Recompute rate and totals after crew factor adjustment
      li.totalRate = li.materialRate + li.laborRate + li.equipmentRate;
      li.totalCost = li.materialCost + li.laborCost + li.equipmentCost;
      crewAdjustedCount++;
    }
    if (crewAdjustedCount > 0) {
      console.log(`[STEP-4] Crew adjustment applied to ${crewAdjustedCount} line items (${ctf.label})`);
    }
  }

  // ── Group by floor ─────────────────────────────────────────────────────────
  const floorMap = new Map<string, EstimateLineItem[]>();
  for (const li of lines) {
    const f = li.floor || 'Unassigned';
    if (!floorMap.has(f)) floorMap.set(f, []);
    floorMap.get(f)!.push(li);
  }

  const floors: FloorSummary[] = [];
  let materialGT = 0, laborGT = 0, equipmentGT = 0, wasteGT = 0;

  for (const [floorName, items] of floorMap) {
    const materialTotal = items.reduce((s, i) => s + i.materialCost, 0);
    const laborTotal = items.reduce((s, i) => s + i.laborCost, 0);
    const equipmentTotal = items.reduce((s, i) => s + i.equipmentCost, 0);
    // Calculate waste cost: the portion of total cost attributable to waste quantities
    const wasteTotal = items.reduce((s, i) => {
      if (i.wasteQuantity <= 0 || i.quantity <= 0) return s;
      const wasteFraction = i.wasteQuantity / i.quantity;
      return s + (i.totalCost * wasteFraction);
    }, 0);
    const floorLaborHours = items.reduce((s, i) => s + (i.laborHours || 0), 0);
    floors.push({
      floor: floorName,
      floorLabel: floorName,       // Alias for downstream consumers
      lineItems: items,
      materialTotal,
      laborTotal,
      equipmentTotal,
      subtotal: materialTotal + laborTotal + equipmentTotal,
      totalLaborHours: floorLaborHours,
      // costPerM2 is set after GFA is known (see post-sort block below)
    });
    materialGT += materialTotal;
    laborGT += laborTotal;
    equipmentGT += equipmentTotal;
    wasteGT += wasteTotal;
  }

  // Sort floors logically
  // Floor order: below-grade → grade → superstructure → penthouse/mechanical → roof → site
  // Handles: P1/P2/B1/B2 parking, Penthouse, Mechanical Level, numbered floors up to 20
  const floorOrder = [
    'P-3','P-2','P-1',                              // parking below grade
    'B3','B2','B1',                                 // basement levels
    'Underground','Basement',
    'Ground','1st','2nd','3rd','4th','5th',
    '6th','7th','8th','9th','10th',
    '11th','12th','13th','14th','15th',
    '16th','17th','18th','19th','20th',
    'Penthouse','Mechanical Level','Mechanical',     // above top occupied floor
    'Roof','Rooftop',
    'Site','Exterior','Unassigned',
  ];
  function floorSortKey(floorName: string): number {
    const fl = floorName.toLowerCase().trim();
    // Numeric parking: P1, P2, P-1, Level P2 etc.
    const parkMatch = fl.match(/^(?:level\s*)?p[-\s]?(\d)/i);
    if (parkMatch) return -10 + parseInt(parkMatch[1]);
    // Basement levels: B1, B2 etc.
    const bsmtMatch = fl.match(/^b(\d)/i);
    if (bsmtMatch) return -5 - parseInt(bsmtMatch[1]);
    // Numbered floors: level 3, floor 4, 5th floor etc.
    const numMatch = fl.match(/(?:level|floor)?\s*(\d{1,2})(?:st|nd|rd|th)?/i);
    if (numMatch) return parseInt(numMatch[1]);
    // Named floors from ordered list
    const idx = floorOrder.findIndex(f => fl.includes(f.toLowerCase()));
    return idx === -1 ? 50 : idx;
  }
  floors.sort((a, b) => floorSortKey(a.floor) - floorSortKey(b.floor));

  // Compute costPerM2 per floor: floor subtotal / GFA (GFA from sanity or override)
  // Also compute totalLaborHours for entire project
  const projectGFA = options.grossFloorAreaOverride && options.grossFloorAreaOverride > 0
    ? options.grossFloorAreaOverride
    : lines.filter(l => l.csiDivision === '03').reduce((s, l) => {
        // proxy GFA from slab items
        return l.description?.toLowerCase().includes('slab') ? s + l.quantity : s;
      }, 0);
  let totalProjectLaborHours = 0;
  for (const fl of floors) {
    if (projectGFA > 0 && fl.subtotal > 0) {
      fl.costPerM2 = fl.subtotal / projectGFA;
    }
    totalProjectLaborHours += fl.totalLaborHours || 0;
  }

  // CODE-2: QTO sanity cross-check
  const sanityCheck = runQtoSanityCheck(elements, {
    scheduleDocCounts: options.scheduleDocCounts,
    grossFloorAreaOverride: options.grossFloorAreaOverride,
  });
  if (!sanityCheck.passed) {
    console.warn(`[estimate-engine] QTO sanity FAILED — ${sanityCheck.warnings.length} warning(s):`);
    sanityCheck.warnings.forEach(w => console.warn(`  • ${w}`));
  }

  const quantityWarnings = lines
    .filter(li => li.verificationStatus === 'missing_dimensions')
    .map(li => ({ csiCode: li.csiCode, description: li.description, floor: li.floor, reason: 'Zero dimensions — quantity excluded from total' }));

  return {
    floors,
    grandTotal: materialGT + laborGT + equipmentGT,
    materialGrandTotal: materialGT,
    laborGrandTotal: laborGT,
    equipmentGrandTotal: equipmentGT,
    wasteGrandTotal: wasteGT,
    incompleteElements: incompleteCount,
    skippedElements,
    currency: 'CAD',
    region: region ?? '',
    regionalFactor: rf,
    methodology: 'CIQS',
    generatedAt: new Date().toISOString(),
    lineItemCount: lines.length,
    csiDivisionsUsed: divisionsUsed.size,
    sanityCheck,
    openingDeductionsSummary: deductions.audit,
    quantityWarnings: quantityWarnings.length > 0 ? quantityWarnings : undefined,
    totalLaborHours: totalProjectLaborHours,
    costPerM2: (projectGFA > 0 && (materialGT + laborGT + equipmentGT) > 0)
      ? (materialGT + laborGT + equipmentGT) / projectGFA
      : undefined,
  };
}

// ─── Route-facing wrapper — fetches elements from DB then runs estimate ──────

export async function buildEstimateForModel(modelId: string, opts?: { scheduleDocCounts?: { doors: number; windows: number }; grossFloorAreaOverride?: number }): Promise<EstimateSummary> {
  // Pre-load DB rates before synchronous estimate loop
  await preloadDbRates();

  let elements: any[] = await storage.getBimElements(modelId);
  if (!elements || elements.length === 0) {
    throw new Error(`No BIM elements found for model ${modelId}`);
  }

  // Try to resolve region from the model's project — no hardcoded fallback per no-defaults policy
  let region: string | undefined = undefined;
  let projectId: string | null = null;
  // v15.29: Building class from project schema — affects NBC/OBC cost factor
  let buildingClass: 'A' | 'B' | 'C' | 'D' | undefined = undefined;
  // STEP-4: Construction type from model geometry data (set by CWP spec analysis)
  let constructionType: string | undefined = undefined;
  // ADV-1: Seismic zone from model geometry data — drives rebarDensityFor() multipliers
  let seismicZone: 'low' | 'moderate' | 'high' | undefined = undefined;
  // CODE-6: Assembly code map from model geometry data (set by CWP section drawing analysis)
  let assemblyCodeMap: Record<string, AssemblyDefinition> | undefined = undefined;

  try {
    const model = await storage.getBimModel(modelId);
    if (model?.projectId) {
      projectId = model.projectId;
      const project = await storage.getProject(model.projectId);
      if (project?.location) {
        region = String(project.location);
      }
      // v15.29: Read buildingClass from project record
      const bc = (project as any)?.buildingClass;
      if (bc && ['A', 'B', 'C', 'D'].includes(bc)) {
        buildingClass = bc as 'A' | 'B' | 'C' | 'D';
      }
    }
    // Read STEP-4 and CODE-6 data from model.geometryData (stored by BIMGenerator)
    if (model?.geometryData) {
      let gd: any;
      try {
        gd = typeof model.geometryData === 'string' ? JSON.parse(model.geometryData) : model.geometryData;
      } catch (e) {
        console.warn(`[buildEstimateForModel] Failed to parse model.geometryData JSON:`, e);
        gd = null;
      }
      if (gd?.constructionType && CONSTRUCTION_TYPE_CREW_FACTORS[gd.constructionType]) {
        constructionType = gd.constructionType;
        console.log(`[buildEstimateForModel] STEP-4: constructionType="${constructionType}" from model.geometryData`);
      }
      if (gd?.assemblyCodeMap && typeof gd.assemblyCodeMap === 'object') {
        assemblyCodeMap = gd.assemblyCodeMap as Record<string, AssemblyDefinition>;
        console.log(`[buildEstimateForModel] CODE-6: ${Object.keys(assemblyCodeMap).length} assembly definitions loaded`);
      }
      // ADV-1: Seismic zone from BIM analysis — drives CSA G30.18 rebar density
      const validZones = new Set(['low', 'moderate', 'high']);
      const rawZone = gd?.seismicZone || gd?.seismic_zone || gd?.seismicPga;
      if (typeof rawZone === 'string' && validZones.has(rawZone)) {
        seismicZone = rawZone as 'low' | 'moderate' | 'high';
        console.log(`[buildEstimateForModel] ADV-1: seismicZone="${seismicZone}" from model.geometryData`);
      } else if (typeof gd?.seismicPga === 'number') {
        // Convert PGA (g) to zone: NBC Table C-2 Ontario thresholds
        seismicZone = gd.seismicPga >= 0.2 ? 'high' : gd.seismicPga >= 0.1 ? 'moderate' : 'low';
        console.log(`[buildEstimateForModel] ADV-1: seismicZone="${seismicZone}" derived from PGA=${gd.seismicPga}`);
      }
    }
  } catch {
    // DB error — region/constructionType/seismicZone/assemblyCodeMap remain undefined; safe fallbacks apply
  }

  // Enrich elements with detected grid references (e.g., "Column at A-3")
  // Non-blocking: if no detected grid or bridge unavailable, elements pass through unchanged
  if (projectId) {
    try {
      elements = await enrichElementsWithGridRefs(elements, projectId);
    } catch {
      // Grid enrichment is non-blocking
    }
  }

  // ── STEP-4 EXTENSION: Sequence-calibrated labor hours ─────────────────────
  // If the QS has confirmed a construction sequence for this project, use the
  // confirmed activity durations and crew sizes to override the productivity-
  // derived laborHours for structural/architectural line items.
  //
  // Rationale: a QS-confirmed sequence carries schedule authority that overrides
  // generic productivity rates. If the QS says "pour Floor 3 slab = 12 days,
  // crew of 8", the estimate's labor hours for that floor's concrete items must
  // align — otherwise the BoQ and the schedule will contradict each other.
  //
  // MEP (Div 21–28) and finishes (Div 09) are excluded — those are driven by
  // MEP productivity rates, not pour sequence.
  //
  // This is non-blocking: if no confirmed sequence exists, the estimate is
  // returned unchanged.
  const SEQUENCE_EXCLUDED_DIVS = new Set(['21','22','23','25','26','27','28','09']);

  let _sequenceCalibrated = false;
  if (projectId) {
    try {
      const confirmedSeq = await (storage as any).getLatestConstructionSequence?.(projectId, modelId);
      if (confirmedSeq?.status === 'confirmed' && confirmedSeq.confirmedData) {
        let seqData: any;
        try {
          seqData = typeof confirmedSeq.confirmedData === 'string'
            ? JSON.parse(confirmedSeq.confirmedData)
            : confirmedSeq.confirmedData;
        } catch (e) {
          console.warn(`[buildEstimateForModel] Failed to parse confirmedSeq.confirmedData JSON:`, e);
          seqData = {};
        }

        const activities: Array<{
          activityId:    string;
          floors:        string[];
          csiDivisions:  string[];
          durationDays:  number;
          crewSize:      number;
          isCriticalPath: boolean;
        }> = seqData.activities || [];

        // Build a lookup: floor+csiDiv → { totalHours: durationDays × crewSize × 8 }
        // (8 working hours per day)
        const floorDivHours = new Map<string, number>();
        for (const act of activities) {
          const actHours = act.durationDays * act.crewSize * 8;
          const floorScope = act.floors.length > 0 ? act.floors : ['*']; // '*' = all floors
          for (const floor of floorScope) {
            for (const div of act.csiDivisions) {
              const key = `${floor.toLowerCase()}::${div.replace(/^0+/, '')}`;
              // Sum hours if multiple activities cover the same floor+division
              floorDivHours.set(key, (floorDivHours.get(key) || 0) + actHours);
            }
          }
        }

        // Apply the sequence hours to matching line items
        const estimate = await generateEstimateFromElements(elements, {
          region,
          seismicZone,
          buildingClass,
          scheduleDocCounts:      opts?.scheduleDocCounts,
          grossFloorAreaOverride: opts?.grossFloorAreaOverride,
          constructionType,
          assemblyCodeMap,
        });

        // GFA for costPerM2: prefer explicit override, fall back to estimate's own proxy
        const seqGFA = (opts?.grossFloorAreaOverride && opts.grossFloorAreaOverride > 0)
          ? opts.grossFloorAreaOverride
          : estimate.costPerM2 && estimate.grandTotal > 0
            ? estimate.grandTotal / estimate.costPerM2   // back-calculate GFA from estimate
            : 0;

        let calibratedCount = 0;

        for (const floorSummary of estimate.floors) {
          const floorKey = (floorSummary.floor || '').toLowerCase();

          // Group line items by CSI division within this floor
          // FloorSummary.lineItems is the correct field name (not .items)
          const itemsByDiv = new Map<string, typeof floorSummary.lineItems>();
          for (const item of floorSummary.lineItems) {
            const div = (item.csiDivision || '').replace(/^0+/, '');
            if (!itemsByDiv.has(div)) itemsByDiv.set(div, []);
            itemsByDiv.get(div)!.push(item);
          }

          for (const [div, items] of itemsByDiv) {
            if (SEQUENCE_EXCLUDED_DIVS.has(div)) continue;

            // Check floor-specific match first, then wildcard
            const seqHours =
              floorDivHours.get(`${floorKey}::${div}`) ??
              floorDivHours.get(`*::${div}`);

            if (!seqHours || seqHours <= 0) continue;

            // Distribute sequence hours proportionally across items in this floor+div
            // by their existing laborHours weight
            const existingTotal = items.reduce((s, i) => s + (i.laborHours || 0), 0);
            if (existingTotal <= 0) continue; // no hours to redistribute

            for (const item of items) {
              const weight = (item.laborHours || 0) / existingTotal;
              const newHours = seqHours * weight;
              if (newHours <= 0) continue;

              // Recompute labor cost from new hours × original rate
              // (rate = laborCost / laborHours before calibration)
              const originalRate = (item.laborHours ?? 0) > 0
                ? item.laborCost / (item.laborHours ?? 1)
                : item.laborRate;

              item.laborHours = newHours;
              item.laborCost  = newHours * originalRate;
              item.totalCost  = item.materialCost + item.laborCost + item.equipmentCost;
              (item as any).sequenceCalibrated = true;
              calibratedCount++;
            }

            // BUG-1 FIX: FloorSummary field is lineItems, not items
            floorSummary.subtotal = floorSummary.lineItems.reduce((s, i) => s + i.totalCost, 0);
            // BUG-3 FIX: use seqGFA (computed above) — not estimate.summary.grossFloorArea (non-existent)
            if (floorSummary.subtotal > 0 && seqGFA > 0) {
              floorSummary.costPerM2 = floorSummary.subtotal / seqGFA;
            }
          }
        }

        if (calibratedCount > 0) {
          // BUG-2 FIX: estimate IS EstimateSummary — there is no .summary sub-property
          // Recompute top-level totals directly on the estimate object
          const newGrandTotal = estimate.floors.reduce((s, f) => s + f.subtotal, 0);
          estimate.grandTotal      = newGrandTotal;
          estimate.laborGrandTotal = estimate.floors.reduce(
            (s, f) => s + f.lineItems.reduce((si, i) => si + i.laborCost, 0), 0
          );
          estimate.totalLaborHours = estimate.floors.reduce(
            (s, f) => s + f.lineItems.reduce((si, i) => si + (i.laborHours || 0), 0), 0
          );
          // Sequence audit metadata as top-level fields
          (estimate as any).sequenceCalibrated      = true;
          (estimate as any).sequenceCalibratedCount = calibratedCount;
          (estimate as any).confirmedSequenceId     = confirmedSeq.id;
          _sequenceCalibrated = true;
          console.log(`[STEP-4-SEQ] Sequence-calibrated ${calibratedCount} line items from confirmed sequence ${confirmedSeq.id}`);
        }

        return estimate;
      }
    } catch (seqErr: any) {
      // Non-blocking — if sequence calibration fails, fall through to standard estimate
      console.warn(`[STEP-4-SEQ] Sequence calibration skipped (non-fatal): ${seqErr?.message}`);
    }
  }

  return generateEstimateFromElements(elements, {
    region,
    seismicZone,
    buildingClass,
    scheduleDocCounts:      opts?.scheduleDocCounts,
    grossFloorAreaOverride: opts?.grossFloorAreaOverride,
    constructionType,
    assemblyCodeMap,
  });
}
