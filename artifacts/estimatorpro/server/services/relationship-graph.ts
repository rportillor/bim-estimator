// server/services/relationship-graph.ts
// ──────────────────────────────────────────────────────────────────────────────
// Bidirectional indexed graph over BIM element relationships.
// Supports BFS/DFS traversal with visited-set loop prevention and depth limits.
// Used by the constraint propagation engine to walk the relationship chain.
// ──────────────────────────────────────────────────────────────────────────────

import type { Relationship } from './relationship-engine';

export interface GraphEdge {
  from: string;
  to: string;
  type: Relationship['type'];
  parameterT?: number;
  metadata?: Record<string, any>;
}

export class RelationshipGraph {
  /** adjacency: elementId → outgoing edges */
  private adj = new Map<string, GraphEdge[]>();
  /** reverse adjacency: elementId → incoming edges */
  private rev = new Map<string, GraphEdge[]>();
  /** all edges */
  private edges: GraphEdge[] = [];

  constructor(relationships: Relationship[]) {
    for (const r of relationships) {
      const edge: GraphEdge = {
        from: r.sourceId,
        to: r.targetId,
        type: r.type,
        parameterT: (r as any).parameterT,
        metadata: (r as any).metadata,
      };
      this.edges.push(edge);

      if (!this.adj.has(r.sourceId)) this.adj.set(r.sourceId, []);
      this.adj.get(r.sourceId)!.push(edge);

      if (!this.rev.has(r.targetId)) this.rev.set(r.targetId, []);
      this.rev.get(r.targetId)!.push(edge);
    }
  }

  /** All outgoing edges from an element */
  outgoing(elementId: string): GraphEdge[] {
    return this.adj.get(elementId) || [];
  }

  /** All incoming edges to an element */
  incoming(elementId: string): GraphEdge[] {
    return this.rev.get(elementId) || [];
  }

  /** All connected edges (both directions) */
  connected(elementId: string): GraphEdge[] {
    return [...this.outgoing(elementId), ...this.incoming(elementId)];
  }

  /** All unique neighbour IDs */
  neighbours(elementId: string): string[] {
    const ids = new Set<string>();
    for (const e of this.outgoing(elementId)) ids.add(e.to);
    for (const e of this.incoming(elementId)) ids.add(e.from);
    return Array.from(ids);
  }

  get edgeCount(): number { return this.edges.length; }
  get nodeCount(): number {
    const ids = new Set<string>();
    for (const e of this.edges) { ids.add(e.from); ids.add(e.to); }
    return ids.size;
  }

  // ── BFS traversal with loop prevention ──────────────────────────────────

  /**
   * Breadth-first walk from `startId`, yielding { elementId, edge, depth }
   * for every reachable element.  Visited-set prevents cycles.
   *
   * @param startId   Starting element
   * @param maxDepth  Max BFS depth (default 10)
   * @param edgeFilter  Optional filter to restrict edge types traversed
   */
  *bfs(
    startId: string,
    maxDepth = 10,
    edgeFilter?: (edge: GraphEdge) => boolean,
  ): Generator<{ elementId: string; edge: GraphEdge; depth: number }> {
    const visited = new Set<string>();
    visited.add(startId);

    type QueueItem = { elementId: string; depth: number };
    const queue: QueueItem[] = [{ elementId: startId, depth: 0 }];

    while (queue.length > 0) {
      const { elementId, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;

      for (const edge of this.connected(elementId)) {
        const neighbour = edge.from === elementId ? edge.to : edge.from;
        if (visited.has(neighbour)) continue;
        if (edgeFilter && !edgeFilter(edge)) continue;

        visited.add(neighbour);
        yield { elementId: neighbour, edge, depth: depth + 1 };
        queue.push({ elementId: neighbour, depth: depth + 1 });
      }
    }
  }

  /**
   * Collect all elements reachable from startId within maxDepth,
   * grouped by edge type.
   */
  reachable(startId: string, maxDepth = 10): Map<string, { elementId: string; edge: GraphEdge; depth: number }[]> {
    const byType = new Map<string, { elementId: string; edge: GraphEdge; depth: number }[]>();
    for (const hit of this.bfs(startId, maxDepth)) {
      const arr = byType.get(hit.edge.type) || [];
      arr.push(hit);
      byType.set(hit.edge.type, arr);
    }
    return byType;
  }
}
