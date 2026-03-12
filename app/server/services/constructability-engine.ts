/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CONSTRUCTABILITY ENGINE — SOP Part 6.1, 6.3
 *  Phase 4 — Constructability & 4D Sequencing
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Analyses project documents and model data to produce constructability
 *  intelligence: work area definitions, access constraints, temporary works
 *  register, trade dependency matrix, and safety/clearance checks.
 *
 *  SOP Part 6.1 requirements:
 *    - Work areas/workfaces by level/zone/grid
 *    - Access and material handling constraints
 *    - Temporary works register (scaffold, shoring, temp power, etc.)
 *    - Trade dependency matrix (predecessor/successor, hold points)
 *    - Safety and clearance issues
 *
 *  SOP Part 6.3 rule: Do NOT assume or invent data.
 *    If clearances, access routes, or temp works requirements are not
 *    explicitly stated in documents, flag as GAP.
 *
 *  Consumes from types.ts:
 *    WorkArea, TempWorksItem, TradeDependency, Gap, GapType,
 *    Discipline, EvidenceReference, ConstraintRow
 *
 *  Consumes from prompt-library.ts:
 *    ConstructabilityParams, getConstructabilityPrompt
 *
 *  Consumes from extraction-checklists.ts:
 *    getAllConstraints, getAllSystems
 *
 *  Consumed by:
 *    sequencing-4d.ts (trade dependencies feed sequencing)
 *    clash-engine.ts (clearance zones for access tests)
 *    report-generator.ts (future — constructability summary)
 *
 *  @module constructability-engine
 *  @version 1.0.0
 */

import type {
  WorkArea,
  TempWorksItem,
  TradeDependency,
  Gap,
  GapType,
  Discipline,
  EvidenceReference,
  ConstraintRow,
} from './types';
import { formatEvidenceRef } from './types';
import type { ConstructabilityParams } from './prompt-library';
import { getConstructabilityPrompt } from './prompt-library';
import { getAllConstraints, getAllSystems } from './extraction-checklists';


// ═══════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** Complete constructability analysis for a project */
export interface ConstructabilityAnalysis {
  projectId: string;
  timestamp: string;

  /** Work area definitions (SOP 6.1) */
  workAreas: WorkArea[];

  /** Temporary works register (SOP 6.1) */
  tempWorks: TempWorksItem[];

  /** Trade dependency matrix (SOP 6.1) */
  tradeDependencies: TradeDependency[];

  /** Safety/clearance issues identified */
  safetyIssues: SafetyIssue[];

  /** Gaps found during analysis */
  gaps: Gap[];

  /** AI prompt used (audit trail) */
  promptUsed?: string;
}

/** A safety or clearance issue per SOP Part 6.1 */
export interface SafetyIssue {
  id: string;
  category: 'headroom' | 'electrical_clearance' | 'egress' | 'fall_protection' | 'confined_space' | 'fire_separation' | 'other';
  description: string;
  location: string;
  severity: 'critical' | 'major' | 'minor';
  affectedTrades: string[];
  codeReference?: string;
  evidenceRef?: EvidenceReference;
  resolution?: string;
}

/** Access route analysis */
export interface AccessRoute {
  id: string;
  from: string;
  to: string;
  routeType: 'material_delivery' | 'personnel' | 'equipment' | 'emergency';
  clearanceRequired: { width: number; height: number; units: string };
  obstructions: string[];
  isViable: boolean;
  evidenceRef?: EvidenceReference;
}

/** Material handling constraint */
export interface MaterialHandlingConstraint {
  id: string;
  material: string;
  deliveryMethod: string;
  liftingRequirement?: string;
  laydownArea?: string;
  accessRoute?: string;
  constraints: string[];
  evidenceRef?: EvidenceReference;
}

/** Constructability validation result */
export interface ConstructabilityValidation {
  isComplete: boolean;
  workAreaCount: number;
  tempWorksCount: number;
  dependencyCount: number;
  safetyIssueCount: number;
  gapCount: number;
  coverage: {
    workAreasDefined: boolean;
    tempWorksAssessed: boolean;
    dependenciesMapped: boolean;
    safetyReviewed: boolean;
    accessRoutesDefined: boolean;
  };
  missingItems: string[];
}


// ═══════════════════════════════════════════════════════════════════════════════
//  ANALYSIS STORE
// ═══════════════════════════════════════════════════════════════════════════════

const analyses = new Map<string, ConstructabilityAnalysis>();

/**
 * Get constructability analysis for a project.
 */
export function getAnalysis(projectId: string): ConstructabilityAnalysis | undefined {
  return analyses.get(projectId);
}

