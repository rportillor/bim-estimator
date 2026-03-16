// server/services/parameter-engine.ts
// ──────────────────────────────────────────────────────────────────────────────
// Revit-style constraint propagation engine.
//
// Responsibilities:
//   1. Transaction-based edit with undo/redo
//   2. Per-edge-type propagation strategies (hosted follow, wall-join adjust, etc.)
//   3. Gauss-Seidel iterative constraint solver
//   4. Graph-aware BFS propagation with loop prevention
// ──────────────────────────────────────────────────────────────────────────────

import { RelationshipGraph, type GraphEdge } from './relationship-graph';
import type { Relationship } from './relationship-engine';

// ── Types ────────────────────────────────────────────────────────────────────

interface Vec3 { x: number; y: number; z: number }

export interface ElementState {
  id: string;
  position: Vec3;
  rotation: number; // radians around Z
  dimensions: { width: number; height: number; depth: number };
  elementType: string;
  hostedIds: string[];
  connectedIds: string[];
}

export type ConstraintType =
  | 'hosted'       // door/window follows host wall position + rotation
  | 'coincident'   // two wall endpoints meet at same point
  | 'distance'     // maintain fixed distance between two elements
  | 'parallel'     // two walls remain parallel
  | 'perpendicular'// two walls remain perpendicular
  | 'aligned';     // elements stay on same axis

export interface Constraint {
  id: string;
  type: ConstraintType;
  elementA: string;
  elementB: string;
  /** For distance constraints */
  value?: number;
  /** For hosted: normalised parameter along host */
  parameterT?: number;
}

interface TransactionRecord {
  id: string;
  timestamp: number;
  changes: Map<string, { before: Vec3; after: Vec3 }>;
}

// ── Propagation strategies ──────────────────────────────────────────────────

type PropagationStrategy = (
  movedId: string,
  delta: Vec3,
  edge: GraphEdge,
  elements: Map<string, ElementState>,
) => Vec3 | null;  // returns delta to apply to the connected element, or null to skip

/**
 * Hosted elements (doors/windows) follow their host wall with full offset.
 */
const hostedFollowHost: PropagationStrategy = (movedId, delta, edge, elements) => {
  // Only propagate if the host (target) was moved
  if ((edge.type as string) !== 'hosted_by') return null;
  // The host is the target — if movedId is the host, propagate to the source (door)
  if (edge.to === movedId) {
    // movedId is the wall, source is the door → door follows
    return { x: delta.x, y: delta.y, z: delta.z };
  }
  return null;
};

/**
 * Connected wall endpoints follow at join point.
 * When wall A moves, connected wall B's nearest endpoint follows.
 */
const wallJoinAdjust: PropagationStrategy = (movedId, delta, edge, _elements) => {
  if (edge.type !== 'wall_join_L' && edge.type !== 'wall_join_T') return null;
  // Both walls share an endpoint — the connected one's endpoint moves by the same delta
  return { x: delta.x, y: delta.y, z: 0 };
};

/**
 * Beam endpoints re-snap when column moves.
 */
const beamReSnapToColumn: PropagationStrategy = (movedId, delta, edge, _elements) => {
  if ((edge.type as string) !== 'column_beam') return null;
  // If the column (sourceId) moved, the beam endpoint follows
  if (edge.from === movedId) {
    return { x: delta.x, y: delta.y, z: 0 };
  }
  return null;
};

/**
 * Slab edge adjusts when bounding wall moves.
 * Instead of moving the slab, we adjust its dimension to maintain the boundary.
 */
const slabEdgeAdjust: PropagationStrategy = (movedId, delta, edge, elements) => {
  if ((edge.type as string) !== 'slab_bounded') return null;
  // If the wall (target) moved, the slab (source) doesn't translate —
  // but we signal that its dimension should change.
  // For simplicity, apply a half-delta to shift the slab centre slightly.
  if (edge.to === movedId) {
    return { x: delta.x * 0.5, y: delta.y * 0.5, z: 0 };
  }
  return null;
};

/** Map edge type → strategy */
const STRATEGIES: Record<string, PropagationStrategy> = {
  hosted_by: hostedFollowHost,
  wall_join_L: wallJoinAdjust,
  wall_join_T: wallJoinAdjust,
  column_beam: beamReSnapToColumn,
  slab_bounded: slabEdgeAdjust,
};

// ── Engine ──────────────────────────────────────────────────────────────────

