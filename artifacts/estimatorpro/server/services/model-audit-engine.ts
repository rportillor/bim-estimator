// server/services/model-audit-engine.ts
// ──────────────────────────────────────────────────────────────────────────────
// Geometric audit engine — the "look at what I placed and check it" pass.
//
// A human Revit modeler iterates 10-20× on a model.  This engine replicates
// that quality loop by running a battery of geometric, topological, and
// clearance checks on a placed BIM element set and emitting findings
// that the iterative-refinement loop can auto-fix.
//
// Audit categories:
//   1. Wall closure       — perimeter walls form closed polygons per storey
//   2. Beam spanning      — beams actually reach between columns/walls
//   3. MEP clearance      — ducts/pipes don't penetrate structure
//   4. Column alignment   — columns on the same grid line are colinear
//   5. Slab coverage      — every storey has a floor slab
//   6. Opening placement  — doors/windows are within wall bounds
//   7. Storey consistency — elements assigned to correct storey by elevation
//   8. Orphan detection   — floating elements not connected to anything
// ──────────────────────────────────────────────────────────────────────────────

export type AuditSeverity = 'critical' | 'warning' | 'info';
export type AuditCategory =
  | 'wall_closure'
  | 'beam_span'
  | 'mep_clearance'
  | 'column_alignment'
  | 'slab_coverage'
  | 'opening_placement'
  | 'storey_consistency'
  | 'orphan_element'
  | 'dimension_sanity';

export interface AuditFinding {
  id: string;
  category: AuditCategory;
  severity: AuditSeverity;
  message: string;
  elementIds: string[];
  /** Auto-fixable? If true, iterative-refinement can attempt a fix. */
  autoFixable: boolean;
  /** Suggested fix action */
  suggestedFix?: {
    action: 'move' | 'extend' | 'delete' | 'add' | 'resize' | 'reassign_storey';
    targetElementId?: string;
    params?: Record<string, any>;
  };
  /** Location of the issue for debugging */
  location?: { x: number; y: number; z: number };
}

