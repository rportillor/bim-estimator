// server/services/clash-detection-engine.ts
// ═══════════════════════════════════════════════════════════════════════════════
// SOP 6.4 — CLASH DETECTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
//
// Professional BIM coordination engine for EstimatorPro v3.
// Detects 5 categories of construction clashes against BIM elements in storage.
//
// Standards:  CSI MasterFormat 2018, CIQS Standard Method, NBC 2020, OBC 2024
// Principle:  NO hardcoded clearances — all values from specs/drawings or user input
// Integrates: storage.ts (getBimElements), routes.ts (API endpoints)
//
// Author:     EstimatorPro AI QS Engine
// Date:       2026-03-01
// Version:    1.0.0
// ═══════════════════════════════════════════════════════════════════════════════

import { storage } from '../storage';

// ═══════════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

/** Axis-aligned bounding box for spatial checks */
export interface AABB {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

/** Parsed element with resolved geometry */
export interface ResolvedElement {
  id: string;
  elementId: string;
  name: string;
  elementType: string;
  category: string;           // Architectural | Structural | MEP
  discipline: Discipline;
  material: string;
  storey: string;
  elevation: number;
  bbox: AABB;
  dimensions: { length: number; width: number; height: number; area: number; volume: number };
  csiDivision: string;        // '03', '05', '22', '23', '26', etc.
  properties: Record<string, any>;
  raw: any;                   // Original BIM element for reference
}

export type Discipline = 'structural' | 'architectural' | 'mechanical' | 'electrical' | 'plumbing' | 'fire_protection' | 'site' | 'other';

export type ClashCategory = 'hard' | 'soft' | 'workflow' | 'code_compliance' | 'tolerance';

export type ClashSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Clash {
  id: string;
  category: ClashCategory;
  severity: ClashSeverity;
  elementA: { id: string; name: string; type: string; discipline: Discipline; storey: string };
  elementB: { id: string; name: string; type: string; discipline: Discipline; storey: string };
  description: string;
  location: { x: number; y: number; z: number };
  overlapVolume: number;      // m³ for hard clashes, 0 for others
  clearanceRequired: number;  // mm — from specs or user input
  clearanceActual: number;    // mm — measured
  codeReference: string;      // e.g. 'NBC 3.2.5.7' or 'OBC 9.10.15.5' or 'SPEC_REQUIRED'
  recommendation: string;
  rfiRequired: boolean;
  rfiDescription: string;
  status: 'open' | 'resolved' | 'accepted' | 'rfi_issued';
}

/** Clearance requirements — ALL from project specs or user input, never hardcoded */
export interface ClearanceRequirements {
  // Mechanical
  ductToDuct_mm: number | null;
  ductToStructural_mm: number | null;
  pipeToPipe_mm: number | null;
  pipeToStructural_mm: number | null;
  equipmentServiceClearance_mm: number | null;
  // Electrical
  panelFrontClearance_mm: number | null;
  panelSideClearance_mm: number | null;
  conduitToConduit_mm: number | null;
  // Plumbing
  drainSlopePercent: number | null;
  cleanoutAccessClearance_mm: number | null;
  // Fire protection
  sprinklerToCeiling_mm: number | null;
  sprinklerToObstruction_mm: number | null;
  fireDamperAccessClearance_mm: number | null;
  // Structural
  columnFireRating_hr: number | null;
  beamFireRating_hr: number | null;
  // Egress
  corridorMinWidth_mm: number | null;
  stairMinWidth_mm: number | null;
  doorMinWidth_mm: number | null;
  doorMinHeight_mm: number | null;
  // General
  ceilingMinHeight_mm: number | null;
  accessPanelClearance_mm: number | null;
}

/** Results from a full clash detection run */
export interface ClashDetectionResult {
  modelId: string;
  projectId: string;
  runDate: string;
  totalElements: number;
  resolvedElements: number;
  skippedElements: number;
  clashes: Clash[];
  summary: {
    totalClashes: number;
    bySeverity: Record<ClashSeverity, number>;
    byCategory: Record<ClashCategory, number>;
    byStorey: Record<string, number>;
    byDisciplinePair: Record<string, number>;
    rfisRequired: number;
  };
  missingClearanceData: string[];
  methodology: 'CIQS';
  engine: 'EstimatorPro-ClashDetection-v1';
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS — Classification maps only, NO dimensional data
// ═══════════════════════════════════════════════════════════════════════════════

/** Map element types to disciplines for clash pair analysis */
const DISCIPLINE_MAP: Record<string, Discipline> = {
  // Structural
  'column': 'structural', 'beam': 'structural', 'slab': 'structural',
  'foundation': 'structural', 'footing': 'structural', 'pile': 'structural',
  'brace': 'structural', 'truss': 'structural', 'joist': 'structural',
  'structural steel': 'structural', 'concrete': 'structural',
  // Architectural
  'wall': 'architectural', 'door': 'architectural', 'window': 'architectural',
  'curtain wall': 'architectural', 'ceiling': 'architectural', 'floor': 'architectural',
  'roof': 'architectural', 'stair': 'architectural', 'ramp': 'architectural',
  'railing': 'architectural', 'partition': 'architectural',
  // Mechanical
  'duct': 'mechanical', 'hvac': 'mechanical', 'ahu': 'mechanical',
  'fan': 'mechanical', 'vav': 'mechanical', 'diffuser': 'mechanical',
  'damper': 'mechanical', 'coil': 'mechanical', 'chiller': 'mechanical',
  'boiler': 'mechanical', 'pump': 'mechanical',
  // Electrical
  'conduit': 'electrical', 'cable tray': 'electrical', 'panel': 'electrical',
  'transformer': 'electrical', 'switchgear': 'electrical', 'receptacle': 'electrical',
  'light': 'electrical', 'lighting': 'electrical', 'fixture': 'electrical',
  'generator': 'electrical',
  // Plumbing
  'pipe': 'plumbing', 'plumbing': 'plumbing', 'sanitary': 'plumbing',
  'domestic water': 'plumbing', 'drain': 'plumbing', 'vent': 'plumbing',
  'valve': 'plumbing', 'fixture plumbing': 'plumbing',
  // Fire protection
  'sprinkler': 'fire_protection', 'fire alarm': 'fire_protection',
  'standpipe': 'fire_protection', 'fire damper': 'fire_protection',
  'fire extinguisher': 'fire_protection',
  // Site
  'excavation': 'site', 'paving': 'site', 'landscape': 'site',
  'retaining wall': 'site', 'utility': 'site',
};

/** CSI Division from element type — for reporting */
const CSI_FROM_TYPE: Record<string, string> = {
  'concrete': '03', 'column': '03', 'beam': '03', 'slab': '03',
  'foundation': '03', 'footing': '03', 'masonry': '04',
  'structural steel': '05', 'joist': '05', 'truss': '05', 'brace': '05',
  'framing': '06', 'millwork': '06',
  'insulation': '07', 'roofing': '07', 'roof': '07', 'waterproofing': '07',
  'door': '08', 'window': '08', 'curtain wall': '08',
  'drywall': '09', 'ceiling': '09', 'tile': '09', 'partition': '09',
  'stair': '06', 'railing': '05',
  'elevator': '14',
  'sprinkler': '21', 'fire alarm': '21', 'standpipe': '21', 'fire damper': '21',
  'plumbing': '22', 'pipe': '22', 'sanitary': '22', 'domestic water': '22',
  'hvac': '23', 'duct': '23', 'ahu': '23', 'vav': '23', 'boiler': '23',
  'conduit': '26', 'cable tray': '26', 'panel': '26', 'lighting': '26',
  'light': '26', 'transformer': '26', 'switchgear': '26', 'generator': '26',
  'excavation': '31', 'paving': '32', 'landscape': '32',
  'wall': '03', 'floor': '03',
};

/** Construction sequence priorities — lower = earlier in sequence */
const CONSTRUCTION_SEQUENCE: Record<string, number> = {
  'excavation': 1, 'pile': 2, 'footing': 3, 'foundation': 4,
  'slab': 5, 'column': 6, 'beam': 7, 'structural steel': 7,
  'joist': 8, 'truss': 8, 'brace': 8,
  'wall': 9, 'masonry': 9,
  'roof': 10, 'roofing': 10,
  'window': 11, 'door': 11, 'curtain wall': 11,
  'pipe': 12, 'plumbing': 12, 'sanitary': 12, 'domestic water': 12, 'drain': 12,
  'duct': 13, 'hvac': 13,
  'conduit': 14, 'cable tray': 14,
  'sprinkler': 15, 'standpipe': 15,
  'insulation': 16,
  'drywall': 17, 'partition': 17,
  'ceiling': 18,
  'tile': 19,
  'lighting': 20, 'light': 20,
  'elevator': 12,
  'paving': 21, 'landscape': 22,
};

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/** Safe JSON parse — returns empty object on failure */
function safeParse(v: any): any {
  if (typeof v === 'object' && v !== null) return v;
  if (typeof v !== 'string') return {};
  try { return JSON.parse(v); } catch { return {}; }
}

/** Classify element type to discipline */
function classifyDiscipline(elementType: string, category: string): Discipline {
  const t = (elementType || '').toLowerCase().trim();
  const c = (category || '').toLowerCase().trim();

  // Direct match
  if (DISCIPLINE_MAP[t]) return DISCIPLINE_MAP[t];

  // Keyword search in type string
  for (const [keyword, discipline] of Object.entries(DISCIPLINE_MAP)) {
    if (t.includes(keyword)) return discipline;
  }

  // Fallback to category
  if (c.includes('structural')) return 'structural';
  if (c.includes('architect')) return 'architectural';
  if (c.includes('mep') || c.includes('mechanical')) return 'mechanical';
  if (c.includes('electr')) return 'electrical';
  if (c.includes('plumb')) return 'plumbing';
  if (c.includes('fire')) return 'fire_protection';

  return 'other';
}

/** Get CSI division from element type */
function getCSIDivision(elementType: string): string {
  const t = (elementType || '').toLowerCase().trim();
  if (CSI_FROM_TYPE[t]) return CSI_FROM_TYPE[t];
  for (const [keyword, div] of Object.entries(CSI_FROM_TYPE)) {
    if (t.includes(keyword)) return div;
  }
  return '01'; // General requirements fallback
}

/** Get construction sequence priority (lower = earlier) */
function getSequencePriority(elementType: string): number {
  const t = (elementType || '').toLowerCase().trim();
  if (CONSTRUCTION_SEQUENCE[t]) return CONSTRUCTION_SEQUENCE[t];
  for (const [keyword, priority] of Object.entries(CONSTRUCTION_SEQUENCE)) {
    if (t.includes(keyword)) return priority;
  }
  return 99; // Unknown = last
}

/** Generate deterministic clash ID */
function clashId(elemA: string, elemB: string, category: ClashCategory): string {
  const sorted = [elemA, elemB].sort();
  return `CLH-${category.toUpperCase().substring(0, 3)}-${sorted[0].substring(0, 8)}-${sorted[1].substring(0, 8)}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GEOMETRY ENGINE — AABB-based spatial analysis
// ═══════════════════════════════════════════════════════════════════════════════

/** Extract AABB from BIM element geometry */
function extractAABB(element: any): AABB | null {
  const geo = safeParse(element.geometry);
  const loc = safeParse(element.location);
  const props = safeParse(element.properties);

  // Try geometry.location + geometry.dimensions first (primary path)
  const geoLoc = geo?.location || loc;
  const geoDim = geo?.dimensions || props?.dimensions;

  if (geoLoc && geoDim) {
    const x = parseFloat(geoLoc.x ?? geoLoc.X ?? 0);
    const y = parseFloat(geoLoc.y ?? geoLoc.Y ?? 0);
    const z = parseFloat(geoLoc.z ?? geoLoc.Z ?? 0);
    const l = parseFloat(geoDim.length ?? geoDim.Length ?? 0);
    const w = parseFloat(geoDim.width ?? geoDim.Width ?? geoDim.depth ?? geoDim.Depth ?? 0);
    const h = parseFloat(geoDim.height ?? geoDim.Height ?? 0);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    if (l <= 0 && w <= 0 && h <= 0) return null;

    // Treat location as center of element
    const halfL = (l || 0.1) / 2;
    const halfW = (w || 0.1) / 2;
    const halfH = (h || 0.1) / 2;

    return {
      minX: x - halfL, minY: y - halfW, minZ: z - halfH,
      maxX: x + halfL, maxY: y + halfW, maxZ: z + halfH,
    };
  }

  // Try bounding box directly
  if (geo?.boundingBox) {
    const bb = geo.boundingBox;
    return {
      minX: parseFloat(bb.min?.x ?? bb.minX ?? 0),
      minY: parseFloat(bb.min?.y ?? bb.minY ?? 0),
      minZ: parseFloat(bb.min?.z ?? bb.minZ ?? 0),
      maxX: parseFloat(bb.max?.x ?? bb.maxX ?? 0),
      maxY: parseFloat(bb.max?.y ?? bb.maxY ?? 0),
      maxZ: parseFloat(bb.max?.z ?? bb.maxZ ?? 0),
    };
  }

  return null;
}

/** Check if two AABBs intersect (hard clash) */
function aabbIntersects(a: AABB, b: AABB): boolean {
  return (
    a.minX < b.maxX && a.maxX > b.minX &&
    a.minY < b.maxY && a.maxY > b.minY &&
    a.minZ < b.maxZ && a.maxZ > b.minZ
  );
}

/** Calculate overlap volume between two AABBs in m³ */
function aabbOverlapVolume(a: AABB, b: AABB): number {
  const overlapX = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const overlapY = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  const overlapZ = Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ));
  return overlapX * overlapY * overlapZ;
}

/** Minimum distance between two AABBs in mm (0 if overlapping) */
function aabbMinDistance_mm(a: AABB, b: AABB): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  const dz = Math.max(0, Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ));
  const distM = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return distM * 1000; // Convert m to mm
}

/** Center point of an AABB */
function aabbCenter(a: AABB): { x: number; y: number; z: number } {
  return {
    x: (a.minX + a.maxX) / 2,
    y: (a.minY + a.maxY) / 2,
    z: (a.minZ + a.maxZ) / 2,
  };
}

/** Expand AABB by a clearance envelope (mm → m conversion) */
function aabbExpand(a: AABB, clearance_mm: number): AABB {
  const c = clearance_mm / 1000; // mm → m
  return {
    minX: a.minX - c, minY: a.minY - c, minZ: a.minZ - c,
    maxX: a.maxX + c, maxY: a.maxY + c, maxZ: a.maxZ + c,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ELEMENT RESOLVER — Parse raw BIM elements into typed ResolvedElements
// ═══════════════════════════════════════════════════════════════════════════════

function resolveElements(rawElements: any[]): { resolved: ResolvedElement[]; skipped: number } {
  const resolved: ResolvedElement[] = [];
  let skipped = 0;

  for (const el of rawElements) {
    const bbox = extractAABB(el);
    if (!bbox) { skipped++; continue; }

    const elementType = (el.elementType || el.type || el.category || '').toLowerCase().trim();
    const category = (el.category || '').trim();
    const props = safeParse(el.properties);
    const geo = safeParse(el.geometry);
    const dims = geo?.dimensions || props?.dimensions || {};

    resolved.push({
      id: el.id,
      elementId: el.elementId || el.id,
      name: el.name || elementType,
      elementType,
      category,
      discipline: classifyDiscipline(elementType, category),
      material: el.material || props?.material || '',
      storey: el.storeyGuid || props?.storey || props?.floor || 'Unassigned',
      elevation: parseFloat(el.elevation ?? 0),
      bbox,
      dimensions: {
        length: parseFloat(dims.length ?? dims.Length ?? 0),
        width: parseFloat(dims.width ?? dims.Width ?? dims.depth ?? 0),
        height: parseFloat(dims.height ?? dims.Height ?? 0),
        area: parseFloat(dims.area ?? dims.Area ?? 0),
        volume: parseFloat(dims.volume ?? dims.Volume ?? 0),
      },
      csiDivision: getCSIDivision(elementType),
      properties: props,
      raw: el,
    });
  }

  return { resolved, skipped };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLASH DETECTORS — 5 categories
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. HARD CLASHES (physical intersection) ────────────────────────────────

function detectHardClashes(elements: ResolvedElement[]): Clash[] {
  const clashes: Clash[] = [];

  // Only check cross-discipline pairs (same-discipline overlaps are often intentional)
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const a = elements[i];
      const b = elements[j];

      // Skip same-discipline pairs (e.g. two walls touching is normal)
      if (a.discipline === b.discipline) continue;

      // Skip pairs where both are architectural (wall/door, wall/window are expected)
      if (a.discipline === 'architectural' && b.discipline === 'architectural') continue;

      if (aabbIntersects(a.bbox, b.bbox)) {
        const overlap = aabbOverlapVolume(a.bbox, b.bbox);
        if (overlap < 0.0001) continue; // Negligible overlap (<0.1L) = touching, not clashing

        const center = aabbCenter(a.bbox);
        const severity = classifyHardClashSeverity(a, b, overlap);

        clashes.push({
          id: clashId(a.id, b.id, 'hard'),
          category: 'hard',
          severity,
          elementA: { id: a.id, name: a.name, type: a.elementType, discipline: a.discipline, storey: a.storey },
          elementB: { id: b.id, name: b.name, type: b.elementType, discipline: b.discipline, storey: b.storey },
          description: `Physical intersection: ${a.name} (${a.discipline}) intersects ${b.name} (${b.discipline}). Overlap volume: ${overlap.toFixed(4)} m³`,
          location: center,
          overlapVolume: overlap,
          clearanceRequired: 0,
          clearanceActual: 0,
          codeReference: determinCodeReference(a, b),
          recommendation: generateHardClashRecommendation(a, b),
          rfiRequired: severity === 'critical' || severity === 'high',
          rfiDescription: severity === 'critical' || severity === 'high'
            ? `RFI: ${a.elementType} (Div ${a.csiDivision}) physically conflicts with ${b.elementType} (Div ${b.csiDivision}). Coordination required between trades.`
            : '',
          status: 'open',
        });
      }
    }
  }

  return clashes;
}

function classifyHardClashSeverity(a: ResolvedElement, b: ResolvedElement, overlap: number): ClashSeverity {
  // Structural vs MEP = critical (can't move structure)
  if (a.discipline === 'structural' || b.discipline === 'structural') {
    const other = a.discipline === 'structural' ? b : a;
    if (['mechanical', 'electrical', 'plumbing', 'fire_protection'].includes(other.discipline)) {
      return overlap > 0.01 ? 'critical' : 'high';
    }
  }

  // MEP vs MEP = high (both can potentially be rerouted)
  if (['mechanical', 'electrical', 'plumbing'].includes(a.discipline) &&
      ['mechanical', 'electrical', 'plumbing'].includes(b.discipline)) {
    return 'high';
  }

  // Fire protection vs anything = high (life safety)
  if (a.discipline === 'fire_protection' || b.discipline === 'fire_protection') {
    return 'high';
  }

  return overlap > 0.05 ? 'medium' : 'low';
}

function determinCodeReference(a: ResolvedElement, b: ResolvedElement): string {
  if (a.discipline === 'fire_protection' || b.discipline === 'fire_protection') return 'NBC 3.2.5 / OBC 3.2.5';
  if (a.discipline === 'structural') return 'CSA A23.3 / CSA S16';
  if (a.discipline === 'electrical' || b.discipline === 'electrical') return 'CEC Rule 12-012';
  if (a.discipline === 'plumbing' || b.discipline === 'plumbing') return 'NPC 2.4.5';
  if (a.discipline === 'mechanical' || b.discipline === 'mechanical') return 'CSA B52 / ASHRAE 15';
  return 'SPEC_REQUIRED';
}

function generateHardClashRecommendation(a: ResolvedElement, b: ResolvedElement): string {
  const structural = a.discipline === 'structural' ? a : (b.discipline === 'structural' ? b : null);
  const mep = structural ? (a === structural ? b : a) : null;

  if (structural && mep) {
    return `Relocate ${mep.elementType} to avoid ${structural.elementType}. Structural elements cannot be moved. If penetration is required, provide sleeve detail per structural engineer's review.`;
  }