export class ParameterEngine {
  private elements: Map<string, ElementState>;
  private constraints: Constraint[] = [];
  private graph: RelationshipGraph | null = null;
  private transactions: TransactionRecord[] = [];
  private txPointer = -1;
  private activeTx: TransactionRecord | null = null;

  constructor(elements: Map<string, ElementState>, constraints?: Constraint[]) {
    this.elements = elements;
    if (constraints) this.constraints = constraints;
  }

  setGraph(graph: RelationshipGraph) { this.graph = graph; }
  setConstraints(constraints: Constraint[]) { this.constraints = constraints; }

  // ── Transaction system ──────────────────────────────────────────────────

  beginTransaction(id?: string): string {
    const txId = id || `tx_${Date.now()}`;
    this.activeTx = { id: txId, timestamp: Date.now(), changes: new Map() };
    return txId;
  }

  commitTransaction(): void {
    if (!this.activeTx) return;
    // Trim any redo history
    this.transactions = this.transactions.slice(0, this.txPointer + 1);
    this.transactions.push(this.activeTx);
    this.txPointer = this.transactions.length - 1;
    this.activeTx = null;
  }

  undoTransaction(): Map<string, Vec3> | null {
    if (this.txPointer < 0) return null;
    const tx = this.transactions[this.txPointer];
    const reverted = new Map<string, Vec3>();
    for (const [id, change] of tx.changes) {
      const el = this.elements.get(id);
      if (el) {
        el.position = { ...change.before };
        reverted.set(id, el.position);
      }
    }
    this.txPointer--;
    return reverted;
  }

  redoTransaction(): Map<string, Vec3> | null {
    if (this.txPointer >= this.transactions.length - 1) return null;
    this.txPointer++;
    const tx = this.transactions[this.txPointer];
    const applied = new Map<string, Vec3>();
    for (const [id, change] of tx.changes) {
      const el = this.elements.get(id);
      if (el) {
        el.position = { ...change.after };
        applied.set(id, el.position);
      }
    }
    return applied;
  }

  private recordChange(id: string, before: Vec3, after: Vec3) {
    if (this.activeTx) {
      if (!this.activeTx.changes.has(id)) {
        this.activeTx.changes.set(id, { before: { ...before }, after: { ...after } });
      } else {
        this.activeTx.changes.get(id)!.after = { ...after };
      }
    }
  }

  // ── Core move + propagate ─────────────────────────────────────────────

  /**
   * Apply an edit (move) to an element and propagate through the relationship graph.
   * Returns all affected element IDs with their new positions.
   */
  applyEdit(
    elementId: string,
    newPosition: Vec3,
  ): Map<string, Vec3> {
    const el = this.elements.get(elementId);
    if (!el) return new Map();

    const txId = this.beginTransaction();
    const affected = new Map<string, Vec3>();

    // 1. Apply primary move
    const before = { ...el.position };
    const delta: Vec3 = {
      x: newPosition.x - el.position.x,
      y: newPosition.y - el.position.y,
      z: newPosition.z - el.position.z,
    };
    el.position = { ...newPosition };
    this.recordChange(elementId, before, el.position);
    affected.set(elementId, { ...el.position });

    // 2. Graph-based BFS propagation
    if (this.graph) {
      this.propagateWithGraph(elementId, delta, affected);
    } else {
      // Fallback: simple hosted propagation
      this.propagateSimple(elementId, delta, affected);
    }

    // 3. Constraint solver pass
    this.solveConstraints(affected, 5, 0.01);

    this.commitTransaction();
    return affected;
  }

  /**
   * Graph-aware BFS propagation.  Walks the relationship graph breadth-first,
   * applying per-edge-type strategies.  Visited-set prevents infinite loops.
   */
  private propagateWithGraph(
    startId: string,
    delta: Vec3,
    affected: Map<string, Vec3>,
    maxDepth = 5,
  ): void {
    if (!this.graph) return;

    for (const { elementId, edge, depth } of this.graph.bfs(startId, maxDepth)) {
      const strategy = STRATEGIES[edge.type];
      if (!strategy) continue;

      // Determine who was the "mover" for this edge
      const moverId = edge.from === elementId ? edge.to : edge.from;
      // Scale delta by depth (diminishing influence)
      const scaledDelta: Vec3 = {
        x: delta.x * Math.pow(0.9, depth - 1),
        y: delta.y * Math.pow(0.9, depth - 1),
        z: delta.z * Math.pow(0.9, depth - 1),
      };

      const result = strategy(moverId, scaledDelta, edge, this.elements);
      if (!result) continue;

      const target = this.elements.get(elementId);
      if (!target) continue;

      const beforePos = { ...target.position };
      target.position.x += result.x;
      target.position.y += result.y;
      target.position.z += result.z;
      this.recordChange(elementId, beforePos, target.position);
      affected.set(elementId, { ...target.position });
    }
  }