/**
 * Store constructability analysis for a project.
 */
export function storeAnalysis(analysis: ConstructabilityAnalysis): ConstructabilityAnalysis {
  analyses.set(analysis.projectId, analysis);
  return analysis;
}

/**
 * Delete analysis (for testing / reset).
 */
export function deleteAnalysis(projectId: string): boolean {
  return analyses.delete(projectId);
}


// ═══════════════════════════════════════════════════════════════════════════════
//  WORK AREA MANAGEMENT — SOP Part 6.1
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create an empty constructability analysis.
 */
export function createEmptyAnalysis(projectId: string): ConstructabilityAnalysis {
  return {
    projectId,
    timestamp: new Date().toISOString(),
    workAreas: [],
    tempWorks: [],
    tradeDependencies: [],
    safetyIssues: [],
    gaps: [],
  };
}

/**
 * Add a work area to the analysis.
 *
 * SOP Part 6.1: Work areas must reference level, zone, and grid bounds.
 * Access routes and material handling must be documented — GAP if missing.
 */
export function addWorkArea(
  analysis: ConstructabilityAnalysis,
  area: WorkArea,
): { added: boolean; gaps: Gap[] } {
  const gaps: Gap[] = [];

  if (!area.accessRoutes || area.accessRoutes.length === 0) {
    gaps.push(makeGap(
      `WA-ACCESS-${area.id}`,
      'PARAMETER_MISSING',
      'accessRoutes',
      `Work area "${area.name}" (${area.level}/${area.zone}) has no access routes defined. Construction traffic and material delivery cannot be planned.`,
      'high',
      'SOP Part 6.1 — Work Area Access',
    ));
  }

  if (!area.materialHandling || area.materialHandling.length === 0) {
    gaps.push(makeGap(
      `WA-MATL-${area.id}`,
      'PARAMETER_MISSING',
      'materialHandling',
      `Work area "${area.name}" has no material handling requirements. Lifting, laydown, and staging not specified.`,
      'medium',
      'SOP Part 6.1 — Material Handling',
    ));
  }

  analysis.workAreas.push(area);
  analysis.gaps.push(...gaps);
  return { added: true, gaps };
}

/**
 * Get work areas for a specific level.
 */
export function getWorkAreasByLevel(
  analysis: ConstructabilityAnalysis,
  level: string,
): WorkArea[] {
  return analysis.workAreas.filter(wa => wa.level === level);
}

/**
 * Get all unique levels from work areas.
 */
export function getWorkAreaLevels(analysis: ConstructabilityAnalysis): string[] {
  return [...new Set(analysis.workAreas.map(wa => wa.level))];
}


// ═══════════════════════════════════════════════════════════════════════════════
//  TEMPORARY WORKS REGISTER — SOP Part 6.1
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Add a temporary works item.
 *
 * SOP Part 6.1: Temp works must have location, duration, and prerequisite.
 * If any are missing, GAP is flagged (per SOP 6.3 — no inventing data).
 */
export function addTempWorks(
  analysis: ConstructabilityAnalysis,
  item: TempWorksItem,
): { added: boolean; gaps: Gap[] } {
  const gaps: Gap[] = [];

  if (!item.duration || item.duration === '') {
    gaps.push(makeGap(
      `TW-DUR-${item.id}`,
      'PARAMETER_MISSING',
      'duration',
      `Temp works "${item.description}" (${item.type}) at ${item.location} — duration not stated. Cannot schedule removal.`,
      'medium',
      'SOP Part 6.1 — Temporary Works Duration',
    ));
  }

  if (!item.prerequisite || item.prerequisite === '') {
    gaps.push(makeGap(
      `TW-PREREQ-${item.id}`,
      'PARAMETER_MISSING',
      'prerequisite',
      `Temp works "${item.description}" — prerequisite activity not identified.`,
      'low',
      'SOP Part 6.1 — Temporary Works Prerequisites',
    ));
  }

  analysis.tempWorks.push(item);
  analysis.gaps.push(...gaps);
  return { added: true, gaps };
}

/**
 * Get temporary works by type.
 */
export function getTempWorksByType(
  analysis: ConstructabilityAnalysis,
  type: TempWorksItem['type'],
): TempWorksItem[] {
  return analysis.tempWorks.filter(tw => tw.type === type);
}

/**
 * Get temporary works for a specific location.
 */
export function getTempWorksByLocation(
  analysis: ConstructabilityAnalysis,
  location: string,
): TempWorksItem[] {
  const loc = location.toLowerCase();
  return analysis.tempWorks.filter(tw => tw.location.toLowerCase().includes(loc));
}


