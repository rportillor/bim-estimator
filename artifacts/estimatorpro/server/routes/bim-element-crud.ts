// server/routes/bim-element-crud.ts
// ──────────────────────────────────────────────────────────────────────────────
// CRUD API for BIM elements — create, edit properties, delete, split, host.
// Enables the user-editable model layer: a QS can drag an element, split a
// wall, manually host a door, or edit material/dimensions from the UI.
// ──────────────────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from 'express';
import { storage } from '../storage';
import { validateExtractedDimensions } from '../helpers/dimension-validator';
import { detectRelationships } from '../services/relationship-engine';

export const bimElementCrudRouter = Router();

// ── Helper: parse stored JSONB fields ────────────────────────────────────────

function parseElement(e: any) {
  return {
    ...e,
    geometry: typeof e.geometry === 'string' ? JSON.parse(e.geometry) : (e.geometry || {}),
    properties: typeof e.properties === 'string' ? JSON.parse(e.properties) : (e.properties || {}),
  };
}

// ── Default dimensions per element type (metres) ─────────────────────────────

const DEFAULT_DIMS: Record<string, { width: number; height: number; depth: number }> = {
  wall:       { width: 6.0,   height: 3.0,   depth: 0.2 },
  column:     { width: 0.4,   height: 3.0,   depth: 0.4 },
  beam:       { width: 0.3,   height: 0.6,   depth: 6.0 },
  slab:       { width: 10.0,  height: 0.2,   depth: 10.0 },
  door:       { width: 0.9,   height: 2.1,   depth: 0.05 },
  window:     { width: 1.2,   height: 1.5,   depth: 0.08 },
  foundation: { width: 2.0,   height: 0.6,   depth: 2.0 },
  stair:      { width: 1.2,   height: 3.0,   depth: 4.0 },
  pipe:       { width: 0.1,   height: 0.1,   depth: 6.0 },
  duct:       { width: 0.4,   height: 0.3,   depth: 6.0 },
};

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/bim/models/:modelId/elements — Return all elements for the viewer
// viewer-3d.tsx fetches this URL and parses: json.data || json.elements || json
// ═════════════════════════════════════════════════════════════════════════════

bimElementCrudRouter.get(
  '/api/bim/models/:modelId/elements',
  async (req: Request, res: Response) => {
    try {
      const { modelId } = req.params;
      const raw = await storage.getBimElements(modelId);
      const elements = (raw || []).map(parseElement);
      return res.json({ elements, count: elements.length });
    } catch (error: any) {
      console.error('Error fetching BIM elements:', error);
      return res.status(500).json({ error: `Failed to get elements: ${error?.message}` });
    }
  },
);

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/bim/models/:modelId/elements — Create a new element
// ═════════════════════════════════════════════════════════════════════════════

bimElementCrudRouter.post(
  '/api/bim/models/:modelId/elements',
  async (req: Request, res: Response) => {
    try {
      const { modelId } = req.params;
      const { elementType, name, material, x, y, z, width, height, depth, storey, category } = req.body;

      if (!elementType) {
        return res.status(400).json({ error: 'Missing required field: elementType' });
      }

      const type = elementType.toLowerCase();
      const defaults = DEFAULT_DIMS[type] || DEFAULT_DIMS.wall;

      const element: any = {
        modelId,
        elementId: `manual_${type}_${Date.now()}`,
        elementType: type,
        name: name || `New ${type.charAt(0).toUpperCase() + type.slice(1)}`,
        category: category || inferCategory(type),
        storey: storey || 'Level 1',
        geometry: {
          dimensions: {
            width:  width  ?? defaults.width,
            height: height ?? defaults.height,
            depth:  depth  ?? defaults.depth,
          },
          location: {
            realLocation: {
              x: Number(x ?? 0),
              y: Number(y ?? 0),
              z: Number(z ?? 0),
            },
          },
        },
        properties: {
          material: material || inferMaterial(type),
          source: 'manual',
          createdAt: new Date().toISOString(),
          editHistory: [{
            action: 'created',
            timestamp: new Date().toISOString(),
            source: 'manual',
          }],
        },
      };

      // Validate dimensions
      const validation = validateExtractedDimensions([element]);
      if (!validation.valid) {
        element.properties.dimensionWarnings = validation.warnings;
      }

      // Persist
      if ((storage as any).upsertBimElements) {
        const existing = await storage.getBimElements(modelId) || [];
        existing.push(element);
        await (storage as any).upsertBimElements(modelId, existing);
      }

      console.log(`✅ CRUD: Created ${type} element "${element.name}" in model ${modelId}`);

      res.status(201).json({
        success: true,
        element: {
          id: element.elementId,
          elementType: element.elementType,
          name: element.name,
          geometry: element.geometry,
          properties: element.properties,
        },
      });
    } catch (error: any) {
      console.error('Error creating BIM element:', error);
      res.status(500).json({ error: `Failed to create element: ${error?.message}` });
    }
  },
);

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/bim/models/:modelId/elements/:elementId — Get single element
// ═════════════════════════════════════════════════════════════════════════════

