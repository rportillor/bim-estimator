// server/estimator/nrm2-measurement.ts
//
// NRM1 / NRM2 Measurement Rules Annotation Module
// Adds measurement methodology annotations to every estimate line item.
//
// Standards:
//   RICS NRM1 — Order of Cost Estimating and Cost Planning for Capital Building Works (4th ed.)
//   RICS NRM2 — Detailed Measurement for Building Works (2nd ed.)
//   CSI MasterFormat 2018 — mapped to NRM2 work sections
//
// This module does NOT modify the core estimate engine. It post-processes an
// EstimateSummary and enriches each line item with:
//   - measurementBasis: how the quantity was measured
//   - nrm2Rule: NRM2 work section reference
//   - measurementNotes: audit-trail notes for the QS
//   - nrm1Group: NRM1 cost-planning group for high-level reporting

import type { EstimateSummary, EstimateLineItem, FloorSummary } from './estimate-engine';

// ─── Measurement Basis ──────────────────────────────────────────────────────

export type MeasurementBasis =
  | 'gross-floor-area'          // GFA per NRM1 Rule 2.7
  | 'gross-internal-floor-area' // GIFA per NRM1 Rule 2.8
  | 'net-internal-area'         // NIA per NRM1 Rule 2.9
  | 'centerline'                // Wall measured to centerline of partitions
  | 'finished-face'             // Wall measured to finished face
  | 'overall-external'          // External dimensions
  | 'net-volume'                // True volume (concrete pours, excavation)
  | 'gross-volume'              // Volume including waste/over-excavation
  | 'linear-meter'              // Linear measurement (pipe, cable, trim)
  | 'number'                    // Count of discrete items (doors, fixtures)
  | 'weight'                    // kg measurement (rebar, structural steel)
  | 'area-on-surface'           // Measured on surface (cladding, paint)
  | 'superficial-area'          // Plan area regardless of shape (roofing)
  | 'enumerated';               // Counted items with varying specs

// ─── NRM2 Rule Reference ────────────────────────────────────────────────────

export interface NRM2Rule {
  ruleRef: string;           // e.g. "NRM2 15.1.1"
  workSection: string;       // e.g. "Wall finishes"
  measurementBasis: MeasurementBasis;
  measurementNotes: string;  // QS audit-trail note
  nrm1Group: string;         // NRM1 cost-planning group code
  nrm1GroupName: string;     // e.g. "2.5 Internal walls and partitions"
}

// ─── Enriched Line Item ─────────────────────────────────────────────────────

export interface MeasuredLineItem extends EstimateLineItem {
  measurementBasis: MeasurementBasis;
  nrm2Rule: string;
  measurementNotes: string;
  nrm1Group: string;
  nrm1GroupName: string;
}

export interface MeasuredFloorSummary extends Omit<FloorSummary, 'lineItems'> {
  lineItems: MeasuredLineItem[];
}

export interface MeasuredEstimate extends Omit<EstimateSummary, 'floors'> {
  floors: MeasuredFloorSummary[];
  measurementStandard: 'RICS NRM2 (2nd edition)';
  costPlanningStandard: 'RICS NRM1 (4th edition)';
  measurementSummary: {
    totalLineItems: number;
    byBasis: Record<MeasurementBasis, number>;
    byNRM1Group: { group: string; name: string; count: number; subtotal: number }[];
  };
}

// ─── NRM2 Rule Lookup by CSI Division Prefix ────────────────────────────────
//
// Maps the first 2 digits of CSI code → NRM2 work section.
// Where CSI codes map to multiple NRM2 rules, the most common is used.
// Per NRM2 Table 1 cross-referenced with CSI MasterFormat.

