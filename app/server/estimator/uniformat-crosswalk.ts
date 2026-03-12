// server/estimator/uniformat-crosswalk.ts
// =============================================================================
// UNIFORMAT II CROSS-WALK + NRM1/NRM2 MEASUREMENT RULES + WBS INTEGRATION
// =============================================================================
//
// Closes QS Level 5 gaps:
//   0.2  UNIFORMAT II Elemental Mapping (CSI → UNIFORMAT Level 3)
//   0.3  NRM1/NRM2 Measurement Rules per rate type
//   0.4  Element ↔ Division Cross-Walk Table (exportable)
//   1.3  WBS/CBS default structure from CSI
//   3.7  NRM2 Measurement Notes (post-process enrichment)
//   7.4  Element ↔ Division Reconciliation
//
// Consumes: EstimateLineItem, FloorSummary, EstimateSummary from estimate-engine.ts
// Consumed by: boe-generator.ts, benchmark-engine.ts, qs-level5-routes.ts
//
// Standards: ASTM E1557 (UNIFORMAT II), RICS NRM1/NRM2, CSI MasterFormat 2018
// =============================================================================

import type {
  EstimateLineItem,
  FloorSummary,
  EstimateSummary,
} from './estimate-engine';


// ─── UNIFORMAT II CLASSIFICATION (ASTM E1557-09) ────────────────────────────

export interface UniformatElement {
  level1Code: string;       // A, B, C, D, E, F, G
  level1Name: string;
  level2Code: string;       // A10, B20, etc.
  level2Name: string;
  level3Code: string;       // A1010, B2020, etc.
  level3Name: string;
}