  if (a.discipline === 'fire_protection' || b.discipline === 'fire_protection') {
    return `Fire protection system clash requires coordination. Verify sprinkler head coverage and clearance per NFPA 13. Submit coordination drawing.`;
  }

  return `Coordinate ${a.discipline} and ${b.discipline} routing. Submit combined coordination drawing showing clash resolution.`;
}

// ─── 2. SOFT CLASHES (clearance violations) ──────────────────────────────────

function detectSoftClashes(
  elements: ResolvedElement[],
  clearances: ClearanceRequirements
): { clashes: Clash[]; missingData: string[] } {
  const clashes: Clash[] = [];
  const missingData: string[] = [];

  // Build clearance lookup by discipline pair
  const clearancePairs = buildClearancePairs(clearances, missingData);

  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const a = elements[i];
      const b = elements[j];

      // Skip same-element-type pairs on different storeys
      if (a.storey !== b.storey && a.storey !== 'Unassigned' && b.storey !== 'Unassigned') continue;

      const pairKey = disciplinePairKey(a.discipline, b.discipline);
      const required_mm = clearancePairs.get(pairKey);

      if (required_mm === undefined || required_mm === null) continue;

      // Already overlapping = hard clash (handled above)
      if (aabbIntersects(a.bbox, b.bbox)) continue;

      const actual_mm = aabbMinDistance_mm(a.bbox, b.bbox);

      if (actual_mm < required_mm) {
        const center = aabbCenter(a.bbox);

        clashes.push({
          id: clashId(a.id, b.id, 'soft'),
          category: 'soft',
          severity: actual_mm < required_mm * 0.5 ? 'high' : 'medium',
          elementA: { id: a.id, name: a.name, type: a.elementType, discipline: a.discipline, storey: a.storey },
          elementB: { id: b.id, name: b.name, type: b.elementType, discipline: b.discipline, storey: b.storey },
          description: `Clearance violation: ${actual_mm.toFixed(0)}mm actual vs ${required_mm}mm required between ${a.name} and ${b.name}`,
          location: center,
          overlapVolume: 0,
          clearanceRequired: required_mm,
          clearanceActual: actual_mm,
          codeReference: 'SPEC_REQUIRED',
          recommendation: `Increase separation between ${a.elementType} and ${b.elementType} by ${(required_mm - actual_mm).toFixed(0)}mm to meet clearance requirements.`,
          rfiRequired: actual_mm < required_mm * 0.5,
          rfiDescription: actual_mm < required_mm * 0.5
            ? `RFI: Clearance between ${a.elementType} and ${b.elementType} is ${actual_mm.toFixed(0)}mm — less than 50% of the ${required_mm}mm requirement.`
            : '',
          status: 'open',
        });
      }
    }
  }

  return { clashes, missingData };
}

