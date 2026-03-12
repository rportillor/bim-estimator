/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  MISSING DATA TRACKER — Cross-Pipeline Gap Aggregation
 *  EstimatorPro v14.35 — Project-agnostic
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Fundamental QS principle: NO DEFAULT VALUES.
 *  When any module in the estimation pipeline encounters missing data, it
 *  registers the gap here instead of using a placeholder.
 *
 *  7 Detection Points (integrated across the pipeline):
 *    1. Document extraction   — missing specs, unclear legends
 *    2. Product mapping       — unresolved spec-to-product references
 *    3. Assembly composition  — incomplete assembly definitions
 *    4. Element generation    — missing dimensions, materials, properties
 *    5. QTO calculation       — missing quantities, measurement rules
 *    6. Cost estimation       — missing rates, missing regional factors
 *    7. Clash detection       — missing clearances, unknown system types
 *
 *  The tracker aggregates gaps from all modules into a single register,
 *  generates formal RFIs, and blocks estimate finalization when critical
 *  gaps remain unresolved.
 *
 *  Consumed by:
 *    construction-workflow-processor.ts  (detection points 1-4)
 *    real-qto-processor.ts              (detection point 5)
 *    clash-detection-engine.ts          (detection point 6)
 *    gap-policy-engine.ts               (SOP-level gap enforcement)
 *    report-generator.ts                (gap summary in reports)
 *    bim-coordination-router.ts         (API endpoint for gap register)
 *
 *  Standards: CIQS Standard Method, ISO 19650-2 (information requirements)
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** The 7 detection points in the estimation pipeline */
export type DetectionPoint =
  | 'DOCUMENT_EXTRACTION'
  | 'PRODUCT_MAPPING'
  | 'ASSEMBLY_COMPOSITION'
  | 'ELEMENT_GENERATION'
  | 'QTO_CALCULATION'
  | 'COST_ESTIMATION'
  | 'CLASH_DETECTION';

/** Severity determines whether the estimate can proceed */
export type GapSeverity =
  | 'CRITICAL'    // Blocks estimate — cannot proceed without this data
  | 'HIGH'        // Degrades accuracy significantly — RFI required
  | 'MEDIUM'      // Affects a subsystem — should be resolved before bid
  | 'LOW';        // Minor detail — can be resolved during construction

/** Current status of the gap */
export type GapStatus =
  | 'OPEN'        // Detected, not yet addressed
  | 'RFI_ISSUED'  // Formal RFI generated
  | 'PENDING'     // Awaiting response
  | 'RESOLVED'    // Data received and applied
  | 'ACCEPTED';   // Accepted as-is (e.g., client confirmed "not applicable")

/** CSI division affected by the gap */
export type CSIDivision = string; // e.g., '03', '05', '07', '26'

/** A single missing data record */
export interface MissingDataItem {
  id: string;
  detectionPoint: DetectionPoint;
  severity: GapSeverity;
  status: GapStatus;
  csiDivision?: CSIDivision;
  discipline?: string;                // ARCH, STRUCT, MECH, ELEC, etc.
  elementId?: string;                 // BIM element that triggered detection
  drawingRef?: string;                // Source drawing (e.g., 'A-201')
  specSection?: string;               // Specification section (e.g., '03 30 00')
  parameter: string;                  // What is missing (e.g., 'concrete_strength')
  description: string;                // Human-readable description
  impact: string;                     // How this affects the estimate
  suggestedAction: string;            // What the user should do
  rfiNumber?: string;                 // If an RFI has been generated
  detectedAt: string;                 // ISO timestamp
  resolvedAt?: string;                // ISO timestamp when resolved
  resolvedValue?: string;             // The value that was provided
  resolvedBy?: string;                // Who provided the data
  floor?: string;                     // Floor/level affected
  location?: string;                  // Spatial location description
}

/** Summary statistics for the gap register */
export interface GapSummary {
  total: number;
  bySeverity: Record<GapSeverity, number>;
  byStatus: Record<GapStatus, number>;
  byDetectionPoint: Record<DetectionPoint, number>;
  byDiscipline: Record<string, number>;
  criticalOpen: number;
  estimateBlocked: boolean;
  completenessPercent: number;
}

