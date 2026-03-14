// server/estimator/uniformat-mapping.ts
// =============================================================================
// UNIFORMAT II ELEMENTAL CLASSIFICATION + CSI CROSS-WALK
// =============================================================================
//
// Implements QS Level 5 Phase 0: Orienting Framework
// Per ASTM E1557 (UNIFORMAT II) and ASTM E1804 (Cost Analysis During Design)
//
// Purpose:
//   1. Map every CSI rate code to a UNIFORMAT II element (rate-code level, not
//      division level — because Div 03 splits across Substructure & Shell)
//   2. Generate dual summary: costs by CSI Division AND by UNIFORMAT Element
//   3. Reconciliation check: sum(divisions) must equal sum(elements)
//   4. Exportable cross-walk table for management reporting and VE analysis
//
// Standards: ASTM E1557-09, ASTM E1804-02, CIQS Elemental Cost Analysis
// =============================================================================

import type { EstimateSummary, EstimateLineItem } from './estimate-engine';

// ─── UNIFORMAT II Hierarchy (ASTM E1557) ─────────────────────────────────────
// Level 1: Major Group Elements (A-G)
// Level 2: Group Elements (A10, A20, B10...)
// Level 3: Individual Elements (A1010, A1020...)
// We map to Level 3 for professional granularity.

export interface UniformatElement {
  level1Code: string;      // A, B, C, D, E, F, G
  level1Name: string;      // Substructure, Shell, Interiors...
  level2Code: string;      // A10, A20, B10...
  level2Name: string;      // Foundations, Basement Construction...
  level3Code: string;      // A1010, A1020, A2010...
  level3Name: string;      // Standard Foundations, Special Foundations...
}

export interface UniformatSummary {
  element: UniformatElement;
  lineItems: EstimateLineItem[];
  materialTotal: number;
  laborTotal: number;
  equipmentTotal: number;
  subtotal: number;
  percentOfTotal: number;
}

export interface UniformatLevel2Summary {
  code: string;
  name: string;
  level3Elements: UniformatSummary[];
  subtotal: number;
  percentOfTotal: number;
}

export interface UniformatLevel1Summary {
  code: string;
  name: string;
  level2Groups: UniformatLevel2Summary[];
  subtotal: number;
  percentOfTotal: number;
}

export interface CrossWalkEntry {
  csiCode: string;
  csiDivision: string;
  csiDivisionName: string;
  uniformatLevel3: string;
  uniformatLevel2: string;
  uniformatLevel1: string;
  uniformatElementName: string;
}

export interface DualSummaryReport {
  byCSIDivision: {
    division: string;
    divisionName: string;
    subtotal: number;
    percentOfTotal: number;
  }[];
  byUniformat: UniformatLevel1Summary[];
  grandTotal: number;
  csiTotal: number;
  uniformatTotal: number;
  reconciliationDelta: number;      // should be 0 or negligible (<$0.01)
  reconciliationPassed: boolean;
  crossWalkTable: CrossWalkEntry[];
  generatedAt: string;
}

// ─── UNIFORMAT II Element Definitions ────────────────────────────────────────