function disciplinePairKey(a: Discipline, b: Discipline): string {
  return [a, b].sort().join(':');
}

function buildClearancePairs(
  c: ClearanceRequirements,
  missingData: string[]
): Map<string, number> {
  const pairs = new Map<string, number>();

  const trySet = (a: Discipline, b: Discipline, val: number | null, label: string) => {
    if (val !== null && val > 0) {
      pairs.set(disciplinePairKey(a, b), val);
    } else {
      missingData.push(`Missing clearance: ${label} (${a} ↔ ${b}). Provide via project specifications or user input.`);
    }
  };

  trySet('mechanical', 'mechanical', c.ductToDuct_mm, 'Duct-to-duct clearance');
  trySet('mechanical', 'structural', c.ductToStructural_mm, 'Duct-to-structural clearance');
  trySet('plumbing', 'plumbing', c.pipeToPipe_mm, 'Pipe-to-pipe clearance');
  trySet('plumbing', 'structural', c.pipeToStructural_mm, 'Pipe-to-structural clearance');
  trySet('electrical', 'electrical', c.conduitToConduit_mm, 'Conduit-to-conduit clearance');
  trySet('fire_protection', 'architectural', c.sprinklerToObstruction_mm, 'Sprinkler-to-obstruction clearance');
  trySet('fire_protection', 'mechanical', c.sprinklerToObstruction_mm, 'Sprinkler-to-duct clearance');

  return pairs;
}

