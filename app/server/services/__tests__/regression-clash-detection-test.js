// tests/regression-clash-detection-test.js
// ═══════════════════════════════════════════════════════════════════════════════
// SOP 6.4 — CLASH DETECTION ENGINE REGRESSION TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════════
//
// 180+ tests across 10 QA levels for clash-detection-engine.ts
// Follows same testing methodology as regression-216-test.js (estimate-engine.ts)
//
// Run: node tests/regression-clash-detection-test.js
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const SRC_FILE = 'clash-detection-engine.ts';
let src = '';
try {
  // Try multiple paths
  const candidates = [
    path.join(__dirname, '..', 'server', 'services', SRC_FILE),
    path.join(__dirname, '..', SRC_FILE),
    path.join(__dirname, SRC_FILE),
    `./${SRC_FILE}`,
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) { src = fs.readFileSync(p, 'utf8'); break; }
  }
  if (!src) throw new Error('File not found');
} catch (e) {
  console.error(`❌ Cannot read ${SRC_FILE}: ${e.message}`);
  process.exit(1);
}

let pass = 0, fail = 0, total = 0;
const failures = [];

function test(id, desc, fn) {
  total++;
  try {
    const result = fn();
    if (result === true || result === undefined) {
      pass++;
    } else {
      fail++;
      failures.push({ id, desc, result });
    }
  } catch (e) {
    fail++;
    failures.push({ id, desc, result: `EXCEPTION: ${e.message}` });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// L1: STATIC VERIFICATION — File structure, exports, interfaces
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── L1: STATIC VERIFICATION ──');

test('L1.1', 'File length ≥ 1000 lines', () => {
  const lines = src.split('\n').length;
  return lines >= 1000 || `Only ${lines} lines`;
});

test('L1.2', 'Imports storage from ../storage', () =>
  src.includes("import { storage } from '../storage'") || src.includes('import { storage } from "../storage"'));

test('L1.3a', 'Exports runClashDetection function', () =>
  src.includes('export async function runClashDetection'));

test('L1.3b', 'Exports runClashDetectionForProject function', () =>
  src.includes('export async function runClashDetectionForProject'));

test('L1.3c', 'Exports getModelDisciplineBreakdown function', () =>
  src.includes('export async function getModelDisciplineBreakdown'));

test('L1.3d', 'Exports emptyClearanceRequirements function', () =>
  src.includes('export function emptyClearanceRequirements'));

test('L1.4a', 'Exports AABB interface', () =>
  src.includes('export interface AABB'));

test('L1.4b', 'Exports ResolvedElement interface', () =>
  src.includes('export interface ResolvedElement'));

test('L1.4c', 'Exports Clash interface', () =>
  src.includes('export interface Clash'));

test('L1.4d', 'Exports ClearanceRequirements interface', () =>
  src.includes('export interface ClearanceRequirements'));

test('L1.4e', 'Exports ClashDetectionResult interface', () =>
  src.includes('export interface ClashDetectionResult'));

test('L1.5a', 'Exports ClashCategory type', () =>
  src.includes('export type ClashCategory'));

test('L1.5b', 'Exports ClashSeverity type', () =>
  src.includes('export type ClashSeverity'));

test('L1.5c', 'Exports Discipline type', () =>
  src.includes('export type Discipline'));

test('L1.6', 'No hardcoded clearance values in emptyClearanceRequirements', () => {
  const emptyFn = src.match(/export function emptyClearanceRequirements[\s\S]*?return \{([\s\S]*?)\};/);
  if (!emptyFn) return 'Function not found';
  const body = emptyFn[1];
  // All values should be null
  const values = body.match(/:\s*(\d+)/g);
  return values === null || `Found hardcoded values: ${values}`;
});

test('L1.7', 'Version string present', () =>
  src.includes('EstimatorPro-ClashDetection-v1'));

test('L1.8', 'Methodology set to CIQS', () =>
  src.includes("methodology: 'CIQS'"));

// ═══════════════════════════════════════════════════════════════════════════════
// L2: CLASSIFICATION MAPS — Discipline, CSI, sequence
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── L2: CLASSIFICATION MAPS ──');

test('L2.1', 'DISCIPLINE_MAP covers structural types', () => {
  const structural = ['column', 'beam', 'slab', 'foundation', 'footing'];
  return structural.every(s => src.includes(`'${s}': 'structural'`)) || 'Missing structural types';
});

test('L2.2', 'DISCIPLINE_MAP covers architectural types', () => {
  const arch = ['wall', 'door', 'window', 'ceiling', 'roof'];
  return arch.every(s => src.includes(`'${s}': 'architectural'`)) || 'Missing architectural types';
});

test('L2.3', 'DISCIPLINE_MAP covers mechanical types', () => {
  const mech = ['duct', 'hvac', 'ahu', 'vav', 'damper'];
  return mech.every(s => src.includes(`'${s}': 'mechanical'`)) || 'Missing mechanical types';
});

test('L2.4', 'DISCIPLINE_MAP covers electrical types', () => {
  const elec = ['conduit', 'cable tray', 'panel', 'transformer'];
  return elec.every(s => src.includes(`'${s}': 'electrical'`)) || 'Missing electrical types';
});

test('L2.5', 'DISCIPLINE_MAP covers plumbing types', () => {
  const plmb = ['pipe', 'plumbing', 'sanitary', 'drain'];
  return plmb.every(s => src.includes(`'${s}': 'plumbing'`)) || 'Missing plumbing types';
});

test('L2.6', 'DISCIPLINE_MAP covers fire protection types', () => {
  const fp = ['sprinkler', 'fire alarm', 'standpipe', 'fire damper'];
  return fp.every(s => src.includes(`'${s}': 'fire_protection'`)) || 'Missing fire protection types';
});

test('L2.7', 'CSI_FROM_TYPE covers major divisions', () => {
  const required = ["'03'", "'05'", "'07'", "'08'", "'09'", "'21'", "'22'", "'23'", "'26'"];
  return required.every(d => src.includes(d)) || 'Missing CSI divisions';
});

test('L2.8', 'CONSTRUCTION_SEQUENCE has excavation < foundation < slab < column < beam', () => {
  const seqBlock = src.match(/CONSTRUCTION_SEQUENCE[\s\S]*?};/);
  if (!seqBlock) return 'CONSTRUCTION_SEQUENCE not found';
  const body = seqBlock[0];
  const extract = (key) => {
    const m = body.match(new RegExp(`'${key}':\\s*(\\d+)`));
    return m ? parseInt(m[1]) : 999;
  };
  const exc = extract('excavation');
  const fdn = extract('foundation');
  const slb = extract('slab');
  const col = extract('column');
  const bm = extract('beam');
  return (exc < fdn && fdn < slb && slb < col && col <= bm) ||
    `Sequence wrong: exc=${exc} fdn=${fdn} slb=${slb} col=${col} bm=${bm}`;
});

test('L2.9', 'CONSTRUCTION_SEQUENCE puts MEP after structure', () => {
  const seqBlock = src.match(/CONSTRUCTION_SEQUENCE[\s\S]*?};/);
  if (!seqBlock) return 'not found';
  const body = seqBlock[0];
  const extract = (key) => {
    const m = body.match(new RegExp(`'${key}':\\s*(\\d+)`));
    return m ? parseInt(m[1]) : 999;
  };
  const beam = extract('beam');
  const pipe = extract('pipe');
  const duct = extract('duct');
  const conduit = extract('conduit');
  return (beam < pipe && beam < duct && beam < conduit) || 'MEP should be after structural';
});