const UNIFORMAT_ELEMENTS: Record<string, UniformatElement> = {
  // === A: SUBSTRUCTURE ===
  'A1010': { level1Code: 'A', level1Name: 'Substructure', level2Code: 'A10', level2Name: 'Foundations', level3Code: 'A1010', level3Name: 'Standard Foundations' },
  'A1020': { level1Code: 'A', level1Name: 'Substructure', level2Code: 'A10', level2Name: 'Foundations', level3Code: 'A1020', level3Name: 'Special Foundations' },
  'A1030': { level1Code: 'A', level1Name: 'Substructure', level2Code: 'A10', level2Name: 'Foundations', level3Code: 'A1030', level3Name: 'Slab on Grade' },
  'A2010': { level1Code: 'A', level1Name: 'Substructure', level2Code: 'A20', level2Name: 'Basement Construction', level3Code: 'A2010', level3Name: 'Basement Excavation' },
  'A2020': { level1Code: 'A', level1Name: 'Substructure', level2Code: 'A20', level2Name: 'Basement Construction', level3Code: 'A2020', level3Name: 'Basement Walls' },

  // === B: SHELL ===
  'B1010': { level1Code: 'B', level1Name: 'Shell', level2Code: 'B10', level2Name: 'Superstructure', level3Code: 'B1010', level3Name: 'Floor Construction' },
  'B1020': { level1Code: 'B', level1Name: 'Shell', level2Code: 'B10', level2Name: 'Superstructure', level3Code: 'B1020', level3Name: 'Roof Construction' },
  'B2010': { level1Code: 'B', level1Name: 'Shell', level2Code: 'B20', level2Name: 'Exterior Enclosure', level3Code: 'B2010', level3Name: 'Exterior Walls' },
  'B2020': { level1Code: 'B', level1Name: 'Shell', level2Code: 'B20', level2Name: 'Exterior Enclosure', level3Code: 'B2020', level3Name: 'Exterior Windows' },
  'B2030': { level1Code: 'B', level1Name: 'Shell', level2Code: 'B20', level2Name: 'Exterior Enclosure', level3Code: 'B2030', level3Name: 'Exterior Doors' },
  'B3010': { level1Code: 'B', level1Name: 'Shell', level2Code: 'B30', level2Name: 'Roofing', level3Code: 'B3010', level3Name: 'Roof Coverings' },
  'B3020': { level1Code: 'B', level1Name: 'Shell', level2Code: 'B30', level2Name: 'Roofing', level3Code: 'B3020', level3Name: 'Roof Openings' },

  // === C: INTERIORS ===
  'C1010': { level1Code: 'C', level1Name: 'Interiors', level2Code: 'C10', level2Name: 'Interior Construction', level3Code: 'C1010', level3Name: 'Partitions' },
  'C1020': { level1Code: 'C', level1Name: 'Interiors', level2Code: 'C10', level2Name: 'Interior Construction', level3Code: 'C1020', level3Name: 'Interior Doors' },
  'C1030': { level1Code: 'C', level1Name: 'Interiors', level2Code: 'C10', level2Name: 'Interior Construction', level3Code: 'C1030', level3Name: 'Fittings' },
  'C2010': { level1Code: 'C', level1Name: 'Interiors', level2Code: 'C20', level2Name: 'Staircases', level3Code: 'C2010', level3Name: 'Stair Construction' },
  'C3010': { level1Code: 'C', level1Name: 'Interiors', level2Code: 'C30', level2Name: 'Interior Finishes', level3Code: 'C3010', level3Name: 'Wall Finishes' },
  'C3020': { level1Code: 'C', level1Name: 'Interiors', level2Code: 'C30', level2Name: 'Interior Finishes', level3Code: 'C3020', level3Name: 'Floor Finishes' },
  'C3030': { level1Code: 'C', level1Name: 'Interiors', level2Code: 'C30', level2Name: 'Interior Finishes', level3Code: 'C3030', level3Name: 'Ceiling Finishes' },

  // === D: SERVICES ===
  'D1010': { level1Code: 'D', level1Name: 'Services', level2Code: 'D10', level2Name: 'Conveying', level3Code: 'D1010', level3Name: 'Elevators & Lifts' },
  'D1020': { level1Code: 'D', level1Name: 'Services', level2Code: 'D10', level2Name: 'Conveying', level3Code: 'D1020', level3Name: 'Escalators & Moving Walks' },
  'D2010': { level1Code: 'D', level1Name: 'Services', level2Code: 'D20', level2Name: 'Plumbing', level3Code: 'D2010', level3Name: 'Plumbing Fixtures' },
  'D2020': { level1Code: 'D', level1Name: 'Services', level2Code: 'D20', level2Name: 'Plumbing', level3Code: 'D2020', level3Name: 'Domestic Water Distribution' },
  'D2030': { level1Code: 'D', level1Name: 'Services', level2Code: 'D20', level2Name: 'Plumbing', level3Code: 'D2030', level3Name: 'Sanitary Waste' },
  'D2040': { level1Code: 'D', level1Name: 'Services', level2Code: 'D20', level2Name: 'Plumbing', level3Code: 'D2040', level3Name: 'Rain Water Drainage' },
  'D2090': { level1Code: 'D', level1Name: 'Services', level2Code: 'D20', level2Name: 'Plumbing', level3Code: 'D2090', level3Name: 'Other Plumbing Systems' },
  'D3010': { level1Code: 'D', level1Name: 'Services', level2Code: 'D30', level2Name: 'HVAC', level3Code: 'D3010', level3Name: 'Energy Supply' },
  'D3020': { level1Code: 'D', level1Name: 'Services', level2Code: 'D30', level2Name: 'HVAC', level3Code: 'D3020', level3Name: 'Heat Generating Systems' },
  'D3030': { level1Code: 'D', level1Name: 'Services', level2Code: 'D30', level2Name: 'HVAC', level3Code: 'D3030', level3Name: 'Cooling Generating Systems' },
  'D3040': { level1Code: 'D', level1Name: 'Services', level2Code: 'D30', level2Name: 'HVAC', level3Code: 'D3040', level3Name: 'Distribution Systems' },
  'D3050': { level1Code: 'D', level1Name: 'Services', level2Code: 'D30', level2Name: 'HVAC', level3Code: 'D3050', level3Name: 'Terminal & Package Units' },
  'D3060': { level1Code: 'D', level1Name: 'Services', level2Code: 'D30', level2Name: 'HVAC', level3Code: 'D3060', level3Name: 'Controls & Instrumentation' },
  'D4010': { level1Code: 'D', level1Name: 'Services', level2Code: 'D40', level2Name: 'Fire Protection', level3Code: 'D4010', level3Name: 'Sprinklers' },
  'D4020': { level1Code: 'D', level1Name: 'Services', level2Code: 'D40', level2Name: 'Fire Protection', level3Code: 'D4020', level3Name: 'Standpipes' },
  'D4030': { level1Code: 'D', level1Name: 'Services', level2Code: 'D40', level2Name: 'Fire Protection', level3Code: 'D4030', level3Name: 'Fire Protection Specialties' },
  'D5010': { level1Code: 'D', level1Name: 'Services', level2Code: 'D50', level2Name: 'Electrical', level3Code: 'D5010', level3Name: 'Electrical Service & Distribution' },
  'D5020': { level1Code: 'D', level1Name: 'Services', level2Code: 'D50', level2Name: 'Electrical', level3Code: 'D5020', level3Name: 'Lighting & Branch Wiring' },
  'D5030': { level1Code: 'D', level1Name: 'Services', level2Code: 'D50', level2Name: 'Electrical', level3Code: 'D5030', level3Name: 'Communications & Security' },
  'D5090': { level1Code: 'D', level1Name: 'Services', level2Code: 'D50', level2Name: 'Electrical', level3Code: 'D5090', level3Name: 'Other Electrical Systems' },

  // === E: EQUIPMENT & FURNISHINGS ===
  'E1010': { level1Code: 'E', level1Name: 'Equipment & Furnishings', level2Code: 'E10', level2Name: 'Equipment', level3Code: 'E1010', level3Name: 'Commercial Equipment' },
  'E1020': { level1Code: 'E', level1Name: 'Equipment & Furnishings', level2Code: 'E10', level2Name: 'Equipment', level3Code: 'E1020', level3Name: 'Institutional Equipment' },
  'E1030': { level1Code: 'E', level1Name: 'Equipment & Furnishings', level2Code: 'E10', level2Name: 'Equipment', level3Code: 'E1030', level3Name: 'Vehicular Equipment' },
  'E1090': { level1Code: 'E', level1Name: 'Equipment & Furnishings', level2Code: 'E10', level2Name: 'Equipment', level3Code: 'E1090', level3Name: 'Other Equipment' },
  'E2010': { level1Code: 'E', level1Name: 'Equipment & Furnishings', level2Code: 'E20', level2Name: 'Furnishings', level3Code: 'E2010', level3Name: 'Fixed Furnishings' },
  'E2020': { level1Code: 'E', level1Name: 'Equipment & Furnishings', level2Code: 'E20', level2Name: 'Furnishings', level3Code: 'E2020', level3Name: 'Movable Furnishings' },

  // === F: SPECIAL CONSTRUCTION & DEMOLITION ===
  'F1010': { level1Code: 'F', level1Name: 'Special Construction & Demolition', level2Code: 'F10', level2Name: 'Special Construction', level3Code: 'F1010', level3Name: 'Special Structures' },
  'F1020': { level1Code: 'F', level1Name: 'Special Construction & Demolition', level2Code: 'F10', level2Name: 'Special Construction', level3Code: 'F1020', level3Name: 'Integrated Construction' },
  'F1030': { level1Code: 'F', level1Name: 'Special Construction & Demolition', level2Code: 'F10', level2Name: 'Special Construction', level3Code: 'F1030', level3Name: 'Special Construction Systems' },
  'F1040': { level1Code: 'F', level1Name: 'Special Construction & Demolition', level2Code: 'F10', level2Name: 'Special Construction', level3Code: 'F1040', level3Name: 'Special Facilities' },
  'F2010': { level1Code: 'F', level1Name: 'Special Construction & Demolition', level2Code: 'F20', level2Name: 'Selective Demolition', level3Code: 'F2010', level3Name: 'Building Elements Demolition' },
  'F2020': { level1Code: 'F', level1Name: 'Special Construction & Demolition', level2Code: 'F20', level2Name: 'Selective Demolition', level3Code: 'F2020', level3Name: 'Hazardous Components Abatement' },

  // === G: BUILDING SITEWORK ===
  'G1010': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G10', level2Name: 'Site Preparation', level3Code: 'G1010', level3Name: 'Site Clearing' },
  'G1020': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G10', level2Name: 'Site Preparation', level3Code: 'G1020', level3Name: 'Site Demolition & Relocations' },
  'G1030': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G10', level2Name: 'Site Preparation', level3Code: 'G1030', level3Name: 'Site Earthwork' },
  'G2010': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G20', level2Name: 'Site Improvements', level3Code: 'G2010', level3Name: 'Roadways' },
  'G2020': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G20', level2Name: 'Site Improvements', level3Code: 'G2020', level3Name: 'Parking Lots' },
  'G2030': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G20', level2Name: 'Site Improvements', level3Code: 'G2030', level3Name: 'Pedestrian Paving' },
  'G2040': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G20', level2Name: 'Site Improvements', level3Code: 'G2040', level3Name: 'Site Development' },
  'G2050': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G20', level2Name: 'Site Improvements', level3Code: 'G2050', level3Name: 'Landscaping' },
  'G3010': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G30', level2Name: 'Site Mechanical Utilities', level3Code: 'G3010', level3Name: 'Water Supply' },
  'G3020': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G30', level2Name: 'Site Mechanical Utilities', level3Code: 'G3020', level3Name: 'Sanitary Sewer' },
  'G3030': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G30', level2Name: 'Site Mechanical Utilities', level3Code: 'G3030', level3Name: 'Storm Sewer' },
  'G3040': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G30', level2Name: 'Site Mechanical Utilities', level3Code: 'G3040', level3Name: 'Heating Distribution' },
  'G3050': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G30', level2Name: 'Site Mechanical Utilities', level3Code: 'G3050', level3Name: 'Cooling Distribution' },
  'G3060': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G30', level2Name: 'Site Mechanical Utilities', level3Code: 'G3060', level3Name: 'Fuel Distribution' },
  'G4010': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G40', level2Name: 'Site Electrical Utilities', level3Code: 'G4010', level3Name: 'Electrical Distribution' },
  'G4020': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G40', level2Name: 'Site Electrical Utilities', level3Code: 'G4020', level3Name: 'Site Lighting' },
  'G4030': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G40', level2Name: 'Site Electrical Utilities', level3Code: 'G4030', level3Name: 'Site Communications & Security' },
  'G9010': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G90', level2Name: 'Other Site Construction', level3Code: 'G9010', level3Name: 'Service & Pedestrian Tunnels' },
  'G9020': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G90', level2Name: 'Other Site Construction', level3Code: 'G9020', level3Name: 'Marine Construction' },
  'G9090': { level1Code: 'G', level1Name: 'Building Sitework', level2Code: 'G90', level2Name: 'Other Site Construction', level3Code: 'G9090', level3Name: 'Other Site Systems' },

  // === Z: GENERAL CONDITIONS (not standard UNIFORMAT — maps Div 01) ===
  'Z1010': { level1Code: 'Z', level1Name: 'General Conditions', level2Code: 'Z10', level2Name: 'General Requirements', level3Code: 'Z1010', level3Name: 'Project Management & Administration' },

  // === P: PROCESS (maps Div 40-48, outside standard building UNIFORMAT) ===
  'P1010': { level1Code: 'P', level1Name: 'Process', level2Code: 'P10', level2Name: 'Process Systems', level3Code: 'P1010', level3Name: 'Process Piping & Equipment' },
  'P2010': { level1Code: 'P', level1Name: 'Process', level2Code: 'P20', level2Name: 'Process Treatment', level3Code: 'P2010', level3Name: 'Treatment & Purification' },
  'P3010': { level1Code: 'P', level1Name: 'Process', level2Code: 'P30', level2Name: 'Process Utilities', level3Code: 'P3010', level3Name: 'Power Generation' },
};