export interface AuditResult {
  modelId: string;
  timestamp: string;
  passNumber: number;
  totalElements: number;
  findings: AuditFinding[];
  summary: {
    critical: number;
    warning: number;
    info: number;
    autoFixable: number;
    score: number;  // 0-100, 100 = no issues
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface Vec2 { x: number; y: number }
interface Vec3 { x: number; y: number; z: number }

function loc(e: any): Vec3 {
  const g = typeof e.geometry === 'string' ? JSON.parse(e.geometry) : (e.geometry || {});
  const p = g.location?.realLocation || { x: 0, y: 0, z: 0 };
  return { x: Number(p.x) || 0, y: Number(p.y) || 0, z: Number(p.z) || 0 };
}

function dims(e: any): { w: number; h: number; d: number } {
  const g = typeof e.geometry === 'string' ? JSON.parse(e.geometry) : (e.geometry || {});
  const dm = g.dimensions || {};
  return {
    w: Number(dm.width || 0),
    h: Number(dm.height || 0),
    d: Number(dm.depth || dm.length || 0),
  };
}

function etype(e: any): string {
  return (e.elementType || e.type || e.category || '').toUpperCase();
}

function eid(e: any): string {
  return e.id || e.elementId || '';
}

function storey(e: any): string {
  return e.storey?.name || e.properties?.level || e.storeyName || '';
}

function dist2(a: Vec2, b: Vec2): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function wallEndpoints(e: any): { start: Vec2; end: Vec2 } | null {
  const s = e.properties?.start;
  const en = e.properties?.end;
  if (!s || !en) return null;
  return { start: { x: Number(s.x) || 0, y: Number(s.y) || 0 }, end: { x: Number(en.x) || 0, y: Number(en.y) || 0 } };
}

let findingCounter = 0;
function makeFindingId(cat: string): string {
  return `audit_${cat}_${Date.now()}_${findingCounter++}`;
}

// ── Audit functions ─────────────────────────────────────────────────────────

/**
 * Check 1: Wall closure — perimeter walls should form closed loops per storey.
 * Collects wall endpoints, groups by storey, then checks if endpoints pair up.
 * Unpaired endpoints = gap in the perimeter.
 */
function auditWallClosure(elements: any[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const walls = elements.filter(e => /(WALL|PARTITION)/.test(etype(e)));

  // Group by storey
  const byStorey = new Map<string, any[]>();
  for (const w of walls) {
    const s = storey(w) || '__default__';
    if (!byStorey.has(s)) byStorey.set(s, []);
    byStorey.get(s)!.push(w);
  }

  const SNAP = 0.5;  // metres — endpoint coincidence tolerance

  for (const [storeyName, storeyWalls] of byStorey) {
    // Collect all endpoints
    const endpoints: { point: Vec2; wallId: string; which: 'start' | 'end' }[] = [];
    for (const w of storeyWalls) {
      const ep = wallEndpoints(w);
      if (!ep) continue;
      endpoints.push({ point: ep.start, wallId: eid(w), which: 'start' });
      endpoints.push({ point: ep.end, wallId: eid(w), which: 'end' });
    }

    // Find unpaired endpoints (each endpoint should be within SNAP of another endpoint)
    const paired = new Set<number>();
    for (let i = 0; i < endpoints.length; i++) {
      if (paired.has(i)) continue;
      let found = false;
      for (let j = i + 1; j < endpoints.length; j++) {
        if (paired.has(j)) continue;
        if (endpoints[i].wallId === endpoints[j].wallId) continue;  // same wall
        if (dist2(endpoints[i].point, endpoints[j].point) < SNAP) {
          paired.add(i);
          paired.add(j);
          found = true;
          break;
        }
      }
      if (!found) {
        findings.push({
          id: makeFindingId('wall_closure'),
          category: 'wall_closure',
          severity: 'warning',
          message: `Wall ${endpoints[i].which} endpoint unpaired on storey "${storeyName}" — gap in wall perimeter at (${endpoints[i].point.x.toFixed(2)}, ${endpoints[i].point.y.toFixed(2)})`,
          elementIds: [endpoints[i].wallId],
          autoFixable: true,
          suggestedFix: {
            action: 'extend',
            targetElementId: endpoints[i].wallId,
            params: { endpoint: endpoints[i].which, snapTo: 'nearest_wall_endpoint', tolerance: SNAP * 3 },
          },
          location: { x: endpoints[i].point.x, y: endpoints[i].point.y, z: 0 },
        });
      }
    }
  }

  return findings;
}

/**
 * Check 2: Beam spanning — beams should reach between columns or walls.
 * A beam whose midpoint is far from any column/wall is likely misplaced.
 */
function auditBeamSpanning(elements: any[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const beams = elements.filter(e => /(BEAM|GIRDER|JOIST)/.test(etype(e)));
  const columns = elements.filter(e => /(COLUMN|PILLAR|POST)/.test(etype(e)));
  const walls = elements.filter(e => /(WALL)/.test(etype(e)));

  const supports = [...columns, ...walls];

  for (const beam of beams) {
    const bLoc = loc(beam);
    const bDims = dims(beam);
    const beamLength = Math.max(bDims.w, bDims.d);

    // Approximate beam endpoints
    const bStart: Vec2 = { x: bLoc.x - beamLength / 2, y: bLoc.y };
    const bEnd: Vec2 = { x: bLoc.x + beamLength / 2, y: bLoc.y };

    let startSupported = false;
    let endSupported = false;
    const BEAM_SUPPORT_SNAP = 1.5;  // metres

    for (const sup of supports) {
      const sLoc = loc(sup);
      const s2: Vec2 = { x: sLoc.x, y: sLoc.y };
      if (dist2(bStart, s2) < BEAM_SUPPORT_SNAP) startSupported = true;
      if (dist2(bEnd, s2) < BEAM_SUPPORT_SNAP) endSupported = true;
    }

    if (!startSupported || !endSupported) {
      findings.push({
        id: makeFindingId('beam_span'),
        category: 'beam_span',
        severity: !startSupported && !endSupported ? 'critical' : 'warning',
        message: `Beam "${beam.name || eid(beam)}" has unsupported ${!startSupported && !endSupported ? 'both ends' : !startSupported ? 'start' : 'end'} — no column or wall within ${BEAM_SUPPORT_SNAP}m`,
        elementIds: [eid(beam)],
        autoFixable: true,
        suggestedFix: {
          action: 'move',
          targetElementId: eid(beam),
          params: { snapEndpoints: true, snapTarget: 'nearest_column_or_wall' },
        },
        location: bLoc,
      });
    }
  }

  return findings;
}

/**
 * Check 3: MEP clearance — ducts/pipes should not penetrate structure.
 * Checks AABB overlap between MEP elements and structural elements.
 */
function auditMEPClearance(elements: any[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const mep = elements.filter(e => /(DUCT|PIPE|CONDUIT|CABLE|HVAC|PLUMB)/.test(etype(e)));
  const structure = elements.filter(e => /(WALL|COLUMN|BEAM|SLAB|FOUNDATION)/.test(etype(e)));

  const MIN_CLEARANCE = 0.05;  // 50mm minimum clearance

  for (const m of mep) {
    const mLoc = loc(m);
    const mDims = dims(m);
    const mHalfW = mDims.w / 2;
    const mHalfD = mDims.d / 2;

    for (const s of structure) {
      // Same storey check
      if (storey(m) && storey(s) && storey(m) !== storey(s)) continue;

      const sLoc = loc(s);
      const sDims = dims(s);
      const sHalfW = sDims.w / 2;
      const sHalfD = sDims.d / 2;

      // AABB overlap check (XY plane)
      const overlapX = Math.max(0,
        Math.min(mLoc.x + mHalfW, sLoc.x + sHalfW) -
        Math.max(mLoc.x - mHalfW, sLoc.x - sHalfW)
      );
      const overlapY = Math.max(0,
        Math.min(mLoc.y + mHalfD, sLoc.y + sHalfD) -
        Math.max(mLoc.y - mHalfD, sLoc.y - sHalfD)
      );
      // Z axis overlap
      const mMinZ = mLoc.z;
      const mMaxZ = mLoc.z + mDims.h;
      const sMinZ = sLoc.z;
      const sMaxZ = sLoc.z + sDims.h;
      const overlapZ = Math.max(0, Math.min(mMaxZ, sMaxZ) - Math.max(mMinZ, sMinZ));

      if (overlapX > MIN_CLEARANCE && overlapY > MIN_CLEARANCE && overlapZ > MIN_CLEARANCE) {
        findings.push({
          id: makeFindingId('mep_clearance'),
          category: 'mep_clearance',
          severity: 'critical',
          message: `MEP "${m.name || etype(m)}" penetrates "${s.name || etype(s)}" — ${(overlapX * overlapY * overlapZ).toFixed(4)}m³ overlap`,
          elementIds: [eid(m), eid(s)],
          autoFixable: true,
          suggestedFix: {
            action: 'move',
            targetElementId: eid(m),
            params: {
              clearStructure: eid(s),
              minClearance: MIN_CLEARANCE,
              preferDirection: 'z_up',  // route MEP over/under structure
            },
          },
          location: mLoc,
        });
        break;  // One finding per MEP element is enough
      }
    }
  }

  return findings;
}

/**
 * Check 4: Column alignment — columns on the same grid line should be colinear.
 * Clusters columns by X or Y coordinate and checks alignment.
 */
function auditColumnAlignment(elements: any[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const columns = elements.filter(e => /(COLUMN|PILLAR|POST)/.test(etype(e)));

  if (columns.length < 3) return findings;

  const ALIGNMENT_TOL = 0.3;  // 300mm alignment tolerance

  // Cluster by X coordinate
  const byX = new Map<number, any[]>();
  for (const col of columns) {
    const cx = Math.round(loc(col).x / ALIGNMENT_TOL) * ALIGNMENT_TOL;
    if (!byX.has(cx)) byX.set(cx, []);
    byX.get(cx)!.push(col);
  }

  // Check each X-cluster for Y-alignment issues
  for (const [gridX, cluster] of byX) {
    if (cluster.length < 2) continue;
    const avgX = cluster.reduce((sum, c) => sum + loc(c).x, 0) / cluster.length;

    for (const col of cluster) {
      const cx = loc(col).x;
      if (Math.abs(cx - avgX) > ALIGNMENT_TOL) {
        findings.push({
          id: makeFindingId('column_alignment'),
          category: 'column_alignment',
          severity: 'warning',
          message: `Column "${col.name || eid(col)}" is ${Math.abs(cx - avgX).toFixed(3)}m off grid line X=${avgX.toFixed(2)}`,
          elementIds: [eid(col)],
          autoFixable: true,
          suggestedFix: {
            action: 'move',
            targetElementId: eid(col),
            params: { newX: avgX },
          },
          location: loc(col),
        });
      }
    }
  }

  // Same for Y clusters
  const byY = new Map<number, any[]>();
  for (const col of columns) {
    const cy = Math.round(loc(col).y / ALIGNMENT_TOL) * ALIGNMENT_TOL;
    if (!byY.has(cy)) byY.set(cy, []);
    byY.get(cy)!.push(col);
  }

  for (const [gridY, cluster] of byY) {
    if (cluster.length < 2) continue;
    const avgY = cluster.reduce((sum, c) => sum + loc(c).y, 0) / cluster.length;

    for (const col of cluster) {
      const cy = loc(col).y;
      if (Math.abs(cy - avgY) > ALIGNMENT_TOL) {
        findings.push({
          id: makeFindingId('column_alignment'),
          category: 'column_alignment',
          severity: 'warning',
          message: `Column "${col.name || eid(col)}" is ${Math.abs(cy - avgY).toFixed(3)}m off grid line Y=${avgY.toFixed(2)}`,
          elementIds: [eid(col)],
          autoFixable: true,
          suggestedFix: {
            action: 'move',
            targetElementId: eid(col),
            params: { newY: avgY },
          },
          location: loc(col),
        });
      }
    }
  }

  return findings;
}

/**
 * Check 5: Slab coverage — every storey should have at least one floor slab.
 */
function auditSlabCoverage(elements: any[]): AuditFinding[] {
  const findings: AuditFinding[] = [];

  // Collect all unique storeys
  const storeysWithElements = new Map<string, string[]>();
  for (const e of elements) {
    const s = storey(e);
    if (!s) continue;
    if (!storeysWithElements.has(s)) storeysWithElements.set(s, []);
    storeysWithElements.get(s)!.push(eid(e));
  }

  const slabs = elements.filter(e => /(SLAB|FLOOR|DECK)/.test(etype(e)));
  const storeysWithSlabs = new Set(slabs.map(s => storey(s)).filter(Boolean));

  for (const [storeyName, elementIds] of storeysWithElements) {
    if (!storeysWithSlabs.has(storeyName) && elementIds.length > 3) {
      findings.push({
        id: makeFindingId('slab_coverage'),
        category: 'slab_coverage',
        severity: 'warning',
        message: `Storey "${storeyName}" has ${elementIds.length} elements but no floor slab — add a slab element`,
        elementIds: [],
        autoFixable: true,
        suggestedFix: {
          action: 'add',
          params: { elementType: 'SLAB', storey: storeyName },
        },
      });
    }
  }

  return findings;
}

/**
 * Check 6: Opening placement — doors/windows should be within wall bounds.
 */
function auditOpeningPlacement(elements: any[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const openings = elements.filter(e => /(DOOR|WINDOW|ENTRANCE|GLAZING)/.test(etype(e)));
  const walls = elements.filter(e => /(WALL|PARTITION)/.test(etype(e)));

  const OPENING_WALL_SNAP = 1.5;  // metres

  for (const opening of openings) {
    const oLoc = loc(opening);
    let nearestWallDist = Infinity;

    for (const wall of walls) {
      const ep = wallEndpoints(wall);
      if (!ep) {
        // No start/end — use centroid distance
        const wLoc = loc(wall);
        const d = dist2({ x: oLoc.x, y: oLoc.y }, { x: wLoc.x, y: wLoc.y });
        nearestWallDist = Math.min(nearestWallDist, d);
      } else {
        // Project opening onto wall segment
        const dx = ep.end.x - ep.start.x;
        const dy = ep.end.y - ep.start.y;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-6) continue;
        let t = ((oLoc.x - ep.start.x) * dx + (oLoc.y - ep.start.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const proj = { x: ep.start.x + t * dx, y: ep.start.y + t * dy };
        nearestWallDist = Math.min(nearestWallDist, dist2({ x: oLoc.x, y: oLoc.y }, proj));
      }
    }

    if (nearestWallDist > OPENING_WALL_SNAP) {
      findings.push({
        id: makeFindingId('opening_placement'),
        category: 'opening_placement',
        severity: 'warning',
        message: `${etype(opening)} "${opening.name || eid(opening)}" is ${nearestWallDist.toFixed(2)}m from nearest wall — should be hosted on a wall`,
        elementIds: [eid(opening)],
        autoFixable: true,
        suggestedFix: {
          action: 'move',
          targetElementId: eid(opening),
          params: { snapTo: 'nearest_wall_centreline' },
        },
        location: oLoc,
      });
    }
  }

  return findings;
}

/**
 * Check 7: Storey consistency — elements at wrong elevation for their storey.
 */
function auditStoreyConsistency(elements: any[]): AuditFinding[] {
  const findings: AuditFinding[] = [];

  // Build storey elevation map
  const storeyElevations = new Map<string, number[]>();
  for (const e of elements) {
    const s = storey(e);
    if (!s) continue;
    const z = loc(e).z;
    if (!storeyElevations.has(s)) storeyElevations.set(s, []);
    storeyElevations.get(s)!.push(z);
  }

  // Compute median Z per storey
  const storeyMedianZ = new Map<string, number>();
  for (const [s, zs] of storeyElevations) {
    const sorted = zs.sort((a, b) => a - b);
    storeyMedianZ.set(s, sorted[Math.floor(sorted.length / 2)]);
  }

  const STOREY_Z_TOL = 2.0;  // ±2m tolerance (floor-to-floor typically 3-4m)

  for (const e of elements) {
    const s = storey(e);
    if (!s) continue;
    const medZ = storeyMedianZ.get(s);
    if (medZ == null) continue;
    const z = loc(e).z;
    const drift = Math.abs(z - medZ);

    if (drift > STOREY_Z_TOL) {
      findings.push({
        id: makeFindingId('storey_consistency'),
        category: 'storey_consistency',
        severity: 'warning',
        message: `${etype(e)} "${e.name || eid(e)}" is at Z=${z.toFixed(2)}m but storey "${s}" median is Z=${medZ.toFixed(2)}m — ${drift.toFixed(2)}m drift`,
        elementIds: [eid(e)],
        autoFixable: true,
        suggestedFix: {
          action: 'reassign_storey',
          targetElementId: eid(e),
          params: { expectedZ: medZ, currentZ: z },
        },
        location: loc(e),
      });
    }
  }

  return findings;
}

/**
 * Check 8: Dimension sanity — elements with zero or extreme dimensions.
 */
function auditDimensionSanity(elements: any[]): AuditFinding[] {
  const findings: AuditFinding[] = [];

  const MAX_DIM = 200;  // 200m — no single element should be wider
  const MIN_DIM = 0.001; // 1mm

  for (const e of elements) {
    const d = dims(e);
    const id = eid(e);
    const type = etype(e);

    // Skip elements with no dimensions (they're handled elsewhere)
    if (d.w === 0 && d.h === 0 && d.d === 0) continue;

    if (d.w > MAX_DIM || d.h > MAX_DIM || d.d > MAX_DIM) {
      findings.push({
        id: makeFindingId('dimension_sanity'),
        category: 'dimension_sanity',
        severity: 'critical',
        message: `${type} "${e.name || id}" has extreme dimensions: ${d.w.toFixed(2)}×${d.h.toFixed(2)}×${d.d.toFixed(2)}m — likely mm-vs-m conversion error`,
        elementIds: [id],
        autoFixable: true,
        suggestedFix: {
          action: 'resize',
          targetElementId: id,
          params: { scaleBy: 0.001, reason: 'mm_to_m_conversion' },
        },
        location: loc(e),
      });
    }

    if ((d.w > 0 && d.w < MIN_DIM) || (d.h > 0 && d.h < MIN_DIM) || (d.d > 0 && d.d < MIN_DIM)) {
      findings.push({
        id: makeFindingId('dimension_sanity'),
        category: 'dimension_sanity',
        severity: 'info',
        message: `${type} "${e.name || id}" has sub-millimetre dimension: ${d.w.toFixed(4)}×${d.h.toFixed(4)}×${d.d.toFixed(4)}m`,
        elementIds: [id],
        autoFixable: false,
      });
    }
  }

  return findings;
}

// ── Main audit entry point ──────────────────────────────────────────────────

/**
 * Run all audit checks on a set of BIM elements.
 * Returns an AuditResult with findings grouped by severity.
 */
export function runModelAudit(
  elements: any[],
  modelId: string,
  passNumber = 1,
): AuditResult {
  const allFindings: AuditFinding[] = [];

  // Run all audit checks
  allFindings.push(...auditWallClosure(elements));
  allFindings.push(...auditBeamSpanning(elements));
  allFindings.push(...auditMEPClearance(elements));
  allFindings.push(...auditColumnAlignment(elements));
  allFindings.push(...auditSlabCoverage(elements));
  allFindings.push(...auditOpeningPlacement(elements));
  allFindings.push(...auditStoreyConsistency(elements));
  allFindings.push(...auditDimensionSanity(elements));

  const critical = allFindings.filter(f => f.severity === 'critical').length;
  const warning = allFindings.filter(f => f.severity === 'warning').length;
  const info = allFindings.filter(f => f.severity === 'info').length;
  const autoFixable = allFindings.filter(f => f.autoFixable).length;

  // Score: start at 100, deduct per finding by severity
  const score = Math.max(0, Math.round(
    100 - (critical * 10) - (warning * 3) - (info * 0.5)
  ));

  console.log(
    `🔍 MODEL AUDIT (pass ${passNumber}): ${allFindings.length} findings ` +
    `(critical=${critical}, warning=${warning}, info=${info}, autoFixable=${autoFixable}) ` +
    `— score ${score}/100`
  );

  return {
    modelId,
    timestamp: new Date().toISOString(),
    passNumber,
    totalElements: elements.length,
    findings: allFindings,
    summary: { critical, warning, info, autoFixable, score },
  };
}
