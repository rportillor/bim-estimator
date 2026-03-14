/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  QTO QA ENGINE — SOP Part 5
 *  Model QTO Extraction and Quality Assurance
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Implements SOP Part 5 — Model QTO SOP (IFC/Revit-based Extraction and QA).
 *
 *  Capabilities:
 *    5.1 Extraction Outputs:
 *      - Element index (ID, category, family/type, tag, level, workset, host, system)
 *      - Category and type rollups (counts, quantities, units)
 *      - Materials table (compound layers, thickness)
 *      - Hosted dependencies (orphan detection)
 *      - MEP connectivity summary (unconnected connectors, system naming)
 *
 *    5.2 QA Rules (mandatory, do not skip):
 *      - Rule 1: ID stability (IFC GUID / Revit UniqueId stable across drops)
 *      - Rule 2: Level assignment (elements missing level → flagged)
 *      - Rule 3: SystemType/Service metadata (MEP without system → flagged)
 *      - Rule 4: Placeholder material detection (By Category/Default → flagged)
 *      - Rule 5: Orphan detection (hosted elements with missing host IDs)
 *      - Rule 6: MEP connectivity (unconnected connectors)
 *
 *    5.3 QTO Maturity Scoring:
 *      - % completeness by category (level, system, material, size, location)
 *      - If critical params missing → quantities reported as counts only
 *
 *  Dependencies:
 *    - types.ts (CoordinationElement, Gap, EvidenceReference, Discipline, etc.)
 *    - prompt-library.ts (Prompt 3.2 for AI-assisted QTO)
 *
 *  @module qto-qa-engine
 *  @version 1.0.0
 *  @sopPart 5
 */

import type {
  CoordinationElement,
  ConnectorInfo,
  Discipline,
  Gap,
  EvidenceReference,
} from '../bim-coordination/types';
import type { ModelQTOParams } from './prompt-library';
import { getModelQTOPrompt } from './prompt-library';

// ─── Result Interfaces ──────────────────────────────────────────────────────

/** Complete QTO extraction result — everything SOP 5.1 requires */
export interface QTOExtractionResult {
  modelId: string;
  modelVersion: string;
  extractionTimestamp: string;
  elementCount: number;

  /** 5.1 — Element index */
  elementIndex: ElementIndexEntry[];

  /** 5.1 — Category/type rollups */
  categoryRollups: CategoryRollup[];

  /** 5.1 — Materials table */
  materialsTable: MaterialEntry[];

  /** 5.1 — Hosted dependencies */
  hostedDependencies: HostedDependency[];

  /** 5.1 — MEP connectivity summary */
  mepConnectivity: MEPConnectivityEntry[];

  /** 5.2 — QA rule results */
  qaResults: QARuleResults;

  /** 5.3 — Maturity scoring */
  maturityScores: MaturityScore[];
  overallMaturity: number;

  /** Gaps found during extraction and QA */
  gaps: Gap[];

  /** Whether quantities can be trusted beyond counts */
  quantityReliability: 'FULL' | 'LIMITED_TO_COUNTS' | 'UNRELIABLE';
  quantityReliabilityReason?: string;
}

/** Element index entry — SOP 5.1 row */
export interface ElementIndexEntry {
  elementId: string;
  idType: 'IFC_GUID' | 'Revit_UniqueId' | 'internal';
  category: string;
  family: string;
  type: string;
  tag?: string;
  level?: string;
  workset?: string;
  hostId?: string;
  systemType?: string;
  systemName?: string;
  discipline: Discipline;
  evidenceRef: EvidenceReference;
}

/** Category/type rollup — SOP 5.1 aggregation */
export interface CategoryRollup {
  category: string;
  type: string;
  discipline: Discipline;
  count: number;
  totalLengthM?: number;
  totalAreaM2?: number;
  totalVolumeM3?: number;
  unit: string;
  evidenceRef: EvidenceReference;
}

/** Materials table entry — SOP 5.1 */
export interface MaterialEntry {
  elementId: string;
  category: string;
  materialName: string;
  isPlaceholder: boolean;
  compoundLayers?: string[];
  thicknessMm?: number;
  evidenceRef: EvidenceReference;
}

/** Hosted dependency entry — SOP 5.1 */
export interface HostedDependency {
  hostedElementId: string;
  hostElementId?: string;
  hostFound: boolean;
  isOrphan: boolean;
  category: string;
  level?: string;
  discipline: Discipline;
  evidenceRef: EvidenceReference;
}

/** MEP connectivity entry — SOP 5.1 */
export interface MEPConnectivityEntry {
  systemName: string;
  systemType: string;
  service: string;
  connectedCount: number;
  unconnectedCount: number;
  unconnectedElementIds: string[];
  namingIssues: string[];
  evidenceRef: EvidenceReference;
}

// ─── QA Rule Results ────────────────────────────────────────────────────────

/** Results for all 6 mandatory QA rules — SOP 5.2 */
export interface QARuleResults {
  rule1_idStability: IDStabilityResult;
  rule2_levelAssignment: LevelAssignmentResult;
  rule3_systemMetadata: SystemMetadataResult;
  rule4_placeholderMaterials: PlaceholderMaterialResult;
  rule5_orphanDetection: OrphanDetectionResult;
  rule6_connectivity: ConnectivityResult;
  overallPass: boolean;
  totalIssueCount: number;
}

/** Rule 1: ID stability across model drops */
export interface IDStabilityResult {
  ruleId: 'QA-R1';
  ruleName: 'ID Stability';
  sopRef: 'Part 5.2';
  pass: boolean;
  comparedToPriorVersion: boolean;
  priorVersionLabel?: string;
  totalElementsCurrent: number;
  totalElementsPrior?: number;
  stableIds: number;
  changedIds: number;
  missingInCurrent: number;
  newInCurrent: number;
  changePercentage: number;
  /** Pass threshold: ≤5% changed */
  threshold: number;
  flaggedElementIds: string[];
  evidenceRef: EvidenceReference;
}

/** Rule 2: Level/storey assignment completeness */
export interface LevelAssignmentResult {
  ruleId: 'QA-R2';
  ruleName: 'Level Assignment';
  sopRef: 'Part 5.2';
  pass: boolean;
  totalElements: number;
  withLevel: number;
  withoutLevel: number;
  assignmentPercentage: number;
  /** Pass threshold: ≥90% */
  threshold: number;
  byCategory: Array<{
    category: string;
    total: number;
    withLevel: number;
    percentage: number;
  }>;
  flaggedElementIds: string[];
  evidenceRef: EvidenceReference;
}

/** Rule 3: SystemType/Service metadata for MEP */
export interface SystemMetadataResult {
  ruleId: 'QA-R3';
  ruleName: 'System Metadata';
  sopRef: 'Part 5.2';
  pass: boolean;
  totalMEPElements: number;
  withSystemType: number;
  withoutSystemType: number;
  systemTypePercentage: number;
  /** Pass threshold: ≥80% for MEP */
  threshold: number;
  byCategory: Array<{
    category: string;
    total: number;
    withSystemType: number;
    percentage: number;
  }>;
  flaggedElementIds: string[];
  evidenceRef: EvidenceReference;
}

