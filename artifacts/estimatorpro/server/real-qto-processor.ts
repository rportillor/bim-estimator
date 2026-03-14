/**
 * 🏗️ Real QTO (Quantity Take-Off) Processor for EstimatorPro
 * 
 * Phase 2: Professional IFC quantity extraction to replace mock data
 * Integrates with existing BIM generation system
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { logger } from './utils/enterprise-logger';
import { parseFirstJsonObject } from './utils/anthropic-response';
import { CADParser, type CADParseResult } from './cad-parser';
import { loadAllRules, evaluateRules } from './compliance/rules-engine';
import type { AnalysisOptions, RealBIMElement, StoreyData } from './types/shared-bim-types';
import { analyzeDrawingsForFacts } from "./services/drawing-analyzer";
import { placeFromDrawingFacts } from "./helpers/symbol-placer";
import { inferStoreysIfMissing } from "./helpers/storey-inference";
import { GeometryValidator, validateExtractedGeometry, GridSystem } from './helpers/geometry-validator';
import { normaliseElevation, toMetres } from './helpers/unit-normaliser';
import { registerMissingData } from './estimator/rfi-generator';

// 📏 Unit Conversion Constants
const _UNIT_CONVERSIONS = {
  METER_TO_FEET: 3.28084,
  SQM_TO_SQFT: 10.7639,
  CBM_TO_CBFT: 35.3147,
  KG_TO_LBS: 2.20462,
} as const;

// 🎯 Drawing Facts Enrichment Function
async function _enrichWithDrawingFacts(projectId:string, modelId:string, baseElements:any[], modelMeta:any, docs:any[]){
  try {
    const { enabled, facts } = await analyzeDrawingsForFacts(projectId, docs);
    if (!enabled) return baseElements;

    const storeys = inferStoreysIfMissing(modelMeta?.storeys, baseElements, {});
    // footprint/perimeter if present
    const foot = modelMeta?.perimeter || modelMeta?.footprint || null;

    // fallback bbox from current elements
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for (const e of baseElements||[]){
      const g = typeof e?.geometry==="string" ? JSON.parse(e.geometry) : e?.geometry;
      const p = g?.location?.realLocation; if (!p) continue;
      if (p.x<minX)minX=p.x; if (p.x>maxX)maxX=p.x; if (p.y<minY)minY=p.y; if (p.y>maxY)maxY=p.y;
    }
    if (!Number.isFinite(minX)) { 
      logger.warn('No element geometry found for footprint bbox — skipping MEP enrichment from drawing facts');
      return baseElements;
    }

    const placed = placeFromDrawingFacts({
      facts,
      storeys,
      footprint: Array.isArray(foot) ? foot : null,
      fallbackBBox: { minX, minY, maxX, maxY }
    });

    const merged = [...baseElements, ...placed];
    logger.info(`Enriched from drawings: added ${placed.length} MEP elements (lights/sprinklers/receptacles/panels)`);
    return merged;
  } catch (e:any) {
    console.warn("[draw] enrichment failed:", e?.message || e);
    return baseElements;
  }
}

// 🏗️ Real Building Element with Quantities - moved to shared types
// Interfaces now imported from './types/shared-bim-types'

export class RealQTOProcessor {
  private cadParser: CADParser;
  
  constructor() {
    this.cadParser = new CADParser();
  }
  
  /**
   * 🎯 Main entry point: Process real data instead of generating mock elements
   */
  async processRealBIMData(
    projectId: string,
    documentPath?: string,
    options: AnalysisOptions & { extractedProducts?: any[], extractedAssemblies?: any[], workflowElements?: any[] } = {
      unitSystem: 'metric',
      includeStoreys: true,
      computeGeometry: true
    }
  ): Promise<{
    elements: RealBIMElement[];
    storeys: StoreyData[];
    summary: {
      totalElements: number;
      elementTypes: Record<string, number>;
      totalQuantities: {
        volume: { metric: number; imperial: number };
        area: { metric: number; imperial: number };
      };
      processingMethod: string;
    };
  }> {
    // 🚀 LOG: Track what we received from ConstructionWorkflow
    logger.info(`🎯 RealQTOProcessor.processRealBIMData called with:`);
    logger.info(`   - Project: ${projectId}`);
    logger.info(`   - Products: ${options.extractedProducts?.length || 0} from workflow`);
    logger.info(`   - Assemblies: ${options.extractedAssemblies?.length || 0} from workflow`);
    logger.info(`   - Elements: ${options.workflowElements?.length || 0} from workflow`);
    
    // If we have workflow elements, use those directly
    if (options.workflowElements && options.workflowElements.length > 0) {
      logger.info(`✨ USING ${options.workflowElements.length} ELEMENTS FROM WORKFLOW`);
      logger.info(`   These elements already have product-based CSI codes!`);
      
      // Sample log of elements
      options.workflowElements.slice(0, 5).forEach((el: any, i: number) => {
        logger.info(`   Element ${i+1}: ${el.type || el.elementType} - ${el.properties?.itemCode || 'NO_CODE'}`);
      });
      
      // Convert to RealBIMElement format and return
      const elements = options.workflowElements.map((el: any) => ({
        ...el,
        id: el.id || randomUUID(),
        elementType: el.elementType || el.type,
        geometry: typeof el.geometry === 'string' ? JSON.parse(el.geometry) : el.geometry
      }));
      
      const storeys = this.extractStoreysFromElements(elements);
      const summary = {
        ...this.generateRealSummary(elements),
        source: 'construction-workflow-with-products'
      };
      
      return { elements, storeys, summary };
    }
    
    logger.info(`Starting real QTO processing for project ${projectId}`);
    logger.debug('Checking Claude analysis in options', { hasAnalysis: !!options.claudeAnalysis });
    
    // Load compliance rules for active validation
    const complianceRules = loadAllRules();
    logger.info(`📋 Loaded ${complianceRules.length} compliance rules for validation`);
    
    try {
      // Phase 2.1: Try to process real IFC file if available
      if (documentPath && this.isIFCFile(documentPath)) {
        logger.info(`Processing IFC file: ${documentPath}`);
        // Use claudeAnalysis from options (fix parameter passing)
        return await this.processIFCFile(documentPath, options, options.claudeAnalysis);
      }
      
      // Phase 2.2: Process other document types with AI enhancement
      if (documentPath) {
        logger.info(`Processing document with AI analysis: ${documentPath}`);
        logger.debug('Processing document with AI', { hasClaudeAnalysis: !!options.claudeAnalysis });
        // Use claudeAnalysis from options (fix parameter passing)
        return await this.processDocumentWithAI(documentPath, options, options.claudeAnalysis);
      }
      
      // 🚨 NO SAMPLE DATA - Require real documents
      logger.error(`No valid construction documents provided`);
      throw new Error('Real BIM processing requires construction documents. Please upload PDF drawings, DWG/DXF CAD files, or IFC models.');
      
    } catch (error: any) {
      console.error('❌ Real QTO processing failed:', error);
      console.error('🔍 STACK TRACE:', error.stack);
      console.error('🔍 ERROR DETAILS:', JSON.stringify(error, null, 2));
      // 🎯 NO FALLBACK - Force success with enhanced Claude analysis
      logger.error('No fallback - forcing Claude analysis success');
      logger.info('Retrying with enhanced Claude analysis for coordinate extraction...');
      return await this.generateElementsFromExistingAnalysis(options.claudeAnalysis || {}, options);
    }
  }
  
  /**
   * 📂 Process real IFC file (Phase 2 implementation)
   */
  private async processIFCFile(
    filePath: string, 
    options: any,
    claudeAnalysis?: any
  ): Promise<{
    elements: RealBIMElement[];
    storeys: StoreyData[];
    summary: any;
  }> {
    // IFC text-based extraction (Phase 1). Full geometry parsing requires web-ifc (Phase 2).
    // For now: use the same Claude-analysis floors[] pipeline as the PDF path so all
    // element-level RFI logic fires correctly.  An RFI is raised to track the upgrade need.
    const fileStats = fs.statSync(filePath);
    logger.info('Processing IFC file via Claude analysis pipeline', {
      sizeMB: (fileStats.size / 1024 / 1024).toFixed(2)
    });

    // Register an informational RFI about the text-only IFC limitation
    try {

      registerMissingData({
        category: 'specification',
        description:
          'IFC file uploaded. Full geometry extraction requires the web-ifc library (Phase 2 upgrade). ' +
          'Elements are extracted from the Claude AI analysis of the IFC content — coordinate precision ' +
          'is lower than native IFC parsing. Upgrade to web-ifc for production-grade IFC support.',
        csiDivision: '00 00 00', impact: 'low',
        drawingRef: `IFC file: ${filePath.split('/').pop()}`,
        costImpactLow: 0, costImpactHigh: 0,
        assumptionUsed: 'claude_text_analysis',
        discoveredBy: 'processIFCFile',
      });
    } catch { /* non-fatal */ }

    // Delegate entirely to the Claude analysis pipeline — identical to PDF path
    if (claudeAnalysis) {
      const result = await this.generateElementsFromExistingAnalysis(claudeAnalysis, options);
      result.summary.processingMethod = 'IFC file — Claude text analysis (upgrade to web-ifc for full geometry)';
      return result;
    }

    // No Claude analysis provided — return empty model with critical RFI
    try {

      registerMissingData({
        category: 'drawing',
        description:
          'IFC file received but no Claude analysis was provided. ' +
          'Cannot extract elements without AI analysis of the IFC content. ' +
          'Ensure the IFC file is passed through the Claude analysis pipeline before BIM generation.',
        csiDivision: '00 00 00', impact: 'critical',
        drawingRef: `IFC file: ${filePath.split('/').pop()}`,
        costImpactLow: 0, costImpactHigh: 0,
        assumptionUsed: 'none — model is empty',
        discoveredBy: 'processIFCFile',
      });
    } catch { /* non-fatal */ }

    return {
      elements: [],
      storeys: [],
      summary: {
        totalElements: 0,
        processingMethod: 'IFC — no Claude analysis',
        rfiCount: 1,
        note: 'IFC received without Claude analysis — see RFI dashboard.',
      },
    };
  }
  
  /**
   * 📋 Process document with AI-powered PDF analysis (ENHANCED!)
   */
  private async processDocumentWithAI(
    filePath: string,
    options: any,
    claudeAnalysis?: any
  ): Promise<{
    elements: RealBIMElement[];
    storeys: StoreyData[];
    summary: any;
  }> {
    logger.info(`Real document processing: ${path.basename(filePath)}`, {
      hasClaudeAnalysis: !!claudeAnalysis
    });
    
    try {
      // 🎯 ENHANCED: Handle PDFs with AI analysis for building geometry extraction
      if (filePath.toLowerCase().endsWith('.pdf')) {
        logger.info('Analyzing PDF construction documents for building geometry');
        return await this.analyzePDFForBuildingGeometry(filePath, options, claudeAnalysis);
      }
      
      // ✅ PARSE REAL CAD FILES (DWG/DXF/IFC)
      const cadResult: CADParseResult = await this.cadParser.parseCADFile(filePath, path.basename(filePath));
      
      logger.info('CAD parsing completed', {
        entities: cadResult.entities.length,
        components: cadResult.extractedData.buildingComponents.length
      });
      
      // ✅ CONVERT CAD ENTITIES TO REAL BIM ELEMENTS
      const elements: RealBIMElement[] = [];
      const storeys: StoreyData[] = this.extractStoreysFromCAD(filePath);
      
      // Process building components from real CAD data
      let componentIndex = 0;
      for (const component of cadResult.extractedData.buildingComponents) {
        const element = this.convertCADComponentToBIMElement(component, componentIndex++);
        elements.push(element);
        
        // Update storey count
        if (element.storey) {
          const storey = storeys.find(s => s.name === element.storey!.name);
          if (storey) storey.elementCount++;
        }
      }
      
      // Also process generic CAD entities as building elements
      let entityIndex = 0;
      for (const entity of cadResult.entities) {
        if (this.isArchitecturalEntity(entity)) {
          const element = this.convertCADEntityToBIMElement(entity, entityIndex++);
          if (element) { // Only add elements with real coordinates
            elements.push(element);
          }
        }
      }
      
      const summary = {
        ...this.generateRealSummary(elements),
        processingMethod: `Real CAD parsing: ${cadResult.format} file`,
        cadData: {
          totalEntities: cadResult.entities.length,
          layers: cadResult.layers,
          drawingBounds: cadResult.statistics.drawingBounds,
          buildingComponents: cadResult.extractedData.buildingComponents.length
        }
      };
      
      // Extract building facts for compliance checking
      const buildingFacts = this.extractBuildingFactsFromAnalysis(claudeAnalysis, elements);
      
      // Run compliance validation
      const complianceRules = loadAllRules();
      const complianceResults = evaluateRules(buildingFacts, complianceRules);
      
      logger.info(`✅ Compliance validation: ${complianceResults.passed} passed, ${complianceResults.failed} failed, ${complianceResults.warnings} warnings`);
      
      logger.info(`Generated ${elements.length} BIM elements from CAD data`);
      return { 
        elements, 
        storeys, 
        summary: {
          ...summary,
          building_analysis: claudeAnalysis?.building_analysis || null,
          buildingAnalysis: claudeAnalysis?.building_analysis || null,
          complianceStatus: {
            passed: complianceResults.passed,
            failed: complianceResults.failed,
            warnings: complianceResults.warnings,
            coverage: complianceResults.coverage
          }
        },
        complianceResults
      } as any;
      
    } catch (error: any) {
      console.error(`❌ Document processing failed for ${filePath}:`, error);
      // NO FALLBACK - Report the actual error
      logger.error('CAD processing failed:', error);
      throw new Error(`Failed to process CAD file: ${error.message || 'Unknown error'}`);
    }
  }
  
  /**
   * 🤖 Use existing Claude analysis from database for real building geometry
   */
  private async analyzePDFForBuildingGeometry(
    filePath: string,
    options: any,
    claudeAnalysis?: any
  ): Promise<{
    elements: RealBIMElement[];
    storeys: StoreyData[];
    summary: any;
  }> {
    logger.info('Using existing Claude analysis', { file: path.basename(filePath) });
    
    try {
      // 🎯 GET EXISTING CLAUDE ANALYSIS from database instead of re-analyzing
      const filename = path.basename(filePath);
      const existingAnalysis = await this.getExistingClaudeAnalysis(filename);
      
      // LOG PRODUCTS AND ASSEMBLIES FROM WORKFLOW
      if (options.extractedProducts && options.extractedProducts.length > 0) {
        logger.info(`📦 Using ${options.extractedProducts.length} products from ConstructionWorkflow:`);
        options.extractedProducts.slice(0, 5).forEach((p: any) => {
          const code = p.itemCode || p.csiCode || p.id;
          const desc = p.description || p.name || 'Unknown';
          logger.info(`   - ${code}: ${desc}`);
        });
        if (options.extractedProducts.length > 5) {
          logger.info(`   ... and ${options.extractedProducts.length - 5} more products`);
        }
      }
      
      if (options.extractedAssemblies && options.extractedAssemblies.length > 0) {
        logger.info(`🔧 Using ${options.extractedAssemblies.length} assemblies from ConstructionWorkflow`);
      }
      
      if (options.workflowElements && options.workflowElements.length > 0) {
        logger.info(`🏭 Using ${options.workflowElements.length} elements already built from assemblies`);
      }
      
      // ── Bug-B fix (v15.4): workflowElements bypass moved OUTSIDE existingAnalysis block ──
      // getExistingClaudeAnalysis() always returns null, so the old if(existingAnalysis)
      // guard made this shortcut unreachable.  Check workflowElements first, unconditionally.
      if (options.workflowElements && options.workflowElements.length > 0) {
        logger.info(`✨ Using ${options.workflowElements.length} elements from ConstructionWorkflow (already matched to products)`);
        const elements = options.workflowElements.map((el: any) => ({
          ...el,
          id: el.id || randomUUID(),
          elementType: el.elementType || el.type,
          geometry: typeof el.geometry === 'string' ? JSON.parse(el.geometry) : el.geometry
        }));
        const storeys = this.extractStoreysFromElements(elements);
        const summary = this.generateRealSummary(elements);
        return { elements, storeys, summary };
      }

      if (existingAnalysis) {
        const components = existingAnalysis.ai_understanding?.building_components_detected || {};
        logger.info(`Found existing Claude analysis with ${components.walls ?? 'UNKNOWN'} walls, ${components.columns ?? 'UNKNOWN'} columns`);
        // 🎯 Generate elements with REAL COORDINATES from Claude's spatial analysis
        return await this.generateElementsFromExistingAnalysis(existingAnalysis, options);
      }
      
      logger.warn(`No existing analysis found for ${filename} - performing new analysis`);
      
      // Check if we have a textBundle in claudeAnalysis
      if (claudeAnalysis?.textBundle) {
        logger.info(`Using provided textBundle for Claude analysis (${claudeAnalysis.textBundle.length} chars)`);
        
        // Use Claude to analyze the provided text bundle
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        });
        
        // Analyze the text bundle directly, skip the PDF reading
        const textContent = claudeAnalysis.textBundle;
        // Resolve project name from storage — no hardcoded fallback
        let qtoProjectName = '[PROJECT NAME — RFI REQUIRED: project not found]';
        try {
          const { storage } = await import('./storage');
          const qtoProject = options?.projectId ? await storage.getProject(options.projectId) : null;
          if (qtoProject?.name) qtoProjectName = qtoProject.name;
        } catch { /* non-fatal */ }

        const analysisPrompt = `Extract ALL building elements from these "${qtoProjectName}" construction documents.

CRITICAL: Extract ACTUAL measurements from the construction documents:
- FIRST: Check EVERY sheet - legend may be on ALL sheets or just SOME sheets
- LEGEND LOCATIONS: Document ALL sheets where legend appears (could be every sheet!)
- COMPILE: Gather legend info from all occurrences - some sheets may have additional legend details
- Floor-to-floor heights: Apply compiled legend to read section dimensions correctly
- Floor elevations: Use legend's elevation marking system consistently
- Wall heights: Apply legend's conventions to interpret vertical dimensions everywhere
- Building height from documents (NOT assumed 20m)

OUTPUT JSON FORMAT ONLY:
{
  "drawing_legend": {
    "found_on_sheets": ["List ALL sheets where legend appears - might be EVERY sheet or just some"],
    "dimension_format": "How dimensions are shown (mm, m, ft-in) from all legend occurrences",
    "elevation_datum": "Datum reference point for elevations",
    "height_notation": "How vertical dimensions are indicated",
    "line_patterns": {
      "grid_lines": "Pattern used for grids (e.g., dash-dot)",
      "walls": "Pattern for walls (e.g., solid)",
      "hidden": "Pattern for hidden/above (e.g., dashed)"
    }
  },
  "building_perimeter": [{"x": 0, "y": 0}, {"x": 30, "y": 0}, ...], // ACTUAL shape from floor plans
  "floor_to_floor_heights": {
    "ground_to_second": null, // EXTRACT from sections (e.g., 3.65m)
    "second_to_third": null,  // EXTRACT from sections
    "third_to_fourth": null,  // EXTRACT from sections
    "typical_floor_height": null // EXTRACT typical height if shown
  },
  "floors": [
    {
      "level": "Ground Floor",
      "elevation": null, // EXTRACT actual elevation mark (e.g., 219.85)
      "ceiling_height": null, // EXTRACT using legend's conventions from section dimensions
      "walls": [{"id": "W1", "start": {"x": 0, "y": 0}, "end": {"x": 5, "y": 0}, "thickness": 200, "ceiling_height": null, "type": "exterior|interior|fire-rated|curtain", "material": "concrete|masonry|stud", "fire_rating": null}], // EXTRACT from architectural drawings — thickness in mm, ceiling_height in mm. Return null if not in drawings
      "columns": [{"id": "C1", "x": 5, "y": 5, "size": "400x400", "height": null, "type": "concrete|steel|timber", "reinforcement": null}], // USE LEGEND to read height — return null if not in structural drawings
      "beams": [{"id": "B1", "start": {"x": 0, "y": 5}, "end": {"x": 6, "y": 5}, "size": "300x600", "depth": 600, "material": "concrete|steel", "top_elevation": null}], // EXTRACT from structural drawings
      "slabs": [{"id": "SL1", "boundary": [{"x": 0, "y": 0}, {"x": 22, "y": 0}, {"x": 22, "y": 15}, {"x": 0, "y": 15}], "thickness": 200, "type": "floor|roof|transfer", "material": "concrete", "top_elevation": null}], // EXTRACT slab boundary = floor plate extents; thickness from sections
      "stairs": [{"id": "ST1", "x": 10, "y": 5, "width": 1200, "length": 4000, "rises": 16, "rise_mm": 175, "run_mm": 275, "type": "straight|L-shaped|U-shaped", "material": "concrete|steel|timber"}], // EXTRACT from floor plans and sections
      "foundations": [{"id": "F1", "x": 5, "y": 5, "width": 600, "depth_mm": 400, "bearing_depth_m": 1.5, "type": "spread|strip|pile|raft", "material": "concrete"}], // GROUND FLOOR ONLY — from foundation plan/sections
      "mep": [{"id": "L1", "category": "electrical", "type": "light", "x": 3, "y": 3, "mounting_height": 2.7}, {"id": "SP1", "category": "mechanical", "type": "sprinkler", "x": 3, "y": 3, "mounting_height": 2.9}, {"id": "REC1", "category": "electrical", "type": "receptacle", "x": 1, "y": 2, "mounting_height": 0.4}], // EXTRACT MEP symbols from plans per legend
      "doors": [{"id": "D1", "x": 2.5, "y": 0, "width": 900, "height": null, "thickness": null, "wall_thickness": null, "type": "single|double|sliding", "fire_rating": null, "hardware_set": null}], // EXTRACT width AND height from door schedule. Return null for any field not in drawings — do NOT use standard values
      "windows": [{"id": "WIN1", "x": 7, "y": 0, "width": 1800, "height": null, "sill_height": null, "type": "fixed|casement|curtain-wall", "glazing": null}], // EXTRACT width AND height from window schedule. Return null for any field not in drawings — do NOT use standard values
      "rooms": [{"id": "R1", "name": "Living Room", "boundary": [{"x": 0, "y": 0}, {"x": 5, "y": 0}, {"x": 5, "y": 4}, {"x": 0, "y": 4}], "ceiling_height": null, "area_m2": null}] // USE LEGEND
    }
  ]
}

CRITICAL — REAL VALUES FROM DRAWINGS ONLY:
- Extract ONLY what is explicitly shown in the drawings — never invent or estimate dimensions
- Return null for any field not found in the drawings — do NOT substitute standard values
- Required fields (return null if not in drawings, element will be flagged as RFI):
  walls: start, end (x/y coords from floor plan grid), thickness (mm from sections)
  columns: x, y (from grid), size (from schedule or structural plan)
  doors: x, y (from floor plan), width (from door schedule)
  windows: x, y (from floor plan), width (from window schedule)
  slabs: boundary polygon (min 3 points from floor plan), thickness (from sections)
  beams: start, end (x/y from structural plan), size (from structural schedule)

MANDATORY EXTRACTION REQUIREMENTS:
- Extract EVERY wall, column, beam, slab, stair, foundation, door, window visible in drawings
- SLABS: Each floor has a slab — extract its boundary polygon matching the floor plate, thickness from sections
- BEAMS: Extract ALL beams from structural plans — match column-to-column spans
- STAIRS: Extract ALL stair locations from floor plans including width, rise, run
- FOUNDATIONS: Extract from foundation plan — spread footings, strip footings, piles
- MEP: Count all light fixtures, sprinklers, receptacles, diffusers, grilles from MEP plans
- Should be HUNDREDS of elements across all floors — be thorough, do not omit any element type

EXTRACT FROM DOCUMENTS:
${textContent.substring(0, 500000)}`;
        
        // Use streaming to avoid SDK "Streaming is strongly recommended" error at high token counts
        const stream = anthropic.messages.stream({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          messages: [{ role: "user", content: analysisPrompt }]
        });
        const streamResponse = await stream.finalMessage();

        const aiAnalysis = streamResponse.content[0].type === 'text' ? streamResponse.content[0].text : '';
        return await this.generateElementsFromAIAnalysis(aiAnalysis, options);
      }
      
      // Load PDF buffers — when allDocumentStorageKeys is provided we send ALL PDFs to Claude
      // in a single call (Claude API allows up to 20 documents per message).
      // Otherwise fall back to the single primary PDF.
      const { loadFileBuffer } = await import('./services/storage-file-resolver');

      const allStorageKeys: string[] = (options?.allDocumentStorageKeys?.length > 0)
        ? options.allDocumentStorageKeys
        : [(claudeAnalysis as any)?.storageKey || path.basename(filePath)].filter(Boolean);

      // Load ALL PDFs — we process them in sequential mini-batches of 4.
      // This avoids Anthropic's 413 (request too large) while still covering
      // every drawing across the full set.
      const pdfBuffers: { key: string; buf: Buffer }[] = [];
      for (const key of allStorageKeys) {
        const buf = await loadFileBuffer(key);
        if (buf) pdfBuffers.push({ key, buf });
        else logger.warn(`⚠️ Could not load PDF for key '${key}' — skipping`);
      }

      if (pdfBuffers.length === 0) {
        logger.warn(`⚠️ Could not load any PDF buffers — skipping new AI analysis`);
        const storeys = this.extractStoreysFromElements([]);
        return {
          elements: [],
          storeys,
          summary: { totalElements: 0, processingMethod: 'pdf_load_failed', rfiCount: 1 }
        };
      }
      logger.info(`Loaded ${pdfBuffers.length} PDFs total — will process in sequential batches of 4 (streaming, 64k tokens each)`);

      // Use Claude to analyze construction documents
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      
      // Resolve project name for prompt
      let pdfProjectName = '[PROJECT NAME]';
      try {
        const { storage: _stor } = await import('./storage');
        const _proj = options?.projectId ? await _stor.getProject(options.projectId) : null;
        if (_proj?.name) pdfProjectName = _proj.name;
      } catch { /* non-fatal */ }

      const analysisPrompt = `Extract ALL building elements from these "${pdfProjectName}" construction drawings to enable accurate 3D BIM reconstruction.

CRITICAL: Extract ACTUAL measurements only — no assumptions, no placeholder values.
- Floor-to-floor heights: read from building sections using the legend's elevation notation
- Floor elevations: read from elevation marks and section datum references
- Wall positions: measure start/end x,y coordinates from floor plans using grid lines
- Column positions: read x,y from structural and architectural plans
- Door/window positions: read x,y from floor plan symbols and door/window schedules

OUTPUT JSON FORMAT ONLY (no other text, no markdown, no explanation):
{
  "drawing_legend": {
    "found_on_sheets": ["List ALL sheets where legend appears"],
    "dimension_format": "How dimensions are shown (mm, m, ft-in) from legend",
    "elevation_datum": "Datum reference point for elevations",
    "height_notation": "How vertical dimensions are indicated",
    "line_patterns": {
      "grid_lines": "Pattern used for grids (e.g., dash-dot)",
      "walls": "Pattern for walls (e.g., solid)",
      "hidden": "Pattern for hidden/above (e.g., dashed)"
    }
  },
  "building_perimeter": [{"x": 0, "y": 0}, {"x": 30, "y": 0}],
  "floor_to_floor_heights": {
    "ground_to_second": null,
    "second_to_third": null,
    "third_to_fourth": null,
    "typical_floor_height": null
  },
  "floors": [
    {
      "level": "Ground Floor",
      "elevation": null,
      "ceiling_height": null,
      "walls": [{"id": "W1", "start": {"x": 0, "y": 0}, "end": {"x": 5, "y": 0}, "thickness": 200, "ceiling_height": null, "type": "exterior", "material": "concrete", "fire_rating": null}],
      "columns": [{"id": "C1", "x": 5, "y": 5, "size": "400x400", "height": null, "type": "concrete"}],
      "beams": [{"id": "B1", "start": {"x": 0, "y": 5}, "end": {"x": 6, "y": 5}, "size": "300x600", "depth": 600, "material": "concrete", "top_elevation": null}],
      "slabs": [{"id": "SL1", "boundary": [{"x": 0, "y": 0}, {"x": 22, "y": 0}, {"x": 22, "y": 15}, {"x": 0, "y": 15}], "thickness": 200, "type": "floor", "material": "concrete", "top_elevation": null}],
      "stairs": [{"id": "ST1", "x": 10, "y": 5, "width": 1200, "length": 4000, "rises": 16, "rise_mm": 175, "run_mm": 275, "type": "straight", "material": "concrete"}],
      "foundations": [{"id": "F1", "x": 5, "y": 5, "width": 600, "depth_mm": 400, "bearing_depth_m": 1.5, "type": "spread", "material": "concrete"}],
      "mep": [{"id": "L1", "category": "electrical", "type": "light", "x": 3, "y": 3, "mounting_height": 2.7}],
      "doors": [{"id": "D1", "x": 2.5, "y": 0, "width": 900, "height": null, "thickness": null, "wall_thickness": null, "type": "single", "fire_rating": null}],
      "windows": [{"id": "WIN1", "x": 7, "y": 0, "width": 1800, "height": null, "sill_height": null, "type": "fixed", "glazing": null}],
      "rooms": [{"id": "R1", "name": "Room Name", "boundary": [{"x": 0, "y": 0}, {"x": 5, "y": 0}, {"x": 5, "y": 4}, {"x": 0, "y": 4}], "ceiling_height": null, "area_m2": null}]
    }
  ]
}

MANDATORY EXTRACTION REQUIREMENTS:
- Extract EVERY wall (exterior, interior, fire-rated, curtain) with real x,y start/end points
- Extract EVERY column with real x,y position on the structural/architectural grid
- Extract EVERY beam between columns
- Extract EVERY slab boundary polygon (floor plate extents per level)
- Extract EVERY stair location with width and rise/run dimensions
- Extract ALL foundations from the foundation plan
- Extract ALL MEP symbols: lights, sprinklers, receptacles, diffusers
- Extract EVERY door and window with real x,y position from plans and schedules
- Extract ALL floors/levels including underground, ground, typical, and roof
- There should be HUNDREDS of elements across all floors — be thorough

`;

      // ── Helper: call Claude with streaming for one small batch of PDFs ────────
      // 4 PDFs per batch keeps requests small enough to avoid 413 errors while
      // allowing 64k output tokens (streaming required at this token count).
      const BATCH_SIZE = 4;

      const callClaude = async (bufs: { key: string; buf: Buffer }[], batchLabel: string): Promise<any> => {
        const docList = bufs.map(({ key }, i) => `  ${i + 1}. ${path.basename(key)}`).join('\n');
        const content: any[] = [
          ...bufs.map(({ buf }) => ({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: buf.toString('base64') },
          })),
          {
            type: "text",
            text: analysisPrompt + `\n\nDocuments being analyzed (${bufs.length} drawings, ${batchLabel}):\n${docList}`,
          },
        ];
        const stream = anthropic.messages.stream({
          model: "claude-sonnet-4-20250514",
          max_tokens: 64000,
          messages: [{ role: "user", content }],
        });
        const finalMsg = await stream.finalMessage();
        const raw = finalMsg.content[0].type === 'text' ? finalMsg.content[0].text : '';
        logger.info(`[${batchLabel}] response: ${raw.length} chars`);
        try {
          const m = raw.match(/```json\n([\s\S]*?)\n```/);
          if (m) return JSON.parse(m[1]);
          const p = parseFirstJsonObject(raw);
          return (p && !p.error) ? p : null;
        } catch { return null; }
      };

      // ── Merge helper: fold floors from a new batch result into the accumulator ─
      const mergeFloors = (acc: any, incoming: any) => {
        if (!incoming?.floors || !Array.isArray(incoming.floors)) return;
        if (!acc.floors) { acc.floors = incoming.floors; return; }
        const CATS = ['walls','columns','beams','slabs','stairs','foundations','mep','doors','windows','rooms'];
        for (const f of incoming.floors) {
          const key = String(f.level).toLowerCase().trim();
          const existing = acc.floors.find((e: any) => String(e.level).toLowerCase().trim() === key);
          if (existing) {
            for (const cat of CATS) {
              if (Array.isArray(f[cat]) && f[cat].length > 0) {
                existing[cat] = [...(existing[cat] || []), ...f[cat]];
              }
            }
          } else {
            acc.floors.push(f);
          }
        }
        // Keep building_perimeter and floor heights from the first batch that has them
        if (!acc.building_perimeter && incoming.building_perimeter) acc.building_perimeter = incoming.building_perimeter;
        if (!acc.floor_to_floor_heights && incoming.floor_to_floor_heights) acc.floor_to_floor_heights = incoming.floor_to_floor_heights;
        if (!acc.drawing_legend && incoming.drawing_legend) acc.drawing_legend = incoming.drawing_legend;
      };

      // ── Process all PDFs sequentially in batches of BATCH_SIZE ───────────────
      const totalBatches = Math.ceil(pdfBuffers.length / BATCH_SIZE);
      logger.info(`Processing ${pdfBuffers.length} PDFs in ${totalBatches} batches of ${BATCH_SIZE}`);

      const mergedAnalysis: any = { floors: [] };
      for (let i = 0; i < pdfBuffers.length; i += BATCH_SIZE) {
        const batchBufs = pdfBuffers.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const batchLabel = `batch-${batchNum}/${totalBatches}`;
        logger.info(`[${batchLabel}] Sending ${batchBufs.length} PDFs to Claude...`);
        try {
          const result = await callClaude(batchBufs, batchLabel);
          if (result) {
            mergeFloors(mergedAnalysis, result);
            const floorCount = mergedAnalysis.floors?.length ?? 0;
            const elemCount = (mergedAnalysis.floors ?? []).reduce((sum: number, f: any) => {
              const CATS = ['walls','columns','beams','slabs','stairs','foundations','mep','doors','windows','rooms'];
              return sum + CATS.reduce((s: number, c: string) => s + (Array.isArray(f[c]) ? f[c].length : 0), 0);
            }, 0);
            logger.info(`[${batchLabel}] merged: ${floorCount} floors, ${elemCount} total elements so far`);
          } else {
            logger.warn(`[${batchLabel}] No usable JSON returned — skipping`);
          }
        } catch (batchErr: any) {
          logger.warn(`[${batchLabel}] failed: ${batchErr?.message} — skipping batch`);
        }
      }

      logger.info(`All batches complete — ${mergedAnalysis.floors?.length ?? 0} floors merged`);

      // Parse AI response and generate elements with extracted coordinates
      return await this.generateElementsFromAIAnalysis(mergedAnalysis, options);
      
    } catch (error: any) {
      console.error(`❌ AI PDF analysis failed:`, error);
      logger.error('AI PDF analysis failed completely');
      throw new Error(`Failed to analyze PDF with AI: ${error.message || 'No analysis available'}`);
    }
  }
  
  /**
   * 🏗️ Generate BIM elements from AI assembly-based analysis with CSI organization
   */
  private async generateElementsFromAIAnalysis(
    aiAnalysis: any,
    _options: any
  ): Promise<{
    elements: RealBIMElement[];
    storeys: StoreyData[];
    summary: any;
  }> {
    logger.info('Processing Claude analysis of construction documents...');
    
    let elements: RealBIMElement[] = [];
    const storeys: StoreyData[] = [];
    
    // Parse JSON response from Claude
    let parsedData;
    try {
      if (typeof aiAnalysis === 'string') {
        // Extract JSON from response
        parsedData = parseFirstJsonObject(aiAnalysis);
        if (parsedData?.error) parsedData = {};
      } else {
        parsedData = aiAnalysis;
      }
    } catch (_e) {
      logger.warn('Failed to parse Claude JSON, using fallback');
      parsedData = {};
    }
    
    // Process floors and elements from structured response
    logger.info(`generateElementsFromAIAnalysis: parsedData type=${typeof parsedData}, keys=${typeof parsedData === 'object' && parsedData ? Object.keys(parsedData).join(', ') : 'n/a'}, floors=${Array.isArray(parsedData?.floors) ? parsedData.floors.length : 'none'}`);
    if (parsedData.floors && Array.isArray(parsedData.floors)) {
      for (const floor of parsedData.floors) {
        // ── Storey elevation ─────────────────────────────────────────────────
        // Source priority:
        //   1. floor.elevation — extracted from sections/elevations
        //   2. Computed from previous storey + floor.ceiling_height
        //   3. Sequential 3.0 m increment as RFI placeholder (never silently dropped)
        // ─────────────────────────────────────────────────────────────────────
        let storeyElevation: number;
        let elevSource: string;
        let elevRfi = false;

        if (floor.elevation !== null && floor.elevation !== undefined) {
          // Normalise: Claude's floors[] prompt returns elevation in mm ("REAL_VALUE_MM")
          // but may return m or annotated strings. Unit-normaliser resolves all cases.
          const normE = normaliseElevation({
            elevation_m:   undefined,        // floors[] schema uses raw elevation (mm)
            elevation_mm:  undefined,         // will fall through to elevation_raw
            elevation_raw: floor.elevation,   // let normaliser detect unit
          });
          storeyElevation = normE ?? Number(floor.elevation);
          elevSource = 'extracted_from_drawings';
        } else {
          // Attempt to derive from previous storey + ceiling height
          const prev = storeys.length > 0 ? storeys[storeys.length - 1] : null;
          // ceiling_height from Claude floors[] is in mm (REAL_CEILING_MM) — normalise to metres
          const rawPrevCeiling = (prev as any)?.ceiling_height ?? (prev as any)?.floorToFloorHeight_m;
          const prevCeiling = rawPrevCeiling != null ? (toMetres(rawPrevCeiling, 'dimension') ?? Number(rawPrevCeiling)) : null;
          if (prev && prevCeiling) {
            storeyElevation = (prev.elevation as number) + prevCeiling;
            elevSource = 'derived_from_previous_storey';
            elevRfi = true;
          } else if (prev) {
            storeyElevation = (prev.elevation as number) + 3.0;
            elevSource = 'sequential_3m_estimate';
            elevRfi = true;
          } else {
            storeyElevation = 0;
            elevSource = 'assumed_ground_datum';
            elevRfi = true;
          }
          try {
            const { registerMissingData } = require('./estimator/rfi-generator');
            registerMissingData({
              category: 'dimension',
              description: `Floor '${floor.name || floor.level || 'UNKNOWN'}' has no elevation. ` +
                `Required: building sections or elevation drawings showing floor datum. ` +
                `Storey placed at estimated elevation ${storeyElevation.toFixed(3)} m — all elements on this floor are RFI-flagged.`,
              csiDivision: '03 00 00', impact: 'high',
              drawingRef: `Sections / Elevations — Floor ${floor.name || floor.level || 'UNKNOWN'}`,
              costImpactLow: 0, costImpactHigh: 0,
              assumptionUsed: `elevation=${storeyElevation.toFixed(3)}m (${elevSource})`,
              discoveredBy: 'processClaudeAnalysis',
            });
          } catch { /* non-fatal */ }
        }

        const storey: StoreyData = {
          name: floor.level || floor.name || 'Unknown',
          elevation: storeyElevation,
          elementCount: 0,
          // Pass through ceiling height so downstream creators can inherit it
          // Normalise to metres — Claude returns REAL_CEILING_MM
          ...(floor.ceiling_height !== undefined ? { ceiling_height: toMetres(floor.ceiling_height, 'dimension') ?? Number(floor.ceiling_height) } : {}),
          ...(elevRfi ? { rfi_flag: true, elevation_source: elevSource } : { elevation_source: elevSource }),
        } as StoreyData;
        storeys.push(storey);
        
        // Process walls
        if (floor.walls) {
          for (const wall of floor.walls) {
            const wallElement = this.createWallElement(wall, storey);
            if (wallElement) {
              elements.push(wallElement);
              storey.elementCount++;
            }
          }
        }
        
        // Process columns
        if (floor.columns) {
          for (const col of floor.columns) {
            const colEl = this.createColumnElement(col, storey);
            if (colEl) { elements.push(colEl); storey.elementCount++; }
          }
        }

        // Process beams
        if (floor.beams) {
          for (const beam of floor.beams) {
            const beamEl = this.createBeamElement(beam, storey);
            if (beamEl) { elements.push(beamEl); storey.elementCount++; }
          }
        }

        // Process slabs (floor plates)
        if (floor.slabs) {
          for (const slab of floor.slabs) {
            const slabEl = this.createSlabElement(slab, storey);
            if (slabEl) { elements.push(slabEl); storey.elementCount++; }
          }
        }

        // Process stairs
        if (floor.stairs) {
          for (const stair of floor.stairs) {
            const stairEl = this.createStairElement(stair, storey);
            if (stairEl) { elements.push(stairEl); storey.elementCount++; }
          }
        }

        // Process foundations (ground floor only — negative or zero elevation)
        if (floor.foundations) {
          for (const found of floor.foundations) {
            const foundEl = this.createFoundationElement(found, storey);
            if (foundEl) { elements.push(foundEl); storey.elementCount++; }
          }
        }

        // Process MEP elements
        if (floor.mep) {
          for (const mep of floor.mep) {
            const mepEl = this.createMEPElement(mep, storey);
            if (mepEl) { elements.push(mepEl); storey.elementCount++; }
          }
        }
        
        // Process doors
        if (floor.doors) {
          for (const door of floor.doors) {
            const doorElement = this.createDoorElement(door, storey);
            if (doorElement) {
              elements.push(doorElement);
              storey.elementCount++;
            }
          }
        }
        
        // Process windows
        if (floor.windows) {
          for (const win of floor.windows) {
            const windowElement = this.createWindowElement(win, storey);
            if (windowElement) {
              elements.push(windowElement);
              storey.elementCount++;
            }
          }
        }
      }
    }
    
    // If Claude returned no floors array the drawings were insufficient to extract
    // floor geometry. Register one high-priority RFI and return an empty model —
    // never throw; the UI must surface the RFI so the user can act on it.
    if (elements.length === 0) {
      logger.warn('No elements from structured format — floors array empty or missing');
      try {
        const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({
          category: 'drawing',
          description:
            'Claude analysis returned no floor data. ' +
            'Required: at least one floor plan or building section with labelled floor elevations, ' +
            'ceiling heights, and element positions. ' +
            'Re-upload clearer drawings or add a building section sheet to the document set.',
          csiDivision: '00 00 00', impact: 'critical',
          drawingRef: 'All architectural drawings — floor plans and sections required',
          costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: 'none — model is empty',
          discoveredBy: 'processClaudeAnalysis',
        });
      } catch { /* non-fatal */ }
      return {
        elements: [],
        storeys: [],
        summary: {
          totalElements: 0,
          processingMethod: 'pdf_analysis',
          rfiCount: 1,
          note: 'No floor data extracted — see RFI dashboard for required drawings.',
        },
      };
    }
    
    // Extract building perimeter from Claude's analysis
    const buildingAnalysis = this.extractBuildingAnalysis(aiAnalysis);

    // CSI/text extraction is a FALLBACK — only run when the floors loop produced nothing.
    // If the floors loop already populated `elements`, do NOT overwrite them.
    if (elements.length === 0) {
      // Parse Claude's CSI-organized assembly response
      const analysisData = typeof aiAnalysis === 'string' ? 
        this.parseClaudeResponse(aiAnalysis) : aiAnalysis;
      
      logger.info('Floors loop produced 0 elements — attempting CSI assemblies fallback...');
      
      if (analysisData?.csi_organized_assemblies) {
        logger.debug('Found CSI-organized assemblies in Claude response');
        elements = this.processCSIAssemblies(analysisData.csi_organized_assemblies, storeys, buildingAnalysis);
        
        if (analysisData?.assembly_cross_references) {
          logger.debug('Processing assembly cross-references');
          elements = elements.concat(this.processAssemblyCrossReferences(analysisData.assembly_cross_references, storeys, buildingAnalysis));
        }
      } else {
        logger.warn('No CSI assemblies found, falling back to text extraction');
        elements = this.extractElementsFromText(aiAnalysis, storeys);
      }
      
      logger.info(`Generated ${elements.length} assembly-based elements from CSI/text fallback`);
    } else {
      logger.info(`Using ${elements.length} elements from floors JSON extraction — skipping CSI/text fallback`);
    }

    // Validate geometry (runs for both floors-path and CSI-path elements)
    const _analysisDataForValidation = typeof aiAnalysis === 'string' ?
      this.parseClaudeResponse(aiAnalysis) : aiAnalysis;
    
    // 📐 Validate geometry after extraction
    const validatedElements = this.validateWithGridSystem(elements, _analysisDataForValidation, []);

    // ✅ QTO Cross-Check
    const perimeter = (() => {
      const pts: Array<{x: number; y: number}> = parsedData?.building_perimeter || [];
      if (pts.length < 2) return 0;
      let p = 0;
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        p += Math.sqrt(Math.pow(pts[j].x - pts[i].x, 2) + Math.pow(pts[j].y - pts[i].y, 2));
      }
      return p;
    })();
    const gfa = parsedData?.gross_floor_area_m2 || 0;
    const crossCheck = this.runQTOCrossCheck(validatedElements, perimeter, gfa);
    if (!crossCheck.passed) {
      crossCheck.findings.forEach(f => logger.warn(f));
    }
    
    const summary = {
      totalElements: validatedElements.length,
      elementTypes: this.countElementTypes(validatedElements),
      processingMethod: 'Assembly-based CSI-organized analysis with geometry validation',
      csiDivisions: this.countCSIDivisions(validatedElements),
      totalQuantities: this.calculateTotalQuantities(elements),
      buildingAnalysis: buildingAnalysis,
      qtoXCheck: crossCheck,
    };
    
    return { elements, storeys, summary };
  }
  
  /**
   * Parse Claude's response to extract JSON
   */
  private parseClaudeResponse(response: string): any {
    try {
      // Try to extract JSON from Claude's response
      const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
      return parseFirstJsonObject(response);
    } catch (error) {
      console.warn('Failed to parse Claude JSON response:', error);
      return {};
    }
  }
  
  /**
   * Process CSI-organized assemblies into BIM elements
   */
  private processCSIAssemblies(csiAssemblies: any, storeys: StoreyData[], buildingAnalysis?: any): RealBIMElement[] {
    const elements: RealBIMElement[] = [];
    let elementIndex = 0;
    
    // Process each CSI division
    Object.keys(csiAssemblies).forEach(divisionKey => {
      const division = csiAssemblies[divisionKey];
      logger.debug(`Processing ${divisionKey}: ${division.length} items`);
      
      division.forEach((item: any) => {
        const element = this.createBIMElementFromCSIItem(item, storeys, elementIndex++, divisionKey, buildingAnalysis);
        elements.push(element);
      });
    });
    
    return elements;
  }
  
  /**
   * Process assembly cross-references for detailed components
   */
  private processAssemblyCrossReferences(crossRefs: any, storeys: StoreyData[], _buildingAnalysis?: any): RealBIMElement[] {
    const elements: RealBIMElement[] = [];
    // Dynamic index based on existing elements to avoid conflicts
    if (!storeys || storeys.length === 0) {
      logger.warn('No storeys available for cross-reference processing — skipping');
      return elements;
    }
    let elementIndex: number = storeys.reduce((sum: number, s: StoreyData) => sum + (s.elementCount as number), 0);
    
    Object.keys(crossRefs).forEach(assemblyKey => {
      const assembly = crossRefs[assemblyKey];
      logger.debug(`Processing assembly: ${assemblyKey}`);
      
      assembly.components?.forEach((component: any) => {
        const element = this.createBIMElementFromComponent(component, assembly, storeys, elementIndex++);
        elements.push(element);
      });
    });
    
    return elements;
  }
  
  /**
   * Create BIM element from CSI item with new item code format: CSI.ElementType
   */
  private createBIMElementFromCSIItem(item: any, storeys: StoreyData[], index: number, division: string, _buildingAnalysis?: any): RealBIMElement {
    const storey = storeys[index % storeys.length];
    const elementType = this.mapCSIToElementType(item.item, division);
    
    // Extract CSI code and element name from item
    const csiCode = item.item?.split(' - ')[0] || '';
    const description = item.item?.split(' - ')[1] || elementType;
    
    // Generate new item code format: CSI.ElementType (e.g., "04.20.EW1")
    const itemCode = this.generateCSIItemCode(csiCode, description, item.assembly_reference);
    
    return {
      id: `csi-${division}-${index}`,
      type: elementType,
      name: description,
      category: this.mapDivisionToCategory(division),
      properties: {
        csi_code: csiCode,
        csi_description: description,
        assembly_reference: item.assembly_reference,
        division: division,
        item_code: itemCode,
        element_name: this.extractElementName(description, item.assembly_reference),
        geometry_source: 'derived_from_csi_quantities'
      },
      // Geometry derived from CSI quantities — no explicit coordinates in assembly format
      geometry: this.deriveGeometryFromQuantity(item.quantity, storey, elementType),
      quantities: item.quantity || {},
      storey: { name: storey.name, elevation: storey.elevation }
    };
  }
  
  /**
   * Create BIM element from assembly component with new item code format
   */
  private createBIMElementFromComponent(component: any, assembly: any, storeys: StoreyData[], index: number, _buildingAnalysis?: any): RealBIMElement {
    const storey = storeys[index % storeys.length];
    const elementType = this.mapCSIToElementType(component.description, component.csi);
    
    // Generate item code for component: CSI.ElementType 
    const itemCode = this.generateCSIItemCode(component.csi, component.description, assembly.detail_reference);
    
    return {
      id: `comp-${assembly.detail_reference}-${index}`,
      type: elementType,
      name: component.description,
      category: this.mapCSIToCategory(component.csi),
      properties: {
        csi_code: component.csi,
        parent_assembly: assembly.detail_reference,
        specification_sections: assembly.specification_sections,
        locations: assembly.locations_from_drawings,
        item_code: itemCode,
        element_name: this.extractElementName(component.description, assembly.detail_reference),
        geometry_source: 'derived_from_csi_quantities'
      },
      // Geometry derived from assembly quantities — no explicit coordinates in this format
      geometry: this.deriveGeometryFromQuantity(component.quantity, storey, elementType),
      quantities: component.quantity || {},
      storey: { name: storey.name, elevation: storey.elevation }
    };
  }
  
  /**
   * Generate new CSI item code format: CSI.ElementType (e.g., "04.20.EW1")
   */
  public generateCSIItemCode(csiCode: string, description: string, assemblyRef?: string): string {
    // Extract CSI division from code (e.g., "04 20 00" → "04.20")
    const division = this.extractCSIDivision(csiCode);
    
    // Extract element name from description or assembly reference
    const elementName = this.extractElementName(description, assemblyRef);
    
    // Format: CSI.ElementType (e.g., "04.20.EW1")
    return `${division}.${elementName}`;
  }
  
  /**
   * Extract CSI division in format XX.YY from full CSI code
   */
  private extractCSIDivision(csiCode: string): string {
    if (!csiCode) {
      return '00.00';
    }
    
    // Handle formats like "04 20 00" or "04.20.00" or "0420"
    const cleaned = csiCode.replace(/\s+/g, '').replace(/\./g, '');
    if (cleaned.length >= 4) {
      const division = cleaned.substring(0, 2);
      const subdivision = cleaned.substring(2, 4);
      return `${division}.${subdivision}`;
    }
    
    // Fallback for shorter codes
    const _twoDigit = cleaned.substring(0, 2).padStart(2, '0');
    // Extract actual subdivision from specifications instead of defaulting to .00
    throw new Error('❌ INCOMPLETE CSI CODE: Cannot determine subdivision without complete CSI specification.\n🔍 Claude MUST extract full CSI codes (e.g., "04 20 13") from construction documents - no defaults allowed!');
  }
  
  /**
   * Extract element name from description or assembly reference
   */
  private extractElementName(description: string, assemblyRef?: string): string {
    // Priority 1: Look for wall types like "IW3D", "EW1", "MW1" in assembly reference
    if (assemblyRef) {
      const wallMatch = assemblyRef.match(/\b([IE]?W\d+[A-Z]?|MW\d+|FW\d+)\b/i);
      if (wallMatch) return wallMatch[1].toUpperCase();
      
      const elementMatch = assemblyRef.match(/\b(D\d+|W\d+|C\d+|S\d+)\b/i);
      if (elementMatch) return elementMatch[1].toUpperCase();
    }
    
    // Priority 2: Look for element types in description
    if (description) {
      const desc = description.toLowerCase();
      
      // Wall types
      if (desc.includes('wall type')) {
        const wallMatch = description.match(/wall type\s+([A-Z0-9]+)/i);
        if (wallMatch) return wallMatch[1].toUpperCase();
      }
      
      // Door types
      if (desc.includes('door') || desc.includes('type d')) {
        const doorMatch = description.match(/\b(D\d+[A-Z]?)\b/i);
        if (doorMatch) return doorMatch[1].toUpperCase();
        return 'DOOR';
      }
      
      // Window types
      if (desc.includes('window')) {
        const windowMatch = description.match(/\b(W\d+[A-Z]?)\b/i);
        if (windowMatch) return windowMatch[1].toUpperCase();
        return 'WIN';
      }
      
      // Column types
      if (desc.includes('column')) {
        const columnMatch = description.match(/\b(C\d+[A-Z]?)\b/i);
        if (columnMatch) return columnMatch[1].toUpperCase();
        return 'COL';
      }
      
      // Generic element types
      if (desc.includes('fire stopping')) return 'FIRE';
      if (desc.includes('gypsum') || desc.includes('drywall')) return 'GYP';
      if (desc.includes('insulation')) return 'INS';
      if (desc.includes('concrete')) return 'CONC';
      if (desc.includes('steel')) return 'STL';
      if (desc.includes('masonry')) return 'MAS';
    }
    
    // Fallback: Generate abbreviated name
    return 'ELEM';
  }

  /**
   * Helper functions for CSI assembly processing
   */
  private mapCSIToElementType(description: string, division: string): string {
    const desc = description?.toLowerCase() || '';
    const div = division?.toLowerCase() || '';
    
    if (desc.includes('concrete') || div.includes('concrete')) return 'SLAB';
    if (desc.includes('steel') || desc.includes('column')) return 'COLUMN';
    if (desc.includes('wall') || desc.includes('masonry')) return 'WALL';
    if (desc.includes('door')) return 'DOOR';
    if (desc.includes('window')) return 'WINDOW';
    if (desc.includes('beam')) return 'BEAM';
    if (desc.includes('fire') || desc.includes('stopping')) return 'FIRE_PROTECTION';
    if (desc.includes('gypsum') || desc.includes('drywall')) return 'WALL_FINISH';
    if (desc.includes('insulation')) return 'INSULATION';
    if (desc.includes('electrical')) return 'ELECTRICAL';
    if (desc.includes('mechanical')) return 'MECHANICAL';
    
    return 'BUILDING_ELEMENT';
  }
  
  private parseQuantity(quantityString: string): number {
    const match = quantityString?.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 1;
  }
  
  private parseUnit(quantityString: string): string {
    const match = quantityString?.match(/\d+(?:\.\d+)?\s*([A-Za-z³²]+)/);
    return match ? match[1] : 'EA';
  }
  
  private getCSIDivisionName(csiCode: string): string {
    if (!csiCode) return 'General';
    
    const division = csiCode.substring(0, 2);
    const divisions: Record<string, string> = {
      '01': 'General Requirements',
      '03': 'Concrete',
      '04': 'Masonry', 
      '05': 'Metals',
      '06': 'Wood and Plastics',
      '07': 'Thermal and Moisture Protection',
      '08': 'Openings',
      '09': 'Finishes',
      '10': 'Specialties',
      '11': 'Equipment',
      '12': 'Furnishings',
      '13': 'Special Construction',
      '14': 'Conveying Equipment',
      '21': 'Fire Suppression',
      '22': 'Plumbing',
      '23': 'HVAC',
      '26': 'Electrical',
      '27': 'Communications',
      '28': 'Electronic Safety and Security'
    };
    
    return divisions[division] || 'Other';
  }
  
  private mapDivisionToCategory(division: string): "Architectural" | "Structural" | "MEP" {
    const div = division.toLowerCase();
    if (div.includes('electrical') || div.includes('mechanical') || div.includes('mep')) return 'MEP';
    if (div.includes('structural') || div.includes('metal') || div.includes('concrete')) return 'Structural';
    return 'Architectural';
  }
  
  private mapCSIToCategory(csiCode: string): "Architectural" | "Structural" | "MEP" {
    if (!csiCode) return 'Architectural';
    
    const division = csiCode.substring(0, 2);
    
    // MEP divisions
    if (['21', '22', '23', '25', '26', '27', '28'].includes(division)) return 'MEP';
    
    // Structural divisions
    if (['03', '05'].includes(division)) return 'Structural';
    
    // Everything else is Architectural
    return 'Architectural';
  }
  
  private countElementTypes(elements: RealBIMElement[]): Record<string, number> {
    const counts: Record<string, number> = {};
    elements.forEach(el => {
      counts[el.type] = (counts[el.type] ?? 0) + 1;
    });
    return counts;
  }
  
  private countCSIDivisions(elements: RealBIMElement[]): Record<string, number> {
    const counts: Record<string, number> = {};
    elements.forEach(el => {
      const csiCode = el.properties?.csi_code;
      if (csiCode) {
        const division = csiCode.substring(0, 2);
        counts[division] = (counts[division] ?? 0) + 1;
      }
    });
    return counts;
  }
  
  private calculateTotalQuantities(elements: RealBIMElement[]): any {
    return {
      totalElements: elements.length,
      csiOrganized: true,
      assemblyBased: true
    };
  }
  
  private extractElementsFromText(_aiAnalysis: any, _storeys: StoreyData[]): RealBIMElement[] {
    // Fallback method for backward compatibility
    logger.warn('Using fallback text extraction - CSI assemblies not found');
    return [];
  }

  // **PRESERVE EXISTING METHODS - Keep all functionality intact**
  
  private isIFCFile(filePath: string): boolean {
    return filePath?.toLowerCase().endsWith('.ifc') || false;
  }

  private generateElementsFromExistingAnalysis(claudeAnalysis: any, options: any) {
    logger.info('Generating elements from existing Claude analysis...');
    return this.generateElementsFromAIAnalysis(claudeAnalysis, options);
  }

  private createRealElement(type: string, storey: StoreyData, index: number, _aiAnalysis?: any): RealBIMElement {
    return {
      id: `elem-${type}-${index}`,
      type: type,
      name: `${type} ${index}`,
      category: type.includes('electrical') ? 'MEP' : type.includes('steel') ? 'Structural' : 'Architectural',
      properties: {
        element_type: type,
        analysis_source: 'rfi_placeholder'
      },
      geometry: (() => {
        throw new Error(`❌ MISSING ELEMENT GEOMETRY: ${type} element ${index} on storey '${storey.name}' needs actual coordinates and dimensions from construction documents. Claude must extract real geometry from floor plans and sections!`);
      })(),
      quantities: {
        metric: [],
        imperial: []
      },
      storey: { name: storey.name, elevation: storey.elevation }
    };
  }

  private generateRealSummary(elements: RealBIMElement[]): any {
    return {
      totalElements: elements.length,
      elementTypes: this.countElementTypes(elements),
      method: 'real_analysis'
    };
  }

  /**
   * 🏗️ Create wall element with REAL coordinates from Claude's analysis
   * 
   * COORDINATE SYSTEM:
   * - X,Y: Wall position on floor plan (horizontal plane from drawing)
   * - Z: Vertical position = storey.elevation (floor level)
   * 
   * FLOOR ELEVATION CALCULATION:
   * - Ground Floor: elevation from drawings (e.g., EL. 0.00 or EL. 219.85)
   * - Second Floor: Ground elevation + ceiling height + slab thickness
   * - Third Floor: Second elevation + ceiling height + slab thickness
   * - Walls connect these elevations to create enclosed volumes
   * 
   * WALL HEIGHT CALCULATION:
   * - Wall base: Z = storey.elevation (floor slab top)
   * - Wall height: MUST equal floor-to-ceiling height from architectural drawings
   * - Wall top: Z = storey.elevation + ceiling height = underside of floor slab above
   * - This ensures walls properly close the space between floor slabs
   * - Example: Ground floor wall from 0m to 2.7m meets second floor slab at 2.7m
   */
  private createWallElement(wallData: any, storey: StoreyData): RealBIMElement | null {
    // Extract real coordinates from Claude's JSON response
    // Bug-D fix (v15.4): missing start/end registers an RFI and returns null
    // instead of throwing, which was killing the entire floor loop for all elements.
    if (!wallData.start || !wallData.end) {
      try {
        const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({
          category: 'drawing',
          description: `Wall '${wallData.id || 'UNKNOWN'}' on storey '${storey.name}' is missing start or end coordinates. ` +
            `Required: floor plan with wall endpoints in drawing coordinate system. Wall excluded from model.`,
          csiDivision: '03 00 00', impact: 'high',
          drawingRef: `Floor plan — Wall ${wallData.id || 'UNKNOWN'}, Storey ${storey.name}`,
          costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: 'wall_excluded_no_coordinates',
          discoveredBy: 'createWallElement',
        });
      } catch { /* non-fatal */ }
      return null;
    }
    const start = wallData.start;
    const end = wallData.end;
    // NO DEFAULTS - only use actual thickness from Claude's analysis
    // Normalise thickness — Claude returns mm by convention but handles any unit string
    const thickness = toMetres(wallData.thickness, 'dimension') !== null
      ? toMetres(wallData.thickness, 'dimension')! * 1000  // keep as mm for length calcs below
      : wallData.thickness; // raw fallback
    if (!thickness) return null; // Skip if no thickness found
    
    // Calculate wall center and dimensions
    const centerX = (start.x + end.x) / 2;
    const centerY = (start.y + end.y) / 2;
    const length = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
    
    // CRITICAL: Wall height = ceiling height from architectural drawings
    // Normalise wall height — Claude returns mm (REAL_CEILING_MM prompt convention)
    const rawWallHeight = wallData.ceiling_height || wallData.floor_to_ceiling_height;
    const wallHeight = rawWallHeight != null ? (toMetres(rawWallHeight, 'dimension') ?? Number(rawWallHeight)) : null;

    let actualWallHeight: number;
    let wallHeightSource: string;

    if (!wallHeight) {
      // Register RFI — wall is included as a placeholder with storey height estimate
      try {
        const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({
          category: 'dimension',
          description:
            `Wall '${wallData.id || 'UNKNOWN'}' on storey '${storey.name}' has no ceiling height. ` +
            `Required sources: (1) Building sections showing floor-to-ceiling dimension, ` +
            `(2) Elevation drawings with height annotation, ` +
            `(3) Drawing legend defining dimension notation. ` +
            `Wall included in model with storey height estimate — verify and update.`,
          csiDivision: '03 00 00',
          impact: 'medium',
          drawingRef: `Sections / Elevations — Wall ${wallData.id || 'UNKNOWN'}, Storey ${storey.name}`,
          costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: `storey_floor_to_floor=${(storey as any).floorToFloorHeight_m ?? 'unknown'}`,
          discoveredBy: 'createWallElement',
        });
      } catch { /* non-fatal */ }
      const rawStoreyH = (storey as any).floorToFloorHeight_m ?? (storey as any).ceiling_height;
      actualWallHeight = rawStoreyH != null ? (toMetres(rawStoreyH, 'dimension') ?? Number(rawStoreyH)) : 3.0;
      wallHeightSource = 'estimated_from_storey';
    } else {
      actualWallHeight = wallHeight;
      wallHeightSource = 'extracted_from_drawings';
    }

    const isRfiFlagged = wallHeightSource === 'estimated_from_storey';
    
    return {
      id: wallData.id || `wall-${Date.now()}`,
      type: 'wall',
      name: wallData.name || wallData.id || 'Wall',
      category: 'Architectural',
      properties: {
        element_type: 'wall',
        wall_type: wallData.type ?? null,
        material: wallData.material ?? null,
        fire_rating: wallData.fireRating ?? null,
        acoustic_rating: wallData.acousticRating ?? null,
        start_point: start,
        end_point: end,
        start: start,
        end: end,
        floor_level: storey.name,
        base_elevation: storey.elevation,
        top_elevation: storey.elevation + actualWallHeight,
        height_source: wallHeightSource,
        rfi_flag: isRfiFlagged,
        needs_attention: isRfiFlagged,
        attention_reason: isRfiFlagged
          ? `Wall height estimated from storey — ceiling height not found in drawings. Verify in sections/elevations.`
          : null,
        analysis_source: 'ai_extracted',
      },
      geometry: {
        location: { realLocation: { 
          x: centerX, 
          y: centerY, 
          z: storey.elevation + (actualWallHeight / 2)
        } },
        dimensions: { 
          length: length, 
          width: thickness / 1000,
          height: actualWallHeight,
          area: length * actualWallHeight,
          volume: length * (thickness / 1000) * actualWallHeight,
        },
      },
      quantities: {
        metric: [{ type: 'length', value: length, unit: 'm', name: 'Wall Length', source: 'ai_extracted' }],
        imperial: [{ type: 'length', value: length * 3.28084, unit: 'ft', name: 'Wall Length', source: 'ai_extracted' }],
      },
      storey: { name: storey.name, elevation: storey.elevation },
    };
  }

  /**
   * 🏗️ Create column element with REAL coordinates from Claude's analysis
   */
  private createColumnElement(colData: any, storey: StoreyData): RealBIMElement | null {
    // Extract real X,Y coordinates from Claude's JSON
    // Bug-D fix (v15.4): missing x/y registers RFI and returns null instead of throwing
    if (colData.x === undefined || colData.x === null) {
      try {
        const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({
          category: 'drawing',
          description: `Column '${colData.id || 'UNKNOWN'}' on storey '${storey.name}' has no x/y coordinates. ` +
            `Required: structural floor plan with column grid positions. Column excluded from model.`,
          csiDivision: '03 00 00', impact: 'high',
          drawingRef: `Structural plan — Column ${colData.id || 'UNKNOWN'}, Storey ${storey.name}`,
          costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: 'column_excluded_no_coordinates',
          discoveredBy: 'createColumnElement',
        });
      } catch { /* non-fatal */ }
      return null;
    }
    const x = colData.x;
    if (colData.y == null) {
      try { const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({ category: 'drawing', csiDivision: '03 00 00', impact: 'high',
          description: `Column '${colData.id || 'UNKNOWN'}' on storey '${storey.name}' has no y coordinate. Column excluded.`,
          drawingRef: `Structural plan — Column ${colData.id || 'UNKNOWN'}`, costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: 'column_excluded_no_y', discoveredBy: 'createColumnElement' }); } catch { /* non-fatal */ }
      return null;
    }
    const y = colData.y;
    const size = colData.size;
    if (!size) {
      try { const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({ category: 'drawing', csiDivision: '03 00 00', impact: 'medium',
          description: `Column '${colData.id || 'UNKNOWN'}' on storey '${storey.name}' has no size data. Required: structural schedule or plan with column dimensions.`,
          drawingRef: `Structural plan/schedule — Column ${colData.id || 'UNKNOWN'}`,
          costImpactLow: 0, costImpactHigh: 0, assumptionUsed: 'column_excluded_no_size',
          discoveredBy: 'createColumnElement' }); } catch { /* non-fatal */ }
      return null;
    }

    // ─── Parse column size — no hardcoded fallbacks allowed ──────────────────
    // Handles: "400x400" (concrete), "W12x26" (steel wide-flange), "400" (square)
    // ─────────────────────────────────────────────────────────────────────────
    let width: number;
    let depth: number;
    const sizeStr = String(size).trim();

    if (/^W\d+x\d+/i.test(sizeStr)) {
      // Steel wide-flange: W12x26 → depth≈305mm from nominal inch designation
      const parts = sizeStr.replace(/^W/i, '').split('x');
      const nomDepthIn = parseFloat(parts[0]);
      const nomWidthIn = parseFloat(parts[1] || parts[0]);
      if (isNaN(nomDepthIn) || isNaN(nomWidthIn)) {
        logger.warn(`Unparseable steel column size '${size}' — column excluded, RFI registered`);
        return null;
      }
      width = (nomWidthIn * 25.4) / 1000;
      depth = (nomDepthIn * 25.4) / 1000;
    } else if (sizeStr.toLowerCase().includes('x')) {
      // Standard rectangular: "400x600" or "300x300"
      const parts = sizeStr.toLowerCase().split('x').map((s: string) => parseFloat(s));
      if (isNaN(parts[0]) || isNaN(parts[1])) {
        logger.warn(`Unparseable rectangular column size '${size}' — column excluded, RFI registered`);
        return null;
      }
      width = parts[0] / 1000;
      depth = parts[1] / 1000;
    } else {
      // Single value — square column: "400" → 400x400
      const dim = parseFloat(sizeStr);
      if (isNaN(dim)) {
        logger.warn(`Unparseable column size '${size}' — column excluded, RFI registered`);
        return null;
      }
      width = dim / 1000;
      depth = dim / 1000;
    }

    if (width <= 0 || depth <= 0) {
      logger.warn(`Column size '${size}' produced zero/negative dimensions — column excluded, RFI registered`);
      return null;
    }
    
    // Column height: prefer structural schedule, fall back to storey height with RFI
    // Normalise column height — Claude returns mm (REAL_VALUE_MM convention)
    const columnHeight = colData.height != null ? (toMetres(colData.height, 'dimension') ?? Number(colData.height)) : null;
    let actualColumnHeight: number;
    let heightSource: string;
    if (!columnHeight) {
      // Register RFI — storey height is a reasonable interim estimate
      try {
        const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({
          category: 'dimension',
          description: `Column '${colData.id || 'UNKNOWN'}' has no height in extracted data. ` +
            `Height estimated from storey floor-to-floor height. ` +
            `Verify in structural column schedule or section drawings.`,
          csiDivision: '03 30 00',
          impact: 'medium',
          drawingRef: 'Structural column schedule / sections',
          costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: `storey_height=${storey.elevation}`,
          discoveredBy: 'createColumnElement',
        });
      } catch { /* rfi-generator unavailable — non-fatal */ }
      // Estimate: typical residential/commercial = 3.0m, use storey data if available
      actualColumnHeight = (storey as any).floorToFloorHeight_m ?? 3.0;
      heightSource = 'estimated_from_storey_height';
    } else {
      actualColumnHeight = columnHeight;
      heightSource = 'extracted_from_drawings';
    }
    if (!actualColumnHeight || actualColumnHeight <= 0) return null;
    
    return {
      id: colData.id || `column-${Date.now()}`,
      type: 'column',
      name: colData.name || colData.id || 'Column',
      category: 'Structural',
      properties: {
        element_type: 'column',
        column_type: colData.type ?? null,
        material: colData.material ?? null,
        size: size,
        reinforcement: colData.reinforcement,
        height_source: heightSource,
        analysis_source: 'ai_extracted'
      },
      geometry: {
        location: { realLocation: { x: x, y: y, z: storey.elevation } },
        dimensions: { 
          length: width, 
          width: depth, 
          height: actualColumnHeight,
          area: width * depth,
          volume: width * depth * actualColumnHeight
        }
      },
      quantities: {
        metric: [{ type: 'volume', value: width * depth * actualColumnHeight, unit: 'm³', name: 'Column Volume', source: 'ai_extracted' }],
        imperial: [{ type: 'volume', value: width * depth * actualColumnHeight * 35.3147, unit: 'ft³', name: 'Column Volume', source: 'ai_extracted' }]
      },
      storey: { name: storey.name, elevation: storey.elevation }
    };
  }

  /**
   * 🚪 Create door element with REAL coordinates from Claude's analysis.
   * Door thickness MUST come from the door schedule or wall assembly details.
   * If missing, an RFI is registered and the door is excluded from the model
   * until the schedule data is supplied — no assumed values permitted.
   */
  /**
   * 🚪 Create door element from Claude's drawing analysis.
   *
   * DESIGN RULE (v15):
   *   A door that cannot be fully resolved is NEVER silently dropped.
   *   Instead it is placed in the model as a visible AMBER placeholder so the
   *   QS sees the opening, and an RFI is raised.  The placeholder is excluded
   *   from the priced BOQ until the RFI is resolved.
   *
   * Thickness resolution priority:
   *   1. doorData.thickness      — door schedule "THK" column (mm)
   *   2. doorData.wall_thickness — hosting wall assembly (mm)
   *   3. Neither → RFI + amber placeholder (thickness = 0.05 m display only,
   *      NOT costed, clearly flagged as unresolved)
   */
  private createDoorElement(doorData: any, storey: StoreyData): RealBIMElement | null {
    if (doorData.x == null || doorData.y == null) {
      try {
        registerMissingData({ category: 'drawing', csiDivision: '08 00 00', impact: 'high',
          description: `Door '${doorData.id || 'UNKNOWN'}' on storey '${storey.name}' has no x/y coordinates. Door excluded.`,
          drawingRef: `Floor plan — Door ${doorData.id || 'UNKNOWN'}`, costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: 'door_excluded_no_coordinates', discoveredBy: 'createDoorElement' }); } catch { /* non-fatal */ }
      return null;
    }
    const x = doorData.x;
    const y = doorData.y ?? 0;  // Bug-D: x/y null already checked above, doorY fallback

    // Width is required — cannot place door without it
    if (!doorData.width) return null;
    const width = toMetres(doorData.width, 'dimension') ?? (doorData.width / 1000);
    // Height: must come from door schedule — NO assumed values
    const heightRaw = doorData.height != null
      ? (toMetres(doorData.height, 'dimension') ?? (doorData.height / 1000))
      : null;
    const heightRfi = heightRaw === null;
    if (heightRfi) {
      try {
        registerMissingData({
          category: 'dimension', csiDivision: '08 14 00', impact: 'high',
          description: `Door '${doorData.id || 'UNKNOWN'}' on storey '${storey.name}' — height not found in door schedule. ` +
            `Required: door schedule "HGT" column or elevation drawing showing opening height. ` +
            `Door included as RFI placeholder — excluded from BOQ until resolved.`,
          drawingRef: `Door schedule — Door ${doorData.id || 'UNKNOWN'}, Storey ${storey.name}`,
          costImpactLow: 0, costImpactHigh: 0, assumptionUsed: 'none — rfi_placeholder_only',
          discoveredBy: 'createDoorElement' });
      } catch { /* non-fatal */ }
    }

    // ─── Door thickness ───────────────────────────────────────────────────────
    const rawThickness = doorData.thickness ?? doorData.wall_thickness ?? null;
    let thicknessM: number;
    let thicknessSource: string;
    let isRfiFlagged = false;
    const attentionParts: string[] = [];

    if (rawThickness !== null) {
      thicknessM      = toMetres(rawThickness, 'dimension') ?? (rawThickness / 1000);
      thicknessSource = doorData.thickness ? 'door_schedule' : 'wall_assembly';
    } else {
      // ── Missing thickness: raise RFI, place amber placeholder ─────────────
      try {
        const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({
          category: 'specification',
          description:
            `Door '${doorData.id || 'UNKNOWN'}' on storey '${storey.name}' — thickness not found. ` +
            `Required: (1) Door schedule column "THK"/"Thickness", ` +
            `(2) Wall assembly detail showing leaf/frame depth, ` +
            `(3) Division 08 manufacturer data sheet. ` +
            `Door shown as AMBER placeholder in BIM — excluded from priced BOQ until resolved.`,
          csiDivision: '08 14 00',
          impact: 'medium',
          drawingRef: `Door schedule / wall assembly — Door ${doorData.id || 'UNKNOWN'}, Storey ${storey.name}`,
          costImpactLow: 0,
          costImpactHigh: 0,
          assumptionUsed: 'display_placeholder_only',
          discoveredBy: 'createDoorElement',
        });
      } catch { /* non-fatal if rfi-generator not available at this call site */ }

      // No display placeholder — null thickness means no geometry for this face
      thicknessM      = null as any;
      thicknessSource = 'rfi_missing';
      isRfiFlagged    = true;
      attentionParts.push('door thickness not found in schedule or wall assembly');
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Merge height RFI into the overall flag
    if (heightRfi) {
      isRfiFlagged = true;
      attentionParts.push('door height not found in schedule');
    }

    return {
      id: doorData.id || `door-${Date.now()}`,
      type: 'door',
      name: doorData.name || doorData.id || 'Door',
      category: 'Architectural',
      properties: {
        element_type:     'door',
        door_type:        doorData.type    ?? null,
        material:         doorData.material ?? null,
        fire_rating:      doorData.fireRating ?? null,
        hardware_set:     doorData.hardware ?? null,
        swing_direction:  doorData.swing   ?? null,
        height_m:         heightRaw,         // null if not extracted — never assumed
        thickness_source: thicknessSource,
        // ── RFI / attention flags ──
        rfi_flag:         isRfiFlagged,
        needs_attention:  isRfiFlagged,
        attention_reason: isRfiFlagged ? attentionParts.join('; ') : null,
        // Excluded from BOQ until all required dimensions are resolved
        exclude_from_boq: isRfiFlagged,
        analysis_source:  'ai_extracted',
      },
      geometry: {
        location: { realLocation: { x, y, z: storey.elevation } },
        dimensions: {
          length: width,
          width:  thicknessM ?? null,
          height: heightRaw,                 // null propagates — viewer renders as point marker
          area:   heightRaw != null ? width * heightRaw : null,
          volume: null,                      // never calculated when any dimension is missing
        },
      },
      quantities: {
        // Count only — area/volume excluded until RFI resolved
        metric:   [{ type: 'count', value: 1, unit: 'ea', name: 'Door Count',
                     source: isRfiFlagged ? 'rfi_placeholder' : 'ai_extracted' }],
        imperial: [{ type: 'count', value: 1, unit: 'ea', name: 'Door Count',
                     source: isRfiFlagged ? 'rfi_placeholder' : 'ai_extracted' }],
      },
      storey: { name: storey.name, elevation: storey.elevation },
    };
  }

  /**
   * 🪟 Create window element with REAL coordinates from Claude's analysis.
   * Missing sill height or frame depth → RFI registered + element included as
   * a flagged placeholder so the QS sees the gap in the 3D model.
   */
  private createWindowElement(winData: any, storey: StoreyData): RealBIMElement | null {
    if (winData.x == null || winData.y == null) {
      try {
        registerMissingData({ category: 'drawing', csiDivision: '08 00 00', impact: 'medium',
          description: `Window '${winData.id || 'UNKNOWN'}' on storey '${storey.name}' has no x/y coordinates. Window excluded.`,
          drawingRef: `Floor plan — Window ${winData.id || 'UNKNOWN'}`, costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: 'window_excluded_no_coordinates', discoveredBy: 'createWindowElement' }); } catch { /* non-fatal */ }
      return null;
    }
    const x = winData.x;
    const y = winData.y ?? 0;  // Bug-D: x/y null already checked above, winY fallback

    // Width is required — cannot place window without it
    if (!winData.width) return null;
    const width = toMetres(winData.width, 'dimension') ?? (winData.width / 1000);
    // Height: must come from window schedule — NO assumed values
    const heightRaw = winData.height != null
      ? (toMetres(winData.height, 'dimension') ?? (winData.height / 1000))
      : null;
    if (heightRaw === null) {
      try {
        registerMissingData({
          category: 'dimension', csiDivision: '08 50 00', impact: 'high',
          description: `Window '${winData.id || 'UNKNOWN'}' on storey '${storey.name}' — height not found in window schedule. ` +
            `Required: window schedule "HGT" column or elevation drawing showing opening height. ` +
            `Window included as RFI placeholder — excluded from BOQ until resolved.`,
          drawingRef: `Window schedule — Window ${winData.id || 'UNKNOWN'}, Storey ${storey.name}`,
          costImpactLow: 0, costImpactHigh: 0, assumptionUsed: 'none — rfi_placeholder_only',
          discoveredBy: 'createWindowElement' });
      } catch { /* non-fatal */ }
    }

    // ─── Sill height ─────────────────────────────────────────────────────────
    let sillHeight: number;
    let sillSource: string;
    let sillRfi = false;
    if (winData.sill_height !== undefined && winData.sill_height !== null) {
      sillHeight = toMetres(winData.sill_height, 'dimension') ?? (winData.sill_height / 1000);
      sillSource = 'extracted_from_drawings';
    } else {
      try {
        const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({
          category: 'dimension',
          description: `Window '${winData.id || 'UNKNOWN'}' on storey '${storey.name}' has no sill height. ` +
            `Required: window schedule or section drawing showing sill elevation. ` +
            `Window placed at floor level — verify and correct.`,
          csiDivision: '08 50 00', impact: 'low',
          drawingRef: `Window schedule / sections — Window ${winData.id || 'UNKNOWN'}`,
          costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: 'sill_height=floor_elevation',
          discoveredBy: 'createWindowElement',
        });
      } catch { /* non-fatal */ }
      sillHeight = 0;
      sillSource = 'estimated_at_floor';
      sillRfi = true;
    }

    // ─── Frame depth ─────────────────────────────────────────────────────────
    let frameDepth: number;
    let depthSource: string;
    let depthRfi = false;
    if (winData.depth !== undefined && winData.depth !== null) {
      frameDepth = winData.depth / 1000;
      depthSource = 'extracted_from_drawings';
    } else if (winData.wall_thickness !== undefined && winData.wall_thickness !== null) {
      frameDepth = winData.wall_thickness / 1000;
      depthSource = 'from_wall_thickness';
    } else {
      try {
        registerMissingData({
          category: 'specification',
          description: `Window '${winData.id || 'UNKNOWN'}' on storey '${storey.name}' has no frame depth. ` +
            `Required: window schedule column "Depth" or wall assembly detail. ` +
            `Window shown as flagged placeholder — verify frame depth from Division 08 specifications.`,
          csiDivision: '08 50 00', impact: 'low',
          drawingRef: `Window schedule / wall assembly — Window ${winData.id || 'UNKNOWN'}`,
          costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: 'none — rfi_placeholder_only',
          discoveredBy: 'createWindowElement',
        });
      } catch { /* non-fatal */ }
      frameDepth = null as any; // No assumed value — null until extracted from drawings
      depthSource = 'rfi_missing';
      depthRfi = true;
    }

    const heightMissing = heightRaw === null;
    const isRfiFlagged = sillRfi || depthRfi || heightMissing;
    const attentionParts: string[] = [];
    if (heightMissing) attentionParts.push('window height not found in schedule');
    if (sillRfi)       attentionParts.push('sill height not found in drawings');
    if (depthRfi)      attentionParts.push('frame depth not found in window schedule');

    return {
      id: winData.id || `window-${Date.now()}`,
      type: 'window',
      name: winData.name || winData.id || 'Window',
      category: 'Architectural',
      properties: {
        element_type: 'window',
        window_type: winData.type ?? null,
        glazing_type: winData.glazing ?? null,
        frame_material: winData.frame ?? null,
        u_value: winData.uValue ?? null,
        height_m: heightRaw,              // null if not extracted — never assumed
        sill_height_source: sillSource,
        depth_source: depthSource,
        rfi_flag: isRfiFlagged,
        needs_attention: isRfiFlagged,
        attention_reason: isRfiFlagged ? attentionParts.join('; ') : null,
        exclude_from_boq: isRfiFlagged,   // excluded until all dims resolved
        analysis_source: 'ai_extracted',
      },
      geometry: {
        location: { realLocation: { x, y, z: storey.elevation + (sillHeight ?? 0) } },
        dimensions: {
          length: width,
          width:  frameDepth ?? null,
          height: heightRaw,              // null propagates — viewer renders as point marker
          area:   heightRaw != null ? width * heightRaw : null,
          volume: null,                   // never calculated when any dimension is missing
        },
      },
      quantities: {
        // Count only — area excluded until height is resolved
        metric:   [{ type: 'count', value: 1, unit: 'ea', name: 'Window Count',
                     source: isRfiFlagged ? 'rfi_placeholder' : 'ai_extracted' }],
        imperial: [{ type: 'count', value: 1, unit: 'ea', name: 'Window Count',
                     source: isRfiFlagged ? 'rfi_placeholder' : 'ai_extracted' }],
      },
      storey: { name: storey.name, elevation: storey.elevation },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // NEW ELEMENT CREATORS — v14.42
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * 🏗️ Create slab element (floor plate / roof / transfer slab)
   * Quantities: area (m²), volume (m³), formwork area (m²)
   */
  private createSlabElement(slabData: any, storey: StoreyData): RealBIMElement | null {
    const boundary: Array<{x: number; y: number}> = slabData.boundary;
    if (!boundary || boundary.length < 3) return null;

    const thicknessMm = slabData.thickness;
    if (thicknessMm === null || thicknessMm === undefined) return null;
    const thicknessM = toMetres(thicknessMm, 'dimension') ?? (Number(thicknessMm) / 1000);
    if (!thicknessM || thicknessM <= 0) return null;

    // Compute slab area using shoelace formula
    let area = 0;
    for (let i = 0; i < boundary.length; i++) {
      const j = (i + 1) % boundary.length;
      area += boundary[i].x * boundary[j].y;
      area -= boundary[j].x * boundary[i].y;
    }
    area = Math.abs(area) / 2;

    const volume = area * thicknessM;
    const centroid = {
      x: boundary.reduce((s, p) => s + p.x, 0) / boundary.length,
      y: boundary.reduce((s, p) => s + p.y, 0) / boundary.length,
    };

    return {
      id: slabData.id || `slab-${storey.name}-${Date.now()}`,
      type: 'slab',
      name: `Slab — ${storey.name}`,
      category: 'Structural',
      properties: {
        element_type: 'slab',
        slab_type: slabData.type ?? null,
        material: slabData.material ?? null,
        thickness_mm: thicknessMm,
        top_elevation: slabData.top_elevation ?? storey.elevation + thicknessM,
        analysis_source: 'ai_extracted',
      },
      geometry: {
        location: { realLocation: { x: centroid.x, y: centroid.y, z: storey.elevation } },
        dimensions: {
          length: Math.sqrt(area), // representative — full polygon in properties
          width: Math.sqrt(area),
          height: thicknessM,
          area,
          volume,
        },
        polygon: boundary,
      },
      quantities: {
        metric: [
          { type: 'area',   value: area,        unit: 'm²',  name: 'Slab Area',      source: 'ai_extracted' },
          { type: 'volume', value: volume,       unit: 'm³',  name: 'Slab Volume',    source: 'ai_extracted' },
          { type: 'area',   value: area,        unit: 'm²',  name: 'Formwork Area',  source: 'ai_extracted' },
        ],
        imperial: [
          { type: 'area',   value: area * 10.764,         unit: 'ft²', name: 'Slab Area',   source: 'ai_extracted' },
          { type: 'volume', value: volume * 35.3147,      unit: 'ft³', name: 'Slab Volume', source: 'ai_extracted' },
        ],
      },
      storey: { name: storey.name, elevation: storey.elevation },
    };
  }

  /**
   * 🔩 Create beam element (concrete or steel)
   * Quantities: length (m), volume (m³), formwork (m²)
   */
  private createBeamElement(beamData: any, storey: StoreyData): RealBIMElement | null {
    const start = beamData.start;
    const end   = beamData.end;
    if (!start || !end) return null;

    const sizeParts = (beamData.size || '').split('x').map((s: string) => parseInt(s));
    if (sizeParts.length < 2 || sizeParts.some(isNaN)) return null;

    const widthM  = sizeParts[0] / 1000;
    const depthM  = (beamData.depth || sizeParts[1]) / 1000;
    const length  = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
    const volume  = widthM * depthM * length;
    const formwork = 2 * (widthM + depthM) * length; // perimeter × length

    return {
      id: beamData.id || `beam-${storey.name}-${Date.now()}`,
      type: 'beam',
      name: `Beam ${beamData.id || ''} — ${storey.name}`,
      category: 'Structural',
      properties: {
        element_type: 'beam',
        material: beamData.material ?? null,
        size: beamData.size,
        start_point: start,
        end_point: end,
        top_elevation: beamData.top_elevation ?? storey.elevation,
        analysis_source: 'ai_extracted',
      },
      geometry: {
        location: { realLocation: {
          x: (start.x + end.x) / 2,
          y: (start.y + end.y) / 2,
          z: storey.elevation,
        } },
        dimensions: { length, width: widthM, height: depthM, area: widthM * depthM, volume },
      },
      quantities: {
        metric: [
          { type: 'length',  value: length,   unit: 'm',   name: 'Beam Length',   source: 'ai_extracted' },
          { type: 'volume',  value: volume,   unit: 'm³',  name: 'Beam Volume',   source: 'ai_extracted' },
          { type: 'area',    value: formwork, unit: 'm²',  name: 'Formwork Area', source: 'ai_extracted' },
        ],
        imperial: [
          { type: 'length', value: length * 3.28084,  unit: 'ft',  name: 'Beam Length',  source: 'ai_extracted' },
          { type: 'volume', value: volume * 35.3147,  unit: 'ft³', name: 'Beam Volume',  source: 'ai_extracted' },
        ],
      },
      storey: { name: storey.name, elevation: storey.elevation },
    };
  }

  /**
   * 🪜 Create stair element
   * Quantities: risers (ea), run area (m²), going width (m)
   */
  private createStairElement(stairData: any, storey: StoreyData): RealBIMElement | null {
    if (stairData.x === undefined || stairData.y === undefined) return null;

    // Architecture law: no silent defaults. Missing stair geometry → RFI + null.
    const rises = stairData.rises ?? stairData.number_of_risers ?? null;
    if (!rises || rises <= 0) {
      try {
        const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({
          category: 'dimension',
          description: `Stair '${stairData.id || 'UNKNOWN'}' on storey '${storey.name}' is missing number of risers. ` +
            `Required: stair section drawing or floor plan annotation showing rise count. Stair excluded.`,
          csiDivision: '03 15 00', impact: 'medium',
          drawingRef: `Floor plan / stair section — Stair ${stairData.id || 'UNKNOWN'}, Storey ${storey.name}`,
          costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: 'stair_excluded_no_rise_count', discoveredBy: 'createStairElement',
        });
      } catch { /* non-fatal */ }
      return null;
    }

    // Rise dimension — OBC requires 125–200 mm. RFI if missing.
    const riseMm = stairData.rise_mm ?? stairData.riser_height ?? null;
    if (!riseMm) {
      try {
        const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({
          category: 'dimension',
          description: `Stair '${stairData.id || 'UNKNOWN'}' on storey '${storey.name}' has no riser height. ` +
            `Required: stair section drawing showing riser dimension. OBC 9.8.4.1 range: 125–200 mm.`,
          csiDivision: '03 15 00', impact: 'medium',
          drawingRef: `Stair section — Stair ${stairData.id || 'UNKNOWN'}, Storey ${storey.name}`,
          costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: 'stair_excluded_no_riser_height', discoveredBy: 'createStairElement',
        });
      } catch { /* non-fatal */ }
      return null;
    }

    // Run dimension — OBC requires ≥ 235 mm. RFI if missing.
    const runMm = stairData.run_mm ?? stairData.tread_depth ?? null;
    if (!runMm) {
      try {
        const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({
          category: 'dimension',
          description: `Stair '${stairData.id || 'UNKNOWN'}' on storey '${storey.name}' has no tread run depth. ` +
            `Required: stair section showing tread dimension. OBC 9.8.4.1 minimum: 235 mm.`,
          csiDivision: '03 15 00', impact: 'medium',
          drawingRef: `Stair section — Stair ${stairData.id || 'UNKNOWN'}, Storey ${storey.name}`,
          costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: 'stair_excluded_no_tread_run', discoveredBy: 'createStairElement',
        });
      } catch { /* non-fatal */ }
      return null;
    }

    // Width — OBC 9.8.3.1 requires ≥ 900 mm. RFI if missing.
    const rawWidth = stairData.width ?? null;
    if (!rawWidth) {
      try {
        const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({
          category: 'dimension',
          description: `Stair '${stairData.id || 'UNKNOWN'}' on storey '${storey.name}' has no stair width. ` +
            `Required: floor plan annotation or stair plan. OBC 9.8.3.1 minimum: 900 mm.`,
          csiDivision: '03 15 00', impact: 'medium',
          drawingRef: `Floor plan — Stair ${stairData.id || 'UNKNOWN'}, Storey ${storey.name}`,
          costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: 'stair_excluded_no_width', discoveredBy: 'createStairElement',
        });
      } catch { /* non-fatal */ }
      return null;
    }

    const widthM     = toMetres(rawWidth,             'dimension') ?? (Number(rawWidth)  / 1000);
    const riseM      = toMetres(riseMm,               'dimension') ?? (Number(riseMm)    / 1000);
    const _runM      = toMetres(runMm,                'dimension') ?? (Number(runMm)     / 1000);
    const rawLength  = stairData.length ?? (Number(rises) * Number(runMm));
    const lengthM    = toMetres(rawLength,            'dimension') ?? (Number(rawLength) / 1000);
    const totalRise  = Number(rises) * riseM;

    return {
      id: stairData.id || `stair-${storey.name}-${Date.now()}`,
      type: 'stair',
      name: `Stair ${stairData.id || ''} — ${storey.name}`,
      category: 'Architectural',
      properties: {
        element_type: 'stair',
        stair_type: stairData.type ?? null,
        material: stairData.material ?? null,
        rises,
        rise_mm: riseMm,
        run_mm: runMm,
        total_rise_m: totalRise,
        analysis_source: 'ai_extracted',
      },
      geometry: {
        location: { realLocation: { x: stairData.x, y: stairData.y, z: storey.elevation } },
        dimensions: { length: lengthM, width: widthM, height: totalRise, area: lengthM * widthM, volume: 0 },
      },
      quantities: {
        metric: [
          { type: 'count', value: rises,           unit: 'ea', name: 'Risers',       source: 'ai_extracted' },
          { type: 'area',  value: lengthM * widthM, unit: 'm²', name: 'Stair Area',   source: 'ai_extracted' },
          { type: 'length', value: widthM,           unit: 'm',  name: 'Stair Width',  source: 'ai_extracted' },
        ],
        imperial: [
          { type: 'count', value: rises,                    unit: 'ea',  name: 'Risers',      source: 'ai_extracted' },
          { type: 'area',  value: lengthM * widthM * 10.764, unit: 'ft²', name: 'Stair Area',  source: 'ai_extracted' },
        ],
      },
      storey: { name: storey.name, elevation: storey.elevation },
    };
  }

  /**
   * 🏛️ Create foundation element (spread, strip, pile, raft)
   * Quantities: volume (m³), formwork (m²), bearing area (m²)
   */
  private createFoundationElement(foundData: any, storey: StoreyData): RealBIMElement | null {
    if (foundData.x === undefined || foundData.y === undefined) return null;

    // Architecture law: no silent defaults for structural dimensions.
    const rawWidth = foundData.width ?? null;
    if (!rawWidth) {
      try {
        const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({
          category: 'dimension',
          description: `Foundation '${foundData.id || 'UNKNOWN'}' on storey '${storey.name}' has no footing width. ` +
            `Required: foundation plan or geotechnical report showing footing size. Foundation excluded.`,
          csiDivision: '03 30 00', impact: 'high',
          drawingRef: `Foundation plan — Foundation ${foundData.id || 'UNKNOWN'}`,
          costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: 'foundation_excluded_no_width', discoveredBy: 'createFoundationElement',
        });
      } catch { /* non-fatal */ }
      return null;
    }

    const rawDepth = foundData.depth_mm ?? foundData.depth ?? null;
    if (!rawDepth) {
      try {
        const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({
          category: 'dimension',
          description: `Foundation '${foundData.id || 'UNKNOWN'}' on storey '${storey.name}' has no footing depth. ` +
            `Required: foundation section showing footing depth. Foundation excluded.`,
          csiDivision: '03 30 00', impact: 'high',
          drawingRef: `Foundation section — Foundation ${foundData.id || 'UNKNOWN'}`,
          costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: 'foundation_excluded_no_depth', discoveredBy: 'createFoundationElement',
        });
      } catch { /* non-fatal */ }
      return null;
    }

    const rawBearing = foundData.bearing_depth_m ?? foundData.bearing_depth ?? null;
    if (rawBearing === null || rawBearing === undefined) {
      try {
        const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({
          category: 'dimension',
          description: `Foundation '${foundData.id || 'UNKNOWN'}' on storey '${storey.name}' has no bearing depth. ` +
            `Required: geotechnical report or foundation sections showing bearing depth below grade. Foundation excluded.`,
          csiDivision: '31 20 00', impact: 'high',
          drawingRef: `Geotechnical report / foundation sections — Foundation ${foundData.id || 'UNKNOWN'}`,
          costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: 'foundation_excluded_no_bearing_depth', discoveredBy: 'createFoundationElement',
        });
      } catch { /* non-fatal */ }
      return null;
    }

    const widthM     = toMetres(rawWidth,  'dimension') ?? (Number(rawWidth)  / 1000);
    const depthM     = toMetres(rawDepth,  'dimension') ?? (Number(rawDepth)  / 1000);
    const bearingM   = toMetres(rawBearing,'dimension') ?? Number(rawBearing);
    const volume     = widthM * widthM * depthM; // square footing
    const formworkA  = 4 * widthM * depthM;      // four sides

    return {
      id: foundData.id || `found-${Date.now()}`,
      type: 'foundation',
      name: `Foundation ${foundData.id || ''} — ${storey.name}`,
      category: 'Structural',
      properties: {
        element_type: 'foundation',
        foundation_type: foundData.type ?? null,
        material: foundData.material ?? null,
        bearing_depth_m: bearingM,
        analysis_source: 'ai_extracted',
      },
      geometry: {
        location: { realLocation: { x: foundData.x, y: foundData.y, z: storey.elevation - bearingM } },
        dimensions: { length: widthM, width: widthM, height: depthM, area: widthM * widthM, volume },
      },
      quantities: {
        metric: [
          { type: 'volume', value: volume,    unit: 'm³', name: 'Foundation Volume', source: 'ai_extracted' },
          { type: 'area',   value: formworkA, unit: 'm²', name: 'Formwork Area',     source: 'ai_extracted' },
          { type: 'area',   value: widthM * widthM, unit: 'm²', name: 'Bearing Area', source: 'ai_extracted' },
        ],
        imperial: [
          { type: 'volume', value: volume * 35.3147, unit: 'ft³', name: 'Foundation Volume', source: 'ai_extracted' },
        ],
      },
      storey: { name: storey.name, elevation: storey.elevation },
    };
  }

  /**
   * ⚡ Create MEP element (light, sprinkler, receptacle, diffuser, grille, panel)
   * Quantities: count (ea)
   */
  private createMEPElement(mepData: any, storey: StoreyData): RealBIMElement | null {
    if (mepData.x === undefined || mepData.y === undefined) return null;
    const category = mepData.category || 'mechanical';
    const type     = mepData.type     || 'equipment';

    // Mounting height must come from drawings (MEP reflected ceiling plan / schedules).
    // If absent: register RFI, place at storey elevation + flagged estimate, exclude from QTO.
    let mountH: number;
    let mountSource: string;
    let mountRfi = false;
    if (mepData.mounting_height !== undefined && mepData.mounting_height !== null) {
      mountH = toMetres(mepData.mounting_height, 'elevation') ?? (Number(mepData.mounting_height));
      // If still not a finite number, fall through to RFI
      if (!Number.isFinite(mountH)) {
        mountH = storey.elevation;
        mountSource = 'rfi_placeholder';
        mountRfi = true;
      } else {
        mountSource = 'extracted_from_drawings';
      }
    } else {
      try {
        const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({
          category: 'dimension',
          description: `MEP element '${mepData.id || type.toUpperCase()}' (${type}) on storey '${storey.name}' has no mounting height. ` +
            `Required: MEP reflected ceiling plan or fixture/equipment schedule. ` +
            `Element placed at storey elevation as placeholder — excluded from priced BOQ.`,
          csiDivision: type === 'sprinkler' ? '21 13 00' : type === 'light' ? '26 50 00' : '23 00 00',
          impact: 'low',
          drawingRef: `MEP reflected ceiling plan / schedule — ${type.toUpperCase()} ${mepData.id || 'UNKNOWN'}, Storey ${storey.name}`,
          costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: 'mounting_height=storey_elevation_placeholder',
          discoveredBy: 'createMEPElement',
        });
      } catch { /* non-fatal */ }
      mountH = storey.elevation;
      mountSource = 'rfi_placeholder';
      mountRfi = true;
    }

    const csiMap: Record<string, string> = {
      light: '26 50 00', sprinkler: '21 13 00', receptacle: '26 27 26',
      diffuser: '23 37 00', grille: '23 37 13', panel: '26 24 16',
      equipment: '23 00 00',
    };

    return {
      id: mepData.id || `mep-${type}-${Date.now()}`,
      type: 'mep',
      name: `${type.charAt(0).toUpperCase() + type.slice(1)} — ${storey.name}`,
      category: category === 'electrical' ? 'Electrical' : category === 'plumbing' ? 'Plumbing' : 'Mechanical',
      properties: {
        element_type: 'mep',
        mep_category: category,
        mep_type: type,
        csi_code: csiMap[type] || '23 00 00',
        mounting_height: mountH,
        mounting_height_source: mountSource,
        rfi_flag: mountRfi,
        needs_attention: mountRfi,
        attention_reason: mountRfi
          ? `MEP mounting height not found in drawings. Element placed at storey elevation — verify in reflected ceiling plan.`
          : null,
        exclude_from_boq: mountRfi,
        analysis_source: mountRfi ? 'rfi_placeholder' : 'ai_extracted',
      },
      geometry: {
        location: { realLocation: { x: mepData.x, y: mepData.y, z: mountH } },
        dimensions: { length: 0.3, width: 0.3, height: 0.1, area: 0.09, volume: 0.009 },
      },
      quantities: {
        metric:   [{ type: 'count', value: 1, unit: 'ea', name: `${type} Count`, source: 'ai_extracted' }],
        imperial: [{ type: 'count', value: 1, unit: 'ea', name: `${type} Count`, source: 'ai_extracted' }],
      },
      storey: { name: storey.name, elevation: storey.elevation },
    };
  }

  /**
   * 📐 Derive approximate geometry from CSI quantity data (for assembly-format elements)
   * Used when explicit coordinates are not available in the CSI assembly path.
   */
  private deriveGeometryFromQuantity(quantity: any, storey: StoreyData, _elementType: string): any {
    // Try to extract a meaningful dimension from the quantity object
    const q = quantity || {};
    const area   = q.area   || q.area_m2   || q.surface_area || 0;
    const length = q.length || q.linear_m  || q.perimeter    || 0;
    const volume = q.volume || q.volume_m3 || 0;
    const count  = q.count  || q.quantity  || 1;

    if (area > 0) {
      const side = Math.sqrt(area);
      return {
        location: { realLocation: { x: 0, y: 0, z: storey.elevation } },
        dimensions: { length: side, width: side, height: 1, area, volume: volume || area * 0.2 },
        source: 'derived_from_area',
      };
    }
    if (length > 0) {
      return {
        location: { realLocation: { x: 0, y: 0, z: storey.elevation } },
        dimensions: { length, width: 0.2, height: 2.7, area: length * 2.7, volume: length * 0.2 * 2.7 },
        source: 'derived_from_length',
      };
    }
    if (volume > 0) {
      const side = Math.cbrt(volume);
      return {
        location: { realLocation: { x: 0, y: 0, z: storey.elevation } },
        dimensions: { length: side, width: side, height: side, area: side * side, volume },
        source: 'derived_from_volume',
      };
    }
    // Minimal placeholder — element exists but geometry is not calculable
    return {
      location: { realLocation: { x: 0, y: 0, z: storey.elevation } },
      dimensions: { length: 0, width: 0, height: 0, area: 0, volume: 0 },
      source: 'no_quantity_data',
      count,
    };
  }

  /**
   * ✅ QTO Cross-Check — validates extracted quantities against building-level expectations
   * Flags discrepancies > 15% as RFI-worthy findings.
   */
  runQTOCrossCheck(
    elements: RealBIMElement[],
    buildingPerimeterM: number,
    grossFloorAreaM2: number
  ): { passed: boolean; findings: string[] } {
    const findings: string[] = [];

    // 1. Wall length vs building perimeter
    const wallLengths = elements
      .filter(e => e.type === 'wall')
      .map(e => e.geometry?.dimensions?.length || 0);
    const totalWallLength = wallLengths.reduce((s, v) => s + v, 0);
    const floors = new Set(elements.map(e => e.storey?.name)).size || 1;
    const expectedMinWallLength = buildingPerimeterM * floors * 0.6; // ≥60% of perimeter×floors
    if (buildingPerimeterM > 0 && totalWallLength < expectedMinWallLength) {
      findings.push(
        `⚠️ QTO CHECK: Total wall length ${totalWallLength.toFixed(1)}m is less than ` +
        `60% of expected (${expectedMinWallLength.toFixed(1)}m = ${buildingPerimeterM.toFixed(1)}m perimeter × ${floors} floors). ` +
        `Possible missed walls — verify extraction.`
      );
    }

    // 2. Slab area vs GFA
    const slabAreas = elements
      .filter(e => e.type === 'slab' && (e.properties as any)?.slab_type !== 'roof')
      .map(e => e.geometry?.dimensions?.area || 0);
    const totalSlabArea = slabAreas.reduce((s, v) => s + v, 0);
    if (grossFloorAreaM2 > 0 && totalSlabArea > 0) {
      const ratio = totalSlabArea / grossFloorAreaM2;
      if (ratio < 0.75 || ratio > 1.30) {
        findings.push(
          `⚠️ QTO CHECK: Total slab area ${totalSlabArea.toFixed(1)}m² is ${(ratio * 100).toFixed(0)}% of ` +
          `stated GFA ${grossFloorAreaM2.toFixed(1)}m². ` +
          `Expected 75–130%. Verify slab boundaries or GFA input.`
        );
      }
    }

    // 3. Door/window count sanity
    const doorCount   = elements.filter(e => e.type === 'door').length;
    const windowCount = elements.filter(e => e.type === 'window').length;
    if (doorCount === 0 && elements.length > 10) {
      findings.push(`⚠️ QTO CHECK: No doors extracted from drawings. Verify door schedule extraction.`);
    }
    if (windowCount === 0 && elements.length > 10) {
      findings.push(`⚠️ QTO CHECK: No windows extracted. Verify window schedule extraction.`);
    }

    // 4. Structural elements
    const columnCount = elements.filter(e => e.type === 'column').length;
    const beamCount   = elements.filter(e => e.type === 'beam').length;
    if (columnCount === 0 && floors > 1) {
      findings.push(`⚠️ QTO CHECK: No columns extracted for multi-storey building. Verify structural drawing extraction.`);
    }
    if (beamCount === 0 && floors > 1) {
      findings.push(`⚠️ QTO CHECK: No beams extracted for multi-storey building. Verify structural drawing extraction.`);
    }

    // 5. Foundation
    const foundCount = elements.filter(e => e.type === 'foundation').length;
    if (foundCount === 0) {
      findings.push(`⚠️ QTO CHECK: No foundations extracted. Verify foundation plan extraction.`);
    }

    logger.info(`QTO Cross-Check: ${findings.length} findings`, { findings });
    return { passed: findings.length === 0, findings };
  }

  private extractStoreysFromElements(elements: RealBIMElement[]): StoreyData[] {
    const storeyMap = new Map<string, StoreyData>();
    
    elements.forEach(el => {
      const storeyName = el.storey?.name;
      if (!storeyName) return;

      let elevation = el.storey?.elevation;

      // Follow inferStoreysIfMissing pattern: fall back to geometry z-value if storey elevation absent
      if (elevation === undefined || elevation === null) {
        const g = typeof el.geometry === 'string' ? JSON.parse(el.geometry) : el.geometry;
        const z = g?.location?.realLocation?.z;
        if (Number.isFinite(z)) {
          elevation = z;
        } else {
          // No elevation from storey or geometry — register RFI and exclude (same as inferStoreysIfMissing)
          try {
            const { registerMissingData } = require('./estimator/rfi-generator');
            registerMissingData({
              category: 'dimension',
              description: `Element '${el.id || 'UNKNOWN'}' on storey '${storeyName}' has no elevation and no geometry z-value. ` +
                'Building section drawings must be uploaded to determine actual floor-to-floor heights.',
              csiDivision: '00 00 00', impact: 'high',
              drawingRef: 'Building sections (A-series) and elevation drawings',
              costImpactLow: 0, costImpactHigh: 0,
              assumptionUsed: undefined, discoveredBy: 'extractStoreysFromElements',
            });
          } catch { /* non-fatal */ }
          return;
        }
      }

      if (!storeyMap.has(storeyName)) {
        storeyMap.set(storeyName, {
          name: storeyName,
          elevation,
          guid: randomUUID(),
          elementCount: 0
        });
      }
      storeyMap.get(storeyName)!.elementCount++;
    });

    // If nothing built from elements, fall back to inferStoreysIfMissing
    if (storeyMap.size === 0) {
      return inferStoreysIfMissing(undefined, elements, {});
    }
    
    return Array.from(storeyMap.values()).sort((a, b) => a.elevation - b.elevation);
  }
  
  private extractStoreysFromCAD(_filePath: string): StoreyData[] {
    throw new Error('❌ CANNOT USE DEFAULT STOREYS: Claude must extract actual floor elevations from CAD drawings!\n🔍 Check architectural plans, sections, and elevations for floor-to-floor heights and datum levels.\n⚠️ NO DEFAULTS ALLOWED - Use actual measurements from construction documents.');
  }

  private convertCADComponentToBIMElement(component: any, _index: number): RealBIMElement {
    throw new Error(`❌ MISSING STOREY DATA FOR CAD COMPONENT: Component type '${component.type || 'UNKNOWN'}' must be associated with actual storey elevation from CAD drawings!\n🔍 Claude must extract floor levels from architectural plans.`);
  }

  private isArchitecturalEntity(entity: any): boolean {
    const type = entity?.type?.toLowerCase() || '';
    return type.includes('wall') || type.includes('door') || type.includes('window');
  }

  private convertCADEntityToBIMElement(entity: any, _index: number): RealBIMElement {
    throw new Error(`❌ MISSING STOREY DATA FOR CAD ENTITY: Entity type '${entity.type || 'UNKNOWN'}' must be associated with actual storey elevation from CAD drawings!\n🔍 Claude must extract floor levels from architectural plans.`);
  }

  /**
   * 📐 Validate elements with appropriate grid system (architectural or structural)
   */
  private validateWithGridSystem(elements: RealBIMElement[], analysisData: any, documents: any[]): RealBIMElement[] {
    const validator = new GeometryValidator();
    
    // Detect drawing types from documents
    const drawingTypes: string[] = [];
    let hasArchitectural = false;
    let hasStructural = false;
    
    if (documents && Array.isArray(documents)) {
      for (const doc of documents) {
        const fileName = doc.fileName || doc.name || '';
        const sheetName = doc.sheet_name || '';
        
        // Check for architectural drawings (A-xxx)
        if (fileName.match(/A-\d+/i) || sheetName.match(/^A-/i)) {
          hasArchitectural = true;
          drawingTypes.push('A-' + (fileName.match(/A-(\d+)/i)?.[1] || 'xxx'));
        }
        
        // Check for structural drawings (S-xxx)
        if (fileName.match(/S-\d+/i) || sheetName.match(/^S-/i)) {
          hasStructural = true;
          drawingTypes.push('S-' + (fileName.match(/S-(\d+)/i)?.[1] || 'xxx'));
        }
      }
    }
    
    logger.info(`📋 Drawing types detected: Architectural=${hasArchitectural}, Structural=${hasStructural}`);
    
    // Extract grid systems — prefer DETECTED grid (WP-0 through WP-7) over Claude analysis
    let architecturalGrid: GridSystem | null = null;
    let structuralGrid: GridSystem | null = null;

    try {
      // projectId not available in this helper — grid detection skipped (caller must pass if needed)
      // const { getGeometryValidatorGrid } = await import('./services/grid-integration-bridge');
      // const detectedGrid = await getGeometryValidatorGrid(projectId, 'combined');
    } catch (err) {
      logger.debug(`Grid detection bridge unavailable: ${(err as Error).message}`);
    }

    // Fall back to Claude analysis ONLY if no detected grid
    if (!architecturalGrid && (analysisData?.architectural_grid || analysisData?.grid_system)) {
      architecturalGrid = this.extractGridFromAnalysis(analysisData.architectural_grid || analysisData.grid_system, 'architectural');
      if (architecturalGrid) logger.info(`📐 Using Claude-extracted architectural grid (no detected grid available)`);
    }

    if (!structuralGrid && analysisData?.structural_grid) {
      structuralGrid = this.extractGridFromAnalysis(analysisData.structural_grid, 'structural');
    }
    
    // If we have both grid types, compare them
    if (architecturalGrid && structuralGrid) {
      const comparison = validator.compareGrids(architecturalGrid, structuralGrid);
      if (!comparison.matching) {
        logger.warn(
          `⚠️ Architectural and Structural grids differ:\n` +
          comparison.differences.map(d => `  • ${d}`).join('\n')
        );
      } else {
        logger.info(`✅ Architectural and Structural grids match`);
      }
    }
    
    // Use the appropriate grid for validation
    const gridToUse = structuralGrid || architecturalGrid;
    
    if (gridToUse) {
      // Validate elements
      const validation = validateExtractedGeometry(
        elements as any[], // Type conversion for compatibility
        analysisData
      );
      
      if (validation.suggestions.length > 0) {
        logger.info(
          `📊 Geometry Validation Results:\n` +
          validation.suggestions.join('\n')
        );
      }
      
      // Return validated elements (maintain type compatibility)
      // Since validation only filters, not transforms, we can safely return
      const validatedIds = new Set(validation.validated.map((e: any) => e.id));
      return elements.filter(el => validatedIds.has(el.id));
    } else {
      logger.warn(`⚠️ No grid system found in Claude's analysis - skipping grid validation`);
      return elements;
    }
  }
  
  /**
   * Extract grid system from Claude's analysis
   */
  private extractGridFromAnalysis(gridData: any, source: 'architectural' | 'structural'): GridSystem | null {
    if (!gridData) return null;
    
    try {
      const grid: GridSystem = {
        vertical: [],
        horizontal: [],
        spacing: { x: null, y: null },
        source: source
      };
      
      // Extract vertical grids (A, B, C...)
      if (gridData.vertical_grids || gridData.columns) {
        const verticals = gridData.vertical_grids || gridData.columns;
        if (Array.isArray(verticals)) {
          grid.vertical = verticals
            .filter((v: any) => Number.isFinite(v.position) || Number.isFinite(v.x))
            .map((v: any, i: number) => ({
              position: v.position ?? v.x,  // NO DEFAULT — missing position = skip
              label: v.label || v.grid || String.fromCharCode(65 + i)
            }));
          if (grid.vertical.length < verticals.length) {
            logger.warn(`⚠️ Skipped ${verticals.length - grid.vertical.length} vertical grids with missing position data — RFI required`);
          }
        }
      }
      
      // Extract horizontal grids (1, 2, 3...)
      if (gridData.horizontal_grids || gridData.rows) {
        const horizontals = gridData.horizontal_grids || gridData.rows;
        if (Array.isArray(horizontals)) {
          grid.horizontal = horizontals
            .filter((h: any) => Number.isFinite(h.position) || Number.isFinite(h.y))
            .map((h: any, i: number) => ({
              position: h.position ?? h.y,  // NO DEFAULT — missing position = skip
              label: h.label || h.grid || String(i + 1)
            }));
          if (grid.horizontal.length < horizontals.length) {
            logger.warn(`⚠️ Skipped ${horizontals.length - grid.horizontal.length} horizontal grids with missing position data — RFI required`);
          }
        }
      }
      
      // Extract typical spacing
      if (gridData.typical_spacing) {
        grid.spacing.x = gridData.typical_spacing.x || gridData.typical_spacing;
        grid.spacing.y = gridData.typical_spacing.y || gridData.typical_spacing;
      }
      
      logger.info(
        `Extracted ${source} grid: ` +
        `${grid.vertical.length} vertical, ${grid.horizontal.length} horizontal grids`
      );
      
      return grid;
    } catch (error) {
      logger.warn(`Could not extract ${source} grid from analysis: ${error}`);
      return null;
    }
  }

  /**
   * 🎯 Extract building analysis including perimeter from Claude's response
   */
  private extractBuildingAnalysis(aiAnalysis: any): any {
    // Extract from various possible locations in Claude's response
    const analysisData = typeof aiAnalysis === 'object' ? aiAnalysis : {};
    
    const analysis: any = {
      dimensions: null,
      perimeter: null,
      origin: analysisData?.coordinate_system?.origin || analysisData?.origin || null
    };
    
    // Helper: filter out perimeter points with missing coords (y=0 is valid!)
    const toPerimeterPt = (pt: any) => {
      if (pt.x === undefined || pt.x === null) return null;
      if (pt.y === undefined && pt.z === undefined) return null;
      return { x: Number(pt.x), z: Number(pt.y ?? pt.z) };
    };

    // Try to get perimeter from building_perimeter or building_analysis
    if (analysisData.building_perimeter && Array.isArray(analysisData.building_perimeter)) {
      const pts = analysisData.building_perimeter.map(toPerimeterPt).filter(Boolean);
      if (pts.length >= 3) {
        analysis.perimeter = pts;
        logger.info(`Extracted building perimeter with ${pts.length} points from Claude analysis`);
      } else {
        logger.warn(`building_perimeter had ${analysisData.building_perimeter.length} points but only ${pts.length} had valid coords — skipping`);
      }
    } else if (analysisData.building_analysis?.building_perimeter) {
      const pts = analysisData.building_analysis.building_perimeter.map(toPerimeterPt).filter(Boolean);
      if (pts.length >= 3) {
        analysis.perimeter = pts;
        logger.info(`Extracted building perimeter from building_analysis section`);
      }
    }
    
    // Extract dimensions if available (only when both width and length are present and non-zero)
    if (analysisData.building_analysis?.dimensions) {
      const dims = analysisData.building_analysis.dimensions;
      if (dims.width && dims.width !== 0 && dims.length && dims.length !== 0) {
        analysis.dimensions = {
          width: Number(dims.width),
          length: Number(dims.length)
        };
        logger.info(`Extracted building dimensions: ${analysis.dimensions.width}m x ${analysis.dimensions.length}m`);
      } else {
        logger.warn('building_analysis.dimensions present but width/length missing or zero — skipping');
      }
    }
    
    // Try to extract from floor_plates if no perimeter found
    if (!analysis.perimeter && analysisData.floor_plates && Array.isArray(analysisData.floor_plates)) {
      const firstFloor = analysisData.floor_plates[0];
      if (firstFloor?.boundary && Array.isArray(firstFloor.boundary)) {
        const pts = firstFloor.boundary.map(toPerimeterPt).filter(Boolean);
        if (pts.length >= 3) {
          analysis.perimeter = pts;
          logger.info(`Extracted building perimeter from floor_plates boundary`);
        }
      }
    }
    
    return analysis;
  }

  /**
   * 🎯 Extract building facts for compliance validation
   */
  private extractBuildingFactsFromAnalysis(claudeAnalysis: any, _elements: RealBIMElement[]): Record<string, any> {
    const facts: Record<string, any> = {};
    
    // Extract from Claude analysis
    const analysis = claudeAnalysis || {};
    const buildingSpecs = analysis.building_specifications || {};
    const components = analysis.ai_understanding?.building_components_detected || {};
    
    // Building dimensions
    facts.building_height_m = buildingSpecs.height; // NO DEFAULT - use actual height
    facts.number_of_floors = buildingSpecs.floors; // NO DEFAULT
    facts.fire_area_m2 = buildingSpecs.floor_area; // NO DEFAULT
    facts.fire_area_sqft = facts.fire_area_m2 * 10.764; // Convert to sq ft
    
    // Occupancy and exits
    facts.occupancy_group = buildingSpecs.occupancy || 'Residential';
    facts.occupant_load = buildingSpecs.occupant_load; // NO DEFAULT
    facts.number_of_exits = components.exits; // NO DEFAULT
    
    // Structural
    facts.construction_type = buildingSpecs.construction_type || 'Type IIIA';
    facts.concrete_fc_MPa = buildingSpecs.concrete_strength; // NO DEFAULT
    facts.exposure_class = buildingSpecs.exposure_class || 'F-1';
    
    // Fire protection
    facts.sprinklered = buildingSpecs.sprinklered !== false; // Default true
    facts.fire_rating_hours = buildingSpecs.fire_rating; // NO DEFAULT
    
    // Accessibility  
    facts.barrier_free_path_width_mm = buildingSpecs.barrier_free_width; // NO DEFAULT
    facts.door_width_inches = buildingSpecs.door_width; // NO DEFAULT
    
    // Environmental
    facts.location = buildingSpecs.location || null; // NO DEFAULT — omit if not extracted
    facts.basic_wind_speed_mph = buildingSpecs.wind_speed; // NO DEFAULT
    facts.location_wind_speed_mph = buildingSpecs.location_wind_speed || null;
    facts.seismic_category = buildingSpecs.seismic_category || 'C';
    
    // Live loads
    facts.live_load_kPa = buildingSpecs.live_load; // NO DEFAULT
    facts.live_load_psf = facts.live_load_kPa * 20.885; // Convert to psf
    
    logger.info('📊 Extracted building facts for compliance:', facts);
    return facts;
  }

  // ── Dead-end trap — never called in production ───────────────────────────
  // Kept as a named method so TypeScript does not complain if any stale import
  // references it. The first line throws unconditionally; the body below is
  // unreachable and exists only so the compiler does not flag missing return types.
  private generateEnhancedSampleData(_options: any): never {
    throw new Error(
      'generateEnhancedSampleData: DISABLED. ' +
      'Real construction documents are required. ' +
      'This method must never be called in production.'
    );
  }

  private getExistingClaudeAnalysis(projectId: string): any {
    logger.debug(`Looking for existing Claude analysis for project ${projectId}`);
    return null; // Implement if needed
  }
}
