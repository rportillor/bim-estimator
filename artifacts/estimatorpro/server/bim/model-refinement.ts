/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  AI MODEL REFINEMENT — Incremental Model Updates from Revised Drawings
 *  Instead of regenerating the entire model when drawings change, this engine:
 *  - Diffs new drawings against existing model
 *  - Identifies added, modified, deleted, and unchanged elements
 *  - Applies incremental updates preserving user edits
 *  - Tracks revision history per element
 *  - Maintains element identity across revisions (stable IDs)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { BIMSolid, LODLevel, RevisionInfo } from './parametric-elements';
import type { Vec3, AABB } from './geometry-kernel';
import { vec3, v3sub, v3len, v3add } from './geometry-kernel';

// ═══════════════════════════════════════════════════════════════════════════════
//  DIFF TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type ChangeAction = 'added' | 'modified' | 'deleted' | 'unchanged' | 'moved' | 'resized';

export interface ElementDiff {
  elementId: string;
  action: ChangeAction;
  confidence: number;         // 0-1 how confident we are in the match
  matchedToId?: string;       // ID of element this was matched to (for modified/moved)
  changes?: PropertyDiff[];   // specific property changes for modified elements
  previousState?: Partial<BIMSolid>;   // snapshot of prior state
}

export interface PropertyDiff {
  property: string;
  oldValue: any;
  newValue: any;
  significance: 'major' | 'minor' | 'cosmetic';
}

export interface ModelDiffResult {
  revisionNumber: number;
  revisionId: string;
  timestamp: string;
  summary: {
    added: number;
    modified: number;
    deleted: number;
    moved: number;
    resized: number;
    unchanged: number;
    total: number;
  };
  diffs: ElementDiff[];
  unmatched: {
    inOld: string[];          // old elements with no match in new
    inNew: string[];          // new elements with no match in old
  };
  mergeConflicts: MergeConflict[];
}

