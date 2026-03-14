/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  MEP ROUTING ENGINE — Automatic duct/pipe/cable tray routing
 *  Creates 3D paths with proper fittings, elbows, transitions, and tees.
 *  Routes avoid structural elements via simple obstacle avoidance.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import {
  type Vec3, vec3, v3add, v3sub, v3scale, v3normalize, v3len, v3cross, v3dot,
} from './geometry-kernel';

import {
  type BIMSolid,
  createDuct, createPipe, createCableTray, createFixture,
  type DuctParams, type PipeParams, type CableTrayParams,
} from './parametric-elements';

// ═══════════════════════════════════════════════════════════════════════════════
//  ROUTING TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type MEPSystem =
  | 'supply_air' | 'return_air' | 'exhaust_air' | 'outside_air'
  | 'domestic_hot' | 'domestic_cold' | 'sanitary' | 'storm' | 'fire_protection'
  | 'hydronic_supply' | 'hydronic_return'
  | 'power' | 'lighting' | 'data' | 'fire_alarm';

export interface MEPRunDef {
  id: string;
  name: string;
  system: MEPSystem;
  endpoints: Vec3[];           // ordered list of connection points
  size: number;                // width/diameter in metres
  sizeHeight?: number;         // for rectangular ducts
  shape: 'circular' | 'rectangular';
  material: string;
  storey: string;
  elevation: number;           // base elevation for horizontal runs
  insulated?: boolean;
  insulationThickness?: number;
}

export interface FittingDef {
  type: 'elbow' | 'tee' | 'reducer' | 'cap' | 'valve' | 'damper';
  position: Vec3;
  angle?: number;              // for elbows (degrees)
  size: number;
}