  /** Simple fallback propagation (no graph). Handles hosted elements only. */
  private propagateSimple(
    elementId: string,
    delta: Vec3,
    affected: Map<string, Vec3>,
  ): void {
    const el = this.elements.get(elementId);
    if (!el) return;

    for (const hostedId of el.hostedIds) {
      const hosted = this.elements.get(hostedId);
      if (!hosted) continue;
      const before = { ...hosted.position };
      hosted.position.x += delta.x;
      hosted.position.y += delta.y;
      hosted.position.z += delta.z;
      this.recordChange(hostedId, before, hosted.position);
      affected.set(hostedId, { ...hosted.position });
    }
  }

  // ── Constraint solver (Gauss-Seidel iterative) ────────────────────────

  /**
   * Iteratively solve constraints until convergence.
   * Each iteration adjusts positions to satisfy constraints.
   */
  solveConstraints(
    affected: Map<string, Vec3>,
    maxIterations = 5,
    tolerance = 0.01,
  ): void {
    for (let iter = 0; iter < maxIterations; iter++) {
      let maxResidual = 0;

      for (const c of this.constraints) {
        const elA = this.elements.get(c.elementA);
        const elB = this.elements.get(c.elementB);
        if (!elA || !elB) continue;

        switch (c.type) {
          case 'hosted': {
            // Hosted element must stay at parameterT along host
            if (c.parameterT != null) {
              // Re-project onto host position (simplified: just ensure same-storey Z)
              const dz = elA.position.z - elB.position.z;
              if (Math.abs(dz) > tolerance) {
                const before = { ...elA.position };
                elA.position.z = elB.position.z;
                this.recordChange(c.elementA, before, elA.position);
                affected.set(c.elementA, { ...elA.position });
                maxResidual = Math.max(maxResidual, Math.abs(dz));
              }
            }
            break;
          }
          case 'coincident': {
            // Two elements should meet at the same point
            const dx = elB.position.x - elA.position.x;
            const dy = elB.position.y - elA.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > tolerance) {
              const half = dist / 2;
              const beforeA = { ...elA.position };
              const beforeB = { ...elB.position };
              elA.position.x += (dx / dist) * half;
              elA.position.y += (dy / dist) * half;
              elB.position.x -= (dx / dist) * half;
              elB.position.y -= (dy / dist) * half;
              this.recordChange(c.elementA, beforeA, elA.position);
              this.recordChange(c.elementB, beforeB, elB.position);
              affected.set(c.elementA, { ...elA.position });
              affected.set(c.elementB, { ...elB.position });
              maxResidual = Math.max(maxResidual, dist);
            }
            break;
          }
          case 'distance': {
            // Maintain fixed distance between two elements
            if (c.value == null) break;
            const dx = elB.position.x - elA.position.x;
            const dy = elB.position.y - elA.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const error = dist - c.value;
            if (Math.abs(error) > tolerance && dist > 1e-6) {
              const correction = error / 2;
              const beforeA = { ...elA.position };
              const beforeB = { ...elB.position };
              elA.position.x += (dx / dist) * correction;
              elA.position.y += (dy / dist) * correction;
              elB.position.x -= (dx / dist) * correction;
              elB.position.y -= (dy / dist) * correction;
              this.recordChange(c.elementA, beforeA, elA.position);
              this.recordChange(c.elementB, beforeB, elB.position);
              affected.set(c.elementA, { ...elA.position });
              affected.set(c.elementB, { ...elB.position });
              maxResidual = Math.max(maxResidual, Math.abs(error));
            }
            break;
          }
        }
      }

      if (maxResidual < tolerance) {
        break;
      }
    }
  }
}

// ── Helpers for building engine from raw elements ───────────────────────────

/**
 * Build an ElementState map from raw BIM elements.
 * Populates hostedIds and connectedIds from element properties
 * (written by relationship-engine.ts).
 */
