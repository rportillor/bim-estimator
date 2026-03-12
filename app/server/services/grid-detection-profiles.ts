// server/services/grid-detection-profiles.ts
// ═══════════════════════════════════════════════════════════════════════════════
// GRID DETECTION PARAMETER PROFILES
// ═══════════════════════════════════════════════════════════════════════════════
//
// Named parameter profiles for different project types, with environment
// variable overrides and recommended tuning ranges.
//
// Profiles calibrated for Canadian construction drawing conventions:
//   - Metric (mm) drawings with typical 3-12m structural grids
//   - Grid bubbles typically 300-600mm diameter on plan
//   - Text heights typically 2.5-5mm (scaled at drawing scale)
//   - Layer naming: S-GRID, A-GRID, G-GRID common patterns
//
// Usage:
//   const params = getDetectionProfile('canadian-commercial');
//   const result = await runGridDetection({ ...options, parameterOverrides: params });
//
// Environment overrides:
//   GRID_ANGLE_EPS_DEG=5.0     → Override angle clustering epsilon
//   GRID_OFFSET_TOL_MM=100.0   → Override offset clustering tolerance
//   GRID_MIN_LENGTH_PCT=0.10   → Override minimum segment length %
//   GRID_AUTO_THRESHOLD=0.70   → Override auto-assign score threshold
//
// Standards: CIQS Standard Method, v1.1 §13, NBC/OBC
// ═══════════════════════════════════════════════════════════════════════════════

import { DEFAULT_DETECTION_PARAMS } from './grid-detection-orchestrator';

type DetectionParams = typeof DEFAULT_DETECTION_PARAMS;

// ═══════════════════════════════════════════════════════════════════════════════
// NAMED PROFILES
// ═══════════════════════════════════════════════════════════════════════════════

export interface DetectionProfile {
  name: string;
  description: string;
  projectType: string;
  params: Partial<DetectionParams>;
}

/**
 * Canadian commercial (default) — 3-12m grids, mm units, standard bubbles.
 * Calibrated for mid-rise mixed-use, office, retail, institutional.
 * Reference: The Moorings on Cameron Lake, Fenelon Falls, Ontario.
 */
const CANADIAN_COMMERCIAL: DetectionProfile = {
  name: 'canadian-commercial',
  description: 'Canadian commercial/institutional (3-12m grids, mm units)',
  projectType: 'commercial',
  params: {
    // Default params are already tuned for this profile
  },
};

/**
 * Canadian residential — smaller grids (1.2-6m), closer spacings.
 * Townhouses, low-rise apartments, wood-frame with some structural grid.
 */
const CANADIAN_RESIDENTIAL: DetectionProfile = {
  name: 'canadian-residential',
  description: 'Canadian residential (1.2-6m grids, tighter detection)',
  projectType: 'residential',
  params: {
    candidateMinLengthPct: 0.10,       // Smaller drawings → shorter grid lines
    offsetToleranceMm: 30.0,           // Tighter spacing tolerance
    gapMergeToleranceMm: 100.0,        // Shorter gaps to merge
    angleClusterMinSupport: 2,         // Fewer grid lines per family
    markerAreaMinPct: 0.0001,          // Smaller bubbles on residential plans
    autoAssignThreshold: 0.70,         // Slightly more permissive
  },
};

/**
 * Industrial / warehouse — large grids (8-30m), wide open spans.
 * Pre-engineered metal buildings, distribution centres, manufacturing.
 */
const INDUSTRIAL: DetectionProfile = {
  name: 'industrial',
  description: 'Industrial/warehouse (8-30m grids, wide spans)',
  projectType: 'industrial',
  params: {
    candidateMinLengthPct: 0.20,       // Large drawings, long grid lines
    offsetToleranceMm: 100.0,          // Wider tolerance for large-scale drawings
    gapMergeToleranceMm: 500.0,        // Larger gaps between split segments
    markerAreaMaxPct: 0.008,           // Larger bubbles on industrial plans
    autoAssignThreshold: 0.80,         // Stricter — fewer grids = each must be sure
  },
};

/**
 * Imperial (feet/inches) — US-standard drawings in imperial units.
 * Same algorithms, adjusted tolerances for ft/in coordinate systems.
 */
const IMPERIAL: DetectionProfile = {
  name: 'imperial',
  description: 'Imperial drawings (feet/inches)',
  projectType: 'commercial',
  params: {
    offsetToleranceMm: 150.0,          // ~6 inches tolerance
    gapMergeToleranceMm: 600.0,        // ~24 inches gap merge
    markerSearchRadiusPct: 0.04,       // Slightly wider search
  },
};

/**
 * The Moorings on Cameron Lake, Fenelon Falls — project-specific profile.
 * Multi-storey residential mixed-use on Cameron Lake.
 * Adjust based on actual detection results during QA.
 */
const THE_MOORINGS: DetectionProfile = {
  name: 'the-moorings',
  description: 'The Moorings on Cameron Lake, Fenelon Falls, Ontario',
  projectType: 'mixed-use residential',
  params: {
    // Start with commercial defaults — tune after first live detection run
    angleClusterEpsDeg: 4.0,           // Slight tolerance increase for PDF drawings
    offsetToleranceMm: 60.0,           // Moderate tolerance
    autoAssignThreshold: 0.72,         // Slightly more permissive for PDF text quality
    reviewThreshold: 0.50,             // Catch more label candidates for review
  },
};

const PROFILES: Record<string, DetectionProfile> = {
  'canadian-commercial': CANADIAN_COMMERCIAL,
  'canadian-residential': CANADIAN_RESIDENTIAL,
  'industrial': INDUSTRIAL,
  'imperial': IMPERIAL,
  'the-moorings': THE_MOORINGS,
};

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get detection parameters for a named profile, with environment variable overrides.
 */