/** Rule 4: Placeholder material detection */
export interface PlaceholderMaterialResult {
  ruleId: 'QA-R4';
  ruleName: 'Placeholder Materials';
  sopRef: 'Part 5.2';
  pass: boolean;
  totalElements: number;
  withRealMaterial: number;
  withPlaceholder: number;
  withoutMaterial: number;
  placeholderPercentage: number;
  /** Pass threshold: ≤10% placeholder */
  threshold: number;
  placeholderValues: string[];
  byCategory: Array<{
    category: string;
    total: number;
    placeholder: number;
    percentage: number;
  }>;
  flaggedElementIds: string[];
  evidenceRef: EvidenceReference;
}

/** Rule 5: Orphan detection (hosted elements missing host) */
export interface OrphanDetectionResult {
  ruleId: 'QA-R5';
  ruleName: 'Orphan Detection';
  sopRef: 'Part 5.2';
  pass: boolean;
  totalHostedElements: number;
  validHosts: number;
  orphans: number;
  orphanPercentage: number;
  /** Pass threshold: 0 orphans */
  threshold: number;
  byCategory: Array<{
    category: string;
    total: number;
    orphans: number;
  }>;
  flaggedElementIds: string[];
  evidenceRef: EvidenceReference;
}

/** Rule 6: MEP connector connectivity */
export interface ConnectivityResult {
  ruleId: 'QA-R6';
  ruleName: 'MEP Connectivity';
  sopRef: 'Part 5.2';
  pass: boolean;
  totalConnectors: number;
  connectedCount: number;
  unconnectedCount: number;
  unconnectedPercentage: number;
  /** Pass threshold: ≤5% unconnected */
  threshold: number;
  bySystem: Array<{
    systemName: string;
    total: number;
    unconnected: number;
    percentage: number;
  }>;
  flaggedElementIds: string[];
  evidenceRef: EvidenceReference;
}

// ─── Maturity Scoring ───────────────────────────────────────────────────────

/** QTO maturity score per category — SOP 5.3 */
export interface MaturityScore {
  category: string;
  discipline: Discipline;
  totalElements: number;
  percentWithLevel: number;
  percentWithSystem: number;
  percentWithMaterial: number;
  percentWithSize: number;
  percentWithLocation: number;
  overallMaturity: number;
  /** If critical params missing, only counts are reliable */
  quantityMode: 'FULL' | 'COUNTS_ONLY';
  quantityModeReason?: string;
}

// ─── Placeholder Material Patterns ──────────────────────────────────────────

/** Known placeholder material names that must be flagged per SOP 5.2 */
const PLACEHOLDER_MATERIALS: string[] = [
  'By Category',
  'Default',
  '<By Category>',
  '<Default>',
  'Generic',
  'None',
  '',
  'Undefined',
  'Not Assigned',
  'Unassigned',
  'Default Material',
  'Material_Default',
];

function isPlaceholderMaterial(materialName: string | undefined | null): boolean {
  if (!materialName || materialName.trim() === '') return true;
  const normalized = materialName.trim().toLowerCase();
  return PLACEHOLDER_MATERIALS.some(p => p.toLowerCase() === normalized);
}

// ─── MEP Categories ─────────────────────────────────────────────────────────

/** Categories that require SystemType/Service metadata */
const MEP_DISCIPLINES: Discipline[] = ['MECH', 'PLBG_FP', 'ELEC'];

const MEP_CATEGORIES = new Set([
  'Ducts', 'Duct Fittings', 'Duct Accessories', 'Duct Insulation',
  'Flex Ducts', 'Air Terminals', 'Mechanical Equipment',
  'Pipes', 'Pipe Fittings', 'Pipe Accessories', 'Pipe Insulation',
  'Flex Pipes', 'Plumbing Fixtures', 'Sprinklers',
  'Cable Trays', 'Cable Tray Fittings', 'Conduits', 'Conduit Fittings',
  'Electrical Equipment', 'Electrical Fixtures', 'Lighting Fixtures',
  'Fire Alarm Devices', 'Communication Devices',
  // IFC equivalents
  'IfcDuctSegment', 'IfcDuctFitting', 'IfcAirTerminal',
  'IfcPipeSegment', 'IfcPipeFitting', 'IfcFlowTerminal',
  'IfcCableCarrierSegment', 'IfcCableSegment',
]);

function isMEPCategory(category: string): boolean {
  return MEP_CATEGORIES.has(category);
}

/** Categories whose elements are typically hosted */
const HOSTED_CATEGORIES = new Set([
  'Doors', 'Windows', 'Lighting Fixtures', 'Electrical Fixtures',
  'Plumbing Fixtures', 'Air Terminals', 'Sprinklers', 'Fire Alarm Devices',
  'Communication Devices', 'Mechanical Equipment',
  'IfcDoor', 'IfcWindow', 'IfcLightFixture', 'IfcFlowTerminal',
  'IfcFireSuppressionTerminal', 'IfcSanitaryTerminal',
]);


// ═══════════════════════════════════════════════════════════════════════════════
//  5.1 — EXTRACTION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build the element index from coordination elements.
 * SOP 5.1: "Element index (ID, category/class, family/type, tag, level,
 * workset, host, system)"
 */
export function buildElementIndex(
  elements: CoordinationElement[],
  modelVersionLabel: string,
): ElementIndexEntry[] {
  return elements.map(el => {
    const [family, type] = parseFamilyType(el.familyType);
    return {
      elementId: el.id,
      idType: el.idType,
      category: el.category,
      family,
      type,
      tag: el.tag,
      level: el.level,
      workset: el.workset,
      hostId: el.hostId,
      systemType: el.systemType,
      systemName: el.systemName,
      discipline: el.discipline,
      evidenceRef: {
        type: 'model' as const,
        modelVersionLabel,
        elementId: el.id,
      },
    };
  });
}

/**
 * Build category/type rollups with aggregated quantities.
 * SOP 5.1: "Categories and type rollups (counts, quantities, units)"
 */
