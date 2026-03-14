/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  PARAMETRIC BUILDING ELEMENTS — Real 3D BIM Object Library
 *  Creates geometry-complete building elements with:
 *  - Multi-layer wall assemblies (structure + insulation + finish)
 *  - Door/window openings that subtract from host walls
 *  - Structural profiles (W-sections, HSS, concrete columns)
 *  - Slab/floor plates with arbitrary polygon boundaries
 *  - Roof elements with slopes
 *  - MEP elements (ducts, pipes, cable trays) with fittings
 *  All dimensions in metres. Z-up coordinate system.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import {
  type Vec2, type Vec3, type Mesh, type Profile2D, type SerializedMesh, type AABB,
  vec2, vec3, v3add, v3sub, v3scale, v3normalize, v3cross, v3len,
  rectProfile, circleProfile, iProfile, addRectHole, profileArea,
  extrudeProfile, sweepAlongPath, createBox, createCylinder,
  mergeMeshes, transformMesh, meshBoundingBox, meshVolume, meshSurfaceArea, meshLateralArea,
  serializeMesh, mat4Translation, mat4RotationZ, mat4RotationY, mat4Mul,
} from './geometry-kernel';

// ═══════════════════════════════════════════════════════════════════════════════
//  MATERIAL LAYERS
// ═══════════════════════════════════════════════════════════════════════════════

export interface MaterialLayer {
  name: string;           // e.g. "Gypsum Board", "Steel Stud", "Batt Insulation"
  thickness: number;      // metres
  material: string;       // material identifier
  isStructural: boolean;
  density?: number;       // kg/m³ for weight calculation
}

export interface WallAssembly {
  id: string;
  name: string;             // e.g. "Exterior Wall Type 1"
  layers: MaterialLayer[];
  totalThickness: number;   // computed sum of layers
  fireRating?: string;      // e.g. "1 HR"
  acousticRating?: number;  // STC rating
}

