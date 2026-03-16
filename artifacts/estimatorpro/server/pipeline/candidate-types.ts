// server/pipeline/candidate-types.ts
// Intermediate Representation (IR) types for the BIM extraction pipeline.
// Candidates represent AI-classified elements before deterministic resolution.

export interface EvidenceSource {
  documentName: string;
  pageNumber?: number;
  extractionMethod: 'text' | 'visual' | 'schedule' | 'section' | 'specification';
  confidence: 'high' | 'medium' | 'low';
  value_extracted: string;
}

export type CandidateStatus =
  | 'complete'
  | 'needs_review'
  | 'missing_thickness'
  | 'missing_height'
  | 'missing_position'
  | 'missing_width'
  | 'unresolved';

export interface BaseCandidate {
  candidateId: string;
  storey: string;
  status: CandidateStatus;
  evidence_sources: EvidenceSource[];
  review_notes: string[];
}

export interface WallCandidate extends BaseCandidate {
  type: 'wall';
  wall_type_code: string | null;
  gridStart: { alpha: string; numeric: string } | null;
  gridEnd: { alpha: string; numeric: string } | null;
  offset_m: { x: number; y: number };
  start_m: { x: number; y: number } | null;
  end_m: { x: number; y: number } | null;
  thickness_mm: number | null;
  height_m: number | null;
  base_elevation_m: number | null;
  material: string | null;
  fire_rating: string | null;
  extension_above_ceiling_mm: number | null;
}

export interface DoorCandidate extends BaseCandidate {
  type: 'door';
  mark: string;
  gridNearest: { alpha: string; numeric: string } | null;
  offset_m: { x: number; y: number };
  position_m: { x: number; y: number } | null;
  width_mm: number | null;
  height_mm: number | null;
  thickness_mm: number | null;
  host_wall_type: string | null;
  swing: string | null;
  fire_rating: string | null;
  hardware_set: string | null;
}

export interface WindowCandidate extends BaseCandidate {
  type: 'window';
  mark: string;
  gridNearest: { alpha: string; numeric: string } | null;
  offset_m: { x: number; y: number };
  position_m: { x: number; y: number } | null;
  width_mm: number | null;
  height_mm: number | null;
  sill_height_mm: number | null;
  glazing: string | null;
  host_wall_type: string | null;
}

export interface ColumnCandidate extends BaseCandidate {
  type: 'column';
  gridPosition: { alpha: string; numeric: string } | null;
  offset_m: { x: number; y: number };
  position_m: { x: number; y: number } | null;
  size_string: string | null;
  width_mm: number | null;
  depth_mm: number | null;
  height_m: number | null;
  material: string | null;
  reinforcement: string | null;
}

export interface SlabCandidate extends BaseCandidate {
  type: 'slab';
  boundary_m: Array<{ x: number; y: number }> | null;
  thickness_mm: number | null;
  material: string | null;
  slab_type: string | null;
}

export interface BeamCandidate extends BaseCandidate {
  type: 'beam';
  gridStart: { alpha: string; numeric: string } | null;
  gridEnd: { alpha: string; numeric: string } | null;
  start_m: { x: number; y: number } | null;
  end_m: { x: number; y: number } | null;
  size_string: string | null;
  width_mm: number | null;
  depth_mm: number | null;
  material: string | null;
}

export interface StairCandidate extends BaseCandidate {
  type: 'stair';
  position_m: { x: number; y: number } | null;
  width_mm: number | null;
  length_mm: number | null;
  rises: number | null;
  rise_mm: number | null;
  run_mm: number | null;
  material: string | null;
}

export interface MEPCandidate extends BaseCandidate {
  type: 'mep';
  category: string;
  mep_type: string;
  position_m: { x: number; y: number } | null;
  mounting_height_m: number | null;
}

export type BIMCandidate =
  | WallCandidate
  | DoorCandidate
  | WindowCandidate
  | ColumnCandidate
  | SlabCandidate
  | BeamCandidate
  | StairCandidate
  | MEPCandidate;

export interface CandidateSet {
  walls: WallCandidate[];
  doors: DoorCandidate[];
  windows: WindowCandidate[];
  columns: ColumnCandidate[];
  slabs: SlabCandidate[];
  beams: BeamCandidate[];
  stairs: StairCandidate[];
  mep: MEPCandidate[];
  storeys: Array<{
    name: string;
    elevation_m: number;
    floor_to_floor_height_m: number | null;
    ceiling_height_m: number | null;
  }>;
  metadata: {
    extractedAt: string;
    documentCount: number;
    totalCandidates: number;
    drawingUnits?: 'mm' | 'm' | 'ft-in';
  };
}

export interface ResolutionStats {
  total: number;
  resolved: number;
  needsReview: number;
  unresolved: number;
  byType: Record<string, { total: number; resolved: number; unresolved: number }>;
}
