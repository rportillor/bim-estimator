// server/services/grid-detection-orchestrator.ts
// ═══════════════════════════════════════════════════════════════════════════════
// GRID DETECTION ORCHESTRATOR — v1.1 §2–§3
// ═══════════════════════════════════════════════════════════════════════════════
//
// Master controller for grid line detection. Responsibilities:
//   1. Classify input format (RVT > DXF > vector PDF > raster PDF > image)
//   2. Create/manage DetectionRun lifecycle with frozen parameters
//   3. Route to format-specific geometry extractors (WP-3, WP-5)
//   4. Build coordinate transforms (v1.1 §8)
//   5. Aggregate results into grid schema via grid-storage
//   6. Trigger confidence scoring (WP-6) and validation
//   7. Generate RFIs for low-confidence or failed detections
//
// Input hierarchy (v1.1 §3 — ordered by extraction reliability):
//   1. RVT (Revit native) — Grid API direct, confidence ≈ 1.0
//   2. DXF (AutoCAD)      — Layer filter + geometry, confidence 0.85–0.95
//   3. PDF (vector)        — Content stream parsing, confidence 0.70–0.90
//   4. PDF (raster)        — CV + OCR pipeline, confidence 0.40–0.70
//   5. Image (PNG/JPG/TIF) — CV + OCR pipeline, confidence 0.30–0.60
//
// Consumed by: bim-generator.ts (automatic), routes/grid-detection.ts (manual)
// Depends on:  grid-storage.ts, cad-parser.ts, pdf-extract.ts, ocr.ts,
//              layout-calibration.ts, raster-glyph-locator.ts
//
// Standards: CIQS Standard Method, v1.1 Grid Line Recognition Specification
// ═══════════════════════════════════════════════════════════════════════════════

import path from 'path';
import { loadFileBuffer } from './storage-file-resolver';
import {
  validateAndScore,
  type ValidationReport,
} from './grid-validation-engine';
import {
  createDetectionRun,
  updateDetectionRunStatus,
  createGridComponent,
  createGridFamilies,
  createGridAxes,
  createGridMarkers,
  createGridLabels,
  createGridAxisLabels,
  createGridNodes,
  createGridNodeAxesBatch,
  createCoordinateTransform,
  getProjectGridSystem,
} from './grid-storage';
import type {
  InsertGridDetectionRun,
  InsertGridComponent,
  InsertGridFamily,
  InsertGridAxis,
  InsertGridMarker,
  InsertGridLabel,
  InsertGridAxisLabel,
  InsertGridNode,
  InsertGridNodeAxis,
  InsertGridCoordinateTransform,
  GridDetectionRun,
} from '@shared/schema';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

/** Supported input file types for grid detection */
export type GridInputType = 'RVT' | 'DXF' | 'DWG' | 'PDF_VECTOR' | 'PDF_RASTER' | 'IMAGE';

/** Result of input classification */
export interface InputClassification {
  inputType: GridInputType;
  confidence: number;          // How confident we are in the classification
  hasVectorContent: boolean;   // Whether the file has extractable vector geometry
  pageCount?: number;          // Number of pages/sheets
  detectedLayers?: string[];   // CAD layer names (DXF/DWG only)
  notes: string[];             // Classification notes for audit
}

/** Default detection parameters per v1.1 §13 */
export const DEFAULT_DETECTION_PARAMS = {
  // §13.1: Candidate segment filters
  candidateMinLengthPct: 0.15,       // Min segment length as % of content width
  straightnessTolDeg: 2.0,           // Max angular deviation for straightness
  strokeWidthRange: [0.1, 3.0],      // Acceptable stroke width range (mm)

  // §13.2: DBSCAN angle clustering
  angleClusterEpsDeg: 3.0,           // Angle clustering epsilon (degrees)
  angleClusterMinSupport: 3,         // Minimum cluster support (segments)

  // §13.3: Offset consolidation & segment merging
  offsetToleranceMm: 50.0,           // Offset clustering tolerance
  gapMergeToleranceMm: 200.0,        // Gap merge tolerance between collinear segments

  // §13.4: Marker/bubble detection
  markerSearchRadiusPct: 0.03,       // Bubble search radius as % of page diagonal
  markerAreaMinPct: 0.0002,          // Min marker area as % of page area
  markerAreaMaxPct: 0.005,           // Max marker area as % of page area
  markerCircularityMin: 0.7,         // Min circularity for circle detection

  // §14.2: Label-to-axis scoring weights
  labelScoreWeights: {
    endpointProximity: 0.35,
    perpendicularDistance: 0.25,
    directionalAlignment: 0.15,
    markerSupport: 0.15,
    textQuality: 0.10,
  },

  // §14.3: Decision thresholds
  autoAssignThreshold: 0.75,         // Score >= this → AUTO status
  autoAssignMargin: 0.10,            // Min margin over 2nd-best for AUTO
  reviewThreshold: 0.55,             // Score >= this but < auto → NEEDS_REVIEW
  // Below reviewThreshold → unassigned
};