/** RFI generated from missing data */
export interface GeneratedRFI {
  rfiNumber: string;
  subject: string;
  description: string;
  discipline: string;
  drawingRef?: string;
  specSection?: string;
  priority: 'URGENT' | 'HIGH' | 'NORMAL';
  relatedGapIds: string[];
  generatedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TRACKER CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * MissingDataTracker — singleton per project estimation session.
 *
 * Create one instance per estimation run. All pipeline modules register
 * their gaps here. At the end, query the register for RFI generation
 * and estimate confidence assessment.
 */
export class MissingDataTracker {
  // ─── Static Project Registry ────────────────────────────────────────────
  // Stores one tracker instance per project for cross-module access.
  // Pattern matches estimate-workflow.ts (versionStore, bidderStore).
  private static registry = new Map<string, MissingDataTracker>();

  /**
   * Get or create a tracker for the given project.
   * Reuses existing instance if one exists for this project.
   */
  static getOrCreate(projectId: string, sessionId?: string): MissingDataTracker {
    const existing = MissingDataTracker.registry.get(projectId);
    if (existing) return existing;
    const tracker = new MissingDataTracker(projectId, sessionId);
    MissingDataTracker.registry.set(projectId, tracker);
    return tracker;
  }

  /** Retrieve the tracker for a project (undefined if no estimation has run). */
  static getForProject(projectId: string): MissingDataTracker | undefined {
    return MissingDataTracker.registry.get(projectId);
  }

  /** Remove a project's tracker from the registry (e.g., after export/cleanup). */
  static removeFromRegistry(projectId: string): boolean {
    return MissingDataTracker.registry.delete(projectId);
  }

  /** List all project IDs with active trackers. */
  static getActiveProjects(): string[] {
    return Array.from(MissingDataTracker.registry.keys());
  }

  // ─── Instance Properties ────────────────────────────────────────────────
  private items: Map<string, MissingDataItem> = new Map();
  private rfiCounter: number = 0;
  private readonly projectId: string;
  private readonly sessionId: string;

  constructor(projectId: string, sessionId?: string) {
    this.projectId = projectId;
    this.sessionId = sessionId || `EST-${Date.now()}`;
    // Auto-register in the static registry
    MissingDataTracker.registry.set(projectId, this);
  }

  // ─── Registration ───────────────────────────────────────────────────────

  /**
   * Register a missing data item from any detection point.
   * Returns the generated gap ID.
   */
  register(item: Omit<MissingDataItem, 'id' | 'status' | 'detectedAt'>): string {
    const id = `GAP-${this.projectId}-${String(this.items.size + 1).padStart(4, '0')}`;
    const record: MissingDataItem = {
      ...item,
      id,
      status: 'OPEN',
      detectedAt: new Date().toISOString(),
    };
    this.items.set(id, record);
    return id;
  }

  /**
   * Register missing data from document extraction (Detection Point 1).
   */
  registerDocumentGap(params: {
    drawingRef: string;
    parameter: string;
    description: string;
    severity?: GapSeverity;
    discipline?: string;
  }): string {
    return this.register({
      detectionPoint: 'DOCUMENT_EXTRACTION',
      severity: params.severity || 'HIGH',
      drawingRef: params.drawingRef,
      discipline: params.discipline,
      parameter: params.parameter,
      description: params.description,
      impact: `Cannot extract ${params.parameter} from ${params.drawingRef}`,
      suggestedAction: `Verify ${params.parameter} on drawing ${params.drawingRef} or issue RFI to design team`,
    });
  }

  /**
   * Register missing data from product mapping (Detection Point 2).
   */
  registerProductGap(params: {
    specSection: string;
    parameter: string;
    description: string;
    severity?: GapSeverity;
  }): string {
    return this.register({
      detectionPoint: 'PRODUCT_MAPPING',
      severity: params.severity || 'HIGH',
      specSection: params.specSection,
      parameter: params.parameter,
      description: params.description,
      impact: `Cannot map specification ${params.specSection} to a product`,
      suggestedAction: `Check specification section ${params.specSection} for product details or contact specifier`,
    });
  }

  /**
   * Register missing data from assembly composition (Detection Point 3).
   */
  registerAssemblyGap(params: {
    elementId?: string;
    csiDivision?: string;
    parameter: string;
    description: string;
    severity?: GapSeverity;
  }): string {
    return this.register({
      detectionPoint: 'ASSEMBLY_COMPOSITION',
      severity: params.severity || 'MEDIUM',
      elementId: params.elementId,
      csiDivision: params.csiDivision,
      parameter: params.parameter,
      description: params.description,
      impact: `Incomplete assembly — ${params.parameter} unknown`,
      suggestedAction: `Provide ${params.parameter} from construction details or typical practice`,
    });
  }

