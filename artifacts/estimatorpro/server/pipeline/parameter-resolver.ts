// server/pipeline/parameter-resolver.ts
// Deterministic parameter resolution engine.
// Resolves candidate parameters from schedule, assembly, and grid data.
// NO Claude/AI calls — purely lookup-based with fuzzy matching.

import type {
  ScheduleData,
  AssemblyData,
  AssemblyDefinition,
  GridData,
  GridAxis,
} from './stage-types';

import type {
  CandidateSet,
  ResolutionStats,
  EvidenceSource,
  CandidateStatus,
  WallCandidate,
  DoorCandidate,
  WindowCandidate,
  ColumnCandidate,
  SlabCandidate,
  BeamCandidate,
  StairCandidate,
  MEPCandidate,
  BIMCandidate,
} from './candidate-types';

// ---------------------------------------------------------------------------
// Internal types for lookup maps
// ---------------------------------------------------------------------------

type DoorEntry = ScheduleData['doors'][number];
type WindowEntry = ScheduleData['windows'][number];

interface StoreyInfo {
  elevation: number;
  height: number | null;
  ceilingHeight: number | null;
}

// ---------------------------------------------------------------------------
// Levenshtein distance for fuzzy matching
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Use single-row DP for space efficiency
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,   // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

// ---------------------------------------------------------------------------
// Lookup map builders
// ---------------------------------------------------------------------------

function buildDoorScheduleMap(schedules: ScheduleData): Map<string, DoorEntry> {
  const map = new Map<string, DoorEntry>();
  for (const d of schedules.doors) {
    const key = d.mark.toUpperCase().replace(/\s+/g, '');
    map.set(key, d);
  }
  return map;
}

function buildWindowScheduleMap(schedules: ScheduleData): Map<string, WindowEntry> {
  const map = new Map<string, WindowEntry>();
  for (const w of schedules.windows) {
    const key = w.mark.toUpperCase().replace(/\s+/g, '');
    map.set(key, w);
  }
  return map;
}

function buildWallAssemblyMap(assemblies: AssemblyData): Map<string, AssemblyDefinition> {
  const map = new Map<string, AssemblyDefinition>();
  for (const [code, def] of Object.entries(assemblies.wallTypes)) {
    map.set(code.toUpperCase().replace(/\s+/g, ''), def);
  }
  return map;
}

function buildGridMap(gridlines: GridAxis[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const g of gridlines) {
    map.set(g.label.toUpperCase().replace(/\s+/g, ''), g.position_m);
  }
  return map;
}