// ─── 3. WORKFLOW CLASHES (construction sequence conflicts) ───────────────────

function detectWorkflowClashes(elements: ResolvedElement[]): Clash[] {
  const clashes: Clash[] = [];

  // Group elements by storey
  const storeyGroups = new Map<string, ResolvedElement[]>();
  for (const el of elements) {
    const key = el.storey || 'Unassigned';
    if (!storeyGroups.has(key)) storeyGroups.set(key, []);
    storeyGroups.get(key)!.push(el);
  }

  for (const [storey, stElements] of storeyGroups) {
    // Find elements that physically overlap and have incorrect sequence
    for (let i = 0; i < stElements.length; i++) {
      for (let j = i + 1; j < stElements.length; j++) {
        const a = stElements[i];
        const b = stElements[j];

        // Only check if they're spatially related (within 1m of each other)
        const dist = aabbMinDistance_mm(a.bbox, b.bbox);
        if (dist > 1000) continue; // More than 1m apart = not sequence-relevant

        const seqA = getSequencePriority(a.elementType);
        const seqB = getSequencePriority(b.elementType);

        // Check specific workflow conflicts
        const conflict = checkWorkflowConflict(a, b, seqA, seqB);
        if (conflict) {
          const center = aabbCenter(a.bbox);
          clashes.push({
            id: clashId(a.id, b.id, 'workflow'),
            category: 'workflow',
            severity: conflict.severity,
            elementA: { id: a.id, name: a.name, type: a.elementType, discipline: a.discipline, storey },
            elementB: { id: b.id, name: b.name, type: b.elementType, discipline: b.discipline, storey },
            description: conflict.description,
            location: center,
            overlapVolume: 0,
            clearanceRequired: 0,
            clearanceActual: dist,
            codeReference: 'Construction Sequencing',
            recommendation: conflict.recommendation,
            rfiRequired: conflict.severity === 'critical',
            rfiDescription: conflict.severity === 'critical' ? conflict.description : '',
            status: 'open',
          });
        }
      }
    }
  }

  return clashes;
}