// ─── CSI Rate Code → UNIFORMAT Level 3 Mapping ──────────────────────────────
// This is the CRITICAL cross-walk: maps every rate code in estimate-engine.ts
// to a specific UNIFORMAT Level 3 element.
//
// KEY DESIGN PRINCIPLE: This mapping is at the RATE CODE level, not the
// CSI Division level, because a single division can span multiple UNIFORMAT
// elements. For example:
//   - Div 03 CONC (foundation wall) → A1010 Standard Foundations
//   - Div 03 SLAB-CONC (elevated slab) → B1010 Floor Construction
//   - Div 03 STAIR-CONC → C2010 Stair Construction
//
// Where a rate code's UNIFORMAT placement is ambiguous (depends on location
// in the building), we map to the most typical use. The classification chain
// in estimate-engine.ts uses floor/location context to differentiate when
// possible; this mapping captures the default/primary assignment.

const CSI_TO_UNIFORMAT: Record<string, string> = {
  // === Div 01 — General Requirements → Z (General Conditions) ===
  '011000-GENERAL':       'Z1010',
  '013000-ADMIN':         'Z1010',
  '014000-QA-TEST':       'Z1010',
  '015000-TEMP':          'Z1010',
  '017000-CLEANUP':       'Z1010',

  // === Div 02 — Existing Conditions → F (Demolition) / G (Site) ===
  '022000-ASSESS':        'F2010',   // Assessment prior to demo
  '023000-GEOTECH':       'G1030',   // Site earthwork/investigation
  '024100-DEMO':          'F2010',   // Building elements demolition
  '024100-DEMO-SEL':      'F2010',   // Selective demolition
  '024200-ABATE':         'F2020',   // Hazardous components abatement
  '026000-CONTAM-REMOVE': 'F2020',   // Hazardous removal
  '027000-WATER-REMED':   'G1030',   // Site remediation
  '028000-FACILITY-REMED':'F2010',   // Facility remediation

  // === Div 03 — Concrete ===
  // Foundation elements → A (Substructure)
  '033000-CONC':          'A1010',   // Default: foundation concrete
  '033000-FORM':          'A1010',   // Default: foundation formwork
  '033000-REBAR':         'A1010',   // Default: foundation rebar
  // Elevated structure → B (Shell - Superstructure)
  '033000-SLAB-CONC':     'B1010',   // Elevated slab → Floor Construction
  '033000-SLAB-FORM':     'B1010',   // Elevated slab formwork
  '033000-COL-CONC':      'B1010',   // Columns support floors
  '033000-COL-FORM':      'B1010',   // Column formwork
  '033000-BEAM-CONC':     'B1010',   // Beams support floors
  '033000-BEAM-FORM':     'B1010',   // Beam formwork
  '033000-STAIR-CONC':    'C2010',   // Stairs → Interior C20
  '034000-PRECAST':       'B1010',   // Precast → Superstructure
  '035000-UNDERLAYMENT':  'C3020',   // Floor finishes prep
  '036000-GROUT':         'A1010',   // Typically foundation/base
  '037000-MASS-CONC':     'A1010',   // Mass concrete → foundations
  '038000-SAW-CUT':       'A1030',   // Slab-on-grade joints

  // === Div 04 — Masonry ===
  '042000-BRICK':         'B2010',   // Exterior walls (primary use)
  '042000-CMU':           'C1010',   // Interior partitions (primary use)
  '044000-STONE':         'B2010',   // Exterior stone cladding
  '045000-REFRACTORY':    'F1030',   // Special construction
  '046000-CORR-MASONRY':  'F1030',   // Special construction
  '047000-MFG-STONE':     'C3010',   // Interior wall finish

  // === Div 05 — Metals ===
  '051200-STRUCT-STL':    'B1010',   // Superstructure
  '052100-JOIST':         'B1010',   // Floor/roof structure
  '053000-METAL-DECK':    'B1010',   // Floor/roof deck
  '054000-CFS-FRAME':     'C1010',   // Interior partitions (typical)
  '054000-CLAD':          'B2010',   // Exterior cladding
  '055000-MISC-MTL':      'B1010',   // Misc structural
  '055200-RAILING':       'C1030',   // Interior fittings
  '057000-DECOR-MTL':     'C1030',   // Interior fittings

  // === Div 06 — Wood, Plastics & Composites ===
  '061000-FRAMING':       'B1010',   // Structural framing
  '061700-STRUCT-PANEL':  'B1010',   // Structural panels
  '062000-FINISH-CARP':   'C1030',   // Interior fittings
  '064000-ARCH-WOOD':     'C1030',   // Interior fittings
  '065000-STRUCT-PLASTIC':'B1010',   // Structural
  '066000-PLASTIC-FAB':   'C1030',   // Interior fittings
  '067000-ENG-WOOD':      'B1010',   // Structural (glulam, LVL)

  // === Div 07 — Thermal & Moisture Protection ===
  '071000-WATERPROOF':    'A2020',   // Below-grade waterproofing
  '072000-INSULATION':    'B2010',   // Exterior wall insulation (primary)
  '072500-AIR-BARRIER':   'B2010',   // Building envelope
  '074000-METAL-PANEL':   'B2010',   // Exterior cladding
  '075000-ROOFING':       'B3010',   // Roof coverings
  '076000-FLASH-SHEET':   'B3010',   // Roof accessories
  '077000-GUTTER':        'B3010',   // Roof drainage
  '078000-FIRESTOP':      'C1010',   // Interior fire separations
  '079000-SEALANTS':      'B2010',   // Building envelope

  // === Div 08 — Openings ===
  '081000-DOOR-HM':       'C1020',   // Interior doors (default)
  '081000-DOOR-WD':       'C1020',   // Interior doors (default)
  '083100-ACCESS-DOOR':   'C1020',   // Interior access doors
  '084000-CURTAIN-WALL':  'B2020',   // Exterior windows/curtain wall
  '085000-WINDOW':        'B2020',   // Exterior windows
  '086000-SKYLIGHT':      'B3020',   // Roof openings
  '087000-HARDWARE':      'C1020',   // Door hardware
  '088000-GLAZING':       'B2020',   // Exterior glazing
  '089000-LOUVER':        'B2010',   // Exterior enclosure

  // === Div 09 — Finishes ===
  '092000-PLASTER':       'C3010',   // Wall finishes
  '092500-DRYWALL':       'C3010',   // Wall finishes (primary)
  '093000-TILE':          'C3020',   // Floor finishes (or wall)
  '095000-CEILING':       'C3030',   // Ceiling finishes
  '096000-FLOORING':      'C3020',   // Floor finishes
  '097000-WALL-FINISH':   'C3010',   // Wall finishes
  '098000-ACOUSTIC':      'C3030',   // Ceiling finishes
  '099000-PAINT':         'C3010',   // Wall finishes (primary)

  // === Div 10 — Specialties ===
  '101400-SIGNAGE':       'E1090',   // Other equipment
  '102100-TOILET-PART':   'C1030',   // Interior fittings
  '102800-TOILET-ACC':    'C1030',   // Interior fittings
  '103000-FIREPLACE':     'C1030',   // Interior fittings
  '104400-FIRE-EXTCAB':   'D4030',   // Fire protection specialties
  '105100-LOCKERS':       'E1090',   // Other equipment
  '105600-MAILBOXES':     'E1090',   // Other equipment
  '107000-EXT-SPECIALTY': 'G2040',   // Site development

  // === Div 11 — Equipment ===
  '111300-LOADING-DOCK':  'E1030',   // Vehicular equipment
  '111500-SECURITY-EQUIP':'E1090',   // Other equipment
  '112000-COMMERCIAL-EQUIP':'E1010', // Commercial equipment
  '113100-LAUNDRY':       'E1010',   // Commercial equipment
  '114000-FOOD-SVC':      'E1010',   // Commercial equipment
  '116800-ATHLETIC':      'E1090',   // Other equipment
  '117000-HEALTHCARE-EQUIP':'E1020', // Institutional equipment
  '117300-LAB-EQUIP':     'E1020',   // Institutional equipment
  '118000-WASTE-EQUIP':   'E1090',   // Other equipment

  // === Div 12 — Furnishings ===
  '121000-ART':           'E2020',   // Movable furnishings
  '123200-CASEWORK':      'E2010',   // Fixed furnishings
  '123600-COUNTERTOP':    'E2010',   // Fixed furnishings
  '124800-FURNITURE':     'E2020',   // Movable furnishings
  '125500-WINDOW-TREAT':  'E2020',   // Movable furnishings
  '126000-MULTI-SEAT':    'E2010',   // Fixed furnishings

  // === Div 13 — Special Construction ===
  '131000-POOL':          'F1040',   // Special facilities
  '132000-PRE-ENG':       'F1010',   // Special structures
  '133400-FABRIC-STRUCT': 'F1010',   // Special structures
  '134600-CLEAN-ROOM':    'F1040',   // Special facilities
  '135000-SPECIAL-INSTRUM':'F1030',  // Special construction systems
  '135300-GREENHOUSE':    'F1010',   // Special structures

  // === Div 14 — Conveying Equipment ===
  '141000-DUMBWAITER':    'D1010',   // Elevators & lifts
  '142100-ELEV-HYD':      'D1010',   // Elevators
  '142100-ELEV-TRAC':     'D1010',   // Elevators
  '143100-ESCALATOR':     'D1020',   // Escalators
  '144000-LIFT':          'D1010',   // Elevators & lifts
  '148000-SCAFFOLD':      'Z1010',   // General conditions (temp)

  // === Div 21 — Fire Suppression ===
  '211000-SPRINKLER':     'D4010',   // Sprinklers
  '211300-SPRINKLER-HEAD':'D4010',   // Sprinklers
  '212000-CHEM-SUPPRESS': 'D4030',   // Fire protection specialties
  '213000-STANDPIPE':     'D4020',   // Standpipes
  '214000-FIRE-WATER-STOR':'D4030',  // Fire protection specialties

  // === Div 22 — Plumbing ===
  '221000-PLUMBING':      'D2020',   // Domestic water distribution
  '221100-PLUMB-PIPE':    'D2020',   // Domestic water distribution
  '223000-HVAC-PIPE':     'D3040',   // HVAC distribution (hydronic)
  '224000-PLUMB-FIXT':    'D2010',   // Plumbing fixtures
  '225000-POOL-PLUMB':    'D2090',   // Other plumbing systems
  '226000-GAS-VACUUM':    'D2090',   // Other plumbing systems

  // === Div 23 — HVAC ===
  '231000-FUEL-SYS':      'D3010',   // Energy supply
  '233000-DUCTWORK':      'D3040',   // Distribution systems
  '233400-HVAC-EQUIP':    'D3050',   // Terminal & package units
  '233600-AHU':           'D3040',   // Distribution systems (central)
  '234000-AIR-CLEAN':     'D3050',   // Terminal & package units
  '235000-BOILER':        'D3020',   // Heat generating systems
  '237000-CHILLER':       'D3030',   // Cooling generating systems
  '238000-DECENTRAL-HVAC':'D3050',   // Terminal & package units

  // === Div 25 — Integrated Automation ===
  '250500-BAS':           'D3060',   // Controls & instrumentation
  '251000-CONTROLS':      'D3060',   // Controls & instrumentation
  '253000-ENERGY-MGMT':   'D3060',   // Controls & instrumentation

  // === Div 26 — Electrical ===
  '260500-WIRE':          'D5010',   // Electrical service & distribution
  '261000-CONDUIT':       'D5010',   // Electrical service & distribution
  '262000-POWER':         'D5010',   // Electrical service & distribution
  '263000-SWITCHGEAR':    'D5010',   // Electrical service & distribution
  '264000-CATHODIC':      'D5090',   // Other electrical systems
  '264000-TRANSFORM':     'D5010',   // Electrical service & distribution
  '265000-LIGHTING':      'D5020',   // Lighting & branch wiring

  // === Div 27 — Communications ===
  '271000-DATA':          'D5030',   // Communications & security
  '271100-DATA-OUTLET':   'D5030',   // Communications & security
  '272000-AV':            'D5030',   // Communications & security
  '273000-VOICE':         'D5030',   // Communications & security
  '275000-DIST-MONITOR':  'D5030',   // Communications & security

  // === Div 28 — Electronic Safety & Security ===
  '281000-FIRE-ALARM':    'D5030',   // Communications & security
  '281300-FIRE-DET':      'D5030',   // Communications & security
  '282000-SECURITY':      'D5030',   // Communications & security
  '283000-ACCESS-CTRL':   'D5030',   // Communications & security
  '284000-CCTV':          'D5030',   // Communications & security
  '284000-ELEC-MONITOR':  'D5030',   // Communications & security

  // === Div 31 — Earthwork ===
  '311000-SITE-CLEAR':    'G1010',   // Site clearing
  '312000-GRADING':       'G1030',   // Site earthwork
  '312300-EXCAVATE':      'A2010',   // Basement excavation (building)
  '313000-BACKFILL':      'G1030',   // Site earthwork
  '315000-PILE':          'A1020',   // Special foundations
  '316000-SHORING':       'A2010',   // Basement construction support
  '317000-TUNNEL':        'G9010',   // Service tunnels

  // === Div 32 — Exterior Improvements ===
  '321000-PAVING':        'G2010',   // Roadways
  '321400-CURB':          'G2010',   // Roadways
  '323000-SITE-FENCE':    'G2040',   // Site development
  '327000-WETLANDS':      'G2050',   // Landscaping
  '328000-IRRIGATION':    'G2050',   // Landscaping
  '329000-LANDSCAPE':     'G2050',   // Landscaping
  '329300-PLANT-TREE':    'G2050',   // Landscaping

  // === Div 33 — Utilities ===
  '331000-WATER-UTIL':    'G3010',   // Water supply
  '332000-WELLS':         'G3010',   // Water supply
  '333000-SEWER':         'G3020',   // Sanitary sewer
  '334000-STORM':         'G3030',   // Storm sewer
  '335000-GAS-UTIL':      'G3060',   // Fuel distribution
  '336000-HYDRONIC-UTIL': 'G3040',   // Heating distribution
  '337000-ELEC-UTIL':     'G4010',   // Electrical distribution
  '338000-TELECOM-UTIL':  'G4030',   // Site communications

  // === Div 34 — Transportation ===
  '341100-RAIL':          'G2010',   // Roadways (transport infrastructure)
  '341300-PARKING-EQUIP': 'G2020',   // Parking lots
  '344000-TRANSPORT-SIGNAL':'G2040', // Site development
  '347100-ROADWAY-SIGN':  'G2010',   // Roadways
  '348000-BRIDGE':        'G9090',   // Other site systems
  '351000-DREDGING':      'G9020',   // Marine construction
  '353000-DOCK':          'G9020',   // Marine construction
  '354000-PIER':          'G9020',   // Marine construction
  '355000-MARINE':        'G9020',   // Marine construction
  '356000-BULKHEAD':      'G9020',   // Marine construction
  '357000-DAM':           'G9020',   // Marine construction

  // === Div 40-48 — Process ===
  '401000-PROCESS-PIPE':  'P1010',   // Process piping & equipment
  '403000-SOLID-PIPE':    'P1010',   // Process piping
  '405000-PIPE-SUPPORT':  'P1010',   // Process piping
  '409000-PROCESS-CONTROL':'P1010',  // Process instrumentation
  '411000-CRANE-PERM':    'P1010',   // Process equipment
  '412000-CONVEYOR':      'P1010',   // Process equipment
  '413000-CHUTE':         'P1010',   // Process equipment
  '415000-MATERIAL-STORE':'P1010',   // Process equipment
  '421000-BOILER-IND':    'P1010',   // Process equipment
  '422000-PROCESS-COOL':  'P1010',   // Process equipment
  '423000-DRYER':         'P1010',   // Process equipment
  '431000-TANK':          'P1010',   // Process equipment
  '432000-PUMP-IND':      'P1010',   // Process equipment
  '433000-COMPRESSOR':    'P1010',   // Process equipment
  '433000-GAS-PURIFY':    'P2010',   // Treatment & purification
  '441000-SCRUBBER':      'P2010',   // Treatment & purification
  '442000-NOISE-CTRL':    'P2010',   // Treatment & purification
  '442000-OIL-SEP':       'P2010',   // Treatment & purification
  '443000-DUST-COLLECT':  'P2010',   // Treatment & purification
  '445000-SOLID-WASTE':   'P2010',   // Treatment & purification
  '451000-MFG-EQUIP':     'P1010',   // Process equipment
  '452000-ASSEMBLY-LINE': 'P1010',   // Process equipment
  '461000-WATER-TREAT':   'P2010',   // Treatment & purification
  '462000-PUMP-STA':      'P1010',   // Process equipment
  '463000-CHEM-FEED':     'P2010',   // Treatment & purification
  '463000-WASTE-TREAT':   'P2010',   // Treatment & purification
  '481000-GENERATOR':     'P3010',   // Power generation
  '482000-SOLAR':         'P3010',   // Power generation
  '483000-WIND':          'P3010',   // Power generation
};