/** Maps every CSI 2-digit division → UNIFORMAT Level 3 element */
export const CSI_TO_UNIFORMAT: Record<string, UniformatElement> = {
  // A — SUBSTRUCTURE
  '31': { level1Code: 'A', level1Name: 'Substructure', level2Code: 'A10', level2Name: 'Foundations', level3Code: 'A1010', level3Name: 'Standard Foundations' },
  '02': { level1Code: 'A', level1Name: 'Substructure', level2Code: 'A10', level2Name: 'Foundations', level3Code: 'A1030', level3Name: 'Slab on Grade' },

  // B — SHELL
  '03': { level1Code: 'B', level1Name: 'Shell', level2Code: 'B10', level2Name: 'Superstructure', level3Code: 'B1010', level3Name: 'Floor Construction' },
  '04': { level1Code: 'B', level1Name: 'Shell', level2Code: 'B20', level2Name: 'Exterior Enclosure', level3Code: 'B2010', level3Name: 'Exterior Walls' },
  '05': { level1Code: 'B', level1Name: 'Shell', level2Code: 'B10', level2Name: 'Superstructure', level3Code: 'B1020', level3Name: 'Roof Construction' },
  '07': { level1Code: 'B', level1Name: 'Shell', level2Code: 'B30', level2Name: 'Roofing', level3Code: 'B3010', level3Name: 'Roof Coverings' },
  '08': { level1Code: 'B', level1Name: 'Shell', level2Code: 'B20', level2Name: 'Exterior Enclosure', level3Code: 'B2020', level3Name: 'Exterior Windows' },

  // C — INTERIORS
  '06': { level1Code: 'C', level1Name: 'Interiors', level2Code: 'C10', level2Name: 'Interior Construction', level3Code: 'C1010', level3Name: 'Partitions' },
  '09': { level1Code: 'C', level1Name: 'Interiors', level2Code: 'C30', level2Name: 'Interior Finishes', level3Code: 'C3010', level3Name: 'Wall Finishes' },
  '10': { level1Code: 'C', level1Name: 'Interiors', level2Code: 'C10', level2Name: 'Interior Construction', level3Code: 'C1030', level3Name: 'Fittings' },

  // D — SERVICES
  '14': { level1Code: 'D', level1Name: 'Services', level2Code: 'D10', level2Name: 'Conveying', level3Code: 'D1010', level3Name: 'Elevators & Lifts' },
  '21': { level1Code: 'D', level1Name: 'Services', level2Code: 'D40', level2Name: 'Fire Protection', level3Code: 'D4010', level3Name: 'Sprinklers' },
  '22': { level1Code: 'D', level1Name: 'Services', level2Code: 'D20', level2Name: 'Plumbing', level3Code: 'D2010', level3Name: 'Plumbing Fixtures' },
  '23': { level1Code: 'D', level1Name: 'Services', level2Code: 'D30', level2Name: 'HVAC', level3Code: 'D3010', level3Name: 'Energy Supply' },
  '25': { level1Code: 'D', level1Name: 'Services', level2Code: 'D50', level2Name: 'Electrical', level3Code: 'D5090', level3Name: 'Other Electrical Systems' },
  '26': { level1Code: 'D', level1Name: 'Services', level2Code: 'D50', level2Name: 'Electrical', level3Code: 'D5010', level3Name: 'Electrical Service & Distribution' },
  '27': { level1Code: 'D', level1Name: 'Services', level2Code: 'D50', level2Name: 'Electrical', level3Code: 'D5030', level3Name: 'Communications & Security' },
  '28': { level1Code: 'D', level1Name: 'Services', level2Code: 'D50', level2Name: 'Electrical', level3Code: 'D5030', level3Name: 'Communications & Security' },

  // E — EQUIPMENT & FURNISHINGS
  '11': { level1Code: 'E', level1Name: 'Equipment & Furnishings', level2Code: 'E10', level2Name: 'Equipment', level3Code: 'E1010', level3Name: 'Commercial Equipment' },
  '12': { level1Code: 'E', level1Name: 'Equipment & Furnishings', level2Code: 'E20', level2Name: 'Furnishings', level3Code: 'E2010', level3Name: 'Fixed Furnishings' },

  // F — SPECIAL CONSTRUCTION & DEMOLITION
  '13': { level1Code: 'F', level1Name: 'Special Construction', level2Code: 'F10', level2Name: 'Special Construction', level3Code: 'F1010', level3Name: 'Special Structures' },
  '35': { level1Code: 'F', level1Name: 'Special Construction', level2Code: 'F10', level2Name: 'Special Construction', level3Code: 'F1050', level3Name: 'Marine Construction' },

  // G — BUILDING SITEWORK
  '32': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G20', level2Name: 'Site Improvements', level3Code: 'G2010', level3Name: 'Roadways' },
  '33': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G30', level2Name: 'Site Mechanical Utilities', level3Code: 'G3010', level3Name: 'Water Supply' },
  '34': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G40', level2Name: 'Site Electrical Utilities', level3Code: 'G4010', level3Name: 'Electrical Distribution' },

  // Z — GENERAL REQUIREMENTS (mapped to cost category, not element)
  '01': { level1Code: 'Z', level1Name: 'General Requirements', level2Code: 'Z10', level2Name: 'General Requirements', level3Code: 'Z1010', level3Name: 'Administration & Supervision' },

  // PROCESS (Div 40-48) — mapped to F (Special Construction)
  '40': { level1Code: 'F', level1Name: 'Special Construction', level2Code: 'F20', level2Name: 'Selective Building Demolition', level3Code: 'F2010', level3Name: 'Process Interconnections' },
  '41': { level1Code: 'F', level1Name: 'Special Construction', level2Code: 'F20', level2Name: 'Selective Building Demolition', level3Code: 'F2020', level3Name: 'Material Handling' },
  '42': { level1Code: 'F', level1Name: 'Special Construction', level2Code: 'F20', level2Name: 'Selective Building Demolition', level3Code: 'F2030', level3Name: 'Process Equipment' },
  '43': { level1Code: 'F', level1Name: 'Special Construction', level2Code: 'F20', level2Name: 'Selective Building Demolition', level3Code: 'F2030', level3Name: 'Process Equipment' },
  '44': { level1Code: 'F', level1Name: 'Special Construction', level2Code: 'F20', level2Name: 'Selective Building Demolition', level3Code: 'F2040', level3Name: 'Pollution Control' },
  '45': { level1Code: 'F', level1Name: 'Special Construction', level2Code: 'F20', level2Name: 'Selective Building Demolition', level3Code: 'F2050', level3Name: 'Manufacturing' },
  '46': { level1Code: 'F', level1Name: 'Special Construction', level2Code: 'F20', level2Name: 'Selective Building Demolition', level3Code: 'F2060', level3Name: 'Water Treatment' },
  '48': { level1Code: 'F', level1Name: 'Special Construction', level2Code: 'F20', level2Name: 'Selective Building Demolition', level3Code: 'F2070', level3Name: 'Power Generation' },
};