export function getDetectionProfile(profileName?: string): DetectionParams {
  const profile = profileName ? PROFILES[profileName] : null;
  const baseParams = { ...DEFAULT_DETECTION_PARAMS };

  // Apply profile overrides
  if (profile) {
    Object.assign(baseParams, profile.params);
  }

  // Apply environment variable overrides (highest priority)
  const envOverrides = getEnvironmentOverrides();
  Object.assign(baseParams, envOverrides);

  return baseParams;
}

/**
 * List all available profiles.
 */
export function listProfiles(): DetectionProfile[] {
  return Object.values(PROFILES);
}

/**
 * Get environment variable overrides for detection parameters.
 */
function getEnvironmentOverrides(): Partial<DetectionParams> {
  const overrides: Partial<DetectionParams> = {};

  const env = process.env;

  if (env.GRID_MIN_LENGTH_PCT) overrides.candidateMinLengthPct = parseFloat(env.GRID_MIN_LENGTH_PCT);
  if (env.GRID_STRAIGHTNESS_TOL_DEG) overrides.straightnessTolDeg = parseFloat(env.GRID_STRAIGHTNESS_TOL_DEG);
  if (env.GRID_ANGLE_EPS_DEG) overrides.angleClusterEpsDeg = parseFloat(env.GRID_ANGLE_EPS_DEG);
  if (env.GRID_ANGLE_MIN_SUPPORT) overrides.angleClusterMinSupport = parseInt(env.GRID_ANGLE_MIN_SUPPORT);
  if (env.GRID_OFFSET_TOL_MM) overrides.offsetToleranceMm = parseFloat(env.GRID_OFFSET_TOL_MM);
  if (env.GRID_GAP_MERGE_MM) overrides.gapMergeToleranceMm = parseFloat(env.GRID_GAP_MERGE_MM);
  if (env.GRID_MARKER_SEARCH_PCT) overrides.markerSearchRadiusPct = parseFloat(env.GRID_MARKER_SEARCH_PCT);
  if (env.GRID_AUTO_THRESHOLD) overrides.autoAssignThreshold = parseFloat(env.GRID_AUTO_THRESHOLD);
  if (env.GRID_REVIEW_THRESHOLD) overrides.reviewThreshold = parseFloat(env.GRID_REVIEW_THRESHOLD);

  // Filter out NaN values
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === 'number' && isNaN(value)) {
      delete (overrides as any)[key];
    }
  }

  return overrides;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TUNING GUIDE — Parameter Descriptions and Recommended Ranges
// ═══════════════════════════════════════════════════════════════════════════════

export interface ParameterGuide {
  name: string;
  envVar: string;
  description: string;
  unit: string;
  default: number;
  range: [number, number];
  tuningAdvice: string;
}

export const PARAMETER_GUIDE: ParameterGuide[] = [
  {
    name: 'candidateMinLengthPct',
    envVar: 'GRID_MIN_LENGTH_PCT',
    description: 'Minimum segment length as percentage of content diagonal',
    unit: 'ratio (0-1)',
    default: 0.15,
    range: [0.05, 0.30],
    tuningAdvice: 'DECREASE if valid grid lines are being filtered out (short grids on large sheets). INCREASE if noise segments pollute results.',
  },
  {
    name: 'angleClusterEpsDeg',
    envVar: 'GRID_ANGLE_EPS_DEG',
    description: 'DBSCAN epsilon for angle clustering — max angle difference within a family',
    unit: 'degrees',
    default: 3.0,
    range: [1.0, 8.0],
    tuningAdvice: 'INCREASE if parallel grid lines are splitting into separate families. DECREASE if non-parallel segments merge into same family.',
  },
  {
    name: 'angleClusterMinSupport',
    envVar: 'GRID_ANGLE_MIN_SUPPORT',
    description: 'Minimum segments for DBSCAN to form an angle cluster',
    unit: 'count',
    default: 3,
    range: [2, 8],
    tuningAdvice: 'DECREASE to 2 for small grids (residential). INCREASE for noisy drawings with many non-grid lines.',
  },
  {
    name: 'offsetToleranceMm',
    envVar: 'GRID_OFFSET_TOL_MM',
    description: 'Maximum perpendicular distance between segments to merge into same axis',
    unit: 'mm',
    default: 50.0,
    range: [10.0, 200.0],
    tuningAdvice: 'INCREASE if grid lines are splitting into multiple axes. DECREASE if separate grid lines are merging.',
  },
  {
    name: 'gapMergeToleranceMm',
    envVar: 'GRID_GAP_MERGE_MM',
    description: 'Maximum gap between collinear segments to merge into one axis',
    unit: 'mm',
    default: 200.0,
    range: [50.0, 1000.0],
    tuningAdvice: 'INCREASE if grid lines interrupted by symbols/text are splitting. DECREASE if non-adjacent segments are incorrectly merging.',
  },
  {
    name: 'autoAssignThreshold',
    envVar: 'GRID_AUTO_THRESHOLD',
    description: 'Minimum score for auto-assigning label to axis without review',
    unit: 'score (0-1)',
    default: 0.75,
    range: [0.60, 0.90],
    tuningAdvice: 'DECREASE if too many correct labels go to NEEDS_REVIEW. INCREASE if auto-assignments are frequently wrong.',
  },
  {
    name: 'reviewThreshold',
    envVar: 'GRID_REVIEW_THRESHOLD',
    description: 'Minimum score for a label-axis association to be considered at all',
    unit: 'score (0-1)',
    default: 0.55,
    range: [0.30, 0.70],
    tuningAdvice: 'DECREASE to catch more marginal label matches for review. INCREASE if too many false associations appear.',
  },
];