  /**
   * Register missing data from element generation (Detection Point 4).
   */
  registerElementGap(params: {
    elementId: string;
    parameter: string;
    description: string;
    floor?: string;
    severity?: GapSeverity;
    discipline?: string;
  }): string {
    return this.register({
      detectionPoint: 'ELEMENT_GENERATION',
      severity: params.severity || 'HIGH',
      elementId: params.elementId,
      discipline: params.discipline,
      floor: params.floor,
      parameter: params.parameter,
      description: params.description,
      impact: `BIM element ${params.elementId} missing ${params.parameter}`,
      suggestedAction: `Check drawings for ${params.parameter} or request from design team`,
    });
  }

  /**
   * Register missing data from QTO calculation (Detection Point 5).
   */
  registerQTOGap(params: {
    elementId?: string;
    csiDivision?: string;
    parameter: string;
    description: string;
    severity?: GapSeverity;
  }): string {
    return this.register({
      detectionPoint: 'QTO_CALCULATION',
      severity: params.severity || 'HIGH',
      elementId: params.elementId,
      csiDivision: params.csiDivision,
      parameter: params.parameter,
      description: params.description,
      impact: `Cannot calculate quantity — ${params.parameter} missing`,
      suggestedAction: `Provide ${params.parameter} for accurate takeoff`,
    });
  }

  /**
   * Register missing data from cost estimation (Detection Point 6).
   */
  registerCostGap(params: {
    csiDivision: string;
    parameter: string;
    description: string;
    severity?: GapSeverity;
  }): string {
    return this.register({
      detectionPoint: 'COST_ESTIMATION',
      severity: params.severity || 'MEDIUM',
      csiDivision: params.csiDivision,
      parameter: params.parameter,
      description: params.description,
      impact: `Cost estimate for CSI ${params.csiDivision} is unreliable — ${params.parameter} missing`,
      suggestedAction: `Verify ${params.parameter} against current market rates or RSMeans data`,
    });
  }

  /**
   * Register missing data from clash detection (Detection Point 7).
   */
  registerClashGap(params: {
    elementId?: string;
    parameter: string;
    description: string;
    discipline?: string;
    severity?: GapSeverity;
  }): string {
    return this.register({
      detectionPoint: 'CLASH_DETECTION',
      severity: params.severity || 'HIGH',
      elementId: params.elementId,
      discipline: params.discipline,
      parameter: params.parameter,
      description: params.description,
      impact: `Clash detection incomplete — ${params.parameter} not available`,
      suggestedAction: `Provide ${params.parameter} from project specifications or design team`,
    });
  }

  // ─── Resolution ─────────────────────────────────────────────────────────

  /**
   * Resolve a gap with the provided value.
   */
  resolve(gapId: string, value: string, resolvedBy: string = 'user'): boolean {
    const item = this.items.get(gapId);
    if (!item) return false;

    item.status = 'RESOLVED';
    item.resolvedAt = new Date().toISOString();
    item.resolvedValue = value;
    item.resolvedBy = resolvedBy;
    return true;
  }

  /**
   * Accept a gap as-is (not applicable or deferred).
   */
  accept(gapId: string, reason: string): boolean {
    const item = this.items.get(gapId);
    if (!item) return false;

    item.status = 'ACCEPTED';
    item.resolvedAt = new Date().toISOString();
    item.resolvedValue = `ACCEPTED: ${reason}`;
    item.resolvedBy = 'user';
    return true;
  }

  /**
   * Mark a gap as having an RFI issued.
   */
  markRFIIssued(gapId: string, rfiNumber: string): boolean {
    const item = this.items.get(gapId);
    if (!item) return false;

    item.status = 'RFI_ISSUED';
    item.rfiNumber = rfiNumber;
    return true;
  }

  // ─── Queries ────────────────────────────────────────────────────────────

  /** Get all items */
  getAll(): MissingDataItem[] {
    return Array.from(this.items.values());
  }

  /** Get items by detection point */
  getByDetectionPoint(point: DetectionPoint): MissingDataItem[] {
    return this.getAll().filter(i => i.detectionPoint === point);
  }

  /** Get items by severity */
  getBySeverity(severity: GapSeverity): MissingDataItem[] {
    return this.getAll().filter(i => i.severity === severity);
  }

  /** Get all open items (not resolved or accepted) */
  getOpen(): MissingDataItem[] {
    return this.getAll().filter(i => i.status === 'OPEN' || i.status === 'RFI_ISSUED' || i.status === 'PENDING');
  }

  /** Get critical open items that block the estimate */
  getCriticalOpen(): MissingDataItem[] {
    return this.getOpen().filter(i => i.severity === 'CRITICAL');
  }