// ─── NRM1 / NRM2 MEASUREMENT RULES ─────────────────────────────────────────

export type MeasurementBasis = 'gross' | 'net' | 'centerline' | 'internal' | 'external' | 'superimposed';

/** NRM2 measurement rule reference per CSI division */
export interface NRMMeasurementRule {
  nrm2Ref: string;          // e.g., "NRM2 15.1.1"
  nrm1Ref: string;          // e.g., "NRM1 2.6.1"
  measurementBasis: MeasurementBasis;
  measurementNote: string;   // Human-readable measurement description
  deductions: string;        // What gets deducted (e.g., "openings > 1m²")
}

export const NRM_RULES_BY_DIVISION: Record<string, NRMMeasurementRule> = {
  '01': { nrm2Ref: 'NRM2 1.1', nrm1Ref: 'NRM1 1.1', measurementBasis: 'gross', measurementNote: 'Preliminaries measured as time-related or fixed charges per project duration', deductions: 'None' },
  '02': { nrm2Ref: 'NRM2 5.1', nrm1Ref: 'NRM1 2.1', measurementBasis: 'gross', measurementNote: 'Site clearance measured as gross site area; demolition by volume or area of structure', deductions: 'None — gross measurement' },
  '03': { nrm2Ref: 'NRM2 11.1', nrm1Ref: 'NRM1 2.2', measurementBasis: 'net', measurementNote: 'Concrete in-situ measured net as-placed volume; formwork measured as contact area both sides for walls, soffit for slabs', deductions: 'Voids > 0.5m³ deducted from concrete volume; openings > 0.5m² deducted from formwork' },
  '04': { nrm2Ref: 'NRM2 14.1', nrm1Ref: 'NRM1 2.3', measurementBasis: 'net', measurementNote: 'Masonry measured net face area per wall elevation; mortar included in unit rate', deductions: 'Openings > 1.0m² deducted; lintels measured separately' },
  '05': { nrm2Ref: 'NRM2 12.1', nrm1Ref: 'NRM1 2.2', measurementBasis: 'net', measurementNote: 'Structural steel by weight (kg) from shop drawings; connections included in unit rate', deductions: 'No deductions — measured by weight' },
  '06': { nrm2Ref: 'NRM2 16.1', nrm1Ref: 'NRM1 2.4', measurementBasis: 'net', measurementNote: 'Carpentry measured by area (m²) for sheathing, linear (m) for framing, count (ea) for trusses', deductions: 'Openings > 1.0m² deducted from sheathing' },
  '07': { nrm2Ref: 'NRM2 15.1', nrm1Ref: 'NRM1 2.5', measurementBasis: 'gross', measurementNote: 'Roofing measured as gross plan area including overlaps; insulation by area; waterproofing by contact area', deductions: 'Penetrations > 1.0m² deducted' },
  '08': { nrm2Ref: 'NRM2 17.1', nrm1Ref: 'NRM1 2.6', measurementBasis: 'net', measurementNote: 'Windows/doors measured as overall frame size (ea or m²); hardware included in unit assembly rate', deductions: 'None — counted elements' },
  '09': { nrm2Ref: 'NRM2 15.1.1', nrm1Ref: 'NRM1 2.7', measurementBasis: 'net', measurementNote: 'Wall finishes measured net wall area less openings > 1m²; floor finishes net floor area; ceiling finishes net plan area', deductions: 'Wall openings > 1.0m² deducted; floor penetrations > 0.5m²' },
  '10': { nrm2Ref: 'NRM2 18.1', nrm1Ref: 'NRM1 2.8', measurementBasis: 'net', measurementNote: 'Specialties measured by count (ea) or linear metre as appropriate for item type', deductions: 'None — counted/measured elements' },
  '11': { nrm2Ref: 'NRM2 19.1', nrm1Ref: 'NRM1 2.9', measurementBasis: 'net', measurementNote: 'Equipment measured by item count; installation included in assembly rate', deductions: 'None — counted items' },
  '12': { nrm2Ref: 'NRM2 20.1', nrm1Ref: 'NRM1 2.10', measurementBasis: 'net', measurementNote: 'Furnishings by count or area; fixed furnishings per assembly', deductions: 'None — counted items' },
  '13': { nrm2Ref: 'NRM2 21.1', nrm1Ref: 'NRM1 3.1', measurementBasis: 'gross', measurementNote: 'Special construction measured per structure type specification', deductions: 'As specified' },
  '14': { nrm2Ref: 'NRM2 22.1', nrm1Ref: 'NRM1 3.2', measurementBasis: 'net', measurementNote: 'Elevators/lifts measured per unit installed; escalators per unit', deductions: 'None — counted items' },
  '21': { nrm2Ref: 'NRM2 33.1', nrm1Ref: 'NRM1 5.4', measurementBasis: 'gross', measurementNote: 'Fire suppression measured as gross floor area served per storey; heads counted separately', deductions: 'None — area-based' },
  '22': { nrm2Ref: 'NRM2 31.1', nrm1Ref: 'NRM1 5.1', measurementBasis: 'net', measurementNote: 'Plumbing fixtures by count; piping by linear metre and diameter classification', deductions: 'None — counted/measured' },
  '23': { nrm2Ref: 'NRM2 32.1', nrm1Ref: 'NRM1 5.2', measurementBasis: 'gross', measurementNote: 'HVAC measured as gross floor area served; equipment by capacity (kW/ton); ductwork by linear metre', deductions: 'None — area/capacity-based' },
  '25': { nrm2Ref: 'NRM2 34.1', nrm1Ref: 'NRM1 5.5', measurementBasis: 'net', measurementNote: 'Automation points measured by count; wiring by linear metre', deductions: 'None — counted/measured' },
  '26': { nrm2Ref: 'NRM2 35.1', nrm1Ref: 'NRM1 5.6', measurementBasis: 'gross', measurementNote: 'Electrical measured as gross floor area; panels by count; wiring by circuit and length', deductions: 'None — area/count-based' },
  '27': { nrm2Ref: 'NRM2 36.1', nrm1Ref: 'NRM1 5.7', measurementBasis: 'net', measurementNote: 'Communications outlets by count; cabling by linear metre and category', deductions: 'None — counted/measured' },
  '28': { nrm2Ref: 'NRM2 36.2', nrm1Ref: 'NRM1 5.8', measurementBasis: 'net', measurementNote: 'Security devices by count; wiring by linear metre', deductions: 'None — counted/measured' },
  '31': { nrm2Ref: 'NRM2 5.2', nrm1Ref: 'NRM1 2.1.2', measurementBasis: 'gross', measurementNote: 'Earthwork by volume (m³) bank or compacted as specified; bulk or trench classification', deductions: 'None — volume-based' },
  '32': { nrm2Ref: 'NRM2 6.1', nrm1Ref: 'NRM1 8.1', measurementBasis: 'gross', measurementNote: 'Site improvements by area (m²) for paving, linear (m) for curbs/fencing', deductions: 'None — area/linear' },
  '33': { nrm2Ref: 'NRM2 7.1', nrm1Ref: 'NRM1 8.2', measurementBasis: 'net', measurementNote: 'Utilities by linear metre and diameter; manholes/catch basins by count', deductions: 'None — measured/counted' },
  '34': { nrm2Ref: 'NRM2 8.1', nrm1Ref: 'NRM1 8.3', measurementBasis: 'net', measurementNote: 'Transportation infrastructure by linear metre or count', deductions: 'None — measured/counted' },
  '35': { nrm2Ref: 'NRM2 9.1', nrm1Ref: 'NRM1 8.4', measurementBasis: 'gross', measurementNote: 'Marine construction by area or linear metre of structure', deductions: 'As specified' },
  '40': { nrm2Ref: 'NRM2 41.1', nrm1Ref: 'NRM1 7.1', measurementBasis: 'net', measurementNote: 'Process piping by linear metre and diameter', deductions: 'None' },
  '41': { nrm2Ref: 'NRM2 42.1', nrm1Ref: 'NRM1 7.2', measurementBasis: 'net', measurementNote: 'Material handling equipment by count', deductions: 'None' },
  '42': { nrm2Ref: 'NRM2 43.1', nrm1Ref: 'NRM1 7.3', measurementBasis: 'net', measurementNote: 'Process heating/cooling by capacity (kW)', deductions: 'None' },
  '43': { nrm2Ref: 'NRM2 43.2', nrm1Ref: 'NRM1 7.4', measurementBasis: 'net', measurementNote: 'Gas/liquid handling by capacity and count', deductions: 'None' },
  '44': { nrm2Ref: 'NRM2 44.1', nrm1Ref: 'NRM1 7.5', measurementBasis: 'net', measurementNote: 'Pollution control by capacity and count', deductions: 'None' },
  '45': { nrm2Ref: 'NRM2 45.1', nrm1Ref: 'NRM1 7.6', measurementBasis: 'net', measurementNote: 'Manufacturing equipment by count', deductions: 'None' },
  '46': { nrm2Ref: 'NRM2 46.1', nrm1Ref: 'NRM1 7.7', measurementBasis: 'net', measurementNote: 'Water/wastewater treatment by capacity', deductions: 'None' },
  '48': { nrm2Ref: 'NRM2 48.1', nrm1Ref: 'NRM1 7.8', measurementBasis: 'net', measurementNote: 'Power generation by capacity (kW/MW)', deductions: 'None' },
};


