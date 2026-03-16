// server/pipeline/mesh-builder.ts
// Deterministic mesh generation from resolved candidates.
// Uses geometry-kernel.ts primitives to build 3D meshes for each candidate type.
// Output format matches what storage.upsertBimElements() expects.

import type {
  CandidateSet,
  WallCandidate,
  DoorCandidate,
  WindowCandidate,
  ColumnCandidate,
  SlabCandidate,
  BeamCandidate,
  StairCandidate,
  MEPCandidate,
} from './candidate-types';

import {
  type Vec2,
  type Profile2D,
  vec2,
  vec3,
  rectProfile,
  circleProfile,
  extrudeProfile,
  createBox,
  serializeMesh,
} from '../bim/geometry-kernel';

// ---------------------------------------------------------------------------
// Output element shape — matches what storage.upsertBimElements expects
// ---------------------------------------------------------------------------

export interface MeshElement {
  candidateId: string;
  geometry: string;     // JSON string: { dimensions, mesh }
  properties: string;   // JSON string
  elementType: string;
  name: string;
  category: string;
  storeyName: string;
  material: string | null;
  location: string;     // JSON string: { realLocation }
  rfiFlag: boolean;
  needsAttention: boolean;
  attentionReason: string | null;
}

// ---------------------------------------------------------------------------
// Wall mesh
// ---------------------------------------------------------------------------

function buildWallMesh(wall: WallCandidate): MeshElement | null {
  if (wall.start_m == null || wall.end_m == null || wall.thickness_mm == null || wall.height_m == null) {
    return null;
  }

  const sx = wall.start_m.x;
  const sy = wall.start_m.y;
  const ex = wall.end_m.x;
  const ey = wall.end_m.y;
  const thicknessM = wall.thickness_mm / 1000;
  const height = wall.height_m;
  const baseZ = wall.base_elevation_m ?? 0;

  // Direction and length
  const dx = ex - sx;
  const dy = ey - sy;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 0.001) return null;

  // Perpendicular direction for thickness offset
  const nx = -dy / length;
  const ny = dx / length;
  const halfT = thicknessM / 2;

  // Build wall profile as 4-point rectangle in XY, then extrude along Z
  const profile = rectProfile(length, thicknessM);
  const mesh = extrudeProfile(profile, height);
  const serialized = serializeMesh(mesh);

  // Midpoint for location
  const midX = (sx + ex) / 2;
  const midY = (sy + ey) / 2;

  // Rotation angle from wall direction
  const angle = Math.atan2(dy, dx);

  const dimensions = {
    length: length,
    width: thicknessM,
    height: height,
  };

  const geometry = JSON.stringify({
    dimensions,
    mesh: serialized,
  });

  const location = JSON.stringify({
    realLocation: { x: midX, y: midY, z: baseZ },
    rotation: angle,
    gridStart: wall.gridStart,
    gridEnd: wall.gridEnd,
  });

  const properties: Record<string, unknown> = {
    wall_type_code: wall.wall_type_code,
    material: wall.material,
    fire_rating: wall.fire_rating,
    extension_above_ceiling_mm: wall.extension_above_ceiling_mm,
    thickness_mm: wall.thickness_mm,
    evidence_sources: wall.evidence_sources,
    pipelineStage: 'IR_MESH_BUILD',
    candidateStatus: wall.status,
  };

  return {
    candidateId: wall.candidateId,
    geometry,
    properties: JSON.stringify(properties),
    elementType: 'wall',
    name: `Wall ${wall.wall_type_code || wall.candidateId}`,
    category: 'Architectural',
    storeyName: wall.storey,
    material: wall.material,
    location,
    rfiFlag: wall.status !== 'complete',
    needsAttention: wall.status !== 'complete',
    attentionReason: wall.status !== 'complete' ? `Wall status: ${wall.status}` : null,
  };
}

// ---------------------------------------------------------------------------
// Column mesh
// ---------------------------------------------------------------------------