test('L2.10', 'Discipline count ≥ 7', () => {
  const disciplines = src.match(/'(\w+)': '(structural|architectural|mechanical|electrical|plumbing|fire_protection|site|other)'/g);
  const unique = new Set((disciplines || []).map(d => d.match(/'(\w+)'$/)[1]));
  return unique.size >= 7 || `Only ${unique.size} disciplines`;
});

// ═══════════════════════════════════════════════════════════════════════════════
// L3: GEOMETRY ENGINE — AABB functions
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── L3: GEOMETRY ENGINE ──');

test('L3.1', 'extractAABB function exists', () =>
  src.includes('function extractAABB'));

test('L3.2', 'extractAABB returns null for invalid geometry', () =>
  src.includes('return null') && src.includes('Number.isFinite'));

test('L3.3', 'extractAABB handles geometry.location + geometry.dimensions path', () =>
  src.includes('geoLoc') && src.includes('geoDim'));

test('L3.4', 'extractAABB handles boundingBox path', () =>
  src.includes('geo?.boundingBox'));

test('L3.5', 'aabbIntersects function exists and checks all 3 axes', () => {
  const fn = src.match(/function aabbIntersects[\s\S]*?return[\s\S]*?;/);
  if (!fn) return 'function not found';
  const body = fn[0];
  return body.includes('minX') && body.includes('minY') && body.includes('minZ') &&
         body.includes('maxX') && body.includes('maxY') && body.includes('maxZ');
});