// ─── WBS / CBS DEFAULT STRUCTURE ────────────────────────────────────────────

export interface WBSNode {
  wbsCode: string;        // e.g., "WBS-03" or "WBS-03.03" (sub-level)
  cbsCode: string;        // e.g., "CBS-B10" (UNIFORMAT-based)
  csiDivision: string;    // "03"
  uniformatLevel1: string;// "B"
  description: string;
  scheduleOfValuesRef: string; // for contractor billing
}

/** Generate default WBS from CSI divisions — project-specific overlay can replace */
export function generateDefaultWBS(): WBSNode[] {
  const CSI_DIVISIONS: Record<string, string> = {
    '01': 'General Requirements', '02': 'Existing Conditions', '03': 'Concrete',
    '04': 'Masonry', '05': 'Metals', '06': 'Wood, Plastics & Composites',
    '07': 'Thermal & Moisture Protection', '08': 'Openings', '09': 'Finishes',
    '10': 'Specialties', '11': 'Equipment', '12': 'Furnishings',
    '13': 'Special Construction', '14': 'Conveying Equipment', '21': 'Fire Suppression',
    '22': 'Plumbing', '23': 'HVAC', '25': 'Integrated Automation',
    '26': 'Electrical', '27': 'Communications', '28': 'Electronic Safety & Security',
    '31': 'Earthwork', '32': 'Exterior Improvements', '33': 'Utilities',
    '34': 'Transportation', '35': 'Waterway & Marine', '40': 'Process Interconnections',
    '41': 'Material Processing', '42': 'Process Heating/Cooling', '43': 'Gas & Liquid',
    '44': 'Pollution Control', '45': 'Manufacturing', '46': 'Water & Wastewater',
    '48': 'Electrical Power Generation',
  };

  return Object.entries(CSI_DIVISIONS).map(([div, name]) => {
    const uf = CSI_TO_UNIFORMAT[div];
    return {
      wbsCode: `WBS-${div}`,
      cbsCode: uf ? `CBS-${uf.level2Code}` : `CBS-Z10`,
      csiDivision: div,
      uniformatLevel1: uf?.level1Code ?? 'Z',
      description: `Div ${div} — ${name}`,
      scheduleOfValuesRef: `SOV-${div}`,
    };
  });
}