// ═══════════════════════════════════════════════════════════════════════════════
//  TRADE DEPENDENCY MATRIX — SOP Part 6.1
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Add a trade dependency to the matrix.
 *
 * SOP Part 6.1: Dependencies must capture predecessor/successor,
 * hold points, and inspection requirements.
 */
export function addTradeDependency(
  analysis: ConstructabilityAnalysis,
  dep: TradeDependency,
): { added: boolean; duplicate: boolean } {
  // Check for duplicate
  const exists = analysis.tradeDependencies.some(d =>
    d.predecessorTrade === dep.predecessorTrade &&
    d.successorTrade === dep.successorTrade &&
    d.dependencyType === dep.dependencyType
  );
  if (exists) return { added: false, duplicate: true };

  analysis.tradeDependencies.push(dep);
  return { added: true, duplicate: false };
}

/**
 * Get all dependencies for a specific trade (as predecessor or successor).
 */
export function getDependenciesForTrade(
  analysis: ConstructabilityAnalysis,
  trade: string,
): { asPredecessor: TradeDependency[]; asSuccessor: TradeDependency[] } {
  return {
    asPredecessor: analysis.tradeDependencies.filter(d => d.predecessorTrade === trade),
    asSuccessor: analysis.tradeDependencies.filter(d => d.successorTrade === trade),
  };
}

/**
 * Get all hold points in the dependency matrix.
 */
export function getHoldPoints(analysis: ConstructabilityAnalysis): TradeDependency[] {
  return analysis.tradeDependencies.filter(d => d.holdPoint);
}

/**
 * Get all inspection-required dependencies.
 */
export function getInspectionPoints(analysis: ConstructabilityAnalysis): TradeDependency[] {
  return analysis.tradeDependencies.filter(d => d.inspectionRequired);
}

/**
 * Get all unique trades in the dependency matrix.
 */
export function listTrades(analysis: ConstructabilityAnalysis): string[] {
  const trades = new Set<string>();
  for (const d of analysis.tradeDependencies) {
    trades.add(d.predecessorTrade);
    trades.add(d.successorTrade);
  }
  return [...trades].sort();
}

/**
 * Build a topological sort of trades (execution order).
 * Returns trades in dependency order. Circular dependencies flagged as GAPs.
 */
export function buildTradeExecutionOrder(
  analysis: ConstructabilityAnalysis,
): { order: string[]; circularDependencies: string[][] } {
  const trades = listTrades(analysis);
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const trade of trades) {
    inDegree.set(trade, 0);
    adjacency.set(trade, []);
  }

  for (const dep of analysis.tradeDependencies) {
    if (dep.dependencyType === 'finish_to_start') {
      adjacency.get(dep.predecessorTrade)?.push(dep.successorTrade);
      inDegree.set(dep.successorTrade, (inDegree.get(dep.successorTrade) ?? 0) + 1);
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [trade, degree] of inDegree) {
    if (degree === 0) queue.push(trade);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const next of (adjacency.get(current) ?? [])) {
      const newDegree = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDegree);
      if (newDegree === 0) queue.push(next);
    }
  }

  // If not all trades are in order, there's a circular dependency
  const circularDependencies: string[][] = [];
  if (order.length < trades.length) {
    const remaining = trades.filter(t => !order.includes(t));
    circularDependencies.push(remaining);

    analysis.gaps.push(makeGap(
      'TRADE-CIRCULAR',
      'missing_detail',
      'tradeDependencies',
      `Circular dependency detected among trades: ${remaining.join(', ')}. Cannot determine execution order.`,
      'high',
      'SOP Part 6.1 — Trade Dependency Matrix',
    ));
  }

  return { order, circularDependencies };
}


// ═══════════════════════════════════════════════════════════════════════════════
//  SAFETY / CLEARANCE CHECKS — SOP Part 6.1
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Add a safety issue to the analysis.
 */
export function addSafetyIssue(
  analysis: ConstructabilityAnalysis,
  issue: SafetyIssue,
): SafetyIssue {
  analysis.safetyIssues.push(issue);
  return issue;
}

/**
 * Get safety issues by severity.
 */
export function getSafetyIssuesBySeverity(
  analysis: ConstructabilityAnalysis,
  severity: SafetyIssue['severity'],
): SafetyIssue[] {
  return analysis.safetyIssues.filter(i => i.severity === severity);
}

/**
 * Get safety issues by category.
 */