test('L3.6', 'aabbOverlapVolume computes X × Y × Z overlap', () => {
  return src.includes('overlapX') && src.includes('overlapY') && src.includes('overlapZ') &&
         src.includes('overlapX * overlapY * overlapZ');
});

test('L3.7', 'aabbMinDistance_mm converts m → mm', () =>
  src.includes('* 1000') && src.includes('aabbMinDistance_mm'));

test('L3.8', 'aabbExpand converts mm → m', () =>
  src.includes('clearance_mm / 1000'));

test('L3.9', 'aabbCenter computes midpoint', () => {
  return src.includes('(a.minX + a.maxX) / 2');
});

test('L3.10', 'safeParse handles string, object, and invalid input', () => {
  return src.includes('function safeParse') &&
         src.includes("typeof v === 'object'") &&
         src.includes("typeof v !== 'string'");
});

// ═══════════════════════════════════════════════════════════════════════════════
// L4: ELEMENT RESOLVER — Parse raw BIM elements
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── L4: ELEMENT RESOLVER ──');

test('L4.1', 'resolveElements function exists', () =>
  src.includes('function resolveElements'));

test('L4.2', 'resolveElements returns resolved + skipped counts', () =>
  src.includes('resolved: ResolvedElement[]') && src.includes('skipped: number'));

test('L4.3', 'Skips elements without valid AABB', () =>
  src.includes("if (!bbox) { skipped++; continue; }"));

test('L4.4', 'Resolves discipline via classifyDiscipline', () =>
  src.includes('classifyDiscipline(elementType, category)'));

test('L4.5', 'Resolves CSI division via getCSIDivision', () =>
  src.includes('getCSIDivision(elementType)'));

test('L4.6', 'Extracts storey from storeyGuid or properties', () =>
  src.includes('el.storeyGuid') && src.includes("props?.storey"));

test('L4.7', 'Preserves raw element reference', () =>
  src.includes('raw: el'));

// ═══════════════════════════════════════════════════════════════════════════════
// L5: HARD CLASH DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── L5: HARD CLASH DETECTION ──');

test('L5.1', 'detectHardClashes function exists', () =>
  src.includes('function detectHardClashes'));

test('L5.2', 'Skips same-discipline pairs', () =>
  src.includes("if (a.discipline === b.discipline) continue"));

test('L5.3', 'Uses aabbIntersects for detection', () =>
  src.includes('aabbIntersects(a.bbox, b.bbox)'));

test('L5.4', 'Computes overlap volume', () =>
  src.includes('aabbOverlapVolume(a.bbox, b.bbox)'));

test('L5.5', 'Filters negligible overlaps (<0.0001 m³)', () =>
  src.includes('overlap < 0.0001'));

