// server/pipeline/stage-types.ts
// TypeScript interfaces for the sequential BIM extraction pipeline.

export interface ScheduleData {
  doors: Array<{
    mark: string;
    width_mm: number;
    height_mm: number;
    type: string;
    fire_rating?: string;
    hardware?: string;
    thickness_mm?: number;
  }>;
  windows: Array<{
    mark: string;
    width_mm: number;
    height_mm: number;
    type: string;
    glazing?: string;
    sill_height_mm?: number;
  }>;
  finishes: Array<{
    room: string;
    floor: string;
    wall: string;
    ceiling: string;
    baseboard?: string;
  }>;
  units: 'mm' | 'm' | 'ft-in';
}

export interface AssemblyDefinition {
  code: string;           // e.g. "EW1", "IW3D"
  description: string;
  totalThickness_mm: number;
  layers: Array<{
    material: string;
    thickness_mm: number;
    function: string;
  }>;
  fire_rating?: string;
  acoustic_rating?: string;
  source_drawing?: string;
}

export interface AssemblyData {
  wallTypes: Record<string, AssemblyDefinition>;
  slabTypes: Record<string, AssemblyDefinition>;
  roofTypes: Record<string, AssemblyDefinition>;
  units: 'mm' | 'm' | 'ft-in';
}

export interface MaterialSpec {
  csiCode: string;
  description: string;
  material: string;
  standard?: string;
  manufacturer?: string;
  source_section?: string;
}

export interface SpecificationData {
  products: MaterialSpec[];
  standards: Array<{
    code: string;
    title: string;
    applicableTo: string;
  }>;
  units: 'mm' | 'm' | 'ft-in';
}

export interface GridAxis {
  label: string;
  position_m: number;
  angle_deg: number;
  family: 'alpha' | 'numeric' | 'centerline';
}

export interface GridData {
  alphaGridlines: GridAxis[];
  numericGridlines: GridAxis[];
  alphaDirection: 'left_to_right' | 'bottom_to_top';
  numericDirection: 'left_to_right' | 'bottom_to_top';
  originLabel: { letter: string; number: string };
  notes: string[];
  confirmed: boolean;
}

export type PipelineStage =
  | 'SCHEDULES'
  | 'SECTIONS'
  | 'SPECIFICATIONS'
  | 'GRID_EXTRACTION'
  | 'GRID_CONFIRMATION'
  | 'FLOOR_PLANS'
  | 'FLOOR_PLANS_5A'
  | 'FLOOR_PLANS_5B'
  | 'FLOOR_PLANS_5C'
  | 'ENRICHMENT'
  | 'REBUILD'
  | 'COMPLETE'
  | 'FAILED';

export interface DrawingScaleInfo {
  /** Scale ratio string, e.g. "1:100" */
  ratio: string;
  /** Multiplier: 1 drawing mm = factor real metres. E.g. 1:100 => 0.1 */
  factor: number;
  /** Where the scale was found */
  source: string;
  /** Confidence in the scale reading */
  confidence: 'high' | 'medium' | 'low';
}

export interface PipelineState {
  version: 2;
  currentStage: PipelineStage;
  stageResults: {
    schedules?: ScheduleData;
    sections?: AssemblyData;
    specifications?: SpecificationData;
    grid?: GridData;
    drawingScale?: DrawingScaleInfo;
    floorPlans?: { elementCount: number };
  };
  pausedAt?: string;
  resumedAt?: string;
  stageTimings: Record<string, { startedAt: string; completedAt?: string; durationMs?: number }>;
  error?: { stage: string; message: string; timestamp: string };
}