function checkWorkflowConflict(
  a: ResolvedElement, b: ResolvedElement,
  seqA: number, seqB: number
): { description: string; recommendation: string; severity: ClashSeverity } | null {
  const tA = a.elementType;
  const tB = b.elementType;

  // Underground MEP must be installed before slab pour
  if ((tA.includes('slab') && (tB.includes('pipe') || tB.includes('drain') || tB.includes('sanitary'))) ||
      (tB.includes('slab') && (tA.includes('pipe') || tA.includes('drain') || tA.includes('sanitary')))) {
    const slab = tA.includes('slab') ? a : b;
    const mep = tA.includes('slab') ? b : a;
    if (mep.elevation <= slab.elevation) {
      return {
        description: `Underground ${mep.elementType} must be installed BEFORE ${slab.elementType} pour. Elements are at same elevation.`,
        recommendation: `Sequence: Complete underground ${mep.elementType} rough-in → inspection → pour ${slab.elementType}. Coordinate with structural and MEP trades.`,
        severity: 'critical',
      };
    }
  }

  // Structural must be complete before MEP installation at same location
  if (a.discipline === 'structural' && ['mechanical', 'electrical', 'plumbing'].includes(b.discipline)) {
    if (aabbIntersects(a.bbox, b.bbox)) {
      return {
        description: `${b.elementType} (MEP) installation area overlaps with ${a.elementType} (structural). Structure must be complete first.`,
        recommendation: `Verify structural completion at this location before MEP rough-in. If penetration needed, submit sleeve/opening request to structural engineer BEFORE pour.`,
        severity: 'high',
      };
    }
  }

  // Insulation before drywall
  if ((tA.includes('drywall') || tA.includes('partition')) && tB.includes('insulation')) {
    return {
      description: `Insulation must be installed and inspected BEFORE drywall closure.`,
      recommendation: `Sequence: MEP rough-in → insulation install → inspection → drywall close.`,
      severity: 'medium',
    };
  }

  // Ceiling MEP before ceiling grid
  if (tA.includes('ceiling') && ['mechanical', 'electrical', 'plumbing', 'fire_protection'].includes(b.discipline)) {
    return {
      description: `Above-ceiling ${b.elementType} must be complete before ceiling grid installation.`,
      recommendation: `Complete all above-ceiling MEP coordination and installation before ceiling grid. Photograph as-built for records.`,
      severity: 'medium',
    };
  }

  return null;
}

// ─── 4. CODE COMPLIANCE CLASHES ─────────────────────────────────────────────