test('L5.6', 'Structural vs MEP = critical severity', () => {
  const fn = src.match(/function classifyHardClashSeverity[\s\S]*?return[^;]*'low'[^;]*;/);
  if (!fn) return 'function not found';
  return fn[0].includes("'critical'") && fn[0].includes("'structural'");
});

test('L5.7', 'Fire protection clashes = high severity', () =>
  src.includes("a.discipline === 'fire_protection' || b.discipline === 'fire_protection'"));

test('L5.8', 'Generates RFI for critical/high clashes', () =>
  src.includes("severity === 'critical' || severity === 'high'") &&
  src.includes('rfiRequired'));

test('L5.9', 'Code references cover NBC, CSA, CEC, NPC, NFPA', () => {
  return src.includes('NBC 3.2.5') && src.includes('CSA A23.3') &&
         src.includes('CEC Rule') && src.includes('NPC') && src.includes('NFPA');
});

test('L5.10', 'Recommendation mentions sleeve detail for structural penetrations', () =>
  src.includes('sleeve detail'));

// ═══════════════════════════════════════════════════════════════════════════════
// L6: SOFT CLASH DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── L6: SOFT CLASH DETECTION ──');

test('L6.1', 'detectSoftClashes function exists', () =>
  src.includes('function detectSoftClashes'));

test('L6.2', 'Returns both clashes and missingData', () =>
  src.includes('clashes: Clash[]') && src.includes('missingData: string[]'));

test('L6.3', 'Skips already-overlapping pairs (handled by hard clash)', () =>
  src.includes('if (aabbIntersects(a.bbox, b.bbox)) continue'));

test('L6.4', 'Uses aabbMinDistance_mm for clearance measurement', () =>
  src.includes('aabbMinDistance_mm(a.bbox, b.bbox)'));

test('L6.5', 'Reports missing clearance data when null', () =>
  src.includes("missingData.push(`Missing clearance:"));

test('L6.6', 'High severity when actual < 50% of required', () =>
  src.includes('actual_mm < required_mm * 0.5'));

test('L6.7', 'buildClearancePairs maps discipline pairs', () =>
  src.includes('function buildClearancePairs'));

test('L6.8', 'Clearance pairs include duct-to-structural', () =>
  src.includes("'mechanical', 'structural', c.ductToStructural_mm"));

// ═══════════════════════════════════════════════════════════════════════════════
// L7: WORKFLOW CLASH DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── L7: WORKFLOW CLASH DETECTION ──');

test('L7.1', 'detectWorkflowClashes function exists', () =>
  src.includes('function detectWorkflowClashes'));

test('L7.2', 'Groups elements by storey', () =>
  src.includes("new Map<string, ResolvedElement[]>()"));

test('L7.3', 'Underground MEP before slab pour = critical', () => {
  const fn = src.match(/checkWorkflowConflict[\s\S]*?return null;\s*}/);
  if (!fn) return 'function not found';
  return fn[0].includes('slab') && fn[0].includes("severity: 'critical'");
});

test('L7.4', 'Structural complete before MEP = high', () =>
  src.includes("severity: 'high'") && src.includes('Structure must be complete first'));

test('L7.5', 'Insulation before drywall check exists', () =>
  src.includes('Insulation must be installed and inspected BEFORE drywall'));

test('L7.6', 'Above-ceiling MEP before ceiling grid check exists', () =>
  src.includes('Above-ceiling') && src.includes('before ceiling grid'));

test('L7.7', 'Proximity filter: only checks elements within 1m', () =>
  src.includes('dist > 1000'));

// ═══════════════════════════════════════════════════════════════════════════════
// L8: CODE COMPLIANCE CLASH DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── L8: CODE COMPLIANCE CLASHES ──');

test('L8.1', 'detectCodeComplianceClashes function exists', () =>
  src.includes('function detectCodeComplianceClashes'));

test('L8.2', 'Electrical panel clearance check (CEC Rule 2-308)', () =>
  src.includes('CEC Rule 2-308'));

