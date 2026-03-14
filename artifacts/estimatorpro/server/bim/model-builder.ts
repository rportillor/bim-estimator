/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  3D MODEL BUILDER — Orchestrates the full geometry pipeline
 *  Converts AI-extracted element data into real 3D BIMSolid objects.
 *  This is the bridge between:
 *    - Claude's drawing analysis (raw element descriptions)
 *    - IFC/DWG/DXF imports (native CAD data)
 *    - PDF text extraction (tabular data)
 *  ...and the 3D geometry engine (parametric-elements, geometry-kernel).
 *
 *  Pipeline:
 *    1. Accept raw elements from any source
 *    2. Classify and normalize element types
 *    3. Build parametric geometry (walls, columns, beams, slabs, MEP)
 *    4. Resolve spatial relationships (host/void, connections)
 *    5. Derive quantities from actual geometry
 *    6. Run clash detection
 *    7. Export to IFC4 / viewer format
 * ══════════════════════════════════════════════════════════════════════════════
 */

import {
  type Vec2, type Vec3, vec2, vec3, v3add, v3sub, v3len,
  type SerializedMesh, serializeMesh, meshVolume, meshSurfaceArea, meshLateralArea,
} from './geometry-kernel';

import {
  type BIMSolid, type WallParams, type WallOpeningDef, type WallAssembly, type MaterialLayer,
  createWall, createColumn, createBeam, createSlab, createFooting, createStair,
  createDuct, createPipe, createCableTray, createFixture,
  createPile, createGradeBeam, createRamp, createCurtainWall, createRailing,
  generateRebarGeometry, createSteelConnection,
  inferWallAssembly, WALL_ASSEMBLIES, serializeBIMSolid,
  type LODLevel, type PhaseAssignment, type WorksetInfo, type RevisionInfo,
  type PileParams, type GradeBeamParams, type RampParams, type CurtainWallParams, type RailingParams,
  type RebarLayoutParams, type ConnectionParams,
} from './parametric-elements';

import { lookupSteelSection, parseSectionFromText, type SteelSectionData } from './steel-sections-db';

import {
  runConstraintsPipeline, type ConstraintResults,
} from './bim-constraints';

import { importIFC, type IFCImportResult } from './ifc-import-engine';
import { parseDXF, convertDXFToBIM, isDXFContent, type DXFImportResult } from './dwg-dxf-import';
import { runClashDetection, summarizeClashes, type ClashResult, type ClashSummary } from './clash-detection';
import { routeMEPRun, layoutSprinklers, layoutLights, type MEPRunDef } from './mep-routing';
import { exportBIMToIFC4, type IFCExportV2Options } from './ifc-export-v2';

// ═══════════════════════════════════════════════════════════════════════════════
//  RAW ELEMENT INPUT (from Claude / legacy system)
// ═══════════════════════════════════════════════════════════════════════════════

export interface RawBIMInput {
  id: string;
  type: string;              // 'Wall', 'Column', 'Door', 'Window', etc.
  name?: string;
  category?: string;         // 'Architectural', 'Structural', 'MEP'
  storey?: string;
  elevation?: number;

  // Dimensions from AI extraction
  length?: number;           // metres
  width?: number;            // metres
  height?: number;           // metres
  thickness?: number;        // metres
  depth?: number;            // metres
  diameter?: number;         // metres (pipes, ducts, columns)
  area?: number;             // m²
  volume?: number;           // m³

  // Position from AI extraction
  x?: number;                // metres
  y?: number;                // metres
  z?: number;                // metres
  startX?: number; startY?: number;   // wall start
  endX?: number; endY?: number;       // wall end

  // Material & steel section
  material?: string;
  sectionDesignation?: string;   // e.g. "W10x49", "HSS6x6x3/8"

  // For openings
  hostId?: string;           // wall ID that hosts this door/window
  sillHeight?: number;       // window sill height
  positionAlongWall?: number; // distance from wall start

  // MEP
  system?: string;           // HVAC system type
  shape?: 'circular' | 'rectangular';
  path?: { x: number; y: number; z: number }[];

  // Polygon boundary (for slabs)
  boundary?: { x: number; y: number }[];

