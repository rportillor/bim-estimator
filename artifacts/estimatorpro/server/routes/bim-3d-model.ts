/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  BIM 3D MODEL ROUTES — API endpoints for real 3D model generation
 *  Connects the geometry pipeline to the existing BIM generation flow.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Request, type Response } from 'express';
import { buildModel, importFile, toViewerElements, type RawBIMInput, type BuildingContext } from '../bim/model-builder';
import { runClashDetection, summarizeClashes } from '../bim/clash-detection';
import { exportBIMToIFC4 } from '../bim/ifc-export-v2';
import { serializeBIMSolid, type BIMSolid } from '../bim/parametric-elements';

export const bim3DRouter = Router();

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /bim/models/:modelId/build-3d
//  Convert existing BIM elements into real 3D geometry
// ═══════════════════════════════════════════════════════════════════════════════

bim3DRouter.post('/bim/models/:modelId/build-3d', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { storage } = req.app.locals;
    const userId = (req as any).user?.id;

    // Verify access
    const model = await storage.getBimModel(modelId);
    if (!model) return res.status(404).json({ error: 'Model not found' });

    const project = await storage.getProject(model.projectId);
    if (!project || project.userId !== userId) return res.status(403).json({ error: 'Access denied' });

    // Fetch existing elements from database
    const dbElements = await storage.getBimElements(modelId);
    if (!dbElements || dbElements.length === 0) {
      return res.status(400).json({ error: 'No elements found in model. Generate BIM first.' });
    }

    // Convert DB elements to RawBIMInput
    const rawElements: RawBIMInput[] = dbElements.map((e: any) => {
      const geometry = typeof e.geometry === 'string' ? JSON.parse(e.geometry) : e.geometry || {};
      const properties = typeof e.properties === 'string' ? JSON.parse(e.properties) : e.properties || {};
      const dims = geometry.dimensions || properties.dimensions || {};
      const loc = geometry.location?.realLocation || properties.realLocation || {};

      return {
        id: e.id || e.elementId,
        type: e.elementType || 'Generic',
        name: e.name || e.elementType,
        category: e.category,
        storey: e.storeyName || e.level || 'Level 1',
        elevation: Number(e.elevation) || 0,
        length: Number(dims.length || dims.width) || undefined,
        width: Number(dims.width || dims.thickness) || undefined,
        height: Number(dims.height) || undefined,
        thickness: Number(dims.thickness || dims.depth) || undefined,
        depth: Number(dims.depth) || undefined,
        x: Number(loc.x) || 0,
        y: Number(loc.y) || 0,
        z: Number(loc.z) || 0,
        startX: properties.start?.x,
        startY: properties.start?.y,
        endX: properties.end?.x,
        endY: properties.end?.y,
        material: e.material || properties.material,
        sectionDesignation: properties.sectionDesignation || properties.profileName || properties.steelSection || properties.memberSize,
        source: 'ai_modeled',
        properties,
      };
    });

    // Build context from storeys
    const storeys = await storage.getBimStoreys?.(modelId) || [];
    const context: BuildingContext = {
      name: project.name || 'Project',
      storeys: storeys.length > 0
        ? storeys.map((s: any) => ({
            name: s.name,
            elevation: Number(s.elevation) || 0,
            floorToFloorHeight: Number(s.floorToFloorHeight) || 3.0,
          }))
        : [{ name: 'Level 1', elevation: 0, floorToFloorHeight: 3.0 }],
    };

    // Build the 3D model
    const result = buildModel(rawElements, context, {
      runClashCheck: true,
      generateIFC: true,
      ifcOptions: { projectName: project.name },
    });

    // Store the IFC content
    if (result.ifcContent) {
      await storage.updateBimModel(modelId, {
        ifcData: result.ifcContent,
        geometryData: JSON.stringify({
          version: '2.0',
          engine: 'proie-geometry-kernel',
          elementCount: result.elements.length,
          stats: result.stats,
        }),
        status: 'ready',
        elementCount: result.elements.length,
      });
    }

    // Update elements with real geometry data
    for (const el of result.elements) {
      const serialized = serializeBIMSolid(el);
      try {
        await storage.updateBimElement?.(el.id, {
          geometry: JSON.stringify({
            dimensions: {
              length: el.quantities.length,
              width: el.quantities.width,
              height: el.quantities.height,
              depth: el.quantities.thickness,
              area: el.quantities.surfaceArea,
              volume: el.quantities.volume,
            },
            location: { realLocation: el.origin },
            mesh: serialized,
            boundingBox: el.boundingBox,
            profile: el.profile ? { outer: el.profile.outer, holes: el.profile.holes } : undefined,
          }),
          properties: JSON.stringify({
            material: el.material,
            assembly: el.assembly?.name,
            layers: el.layers?.map(l => ({ name: l.name, thickness: l.thickness, material: l.material })),
            ifcClass: el.ifcClass,
            source: el.source,
            hostId: el.hostId,
            hostedIds: el.hostedIds,
            connectedIds: el.connectedIds,
            quantities: el.quantities,
          }),
        });
      } catch {
        // Non-fatal — element may not exist in DB if it was created by geometry pipeline
      }
    }

    res.json({
      success: true,
      stats: result.stats,
      clashSummary: result.clashSummary,
      warnings: result.warnings,
      hasIFC: !!result.ifcContent,
    });
  } catch (error: any) {
    console.error('3D model build error:', error);
    res.status(500).json({ error: error.message || 'Failed to build 3D model' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /bim/models/:modelId/viewer-data
//  Return serialized mesh data for the 3D viewer
// ═══════════════════════════════════════════════════════════════════════════════

bim3DRouter.get('/bim/models/:modelId/viewer-data', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { storage } = req.app.locals;
    const userId = (req as any).user?.id;

    const model = await storage.getBimModel(modelId);
    if (!model) return res.status(404).json({ error: 'Model not found' });

    const project = await storage.getProject(model.projectId);
    if (!project || project.userId !== userId) return res.status(403).json({ error: 'Access denied' });

    const dbElements = await storage.getBimElements(modelId);
    const viewerData = dbElements.map((e: any) => {
      const geometry = typeof e.geometry === 'string' ? JSON.parse(e.geometry) : e.geometry || {};
      const properties = typeof e.properties === 'string' ? JSON.parse(e.properties) : e.properties || {};

      return {
        id: e.id,
        type: e.elementType,
        name: e.name,
        category: e.category,
        storey: e.storeyName || 'Level 1',
        material: e.material || properties.material,
        origin: geometry.location?.realLocation || { x: 0, y: 0, z: 0 },
        rotation: properties.rotation || 0,
        mesh: geometry.mesh || null,  // SerializedMesh from 3D build
        boundingBox: geometry.boundingBox || null,
        dimensions: geometry.dimensions || {},
        quantities: properties.quantities || {},
        color: properties.color,
        opacity: properties.opacity,
        hostId: properties.hostId,
        ifcClass: properties.ifcClass,
        source: properties.source || 'ai_modeled',
        // Legacy compatibility
        properties,
      };
    });

    res.json({
      modelId,
      engineVersion: '2.0',
      elements: viewerData,
      total: viewerData.length,
      hasMeshData: viewerData.some((e: any) => e.mesh != null),
    });
  } catch (error: any) {
    console.error('Viewer data error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch viewer data' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /bim/models/:modelId/clash-check
//  Run clash detection on an existing model
// ═══════════════════════════════════════════════════════════════════════════════

bim3DRouter.post('/bim/models/:modelId/clash-check', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { storage } = req.app.locals;
    const userId = (req as any).user?.id;

    const model = await storage.getBimModel(modelId);
    if (!model) return res.status(404).json({ error: 'Model not found' });

    const project = await storage.getProject(model.projectId);
    if (!project || project.userId !== userId) return res.status(403).json({ error: 'Access denied' });

    // Fetch and rebuild elements
    const dbElements = await storage.getBimElements(modelId);
    const rawElements: RawBIMInput[] = dbElements.map((e: any) => {
      const geometry = typeof e.geometry === 'string' ? JSON.parse(e.geometry) : e.geometry || {};
      const properties = typeof e.properties === 'string' ? JSON.parse(e.properties) : e.properties || {};
      const dims = geometry.dimensions || {};
      const loc = geometry.location?.realLocation || {};

      return {
        id: e.id, type: e.elementType || 'Generic', name: e.name,
        storey: e.storeyName || 'Level 1', elevation: Number(e.elevation) || 0,
        length: Number(dims.length) || undefined, width: Number(dims.width) || undefined,
        height: Number(dims.height) || undefined, thickness: Number(dims.thickness) || undefined,
        x: Number(loc.x) || 0, y: Number(loc.y) || 0, z: Number(loc.z) || 0,
        material: e.material,
        sectionDesignation: properties.sectionDesignation || properties.profileName || properties.steelSection || properties.memberSize,
        source: 'ai_modeled',
        properties,
      };
    });

    const context: BuildingContext = {
      name: project.name || 'Project',
      storeys: [{ name: 'Level 1', elevation: 0, floorToFloorHeight: 3.0 }],
    };

    const result = buildModel(rawElements, context, { runClashCheck: true, generateIFC: false });

    res.json({
      clashes: result.clashes,
      summary: result.clashSummary,
      elementCount: result.elements.length,
    });
  } catch (error: any) {
    console.error('Clash check error:', error);
    res.status(500).json({ error: error.message || 'Clash detection failed' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /bim/import-file
//  Import IFC/DXF/DWG file directly into a project as a 3D model
// ═══════════════════════════════════════════════════════════════════════════════

bim3DRouter.post('/bim/import-file', async (req: Request, res: Response) => {
  try {
    const { storage } = req.app.locals;
    const userId = (req as any).user?.id;
    const { projectId, documentId, filename } = req.body;

    if (!projectId || !documentId) {
      return res.status(400).json({ error: 'projectId and documentId required' });
    }

    // Verify access
    const project = await storage.getProject(projectId);
    if (!project || project.userId !== userId) return res.status(403).json({ error: 'Access denied' });

    // Load the file content
    const document = await storage.getDocument?.(documentId);
    if (!document) return res.status(404).json({ error: 'Document not found' });

    const fs = await import('fs');
    const path = await import('path');

    // Try to load the file
    const filePath = document.storageKey || document.filePath || document.path;
    if (!filePath) return res.status(400).json({ error: 'Document has no file path' });

    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found on disk' });

    const content = fs.readFileSync(fullPath);
    const fname = filename || document.filename || document.name || 'import.ifc';

    // Import the file
    const importResult = await importFile(content, fname);

    if (importResult.elements.length === 0) {
      return res.json({
        success: false,
        format: importResult.format,
        warnings: importResult.warnings,
        message: 'No elements could be extracted from this file.',
      });
    }

    // Create a BIM model
    const modelId = `model_${Date.now()}`;
    await storage.createBimModel?.({
      id: modelId,
      projectId,
      name: importResult.projectName || `Imported ${importResult.format.toUpperCase()} Model`,
      modelType: 'imported',
      status: 'ready',
      elementCount: importResult.elements.length,
    });

    // Store elements
    for (const el of importResult.elements) {
      const serialized = serializeBIMSolid(el);
      await storage.createBimElement?.({
        modelId,
        elementId: el.id,
        elementType: el.type,
        name: el.name,
        category: el.category,
        material: el.material,
        storeyName: el.storey,
        elevation: String(el.elevation),
        geometry: JSON.stringify({
          dimensions: {
            length: el.quantities.length,
            width: el.quantities.width,
            height: el.quantities.height,
            depth: el.quantities.thickness,
            area: el.quantities.surfaceArea,
            volume: el.quantities.volume,
          },
          location: { realLocation: el.origin },
          mesh: serialized,
          boundingBox: el.boundingBox,
        }),
        properties: JSON.stringify({
          material: el.material,
          ifcClass: el.ifcClass,
          source: el.source,
          quantities: el.quantities,
        }),
      });
    }

    // Generate IFC export
    const ifcContent = exportBIMToIFC4(importResult.elements, {
      projectName: importResult.projectName || project.name,
    });

    await storage.updateBimModel?.(modelId, { ifcData: ifcContent });

    res.json({
      success: true,
      modelId,
      format: importResult.format,
      storeys: importResult.storeys,
      stats: importResult.stats,
      elementCount: importResult.elements.length,
      warnings: importResult.warnings,
    });
  } catch (error: any) {
    console.error('File import error:', error);
    res.status(500).json({ error: error.message || 'File import failed' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /bim/models/:modelId/download-v2
//  Download IFC4 file with real geometry
// ═══════════════════════════════════════════════════════════════════════════════

bim3DRouter.get('/bim/models/:modelId/download-v2', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { storage } = req.app.locals;
    const userId = (req as any).user?.id;

    const model = await storage.getBimModel(modelId);
    if (!model) return res.status(404).json({ error: 'Model not found' });

    const project = await storage.getProject(model.projectId);
    if (!project || project.userId !== userId) return res.status(403).json({ error: 'Access denied' });

    if (!model.ifcData) {
      return res.status(404).json({ error: 'No IFC data. Run Build 3D first.' });
    }

    res.setHeader('Content-Type', 'application/x-step');
    res.setHeader('Content-Disposition', `attachment; filename="${(model.name || 'model').replace(/[^a-zA-Z0-9_-]/g, '_')}.ifc"`);
    res.send(model.ifcData);
  } catch (error: any) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});