const NRM2_RULES: Record<string, NRM2Rule> = {
  // DIV 01: General Requirements → NRM2 Section 1 (Preliminaries)
  '01': {
    ruleRef: 'NRM2 1.1',
    workSection: 'Preliminaries',
    measurementBasis: 'number',
    measurementNotes: 'Measured as time-related or fixed charges per NRM2 1.1. Preliminary items measured per duration (weeks/months) or as lump sum.',
    nrm1Group: '1.1',
    nrm1GroupName: '1.1 Facilitating works (preliminaries)',
  },

  // DIV 02: Existing Conditions → NRM2 Section 3 (Demolitions)
  '02': {
    ruleRef: 'NRM2 3.1',
    workSection: 'Demolitions',
    measurementBasis: 'net-volume',
    measurementNotes: 'Demolition measured in m³ of volume removed per NRM2 3.1. Selective demolition measured per m² of surface area. Hazardous material removal measured per m² of surface treated.',
    nrm1Group: '1.2',
    nrm1GroupName: '1.2 Demolitions and alterations',
  },

  // DIV 03: Concrete → NRM2 Section 11 (In-situ concrete works)
  '03': {
    ruleRef: 'NRM2 11.1',
    workSection: 'In-situ concrete works',
    measurementBasis: 'net-volume',
    measurementNotes: 'Concrete measured in m³ net volume placed per NRM2 11.1.1. Formwork measured per m² of contact area (NRM2 11.8). Reinforcement measured in kg (NRM2 11.6). No deduction for openings ≤ 0.5 m² in formwork.',
    nrm1Group: '2.1',
    nrm1GroupName: '2.1 Frame',
  },

  // DIV 04: Masonry → NRM2 Section 14 (Masonry)
  '04': {
    ruleRef: 'NRM2 14.1',
    workSection: 'Masonry',
    measurementBasis: 'area-on-surface',
    measurementNotes: 'Brickwork and blockwork measured per m² of wall surface per NRM2 14.1.1. Deductions for openings > 0.5 m². Facework measured separately from backing. Damp-proof courses measured in linear metres.',
    nrm1Group: '2.3',
    nrm1GroupName: '2.3 External walls',
  },

  // DIV 05: Metals → NRM2 Section 12 (Structural metalwork)
  '05': {
    ruleRef: 'NRM2 12.1',
    workSection: 'Structural metalwork',
    measurementBasis: 'weight',
    measurementNotes: 'Structural steelwork measured in tonnes per NRM2 12.1.1 — classify by section type. Miscellaneous metalwork (handrails, ladders) measured per linear metre or enumerated. Connections included in tonnage.',
    nrm1Group: '2.1',
    nrm1GroupName: '2.1 Frame',
  },

  // DIV 06: Wood, Plastics, Composites → NRM2 Section 16 (Carpentry)
  '06': {
    ruleRef: 'NRM2 16.1',
    workSection: 'Carpentry / Timber framing',
    measurementBasis: 'area-on-surface',
    measurementNotes: 'Structural timber measured in m³ per NRM2 16.1.1. Framed walls measured per m² of wall area. Truss roofs measured per m² of plan area. Finish carpentry (trim, casework) measured per linear metre or enumerated.',
    nrm1Group: '2.5',
    nrm1GroupName: '2.5 Internal walls and partitions',
  },

  // DIV 07: Thermal & Moisture Protection → NRM2 Section 17/18
  '07': {
    ruleRef: 'NRM2 17.1',
    workSection: 'Sheet roof coverings / Waterproofing',
    measurementBasis: 'superficial-area',
    measurementNotes: 'Roofing measured in m² of plan area per NRM2 17.1. Insulation measured per m² of surface area (NRM2 18.1). Waterproofing below grade measured per m² of surface protected. Flashings measured in linear metres.',
    nrm1Group: '2.2',
    nrm1GroupName: '2.2 Upper floors and roof',
  },

  // DIV 08: Openings → NRM2 Section 19 (Windows/Doors)
  '08': {
    ruleRef: 'NRM2 19.1',
    workSection: 'Windows, screens, and lights / Doors',
    measurementBasis: 'enumerated',
    measurementNotes: 'Windows enumerated per NRM2 19.1 — state type, size, material, glazing spec, ironmongery. Doors enumerated per NRM2 19.2 — state type, size, thickness, fire rating, ironmongery set. Door frames measured separately.',
    nrm1Group: '2.4',
    nrm1GroupName: '2.4 Windows and external doors',
  },

  // DIV 09: Finishes → NRM2 Section 15 (Wall/floor/ceiling finishes)
  '09': {
    ruleRef: 'NRM2 15.1',
    workSection: 'Wall, floor, and ceiling finishes',
    measurementBasis: 'area-on-surface',
    measurementNotes: 'Wall finishes measured per m² of finished face per NRM2 15.1.1. Floor finishes measured per m² of plan area. Ceiling finishes measured per m² of plan area. Deductions for openings > 0.5 m². Painting measured per m² of surface.',
    nrm1Group: '3.1',
    nrm1GroupName: '3.1 Wall finishes',
  },

  // DIV 10: Specialties → NRM2 Section 25 (Specialist fittings)
  '10': {
    ruleRef: 'NRM2 25.1',
    workSection: 'Specialist fittings and furnishings',
    measurementBasis: 'enumerated',
    measurementNotes: 'Specialist items enumerated per NRM2 25.1 — state type, size, fixing method. Toilet partitions, lockers, signage measured individually. Fire extinguishers and safety equipment enumerated.',
    nrm1Group: '4.1',
    nrm1GroupName: '4.1 Fittings, furnishings, and equipment',
  },

  // DIV 11: Equipment → NRM2 Section 25
  '11': {
    ruleRef: 'NRM2 25.2',
    workSection: 'Equipment',
    measurementBasis: 'enumerated',
    measurementNotes: 'Equipment items enumerated per NRM2 25.2 — state capacity, duty, power requirement. Include installation, commissioning, and testing in item description.',
    nrm1Group: '4.1',
    nrm1GroupName: '4.1 Fittings, furnishings, and equipment',
  },

  // DIV 12: Furnishings → NRM2 Section 25
  '12': {
    ruleRef: 'NRM2 25.3',
    workSection: 'Furnishings',
    measurementBasis: 'enumerated',
    measurementNotes: 'Furnishings enumerated per NRM2 25.3. Cabinets measured per linear metre of run. Countertops measured per m² of surface area. Window treatments measured per window opening.',
    nrm1Group: '4.1',
    nrm1GroupName: '4.1 Fittings, furnishings, and equipment',
  },

  // DIV 13: Special Construction → NRM2 Section 38
  '13': {
    ruleRef: 'NRM2 38.1',
    workSection: 'Special construction',
    measurementBasis: 'enumerated',
    measurementNotes: 'Special construction items enumerated or measured per m² per NRM2 38.1. Swimming pools, clean rooms, controlled environments measured as complete systems. Pre-engineered structures measured per m² of floor area.',
    nrm1Group: '4.2',
    nrm1GroupName: '4.2 Special installations',
  },

  // DIV 14: Conveying Equipment → NRM2 Section 36
  '14': {
    ruleRef: 'NRM2 36.1',
    workSection: 'Lift and escalator installations',
    measurementBasis: 'enumerated',
    measurementNotes: 'Lifts/elevators enumerated per NRM2 36.1 — state capacity (kg), speed (m/s), number of stops, pit depth. Escalators enumerated — state rise, width, speed. Include builder work in connection.',
    nrm1Group: '5.10',
    nrm1GroupName: '5.10 Lift and conveyor installations',
  },

  // DIV 21: Fire Suppression → NRM2 Section 37
  '21': {
    ruleRef: 'NRM2 37.1',
    workSection: 'Fire suppression installations',
    measurementBasis: 'area-on-surface',
    measurementNotes: 'Sprinkler systems measured per m² of protected floor area per NRM2 37.1. Wet risers, dry risers, and fire hydrant installations enumerated. Specialised suppression (FM-200, CO₂) measured as complete systems.',
    nrm1Group: '5.4',
    nrm1GroupName: '5.4 Fire and lightning protection',
  },

  // DIV 22: Plumbing → NRM2 Section 33 (Sanitary installations)
  '22': {
    ruleRef: 'NRM2 33.1',
    workSection: 'Sanitary installations / Hot and cold water',
    measurementBasis: 'enumerated',
    measurementNotes: 'Sanitary fittings (WC, basin, bath) enumerated per NRM2 33.1 — state type and size. Pipework measured in linear metres per NRM2 33.2 — classify by diameter. Insulation to pipes measured per linear metre.',
    nrm1Group: '5.1',
    nrm1GroupName: '5.1 Sanitary installations',
  },

  // DIV 23: HVAC → NRM2 Section 34/35
  '23': {
    ruleRef: 'NRM2 34.1',
    workSection: 'Heating / Ventilation / Air conditioning',
    measurementBasis: 'area-on-surface',
    measurementNotes: 'Space heating measured per m² served per NRM2 34.1. Ductwork measured in linear metres per NRM2 35.2 — classify by size. AHUs, boilers, chillers enumerated — state capacity. Controls measured as provisional sum or enumerated.',
    nrm1Group: '5.5',
    nrm1GroupName: '5.5 Heating, ventilation, and air conditioning',
  },

  // DIV 25: Integrated Automation → NRM2 Section 35
  '25': {
    ruleRef: 'NRM2 35.3',
    workSection: 'Controls and building management',
    measurementBasis: 'enumerated',
    measurementNotes: 'BMS points enumerated per NRM2 35.3. Head-end equipment, panels, and sensors enumerated individually. Commissioning measured as provisional sum or per system.',
    nrm1Group: '5.12',
    nrm1GroupName: '5.12 BWIC (builder work in connection)',
  },

  // DIV 26: Electrical → NRM2 Section 30/31
  '26': {
    ruleRef: 'NRM2 30.1',
    workSection: 'Electrical installations',
    measurementBasis: 'enumerated',
    measurementNotes: 'Power distribution boards enumerated per NRM2 30.1 — state capacity (A). Cable measured in linear metres per NRM2 30.2 — classify by size. Luminaires enumerated — state type, wattage. Small power (outlets) enumerated per NRM2 30.3.',
    nrm1Group: '5.7',
    nrm1GroupName: '5.7 Electrical installations',
  },

  // DIV 27: Communications → NRM2 Section 31
  '27': {
    ruleRef: 'NRM2 31.1',
    workSection: 'Communications, security, and controls',
    measurementBasis: 'enumerated',
    measurementNotes: 'Data points enumerated per NRM2 31.1. Structured cabling measured in linear metres. CCTV, access control, and intruder detection enumerated by device. Public address and voice evacuation measured per zone.',
    nrm1Group: '5.8',
    nrm1GroupName: '5.8 Communications, security, and controls',
  },

  // DIV 28: Electronic Safety and Security → NRM2 Section 37
  '28': {
    ruleRef: 'NRM2 37.2',
    workSection: 'Electronic safety and security',
    measurementBasis: 'enumerated',
    measurementNotes: 'Fire alarm points (detectors, call points, sounders) enumerated per NRM2 37.2. Emergency lighting enumerated. Lightning protection measured per system. Earthing measured per installation.',
    nrm1Group: '5.4',
    nrm1GroupName: '5.4 Fire and lightning protection',
  },

  // DIV 31: Earthwork → NRM2 Section 5 (Excavation and filling)
  '31': {
    ruleRef: 'NRM2 5.1',
    workSection: 'Excavation and filling',
    measurementBasis: 'gross-volume',
    measurementNotes: 'Excavation measured in m³ per NRM2 5.1.1 — state maximum depth range. Filling measured in m³ — distinguish imported fill from excavated material. Disposal of excavated material measured separately. Over-excavation included in measurement.',
    nrm1Group: '1.3',
    nrm1GroupName: '1.3 Substructure — below lowest floor finish',
  },

  // DIV 32: Exterior Improvements → NRM2 Section 5/6
  '32': {
    ruleRef: 'NRM2 5.6',
    workSection: 'External works — hard landscaping',
    measurementBasis: 'superficial-area',
    measurementNotes: 'Paving measured per m² per NRM2 5.6. Kerbs measured in linear metres. Fencing measured in linear metres — state height. Site drainage measured in linear metres per NRM2 6.1. Soft landscaping measured per m².',
    nrm1Group: '8.1',
    nrm1GroupName: '8.1 External works',
  },

  // DIV 33: Utilities → NRM2 Section 6 (External services)
  '33': {
    ruleRef: 'NRM2 6.1',
    workSection: 'External services',
    measurementBasis: 'linear-meter',
    measurementNotes: 'Service runs measured in linear metres per NRM2 6.1 — classify by diameter and depth. Manholes, chambers enumerated — state size and depth. Connections to existing services enumerated.',
    nrm1Group: '8.2',
    nrm1GroupName: '8.2 External services (drainage, incoming services)',
  },

  // DIV 34: Transportation → NRM2 Section 32 (Roads)
  '34': {
    ruleRef: 'NRM2 32.1',
    workSection: 'Transport infrastructure',
    measurementBasis: 'superficial-area',
    measurementNotes: 'Road surfacing measured per m² per NRM2 32.1. Sub-base measured per m³. Road markings measured in linear metres. Traffic signals and signage enumerated.',
    nrm1Group: '8.1',
    nrm1GroupName: '8.1 External works',
  },

  // DIV 35: Waterway and Marine → NRM2 Section 39
  '35': {
    ruleRef: 'NRM2 39.1',
    workSection: 'Marine and waterway works',
    measurementBasis: 'net-volume',
    measurementNotes: 'Dredging measured in m³ per NRM2 39.1. Sheet piling measured per m² of wall area. Dock structures measured per m² of plan area or per linear metre of quay wall. Scour protection measured per m².',
    nrm1Group: '8.3',
    nrm1GroupName: '8.3 Minor building works and ancillary buildings',
  },

  // DIV 40: Process Integration → NRM2 Section 38
  '40': {
    ruleRef: 'NRM2 38.2',
    workSection: 'Process engineering',
    measurementBasis: 'enumerated',
    measurementNotes: 'Process equipment enumerated per NRM2 38.2 — state capacity, duty. Process piping measured in linear metres — classify by diameter, material, pressure rating. Instrumentation enumerated.',
    nrm1Group: '4.2',
    nrm1GroupName: '4.2 Special installations',
  },

  // DIV 41-44: Process equipment → same NRM2 38 mapping
  '41': { ruleRef: 'NRM2 38.3', workSection: 'Material processing and handling', measurementBasis: 'enumerated', measurementNotes: 'Material handling equipment enumerated. Conveyors measured in linear metres.', nrm1Group: '4.2', nrm1GroupName: '4.2 Special installations' },
  '42': { ruleRef: 'NRM2 38.4', workSection: 'Process heating and cooling', measurementBasis: 'enumerated', measurementNotes: 'Heat exchangers, furnaces, and ovens enumerated — state capacity.', nrm1Group: '4.2', nrm1GroupName: '4.2 Special installations' },
  '43': { ruleRef: 'NRM2 38.5', workSection: 'Process gas and liquid handling', measurementBasis: 'enumerated', measurementNotes: 'Pumps, compressors, tanks enumerated — state capacity and pressure rating.', nrm1Group: '4.2', nrm1GroupName: '4.2 Special installations' },
  '44': { ruleRef: 'NRM2 38.6', workSection: 'Pollution and waste control', measurementBasis: 'enumerated', measurementNotes: 'Treatment equipment enumerated. Ducting measured in linear metres.', nrm1Group: '4.2', nrm1GroupName: '4.2 Special installations' },
};