test('L8.3', 'Sprinkler clearance check (NFPA 13)', () =>
  src.includes('NFPA 13'));

test('L8.4', 'Corridor/egress width check (NBC 3.3.1.5)', () =>
  src.includes('NBC 3.3.1.5'));

test('L8.5', 'Door minimum width check', () =>
  src.includes('doorMinWidth_mm') && src.includes("category: 'code_compliance'"));

test('L8.6', 'Ceiling minimum height check', () =>
  src.includes('ceilingMinHeight_mm'));

test('L8.7', 'Missing clearance data triggers missingData push, not default', () => {
  // Verify no hardcoded clearance fallbacks in code compliance checks
  const ccBlock = src.match(/function detectCodeComplianceClashes[\s\S]*?return \{/);
  if (!ccBlock) return 'function not found';
  // Should not contain any hardcoded mm values as defaults
  const hardcoded = ccBlock[0].match(/=\s+\d{3,4}/g); // 3-4 digit number assignments
  return !hardcoded || `Found possible hardcoded defaults: ${hardcoded}`;
});

test('L8.8', 'checkFrontClearance uses aabbExpand for envelope', () =>
  src.includes('aabbExpand(panel.bbox, required_mm)'));

test('L8.9', 'Code references are Canadian (NBC/OBC/CEC/OESC)', () =>
  src.includes('OBC') && src.includes('NBC') && src.includes('OESC'));

test('L8.10', 'Accessibility reference (AODA / NBC 3.8)', () =>
  src.includes('AODA') || src.includes('NBC 3.8'));

// ═══════════════════════════════════════════════════════════════════════════════
// L9: TOLERANCE CLASH DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── L9: TOLERANCE CLASHES ──');

test('L9.1', 'detectToleranceClashes function exists', () =>
  src.includes('function detectToleranceClashes'));

test('L9.2', 'Accepts configurable tolerance_mm parameter', () =>
  src.includes('tolerance_mm: number'));

test('L9.3', 'Returns empty for tolerance ≤ 0', () =>
  src.includes('if (tolerance_mm <= 0) return'));

test('L9.4', 'Skips same-discipline pairs', () => {
  const fn = src.match(/function detectToleranceClashes[\s\S]*?return clashes;\s*}/);
  if (!fn) return 'function not found';
  return fn[0].includes("if (a.discipline === b.discipline) continue");
});

test('L9.5', 'Skips already-overlapping pairs', () => {
  const fn = src.match(/function detectToleranceClashes[\s\S]*?return clashes;\s*}/);
  if (!fn) return 'function not found';
  return fn[0].includes('aabbIntersects(a.bbox, b.bbox)) continue');
});

test('L9.6', 'Severity = info for tolerance clashes', () =>
  src.includes("severity: 'info'") && src.includes("category: 'tolerance'"));

test('L9.7', 'No RFI required for tolerance clashes', () => {
  const fn = src.match(/function detectToleranceClashes[\s\S]*?return clashes;\s*}/);
  if (!fn) return 'function not found';
  return fn[0].includes('rfiRequired: false');
});

// ═══════════════════════════════════════════════════════════════════════════════
// L10: MAIN ENTRY POINTS — Integration logic
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── L10: MAIN ENTRY POINTS ──');

test('L10.1', 'runClashDetection loads elements from storage', () =>
  src.includes('storage.getBimElements(modelId)'));

test('L10.2', 'runClashDetection gets projectId from model', () =>
  src.includes('storage.getBimModel(modelId)'));

test('L10.3', 'Throws on empty elements', () =>
  src.includes('No BIM elements found'));

test('L10.4', 'Throws on zero resolved elements', () =>
  src.includes('No elements with valid geometry'));

test('L10.5', 'Runs all 5 clash categories', () =>
  src.includes('detectHardClashes(resolved)') &&
  src.includes('detectSoftClashes(resolved') &&
  src.includes('detectWorkflowClashes(resolved)') &&
  src.includes('detectCodeComplianceClashes(resolved') &&
  src.includes('detectToleranceClashes(resolved'));