function buildColumnMesh(col: ColumnCandidate): MeshElement | null {
  if (col.position_m == null || col.width_mm == null || col.depth_mm == null || col.height_m == null) {
    return null;
  }

  const widthM = col.width_mm / 1000;
  const depthM = col.depth_mm / 1000;
  const height = col.height_m;

  // Use rectangular or circular profile based on whether width == depth
  const isRound = col.size_string ? /dia/i.test(col.size_string) : false;
  const profile = isRound
    ? circleProfile(widthM / 2)
    : rectProfile(widthM, depthM);

  const mesh = extrudeProfile(profile, height);
  const serialized = serializeMesh(mesh);

  const storeyKey = col.storey.toLowerCase().replace(/\s+/g, '');
  const baseZ = 0; // Position Z is from storey elevation (handled by viewer)

  const dimensions = {
    length: widthM,
    width: depthM,
    height: height,
  };

  const geometry = JSON.stringify({
    dimensions,
    mesh: serialized,
  });

  const location = JSON.stringify({
    realLocation: { x: col.position_m.x, y: col.position_m.y, z: baseZ },
    gridPosition: col.gridPosition,
  });

  const properties: Record<string, unknown> = {
    size_string: col.size_string,
    material: col.material,
    reinforcement: col.reinforcement,
    evidence_sources: col.evidence_sources,
    pipelineStage: 'IR_MESH_BUILD',
    candidateStatus: col.status,
  };

  return {
    candidateId: col.candidateId,
    geometry,
    properties: JSON.stringify(properties),
    elementType: 'column',
    name: `Column ${col.size_string || col.candidateId}`,
    category: 'Structural',
    storeyName: col.storey,
    material: col.material,
    location,
    rfiFlag: col.status !== 'complete',
    needsAttention: col.status !== 'complete',
    attentionReason: col.status !== 'complete' ? `Column status: ${col.status}` : null,
  };
}

// ---------------------------------------------------------------------------
// Door mesh
// ---------------------------------------------------------------------------

function buildDoorMesh(door: DoorCandidate): MeshElement | null {
  if (door.position_m == null || door.width_mm == null || door.height_mm == null) {
    return null;
  }

  const widthM = door.width_mm / 1000;
  const heightM = door.height_mm / 1000;
  const depthM = door.thickness_mm != null ? door.thickness_mm / 1000 : 0.05;

  const mesh = createBox(widthM, heightM, depthM);
  const serialized = serializeMesh(mesh);

  const dimensions = {
    length: widthM,
    height: heightM,
    width: depthM,
  };

  const geometry = JSON.stringify({
    dimensions,
    mesh: serialized,
  });

  const location = JSON.stringify({
    realLocation: { x: door.position_m.x, y: door.position_m.y, z: 0 },
    gridNearest: door.gridNearest,
  });

  const properties: Record<string, unknown> = {
    mark: door.mark,
    swing: door.swing,
    fire_rating: door.fire_rating,
    hardware_set: door.hardware_set,
    host_wall_type: door.host_wall_type,
    width_mm: door.width_mm,
    height_mm: door.height_mm,
    evidence_sources: door.evidence_sources,
    pipelineStage: 'IR_MESH_BUILD',
    candidateStatus: door.status,
  };

  return {
    candidateId: door.candidateId,
    geometry,
    properties: JSON.stringify(properties),
    elementType: 'door',
    name: `Door ${door.mark}`,
    category: 'Architectural',
    storeyName: door.storey,
    material: null,
    location,
    rfiFlag: door.status !== 'complete',
    needsAttention: door.status !== 'complete',
    attentionReason: door.status !== 'complete' ? `Door status: ${door.status}` : null,
  };
}

// ---------------------------------------------------------------------------
// Window mesh
// ---------------------------------------------------------------------------

function buildWindowMesh(win: WindowCandidate): MeshElement | null {
  if (win.position_m == null || win.width_mm == null || win.height_mm == null) {
    return null;
  }

  const widthM = win.width_mm / 1000;
  const heightM = win.height_mm / 1000;
  const depthM = 0.05; // windows are thin

  const mesh = createBox(widthM, heightM, depthM);
  const serialized = serializeMesh(mesh);

  const sillZ = win.sill_height_mm != null ? win.sill_height_mm / 1000 : 0;

  const dimensions = {
    length: widthM,
    height: heightM,
    width: depthM,
  };

  const geometry = JSON.stringify({
    dimensions,
    mesh: serialized,
  });

  const location = JSON.stringify({
    realLocation: { x: win.position_m.x, y: win.position_m.y, z: sillZ },
    gridNearest: win.gridNearest,
  });

  const properties: Record<string, unknown> = {
    mark: win.mark,
    glazing: win.glazing,
    sill_height_mm: win.sill_height_mm,
    host_wall_type: win.host_wall_type,
    width_mm: win.width_mm,
    height_mm: win.height_mm,
    evidence_sources: win.evidence_sources,
    pipelineStage: 'IR_MESH_BUILD',
    candidateStatus: win.status,
  };

  return {
    candidateId: win.candidateId,
    geometry,
    properties: JSON.stringify(properties),
    elementType: 'window',
    name: `Window ${win.mark}`,
    category: 'Architectural',
    storeyName: win.storey,
    material: win.glazing,
    location,
    rfiFlag: win.status !== 'complete',
    needsAttention: win.status !== 'complete',
    attentionReason: win.status !== 'complete' ? `Window status: ${win.status}` : null,
  };
}