export function buildElementMap(elements: any[]): Map<string, ElementState> {
  const map = new Map<string, ElementState>();
  const byId = new Map<string, any>();

  // First pass: create ElementState entries
  for (const e of elements) {
    const id = e.id || e.elementId;
    if (!id) continue;
    byId.set(id, e);

    const g = typeof e.geometry === 'string' ? JSON.parse(e.geometry) : (e.geometry || {});
    const pos = g.location?.realLocation || { x: 0, y: 0, z: 0 };
    const dims = g.dimensions || {};

    map.set(id, {
      id,
      position: { x: Number(pos.x) || 0, y: Number(pos.y) || 0, z: Number(pos.z) || 0 },
      rotation: 0,
      dimensions: {
        width: Number(dims.width || 1),
        height: Number(dims.height || 1),
        depth: Number(dims.depth || dims.length || 1),
      },
      elementType: (e.elementType || e.type || '').toUpperCase(),
      hostedIds: [],
      connectedIds: [],
    });
  }

  // Second pass: populate hostedIds by reverse lookup
  for (const e of elements) {
    const id = e.id || e.elementId;
    const hostWallId = e.properties?.hostWallId;
    if (hostWallId && map.has(hostWallId)) {
      const host = map.get(hostWallId)!;
      if (!host.hostedIds.includes(id)) host.hostedIds.push(id);
    }

    // Connected IDs from relationship properties
    const connected: string[] = [];
    for (const arr of [
      e.properties?.connectedWallIds,
      e.properties?.connectedColumnIds,
      e.properties?.supportedBeamIds,
      e.properties?.boundingWallIds,
    ]) {
      if (Array.isArray(arr)) connected.push(...arr);
    }
    const state = map.get(id);
    if (state) state.connectedIds = [...new Set(connected)].filter(cid => map.has(cid));
  }

  return map;
}

/**
 * Build Constraint objects from relationship data written by relationship-engine.
 */
export function buildConstraintsFromRelationships(
  relationships: { sourceId: string; targetId: string; type: string; parameterT?: number }[],
): Constraint[] {
  const constraints: Constraint[] = [];
  let idx = 0;

  for (const r of relationships) {
    switch (r.type) {
      case 'hosted_by':
        constraints.push({
          id: `c_hosted_${idx++}`,
          type: 'hosted',
          elementA: r.sourceId,
          elementB: r.targetId,
          parameterT: r.parameterT,
        });
        break;
      case 'wall_join_L':
        constraints.push({
          id: `c_coincident_${idx++}`,
          type: 'coincident',
          elementA: r.sourceId,
          elementB: r.targetId,
        });
        break;
      case 'wall_join_T':
      case 'column_beam':
      case 'slab_bounded':
        constraints.push({
          id: `c_distance_${idx++}`,
          type: 'distance',
          elementA: r.sourceId,
          elementB: r.targetId,
          value: 0,  // zero distance = touching
          parameterT: r.parameterT,
        });
        break;
    }
  }

  return constraints;
}

/**
 * Run constraint solver on raw elements + relationships (for postprocess pipeline).
 * Modifies element positions in-place.  Returns count of adjusted elements.
 */
export function solveConstraintsOnElements(
  elements: any[],
  relationships: { sourceId: string; targetId: string; type: string; parameterT?: number }[],
  maxIterations = 5,
  tolerance = 0.01,
): number {
  const elMap = buildElementMap(elements);
  const constraints = buildConstraintsFromRelationships(relationships);
  const graph = new RelationshipGraph(relationships as any);

  const engine = new ParameterEngine(elMap, constraints);
  engine.setGraph(graph);

  // Run solver without a move — just verify constraints
  const affected = new Map<string, { x: number; y: number; z: number }>();
  for (const [id, state] of elMap) {
    affected.set(id, { ...state.position });
  }
  engine.solveConstraints(affected, maxIterations, tolerance);

  // Write adjusted positions back to elements
  let adjustedCount = 0;
  for (const e of elements) {
    const id = e.id || e.elementId;
    const state = elMap.get(id);
    if (!state) continue;

    const g = typeof e.geometry === 'string' ? JSON.parse(e.geometry) : (e.geometry || {});
    const oldPos = g.location?.realLocation || { x: 0, y: 0, z: 0 };
    const dx = Math.abs(state.position.x - (Number(oldPos.x) || 0));
    const dy = Math.abs(state.position.y - (Number(oldPos.y) || 0));
    const dz = Math.abs(state.position.z - (Number(oldPos.z) || 0));

    if (dx > tolerance || dy > tolerance || dz > tolerance) {
      g.location = g.location || {};
      g.location.realLocation = { ...state.position };
      e.geometry = g;
      adjustedCount++;
    }
  }

  return adjustedCount;
}