/** Tool versions for reproducibility */
export const TOOL_VERSIONS = {
  pdfParser: 'pdf-parse@1.1.1',
  dxfParser: 'dxf-parser@1.1.2',
  ocrEngine: 'tesseract.js@5.x',
  ocrModel: 'eng',
  detectorVersion: 'estimatorpro-grid-v1.1',
};

/** Options for running grid detection */
export interface GridDetectionOptions {
  projectId: string;
  sourceFileId: string;
  filename: string;
  storageKey: string;

  // Optional overrides
  sheetId?: string;               // Specific sheet/view to detect on
  pageNo?: number;                // Specific page for multi-page PDFs
  parameterOverrides?: Partial<typeof DEFAULT_DETECTION_PARAMS>;
  triggeredBy?: string;           // "auto" | "manual" | user ID
}

/** Result returned by format-specific extractors */
export interface ExtractorResult {
  success: boolean;

  // Extracted geometry (populated by WP-3/WP-5 extractors)
  components: InsertGridComponent[];
  families: InsertGridFamily[];
  axes: InsertGridAxis[];
  markers: InsertGridMarker[];
  labels: InsertGridLabel[];
  axisLabels: InsertGridAxisLabel[];
  nodes: InsertGridNode[];
  nodeAxes: InsertGridNodeAxis[];

  // Coordinate transform data
  transform?: InsertGridCoordinateTransform;

  // Diagnostics
  warnings: string[];
  errors: string[];
  extractionTimeMs: number;
}

/**
 * Interface that format-specific extractors must implement.
 * WP-3 (DXF), WP-5 (vector PDF), and future extractors all conform to this.
 */
export interface GridExtractor {
  readonly name: string;
  readonly supportedTypes: GridInputType[];