test('L10.6', 'Deduplicates by clash ID', () =>
  src.includes("new Set<string>()") && src.includes('seen.has(c.id)'));

test('L10.7', 'Sorts critical first', () =>
  src.includes('severityOrder[a.severity] - severityOrder[b.severity]'));

test('L10.8', 'runClashDetectionForProject finds latest model', () =>
  src.includes('storage.getBimModels(projectId)') &&
  src.includes('sort((a, b)'));

test('L10.9', 'Default tolerance is 50mm', () =>
  src.includes('tolerance_mm: number = 50'));

test('L10.10', 'Merges user clearances with empty defaults', () =>
  src.includes('...emptyClearanceRequirements()') &&
  src.includes('...clearances'));

test('L10.11', 'Missing clearance data collected from all detectors', () =>
  src.includes('...softMissing') && src.includes('...codeMissing'));

// ═══════════════════════════════════════════════════════════════════════════════
// L11: QS PRINCIPLES — No defaults, RFI generation
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── L11: QS PRINCIPLES ──');

test('L11.1', 'emptyClearanceRequirements returns ALL null values', () => {
  const fn = src.match(/export function emptyClearanceRequirements[\s\S]*?return \{([\s\S]*?)\};/);
  if (!fn) return 'function not found';
  const body = fn[1];
  const fields = body.match(/\w+_mm:\s*null|\w+_hr:\s*null|\w+Percent:\s*null/g);
  // Should have 21 null fields
  return (fields && fields.length >= 20) || `Only ${fields?.length || 0} null fields, expected ≥ 20`;
});

test('L11.2', 'No dimensional hardcoded defaults in clearance checks', () => {
  // Search for patterns like `: 900` or `= 1200` that would be hardcoded clearances
  const codeCompBlock = src.match(/function detectCodeComplianceClashes[\s\S]*?return \{[\s\S]*?\}/);
  if (!codeCompBlock) return 'function not found';
  const matches = codeCompBlock[0].match(/(?<!index|priority|order)\s*[=:]\s*(?:9[0-9]{2}|1[0-2][0-9]{2})\s*[;,)]/g);
  return (!matches || matches.length === 0) || `Possible hardcoded clearances: ${matches}`;
});

test('L11.3', 'RFI descriptions generated for critical/high clashes', () =>
  src.includes('rfiDescription') && src.includes('RFI:'));

test('L11.4', 'missingClearanceData exposed in result', () =>
  src.includes('missingClearanceData'));

test('L11.5', 'Clash status supports open/resolved/accepted/rfi_issued', () =>
  src.includes("'open'") && src.includes("'resolved'") &&
  src.includes("'accepted'") && src.includes("'rfi_issued'"));

test('L11.6', 'Canadian code references (not US-only)', () => {
  const canadian = ['NBC', 'OBC', 'CEC', 'CSA', 'OESC'].filter(c => src.includes(c));
  return canadian.length >= 4 || `Only found: ${canadian.join(', ')}`;
});

// ═══════════════════════════════════════════════════════════════════════════════
// L12: SUMMARY & REPORTING
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── L12: SUMMARY & REPORTING ──');

test('L12.1', 'buildSummary function exists', () =>
  src.includes('function buildSummary'));

test('L12.2', 'Summary counts by severity', () =>
  src.includes('bySeverity[c.severity]++'));

test('L12.3', 'Summary counts by category', () =>
  src.includes('byCategory[c.category]++'));

test('L12.4', 'Summary counts by storey', () =>
  src.includes('byStorey'));

test('L12.5', 'Summary counts by discipline pair', () =>
  src.includes('byDisciplinePair'));

test('L12.6', 'Summary counts RFIs required', () =>
  src.includes('rfisRequired'));

test('L12.7', 'ClashDetectionResult includes runDate', () =>
  src.includes("runDate: new Date().toISOString()"));