/** Common wall assemblies */
export const WALL_ASSEMBLIES: Record<string, WallAssembly> = {
  'EXT_WALL_BRICK': {
    id: 'EXT_WALL_BRICK', name: 'Exterior Wall - Brick Veneer',
    layers: [
      { name: 'Face Brick', thickness: 0.090, material: 'Brick', isStructural: false, density: 1920 },
      { name: 'Air Cavity', thickness: 0.025, material: 'Air', isStructural: false },
      { name: 'Rigid Insulation', thickness: 0.050, material: 'XPS Insulation', isStructural: false, density: 35 },
      { name: 'Sheathing', thickness: 0.012, material: 'OSB', isStructural: false, density: 650 },
      { name: 'Steel Stud', thickness: 0.092, material: 'Steel', isStructural: true, density: 7850 },
      { name: 'Batt Insulation', thickness: 0.089, material: 'Fibreglass Batt', isStructural: false, density: 12 },
      { name: 'Vapour Barrier', thickness: 0.001, material: 'Polyethylene', isStructural: false },
      { name: 'Gypsum Board', thickness: 0.016, material: 'Gypsum', isStructural: false, density: 800 },
    ],
    totalThickness: 0.375, fireRating: '1 HR', acousticRating: 55,
  },
  'EXT_WALL_METAL': {
    id: 'EXT_WALL_METAL', name: 'Exterior Wall - Metal Panel',
    layers: [
      { name: 'Metal Panel', thickness: 0.025, material: 'Aluminum', isStructural: false, density: 2700 },
      { name: 'Air Cavity', thickness: 0.025, material: 'Air', isStructural: false },
      { name: 'Rigid Insulation', thickness: 0.075, material: 'Mineral Wool', isStructural: false, density: 130 },
      { name: 'Steel Stud', thickness: 0.152, material: 'Steel', isStructural: true, density: 7850 },
      { name: 'Batt Insulation', thickness: 0.150, material: 'Fibreglass Batt', isStructural: false, density: 12 },
      { name: 'Gypsum Board', thickness: 0.016, material: 'Gypsum', isStructural: false, density: 800 },
    ],
    totalThickness: 0.443, fireRating: '2 HR',
  },
  'INT_WALL_STANDARD': {
    id: 'INT_WALL_STANDARD', name: 'Interior Partition - Standard',
    layers: [
      { name: 'Gypsum Board', thickness: 0.016, material: 'Gypsum', isStructural: false, density: 800 },
      { name: 'Steel Stud', thickness: 0.092, material: 'Steel', isStructural: true, density: 7850 },
      { name: 'Batt Insulation', thickness: 0.089, material: 'Fibreglass Batt', isStructural: false, density: 12 },
      { name: 'Gypsum Board', thickness: 0.016, material: 'Gypsum', isStructural: false, density: 800 },
    ],
    totalThickness: 0.213, fireRating: '1 HR', acousticRating: 45,
  },
  'INT_WALL_FIRE': {
    id: 'INT_WALL_FIRE', name: 'Interior Partition - Fire Rated',
    layers: [
      { name: 'Type X Gypsum', thickness: 0.016, material: 'Type X Gypsum', isStructural: false, density: 800 },
      { name: 'Type X Gypsum', thickness: 0.016, material: 'Type X Gypsum', isStructural: false, density: 800 },
      { name: 'Steel Stud', thickness: 0.092, material: 'Steel', isStructural: true, density: 7850 },
      { name: 'Mineral Wool', thickness: 0.089, material: 'Mineral Wool', isStructural: false, density: 130 },
      { name: 'Type X Gypsum', thickness: 0.016, material: 'Type X Gypsum', isStructural: false, density: 800 },
      { name: 'Type X Gypsum', thickness: 0.016, material: 'Type X Gypsum', isStructural: false, density: 800 },
    ],
    totalThickness: 0.245, fireRating: '2 HR', acousticRating: 55,
  },
  'CMU_WALL': {
    id: 'CMU_WALL', name: 'CMU Block Wall',
    layers: [
      { name: 'CMU Block', thickness: 0.200, material: 'Concrete Masonry', isStructural: true, density: 2100 },
    ],
    totalThickness: 0.200,
  },
  'CONCRETE_WALL': {
    id: 'CONCRETE_WALL', name: 'Cast-in-Place Concrete Wall',
    layers: [
      { name: 'Concrete', thickness: 0.300, material: 'Concrete', isStructural: true, density: 2400 },
    ],
    totalThickness: 0.300, fireRating: '3 HR',
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
//  BIM SOLID ELEMENT — Base type for all 3D building elements
// ═══════════════════════════════════════════════════════════════════════════════

// ── LOD Levels per BIM Forum spec ───────────────────────────────────────
export type LODLevel = 100 | 200 | 300 | 350 | 400 | 500;

// ── Construction Phase assignment ───────────────────────────────────────
export interface PhaseAssignment {
  phaseId: string;             // e.g. "1.3" (WBS code)
  phaseName: string;           // e.g. "Foundations & Substructure"
  createdPhase?: string;       // phase when element is built
  demolishedPhase?: string;    // phase when element is removed (reno/demo)
}

// ── Workset for discipline isolation ────────────────────────────────────
export interface WorksetInfo {
  worksetId: string;
  worksetName: string;         // e.g. "Structural", "Mechanical", "Arch - Interior"
  discipline: 'Architectural' | 'Structural' | 'Mechanical' | 'Electrical' | 'Plumbing' | 'Fire Protection' | 'Civil';
  isEditable: boolean;
}

// ── Revision tracking ──────────────────────────────────────────────────
export interface RevisionInfo {
  revisionNumber: number;
  revisionId: string;
  action: 'added' | 'modified' | 'deleted' | 'unchanged';
  previousState?: string;      // serialized prior state for diffing
  modifiedAt?: string;         // ISO timestamp
  modifiedBy?: string;
}

// ── Rebar data on concrete elements ────────────────────────────────────
export interface RebarInfo {
  totalWeight: number;          // kg
  density: number;              // kg/m³
  bars: RebarBar[];
  coverTop: number;             // mm
  coverBottom: number;          // mm
  coverSide: number;            // mm
}

export interface RebarBar {
  id: string;
  designation: string;          // "10M", "15M", "20M", etc. (CSA G30.18)
  diameter: number;             // mm
  length: number;               // mm
  spacing: number;              // mm (0 = individual bar)
  count: number;
  direction: 'longitudinal' | 'transverse' | 'stirrup' | 'tie' | 'spiral';
  layer: 'top' | 'bottom' | 'side' | 'core';
}

// ── Steel connection detail ────────────────────────────────────────────
export interface ConnectionDetail {
  id: string;
  type: 'shear_tab' | 'moment_end_plate' | 'clip_angle' | 'base_plate' | 'splice' | 'brace_gusset';
  connectedElementIds: string[];
  plates: ConnectionPlate[];
  bolts: BoltGroup[];
  welds: WeldLine[];
}

export interface ConnectionPlate {
  id: string;
  name: string;
  width: number;                // mm
  height: number;               // mm
  thickness: number;            // mm
  material: string;             // e.g. "A36", "350W"
  position: Vec3;
  rotation: number;
  mesh?: Mesh;
}

export interface BoltGroup {
  id: string;
  boltDiameter: number;        // mm (e.g. 19.05 for 3/4")
  boltGrade: string;            // "A325", "A490"
  rows: number;
  columns: number;
  rowSpacing: number;           // mm
  colSpacing: number;           // mm
  position: Vec3;
  meshes?: Mesh[];
}

export interface WeldLine {
  id: string;
  type: 'fillet' | 'groove' | 'plug';
  size: number;                 // mm (leg size for fillet)
  length: number;               // mm
  start: Vec3;
  end: Vec3;
}

export interface BIMSolid {
  id: string;
  type: string;               // 'Wall', 'Column', 'Beam', 'Slab', 'Door', 'Window', etc.
  name: string;
  category: 'Architectural' | 'Structural' | 'MEP';
  storey: string;
  elevation: number;          // metres above datum

  // Geometry
  mesh: Mesh;                 // full 3D triangle mesh
  serialized?: SerializedMesh; // computed on demand for storage/viewer
  boundingBox: AABB;
  profile?: Profile2D;        // cross-section profile (for walls, beams, etc.)

  // Quantities derived from geometry
  quantities: {
    volume: number;            // m³
    surfaceArea: number;       // m²
    lateralArea: number;       // m² (wall face area, excluding top/bottom)
    length?: number;           // m (for linear elements)
    width?: number;            // m
    height?: number;           // m
    thickness?: number;        // m
    perimeter?: number;        // m (for slabs)
    weight?: number;           // kg (if density known)
    profileArea?: number;      // m² (cross-section area)
  };

  // Material
  material: string;
  assembly?: WallAssembly;     // multi-layer assembly (for walls)
  layers?: MaterialLayer[];

  // Spatial relationships
  hostId?: string;             // parent element (wall hosts door/window)
  hostedIds: string[];         // children (doors/windows in this wall)
  connectedIds: string[];      // connected elements (wall-to-wall, beam-to-column)

  // Positioning
  origin: Vec3;                // placement origin in world coords
  rotation: number;            // yaw rotation in radians (around Z-axis)

  // IFC mapping
  ifcClass: string;            // IFCWALL, IFCSLAB, etc.
  ifcGuid: string;

  // Provenance
  source: 'ai_modeled' | 'ifc_imported' | 'dwg_imported' | 'user_placed' | 'seeded';

  // ── Phase 2 properties ───────────────────────────────────────────────
  lod?: LODLevel;              // LOD 100-500 per BIM Forum spec
  phase?: PhaseAssignment;     // construction phase assignment
  workset?: WorksetInfo;       // workset / discipline isolation
  revision?: RevisionInfo;     // revision tracking
  rebar?: RebarInfo;           // reinforcement data (concrete elements)
  connections?: ConnectionDetail[]; // steel connection details
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WALL ELEMENT — Parametric wall with layers and openings
// ═══════════════════════════════════════════════════════════════════════════════

export interface WallOpeningDef {
  type: 'door' | 'window';
  id: string;
  name: string;
  position: number;        // distance along wall from start (metres)
  width: number;           // metres
  height: number;          // metres
  sillHeight: number;      // metres above floor (0 for doors)
  material?: string;
}

export interface WallParams {
  id: string;
  name: string;
  start: Vec2;              // start point in plan (metres)
  end: Vec2;                // end point in plan (metres)
  height: number;           // storey height (metres)
  assembly: WallAssembly | string;  // wall assembly or key into WALL_ASSEMBLIES
  storey: string;
  elevation: number;        // base elevation (metres)
  openings?: WallOpeningDef[];
  isExterior?: boolean;
  source?: BIMSolid['source'];
}

export function createWall(params: WallParams): { wall: BIMSolid; openings: BIMSolid[] } {
  const assembly = typeof params.assembly === 'string'
    ? WALL_ASSEMBLIES[params.assembly] || WALL_ASSEMBLIES['INT_WALL_STANDARD']
    : params.assembly;

  const dx = params.end.x - params.start.x;
  const dy = params.end.y - params.start.y;
  const wallLength = Math.sqrt(dx * dx + dy * dy);
  const rotation = Math.atan2(dy, dx);
  const thickness = assembly.totalThickness;
  const origin = vec3(params.start.x, params.start.y, params.elevation);

  // Build wall profile (length × height) with openings cut out
  let wallProfile: Profile2D = {
    outer: [vec2(0, 0), vec2(wallLength, 0), vec2(wallLength, params.height), vec2(0, params.height)],
    holes: [],
  };

  // Cut openings
  const openingElements: BIMSolid[] = [];
  for (const op of params.openings || []) {
    const cx = op.position + op.width / 2;
    const cy = op.sillHeight + op.height / 2;
    wallProfile = addRectHole(wallProfile, cx, cy, op.width, op.height);

    // Create the door/window element
    const openingMesh = createBox(op.width, op.height, thickness * 0.8);
    const openingOrigin = vec3(
      params.start.x + Math.cos(rotation) * (op.position + op.width / 2),
      params.start.y + Math.sin(rotation) * (op.position + op.width / 2),
      params.elevation + op.sillHeight + op.height / 2,
    );

    const placedOpening = transformMesh(openingMesh,
      mat4Mul(mat4Translation(openingOrigin), mat4RotationZ(rotation))
    );

    openingElements.push({
      id: op.id,
      type: op.type === 'door' ? 'Door' : 'Window',
      name: op.name,
      category: 'Architectural',
      storey: params.storey,
      elevation: params.elevation,
      mesh: placedOpening,
      boundingBox: meshBoundingBox(placedOpening),
      quantities: {
        volume: op.width * op.height * thickness * 0.8,
        surfaceArea: 2 * (op.width * op.height + op.width * thickness + op.height * thickness),
        lateralArea: op.width * op.height,
        width: op.width,
        height: op.height,
        thickness: thickness * 0.8,
      },
      material: op.material || (op.type === 'door' ? 'Wood' : 'Glass'),
      hostId: params.id,
      hostedIds: [],
      connectedIds: [],
      origin: openingOrigin,
      rotation,
      ifcClass: op.type === 'door' ? 'IFCDOOR' : 'IFCWINDOW',
      ifcGuid: generateBIMGuid(),
      source: params.source || 'ai_modeled',
    });
  }

  // Extrude wall profile to get the wall mesh (extrude along thickness direction)
  const wallMesh2D = extrudeProfile(wallProfile, thickness, vec3(0, 0, 1));

  // Transform: rotate profile so it's vertical (length along X, height along Z, thickness along Y)
  // Then rotate to match wall direction and translate to start point
  const transform = mat4Mul(
    mat4Translation(origin),
    mat4RotationZ(rotation),
  );
  const wallMesh = transformMesh(wallMesh2D, transform);

  const vol = meshVolume(wallMesh);
  const surfArea = meshSurfaceArea(wallMesh);
  const latArea = meshLateralArea(wallMesh);

  // Calculate weight from layer densities
  let totalWeight = 0;
  for (const layer of assembly.layers) {
    if (layer.density) {
      const layerVolume = wallLength * params.height * layer.thickness;
      totalWeight += layerVolume * layer.density;
    }
  }

  const wall: BIMSolid = {
    id: params.id,
    type: params.isExterior ? 'Exterior Wall' : 'Interior Wall',
    name: params.name,
    category: 'Architectural',
    storey: params.storey,
    elevation: params.elevation,
    mesh: wallMesh,
    boundingBox: meshBoundingBox(wallMesh),
    profile: wallProfile,
    quantities: {
      volume: vol,
      surfaceArea: surfArea,
      lateralArea: latArea,
      length: wallLength,
      height: params.height,
      thickness,
      weight: totalWeight > 0 ? totalWeight : undefined,
      profileArea: profileArea(wallProfile),
    },
    material: assembly.layers.find(l => l.isStructural)?.material || assembly.layers[0]?.material || 'Unknown',
    assembly,
    layers: assembly.layers,
    hostId: undefined,
    hostedIds: openingElements.map(o => o.id),
    connectedIds: [],
    origin,
    rotation,
    ifcClass: 'IFCWALL',
    ifcGuid: generateBIMGuid(),
    source: params.source || 'ai_modeled',
  };

  return { wall, openings: openingElements };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COLUMN ELEMENT
// ═══════════════════════════════════════════════════════════════════════════════

export interface ColumnParams {
  id: string;
  name: string;
  center: Vec2;             // plan position
  width: number;            // X dimension (metres)
  depth: number;            // Y dimension (metres)
  height: number;           // floor-to-floor (metres)
  storey: string;
  elevation: number;
  shape: 'rectangular' | 'circular' | 'w-section';
  material: string;         // 'Concrete', 'Steel', etc.
  rotation?: number;
  // For steel W-sections:
  flangeWidth?: number;
  webThickness?: number;
  flangeThickness?: number;
  source?: BIMSolid['source'];
}

export function createColumn(params: ColumnParams): BIMSolid {
  let mesh: Mesh;
  let profileDef: Profile2D | undefined;

  if (params.shape === 'circular') {
    const radius = Math.max(params.width, params.depth) / 2;
    mesh = createCylinder(radius, params.height, 24);
    profileDef = circleProfile(radius, 24);
  } else if (params.shape === 'w-section' && params.flangeWidth && params.webThickness && params.flangeThickness) {
    profileDef = iProfile(params.flangeWidth, params.depth, params.webThickness, params.flangeThickness);
    mesh = extrudeProfile(profileDef, params.height);
  } else {
    profileDef = rectProfile(params.width, params.depth);
    mesh = createBox(params.width, params.height, params.depth);
  }

  const origin = vec3(params.center.x, params.center.y, params.elevation);
  const rot = params.rotation || 0;
  const transform = mat4Mul(mat4Translation(origin), mat4RotationZ(rot));
  mesh = transformMesh(mesh, transform);

  const vol = meshVolume(mesh);

  return {
    id: params.id,
    type: 'Column',
    name: params.name,
    category: 'Structural',
    storey: params.storey,
    elevation: params.elevation,
    mesh,
    boundingBox: meshBoundingBox(mesh),
    profile: profileDef,
    quantities: {
      volume: vol,
      surfaceArea: meshSurfaceArea(mesh),
      lateralArea: meshLateralArea(mesh),
      width: params.width,
      height: params.height,
      thickness: params.depth,
      profileArea: profileDef ? profileArea(profileDef) : params.width * params.depth,
      weight: params.material === 'Concrete' ? vol * 2400 : params.material === 'Steel' ? vol * 7850 : undefined,
    },
    material: params.material,
    hostedIds: [],
    connectedIds: [],
    origin,
    rotation: rot,
    ifcClass: 'IFCCOLUMN',
    ifcGuid: generateBIMGuid(),
    source: params.source || 'ai_modeled',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BEAM ELEMENT
// ═══════════════════════════════════════════════════════════════════════════════

export interface BeamParams {
  id: string;
  name: string;
  start: Vec3;              // start point in 3D
  end: Vec3;                // end point in 3D
  width: number;            // cross-section width
  depth: number;            // cross-section depth
  storey: string;
  elevation: number;
  shape: 'rectangular' | 'w-section' | 'circular';
  material: string;
  flangeWidth?: number;
  webThickness?: number;
  flangeThickness?: number;
  source?: BIMSolid['source'];
}

export function createBeam(params: BeamParams): BIMSolid {
  const dir = v3sub(params.end, params.start);
  const beamLength = v3len(dir);
  const rotation = Math.atan2(dir.y, dir.x);

  let profileDef: Profile2D;
  if (params.shape === 'w-section' && params.flangeWidth && params.webThickness && params.flangeThickness) {
    profileDef = iProfile(params.flangeWidth, params.depth, params.webThickness, params.flangeThickness);
  } else if (params.shape === 'circular') {
    profileDef = circleProfile(Math.max(params.width, params.depth) / 2, 24);
  } else {
    profileDef = rectProfile(params.width, params.depth);
  }

  let mesh = extrudeProfile(profileDef, beamLength, v3normalize(dir));
  const transform = mat4Translation(params.start);
  mesh = transformMesh(mesh, transform);

  const vol = meshVolume(mesh);

  return {
    id: params.id,
    type: 'Beam',
    name: params.name,
    category: 'Structural',
    storey: params.storey,
    elevation: params.elevation,
    mesh,
    boundingBox: meshBoundingBox(mesh),
    profile: profileDef,
    quantities: {
      volume: vol,
      surfaceArea: meshSurfaceArea(mesh),
      lateralArea: meshLateralArea(mesh),
      length: beamLength,
      width: params.width,
      height: params.depth,
      profileArea: profileArea(profileDef),
      weight: params.material === 'Concrete' ? vol * 2400 : params.material === 'Steel' ? vol * 7850 : undefined,
    },
    material: params.material,
    hostedIds: [],
    connectedIds: [],
    origin: params.start,
    rotation,
    ifcClass: 'IFCBEAM',
    ifcGuid: generateBIMGuid(),
    source: params.source || 'ai_modeled',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SLAB / FLOOR PLATE
// ═══════════════════════════════════════════════════════════════════════════════

export interface SlabParams {
  id: string;
  name: string;
  boundary: Vec2[];         // polygon boundary in plan (metres)
  thickness: number;        // metres
  storey: string;
  elevation: number;        // top of slab elevation
  material: string;
  openings?: { boundary: Vec2[] }[];  // penetrations
  isRoof?: boolean;
  slope?: number;           // degrees for roof slabs
  source?: BIMSolid['source'];
}

export function createSlab(params: SlabParams): BIMSolid {
  const profile: Profile2D = {
    outer: params.boundary,
    holes: (params.openings || []).map(o => o.boundary),
  };

  // Extrude downward from top of slab
  const slabBottom = params.elevation - params.thickness;
  let mesh = extrudeProfile(profile, params.thickness, vec3(0, 0, 1));
  mesh = transformMesh(mesh, mat4Translation(vec3(0, 0, slabBottom)));

  // If roof with slope, apply tilt
  if (params.isRoof && params.slope && params.slope > 0) {
    const slopeRad = (params.slope * Math.PI) / 180;
    const bb = meshBoundingBox(mesh);
    const center = vec3((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, bb.min.z);
    mesh = transformMesh(mesh,
      mat4Mul(
        mat4Translation(center),
        mat4Mul(mat4RotationY(slopeRad), mat4Translation(v3scale(center, -1)))
      )
    );
  }

  const vol = meshVolume(mesh);
  const area = Math.abs(profileArea(profile));

  // Compute perimeter
  let perimeter = 0;
  for (let i = 0; i < params.boundary.length; i++) {
    const j = (i + 1) % params.boundary.length;
    const dx = params.boundary[j].x - params.boundary[i].x;
    const dy = params.boundary[j].y - params.boundary[i].y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }

  return {
    id: params.id,
    type: params.isRoof ? 'Roof Slab' : 'Floor Slab',
    name: params.name,
    category: 'Structural',
    storey: params.storey,
    elevation: params.elevation,
    mesh,
    boundingBox: meshBoundingBox(mesh),
    profile,
    quantities: {
      volume: vol,
      surfaceArea: meshSurfaceArea(mesh),
      lateralArea: perimeter * params.thickness,
      thickness: params.thickness,
      perimeter,
      profileArea: area,
      weight: params.material === 'Concrete' ? vol * 2400 : undefined,
    },
    material: params.material,
    hostedIds: [],
    connectedIds: [],
    origin: vec3(0, 0, params.elevation),
    rotation: 0,
    ifcClass: params.isRoof ? 'IFCROOF' : 'IFCSLAB',
    ifcGuid: generateBIMGuid(),
    source: params.source || 'ai_modeled',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FOOTING / FOUNDATION
// ═══════════════════════════════════════════════════════════════════════════════

export interface FootingParams {
  id: string;
  name: string;
  center: Vec2;
  width: number;
  depth: number;
  height: number;           // thickness of footing
  storey: string;
  elevation: number;        // top of footing
  type: 'strip' | 'spread' | 'pile_cap';
  material: string;
  source?: BIMSolid['source'];
}

export function createFooting(params: FootingParams): BIMSolid {
  let mesh = createBox(params.width, params.height, params.depth);
  const origin = vec3(params.center.x, params.center.y, params.elevation - params.height / 2);
  mesh = transformMesh(mesh, mat4Translation(origin));

  const vol = meshVolume(mesh);

  return {
    id: params.id,
    type: 'Footing',
    name: params.name,
    category: 'Structural',
    storey: params.storey,
    elevation: params.elevation,
    mesh,
    boundingBox: meshBoundingBox(mesh),
    quantities: {
      volume: vol,
      surfaceArea: meshSurfaceArea(mesh),
      lateralArea: meshLateralArea(mesh),
      width: params.width,
      height: params.height,
      thickness: params.depth,
      weight: vol * 2400,
    },
    material: params.material,
    hostedIds: [],
    connectedIds: [],
    origin,
    rotation: 0,
    ifcClass: 'IFCFOOTING',
    ifcGuid: generateBIMGuid(),
    source: params.source || 'ai_modeled',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STAIR ELEMENT
// ═══════════════════════════════════════════════════════════════════════════════

export interface StairParams {
  id: string;
  name: string;
  origin: Vec3;
  width: number;            // stair width
  riserHeight: number;      // height per step
  treadDepth: number;       // depth per step
  numRisers: number;        // total risers
  rotation: number;         // radians
  storey: string;
  elevation: number;
  material: string;
  source?: BIMSolid['source'];
}

export function createStair(params: StairParams): BIMSolid {
  const meshes: Mesh[] = [];

  for (let i = 0; i < params.numRisers; i++) {
    const stepHeight = params.riserHeight;
    const stepDepth = params.treadDepth;

    // Each step is a box
    const step = createBox(params.width, stepHeight, stepDepth);
    const stepOrigin = vec3(0, i * stepDepth + stepDepth / 2, i * stepHeight + stepHeight / 2);
    meshes.push(transformMesh(step, mat4Translation(stepOrigin)));
  }

  let mesh = mergeMeshes(...meshes);
  const transform = mat4Mul(mat4Translation(params.origin), mat4RotationZ(params.rotation));
  mesh = transformMesh(mesh, transform);

  const totalHeight = params.numRisers * params.riserHeight;
  const totalRun = params.numRisers * params.treadDepth;
  const vol = meshVolume(mesh);

  return {
    id: params.id,
    type: 'Stair',
    name: params.name,
    category: 'Architectural',
    storey: params.storey,
    elevation: params.elevation,
    mesh,
    boundingBox: meshBoundingBox(mesh),
    quantities: {
      volume: vol,
      surfaceArea: meshSurfaceArea(mesh),
      lateralArea: meshLateralArea(mesh),
      width: params.width,
      height: totalHeight,
      length: totalRun,
    },
    material: params.material,
    hostedIds: [],
    connectedIds: [],
    origin: params.origin,
    rotation: params.rotation,
    ifcClass: 'IFCSTAIRFLIGHT',
    ifcGuid: generateBIMGuid(),
    source: params.source || 'ai_modeled',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RAILING
// ═══════════════════════════════════════════════════════════════════════════════

export interface RailingParams {
  id: string;
  name: string;
  path: Vec3[];             // 3D polyline path
  height: number;           // railing height (metres)
  postSpacing: number;      // distance between posts
  postSize: number;         // post width/depth
  railDiameter: number;     // horizontal rail diameter
  storey: string;
  elevation: number;
  material: string;
  source?: BIMSolid['source'];
}

export function createRailing(params: RailingParams): BIMSolid {
  const meshes: Mesh[] = [];

  // Create posts along path
  let accumulated = 0;
  for (let i = 0; i < params.path.length - 1; i++) {
    const a = params.path[i], b = params.path[i + 1];
    const segLen = v3len(v3sub(b, a));
    const dir = v3normalize(v3sub(b, a));

    let dist = (params.postSpacing - accumulated) % params.postSpacing;
    while (dist <= segLen) {
      const pos = v3add(a, v3scale(dir, dist));
      const post = createBox(params.postSize, params.height, params.postSize);
      meshes.push(transformMesh(post, mat4Translation(v3add(pos, vec3(0, 0, params.height / 2)))));
      dist += params.postSpacing;
    }
    accumulated = (accumulated + segLen) % params.postSpacing;
  }

  // Top rail as swept cylinder
  const railProfile = circleProfile(params.railDiameter / 2, 12);
  const topRailPath = params.path.map(p => v3add(p, vec3(0, 0, params.height)));
  meshes.push(sweepAlongPath(railProfile, topRailPath));

  // Mid rail
  const midRailPath = params.path.map(p => v3add(p, vec3(0, 0, params.height / 2)));
  meshes.push(sweepAlongPath(railProfile, midRailPath));

  const mesh = mergeMeshes(...meshes);

  return {
    id: params.id,
    type: 'Railing',
    name: params.name,
    category: 'Architectural',
    storey: params.storey,
    elevation: params.elevation,
    mesh,
    boundingBox: meshBoundingBox(mesh),
    quantities: {
      volume: meshVolume(mesh),
      surfaceArea: meshSurfaceArea(mesh),
      lateralArea: meshLateralArea(mesh),
      height: params.height,
    },
    material: params.material,
    hostedIds: [],
    connectedIds: [],
    origin: params.path[0],
    rotation: 0,
    ifcClass: 'IFCRAILING',
    ifcGuid: generateBIMGuid(),
    source: params.source || 'ai_modeled',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MEP ELEMENTS — Ducts, Pipes, Cable Trays
// ═══════════════════════════════════════════════════════════════════════════════

export interface DuctParams {
  id: string;
  name: string;
  path: Vec3[];              // centerline path
  width: number;             // cross-section width (or diameter for round)
  height: number;            // cross-section height (same as width for round)
  shape: 'rectangular' | 'circular';
  insulated: boolean;
  insulationThickness?: number;
  storey: string;
  elevation: number;
  material: string;
  source?: BIMSolid['source'];
}

export function createDuct(params: DuctParams): BIMSolid {
  let profile: Profile2D;
  if (params.shape === 'circular') {
    profile = circleProfile(params.width / 2, 24);
  } else {
    profile = rectProfile(params.width, params.height);
  }

  let mesh = sweepAlongPath(profile, params.path);

  // Add insulation layer
  if (params.insulated && params.insulationThickness) {
    let insProfile: Profile2D;
    if (params.shape === 'circular') {
      insProfile = circleProfile(params.width / 2 + params.insulationThickness, 24);
    } else {
      insProfile = rectProfile(params.width + 2 * params.insulationThickness, params.height + 2 * params.insulationThickness);
    }
    const insMesh = sweepAlongPath(insProfile, params.path);
    mesh = mergeMeshes(mesh, insMesh);
  }

  // Calculate path length
  let pathLength = 0;
  for (let i = 0; i < params.path.length - 1; i++) {
    pathLength += v3len(v3sub(params.path[i + 1], params.path[i]));
  }

  const crossArea = params.shape === 'circular'
    ? Math.PI * (params.width / 2) ** 2
    : params.width * params.height;

  return {
    id: params.id,
    type: 'Duct',
    name: params.name,
    category: 'MEP',
    storey: params.storey,
    elevation: params.elevation,
    mesh,
    boundingBox: meshBoundingBox(mesh),
    profile,
    quantities: {
      volume: crossArea * pathLength,
      surfaceArea: meshSurfaceArea(mesh),
      lateralArea: meshLateralArea(mesh),
      length: pathLength,
      width: params.width,
      height: params.height,
      profileArea: crossArea,
    },
    material: params.material,
    hostedIds: [],
    connectedIds: [],
    origin: params.path[0],
    rotation: 0,
    ifcClass: 'IFCDUCTSEGMENT',
    ifcGuid: generateBIMGuid(),
    source: params.source || 'ai_modeled',
  };
}

export interface PipeParams {
  id: string;
  name: string;
  path: Vec3[];
  diameter: number;          // outer diameter
  wallThickness: number;     // pipe wall thickness
  storey: string;
  elevation: number;
  material: string;          // 'Copper', 'PVC', 'Cast Iron', 'Steel'
  system: 'domestic_hot' | 'domestic_cold' | 'sanitary' | 'storm' | 'fire_protection' | 'hydronic';
  source?: BIMSolid['source'];
}

export function createPipe(params: PipeParams): BIMSolid {
  const profile = circleProfile(params.diameter / 2, 16);
  const mesh = sweepAlongPath(profile, params.path);

  let pathLength = 0;
  for (let i = 0; i < params.path.length - 1; i++) {
    pathLength += v3len(v3sub(params.path[i + 1], params.path[i]));
  }

  const crossArea = Math.PI * (params.diameter / 2) ** 2;

  return {
    id: params.id,
    type: 'Pipe',
    name: params.name,
    category: 'MEP',
    storey: params.storey,
    elevation: params.elevation,
    mesh,
    boundingBox: meshBoundingBox(mesh),
    profile,
    quantities: {
      volume: crossArea * pathLength,
      surfaceArea: meshSurfaceArea(mesh),
      lateralArea: meshLateralArea(mesh),
      length: pathLength,
      width: params.diameter,
      profileArea: crossArea,
    },
    material: params.material,
    hostedIds: [],
    connectedIds: [],
    origin: params.path[0],
    rotation: 0,
    ifcClass: 'IFCPIPESEGMENT',
    ifcGuid: generateBIMGuid(),
    source: params.source || 'ai_modeled',
  };
}

export interface CableTrayParams {
  id: string;
  name: string;
  path: Vec3[];
  width: number;
  height: number;           // side rail height
  storey: string;
  elevation: number;
  material: string;
  source?: BIMSolid['source'];
}

export function createCableTray(params: CableTrayParams): BIMSolid {
  // Cable tray is a U-shaped profile (open top)
  const t = 0.002; // 2mm sheet metal thickness
  const profile: Profile2D = {
    outer: [
      vec2(-params.width / 2, 0),
      vec2(params.width / 2, 0),
      vec2(params.width / 2, params.height),
      vec2(params.width / 2 - t, params.height),
      vec2(params.width / 2 - t, t),
      vec2(-params.width / 2 + t, t),
      vec2(-params.width / 2 + t, params.height),
      vec2(-params.width / 2, params.height),
    ],
    holes: [],
  };

  const mesh = sweepAlongPath(profile, params.path);

  let pathLength = 0;
  for (let i = 0; i < params.path.length - 1; i++) {
    pathLength += v3len(v3sub(params.path[i + 1], params.path[i]));
  }

  return {
    id: params.id,
    type: 'Cable Tray',
    name: params.name,
    category: 'MEP',
    storey: params.storey,
    elevation: params.elevation,
    mesh,
    boundingBox: meshBoundingBox(mesh),
    profile,
    quantities: {
      volume: meshVolume(mesh),
      surfaceArea: meshSurfaceArea(mesh),
      lateralArea: meshLateralArea(mesh),
      length: pathLength,
      width: params.width,
      height: params.height,
    },
    material: params.material,
    hostedIds: [],
    connectedIds: [],
    origin: params.path[0],
    rotation: 0,
    ifcClass: 'IFCCABLETRUNKING',
    ifcGuid: generateBIMGuid(),
    source: params.source || 'ai_modeled',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ELECTRICAL FIXTURES (point elements)
// ═══════════════════════════════════════════════════════════════════════════════

export interface FixtureParams {
  id: string;
  name: string;
  type: 'light' | 'receptacle' | 'switch' | 'panel' | 'sprinkler' | 'smoke_detector' | 'generic';
  position: Vec3;
  storey: string;
  elevation: number;
  source?: BIMSolid['source'];
}

export function createFixture(params: FixtureParams): BIMSolid {
  // Small representative geometry for visualization
  let mesh: Mesh;
  let size = { w: 0.1, h: 0.1, d: 0.05 };

  switch (params.type) {
    case 'light':
      mesh = createCylinder(0.15, 0.05, 12);
      size = { w: 0.3, h: 0.05, d: 0.3 };
      break;
    case 'panel':
      mesh = createBox(0.6, 0.8, 0.2);
      size = { w: 0.6, h: 0.8, d: 0.2 };
      break;
    case 'sprinkler':
      mesh = createCylinder(0.025, 0.1, 8);
      size = { w: 0.05, h: 0.1, d: 0.05 };
      break;
    default:
      mesh = createBox(0.1, 0.1, 0.05);
  }

  mesh = transformMesh(mesh, mat4Translation(params.position));

  const ifcClassMap: Record<string, string> = {
    light: 'IFCLIGHTFIXTURE', receptacle: 'IFCELECTRICAPPLIANCE',
    switch: 'IFCELECTRICAPPLIANCE', panel: 'IFCELECTRICDISTRIBUTIONBOARD',
    sprinkler: 'IFCFLOWTERMINAL', smoke_detector: 'IFCSENSOR', generic: 'IFCBUILDINGELEMENTPROXY',
  };

  return {
    id: params.id,
    type: params.type.charAt(0).toUpperCase() + params.type.slice(1),
    name: params.name,
    category: 'MEP',
    storey: params.storey,
    elevation: params.elevation,
    mesh,
    boundingBox: meshBoundingBox(mesh),
    quantities: {
      volume: size.w * size.h * size.d,
      surfaceArea: 2 * (size.w * size.h + size.w * size.d + size.h * size.d),
      lateralArea: 2 * (size.w + size.d) * size.h,
      width: size.w,
      height: size.h,
      thickness: size.d,
    },
    material: 'Steel',
    hostedIds: [],
    connectedIds: [],
    origin: params.position,
    rotation: 0,
    ifcClass: ifcClassMap[params.type] || 'IFCBUILDINGELEMENTPROXY',
    ifcGuid: generateBIMGuid(),
    source: params.source || 'ai_modeled',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PILE FOUNDATION — Deep foundation element
// ═══════════════════════════════════════════════════════════════════════════════

export interface PileParams {
  id: string;
  name: string;
  center: Vec2;
  diameter: number;           // metres
  length: number;             // metres (depth)
  storey: string;
  elevation: number;          // top of pile
  type: 'driven' | 'bored' | 'helical' | 'micropile';
  material: string;           // 'Concrete', 'Steel', 'Timber'
  capacity?: number;          // kN (bearing capacity)
  source?: BIMSolid['source'];
}

export function createPile(params: PileParams): BIMSolid {
  const radius = params.diameter / 2;
  let mesh = createCylinder(radius, params.length, 16);
  const origin = vec3(params.center.x, params.center.y, params.elevation - params.length);
  mesh = transformMesh(mesh, mat4Translation(origin));

  const vol = Math.PI * radius * radius * params.length;

  return {
    id: params.id,
    type: `Pile (${params.type})`,
    name: params.name,
    category: 'Structural',
    storey: params.storey,
    elevation: params.elevation,
    mesh,
    boundingBox: meshBoundingBox(mesh),
    quantities: {
      volume: vol,
      surfaceArea: meshSurfaceArea(mesh),
      lateralArea: 2 * Math.PI * radius * params.length,
      length: params.length,
      width: params.diameter,
      weight: params.material === 'Concrete' ? vol * 2400 : params.material === 'Steel' ? vol * 7850 : vol * 600,
    },
    material: params.material,
    hostedIds: [],
    connectedIds: [],
    origin,
    rotation: 0,
    ifcClass: 'IFCPILE',
    ifcGuid: generateBIMGuid(),
    source: params.source || 'ai_modeled',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GRADE BEAM — Beam at foundation level connecting footings/pile caps
// ═══════════════════════════════════════════════════════════════════════════════

export interface GradeBeamParams {
  id: string;
  name: string;
  start: Vec2;
  end: Vec2;
  width: number;              // metres
  depth: number;              // metres (height of grade beam)
  storey: string;
  elevation: number;          // top of grade beam
  material: string;
  source?: BIMSolid['source'];
}

export function createGradeBeam(params: GradeBeamParams): BIMSolid {
  const dx = params.end.x - params.start.x;
  const dy = params.end.y - params.start.y;
  const beamLength = Math.sqrt(dx * dx + dy * dy);
  const rotation = Math.atan2(dy, dx);

  const profileDef = rectProfile(beamLength, params.width);
  let mesh = extrudeProfile(profileDef, params.depth);
  const origin = vec3(
    (params.start.x + params.end.x) / 2,
    (params.start.y + params.end.y) / 2,
    params.elevation - params.depth,
  );
  mesh = transformMesh(mesh, mat4Mul(mat4Translation(origin), mat4RotationZ(rotation)));

  const vol = beamLength * params.width * params.depth;

  return {
    id: params.id,
    type: 'Grade Beam',
    name: params.name,
    category: 'Structural',
    storey: params.storey,
    elevation: params.elevation,
    mesh,
    boundingBox: meshBoundingBox(mesh),
    profile: profileDef,
    quantities: {
      volume: vol,
      surfaceArea: meshSurfaceArea(mesh),
      lateralArea: meshLateralArea(mesh),
      length: beamLength,
      width: params.width,
      height: params.depth,
      weight: vol * 2400,
    },
    material: params.material,
    hostedIds: [],
    connectedIds: [],
    origin,
    rotation,
    ifcClass: 'IFCBEAM',
    ifcGuid: generateBIMGuid(),
    source: params.source || 'ai_modeled',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RAMP ELEMENT
// ═══════════════════════════════════════════════════════════════════════════════

export interface RampParams {
  id: string;
  name: string;
  origin: Vec3;
  width: number;              // metres
  length: number;             // run length (metres)
  riseHeight: number;         // metres (total height change)
  thickness: number;          // slab thickness (metres)
  rotation: number;           // radians
  storey: string;
  elevation: number;
  material: string;
  source?: BIMSolid['source'];
}

export function createRamp(params: RampParams): BIMSolid {
  // Ramp as a sloped slab: trapezoidal cross-section extruded along width
  const slopeAngle = Math.atan2(params.riseHeight, params.length);
  const rampProfile: Profile2D = {
    outer: [
      vec2(0, 0),
      vec2(params.length, 0),
      vec2(params.length, params.riseHeight + params.thickness),
      vec2(params.length, params.riseHeight),
      vec2(0, params.thickness),
      vec2(0, 0),
    ].filter((_, i, arr) => {
      // Deduplicate the profile into a clean trapezoid
      return true;
    }),
    holes: [],
  };

  // Simpler: just create a wedge shape
  const profile: Profile2D = {
    outer: [
      vec2(0, 0),
      vec2(params.length, params.riseHeight),
      vec2(params.length, params.riseHeight + params.thickness),
      vec2(0, params.thickness),
    ],
    holes: [],
  };

  let mesh = extrudeProfile(profile, params.width);
  const transform = mat4Mul(mat4Translation(params.origin), mat4RotationZ(params.rotation));
  mesh = transformMesh(mesh, transform);

  const vol = params.length * params.width * params.thickness + 0.5 * params.length * params.width * params.riseHeight;

  return {
    id: params.id,
    type: 'Ramp',
    name: params.name,
    category: 'Architectural',
    storey: params.storey,
    elevation: params.elevation,
    mesh,
    boundingBox: meshBoundingBox(mesh),
    profile,
    quantities: {
      volume: vol,
      surfaceArea: meshSurfaceArea(mesh),
      lateralArea: meshLateralArea(mesh),
      width: params.width,
      height: params.riseHeight,
      length: params.length,
      thickness: params.thickness,
      weight: params.material === 'Concrete' ? vol * 2400 : undefined,
    },
    material: params.material,
    hostedIds: [],
    connectedIds: [],
    origin: params.origin,
    rotation: params.rotation,
    ifcClass: 'IFCRAMP',
    ifcGuid: generateBIMGuid(),
    source: params.source || 'ai_modeled',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CURTAIN WALL — Panel + mullion system
// ═══════════════════════════════════════════════════════════════════════════════

export interface CurtainWallParams {
  id: string;
  name: string;
  start: Vec2;
  end: Vec2;
  height: number;             // metres
  storey: string;
  elevation: number;
  panelWidth: number;         // grid spacing horizontal (metres)
  panelHeight: number;        // grid spacing vertical (metres)
  mullionWidth: number;       // mullion face width (metres, typically 0.05-0.065)
  mullionDepth: number;       // mullion depth (metres, typically 0.15-0.2)
  panelThickness: number;     // glass/panel thickness (metres, typically 0.025)
  panelMaterial: string;      // 'Glass', 'Spandrel Panel', etc.
  mullionMaterial: string;    // 'Aluminum', 'Steel'
  source?: BIMSolid['source'];
}

export function createCurtainWall(params: CurtainWallParams): { wall: BIMSolid; panels: BIMSolid[]; mullions: BIMSolid[] } {
  const dx = params.end.x - params.start.x;
  const dy = params.end.y - params.start.y;
  const wallLength = Math.sqrt(dx * dx + dy * dy);
  const rotation = Math.atan2(dy, dx);
  const origin = vec3(params.start.x, params.start.y, params.elevation);

  const nCols = Math.max(1, Math.round(wallLength / params.panelWidth));
  const nRows = Math.max(1, Math.round(params.height / params.panelHeight));
  const actualPanelW = wallLength / nCols;
  const actualPanelH = params.height / nRows;

  const panels: BIMSolid[] = [];
  const mullions: BIMSolid[] = [];
  const allMeshes: Mesh[] = [];

  // Create panels
  for (let col = 0; col < nCols; col++) {
    for (let row = 0; row < nRows; row++) {
      const panelW = actualPanelW - params.mullionWidth;
      const panelH = actualPanelH - params.mullionWidth;
      const panelMesh = createBox(panelW, panelH, params.panelThickness);
      const cx = col * actualPanelW + actualPanelW / 2;
      const cy = row * actualPanelH + actualPanelH / 2;

      const placedMesh = transformMesh(panelMesh,
        mat4Mul(
          mat4Translation(origin),
          mat4Mul(mat4RotationZ(rotation), mat4Translation(vec3(cx, 0, cy)))
        )
      );

      allMeshes.push(placedMesh);

      panels.push({
        id: `${params.id}_panel_${col}_${row}`,
        type: 'Curtain Wall Panel',
        name: `${params.name} Panel ${col + 1}-${row + 1}`,
        category: 'Architectural',
        storey: params.storey,
        elevation: params.elevation,
        mesh: placedMesh,
        boundingBox: meshBoundingBox(placedMesh),
        quantities: {
          volume: panelW * panelH * params.panelThickness,
          surfaceArea: 2 * panelW * panelH,
          lateralArea: panelW * panelH,
          width: panelW,
          height: panelH,
          thickness: params.panelThickness,
        },
        material: params.panelMaterial,
        hostId: params.id,
        hostedIds: [],
        connectedIds: [],
        origin: vec3(params.start.x + Math.cos(rotation) * cx, params.start.y + Math.sin(rotation) * cx, params.elevation + cy),
        rotation,
        ifcClass: 'IFCPLATE',
        ifcGuid: generateBIMGuid(),
        source: params.source || 'ai_modeled',
      });
    }
  }

  // Create vertical mullions
  for (let col = 0; col <= nCols; col++) {
    const x = col * actualPanelW;
    const mullMesh = createBox(params.mullionWidth, params.height, params.mullionDepth);
    const placedMull = transformMesh(mullMesh,
      mat4Mul(
        mat4Translation(origin),
        mat4Mul(mat4RotationZ(rotation), mat4Translation(vec3(x, 0, params.height / 2)))
      )
    );
    allMeshes.push(placedMull);

    mullions.push({
      id: `${params.id}_vmull_${col}`,
      type: 'Mullion',
      name: `${params.name} V-Mullion ${col + 1}`,
      category: 'Architectural',
      storey: params.storey,
      elevation: params.elevation,
      mesh: placedMull,
      boundingBox: meshBoundingBox(placedMull),
      quantities: {
        volume: params.mullionWidth * params.height * params.mullionDepth,
        surfaceArea: meshSurfaceArea(placedMull),
        lateralArea: meshLateralArea(placedMull),
        width: params.mullionWidth,
        height: params.height,
        thickness: params.mullionDepth,
      },
      material: params.mullionMaterial,
      hostId: params.id,
      hostedIds: [],
      connectedIds: [],
      origin: vec3(params.start.x + Math.cos(rotation) * x, params.start.y + Math.sin(rotation) * x, params.elevation + params.height / 2),
      rotation,
      ifcClass: 'IFCMEMBER',
      ifcGuid: generateBIMGuid(),
      source: params.source || 'ai_modeled',
    });
  }

  // Create horizontal mullions
  for (let row = 0; row <= nRows; row++) {
    const y = row * actualPanelH;
    const mullMesh = createBox(wallLength, params.mullionWidth, params.mullionDepth);
    const placedMull = transformMesh(mullMesh,
      mat4Mul(
        mat4Translation(origin),
        mat4Mul(mat4RotationZ(rotation), mat4Translation(vec3(wallLength / 2, 0, y)))
      )
    );
    allMeshes.push(placedMull);

    mullions.push({
      id: `${params.id}_hmull_${row}`,
      type: 'Mullion',
      name: `${params.name} H-Mullion ${row + 1}`,
      category: 'Architectural',
      storey: params.storey,
      elevation: params.elevation,
      mesh: placedMull,
      boundingBox: meshBoundingBox(placedMull),
      quantities: {
        volume: wallLength * params.mullionWidth * params.mullionDepth,
        surfaceArea: meshSurfaceArea(placedMull),
        lateralArea: meshLateralArea(placedMull),
        width: wallLength,
        height: params.mullionWidth,
        thickness: params.mullionDepth,
      },
      material: params.mullionMaterial,
      hostId: params.id,
      hostedIds: [],
      connectedIds: [],
      origin: vec3(params.start.x + Math.cos(rotation) * wallLength / 2, params.start.y + Math.sin(rotation) * wallLength / 2, params.elevation + y),
      rotation,
      ifcClass: 'IFCMEMBER',
      ifcGuid: generateBIMGuid(),
      source: params.source || 'ai_modeled',
    });
  }

  // The curtain wall envelope solid
  const envelopeMesh = mergeMeshes(...allMeshes);
  const wall: BIMSolid = {
    id: params.id,
    type: 'Curtain Wall',
    name: params.name,
    category: 'Architectural',
    storey: params.storey,
    elevation: params.elevation,
    mesh: envelopeMesh,
    boundingBox: meshBoundingBox(envelopeMesh),
    quantities: {
      volume: meshVolume(envelopeMesh),
      surfaceArea: wallLength * params.height,
      lateralArea: wallLength * params.height,
      length: wallLength,
      height: params.height,
    },
    material: params.panelMaterial,
    hostedIds: [...panels.map(p => p.id), ...mullions.map(m => m.id)],
    connectedIds: [],
    origin,
    rotation,
    ifcClass: 'IFCCURTAINWALL',
    ifcGuid: generateBIMGuid(),
    source: params.source || 'ai_modeled',
  };

  return { wall, panels, mullions };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  REBAR GEOMETRY — Individual bar modeling for concrete elements
// ═══════════════════════════════════════════════════════════════════════════════

/** CSA G30.18 bar database */
const CSA_BARS: Record<string, { diameter: number; area: number; mass: number }> = {
  '10M': { diameter: 11.3, area: 100, mass: 0.785 },
  '15M': { diameter: 16.0, area: 200, mass: 1.570 },
  '20M': { diameter: 19.5, area: 300, mass: 2.355 },
  '25M': { diameter: 25.2, area: 500, mass: 3.925 },
  '30M': { diameter: 29.9, area: 700, mass: 5.495 },
  '35M': { diameter: 35.7, area: 1000, mass: 7.850 },
  '45M': { diameter: 43.7, area: 1500, mass: 11.775 },
  '55M': { diameter: 56.4, area: 2500, mass: 19.625 },
};

export interface RebarLayoutParams {
  hostElement: BIMSolid;
  elementType: 'slab' | 'wall' | 'column' | 'beam' | 'footing';
  cover: number;               // mm
  topBarDesignation: string;    // e.g. "15M"
  topBarSpacing: number;        // mm
  bottomBarDesignation: string;
  bottomBarSpacing: number;
  stirrupDesignation?: string;  // for beams/columns
  stirrupSpacing?: number;      // mm
}

export function generateRebarGeometry(params: RebarLayoutParams): { bars: BIMSolid[]; rebarInfo: RebarInfo } {
  const bars: BIMSolid[] = [];
  const rebarBars: RebarBar[] = [];
  const coverM = params.cover / 1000;

  const bb = params.hostElement.boundingBox;
  const hostLength = (params.hostElement.quantities.length || (bb.max.x - bb.min.x));
  const hostWidth = (params.hostElement.quantities.width || (bb.max.y - bb.min.y));
  const hostHeight = (params.hostElement.quantities.height || params.hostElement.quantities.thickness || (bb.max.z - bb.min.z));

  const topBar = CSA_BARS[params.topBarDesignation] || CSA_BARS['15M'];
  const botBar = CSA_BARS[params.bottomBarDesignation] || CSA_BARS['15M'];
  const topDiamM = topBar.diameter / 1000;
  const botDiamM = botBar.diameter / 1000;

  let barIdx = 0;
  let totalWeight = 0;

  // Bottom longitudinal bars
  if (params.bottomBarSpacing > 0) {
    const nBars = Math.max(2, Math.floor((hostWidth - 2 * coverM) / (params.bottomBarSpacing / 1000)));
    const spacing = (hostWidth - 2 * coverM) / (nBars - 1);

    for (let i = 0; i < nBars; i++) {
      const barLength = hostLength - 2 * coverM;
      const yPos = bb.min.y + coverM + i * spacing;
      const zPos = bb.min.z + coverM + botDiamM / 2;
      const path = [
        vec3(bb.min.x + coverM, yPos, zPos),
        vec3(bb.min.x + coverM + barLength, yPos, zPos),
      ];
      const barProfile = circleProfile(botDiamM / 2, 8);
      const barMesh = sweepAlongPath(barProfile, path);
      const weight = botBar.mass * barLength;
      totalWeight += weight;

      bars.push({
        id: `${params.hostElement.id}_rebar_bot_${barIdx}`,
        type: 'Rebar',
        name: `${params.bottomBarDesignation} Bottom Bar ${barIdx + 1}`,
        category: 'Structural',
        storey: params.hostElement.storey,
        elevation: params.hostElement.elevation,
        mesh: barMesh,
        boundingBox: meshBoundingBox(barMesh),
        quantities: {
          volume: Math.PI * (botDiamM / 2) ** 2 * barLength,
          surfaceArea: Math.PI * botDiamM * barLength,
          lateralArea: Math.PI * botDiamM * barLength,
          length: barLength,
          width: botDiamM,
          weight,
        },
        material: 'Reinforcing Steel',
        hostId: params.hostElement.id,
        hostedIds: [],
        connectedIds: [],
        origin: path[0],
        rotation: 0,
        ifcClass: 'IFCREINFORCINGBAR',
        ifcGuid: generateBIMGuid(),
        source: params.hostElement.source,
      });

      rebarBars.push({
        id: `bot_${barIdx}`,
        designation: params.bottomBarDesignation,
        diameter: botBar.diameter,
        length: barLength * 1000,
        spacing: params.bottomBarSpacing,
        count: 1,
        direction: 'longitudinal',
        layer: 'bottom',
      });
      barIdx++;
    }
  }

  // Top longitudinal bars
  if (params.topBarSpacing > 0) {
    const nBars = Math.max(2, Math.floor((hostWidth - 2 * coverM) / (params.topBarSpacing / 1000)));
    const spacing = (hostWidth - 2 * coverM) / (nBars - 1);

    for (let i = 0; i < nBars; i++) {
      const barLength = hostLength - 2 * coverM;
      const yPos = bb.min.y + coverM + i * spacing;
      const zPos = bb.max.z - coverM - topDiamM / 2;
      const path = [
        vec3(bb.min.x + coverM, yPos, zPos),
        vec3(bb.min.x + coverM + barLength, yPos, zPos),
      ];
      const barProfile = circleProfile(topDiamM / 2, 8);
      const barMesh = sweepAlongPath(barProfile, path);
      const weight = topBar.mass * barLength;
      totalWeight += weight;

      bars.push({
        id: `${params.hostElement.id}_rebar_top_${barIdx}`,
        type: 'Rebar',
        name: `${params.topBarDesignation} Top Bar ${barIdx + 1}`,
        category: 'Structural',
        storey: params.hostElement.storey,
        elevation: params.hostElement.elevation,
        mesh: barMesh,
        boundingBox: meshBoundingBox(barMesh),
        quantities: {
          volume: Math.PI * (topDiamM / 2) ** 2 * barLength,
          surfaceArea: Math.PI * topDiamM * barLength,
          lateralArea: Math.PI * topDiamM * barLength,
          length: barLength,
          width: topDiamM,
          weight,
        },
        material: 'Reinforcing Steel',
        hostId: params.hostElement.id,
        hostedIds: [],
        connectedIds: [],
        origin: path[0],
        rotation: 0,
        ifcClass: 'IFCREINFORCINGBAR',
        ifcGuid: generateBIMGuid(),
        source: params.hostElement.source,
      });

      rebarBars.push({
        id: `top_${barIdx}`,
        designation: params.topBarDesignation,
        diameter: topBar.diameter,
        length: barLength * 1000,
        spacing: params.topBarSpacing,
        count: 1,
        direction: 'longitudinal',
        layer: 'top',
      });
      barIdx++;
    }
  }

  // Stirrups (for beams/columns)
  if (params.stirrupDesignation && params.stirrupSpacing && (params.elementType === 'beam' || params.elementType === 'column')) {
    const stirBar = CSA_BARS[params.stirrupDesignation] || CSA_BARS['10M'];
    const stirDiamM = stirBar.diameter / 1000;
    const nStirrups = Math.floor((hostLength - 2 * coverM) / (params.stirrupSpacing / 1000));

    for (let i = 0; i < nStirrups; i++) {
      const xPos = bb.min.x + coverM + i * (params.stirrupSpacing / 1000);
      const innerW = hostWidth - 2 * coverM;
      const innerH = (hostHeight || 0.5) - 2 * coverM;
      const perimeter = 2 * (innerW + innerH);

      // Stirrup as a rectangular ring
      const stirPath: Vec3[] = [
        vec3(xPos, bb.min.y + coverM, bb.min.z + coverM),
        vec3(xPos, bb.max.y - coverM, bb.min.z + coverM),
        vec3(xPos, bb.max.y - coverM, bb.max.z - coverM),
        vec3(xPos, bb.min.y + coverM, bb.max.z - coverM),
        vec3(xPos, bb.min.y + coverM, bb.min.z + coverM),
      ];
      const stirProfile = circleProfile(stirDiamM / 2, 6);
      const stirMesh = sweepAlongPath(stirProfile, stirPath);
      const weight = stirBar.mass * perimeter / 1000;
      totalWeight += weight;

      bars.push({
        id: `${params.hostElement.id}_stirrup_${i}`,
        type: 'Rebar',
        name: `${params.stirrupDesignation} Stirrup ${i + 1}`,
        category: 'Structural',
        storey: params.hostElement.storey,
        elevation: params.hostElement.elevation,
        mesh: stirMesh,
        boundingBox: meshBoundingBox(stirMesh),
        quantities: {
          volume: Math.PI * (stirDiamM / 2) ** 2 * perimeter,
          surfaceArea: Math.PI * stirDiamM * perimeter,
          lateralArea: Math.PI * stirDiamM * perimeter,
          length: perimeter,
          width: stirDiamM,
          weight,
        },
        material: 'Reinforcing Steel',
        hostId: params.hostElement.id,
        hostedIds: [],
        connectedIds: [],
        origin: stirPath[0],
        rotation: 0,
        ifcClass: 'IFCREINFORCINGBAR',
        ifcGuid: generateBIMGuid(),
        source: params.hostElement.source,
      });

      rebarBars.push({
        id: `stirrup_${i}`,
        designation: params.stirrupDesignation,
        diameter: stirBar.diameter,
        length: perimeter * 1000,
        spacing: params.stirrupSpacing,
        count: 1,
        direction: 'stirrup',
        layer: 'core',
      });
    }
  }

  const hostVol = params.hostElement.quantities.volume || 1;
  const rebarInfo: RebarInfo = {
    totalWeight,
    density: totalWeight / hostVol,
    bars: rebarBars,
    coverTop: params.cover,
    coverBottom: params.cover,
    coverSide: params.cover,
  };

  return { bars, rebarInfo };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STEEL CONNECTION GEOMETRY — Plates, bolts, welds
// ═══════════════════════════════════════════════════════════════════════════════

export interface ConnectionParams {
  id: string;
  type: ConnectionDetail['type'];
  beamElement: BIMSolid;
  supportElement: BIMSolid;       // column or other beam
  plateThickness?: number;         // mm (default 12)
  plateMaterial?: string;          // default "350W"
  boltDiameter?: number;           // mm (default 19.05 = 3/4")
  boltGrade?: string;              // default "A325"
  boltRows?: number;               // default 3
  weldSize?: number;               // mm (default 8)
}

export function createSteelConnection(params: ConnectionParams): { elements: BIMSolid[]; detail: ConnectionDetail } {
  const elements: BIMSolid[] = [];
  const plateThickM = (params.plateThickness || 12) / 1000;
  const boltDiamM = (params.boltDiameter || 19.05) / 1000;
  const nRows = params.boltRows || 3;

  const beamBB = params.beamElement.boundingBox;
  const beamDepth = (beamBB.max.z - beamBB.min.z) || 0.3;
  const beamWidth = (beamBB.max.y - beamBB.min.y) || 0.15;

  // Connection point = closest end of beam to support
  const supportCenter = params.supportElement.origin;
  const beamStart = params.beamElement.origin;
  const connPt = beamStart; // simplified: connection at beam start

  const plates: ConnectionPlate[] = [];
  const bolts: BoltGroup[] = [];
  const welds: WeldLine[] = [];

  if (params.type === 'shear_tab') {
    // Single plate welded to column, bolted to beam web
    const plateH = beamDepth * 0.7;
    const plateW = 0.15; // 150mm wide
    const plateMesh = createBox(plateThickM, plateH, plateW);
    const plateOrigin = vec3(connPt.x, connPt.y, connPt.z + beamDepth * 0.15);
    const placed = transformMesh(plateMesh, mat4Translation(plateOrigin));

    plates.push({
      id: `${params.id}_plate_0`,
      name: 'Shear Tab Plate',
      width: plateW * 1000,
      height: plateH * 1000,
      thickness: (params.plateThickness || 12),
      material: params.plateMaterial || '350W',
      position: plateOrigin,
      rotation: 0,
      mesh: placed,
    });

    elements.push({
      id: `${params.id}_plate_0`,
      type: 'Connection Plate',
      name: `${params.beamElement.name} Shear Tab`,
      category: 'Structural',
      storey: params.beamElement.storey,
      elevation: params.beamElement.elevation,
      mesh: placed,
      boundingBox: meshBoundingBox(placed),
      quantities: {
        volume: plateThickM * plateH * plateW,
        surfaceArea: 2 * (plateThickM * plateH + plateThickM * plateW + plateH * plateW),
        lateralArea: 2 * plateThickM * plateH,
        width: plateW,
        height: plateH,
        thickness: plateThickM,
        weight: plateThickM * plateH * plateW * 7850,
      },
      material: params.plateMaterial || '350W Steel',
      hostedIds: [],
      connectedIds: [params.beamElement.id, params.supportElement.id],
      origin: plateOrigin,
      rotation: 0,
      ifcClass: 'IFCPLATE',
      ifcGuid: generateBIMGuid(),
      source: params.beamElement.source,
    });

    // Bolts
    const boltSpacing = plateH / (nRows + 1);
    const boltMeshes: Mesh[] = [];
    for (let r = 0; r < nRows; r++) {
      const boltZ = connPt.z + beamDepth * 0.15 + (r + 1) * boltSpacing;
      const boltMesh = createCylinder(boltDiamM / 2, plateThickM + beamWidth * 0.3, 8);
      const placedBolt = transformMesh(boltMesh, mat4Translation(vec3(connPt.x, connPt.y, boltZ)));
      boltMeshes.push(placedBolt);

      elements.push({
        id: `${params.id}_bolt_${r}`,
        type: 'Bolt',
        name: `${params.boltGrade || 'A325'} Bolt ${r + 1}`,
        category: 'Structural',
        storey: params.beamElement.storey,
        elevation: params.beamElement.elevation,
        mesh: placedBolt,
        boundingBox: meshBoundingBox(placedBolt),
        quantities: {
          volume: Math.PI * (boltDiamM / 2) ** 2 * plateThickM,
          surfaceArea: Math.PI * boltDiamM * plateThickM,
          lateralArea: Math.PI * boltDiamM * plateThickM,
          width: boltDiamM,
        },
        material: params.boltGrade || 'A325',
        hostedIds: [],
        connectedIds: [params.id + '_plate_0'],
        origin: vec3(connPt.x, connPt.y, boltZ),
        rotation: 0,
        ifcClass: 'IFCMECHANICALFASTENER',
        ifcGuid: generateBIMGuid(),
        source: params.beamElement.source,
      });
    }

    bolts.push({
      id: `${params.id}_boltgroup_0`,
      boltDiameter: params.boltDiameter || 19.05,
      boltGrade: params.boltGrade || 'A325',
      rows: nRows,
      columns: 1,
      rowSpacing: boltSpacing * 1000,
      colSpacing: 0,
      position: connPt,
      meshes: boltMeshes,
    });

    // Weld line (plate to column)
    const weldSizeMM = params.weldSize || 8;
    welds.push({
      id: `${params.id}_weld_0`,
      type: 'fillet',
      size: weldSizeMM,
      length: plateH * 1000,
      start: vec3(connPt.x, connPt.y, connPt.z + beamDepth * 0.15),
      end: vec3(connPt.x, connPt.y, connPt.z + beamDepth * 0.15 + plateH),
    });
    welds.push({
      id: `${params.id}_weld_1`,
      type: 'fillet',
      size: weldSizeMM,
      length: plateH * 1000,
      start: vec3(connPt.x, connPt.y + plateThickM, connPt.z + beamDepth * 0.15),
      end: vec3(connPt.x, connPt.y + plateThickM, connPt.z + beamDepth * 0.15 + plateH),
    });
  }

  const detail: ConnectionDetail = {
    id: params.id,
    type: params.type,
    connectedElementIds: [params.beamElement.id, params.supportElement.id],
    plates,
    bolts,
    welds,
  };

  return { elements, detail };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function generateBIMGuid(): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  let result = '';
  for (let i = 0; i < 22; i++) result += chars[Math.floor(Math.random() * 64)];
  return result;
}

/** Convert a BIMSolid to the serialized format for DB storage and viewer transport */
export function serializeBIMSolid(solid: BIMSolid): SerializedMesh {
  if (solid.serialized) return solid.serialized;
  const s = serializeMesh(solid.mesh);
  solid.serialized = s;
  return s;
}

/** Convert a flat element from the old system into BIMSolid params */
export function inferWallAssembly(material?: string, isExterior?: boolean): WallAssembly {
  if (!material) return isExterior ? WALL_ASSEMBLIES['EXT_WALL_BRICK'] : WALL_ASSEMBLIES['INT_WALL_STANDARD'];
  const m = material.toUpperCase();
  if (/CONCRETE|CAST/.test(m)) return WALL_ASSEMBLIES['CONCRETE_WALL'];
  if (/CMU|BLOCK|MASONRY/.test(m)) return WALL_ASSEMBLIES['CMU_WALL'];
  if (/METAL|ALUMINUM|STEEL/.test(m) && isExterior) return WALL_ASSEMBLIES['EXT_WALL_METAL'];
  if (/BRICK/.test(m)) return WALL_ASSEMBLIES['EXT_WALL_BRICK'];
  if (/FIRE/.test(m)) return WALL_ASSEMBLIES['INT_WALL_FIRE'];
  return isExterior ? WALL_ASSEMBLIES['EXT_WALL_BRICK'] : WALL_ASSEMBLIES['INT_WALL_STANDARD'];
}