  /**
   * Extract grid geometry from the given file buffer.
   * Must return structured data ready for persistence.
   */
  extract(
    buffer: Buffer,
    classification: InputClassification,
    params: typeof DEFAULT_DETECTION_PARAMS,
    runId: string,
  ): Promise<ExtractorResult>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INPUT CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

/** File extension to input type mapping */
const EXTENSION_MAP: Record<string, GridInputType> = {
  '.rvt': 'RVT',
  '.rfa': 'RVT',
  '.dxf': 'DXF',
  '.dwg': 'DWG',
  '.ifc': 'DXF',    // IFC treated as vector CAD for grid detection
  '.pdf': 'PDF_VECTOR',  // Default to vector; reclassified after content probe
  '.png': 'IMAGE',
  '.jpg': 'IMAGE',
  '.jpeg': 'IMAGE',
  '.tif': 'IMAGE',
  '.tiff': 'IMAGE',
  '.bmp': 'IMAGE',
};

/**
 * Classify input file format and capabilities.
 * Determines the optimal extraction path per v1.1 §3.
 */
export async function classifyInput(
  filename: string,
  storageKey: string,
): Promise<InputClassification> {
  const ext = path.extname(filename).toLowerCase();
  const baseType = EXTENSION_MAP[ext];
  const notes: string[] = [];

  if (!baseType) {
    return {
      inputType: 'IMAGE',
      confidence: 0.3,
      hasVectorContent: false,
      notes: [`Unknown extension "${ext}" — falling back to IMAGE pipeline`],
    };
  }

  // For PDFs, probe content to distinguish vector vs raster
  if (baseType === 'PDF_VECTOR') {
    const classification = await probePdfContent(storageKey, notes);
    return classification;
  }

  // CAD formats are inherently vector
  if (baseType === 'RVT' || baseType === 'DXF' || baseType === 'DWG') {
    const layers = baseType === 'DXF' ? await probeDxfLayers(storageKey, notes) : undefined;
    return {
      inputType: baseType,
      confidence: baseType === 'RVT' ? 0.99 : 0.95,
      hasVectorContent: true,
      detectedLayers: layers,
      notes,
    };
  }

  // Images
  return {
    inputType: 'IMAGE',
    confidence: 0.5,
    hasVectorContent: false,
    notes: [`Image file (${ext}) — will use raster CV + OCR pipeline`],
  };
}

/**
 * Probe PDF content to determine if it's vector or raster.
 * Vector PDFs have text objects and drawing operators; raster PDFs are embedded images.
 */
async function probePdfContent(
  storageKey: string,
  notes: string[],
): Promise<InputClassification> {
  try {
    const buf = await loadFileBuffer(storageKey);
    if (!buf) {
      notes.push('Could not load PDF buffer — treating as raster');
      return { inputType: 'PDF_RASTER', confidence: 0.4, hasVectorContent: false, notes };
    }

    // Quick content probe: look for vector drawing operators in raw PDF bytes
    // Vector PDFs contain operators like 'm' (moveto), 'l' (lineto), 're' (rect),
    // 'Tm' (text matrix), 'Tj' (show text)
    const header = buf.slice(0, Math.min(buf.length, 50000)).toString('latin1');

    // Count vector indicators
    const hasTextOps = /\bTj\b|\bTJ\b|\bTm\b/.test(header);
    const hasLineOps = /\b[ml]\s+[\d.]+\s+[\d.]+/.test(header) || /\bre\b/.test(header);
    const hasImageStreams = /\/Subtype\s*\/Image/.test(header);
    const hasFormXObjects = /\/Subtype\s*\/Form/.test(header);

    // Decision logic
    if (hasTextOps && hasLineOps) {
      notes.push('PDF contains vector text and line drawing operators');
      return {
        inputType: 'PDF_VECTOR',
        confidence: 0.85,
        hasVectorContent: true,
        notes,
      };
    }

    if (hasFormXObjects && !hasImageStreams) {
      notes.push('PDF contains form XObjects but no image streams — likely vector');
      return {
        inputType: 'PDF_VECTOR',
        confidence: 0.70,
        hasVectorContent: true,
        notes,
      };
    }

    if (hasImageStreams && !hasLineOps) {
      notes.push('PDF is primarily raster images — will use CV + OCR');
      return {
        inputType: 'PDF_RASTER',
        confidence: 0.75,
        hasVectorContent: false,
        notes,
      };
    }

    // Mixed content — try vector first, fall back to raster
    notes.push('PDF has mixed vector/raster content — attempting vector extraction');
    return {
      inputType: 'PDF_VECTOR',
      confidence: 0.60,
      hasVectorContent: true,
      notes,
    };

  } catch (error) {
    notes.push(`PDF probe error: ${(error as Error).message} — treating as raster`);
    return { inputType: 'PDF_RASTER', confidence: 0.4, hasVectorContent: false, notes };
  }
}

/**
 * Probe DXF file for grid-relevant layer names.
 */
async function probeDxfLayers(
  storageKey: string,
  notes: string[],
): Promise<string[] | undefined> {
  try {
    const buf = await loadFileBuffer(storageKey);
    if (!buf) return undefined;

    const content = buf.toString('utf8').substring(0, 100000);

    // Extract layer names from TABLES section
    const layerPattern = /AcDbLayerTableRecord\s+2\s+(\S+)/g;
    const layers: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = layerPattern.exec(content)) !== null) {
      layers.push(match[1]);
    }

    // Identify grid-relevant layers
    const gridLayers = layers.filter(l =>
      /grid|axis|grille|g-grid|a-grid|s-grid/i.test(l)
    );

    if (gridLayers.length > 0) {
      notes.push(`DXF grid layers found: ${gridLayers.join(', ')}`);
    } else {
      notes.push(`DXF has ${layers.length} layers but no obvious grid layers — will scan all`);
    }

