/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  DISCIPLINE SOP — SOP Parts 2 & 12
 *  EstimatorPro v14.35 — Project-agnostic
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Discipline-aware processing for 7 construction disciplines:
 *    ARC / STR / MECH / PLBG / FP / ELEC / BIM_VDC
 *  Each has:
 *    1. Required deliverables (model, drawings, specs, calcs)
 *    2. Metadata requirements (naming, parameters, classification)
 *    3. Coordination responsibilities (what to check, who to notify)
 *    4. Model content requirements per LOD stage
 *    5. QA checklists per discipline
 *
 *  Standards: CIQS, CSI MasterFormat 2018, ISO 19650, AIA E203
 *  Consumed by: model-drop-gating.ts, bep-rules-engine.ts, discipline-tests.ts
 *  Depends on:  clash-detection-engine.ts (Discipline type)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { Discipline } from './clash-detection-engine';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type DisciplineCode = 'ARC' | 'STR' | 'MECH' | 'PLBG' | 'FP' | 'ELEC' | 'BIM_VDC';

export interface DisciplineDefinition {
  code: DisciplineCode;
  fullName: string;
  internalDiscipline: Discipline;
  csiDivisions: string[];
  requiredDeliverables: Deliverable[];
  metadataRequirements: MetadataRequirement[];
  coordinationResponsibilities: CoordinationResponsibility[];
  modelContentByLOD: Record<number, string[]>;
  qaChecklist: QACheckItem[];
}

export interface Deliverable {
  id: string;
  name: string;
  type: 'model' | 'drawing' | 'specification' | 'calculation' | 'schedule' | 'report';
  required: boolean;
  description: string;
}

export interface MetadataRequirement {
  parameter: string;
  description: string;
  required: boolean;
  validationRule: string;
  example: string;
}

export interface CoordinationResponsibility {
  checkWith: DisciplineCode[];
  description: string;
  frequency: 'every_drop' | 'weekly' | 'milestone';
  priority: 'critical' | 'high' | 'medium';
}