function detectCodeComplianceClashes(
  elements: ResolvedElement[],
  clearances: ClearanceRequirements
): { clashes: Clash[]; missingData: string[] } {
  const clashes: Clash[] = [];
  const missingData: string[] = [];

  for (const el of elements) {
    // Electrical panel clearance check
    if (el.elementType.includes('panel') && el.discipline === 'electrical') {
      if (clearances.panelFrontClearance_mm === null) {
        missingData.push('Missing: Electrical panel front clearance (CEC Rule 2-308). Provide from project specs.');
      } else {
        const frontClearance = checkFrontClearance(el, elements, clearances.panelFrontClearance_mm);
        if (frontClearance) clashes.push(frontClearance);
      }
    }

    // Sprinkler head clearance to ceiling
    if (el.elementType.includes('sprinkler') && el.discipline === 'fire_protection') {
      if (clearances.sprinklerToCeiling_mm === null) {
        missingData.push('Missing: Sprinkler head to ceiling distance (NFPA 13 / NBC 3.2.5). Provide from project specs.');
      } else {
        const sprinklerClash = checkSprinklerClearance(el, elements, clearances.sprinklerToCeiling_mm);
        if (sprinklerClash) clashes.push(sprinklerClash);
      }
    }

    // Corridor/egress width checks
    if ((el.elementType.includes('corridor') || el.elementType.includes('hallway')) &&
        el.discipline === 'architectural') {
      if (clearances.corridorMinWidth_mm === null) {
        missingData.push('Missing: Minimum corridor width (NBC 3.3.1.5 / OBC 3.3.1.5). Provide from project specs.');
      } else {
        const egressClash = checkEgressWidth(el, clearances.corridorMinWidth_mm);
        if (egressClash) clashes.push(egressClash);
      }
    }

    // Door minimum dimensions
    if (el.elementType.includes('door') && el.discipline === 'architectural') {
      if (clearances.doorMinWidth_mm !== null) {
        const doorW = (el.dimensions.width || 0) * 1000; // m → mm
        if (doorW > 0 && doorW < clearances.doorMinWidth_mm) {
          const center = aabbCenter(el.bbox);
          clashes.push({
            id: clashId(el.id, 'CODE', 'code_compliance'),
            category: 'code_compliance',
            severity: 'high',
            elementA: { id: el.id, name: el.name, type: el.elementType, discipline: el.discipline, storey: el.storey },
            elementB: { id: 'NBC', name: 'Building Code', type: 'code_requirement', discipline: 'other', storey: el.storey },
            description: `Door width ${doorW.toFixed(0)}mm is less than minimum ${clearances.doorMinWidth_mm}mm per NBC 3.3.1.5.`,
            location: center,
            overlapVolume: 0,
            clearanceRequired: clearances.doorMinWidth_mm,
            clearanceActual: doorW,
            codeReference: 'NBC 3.3.1.5 / OBC 3.3.1.5',
            recommendation: `Increase door width to minimum ${clearances.doorMinWidth_mm}mm. Verify accessibility requirements (AODA / NBC 3.8).`,
            rfiRequired: true,
            rfiDescription: `RFI: Door ${el.name} width (${doorW.toFixed(0)}mm) does not meet minimum code requirement (${clearances.doorMinWidth_mm}mm).`,
            status: 'open',
          });
        }
      }
    }

    // Ceiling height check
    if (el.elementType.includes('ceiling') && el.discipline === 'architectural') {
      if (clearances.ceilingMinHeight_mm !== null) {
        const ceilH = (el.elevation || 0) * 1000;
        if (ceilH > 0 && ceilH < clearances.ceilingMinHeight_mm) {
          const center = aabbCenter(el.bbox);
          clashes.push({
            id: clashId(el.id, 'CODE-CEIL', 'code_compliance'),
            category: 'code_compliance',
            severity: 'medium',
            elementA: { id: el.id, name: el.name, type: el.elementType, discipline: el.discipline, storey: el.storey },
            elementB: { id: 'NBC', name: 'Building Code', type: 'code_requirement', discipline: 'other', storey: el.storey },
            description: `Ceiling height ${ceilH.toFixed(0)}mm is below minimum ${clearances.ceilingMinHeight_mm}mm.`,
            location: center,
            overlapVolume: 0,
            clearanceRequired: clearances.ceilingMinHeight_mm,
            clearanceActual: ceilH,
            codeReference: 'NBC 3.3.1.2 / OBC 3.8.2.3',
            recommendation: `Verify ceiling height meets code requirements. Check for MEP services reducing available clear height.`,
            rfiRequired: false,
            rfiDescription: '',
            status: 'open',
          });
        }
      }
    }
  }

  return { clashes, missingData };
}

/** Check if electrical panel has required front clearance */
function checkFrontClearance(
  panel: ResolvedElement,
  allElements: ResolvedElement[],
  required_mm: number
): Clash | null {
  const expandedBbox = aabbExpand(panel.bbox, required_mm);

  for (const other of allElements) {
    if (other.id === panel.id) continue;
    if (other.discipline === 'electrical') continue; // Don't clash with own discipline

    if (aabbIntersects(expandedBbox, other.bbox)) {
      const actual = aabbMinDistance_mm(panel.bbox, other.bbox);
      if (actual < required_mm) {
        const center = aabbCenter(panel.bbox);
        return {
          id: clashId(panel.id, other.id, 'code_compliance'),
          category: 'code_compliance',
          severity: 'critical',
          elementA: { id: panel.id, name: panel.name, type: panel.elementType, discipline: panel.discipline, storey: panel.storey },
          elementB: { id: other.id, name: other.name, type: other.elementType, discipline: other.discipline, storey: other.storey },
          description: `Electrical panel clearance violation: ${actual.toFixed(0)}mm actual vs ${required_mm}mm required (CEC Rule 2-308).`,
          location: center,
          overlapVolume: 0,
          clearanceRequired: required_mm,
          clearanceActual: actual,
          codeReference: 'CEC Rule 2-308 / OESC',
          recommendation: `Remove obstruction or relocate panel. CEC requires ${required_mm}mm clear working space in front of electrical panels. Life safety issue.`,
          rfiRequired: true,
          rfiDescription: `RFI: Electrical panel ${panel.name} front clearance obstructed by ${other.name}. CEC Rule 2-308 violation.`,
          status: 'open',
        };
      }
    }
  }

  return null;
}

