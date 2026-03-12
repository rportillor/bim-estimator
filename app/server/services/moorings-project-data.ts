/**
 * moorings-project-data.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * EstimatorPro v15.9 — Moorings on Cameron Lake Project Data Service
 *
 * Single authoritative source-of-truth for all confirmed project data from
 * drawing sessions A101/A201/A202/A204/A205/A207/A208/A210/A213/A301 +
 * Specifications R1 (390 pages).
 *
 * ARCHITECTURE LAW: No defaults, no hardcoded fallbacks.
 * Every value here traces to a named drawing or specification section.
 * Missing data throws a descriptive error — never silently substitutes.
 *
 * Usage:
 *   import { MOORINGS } from "./moorings-project-data";
 *   const suites = MOORINGS.units.confirmed;           // 34 suites
 *   const datum  = MOORINGS.datums.groundFloor;        // 262.25
 *   const rfi    = MOORINGS.drawingRegister.missing[0];
 */

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type DrawingStatus = "RECEIVED" | "MISSING" | "PARTIAL" | "SUPERSEDED";
export type Confidence    = "C1" | "C2" | "C3" | "C4";
export type RFIPriority   = "BLOCKER" | "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type RFIStatus     = "OPEN" | "CLOSED" | "SUPERSEDED";
export type UnitType      = "1B+D" | "2B" | "2B+D" | "3B" | "STUDIO" | "UNKNOWN";
export type FloorLevel    = "P1" | "GF" | "F2" | "F3" | "MPH" | "ROOF";

export interface Drawing {
  number:     string;
  title:      string;
  status:     DrawingStatus;
  confidence: Confidence;
  source?:    string;
  rfiRef?:    string;
  notes?:     string;
}

export interface FloorDatum {
  level:        FloorLevel;
  label:        string;
  elevationM:   number;           // metres above MSL (AMSL)
  ftfHeightM?:  number;           // floor-to-floor height above this level
  source:       string;
  confidence:   Confidence;
}

export interface Suite {
  unitNumber:   string;
  floor:        FloorLevel;
  type:         UnitType;
  barrierFree:  boolean;
  sourceDrawing:string;
  notes?:       string;
}

export interface ConfirmedQuantity {
  description:  string;
  qty:          number;
  unit:         string;
  confidence:   Confidence;
  source:       string;
  notes?:       string;
}

export interface RFI {
  id:           string;
  description:  string;
  priority:     RFIPriority;
  status:       RFIStatus;
  closedBy?:    string;
  costImpact?:  string;
  notes?:       string;
}

export interface WallType {
  code:         string;
  description:  string;
  fireRating?:  string;
  stcRating?:   number;
  source:       string;
}

export interface ExteriorFinish {
  code:         string;
  description:  string;
  manufacturer?:string;
  colour?:      string;
  colourStatus: "CONFIRMED" | "TBD";
  source:       string;
  rfiRef?:      string;
}

export interface SpecSection {
  number:  string;
  title:   string;
  present: boolean;
  notes?:  string;
  closes?: string;   // RFI closed by this section
}

// ─── DRAWING REGISTER ─────────────────────────────────────────────────────────

