/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  RELATIONSHIP ENGINE — Post-processing step that establishes parametric
 *  relationships between BIM elements, mirroring how a human modeler works:
 *
 *  1. Host/Opening: Doors and windows are hosted in their nearest wall
 *  2. Wall Joins:   Wall endpoints that meet are joined (L, T, X)
 *  3. Beam-Column:  Beam endpoints snap to nearest column center
 *  4. Slab-Wall:    Slabs reference the walls that bound them
 *
 *  This runs after elements are positioned and calibrated, but before
 *  the final save to the database.
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawElement {
  id: string;
  type?: string;
  elementType?: string;
  category?: string;
  geometry?: any;
  properties?: any;
  storey?: { name?: string; elevation?: number };
  storeyName?: string;
}

interface Relationship {
  sourceId: string;
  targetId: string;
  type: 'hosted_in' | 'wall_join_L' | 'wall_join_T' | 'wall_join_X' |
        'beam_to_column' | 'slab_bounded_by' | 'connected_to';
  metadata?: Record<string, any>;
}

interface RelationshipResult {
  elements: RawElement[];
  relationships: Relationship[];
  stats: {
    hostedOpenings: number;
    wallJoins: number;
    beamColumnSnaps: number;
    slabBounds: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getType(e: RawElement): string {
  return String(e?.elementType || e?.type || e?.category || '').toUpperCase();
}

function getLoc(e: RawElement): { x: number; y: number; z: number } {
  const g = typeof e?.geometry === 'string' ? JSON.parse(e.geometry) : (e?.geometry || {});
  return g?.location?.realLocation || { x: 0, y: 0, z: 0 };
}

function getDims(e: RawElement): { w: number; h: number; d: number } {
  const g = typeof e?.geometry === 'string' ? JSON.parse(e.geometry) : (e?.geometry || {});
  const dims = g?.dimensions || {};
  return {
    w: Number(dims.width || 0),
    h: Number(dims.height || 0),
    d: Number(dims.depth || 0),
  };
}

function getStorey(e: RawElement): string {
  return e?.storey?.name || e?.storeyName || e?.properties?.level || '';
}

function dist2D(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function dist3D(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// ─── 1. Host/Opening Relationships ───────────────────────────────────────────

/**
 * For each door/window, find the nearest wall on the same storey and
 * establish a hosted_in relationship. This is how Revit/ArchiCAD work:
 * openings don't exist in isolation — they belong to a host wall.
 */
function assignHostWalls(elements: RawElement[]): { relationships: Relationship[]; count: number } {
  const walls = elements.filter(e => /WALL|PARTITION/i.test(getType(e)));
  const openings = elements.filter(e => /DOOR|WINDOW|OPENING|CURTAIN_WALL_PANEL/i.test(getType(e)));
  const relationships: Relationship[] = [];

  for (const opening of openings) {
    const oLoc = getLoc(opening);
    const oStorey = getStorey(opening);
    let bestWall: RawElement | null = null;
    let bestDist = Infinity;

    for (const wall of walls) {
      // Same storey check (or close elevation)
      const wStorey = getStorey(wall);
      const wLoc = getLoc(wall);
      if (oStorey && wStorey && oStorey !== wStorey) {
        // Allow if elevations are within one floor height
        const wElev = wall.storey?.elevation ?? 0;
        const oElev = opening.storey?.elevation ?? 0;
        if (Math.abs(wElev - oElev) > 4.0) continue;
      }

      const d = dist2D(oLoc, wLoc);
      // Opening should be within wall length to be a valid host
      const wDims = getDims(wall);
      const maxHostDist = Math.max(wDims.w, wDims.d, 2.0); // wall half-length or 2m
      if (d < bestDist && d < maxHostDist) {
        bestDist = d;
        bestWall = wall;
      }
    }

    if (bestWall) {
      relationships.push({
        sourceId: opening.id,
        targetId: bestWall.id,
        type: 'hosted_in',
        metadata: { distance: bestDist, openingType: getType(opening) },
      });

      // Write back to element properties for downstream consumers
      opening.properties = {
        ...(opening.properties || {}),
        hostWallId: bestWall.id,
        hostRelation: 'hosted_in',
      };
    }
  }

  return { relationships, count: relationships.length };
}

// ─── 2. Wall Join Detection ─────────────────────────────────────────────────

/**
 * Detect wall endpoints that meet or nearly meet and classify the joint.
 * Tolerance is in metres — walls within this distance are considered joined.
 */
function detectWallJoins(elements: RawElement[], tolerance = 0.15): { relationships: Relationship[]; count: number } {
  const walls = elements.filter(e => /WALL|PARTITION/i.test(getType(e)));
  const relationships: Relationship[] = [];
  const joined = new Set<string>();

  // Extract wall start/end points from geometry
  interface WallEndpoints {
    element: RawElement;
    start: { x: number; y: number };
    end: { x: number; y: number };
    yaw: number;
  }

  const wallData: WallEndpoints[] = walls.map(w => {
    const loc = getLoc(w);
    const dims = getDims(w);
    const g = typeof w?.geometry === 'string' ? JSON.parse(w.geometry) : (w?.geometry || {});
    const yaw = g?.orientation?.yawRad || 0;
    const halfLen = (dims.w || dims.d || 3) / 2;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    return {
      element: w,
      start: { x: loc.x - cos * halfLen, y: loc.y - sin * halfLen },
      end: { x: loc.x + cos * halfLen, y: loc.y + sin * halfLen },
      yaw,
    };
  });

  for (let i = 0; i < wallData.length; i++) {
    for (let j = i + 1; j < wallData.length; j++) {
      const a = wallData[i];
      const b = wallData[j];

      // Same storey check
      if (getStorey(a.element) !== getStorey(b.element)) continue;

      const pairKey = [a.element.id, b.element.id].sort().join('|');
      if (joined.has(pairKey)) continue;

      // Check all endpoint combinations
      const endpointDists = [
        dist2D(a.start, b.start),
        dist2D(a.start, b.end),
        dist2D(a.end, b.start),
        dist2D(a.end, b.end),
      ];
      const minDist = Math.min(...endpointDists);

      if (minDist < tolerance) {
        // Classify join type by angle
        const angleDiff = Math.abs(a.yaw - b.yaw) % Math.PI;
        let joinType: 'wall_join_L' | 'wall_join_T' | 'wall_join_X';
        if (angleDiff < 0.2 || Math.abs(angleDiff - Math.PI) < 0.2) {
          joinType = 'wall_join_X'; // Nearly parallel — extension/cross
        } else if (Math.abs(angleDiff - Math.PI / 2) < 0.3) {
          joinType = 'wall_join_L'; // Roughly perpendicular
        } else {
          joinType = 'wall_join_T'; // Angled
        }

        joined.add(pairKey);
        relationships.push({
          sourceId: a.element.id,
          targetId: b.element.id,
          type: joinType,
          metadata: { distance: minDist, angleDegrees: (angleDiff * 180) / Math.PI },
        });

        // Write connection back to both elements
        a.element.properties = {
          ...(a.element.properties || {}),
          connectedWallIds: [...((a.element.properties?.connectedWallIds) || []), b.element.id],
        };
        b.element.properties = {
          ...(b.element.properties || {}),
          connectedWallIds: [...((b.element.properties?.connectedWallIds) || []), a.element.id],
        };
      }
    }
  }

  return { relationships, count: relationships.length };
}

// ─── 3. Beam-Column Snapping ────────────────────────────────────────────────

/**
 * Snap beam endpoints to the nearest column center on the same storey.
 * A human modeler always connects beams to columns — they never float free.
 */
function snapBeamsToColumns(elements: RawElement[], tolerance = 0.5): { relationships: Relationship[]; count: number } {
  const beams = elements.filter(e => /BEAM|GIRDER|JOIST/i.test(getType(e)));
  const columns = elements.filter(e => /COLUMN|PILLAR|PIER/i.test(getType(e)));
  const relationships: Relationship[] = [];

  for (const beam of beams) {
    const bLoc = getLoc(beam);
    const bStorey = getStorey(beam);

    let bestCol: RawElement | null = null;
    let bestDist = Infinity;

    for (const col of columns) {
      if (bStorey && getStorey(col) !== bStorey) continue;
      const cLoc = getLoc(col);
      const d = dist2D(bLoc, cLoc);
      if (d < bestDist && d < tolerance) {
        bestDist = d;
        bestCol = col;
      }
    }

    if (bestCol) {
      relationships.push({
        sourceId: beam.id,
        targetId: bestCol.id,
        type: 'beam_to_column',
        metadata: { snapDistance: bestDist },
      });

      beam.properties = {
        ...(beam.properties || {}),
        connectedColumnIds: [...((beam.properties?.connectedColumnIds) || []), bestCol.id],
      };
      bestCol.properties = {
        ...(bestCol.properties || {}),
        supportedBeamIds: [...((bestCol.properties?.supportedBeamIds) || []), beam.id],
      };
    }
  }

  return { relationships, count: relationships.length };
}

// ─── 4. Slab-Wall Bounding ──────────────────────────────────────────────────

/**
 * Associate slabs with the walls that form their boundary edges.
 * A human modeler would draw the slab to the wall faces — we reverse-engineer
 * this by finding walls whose positions overlap the slab boundary.
 */
function boundSlabsToWalls(elements: RawElement[], tolerance = 1.0): { relationships: Relationship[]; count: number } {
  const slabs = elements.filter(e => /SLAB|FLOOR/i.test(getType(e)));
  const walls = elements.filter(e => /WALL|PARTITION/i.test(getType(e)));
  const relationships: Relationship[] = [];

  for (const slab of slabs) {
    const sLoc = getLoc(slab);
    const sDims = getDims(slab);
    const sStorey = getStorey(slab);
    const sHalfW = (sDims.w || 10) / 2;
    const sHalfD = (sDims.d || 10) / 2;

    const boundingWalls: string[] = [];

    for (const wall of walls) {
      if (sStorey && getStorey(wall) !== sStorey) continue;
      const wLoc = getLoc(wall);

      // Check if wall is near slab perimeter
      const dx = Math.abs(wLoc.x - sLoc.x);
      const dy = Math.abs(wLoc.y - sLoc.y);
      const nearEdgeX = Math.abs(dx - sHalfW) < tolerance;
      const nearEdgeY = Math.abs(dy - sHalfD) < tolerance;
      const insideX = dx < sHalfW + tolerance;
      const insideY = dy < sHalfD + tolerance;

      if ((nearEdgeX && insideY) || (nearEdgeY && insideX)) {
        boundingWalls.push(wall.id);
        relationships.push({
          sourceId: slab.id,
          targetId: wall.id,
          type: 'slab_bounded_by',
        });
      }
    }

    if (boundingWalls.length > 0) {
      slab.properties = {
        ...(slab.properties || {}),
        boundingWallIds: boundingWalls,
      };
    }
  }

  return { relationships, count: relationships.length };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Run the full relationship engine on a set of positioned elements.
 * This should be called after calibration but before the final database save.
 * Mirrors how a human modeler would establish connections between elements.
 */
export function establishRelationships(elements: RawElement[]): RelationshipResult {
  console.log(`🔗 [RELATIONSHIPS] Starting parametric relationship analysis for ${elements.length} elements...`);

  const hosting = assignHostWalls(elements);
  console.log(`   Hosted openings: ${hosting.count} (doors/windows → walls)`);

  const wallJoins = detectWallJoins(elements);
  console.log(`   Wall joins: ${wallJoins.count} (L/T/X connections)`);

  const beamSnaps = snapBeamsToColumns(elements);
  console.log(`   Beam-column snaps: ${beamSnaps.count}`);

  const slabBounds = boundSlabsToWalls(elements);
  console.log(`   Slab-wall bounds: ${slabBounds.count}`);

  const allRelationships = [
    ...hosting.relationships,
    ...wallJoins.relationships,
    ...beamSnaps.relationships,
    ...slabBounds.relationships,
  ];

  console.log(`🔗 [RELATIONSHIPS] Complete: ${allRelationships.length} total relationships established`);

  return {
    elements,
    relationships: allRelationships,
    stats: {
      hostedOpenings: hosting.count,
      wallJoins: wallJoins.count,
      beamColumnSnaps: beamSnaps.count,
      slabBounds: slabBounds.count,
    },
  };
}