// ---------------------------------------------------------------------------
// Slab mesh
// ---------------------------------------------------------------------------

function buildSlabMesh(slab: SlabCandidate): MeshElement | null {
  if (slab.boundary_m == null || slab.boundary_m.length < 3 || slab.thickness_mm == null) {
    return null;
  }

  const thicknessM = slab.thickness_mm / 1000;

  // Build profile from boundary polygon
  const outer: Vec2[] = slab.boundary_m.map(p => vec2(p.x, p.y));
  const profile = { outer, holes: [] as Vec2[][] };

  const mesh = extrudeProfile(profile, thicknessM);
  const serialized = serializeMesh(mesh);

  // Compute centroid for location
  let cx = 0;
  let cy = 0;
  for (const p of slab.boundary_m) {
    cx += p.x;
    cy += p.y;
  }
  cx /= slab.boundary_m.length;
  cy /= slab.boundary_m.length;

  // Compute approximate area for quantity
  let area = 0;
  for (let i = 0; i < slab.boundary_m.length; i++) {
    const j = (i + 1) % slab.boundary_m.length;
    area += slab.boundary_m[i].x * slab.boundary_m[j].y;
    area -= slab.boundary_m[j].x * slab.boundary_m[i].y;
  }
  area = Math.abs(area) / 2;

  const dimensions = {
    length: Math.sqrt(area), // approximate span
    width: Math.sqrt(area),
    height: thicknessM,
  };

  const geometry = JSON.stringify({
    dimensions,
    mesh: serialized,
  });

  const location = JSON.stringify({
    realLocation: { x: cx, y: cy, z: 0 },
  });

  const properties: Record<string, unknown> = {
    slab_type: slab.slab_type,
    material: slab.material,
    thickness_mm: slab.thickness_mm,
    area_m2: area,
    boundary_m: slab.boundary_m,
    evidence_sources: slab.evidence_sources,
    pipelineStage: 'IR_MESH_BUILD',
    candidateStatus: slab.status,
  };

  return {
    candidateId: slab.candidateId,
    geometry,
    properties: JSON.stringify(properties),
    elementType: 'slab',
    name: `Slab ${slab.slab_type || slab.candidateId}`,
    category: 'Structural',
    storeyName: slab.storey,
    material: slab.material,
    location,
    rfiFlag: slab.status !== 'complete',
    needsAttention: slab.status !== 'complete',
    attentionReason: slab.status !== 'complete' ? `Slab status: ${slab.status}` : null,
  };
}

// ---------------------------------------------------------------------------
// Beam mesh
// ---------------------------------------------------------------------------

function buildBeamMesh(beam: BeamCandidate): MeshElement | null {
  if (beam.start_m == null || beam.end_m == null || beam.width_mm == null || beam.depth_mm == null) {
    return null;
  }

  const widthM = beam.width_mm / 1000;
  const depthM = beam.depth_mm / 1000;

  // Compute length from start to end
  const dx = beam.end_m.x - beam.start_m.x;
  const dy = beam.end_m.y - beam.start_m.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 0.001) return null;

  // Build beam as a rectangular extrusion along its span
  const profile = rectProfile(widthM, depthM);
  const mesh = extrudeProfile(profile, length, vec3(1, 0, 0));
  const serialized = serializeMesh(mesh);

  const midX = (beam.start_m.x + beam.end_m.x) / 2;
  const midY = (beam.start_m.y + beam.end_m.y) / 2;
  const angle = Math.atan2(dy, dx);

  const dimensions = {
    length: length,
    width: widthM,
    height: depthM,
  };

  const geometry = JSON.stringify({
    dimensions,
    mesh: serialized,
  });

  const location = JSON.stringify({
    realLocation: { x: midX, y: midY, z: 0 },
    rotation: angle,
    gridStart: beam.gridStart,
    gridEnd: beam.gridEnd,
  });

  const properties: Record<string, unknown> = {
    size_string: beam.size_string,
    material: beam.material,
    evidence_sources: beam.evidence_sources,
    pipelineStage: 'IR_MESH_BUILD',
    candidateStatus: beam.status,
  };

  return {
    candidateId: beam.candidateId,
    geometry,
    properties: JSON.stringify(properties),
    elementType: 'beam',
    name: `Beam ${beam.size_string || beam.candidateId}`,
    category: 'Structural',
    storeyName: beam.storey,
    material: beam.material,
    location,
    rfiFlag: beam.status !== 'complete',
    needsAttention: beam.status !== 'complete',
    attentionReason: beam.status !== 'complete' ? `Beam status: ${beam.status}` : null,
  };
}

// ---------------------------------------------------------------------------
// Stair mesh
// ---------------------------------------------------------------------------