function buildStoreyMap(
  storeys: CandidateSet['storeys'],
): Map<string, StoreyInfo> {
  const map = new Map<string, StoreyInfo>();
  for (const s of storeys) {
    const key = s.name.toLowerCase().replace(/\s+/g, '');
    map.set(key, {
      elevation: s.elevation_m,
      height: s.floor_to_floor_height_m,
      ceilingHeight: s.ceiling_height_m,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Fuzzy lookup helpers
// ---------------------------------------------------------------------------

function fuzzyLookup<T>(map: Map<string, T>, raw: string): { value: T; matchedKey: string } | null {
  const key = raw.toUpperCase().replace(/\s+/g, '');

  // Exact match
  const exact = map.get(key);
  if (exact) return { value: exact, matchedKey: key };

  // Strip common prefixes (D101 -> 101, W201 -> 201)
  const stripped = key.replace(/^[A-Z]-?/, '');
  if (stripped !== key) {
    for (const [k, v] of map) {
      const kStripped = k.replace(/^[A-Z]-?/, '');
      if (kStripped === stripped) return { value: v, matchedKey: k };
    }
  }

  // Remove dashes (D-101 -> D101)
  const noDash = key.replace(/-/g, '');
  if (noDash !== key) {
    const found = map.get(noDash);
    if (found) return { value: found, matchedKey: noDash };
  }

  // Levenshtein distance < 2
  for (const [k, v] of map) {
    if (levenshtein(key, k) < 2) return { value: v, matchedKey: k };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Grid position resolution
// ---------------------------------------------------------------------------

function resolveGridPosition(
  gridRef: { alpha: string; numeric: string } | null,
  offset: { x: number; y: number },
  gridAlpha: Map<string, number>,
  gridNumeric: Map<string, number>,
): { x: number; y: number } | null {
  if (!gridRef) return null;

  const alphaKey = gridRef.alpha.toUpperCase().replace(/\s+/g, '');
  const numericKey = gridRef.numeric.toUpperCase().replace(/\s+/g, '');

  const alphaPos = gridAlpha.get(alphaKey);
  const numericPos = gridNumeric.get(numericKey);

  if (alphaPos == null || numericPos == null) return null;

  return {
    x: alphaPos + offset.x,
    y: numericPos + offset.y,
  };
}

// ---------------------------------------------------------------------------
// Evidence builder
// ---------------------------------------------------------------------------

function makeEvidence(
  docName: string,
  method: EvidenceSource['extractionMethod'],
  confidence: EvidenceSource['confidence'],
  value: string,
): EvidenceSource {
  return {
    documentName: docName,
    extractionMethod: method,
    confidence,
    value_extracted: value,
  };
}

// ---------------------------------------------------------------------------
// Column size parsing (e.g. "400x400", "W12x26", "600 DIA")
// ---------------------------------------------------------------------------

function parseColumnSize(sizeStr: string): { width_mm: number; depth_mm: number } | null {
  if (!sizeStr) return null;
  const s = sizeStr.toUpperCase().trim();

  // "400x400" or "400 x 400"
  const rectMatch = s.match(/^(\d+)\s*[xX]\s*(\d+)$/);
  if (rectMatch) {
    return { width_mm: parseInt(rectMatch[1], 10), depth_mm: parseInt(rectMatch[2], 10) };
  }

  // "600 DIA" or "600mm DIA"
  const diaMatch = s.match(/^(\d+)\s*(?:MM)?\s*DIA/);
  if (diaMatch) {
    const d = parseInt(diaMatch[1], 10);
    return { width_mm: d, depth_mm: d };
  }

  // W-section: "W12x26" — width/depth from standard tables is complex,
  // so use nominal depth (first number * 25.4 for inches)
  const wMatch = s.match(/^W(\d+)[xX](\d+)/);
  if (wMatch) {
    const nominalDepthIn = parseInt(wMatch[1], 10);
    const depth_mm = Math.round(nominalDepthIn * 25.4);
    // Flange width approximately 60% of depth for common W-shapes
    const width_mm = Math.round(depth_mm * 0.6);
    return { width_mm, depth_mm };
  }

  // HSS: "HSS 200x200" or "HSS200x200"
  const hssMatch = s.match(/HSS\s*(\d+)\s*[xX]\s*(\d+)/);
  if (hssMatch) {
    return { width_mm: parseInt(hssMatch[1], 10), depth_mm: parseInt(hssMatch[2], 10) };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Status computation
// ---------------------------------------------------------------------------

function computeWallStatus(w: WallCandidate): CandidateStatus {
  if (w.start_m == null || w.end_m == null) return 'missing_position';
  if (w.thickness_mm == null) return 'missing_thickness';
  if (w.height_m == null) return 'missing_height';
  // If all required fields exist but evidence is low confidence, flag for review
  const hasLowConfidence = w.evidence_sources.some(e => e.confidence === 'low');
  if (hasLowConfidence) return 'needs_review';
  return 'complete';
}

function computeDoorStatus(d: DoorCandidate): CandidateStatus {
  if (d.position_m == null) return 'missing_position';
  if (d.width_mm == null) return 'missing_width';
  if (d.height_mm == null) return 'missing_height';
  const hasLowConfidence = d.evidence_sources.some(e => e.confidence === 'low');
  if (hasLowConfidence) return 'needs_review';
  return 'complete';
}

function computeWindowStatus(w: WindowCandidate): CandidateStatus {
  if (w.position_m == null) return 'missing_position';
  if (w.width_mm == null) return 'missing_width';
  if (w.height_mm == null) return 'missing_height';
  const hasLowConfidence = w.evidence_sources.some(e => e.confidence === 'low');
  if (hasLowConfidence) return 'needs_review';
  return 'complete';
}

function computeColumnStatus(c: ColumnCandidate): CandidateStatus {
  if (c.position_m == null) return 'missing_position';
  if (c.width_mm == null || c.depth_mm == null) return 'missing_width';
  if (c.height_m == null) return 'missing_height';
  const hasLowConfidence = c.evidence_sources.some(e => e.confidence === 'low');
  if (hasLowConfidence) return 'needs_review';
  return 'complete';
}

function computeSlabStatus(s: SlabCandidate): CandidateStatus {
  if (s.boundary_m == null || s.boundary_m.length < 3) return 'missing_position';
  if (s.thickness_mm == null) return 'missing_thickness';
  const hasLowConfidence = s.evidence_sources.some(e => e.confidence === 'low');
  if (hasLowConfidence) return 'needs_review';
  return 'complete';
}

function computeBeamStatus(b: BeamCandidate): CandidateStatus {
  if (b.start_m == null || b.end_m == null) return 'missing_position';
  if (b.width_mm == null || b.depth_mm == null) return 'missing_width';
  const hasLowConfidence = b.evidence_sources.some(e => e.confidence === 'low');
  if (hasLowConfidence) return 'needs_review';
  return 'complete';
}

function computeStairStatus(s: StairCandidate): CandidateStatus {
  if (s.position_m == null) return 'missing_position';
  if (s.width_mm == null) return 'missing_width';
  const hasLowConfidence = s.evidence_sources.some(e => e.confidence === 'low');
  if (hasLowConfidence) return 'needs_review';
  return 'complete';
}

function computeMEPStatus(m: MEPCandidate): CandidateStatus {
  if (m.position_m == null) return 'missing_position';
  const hasLowConfidence = m.evidence_sources.some(e => e.confidence === 'low');
  if (hasLowConfidence) return 'needs_review';
  return 'complete';
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

export function resolveParameters(
  candidates: CandidateSet,
  schedules: ScheduleData,
  assemblies: AssemblyData,
  grid: GridData,
): { candidates: CandidateSet; stats: ResolutionStats } {
  // Build lookup maps
  const doorSchedule = buildDoorScheduleMap(schedules);
  const windowSchedule = buildWindowScheduleMap(schedules);
  const wallAssemblies = buildWallAssemblyMap(assemblies);
  const gridAlpha = buildGridMap(grid.alphaGridlines);
  const gridNumeric = buildGridMap(grid.numericGridlines);
  const storeyMap = buildStoreyMap(candidates.storeys);

  // Resolve walls
  for (const wall of candidates.walls) {
    // Grid -> absolute position
    if (wall.start_m == null && wall.gridStart) {
      const resolved = resolveGridPosition(wall.gridStart, wall.offset_m, gridAlpha, gridNumeric);
      if (resolved) {
        wall.start_m = resolved;
        wall.evidence_sources.push(
          makeEvidence('grid', 'visual', 'high', `Start resolved from grid ${wall.gridStart.alpha}-${wall.gridStart.numeric}`),
        );
      }
    }
    if (wall.end_m == null && wall.gridEnd) {
      const resolved = resolveGridPosition(wall.gridEnd, { x: 0, y: 0 }, gridAlpha, gridNumeric);
      if (resolved) {
        wall.end_m = resolved;
        wall.evidence_sources.push(
          makeEvidence('grid', 'visual', 'high', `End resolved from grid ${wall.gridEnd.alpha}-${wall.gridEnd.numeric}`),
        );
      }
    }

    // Wall type -> thickness
    if (wall.thickness_mm == null && wall.wall_type_code) {
      const match = fuzzyLookup(wallAssemblies, wall.wall_type_code);
      if (match) {
        wall.thickness_mm = match.value.totalThickness_mm;
        wall.material = wall.material || match.value.layers[0]?.material || null;
        wall.fire_rating = wall.fire_rating || match.value.fire_rating || null;
        wall.evidence_sources.push(
          makeEvidence('assembly-data', 'section', 'high', `Thickness ${match.value.totalThickness_mm}mm from assembly ${match.matchedKey}`),
        );
      }
    }

    // Storey -> height
    if (wall.height_m == null) {
      const storeyKey = wall.storey.toLowerCase().replace(/\s+/g, '');
      const storeyInfo = storeyMap.get(storeyKey);
      if (storeyInfo?.ceilingHeight != null) {
        const ceilingH = storeyInfo.ceilingHeight;
        const extensionM = (wall.extension_above_ceiling_mm || 0) / 1000;
        wall.height_m = ceilingH + extensionM;
        wall.evidence_sources.push(
          makeEvidence('storey-data', 'section', 'high', `Height ${wall.height_m}m = ceiling ${ceilingH}m + extension ${extensionM}m`),
        );
      } else if (storeyInfo?.height != null) {
        wall.height_m = storeyInfo.height;
        wall.evidence_sources.push(
          makeEvidence('storey-data', 'section', 'medium', `Height ${storeyInfo.height}m from floor-to-floor (no ceiling height available)`),
        );
      }
    }

    // Base elevation from storey
    if (wall.base_elevation_m == null) {
      const storeyKey = wall.storey.toLowerCase().replace(/\s+/g, '');
      const storeyInfo = storeyMap.get(storeyKey);
      if (storeyInfo) {
        wall.base_elevation_m = storeyInfo.elevation;
      }
    }

    wall.status = computeWallStatus(wall);
  }

  // Resolve doors
  for (const door of candidates.doors) {
    // Grid -> position
    if (door.position_m == null && door.gridNearest) {
      const resolved = resolveGridPosition(door.gridNearest, door.offset_m, gridAlpha, gridNumeric);
      if (resolved) {
        door.position_m = resolved;
        door.evidence_sources.push(
          makeEvidence('grid', 'visual', 'high', `Position resolved from grid ${door.gridNearest.alpha}-${door.gridNearest.numeric}`),
        );
      }
    }

    // Mark -> dimensions from door schedule
    if ((door.width_mm == null || door.height_mm == null) && door.mark) {
      const match = fuzzyLookup(doorSchedule, door.mark);
      if (match) {
        if (door.width_mm == null) {
          door.width_mm = match.value.width_mm;
          door.evidence_sources.push(
            makeEvidence('door-schedule', 'schedule', 'high', `Width ${match.value.width_mm}mm from schedule mark ${match.matchedKey}`),
          );
        }
        if (door.height_mm == null) {
          door.height_mm = match.value.height_mm;
          door.evidence_sources.push(
            makeEvidence('door-schedule', 'schedule', 'high', `Height ${match.value.height_mm}mm from schedule mark ${match.matchedKey}`),
          );
        }
        if (door.thickness_mm == null && match.value.thickness_mm) {
          door.thickness_mm = match.value.thickness_mm;
        }
        if (door.fire_rating == null && match.value.fire_rating) {
          door.fire_rating = match.value.fire_rating;
        }
        if (door.hardware_set == null && match.value.hardware) {
          door.hardware_set = match.value.hardware;
        }
      }
    }

    door.status = computeDoorStatus(door);
  }

  // Resolve windows
  for (const win of candidates.windows) {
    // Grid -> position
    if (win.position_m == null && win.gridNearest) {
      const resolved = resolveGridPosition(win.gridNearest, win.offset_m, gridAlpha, gridNumeric);
      if (resolved) {
        win.position_m = resolved;
        win.evidence_sources.push(
          makeEvidence('grid', 'visual', 'high', `Position resolved from grid ${win.gridNearest.alpha}-${win.gridNearest.numeric}`),
        );
      }
    }

    // Mark -> dimensions from window schedule
    if ((win.width_mm == null || win.height_mm == null) && win.mark) {
      const match = fuzzyLookup(windowSchedule, win.mark);
      if (match) {
        if (win.width_mm == null) {
          win.width_mm = match.value.width_mm;
          win.evidence_sources.push(
            makeEvidence('window-schedule', 'schedule', 'high', `Width ${match.value.width_mm}mm from schedule mark ${match.matchedKey}`),
          );
        }
        if (win.height_mm == null) {
          win.height_mm = match.value.height_mm;
          win.evidence_sources.push(
            makeEvidence('window-schedule', 'schedule', 'high', `Height ${match.value.height_mm}mm from schedule mark ${match.matchedKey}`),
          );
        }
        if (win.sill_height_mm == null && match.value.sill_height_mm != null) {
          win.sill_height_mm = match.value.sill_height_mm;
          win.evidence_sources.push(
            makeEvidence('window-schedule', 'schedule', 'high', `Sill height ${match.value.sill_height_mm}mm from schedule mark ${match.matchedKey}`),
          );
        }
        if (win.glazing == null && match.value.glazing) {
          win.glazing = match.value.glazing;
        }
      }
    }

    win.status = computeWindowStatus(win);
  }

  // Resolve columns
  for (const col of candidates.columns) {
    // Grid -> position
    if (col.position_m == null && col.gridPosition) {
      const resolved = resolveGridPosition(col.gridPosition, col.offset_m, gridAlpha, gridNumeric);
      if (resolved) {
        col.position_m = resolved;
        col.evidence_sources.push(
          makeEvidence('grid', 'visual', 'high', `Position resolved from grid ${col.gridPosition.alpha}-${col.gridPosition.numeric}`),
        );
      }
    }

    // Size string -> dimensions
    if ((col.width_mm == null || col.depth_mm == null) && col.size_string) {
      const parsed = parseColumnSize(col.size_string);
      if (parsed) {
        col.width_mm = col.width_mm ?? parsed.width_mm;
        col.depth_mm = col.depth_mm ?? parsed.depth_mm;
        col.evidence_sources.push(
          makeEvidence('structural-data', 'text', 'high', `Size parsed from "${col.size_string}": ${parsed.width_mm}x${parsed.depth_mm}mm`),
        );
      }
    }

    // Storey -> height
    if (col.height_m == null) {
      const storeyKey = col.storey.toLowerCase().replace(/\s+/g, '');
      const storeyInfo = storeyMap.get(storeyKey);
      if (storeyInfo?.height != null) {
        col.height_m = storeyInfo.height;
        col.evidence_sources.push(
          makeEvidence('storey-data', 'section', 'high', `Height ${storeyInfo.height}m from floor-to-floor`),
        );
      }
    }

    col.status = computeColumnStatus(col);
  }

  // Resolve beams
  for (const beam of candidates.beams) {
    // Grid -> positions
    if (beam.start_m == null && beam.gridStart) {
      const resolved = resolveGridPosition(beam.gridStart, { x: 0, y: 0 }, gridAlpha, gridNumeric);
      if (resolved) {
        beam.start_m = resolved;
        beam.evidence_sources.push(
          makeEvidence('grid', 'visual', 'high', `Start resolved from grid ${beam.gridStart.alpha}-${beam.gridStart.numeric}`),
        );
      }
    }
    if (beam.end_m == null && beam.gridEnd) {
      const resolved = resolveGridPosition(beam.gridEnd, { x: 0, y: 0 }, gridAlpha, gridNumeric);
      if (resolved) {
        beam.end_m = resolved;
        beam.evidence_sources.push(
          makeEvidence('grid', 'visual', 'high', `End resolved from grid ${beam.gridEnd.alpha}-${beam.gridEnd.numeric}`),
        );
      }
    }

    // Size string -> dimensions
    if ((beam.width_mm == null || beam.depth_mm == null) && beam.size_string) {
      const parsed = parseColumnSize(beam.size_string); // same parser works
      if (parsed) {
        beam.width_mm = beam.width_mm ?? parsed.width_mm;
        beam.depth_mm = beam.depth_mm ?? parsed.depth_mm;
        beam.evidence_sources.push(
          makeEvidence('structural-data', 'text', 'high', `Size parsed from "${beam.size_string}": ${parsed.width_mm}x${parsed.depth_mm}mm`),
        );
      }
    }

    beam.status = computeBeamStatus(beam);
  }

  // Resolve slabs (minimal — boundary and thickness are usually from AI)
  for (const slab of candidates.slabs) {
    // Check slab type against assembly data
    if (slab.thickness_mm == null && slab.slab_type) {
      const slabAssemblies = new Map<string, AssemblyDefinition>();
      for (const [code, def] of Object.entries(assemblies.slabTypes)) {
        slabAssemblies.set(code.toUpperCase().replace(/\s+/g, ''), def);
      }
      const match = fuzzyLookup(slabAssemblies, slab.slab_type);
      if (match) {
        slab.thickness_mm = match.value.totalThickness_mm;
        slab.material = slab.material || match.value.layers[0]?.material || null;
        slab.evidence_sources.push(
          makeEvidence('assembly-data', 'section', 'high', `Thickness ${match.value.totalThickness_mm}mm from slab assembly ${match.matchedKey}`),
        );
      }
    }

    slab.status = computeSlabStatus(slab);
  }

  // Resolve stairs (position from grid if applicable)
  for (const stair of candidates.stairs) {
    stair.status = computeStairStatus(stair);
  }

  // Resolve MEP (position from grid if applicable)
  for (const mep of candidates.mep) {
    mep.status = computeMEPStatus(mep);
  }

  // Update metadata
  const allCandidates: BIMCandidate[] = [
    ...candidates.walls,
    ...candidates.doors,
    ...candidates.windows,
    ...candidates.columns,
    ...candidates.slabs,
    ...candidates.beams,
    ...candidates.stairs,
    ...candidates.mep,
  ];

  candidates.metadata.totalCandidates = allCandidates.length;

  // Compute stats
  const stats = computeStats(allCandidates);

  return { candidates, stats };
}

// ---------------------------------------------------------------------------
// Stats computation
// ---------------------------------------------------------------------------

function computeStats(candidates: BIMCandidate[]): ResolutionStats {
  const byType: Record<string, { total: number; resolved: number; unresolved: number }> = {};

  let resolved = 0;
  let needsReview = 0;
  let unresolved = 0;

  for (const c of candidates) {
    const typeName = c.type;
    if (!byType[typeName]) {
      byType[typeName] = { total: 0, resolved: 0, unresolved: 0 };
    }
    byType[typeName].total++;

    if (c.status === 'complete') {
      resolved++;
      byType[typeName].resolved++;
    } else if (c.status === 'needs_review') {
      needsReview++;
      // needs_review is partially resolved — count as unresolved for stats
      byType[typeName].unresolved++;
    } else {
      unresolved++;
      byType[typeName].unresolved++;
    }
  }

  return {
    total: candidates.length,
    resolved,
    needsReview,
    unresolved,
    byType,
  };
}
