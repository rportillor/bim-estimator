/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  GEOMETRY UPGRADE — Replaces bounding-box geometry with parametric profiles
 *
 *  A human modeler in Revit never places a "box" for a beam — they select
 *  a W14x22 section and the software renders the actual I-beam shape.
 *  This module bridges that gap by:
 *
 *  1. Looking up steel section designations in the AISC/CISC database
 *  2. Matching wall types to multi-layer assembly definitions
 *  3. Determining actual column shapes (round vs square vs rectangular)
 *  4. Adding profile metadata so the 3D viewer can render real shapes
 *
 *  Runs as a post-processing pass after elements are positioned.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { lookupSteelSection } from '../bim/steel-sections-db';
import { WALL_ASSEMBLIES } from '../bim/parametric-elements';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawElement {
  id: string;
  type?: string;
  elementType?: string;
  category?: string;
  name?: string;
  geometry?: any;
  properties?: any;
}

interface UpgradeResult {
  elements: RawElement[];
  stats: {
    steelProfilesResolved: number;
    wallAssembliesMatched: number;
    columnShapesDetermined: number;
    mepShapesDetermined: number;
    total: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getType(e: RawElement): string {
  return String(e?.elementType || e?.type || e?.category || '').toUpperCase();
}

function getGeom(e: RawElement): any {
  return typeof e?.geometry === 'string' ? JSON.parse(e.geometry) : (e?.geometry || {});
}

// ─── 1. Steel Section Resolution ─────────────────────────────────────────────

/**
 * Attempt to resolve steel section designation from element name/properties
 * and attach real cross-section data (depth, flange width, web thickness).
 */
function resolveBeamProfile(element: RawElement): boolean {
  const props = element.properties || {};
  const name = String(element.name || props.mark || props.profile || props.designation || '');

  // Look for W-section, HSS, L, C patterns
  const sectionMatch = name.match(/(?:W|HSS|L|C|WT|MC)\s*\d+[xX×]\s*\d+/i);
  if (!sectionMatch) return false;

  const designation = sectionMatch[0].replace(/\s+/g, '').replace(/[×x]/i, 'X');
  const section = lookupSteelSection(designation);
  if (!section) return false;

  // Attach real profile data to geometry
  const g = getGeom(element);
  g.profile = {
    type: 'steel_section',
    shape: section.shape,
    designation: section.designation,
    depth: section.depth,
    flangeWidth: section.flangeWidth,
    webThickness: section.webThickness,
    flangeThickness: section.flangeThickness,
    weightPerMetre: section.weightPerMetre,
    area: section.area,
  };

  // Update dimensions to match real section
  g.dimensions = {
    ...(g.dimensions || {}),
    width: section.flangeWidth,
    height: section.depth,
    depth: g.dimensions?.depth || g.dimensions?.width || section.flangeWidth,
  };

  element.geometry = g;
  element.properties = {
    ...props,
    steelSection: section.designation,
    profileShape: section.shape,
    unitWeight: section.weightPerMetre,
    profileResolved: true,
  };

  return true;
}

// ─── 2. Wall Assembly Matching ──────────────────────────────────────────────

/**
 * Match wall elements to multi-layer assembly definitions based on
 * wall type name, fire rating, or thickness.
 */
function resolveWallAssembly(element: RawElement): boolean {
  const props = element.properties || {};
  const name = String(element.name || props.wallType || props.assemblyType || '').toUpperCase();
  const fireRating = props.fireRating || props.fire_rating || '';
  const g = getGeom(element);
  const thickness = g?.dimensions?.depth || g?.dimensions?.width || 0;

  let matchedAssembly: (typeof WALL_ASSEMBLIES)[keyof typeof WALL_ASSEMBLIES] | null = null;

  // Try direct name match
  if (name.includes('EXTERIOR') || name.includes('EXT')) {
    if (name.includes('BRICK')) matchedAssembly = WALL_ASSEMBLIES['EXT_WALL_BRICK'];
    else if (name.includes('METAL') || name.includes('PANEL')) matchedAssembly = WALL_ASSEMBLIES['EXT_WALL_METAL'];
    else matchedAssembly = WALL_ASSEMBLIES['EXT_WALL_BRICK']; // default exterior
  } else if (name.includes('CMU') || name.includes('BLOCK') || name.includes('MASONRY')) {
    matchedAssembly = WALL_ASSEMBLIES['CMU_WALL'];
  } else if (name.includes('CONCRETE') || name.includes('RC') || name.includes('CAST')) {
    matchedAssembly = WALL_ASSEMBLIES['CONCRETE_WALL'];
  } else if (fireRating && /2\s*HR|2-HOUR/i.test(String(fireRating))) {
    matchedAssembly = WALL_ASSEMBLIES['INT_WALL_FIRE'];
  } else if (name.includes('INTERIOR') || name.includes('INT') || name.includes('PARTITION')) {
    matchedAssembly = WALL_ASSEMBLIES['INT_WALL_STANDARD'];
  }

  // Fall back to thickness-based matching
  if (!matchedAssembly && thickness > 0) {
    if (thickness > 0.35) matchedAssembly = WALL_ASSEMBLIES['EXT_WALL_BRICK'];
    else if (thickness > 0.25) matchedAssembly = WALL_ASSEMBLIES['INT_WALL_FIRE'];
    else if (thickness > 0.18) matchedAssembly = WALL_ASSEMBLIES['INT_WALL_STANDARD'];
    else if (thickness > 0.15) matchedAssembly = WALL_ASSEMBLIES['CMU_WALL'];
  }

  if (!matchedAssembly) return false;

  // Attach assembly data
  g.assembly = {
    id: matchedAssembly.id,
    name: matchedAssembly.name,
    totalThickness: matchedAssembly.totalThickness,
    layerCount: matchedAssembly.layers.length,
    layers: matchedAssembly.layers.map(l => ({
      name: l.name,
      thickness: l.thickness,
      material: l.material,
      isStructural: l.isStructural,
    })),
    fireRating: matchedAssembly.fireRating,
    acousticRating: matchedAssembly.acousticRating,
  };

  // Update depth to match assembly's real thickness
  g.dimensions = {
    ...(g.dimensions || {}),
    depth: matchedAssembly.totalThickness,
  };

  element.geometry = g;
  element.properties = {
    ...props,
    wallAssembly: matchedAssembly.id,
    wallAssemblyName: matchedAssembly.name,
    fireRating: matchedAssembly.fireRating || fireRating,
    assemblyResolved: true,
  };

  return true;
}

// ─── 3. Column Shape Determination ──────────────────────────────────────────

/**
 * Determine actual column shape from properties — a human modeler always
 * knows whether a column is round, square, or rectangular.
 */
function resolveColumnShape(element: RawElement): boolean {
  const props = element.properties || {};
  const g = getGeom(element);
  const dims = g?.dimensions || {};

  let shape: string;
  let resolved = false;

  // Check explicit properties
  if (props.shape) {
    shape = String(props.shape).toLowerCase();
    resolved = true;
  } else if (props.diameter || props.radius) {
    shape = 'cylinder';
    const d = Number(props.diameter || (props.radius * 2) || 0);
    if (d > 0) {
      g.dimensions = { ...dims, width: d, depth: d };
      g.profile = { type: 'column', shape: 'circular', diameter: d };
    }
    resolved = true;
  } else if (dims.width && dims.depth) {
    const ratio = dims.width > 0 && dims.depth > 0
      ? Math.min(dims.width, dims.depth) / Math.max(dims.width, dims.depth)
      : 1;
    if (ratio > 0.85) {
      shape = 'square_prism';
      g.profile = { type: 'column', shape: 'square', side: dims.width };
    } else {
      shape = 'rectangular_prism';
      g.profile = { type: 'column', shape: 'rectangular', width: dims.width, depth: dims.depth };
    }
    resolved = true;
  } else {
    // Check for steel column designation
    const name = String(element.name || props.mark || '');
    if (/W\d+/i.test(name)) {
      const section = lookupSteelSection(name.replace(/\s+/g, '').replace(/[×x]/i, 'X'));
      if (section) {
        g.profile = {
          type: 'steel_section',
          shape: section.shape,
          designation: section.designation,
          depth: section.depth,
          flangeWidth: section.flangeWidth,
        };
        shape = 'steel_section';
        resolved = true;
      }
    }
    if (!resolved) {
      shape = 'square_prism'; // safe default for concrete columns
      g.profile = { type: 'column', shape: 'square', side: dims.width || 0.4 };
      resolved = true;
    }
  }

  if (resolved) {
    element.geometry = g;
    element.properties = { ...props, resolvedShape: shape!, shapeResolved: true };
  }

  return resolved;
}

// ─── 4. MEP Shape Determination ─────────────────────────────────────────────

/**
 * Determine duct/pipe shapes — rectangular ducts vs round ducts vs pipes.
 */
function resolveMEPShape(element: RawElement): boolean {
  const props = element.properties || {};
  const type = getType(element);
  const g = getGeom(element);

  if (/PIPE|CONDUIT|SPRINKLER_PIPE/i.test(type)) {
    g.profile = {
      type: 'pipe',
      shape: 'circular',
      diameter: g.dimensions?.width || props.diameter || 0.05,
    };
    element.geometry = g;
    element.properties = { ...props, mepShape: 'circular_pipe', shapeResolved: true };
    return true;
  }

  if (/DUCT/i.test(type)) {
    const isRound = props.shape === 'round' || props.diameter || (!g.dimensions?.depth && g.dimensions?.width);
    if (isRound) {
      g.profile = {
        type: 'duct',
        shape: 'circular',
        diameter: g.dimensions?.width || props.diameter || 0.3,
      };
    } else {
      g.profile = {
        type: 'duct',
        shape: 'rectangular',
        width: g.dimensions?.width || 0.6,
        height: g.dimensions?.depth || 0.3,
      };
    }
    element.geometry = g;
    element.properties = { ...props, mepShape: isRound ? 'circular_duct' : 'rectangular_duct', shapeResolved: true };
    return true;
  }

  if (/CABLE_TRAY|CABLE/i.test(type)) {
    g.profile = {
      type: 'cable_tray',
      shape: 'u_channel',
      width: g.dimensions?.width || 0.3,
      depth: g.dimensions?.depth || 0.1,
    };
    element.geometry = g;
    element.properties = { ...props, mepShape: 'u_channel', shapeResolved: true };
    return true;
  }

  return false;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Upgrade all elements from bounding-box geometry to parametric profiles.
 * This is the equivalent of a human modeler selecting the correct family/type
 * for each element instead of placing generic boxes.
 */
export function upgradeGeometry(elements: RawElement[]): UpgradeResult {
  console.log(`📐 [GEOMETRY-UPGRADE] Starting profile resolution for ${elements.length} elements...`);

  let steelResolved = 0;
  let wallResolved = 0;
  let columnResolved = 0;
  let mepResolved = 0;

  for (const el of elements) {
    const type = getType(el);

    // Beams/girders/joists → steel section lookup
    if (/BEAM|GIRDER|JOIST|LINTEL/i.test(type)) {
      if (resolveBeamProfile(el)) steelResolved++;
    }

    // Walls/partitions → assembly matching
    if (/WALL|PARTITION/i.test(type)) {
      if (resolveWallAssembly(el)) wallResolved++;
    }

    // Columns → shape determination
    if (/COLUMN|PILLAR|PIER/i.test(type)) {
      if (resolveColumnShape(el)) columnResolved++;
    }

    // MEP elements → duct/pipe shape
    if (/DUCT|PIPE|CONDUIT|CABLE|SPRINKLER/i.test(type)) {
      if (resolveMEPShape(el)) mepResolved++;
    }
  }

  const total = steelResolved + wallResolved + columnResolved + mepResolved;
  console.log(`📐 [GEOMETRY-UPGRADE] Complete: ${total} elements upgraded`);
  console.log(`   Steel profiles: ${steelResolved}, Wall assemblies: ${wallResolved}, Column shapes: ${columnResolved}, MEP shapes: ${mepResolved}`);

  return {
    elements,
    stats: {
      steelProfilesResolved: steelResolved,
      wallAssembliesMatched: wallResolved,
      columnShapesDetermined: columnResolved,
      mepShapesDetermined: mepResolved,
      total,
    },
  };
}