bimElementCrudRouter.get(
  '/api/bim/models/:modelId/elements/:elementId',
  async (req: Request, res: Response) => {
    try {
      const { modelId, elementId } = req.params;
      const all = await storage.getBimElements(modelId);
      const el = (all || []).find((e: any) => (e.id || e.elementId) === elementId);

      if (!el) return res.status(404).json({ error: 'Element not found' });

      res.json(parseElement(el));
    } catch (error: any) {
      res.status(500).json({ error: `Failed to get element: ${error?.message}` });
    }
  },
);

// ═════════════════════════════════════════════════════════════════════════════
// PATCH /api/bim/models/:modelId/elements/:elementId — Edit element properties
// ═════════════════════════════════════════════════════════════════════════════

bimElementCrudRouter.patch(
  '/api/bim/models/:modelId/elements/:elementId',
  async (req: Request, res: Response) => {
    try {
      const { modelId, elementId } = req.params;
      const updates = req.body; // { name?, material?, width?, height?, depth?, category?, storey? }

      const all = await storage.getBimElements(modelId) || [];
      const idx = all.findIndex((e: any) => (e.id || e.elementId) === elementId);
      if (idx === -1) return res.status(404).json({ error: 'Element not found' });

      const el = parseElement(all[idx]);
      const changedFields: string[] = [];

      // Apply property updates
      if (updates.name !== undefined && updates.name !== el.name) {
        el.name = updates.name;
        changedFields.push('name');
      }
      if (updates.category !== undefined) {
        el.category = updates.category;
        changedFields.push('category');
      }
      if (updates.storey !== undefined) {
        el.storey = updates.storey;
        changedFields.push('storey');
      }
      if (updates.elementType !== undefined) {
        el.elementType = updates.elementType;
        changedFields.push('elementType');
      }

      // Material
      if (updates.material !== undefined) {
        if (!el.properties) el.properties = {};
        el.properties.material = updates.material;
        changedFields.push('material');
      }

      // Dimensions
      const dims = el.geometry?.dimensions || {};
      if (updates.width  !== undefined) { dims.width  = Number(updates.width);  changedFields.push('width'); }
      if (updates.height !== undefined) { dims.height = Number(updates.height); changedFields.push('height'); }
      if (updates.depth  !== undefined) { dims.depth  = Number(updates.depth);  changedFields.push('depth'); }
      if (changedFields.some(f => ['width', 'height', 'depth'].includes(f))) {
        if (!el.geometry) el.geometry = {};
        el.geometry.dimensions = dims;

        // Re-validate
        const validation = validateExtractedDimensions([el]);
        if (!validation.valid) {
          el.properties.dimensionWarnings = validation.warnings;
        } else {
          delete el.properties.dimensionWarnings;
          el.properties.dimensionValidation = 'PASSED';
        }
      }

      // Track edit history
      if (!el.properties) el.properties = {};
      if (!el.properties.editHistory) el.properties.editHistory = [];
      el.properties.editHistory.push({
        action: 'edited',
        fields: changedFields,
        timestamp: new Date().toISOString(),
        source: 'manual',
      });

      // Persist
      all[idx] = el;
      if ((storage as any).upsertBimElements) {
        await (storage as any).upsertBimElements(modelId, all);
      }

      console.log(`✏️ CRUD: Edited ${changedFields.join(', ')} on element ${elementId}`);

      res.json({ success: true, changedFields, element: el });
    } catch (error: any) {
      console.error('Error editing BIM element:', error);
      res.status(500).json({ error: `Failed to edit element: ${error?.message}` });
    }
  },
);

