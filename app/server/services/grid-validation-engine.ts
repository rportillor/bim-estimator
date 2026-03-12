// server/services/grid-validation-engine.ts
// ═══════════════════════════════════════════════════════════════════════════════
// GRID CONFIDENCE SCORING & VALIDATION ENGINE — v1.1 §9, §10, §15
// ═══════════════════════════════════════════════════════════════════════════════
//
// Centralized post-extraction validation and confidence scoring.
// Runs after the format-specific extractor (WP-3/WP-5) and before the
// orchestrator persists results and sets final run status.
//
// Responsibilities:
//   1. Domain validation (Canadian construction: NBC/OBC spacing bounds)
//   2. Topological validation (grid completeness, family orthogonality)
//   3. Label validation (sequence completeness, duplicates, unlabeled axes)
//   4. Confidence aggregation (per-axis → per-family → per-component → run-level)
//   5. Issue classification with severity and RFI triggers
//   6. Structured validation report for review UI (WP-7)
//
// Integration:
//   orchestrator.runGridDetection()
//     → extractor.extract()
//     → validateAndScore()   ← THIS MODULE
//     → persistExtractorResults()
//     → updateDetectionRunStatus()
//
// Standards: CIQS Standard Method, NBC/OBC, v1.1 §9 (validation), §15 (confidence)
// ═══════════════════════════════════════════════════════════════════════════════

import type { ExtractorResult } from './grid-detection-orchestrator';

// ═══════════════════════════════════════════════════════════════════════════════
// DOMAIN CONSTANTS — Canadian Construction Standards
// ═══════════════════════════════════════════════════════════════════════════════

/** NBC/OBC minimum structural grid spacing (meters) */
const MIN_GRID_SPACING_M = 1.0;

/** Maximum practical grid spacing for buildings (meters) */
const MAX_GRID_SPACING_M = 30.0;

/** Typical Canadian commercial grid spacing range (meters) — for confidence scoring */
const TYPICAL_SPACING_MIN_M = 3.0;
const TYPICAL_SPACING_MAX_M = 12.0;

/** Minimum expected axes per family for a valid structural grid */
const MIN_AXES_PER_FAMILY = 2;

/** Maximum angle deviation from perpendicular for orthogonal grid detection (degrees) */
const ORTHO_TOLERANCE_DEG = 5.0;

/** Minimum expected families for a valid grid (usually 2 for X and Y) */
const MIN_FAMILIES = 2;

/** Maximum families before flagging unusual geometry (rotated wings, etc.) */
const MAX_TYPICAL_FAMILIES = 4;

/** Minimum confidence thresholds per entity level */
const MIN_AXIS_CONFIDENCE = 0.15;
const MIN_NODE_CONFIDENCE = 0.10;
const MIN_RUN_CONFIDENCE = 0.25;

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ValidationIssue {
  code: string;                    // Machine-readable code (e.g., "GRID_SPACING_BELOW_MIN")
  severity: IssueSeverity;
  category: 'domain' | 'topology' | 'labeling' | 'confidence' | 'completeness';
  title: string;
  description: string;
  affectedEntities: string[];      // Entity index references (e.g., "axis:3", "family:0")
  suggestedAction: string;
  generatesRfi: boolean;
}

