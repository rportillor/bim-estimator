// server/services/mep-routing.ts
// ──────────────────────────────────────────────────────────────────────────────
// MEP routing engine — routes ducts, pipes, cable trays, and conduits between
// equipment endpoints using A* pathfinding with orthogonal routing.
//
// Called as PASS 0.5 in the postprocess pipeline, BEFORE geometry upgrade,
// so that routed segments get profile data in PASS 1.
// ──────────────────────────────────────────────────────────────────────────────

interface Vec3 { x: number; y: number; z: number }
interface AABB { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

// ── Types ────────────────────────────────────────────────────────────────────

export type MEPSystem = 'hvac_supply' | 'hvac_return' | 'exhaust' | 'plumbing_hot' | 'plumbing_cold'
  | 'plumbing_waste' | 'fire_sprinkler' | 'electrical_power' | 'electrical_low_voltage'
  | 'cable_tray' | 'gas';

export interface MEPSegment {
  id: string;
  system: MEPSystem;
  elementType: string;
  start: Vec3;
  end: Vec3;
  /** Segment diameter (pipes/ducts) or width (rectangular ducts, cable trays) in metres */
  size: number;
  /** Optional height for rectangular ducts */
  height?: number;
  shape: 'circular' | 'rectangular';
  material?: string;
  storey?: string;
}

export interface MEPFitting {
  id: string;
  system: MEPSystem;
  elementType: string;
  fittingType: 'elbow_90' | 'elbow_45' | 'tee' | 'reducer' | 'cap' | 'transition';
  position: Vec3;
  /** Rotation angle in radians */
  rotation: number;
  size: number;
  storey?: string;
}

export interface RoutingResult {
  segments: MEPSegment[];
  fittings: MEPFitting[];
}

interface GridNode {
  x: number; y: number; z: number;
  g: number; h: number; f: number;
  parent: GridNode | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function dist3(a: Vec3, b: Vec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function manhattan3(a: Vec3, b: Vec3): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
}

function pointInAABB(p: Vec3, box: AABB, margin = 0.1): boolean {
  return p.x >= box.minX - margin && p.x <= box.maxX + margin &&
         p.y >= box.minY - margin && p.y <= box.maxY + margin &&
         p.z >= box.minZ - margin && p.z <= box.maxZ + margin;
}

function elementToAABB(e: any): AABB | null {
  const g = typeof e.geometry === 'string' ? JSON.parse(e.geometry) : (e.geometry || {});
  const pos = g.location?.realLocation;
  const dims = g.dimensions;
  if (!pos || !dims) return null;

  const x = Number(pos.x) || 0;
  const y = Number(pos.y) || 0;
  const z = Number(pos.z) || 0;
  const w = Number(dims.width || 1) / 2;
  const h = Number(dims.height || 1) / 2;
  const d = Number(dims.depth || dims.length || 1) / 2;

  return { minX: x - w, minY: y - d, minZ: z, maxX: x + w, maxY: y + d, maxZ: z + h * 2 };
}

function nodeKey(x: number, y: number, z: number): string {
  return `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;
}

// ── System classification ───────────────────────────────────────────────────

export function inferMEPSystem(e: any): MEPSystem | null {
  const t = (e.elementType || e.type || e.category || '').toUpperCase();
  const mat = (e.material || e.properties?.material || '').toUpperCase();

  if (/(SUPPLY.*DUCT|DUCT.*SUPPLY|AHU|RTU|VAV|DIFFUSER|SUPPLY.*AIR)/.test(t)) return 'hvac_supply';
  if (/(RETURN.*DUCT|DUCT.*RETURN|RETURN.*AIR)/.test(t)) return 'hvac_return';
  if (/(EXHAUST|EXTRACT|FUME)/.test(t)) return 'exhaust';
  if (/(HOT.*WATER|HW.*PIPE|DOMESTIC.*HOT)/.test(t)) return 'plumbing_hot';
  if (/(COLD.*WATER|CW.*PIPE|DOMESTIC.*COLD)/.test(t)) return 'plumbing_cold';
  if (/(WASTE|DRAIN|SEWER|SOIL|VENT.*PIPE)/.test(t)) return 'plumbing_waste';
  if (/(SPRINKLER|FIRE.*PIPE|STANDPIPE|HYDRANT)/.test(t)) return 'fire_sprinkler';
  if (/(CONDUIT|POWER.*CABLE|BUS.*DUCT|ELECTRICAL.*PIPE)/.test(t)) return 'electrical_power';
  if (/(DATA|COMM|LOW.*VOLT|TELECOM|NETWORK)/.test(t)) return 'electrical_low_voltage';
  if (/(CABLE.*TRAY|WIRE.*WAY|LADDER.*RACK)/.test(t)) return 'cable_tray';
  if (/(GAS.*PIPE|NATURAL.*GAS|LPG)/.test(t)) return 'gas';

  // Fallback by general category
  if (/(DUCT|HVAC|FAN|DIFFUSER|VAV|AHU)/.test(t)) return 'hvac_supply';
  if (/(PIPE|PLUMB)/.test(t)) return 'plumbing_cold';
  if (/(CONDUIT|CABLE|WIRE|ELECTRICAL)/.test(t)) return 'electrical_power';
  if (/(SPRINKLER|FIRE)/.test(t)) return 'fire_sprinkler';

  return null;
}

/** Default routing heights (ceiling offset in metres) per system */
const ROUTING_Z_OFFSETS: Record<MEPSystem, number> = {
  hvac_supply: 0.3,       // 300mm below ceiling
  hvac_return: 0.5,       // 500mm below ceiling
  exhaust: 0.3,
  plumbing_hot: 0.8,      // 800mm below ceiling
  plumbing_cold: 0.8,
  plumbing_waste: -0.5,   // below floor (negative offset from slab)
  fire_sprinkler: 0.15,   // 150mm below ceiling (closest to ceiling)
  electrical_power: 1.0,  // 1m below ceiling (lowest of overhead MEP)
  electrical_low_voltage: 1.0,
  cable_tray: 0.6,        // 600mm below ceiling
  gas: 0.9,
};

/** Default segment sizes in metres per system */
const DEFAULT_SIZES: Record<MEPSystem, { size: number; shape: 'circular' | 'rectangular' }> = {
  hvac_supply: { size: 0.4, shape: 'rectangular' },
  hvac_return: { size: 0.35, shape: 'rectangular' },
  exhaust: { size: 0.3, shape: 'circular' },
  plumbing_hot: { size: 0.025, shape: 'circular' },   // 25mm
  plumbing_cold: { size: 0.025, shape: 'circular' },
  plumbing_waste: { size: 0.1, shape: 'circular' },    // 100mm
  fire_sprinkler: { size: 0.032, shape: 'circular' },  // 32mm
  electrical_power: { size: 0.025, shape: 'circular' },
  electrical_low_voltage: { size: 0.02, shape: 'circular' },
  cable_tray: { size: 0.3, shape: 'rectangular' },
  gas: { size: 0.025, shape: 'circular' },
};

// ── A* Pathfinder ───────────────────────────────────────────────────────────

const GRID_STEP = 0.5;  // 500mm grid resolution

function aStarRoute(
  start: Vec3,
  end: Vec3,
  obstacles: AABB[],
  gridStep = GRID_STEP,
): Vec3[] | null {
  // Snap to grid
  const snap = (v: number) => Math.round(v / gridStep) * gridStep;
  const s: Vec3 = { x: snap(start.x), y: snap(start.y), z: snap(start.z) };
  const e: Vec3 = { x: snap(end.x), y: snap(end.y), z: snap(end.z) };

  const open: GridNode[] = [];
  const closed = new Set<string>();

  const startNode: GridNode = { x: s.x, y: s.y, z: s.z, g: 0, h: manhattan3(s, e), f: manhattan3(s, e), parent: null };
  open.push(startNode);

  // Orthogonal directions: ±X, ±Y, ±Z
  const dirs: Vec3[] = [
    { x: gridStep, y: 0, z: 0 }, { x: -gridStep, y: 0, z: 0 },
    { x: 0, y: gridStep, z: 0 }, { x: 0, y: -gridStep, z: 0 },
    { x: 0, y: 0, z: gridStep }, { x: 0, y: 0, z: -gridStep },
  ];

  const maxNodes = 5000;  // Safety limit
  let explored = 0;

  while (open.length > 0 && explored < maxNodes) {
    // Find node with lowest f
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];
    explored++;

    const key = nodeKey(current.x, current.y, current.z);
    if (closed.has(key)) continue;
    closed.add(key);

    // Goal check (within one grid step)
    if (Math.abs(current.x - e.x) < gridStep &&
        Math.abs(current.y - e.y) < gridStep &&
        Math.abs(current.z - e.z) < gridStep) {
      // Reconstruct path
      const path: Vec3[] = [];
      let node: GridNode | null = current;
      while (node) {
        path.unshift({ x: node.x, y: node.y, z: node.z });
        node = node.parent;
      }
      // Append exact end point
      path.push({ ...end });
      // Prepend exact start point
      path[0] = { ...start };
      return simplifyPath(path);
    }

    // Expand neighbours
    for (const dir of dirs) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      const nz = current.z + dir.z;
      const nKey = nodeKey(nx, ny, nz);

      if (closed.has(nKey)) continue;

      // Obstacle check
      const point: Vec3 = { x: nx, y: ny, z: nz };
      let blocked = false;
      for (const obs of obstacles) {
        if (pointInAABB(point, obs, 0.2)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      const g = current.g + gridStep;
      // Penalise direction changes (prefer straight runs)
      const turnPenalty = current.parent ?
        ((current.x - current.parent.x !== dir.x || current.y - current.parent.y !== dir.y || current.z - current.parent.z !== dir.z) ? gridStep * 0.5 : 0)
        : 0;
      const h = manhattan3(point, e);

      open.push({ x: nx, y: ny, z: nz, g: g + turnPenalty, h, f: g + turnPenalty + h, parent: current });
    }
  }

  // A* failed — fall back to direct L-route
  return lRoute(start, end);
}

/** Simplify path by removing collinear points */
function simplifyPath(path: Vec3[]): Vec3[] {
  if (path.length <= 2) return path;
  const result: Vec3[] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = result[result.length - 1];
    const next = path[i + 1];
    const curr = path[i];
    // Check if collinear (same direction from prev to curr and curr to next)
    const dx1 = Math.sign(curr.x - prev.x), dy1 = Math.sign(curr.y - prev.y), dz1 = Math.sign(curr.z - prev.z);
    const dx2 = Math.sign(next.x - curr.x), dy2 = Math.sign(next.y - curr.y), dz2 = Math.sign(next.z - curr.z);
    if (dx1 !== dx2 || dy1 !== dy2 || dz1 !== dz2) {
      result.push(curr);  // Direction change = keep this point (it's a bend)
    }
  }
  result.push(path[path.length - 1]);
  return result;
}

/** Simple L-shaped route (fallback when A* fails) — two straight segments with one bend */
function lRoute(start: Vec3, end: Vec3): Vec3[] {
  // Route in X first, then Y, keep Z constant
  const mid: Vec3 = { x: end.x, y: start.y, z: start.z };
  if (Math.abs(mid.x - start.x) < 0.01 && Math.abs(mid.y - start.y) < 0.01) {
    return [start, end];  // Points are already aligned in XY
  }
  return [start, mid, end];
}

// ── Route generation ────────────────────────────────────────────────────────

let segmentCounter = 0;
let fittingCounter = 0;

function makeSegmentId(system: MEPSystem): string {
  return `mep_seg_${system}_${Date.now()}_${segmentCounter++}`;
}
function makeFittingId(system: MEPSystem): string {
  return `mep_fit_${system}_${Date.now()}_${fittingCounter++}`;
}

/**
 * Route a single MEP run between two endpoints.
 */
export function routeMEPRun(
  start: Vec3,
  end: Vec3,
  system: MEPSystem,
  obstacles: AABB[],
  storey?: string,
): RoutingResult {
  const path = aStarRoute(start, end, obstacles) || [start, end];
  const defaults = DEFAULT_SIZES[system];
  const segments: MEPSegment[] = [];
  const fittings: MEPFitting[] = [];

  for (let i = 0; i < path.length - 1; i++) {
    segments.push({
      id: makeSegmentId(system),
      system,
      elementType: system.includes('hvac') || system.includes('exhaust') ? 'DUCT' : 'PIPE',
      start: path[i],
      end: path[i + 1],
      size: defaults.size,
      shape: defaults.shape,
      storey,
    });

    // Add fitting at each bend (except start and end)
    if (i > 0) {
      const prev = path[i - 1];
      const curr = path[i];
      const next = path[i + 1];
      const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y, dz1 = curr.z - prev.z;
      const dx2 = next.x - curr.x, dy2 = next.y - curr.y, dz2 = next.z - curr.z;
      const dirChanged = (Math.sign(dx1) !== Math.sign(dx2)) || (Math.sign(dy1) !== Math.sign(dy2)) || (Math.sign(dz1) !== Math.sign(dz2));

      if (dirChanged) {
        // Determine angle of bend
        const angle = Math.atan2(dy2, dx2) - Math.atan2(dy1, dx1);
        const absAngle = Math.abs(angle);
        const fittingType = absAngle > Math.PI / 3 ? 'elbow_90' : 'elbow_45';

        fittings.push({
          id: makeFittingId(system),
          system,
          elementType: 'MEP_FITTING',
          fittingType: fittingType as any,
          position: curr,
          rotation: Math.atan2(dy2, dx2),
          size: defaults.size,
          storey,
        });
      }
    }
  }

  return { segments, fittings };
}

// ── Auto-routing for the pipeline ───────────────────────────────────────────

interface MEPEquipmentNode {
  id: string;
  position: Vec3;
  system: MEPSystem;
  role: 'source' | 'terminal';  // AHU=source, diffuser=terminal, etc.
  storey: string;
}

function classifyRole(e: any): 'source' | 'terminal' {
  const t = (e.elementType || e.type || '').toUpperCase();
  if (/(AHU|RTU|BOILER|CHILLER|PUMP|PANEL|TRANSFORMER|MAIN|RISER)/.test(t)) return 'source';
  return 'terminal';
}

/**
 * Auto-route all MEP elements in a model.
 * Groups elements by system + storey, identifies source/terminal roles,
 * and routes from sources to terminals using A* pathfinding.
 *
 * @param elements   All BIM elements (structural used as obstacles)
 * @returns Array of new BIM elements representing routed segments + fittings
 */
export function autoRouteMEP(elements: any[]): any[] {
  // 1. Classify MEP elements and structural obstacles
  const mepNodes: MEPEquipmentNode[] = [];
  const obstacles: AABB[] = [];

  for (const e of elements) {
    const system = inferMEPSystem(e);
    if (system) {
      const g = typeof e.geometry === 'string' ? JSON.parse(e.geometry) : (e.geometry || {});
      const pos = g.location?.realLocation;
      if (!pos) continue;

      mepNodes.push({
        id: e.id || e.elementId,
        position: { x: Number(pos.x) || 0, y: Number(pos.y) || 0, z: Number(pos.z) || 0 },
        system,
        role: classifyRole(e),
        storey: e.storey?.name || e.properties?.level || '',
      });
    } else {
      // Structural elements become obstacles
      const t = (e.elementType || e.type || '').toUpperCase();
      if (/(WALL|COLUMN|BEAM|FOUNDATION|SLAB)/.test(t)) {
        const aabb = elementToAABB(e);
        if (aabb) obstacles.push(aabb);
      }
    }
  }

  if (mepNodes.length < 2) {
    console.log('🔧 MEP ROUTING: fewer than 2 MEP nodes — skipping routing');
    return [];
  }

  // 2. Group by system + storey
  const groups = new Map<string, MEPEquipmentNode[]>();
  for (const node of mepNodes) {
    const key = `${node.system}::${node.storey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(node);
  }

  const newElements: any[] = [];
  let totalSegments = 0;
  let totalFittings = 0;

  // 3. For each group, route from sources to terminals
  for (const [groupKey, nodes] of groups) {
    if (nodes.length < 2) continue;

    const sources = nodes.filter(n => n.role === 'source');
    const terminals = nodes.filter(n => n.role === 'terminal');

    // If no explicit source, use first node as source
    const effectiveSources = sources.length > 0 ? sources : [nodes[0]];
    const effectiveTerminals = terminals.length > 0 ? terminals : nodes.slice(1);

    // Route from each source to nearest unrouted terminals (simple nearest-neighbour)
    const routed = new Set<string>();

    for (const source of effectiveSources) {
      // Sort terminals by distance to source
      const sorted = effectiveTerminals
        .filter(t => t.id !== source.id && !routed.has(t.id))
        .sort((a, b) => dist3(a.position, source.position) - dist3(b.position, source.position));

      // Route: star topology from source → each terminal
      // (in a real BIM system you'd use tree routing with trunk + branches)
      let prevEnd = source.position;

      for (const terminal of sorted) {
        // Adjust Z for routing height
        const zOffset = ROUTING_Z_OFFSETS[source.system] || 0.5;
        const routeStart: Vec3 = { x: prevEnd.x, y: prevEnd.y, z: prevEnd.z };
        const routeEnd: Vec3 = { x: terminal.position.x, y: terminal.position.y, z: terminal.position.z };

        // If close enough to route on same plane, adjust Z
        if (Math.abs(routeStart.z - routeEnd.z) < 0.5) {
          // Same floor — use routing Z offset from ceiling
          const ceilingZ = routeStart.z + 3.0 - zOffset;  // assume 3m floor-to-floor
          routeStart.z = ceilingZ;
          routeEnd.z = ceilingZ;
        }

        const result = routeMEPRun(routeStart, routeEnd, source.system, obstacles, source.storey);

        // Convert segments to BIM elements
        for (const seg of result.segments) {
          const midX = (seg.start.x + seg.end.x) / 2;
          const midY = (seg.start.y + seg.end.y) / 2;
          const midZ = (seg.start.z + seg.end.z) / 2;
          const length = dist3(seg.start, seg.end);

          newElements.push({
            id: seg.id,
            elementId: seg.id,
            elementType: seg.elementType,
            type: seg.elementType,
            category: seg.system,
            name: `${seg.system} ${seg.elementType} segment`,
            geometry: {
              location: { realLocation: { x: midX, y: midY, z: midZ } },
              dimensions: {
                width: seg.shape === 'rectangular' ? seg.size : seg.size,
                height: seg.height || seg.size,
                depth: length,
                length: length,
              },
            },
            properties: {
              start: seg.start,
              end: seg.end,
              system: seg.system,
              shape: seg.shape,
              diameter: seg.shape === 'circular' ? seg.size : undefined,
              material: seg.material,
              isRouted: true,  // Flag to identify routing-generated elements
            },
            storey: { name: seg.storey || '' },
            storeyName: seg.storey || '',
          });
          totalSegments++;
        }

        // Convert fittings to BIM elements
        for (const fit of result.fittings) {
          newElements.push({
            id: fit.id,
            elementId: fit.id,
            elementType: 'MEP_FITTING',
            type: 'MEP_FITTING',
            category: fit.system,
            name: `${fit.fittingType} fitting`,
            geometry: {
              location: { realLocation: fit.position },
              dimensions: { width: fit.size, height: fit.size, depth: fit.size },
            },
            properties: {
              fittingType: fit.fittingType,
              system: fit.system,
              rotation: fit.rotation,
              isRouted: true,
            },
            storey: { name: fit.storey || '' },
            storeyName: fit.storey || '',
          });
          totalFittings++;
        }

        routed.add(terminal.id);
        prevEnd = terminal.position;
      }
    }
  }

  console.log(`🔧 MEP ROUTING: generated ${totalSegments} segments + ${totalFittings} fittings across ${groups.size} system groups`);
  return newElements;
}

/**
 * Layout sprinklers in a regular grid over a slab area.
 * Standard coverage: 1 head per 12m² (NFPA 13 light hazard).
 */
export function layoutSprinklers(
  slab: any,
  ceilingHeight: number,
  spacing = 3.5,
): any[] {
  const g = typeof slab.geometry === 'string' ? JSON.parse(slab.geometry) : (slab.geometry || {});
  const pos = g.location?.realLocation || { x: 0, y: 0, z: 0 };
  const dims = g.dimensions || {};
  const w = Number(dims.width || 10);
  const d = Number(dims.depth || dims.length || 10);
  const storeyName = slab.storey?.name || '';

  const heads: any[] = [];
  const startX = Number(pos.x) - w / 2 + spacing / 2;
  const startY = Number(pos.y) - d / 2 + spacing / 2;
  const headZ = Number(pos.z) + ceilingHeight - 0.15;  // 150mm below ceiling

  for (let x = startX; x < Number(pos.x) + w / 2; x += spacing) {
    for (let y = startY; y < Number(pos.y) + d / 2; y += spacing) {
      const id = `sprinkler_${Date.now()}_${heads.length}`;
      heads.push({
        id,
        elementId: id,
        elementType: 'SPRINKLER',
        type: 'SPRINKLER',
        category: 'fire_sprinkler',
        name: 'Sprinkler Head',
        geometry: {
          location: { realLocation: { x, y, z: headZ } },
          dimensions: { width: 0.1, height: 0.15, depth: 0.1 },
        },
        properties: { system: 'fire_sprinkler', isRouted: true, coverage_m2: spacing * spacing },
        storey: { name: storeyName },
        storeyName,
      });
    }
  }

  return heads;
}

/**
 * Layout recessed lights in a regular grid.
 * Standard spacing: ~2.5m for typical 300mm LED panels.
 */
export function layoutLights(
  slab: any,
  ceilingHeight: number,
  spacing = 2.5,
): any[] {
  const g = typeof slab.geometry === 'string' ? JSON.parse(slab.geometry) : (slab.geometry || {});
  const pos = g.location?.realLocation || { x: 0, y: 0, z: 0 };
  const dims = g.dimensions || {};
  const w = Number(dims.width || 10);
  const d = Number(dims.depth || dims.length || 10);
  const storeyName = slab.storey?.name || '';

  const lights: any[] = [];
  const startX = Number(pos.x) - w / 2 + spacing / 2;
  const startY = Number(pos.y) - d / 2 + spacing / 2;
  const lightZ = Number(pos.z) + ceilingHeight - 0.05;

  for (let x = startX; x < Number(pos.x) + w / 2; x += spacing) {
    for (let y = startY; y < Number(pos.y) + d / 2; y += spacing) {
      const id = `light_${Date.now()}_${lights.length}`;
      lights.push({
        id,
        elementId: id,
        elementType: 'LIGHT',
        type: 'LIGHT',
        category: 'electrical',
        name: 'Recessed LED Panel',
        geometry: {
          location: { realLocation: { x, y, z: lightZ } },
          dimensions: { width: 0.6, height: 0.05, depth: 0.6 },
        },
        properties: { system: 'electrical_power', isRouted: true, wattage: 40 },
        storey: { name: storeyName },
        storeyName,
      });
    }
  }

  return lights;
}