// ─── ENRICHED ESTIMATE LINE ITEM (post-process) ────────────────────────────

export interface EnrichedLineItem extends EstimateLineItem {
  // UNIFORMAT mapping
  uniformatCode: string;
  uniformatName: string;
  uniformatLevel1: string;
  uniformatLevel1Name: string;
  // NRM2 measurement rule
  nrm2Ref: string;
  nrm1Ref: string;
  measurementBasis: MeasurementBasis;
  measurementNote: string;
  // WBS
  wbsCode: string;
  cbsCode: string;
}

/**
 * Post-process estimate line items to add UNIFORMAT, NRM, and WBS data.
 * Does NOT mutate originals — returns new enriched array.
 */
export function enrichEstimateLineItems(items: EstimateLineItem[]): EnrichedLineItem[] {
  return items.map(item => {
    const div = item.csiDivision;
    const uf = CSI_TO_UNIFORMAT[div] ?? {
      level1Code: 'Z', level1Name: 'Unclassified',
      level2Code: 'Z99', level2Name: 'Unclassified',
      level3Code: 'Z9999', level3Name: 'Unclassified',
    };
    const nrm = NRM_RULES_BY_DIVISION[div] ?? {
      nrm2Ref: 'N/A', nrm1Ref: 'N/A',
      measurementBasis: 'net' as MeasurementBasis,
      measurementNote: 'No NRM rule defined for this division',
      deductions: 'N/A',
    };

    return {
      ...item,
      uniformatCode: uf.level3Code,
      uniformatName: uf.level3Name,
      uniformatLevel1: uf.level1Code,
      uniformatLevel1Name: uf.level1Name,
      nrm2Ref: nrm.nrm2Ref,
      nrm1Ref: nrm.nrm1Ref,
      measurementBasis: nrm.measurementBasis,
      measurementNote: nrm.measurementNote,
      wbsCode: `WBS-${div}`,
      cbsCode: `CBS-${uf.level2Code}`,
    };
  });
}


