/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  RELATIONSHIP GRAPH — Indexed bidirectional graph for constraint propagation
 *
 *  Bridges the gap between descriptive relationships (relationship-engine.ts)
 *  and active constraint propagation. Provides:
 *    - Efficient edge lookups by element ID and relationship type
 *    - BFS traversal with visited-set loop prevention
 *    - Cascading propagation with depth limits
 *
 *  Used by the parameter engine to walk the relationship graph when an
 *  element moves, ensuring all connected elements update correctly.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { BIMSolid } from './parametric-elements';
import type { Vec3 } from './geometry-kernel';
import { vec3, v3sub, v3len } from './geometry-kernel';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EdgeType =
  | 'hosts'            // host → hosted element (wall → door)
  | 'hosted_in'        // hosted element → host (door → wall)
  | 'wall_join'        // wall endpoint to wall endpoint (L/T/X)
  | 'beam_to_column'   // beam endpoint snapped to column
  | 'column_to_beam'   // reverse: column supports beam
  | 'slab_bounded_by'  // slab edge aligned to wall
  | 'wall_bounds_slab' // reverse: wall bounds a slab
  | 'connected_to';    // generic connection

export interface GraphEdge {
  targetId: string;
  type: EdgeType;
  metadata?: Record<string, any>;
}

export interface BFSNode {
  elementId: string;
  parentId: string | null;
  edgeType: EdgeType;
  depth: number;
}

// ─── Relationship Graph ───────────────────────────────────────────────────────

export class RelationshipGraph {
  /** adjacency list: elementId → outgoing edges */
  private adjacency = new Map<string, GraphEdge[]>();

  /** Add a directed edge */
  addEdge(sourceId: string, targetId: string, type: EdgeType, metadata?: Record<string, any>): void {
    if (!this.adjacency.has(sourceId)) this.adjacency.set(sourceId, []);
    const edges = this.adjacency.get(sourceId)!;
    // Avoid duplicates
    if (edges.some(e => e.targetId === targetId && e.type === type)) return;
    edges.push({ targetId, type, metadata });
  }

  /** Add a bidirectional edge pair */
  addBidirectional(
    idA: string, idB: string,
    typeAtoB: EdgeType, typeBtoA: EdgeType,
    metadata?: Record<string, any>,
  ): void {
    this.addEdge(idA, idB, typeAtoB, metadata);
    this.addEdge(idB, idA, typeBtoA, metadata);
  }

  /** Get all edges from an element, optionally filtered by type */
  getEdges(elementId: string, type?: EdgeType): GraphEdge[] {
    const edges = this.adjacency.get(elementId) || [];
    return type ? edges.filter(e => e.type === type) : edges;
  }

  /** Get all neighbor IDs */
  getNeighborIds(elementId: string, type?: EdgeType): string[] {
    return this.getEdges(elementId, type).map(e => e.targetId);
  }

  /** BFS traversal from a start element with loop prevention */
  *bfsWalk(startId: string, maxDepth: number = 5): Generator<BFSNode> {
    const visited = new Set<string>([startId]);
    const queue: BFSNode[] = [];

    // Seed with direct neighbors
    for (const edge of this.getEdges(startId)) {
      if (!visited.has(edge.targetId)) {
        queue.push({
          elementId: edge.targetId,
          parentId: startId,
          edgeType: edge.type,
          depth: 1,
        });
        visited.add(edge.targetId);
      }
    }

    while (queue.length > 0) {
      const node = queue.shift()!;
      yield node;

      // Don't go deeper than maxDepth
      if (node.depth >= maxDepth) continue;

      // Add this node's unvisited neighbors
      for (const edge of this.getEdges(node.elementId)) {
        if (!visited.has(edge.targetId)) {
          queue.push({
            elementId: edge.targetId,
            parentId: node.elementId,
            edgeType: edge.type,
            depth: node.depth + 1,
          });
          visited.add(edge.targetId);
        }
      }
    }
  }

  /** Total edge count */
  get edgeCount(): number {
    let count = 0;
    for (const edges of this.adjacency.values()) count += edges.length;
    return count;
  }

  /** Total node count */
  get nodeCount(): number {
    return this.adjacency.size;
  }
}

// ─── Graph Builder ────────────────────────────────────────────────────────────

/**
 * Build a RelationshipGraph from a Map of BIMSolid elements.
 * Reads hostId/hostedIds/connectedIds and infers edge types from element types.
 */
export function buildGraphFromElements(elements: Map<string, BIMSolid>): RelationshipGraph {
  const graph = new RelationshipGraph();

  for (const [id, el] of elements) {
    // Host/hosted relationships
    if (el.hostId && elements.has(el.hostId)) {
      graph.addBidirectional(el.hostId, id, 'hosts', 'hosted_in');
    }
    for (const hostedId of el.hostedIds) {
      if (elements.has(hostedId)) {
        graph.addBidirectional(id, hostedId, 'hosts', 'hosted_in');
      }
    }

    // Connected relationships — classify by element types
    const elType = el.type.toLowerCase();
    for (const connId of el.connectedIds) {
      const conn = elements.get(connId);
      if (!conn) continue;
      const connType = conn.type.toLowerCase();

      // Wall-to-wall
      if (/wall|partition/i.test(elType) && /wall|partition/i.test(connType)) {
        graph.addBidirectional(id, connId, 'wall_join', 'wall_join');
      }
      // Beam-to-column
      else if (/beam|girder|joist/i.test(elType) && /column|pillar|pier/i.test(connType)) {
        graph.addBidirectional(id, connId, 'beam_to_column', 'column_to_beam');
      }
      // Column-to-beam (reverse direction already covered above, but handle if stored this way)
      else if (/column|pillar|pier/i.test(elType) && /beam|girder|joist/i.test(connType)) {
        graph.addBidirectional(id, connId, 'column_to_beam', 'beam_to_column');
      }
      // Slab-to-wall
      else if (/slab|floor/i.test(elType) && /wall|partition/i.test(connType)) {
        graph.addBidirectional(id, connId, 'slab_bounded_by', 'wall_bounds_slab');
      }
      // Generic
      else {
        graph.addBidirectional(id, connId, 'connected_to', 'connected_to');
      }
    }
  }

  return graph;
}