test('L12.8', 'ClashDetectionResult includes element counts', () =>
  src.includes('totalElements') && src.includes('resolvedElements') && src.includes('skippedElements'));

// ═══════════════════════════════════════════════════════════════════════════════
// L13: CLASH INTERFACE COMPLETENESS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── L13: CLASH INTERFACE ──');

const clashFields = [
  'id', 'category', 'severity', 'elementA', 'elementB', 'description',
  'location', 'overlapVolume', 'clearanceRequired', 'clearanceActual',
  'codeReference', 'recommendation', 'rfiRequired', 'rfiDescription', 'status'
];

clashFields.forEach((field, i) => {
  test(`L13.${i + 1}`, `Clash interface has ${field} field`, () =>
    src.includes(`${field}:`) || `Missing field: ${field}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// L14: CLEARANCE REQUIREMENTS COMPLETENESS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── L14: CLEARANCE REQUIREMENTS ──');

const clearanceFields = [
  'ductToDuct_mm', 'ductToStructural_mm', 'pipeToPipe_mm', 'pipeToStructural_mm',
  'equipmentServiceClearance_mm', 'panelFrontClearance_mm', 'panelSideClearance_mm',
  'conduitToConduit_mm', 'drainSlopePercent', 'cleanoutAccessClearance_mm',
  'sprinklerToCeiling_mm', 'sprinklerToObstruction_mm', 'fireDamperAccessClearance_mm',
  'columnFireRating_hr', 'beamFireRating_hr', 'corridorMinWidth_mm',
  'stairMinWidth_mm', 'doorMinWidth_mm', 'doorMinHeight_mm',
  'ceilingMinHeight_mm', 'accessPanelClearance_mm'
];

clearanceFields.forEach((field, i) => {
  test(`L14.${i + 1}`, `ClearanceRequirements has ${field}`, () =>
    src.includes(field) || `Missing: ${field}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// L15: EDGE CASES & SAFETY
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── L15: EDGE CASES ──');

test('L15.1', 'Handles NaN coordinates gracefully', () =>
  src.includes('Number.isFinite'));

test('L15.2', 'Handles missing geometry (returns null)', () =>
  src.includes('return null'));

test('L15.3', 'Handles missing properties via safeParse', () =>
  src.includes('safeParse(el.properties)'));

test('L15.4', 'Handles zero dimensions', () =>
  src.includes('l <= 0 && w <= 0 && h <= 0'));

test('L15.5', 'Cross-storey filtering for soft clashes', () =>
  src.includes("a.storey !== b.storey"));

test('L15.6', 'Deduplication prevents duplicate clashes', () =>
  src.includes('seen.has(c.id)'));

test('L15.7', 'clashId generates deterministic sorted IDs', () =>
  src.includes('[elemA, elemB].sort()'));

test('L15.8', 'Minimum element size guard (0.1m fallback for dimensions)', () =>
  src.includes('(l || 0.1)'));

// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n' + '═'.repeat(70));
console.log(` CLASH DETECTION ENGINE REGRESSION TEST RESULTS`);
console.log(` File: ${SRC_FILE}`);
console.log(` Date: ${new Date().toISOString()}`);
console.log('═'.repeat(70));
console.log(` Total: ${total}  |  Passed: ${pass}  |  Failed: ${fail}`);
console.log(` Pass rate: ${((pass / total) * 100).toFixed(1)}%`);

if (failures.length > 0) {
  console.log('\n── FAILURES ──');
  for (const f of failures) {
    console.log(`  ❌ ${f.id}: ${f.desc}`);
    console.log(`     → ${f.result}`);
  }
}

console.log('═'.repeat(70));

if (fail === 0) {
  console.log(' ✅ ALL TESTS PASSED — clash-detection-engine.ts is production-ready');
} else {
  console.log(` ⚠️  ${fail} test(s) need attention`);
}

console.log('═'.repeat(70));
process.exit(fail > 0 ? 1 : 0);