export function buildCategoryRollups(
  elements: CoordinationElement[],
  modelVersionLabel: string,
): CategoryRollup[] {
  const groups = new Map<string, CoordinationElement[]>();

  for (const el of elements) {
    const key = `${el.category}||${el.familyType}||${el.discipline}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(el);
  }

  const rollups: CategoryRollup[] = [];

  for (const [key, group] of groups) {
    const [category, familyType, discipline] = key.split('||');
    const [, type] = parseFamilyType(familyType);

    let totalLengthM = 0;
    let totalAreaM2 = 0;
    let totalVolumeM3 = 0;
    let hasLength = false;
    let hasArea = false;
    let hasVolume = false;

    for (const el of group) {
      const bbox = el.bbox;
      const dx = Math.abs(bbox.maxX - bbox.minX);
      const dy = Math.abs(bbox.maxY - bbox.minY);
      const dz = Math.abs(bbox.maxZ - bbox.minZ);

      // Length: longest dimension (for linear elements)
      const length = Math.max(dx, dy, dz);
      if (length > 0) { totalLengthM += length / 1000; hasLength = true; }

      // Area: derive from 2 largest dimensions
      const dims = [dx, dy, dz].sort((a, b) => b - a);
      const area = dims[0] * dims[1];
      if (area > 0) { totalAreaM2 += area / 1e6; hasArea = true; }

      // Volume: full bbox
      const vol = dx * dy * dz;
      if (vol > 0) { totalVolumeM3 += vol / 1e9; hasVolume = true; }
    }

    rollups.push({
      category,
      type,
      discipline: discipline as Discipline,
      count: group.length,
      totalLengthM: hasLength ? Math.round(totalLengthM * 1000) / 1000 : undefined,
      totalAreaM2: hasArea ? Math.round(totalAreaM2 * 1000) / 1000 : undefined,
      totalVolumeM3: hasVolume ? Math.round(totalVolumeM3 * 1000) / 1000 : undefined,
      unit: 'metric',
      evidenceRef: {
        type: 'model' as const,
        modelVersionLabel,
        elementId: group[0].id,
      },
    });
  }

  return rollups.sort((a, b) => a.category.localeCompare(b.category) || a.type.localeCompare(b.type));
}

/**
 * Build materials table.
 * SOP 5.1: "Materials table (including compound layers and thickness where available)"
 */
export function buildMaterialsTable(
  elements: CoordinationElement[],
  modelVersionLabel: string,
): MaterialEntry[] {
  return elements.map(el => ({
    elementId: el.id,
    category: el.category,
    materialName: el.material || '',
    isPlaceholder: isPlaceholderMaterial(el.material),
    compoundLayers: el.rawProperties?.compoundLayers as string[] | undefined,
    thicknessMm: el.rawProperties?.thickness as number | undefined,
    evidenceRef: {
      type: 'model' as const,
      modelVersionLabel,
      elementId: el.id,
    },
  }));
}

/**
 * Build hosted dependency analysis.
 * SOP 5.1: "Hosted dependencies (orphans, mis-hosts)"
 */
export function buildHostedDependencies(
  elements: CoordinationElement[],
  modelVersionLabel: string,
): HostedDependency[] {
  const idSet = new Set(elements.map(el => el.id));

  return elements
    .filter(el => el.isHosted || HOSTED_CATEGORIES.has(el.category))
    .map(el => {
      const hasHost = !!el.hostId;
      const hostFound = hasHost && idSet.has(el.hostId!);
      return {
        hostedElementId: el.id,
        hostElementId: el.hostId,
        hostFound,
        isOrphan: !hostFound,
        category: el.category,
        level: el.level,
        discipline: el.discipline,
        evidenceRef: {
          type: 'model' as const,
          modelVersionLabel,
          elementId: el.id,
        },
      };
    });
}

/**
 * Build MEP connectivity summary.
 * SOP 5.1: "MEP connectivity summary (unconnected connectors, system naming issues)"
 */
export function buildMEPConnectivity(
  elements: CoordinationElement[],
  modelVersionLabel: string,
): MEPConnectivityEntry[] {
  const systemMap = new Map<string, {
    systemType: string;
    service: string;
    connectors: ConnectorInfo[];
    namingIssues: string[];
    elementIds: Set<string>;
  }>();

  for (const el of elements) {
    if (!el.connectors || el.connectors.length === 0) continue;

    const sysName = el.systemName || el.systemType || 'UNNAMED_SYSTEM';
    if (!systemMap.has(sysName)) {
      systemMap.set(sysName, {
        systemType: el.systemType || 'UNKNOWN',
        service: el.rawProperties?.service as string || 'UNKNOWN',
        connectors: [],
        namingIssues: [],
        elementIds: new Set(),
      });
    }

    const entry = systemMap.get(sysName)!;
    entry.connectors.push(...el.connectors);
    entry.elementIds.add(el.id);

    // Check naming issues
    if (!el.systemType) {
      entry.namingIssues.push(`Element ${el.id}: missing SystemType`);
    }
    if (el.systemType && entry.systemType !== 'UNKNOWN' && el.systemType !== entry.systemType) {
      entry.namingIssues.push(`Element ${el.id}: SystemType mismatch (${el.systemType} vs ${entry.systemType})`);
    }
  }

  const results: MEPConnectivityEntry[] = [];
  for (const [sysName, data] of systemMap) {
    const connected = data.connectors.filter(c => c.isConnected);
    const unconnected = data.connectors.filter(c => !c.isConnected);

    results.push({
      systemName: sysName,
      systemType: data.systemType,
      service: data.service,
      connectedCount: connected.length,
      unconnectedCount: unconnected.length,
      unconnectedElementIds: [...new Set(unconnected.map(c => c.connectorId))],
      namingIssues: [...new Set(data.namingIssues)],
      evidenceRef: {
        type: 'model' as const,
        modelVersionLabel,
        elementId: [...data.elementIds][0],
      },
    });
  }

  return results.sort((a, b) => b.unconnectedCount - a.unconnectedCount);
}


// ═══════════════════════════════════════════════════════════════════════════════
//  5.2 — QA RULES (MANDATORY — DO NOT SKIP)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Rule 1: ID Stability Check
 * SOP 5.2: "IFC GUID/Revit UniqueId must be stable across drops;
 * if not, flag delta tracking risk."
 * Threshold: ≤5% changed
 */
export function qaRule1_IDStability(
  currentElements: CoordinationElement[],
  priorElements: CoordinationElement[] | null,
  modelVersionLabel: string,
  priorVersionLabel?: string,
): IDStabilityResult {
  const evidenceRef: EvidenceReference = { type: 'model', modelVersionLabel };

  if (!priorElements) {
    return {
      ruleId: 'QA-R1',
      ruleName: 'ID Stability',
      sopRef: 'Part 5.2',
      pass: true,
      comparedToPriorVersion: false,
      totalElementsCurrent: currentElements.length,
      stableIds: currentElements.length,
      changedIds: 0,
      missingInCurrent: 0,
      newInCurrent: currentElements.length,
      changePercentage: 0,
      threshold: 5,
      flaggedElementIds: [],
      evidenceRef,
    };
  }

  const currentIds = new Set(currentElements.map(el => el.id));
  const priorIds = new Set(priorElements.map(el => el.id));

  const stableIds = [...currentIds].filter(id => priorIds.has(id));
  const missingInCurrent = [...priorIds].filter(id => !currentIds.has(id));
  const newInCurrent = [...currentIds].filter(id => !priorIds.has(id));

  const totalForComparison = Math.max(priorIds.size, 1);
  const changedCount = missingInCurrent.length + newInCurrent.length;
  const changePercentage = Math.round((changedCount / totalForComparison) * 10000) / 100;

  return {
    ruleId: 'QA-R1',
    ruleName: 'ID Stability',
    sopRef: 'Part 5.2',
    pass: changePercentage <= 5,
    comparedToPriorVersion: true,
    priorVersionLabel,
    totalElementsCurrent: currentElements.length,
    totalElementsPrior: priorElements.length,
    stableIds: stableIds.length,
    changedIds: changedCount,
    missingInCurrent: missingInCurrent.length,
    newInCurrent: newInCurrent.length,
    changePercentage,
    threshold: 5,
    flaggedElementIds: [...missingInCurrent, ...newInCurrent],
    evidenceRef,
  };
}

/**
 * Rule 2: Level Assignment Validation
 * SOP 5.2: "Elements missing level/storey are flagged and corrected by discipline."
 * Threshold: ≥90% assigned
 */
export function qaRule2_LevelAssignment(
  elements: CoordinationElement[],
  modelVersionLabel: string,
): LevelAssignmentResult {
  const withLevel = elements.filter(el => el.hasLevel && el.level && el.level.trim() !== '');
  const withoutLevel = elements.filter(el => !el.hasLevel || !el.level || el.level.trim() === '');

  const percentage = elements.length > 0
    ? Math.round((withLevel.length / elements.length) * 10000) / 100
    : 100;

  // By category breakdown
  const categoryMap = new Map<string, { total: number; withLevel: number }>();
  for (const el of elements) {
    if (!categoryMap.has(el.category)) categoryMap.set(el.category, { total: 0, withLevel: 0 });
    const cat = categoryMap.get(el.category)!;
    cat.total++;
    if (el.hasLevel && el.level && el.level.trim() !== '') cat.withLevel++;
  }

  return {
    ruleId: 'QA-R2',
    ruleName: 'Level Assignment',
    sopRef: 'Part 5.2',
    pass: percentage >= 90,
    totalElements: elements.length,
    withLevel: withLevel.length,
    withoutLevel: withoutLevel.length,
    assignmentPercentage: percentage,
    threshold: 90,
    byCategory: [...categoryMap.entries()]
      .map(([category, data]) => ({
        category,
        total: data.total,
        withLevel: data.withLevel,
        percentage: data.total > 0 ? Math.round((data.withLevel / data.total) * 10000) / 100 : 100,
      }))
      .sort((a, b) => a.percentage - b.percentage),
    flaggedElementIds: withoutLevel.map(el => el.id),
    evidenceRef: { type: 'model', modelVersionLabel },
  };
}

/**
 * Rule 3: SystemType/Service Metadata
 * SOP 5.2: "SystemType/Service must be populated for MEP;
 * missing values are flagged as leading indicators."
 * Threshold: ≥80% for MEP categories
 */
export function qaRule3_SystemMetadata(
  elements: CoordinationElement[],
  modelVersionLabel: string,
): SystemMetadataResult {
  const mepElements = elements.filter(el =>
    MEP_DISCIPLINES.includes(el.discipline) || isMEPCategory(el.category)
  );

  const withSystemType = mepElements.filter(el => el.hasSystemType && el.systemType && el.systemType.trim() !== '');
  const withoutSystemType = mepElements.filter(el => !el.hasSystemType || !el.systemType || el.systemType.trim() === '');

  const percentage = mepElements.length > 0
    ? Math.round((withSystemType.length / mepElements.length) * 10000) / 100
    : 100;

  // By category breakdown
  const categoryMap = new Map<string, { total: number; withSystemType: number }>();
  for (const el of mepElements) {
    if (!categoryMap.has(el.category)) categoryMap.set(el.category, { total: 0, withSystemType: 0 });
    const cat = categoryMap.get(el.category)!;
    cat.total++;
    if (el.hasSystemType && el.systemType && el.systemType.trim() !== '') cat.withSystemType++;
  }

  return {
    ruleId: 'QA-R3',
    ruleName: 'System Metadata',
    sopRef: 'Part 5.2',
    pass: percentage >= 80,
    totalMEPElements: mepElements.length,
    withSystemType: withSystemType.length,
    withoutSystemType: withoutSystemType.length,
    systemTypePercentage: percentage,
    threshold: 80,
    byCategory: [...categoryMap.entries()]
      .map(([category, data]) => ({
        category,
        total: data.total,
        withSystemType: data.withSystemType,
        percentage: data.total > 0 ? Math.round((data.withSystemType / data.total) * 10000) / 100 : 100,
      }))
      .sort((a, b) => a.percentage - b.percentage),
    flaggedElementIds: withoutSystemType.map(el => el.id),
    evidenceRef: { type: 'model', modelVersionLabel },
  };
}

/**
 * Rule 4: Placeholder Material Detection
 * SOP 5.2: "Placeholder materials (By Category/Default) flagged;
 * inconsistent materials within the same type flagged."
 * Threshold: ≤10% placeholder
 */
export function qaRule4_PlaceholderMaterials(
  elements: CoordinationElement[],
  modelVersionLabel: string,
): PlaceholderMaterialResult {
  const withReal = elements.filter(el => !isPlaceholderMaterial(el.material));
  const withPlaceholder = elements.filter(el => el.material && isPlaceholderMaterial(el.material));
  const withoutMaterial = elements.filter(el => !el.material || el.material.trim() === '');

  const placeholderCount = withPlaceholder.length + withoutMaterial.length;
  const percentage = elements.length > 0
    ? Math.round((placeholderCount / elements.length) * 10000) / 100
    : 0;

  // Collect unique placeholder values
  const placeholderValues = [...new Set(
    withPlaceholder.map(el => el.material!).filter(Boolean)
  )];

  // By category breakdown
  const categoryMap = new Map<string, { total: number; placeholder: number }>();
  for (const el of elements) {
    if (!categoryMap.has(el.category)) categoryMap.set(el.category, { total: 0, placeholder: 0 });
    const cat = categoryMap.get(el.category)!;
    cat.total++;
    if (isPlaceholderMaterial(el.material)) cat.placeholder++;
  }

  return {
    ruleId: 'QA-R4',
    ruleName: 'Placeholder Materials',
    sopRef: 'Part 5.2',
    pass: percentage <= 10,
    totalElements: elements.length,
    withRealMaterial: withReal.length,
    withPlaceholder: withPlaceholder.length,
    withoutMaterial: withoutMaterial.length,
    placeholderPercentage: percentage,
    threshold: 10,
    placeholderValues,
    byCategory: [...categoryMap.entries()]
      .map(([category, data]) => ({
        category,
        total: data.total,
        placeholder: data.placeholder,
        percentage: data.total > 0 ? Math.round((data.placeholder / data.total) * 10000) / 100 : 0,
      }))
      .sort((a, b) => b.percentage - a.percentage),
    flaggedElementIds: [...withPlaceholder, ...withoutMaterial].map(el => el.id),
    evidenceRef: { type: 'model', modelVersionLabel },
  };
}

/**
 * Rule 5: Orphan Detection
 * SOP 5.2: "Hosted elements with missing host IDs flagged;
 * often cause false clashes and constructability issues."
 * Threshold: 0 orphans
 */
export function qaRule5_OrphanDetection(
  elements: CoordinationElement[],
  modelVersionLabel: string,
): OrphanDetectionResult {
  const idSet = new Set(elements.map(el => el.id));
  const hostedElements = elements.filter(el => el.isHosted || HOSTED_CATEGORIES.has(el.category));

  const orphans = hostedElements.filter(el => {
    if (!el.hostId) return true;
    if (!idSet.has(el.hostId)) return true;
    return false;
  });

  const validHosts = hostedElements.length - orphans.length;
  const percentage = hostedElements.length > 0
    ? Math.round((orphans.length / hostedElements.length) * 10000) / 100
    : 0;

  // By category breakdown
  const categoryMap = new Map<string, { total: number; orphans: number }>();
  for (const el of hostedElements) {
    if (!categoryMap.has(el.category)) categoryMap.set(el.category, { total: 0, orphans: 0 });
    const cat = categoryMap.get(el.category)!;
    cat.total++;
    if (orphans.some(o => o.id === el.id)) cat.orphans++;
  }

  return {
    ruleId: 'QA-R5',
    ruleName: 'Orphan Detection',
    sopRef: 'Part 5.2',
    pass: orphans.length === 0,
    totalHostedElements: hostedElements.length,
    validHosts,
    orphans: orphans.length,
    orphanPercentage: percentage,
    threshold: 0,
    byCategory: [...categoryMap.entries()]
      .map(([category, data]) => ({
        category,
        total: data.total,
        orphans: data.orphans,
      }))
      .sort((a, b) => b.orphans - a.orphans),
    flaggedElementIds: orphans.map(el => el.id),
    evidenceRef: { type: 'model', modelVersionLabel },
  };
}

/**
 * Rule 6: MEP Connector Connectivity
 * SOP 5.1 + 5.2: "Unconnected connectors, system naming issues"
 * Threshold: ≤5% unconnected
 */
export function qaRule6_Connectivity(
  elements: CoordinationElement[],
  modelVersionLabel: string,
): ConnectivityResult {
  let totalConnectors = 0;
  let connectedCount = 0;
  let unconnectedCount = 0;
  const flaggedElementIds: string[] = [];

  const systemMap = new Map<string, { total: number; unconnected: number }>();

  for (const el of elements) {
    if (!el.connectors || el.connectors.length === 0) continue;

    const sysName = el.systemName || el.systemType || 'UNNAMED';

    if (!systemMap.has(sysName)) systemMap.set(sysName, { total: 0, unconnected: 0 });
    const sys = systemMap.get(sysName)!;

    for (const conn of el.connectors) {
      totalConnectors++;
      sys.total++;
      if (conn.isConnected) {
        connectedCount++;
      } else {
        unconnectedCount++;
        sys.unconnected++;
        flaggedElementIds.push(el.id);
      }
    }
  }

  const percentage = totalConnectors > 0
    ? Math.round((unconnectedCount / totalConnectors) * 10000) / 100
    : 0;

  return {
    ruleId: 'QA-R6',
    ruleName: 'MEP Connectivity',
    sopRef: 'Part 5.2',
    pass: percentage <= 5,
    totalConnectors,
    connectedCount,
    unconnectedCount,
    unconnectedPercentage: percentage,
    threshold: 5,
    bySystem: [...systemMap.entries()]
      .map(([systemName, data]) => ({
        systemName,
        total: data.total,
        unconnected: data.unconnected,
        percentage: data.total > 0 ? Math.round((data.unconnected / data.total) * 10000) / 100 : 0,
      }))
      .sort((a, b) => b.unconnected - a.unconnected),
    flaggedElementIds: [...new Set(flaggedElementIds)],
    evidenceRef: { type: 'model', modelVersionLabel },
  };
}

/**
 * Run ALL 6 QA rules and aggregate results.
 * SOP 5.2: "QA rules (do not skip)"
 */
export function runAllQARules(
  currentElements: CoordinationElement[],
  priorElements: CoordinationElement[] | null,
  modelVersionLabel: string,
  priorVersionLabel?: string,
): QARuleResults {
  const rule1 = qaRule1_IDStability(currentElements, priorElements, modelVersionLabel, priorVersionLabel);
  const rule2 = qaRule2_LevelAssignment(currentElements, modelVersionLabel);
  const rule3 = qaRule3_SystemMetadata(currentElements, modelVersionLabel);
  const rule4 = qaRule4_PlaceholderMaterials(currentElements, modelVersionLabel);
  const rule5 = qaRule5_OrphanDetection(currentElements, modelVersionLabel);
  const rule6 = qaRule6_Connectivity(currentElements, modelVersionLabel);

  const totalIssueCount =
    rule1.flaggedElementIds.length +
    rule2.flaggedElementIds.length +
    rule3.flaggedElementIds.length +
    rule4.flaggedElementIds.length +
    rule5.flaggedElementIds.length +
    rule6.flaggedElementIds.length;

  return {
    rule1_idStability: rule1,
    rule2_levelAssignment: rule2,
    rule3_systemMetadata: rule3,
    rule4_placeholderMaterials: rule4,
    rule5_orphanDetection: rule5,
    rule6_connectivity: rule6,
    overallPass: rule1.pass && rule2.pass && rule3.pass && rule4.pass && rule5.pass && rule6.pass,
    totalIssueCount,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
//  5.3 — QTO MATURITY SCORING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate QTO maturity scores per category.
 * SOP 5.3: "Report completeness by category: % with level, system, material,
 * size, and location filled."
 *
 * If critical parameters are missing, state that quantities can only be
 * reported as counts (not length/area/volume).
 */
export function calculateMaturityScores(
  elements: CoordinationElement[],
): MaturityScore[] {
  const categoryMap = new Map<string, CoordinationElement[]>();
  for (const el of elements) {
    if (!categoryMap.has(el.category)) categoryMap.set(el.category, []);
    categoryMap.get(el.category)!.push(el);
  }

  const scores: MaturityScore[] = [];

  for (const [category, group] of categoryMap) {
    const total = group.length;
    if (total === 0) continue;

    const withLevel = group.filter(el => el.hasLevel && el.level && el.level.trim() !== '').length;
    const withSystem = group.filter(el => el.hasSystemType && el.systemType && el.systemType.trim() !== '').length;
    const withMaterial = group.filter(el => el.hasMaterial && el.material && !isPlaceholderMaterial(el.material)).length;

    // Size: element has meaningful bbox dimensions
    const withSize = group.filter(el => {
      const bbox = el.bbox;
      const dx = Math.abs(bbox.maxX - bbox.minX);
      const dy = Math.abs(bbox.maxY - bbox.minY);
      const dz = Math.abs(bbox.maxZ - bbox.minZ);
      return dx > 0 && dy > 0 && dz > 0;
    }).length;

    // Location: has both level and zone (or at minimum, non-zero coordinates)
    const withLocation = group.filter(el => {
      const hasLevelZone = el.hasLevel && el.zone;
      const hasCoords = el.bbox.minX !== 0 || el.bbox.minY !== 0 || el.bbox.minZ !== 0;
      return hasLevelZone || hasCoords;
    }).length;

    const pctLevel = Math.round((withLevel / total) * 10000) / 100;
    const pctSystem = Math.round((withSystem / total) * 10000) / 100;
    const pctMaterial = Math.round((withMaterial / total) * 10000) / 100;
    const pctSize = Math.round((withSize / total) * 10000) / 100;
    const pctLocation = Math.round((withLocation / total) * 10000) / 100;

    const overall = Math.round((pctLevel + pctSystem + pctMaterial + pctSize + pctLocation) / 5 * 100) / 100;

    // Determine quantity mode
    // If level < 80% or size < 80%, quantities are counts only
    const criticalMissing = pctLevel < 80 || pctSize < 80;
    let quantityMode: 'FULL' | 'COUNTS_ONLY' = 'FULL';
    let quantityModeReason: string | undefined;

    if (criticalMissing) {
      quantityMode = 'COUNTS_ONLY';
      const reasons: string[] = [];
      if (pctLevel < 80) reasons.push(`level assignment ${pctLevel}% (<80%)`);
      if (pctSize < 80) reasons.push(`size data ${pctSize}% (<80%)`);
      quantityModeReason = `Critical parameters missing: ${reasons.join(', ')}. Quantities limited to counts.`;
    }

    const discipline = group[0].discipline;

    scores.push({
      category,
      discipline,
      totalElements: total,
      percentWithLevel: pctLevel,
      percentWithSystem: pctSystem,
      percentWithMaterial: pctMaterial,
      percentWithSize: pctSize,
      percentWithLocation: pctLocation,
      overallMaturity: overall,
      quantityMode,
      quantityModeReason,
    });
  }

  return scores.sort((a, b) => a.overallMaturity - b.overallMaturity);
}


// ═══════════════════════════════════════════════════════════════════════════════
//  GAP GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate SOP-compliant gaps from QA rule results.
 * Each failing rule produces a Gap entry per Appendix D.
 */
export function generateGapsFromQA(
  qaResults: QARuleResults,
  modelVersionLabel: string,
): Gap[] {
  const gaps: Gap[] = [];
  let gapCounter = 1;

  // Rule 1 failures → ID stability gap
  if (!qaResults.rule1_idStability.pass) {
    gaps.push({
      id: `GAP-QTO-${String(gapCounter++).padStart(3, '0')}`,
      type: 'ACTION_ITEM',
      parameterName: 'Element IDs',
      affectedElementIds: qaResults.rule1_idStability.flaggedElementIds.slice(0, 100),
      affectedCount: qaResults.rule1_idStability.changedIds,
      discipline: 'ARC' as Discipline,
      description: `ID stability check failed: ${qaResults.rule1_idStability.changePercentage}% changed (threshold: ≤${qaResults.rule1_idStability.threshold}%). Delta tracking unreliable.`,
      impact: 'high',
      sopReference: 'Part 5.2, QA Rule 1',
      evidenceRef: qaResults.rule1_idStability.evidenceRef,
    });
  }

  // Rule 2 failures → Level assignment gap
  if (!qaResults.rule2_levelAssignment.pass) {
    // One gap per failing category
    for (const cat of qaResults.rule2_levelAssignment.byCategory) {
      if (cat.percentage < 90) {
        gaps.push({
          id: `GAP-QTO-${String(gapCounter++).padStart(3, '0')}`,
          type: 'PARAMETER_MISSING',
          parameterName: 'Level',
          affectedElementIds: qaResults.rule2_levelAssignment.flaggedElementIds.slice(0, 50),
          affectedCount: cat.total - cat.withLevel,
          discipline: 'ARC' as Discipline,
          description: `${cat.category}: ${cat.percentage}% level assignment (threshold: ≥90%). ${cat.total - cat.withLevel} elements missing level.`,
          impact: cat.percentage < 50 ? 'high' : 'medium',
          sopReference: 'Part 5.2, QA Rule 2',
          evidenceRef: { type: 'model', modelVersionLabel },
        });
      }
    }
  }

  // Rule 3 failures → System metadata gap
  if (!qaResults.rule3_systemMetadata.pass) {
    for (const cat of qaResults.rule3_systemMetadata.byCategory) {
      if (cat.percentage < 80) {
        gaps.push({
          id: `GAP-QTO-${String(gapCounter++).padStart(3, '0')}`,
          type: 'PARAMETER_MISSING',
          parameterName: 'SystemType',
          affectedElementIds: qaResults.rule3_systemMetadata.flaggedElementIds.slice(0, 50),
          affectedCount: cat.total - cat.withSystemType,
          discipline: 'MECH' as Discipline,
          description: `${cat.category}: ${cat.percentage}% SystemType populated (threshold: ≥80%). ${cat.total - cat.withSystemType} elements missing SystemType.`,
          impact: cat.percentage < 50 ? 'high' : 'medium',
          sopReference: 'Part 5.2, QA Rule 3',
          evidenceRef: { type: 'model', modelVersionLabel },
        });
      }
    }
  }

  // Rule 4 failures → Material gap
  if (!qaResults.rule4_placeholderMaterials.pass) {
    gaps.push({
      id: `GAP-QTO-${String(gapCounter++).padStart(3, '0')}`,
      type: 'PARAMETER_MISSING',
      parameterName: 'Material',
      affectedElementIds: qaResults.rule4_placeholderMaterials.flaggedElementIds.slice(0, 100),
      affectedCount: qaResults.rule4_placeholderMaterials.withPlaceholder + qaResults.rule4_placeholderMaterials.withoutMaterial,
      discipline: 'ARC' as Discipline,
      description: `${qaResults.rule4_placeholderMaterials.placeholderPercentage}% placeholder/missing materials (threshold: ≤10%). Values found: ${qaResults.rule4_placeholderMaterials.placeholderValues.join(', ') || 'blank'}.`,
      impact: 'medium',
      sopReference: 'Part 5.2, QA Rule 4',
      evidenceRef: qaResults.rule4_placeholderMaterials.evidenceRef,
    });
  }

  // Rule 5 failures → Orphan gap
  if (!qaResults.rule5_orphanDetection.pass) {
    gaps.push({
      id: `GAP-QTO-${String(gapCounter++).padStart(3, '0')}`,
      type: 'ACTION_ITEM',
      parameterName: 'HostId',
      affectedElementIds: qaResults.rule5_orphanDetection.flaggedElementIds,
      affectedCount: qaResults.rule5_orphanDetection.orphans,
      discipline: 'ARC' as Discipline,
      description: `${qaResults.rule5_orphanDetection.orphans} orphan elements found (threshold: 0). Missing host IDs cause false clashes and constructability issues.`,
      impact: 'high',
      sopReference: 'Part 5.2, QA Rule 5',
      evidenceRef: qaResults.rule5_orphanDetection.evidenceRef,
    });
  }

  // Rule 6 failures → Connectivity gap
  if (!qaResults.rule6_connectivity.pass) {
    gaps.push({
      id: `GAP-QTO-${String(gapCounter++).padStart(3, '0')}`,
      type: 'ACTION_ITEM',
      parameterName: 'Connector',
      affectedElementIds: qaResults.rule6_connectivity.flaggedElementIds,
      affectedCount: qaResults.rule6_connectivity.unconnectedCount,
      discipline: 'MECH' as Discipline,
      description: `${qaResults.rule6_connectivity.unconnectedPercentage}% unconnected MEP connectors (threshold: ≤5%). ${qaResults.rule6_connectivity.unconnectedCount} of ${qaResults.rule6_connectivity.totalConnectors} connectors unconnected.`,
      impact: qaResults.rule6_connectivity.unconnectedPercentage > 20 ? 'high' : 'medium',
      sopReference: 'Part 5.2, QA Rule 6',
      evidenceRef: qaResults.rule6_connectivity.evidenceRef,
    });
  }

  return gaps;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  FULL QTO EXTRACTION PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run the complete QTO extraction and QA pipeline.
 * This is the main entry point that performs all SOP Part 5 operations:
 *   1. Build element index (5.1)
 *   2. Build category rollups (5.1)
 *   3. Build materials table (5.1)
 *   4. Build hosted dependencies (5.1)
 *   5. Build MEP connectivity (5.1)
 *   6. Run all 6 QA rules (5.2)
 *   7. Calculate maturity scores (5.3)
 *   8. Generate gaps from QA failures
 *   9. Determine overall quantity reliability
 */
export function runQTOExtraction(
  currentElements: CoordinationElement[],
  modelId: string,
  modelVersionLabel: string,
  priorElements?: CoordinationElement[] | null,
  priorVersionLabel?: string,
): QTOExtractionResult {
  // 5.1 — Extraction
  const elementIndex = buildElementIndex(currentElements, modelVersionLabel);
  const categoryRollups = buildCategoryRollups(currentElements, modelVersionLabel);
  const materialsTable = buildMaterialsTable(currentElements, modelVersionLabel);
  const hostedDependencies = buildHostedDependencies(currentElements, modelVersionLabel);
  const mepConnectivity = buildMEPConnectivity(currentElements, modelVersionLabel);

  // 5.2 — QA Rules
  const qaResults = runAllQARules(
    currentElements,
    priorElements ?? null,
    modelVersionLabel,
    priorVersionLabel,
  );

  // 5.3 — Maturity Scoring
  const maturityScores = calculateMaturityScores(currentElements);

  // Overall maturity (average across categories)
  const overallMaturity = maturityScores.length > 0
    ? Math.round(
      maturityScores.reduce((sum, s) => sum + s.overallMaturity, 0) / maturityScores.length * 100
    ) / 100
    : 0;

  // Generate gaps
  const gaps = generateGapsFromQA(qaResults, modelVersionLabel);

  // Determine quantity reliability
  let quantityReliability: 'FULL' | 'LIMITED_TO_COUNTS' | 'UNRELIABLE' = 'FULL';
  let quantityReliabilityReason: string | undefined;

  const countsOnlyCategories = maturityScores.filter(s => s.quantityMode === 'COUNTS_ONLY');
  if (countsOnlyCategories.length > 0) {
    const ratio = countsOnlyCategories.length / maturityScores.length;
    if (ratio > 0.5) {
      quantityReliability = 'UNRELIABLE';
      quantityReliabilityReason = `${countsOnlyCategories.length} of ${maturityScores.length} categories have critical parameter gaps. Quantities are unreliable beyond element counts.`;
    } else {
      quantityReliability = 'LIMITED_TO_COUNTS';
      quantityReliabilityReason = `${countsOnlyCategories.length} categories limited to counts only: ${countsOnlyCategories.map(c => c.category).join(', ')}`;
    }
  }

  if (!qaResults.rule1_idStability.pass) {
    quantityReliability = 'UNRELIABLE';
    quantityReliabilityReason = `ID stability failed (${qaResults.rule1_idStability.changePercentage}% changed). Delta tracking unreliable. ${quantityReliabilityReason || ''}`;
  }

  return {
    modelId,
    modelVersion: modelVersionLabel,
    extractionTimestamp: new Date().toISOString(),
    elementCount: currentElements.length,
    elementIndex,
    categoryRollups,
    materialsTable,
    hostedDependencies,
    mepConnectivity,
    qaResults,
    maturityScores,
    overallMaturity,
    gaps,
    quantityReliability,
    quantityReliabilityReason,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
//  AI PROMPT GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate the SOP 3.2 Model QTO prompt for AI-assisted extraction.
 * Uses prompt-library.ts as the single source of truth.
 */
export function generateQTOPrompt(params: ModelQTOParams): string {
  return getModelQTOPrompt(params);
}


// ═══════════════════════════════════════════════════════════════════════════════
//  SUMMARY / REPORTING HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Generate a human-readable QA summary for reporting */
export function generateQASummary(result: QTOExtractionResult): string {
  const lines: string[] = [];

  lines.push(`═══ QTO QA SUMMARY — ${result.modelId} (${result.modelVersion}) ═══`);
  lines.push(`Extraction: ${result.extractionTimestamp}`);
  lines.push(`Elements: ${result.elementCount}`);
  lines.push(`Overall Maturity: ${result.overallMaturity}%`);
  lines.push(`Quantity Reliability: ${result.quantityReliability}`);
  if (result.quantityReliabilityReason) {
    lines.push(`  Reason: ${result.quantityReliabilityReason}`);
  }
  lines.push('');

  // QA Rules
  lines.push('── QA Rules (SOP Part 5.2) ──');
  const rules = [
    { name: 'R1 ID Stability', ...result.qaResults.rule1_idStability },
    { name: 'R2 Level Assignment', ...result.qaResults.rule2_levelAssignment },
    { name: 'R3 System Metadata', ...result.qaResults.rule3_systemMetadata },
    { name: 'R4 Placeholder Materials', ...result.qaResults.rule4_placeholderMaterials },
    { name: 'R5 Orphan Detection', ...result.qaResults.rule5_orphanDetection },
    { name: 'R6 MEP Connectivity', ...result.qaResults.rule6_connectivity },
  ];

  for (const rule of rules) {
    const status = rule.pass ? '✅ PASS' : '❌ FAIL';
    lines.push(`  ${rule.name}: ${status} (${rule.flaggedElementIds.length} issues)`);
  }

  lines.push(`  Overall: ${result.qaResults.overallPass ? '✅ ALL PASS' : '❌ ISSUES FOUND'} (${result.qaResults.totalIssueCount} total)`);
  lines.push('');

  // Maturity scores (worst 5)
  lines.push('── Maturity Scores (SOP Part 5.3) ── (lowest 5)');
  const worstScores = result.maturityScores.slice(0, 5);
  for (const score of worstScores) {
    lines.push(`  ${score.category}: ${score.overallMaturity}% overall — Level:${score.percentWithLevel}% Sys:${score.percentWithSystem}% Mat:${score.percentWithMaterial}% Size:${score.percentWithSize}% Loc:${score.percentWithLocation}% [${score.quantityMode}]`);
  }
  lines.push('');

  // Gaps
  if (result.gaps.length > 0) {
    lines.push(`── Gaps (${result.gaps.length}) ──`);
    for (const gap of result.gaps) {
      lines.push(`  ${gap.id} [${gap.type}] ${gap.parameterName}: ${gap.description}`);
    }
  }

  return lines.join('\n');
}

/** Get element count by discipline */
export function countByDiscipline(elements: CoordinationElement[]): Record<Discipline, number> {
  const counts: Record<string, number> = {
    ARC: 0, STR: 0, MECH: 0, PLBG_FP: 0, ELEC: 0,
  };
  for (const el of elements) {
    counts[el.discipline] = (counts[el.discipline] || 0) + 1;
  }
  return counts as Record<Discipline, number>;
}

/** Get elements failing a specific QA rule */
export function getFailedElements(
  qaResults: QARuleResults,
  ruleId: 'QA-R1' | 'QA-R2' | 'QA-R3' | 'QA-R4' | 'QA-R5' | 'QA-R6',
): string[] {
  switch (ruleId) {
    case 'QA-R1': return qaResults.rule1_idStability.flaggedElementIds;
    case 'QA-R2': return qaResults.rule2_levelAssignment.flaggedElementIds;
    case 'QA-R3': return qaResults.rule3_systemMetadata.flaggedElementIds;
    case 'QA-R4': return qaResults.rule4_placeholderMaterials.flaggedElementIds;
    case 'QA-R5': return qaResults.rule5_orphanDetection.flaggedElementIds;
    case 'QA-R6': return qaResults.rule6_connectivity.flaggedElementIds;
    default: return [];
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Parse "Family:Type" string into [family, type] */
function parseFamilyType(familyType: string): [string, string] {
  const idx = familyType.indexOf(':');
  if (idx === -1) return [familyType, familyType];
  return [familyType.substring(0, idx), familyType.substring(idx + 1)];
}


// ═══════════════════════════════════════════════════════════════════════════════
//  MODEL DROP GATE CHECK — SOP Part 2 (BIM/VDC Management)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Quick check for model drop acceptance.
 * Per SOP Part 2 (BIM/VDC Management):
 *   "Enforce gates: minimum metadata completeness (SystemType, Level, IDs
 *    stability) before accepting a model drop."
 *
 * Returns pass/fail and the specific rules that blocked.
 */
export interface ModelDropGateResult {
  accepted: boolean;
  gateChecks: Array<{
    gate: string;
    passed: boolean;
    actual: string;
    required: string;
    ruleId: string;
  }>;
  blockedBy: string[];
  recommendation: string;
}

export function checkModelDropGate(
  qaResults: QARuleResults,
): ModelDropGateResult {
  const gateChecks: ModelDropGateResult['gateChecks'] = [];
  const blockedBy: string[] = [];

  // Gate 1: Level assignment ≥90% (SOP Part 5.2 Rule 2)
  const r2 = qaResults.rule2_levelAssignment;
  const levelPass = r2.assignmentPercentage >= r2.threshold;
  gateChecks.push({
    gate: 'Level Assignment ≥90%',
    passed: levelPass,
    actual: `${r2.assignmentPercentage.toFixed(1)}% (${r2.withLevel} of ${r2.totalElements})`,
    required: `≥${r2.threshold}%`,
    ruleId: 'QA-R2',
  });
  if (!levelPass) blockedBy.push(`Level assignment at ${r2.assignmentPercentage.toFixed(1)}% — below ${r2.threshold}% threshold`);

  // Gate 2: SystemType ≥80% for MEP (SOP Part 5.2 Rule 3)
  const r3 = qaResults.rule3_systemMetadata;
  const sysPass = r3.systemTypePercentage >= r3.threshold || r3.totalMEPElements === 0;
  gateChecks.push({
    gate: 'SystemType ≥80% (MEP)',
    passed: sysPass,
    actual: r3.totalMEPElements > 0
      ? `${r3.systemTypePercentage.toFixed(1)}% (${r3.withSystemType} of ${r3.totalMEPElements} MEP elements)`
      : 'N/A — no MEP elements',
    required: `≥${r3.threshold}% for MEP elements`,
    ruleId: 'QA-R3',
  });
  if (!sysPass) blockedBy.push(`SystemType at ${r3.systemTypePercentage.toFixed(1)}% — below ${r3.threshold}% threshold`);

  // Gate 3: ID stability ≤5% changed (SOP Part 5.2 Rule 1)
  const r1 = qaResults.rule1_idStability;
  const idPass = r1.pass || !r1.comparedToPriorVersion;
  gateChecks.push({
    gate: 'ID Stability ≤5% changed',
    passed: idPass,
    actual: r1.comparedToPriorVersion
      ? `${r1.changePercentage.toFixed(1)}% changed (${r1.changedIds} of ${r1.totalElementsCurrent})`
      : 'N/A — first model drop',
    required: `≤${r1.threshold}% IDs changed from prior drop`,
    ruleId: 'QA-R1',
  });
  if (!idPass) blockedBy.push(`ID instability at ${r1.changePercentage.toFixed(1)}% — exceeds ${r1.threshold}% threshold`);

  const accepted = blockedBy.length === 0;

  let recommendation: string;
  if (accepted) {
    recommendation = 'Model drop ACCEPTED. Proceed with selection set build and clash detection.';
  } else {
    recommendation = `Model drop BLOCKED — ${blockedBy.length} gate(s) failed:\n` +
      blockedBy.map((b, i) => `  ${i + 1}. ${b}`).join('\n') +
      '\nReturn model to discipline lead for corrections before re-submission.';
  }

  return { accepted, gateChecks, blockedBy, recommendation };
}


// ═══════════════════════════════════════════════════════════════════════════════
//  QA REPORT FORMATTER — For meeting packs and dashboards
// ═══════════════════════════════════════════════════════════════════════════════

/** Format QA results for dashboard / meeting pack consumption */
export function formatQAReportSummary(result: QTOExtractionResult): string {
  const lines: string[] = [];
  lines.push(`═══ QTO QA REPORT ═══`);
  lines.push(`Model: ${result.modelId} (${result.modelVersion})`);
  lines.push(`Run: ${result.extractionTimestamp}`);
  lines.push(`Elements: ${result.elementCount}`);
  lines.push(`Overall QA: ${result.qaResults.overallPass ? 'PASS' : 'FAIL'} (${result.qaResults.totalIssueCount} issues)`);
  lines.push('');

  // QA Rules
  lines.push('─── QA Rules (SOP 5.2) ───');
  const rules = [
    { r: result.qaResults.rule1_idStability, name: 'ID Stability' },
    { r: result.qaResults.rule2_levelAssignment, name: 'Level Assignment' },
    { r: result.qaResults.rule3_systemMetadata, name: 'System Metadata' },
    { r: result.qaResults.rule4_placeholderMaterials, name: 'Placeholder Materials' },
    { r: result.qaResults.rule5_orphanDetection, name: 'Orphan Detection' },
    { r: result.qaResults.rule6_connectivity, name: 'MEP Connectivity' },
  ];
  for (const { r } of rules) {
    const icon = r.pass ? '✓' : '✗';
    lines.push(`  ${icon} ${r.ruleName} — ${r.pass ? 'PASS' : 'FAIL'}`);
  }
  lines.push('');

  // Maturity
  lines.push('─── Maturity Scores (SOP 5.3) ───');
  const overallMat = result.maturityScores.length > 0
    ? result.maturityScores.reduce((s, m) => s + m.overallMaturity * m.totalElements, 0)
      / result.maturityScores.reduce((s, m) => s + m.totalElements, 0)
    : 0;
  lines.push(`  Overall: ${overallMat.toFixed(1)}%`);
  const countsOnly = result.maturityScores.filter(m => m.quantityMode === 'COUNTS_ONLY');
  if (countsOnly.length > 0) {
    lines.push(`  COUNTS_ONLY categories (${countsOnly.length}): ${countsOnly.map(m => m.category).join(', ')}`);
  }
  lines.push('');

  // Model Drop Gate
  const gate = checkModelDropGate(result.qaResults);
  lines.push('─── Model Drop Gate (SOP Part 2) ───');
  lines.push(`  Result: ${gate.accepted ? 'ACCEPTED' : 'BLOCKED'}`);
  for (const g of gate.gateChecks) {
    const icon = g.passed ? '✓' : '✗';
    lines.push(`  ${icon} ${g.gate}: ${g.actual}`);
  }

  // Gaps
  lines.push('');
  lines.push(`─── Gaps: ${result.gaps.length} ───`);
  for (const gap of result.gaps.slice(0, 10)) {
    lines.push(`  [${gap.type}] ${gap.description}`);
  }
  if (result.gaps.length > 10) {
    lines.push(`  ... and ${result.gaps.length - 10} more`);
  }

  return lines.join('\n');
}