export interface RoutingResult {
  segments: BIMSolid[];
  fittings: FittingDef[];
  totalLength: number;
  turnsCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SYSTEM → DEFAULT PARAMETERS
// ═══════════════════════════════════════════════════════════════════════════════

interface SystemDefaults {
  defaultHeight: number;     // mounting height above floor
  material: string;
  insulated: boolean;
  insulationThickness: number;
  discipline: 'Mechanical' | 'Plumbing' | 'Electrical' | 'Fire Protection';
}

const SYSTEM_DEFAULTS: Record<MEPSystem, SystemDefaults> = {
  supply_air:       { defaultHeight: 3.0, material: 'Galvanized Steel', insulated: true, insulationThickness: 0.025, discipline: 'Mechanical' },
  return_air:       { defaultHeight: 3.0, material: 'Galvanized Steel', insulated: false, insulationThickness: 0, discipline: 'Mechanical' },
  exhaust_air:      { defaultHeight: 3.2, material: 'Galvanized Steel', insulated: false, insulationThickness: 0, discipline: 'Mechanical' },
  outside_air:      { defaultHeight: 3.0, material: 'Galvanized Steel', insulated: true, insulationThickness: 0.050, discipline: 'Mechanical' },
  domestic_hot:     { defaultHeight: 2.8, material: 'Copper', insulated: true, insulationThickness: 0.013, discipline: 'Plumbing' },
  domestic_cold:    { defaultHeight: 2.8, material: 'Copper', insulated: false, insulationThickness: 0, discipline: 'Plumbing' },
  sanitary:         { defaultHeight: 0.3, material: 'Cast Iron', insulated: false, insulationThickness: 0, discipline: 'Plumbing' },
  storm:            { defaultHeight: 0.3, material: 'PVC', insulated: false, insulationThickness: 0, discipline: 'Plumbing' },
  fire_protection:  { defaultHeight: 3.0, material: 'Steel', insulated: false, insulationThickness: 0, discipline: 'Fire Protection' },
  hydronic_supply:  { defaultHeight: 3.0, material: 'Steel', insulated: true, insulationThickness: 0.025, discipline: 'Mechanical' },
  hydronic_return:  { defaultHeight: 3.0, material: 'Steel', insulated: true, insulationThickness: 0.025, discipline: 'Mechanical' },
  power:            { defaultHeight: 3.2, material: 'Steel', insulated: false, insulationThickness: 0, discipline: 'Electrical' },
  lighting:         { defaultHeight: 3.2, material: 'Steel', insulated: false, insulationThickness: 0, discipline: 'Electrical' },
  data:             { defaultHeight: 3.2, material: 'Steel', insulated: false, insulationThickness: 0, discipline: 'Electrical' },
  fire_alarm:       { defaultHeight: 3.2, material: 'Steel', insulated: false, insulationThickness: 0, discipline: 'Electrical' },
};

// ═══════════════════════════════════════════════════════════════════════════════
//  ROUTE GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a routed MEP run from endpoint definitions.
 * Creates orthogonal routing with proper elbows at turns.
 */
export function routeMEPRun(def: MEPRunDef): RoutingResult {
  const defaults = SYSTEM_DEFAULTS[def.system];
  const isduct = ['supply_air', 'return_air', 'exhaust_air', 'outside_air'].includes(def.system);
  const isPipe = ['domestic_hot', 'domestic_cold', 'sanitary', 'storm', 'fire_protection', 'hydronic_supply', 'hydronic_return'].includes(def.system);
  const isTray = ['power', 'lighting', 'data', 'fire_alarm'].includes(def.system);

  // Build the 3D path through all endpoints with orthogonal routing
  const routedPath = buildOrthogonalRoute(def.endpoints, def.elevation + defaults.defaultHeight);
  const fittings: FittingDef[] = [];

  // Detect turns and create fitting definitions
  for (let i = 1; i < routedPath.length - 1; i++) {
    const prev = routedPath[i - 1];
    const curr = routedPath[i];
    const next = routedPath[i + 1];
    const d1 = v3normalize(v3sub(curr, prev));
    const d2 = v3normalize(v3sub(next, curr));
    const dot = v3dot(d1, d2);

    if (Math.abs(dot) < 0.99) { // There's a turn
      const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
      fittings.push({
        type: 'elbow',
        position: curr,
        angle,
        size: def.size,
      });
    }
  }

  // Split path into segments between fittings (each segment is one straight run)
  const segments: BIMSolid[] = [];
  let segIdx = 0;

  // Create the full run as a single element
  if (routedPath.length >= 2) {
    if (isduct) {
      const duct = createDuct({
        id: `${def.id}_seg${segIdx}`,
        name: `${def.name}`,
        path: routedPath,
        width: def.size,
        height: def.sizeHeight || def.size,
        shape: def.shape,
        insulated: def.insulated ?? defaults.insulated,
        insulationThickness: def.insulationThickness ?? defaults.insulationThickness,
        storey: def.storey,
        elevation: def.elevation,
        material: def.material || defaults.material,
        source: 'ai_modeled',
      });
      segments.push(duct);
    } else if (isPipe) {
      const pipe = createPipe({
        id: `${def.id}_seg${segIdx}`,
        name: `${def.name}`,
        path: routedPath,
        diameter: def.size,
        wallThickness: def.size * 0.05,
        storey: def.storey,
        elevation: def.elevation,
        material: def.material || defaults.material,
        system: def.system as PipeParams['system'],
        source: 'ai_modeled',
      });
      segments.push(pipe);
    } else if (isTray) {
      const tray = createCableTray({
        id: `${def.id}_seg${segIdx}`,
        name: `${def.name}`,
        path: routedPath,
        width: def.size,
        height: def.sizeHeight || 0.1,
        storey: def.storey,
        elevation: def.elevation,
        material: def.material || defaults.material,
        source: 'ai_modeled',
      });
      segments.push(tray);
    }
  }

  // Calculate total length
  let totalLength = 0;
  for (let i = 0; i < routedPath.length - 1; i++) {
    totalLength += v3len(v3sub(routedPath[i + 1], routedPath[i]));
  }

  return {
    segments,
    fittings,
    totalLength,
    turnsCount: fittings.length,
  };
}

/**
 * Build an orthogonal route between a series of endpoints.
 * Routes run horizontally at the specified height, with vertical risers at ends.
 */
function buildOrthogonalRoute(endpoints: Vec3[], routingHeight: number): Vec3[] {
  if (endpoints.length < 2) return endpoints;

  const route: Vec3[] = [];

  for (let i = 0; i < endpoints.length; i++) {
    const pt = endpoints[i];

    if (i === 0) {
      // Start point: rise to routing height if needed
      if (Math.abs(pt.z - routingHeight) > 0.1) {
        route.push(pt);
        route.push(vec3(pt.x, pt.y, routingHeight));
      } else {
        route.push(vec3(pt.x, pt.y, routingHeight));
      }
    } else {
      const prev = endpoints[i - 1];
      const prevRouting = vec3(prev.x, prev.y, routingHeight);
      const currRouting = vec3(pt.x, pt.y, routingHeight);

      // Create L-shaped or U-shaped route between points
      const dx = Math.abs(currRouting.x - prevRouting.x);
      const dy = Math.abs(currRouting.y - prevRouting.y);

      if (dx > 0.1 && dy > 0.1) {
        // Need an L-shaped route: go X first, then Y
        route.push(vec3(currRouting.x, prevRouting.y, routingHeight));
      }

      route.push(currRouting);

      // Drop to endpoint if needed
      if (Math.abs(pt.z - routingHeight) > 0.1) {
        route.push(pt);
      }
    }
  }

  return route;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SPRINKLER LAYOUT
// ═══════════════════════════════════════════════════════════════════════════════

export interface SprinklerLayoutParams {
  boundary: Vec3[];              // room/zone boundary polygon (at ceiling height)
  spacing: number;               // max spacing (metres, typically 3.0-4.6)
  coverageArea: number;          // max coverage per head (m², typically 12-21)
  storey: string;
  elevation: number;             // ceiling height
  type: 'pendant' | 'upright' | 'sidewall';
}

export function layoutSprinklers(params: SprinklerLayoutParams): BIMSolid[] {
  const heads: BIMSolid[] = [];

  // Compute bounding box of boundary
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of params.boundary) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const spacing = params.spacing;
  const halfSpacing = spacing / 2;
  let idx = 0;

  for (let x = minX + halfSpacing; x < maxX; x += spacing) {
    for (let y = minY + halfSpacing; y < maxY; y += spacing) {
      // Check if point is inside boundary (ray casting)
      if (pointInPoly3D(vec3(x, y, params.elevation), params.boundary)) {
        heads.push(createFixture({
          id: `sprinkler_${params.storey}_${idx++}`,
          name: `Sprinkler Head ${idx}`,
          type: 'sprinkler',
          position: vec3(x, y, params.elevation),
          storey: params.storey,
          elevation: params.elevation,
          source: 'ai_modeled',
        }));
      }
    }
  }

  return heads;
}

function pointInPoly3D(p: Vec3, poly: Vec3[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i], pj = poly[j];
    const intersect = ((pi.y > p.y) !== (pj.y > p.y)) &&
      (p.x < (pj.x - pi.x) * (p.y - pi.y) / ((pj.y - pi.y) || 1e-9) + pi.x);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LIGHT FIXTURE LAYOUT
// ═══════════════════════════════════════════════════════════════════════════════

export interface LightLayoutParams {
  boundary: Vec3[];
  spacing: number;               // metres between fixtures
  storey: string;
  elevation: number;             // mounting height
  fixtureType: 'recessed_2x4' | 'recessed_2x2' | 'linear' | 'pendant' | 'surface';
}

export function layoutLights(params: LightLayoutParams): BIMSolid[] {
  const lights: BIMSolid[] = [];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of params.boundary) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const spacing = params.spacing;
  const halfSpacing = spacing / 2;
  let idx = 0;

  for (let x = minX + halfSpacing; x < maxX; x += spacing) {
    for (let y = minY + halfSpacing; y < maxY; y += spacing) {
      if (pointInPoly3D(vec3(x, y, params.elevation), params.boundary)) {
        lights.push(createFixture({
          id: `light_${params.storey}_${idx++}`,
          name: `Light Fixture ${idx} (${params.fixtureType})`,
          type: 'light',
          position: vec3(x, y, params.elevation),
          storey: params.storey,
          elevation: params.elevation,
          source: 'ai_modeled',
        }));
      }
    }
  }

  return lights;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTO-ROUTING ENGINE — A* pathfinding with obstacle avoidance
//  Routes MEP runs around structural elements (columns, walls, beams)
// ═══════════════════════════════════════════════════════════════════════════════

import type { AABB } from './geometry-kernel';
import { aabbOverlap } from './geometry-kernel';

export interface AutoRoutingParams {
  id: string;
  name: string;
  system: MEPSystem;
  source: Vec3;                    // equipment/riser origin
  targets: Vec3[];                 // terminal endpoints (diffusers, fixtures, etc.)
  size: number;                    // duct/pipe size in metres
  sizeHeight?: number;
  shape: 'circular' | 'rectangular';
  material?: string;
  storey: string;
  elevation: number;
  obstacles: AABB[];               // structural elements to avoid
  gridResolution?: number;         // routing grid cell size (metres, default 0.3)
  clearance?: number;              // minimum clearance from obstacles (metres, default 0.15)
}

export interface AutoRoutingResult {
  runs: RoutingResult[];
  totalLength: number;
  totalTurns: number;
  unreachableTargets: Vec3[];
}

/**
 * Auto-route MEP runs from a source to multiple targets, avoiding obstacles.
 * Uses grid-based A* pathfinding with orthogonal movement.
 */
export function autoRouteMEP(params: AutoRoutingParams): AutoRoutingResult {
  const defaults = SYSTEM_DEFAULTS[params.system];
  const routingZ = params.elevation + defaults.defaultHeight;
  const gridRes = params.gridResolution || 0.3;
  const clearance = params.clearance || 0.15;

  // Expand obstacles by clearance + half duct size
  const expandedObstacles = params.obstacles.map(obs => ({
    min: vec3(obs.min.x - clearance - params.size / 2, obs.min.y - clearance - params.size / 2, obs.min.z - clearance),
    max: vec3(obs.max.x + clearance + params.size / 2, obs.max.y + clearance + params.size / 2, obs.max.z + clearance),
  }));

  // Compute bounding region for the routing grid
  const allPoints = [params.source, ...params.targets];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of allPoints) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  minX -= 2; minY -= 2; maxX += 2; maxY += 2;

  const runs: RoutingResult[] = [];
  const unreachableTargets: Vec3[] = [];
  let totalLength = 0;
  let totalTurns = 0;

  // Route to each target independently from source
  for (let ti = 0; ti < params.targets.length; ti++) {
    const target = params.targets[ti];
    const path = aStarRoute(
      vec3(params.source.x, params.source.y, routingZ),
      vec3(target.x, target.y, routingZ),
      expandedObstacles,
      gridRes,
      minX, minY, maxX, maxY,
    );

    if (!path) {
      unreachableTargets.push(target);
      continue;
    }

    // Create the run from the found path
    const fullPath = [params.source, ...path, target];
    const run = routeMEPRun({
      id: `${params.id}_run_${ti}`,
      name: `${params.name} Run ${ti + 1}`,
      system: params.system,
      endpoints: fullPath,
      size: params.size,
      sizeHeight: params.sizeHeight,
      shape: params.shape,
      material: params.material || defaults.material,
      storey: params.storey,
      elevation: params.elevation,
      insulated: defaults.insulated,
      insulationThickness: defaults.insulationThickness,
    });

    runs.push(run);
    totalLength += run.totalLength;
    totalTurns += run.turnsCount;
  }

  return { runs, totalLength, totalTurns, unreachableTargets };
}

/**
 * A* pathfinding on a 2D grid at a fixed Z height.
 * Returns a series of waypoints (at grid intersections) from start to goal,
 * or null if no path exists.
 */
function aStarRoute(
  start: Vec3,
  goal: Vec3,
  obstacles: AABB[],
  gridRes: number,
  minX: number, minY: number, maxX: number, maxY: number,
): Vec3[] | null {
  const cols = Math.ceil((maxX - minX) / gridRes);
  const rows = Math.ceil((maxY - minY) / gridRes);
  const z = start.z;

  function toGrid(x: number, y: number): [number, number] {
    return [Math.round((x - minX) / gridRes), Math.round((y - minY) / gridRes)];
  }
  function toWorld(col: number, row: number): Vec3 {
    return vec3(minX + col * gridRes, minY + row * gridRes, z);
  }
  function key(col: number, row: number): number {
    return col * 100000 + row;
  }

  // Check if a grid cell is blocked
  function isBlocked(col: number, row: number): boolean {
    if (col < 0 || col >= cols || row < 0 || row >= rows) return true;
    const wp = toWorld(col, row);
    const cellBB: AABB = {
      min: vec3(wp.x - gridRes / 2, wp.y - gridRes / 2, z - 0.5),
      max: vec3(wp.x + gridRes / 2, wp.y + gridRes / 2, z + 0.5),
    };
    for (const obs of obstacles) {
      if (aabbOverlap(cellBB, obs)) return true;
    }
    return false;
  }

  const [startC, startR] = toGrid(start.x, start.y);
  const [goalC, goalR] = toGrid(goal.x, goal.y);

  // A* with Manhattan heuristic (orthogonal movement only)
  const openSet = new Map<number, { col: number; row: number; g: number; f: number }>();
  const closedSet = new Set<number>();
  const cameFrom = new Map<number, number>();

  const startKey = key(startC, startR);
  openSet.set(startKey, { col: startC, row: startR, g: 0, f: Math.abs(goalC - startC) + Math.abs(goalR - startR) });

  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // orthogonal only
  const maxIterations = Math.min(cols * rows, 50000); // safety limit
  let iterations = 0;

  while (openSet.size > 0 && iterations++ < maxIterations) {
    // Find lowest f-score in open set
    let best: { col: number; row: number; g: number; f: number } | null = null;
    let bestKey = -1;
    for (const [k, node] of openSet) {
      if (!best || node.f < best.f) { best = node; bestKey = k; }
    }
    if (!best) break;

    if (best.col === goalC && best.row === goalR) {
      // Reconstruct path
      const path: Vec3[] = [];
      let current = key(goalC, goalR);
      while (cameFrom.has(current)) {
        const c = Math.floor(current / 100000);
        const r = current % 100000;
        path.unshift(toWorld(c, r));
        current = cameFrom.get(current)!;
      }
      return path;
    }

    openSet.delete(bestKey);
    closedSet.add(bestKey);

    for (const [dc, dr] of dirs) {
      const nc = best.col + dc;
      const nr = best.row + dr;
      const nk = key(nc, nr);

      if (closedSet.has(nk)) continue;
      if (isBlocked(nc, nr)) continue;

      const g = best.g + 1;
      const h = Math.abs(goalC - nc) + Math.abs(goalR - nr);
      const f = g + h;

      const existing = openSet.get(nk);
      if (existing && existing.g <= g) continue;

      openSet.set(nk, { col: nc, row: nr, g, f });
      cameFrom.set(nk, bestKey);
    }
  }

  return null; // no path found
}