function buildStairMesh(stair: StairCandidate): MeshElement | null {
  if (stair.position_m == null || stair.width_mm == null) {
    return null;
  }

  const widthM = stair.width_mm / 1000;
  const lengthM = stair.length_mm != null ? stair.length_mm / 1000 : widthM * 2; // fallback proportional
  const riseM = stair.rise_mm != null ? stair.rise_mm / 1000 : 0.178;
  const runs = stair.rises ?? 12;
  const totalHeight = riseM * runs;

  // Simple box approximation for stair volume
  const mesh = createBox(widthM, totalHeight, lengthM);
  const serialized = serializeMesh(mesh);

  const dimensions = {
    length: lengthM,
    width: widthM,
    height: totalHeight,
  };

  const geometry = JSON.stringify({
    dimensions,
    mesh: serialized,
  });

  const location = JSON.stringify({
    realLocation: { x: stair.position_m.x, y: stair.position_m.y, z: 0 },
  });

  const properties: Record<string, unknown> = {
    rises: stair.rises,
    rise_mm: stair.rise_mm,
    run_mm: stair.run_mm,
    material: stair.material,
    evidence_sources: stair.evidence_sources,
    pipelineStage: 'IR_MESH_BUILD',
    candidateStatus: stair.status,
  };

  return {
    candidateId: stair.candidateId,
    geometry,
    properties: JSON.stringify(properties),
    elementType: 'stair',
    name: `Stair ${stair.candidateId}`,
    category: 'Architectural',
    storeyName: stair.storey,
    material: stair.material,
    location,
    rfiFlag: stair.status !== 'complete',
    needsAttention: stair.status !== 'complete',
    attentionReason: stair.status !== 'complete' ? `Stair status: ${stair.status}` : null,
  };
}

// ---------------------------------------------------------------------------
// MEP mesh
// ---------------------------------------------------------------------------

function buildMEPMesh(mep: MEPCandidate): MeshElement | null {
  if (mep.position_m == null) {
    return null;
  }

  // MEP elements are small boxes or cylinders representing devices
  const sizeM = 0.3; // 300mm representative size
  const mesh = createBox(sizeM, sizeM, sizeM);
  const serialized = serializeMesh(mesh);

  const mountingZ = mep.mounting_height_m ?? 2.4;

  const dimensions = {
    length: sizeM,
    width: sizeM,
    height: sizeM,
  };

  const geometry = JSON.stringify({
    dimensions,
    mesh: serialized,
  });

  const location = JSON.stringify({
    realLocation: { x: mep.position_m.x, y: mep.position_m.y, z: mountingZ },
  });

  const properties: Record<string, unknown> = {
    category: mep.category,
    mep_type: mep.mep_type,
    mounting_height_m: mep.mounting_height_m,
    evidence_sources: mep.evidence_sources,
    pipelineStage: 'IR_MESH_BUILD',
    candidateStatus: mep.status,
  };

  // Map MEP category to DB category
  const dbCategory = (() => {
    const cat = mep.category.toLowerCase();
    if (cat === 'mechanical' || cat === 'electrical' || cat === 'plumbing') return 'MEP';
    if (cat === 'fire_protection') return 'MEP';
    return 'MEP';
  })();

  return {
    candidateId: mep.candidateId,
    geometry,
    properties: JSON.stringify(properties),
    elementType: 'mep',
    name: `${mep.mep_type} ${mep.candidateId}`,
    category: dbCategory,
    storeyName: mep.storey,
    material: null,
    location,
    rfiFlag: mep.status !== 'complete',
    needsAttention: mep.status !== 'complete',
    attentionReason: mep.status !== 'complete' ? `MEP status: ${mep.status}` : null,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function buildMeshes(candidates: CandidateSet): MeshElement[] {
  const results: MeshElement[] = [];

  for (const wall of candidates.walls) {
    const elem = buildWallMesh(wall);
    if (elem) results.push(elem);
  }

  for (const col of candidates.columns) {
    const elem = buildColumnMesh(col);
    if (elem) results.push(elem);
  }

  for (const door of candidates.doors) {
    const elem = buildDoorMesh(door);
    if (elem) results.push(elem);
  }

  for (const win of candidates.windows) {
    const elem = buildWindowMesh(win);
    if (elem) results.push(elem);
  }

  for (const slab of candidates.slabs) {
    const elem = buildSlabMesh(slab);
    if (elem) results.push(elem);
  }

  for (const beam of candidates.beams) {
    const elem = buildBeamMesh(beam);
    if (elem) results.push(elem);
  }

  for (const stair of candidates.stairs) {
    const elem = buildStairMesh(stair);
    if (elem) results.push(elem);
  }

  for (const mep of candidates.mep) {
    const elem = buildMEPMesh(mep);
    if (elem) results.push(elem);
  }

  return results;
}
