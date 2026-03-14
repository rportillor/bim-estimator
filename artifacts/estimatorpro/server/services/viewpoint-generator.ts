/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  VIEWPOINT GENERATOR — SOP Part 9
 *  EstimatorPro v14.35 — Project-agnostic
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Generates 3 viewpoints per clash group (ISO, SEC, PLAN):
 *    1. Camera positioning relative to clash centroid
 *    2. Color overrides: Red=offender, Amber=victim, Gray=context
 *    3. Stable naming: {GroupId}__ISO / __SEC / __PLAN
 *    4. Visibility overrides: only relevant elements shown
 *    5. Reproducible workflow for re-generation on model updates
 *
 *  Standards: BCF 2.1 viewpoint spec, CIQS, ISO 19650
 *  Consumed by: bcf-export.ts, bim-coordination-router.ts
 *  Depends on:  dedup-engine.ts (ClashGroup), clash-detection-engine.ts (AABB)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { ClashGroup } from './dedup-engine';
import type { AABB } from './clash-detection-engine';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type ViewpointType = 'ISO' | 'SEC' | 'PLAN';

export interface Vector3 { x: number; y: number; z: number; }

export interface CameraSetup {
  eyePosition: Vector3;
  lookAt: Vector3;
  upVector: Vector3;
  fieldOfView: number;
  nearClip: number;
  farClip: number;
}

export interface ColorOverride {
  elementId: string;
  role: 'offender' | 'victim' | 'context';
  color: string;        // RRGGBB hex
  transparency: number; // 0.0 (opaque) to 1.0 (invisible)
}

export interface VisibilityOverride {
  elementId: string;
  visible: boolean;
}

export interface Viewpoint {
  id: string;                      // {groupId}__{type}
  groupId: string;
  type: ViewpointType;
  camera: CameraSetup;
  colorOverrides: ColorOverride[];
  visibilityOverrides: VisibilityOverride[];
  sectionPlane: SectionPlane | null;
  description: string;
}

export interface SectionPlane {
  origin: Vector3;
  normal: Vector3;
}

export interface ViewpointSet {
  groupId: string;
  groupDescription: string;
  viewpoints: [Viewpoint, Viewpoint, Viewpoint]; // ISO, SEC, PLAN
}

// ═══════════════════════════════════════════════════════════════════════════════
// COLOR CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const COLORS = {
  OFFENDER: 'FF0000',    // Red
  VICTIM:   'FF8C00',    // Amber/Orange
  CONTEXT:  '808080',    // Gray
} as const;

