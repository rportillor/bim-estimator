/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  PARAMETER ENGINE — Live Parameter Editing with Constraints & Transactions
 *  Provides:
 *  - Transaction-based undo/redo system
 *  - Parameter propagation (move wall → doors/windows move with it)
 *  - Constraint solver (wall-to-wall joins, beam-column connections)
 *  - Property change tracking and validation
 *  - Element hosting relationships (doors in walls, fixtures on floors)
 *  All dimensions in metres. Z-up coordinate system.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { BIMSolid, LODLevel } from './parametric-elements';
import type { Vec3 } from './geometry-kernel';
import { vec3, v3add, v3sub, v3len, v3scale } from './geometry-kernel';

// ═══════════════════════════════════════════════════════════════════════════════
//  TRANSACTION SYSTEM — Atomic undo/redo with change tracking
// ═══════════════════════════════════════════════════════════════════════════════

export interface PropertyChange {
  elementId: string;
  property: string;         // dot-path: e.g. "quantities.height", "origin.x", "material"
  oldValue: any;
  newValue: any;
}

export interface Transaction {
  id: string;
  timestamp: string;        // ISO 8601
  userId: string;
  description: string;
  changes: PropertyChange[];
  propagatedChanges: PropertyChange[];   // changes auto-applied by constraints
}

export interface TransactionStack {
  undoStack: Transaction[];
  redoStack: Transaction[];
  maxSize: number;
}

export function createTransactionStack(maxSize: number = 100): TransactionStack {
  return { undoStack: [], redoStack: [], maxSize };
}

export function beginTransaction(
  stack: TransactionStack,
  id: string,
  userId: string,
  description: string,
): Transaction {
  const tx: Transaction = {
    id,
    timestamp: new Date().toISOString(),
    userId,
    description,
    changes: [],
    propagatedChanges: [],
  };
  return tx;
}

export function recordChange(tx: Transaction, change: PropertyChange): void {
  tx.changes.push(change);
}

export function commitTransaction(stack: TransactionStack, tx: Transaction): void {
  stack.undoStack.push(tx);
  stack.redoStack = []; // clear redo on new commit
  if (stack.undoStack.length > stack.maxSize) {
    stack.undoStack.shift();
  }
}

export function canUndo(stack: TransactionStack): boolean {
  return stack.undoStack.length > 0;
}

export function canRedo(stack: TransactionStack): boolean {
  return stack.redoStack.length > 0;
}

export function undoTransaction(
  stack: TransactionStack,
  elements: Map<string, BIMSolid>,
): Transaction | null {
  const tx = stack.undoStack.pop();
  if (!tx) return null;

  // Apply changes in reverse
  const allChanges = [...tx.propagatedChanges, ...tx.changes].reverse();
  for (const change of allChanges) {
    const el = elements.get(change.elementId);
    if (el) setNestedProperty(el, change.property, change.oldValue);
  }

  stack.redoStack.push(tx);
  return tx;
}