// ─── Mapping Functions ───────────────────────────────────────────────────────

/**
 * Get the UNIFORMAT element for a given CSI rate code.
 * Falls back to division-level mapping if rate code not found.
 */
export function getUniformatElement(csiRateCode: string): UniformatElement {
  const uniformatCode = CSI_TO_UNIFORMAT[csiRateCode];
  if (uniformatCode && UNIFORMAT_ELEMENTS[uniformatCode]) {
    return UNIFORMAT_ELEMENTS[uniformatCode];
  }

  // Division-level fallback for unmapped rate codes
  const div = csiRateCode.substring(0, 2);
  const fallbackMap: Record<string, string> = {
    '01': 'Z1010', '02': 'F2010', '03': 'A1010', '04': 'B2010',
    '05': 'B1010', '06': 'B1010', '07': 'B2010', '08': 'B2020',
    '09': 'C3010', '10': 'E1090', '11': 'E1010', '12': 'E2020',
    '13': 'F1010', '14': 'D1010', '21': 'D4010', '22': 'D2020',
    '23': 'D3040', '25': 'D3060', '26': 'D5010', '27': 'D5030',
    '28': 'D5030', '31': 'G1030', '32': 'G2040', '33': 'G3010',
    '34': 'G2010', '35': 'G9020', '40': 'P1010', '41': 'P1010',
    '42': 'P1010', '43': 'P1010', '44': 'P2010', '45': 'P1010',
    '46': 'P2010', '48': 'P3010',
  };

  const fallback = fallbackMap[div] || 'Z1010';
  return UNIFORMAT_ELEMENTS[fallback] || UNIFORMAT_ELEMENTS['Z1010'];
}