  /** Check whether the estimate is blocked by critical gaps */
  isEstimateBlocked(): boolean {
    return this.getCriticalOpen().length > 0;
  }

  /** Get a single item by ID */
  get(gapId: string): MissingDataItem | undefined {
    return this.items.get(gapId);
  }

  /** Total count */
  get size(): number {
    return this.items.size;
  }

  // ─── Summary ────────────────────────────────────────────────────────────

  /**
   * Generate a summary of the gap register.
   */
  getSummary(): GapSummary {
    const all = this.getAll();
    const bySeverity: Record<GapSeverity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    const byStatus: Record<GapStatus, number> = { OPEN: 0, RFI_ISSUED: 0, PENDING: 0, RESOLVED: 0, ACCEPTED: 0 };
    const byDetectionPoint: Record<DetectionPoint, number> = {
      DOCUMENT_EXTRACTION: 0, PRODUCT_MAPPING: 0, ASSEMBLY_COMPOSITION: 0,
      ELEMENT_GENERATION: 0, QTO_CALCULATION: 0, COST_ESTIMATION: 0, CLASH_DETECTION: 0,
    };
    const byDiscipline: Record<string, number> = {};

    for (const item of all) {
      bySeverity[item.severity]++;
      byStatus[item.status]++;
      byDetectionPoint[item.detectionPoint]++;
      if (item.discipline) {
        byDiscipline[item.discipline] = (byDiscipline[item.discipline] || 0) + 1;
      }
    }

    const resolved = byStatus.RESOLVED + byStatus.ACCEPTED;
    const completeness = all.length > 0 ? Math.round((resolved / all.length) * 100) : 100;

    return {
      total: all.length,
      bySeverity,
      byStatus,
      byDetectionPoint,
      byDiscipline,
      criticalOpen: this.getCriticalOpen().length,
      estimateBlocked: this.isEstimateBlocked(),
      completenessPercent: completeness,
    };
  }

  // ─── RFI Generation ─────────────────────────────────────────────────────

  /**
   * Generate formal RFIs from open gaps, grouped by discipline/drawing.
   * Groups related gaps into a single RFI where possible.
   */
  generateRFIs(): GeneratedRFI[] {
    const openGaps = this.getOpen().filter(g => !g.rfiNumber);
    if (openGaps.length === 0) return [];

    // Group by discipline + drawing
    const groups = new Map<string, MissingDataItem[]>();
    for (const gap of openGaps) {
      const key = `${gap.discipline || 'GENERAL'}_${gap.drawingRef || gap.specSection || 'UNREF'}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(gap);
    }

    const rfis: GeneratedRFI[] = [];
    for (const [, gaps] of groups) {
      this.rfiCounter++;
      const rfiNum = `RFI-${this.projectId}-${String(this.rfiCounter).padStart(3, '0')}`;
      const first = gaps[0];

      const priority: GeneratedRFI['priority'] = gaps.some(g => g.severity === 'CRITICAL')
        ? 'URGENT'
        : gaps.some(g => g.severity === 'HIGH')
          ? 'HIGH'
          : 'NORMAL';

      const description = gaps
        .map(g => `• ${g.parameter}: ${g.description}`)
        .join('\n');

      const rfi: GeneratedRFI = {
        rfiNumber: rfiNum,
        subject: `Missing Data — ${first.discipline || 'General'} ${first.drawingRef || first.specSection || ''}`.trim(),
        description: `The following data is required for accurate estimation:\n\n${description}`,
        discipline: first.discipline || 'GENERAL',
        drawingRef: first.drawingRef,
        specSection: first.specSection,
        priority,
        relatedGapIds: gaps.map(g => g.id),
        generatedAt: new Date().toISOString(),
      };

      rfis.push(rfi);

      // Mark all gaps as RFI issued
      for (const gap of gaps) {
        this.markRFIIssued(gap.id, rfiNum);
      }
    }

    return rfis;
  }

  // ─── Serialization ──────────────────────────────────────────────────────

  /** Export the full register for persistence or reporting */
  toJSON(): {
    projectId: string;
    sessionId: string;
    items: MissingDataItem[];
    summary: GapSummary;
  } {
    return {
      projectId: this.projectId,
      sessionId: this.sessionId,
      items: this.getAll(),
      summary: this.getSummary(),
    };
  }

  /** Import previously saved items (e.g., from database) */
  loadItems(items: MissingDataItem[]): void {
    for (const item of items) {
      this.items.set(item.id, item);
    }
  }

  /** Clear all items (for re-estimation) */
  clear(): void {
    this.items.clear();
    this.rfiCounter = 0;
  }
}