  // Source tracking
  source?: string;
  properties?: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BUILD RESULT
// ═══════════════════════════════════════════════════════════════════════════════

export interface BuildResult {
  elements: BIMSolid[];
  clashes: ClashResult[];
  clashSummary: ClashSummary;
  constraints: ConstraintResults;
  stats: {
    totalElements: number;
    byType: Record<string, number>;
    byStorey: Record<string, number>;
    byCategory: Record<string, number>;
    totalVolume: number;
    totalArea: number;
    withGeometry: number;
    lodDistribution: Record<number, number>;
    worksetDistribution: Record<string, number>;
    phaseDistribution: Record<string, number>;
  };
  ifcContent?: string;
  warnings: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BUILDING CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════

export interface BuildingContext {
  name: string;
  storeys: { name: string; elevation: number; floorToFloorHeight: number }[];
  footprint?: Vec2[];         // building perimeter polygon
  gridX?: number[];           // structural grid X positions
  gridY?: number[];           // structural grid Y positions
  defaultWallHeight?: number;
  defaultSlabThickness?: number;
  // Phase 2 options
  generateRebar?: boolean;       // generate rebar geometry for concrete elements
  generateConnections?: boolean; // generate steel connection details
  revisionNumber?: number;       // current revision number
  revisionId?: string;           // current revision identifier
  previousElements?: BIMSolid[]; // previous model for revision diffing
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN BUILD FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

export function buildModel(
  rawElements: RawBIMInput[],
  context: BuildingContext,
  options?: { runClashCheck?: boolean; generateIFC?: boolean; ifcOptions?: IFCExportV2Options },
): BuildResult {
  const warnings: string[] = [];
  const elements: BIMSolid[] = [];

  // Group raw elements by type for proper ordering (walls before doors)
  const walls: RawBIMInput[] = [];
  const curtainWalls: RawBIMInput[] = [];
  const openings: RawBIMInput[] = [];
  const columns: RawBIMInput[] = [];
  const beams: RawBIMInput[] = [];
  const slabs: RawBIMInput[] = [];
  const foundations: RawBIMInput[] = [];
  const piles: RawBIMInput[] = [];
  const gradeBeams: RawBIMInput[] = [];
  const stairs: RawBIMInput[] = [];
  const ramps: RawBIMInput[] = [];
  const railings: RawBIMInput[] = [];
  const mep: RawBIMInput[] = [];
  const fixtures: RawBIMInput[] = [];
  const other: RawBIMInput[] = [];

  for (const raw of rawElements) {
    const t = (raw.type || '').toUpperCase();
    if (/CURTAIN.?WALL|STOREFRONT|FACADE/.test(t)) curtainWalls.push(raw);
    else if (/WALL|PARTITION/.test(t)) walls.push(raw);
    else if (/DOOR/.test(t)) openings.push(raw);
    else if (/WINDOW|GLAZING/.test(t)) openings.push(raw);
    else if (/COLUMN|PILLAR/.test(t)) columns.push(raw);
    else if (/GRADE.?BEAM/.test(t)) gradeBeams.push(raw);
    else if (/BEAM|GIRDER|JOIST/.test(t)) beams.push(raw);
    else if (/SLAB|FLOOR|DECK|ROOF/.test(t)) slabs.push(raw);
    else if (/PILE/.test(t)) piles.push(raw);
    else if (/FOOTING|FOUNDATION/.test(t)) foundations.push(raw);
    else if (/RAMP/.test(t)) ramps.push(raw);
    else if (/RAILING|GUARDRAIL|HANDRAIL/.test(t)) railings.push(raw);
    else if (/STAIR/.test(t)) stairs.push(raw);
    else if (/DUCT|PIPE|CABLE|CONDUIT/.test(t)) mep.push(raw);
    else if (/LIGHT|SPRINKLER|PANEL|RECEPTACLE|SWITCH|SMOKE/.test(t)) fixtures.push(raw);
    else other.push(raw);
  }

  // ── COLLECT OPENINGS PER WALL (for void cut) ─────────────────────────
  // Group openings by their hostId so we can pass them to createWall()
  // for proper boolean subtraction from the wall profile.
  const openingsByWallId = new Map<string, WallOpeningDef[]>();
  const orphanOpenings: RawBIMInput[] = []; // openings with no host wall

  for (const raw of openings) {
    const isDoor = /DOOR/i.test(raw.type || '');
    const width = raw.width || (isDoor ? 0.9 : 1.0);
    const height = raw.height || (isDoor ? 2.1 : 1.2);
    const sillHeight = raw.sillHeight || (isDoor ? 0 : 0.9);

    if (raw.hostId) {
      const wallOpenings = openingsByWallId.get(raw.hostId) || [];
      wallOpenings.push({
        type: isDoor ? 'door' : 'window',
        id: raw.id,
        name: raw.name || `${isDoor ? 'Door' : 'Window'} ${raw.id}`,
        position: raw.positionAlongWall || 1.0, // default 1m from wall start
        width,
        height,
        sillHeight,
        material: raw.material || (isDoor ? 'Wood' : 'Glass'),
      });
      openingsByWallId.set(raw.hostId, wallOpenings);
    } else {
      orphanOpenings.push(raw);
    }
  }

  // ── BUILD WALLS (with openings cut into them) ──────────────────────
  const wallMap = new Map<string, BIMSolid>();

  for (const raw of walls) {
    const storey = raw.storey || context.storeys[0]?.name || 'Level 1';
    const storeyInfo = context.storeys.find(s => s.name === storey) || context.storeys[0];
    const elevation = raw.elevation ?? storeyInfo?.elevation ?? 0;
    const height = raw.height || storeyInfo?.floorToFloorHeight || context.defaultWallHeight || 3.0;
    const isExterior = /EXT|EXTERIOR|FACADE/i.test(raw.type || '') || /EXT/i.test(raw.material || '');

    let start: Vec2, end: Vec2;
    if (raw.startX != null && raw.startY != null && raw.endX != null && raw.endY != null) {
      start = vec2(raw.startX, raw.startY);
      end = vec2(raw.endX, raw.endY);
    } else if (raw.x != null && raw.y != null && raw.length) {
      start = vec2(raw.x, raw.y);
      end = vec2(raw.x + raw.length, raw.y);
    } else {
      warnings.push(`Wall "${raw.name || raw.id}" missing position data — placed at origin`);
      start = vec2(0, 0);
      end = vec2(raw.length || 5, 0);
    }

    // Prefer extracted thickness from AI over assembly defaults
    let assembly = inferWallAssembly(raw.material, isExterior);
    if (raw.thickness && raw.thickness > 0) {
      const extractedThickness = raw.thickness;
      const materialName = raw.material || (isExterior ? 'Exterior Assembly' : 'Interior Assembly');
      const customAssembly: WallAssembly = {
        id: `CUSTOM_${raw.id}`,
        name: `${materialName} (extracted)`,
        layers: [{
          name: materialName,
          thickness: extractedThickness,
          material: materialName,
          isStructural: true,
          density: /CONCRETE|CAST/i.test(materialName) ? 2400
            : /CMU|BLOCK|MASONRY/i.test(materialName) ? 2100
            : /STEEL|METAL/i.test(materialName) ? 7850
            : /BRICK/i.test(materialName) ? 1920
            : undefined,
        }],
        totalThickness: extractedThickness,
      };
      assembly = customAssembly;
    }

    // Pass hosted openings so createWall() cuts voids in the wall profile
    const wallOpenings = openingsByWallId.get(raw.id) || [];

    const result = createWall({
      id: raw.id,
      name: raw.name || `Wall ${raw.id}`,
      start, end,
      height,
      assembly,
      storey,
      elevation,
      isExterior,
      openings: wallOpenings,
      source: (raw.source as BIMSolid['source']) || 'ai_modeled',
    });

    wallMap.set(raw.id, result.wall);
    elements.push(result.wall);

    // Push the opening elements created by createWall() (with proper geometry)
    for (const openingEl of result.openings) {
      elements.push(openingEl);
    }
  }

  // ── BUILD ORPHAN OPENINGS (doors/windows with no host wall) ────────
  for (const raw of orphanOpenings) {
    const storey = raw.storey || context.storeys[0]?.name || 'Level 1';
    const storeyInfo = context.storeys.find(s => s.name === storey) || context.storeys[0];
    const elevation = raw.elevation ?? storeyInfo?.elevation ?? 0;
    const isDoor = /DOOR/i.test(raw.type || '');

    const pos = vec3(raw.x || 0, raw.y || 0, elevation + (raw.sillHeight || (isDoor ? 0 : 0.9)));
    const width = raw.width || (isDoor ? 0.9 : 1.0);
    const height = raw.height || (isDoor ? 2.1 : 1.2);

    const fixture = createFixture({
      id: raw.id,
      name: raw.name || `${isDoor ? 'Door' : 'Window'} ${raw.id}`,
      type: 'generic',
      position: pos,
      storey,
      elevation,
      source: (raw.source as BIMSolid['source']) || 'ai_modeled',
    });

    fixture.type = isDoor ? 'Door' : 'Window';
    fixture.ifcClass = isDoor ? 'IFCDOOR' : 'IFCWINDOW';
    fixture.material = raw.material || (isDoor ? 'Wood' : 'Glass');
    fixture.quantities.width = width;
    fixture.quantities.height = height;

    // Try to auto-detect host wall by proximity
    let bestWall: BIMSolid | undefined;
    let bestDist = Infinity;
    for (const [, wall] of wallMap) {
      if (wall.storey !== storey) continue;
      const d = v3len(v3sub(pos, wall.origin));
      if (d < bestDist) { bestDist = d; bestWall = wall; }
    }
    if (bestWall && bestDist < 5) {
      fixture.hostId = bestWall.id;
      bestWall.hostedIds.push(fixture.id);
    }

    elements.push(fixture);
  }

  // ── BUILD COLUMNS ─────────────────────────────────────────────────────
  for (const raw of columns) {
    const storey = raw.storey || context.storeys[0]?.name || 'Level 1';
    const storeyInfo = context.storeys.find(s => s.name === storey) || context.storeys[0];
    const elevation = raw.elevation ?? storeyInfo?.elevation ?? 0;
    const height = raw.height || storeyInfo?.floorToFloorHeight || 3.0;

    // Try to resolve steel section from designation or name
    const sectionData = resolveSteelSection(raw);

    let shape: 'rectangular' | 'circular' | 'w-section';
    let width: number;
    let depth: number;
    let flangeWidth: number | undefined;
    let webThickness: number | undefined;
    let flangeThickness: number | undefined;

    if (raw.diameter) {
      shape = 'circular';
      width = raw.diameter;
      depth = raw.diameter;
    } else if (sectionData && sectionData.shape === 'w-section') {
      shape = 'w-section';
      width = sectionData.flangeWidth;
      depth = sectionData.depth;
      flangeWidth = sectionData.flangeWidth;
      webThickness = sectionData.webThickness;
      flangeThickness = sectionData.flangeThickness;
    } else if (sectionData && (sectionData.shape === 'hss-rect' || sectionData.shape === 'hss-round')) {
      shape = sectionData.shape === 'hss-round' ? 'circular' : 'rectangular';
      width = sectionData.flangeWidth;
      depth = sectionData.depth;
    } else if (raw.properties?.shape === 'w-section') {
      shape = 'w-section';
      width = raw.properties.flangeWidth || raw.width || 0.254;
      depth = raw.depth || raw.properties.depth || 0.254;
      flangeWidth = raw.properties.flangeWidth;
      webThickness = raw.properties.webThickness;
      flangeThickness = raw.properties.flangeThickness;
    } else {
      shape = 'rectangular';
      width = raw.width || raw.depth || 0.4;
      depth = raw.depth || raw.width || 0.4;
    }

    const material = raw.material || (sectionData ? 'Steel' : 'Concrete');

    elements.push(createColumn({
      id: raw.id,
      name: raw.name || `Column ${raw.id}`,
      center: vec2(raw.x || 0, raw.y || 0),
      width, depth, height,
      storey, elevation,
      shape,
      flangeWidth,
      webThickness,
      flangeThickness,
      material,
      source: (raw.source as BIMSolid['source']) || 'ai_modeled',
    }));
  }

  // ── BUILD BEAMS ───────────────────────────────────────────────────────
  for (const raw of beams) {
    const storey = raw.storey || context.storeys[0]?.name || 'Level 1';
    const storeyInfo = context.storeys.find(s => s.name === storey) || context.storeys[0];
    const elevation = raw.elevation ?? storeyInfo?.elevation ?? 0;
    const beamHeight = storeyInfo?.floorToFloorHeight || 3.0;

    const start = vec3(raw.startX || raw.x || 0, raw.startY || raw.y || 0, elevation + beamHeight);
    const end = vec3(raw.endX || (raw.x || 0) + (raw.length || 5), raw.endY || raw.y || 0, elevation + beamHeight);

    // Try to resolve steel section from designation or name
    const sectionData = resolveSteelSection(raw);

    let beamShape: 'rectangular' | 'w-section' | 'circular';
    let beamWidth: number;
    let beamDepth: number;
    let flangeWidth: number | undefined;
    let webThickness: number | undefined;
    let flangeThickness: number | undefined;

    if (sectionData && sectionData.shape === 'w-section') {
      beamShape = 'w-section';
      beamWidth = sectionData.flangeWidth;
      beamDepth = sectionData.depth;
      flangeWidth = sectionData.flangeWidth;
      webThickness = sectionData.webThickness;
      flangeThickness = sectionData.flangeThickness;
    } else if (sectionData && sectionData.shape === 'hss-round') {
      beamShape = 'circular';
      beamWidth = sectionData.depth;
      beamDepth = sectionData.depth;
    } else if (sectionData && sectionData.shape === 'hss-rect') {
      beamShape = 'rectangular';
      beamWidth = sectionData.flangeWidth;
      beamDepth = sectionData.depth;
    } else if (raw.properties?.shape === 'w-section') {
      beamShape = 'w-section';
      beamWidth = raw.properties.flangeWidth || raw.width || 0.254;
      beamDepth = raw.depth || raw.height || raw.properties.depth || 0.254;
      flangeWidth = raw.properties.flangeWidth;
      webThickness = raw.properties.webThickness;
      flangeThickness = raw.properties.flangeThickness;
    } else {
      beamShape = 'rectangular';
      beamWidth = raw.width || 0.3;
      beamDepth = raw.depth || raw.height || 0.5;
    }

    const material = raw.material || (sectionData ? 'Steel' : 'Concrete');

    elements.push(createBeam({
      id: raw.id,
      name: raw.name || `Beam ${raw.id}`,
      start, end,
      width: beamWidth,
      depth: beamDepth,
      storey, elevation,
      shape: beamShape,
      flangeWidth,
      webThickness,
      flangeThickness,
      material,
      source: (raw.source as BIMSolid['source']) || 'ai_modeled',
    }));
  }

  // ── BUILD SLABS ───────────────────────────────────────────────────────
  for (const raw of slabs) {
    const storey = raw.storey || context.storeys[0]?.name || 'Level 1';
    const storeyInfo = context.storeys.find(s => s.name === storey) || context.storeys[0];
    const elevation = raw.elevation ?? storeyInfo?.elevation ?? 0;
    const isRoof = /ROOF/i.test(raw.type || '');

    let boundary: Vec2[];
    if (raw.boundary && raw.boundary.length >= 3) {
      boundary = raw.boundary.map(p => vec2(p.x, p.y));
    } else if (context.footprint && context.footprint.length >= 3) {
      boundary = context.footprint;
    } else {
      // Default rectangular slab from dimensions
      const w = raw.width || raw.length || 20;
      const d = raw.depth || raw.width || 15;
      boundary = [vec2(0, 0), vec2(w, 0), vec2(w, d), vec2(0, d)];
    }

    elements.push(createSlab({
      id: raw.id,
      name: raw.name || `${isRoof ? 'Roof' : 'Floor'} Slab ${raw.id}`,
      boundary,
      thickness: raw.thickness || raw.height || context.defaultSlabThickness || 0.200,
      storey, elevation,
      material: raw.material || 'Concrete',
      isRoof,
      source: (raw.source as BIMSolid['source']) || 'ai_modeled',
    }));
  }

  // ── BUILD FOUNDATIONS (spread/strip footings) ────────────────────────
  for (const raw of foundations) {
    elements.push(createFooting({
      id: raw.id,
      name: raw.name || `Footing ${raw.id}`,
      center: vec2(raw.x || 0, raw.y || 0),
      width: raw.width || 1.5,
      depth: raw.depth || 1.5,
      height: raw.height || raw.thickness || 0.6,
      storey: raw.storey || 'Foundation',
      elevation: raw.elevation || -0.6,
      type: /STRIP/i.test(raw.type || '') ? 'strip'
        : /PILE.?CAP/i.test(raw.type || '') ? 'pile_cap'
        : 'spread',
      material: raw.material || 'Concrete',
      source: (raw.source as BIMSolid['source']) || 'ai_modeled',
    }));
  }

  // ── BUILD PILES (deep foundations) ──────────────────────────────────
  for (const raw of piles) {
    elements.push(createPile({
      id: raw.id,
      name: raw.name || `Pile ${raw.id}`,
      center: vec2(raw.x || 0, raw.y || 0),
      diameter: raw.diameter || raw.width || 0.45,
      length: raw.length || raw.depth || 15,
      storey: raw.storey || 'Foundation',
      elevation: raw.elevation || 0,
      type: /HELICAL/i.test(raw.type || '') ? 'helical'
        : /BORED|DRILLED/i.test(raw.type || '') ? 'bored'
        : /MICRO/i.test(raw.type || '') ? 'micropile'
        : 'driven',
      material: raw.material || 'Concrete',
      capacity: raw.properties?.capacity,
      source: (raw.source as BIMSolid['source']) || 'ai_modeled',
    }));
  }

  // ── BUILD GRADE BEAMS ───────────────────────────────────────────────
  for (const raw of gradeBeams) {
    const start = vec2(raw.startX || raw.x || 0, raw.startY || raw.y || 0);
    const end = vec2(raw.endX || (raw.x || 0) + (raw.length || 5), raw.endY || raw.y || 0);

    elements.push(createGradeBeam({
      id: raw.id,
      name: raw.name || `Grade Beam ${raw.id}`,
      start, end,
      width: raw.width || 0.4,
      depth: raw.depth || raw.height || 0.6,
      storey: raw.storey || 'Foundation',
      elevation: raw.elevation || 0,
      material: raw.material || 'Concrete',
      source: (raw.source as BIMSolid['source']) || 'ai_modeled',
    }));
  }

  // ── BUILD CURTAIN WALLS ─────────────────────────────────────────────
  for (const raw of curtainWalls) {
    const storey = raw.storey || context.storeys[0]?.name || 'Level 1';
    const storeyInfo = context.storeys.find(s => s.name === storey) || context.storeys[0];
    const elevation = raw.elevation ?? storeyInfo?.elevation ?? 0;
    const height = raw.height || storeyInfo?.floorToFloorHeight || 3.6;

    let start: Vec2, end: Vec2;
    if (raw.startX != null && raw.startY != null && raw.endX != null && raw.endY != null) {
      start = vec2(raw.startX, raw.startY);
      end = vec2(raw.endX, raw.endY);
    } else if (raw.x != null && raw.y != null && raw.length) {
      start = vec2(raw.x, raw.y);
      end = vec2(raw.x + raw.length, raw.y);
    } else {
      start = vec2(0, 0);
      end = vec2(raw.length || 10, 0);
    }

    const cwResult = createCurtainWall({
      id: raw.id,
      name: raw.name || `Curtain Wall ${raw.id}`,
      start, end,
      height,
      storey, elevation,
      panelWidth: raw.properties?.panelWidth || 1.5,
      panelHeight: raw.properties?.panelHeight || 1.8,
      mullionWidth: raw.properties?.mullionWidth || 0.065,
      mullionDepth: raw.properties?.mullionDepth || 0.15,
      panelThickness: raw.properties?.panelThickness || 0.025,
      panelMaterial: raw.material || 'Glass',
      mullionMaterial: raw.properties?.mullionMaterial || 'Aluminum',
      source: (raw.source as BIMSolid['source']) || 'ai_modeled',
    });

    elements.push(cwResult.wall);
    elements.push(...cwResult.panels);
    elements.push(...cwResult.mullions);
  }

  // ── BUILD STAIRS ──────────────────────────────────────────────────────
  for (const raw of stairs) {
    const storey = raw.storey || context.storeys[0]?.name || 'Level 1';
    const storeyInfo = context.storeys.find(s => s.name === storey) || context.storeys[0];
    const elevation = raw.elevation ?? storeyInfo?.elevation ?? 0;
    const totalHeight = raw.height || storeyInfo?.floorToFloorHeight || 3.0;
    const numRisers = Math.round(totalHeight / 0.178); // 178mm risers (OBC max)

    elements.push(createStair({
      id: raw.id,
      name: raw.name || `Stair ${raw.id}`,
      origin: vec3(raw.x || 0, raw.y || 0, elevation),
      width: raw.width || 1.2,
      riserHeight: totalHeight / numRisers,
      treadDepth: 0.279,
      numRisers,
      rotation: 0,
      storey, elevation,
      material: raw.material || 'Concrete',
      source: (raw.source as BIMSolid['source']) || 'ai_modeled',
    }));
  }

  // ── BUILD RAMPS ────────────────────────────────────────────────────
  for (const raw of ramps) {
    const storey = raw.storey || context.storeys[0]?.name || 'Level 1';
    const storeyInfo = context.storeys.find(s => s.name === storey) || context.storeys[0];
    const elevation = raw.elevation ?? storeyInfo?.elevation ?? 0;
    const riseHeight = raw.height || 1.0;
    const runLength = raw.length || riseHeight / Math.tan(Math.atan(1 / 12)); // 1:12 slope per OBC

    elements.push(createRamp({
      id: raw.id,
      name: raw.name || `Ramp ${raw.id}`,
      origin: vec3(raw.x || 0, raw.y || 0, elevation),
      width: raw.width || 1.5,
      length: runLength,
      riseHeight,
      thickness: raw.thickness || 0.2,
      rotation: 0,
      storey, elevation,
      material: raw.material || 'Concrete',
      source: (raw.source as BIMSolid['source']) || 'ai_modeled',
    }));
  }

  // ── BUILD RAILINGS ──────────────────────────────────────────────────
  for (const raw of railings) {
    const storey = raw.storey || context.storeys[0]?.name || 'Level 1';
    const storeyInfo = context.storeys.find(s => s.name === storey) || context.storeys[0];
    const elevation = raw.elevation ?? storeyInfo?.elevation ?? 0;

    const path = raw.path?.map(p => vec3(p.x, p.y, p.z))
      || [vec3(raw.x || 0, raw.y || 0, elevation), vec3((raw.x || 0) + (raw.length || 3), raw.y || 0, elevation)];

    elements.push(createRailing({
      id: raw.id,
      name: raw.name || `Railing ${raw.id}`,
      path,
      height: raw.height || 1.07, // 1070mm per OBC
      postSpacing: 1.2,
      postSize: 0.05,
      railDiameter: 0.042,
      storey, elevation,
      material: raw.material || 'Steel',
      source: (raw.source as BIMSolid['source']) || 'ai_modeled',
    }));
  }

  // ── BUILD MEP ─────────────────────────────────────────────────────────
  for (const raw of mep) {
    const storey = raw.storey || context.storeys[0]?.name || 'Level 1';
    const storeyInfo = context.storeys.find(s => s.name === storey) || context.storeys[0];
    const elevation = raw.elevation ?? storeyInfo?.elevation ?? 0;

    const path = raw.path?.map(p => vec3(p.x, p.y, p.z))
      || [vec3(raw.x || 0, raw.y || 0, elevation + 3), vec3((raw.x || 0) + (raw.length || 5), raw.y || 0, elevation + 3)];

    if (/DUCT|HVAC/i.test(raw.type || '')) {
      elements.push(createDuct({
        id: raw.id,
        name: raw.name || `Duct ${raw.id}`,
        path,
        width: raw.width || raw.diameter || 0.3,
        height: raw.height || raw.width || 0.3,
        shape: raw.shape || (raw.diameter ? 'circular' : 'rectangular'),
        insulated: true,
        storey, elevation,
        material: raw.material || 'Galvanized Steel',
        source: (raw.source as BIMSolid['source']) || 'ai_modeled',
      }));
    } else if (/PIPE/i.test(raw.type || '')) {
      elements.push(createPipe({
        id: raw.id,
        name: raw.name || `Pipe ${raw.id}`,
        path,
        diameter: raw.diameter || raw.width || 0.05,
        wallThickness: (raw.diameter || 0.05) * 0.05,
        storey, elevation,
        material: raw.material || 'Copper',
        system: 'domestic_cold',
        source: (raw.source as BIMSolid['source']) || 'ai_modeled',
      }));
    } else if (/CABLE|CONDUIT|TRAY/i.test(raw.type || '')) {
      elements.push(createCableTray({
        id: raw.id,
        name: raw.name || `Cable Tray ${raw.id}`,
        path,
        width: raw.width || 0.3,
        height: raw.height || 0.1,
        storey, elevation,
        material: raw.material || 'Steel',
        source: (raw.source as BIMSolid['source']) || 'ai_modeled',
      }));
    }
  }

  // ── BUILD FIXTURES ────────────────────────────────────────────────────
  for (const raw of fixtures) {
    const storey = raw.storey || context.storeys[0]?.name || 'Level 1';
    const storeyInfo = context.storeys.find(s => s.name === storey) || context.storeys[0];
    const elevation = raw.elevation ?? storeyInfo?.elevation ?? 0;

    let fType: 'light' | 'receptacle' | 'switch' | 'panel' | 'sprinkler' | 'smoke_detector' | 'generic' = 'generic';
    const t = (raw.type || '').toUpperCase();
    if (/LIGHT|LUMINAIRE/.test(t)) fType = 'light';
    else if (/SPRINKLER/.test(t)) fType = 'sprinkler';
    else if (/PANEL/.test(t)) fType = 'panel';
    else if (/RECEPTACLE|OUTLET/.test(t)) fType = 'receptacle';
    else if (/SWITCH/.test(t)) fType = 'switch';
    else if (/SMOKE|DETECTOR/.test(t)) fType = 'smoke_detector';

    elements.push(createFixture({
      id: raw.id,
      name: raw.name || `${fType} ${raw.id}`,
      type: fType,
      position: vec3(raw.x || 0, raw.y || 0, elevation + (raw.z || (fType === 'light' ? 2.8 : 1.2))),
      storey, elevation,
      source: (raw.source as BIMSolid['source']) || 'ai_modeled',
    }));
  }

  // ── BUILD OTHER ───────────────────────────────────────────────────────
  for (const raw of other) {
    const storey = raw.storey || context.storeys[0]?.name || 'Level 1';
    const storeyInfo = context.storeys.find(s => s.name === storey) || context.storeys[0];
    const elevation = raw.elevation ?? storeyInfo?.elevation ?? 0;

    elements.push(createFixture({
      id: raw.id,
      name: raw.name || `Element ${raw.id}`,
      type: 'generic',
      position: vec3(raw.x || 0, raw.y || 0, elevation),
      storey, elevation,
      source: (raw.source as BIMSolid['source']) || 'ai_modeled',
    }));
  }

  // ── REBAR GENERATION (for concrete elements) ────────────────────────
  if (context.generateRebar) {
    const concreteElements = elements.filter(e =>
      /concrete/i.test(e.material) && /slab|beam|column|footing|wall|grade.beam/i.test(e.type)
    );
    for (const el of concreteElements) {
      const elementType = /slab|floor/i.test(el.type) ? 'slab'
        : /beam/i.test(el.type) ? 'beam'
        : /column/i.test(el.type) ? 'column'
        : /wall/i.test(el.type) ? 'wall'
        : 'footing';

      const { bars, rebarInfo } = generateRebarGeometry({
        hostElement: el,
        elementType,
        cover: elementType === 'footing' ? 75 : 40,
        topBarDesignation: elementType === 'slab' ? '15M' : '20M',
        topBarSpacing: elementType === 'slab' ? 300 : 200,
        bottomBarDesignation: elementType === 'slab' ? '15M' : '20M',
        bottomBarSpacing: elementType === 'slab' ? 300 : 200,
        stirrupDesignation: (elementType === 'beam' || elementType === 'column') ? '10M' : undefined,
        stirrupSpacing: (elementType === 'beam' || elementType === 'column') ? 200 : undefined,
      });

      el.rebar = rebarInfo;
      elements.push(...bars);
    }
  }

  // ── STEEL CONNECTION GENERATION ────────────────────────────────────
  if (context.generateConnections) {
    const steelBeams = elements.filter(e => /beam/i.test(e.type) && /steel/i.test(e.material));
    const steelColumns = elements.filter(e => /column/i.test(e.type) && /steel/i.test(e.material));

    for (const beam of steelBeams) {
      // Find closest column to beam start
      let closestCol: BIMSolid | undefined;
      let closestDist = Infinity;
      for (const col of steelColumns) {
        if (col.storey !== beam.storey) continue;
        const d = v3len(v3sub(beam.origin, col.origin));
        if (d < closestDist && d < 1.0) { closestDist = d; closestCol = col; }
      }

      if (closestCol) {
        const { elements: connElements, detail } = createSteelConnection({
          id: `conn_${beam.id}_${closestCol.id}`,
          type: 'shear_tab',
          beamElement: beam,
          supportElement: closestCol,
        });
        beam.connections = beam.connections || [];
        beam.connections.push(detail);
        elements.push(...connElements);
      }
    }
  }

  // ── PARAMETRIC CONSTRAINTS PIPELINE ─────────────────────────────────
  // Runs: wall auto-joins, beam-column snapping, trim/extend,
  //       phase assignment, LOD classification, workset assignment, revision tracking
  const constraintResults = runConstraintsPipeline(elements, {
    revisionNumber: context.revisionNumber,
    revisionId: context.revisionId,
    previousElements: context.previousElements,
  });

  // ── CLASH DETECTION ───────────────────────────────────────────────────
  let clashes: ClashResult[] = [];
  let clashSummary: ClashSummary = { total: 0, bySeverity: { critical: 0, major: 0, minor: 0, info: 0 }, byType: { hard: 0, soft: 0, clearance: 0 }, byDiscipline: {}, topClashes: [] };

  if (options?.runClashCheck !== false && elements.length > 1) {
    clashes = runClashDetection(elements, {
      ignoreSameHost: true,
      excludePairs: [
        ['Floor Slab', 'Wall'], ['Floor Slab', 'Column'],
        ['Rebar', 'Rebar'], ['Bolt', 'Connection Plate'],
        ['Mullion', 'Curtain Wall Panel'],
      ],
    });
    clashSummary = summarizeClashes(clashes);
  }

  // ── IFC EXPORT ────────────────────────────────────────────────────────
  let ifcContent: string | undefined;
  if (options?.generateIFC) {
    ifcContent = exportBIMToIFC4(elements, {
      projectName: context.name,
      ...options.ifcOptions,
    });
  }

  // ── STATS ─────────────────────────────────────────────────────────────
  const byType: Record<string, number> = {};
  const byStorey: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let totalVolume = 0, totalArea = 0;

  for (const el of elements) {
    byType[el.type] = (byType[el.type] || 0) + 1;
    byStorey[el.storey] = (byStorey[el.storey] || 0) + 1;
    byCategory[el.category] = (byCategory[el.category] || 0) + 1;
    totalVolume += el.quantities.volume;
    totalArea += el.quantities.surfaceArea;
  }

  return {
    elements,
    clashes,
    clashSummary,
    constraints: constraintResults,
    stats: {
      totalElements: elements.length,
      byType, byStorey, byCategory,
      totalVolume, totalArea,
      withGeometry: elements.filter(e => e.mesh.triangles.length > 0).length,
      lodDistribution: constraintResults.lodDistribution,
      worksetDistribution: constraintResults.worksetDistribution,
      phaseDistribution: constraintResults.phaseDistribution,
    },
    ifcContent,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FILE IMPORT DISPATCHER
// ═══════════════════════════════════════════════════════════════════════════════

export interface FileImportResult {
  elements: BIMSolid[];
  format: 'ifc' | 'dxf' | 'dwg' | 'pdf' | 'unknown';
  projectName?: string;
  storeys: { name: string; elevation: number }[];
  stats: Record<string, any>;
  warnings: string[];
}

/**
 * Import a file and convert to BIMSolid array.
 * Auto-detects format from content/extension.
 */
export async function importFile(
  content: string | Buffer,
  filename: string,
  options?: { storey?: string; elevation?: number; defaultFloorHeight?: number },
): Promise<FileImportResult> {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const textContent = typeof content === 'string' ? content : content.toString('utf-8');

  // IFC detection
  if (ext === 'ifc' || textContent.includes('ISO-10303-21') || textContent.includes('FILE_SCHEMA')) {
    const result = importIFC(textContent);
    return {
      elements: result.elements,
      format: 'ifc',
      projectName: result.projectName,
      storeys: result.storeys.map(s => ({ name: s.name, elevation: s.elevation })),
      stats: result.stats,
      warnings: [],
    };
  }

  // DXF detection
  if (ext === 'dxf' || isDXFContent(textContent)) {
    const parsed = await parseDXF(textContent);
    const result = convertDXFToBIM(parsed, {
      defaultFloorHeight: options?.defaultFloorHeight || 3.0,
      defaultWallThickness: 0.2,
      storey: options?.storey || 'Level 1',
      elevation: options?.elevation || 0,
    });
    return {
      elements: result.elements,
      format: 'dxf',
      storeys: [{ name: options?.storey || 'Level 1', elevation: options?.elevation || 0 }],
      stats: result.stats,
      warnings: result.warnings,
    };
  }

  // DWG detection (binary)
  if (ext === 'dwg' && Buffer.isBuffer(content)) {
    return {
      elements: [],
      format: 'dwg',
      storeys: [],
      stats: { message: 'DWG binary import requires ODA File Converter. Please export as DXF or IFC from your CAD software.' },
      warnings: ['DWG binary format detected. For best results, export as IFC or DXF from your CAD software.'],
    };
  }

  return {
    elements: [],
    format: 'unknown',
    storeys: [],
    stats: {},
    warnings: [`Unrecognized file format: ${ext}`],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STEEL SECTION RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Try to resolve a steel section from the raw element data.
 * Checks (in order):
 *   1. raw.sectionDesignation (explicit field)
 *   2. raw.properties.sectionDesignation
 *   3. raw.properties.profileName
 *   4. raw.name (parse W/HSS designation from free text)
 *   5. raw.material (parse from material string like "Steel W10x49")
 */
function resolveSteelSection(raw: RawBIMInput): SteelSectionData | null {
  // 1. Explicit designation field
  if (raw.sectionDesignation) {
    const section = lookupSteelSection(raw.sectionDesignation);
    if (section) return section;
  }

  // 2-3. Properties object
  const props = raw.properties || {};
  for (const key of ['sectionDesignation', 'profileName', 'section', 'steelSection', 'memberSize']) {
    if (props[key]) {
      const section = lookupSteelSection(props[key]);
      if (section) return section;
      // Also try parsing from free text
      const parsed = parseSectionFromText(props[key]);
      if (parsed) return lookupSteelSection(parsed);
    }
  }

  // 4. Parse from element name
  if (raw.name) {
    const parsed = parseSectionFromText(raw.name);
    if (parsed) return lookupSteelSection(parsed);
  }

  // 5. Parse from material string
  if (raw.material) {
    const parsed = parseSectionFromText(raw.material);
    if (parsed) return lookupSteelSection(parsed);
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ELEMENT → VIEWER DATA (for 3D viewer transport)
// ═══════════════════════════════════════════════════════════════════════════════

export interface ViewerElement {
  id: string;
  type: string;
  name: string;
  category: string;
  storey: string;
  material: string;
  origin: Vec3;
  rotation: number;
  mesh: SerializedMesh;
  boundingBox: { min: Vec3; max: Vec3 };
  quantities: BIMSolid['quantities'];
  color?: string;              // hex color for viewer
  opacity?: number;
  hostId?: string;
  ifcClass: string;
  source: string;
}

/** Convert BIMSolid array to viewer-ready format */
export function toViewerElements(elements: BIMSolid[]): ViewerElement[] {
  return elements.map(el => ({
    id: el.id,
    type: el.type,
    name: el.name,
    category: el.category,
    storey: el.storey,
    material: el.material,
    origin: el.origin,
    rotation: el.rotation,
    mesh: serializeBIMSolid(el),
    boundingBox: { min: el.boundingBox.min, max: el.boundingBox.max },
    quantities: el.quantities,
    color: getElementColor(el),
    opacity: getElementOpacity(el),
    hostId: el.hostId,
    ifcClass: el.ifcClass,
    source: el.source,
  }));
}

function getElementColor(el: BIMSolid): string {
  const t = el.type.toLowerCase();
  if (/exterior wall/.test(t)) return '#C4A882';
  if (/interior wall|partition/.test(t)) return '#E8DCC8';
  if (/curtain/.test(t)) return '#88CCEE';
  if (/column/.test(t)) return '#808080';
  if (/beam/.test(t)) return '#A0A0A0';
  if (/slab|floor/.test(t)) return '#D0D0D0';
  if (/roof/.test(t)) return '#8B4513';
  if (/door/.test(t)) return '#8B6914';
  if (/window/.test(t)) return '#4FC3F7';
  if (/stair/.test(t)) return '#B0B0B0';
  if (/footing|foundation/.test(t)) return '#696969';
  if (/duct/.test(t)) return '#4CAF50';
  if (/pipe/.test(t)) return '#2196F3';
  if (/cable|tray/.test(t)) return '#FF9800';
  if (/light/.test(t)) return '#FFEB3B';
  if (/sprinkler/.test(t)) return '#F44336';
  if (/panel/.test(t)) return '#9C27B0';
  return '#CCCCCC';
}

function getElementOpacity(el: BIMSolid): number {
  if (/window|glazing|curtain/i.test(el.type)) return 0.4;
  if (/door/i.test(el.type)) return 0.8;
  return 1.0;
}