// ─── Annotation Engine ──────────────────────────────────────────────────────

/**
 * Look up NRM2 rule for a given CSI code.
 * Falls back to division-level lookup, then to generic rule.
 */
export function getNRM2Rule(csiCode: string): NRM2Rule {
  const div = csiCode.substring(0, 2);
  return NRM2_RULES[div] || {
    ruleRef: 'NRM2 N/A',
    workSection: 'Unclassified',
    measurementBasis: 'enumerated' as MeasurementBasis,
    measurementNotes: 'No NRM2 mapping for CSI division ' + div + '. Measured as enumerated item.',
    nrm1Group: '0.0',
    nrm1GroupName: '0.0 Unclassified',
  };
}

/**
 * Annotate an entire EstimateSummary with NRM2 measurement rules.
 * Does NOT modify the original — returns a new MeasuredEstimate.
 */
export function annotateWithNRM2(estimate: EstimateSummary): MeasuredEstimate {
  const basisCounts: Record<MeasurementBasis, number> = {} as any;
  const nrm1Totals = new Map<string, { group: string; name: string; count: number; subtotal: number }>();

  const measuredFloors: MeasuredFloorSummary[] = estimate.floors.map(floor => {
    const measuredItems: MeasuredLineItem[] = floor.lineItems.map(item => {
      const rule = getNRM2Rule(item.csiCode);

      // Track basis counts
      basisCounts[rule.measurementBasis] = (basisCounts[rule.measurementBasis] || 0) + 1;

      // Track NRM1 group totals
      const existing = nrm1Totals.get(rule.nrm1Group);
      if (existing) {
        existing.count++;
        existing.subtotal += item.totalCost;
      } else {
        nrm1Totals.set(rule.nrm1Group, {
          group: rule.nrm1Group,
          name: rule.nrm1GroupName,
          count: 1,
          subtotal: item.totalCost,
        });
      }

      return {
        ...item,
        measurementBasis: rule.measurementBasis,
        nrm2Rule: rule.ruleRef,
        measurementNotes: rule.measurementNotes,
        nrm1Group: rule.nrm1Group,
        nrm1GroupName: rule.nrm1GroupName,
      };
    });

    return {
      ...floor,
      lineItems: measuredItems,
    };
  });

  const byNRM1Group = Array.from(nrm1Totals.values())
    .sort((a, b) => a.group.localeCompare(b.group));

  return {
    ...estimate,
    floors: measuredFloors,
    measurementStandard: 'RICS NRM2 (2nd edition)',
    costPlanningStandard: 'RICS NRM1 (4th edition)',
    measurementSummary: {
      totalLineItems: estimate.lineItemCount,
      byBasis: basisCounts,
      byNRM1Group: byNRM1Group,
    },
  };
}