export interface QACheckItem {
  id: string;
  description: string;
  category: 'geometry' | 'metadata' | 'classification' | 'coordination' | 'compliance';
  automated: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISCIPLINE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

export const DISCIPLINE_DEFINITIONS: DisciplineDefinition[] = [
  // ── ARCHITECTURAL ────────────────────────────────────────────────────────
  {
    code: 'ARC',
    fullName: 'Architectural',
    internalDiscipline: 'architectural',
    csiDivisions: ['06', '07', '08', '09', '10', '11', '12'],
    requiredDeliverables: [
      { id: 'ARC-M01', name: 'Architectural Model', type: 'model', required: true, description: 'Full building model with walls, doors, windows, ceilings, floors, roofs' },
      { id: 'ARC-D01', name: 'Floor Plans', type: 'drawing', required: true, description: 'Floor plans at each level with room names, areas, finishes' },
      { id: 'ARC-D02', name: 'Elevations', type: 'drawing', required: true, description: 'All building elevations' },
      { id: 'ARC-D03', name: 'Building Sections', type: 'drawing', required: true, description: 'Longitudinal and transverse sections' },
      { id: 'ARC-S01', name: 'Specifications (Div 06-12)', type: 'specification', required: true, description: 'CSI Divisions 06 through 12' },
      { id: 'ARC-SC01', name: 'Door Schedule', type: 'schedule', required: true, description: 'Door types, sizes, hardware, fire ratings' },
      { id: 'ARC-SC02', name: 'Window Schedule', type: 'schedule', required: true, description: 'Window types, sizes, glazing, U-values' },
      { id: 'ARC-SC03', name: 'Room Finish Schedule', type: 'schedule', required: true, description: 'Floor, wall, ceiling finishes per room' },
    ],
    metadataRequirements: [
      { parameter: 'Level', required: true, validationRule: 'Must reference project level', description: 'Building level assignment', example: 'Level 1' },
      { parameter: 'Room_Name', required: true, validationRule: 'Non-empty string', description: 'Room name for space assignment', example: 'Living Room' },
      { parameter: 'Fire_Rating', required: true, validationRule: 'Valid fire rating or N/A', description: 'Fire rating for walls/doors/assemblies', example: '1HR' },
      { parameter: 'Finish_Floor', required: false, validationRule: 'Spec reference', description: 'Floor finish specification', example: 'Porcelain Tile T-01' },
      { parameter: 'Assembly_Code', required: true, validationRule: 'Uniformat code', description: 'Uniformat assembly classification', example: 'B2010' },
    ],
    coordinationResponsibilities: [
      { checkWith: ['STR'], description: 'Verify wall/column alignment at grid intersections', frequency: 'every_drop', priority: 'critical' },
      { checkWith: ['MECH', 'ELEC'], description: 'Confirm ceiling heights accommodate MEP routing', frequency: 'every_drop', priority: 'high' },
      { checkWith: ['FP'], description: 'Verify fire-rated assembly continuity', frequency: 'weekly', priority: 'critical' },
    ],
    modelContentByLOD: {
      200: ['Exterior walls', 'Interior partitions (major)', 'Floor slabs', 'Roof outline', 'Doors (generic)', 'Windows (generic)'],
      300: ['All walls with correct types', 'Doors with hardware', 'Windows with glazing', 'Ceilings', 'Stairs', 'Finishes'],
      350: ['Millwork', 'Signage', 'Accessories', 'Detailed assemblies'],
      400: ['Fabrication-ready geometry', 'Exact product models'],
    },
    qaChecklist: [
      { id: 'ARC-QA-01', description: 'All rooms have Room_Name and Room_Number', category: 'metadata', automated: true },
      { id: 'ARC-QA-02', description: 'Fire-rated walls have Fire_Rating parameter', category: 'compliance', automated: true },
      { id: 'ARC-QA-03', description: 'Doors hosted in walls (no unhosted doors)', category: 'geometry', automated: true },
      { id: 'ARC-QA-04', description: 'Floor plans match between model and drawings', category: 'coordination', automated: false },
      { id: 'ARC-QA-05', description: 'Ceiling heights per room match specification', category: 'compliance', automated: true },
    ],
  },

  // ── STRUCTURAL ──────────────────────────────────────────────────────────
  {
    code: 'STR',
    fullName: 'Structural',
    internalDiscipline: 'structural',
    csiDivisions: ['03', '04', '05'],
    requiredDeliverables: [
      { id: 'STR-M01', name: 'Structural Model', type: 'model', required: true, description: 'Foundations, columns, beams, slabs, walls, bracing' },
      { id: 'STR-D01', name: 'Foundation Plans', type: 'drawing', required: true, description: 'Foundation layout, footings, piles' },
      { id: 'STR-D02', name: 'Framing Plans', type: 'drawing', required: true, description: 'Floor framing at each level' },
      { id: 'STR-C01', name: 'Structural Calculations', type: 'calculation', required: true, description: 'Load calculations per CSA A23.3 / S16' },
      { id: 'STR-S01', name: 'Specifications (Div 03-05)', type: 'specification', required: true, description: 'Concrete, masonry, metals specs' },
    ],
    metadataRequirements: [
      { parameter: 'Level', required: true, validationRule: 'Must reference project level', description: 'Level assignment', example: 'Level 2' },
      { parameter: 'Material', required: true, validationRule: 'Not "By Category" or "Default"', description: 'Structural material', example: '30 MPa Concrete' },
      { parameter: 'Mark', required: true, validationRule: 'Unique per element type per level', description: 'Element mark/tag', example: 'C-12' },
      { parameter: 'Concrete_Strength', required: true, validationRule: 'Numeric MPa value', description: 'Concrete compressive strength', example: '30' },
      { parameter: 'Rebar_Grade', required: true, validationRule: 'CSA G30.18 grade', description: 'Reinforcement grade', example: '400R' },
    ],
    coordinationResponsibilities: [
      { checkWith: ['ARC'], description: 'Verify grid alignment with architectural plans', frequency: 'every_drop', priority: 'critical' },
      { checkWith: ['MECH', 'PLBG', 'FP', 'ELEC'], description: 'Approve all penetrations through structural members', frequency: 'every_drop', priority: 'critical' },
    ],
    modelContentByLOD: {
      200: ['Foundations (outline)', 'Columns', 'Primary beams', 'Slabs'],
      300: ['All structural members sized', 'Connections (generic)', 'Openings with sleeves'],
      350: ['Rebar layout', 'Embed plates', 'Detailed connections'],
      400: ['Shop drawing geometry', 'Fabrication details'],
    },
    qaChecklist: [
      { id: 'STR-QA-01', description: 'All members have Material (not "By Category")', category: 'metadata', automated: true },
      { id: 'STR-QA-02', description: 'Columns span full floor-to-floor height', category: 'geometry', automated: true },
      { id: 'STR-QA-03', description: 'Grid alignment matches architectural grid ±25mm', category: 'coordination', automated: true },
      { id: 'STR-QA-04', description: 'All penetrations have sleeves modeled', category: 'coordination', automated: true },
    ],
  },

  // ── MECHANICAL (HVAC) ───────────────────────────────────────────────────
  {
    code: 'MECH',
    fullName: 'Mechanical (HVAC)',
    internalDiscipline: 'mechanical',
    csiDivisions: ['23'],
    requiredDeliverables: [
      { id: 'MECH-M01', name: 'HVAC Model', type: 'model', required: true, description: 'Ductwork, equipment, diffusers, dampers' },
      { id: 'MECH-D01', name: 'HVAC Plans', type: 'drawing', required: true, description: 'Duct layout per level' },
      { id: 'MECH-S01', name: 'Specifications (Div 23)', type: 'specification', required: true, description: 'HVAC equipment and ductwork specs' },
      { id: 'MECH-SC01', name: 'Equipment Schedule', type: 'schedule', required: true, description: 'AHUs, RTUs, VAVs, fans with capacities' },
    ],
    metadataRequirements: [
      { parameter: 'SystemType', required: true, validationRule: 'Non-empty system assignment', description: 'HVAC system name', example: 'Supply Air - AHU-1' },
      { parameter: 'Insulation_Type', required: true, validationRule: 'Spec reference or N/A', description: 'Insulation specification', example: 'Fiberglass 25mm' },
      { parameter: 'Level', required: true, validationRule: 'Must reference project level', description: 'Level assignment', example: 'Level 1' },
    ],
    coordinationResponsibilities: [
      { checkWith: ['STR'], description: 'All duct penetrations through structure approved', frequency: 'every_drop', priority: 'critical' },
      { checkWith: ['ELEC'], description: 'Vertical separation hierarchy (elec above mech)', frequency: 'every_drop', priority: 'high' },
      { checkWith: ['ARC'], description: 'Ductwork fits within ceiling plenum', frequency: 'every_drop', priority: 'high' },
    ],
    modelContentByLOD: {
      200: ['Major duct runs (mains)', 'Large equipment'],
      300: ['All ductwork sized', 'Fittings', 'Diffusers', 'Insulation envelope', 'Equipment with clearances'],
      350: ['Hangers/supports', 'Access doors', 'Flex connections'],
      400: ['Fabrication spool drawings', 'Exact fitting geometry'],
    },
    qaChecklist: [
      { id: 'MECH-QA-01', description: 'All ducts have SystemType assigned', category: 'metadata', automated: true },
      { id: 'MECH-QA-02', description: 'Insulation modeled on all supply/return mains', category: 'geometry', automated: true },
      { id: 'MECH-QA-03', description: 'Equipment has service clearance zones', category: 'compliance', automated: true },
    ],
  },

  // ── PLUMBING ─────────────────────────────────────────────────────────────
  {
    code: 'PLBG',
    fullName: 'Plumbing',
    internalDiscipline: 'plumbing',
    csiDivisions: ['22'],
    requiredDeliverables: [
      { id: 'PLBG-M01', name: 'Plumbing Model', type: 'model', required: true, description: 'Piping, fixtures, drains, vents' },
      { id: 'PLBG-D01', name: 'Plumbing Plans', type: 'drawing', required: true, description: 'Pipe layout per level' },
      { id: 'PLBG-S01', name: 'Specifications (Div 22)', type: 'specification', required: true, description: 'Piping materials and fixtures' },
    ],
    metadataRequirements: [
      { parameter: 'SystemType', required: true, validationRule: 'Non-empty', description: 'Plumbing system', example: 'Domestic Hot Water' },
      { parameter: 'Pipe_Size', required: true, validationRule: 'Numeric diameter', description: 'Nominal pipe size', example: '50mm' },
      { parameter: 'Level', required: true, validationRule: 'Must reference project level', description: 'Level assignment', example: 'Level 1' },
    ],
    coordinationResponsibilities: [
      { checkWith: ['STR'], description: 'Pipe penetrations approved by structural', frequency: 'every_drop', priority: 'critical' },
      { checkWith: ['MECH'], description: 'No conflicts with ductwork routing', frequency: 'every_drop', priority: 'high' },
    ],
    modelContentByLOD: {
      200: ['Major pipe runs', 'Risers', 'Large fixtures'],
      300: ['All piping sized', 'Fittings', 'Fixtures', 'Insulation'],
      350: ['Hangers', 'Sleeves', 'Access panels'],
      400: ['Spool drawings', 'Prefab assemblies'],
    },
    qaChecklist: [
      { id: 'PLBG-QA-01', description: 'All pipes have SystemType', category: 'metadata', automated: true },
      { id: 'PLBG-QA-02', description: 'Drain slopes verified ≥ code minimum', category: 'compliance', automated: true },
    ],
  },

  // ── FIRE PROTECTION ─────────────────────────────────────────────────────
  {
    code: 'FP',
    fullName: 'Fire Protection',
    internalDiscipline: 'fire_protection',
    csiDivisions: ['21'],
    requiredDeliverables: [
      { id: 'FP-M01', name: 'Fire Protection Model', type: 'model', required: true, description: 'Sprinkler piping, heads, standpipes, FHCs' },
      { id: 'FP-D01', name: 'FP Plans', type: 'drawing', required: true, description: 'Sprinkler layout per level' },
      { id: 'FP-S01', name: 'Specifications (Div 21)', type: 'specification', required: true, description: 'FP system specs per NFPA 13' },
      { id: 'FP-C01', name: 'Hydraulic Calculations', type: 'calculation', required: true, description: 'Sprinkler hydraulic calcs per NFPA 13' },
    ],
    metadataRequirements: [
      { parameter: 'SystemType', required: true, validationRule: 'Non-empty', description: 'FP system', example: 'Wet Sprinkler' },
      { parameter: 'Coverage_Area', required: true, validationRule: 'Numeric m²', description: 'Sprinkler coverage area', example: '12.0' },
      { parameter: 'Level', required: true, validationRule: 'Must reference project level', description: 'Level assignment', example: 'Level 1' },
    ],
    coordinationResponsibilities: [
      { checkWith: ['STR'], description: 'FP penetrations through structure approved', frequency: 'every_drop', priority: 'critical' },
      { checkWith: ['ARC'], description: 'Sprinkler-to-ceiling clearance per NFPA 13', frequency: 'every_drop', priority: 'critical' },
    ],
    modelContentByLOD: {
      200: ['Main risers', 'Branch mains'],
      300: ['All piping sized', 'Sprinkler heads located', 'FHC locations'],
      350: ['Hangers', 'Firestop locations'],
      400: ['Fabrication geometry'],
    },
    qaChecklist: [
      { id: 'FP-QA-01', description: 'All sprinklers have Coverage_Area', category: 'metadata', automated: true },
      { id: 'FP-QA-02', description: 'Sprinkler-to-ceiling distance within NFPA range', category: 'compliance', automated: true },
    ],
  },

  // ── ELECTRICAL ──────────────────────────────────────────────────────────
  {
    code: 'ELEC',
    fullName: 'Electrical',
    internalDiscipline: 'electrical',
    csiDivisions: ['26', '27', '28'],
    requiredDeliverables: [
      { id: 'ELEC-M01', name: 'Electrical Model', type: 'model', required: true, description: 'Conduit, cable trays, panels, switchgear, fixtures' },
      { id: 'ELEC-D01', name: 'Electrical Plans', type: 'drawing', required: true, description: 'Power and lighting layout per level' },
      { id: 'ELEC-S01', name: 'Specifications (Div 26-28)', type: 'specification', required: true, description: 'Electrical equipment and wiring specs' },
      { id: 'ELEC-SC01', name: 'Panel Schedule', type: 'schedule', required: true, description: 'Panel board schedules with circuits' },
    ],
    metadataRequirements: [
      { parameter: 'SystemType', required: true, validationRule: 'Non-empty', description: 'Electrical system', example: 'Power - Panel LP-1A' },
      { parameter: 'Voltage', required: true, validationRule: 'Standard voltage value', description: 'Circuit voltage', example: '120/208V' },
      { parameter: 'Level', required: true, validationRule: 'Must reference project level', description: 'Level assignment', example: 'Level 1' },
    ],
    coordinationResponsibilities: [
      { checkWith: ['STR'], description: 'Conduit penetrations through structure approved', frequency: 'every_drop', priority: 'critical' },
      { checkWith: ['MECH'], description: 'Electrical above mechanical in shared corridors', frequency: 'every_drop', priority: 'high' },
      { checkWith: ['ARC'], description: 'Panel front clearance per CEC 26-402', frequency: 'every_drop', priority: 'critical' },
    ],
    modelContentByLOD: {
      200: ['Major conduit runs', 'Panel locations', 'Large equipment'],
      300: ['All conduit/tray sized', 'Fixtures located', 'Panels with clearance zones'],
      350: ['Supports', 'Junction boxes', 'Device connections'],
      400: ['As-built geometry'],
    },
    qaChecklist: [
      { id: 'ELEC-QA-01', description: 'All conduit/tray have SystemType', category: 'metadata', automated: true },
      { id: 'ELEC-QA-02', description: 'Panel working clearance zones modeled', category: 'compliance', automated: true },
    ],
  },

  // ── BIM / VDC COORDINATION ──────────────────────────────────────────────
  {
    code: 'BIM_VDC',
    fullName: 'BIM / VDC Coordination',
    internalDiscipline: 'other',
    csiDivisions: [],
    requiredDeliverables: [
      { id: 'BIM-R01', name: 'BIM Execution Plan', type: 'report', required: true, description: 'Project BEP per ISO 19650' },
      { id: 'BIM-R02', name: 'Clash Detection Report', type: 'report', required: true, description: 'Weekly clash report per SOP' },
      { id: 'BIM-R03', name: 'Model Audit Report', type: 'report', required: true, description: 'Model quality audit results' },
    ],
    metadataRequirements: [],
    coordinationResponsibilities: [
      { checkWith: ['ARC', 'STR', 'MECH', 'PLBG', 'FP', 'ELEC'], description: 'Coordinate all disciplines — federated model assembly', frequency: 'every_drop', priority: 'critical' },
    ],
    modelContentByLOD: {
      200: ['Federated coordination model'],
      300: ['Full coordination model with all disciplines'],
      350: ['Construction-ready coordination model'],
      400: ['As-built coordination model'],
    },
    qaChecklist: [
      { id: 'BIM-QA-01', description: 'All discipline models loaded in federation', category: 'coordination', automated: true },
      { id: 'BIM-QA-02', description: 'Naming conventions per BEP', category: 'metadata', automated: true },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// LOOKUP HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const defMap = new Map<DisciplineCode, DisciplineDefinition>();
for (const d of DISCIPLINE_DEFINITIONS) defMap.set(d.code, d);

export function getDisciplineDefinition(code: DisciplineCode): DisciplineDefinition | undefined {
  return defMap.get(code);
}

export function getDisciplineByInternal(disc: Discipline): DisciplineDefinition | undefined {
  return DISCIPLINE_DEFINITIONS.find(d => d.internalDiscipline === disc);
}

export function getAllDisciplineCodes(): DisciplineCode[] {
  return DISCIPLINE_DEFINITIONS.map(d => d.code);
}

export function csiDivisionToDiscipline(division: string): DisciplineCode | null {
  for (const def of DISCIPLINE_DEFINITIONS) {
    if (def.csiDivisions.includes(division)) return def.code;
  }
  return null;
}