    return layers;
  } catch {
    return undefined;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXTRACTOR REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Registry of format-specific grid extractors.
 * WP-3 (DXF) and WP-5 (Vector PDF) will register here.
 */
const extractorRegistry: Map<GridInputType, GridExtractor> = new Map();

/**
 * Register a grid extractor for one or more input types.
 * Called by WP-3 and WP-5 modules at initialization.
 */
export function registerGridExtractor(extractor: GridExtractor): void {
  for (const type of extractor.supportedTypes) {
    extractorRegistry.set(type, extractor);
    console.log(`📐 Grid extractor registered: ${extractor.name} → ${type}`);
  }
}

/**
 * Get the registered extractor for an input type, or null if none available.
 */
export function getExtractorForType(type: GridInputType): GridExtractor | null {
  return extractorRegistry.get(type) ?? null;
}

/**
 * List all registered extractors and their supported types.
 */
export function listRegisteredExtractors(): Array<{ name: string; types: GridInputType[] }> {
  const seen = new Set<string>();
  const result: Array<{ name: string; types: GridInputType[] }> = [];
  for (const [, extractor] of extractorRegistry) {
    if (!seen.has(extractor.name)) {
      seen.add(extractor.name);
      result.push({ name: extractor.name, types: extractor.supportedTypes });
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATION — runGridDetection()
// ═══════════════════════════════════════════════════════════════════════════════

/** Full result of a detection run */
export interface GridDetectionResult {
  run: GridDetectionRun;
  classification: InputClassification;
  stats: {
    componentCount: number;
    familyCount: number;
    axisCount: number;
    nodeCount: number;
    markerCount: number;
    labelCount: number;
    needsReviewCount: number;
  };
  validation: ValidationReport | null;
  warnings: string[];
  errors: string[];
  durationMs: number;
}

/**
 * MAIN ENTRY POINT: Run grid detection on a source file.
 *
 * Orchestrates the full pipeline:
 *   1. Classify input format
 *   2. Create detection run record (audit trail)
 *   3. Load file buffer
 *   4. Route to format-specific extractor
 *   5. Persist all extracted geometry to grid schema
 *   6. Update run status
 *   7. Return results
 *
 * If no extractor is registered for the input type, returns a FAILED run
 * with appropriate error messages.
 */
export async function runGridDetection(
  options: GridDetectionOptions,
): Promise<GridDetectionResult> {
  const startTime = Date.now();
  const warnings: string[] = [];
  const errors: string[] = [];

  // ── Step 1: Classify Input ──
  const classification = await classifyInput(options.filename, options.storageKey);
  warnings.push(...classification.notes);

  // Merge parameters with overrides
  const params = {
    ...DEFAULT_DETECTION_PARAMS,
    ...(options.parameterOverrides ?? {}),
  };

  // ── Step 2: Create Detection Run Record ──
  const runData: InsertGridDetectionRun = {
    projectId: options.projectId,
    sourceFileId: options.sourceFileId,
    sheetId: options.sheetId ?? null,
    viewId: null,
    pageNo: options.pageNo ?? null,
    inputType: classification.inputType,
    parameters: params,
    toolVersions: TOOL_VERSIONS,
    status: 'FAILED',  // Will be updated on success
    startedAt: new Date(),
    triggeredBy: options.triggeredBy ?? 'auto',
  };

  const run = await createDetectionRun(runData);
  console.log(`📐 Grid detection started: run=${run.id}, type=${classification.inputType}, file=${options.filename}`);

  // ── Step 3: Load File Buffer ──
  const buffer = await loadFileBuffer(options.storageKey);
  if (!buffer) {
    const msg = `Cannot load file buffer for "${options.filename}" (storageKey: ${options.storageKey})`;
    errors.push(msg);
    console.error(`❌ ${msg}`);
    await updateDetectionRunStatus(run.id, 'FAILED');
    return buildResult(run, classification, errors, warnings, startTime);
  }

  // ── Step 4: Get Extractor for Input Type ──
  let extractor = getExtractorForType(classification.inputType);

  // Fallback chain: DWG → try DXF extractor (if DWG-to-DXF conversion available)
  if (!extractor && classification.inputType === 'DWG') {
    extractor = getExtractorForType('DXF');
    if (extractor) {
      warnings.push('DWG file — using DXF extractor (requires ODA conversion)');
    }
  }

  // Fallback: PDF_RASTER → try IMAGE extractor
  if (!extractor && classification.inputType === 'PDF_RASTER') {
    extractor = getExtractorForType('IMAGE');
    if (extractor) {
      warnings.push('Raster PDF — falling back to IMAGE extractor');
    }
  }

  if (!extractor) {
    const registered = listRegisteredExtractors();
    const msg = registered.length > 0
      ? `No grid extractor registered for ${classification.inputType}. Available: ${registered.map(e => e.types.join(',')).join('; ')}`
      : `No grid extractors registered. Grid detection requires WP-3 (DXF) or WP-5 (Vector PDF) to be implemented.`;
    errors.push(msg);
    warnings.push(
      'Grid detection infrastructure (schema + orchestrator) is ready. ' +
      'Format-specific geometry extractors are pending implementation: ' +
      'WP-3 (DXF/CAD) and WP-5 (Vector PDF).'
    );
    console.warn(`⚠️ ${msg}`);
    await updateDetectionRunStatus(run.id, 'FAILED');
    return buildResult(run, classification, errors, warnings, startTime);
  }

  // ── Step 5: Run Format-Specific Extractor ──
  console.log(`📐 Running extractor: ${extractor.name} for ${classification.inputType}`);
  let extractorResult: ExtractorResult;
  try {
    extractorResult = await extractor.extract(buffer, classification, params, run.id);
    warnings.push(...extractorResult.warnings);
    errors.push(...extractorResult.errors);
  } catch (error) {
    const msg = `Extractor ${extractor.name} threw: ${(error as Error).message}`;
    errors.push(msg);
    console.error(`❌ ${msg}`);
    await updateDetectionRunStatus(run.id, 'FAILED');
    return buildResult(run, classification, errors, warnings, startTime);
  }

  if (!extractorResult.success) {
    errors.push(`Extractor ${extractor.name} returned success=false`);
    await updateDetectionRunStatus(run.id, 'FAILED');
    return buildResult(run, classification, errors, warnings, startTime);
  }

  // ── Step 6: Validate & Score (WP-6) ──
  // Run domain, topology, labeling, and confidence validation before persisting
  let validationReport: ValidationReport | null = null;
  try {
    // Determine unit scale for domain validation
    const unitScale = extractorResult.transform
      ? parseFloat(String(extractorResult.transform.scale)) || 0.001
      : 0.001; // Default to mm if no transform

    validationReport = validateAndScore(extractorResult, unitScale);

    // Add validation issues as warnings
    for (const issue of validationReport.issues) {
      const prefix = issue.severity === 'critical' ? '🔴' :
                     issue.severity === 'high' ? '🟠' :
                     issue.severity === 'medium' ? '🟡' : '🔵';
      warnings.push(`${prefix} [${issue.code}] ${issue.title}`);
    }

    console.log(
      `📐 Validation: grade=${validationReport.confidence.grade}, ` +
      `confidence=${(validationReport.confidence.runConfidence * 100).toFixed(0)}%, ` +
      `issues=${validationReport.issues.length} ` +
      `(${validationReport.issueCounts.critical}c/${validationReport.issueCounts.high}h/${validationReport.issueCounts.medium}m), ` +
      `RFIs=${validationReport.rfiCount}, ` +
      `recommended=${validationReport.recommendedStatus}`
    );
  } catch (error) {
    warnings.push(`⚠️ Validation engine error (non-blocking): ${(error as Error).message}`);
  }

  // ── Step 7: Persist All Extracted Data ──
  const stats = await persistExtractorResults(run.id, options.projectId, extractorResult);

  // ── Step 8: Update Run Status ──
  // Use validation report's recommendation if available, fall back to basic logic
  let finalStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  if (validationReport) {
    finalStatus = validationReport.recommendedStatus;
  } else {
    const needsReview = stats.needsReviewCount > 0;
    finalStatus = errors.length > 0 ? 'PARTIAL' : (needsReview ? 'PARTIAL' : 'SUCCESS');
  }
  const updatedRun = await updateDetectionRunStatus(run.id, finalStatus);

  console.log(
    `✅ Grid detection complete: run=${run.id}, status=${finalStatus}, ` +
    `axes=${stats.axisCount}, nodes=${stats.nodeCount}, ` +
    `review=${stats.needsReviewCount}, ${Date.now() - startTime}ms`
  );

  return {
    run: updatedRun ?? run,
    classification,
    stats,
    validation: validationReport,
    warnings,
    errors,
    durationMs: Date.now() - startTime,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERSISTENCE — Store Extractor Results in Grid Schema
// ═══════════════════════════════════════════════════════════════════════════════

interface PersistenceStats {
  componentCount: number;
  familyCount: number;
  axisCount: number;
  nodeCount: number;
  markerCount: number;
  labelCount: number;
  needsReviewCount: number;
}

/**
 * Persist all extracted grid data from an extractor result.
 *
 * IMPORTANT — ID REMAPPING:
 * Extractors use array index strings ("0", "1", "2") as temporary FK references
 * because real DB UUIDs are not known until insertion. This function inserts
 * entities in FK-dependency order and remaps references to real IDs:
 *
 *   components[i] → real UUID, referenced by families as componentId = "i"
 *   families[i]   → real UUID, referenced by axes as familyId = "i"
 *   axes[i]       → real UUID, referenced by markers, axisLabels, nodeAxes
 *   markers[i]    → real UUID, referenced by labels as markerId = "i"
 *   labels[i]     → real UUID, referenced by axisLabels as labelId = "i"
 *   nodes[i]      → real UUID, referenced by nodeAxes as nodeId = "i"
 */
async function persistExtractorResults(
  runId: string,
  projectId: string,
  result: ExtractorResult,
): Promise<PersistenceStats> {
  let needsReviewCount = 0;

  // ── 1. Components ──
  const compMap = new Map<string, string>(); // index → real ID
  if (result.components.length > 0) {
    for (let i = 0; i < result.components.length; i++) {
      const saved = await createGridComponent({ ...result.components[i], runId });
      compMap.set(String(i), saved.id);
    }
  } else {
    // Fallback: create a default component
    const saved = await createGridComponent({
      runId, name: 'Main',
      bboxMinX: '0', bboxMinY: '0', bboxMaxX: '0', bboxMaxY: '0',
      primaryFrame: 'MODEL', confidence: '0.500',
    });
    compMap.set('0', saved.id);
  }

  // ── 2. Families (FK: componentId → components) ──
  const famMap = new Map<string, string>();
  for (let i = 0; i < result.families.length; i++) {
    const fam = result.families[i];
    const realCompId = compMap.get(fam.componentId) ?? fam.componentId;
    const [saved] = await createGridFamilies([{ ...fam, componentId: realCompId }]);
    famMap.set(String(i), saved.id);
  }

  // ── 3. Axes (FK: familyId → families) ──
  const axisMap = new Map<string, string>();
  const axesToInsert = result.axes.map((axis, i) => {
    const realFamId = famMap.get(axis.familyId) ?? axis.familyId;
    return { ...axis, familyId: realFamId, _idx: i };
  });
  for (const axisData of axesToInsert) {
    const idx = axisData._idx;
    const { _idx, ...insertData } = axisData;
    const [saved] = await createGridAxes([insertData]);
    axisMap.set(String(idx), saved.id);
    if (saved.status === 'NEEDS_REVIEW') needsReviewCount++;
  }

  // ── 4. Markers (FK: axisId → axes, nullable) ──
  const markerMap = new Map<string, string>();
  for (let i = 0; i < result.markers.length; i++) {
    const marker = result.markers[i];
    const realAxisId = marker.axisId ? (axisMap.get(marker.axisId) ?? marker.axisId) : null;
    const [saved] = await createGridMarkers([{ ...marker, axisId: realAxisId }]);
    markerMap.set(String(i), saved.id);
  }

  // ── 5. Labels (FK: markerId → markers, nullable) ──
  const labelMap = new Map<string, string>();
  for (let i = 0; i < result.labels.length; i++) {
    const label = result.labels[i];
    const realMarkerId = label.markerId ? (markerMap.get(label.markerId) ?? label.markerId) : null;
    const [saved] = await createGridLabels([{ ...label, markerId: realMarkerId }]);
    labelMap.set(String(i), saved.id);
  }

  // ── 6. Axis-Label associations (FK: axisId → axes, labelId → labels) ──
  const savedAxisLabels: any[] = [];
  for (const al of result.axisLabels) {
    const realAxisId = axisMap.get(al.axisId) ?? al.axisId;
    const realLabelId = labelMap.get(al.labelId) ?? al.labelId;
    const [saved] = await createGridAxisLabels([{
      ...al,
      axisId: realAxisId,
      labelId: realLabelId,
    }]);
    savedAxisLabels.push(saved);
    if (saved.status === 'NEEDS_REVIEW') needsReviewCount++;
  }

  // ── 7. Nodes (FK: componentId → components) ──
  const nodeMap = new Map<string, string>();
  for (let i = 0; i < result.nodes.length; i++) {
    const node = result.nodes[i];
    const realCompId = compMap.get(node.componentId) ?? node.componentId;
    const [saved] = await createGridNodes([{ ...node, componentId: realCompId }]);
    nodeMap.set(String(i), saved.id);
  }

  // ── 8. Node-Axis links (FK: nodeId → nodes, axisId → axes) ──
  if (result.nodeAxes.length > 0) {
    const remappedLinks = result.nodeAxes.map(na => ({
      ...na,
      nodeId: nodeMap.get(na.nodeId) ?? na.nodeId,
      axisId: axisMap.get(na.axisId) ?? na.axisId,
    }));
    await createGridNodeAxesBatch(remappedLinks);
  }

  // ── 9. Coordinate transform ──
  if (result.transform) {
    await createCoordinateTransform({
      ...result.transform,
      projectId,
    });
  }

  return {
    componentCount: compMap.size,
    familyCount: famMap.size,
    axisCount: axisMap.size,
    nodeCount: nodeMap.size,
    markerCount: markerMap.size,
    labelCount: labelMap.size,
    needsReviewCount,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER — Build Result Object
// ═══════════════════════════════════════════════════════════════════════════════

function buildResult(
  run: GridDetectionRun,
  classification: InputClassification,
  errors: string[],
  warnings: string[],
  startTime: number,
): GridDetectionResult {
  return {
    run,
    classification,
    stats: {
      componentCount: 0,
      familyCount: 0,
      axisCount: 0,
      nodeCount: 0,
      markerCount: 0,
      labelCount: 0,
      needsReviewCount: 0,
    },
    validation: null,
    warnings,
    errors,
    durationMs: Date.now() - startTime,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVENIENCE — Project-Level Grid Queries
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the grid spacing for a project's primary axis families.
 * This is the replacement for the hardcoded 8m default.
 *
 * Returns null if no grid detection has been run or if detection failed.
 * Caller must generate RFI when null is returned.
 */
export async function getProjectGridSpacing(
  projectId: string,
): Promise<{ xSpacing: number | null; ySpacing: number | null } | null> {
  const system = await getProjectGridSystem(projectId);
  if (!system || system.families.length === 0) return null;

  // Convention: family with theta ≈ 0° or 180° is "X" (horizontal)
  //             family with theta ≈ 90° is "Y" (vertical)
  let xSpacing: number | null = null;
  let ySpacing: number | null = null;

  for (const family of system.families) {
    const theta = family.thetaDeg;
    const isHorizontal = theta < 10 || theta > 170;
    const isVertical = theta > 80 && theta < 100;

    if (isHorizontal && family.avgSpacing > 0) {
      xSpacing = family.avgSpacing;
    } else if (isVertical && family.avgSpacing > 0) {
      ySpacing = family.avgSpacing;
    }
  }

  return { xSpacing, ySpacing };
}

/**
 * Check if grid detection is available (any extractors registered).
 */
export function isGridDetectionAvailable(): boolean {
  return extractorRegistry.size > 0;
}

/**
 * Get a human-readable status of grid detection capabilities.
 */
export function getGridDetectionStatus(): {
  available: boolean;
  extractors: Array<{ name: string; types: GridInputType[] }>;
  message: string;
} {
  const extractors = listRegisteredExtractors();
  const available = extractors.length > 0;
  const message = available
    ? `Grid detection available via: ${extractors.map(e => `${e.name} (${e.types.join(', ')})`).join('; ')}`
    : 'Grid detection infrastructure ready. Awaiting format-specific extractors (WP-3: DXF, WP-5: Vector PDF).';

  return { available, extractors, message };
}