// ─── UNIFORMAT ELEMENTAL SUMMARY ────────────────────────────────────────────

export interface UniformatSummaryRow {
  level1Code: string;
  level1Name: string;
  level2Code: string;
  level2Name: string;
  level3Code: string;
  level3Name: string;
  materialTotal: number;
  laborTotal: number;
  equipmentTotal: number;
  subtotal: number;
  lineItemCount: number;
  percentOfTotal: number;
}

/** Generate dual summary: group estimate by UNIFORMAT elements */
export function generateUniformatSummary(estimate: EstimateSummary): UniformatSummaryRow[] {
  const allItems = estimate.floors.flatMap(f => f.lineItems);
  const enriched = enrichEstimateLineItems(allItems);

  const groups = new Map<string, { uf: UniformatElement; mat: number; lab: number; eqp: number; count: number }>();

  for (const item of enriched) {
    const key = item.uniformatCode;
    const existing = groups.get(key) ?? {
      uf: {
        level1Code: item.uniformatLevel1, level1Name: item.uniformatLevel1Name,
        level2Code: item.cbsCode.replace('CBS-', ''), level2Name: '',
        level3Code: item.uniformatCode, level3Name: item.uniformatName,
      },
      mat: 0, lab: 0, eqp: 0, count: 0,
    };
    existing.mat += item.materialCost;
    existing.lab += item.laborCost;
    existing.eqp += item.equipmentCost;
    existing.count += 1;
    groups.set(key, existing);
  }

  const rows: UniformatSummaryRow[] = [];
  for (const [, g] of groups) {
    const subtotal = g.mat + g.lab + g.eqp;
    rows.push({
      level1Code: g.uf.level1Code,
      level1Name: g.uf.level1Name,
      level2Code: g.uf.level2Code,
      level2Name: g.uf.level2Name,
      level3Code: g.uf.level3Code,
      level3Name: g.uf.level3Name,
      materialTotal: Math.round(g.mat * 100) / 100,
      laborTotal: Math.round(g.lab * 100) / 100,
      equipmentTotal: Math.round(g.eqp * 100) / 100,
      subtotal: Math.round(subtotal * 100) / 100,
      lineItemCount: g.count,
      percentOfTotal: estimate.grandTotal > 0 ? Math.round((subtotal / estimate.grandTotal) * 10000) / 100 : 0,
    });
  }

  return rows.sort((a, b) => a.level1Code.localeCompare(b.level1Code) || a.level3Code.localeCompare(b.level3Code));
}