/**
 * Format a human-readable NRM2 measurement report.
 */
export function formatNRM2Report(measured: MeasuredEstimate): string {
  const out: string[] = [];
  const f = (n: number) => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  out.push('═══════════════════════════════════════════════════════════════');
  out.push('  NRM1/NRM2 MEASUREMENT RULES REPORT');
  out.push('  Standard: ' + measured.measurementStandard);
  out.push('  Cost Planning: ' + measured.costPlanningStandard);
  out.push('═══════════════════════════════════════════════════════════════');
  out.push('');

  // --- Summary by Measurement Basis ---
  out.push('─── Measurement Basis Distribution ───');
  out.push('');
  const totalItems = measured.measurementSummary.totalLineItems;
  for (const [basis, count] of Object.entries(measured.measurementSummary.byBasis)) {
    const pct = totalItems > 0 ? ((count as number) / totalItems * 100).toFixed(1) : '0.0';
    out.push('  ' + (basis as string).padEnd(28) + String(count).padStart(6) + ' items  (' + pct + '%)');
  }
  out.push('');

  // --- NRM1 Cost Planning Summary ---
  out.push('─── NRM1 Cost Planning Groups ───');
  out.push('');
  out.push('  Group    Description                              Items     Subtotal');
  out.push('  ─────    ───────────                              ─────     ────────');
  let nrm1Total = 0;
  for (const g of measured.measurementSummary.byNRM1Group) {
    nrm1Total += g.subtotal;
    out.push('  ' + g.group.padEnd(9) + g.name.padEnd(41) + String(g.count).padStart(5) + '     ' + f(g.subtotal).padStart(14));
  }
  out.push('  ' + '─'.repeat(75));
  out.push('  ' + 'TOTAL'.padEnd(50) + String(totalItems).padStart(5) + '     ' + f(nrm1Total).padStart(14));
  out.push('');

  // --- Sample Line Item Annotations ---
  out.push('─── Sample Line Item Annotations (first 10) ───');
  out.push('');
  let sampleCount = 0;
  for (const floor of measured.floors) {
    for (const item of floor.lineItems) {
      if (sampleCount >= 10) break;
      out.push('  CSI: ' + item.csiCode);
      out.push('    Description: ' + item.description);
      out.push('    NRM2 Rule:   ' + item.nrm2Rule + ' — ' + item.measurementNotes.substring(0, 100));
      out.push('    NRM1 Group:  ' + item.nrm1Group + ' ' + item.nrm1GroupName);
      out.push('    Basis:       ' + item.measurementBasis);
      out.push('    Quantity:    ' + item.quantity.toFixed(2) + ' ' + item.unit);
      out.push('');
      sampleCount++;
    }
    if (sampleCount >= 10) break;
  }

  out.push('─── End of NRM2 Measurement Report ───');
  return out.join('\n');
}

// ─── NRM2 Rule Count for QA ─────────────────────────────────────────────────

export const NRM2_DIVISION_COUNT = Object.keys(NRM2_RULES).length;
