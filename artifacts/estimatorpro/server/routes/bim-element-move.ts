// server/routes/bim-element-move.ts
// ──────────────────────────────────────────────────────────────────────────────
// POST /api/bim/models/:modelId/elements/:elementId/move
//
// Moves a BIM element and propagates the change through the relationship graph
// (constraint propagation).  Returns all affected elements with new positions.
// ──────────────────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from 'express';
import { storage } from '../storage';
import { detectRelationships } from '../services/relationship-engine';
import { ParameterEngine, buildElementMap, buildConstraintsFromRelationships } from '../services/parameter-engine';
import { RelationshipGraph } from '../services/relationship-graph';

export const bimElementMoveRouter = Router();

bimElementMoveRouter.post(
  '/api/bim/models/:modelId/elements/:elementId/move',
  async (req: Request, res: Response) => {
    try {
      const { modelId, elementId } = req.params;
      const { x, y, z } = req.body;

      if (x == null || y == null || z == null) {
        return res.status(400).json({ error: 'Missing required fields: x, y, z' });
      }

      // 1. Load all elements for the model
      const allElements = await storage.getBimElements(modelId);
      if (!allElements || allElements.length === 0) {
        return res.status(404).json({ error: 'No elements found for model' });
      }

      // Parse geometry for each element
      const elements = allElements.map((e: any) => ({
        ...e,
        geometry: typeof e.geometry === 'string' ? JSON.parse(e.geometry) : (e.geometry || {}),
        properties: typeof e.properties === 'string' ? JSON.parse(e.properties) : (e.properties || {}),
      }));

      // Verify target element exists
      const targetEl = elements.find((e: any) => (e.id || e.elementId) === elementId);
      if (!targetEl) {
        return res.status(404).json({ error: `Element ${elementId} not found` });
      }

      // 2. Detect relationships
      const relationships = detectRelationships(elements);

      // 3. Build constraint engine
      const elMap = buildElementMap(elements);
      const constraints = buildConstraintsFromRelationships(relationships);
      const graph = new RelationshipGraph(relationships);

      const engine = new ParameterEngine(elMap, constraints);
      engine.setGraph(graph);

      // 4. Apply edit — moves the element and propagates through the graph
      const newPosition = { x: Number(x), y: Number(y), z: Number(z) };
      const affected = engine.applyEdit(elementId, newPosition);

      // 5. Write updated positions back to elements and persist
      const updatedElements: any[] = [];
      for (const [id, pos] of affected) {
        const origEl = elements.find((e: any) => (e.id || e.elementId) === id);
        if (!origEl) continue;

        origEl.geometry.location = origEl.geometry.location || {};
        origEl.geometry.location.realLocation = { x: pos.x, y: pos.y, z: pos.z };

        updatedElements.push({
          id,
          position: pos,
          elementType: origEl.elementType || origEl.type,
          name: origEl.name,
        });
      }

      // Persist all changes
      if ((storage as any).upsertBimElements) {
        await (storage as any).upsertBimElements(modelId, elements);
      }

      console.log(`🔧 MOVE: element ${elementId} moved to (${x}, ${y}, ${z}) — ${affected.size} elements affected`);

      res.json({
        success: true,
        movedElement: elementId,
        newPosition: { x: Number(x), y: Number(y), z: Number(z) },
        affectedElements: updatedElements,
        totalAffected: affected.size,
      });
    } catch (error: any) {
      console.error('Error moving BIM element:', error);
      res.status(500).json({ error: `Failed to move element: ${error?.message}` });
    }
  },
);