// ═════════════════════════════════════════════════════════════════════════════
// DELETE /api/bim/models/:modelId/elements/:elementId — Delete element
// ═════════════════════════════════════════════════════════════════════════════

bimElementCrudRouter.delete(
  '/api/bim/models/:modelId/elements/:elementId',
  async (req: Request, res: Response) => {
    try {
      const { modelId, elementId } = req.params;

      const all = await storage.getBimElements(modelId) || [];
      const idx = all.findIndex((e: any) => (e.id || e.elementId) === elementId);
      if (idx === -1) return res.status(404).json({ error: 'Element not found' });

      const deleted = parseElement(all[idx]);

      // Check for hosted elements that will be orphaned
      const relationships = detectRelationships(all.map(parseElement));
      const hosted = relationships.filter(
        r => r.type === 'hosted_by' && r.targetId === elementId
      );

      // Remove the element
      all.splice(idx, 1);

      // Persist
      if ((storage as any).upsertBimElements) {
        await (storage as any).upsertBimElements(modelId, all);
      }

      console.log(`🗑️ CRUD: Deleted element ${elementId} (${deleted.elementType})`);

      res.json({
        success: true,
        deletedElement: {
          id: elementId,
          type: deleted.elementType,
          name: deleted.name,
        },
        orphanedElements: hosted.map(h => h.sourceId),
        warning: hosted.length > 0
          ? `${hosted.length} hosted element(s) are now orphaned (doors/windows without a wall)`
          : undefined,
      });
    } catch (error: any) {
      console.error('Error deleting BIM element:', error);
      res.status(500).json({ error: `Failed to delete element: ${error?.message}` });
    }
  },
);

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/bim/models/:modelId/elements/:elementId/split — Split wall at point
// ═════════════════════════════════════════════════════════════════════════════

bimElementCrudRouter.post(
  '/api/bim/models/:modelId/elements/:elementId/split',
  async (req: Request, res: Response) => {
    try {
      const { modelId, elementId } = req.params;
      const { splitRatio } = req.body; // 0-1: where along the wall to split

      if (splitRatio == null || splitRatio <= 0 || splitRatio >= 1) {
        return res.status(400).json({ error: 'splitRatio must be between 0 and 1 (exclusive)' });
      }

      const all = await storage.getBimElements(modelId) || [];
      const idx = all.findIndex((e: any) => (e.id || e.elementId) === elementId);
      if (idx === -1) return res.status(404).json({ error: 'Element not found' });

      const el = parseElement(all[idx]);
      const type = (el.elementType || '').toLowerCase();
      if (!type.includes('wall')) {
        return res.status(400).json({ error: 'Only wall elements can be split' });
      }

      const dims = el.geometry?.dimensions || {};
      const loc = el.geometry?.location?.realLocation || { x: 0, y: 0, z: 0 };
      const totalWidth = dims.width || 6;

      // Create two wall segments
      const wall1Width = totalWidth * splitRatio;
      const wall2Width = totalWidth * (1 - splitRatio);

      const wall1 = {
        ...JSON.parse(JSON.stringify(el)),
        elementId: `${elementId}_A`,
        name: `${el.name || 'Wall'} (A)`,
        geometry: {
          ...el.geometry,
          dimensions: { ...dims, width: Number(wall1Width.toFixed(3)) },
          location: { realLocation: { ...loc } },
        },
        properties: {
          ...el.properties,
          source: 'split',
          splitFrom: elementId,
          editHistory: [...(el.properties?.editHistory || []), {
            action: 'split',
            timestamp: new Date().toISOString(),
            source: 'manual',
          }],
        },
      };

      const wall2 = {
        ...JSON.parse(JSON.stringify(el)),
        elementId: `${elementId}_B`,
        name: `${el.name || 'Wall'} (B)`,
        geometry: {
          ...el.geometry,
          dimensions: { ...dims, width: Number(wall2Width.toFixed(3)) },
          location: {
            realLocation: {
              x: loc.x + wall1Width,
              y: loc.y,
              z: loc.z,
            },
          },
        },
        properties: {
          ...el.properties,
          source: 'split',
          splitFrom: elementId,
          editHistory: [...(el.properties?.editHistory || []), {
            action: 'split',
            timestamp: new Date().toISOString(),
            source: 'manual',
          }],
        },
      };

      // Replace original with two segments
      all.splice(idx, 1, wall1, wall2);

      if ((storage as any).upsertBimElements) {
        await (storage as any).upsertBimElements(modelId, all);
      }

      console.log(`✂️ CRUD: Split wall ${elementId} at ${(splitRatio * 100).toFixed(0)}% → ${wall1.elementId}, ${wall2.elementId}`);

      res.json({
        success: true,
        deletedElement: elementId,
        newElements: [
          { id: wall1.elementId, width: wall1Width },
          { id: wall2.elementId, width: wall2Width },
        ],
      });
    } catch (error: any) {
      console.error('Error splitting element:', error);
      res.status(500).json({ error: `Failed to split element: ${error?.message}` });
    }
  },
);

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/bim/models/:modelId/elements/:elementId/host — Host door/window in wall
// ═════════════════════════════════════════════════════════════════════════════