// ─── CSI DIVISION SUMMARY (for reconciliation) ─────────────────────────────

export interface CSIDivisionSummaryRow {
  csiDivision: string;
  csiDivisionName: string;
  materialTotal: number;
  laborTotal: number;
  equipmentTotal: number;
  subtotal: number;
  lineItemCount: number;
  percentOfTotal: number;
}

export function generateCSIDivisionSummary(estimate: EstimateSummary): CSIDivisionSummaryRow[] {
  const allItems = estimate.floors.flatMap(f => f.lineItems);
  const groups = new Map<string, { name: string; mat: number; lab: number; eqp: number; count: number }>();

  for (const item of allItems) {
    const div = item.csiDivision;
    const existing = groups.get(div) ?? { name: item.csiDivisionName, mat: 0, lab: 0, eqp: 0, count: 0 };
    existing.mat += item.materialCost;
    existing.lab += item.laborCost;
    existing.eqp += item.equipmentCost;
    existing.count += 1;
    groups.set(div, existing);
  }

  const rows: CSIDivisionSummaryRow[] = [];
  for (const [div, g] of groups) {
    const subtotal = g.mat + g.lab + g.eqp;
    rows.push({
      csiDivision: div,
      csiDivisionName: g.name,
      materialTotal: Math.round(g.mat * 100) / 100,
      laborTotal: Math.round(g.lab * 100) / 100,
      equipmentTotal: Math.round(g.eqp * 100) / 100,
      subtotal: Math.round(subtotal * 100) / 100,
      lineItemCount: g.count,
      percentOfTotal: estimate.grandTotal > 0 ? Math.round((subtotal / estimate.grandTotal) * 10000) / 100 : 0,
    });
  }

  return rows.sort((a, b) => a.csiDivision.localeCompare(b.csiDivision));
}


// ─── ELEMENT ↔ DIVISION RECONCILIATION (Phase 7.4) ─────────────────────────

export interface ReconciliationResult {
  csiTotal: number;
  uniformatTotal: number;
  difference: number;
  differencePercent: number;
  reconciled: boolean;       // true if difference ≤ $0.01 (rounding tolerance)
  csiDivisionCount: number;
  uniformatElementCount: number;
  timestamp: string;
  discrepancies: Array<{
    type: 'csi_only' | 'uniformat_only' | 'amount_mismatch';
    code: string;
    csiAmount: number;
    uniformatAmount: number;
    difference: number;
  }>;
}