/** Check sprinkler head clearance */
function checkSprinklerClearance(
  sprinkler: ResolvedElement,
  allElements: ResolvedElement[],
  required_mm: number
): Clash | null {
  for (const other of allElements) {
    if (other.id === sprinkler.id) continue;
    if (other.discipline === 'fire_protection') continue;
    if (!other.elementType.includes('ceiling') && other.discipline !== 'mechanical') continue;

    const dist = aabbMinDistance_mm(sprinkler.bbox, other.bbox);
    if (dist < required_mm && dist >= 0) {
      const center = aabbCenter(sprinkler.bbox);
      return {
        id: clashId(sprinkler.id, other.id, 'code_compliance'),
        category: 'code_compliance',
        severity: 'high',
        elementA: { id: sprinkler.id, name: sprinkler.name, type: sprinkler.elementType, discipline: sprinkler.discipline, storey: sprinkler.storey },
        elementB: { id: other.id, name: other.name, type: other.elementType, discipline: other.discipline, storey: other.storey },
        description: `Sprinkler head clearance ${dist.toFixed(0)}mm vs ${required_mm}mm required (NFPA 13 / NBC 3.2.5).`,
        location: center,
        overlapVolume: 0,
        clearanceRequired: required_mm,
        clearanceActual: dist,
        codeReference: 'NFPA 13 Section 8.6 / NBC 3.2.5',
        recommendation: `Adjust sprinkler head position or relocate obstruction to maintain ${required_mm}mm clearance. Life safety — do not reduce.`,
        rfiRequired: true,
        rfiDescription: `RFI: Sprinkler head ${sprinkler.name} clearance obstructed. NFPA 13 violation.`,
        status: 'open',
      };
    }
  }

  return null;
}

/** Check egress width */
function checkEgressWidth(el: ResolvedElement, minWidth_mm: number): Clash | null {
  const widthM = el.dimensions.width || 0;
  const width_mm = widthM * 1000;

  if (width_mm > 0 && width_mm < minWidth_mm) {
    const center = aabbCenter(el.bbox);
    return {
      id: clashId(el.id, 'CODE-EGRESS', 'code_compliance'),
      category: 'code_compliance',
      severity: 'critical',
      elementA: { id: el.id, name: el.name, type: el.elementType, discipline: el.discipline, storey: el.storey },
      elementB: { id: 'NBC', name: 'Building Code', type: 'egress_requirement', discipline: 'other', storey: el.storey },
      description: `Egress corridor width ${width_mm.toFixed(0)}mm is below minimum ${minWidth_mm}mm (NBC 3.3.1.5).`,
      location: center,
      overlapVolume: 0,
      clearanceRequired: minWidth_mm,
      clearanceActual: width_mm,
      codeReference: 'NBC 3.3.1.5 / OBC 3.3.1.5',
      recommendation: `Widen corridor to minimum ${minWidth_mm}mm. Check if MEP services are encroaching on egress width. Life safety — mandatory compliance.`,
      rfiRequired: true,
      rfiDescription: `RFI: Corridor ${el.name} width (${width_mm.toFixed(0)}mm) does not meet minimum egress requirement (${minWidth_mm}mm).`,
      status: 'open',
    };
  }

  return null;
}

// ─── 5. TOLERANCE CLASHES (proximity warnings) ──────────────────────────────

function detectToleranceClashes(
  elements: ResolvedElement[],
  tolerance_mm: number
): Clash[] {
  const clashes: Clash[] = [];

  if (tolerance_mm <= 0) return clashes;

  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const a = elements[i];
      const b = elements[j];

      // Only flag cross-discipline near-misses
      if (a.discipline === b.discipline) continue;
      if (aabbIntersects(a.bbox, b.bbox)) continue; // Already caught by hard clash

      const dist = aabbMinDistance_mm(a.bbox, b.bbox);
      if (dist > 0 && dist <= tolerance_mm) {
        const center = aabbCenter(a.bbox);
        clashes.push({
          id: clashId(a.id, b.id, 'tolerance'),
          category: 'tolerance',
          severity: 'info',
          elementA: { id: a.id, name: a.name, type: a.elementType, discipline: a.discipline, storey: a.storey },
          elementB: { id: b.id, name: b.name, type: b.elementType, discipline: b.discipline, storey: b.storey },
          description: `Proximity warning: ${a.name} and ${b.name} are only ${dist.toFixed(0)}mm apart (tolerance threshold: ${tolerance_mm}mm).`,
          location: center,
          overlapVolume: 0,
          clearanceRequired: tolerance_mm,
          clearanceActual: dist,
          codeReference: 'Construction tolerance',
          recommendation: `Review proximity. Construction tolerances or thermal movement may cause contact. Consider increasing separation.`,
          rfiRequired: false,
          rfiDescription: '',
          status: 'open',
        });
      }
    }
  }

  return clashes;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