bimElementCrudRouter.post(
  '/api/bim/models/:modelId/elements/:elementId/host',
  async (req: Request, res: Response) => {
    try {
      const { modelId, elementId } = req.params;
      const { wallId, parameterT } = req.body; // parameterT: 0-1 position along wall

      if (!wallId) return res.status(400).json({ error: 'Missing required field: wallId' });

      const all = await storage.getBimElements(modelId) || [];
      const elIdx = all.findIndex((e: any) => (e.id || e.elementId) === elementId);
      const wallIdx = all.findIndex((e: any) => (e.id || e.elementId) === wallId);

      if (elIdx === -1) return res.status(404).json({ error: 'Element not found' });
      if (wallIdx === -1) return res.status(404).json({ error: 'Wall not found' });

      const el = parseElement(all[elIdx]);
      const wall = parseElement(all[wallIdx]);

      const elType = (el.elementType || '').toLowerCase();
      if (!elType.includes('door') && !elType.includes('window')) {
        return res.status(400).json({ error: 'Only doors and windows can be hosted' });
      }

      const wallType = (wall.elementType || '').toLowerCase();
      if (!wallType.includes('wall')) {
        return res.status(400).json({ error: 'Host element must be a wall' });
      }

      // Position the opening along the wall
      const t = Math.max(0.05, Math.min(0.95, parameterT ?? 0.5));
      const wallLoc = wall.geometry?.location?.realLocation || { x: 0, y: 0, z: 0 };
      const wallWidth = wall.geometry?.dimensions?.width || 6;

      el.geometry.location = el.geometry.location || {};
      el.geometry.location.realLocation = {
        x: wallLoc.x + wallWidth * t,
        y: wallLoc.y,
        z: wallLoc.z, // sill height could be added here
      };

      // Set hosting relationship
      if (!el.properties) el.properties = {};
      el.properties.hostWallId = wallId;
      el.properties.hostParameterT = t;
      el.properties.editHistory = [...(el.properties.editHistory || []), {
        action: 'hosted',
        wallId,
        parameterT: t,
        timestamp: new Date().toISOString(),
        source: 'manual',
      }];

      all[elIdx] = el;

      if ((storage as any).upsertBimElements) {
        await (storage as any).upsertBimElements(modelId, all);
      }

      console.log(`🚪 CRUD: Hosted ${elType} ${elementId} in wall ${wallId} at t=${t.toFixed(2)}`);

      res.json({
        success: true,
        element: { id: elementId, hostedIn: wallId, parameterT: t },
      });
    } catch (error: any) {
      console.error('Error hosting element:', error);
      res.status(500).json({ error: `Failed to host element: ${error?.message}` });
    }
  },
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function inferCategory(type: string): string {
  if (['wall', 'door', 'window', 'stair', 'roof'].some(t => type.includes(t))) return 'architectural';
  if (['column', 'beam', 'foundation', 'slab'].some(t => type.includes(t))) return 'structural';
  if (['pipe', 'duct', 'conduit', 'sprinkler', 'light'].some(t => type.includes(t))) return 'mep';
  return 'architectural';
}

function inferMaterial(type: string): string {
  if (type.includes('column') || type.includes('beam') || type.includes('slab') || type.includes('foundation')) {
    return 'Concrete (30MPa)';
  }
  if (type.includes('wall')) return 'CMU Block';
  if (type.includes('door')) return 'Hollow Metal Frame';
  if (type.includes('window')) return 'Aluminum Frame, Double Glazed';
  if (type.includes('pipe')) return 'Copper Type L';
  if (type.includes('duct')) return 'Galvanized Sheet Metal';
  return 'General';
}