const TRANSPARENCY = {
  OFFENDER: 0.0,
  VICTIM:   0.0,
  CONTEXT:  0.5,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// CAMERA CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute a bounding box that envelopes all elements in a clash group.
 */
function computeGroupBounds(group: ClashGroup): AABB {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const clash of group.clashes) {
    for (const el of [clash.elementA, clash.elementB]) {
      if (el.bbox) {
        minX = Math.min(minX, el.bbox.minX);
        minY = Math.min(minY, el.bbox.minY);
        minZ = Math.min(minZ, el.bbox.minZ);
        maxX = Math.max(maxX, el.bbox.maxX);
        maxY = Math.max(maxY, el.bbox.maxY);
        maxZ = Math.max(maxZ, el.bbox.maxZ);
      }
    }
  }

  // Fallback if no valid bounds
  if (!isFinite(minX)) {
    return { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };
  }

  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function centroid(bounds: AABB): Vector3 {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
}

function diagonalLength(bounds: AABB): number {
  const dx = bounds.maxX - bounds.minX;
  const dy = bounds.maxY - bounds.minY;
  const dz = bounds.maxZ - bounds.minZ;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Generate camera setups for 3 standard viewpoints.
 */
function computeCameras(bounds: AABB): Record<ViewpointType, CameraSetup> {
  const center = centroid(bounds);
  const dist = Math.max(diagonalLength(bounds) * 1.5, 2); // Minimum 2m distance
  const far = dist * 10;

  return {
    ISO: {
      eyePosition: { x: center.x + dist * 0.7, y: center.y + dist * 0.7, z: center.z + dist * 0.5 },
      lookAt: center,
      upVector: { x: 0, y: 0, z: 1 },
      fieldOfView: 60,
      nearClip: 0.01,
      farClip: far,
    },
    SEC: {
      eyePosition: { x: center.x, y: center.y + dist, z: center.z },
      lookAt: center,
      upVector: { x: 0, y: 0, z: 1 },
      fieldOfView: 60,
      nearClip: 0.01,
      farClip: far,
    },
    PLAN: {
      eyePosition: { x: center.x, y: center.y, z: center.z + dist },
      lookAt: center,
      upVector: { x: 0, y: 1, z: 0 },
      fieldOfView: 60,
      nearClip: 0.01,
      farClip: far,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIEWPOINT GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a complete viewpoint set (ISO/SEC/PLAN) for a clash group.
 */
export function generateViewpointSet(group: ClashGroup): ViewpointSet {
  const bounds = computeGroupBounds(group);
  const cameras = computeCameras(bounds);
  const center = centroid(bounds);

  // Build color overrides
  const colorOverrides = buildColorOverrides(group);
  const visibilityOverrides = buildVisibilityOverrides(group);

  const types: ViewpointType[] = ['ISO', 'SEC', 'PLAN'];
  const viewpoints = types.map(type => {
    const sectionPlane: SectionPlane | null = type === 'SEC'
      ? { origin: center, normal: { x: 0, y: -1, z: 0 } }
      : type === 'PLAN'
        ? { origin: center, normal: { x: 0, y: 0, z: -1 } }
        : null;

    return {
      id: `${group.groupId}__${type}`,
      groupId: group.groupId,
      type,
      camera: cameras[type],
      colorOverrides,
      visibilityOverrides,
      sectionPlane,
      description: `${type} view of ${group.description}`,
    } as Viewpoint;
  }) as [Viewpoint, Viewpoint, Viewpoint];

  return {
    groupId: group.groupId,
    groupDescription: group.description,
    viewpoints,
  };
}

/**
 * Generate viewpoint sets for all clash groups.
 */
export function generateAllViewpoints(groups: ClashGroup[]): ViewpointSet[] {
  return groups.map(generateViewpointSet);
}

/**
 * Build color overrides: Red=offender, Amber=victims, Gray=context elements.
 */
function buildColorOverrides(group: ClashGroup): ColorOverride[] {
  const overrides: ColorOverride[] = [];
  const seen = new Set<string>();

  // Offender (red)
  if (!seen.has(group.rootCauseElementId)) {
    overrides.push({
      elementId: group.rootCauseElementId,
      role: 'offender',
      color: COLORS.OFFENDER,
      transparency: TRANSPARENCY.OFFENDER,
    });
    seen.add(group.rootCauseElementId);
  }

  // Victims (amber)
  for (const victimId of group.affectedElements) {
    if (!seen.has(victimId)) {
      overrides.push({
        elementId: victimId,
        role: 'victim',
        color: COLORS.VICTIM,
        transparency: TRANSPARENCY.VICTIM,
      });
      seen.add(victimId);
    }
  }

  // Context: other elements from clashes not already covered
  for (const clash of group.clashes) {
    for (const el of [clash.elementA, clash.elementB]) {
      const elId = el.id || el.elementId;
      if (!seen.has(elId)) {
        overrides.push({
          elementId: elId,
          role: 'context',
          color: COLORS.CONTEXT,
          transparency: TRANSPARENCY.CONTEXT,
        });
        seen.add(elId);
      }
    }
  }

  return overrides;
}

/**
 * Build visibility overrides: show only elements involved in the group.
 */
function buildVisibilityOverrides(group: ClashGroup): VisibilityOverride[] {
  const visibleIds = new Set<string>();
  visibleIds.add(group.rootCauseElementId);
  for (const id of group.affectedElements) visibleIds.add(id);
  for (const clash of group.clashes) {
    visibleIds.add(clash.elementA.id || clash.elementA.elementId);
    visibleIds.add(clash.elementB.id || clash.elementB.elementId);
  }

  return Array.from(visibleIds).map(id => ({ elementId: id, visible: true }));
}