function buildSummary(clashes: Clash[]): ClashDetectionResult['summary'] {
  const bySeverity: Record<ClashSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byCategory: Record<ClashCategory, number> = { hard: 0, soft: 0, workflow: 0, code_compliance: 0, tolerance: 0 };
  const byStorey: Record<string, number> = {};
  const byDisciplinePair: Record<string, number> = {};
  let rfisRequired = 0;

  for (const c of clashes) {
    bySeverity[c.severity]++;
    byCategory[c.category]++;

    const storey = c.elementA.storey || c.elementB.storey || 'Unknown';
    byStorey[storey] = (byStorey[storey] || 0) + 1;

    const pair = [c.elementA.discipline, c.elementB.discipline].sort().join(' ↔ ');
    byDisciplinePair[pair] = (byDisciplinePair[pair] || 0) + 1;

    if (c.rfiRequired) rfisRequired++;
  }

  return { totalClashes: clashes.length, bySeverity, byCategory, byStorey, byDisciplinePair, rfisRequired };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINTS — Exported functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Default (empty) clearance requirements — all null = all require user input.
 * This enforces the QS principle: no hardcoded dimensional defaults.
 */
export function emptyClearanceRequirements(): ClearanceRequirements {
  return {
    ductToDuct_mm: null,
    ductToStructural_mm: null,
    pipeToPipe_mm: null,
    pipeToStructural_mm: null,
    equipmentServiceClearance_mm: null,
    panelFrontClearance_mm: null,
    panelSideClearance_mm: null,
    conduitToConduit_mm: null,
    drainSlopePercent: null,
    cleanoutAccessClearance_mm: null,
    sprinklerToCeiling_mm: null,
    sprinklerToObstruction_mm: null,
    fireDamperAccessClearance_mm: null,
    columnFireRating_hr: null,
    beamFireRating_hr: null,
    corridorMinWidth_mm: null,
    stairMinWidth_mm: null,
    doorMinWidth_mm: null,
    doorMinHeight_mm: null,
    ceilingMinHeight_mm: null,
    accessPanelClearance_mm: null,
  };
}

/**
 * Run full clash detection against a BIM model.
 *
 * @param modelId   - BIM model ID in storage
 * @param clearances - Clearance requirements from project specs or user input
 * @param tolerance_mm - Proximity tolerance threshold (default 50mm)
 */
export async function runClashDetection(
  modelId: string,
  clearances: Partial<ClearanceRequirements>,
  tolerance_mm: number = 50
): Promise<ClashDetectionResult> {

  // ── 1. Load BIM elements from storage ──
  const rawElements = await storage.getBimElements(modelId);
  if (!rawElements || rawElements.length === 0) {
    throw new Error(`No BIM elements found for model ${modelId}. Generate BIM model first.`);
  }

  // ── 2. Get project ID from model ──
  const model = await storage.getBimModel(modelId);
  const projectId = model?.projectId || 'unknown';

  // ── 3. Merge clearances with empty defaults (null = not provided) ──
  const mergedClearances: ClearanceRequirements = {
    ...emptyClearanceRequirements(),
    ...clearances,
  };

  // ── 4. Resolve elements (parse geometry, classify disciplines) ──
  const { resolved, skipped } = resolveElements(rawElements);

  if (resolved.length === 0) {
    throw new Error(`No elements with valid geometry found in model ${modelId}. ${skipped} elements skipped (missing geometry data).`);
  }

  // ── 5. Run all 5 clash detection categories ──
  const hardClashes = detectHardClashes(resolved);
  const { clashes: softClashes, missingData: softMissing } = detectSoftClashes(resolved, mergedClearances);
  const workflowClashes = detectWorkflowClashes(resolved);
  const { clashes: codeClashes, missingData: codeMissing } = detectCodeComplianceClashes(resolved, mergedClearances);
  const toleranceClashes = detectToleranceClashes(resolved, tolerance_mm);

  // ── 6. Combine and deduplicate ──
  const allClashes = [
    ...hardClashes,
    ...softClashes,
    ...workflowClashes,
    ...codeClashes,
    ...toleranceClashes,
  ];

  // Deduplicate by clash ID
  const seen = new Set<string>();
  const uniqueClashes = allClashes.filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  // Sort: critical first, then by category
  const severityOrder: Record<ClashSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  uniqueClashes.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // ── 7. Build result ──
  const missingClearanceData = [...new Set([...softMissing, ...codeMissing])];

  return {
    modelId,
    projectId,
    runDate: new Date().toISOString(),
    totalElements: rawElements.length,
    resolvedElements: resolved.length,
    skippedElements: skipped,
    clashes: uniqueClashes,
    summary: buildSummary(uniqueClashes),
    missingClearanceData,
    methodology: 'CIQS',
    engine: 'EstimatorPro-ClashDetection-v1',
  };
}

/**
 * Run clash detection for a project (finds latest model automatically).
 */
export async function runClashDetectionForProject(
  projectId: string,
  clearances: Partial<ClearanceRequirements>,
  tolerance_mm: number = 50
): Promise<ClashDetectionResult> {
  const models = await storage.getBimModels(projectId);
  if (!models || models.length === 0) {
    throw new Error(`No BIM models found for project ${projectId}. Generate a BIM model first.`);
  }

  // Use the most recently created model
  const latest = models.sort((a, b) =>
    new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  )[0];

  return runClashDetection(latest.id, clearances, tolerance_mm);
}

/**
 * Get discipline breakdown for a model (useful for UI before running full detection).
 */
export async function getModelDisciplineBreakdown(modelId: string): Promise<{
  total: number;
  byDiscipline: Record<Discipline, number>;
  byCSIDivision: Record<string, number>;
  byStorey: Record<string, number>;
  geometryResolvable: number;
  geometryMissing: number;
}> {
  const rawElements = await storage.getBimElements(modelId);
  const { resolved, skipped } = resolveElements(rawElements);

  const byDiscipline: Record<string, number> = {};
  const byCSIDivision: Record<string, number> = {};
  const byStorey: Record<string, number> = {};

  for (const el of resolved) {
    byDiscipline[el.discipline] = (byDiscipline[el.discipline] || 0) + 1;
    byCSIDivision[el.csiDivision] = (byCSIDivision[el.csiDivision] || 0) + 1;
    byStorey[el.storey] = (byStorey[el.storey] || 0) + 1;
  }

  return {
    total: rawElements.length,
    byDiscipline: byDiscipline as Record<Discipline, number>,
    byCSIDivision,
    byStorey,
    geometryResolvable: resolved.length,
    geometryMissing: skipped,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════
//
// Interfaces:  AABB, ResolvedElement, Clash, ClearanceRequirements,
//              ClashDetectionResult, ClashCategory, ClashSeverity, Discipline
//
// Functions:   runClashDetection(modelId, clearances, tolerance)
//              runClashDetectionForProject(projectId, clearances, tolerance)
//              getModelDisciplineBreakdown(modelId)
//              emptyClearanceRequirements()
//
// Categories:  1. Hard clashes (physical intersection)
//              2. Soft clashes (clearance violations)
//              3. Workflow clashes (construction sequence)
//              4. Code compliance clashes (NBC/OBC/CEC/NFPA)
//              5. Tolerance clashes (proximity warnings)
//
// Principle:   NO hardcoded clearance values. All from specs or user input.
//              Missing data → reported in missingClearanceData[] for RFI.
// ═══════════════════════════════════════════════════════════════════════════════