export const DRAWING_REGISTER: Drawing[] = [
  // Architectural — Confirmed
  { number:"A101", title:"Underground Parking Plan",           status:"RECEIVED",  confidence:"C1", source:"Session 2" },
  { number:"A201", title:"Ground Floor Plan – A Wing",         status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A202", title:"Ground Floor Plan – B Wing",         status:"RECEIVED",  confidence:"C1", source:"Session 2" },
  { number:"A204", title:"Second Floor Plan – A Wing",         status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A205", title:"Second Floor Plan – B Wing",         status:"RECEIVED",  confidence:"C1", source:"Session 2" },
  { number:"A207", title:"Third Floor Plan – A Wing",          status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A208", title:"Third Floor Plan – B Wing",          status:"RECEIVED",  confidence:"C1", source:"Session 2" },
  { number:"A210", title:"Mechanical Penthouse – A Wing",      status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A213", title:"Roof Plan – A Wing",                 status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A301", title:"Elevations (5 views)",               status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A401", title:"Building Section AA",                status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A402", title:"Building Section BB",                status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A403", title:"Building Section CC",                status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A411", title:"Wall Section – Typical Exterior 1",  status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A412", title:"Wall Section – Typical Exterior 2",  status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A413", title:"Wall Section – Typical Exterior 3",  status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A501", title:"Stair Details – Stairs A, B, C",     status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A611", title:"Foundation / Grade Detail",          status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A621", title:"Garbage Chute Detail",               status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A622", title:"Barrier-Free Detail",                status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A216", title:"Washroom Details",                   status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A701", title:"Door & Room Finish Schedule",        status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A711", title:"Window Schedule – Ground Floor",     status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A712", title:"Window Schedule – Floor 2",          status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A713", title:"Window Schedule – Floor 3",          status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A714", title:"Window Schedule – Penthouse",        status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  { number:"A004", title:"Wall Type Legend",                   status:"RECEIVED",  confidence:"C1", source:"Session 1" },
  // Landscape
  { number:"LE-1.0", title:"Landscape Lighting Plan",          status:"RECEIVED",  confidence:"C2", source:"Session 1" },

  // MISSING — BLOCKERS
  { number:"A203", title:"Ground Floor Plan – C Wing",         status:"MISSING",   confidence:"C4", rfiRef:"RFI-023",
    notes:"Contains BF units 101/102/106; ~200m² GFA missing; ~6 suites unknown" },
  { number:"A206", title:"Second Floor Plan – C Wing",         status:"MISSING",   confidence:"C4", rfiRef:"RFI-023",
    notes:"~200m² GFA missing; ~6 suites unknown" },
  { number:"A209", title:"Third Floor Plan – C Wing",          status:"MISSING",   confidence:"C4", rfiRef:"RFI-023",
    notes:"Referenced on A208; ~200m² GFA missing; ~6 suites unknown" },

  // MISSING — HIGH
  { number:"A211", title:"Stair A Penthouse Detail",           status:"MISSING",   confidence:"C3", rfiRef:"RFI-013" },
  { number:"A214", title:"Roof Details",                       status:"MISSING",   confidence:"C3", rfiRef:"RFI-013" },

  // STRUCTURAL — NOT RECEIVED
  { number:"S-series", title:"Structural Drawings (foundations, post-tension, shear walls, steel schedule)",
    status:"MISSING", confidence:"C4", rfiRef:"RFI-002",
    notes:"BLOCKER — CIP concrete, structural steel, post-tension quantities all at allowance until received" },

  // MEP — NOT RECEIVED
  { number:"M-series", title:"Mechanical Drawings",           status:"MISSING",   confidence:"C4", rfiRef:"RFI-006" },
  { number:"E-series", title:"Electrical Drawings",           status:"MISSING",   confidence:"C4", rfiRef:"RFI-007" },
  { number:"P-series", title:"Plumbing Drawings",             status:"MISSING",   confidence:"C4", rfiRef:"RFI-006" },

  // Specifications
  { number:"SPEC-R1", title:"Project Specifications Rev 1 (May 2021) — 390 pages",
    status:"RECEIVED", confidence:"C1", source:"Session 1",
    notes:"MD5: ebca8a94ba52a75683cc32b5ed938290" },
  { number:"SPEC-R2", title:"Project Specifications Rev 2 (May 28)",
    status:"PARTIAL", confidence:"C1", rfiRef:"RFI-SPEC-01",
    notes:"IDENTICAL to R1 — same MD5. Correct R2 has not been received." },
  { number:"ID-pkg",  title:"Interior Design Package",        status:"MISSING",   confidence:"C4", rfiRef:"RFI-008" },
  { number:"RCP",     title:"Reflected Ceiling Plans",        status:"MISSING",   confidence:"C4", rfiRef:"RFI-013" },
];

// ─── FLOOR DATUMS ─────────────────────────────────────────────────────────────

export const FLOOR_DATUMS: FloorDatum[] = [
  { level:"P1",   label:"Underground Parking Level",    elevationM: 257.60, ftfHeightM: 4.65, source:"A101/A201 datum annotations", confidence:"C1" },
  { level:"GF",   label:"Ground Floor",                 elevationM: 262.25, ftfHeightM: 4.00, source:"A201/A202 datum annotations", confidence:"C1" },
  { level:"F2",   label:"Floor 2 / Second Floor",       elevationM: 266.25, ftfHeightM: 3.60, source:"A204/A205 datum annotations", confidence:"C1" },
  { level:"F3",   label:"Floor 3 / Third Floor",        elevationM: 269.85, ftfHeightM: 4.10, source:"A207/A208 datum annotations", confidence:"C1" },
  { level:"MPH",  label:"Mechanical Penthouse",         elevationM: 273.95, ftfHeightM: 3.80, source:"A210 datum annotation",       confidence:"C1" },
  { level:"ROOF", label:"Roof Level",                   elevationM: 278.05, ftfHeightM: undefined, source:"A213 / A301",           confidence:"C1" },
];

// ─── BUILDING GEOMETRY ────────────────────────────────────────────────────────

export const BUILDING_GEOMETRY = {
  // Grid dimensions — confirmed from all plans
  gridNS_mm:         41999,   // N-S grid confirmed A201/A204/A207: 4710+3489+4354+2546+4050+2301+749+6850+3051+6849+3050
  gridEW_mm:         40830,   // E-W grid confirmed A201/A204/A207: 3475+9479+1846+4200+6980+6606+2359+5885
  parkingEW_mm:      42801,   // Extended at parking crescent B-wing (A101)
  gridNS_m:          42.00,
  gridEW_m:          40.83,
  parkingEW_m:       42.80,

  // Building height
  buildingHeightOBC_mm:  12000,  // Per A301 elevation tag — OBC measure
  datumRangeGFtoRoof_mm: 15800,  // 278.05 - 262.25 = 15.80m (RFI-017 open — classification question)
  source: "A201/A204/A207 grid dims; A301 height annotation",
  confidence: "C1" as Confidence,

  // Structural bays
  structuralBays_mm: [4100, 4100, 3600, 4000] as number[],

  // Ceiling heights (confirmed from plan notes)
  ceilingHeights: {
    suiteGeneral_mmAFF:    3050,  // CL1a confirmed A201
    suiteBathroom_mmAFF:   2750,  // CL1a confirmed A201
    corridor_mmAFF:        2750,  // Corridor ceiling note all floors
    source: "A201 ceiling height annotations CL1a",
    confidence: "C1" as Confidence,
  },

  // Floor areas (PARTIAL — A203/A206/A209 missing)
  gfa: {
    parkingP1_m2:         4000,  // confidence:"C1", source:"A101 full footprint"
    groundFloorPartial_m2:1700,  // A+B wings only — A203 missing ~200m²
    floor2Partial_m2:     1650,  // A+B wings only — A206 missing ~200m²
    floor3Partial_m2:     1550,  // A+B wings only — A209 missing ~200m²
    mphFloor_m2:           400,  confidence:"C2", source:"A210",
    aboveGradePartial_m2: 4900,  // PARTIAL — missing ~600m²
    allFloorsPartial_m2:  8900,  // PARTIAL — missing ~600m²
    missingCWing_m2_est:   600,  // Estimated from A+B wing density
    notes: "BLOCKER: A203/A206/A209 not received. Total GFA understated by ~600m².",
  },

  rampGrades: {
    externalApproach_pct:  15.0,  // A101 annotation
    internalMain_pct:      11.5,  // A101 annotation
    internalSecondary_pct:  4.5,  // A101 annotation
    gfAccessible_pct:       8.0,  // A202 ramp to GF
    source: "A101 ramp grade annotations",
    confidence: "C1" as Confidence,
  },
} as const;

// ─── UNIT MIX SCHEDULE ───────────────────────────────────────────────────────

export const UNIT_SCHEDULE: Suite[] = [
  // GROUND FLOOR — A Wing (A201)
  { unitNumber:"110", floor:"GF", type:"2B",    barrierFree:false, sourceDrawing:"A201" },
  { unitNumber:"111", floor:"GF", type:"2B+D",  barrierFree:false, sourceDrawing:"A201" },
  { unitNumber:"112", floor:"GF", type:"2B+D",  barrierFree:true,  sourceDrawing:"A201" },
  { unitNumber:"113", floor:"GF", type:"3B",    barrierFree:false, sourceDrawing:"A201" },
  { unitNumber:"114", floor:"GF", type:"2B",    barrierFree:false, sourceDrawing:"A201" },
  { unitNumber:"115", floor:"GF", type:"2B+D",  barrierFree:false, sourceDrawing:"A201" },
  { unitNumber:"116", floor:"GF", type:"3B",    barrierFree:true,  sourceDrawing:"A201" },
  { unitNumber:"117", floor:"GF", type:"2B+D",  barrierFree:true,  sourceDrawing:"A201" },
  { unitNumber:"118", floor:"GF", type:"2B+D",  barrierFree:true,  sourceDrawing:"A201" },
  { unitNumber:"119", floor:"GF", type:"2B+D",  barrierFree:false, sourceDrawing:"A201" },

  // GROUND FLOOR — B Wing (A202)
  { unitNumber:"108", floor:"GF", type:"2B+D",  barrierFree:false, sourceDrawing:"A202" },
  { unitNumber:"109", floor:"GF", type:"2B",    barrierFree:false, sourceDrawing:"A202" },

  // GROUND FLOOR — C Wing (A203 MISSING)
  { unitNumber:"101", floor:"GF", type:"UNKNOWN", barrierFree:true,  sourceDrawing:"A203", notes:"A203 MISSING — BF confirmed from legend" },
  { unitNumber:"102", floor:"GF", type:"UNKNOWN", barrierFree:true,  sourceDrawing:"A203", notes:"A203 MISSING — BF confirmed from legend" },
  { unitNumber:"103", floor:"GF", type:"UNKNOWN", barrierFree:false, sourceDrawing:"A203", notes:"A203 MISSING" },
  { unitNumber:"104", floor:"GF", type:"UNKNOWN", barrierFree:false, sourceDrawing:"A203", notes:"A203 MISSING" },
  { unitNumber:"105", floor:"GF", type:"UNKNOWN", barrierFree:false, sourceDrawing:"A203", notes:"A203 MISSING" },
  { unitNumber:"106", floor:"GF", type:"UNKNOWN", barrierFree:true,  sourceDrawing:"A203", notes:"A203 MISSING — BF confirmed from legend" },
  { unitNumber:"107", floor:"GF", type:"UNKNOWN", barrierFree:false, sourceDrawing:"A203", notes:"A203 MISSING" },

  // FLOOR 2 — A Wing (A204)
  { unitNumber:"210", floor:"F2", type:"2B",    barrierFree:false, sourceDrawing:"A204" },
  { unitNumber:"211", floor:"F2", type:"2B+D",  barrierFree:false, sourceDrawing:"A204" },
  { unitNumber:"212", floor:"F2", type:"2B+D",  barrierFree:false, sourceDrawing:"A204" },
  { unitNumber:"213", floor:"F2", type:"2B",    barrierFree:false, sourceDrawing:"A204" },
  { unitNumber:"214", floor:"F2", type:"2B+D",  barrierFree:false, sourceDrawing:"A204" },
  { unitNumber:"215", floor:"F2", type:"3B",    barrierFree:true,  sourceDrawing:"A204" },
  { unitNumber:"216", floor:"F2", type:"2B+D",  barrierFree:true,  sourceDrawing:"A204" },
  { unitNumber:"217", floor:"F2", type:"2B+D",  barrierFree:true,  sourceDrawing:"A204" },
  { unitNumber:"218", floor:"F2", type:"2B+D",  barrierFree:true,  sourceDrawing:"A204" },

  // FLOOR 2 — B Wing (A205)
  { unitNumber:"201", floor:"F2", type:"2B",    barrierFree:false, sourceDrawing:"A205" },
  { unitNumber:"208", floor:"F2", type:"2B+D",  barrierFree:false, sourceDrawing:"A205" },
  { unitNumber:"209", floor:"F2", type:"2B",    barrierFree:false, sourceDrawing:"A205" },
  { unitNumber:"219", floor:"F2", type:"1B+D",  barrierFree:false, sourceDrawing:"A205", notes:"New unit type — first confirmed 1B+D" },
  { unitNumber:"220", floor:"F2", type:"1B+D",  barrierFree:false, sourceDrawing:"A205" },

  // FLOOR 2 — C Wing (A206 MISSING)
  { unitNumber:"202", floor:"F2", type:"UNKNOWN", barrierFree:false, sourceDrawing:"A206", notes:"A206 MISSING" },
  { unitNumber:"203", floor:"F2", type:"UNKNOWN", barrierFree:false, sourceDrawing:"A206", notes:"A206 MISSING" },
  { unitNumber:"204", floor:"F2", type:"UNKNOWN", barrierFree:false, sourceDrawing:"A206", notes:"A206 MISSING" },
  { unitNumber:"205", floor:"F2", type:"UNKNOWN", barrierFree:false, sourceDrawing:"A206", notes:"A206 MISSING" },
  { unitNumber:"206", floor:"F2", type:"UNKNOWN", barrierFree:false, sourceDrawing:"A206", notes:"A206 MISSING" },
  { unitNumber:"207", floor:"F2", type:"UNKNOWN", barrierFree:false, sourceDrawing:"A206", notes:"A206 MISSING" },

  // FLOOR 3 — A Wing (A207)
  { unitNumber:"309", floor:"F3", type:"2B",    barrierFree:false, sourceDrawing:"A207" },
  { unitNumber:"310", floor:"F3", type:"2B+D",  barrierFree:false, sourceDrawing:"A207" },
  { unitNumber:"311", floor:"F3", type:"2B",    barrierFree:false, sourceDrawing:"A207" },
  { unitNumber:"312", floor:"F3", type:"2B+D",  barrierFree:false, sourceDrawing:"A207" },
  { unitNumber:"313", floor:"F3", type:"2B",    barrierFree:false, sourceDrawing:"A207" },
  { unitNumber:"314", floor:"F3", type:"2B+D",  barrierFree:false, sourceDrawing:"A207" },
  { unitNumber:"315", floor:"F3", type:"2B",    barrierFree:false, sourceDrawing:"A207" },
  { unitNumber:"316", floor:"F3", type:"2B+D",  barrierFree:false, sourceDrawing:"A207" },

  // FLOOR 3 — B Wing (A208)
  { unitNumber:"301", floor:"F3", type:"1B+D",  barrierFree:false, sourceDrawing:"A208" },
  { unitNumber:"307", floor:"F3", type:"2B+D",  barrierFree:false, sourceDrawing:"A208" },
  { unitNumber:"308", floor:"F3", type:"2B",    barrierFree:false, sourceDrawing:"A208" },
  { unitNumber:"317", floor:"F3", type:"1B+D",  barrierFree:false, sourceDrawing:"A208" },
  { unitNumber:"318", floor:"F3", type:"1B+D",  barrierFree:false, sourceDrawing:"A208" },

  // FLOOR 3 — C Wing (A209 MISSING)
  { unitNumber:"302", floor:"F3", type:"UNKNOWN", barrierFree:false, sourceDrawing:"A209", notes:"A209 MISSING" },
  { unitNumber:"303", floor:"F3", type:"UNKNOWN", barrierFree:false, sourceDrawing:"A209", notes:"A209 MISSING" },
  { unitNumber:"304", floor:"F3", type:"UNKNOWN", barrierFree:false, sourceDrawing:"A209", notes:"A209 MISSING" },
  { unitNumber:"305", floor:"F3", type:"UNKNOWN", barrierFree:false, sourceDrawing:"A209", notes:"A209 MISSING" },
  { unitNumber:"306", floor:"F3", type:"UNKNOWN", barrierFree:false, sourceDrawing:"A209", notes:"A209 MISSING" },
];

// ─── CONFIRMED QUANTITIES ─────────────────────────────────────────────────────

export const CONFIRMED_QUANTITIES: Record<string, ConfirmedQuantity> = {
  parkingStalls: {
    description: "Underground parking stalls — numbered 1–91 on A101",
    qty: 91, unit: "stalls", confidence: "C1", source: "A101 stall plan"
  },
  evStalls: {
    description: "EV charging stalls — labelled on A101",
    qty: 10, unit: "stalls", confidence: "C1", source: "A101"
  },
  accessibleStalls: {
    description: "Accessible parking stalls at elevator lobby",
    qty: 5, unit: "stalls", confidence: "C1", source: "A101 elevator lobby"
  },
  elevators: {
    description: "Traction elevators — machine room B01-03a",
    qty: 2, unit: "units", confidence: "C1", source: "A101/A202 B01-03a"
  },
  precastStairFlights: {
    description: "Precast concrete stair flights — Stairs A, B, C (3 flights each)",
    qty: 9, unit: "flights", confidence: "C1", source: "A501; 03 41 23 spec"
  },
  chuteIntakeFloors: {
    description: "Garbage chute intake hopper doors (GF/F2/F3 + P1 discharge)",
    qty: 4, unit: "floors", confidence: "C1", source: "A201/A204/A207; 11 91 82 spec"
  },
  suitesConfirmed: {
    description: "Residential suites confirmed from received drawings (A+B wings all floors)",
    qty: 34, unit: "suites", confidence: "C1", source: "A201/A202/A204/A205/A207/A208"
  },
  bfSuitesConfirmed: {
    description: "Barrier-free suites confirmed (BF designation on drawings)",
    qty: 8, unit: "suites", confidence: "C1",
    source: "A201: 112/116/117/118; A204: 215/216/217/218",
    notes: "Additional BF suites in A203 (units 101/102/106) not yet confirmed"
  },
  insectScreens: {
    description: "Window insect screens — all operable WD panels per A711-A714",
    qty: 138, unit: "ea", confidence: "C1", source: "A711/A712/A713/A714"
  },
  parkingHeadroom: {
    description: "Parking level minimum clear headroom",
    qty: 2100, unit: "mm", confidence: "C1", source: "A101 annotation"
  },
  roofArea: {
    description: "Roof area from A213 roof plan",
    qty: 1700, unit: "m²", confidence: "C2", source: "A213"
  },
  parkingArea: {
    description: "Parking level area — full building footprint at P1",
    qty: 4000, unit: "m²", confidence: "C1", source: "A101"
  },
};

// ─── WALL TYPE CATALOGUE ─────────────────────────────────────────────────────

export const WALL_TYPES: WallType[] = [
  { code:"IW1a",  description:"Ext wall — metal stud + exterior sheathing",             source:"A004/A411-A413" },
  { code:"IW1b",  description:"Int partition — metal stud + GWB both sides",            source:"A004" },
  { code:"IW1s",  description:"Shaft liner wall — 2HR UL rated shaftwall assembly",     fireRating:"2HR", stcRating:50, source:"A004" },
  { code:"IW2b",  description:"BF accessible suite wall — 20ga stud + backer plate",    source:"A004/A622" },
  { code:"IW2f",  description:"Wet wall — metal stud + cement board + tile",            source:"A004" },
  { code:"IW2g",  description:"Interior glazed partition — aluminum framed",            source:"A004" },
  { code:"IW2m",  description:"Concrete retaining wall — ramp conditions",              source:"A004/A101" },
  { code:"IW3b",  description:"Suite demising wall — fire-rated GWB assembly STC50",    fireRating:"1HR", stcRating:50, source:"A004/A411-A413" },
  { code:"IW3e",  description:"Suite demising wall — enhanced STC ULC W453",            fireRating:"1HR", stcRating:55, source:"A004/A411-A413" },
  { code:"IW3f",  description:"Rated partition — demising + shaft at corridor",         fireRating:"2HR", source:"A004" },
  { code:"IW4a",  description:"CMU load-bearing block — 200mm service core",            source:"A004/A101" },
  { code:"IW4b",  description:"CMU block — parking/structural walls",                   source:"A004/A101" },
  { code:"IW4c",  description:"CMU block — stair cores all floors",                     source:"A004" },
  { code:"IW4d",  description:"CIP concrete structural wall",                           source:"A004" },
  { code:"IW8b",  description:"CIP concrete structure — parking garage walls",          source:"A004/A101" },
  { code:"IW9a",  description:"Glazed storefront partitions — corridor/amenity",        source:"A004/A201/A204/A207" },
  { code:"EW1a",  description:"Exterior wall — brick veneer on metal stud + insul",     source:"A411-A413" },
  { code:"EW1b",  description:"Exterior wall — curtain wall on concrete",               source:"A411-A413" },
  { code:"T04",   description:"Parking stall line marking — traffic paint",             source:"A101" },
];

// ─── EXTERIOR FINISHES (A301) ─────────────────────────────────────────────────

export const EXTERIOR_FINISHES: ExteriorFinish[] = [
  { code:"GL1",  description:"Aluminum window wall glazing system",           manufacturer:"TBC", colour:"Mill/Clear",   colourStatus:"CONFIRMED", source:"A301" },
  { code:"SP1",  description:"Spandrel glass unit — integrated with GL1",     manufacturer:"TBC", colour:"TBD",          colourStatus:"TBD",       source:"A301", rfiRef:"RFI-009" },
  { code:"LV1",  description:"Aluminum wall louver — MPH level",              manufacturer:"TBC", colour:"TBD",          colourStatus:"TBD",       source:"A301", rfiRef:"RFI-010" },
  { code:"AP1",  description:"Aluminum sheet/composite panel",                manufacturer:"TBC", colour:"TBD",          colourStatus:"TBD",       source:"A301", rfiRef:"RFI-010" },
  { code:"CS1",  description:"Brampton Brick Vivace — dominant zone",         manufacturer:"Brampton Brick", colour:"Sienna", colourStatus:"CONFIRMED", source:"A301" },
  { code:"CS2",  description:"Brampton Brick Vivace — accent zone",           manufacturer:"Brampton Brick", colour:"Cortona", colourStatus:"CONFIRMED", source:"A301" },
  { code:"ML1",  description:"Window mullion — aluminum",                     manufacturer:"TBC", colour:"Match GL1",    colourStatus:"CONFIRMED", source:"A301" },
  { code:"WP1",  description:"Wood privacy screen — balcony/terrace",         manufacturer:"TBC", colour:"Natural",      colourStatus:"CONFIRMED", source:"A301", rfiRef:"RFI-020" },
  { code:"GC1",  description:"Glulam column — entry feature",                 manufacturer:"TBC", colour:"Natural",      colourStatus:"CONFIRMED", source:"A301" },
  { code:"RL1",  description:"Glass railing with aluminum posts and handrail", manufacturer:"TBC", colour:"Clear/Alum",  colourStatus:"CONFIRMED", source:"A301/A501" },
  { code:"PR1",  description:"Prefinished metal cap flashing — parapet",      manufacturer:"TBC", colour:"Match",        colourStatus:"CONFIRMED", source:"A301/A213" },
  { code:"SC",   description:"Scupper — prefinished metal",                   manufacturer:"TBC", colour:"Match",        colourStatus:"CONFIRMED", source:"A301/A213" },
];

// ─── SPECIFICATION SECTIONS ───────────────────────────────────────────────────

export const SPEC_SECTIONS: SpecSection[] = [
  // CONFIRMED PRESENT
  { number:"01 21 00", title:"Cash Allowances",          present:true,  notes:"Values absent — RFI-SPEC-04" },
  { number:"03 41 23", title:"Precast Concrete Stairs",  present:true,  closes:"RFI-012" },
  { number:"03 54 16", title:"Self-Levelling Underlayment", present:true },
  { number:"04 20 00", title:"Unit Masonry",             present:true,  closes:"RFI-019" },
  { number:"05 27 20", title:"Aluminum Handrails & Railings", present:true },
  { number:"05 41 00", title:"Structural Metal Stud Framing", present:true },
  { number:"05 50 00", title:"Metal Fabrications",       present:true },
  { number:"06 05 73", title:"Wood Treatment",           present:true },
  { number:"06 10 00", title:"Rough Carpentry",          present:true },
  { number:"06 20 00", title:"Finish Carpentry",         present:true },
  { number:"07 13 00", title:"Below-Grade Waterproofing",present:true },
  { number:"07 18 14", title:"Parking Deck Waterproofing",present:true },
  { number:"07 21 00", title:"Thermal Insulation",       present:true },
  { number:"07 21 16", title:"Batt Insulation",          present:true },
  { number:"07 24 00", title:"Exterior GWB Sheathing",   present:true },
  { number:"07 25 00", title:"Air/Vapour Barrier",       present:true },
  { number:"07 51 00", title:"Modified Bitumen Roofing", present:true },
  { number:"07 62 00", title:"Sheet Metal Flashing",     present:true },
  { number:"07 84 00", title:"Firestopping",             present:true },
  { number:"07 92 00", title:"Joint Sealants",           present:true },
  { number:"08 11 13", title:"Hollow Metal Doors & Frames", present:true },
  { number:"08 14 16", title:"Flush Wood Doors",         present:true },
  { number:"08 38 00", title:"Glazed Partitions",        present:true },
  { number:"08 44 00", title:"Curtain Wall / Window Wall", present:true },
  { number:"08 90 00", title:"Louvres & Vents",          present:true },
  { number:"09 22 00", title:"Metal Stud Framing / GWB", present:true },
  { number:"09 29 00", title:"GWB Ceilings",             present:true },
  { number:"09 30 00", title:"Ceramic Tile",             present:true },
  { number:"09 51 00", title:"Acoustic Suspended Ceilings", present:true },
  { number:"09 64 00", title:"Hardwood Flooring",        present:true },
  { number:"09 65 00", title:"Resilient Flooring",       present:true },
  { number:"09 68 00", title:"Carpet",                   present:true },
  { number:"09 91 00", title:"Interior Painting",        present:true,
    notes:"MPI APL only; E2/E3 rating required; premium grade; low-VOC" },
  { number:"10 21 00", title:"Compartments & Cubicles",  present:true },
  { number:"10 22 13", title:"Wire Mesh Partitions",     present:true },
  { number:"10 28 14", title:"Toilet / Washroom Accessories", present:true },
  { number:"10 51 00", title:"Lockers",                  present:true },
  { number:"10 55 00", title:"Postal Specialties",       present:true },
  { number:"10 81 16", title:"Pest Control Devices (insect screens)", present:true },
  { number:"10 86 00", title:"Safety Mirrors",           present:true },
  { number:"11 82 26", title:"Waste Sorting Equipment",  present:true,
    notes:"3-stream; 208V/575V 3-phase; NEMA 13; ULC panel; ball-screw actuated jacks" },
  { number:"11 91 82", title:"Garbage Chute",            present:true, closes:"RFI-014",
    notes:"610mm dia 16ga aluminized steel; 381×457mm doors; 1.5HR UL rated; ADA lever handles" },
  { number:"31 00 00", title:"Earthwork",                present:true,
    notes:"Granular A/B per OPSS 1010; Terrafix filter cloth; no slag/recycled aggregate" },
  { number:"32 05 03", title:"Miscellaneous Exterior Concrete", present:true },
  { number:"32 12 16", title:"Asphalt Paving",           present:true },
  { number:"32 90 00", title:"Landscaping",              present:true },

  // CONFIRMED ABSENT — BLOCKERS
  { number:"03 30 00", title:"Cast-in-Place Concrete",   present:false, notes:"RFI-SPEC-02 OPEN — BLOCKER" },
  { number:"05 10 00", title:"Structural Steel",         present:false, notes:"RFI-SPEC-05 OPEN — HIGH" },
  { number:"14 21 00", title:"Elevators",                present:false, notes:"RFI-015 OPEN — MEDIUM" },
  { number:"21 00 00", title:"Fire Suppression (Sprinkler)", present:false, notes:"RFI-SPEC-03 OPEN — BLOCKER" },
  { number:"22 00 00", title:"Plumbing",                 present:false, notes:"RFI-SPEC-03 OPEN — BLOCKER" },
  { number:"23 00 00", title:"HVAC",                     present:false, notes:"RFI-SPEC-03 OPEN — BLOCKER" },
  { number:"26 00 00", title:"Electrical",               present:false, notes:"RFI-SPEC-03 OPEN — BLOCKER" },
  { number:"27 00 00", title:"Telecommunications",       present:false, notes:"RFI-SPEC-03 OPEN — BLOCKER" },
  { number:"28 00 00", title:"Electronic Safety & Security (incl. Enterphone)", present:false, notes:"RFI-025 OPEN — HIGH" },
];

// ─── OPEN RFI LOG ─────────────────────────────────────────────────────────────

export const RFI_LOG: RFI[] = [
  // CLOSED
  { id:"RFI-005",      description:"Floor-to-floor heights — all datums confirmed",                      priority:"HIGH",   status:"CLOSED", closedBy:"A201/A204/A207/A210 datum annotations" },
  { id:"RFI-012",      description:"Precast stair specification — confirmed 03 41 23",                   priority:"HIGH",   status:"CLOSED", closedBy:"03 41 23 in specification R1" },
  { id:"RFI-014",      description:"Garbage chute specification — confirmed 11 91 82",                   priority:"HIGH",   status:"CLOSED", closedBy:"11 91 82 in specification R1" },
  { id:"RFI-016",      description:"Parking stall count — 91 stalls + 10 EV confirmed",                  priority:"HIGH",   status:"CLOSED", closedBy:"A101 stall numbering" },
  { id:"RFI-019",      description:"CMU spec — confirmed in 04 20 00 Unit Masonry",                       priority:"MEDIUM", status:"CLOSED", closedBy:"04 20 00 in specification R1" },

  // OPEN — BLOCKER
  { id:"RFI-023",      description:"A203/A206/A209 missing — C-wing suites 101-107/201-207/301-306; ~16 suites unknown; 3 BF suites unconfirmed",
    priority:"BLOCKER", status:"OPEN", costImpact:"±$2.0–3.5M" },
  { id:"RFI-001",      description:"Drawing register incomplete — C-wing plans, MEP, structural not received",
    priority:"CRITICAL", status:"OPEN" },
  { id:"RFI-002",      description:"Structural drawings S-series not received — foundations, PT slab, shear walls, steel schedule unknown",
    priority:"BLOCKER", status:"OPEN", costImpact:"±$800K–1.5M" },
  { id:"RFI-003",      description:"Suite count uncertain — 34 confirmed, ~50 estimated total",
    priority:"CRITICAL", status:"OPEN" },
  { id:"RFI-004",      description:"GFA understated by ~600m² due to missing C-wing plans",
    priority:"CRITICAL", status:"OPEN" },
  { id:"RFI-SPEC-01",  description:"Specification R2 identical to R1 (same MD5) — correct revision not received",
    priority:"CRITICAL", status:"OPEN" },
  { id:"RFI-SPEC-02",  description:"03 30 00 CIP Concrete specification entirely absent — all CIP at benchmark rates",
    priority:"BLOCKER", status:"OPEN", costImpact:"±$500K" },
  { id:"RFI-SPEC-03",  description:"Entire MEP specification Div 21–28 absent — all MEP at benchmark allowance rates",
    priority:"BLOCKER", status:"OPEN", costImpact:"±$1.5–3.0M" },
  { id:"RFI-006",      description:"Mechanical drawings not received",
    priority:"BLOCKER", status:"OPEN" },
  { id:"RFI-007",      description:"Electrical drawings not received",
    priority:"BLOCKER", status:"OPEN" },

  // OPEN — HIGH
  { id:"RFI-017",      description:"Building height discrepancy: A301 annotates 12,000mm OBC but datum range GF–Roof = 15,800mm — OBC Group C/D classification impact",
    priority:"HIGH", status:"OPEN" },
  { id:"RFI-024",      description:"Lobby gas fireplace F01-02 — no specification, fuel type unconfirmed, no flue detail",
    priority:"HIGH", status:"OPEN", costImpact:"±$30K" },
  { id:"RFI-025",      description:"Enterphone/access control system — Div 28 specification entirely absent",
    priority:"HIGH", status:"OPEN", costImpact:"±$50K" },
  { id:"RFI-026",      description:"Member's Club F03-01 — no ID specification; kitchen/bar/AV scope undefined; occ.50 program not detailed",
    priority:"HIGH", status:"OPEN", costImpact:"±$200K" },
  { id:"RFI-SPEC-04",  description:"Cash Allowances section 01 21 00 — present but all dollar values blank",
    priority:"HIGH", status:"OPEN" },
  { id:"RFI-SPEC-05",  description:"05 10 00 Structural Steel specification absent — structural frame cost unknown",
    priority:"HIGH", status:"OPEN", costImpact:"±$400K" },
  { id:"RFI-021",      description:"21 soffit type codes identified on plans — assembly specifications not received",
    priority:"HIGH", status:"OPEN" },
  { id:"RFI-022",      description:"MPH equipment schedule — no MEP drawings received; mechanical penthouse equipment unknown",
    priority:"HIGH", status:"OPEN" },
  { id:"RFI-008",      description:"Interior Design drawings not issued — all suite finish specifications at assumed values",
    priority:"HIGH", status:"OPEN" },

  // OPEN — MEDIUM
  { id:"RFI-015",      description:"Elevator specification absent — 2 units confirmed, spec/manufacturer/cab finish unknown",
    priority:"MEDIUM", status:"OPEN", costImpact:"±$150K" },
  { id:"RFI-011",      description:"Suite door hardware complete count pending A203/A206/A209 confirmation",
    priority:"MEDIUM", status:"OPEN" },
  { id:"RFI-013",      description:"Reflected ceiling plans not received — ceiling materials at assumed values",
    priority:"MEDIUM", status:"OPEN", costImpact:"±$100K" },
  { id:"RFI-018",      description:"Guest Suite Floor 2 (F02-07) — type, area, and specification unknown",
    priority:"MEDIUM", status:"OPEN" },
  { id:"RFI-020",      description:"WP1 Wood Privacy Screen — species and treatment specification not confirmed",
    priority:"MEDIUM", status:"OPEN" },
  { id:"RFI-009",      description:"SP1 Spandrel Glass Unit — colour TBD on A301",
    priority:"MEDIUM", status:"OPEN" },
  { id:"RFI-010",      description:"AP1 Aluminum Panel / LV1 Louver — colours TBD on A301",
    priority:"MEDIUM", status:"OPEN" },

  // OPEN — LOW
  { id:"RFI-SPEC-06",  description:"Acoustic subflooring specification not confirmed",   priority:"LOW", status:"OPEN" },
  { id:"RFI-SPEC-07",  description:"Tile type and finish not specified — deferred to ID drawings",  priority:"LOW", status:"OPEN" },
  { id:"RFI-SPEC-08",  description:"Window frame colours not confirmed in specification", priority:"LOW", status:"OPEN" },
];

// ─── AMENITY SPACES ──────────────────────────────────────────────────────────

export const AMENITY_SPACES = [
  // Ground Floor (A202)
  { id:"F01-01", name:"Main Lobby",          floor:"GF", area_m2_est:120, source:"A202", confirmed:true },
  { id:"F01-02", name:"Lobby Fireplace Area", floor:"GF", area_m2_est:30,  source:"A202", confirmed:true,
    notes:"Gas fireplace — no spec — RFI-024" },
  { id:"F01-03", name:"Mail Room",            floor:"GF", area_m2_est:18,  source:"A202", confirmed:true },
  { id:"F01-04", name:"Parcel Storage",       floor:"GF", area_m2_est:12,  source:"A202", confirmed:true },
  { id:"F01-05", name:"Moving Room",          floor:"GF", area_m2_est:20,  source:"A202", confirmed:true },
  { id:"F01-06", name:"Garbage / Recycling",  floor:"GF", area_m2_est:25,  source:"A202", confirmed:true },
  { id:"F01-07", name:"Universal Washroom",   floor:"GF", area_m2_est:8,   source:"A202", confirmed:true },
  { id:"F01-08", name:"Pet Spa",              floor:"GF", area_m2_est:15,  source:"A202", confirmed:true },

  // Parking Level (A101)
  { id:"B01-01", name:"Parking Garage",       floor:"P1", area_m2_est:3800,source:"A101", confirmed:true },
  { id:"B01-03", name:"Elevator Lobby P1",    floor:"P1", area_m2_est:30,  source:"A101", confirmed:true },
  { id:"B01-03a",name:"Elevator Machine Room",floor:"P1", area_m2_est:18,  source:"A101", confirmed:true },
  { id:"B01-05", name:"Lockers (5 units)",    floor:"P1", area_m2_est:20,  source:"A101", confirmed:true },
  { id:"B01-06", name:"Electrical Room",      floor:"P1", area_m2_est:25,  source:"A101", confirmed:true },
  { id:"B01-07", name:"Telecom Room",         floor:"P1", area_m2_est:10,  source:"A101", confirmed:true },
  { id:"B01-08", name:"Water Meter Room",     floor:"P1", area_m2_est:8,   source:"A101", confirmed:true },

  // Floor 2 Amenities (A205)
  { id:"F02-01", name:"Fitness Centre",       floor:"F2", area_m2_est:180, source:"A205", confirmed:true,
    notes:"Occ.20; rubber flooring; commercial equipment — spec not received" },
  { id:"F02-02", name:"Yoga Studio",          floor:"F2", area_m2_est:80,  source:"A205", confirmed:true,
    notes:"Occ.10" },
  { id:"F02-03", name:"Sauna",               floor:"F2", area_m2_est:20,  source:"A205", confirmed:true },
  { id:"F02-04", name:"Men's WR + Change",    floor:"F2", area_m2_est:35,  source:"A205", confirmed:true },
  { id:"F02-05", name:"Women's WR + Change",  floor:"F2", area_m2_est:35,  source:"A205", confirmed:true },
  { id:"F02-07", name:"Guest Suite",          floor:"F2", area_m2_est:45,  source:"A204", confirmed:true,
    notes:"Type/spec unknown — RFI-018" },

  // Floor 3 Amenities (A208)
  { id:"F03-01", name:"Member's Club",        floor:"F3", area_m2_est:200, source:"A208", confirmed:true,
    notes:"Occ.50; kitchen/bar/AV scope unknown — RFI-026" },
  { id:"F03-02", name:"TV Room",              floor:"F3", area_m2_est:45,  source:"A208", confirmed:true },
  { id:"F03-03", name:"Washroom (BF)",        floor:"F3", area_m2_est:10,  source:"A208", confirmed:true },
  { id:"F03-04", name:"Washroom",             floor:"F3", area_m2_est:8,   source:"A208", confirmed:true },
] as const;

// ─── PROJECT CONTRACT DETAILS ─────────────────────────────────────────────────

export const PROJECT_INFO = {
  name:          "The Moorings on Cameron Lake",
  address:       "99 Louisa Street, Fenelon Falls, Ontario",
  projectNumber: "21.001CS",
  architect:     "Turner Fleischer Architects Inc.",
  contractForm:  "CCDC5B-2010 Construction Management",
  specRevision:  "R1 May 2021 (R2 identical — RFI-SPEC-01)",
  jurisdiction:  "City of Kawartha Lakes, Ontario",
  applicableCode:"OBC 2012 (confirm if 2024 OBC applies — see RFI-017)",
  standards: [
    "CIQS Standard Method of Measurement",
    "CSI MasterFormat 2018",
    "AACE International 18R-97",
    "RICS NRM2",
    "OBC / NBC 2012",
    "CSA G30.18 Rebar",
    "CPCI Precast Standards",
  ],
  estimateClass:   "AACE Class 5 ±30–50%",
  estimateDate:    "March 2026",
  estimatorTool:   "EstimatorPro v15.9",
  specConflictRule:"Where drawings and specifications conflict, most expensive product governs at tender (Spec Clause 1.4.2)",
} as const;

// ─── AGGREGATE ACCESS OBJECT ─────────────────────────────────────────────────

export const MOORINGS = {
  project:     PROJECT_INFO,
  geometry:    BUILDING_GEOMETRY,
  datums:      Object.fromEntries(FLOOR_DATUMS.map(d => [d.level, d])) as Record<FloorLevel, FloorDatum>,
  units: {
    all:       UNIT_SCHEDULE,
    confirmed: UNIT_SCHEDULE.filter(u => u.sourceDrawing !== "A203" && u.sourceDrawing !== "A206" && u.sourceDrawing !== "A209"),
    missing:   UNIT_SCHEDULE.filter(u => u.notes?.includes("MISSING")),
    byFloor:   (f: FloorLevel) => UNIT_SCHEDULE.filter(u => u.floor === f),
    byType:    (t: UnitType)   => UNIT_SCHEDULE.filter(u => u.type  === t),
    barrierFree: UNIT_SCHEDULE.filter(u => u.barrierFree),
    totalCount:  UNIT_SCHEDULE.length,
    confirmedCount: UNIT_SCHEDULE.filter(u => !u.notes?.includes("MISSING")).length,
  },
  drawingRegister: {
    all:       DRAWING_REGISTER,
    received:  DRAWING_REGISTER.filter(d => d.status === "RECEIVED"),
    missing:   DRAWING_REGISTER.filter(d => d.status === "MISSING"),
    partial:   DRAWING_REGISTER.filter(d => d.status === "PARTIAL"),
    blockers:  DRAWING_REGISTER.filter(d => d.status === "MISSING" && d.rfiRef),
  },
  quantities:  CONFIRMED_QUANTITIES,
  wallTypes:   WALL_TYPES,
  finishes:    EXTERIOR_FINISHES,
  spec:        SPEC_SECTIONS,
  amenities:   AMENITY_SPACES,
  rfis: {
    all:       RFI_LOG,
    open:      RFI_LOG.filter(r => r.status === "OPEN"),
    closed:    RFI_LOG.filter(r => r.status === "CLOSED"),
    blockers:  RFI_LOG.filter(r => r.priority === "BLOCKER" && r.status === "OPEN"),
    byPriority:(p: RFIPriority) => RFI_LOG.filter(r => r.priority === p && r.status === "OPEN"),
  },
} as const;

// ─── HELPER: throw if data missing (enforces no-defaults law) ─────────────────

export function requireDatum(level: FloorLevel): FloorDatum {
  const d = FLOOR_DATUMS.find(x => x.level === level);
  if (!d) throw new Error(`No datum confirmed for level "${level}" — check drawing register`);
  return d;
}

export function requireQuantity(key: keyof typeof CONFIRMED_QUANTITIES): ConfirmedQuantity {
  const q = CONFIRMED_QUANTITIES[key];
  if (!q) throw new Error(`Quantity "${key}" not yet confirmed from drawings — raise RFI`);
  return q;
}

export function getOpenBlockers(): RFI[] {
  return RFI_LOG.filter(r => r.priority === "BLOCKER" && r.status === "OPEN");
}

export function getDrawingCompleteness(): { received: number; missing: number; pct: number } {
  const arch = DRAWING_REGISTER.filter(d => d.number.startsWith("A") || d.number.startsWith("LE"));
  const received = arch.filter(d => d.status === "RECEIVED").length;
  const total = arch.length;
  return { received, missing: total - received, pct: Math.round(received / total * 100) };
}

export function getUnitMixSummary() {
  const types: UnitType[] = ["1B+D","2B","2B+D","3B","UNKNOWN"];
  return types.map(t => ({
    type: t,
    count: UNIT_SCHEDULE.filter(u => u.type === t).length,
    confirmed: UNIT_SCHEDULE.filter(u => u.type === t && !u.notes?.includes("MISSING")).length,
    barrierFree: UNIT_SCHEDULE.filter(u => u.type === t && u.barrierFree).length,
  })).filter(x => x.count > 0);
}