/**
 * Generate the complete cross-walk table mapping every CSI rate code
 * used in the estimate to its UNIFORMAT element.
 */
export function generateCrossWalkTable(estimate: EstimateSummary): CrossWalkEntry[] {
  const seen = new Set<string>();
  const entries: CrossWalkEntry[] = [];

  for (const floor of estimate.floors) {
    for (const item of floor.lineItems) {
      if (seen.has(item.csiCode)) continue;
      seen.add(item.csiCode);

      const uf = getUniformatElement(item.csiCode);
      entries.push({
        csiCode: item.csiCode,
        csiDivision: item.csiDivision,
        csiDivisionName: item.csiDivisionName,
        uniformatLevel3: uf.level3Code,
        uniformatLevel2: uf.level2Code,
        uniformatLevel1: uf.level1Code,
        uniformatElementName: uf.level3Name,
      });
    }
  }

  return entries.sort((a, b) => a.csiCode.localeCompare(b.csiCode));
}

/**
 * Generate the complete dual-summary report:
 *   1. Costs by CSI Division
 *   2. Costs by UNIFORMAT Element (3 levels: L1 → L2 → L3)
 *   3. Reconciliation check
 *   4. Cross-walk table
 */
export function generateDualSummary(estimate: EstimateSummary): DualSummaryReport {
  const grandTotal = estimate.grandTotal;

  // --- 1. CSI Division Summary (already available from engine) ---
  const divMap = new Map<string, { name: string; total: number }>();
  for (const floor of estimate.floors) {
    for (const item of floor.lineItems) {
      const key = item.csiDivision;
      if (!divMap.has(key)) divMap.set(key, { name: item.csiDivisionName, total: 0 });
      divMap.get(key)!.total += item.totalCost;
    }
  }

  const byCSIDivision = Array.from(divMap.entries())
    .map(([div, data]) => ({
      division: div,
      divisionName: data.name,
      subtotal: data.total,
      percentOfTotal: grandTotal > 0 ? data.total / grandTotal : 0,
    }))
    .sort((a, b) => a.division.localeCompare(b.division));

  const csiTotal = byCSIDivision.reduce((s, d) => s + d.subtotal, 0);

  // --- 2. UNIFORMAT Elemental Summary ---
  const ufL3Map = new Map<string, {
    element: UniformatElement;
    items: EstimateLineItem[];
    material: number; labor: number; equipment: number; total: number;
  }>();

  for (const floor of estimate.floors) {
    for (const item of floor.lineItems) {
      const uf = getUniformatElement(item.csiCode);
      const key = uf.level3Code;
      if (!ufL3Map.has(key)) {
        ufL3Map.set(key, { element: uf, items: [], material: 0, labor: 0, equipment: 0, total: 0 });
      }
      const entry = ufL3Map.get(key)!;
      entry.items.push(item);
      entry.material += item.materialCost;
      entry.labor += item.laborCost;
      entry.equipment += item.equipmentCost;
      entry.total += item.totalCost;
    }
  }

  // Build Level 3 summaries
  const level3Summaries: UniformatSummary[] = Array.from(ufL3Map.values()).map(v => ({
    element: v.element,
    lineItems: v.items,
    materialTotal: v.material,
    laborTotal: v.labor,
    equipmentTotal: v.equipment,
    subtotal: v.total,
    percentOfTotal: grandTotal > 0 ? v.total / grandTotal : 0,
  }));

  // Roll up to Level 2
  const l2Map = new Map<string, UniformatLevel2Summary>();
  for (const l3 of level3Summaries) {
    const key = l3.element.level2Code;
    if (!l2Map.has(key)) {
      l2Map.set(key, { code: key, name: l3.element.level2Name, level3Elements: [], subtotal: 0, percentOfTotal: 0 });
    }
    const l2 = l2Map.get(key)!;
    l2.level3Elements.push(l3);
    l2.subtotal += l3.subtotal;
  }
  for (const l2 of l2Map.values()) {
    l2.percentOfTotal = grandTotal > 0 ? l2.subtotal / grandTotal : 0;
    l2.level3Elements.sort((a, b) => a.element.level3Code.localeCompare(b.element.level3Code));
  }

  // Roll up to Level 1
  const l1Map = new Map<string, UniformatLevel1Summary>();
  for (const l2 of l2Map.values()) {
    const l1Code = l2.code.substring(0, 1);
    const l1Name = level3Summaries.find(s => s.element.level1Code === l1Code)?.element.level1Name || 'Unknown';
    if (!l1Map.has(l1Code)) {
      l1Map.set(l1Code, { code: l1Code, name: l1Name, level2Groups: [], subtotal: 0, percentOfTotal: 0 });
    }
    const l1 = l1Map.get(l1Code)!;
    l1.level2Groups.push(l2);
    l1.subtotal += l2.subtotal;
  }
  for (const l1 of l1Map.values()) {
    l1.percentOfTotal = grandTotal > 0 ? l1.subtotal / grandTotal : 0;
    l1.level2Groups.sort((a, b) => a.code.localeCompare(b.code));
  }

  const byUniformat = Array.from(l1Map.values()).sort((a, b) => a.code.localeCompare(b.code));
  const uniformatTotal = byUniformat.reduce((s, l1) => s + l1.subtotal, 0);

  // --- 3. Reconciliation ---
  const delta = Math.abs(csiTotal - uniformatTotal);
  const reconciliationPassed = delta < 0.01;

  // --- 4. Cross-Walk Table ---
  const crossWalkTable = generateCrossWalkTable(estimate);

  return {
    byCSIDivision,
    byUniformat,
    grandTotal,
    csiTotal,
    uniformatTotal,
    reconciliationDelta: delta,
    reconciliationPassed,
    crossWalkTable,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Report Formatter ────────────────────────────────────────────────────────

/**
 * Format the dual summary as a human-readable report.
 * Shows both CSI and UNIFORMAT views side by side.
 */
export function formatDualSummaryReport(report: DualSummaryReport): string {
  const f = (n: number) => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (n: number) => (n * 100).toFixed(1) + '%';
  const out: string[] = [];

  out.push('====================================================================');
  out.push('  DUAL COST SUMMARY — CSI MasterFormat & UNIFORMAT II');
  out.push('====================================================================');
  out.push('');

  // CSI Summary
  out.push('  ── SUMMARY BY CSI MASTERFORMAT DIVISION ──');
  out.push('');
  for (const d of report.byCSIDivision) {
    const line = ('  Div ' + d.division).padEnd(10) +
      d.divisionName.padEnd(38) +
      f(d.subtotal).padStart(16) +
      ('  ' + pct(d.percentOfTotal)).padStart(8);
    out.push(line);
  }
  out.push('  ' + '─'.repeat(72));
  out.push('  CSI TOTAL:'.padEnd(48) + f(report.csiTotal).padStart(16));
  out.push('');

  // UNIFORMAT Summary
  out.push('  ── SUMMARY BY UNIFORMAT II ELEMENT ──');
  out.push('');
  for (const l1 of report.byUniformat) {
    out.push('  ' + l1.code + ': ' + l1.name.padEnd(42) +
      f(l1.subtotal).padStart(16) + ('  ' + pct(l1.percentOfTotal)).padStart(8));

    for (const l2 of l1.level2Groups) {
      out.push('    ' + l2.code + ': ' + l2.name.padEnd(38) +
        f(l2.subtotal).padStart(16) + ('  ' + pct(l2.percentOfTotal)).padStart(8));

      for (const l3 of l2.level3Elements) {
        out.push('      ' + l3.element.level3Code + ': ' + l3.element.level3Name.padEnd(30) +
          f(l3.subtotal).padStart(16) + ('  ' + pct(l3.percentOfTotal)).padStart(8));
      }
    }
    out.push('');
  }
  out.push('  ' + '─'.repeat(72));
  out.push('  UNIFORMAT TOTAL:'.padEnd(48) + f(report.uniformatTotal).padStart(16));
  out.push('');

  // Reconciliation
  out.push('  ── RECONCILIATION ──');
  out.push('  CSI Total:      ' + f(report.csiTotal));
  out.push('  UNIFORMAT Total: ' + f(report.uniformatTotal));
  out.push('  Delta:          ' + f(report.reconciliationDelta));
  out.push('  Status:         ' + (report.reconciliationPassed ? '✅ PASSED' : '❌ FAILED — investigate'));
  out.push('');
  out.push('  Cross-walk entries: ' + report.crossWalkTable.length);
  out.push('====================================================================');

  return out.join('\n');
}