export interface ConfidenceBreakdown {
  /** Per-axis confidence statistics */
  axes: {
    count: number;
    min: number;
    max: number;
    mean: number;
    median: number;
    belowThreshold: number;        // Count below MIN_AXIS_CONFIDENCE
  };
  /** Per-family confidence (aggregated from axes) */
  families: {
    count: number;
    scores: number[];              // One per family
  };
  /** Labeling confidence */
  labeling: {
    totalAxes: number;
    labeledAxes: number;
    autoAssigned: number;
    needsReview: number;
    unlabeled: number;
    labelCoverage: number;         // labeledAxes / totalAxes
  };
  /** Node/intersection confidence */
  nodes: {
    count: number;
    expectedCount: number;         // families[0].axes × families[1].axes for 2-family grids
    coverage: number;              // actual / expected
    avgConfidence: number;
  };
  /** Overall run confidence (0-1) */
  runConfidence: number;
  /** Quality grade */
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface ValidationReport {
  /** ISO timestamp of validation */
  validatedAt: string;
  /** Issues found, ordered by severity */
  issues: ValidationIssue[];
  /** Confidence breakdown */
  confidence: ConfidenceBreakdown;
  /** Summary counts by severity */
  issueCounts: Record<IssueSeverity, number>;
  /** Whether the run passes minimum quality for production use */
  passesMinimumQuality: boolean;
  /** Recommended run status based on validation */
  recommendedStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  /** Number of RFIs that should be generated */
  rfiCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate and score an extractor result before persistence.
 * Returns a structured validation report with issues and confidence.
 *
 * This function does NOT modify the ExtractorResult — it only analyzes it.
 * The orchestrator uses the report to set final run status.
 */
export function validateAndScore(
  result: ExtractorResult,
  unitScaleToMeters: number,
): ValidationReport {
  const issues: ValidationIssue[] = [];

  // ── 1. Domain Validation ──
  validateDomain(result, unitScaleToMeters, issues);

  // ── 2. Topological Validation ──
  validateTopology(result, issues);

  // ── 3. Label Validation ──
  validateLabeling(result, issues);

  // ── 4. Confidence Aggregation ──
  const confidence = computeConfidence(result);

  // ── 5. Confidence-based issues ──
  validateConfidence(confidence, issues);

  // ── 6. Build report ──
  const issueCounts: Record<IssueSeverity, number> = {
    critical: 0, high: 0, medium: 0, low: 0, info: 0,
  };
  for (const issue of issues) issueCounts[issue.severity]++;

  // Sort by severity
  const severityOrder: Record<IssueSeverity, number> = {
    critical: 0, high: 1, medium: 2, low: 3, info: 4,
  };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const rfiCount = issues.filter(i => i.generatesRfi).length;

  const passesMinimumQuality =
    confidence.runConfidence >= MIN_RUN_CONFIDENCE &&
    issueCounts.critical === 0 &&
    confidence.axes.count >= 2;

  let recommendedStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  if (!passesMinimumQuality) {
    recommendedStatus = 'FAILED';
  } else if (issueCounts.high > 0 || confidence.labeling.needsReview > 0) {
    recommendedStatus = 'PARTIAL';
  } else {
    recommendedStatus = 'SUCCESS';
  }

  return {
    validatedAt: new Date().toISOString(),
    issues,
    confidence,
    issueCounts,
    passesMinimumQuality,
    recommendedStatus,
    rfiCount,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. DOMAIN VALIDATION — NBC/OBC Construction Rules
// ═══════════════════════════════════════════════════════════════════════════════

function validateDomain(
  result: ExtractorResult,
  unitScale: number,
  issues: ValidationIssue[],
): void {
  if (result.families.length === 0 || result.axes.length === 0) return;

  // Check grid spacings within each family
  const familyAxes = new Map<string, Array<{ offsetD: number; index: number }>>();
  for (let i = 0; i < result.axes.length; i++) {
    const axis = result.axes[i];
    const fid = axis.familyId;
    if (!familyAxes.has(fid)) familyAxes.set(fid, []);
    familyAxes.get(fid)!.push({ offsetD: parseFloat(String(axis.offsetD)), index: i });
  }

  for (const [familyId, axes] of familyAxes) {
    if (axes.length < 2) continue;
    axes.sort((a, b) => a.offsetD - b.offsetD);

    for (let i = 1; i < axes.length; i++) {
      const spacingRaw = Math.abs(axes[i].offsetD - axes[i - 1].offsetD);
      const spacingM = spacingRaw * unitScale;

      if (spacingM < MIN_GRID_SPACING_M && spacingM > 0.01) {
        issues.push({
          code: 'GRID_SPACING_BELOW_MIN',
          severity: 'high',
          category: 'domain',
          title: `Grid spacing ${spacingM.toFixed(2)}m below minimum ${MIN_GRID_SPACING_M}m`,
          description: `Axis spacing between axis:${axes[i - 1].index} and axis:${axes[i].index} ` +
            `is ${spacingM.toFixed(3)}m, below NBC/OBC minimum of ${MIN_GRID_SPACING_M}m. ` +
            `This may indicate false positive detection or incorrect unit scaling.`,
          affectedEntities: [`axis:${axes[i - 1].index}`, `axis:${axes[i].index}`],
          suggestedAction: 'Verify grid spacing against structural drawings. Check unit calibration.',
          generatesRfi: true,
        });
      }

      if (spacingM > MAX_GRID_SPACING_M) {
        issues.push({
          code: 'GRID_SPACING_ABOVE_MAX',
          severity: 'medium',
          category: 'domain',
          title: `Grid spacing ${spacingM.toFixed(2)}m exceeds typical maximum ${MAX_GRID_SPACING_M}m`,
          description: `Axis spacing of ${spacingM.toFixed(3)}m exceeds typical maximum. ` +
            `This may indicate a missed intermediate grid line or unit scaling issue.`,
          affectedEntities: [`axis:${axes[i - 1].index}`, `axis:${axes[i].index}`],
          suggestedAction: 'Check for intermediate grid lines. Verify unit calibration.',
          generatesRfi: true,
        });
      }

      if (spacingM >= MIN_GRID_SPACING_M && spacingM <= MAX_GRID_SPACING_M &&
          (spacingM < TYPICAL_SPACING_MIN_M || spacingM > TYPICAL_SPACING_MAX_M)) {
        issues.push({
          code: 'GRID_SPACING_ATYPICAL',
          severity: 'info',
          category: 'domain',
          title: `Grid spacing ${spacingM.toFixed(2)}m outside typical ${TYPICAL_SPACING_MIN_M}-${TYPICAL_SPACING_MAX_M}m range`,
          description: `Spacing is valid but outside the typical range for Canadian commercial construction.`,
          affectedEntities: [`axis:${axes[i - 1].index}`, `axis:${axes[i].index}`],
          suggestedAction: 'No action required — may indicate residential or industrial grid.',
          generatesRfi: false,
        });
      }
    }

    // Check for non-uniform spacing (potential missed grid lines)
    if (axes.length >= 3) {
      const spacings: number[] = [];
      for (let i = 1; i < axes.length; i++) {
        spacings.push(Math.abs(axes[i].offsetD - axes[i - 1].offsetD));
      }
      const avgSpacing = spacings.reduce((s, v) => s + v, 0) / spacings.length;
      const maxDeviation = Math.max(...spacings.map(s => Math.abs(s - avgSpacing) / avgSpacing));

      if (maxDeviation > 0.5 && avgSpacing > 0) {
        // Check if any spacing is approximately 2× the average (missed line)
        const doubleSpacings = spacings.filter(s => Math.abs(s / avgSpacing - 2) < 0.3);
        if (doubleSpacings.length > 0) {
          issues.push({
            code: 'GRID_POSSIBLE_MISSING_LINE',
            severity: 'medium',
            category: 'domain',
            title: `Possible missing grid line in family (${doubleSpacings.length} gaps at ~2× average spacing)`,
            description: `${doubleSpacings.length} spacing(s) are approximately double the average ` +
              `(${(avgSpacing * unitScale).toFixed(2)}m), suggesting missed intermediate grid lines.`,
            affectedEntities: [`family:${familyId}`],
            suggestedAction: 'Review structural drawings for intermediate grid lines.',
            generatesRfi: true,
          });
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. TOPOLOGICAL VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

function validateTopology(
  result: ExtractorResult,
  issues: ValidationIssue[],
): void {
  const { families, axes, nodes, nodeAxes } = result;

  // ── Family count check ──
  if (families.length < MIN_FAMILIES) {
    issues.push({
      code: 'GRID_INSUFFICIENT_FAMILIES',
      severity: families.length === 0 ? 'critical' : 'high',
      category: 'topology',
      title: `Only ${families.length} grid family detected (minimum ${MIN_FAMILIES})`,
      description: `A valid structural grid requires at least ${MIN_FAMILIES} orientation families ` +
        `(typically horizontal and vertical). Only ${families.length} detected.`,
      affectedEntities: families.map((_, i) => `family:${i}`),
      suggestedAction: 'Verify drawing contains visible grid lines in both directions.',
      generatesRfi: true,
    });
  }

  if (families.length > MAX_TYPICAL_FAMILIES) {
    issues.push({
      code: 'GRID_MANY_FAMILIES',
      severity: 'low',
      category: 'topology',
      title: `${families.length} grid families detected (typical: 2-${MAX_TYPICAL_FAMILIES})`,
      description: `More families than typical may indicate rotated building wings, ` +
        `angled grids, or false-positive detection of non-grid geometry.`,
      affectedEntities: families.map((_, i) => `family:${i}`),
      suggestedAction: 'Review detected families — confirm all represent actual grid lines.',
      generatesRfi: false,
    });
  }

  // ── Orthogonality check (for 2-family grids) ──
  if (families.length >= 2) {
    const theta0 = parseFloat(String(families[0].thetaDeg));
    const theta1 = parseFloat(String(families[1].thetaDeg));
    let angleBetween = Math.abs(theta0 - theta1);
    if (angleBetween > 90) angleBetween = 180 - angleBetween;
    const deviation = Math.abs(angleBetween - 90);

    if (deviation > ORTHO_TOLERANCE_DEG && deviation < 80) {
      issues.push({
        code: 'GRID_NON_ORTHOGONAL',
        severity: 'medium',
        category: 'topology',
        title: `Grid families are ${angleBetween.toFixed(1)}° apart (${deviation.toFixed(1)}° from perpendicular)`,
        description: `Primary grid families are not perpendicular. This may indicate a skewed grid ` +
          `(valid for some structures) or a detection error.`,
        affectedEntities: ['family:0', 'family:1'],
        suggestedAction: 'Verify if structure has an intentionally skewed grid layout.',
        generatesRfi: false,
      });
    }
  }

  // ── Axes per family ──
  const familyAxesCounts = new Map<string, number>();
  for (const axis of axes) {
    const fid = axis.familyId;
    familyAxesCounts.set(fid, (familyAxesCounts.get(fid) || 0) + 1);
  }
  for (const [fid, count] of familyAxesCounts) {
    if (count < MIN_AXES_PER_FAMILY) {
      issues.push({
        code: 'GRID_FEW_AXES_IN_FAMILY',
        severity: 'medium',
        category: 'topology',
        title: `Family has only ${count} axis (minimum ${MIN_AXES_PER_FAMILY})`,
        description: `A grid family with fewer than ${MIN_AXES_PER_FAMILY} axes may be a false positive ` +
          `or indicate partial grid detection.`,
        affectedEntities: [`family:${fid}`],
        suggestedAction: 'Check if additional grid lines were missed in this direction.',
        generatesRfi: false,
      });
    }
  }

  // ── Node coverage ──
  if (families.length >= 2 && axes.length >= 2) {
    const familySizes = Array.from(familyAxesCounts.values()).sort((a, b) => b - a);
    const expectedNodes = familySizes.length >= 2 ? familySizes[0] * familySizes[1] : 0;

    if (expectedNodes > 0 && nodes.length < expectedNodes * 0.5) {
      issues.push({
        code: 'GRID_LOW_NODE_COVERAGE',
        severity: 'medium',
        category: 'topology',
        title: `Only ${nodes.length}/${expectedNodes} expected grid intersections detected`,
        description: `Node coverage is ${((nodes.length / expectedNodes) * 100).toFixed(0)}%. ` +
          `Many expected intersections are missing, which may indicate partial grid lines ` +
          `or incorrect family grouping.`,
        affectedEntities: [],
        suggestedAction: 'Review axes for correct family assignment. Check for partial grid lines.',
        generatesRfi: nodes.length < expectedNodes * 0.25,
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. LABEL VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

function validateLabeling(
  result: ExtractorResult,
  issues: ValidationIssue[],
): void {
  const { axes, labels, axisLabels } = result;

  const totalAxes = axes.length;
  if (totalAxes === 0) return;

  // Count labeled vs unlabeled axes
  const labeledAxisIds = new Set(axisLabels.map(al => al.axisId));
  const unlabeledCount = totalAxes - labeledAxisIds.size;
  const needsReviewCount = axisLabels.filter(al => al.status === 'NEEDS_REVIEW').length;

  // ── No labels at all ──
  if (labels.length === 0) {
    issues.push({
      code: 'GRID_NO_LABELS',
      severity: 'high',
      category: 'labeling',
      title: 'No grid labels detected',
      description: 'No text labels (A, B, C or 1, 2, 3) were found near grid axes. ' +
        'Grid lines cannot be referenced without labels.',
      affectedEntities: [],
      suggestedAction: 'Check drawing for grid bubble labels. If present, verify extraction quality.',
      generatesRfi: true,
    });
    return;
  }

  // ── Low label coverage ──
  if (unlabeledCount > 0) {
    const coverage = labeledAxisIds.size / totalAxes;
    const severity: IssueSeverity = coverage < 0.5 ? 'high' : coverage < 0.8 ? 'medium' : 'low';

    issues.push({
      code: 'GRID_UNLABELED_AXES',
      severity,
      category: 'labeling',
      title: `${unlabeledCount}/${totalAxes} axes have no assigned label`,
      description: `Label coverage is ${(coverage * 100).toFixed(0)}%. ` +
        `Unlabeled axes cannot be referenced in the BOQ or element placement.`,
      affectedEntities: axes
        .filter((_, i) => !labeledAxisIds.has(String(i)))
        .map((_, i) => `axis:${i}`)
        .slice(0, 10),
      suggestedAction: 'Review unlabeled axes — assign labels manually or verify detection.',
      generatesRfi: coverage < 0.5,
    });
  }

  // ── Review items ──
  if (needsReviewCount > 0) {
    issues.push({
      code: 'GRID_LABELS_NEED_REVIEW',
      severity: needsReviewCount > totalAxes * 0.5 ? 'high' : 'medium',
      category: 'labeling',
      title: `${needsReviewCount} label associations need human review`,
      description: `These associations scored below the auto-assign threshold or had ` +
        `insufficient margin over competing candidates.`,
      affectedEntities: axisLabels
        .filter(al => al.status === 'NEEDS_REVIEW')
        .map(al => `axis-label:${al.axisId}-${al.labelId}`)
        .slice(0, 10),
      suggestedAction: 'Review flagged associations in the Grid Review UI.',
      generatesRfi: false,
    });
  }

  // ── Duplicate label text ──
  const labelTexts = labels.map(l => l.normText).filter(Boolean);
  const textCounts = new Map<string, number>();
  for (const t of labelTexts) {
    textCounts.set(t as string, (textCounts.get(t as string) || 0) + 1);
  }
  const duplicates = Array.from(textCounts.entries()).filter(([, c]) => c > 1);

  if (duplicates.length > 0) {
    issues.push({
      code: 'GRID_DUPLICATE_LABELS',
      severity: 'medium',
      category: 'labeling',
      title: `Duplicate label text detected: ${duplicates.map(([t, c]) => `${t}(×${c})`).join(', ')}`,
      description: `Grid labels should be unique. Duplicates may indicate false positive detection ` +
        `or label text present in both plan and legend.`,
      affectedEntities: [],
      suggestedAction: 'Verify duplicate labels are not from drawing legend or title block.',
      generatesRfi: false,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. CONFIDENCE AGGREGATION
// ═══════════════════════════════════════════════════════════════════════════════

function computeConfidence(result: ExtractorResult): ConfidenceBreakdown {
  const { families, axes, axisLabels, nodes } = result;

  // ── Axis confidence ──
  const axisConfs = axes.map(a => parseFloat(String(a.confidence)));
  const axisMin = axisConfs.length > 0 ? Math.min(...axisConfs) : 0;
  const axisMax = axisConfs.length > 0 ? Math.max(...axisConfs) : 0;
  const axisMean = axisConfs.length > 0 ? axisConfs.reduce((s, v) => s + v, 0) / axisConfs.length : 0;
  const axisMedian = median(axisConfs);
  const axisBelowThreshold = axisConfs.filter(c => c < MIN_AXIS_CONFIDENCE).length;

  // ── Family confidence ──
  const familyConfs = families.map(f => parseFloat(String(f.confidence)));

  // ── Labeling stats ──
  const totalAxes = axes.length;
  const labeledAxisIds = new Set(axisLabels.map(al => al.axisId));
  const autoAssigned = axisLabels.filter(al => al.status === 'AUTO').length;
  const needsReview = axisLabels.filter(al => al.status === 'NEEDS_REVIEW').length;
  const unlabeled = totalAxes - labeledAxisIds.size;
  const labelCoverage = totalAxes > 0 ? labeledAxisIds.size / totalAxes : 0;

  // ── Node stats ──
  const nodeConfs = nodes.map(n => parseFloat(String(n.confidence)));
  const avgNodeConf = nodeConfs.length > 0 ? nodeConfs.reduce((s, v) => s + v, 0) / nodeConfs.length : 0;

  // Expected nodes for 2-family orthogonal grid
  const familyAxesCounts: number[] = [];
  const familyMap = new Map<string, number>();
  for (const axis of axes) {
    familyMap.set(axis.familyId, (familyMap.get(axis.familyId) || 0) + 1);
  }
  for (const [, count] of familyMap) familyAxesCounts.push(count);
  familyAxesCounts.sort((a, b) => b - a);
  const expectedNodes = familyAxesCounts.length >= 2
    ? familyAxesCounts[0] * familyAxesCounts[1]
    : 0;
  const nodeCoverage = expectedNodes > 0 ? nodes.length / expectedNodes : (nodes.length > 0 ? 1 : 0);

  // ── Run confidence (weighted combination) ──
  const W_AXES = 0.30;
  const W_FAMILIES = 0.15;
  const W_LABELS = 0.25;
  const W_NODES = 0.15;
  const W_COVERAGE = 0.15;

  const familyScore = families.length >= MIN_FAMILIES
    ? Math.min(1, families.length / MIN_FAMILIES) * (familyConfs.length > 0 ? familyConfs.reduce((s, v) => s + v, 0) / familyConfs.length : 0)
    : 0;

  const runConfidence = Math.min(0.999, Math.max(0,
    W_AXES * axisMean +
    W_FAMILIES * familyScore +
    W_LABELS * (labelCoverage * 0.7 + (autoAssigned / Math.max(1, axisLabels.length)) * 0.3) +
    W_NODES * Math.min(1, nodeCoverage) * avgNodeConf +
    W_COVERAGE * Math.min(1, axes.length / 4) // Reward having sufficient axes
  ));

  // ── Grade ──
  let grade: 'A' | 'B' | 'C' | 'D' | 'F';
  if (runConfidence >= 0.85) grade = 'A';
  else if (runConfidence >= 0.70) grade = 'B';
  else if (runConfidence >= 0.50) grade = 'C';
  else if (runConfidence >= 0.30) grade = 'D';
  else grade = 'F';

  return {
    axes: {
      count: axisConfs.length,
      min: round3(axisMin),
      max: round3(axisMax),
      mean: round3(axisMean),
      median: round3(axisMedian),
      belowThreshold: axisBelowThreshold,
    },
    families: {
      count: families.length,
      scores: familyConfs.map(round3),
    },
    labeling: {
      totalAxes,
      labeledAxes: labeledAxisIds.size,
      autoAssigned,
      needsReview,
      unlabeled,
      labelCoverage: round3(labelCoverage),
    },
    nodes: {
      count: nodes.length,
      expectedCount: expectedNodes,
      coverage: round3(nodeCoverage),
      avgConfidence: round3(avgNodeConf),
    },
    runConfidence: round3(runConfidence),
    grade,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. CONFIDENCE-BASED ISSUES
// ═══════════════════════════════════════════════════════════════════════════════

function validateConfidence(
  confidence: ConfidenceBreakdown,
  issues: ValidationIssue[],
): void {
  if (confidence.axes.belowThreshold > 0) {
    issues.push({
      code: 'GRID_LOW_CONFIDENCE_AXES',
      severity: 'medium',
      category: 'confidence',
      title: `${confidence.axes.belowThreshold} axes below minimum confidence threshold`,
      description: `These axes have confidence below ${MIN_AXIS_CONFIDENCE} and may be false positives.`,
      affectedEntities: [],
      suggestedAction: 'Review low-confidence axes — reject false positives.',
      generatesRfi: false,
    });
  }

  if (confidence.runConfidence < MIN_RUN_CONFIDENCE) {
    issues.push({
      code: 'GRID_RUN_CONFIDENCE_LOW',
      severity: 'critical',
      category: 'confidence',
      title: `Overall detection confidence ${(confidence.runConfidence * 100).toFixed(0)}% is below minimum ${(MIN_RUN_CONFIDENCE * 100).toFixed(0)}%`,
      description: `The grid detection result does not meet minimum quality standards. ` +
        `This could indicate poor input quality, incorrect format, or non-grid content.`,
      affectedEntities: [],
      suggestedAction: 'Try a different input file format or manually review the drawing.',
      generatesRfi: true,
    });
  }

  if (confidence.grade === 'D' || confidence.grade === 'F') {
    issues.push({
      code: 'GRID_QUALITY_GRADE_LOW',
      severity: confidence.grade === 'F' ? 'high' : 'medium',
      category: 'confidence',
      title: `Detection quality grade: ${confidence.grade}`,
      description: `Grid detection quality is ${confidence.grade === 'F' ? 'failing' : 'poor'}. ` +
        `Run confidence: ${(confidence.runConfidence * 100).toFixed(0)}%.`,
      affectedEntities: [],
      suggestedAction: 'Human review strongly recommended before using grid data for element placement.',
      generatesRfi: false,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. CONVERT ISSUES TO RFI-COMPATIBLE FORMAT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert validation issues to the conflict detection format used by rfi-service.
 * This allows Phase 3.1 in bim-generator to feed grid validation issues
 * into the existing RFI pipeline.
 */
export function issuesToConflictResults(
  issues: ValidationIssue[],
): Array<{
  type: string;
  severity: string;
  title: string;
  description: string;
  relatedDocuments: string[];
  proposedSolution: string;
}> {
  return issues
    .filter(i => i.generatesRfi)
    .map(issue => ({
      type: 'missing_information',
      severity: issue.severity === 'critical' ? 'critical' : issue.severity === 'high' ? 'high' : 'medium',
      title: `Grid Validation: ${issue.title}`,
      description: `[${issue.code}] ${issue.description}`,
      relatedDocuments: ['Structural Foundation Plan', 'Architectural Floor Plans'],
      proposedSolution: issue.suggestedAction,
    }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