export function redoTransaction(
  stack: TransactionStack,
  elements: Map<string, BIMSolid>,
): Transaction | null {
  const tx = stack.redoStack.pop();
  if (!tx) return null;

  // Apply changes forward
  const allChanges = [...tx.changes, ...tx.propagatedChanges];
  for (const change of allChanges) {
    const el = elements.get(change.elementId);
    if (el) setNestedProperty(el, change.property, change.newValue);
  }

  stack.undoStack.push(tx);
  return tx;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PROPERTY ACCESS — Deep get/set with dot-path notation
// ═══════════════════════════════════════════════════════════════════════════════

function getNestedProperty(obj: any, path: string): any {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function setNestedProperty(obj: any, path: string, value: any): void {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] == null) current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PARAMETER PROPAGATION — Cascading changes through relationships
// ═══════════════════════════════════════════════════════════════════════════════

export interface PropagationRule {
  triggerProperty: string;         // property that triggers propagation
  targetRelation: 'hosted' | 'connected' | 'adjacent';
  targetProperty: string;          // property to update on targets
  transform: 'copy' | 'offset' | 'match' | 'custom';
  customFn?: (oldVal: any, newVal: any, sourceEl: BIMSolid, targetEl: BIMSolid) => any;
}

const DEFAULT_PROPAGATION_RULES: PropagationRule[] = [
  // Moving a wall moves its hosted doors/windows
  {
    triggerProperty: 'origin.x',
    targetRelation: 'hosted',
    targetProperty: 'origin.x',
    transform: 'offset',
  },
  {
    triggerProperty: 'origin.y',
    targetRelation: 'hosted',
    targetProperty: 'origin.y',
    transform: 'offset',
  },
  {
    triggerProperty: 'origin.z',
    targetRelation: 'hosted',
    targetProperty: 'origin.z',
    transform: 'offset',
  },
  // Rotating a wall rotates its hosted elements
  {
    triggerProperty: 'rotation',
    targetRelation: 'hosted',
    targetProperty: 'rotation',
    transform: 'offset',
  },
  // Changing wall height affects hosted elements' heights
  {
    triggerProperty: 'quantities.height',
    targetRelation: 'hosted',
    targetProperty: 'quantities.height',
    transform: 'custom',
    customFn: (_oldVal, newVal, _source, target) => {
      // Door/window heights are independent of wall height
      // but sill height might need adjustment
      return target.quantities.height;
    },
  },
  // Changing storey assignment propagates to hosted elements
  {
    triggerProperty: 'storey',
    targetRelation: 'hosted',
    targetProperty: 'storey',
    transform: 'copy',
  },
  {
    triggerProperty: 'elevation',
    targetRelation: 'hosted',
    targetProperty: 'elevation',
    transform: 'copy',
  },
  // Material change on wall section propagates (connected walls match material)
  {
    triggerProperty: 'material',
    targetRelation: 'connected',
    targetProperty: 'material',
    transform: 'copy',
  },

  // ── WALL-WALL ENDPOINT FOLLOWING ──────────────────────────────────
  // When a wall moves, connected walls' nearest endpoint follows
  {
    triggerProperty: 'origin.x',
    targetRelation: 'connected',
    targetProperty: 'origin.x',
    transform: 'custom',
    customFn: (oldVal, newVal, source, target) => {
      // Only move connected walls, not beams/slabs
      if (!/wall|partition/i.test(target.type)) return target.origin.x;
      const delta = (newVal as number) - (oldVal as number);
      // Move the connected wall's endpoint that was closest to the source
      const srcLen = source.quantities.length || 3;
      const cos = Math.cos(source.rotation);
      const srcEnd = source.origin.x + cos * srcLen;
      const tgtDist = Math.abs(target.origin.x - source.origin.x);
      const tgtEndDist = Math.abs(target.origin.x - srcEnd);
      // If target's origin was near source's origin, follow the move
      if (tgtDist < 0.5) return target.origin.x + delta;
      return target.origin.x;
    },
  },
  {
    triggerProperty: 'origin.y',
    targetRelation: 'connected',
    targetProperty: 'origin.y',
    transform: 'custom',
    customFn: (oldVal, newVal, source, target) => {
      if (!/wall|partition/i.test(target.type)) return target.origin.y;
      const delta = (newVal as number) - (oldVal as number);
      const tgtDist = Math.abs(target.origin.y - source.origin.y);
      if (tgtDist < 0.5) return target.origin.y + delta;
      return target.origin.y;
    },
  },

  // ── BEAM-COLUMN RE-SNAP ───────────────────────────────────────────
  // When a column moves, connected beams' nearest endpoint re-snaps
  {
    triggerProperty: 'origin.x',
    targetRelation: 'connected',
    targetProperty: 'origin.x',
    transform: 'custom',
    customFn: (oldVal, newVal, source, target) => {
      // Only snap beams to columns, not vice versa
      if (!/beam|girder|joist/i.test(target.type)) return target.origin.x;
      if (!/column|pillar|pier/i.test(source.type)) return target.origin.x;
      const delta = (newVal as number) - (oldVal as number);
      // If beam endpoint was near old column position, follow
      const dist = Math.abs(target.origin.x - (oldVal as number));
      if (dist < 0.5) return target.origin.x + delta;
      return target.origin.x;
    },
  },
  {
    triggerProperty: 'origin.y',
    targetRelation: 'connected',
    targetProperty: 'origin.y',
    transform: 'custom',
    customFn: (oldVal, newVal, source, target) => {
      if (!/beam|girder|joist/i.test(target.type)) return target.origin.y;
      if (!/column|pillar|pier/i.test(source.type)) return target.origin.y;
      const delta = (newVal as number) - (oldVal as number);
      const dist = Math.abs(target.origin.y - (oldVal as number));
      if (dist < 0.5) return target.origin.y + delta;
      return target.origin.y;
    },
  },

  // ── SLAB-WALL EDGE ADJUSTMENT ─────────────────────────────────────
  // When a wall moves, bounded slabs adjust their edge (via dimension change)
  {
    triggerProperty: 'origin.x',
    targetRelation: 'connected',
    targetProperty: 'quantities.width',
    transform: 'custom',
    customFn: (oldVal, newVal, source, target) => {
      if (!/slab|floor/i.test(target.type)) return target.quantities.width;
      if (!/wall|partition/i.test(source.type)) return target.quantities.width;
      // Adjust slab width by the delta of the bounding wall's movement
      const delta = Math.abs((newVal as number) - (oldVal as number));
      const currentWidth = target.quantities.width || 10;
      // Determine if wall is on the positive or negative edge
      const wallX = newVal as number;
      const slabCenterX = target.origin.x;
      const halfWidth = currentWidth / 2;
      const wasOnPositiveEdge = Math.abs((oldVal as number) - (slabCenterX + halfWidth)) < 1.0;
      const wasOnNegativeEdge = Math.abs((oldVal as number) - (slabCenterX - halfWidth)) < 1.0;
      if (wasOnPositiveEdge || wasOnNegativeEdge) {
        return currentWidth + ((newVal as number) - (oldVal as number)) * (wasOnPositiveEdge ? 1 : -1);
      }
      return target.quantities.width;
    },
  },
];

export function propagateChange(
  sourceElement: BIMSolid,
  property: string,
  oldValue: any,
  newValue: any,
  elements: Map<string, BIMSolid>,
  rules: PropagationRule[] = DEFAULT_PROPAGATION_RULES,
): PropertyChange[] {
  const propagated: PropertyChange[] = [];

  for (const rule of rules) {
    if (rule.triggerProperty !== property) continue;

    // Find target elements based on relation type
    let targetIds: string[] = [];
    switch (rule.targetRelation) {
      case 'hosted':
        targetIds = sourceElement.hostedIds;
        break;
      case 'connected':
        targetIds = sourceElement.connectedIds;
        break;
      case 'adjacent':
        // Find elements within spatial proximity
        targetIds = findAdjacentElements(sourceElement, elements);
        break;
    }

    for (const targetId of targetIds) {
      const target = elements.get(targetId);
      if (!target) continue;

      const currentValue = getNestedProperty(target, rule.targetProperty);
      let newTargetValue: any;

      switch (rule.transform) {
        case 'copy':
          newTargetValue = newValue;
          break;
        case 'offset': {
          const delta = typeof newValue === 'number' && typeof oldValue === 'number'
            ? newValue - oldValue : 0;
          newTargetValue = typeof currentValue === 'number' ? currentValue + delta : currentValue;
          break;
        }
        case 'match':
          newTargetValue = newValue;
          break;
        case 'custom':
          newTargetValue = rule.customFn
            ? rule.customFn(oldValue, newValue, sourceElement, target)
            : currentValue;
          break;
      }

      if (newTargetValue !== currentValue) {
        propagated.push({
          elementId: targetId,
          property: rule.targetProperty,
          oldValue: currentValue,
          newValue: newTargetValue,
        });
        setNestedProperty(target, rule.targetProperty, newTargetValue);
      }
    }
  }

  return propagated;
}

function findAdjacentElements(
  source: BIMSolid,
  elements: Map<string, BIMSolid>,
  tolerance: number = 0.05,
): string[] {
  const result: string[] = [];
  for (const [id, el] of elements) {
    if (id === source.id) continue;
    if (el.storey !== source.storey) continue;

    const dist = v3len(v3sub(el.origin, source.origin));
    const maxExtent = Math.max(
      (source.quantities.length || 0) + (el.quantities.length || 0),
      (source.quantities.width || 0) + (el.quantities.width || 0),
    );

    if (dist < maxExtent + tolerance) {
      result.push(id);
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONSTRAINT SOLVER — Geometric relationship maintenance
// ═══════════════════════════════════════════════════════════════════════════════

export type ConstraintType =
  | 'fixed'              // element cannot move
  | 'coincident'         // two points share same location
  | 'parallel'           // two elements maintain parallel orientation
  | 'perpendicular'      // two elements at 90°
  | 'distance'           // fixed distance between two elements
  | 'aligned'            // elements share a common axis/line
  | 'hosted'             // element lives on a host (door in wall)
  | 'tangent';           // element tangent to another (curved wall meets straight)

export interface Constraint {
  id: string;
  type: ConstraintType;
  elementIds: string[];           // elements involved
  parameters: Record<string, number>;  // type-specific params (distance value, angle, etc.)
  priority: number;               // higher = enforced first (0-10)
  isActive: boolean;
}

export interface ConstraintSolverResult {
  iterations: number;
  converged: boolean;
  maxResidual: number;
  adjustments: PropertyChange[];
}

/**
 * Solve all active constraints iteratively.
 * Uses Gauss-Seidel relaxation — each constraint adjusts elements in sequence.
 */
export function solveConstraints(
  constraints: Constraint[],
  elements: Map<string, BIMSolid>,
  maxIterations: number = 10,
  tolerance: number = 0.001,
): ConstraintSolverResult {
  const adjustments: PropertyChange[] = [];
  let converged = false;
  let maxResidual = 0;
  let iteration = 0;

  const active = constraints
    .filter(c => c.isActive)
    .sort((a, b) => b.priority - a.priority);

  for (iteration = 0; iteration < maxIterations; iteration++) {
    maxResidual = 0;

    for (const constraint of active) {
      const residual = applyConstraint(constraint, elements, adjustments);
      maxResidual = Math.max(maxResidual, residual);
    }

    if (maxResidual < tolerance) {
      converged = true;
      break;
    }
  }

  return { iterations: iteration + 1, converged, maxResidual, adjustments };
}

function applyConstraint(
  constraint: Constraint,
  elements: Map<string, BIMSolid>,
  adjustments: PropertyChange[],
): number {
  const els = constraint.elementIds.map(id => elements.get(id)).filter(Boolean) as BIMSolid[];
  if (els.length < 2 && constraint.type !== 'fixed') return 0;

  switch (constraint.type) {
    case 'fixed':
      return 0; // no adjustment needed

    case 'coincident': {
      if (els.length < 2) return 0;
      const target = els[0].origin;
      const dist = v3len(v3sub(els[1].origin, target));
      if (dist > 0.001) {
        const old = { ...els[1].origin };
        els[1].origin = { ...target };
        adjustments.push({
          elementId: els[1].id,
          property: 'origin',
          oldValue: old,
          newValue: { ...target },
        });
      }
      return dist;
    }

    case 'distance': {
      if (els.length < 2) return 0;
      const targetDist = constraint.parameters['distance'] || 0;
      const currentDist = v3len(v3sub(els[1].origin, els[0].origin));
      const residual = Math.abs(currentDist - targetDist);

      if (residual > 0.001 && currentDist > 0.001) {
        const dir = v3scale(v3sub(els[1].origin, els[0].origin), 1 / currentDist);
        const adjustment = v3scale(dir, (targetDist - currentDist) / 2);
        const old1 = { ...els[1].origin };
        els[1].origin = v3add(els[1].origin, adjustment);
        adjustments.push({
          elementId: els[1].id,
          property: 'origin',
          oldValue: old1,
          newValue: { ...els[1].origin },
        });
      }
      return residual;
    }

    case 'parallel': {
      if (els.length < 2) return 0;
      const angleDiff = Math.abs(els[0].rotation - els[1].rotation);
      const residual = Math.min(angleDiff, Math.abs(angleDiff - Math.PI));
      if (residual > 0.001) {
        const oldRot = els[1].rotation;
        // Snap to nearest parallel angle
        const diff = els[1].rotation - els[0].rotation;
        const normalizedDiff = ((diff + Math.PI) % (2 * Math.PI)) - Math.PI;
        if (Math.abs(normalizedDiff) < Math.PI / 2) {
          els[1].rotation = els[0].rotation;
        } else {
          els[1].rotation = els[0].rotation + Math.PI;
        }
        adjustments.push({
          elementId: els[1].id,
          property: 'rotation',
          oldValue: oldRot,
          newValue: els[1].rotation,
        });
      }
      return residual;
    }

    case 'perpendicular': {
      if (els.length < 2) return 0;
      const targetAngle = els[0].rotation + Math.PI / 2;
      const diff = els[1].rotation - targetAngle;
      const residual = Math.abs(((diff + Math.PI) % (2 * Math.PI)) - Math.PI);
      if (residual > 0.001) {
        const oldRot = els[1].rotation;
        els[1].rotation = targetAngle;
        adjustments.push({
          elementId: els[1].id,
          property: 'rotation',
          oldValue: oldRot,
          newValue: els[1].rotation,
        });
      }
      return residual;
    }

    case 'aligned': {
      if (els.length < 2) return 0;
      // Project element B onto element A's axis
      const axis = vec3(Math.cos(els[0].rotation), Math.sin(els[0].rotation), 0);
      const diff = v3sub(els[1].origin, els[0].origin);
      const perpComponent = v3sub(diff, v3scale(axis, diff.x * axis.x + diff.y * axis.y + diff.z * axis.z));
      const residual = v3len(perpComponent);

      if (residual > 0.001) {
        const old = { ...els[1].origin };
        els[1].origin = v3sub(els[1].origin, perpComponent);
        adjustments.push({
          elementId: els[1].id,
          property: 'origin',
          oldValue: old,
          newValue: { ...els[1].origin },
        });
      }
      return residual;
    }

    case 'hosted': {
      if (els.length < 2) return 0;
      // Ensure hosted element stays on host
      const host = els[0];
      const guest = els[1];

      // Guest Z should match host elevation
      const targetZ = host.origin.z;
      const residual = Math.abs(guest.origin.z - targetZ);

      if (residual > 0.001) {
        const old = guest.origin.z;
        guest.origin = { ...guest.origin, z: targetZ };
        adjustments.push({
          elementId: guest.id,
          property: 'origin.z',
          oldValue: old,
          newValue: targetZ,
        });
      }
      return residual;
    }

    default:
      return 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PARAMETER VALIDATION — Ensure values are within valid ranges
// ═══════════════════════════════════════════════════════════════════════════════

export interface ValidationRule {
  property: string;
  min?: number;
  max?: number;
  allowedValues?: any[];
  elementTypes?: string[];   // which element types this rule applies to
  message: string;
}

const DEFAULT_VALIDATION_RULES: ValidationRule[] = [
  { property: 'quantities.height', min: 0.1, max: 100, message: 'Height must be between 0.1m and 100m' },
  { property: 'quantities.width', min: 0.01, max: 50, message: 'Width must be between 0.01m and 50m' },
  { property: 'quantities.length', min: 0.01, max: 500, message: 'Length must be between 0.01m and 500m' },
  { property: 'quantities.thickness', min: 0.001, max: 5, message: 'Thickness must be between 1mm and 5m' },
  { property: 'elevation', min: -50, max: 500, message: 'Elevation must be between -50m and 500m' },
  { property: 'rotation', min: -2 * Math.PI, max: 2 * Math.PI, message: 'Rotation must be within ±2π radians' },
  {
    property: 'lod',
    allowedValues: [100, 200, 300, 350, 400, 500],
    message: 'LOD must be 100, 200, 300, 350, 400, or 500',
  },
];

export interface ValidationError {
  elementId: string;
  property: string;
  value: any;
  message: string;
}

export function validatePropertyChange(
  element: BIMSolid,
  property: string,
  value: any,
  rules: ValidationRule[] = DEFAULT_VALIDATION_RULES,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const rule of rules) {
    if (rule.property !== property) continue;
    if (rule.elementTypes && !rule.elementTypes.includes(element.type)) continue;

    if (rule.min !== undefined && typeof value === 'number' && value < rule.min) {
      errors.push({ elementId: element.id, property, value, message: rule.message });
    }
    if (rule.max !== undefined && typeof value === 'number' && value > rule.max) {
      errors.push({ elementId: element.id, property, value, message: rule.message });
    }
    if (rule.allowedValues && !rule.allowedValues.includes(value)) {
      errors.push({ elementId: element.id, property, value, message: rule.message });
    }
  }

  return errors;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PARAMETER EDIT API — High-level editing interface
// ═══════════════════════════════════════════════════════════════════════════════

export interface EditResult {
  success: boolean;
  transaction?: Transaction;
  validationErrors: ValidationError[];
  constraintResult?: ConstraintSolverResult;
  affectedElementIds: string[];
}

/**
 * Apply a property edit to an element with full undo/redo, validation,
 * propagation, and constraint solving.
 */
export function applyEdit(
  elementId: string,
  property: string,
  newValue: any,
  elements: Map<string, BIMSolid>,
  stack: TransactionStack,
  constraints: Constraint[],
  userId: string = 'system',
): EditResult {
  const element = elements.get(elementId);
  if (!element) {
    return {
      success: false,
      validationErrors: [{ elementId, property, value: newValue, message: 'Element not found' }],
      affectedElementIds: [],
    };
  }

  // Validate
  const errors = validatePropertyChange(element, property, newValue);
  if (errors.length > 0) {
    return { success: false, validationErrors: errors, affectedElementIds: [] };
  }

  // Begin transaction
  const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tx = beginTransaction(stack, txId, userId, `Edit ${element.name}: ${property} = ${newValue}`);

  // Record primary change
  const oldValue = getNestedProperty(element, property);
  recordChange(tx, { elementId, property, oldValue, newValue });
  setNestedProperty(element, property, newValue);

  // Propagate changes
  const propagated = propagateChange(element, property, oldValue, newValue, elements);
  tx.propagatedChanges = propagated;

  // Solve constraints
  const constraintResult = solveConstraints(constraints, elements);
  for (const adj of constraintResult.adjustments) {
    tx.propagatedChanges.push(adj);
  }

  // Commit transaction
  commitTransaction(stack, tx);

  // Collect all affected element IDs
  const affected = new Set<string>([elementId]);
  for (const change of [...propagated, ...constraintResult.adjustments]) {
    affected.add(change.elementId);
  }

  return {
    success: true,
    transaction: tx,
    validationErrors: [],
    constraintResult,
    affectedElementIds: [...affected],
  };
}

/**
 * Batch edit multiple properties in a single transaction.
 */
export function applyBatchEdit(
  edits: Array<{ elementId: string; property: string; value: any }>,
  elements: Map<string, BIMSolid>,
  stack: TransactionStack,
  constraints: Constraint[],
  userId: string = 'system',
  description: string = 'Batch edit',
): EditResult {
  // Validate all edits first
  const allErrors: ValidationError[] = [];
  for (const edit of edits) {
    const el = elements.get(edit.elementId);
    if (!el) {
      allErrors.push({ elementId: edit.elementId, property: edit.property, value: edit.value, message: 'Element not found' });
      continue;
    }
    allErrors.push(...validatePropertyChange(el, edit.property, edit.value));
  }

  if (allErrors.length > 0) {
    return { success: false, validationErrors: allErrors, affectedElementIds: [] };
  }

  // Begin single transaction for all edits
  const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tx = beginTransaction(stack, txId, userId, description);

  const affected = new Set<string>();

  for (const edit of edits) {
    const el = elements.get(edit.elementId)!;
    const oldValue = getNestedProperty(el, edit.property);
    recordChange(tx, { elementId: edit.elementId, property: edit.property, oldValue, newValue: edit.value });
    setNestedProperty(el, edit.property, edit.value);
    affected.add(edit.elementId);

    // Propagate each change
    const propagated = propagateChange(el, edit.property, oldValue, edit.value, elements);
    for (const p of propagated) {
      tx.propagatedChanges.push(p);
      affected.add(p.elementId);
    }
  }

  // Solve constraints once after all changes
  const constraintResult = solveConstraints(constraints, elements);
  for (const adj of constraintResult.adjustments) {
    tx.propagatedChanges.push(adj);
    affected.add(adj.elementId);
  }

  commitTransaction(stack, tx);

  return {
    success: true,
    transaction: tx,
    validationErrors: [],
    constraintResult,
    affectedElementIds: [...affected],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GRAPH-AWARE PROPAGATION — BFS walk with per-edge-type strategies
// ═══════════════════════════════════════════════════════════════════════════════

import { type RelationshipGraph, type EdgeType } from './relationship-graph';

/**
 * Propagation strategy: given a position/rotation delta and a relationship edge
 * type, compute the property changes needed on the target element.
 */
type PropagationStrategy = (
  delta: { dx: number; dy: number; dz: number; dRotation: number },
  source: BIMSolid,
  target: BIMSolid,
  edgeType: EdgeType,
) => PropertyChange[];

/** Strategy: hosted elements follow their host's position and rotation */
const hostedFollowHost: PropagationStrategy = (delta, _source, target) => {
  const changes: PropertyChange[] = [];
  if (delta.dx !== 0) {
    changes.push({ elementId: target.id, property: 'origin.x', oldValue: target.origin.x, newValue: target.origin.x + delta.dx });
    target.origin = { ...target.origin, x: target.origin.x + delta.dx };
  }
  if (delta.dy !== 0) {
    changes.push({ elementId: target.id, property: 'origin.y', oldValue: target.origin.y, newValue: target.origin.y + delta.dy });
    target.origin = { ...target.origin, y: target.origin.y + delta.dy };
  }
  if (delta.dz !== 0) {
    changes.push({ elementId: target.id, property: 'origin.z', oldValue: target.origin.z, newValue: target.origin.z + delta.dz });
    target.origin = { ...target.origin, z: target.origin.z + delta.dz };
  }
  if (delta.dRotation !== 0) {
    changes.push({ elementId: target.id, property: 'rotation', oldValue: target.rotation, newValue: target.rotation + delta.dRotation });
    target.rotation += delta.dRotation;
  }
  return changes;
};

/** Strategy: connected wall endpoint adjusts at join point */
const wallJoinAdjust: PropagationStrategy = (delta, source, target) => {
  const changes: PropertyChange[] = [];
  // Only adjust if target wall's origin was close to source wall's origin or endpoint
  const srcLen = source.quantities.length || 3;
  const cos = Math.cos(source.rotation);
  const sin = Math.sin(source.rotation);
  const srcEnd = { x: source.origin.x + cos * srcLen, y: source.origin.y + sin * srcLen };

  // Check which endpoint of the target was at the join
  const distToOrigin = Math.hypot(target.origin.x - (source.origin.x - delta.dx), target.origin.y - (source.origin.y - delta.dy));
  const distToEnd = Math.hypot(target.origin.x - (srcEnd.x - delta.dx), target.origin.y - (srcEnd.y - delta.dy));

  // Target's origin was near the join point — move it
  if (distToOrigin < 0.5 || distToEnd < 0.5) {
    if (delta.dx !== 0) {
      changes.push({ elementId: target.id, property: 'origin.x', oldValue: target.origin.x, newValue: target.origin.x + delta.dx });
      target.origin = { ...target.origin, x: target.origin.x + delta.dx };
    }
    if (delta.dy !== 0) {
      changes.push({ elementId: target.id, property: 'origin.y', oldValue: target.origin.y, newValue: target.origin.y + delta.dy });
      target.origin = { ...target.origin, y: target.origin.y + delta.dy };
    }
  }
  return changes;
};

/** Strategy: beam endpoint re-snaps to column center when column moves */
const beamReSnapToColumn: PropagationStrategy = (delta, source, target) => {
  const changes: PropertyChange[] = [];
  // Column (source) moved — beam (target) endpoint should follow
  // Only move if beam origin was near old column position
  const oldColX = source.origin.x - delta.dx;
  const oldColY = source.origin.y - delta.dy;
  const dist = Math.hypot(target.origin.x - oldColX, target.origin.y - oldColY);
  if (dist < 0.5) {
    if (delta.dx !== 0) {
      changes.push({ elementId: target.id, property: 'origin.x', oldValue: target.origin.x, newValue: target.origin.x + delta.dx });
      target.origin = { ...target.origin, x: target.origin.x + delta.dx };
    }
    if (delta.dy !== 0) {
      changes.push({ elementId: target.id, property: 'origin.y', oldValue: target.origin.y, newValue: target.origin.y + delta.dy });
      target.origin = { ...target.origin, y: target.origin.y + delta.dy };
    }
  }
  return changes;
};

/** Strategy: slab edge adjusts when bounding wall moves */
const slabEdgeAdjust: PropagationStrategy = (delta, source, target) => {
  const changes: PropertyChange[] = [];
  const currentWidth = target.quantities.width || 10;
  const halfW = currentWidth / 2;
  const oldWallX = source.origin.x - delta.dx;
  // Check if wall was on positive or negative edge of slab
  const onPosEdge = Math.abs(oldWallX - (target.origin.x + halfW)) < 1.0;
  const onNegEdge = Math.abs(oldWallX - (target.origin.x - halfW)) < 1.0;
  if (onPosEdge || onNegEdge) {
    const newWidth = currentWidth + delta.dx * (onPosEdge ? 1 : -1);
    if (newWidth > 0.5) { // sanity check
      changes.push({ elementId: target.id, property: 'quantities.width', oldValue: currentWidth, newValue: newWidth });
      target.quantities = { ...target.quantities, width: newWidth };
    }
  }
  return changes;
};

/** Strategy map: edge type → propagation strategy */
const STRATEGIES: Partial<Record<EdgeType, PropagationStrategy>> = {
  'hosts': hostedFollowHost,
  'wall_join': wallJoinAdjust,
  'column_to_beam': beamReSnapToColumn,
  'wall_bounds_slab': slabEdgeAdjust,
  // Reverse directions don't propagate (door doesn't move wall, beam doesn't move column)
  // 'hosted_in': no propagation
  // 'beam_to_column': no propagation
  // 'slab_bounded_by': no propagation
};

/**
 * Graph-aware constraint propagation with BFS walk and loop prevention.
 * Replaces the simple rule-based propagateChange() when a relationship graph
 * is available. Handles cascading (wall → door → door hardware) with depth limit.
 */
export function propagateWithGraph(
  sourceElementId: string,
  oldOrigin: Vec3,
  newOrigin: Vec3,
  oldRotation: number,
  newRotation: number,
  elements: Map<string, BIMSolid>,
  graph: RelationshipGraph,
  maxDepth: number = 5,
): PropertyChange[] {
  const allChanges: PropertyChange[] = [];
  const delta = {
    dx: newOrigin.x - oldOrigin.x,
    dy: newOrigin.y - oldOrigin.y,
    dz: newOrigin.z - oldOrigin.z,
    dRotation: newRotation - oldRotation,
  };

  // No movement — nothing to propagate
  if (Math.abs(delta.dx) < 0.0001 && Math.abs(delta.dy) < 0.0001 &&
      Math.abs(delta.dz) < 0.0001 && Math.abs(delta.dRotation) < 0.0001) {
    return allChanges;
  }

  // BFS walk with loop prevention (built into the graph's bfsWalk)
  for (const node of graph.bfsWalk(sourceElementId, maxDepth)) {
    const strategy = STRATEGIES[node.edgeType];
    if (!strategy) continue; // no propagation for this edge type

    const parent = elements.get(node.parentId!);
    const target = elements.get(node.elementId);
    if (!parent || !target) continue;

    // For cascading: use the delta relative to the parent's movement
    // At depth 1, delta is from the original source. At deeper levels,
    // we use the parent's accumulated delta from earlier changes.
    const parentDelta = node.depth === 1 ? delta : (() => {
      // Find how much the parent moved from our earlier propagation
      const parentChanges = allChanges.filter(c => c.elementId === node.parentId);
      let pdx = 0, pdy = 0, pdz = 0, pdr = 0;
      for (const c of parentChanges) {
        if (c.property === 'origin.x') pdx = (c.newValue as number) - (c.oldValue as number);
        if (c.property === 'origin.y') pdy = (c.newValue as number) - (c.oldValue as number);
        if (c.property === 'origin.z') pdz = (c.newValue as number) - (c.oldValue as number);
        if (c.property === 'rotation') pdr = (c.newValue as number) - (c.oldValue as number);
      }
      return { dx: pdx, dy: pdy, dz: pdz, dRotation: pdr };
    })();

    // Skip if parent didn't actually move (no cascading needed)
    if (Math.abs(parentDelta.dx) < 0.0001 && Math.abs(parentDelta.dy) < 0.0001 &&
        Math.abs(parentDelta.dz) < 0.0001 && Math.abs(parentDelta.dRotation) < 0.0001) {
      continue;
    }

    const changes = strategy(parentDelta, parent, target, node.edgeType);
    allChanges.push(...changes);
  }

  return allChanges;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ELEMENT SELECTION & FILTERING
// ═══════════════════════════════════════════════════════════════════════════════

export interface SelectionFilter {
  types?: string[];
  categories?: string[];
  storeys?: string[];
  materials?: string[];
  lodLevels?: LODLevel[];
  phases?: string[];
  worksets?: string[];
  boundingBox?: { min: Vec3; max: Vec3 };
}

export function filterElements(
  elements: Map<string, BIMSolid>,
  filter: SelectionFilter,
): BIMSolid[] {
  const result: BIMSolid[] = [];

  for (const [, el] of elements) {
    if (filter.types && !filter.types.includes(el.type)) continue;
    if (filter.categories && !filter.categories.includes(el.category)) continue;
    if (filter.storeys && !filter.storeys.includes(el.storey)) continue;
    if (filter.materials && !filter.materials.includes(el.material)) continue;
    if (filter.lodLevels && el.lod && !filter.lodLevels.includes(el.lod)) continue;
    if (filter.phases && el.phase && !filter.phases.includes(el.phase.phaseId)) continue;
    if (filter.worksets && el.workset && !filter.worksets.includes(el.workset.worksetId)) continue;
    if (filter.boundingBox) {
      const bb = filter.boundingBox;
      if (el.origin.x < bb.min.x || el.origin.x > bb.max.x) continue;
      if (el.origin.y < bb.min.y || el.origin.y > bb.max.y) continue;
      if (el.origin.z < bb.min.z || el.origin.z > bb.max.z) continue;
    }
    result.push(el);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TRANSACTION HISTORY — Query and export
// ═══════════════════════════════════════════════════════════════════════════════

export interface TransactionSummary {
  id: string;
  timestamp: string;
  userId: string;
  description: string;
  changeCount: number;
  propagatedCount: number;
  affectedElements: string[];
}

export function getTransactionHistory(stack: TransactionStack): TransactionSummary[] {
  return stack.undoStack.map(tx => ({
    id: tx.id,
    timestamp: tx.timestamp,
    userId: tx.userId,
    description: tx.description,
    changeCount: tx.changes.length,
    propagatedCount: tx.propagatedChanges.length,
    affectedElements: [...new Set([
      ...tx.changes.map(c => c.elementId),
      ...tx.propagatedChanges.map(c => c.elementId),
    ])],
  }));
}

export function exportTransactionLog(stack: TransactionStack): string {
  const log = stack.undoStack.map(tx => ({
    id: tx.id,
    timestamp: tx.timestamp,
    userId: tx.userId,
    description: tx.description,
    changes: tx.changes,
    propagatedChanges: tx.propagatedChanges,
  }));
  return JSON.stringify(log, null, 2);
}