/** Reconcile CSI division totals against UNIFORMAT elemental totals */
export function reconcileElementDivision(estimate: EstimateSummary): ReconciliationResult {
  const csiSummary = generateCSIDivisionSummary(estimate);
  const ufSummary = generateUniformatSummary(estimate);

  const csiTotal = csiSummary.reduce((s, r) => s + r.subtotal, 0);
  const ufTotal = ufSummary.reduce((s, r) => s + r.subtotal, 0);
  const diff = Math.abs(csiTotal - ufTotal);

  return {
    csiTotal: Math.round(csiTotal * 100) / 100,
    uniformatTotal: Math.round(ufTotal * 100) / 100,
    difference: Math.round(diff * 100) / 100,
    differencePercent: csiTotal > 0 ? Math.round((diff / csiTotal) * 10000) / 100 : 0,
    reconciled: diff <= 0.01,
    csiDivisionCount: csiSummary.length,
    uniformatElementCount: ufSummary.length,
    timestamp: new Date().toISOString(),
    discrepancies: [],  // populated when there are actual mapping gaps
  };
}


// ─── EXPORTABLE CROSS-WALK TABLE (Phase 0.4) ───────────────────────────────

export interface CrossWalkRow {
  csiDivision: string;
  csiDivisionName: string;
  uniformatLevel1: string;
  uniformatLevel1Name: string;
  uniformatLevel2: string;
  uniformatLevel2Name: string;
  uniformatLevel3: string;
  uniformatLevel3Name: string;
  nrm2Ref: string;
  nrm1Ref: string;
  measurementBasis: MeasurementBasis;
  wbsCode: string;
}

/** Generate complete cross-walk table — exportable for auditors */
export function generateCrossWalkTable(): CrossWalkRow[] {
  const CSI_DIVISIONS: Record<string, string> = {
    '01': 'General Requirements', '02': 'Existing Conditions', '03': 'Concrete',
    '04': 'Masonry', '05': 'Metals', '06': 'Wood, Plastics & Composites',
    '07': 'Thermal & Moisture Protection', '08': 'Openings', '09': 'Finishes',
    '10': 'Specialties', '11': 'Equipment', '12': 'Furnishings',
    '13': 'Special Construction', '14': 'Conveying Equipment', '21': 'Fire Suppression',
    '22': 'Plumbing', '23': 'HVAC', '25': 'Integrated Automation',
    '26': 'Electrical', '27': 'Communications', '28': 'Electronic Safety & Security',
    '31': 'Earthwork', '32': 'Exterior Improvements', '33': 'Utilities',
    '34': 'Transportation', '35': 'Waterway & Marine', '40': 'Process Interconnections',
    '41': 'Material Processing', '42': 'Process Heating/Cooling', '43': 'Gas & Liquid',
    '44': 'Pollution Control', '45': 'Manufacturing', '46': 'Water & Wastewater',
    '48': 'Electrical Power Generation',
  };

  return Object.entries(CSI_DIVISIONS).map(([div, name]) => {
    const uf = CSI_TO_UNIFORMAT[div];
    const nrm = NRM_RULES_BY_DIVISION[div];
    return {
      csiDivision: div,
      csiDivisionName: name,
      uniformatLevel1: uf?.level1Code ?? 'Z',
      uniformatLevel1Name: uf?.level1Name ?? 'Unclassified',
      uniformatLevel2: uf?.level2Code ?? 'Z99',
      uniformatLevel2Name: uf?.level2Name ?? 'Unclassified',
      uniformatLevel3: uf?.level3Code ?? 'Z9999',
      uniformatLevel3Name: uf?.level3Name ?? 'Unclassified',
      nrm2Ref: nrm?.nrm2Ref ?? 'N/A',
      nrm1Ref: nrm?.nrm1Ref ?? 'N/A',
      measurementBasis: nrm?.measurementBasis ?? 'net',
      wbsCode: `WBS-${div}`,
    };
  });
}