export interface MergeConflict {
  elementId: string;
  property: string;
  drawingValue: any;          // value from new drawings
  userEditValue: any;         // value from user edits
  originalValue: any;         // value before any edits
  resolution: 'keep_user' | 'keep_drawing' | 'needs_review';
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ELEMENT MATCHING — Find corresponding elements between revisions
// ═══════════════════════════════════════════════════════════════════════════════

interface MatchScore {
  oldId: string;
  newId: string;
  score: number;              // 0-1 match confidence
  reasons: string[];
}

/**
 * Match elements between old and new model using multiple criteria:
 * 1. Same element ID (strongest match)
 * 2. Same IFC GUID
 * 3. Same type + name
 * 4. Same type + similar position + similar dimensions
 */
function matchElements(
  oldElements: BIMSolid[],
  newElements: BIMSolid[],
): Map<string, { matchedId: string; score: number }> {
  const matches = new Map<string, { matchedId: string; score: number }>();
  const usedNewIds = new Set<string>();
  const candidates: MatchScore[] = [];

  // Phase 1: Exact ID matches
  const newById = new Map(newElements.map(e => [e.id, e]));
  for (const old of oldElements) {
    if (newById.has(old.id)) {
      matches.set(old.id, { matchedId: old.id, score: 1.0 });
      usedNewIds.add(old.id);
    }
  }

  // Phase 2: IFC GUID matches
  const newByGuid = new Map(newElements.filter(e => e.ifcGuid).map(e => [e.ifcGuid, e]));
  for (const old of oldElements) {
    if (matches.has(old.id)) continue;
    if (old.ifcGuid && newByGuid.has(old.ifcGuid)) {
      const matched = newByGuid.get(old.ifcGuid)!;
      if (!usedNewIds.has(matched.id)) {
        matches.set(old.id, { matchedId: matched.id, score: 0.95 });
        usedNewIds.add(matched.id);
      }
    }
  }

  // Phase 3: Type + Name matches
  const newByTypeName = new Map<string, BIMSolid[]>();
  for (const el of newElements) {
    if (usedNewIds.has(el.id)) continue;
    const key = `${el.type}|${el.name}`;
    if (!newByTypeName.has(key)) newByTypeName.set(key, []);
    newByTypeName.get(key)!.push(el);
  }

  for (const old of oldElements) {
    if (matches.has(old.id)) continue;
    const key = `${old.type}|${old.name}`;
    const nameMatches = newByTypeName.get(key);
    if (nameMatches && nameMatches.length > 0) {
      // Find closest by position
      let bestMatch: BIMSolid | null = null;
      let bestDist = Infinity;
      for (const nm of nameMatches) {
        if (usedNewIds.has(nm.id)) continue;
        const dist = v3len(v3sub(nm.origin, old.origin));
        if (dist < bestDist) {
          bestDist = dist;
          bestMatch = nm;
        }
      }
      if (bestMatch && bestDist < 5) { // within 5m
        matches.set(old.id, { matchedId: bestMatch.id, score: 0.85 });
        usedNewIds.add(bestMatch.id);
      }
    }
  }

  // Phase 4: Spatial proximity + type matches (fuzzy)
  for (const old of oldElements) {
    if (matches.has(old.id)) continue;

    for (const newEl of newElements) {
      if (usedNewIds.has(newEl.id)) continue;
      if (newEl.type !== old.type) continue;
      if (newEl.storey !== old.storey) continue;

      const dist = v3len(v3sub(newEl.origin, old.origin));
      const dimSimilarity = computeDimensionSimilarity(old, newEl);

      if (dist < 2 && dimSimilarity > 0.7) {
        const score = (1 - dist / 5) * 0.5 + dimSimilarity * 0.5;
        candidates.push({
          oldId: old.id,
          newId: newEl.id,
          score: Math.min(0.8, score),
          reasons: [`type match: ${old.type}`, `distance: ${dist.toFixed(2)}m`, `dim similarity: ${(dimSimilarity * 100).toFixed(0)}%`],
        });
      }
    }
  }

  // Resolve fuzzy matches (best score wins, no double-matching)
  candidates.sort((a, b) => b.score - a.score);
  for (const candidate of candidates) {
    if (matches.has(candidate.oldId) || usedNewIds.has(candidate.newId)) continue;
    matches.set(candidate.oldId, { matchedId: candidate.newId, score: candidate.score });
    usedNewIds.add(candidate.newId);
  }

  return matches;
}

function computeDimensionSimilarity(a: BIMSolid, b: BIMSolid): number {
  const dims: (keyof BIMSolid['quantities'])[] = ['length', 'width', 'height', 'thickness', 'volume'];
  let totalSim = 0;
  let count = 0;

  for (const dim of dims) {
    const va = a.quantities[dim] as number | undefined;
    const vb = b.quantities[dim] as number | undefined;
    if (va != null && vb != null && va > 0 && vb > 0) {
      const ratio = Math.min(va, vb) / Math.max(va, vb);
      totalSim += ratio;
      count++;
    }
  }

  return count > 0 ? totalSim / count : 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PROPERTY DIFFING — Detect specific changes between matched elements
// ═══════════════════════════════════════════════════════════════════════════════

function diffProperties(old: BIMSolid, updated: BIMSolid): PropertyDiff[] {
  const diffs: PropertyDiff[] = [];

  // Position change
  const posDist = v3len(v3sub(updated.origin, old.origin));
  if (posDist > 0.01) {
    diffs.push({
      property: 'origin',
      oldValue: old.origin,
      newValue: updated.origin,
      significance: posDist > 0.5 ? 'major' : 'minor',
    });
  }

  // Rotation change
  if (Math.abs(updated.rotation - old.rotation) > 0.01) {
    diffs.push({
      property: 'rotation',
      oldValue: old.rotation,
      newValue: updated.rotation,
      significance: 'major',
    });
  }

  // Dimension changes
  const dimProps: Array<{ key: keyof BIMSolid['quantities']; name: string }> = [
    { key: 'length', name: 'quantities.length' },
    { key: 'width', name: 'quantities.width' },
    { key: 'height', name: 'quantities.height' },
    { key: 'thickness', name: 'quantities.thickness' },
    { key: 'volume', name: 'quantities.volume' },
    { key: 'surfaceArea', name: 'quantities.surfaceArea' },
  ];

  for (const { key, name } of dimProps) {
    const oldVal = old.quantities[key] as number | undefined;
    const newVal = updated.quantities[key] as number | undefined;
    if (oldVal != null && newVal != null && Math.abs(oldVal - newVal) > 0.001) {
      const ratio = Math.abs(oldVal - newVal) / Math.max(oldVal, 0.001);
      diffs.push({
        property: name,
        oldValue: oldVal,
        newValue: newVal,
        significance: ratio > 0.1 ? 'major' : 'minor',
      });
    }
  }

  // Material change
  if (old.material !== updated.material) {
    diffs.push({
      property: 'material',
      oldValue: old.material,
      newValue: updated.material,
      significance: 'major',
    });
  }

  // Storey change
  if (old.storey !== updated.storey) {
    diffs.push({
      property: 'storey',
      oldValue: old.storey,
      newValue: updated.storey,
      significance: 'major',
    });
  }

  // Name change
  if (old.name !== updated.name) {
    diffs.push({
      property: 'name',
      oldValue: old.name,
      newValue: updated.name,
      significance: 'cosmetic',
    });
  }

  return diffs;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MODEL DIFF — Compare old and new model
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compare two sets of BIM elements and produce a detailed diff.
 */
export function diffModels(
  oldElements: BIMSolid[],
  newElements: BIMSolid[],
  revisionNumber: number,
  revisionId: string,
): ModelDiffResult {
  const matches = matchElements(oldElements, newElements);
  const diffs: ElementDiff[] = [];

  const oldById = new Map(oldElements.map(e => [e.id, e]));
  const newById = new Map(newElements.map(e => [e.id, e]));
  const matchedNewIds = new Set<string>();

  // Process matched elements
  for (const [oldId, match] of matches) {
    matchedNewIds.add(match.matchedId);
    const oldEl = oldById.get(oldId)!;
    const newEl = newById.get(match.matchedId)!;

    const propDiffs = diffProperties(oldEl, newEl);

    if (propDiffs.length === 0) {
      diffs.push({
        elementId: oldId,
        action: 'unchanged',
        confidence: match.score,
        matchedToId: match.matchedId,
      });
    } else {
      // Classify the change
      const hasMajorDims = propDiffs.some(d => d.property.startsWith('quantities.') && d.significance === 'major');
      const hasPositionChange = propDiffs.some(d => d.property === 'origin');
      const hasOnlyPositionChange = propDiffs.length === 1 && hasPositionChange;

      let action: ChangeAction = 'modified';
      if (hasOnlyPositionChange) action = 'moved';
      else if (hasMajorDims && !hasPositionChange) action = 'resized';

      diffs.push({
        elementId: oldId,
        action,
        confidence: match.score,
        matchedToId: match.matchedId,
        changes: propDiffs,
        previousState: {
          origin: oldEl.origin,
          rotation: oldEl.rotation,
          quantities: { ...oldEl.quantities },
          material: oldEl.material,
          storey: oldEl.storey,
          name: oldEl.name,
        },
      });
    }
  }

  // Deleted elements (in old but not matched)
  const unmatchedOld: string[] = [];
  for (const old of oldElements) {
    if (!matches.has(old.id)) {
      diffs.push({
        elementId: old.id,
        action: 'deleted',
        confidence: 1.0,
        previousState: {
          origin: old.origin,
          rotation: old.rotation,
          quantities: { ...old.quantities },
          material: old.material,
          storey: old.storey,
          name: old.name,
        },
      });
      unmatchedOld.push(old.id);
    }
  }

  // Added elements (in new but not matched)
  const unmatchedNew: string[] = [];
  for (const newEl of newElements) {
    if (!matchedNewIds.has(newEl.id)) {
      diffs.push({
        elementId: newEl.id,
        action: 'added',
        confidence: 1.0,
      });
      unmatchedNew.push(newEl.id);
    }
  }

  // Summary
  const summary = {
    added: diffs.filter(d => d.action === 'added').length,
    modified: diffs.filter(d => d.action === 'modified').length,
    deleted: diffs.filter(d => d.action === 'deleted').length,
    moved: diffs.filter(d => d.action === 'moved').length,
    resized: diffs.filter(d => d.action === 'resized').length,
    unchanged: diffs.filter(d => d.action === 'unchanged').length,
    total: diffs.length,
  };

  return {
    revisionNumber,
    revisionId,
    timestamp: new Date().toISOString(),
    summary,
    diffs,
    unmatched: { inOld: unmatchedOld, inNew: unmatchedNew },
    mergeConflicts: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MERGE ENGINE — Apply incremental updates while preserving user edits
// ═══════════════════════════════════════════════════════════════════════════════

export interface MergeOptions {
  preserveUserEdits: boolean;       // keep user-modified properties over drawing changes
  autoAcceptMinorChanges: boolean;  // automatically apply minor/cosmetic changes
  deleteRemovedElements: boolean;   // actually delete or just mark as demolished
  updateRevisionInfo: boolean;      // update revision tracking on elements
}

const DEFAULT_MERGE_OPTIONS: MergeOptions = {
  preserveUserEdits: true,
  autoAcceptMinorChanges: true,
  deleteRemovedElements: false,
  updateRevisionInfo: true,
};

/**
 * Merge new model data into existing model, preserving user edits.
 */
export function mergeModels(
  existingElements: BIMSolid[],
  newElements: BIMSolid[],
  userEditedProperties: Map<string, Set<string>>,  // elementId → set of user-edited property paths
  revisionNumber: number,
  revisionId: string,
  options: Partial<MergeOptions> = {},
): {
  mergedElements: BIMSolid[];
  diffResult: ModelDiffResult;
  appliedChanges: number;
  preservedEdits: number;
  conflicts: MergeConflict[];
} {
  const opts = { ...DEFAULT_MERGE_OPTIONS, ...options };
  const diff = diffModels(existingElements, newElements, revisionNumber, revisionId);

  const existingMap = new Map(existingElements.map(e => [e.id, e]));
  const newMap = new Map(newElements.map(e => [e.id, e]));
  const mergedElements: BIMSolid[] = [];
  const conflicts: MergeConflict[] = [];
  let appliedChanges = 0;
  let preservedEdits = 0;

  for (const d of diff.diffs) {
    switch (d.action) {
      case 'unchanged': {
        const el = existingMap.get(d.elementId);
        if (el) {
          if (opts.updateRevisionInfo) {
            el.revision = {
              revisionNumber,
              revisionId,
              action: 'unchanged',
              modifiedAt: new Date().toISOString(),
            };
          }
          mergedElements.push(el);
        }
        break;
      }

      case 'modified':
      case 'moved':
      case 'resized': {
        const existing = existingMap.get(d.elementId);
        const updated = d.matchedToId ? newMap.get(d.matchedToId) : null;
        if (!existing) break;

        const userEdits = userEditedProperties.get(d.elementId);

        if (d.changes) {
          for (const change of d.changes) {
            const isUserEdited = userEdits?.has(change.property);

            if (isUserEdited && opts.preserveUserEdits) {
              // Conflict: drawing changed something the user also edited
              conflicts.push({
                elementId: d.elementId,
                property: change.property,
                drawingValue: change.newValue,
                userEditValue: getProperty(existing, change.property),
                originalValue: change.oldValue,
                resolution: 'keep_user',
              });
              preservedEdits++;
            } else if (change.significance === 'cosmetic' || (change.significance === 'minor' && opts.autoAcceptMinorChanges)) {
              // Auto-apply minor changes
              setProperty(existing, change.property, change.newValue);
              appliedChanges++;
            } else {
              // Apply drawing change
              setProperty(existing, change.property, change.newValue);
              appliedChanges++;
            }
          }
        }

        // Update geometry from new element if available
        if (updated && !userEdits?.has('mesh')) {
          existing.mesh = updated.mesh;
          existing.boundingBox = updated.boundingBox;
          existing.serialized = undefined; // force re-serialization
        }

        if (opts.updateRevisionInfo) {
          existing.revision = {
            revisionNumber,
            revisionId,
            action: (d.action === 'moved' || d.action === 'resized') ? 'modified' : d.action as 'added' | 'modified' | 'deleted' | 'unchanged',
            modifiedAt: new Date().toISOString(),
          };
        }

        mergedElements.push(existing);
        break;
      }

      case 'deleted': {
        const existing = existingMap.get(d.elementId);
        if (!existing) break;

        if (opts.deleteRemovedElements) {
          if (opts.updateRevisionInfo) {
            existing.revision = {
              revisionNumber,
              revisionId,
              action: 'deleted',
              modifiedAt: new Date().toISOString(),
            };
          }
          // Don't add to merged (effectively deleted)
        } else {
          // Mark as demolished but keep in model
          if (existing.phase) {
            existing.phase.demolishedPhase = `Rev ${revisionNumber}`;
          }
          if (opts.updateRevisionInfo) {
            existing.revision = {
              revisionNumber,
              revisionId,
              action: 'deleted',
              modifiedAt: new Date().toISOString(),
            };
          }
          mergedElements.push(existing);
        }
        break;
      }

      case 'added': {
        const newEl = newMap.get(d.elementId);
        if (newEl) {
          if (opts.updateRevisionInfo) {
            newEl.revision = {
              revisionNumber,
              revisionId,
              action: 'added',
              modifiedAt: new Date().toISOString(),
            };
          }
          mergedElements.push(newEl);
          appliedChanges++;
        }
        break;
      }
    }
  }

  diff.mergeConflicts = conflicts;

  return {
    mergedElements,
    diffResult: diff,
    appliedChanges,
    preservedEdits,
    conflicts,
  };
}

function getProperty(obj: any, path: string): any {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function setProperty(obj: any, path: string, value: any): void {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] == null) current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  REVISION REPORT — Human-readable summary
// ═══════════════════════════════════════════════════════════════════════════════

export interface RevisionReport {
  revisionNumber: number;
  revisionId: string;
  timestamp: string;
  summary: string;
  statistics: ModelDiffResult['summary'];
  changes: Array<{
    elementName: string;
    elementType: string;
    action: ChangeAction;
    details: string;
  }>;
  conflicts: Array<{
    elementId: string;
    property: string;
    description: string;
    resolution: string;
  }>;
}

export function generateRevisionReport(diff: ModelDiffResult, elements: Map<string, BIMSolid>): RevisionReport {
  const changes: RevisionReport['changes'] = [];

  for (const d of diff.diffs) {
    if (d.action === 'unchanged') continue;

    const el = elements.get(d.elementId) || elements.get(d.matchedToId || '');
    const name = el?.name || d.elementId;
    const type = el?.type || 'Unknown';

    let details = '';
    switch (d.action) {
      case 'added':
        details = 'New element added to model';
        break;
      case 'deleted':
        details = 'Element removed from model';
        break;
      case 'moved':
        details = d.changes?.filter(c => c.property === 'origin')
          .map(c => `Moved from (${formatVec(c.oldValue)}) to (${formatVec(c.newValue)})`)
          .join('; ') || 'Position changed';
        break;
      case 'resized':
        details = d.changes?.filter(c => c.property.startsWith('quantities.'))
          .map(c => `${c.property.split('.')[1]}: ${formatNum(c.oldValue)} → ${formatNum(c.newValue)}`)
          .join(', ') || 'Dimensions changed';
        break;
      case 'modified':
        details = d.changes?.map(c => `${c.property}: changed`)
          .join(', ') || 'Properties modified';
        break;
    }

    changes.push({ elementName: name, elementType: type, action: d.action, details });
  }

  const conflictReport = diff.mergeConflicts.map(c => ({
    elementId: c.elementId,
    property: c.property,
    description: `Drawing value: ${JSON.stringify(c.drawingValue)}, User edit: ${JSON.stringify(c.userEditValue)}`,
    resolution: c.resolution === 'keep_user' ? 'Kept user edit' :
                c.resolution === 'keep_drawing' ? 'Applied drawing change' :
                'Needs manual review',
  }));

  return {
    revisionNumber: diff.revisionNumber,
    revisionId: diff.revisionId,
    timestamp: diff.timestamp,
    summary: `Revision ${diff.revisionNumber}: ${diff.summary.added} added, ${diff.summary.modified + diff.summary.moved + diff.summary.resized} modified, ${diff.summary.deleted} deleted, ${diff.summary.unchanged} unchanged`,
    statistics: diff.summary,
    changes,
    conflicts: conflictReport,
  };
}

function formatVec(v: any): string {
  if (v && typeof v === 'object' && 'x' in v) {
    return `${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}`;
  }
  return String(v);
}

function formatNum(n: any): string {
  if (typeof n === 'number') {
    return n >= 1 ? `${n.toFixed(2)}m` : `${(n * 1000).toFixed(0)}mm`;
  }
  return String(n);
}