export function getSafetyIssuesByCategory(
  analysis: ConstructabilityAnalysis,
  category: SafetyIssue['category'],
): SafetyIssue[] {
  return analysis.safetyIssues.filter(i => i.category === category);
}

/**
 * Run standard safety checks against known constraints.
 *
 * Checks extraction-checklists constraints for safety-related items
 * and generates safety issues where clearances are undefined.
 *
 * SOP Part 6.3: Do NOT assume clearance values — GAP if not stated.
 */
export function runSafetyChecks(
  analysis: ConstructabilityAnalysis,
  projectId: string,
): SafetyIssue[] {
  const newIssues: SafetyIssue[] = [];
  const constraints = getAllConstraints(projectId);
  let counter = 0;

  const nextId = (): string => {
    counter++;
    return `SAFETY-${String(counter).padStart(3, '0')}`;
  };

  // Check for safety-typed constraints without resolution
  for (const constraint of constraints) {
    if (constraint.type === 'safety') {
      const issue: SafetyIssue = {
        id: nextId(),
        category: 'other',
        description: `Safety constraint: ${constraint.description}`,
        location: constraint.affectedScope,
        severity: 'major',
        affectedTrades: [],
        evidenceRef: constraint.evidenceRef,
      };
      newIssues.push(issue);
    }
  }

  // Check work areas for missing access routes (fire/egress concern)
  for (const wa of analysis.workAreas) {
    if (wa.accessRoutes.length === 0) {
      newIssues.push({
        id: nextId(),
        category: 'egress',
        description: `Work area "${wa.name}" has no defined access routes — egress path not verified.`,
        location: `${wa.level}/${wa.zone}`,
        severity: 'critical',
        affectedTrades: ['All'],
        evidenceRef: wa.evidenceRef,
      });
    }
  }

  // Check for electrical systems without clearance zones
  const systems = getAllSystems(projectId);
  const electricalSystems = systems.filter(s =>
    s.discipline === 'ELEC' ||
    s.system.toLowerCase().includes('electrical') ||
    s.system.toLowerCase().includes('panel') ||
    s.system.toLowerCase().includes('transformer')
  );

  for (const sys of electricalSystems) {
    // If no clearance mentioned in key parameters, flag
    const hasClr = sys.keyParameters.toLowerCase().includes('clearance') ||
                   sys.keyParameters.toLowerCase().includes('working space');
    if (!hasClr) {
      newIssues.push({
        id: nextId(),
        category: 'electrical_clearance',
        description: `Electrical system "${sys.tag}" (${sys.system}) — working clearance not documented. CEC/NEC requires minimum working space.`,
        location: sys.location,
        severity: 'major',
        affectedTrades: ['Electrical', 'General'],
        codeReference: 'CEC Section 2-308 / NEC Article 110.26',
        evidenceRef: sys.evidenceRef,
      });

      analysis.gaps.push(makeGap(
        `SAFETY-ELEC-CLR-${sys.tag}`,
        'missing_clearance',
        'electricalClearance',
        `Electrical working clearance for "${sys.tag}" not defined in documents. Per CEC/NEC requires minimum clearance for safe operation and maintenance.`,
        'high',
        'SOP Part 6.3 — No assumed clearances',
      ));
    }
  }

  analysis.safetyIssues.push(...newIssues);
  return newIssues;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  PROMPT GENERATION — SOP Part 3 integration
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate the AI prompt for constructability analysis.
 * Wraps prompt-library Prompt 3.3 with project-specific context.
 */
export function generateConstructabilityPrompt(
  params: ConstructabilityParams,
  analysis?: ConstructabilityAnalysis,
): string {
  const contextParts: string[] = [];

  if (analysis) {
    contextParts.push(
      `Existing analysis: ${analysis.workAreas.length} work areas, ` +
      `${analysis.tempWorks.length} temp works items, ` +
      `${analysis.tradeDependencies.length} trade dependencies, ` +
      `${analysis.safetyIssues.length} safety issues, ` +
      `${analysis.gaps.length} gaps`
    );
  }

  if (params.siteConstraints && params.siteConstraints.length > 0) {
    contextParts.push(`Site constraints: ${params.siteConstraints.join('; ')}`);
  }

  const enrichedParams: ConstructabilityParams = {
    ...params,
    additionalContext: [
      params.additionalContext ?? '',
      ...contextParts,
    ].filter(Boolean).join('\n'),
  };

  return getConstructabilityPrompt(enrichedParams);
}


// ═══════════════════════════════════════════════════════════════════════════════
//  VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate the completeness of a constructability analysis.
 */
export function validateAnalysis(
  analysis: ConstructabilityAnalysis,
): ConstructabilityValidation {
  const missingItems: string[] = [];

  const workAreasDefined = analysis.workAreas.length > 0;
  const tempWorksAssessed = analysis.tempWorks.length > 0;
  const dependenciesMapped = analysis.tradeDependencies.length > 0;
  const safetyReviewed = analysis.safetyIssues.length > 0 ||
    analysis.gaps.some(g => g.parameterName.includes('safety') || g.parameterName.includes('clearance'));
  const accessRoutesDefined = analysis.workAreas.some(wa => wa.accessRoutes.length > 0);

  if (!workAreasDefined) missingItems.push('No work areas defined');
  if (!tempWorksAssessed) missingItems.push('Temporary works register empty');
  if (!dependenciesMapped) missingItems.push('Trade dependency matrix empty');
  if (!safetyReviewed) missingItems.push('Safety review not performed');
  if (!accessRoutesDefined) missingItems.push('No access routes defined for any work area');

  return {
    isComplete: missingItems.length === 0,
    workAreaCount: analysis.workAreas.length,
    tempWorksCount: analysis.tempWorks.length,
    dependencyCount: analysis.tradeDependencies.length,
    safetyIssueCount: analysis.safetyIssues.length,
    gapCount: analysis.gaps.length,
    coverage: {
      workAreasDefined,
      tempWorksAssessed,
      dependenciesMapped,
      safetyReviewed,
      accessRoutesDefined,
    },
    missingItems,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
//  SUMMARY / REPORT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a text summary for meeting packs / dashboards.
 */
export function formatConstructabilitySummary(projectId: string): string {
  const analysis = analyses.get(projectId);
  if (!analysis) return `No constructability analysis for project ${projectId}.`;

  const validation = validateAnalysis(analysis);
  const tradeOrder = buildTradeExecutionOrder(analysis);

  const lines: string[] = [
    `CONSTRUCTABILITY ANALYSIS — Project ${projectId}`,
    `Last updated: ${analysis.timestamp}`,
    '',
    `Work Areas:         ${analysis.workAreas.length}`,
    `Temporary Works:    ${analysis.tempWorks.length}`,
    `Trade Dependencies: ${analysis.tradeDependencies.length}`,
    `Safety Issues:      ${analysis.safetyIssues.length}`,
    `Gaps:               ${analysis.gaps.length}`,
    '',
  ];

  // Work areas by level
  const levels = getWorkAreaLevels(analysis);
  if (levels.length > 0) {
    lines.push('WORK AREAS BY LEVEL:');
    for (const level of levels) {
      const areas = getWorkAreasByLevel(analysis, level);
      lines.push(`  ${level}: ${areas.map(a => a.name).join(', ')}`);
    }
    lines.push('');
  }

  // Trade execution order
  if (tradeOrder.order.length > 0) {
    lines.push('TRADE EXECUTION ORDER:');
    tradeOrder.order.forEach((trade, i) => {
      lines.push(`  ${i + 1}. ${trade}`);
    });
    if (tradeOrder.circularDependencies.length > 0) {
      lines.push(`  ⚠ CIRCULAR: ${tradeOrder.circularDependencies.map(c => c.join(', ')).join(' | ')}`);
    }
    lines.push('');
  }

  // Hold points
  const holds = getHoldPoints(analysis);
  if (holds.length > 0) {
    lines.push(`HOLD POINTS (${holds.length}):`);
    for (const h of holds) {
      lines.push(`  ${h.predecessorTrade} → ${h.successorTrade}: ${h.description}`);
    }
    lines.push('');
  }

  // Critical safety issues
  const critical = getSafetyIssuesBySeverity(analysis, 'critical');
  if (critical.length > 0) {
    lines.push(`CRITICAL SAFETY ISSUES (${critical.length}):`);
    for (const s of critical) {
      lines.push(`  [${s.id}] ${s.category} — ${s.description}`);
    }
    lines.push('');
  }

  // Gaps
  if (analysis.gaps.length > 0) {
    lines.push(`GAPS (${analysis.gaps.length}):`);
    for (const g of analysis.gaps) {
      lines.push(`  [${g.id}] ${g.type} — ${g.description}`);
    }
  }

  return lines.join('\n');
}


// ═══════════════════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function makeGap(
  id: string,
  type: GapType,
  parameterName: string,
  description: string,
  impact: Gap['impact'],
  sopReference: string,
): Gap {
  return {
    id,
    type,
    parameterName,
    affectedCount: 0,
    discipline: 'ARC',
    description,
    impact,
    sopReference,
  };
}
