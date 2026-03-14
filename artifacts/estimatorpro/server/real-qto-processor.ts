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
      throw new Error('❌ MISSING BUILDING FOOTPRINT: Cannot determine building bounds from elements or Claude analysis.\n🔍 Claude MUST extract building perimeter from floor plans - no fallback bounds allowed!');
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
      const { registerMissingData } = require('./estimator/rfi-generator');
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
      const { registerMissingData } = require('./estimator/rfi-generator');
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
      "walls": [{"id": "W1", "start": {"x": 0, "y": 0}, "end": {"x": 5, "y": 0}, "thickness": 200, "ceiling_height": null, "type": "exterior|interior|fire-rated|curtain", "material": "concrete|masonry|stud", "fire_rating": null}], // EXTRACT from architectural drawings
      "columns": [{"id": "C1", "x": 5, "y": 5, "size": "400x400", "height": null, "type": "concrete|steel|timber", "reinforcement": null}], // USE LEGEND to read height
      "beams": [{"id": "B1", "start": {"x": 0, "y": 5}, "end": {"x": 6, "y": 5}, "size": "300x600", "depth": 600, "material": "concrete|steel", "top_elevation": null}], // EXTRACT from structural drawings
      "slabs": [{"id": "SL1", "boundary": [{"x": 0, "y": 0}, {"x": 22, "y": 0}, {"x": 22, "y": 15}, {"x": 0, "y": 15}], "thickness": 200, "type": "floor|roof|transfer", "material": "concrete", "top_elevation": null}], // EXTRACT slab boundary = floor plate extents; thickness from sections
      "stairs": [{"id": "ST1", "x": 10, "y": 5, "width": 1200, "length": 4000, "rises": 16, "rise_mm": 175, "run_mm": 275, "type": "straight|L-shaped|U-shaped", "material": "concrete|steel|timber"}], // EXTRACT from floor plans and sections
      "foundations": [{"id": "F1", "x": 5, "y": 5, "width": 600, "depth_mm": 400, "bearing_depth_m": 1.5, "type": "spread|strip|pile|raft", "material": "concrete"}], // GROUND FLOOR ONLY — from foundation plan/sections
      "mep": [{"id": "L1", "category": "electrical", "type": "light", "x": 3, "y": 3, "mounting_height": 2.7}, {"id": "SP1", "category": "mechanical", "type": "sprinkler", "x": 3, "y": 3, "mounting_height": 2.9}, {"id": "REC1", "category": "electrical", "type": "receptacle", "x": 1, "y": 2, "mounting_height": 0.4}], // EXTRACT MEP symbols from plans per legend
      "doors": [{"id": "D1", "x": 2.5, "y": 0, "width": 900, "height": null, "thickness": null, "wall_thickness": null, "type": "single|double|sliding", "fire_rating": null, "hardware_set": null}], // thickness from door schedule "THK" column; wall_thickness from hosting wall assembly detail — BOTH required for BOQ
      "windows": [{"id": "WIN1", "x": 7, "y": 0, "width": 1800, "height": null, "sill_height": null, "type": "fixed|casement|curtain-wall", "glazing": null}], // USE LEGEND
      "rooms": [{"id": "R1", "name": "Living Room", "boundary": [{"x": 0, "y": 0}, {"x": 5, "y": 0}, {"x": 5, "y": 4}, {"x": 0, "y": 4}], "ceiling_height": null, "area_m2": null}] // USE LEGEND
    }
  ]
}

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
        
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          messages: [{ role: "user", content: analysisPrompt }]
        });
        
        const aiAnalysis = response.content[0].type === 'text' ? response.content[0].text : '';
        return await this.generateElementsFromAIAnalysis(aiAnalysis, options);
      }
      
      // Fallback: Read PDF content for new AI analysis
      // Bug-C fix (v15.4): use loadFileBuffer which tries all storage path candidates.
      // readFileSync(filePath) used a constructed path that never matched FileStorageService's
      // actual storage layout (./uploads/projects/PID/documents/DID/revisions/...).
      const { loadFileBuffer } = await import('./services/storage-file-resolver');
      const storageKey = (claudeAnalysis as any)?.storageKey
                      || path.basename(filePath);
      const pdfBufferOrNull = await loadFileBuffer(storageKey);
      if (!pdfBufferOrNull) {
        logger.warn(`⚠️ Could not load PDF for ${path.basename(filePath)} via any candidate path — skipping new AI analysis`);
        const storeys = this.extractStoreysFromElements([]);
        return {
          elements: [],
          storeys,
          summary: { totalElements: 0, processingMethod: 'pdf_load_failed', rfiCount: 1 }
        };
      }
      const pdfBuffer = pdfBufferOrNull;
      
      // Use Claude to analyze construction documents
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      
      const analysisPrompt = `You are a QUALIFIED QUANTITY SURVEYOR ESTIMATOR and EXPERT BIM MODELER with 20+ years experience. Your task is to ACCURATELY EXTRACT the complete building geometry to enable 3D BIM reconstruction.

🎯 YOUR CRITICAL MISSION:
Extract ALL structural elements and geometry from these construction documents to reproduce the ACTUAL building (not a simplified box).

⚠️ CRITICAL HEIGHT EXTRACTION REQUIREMENTS:
1. **CHECK EVERY DRAWING FOR LEGEND**: Legend may be on EVERY sheet (corner box) OR only on some sheets
2. **TWO COMMON PATTERNS**:
   - Legend on EVERY drawing (typically in title block area or corner)
   - Legend on SELECT sheets only (cover, first sheet, or general notes)
3. **COMPILE LEGEND INFORMATION**: Gather ALL legend info from ALL sheets where it appears
4. **APPLY COMPILED LEGEND**: Use the complete legend information to interpret all drawings
5. **DIMENSION CONVENTIONS**: Follow the legend's notation for heights, elevations, and measurements
6. **NO DEFAULTS** - Extract actual measurements using legend conventions from wherever they appear!

🏗️ MANDATORY GEOMETRY EXTRACTION:
1. **LEGEND SEARCH STRATEGY**:
   - Check EVERY drawing sheet for legend information
   - Legend might be repeated on all sheets OR only on some
   - Common locations: title block, corner box, first sheet, general notes
2. **LINE PATTERN RECOGNITION**: Compile line type definitions from ALL legends found:
   - Grid lines: Often dash-dot pattern (---dot---dot---)
   - Walls: Solid lines (━━━)
   - Hidden/Above: Dashed lines (- - -)
3. **ARCHITECTURAL GRID LINES**: Use compiled legend to identify grids across all drawings
4. **STRUCTURAL GRID LINES**: Apply legend patterns consistently to all structural sheets
   - Note: Architectural and structural grids may differ - document both!
3. **BUILDING PERIMETER**: Trace the EXACT building outline from architectural floor plans (irregular shapes, not rectangles)
4. **COLUMN COORDINATION (ARCHITECTURAL + STRUCTURAL)**:
   - **STEP 1**: Identify columns in ARCHITECTURAL drawings (architect's intended locations)
   - **STEP 2**: Identify columns in STRUCTURAL drawings (engineer's actual design)
   - **STEP 3**: COMPARE locations between both disciplines
   - **STEP 4**: Flag any discrepancies as RFI (Request for Information) items
   - Look for column symbols in BOTH architectural and structural legends
   - Common architectural symbols: dashed rectangles, outline squares
   - Common structural symbols: solid/hatched rectangles with reinforcement details
   - Extract size, type, and coordinates from BOTH drawing sets
   - Document any misalignments between architectural intent and structural design
5. **ALL WALLS**: Map EVERY wall type from drawings:
   - Standard walls (exterior/interior)
   - CURB WALLS (low walls for parking, landscaping)
   - Retaining walls
   - Parapet walls
   - Fire walls
   - Extract start/end points, heights, thicknesses, and materials
6. **ACCESSIBILITY & SITE ELEMENTS**:
   - RAMPS: Identify all accessibility ramps with slopes, widths, and handrail details
   - CURBS: Extract curb locations, heights, and types (standard, mountable, barrier)
   - STAIRS: All stairways with rise/run dimensions and handrail specifications
   - ELEVATORS & LIFTS: Location and dimensions
   - SITE GRADING: Elevation changes and slopes
7. **FLOOR BOUNDARIES**: Extract actual floor plate shapes from ARCHITECTURAL plans for each level (not simplified rectangles)
8. **ALL OPENINGS**: Locate EVERY door and window from ARCHITECTURAL drawings with positions, widths, and heights
9. **SPECIAL FEATURES**: 
   - Mechanical/electrical rooms
   - Shafts (elevator, mechanical, electrical)
   - Balconies and terraces
   - Canopies and overhangs
   - Loading docks
   - Any unique elements shown in details or specifications

**📚 CRITICAL: READ ALL DRAWINGS IN PARALLEL WITH SPECIFICATIONS**
- DO NOT read drawings in isolation - cross-reference with specs continuously
- Architectural drawings + Structural drawings + Specifications = Complete picture
- Flag any conflicts between disciplines as RFI items

Follow the PROFESSIONAL ESTIMATION METHODOLOGY in this EXACT sequence:

**📋 STEP 1: SPECIFICATIONS REVIEW**
First, identify and read ALL specifications in the document:
- Material specifications and standards (CSA, ASTM, etc.)
- Quality requirements and grade specifications  
- Construction methods and procedures
- Workmanship standards and tolerances
- Special requirements and notes

**🗝️ STEP 2: LEGEND AND SYMBOL IDENTIFICATION** 
Find and document ALL legends, symbols, and abbreviations:
- COLUMN SYMBOLS: Identify how columns are represented (solid rectangles, hatched squares, etc.)
- Wall type symbols and their meanings
- Door and window schedule symbols
- Material hatch patterns and what they represent (concrete, steel, masonry, etc.)
- Electrical, mechanical, plumbing symbols
- CRITICAL: Use these symbols to identify actual elements in the drawings
- Drawing annotation symbols and abbreviations
- Reference symbols linking to details

**🔧 STEP 3: CONSTRUCTION ASSEMBLIES ANALYSIS**
Study ALL construction details, sections, and assemblies:
- Wall sections showing layer build-up and materials
- Foundation details and connection methods  
- Floor and roof assembly constructions
- Connection details between different elements
- Typical details referenced in the main drawings
- Cross-sections showing vertical relationships

**🏗️ STEP 4: DRAWING COMPREHENSION AND CONSTRUCTION APPROACH**
Analyze the drawings to understand HOW the building will be constructed:
- Overall building layout and structural approach
- Construction sequence and phasing
- How different building systems connect and relate
- Coordination between architectural, structural, and MEP systems
- Building orientation and site relationships
- Construction methodology implied by the design

**📍 STEP 5: ESTABLISH ORIGIN AND REFERENCE POINTS**
ONLY AFTER understanding the above, establish:
- Building reference points and grid system
- Primary datum levels and elevations  
- Coordinate system origin (typically bottom-left)
- North arrow direction and building orientation

**🔍 STEP 6: ASSEMBLY-BASED QUANTIFICATION WITH CSI CROSS-REFERENCING**
Create complete construction assemblies by cross-referencing specifications, drawings, and details:

**🏗️ ASSEMBLY CREATION PROCESS:**
For each wall type (e.g., IW3D fire-rated wall):
1. **Find wall locations** from drawings using Step 2 legends
2. **Get assembly details** from Step 3 construction sections  
3. **Cross-reference specifications** for each assembly component
4. **Calculate quantities** for the complete assembly
5. **Organize by CSI divisions** for proper estimation

**Example Assembly Analysis:**
If drawings show "Wall Type IW3D" (fire-rated):
- Measure wall length from drawings
- Find IW3D detail showing: studs + drywall + insulation + fire stopping
- Cross-reference specs: Division 07 (fire stopping), Division 09 (drywall), etc.
- Calculate: fire stopping linear feet, drywall square feet, insulation square feet
- Create assembly: "IW3D Fire-Rated Wall Assembly" with all components

**REQUIRED JSON OUTPUT - COMPLETE BUILDING GEOMETRY WITH CSI ORGANIZATION:**
⚠️ CRITICAL WARNING: The JSON below shows the FORMAT ONLY. 
DO NOT USE ANY OF THE EXAMPLE VALUES - they are placeholders to show structure.
YOU MUST EXTRACT ALL REAL VALUES FROM THE ACTUAL CONSTRUCTION DOCUMENTS.
{
  "drawing_legend": {
    "found_on_sheets": ["List EVERY sheet containing legend - could be all sheets or just some"],
    "dimension_notation": "Compiled from all legends: how dimensions are shown",
    "elevation_system": "Datum point and elevation notation format",
    "vertical_dimensions": "How floor-to-floor and ceiling heights are indicated",
    "line_patterns": {
      "description": "Line types from legend(s) showing how to identify elements",
      "grid_lines": "Dash-dot pattern or as shown in legend",
      "walls": "Solid lines or as defined",
      "hidden_above": "Dashed pattern for elements above cutting plane"
    },
    "symbols": "Key symbols for structural and architectural elements"
  },
  "building_analysis": {
    "project_name": "Extract from title block",
    "building_type": "Residential/Commercial/Industrial",
    "total_floors": 3,
    "architectural_grid_system": {
      "source": "ACTUAL drawing numbers where you found the grid",
      "x": [
        // EXTRACT ACTUAL grid lines from drawings - DO NOT USE THESE EXAMPLE VALUES
        {"name": "ACTUAL_GRID_LABEL", "pos": "ACTUAL_POSITION_IN_METERS"}
        // Add ALL grid lines shown on the architectural plans
      ],
      "y": [
        // EXTRACT ACTUAL grid lines from drawings - DO NOT USE THESE EXAMPLE VALUES
        {"name": "ACTUAL_GRID_LABEL", "pos": "ACTUAL_POSITION_IN_METERS"}
        // Add ALL grid lines shown on the architectural plans
      ]
    },
    "structural_grid_system": {
      "source": "ACTUAL structural drawing numbers where grid is shown",
      "x": [
        // EXTRACT ACTUAL structural grid from drawings - DO NOT USE EXAMPLES
        {"name": "REAL_GRID_NAME", "pos": "REAL_POSITION"}
        // Extract from structural plans, not these examples
      ],
      "y": [
        // EXTRACT ACTUAL structural grid from drawings - DO NOT USE EXAMPLES
        {"name": "REAL_GRID_NAME", "pos": "REAL_POSITION"}
        // Extract from structural plans, not these examples
      ]
    },
    "building_perimeter": [
      // TRACE ACTUAL BUILDING OUTLINE from floor plans
      // DO NOT use this rectangle example - extract real perimeter
      {"x": "ACTUAL_X", "y": "ACTUAL_Y"}
      // Include all vertices of the real building footprint
    ],
    "column_legend": {
      "symbol_description": "Solid black rectangles with white text labels",
      "pattern": "solid fill or concrete hatch pattern",
      "source_drawing": "S1.01 Structural Legend"
    },
    "architectural_columns": [
      // EXTRACT ACTUAL columns from architectural drawings
      // DO NOT use these examples - find real column positions
      {"id": "REAL_ID", "drawing": "ACTUAL_DRAWING", "location": "ACTUAL_GRID", "x": "REAL_X", "y": "REAL_Y", "shown_as": "how it appears"}
      // List ALL columns shown on the architectural plans
    ],
    "structural_columns": [
      {"id": "SC1", "drawing": "S2.01", "location": "Near grid A1", "x": 0.2, "y": 0.2, "size": "400x400mm", "type": "concrete", "height": null}, // EXTRACT actual height from structural drawings
      {"id": "SC2", "drawing": "S2.01", "location": "At grid B2", "x": 4.5, "y": 6.0, "size": "400x400mm", "type": "concrete", "height": null}, // EXTRACT actual height
      {"id": "SC3", "drawing": "S2.01", "location": "Grid C3", "x": 9.0, "y": 12.0, "size": "600x400mm", "type": "concrete", "height": null} // EXTRACT actual height
    ],
    "column_coordination_issues": [
      {"rfi_number": "RFI-001", "description": "Column SC1 offset 200mm from architectural intent AC1", "architectural_pos": {"x": 0, "y": 0}, "structural_pos": {"x": 0.2, "y": 0.2}}
    ],
    "walls": [
      {"id": "EW1", "type": "exterior", "material": "concrete", "start": {"x": 0, "y": 0}, "end": {"x": 22.5, "y": 0}, "ceiling_height": null, "thickness": 0.3}, // EXTRACT ceiling height to close with floor above
      {"id": "IW1", "type": "interior", "material": "drywall", "start": {"x": 4.5, "y": 0}, "end": {"x": 4.5, "y": 30}, "ceiling_height": null, "thickness": 0.15}, // EXTRACT ceiling height
      {"id": "CW1", "type": "curb_wall", "material": "concrete", "start": {"x": 0, "y": -5}, "end": {"x": 22.5, "y": -5}, "height": 0.15, "thickness": 0.2}
    ],
    "accessibility_elements": [
      {"type": "ramp", "id": "R1", "location": {"x": 10, "y": 0}, "width": 1.5, "length": 6.0, "slope": "1:12", "handrails": "both sides"},
      {"type": "curb", "id": "C1", "start": {"x": 0, "y": -5}, "end": {"x": 22.5, "y": -5}, "height": 0.15, "type": "barrier"},
      {"type": "stairs", "id": "ST1", "location": {"x": 15, "y": 10}, "width": 1.2, "rises": 16, "run": 0.28, "rise": 0.175}
    ],
    "special_features": [
      {"type": "elevator", "id": "EL1", "location": {"x": 8, "y": 12}, "dimensions": {"x": 2.1, "y": 2.4}},
      {"type": "mechanical_room", "id": "MR1", "boundary": [{"x": 18, "y": 25}, {"x": 22.5, "y": 25}, {"x": 22.5, "y": 30}, {"x": 18, "y": 30}]},
      {"type": "loading_dock", "id": "LD1", "location": {"x": 0, "y": 15}, "dimensions": {"x": 4, "y": 3}}
    ],
    "floor_plates": [
      {"level": "Ground Floor", "elevation": null, "ceiling_height": null, "boundary": [{"x": 0, "y": 0}, {"x": 22.5, "y": 0}, {"x": 22.5, "y": 30}, {"x": 0, "y": 30}]}, // EXTRACT elevation AND ceiling height
      {"level": "Second Floor", "elevation": null, "ceiling_height": null, "boundary": [{"x": 0, "y": 0}, {"x": 22.5, "y": 0}, {"x": 22.5, "y": 30}, {"x": 0, "y": 30}]} // Elevation = previous floor + ceiling + slab
    ],
    "openings": [
      {"type": "door", "id": "D1", "wall": "EW1", "location": {"x": 11.25, "y": 0}, "width": 1.2, "height": null}, // EXTRACT actual door height
      {"type": "window", "id": "W1", "wall": "EW1", "location": {"x": 2.25, "y": 0}, "width": 1.8, "height": null} // EXTRACT actual window height
    ]
  },
{
  "csi_organized_assemblies": {
    "division_01_general": [
      {"item": "01 45 00 - Quality Control Testing", "quantity": "1 LS", "assembly_reference": "general requirements"}
    ],
    "division_03_concrete": [
      {"item": "03 30 00 - Cast-in-Place Concrete", "quantity": "45 m³", "assembly_reference": "foundation from detail F1"}
    ],
    "division_04_masonry": [
      {"item": "04 20 00 - Unit Masonry - Wall Type MW1", "quantity": "125 m²", "assembly_reference": "exterior wall assembly MW1"}
    ],
    "division_05_metals": [
      {"item": "05 12 00 - Structural Steel - Columns", "quantity": "12 EA", "assembly_reference": "column schedule C1"}
    ],
    "division_06_wood": [
      {"item": "06 10 00 - Rough Carpentry - Wall Type IW3D", "quantity": "85 m²", "assembly_reference": "interior framed wall detail"}
    ],
    "division_07_thermal_moisture": [
      {"item": "07 84 00 - Fire Stopping - Wall Type IW3D", "quantity": "45 LM", "assembly_reference": "fire stopping at wall penetrations"}
    ],
    "division_08_openings": [
      {"item": "08 11 00 - Steel Doors - Type D1", "quantity": "8 EA", "assembly_reference": "door schedule"}
    ],
    "division_09_finishes": [
      {"item": "09 29 00 - Gypsum Board - Wall Type IW3D", "quantity": "170 m²", "assembly_reference": "2 sides of wall assembly"}
    ]
  },
  "assembly_cross_references": {
    "wall_type_IW3D": {
      "specification_sections": ["06 10 00 - Wood Framing", "07 84 00 - Fire Stopping", "09 29 00 - Gypsum Board"],
      "detail_reference": "Wall Section A-A",
      "locations_from_drawings": ["Grid A-B, Lines 1-3", "Grid C-D, Lines 2-4"],
      "total_length": "45 LM",
      "components": [
        {"csi": "06 10 00", "description": "2x4 studs @ 400mm o.c.", "quantity": "45 LM"},
        {"csi": "07 84 00", "description": "Fire stopping at penetrations", "quantity": "45 LM"},
        {"csi": "09 29 00", "description": "12.7mm gypsum board both sides", "quantity": "170 m²"}
      ]
    }
  }
}

**📋 CRITICAL REQUIREMENTS FOR BIM GEOMETRY EXTRACTION:**
- **YOU MUST EXTRACT THE ACTUAL BUILDING WITH ALL DETAILED ELEMENTS, NOT A SIMPLIFIED BOX**
- **READ ALL DRAWINGS IN PARALLEL**: Architectural + Structural + Specifications simultaneously
- **COORDINATE BETWEEN DISCIPLINES**: Architect shows intent, Engineer shows design - verify alignment
- Identify ARCHITECTURAL grid lines from architectural drawings (A-series: A1.01, A2.01, etc.)
- Identify STRUCTURAL grid lines from structural drawings (S-series: S1.01, S2.01, etc.)
- **COLUMN VERIFICATION**: Extract columns from BOTH architectural AND structural drawings
  - Architect shows WHERE they want columns (design intent)
  - Engineer shows WHERE columns actually are (structural design)
  - Flag any misalignment as RFI (Request for Information)
- Map the REAL building perimeter from ARCHITECTURAL floor plans (may be L-shaped, U-shaped, irregular)
- **SPECIFICATION INTEGRATION**: Every element must be verified against specs for materials and requirements
- Identify ALL SPECIAL WALLS: curb walls, retaining walls, parapet walls by their representation
- Extract ALL ACCESSIBILITY FEATURES: ramps (with slopes), curbs, stairs, elevators as shown in drawings
- CROSS-REFERENCE all elements with specifications for materials, finishes, and performance requirements
- Find SITE ELEMENTS: loading docks, canopies, grade changes, landscaping walls
- Document mechanical rooms, electrical rooms, shafts, and service areas
- Trace ALL walls from ARCHITECTURAL drawings with actual paths, corners, and connections
- Extract TRUE floor plate boundaries from ARCHITECTURAL plans that match the building's actual shape
- Document EVERY door and window opening from ARCHITECTURAL drawings with precise locations
- Your output MUST enable accurate 3D BIM model reconstruction
- Follow ALL 6 steps in EXACT sequence
- Cross-reference specifications with drawings and details
- Organize ALL items by proper CSI divisions (01-48)
- Calculate quantities based on actual measurements from drawings

**🚨 MANDATORY CROSS-REFERENCING:**
- Specifications tell you WHAT products to use
- Drawings tell you WHERE and HOW MUCH
- Details tell you HOW it's assembled
- YOU MUST connect all three for proper estimation

Document: ${path.basename(filePath)}`;

      // ── v15.3 FIX: Send actual PDF bytes to Claude so it can see the drawings ──
      // pdfBuffer was previously loaded but discarded; the API call sent only the
      // analysisPrompt text string. Claude was asked to extract coordinates from a
      // filename with no visual content. Now the PDF is attached as a native document
      // source so Claude can read the actual floor plans, sections, and elevations.
      const pdfBase64 = pdfBuffer.toString('base64');
      const userContent: any[] = [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: pdfBase64,
          },
        },
        {
          type: "text",
          text: analysisPrompt,
        },
      ];

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        messages: [
          {
            role: "user",
            content: userContent,
          }
        ],
      });

      let aiAnalysis = response.content[0].type === 'text' ? response.content[0].text : '';
      logger.debug('Raw AI response:', { preview: aiAnalysis.substring(0, 500) });
      
      // 🎯 PARSE JSON RESPONSE from Claude
      let parsedAnalysis;
      try {
        // Extract JSON from Claude's response (remove markdown if present)
        const jsonMatch = aiAnalysis.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch) {
          parsedAnalysis = JSON.parse(jsonMatch[1]);
          logger.debug('Successfully parsed Claude JSON response', { analysis: parsedAnalysis });
        } else {
          parsedAnalysis = parseFirstJsonObject(aiAnalysis);
          if (parsedAnalysis && !parsedAnalysis.error) {
            logger.debug('Successfully parsed Claude JSON response via parseFirstJsonObject');
          } else {
            logger.warn('No JSON found in Claude response, using text analysis');
            parsedAnalysis = aiAnalysis;
          }
        }
      } catch (parseError) {
        logger.warn('JSON parsing failed, using text analysis', { error: parseError });
        parsedAnalysis = aiAnalysis;
      }
      
      // Parse AI response and generate elements with extracted coordinates
      return await this.generateElementsFromAIAnalysis(parsedAnalysis, options);
      
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
    
    // Parse Claude's CSI-organized assembly response
    const analysisData = typeof aiAnalysis === 'string' ? 
      this.parseClaudeResponse(aiAnalysis) : aiAnalysis;
    
    logger.info('Processing CSI assemblies from Claude analysis...');
    
    // Check if we have the new CSI-organized format
    if (analysisData?.csi_organized_assemblies) {
      logger.debug('Found CSI-organized assemblies in Claude response');
      elements = this.processCSIAssemblies(analysisData.csi_organized_assemblies, storeys, buildingAnalysis);
      
      // Also process assembly cross-references for detailed components
      if (analysisData?.assembly_cross_references) {
        logger.debug('Processing assembly cross-references');
        elements = elements.concat(this.processAssemblyCrossReferences(analysisData.assembly_cross_references, storeys, buildingAnalysis));
      }
    } else {
      logger.warn('No CSI assemblies found, falling back to text extraction');
      // Fallback to text-based extraction for backwards compatibility
      elements = this.extractElementsFromText(aiAnalysis, storeys);
    }
    
    logger.info(`Generated ${elements.length} assembly-based elements from Claude analysis`);
    
    // 📐 Validate geometry after extraction
    const validatedElements = this.validateWithGridSystem(elements, analysisData, []);

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
      throw new Error('❌ INVALID STOREY COUNT: Cannot calculate element index without valid storey counts from construction documents!');
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
      throw new Error('❌ MISSING CSI CODE: Cannot generate CSI division without valid CSI code.\n🔍 Claude MUST extract CSI codes from construction specifications - no defaults allowed!');
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
      // Bug-D fix: no size → register RFI, continue with RFI-placeholder dimensions
      try { const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({ category: 'drawing', csiDivision: '03 00 00', impact: 'medium',
          description: `Column '${colData.id || 'UNKNOWN'}' on storey '${storey.name}' has no size data. Required: structural schedule or plan with column dimensions.`,
          drawingRef: `Structural plan/schedule — Column ${colData.id || 'UNKNOWN'}`,
          costImpactLow: 0, costImpactHigh: 0, assumptionUsed: 'column_size_rfi_placeholder',
          discoveredBy: 'createColumnElement' }); } catch { /* non-fatal */ }
    }

    // ─── Parse column size defensively ───────────────────────────────────────
    // Handles: "400x400" (concrete), "W12x26" (steel wide-flange), "400" (square)
    // ─────────────────────────────────────────────────────────────────────────
    let width: number;
    let depth: number;
    const sizeStr = String(size).trim();

    if (/^W\d+x\d+/i.test(sizeStr)) {
      // Steel wide-flange: W12x26 → depth=12in≈305mm, flange width lookup not needed for volume
      const parts = sizeStr.replace(/^W/i, '').split('x');
      const nomDepthIn = parseFloat(parts[0]);
      const nomWidthIn = parseFloat(parts[1] || parts[0]);
      // Convert nominal inch designation to approximate mm (standard steel tables)
      width = (nomWidthIn * 25.4) / 1000;
      depth = (nomDepthIn * 25.4) / 1000;
    } else if (sizeStr.toLowerCase().includes('x')) {
      // Standard rectangular: "400x600" or "300x300"
      const parts = sizeStr.toLowerCase().split('x').map((s: string) => parseFloat(s));
      width = (isNaN(parts[0]) ? 400 : parts[0]) / 1000;
      depth = (isNaN(parts[1]) ? parts[0] : parts[1]) / 1000;
    } else {
      // Single value — assume square: "400" → 400x400
      const dim = parseFloat(sizeStr);
      if (isNaN(dim)) {
        throw new Error(`❌ UNPARSEABLE COLUMN SIZE: '${size}' — expected format: "400x400", "W12x26", or "400".`);
      }
      width = dim / 1000;
      depth = dim / 1000;
    }

    if (width <= 0 || depth <= 0) {
      throw new Error(`❌ INVALID COLUMN SIZE: '${size}' produced zero or negative dimensions.`);
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
      try { const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({ category: 'drawing', csiDivision: '08 00 00', impact: 'high',
          description: `Door '${doorData.id || 'UNKNOWN'}' on storey '${storey.name}' has no x/y coordinates. Door excluded.`,
          drawingRef: `Floor plan — Door ${doorData.id || 'UNKNOWN'}`, costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: 'door_excluded_no_coordinates', discoveredBy: 'createDoorElement' }); } catch { /* non-fatal */ }
      return null;
    }
    const x = doorData.x;
    const y = doorData.y ?? 0;  // Bug-D: x/y null already checked above, doorY fallback

    // Width and height must exist — minimum needed to show an opening
    if (!doorData.width || !doorData.height) return null;
    // Normalise door dimensions — Claude returns mm by convention but handles any unit
    const width  = toMetres(doorData.width,  'dimension') ?? (doorData.width  / 1000);
    const height = toMetres(doorData.height, 'dimension') ?? (doorData.height / 1000);

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

      // 0.05 m used ONLY for 3-D display geometry — never flows into quantities
      thicknessM      = 0.05;
      thicknessSource = 'rfi_placeholder';
      isRfiFlagged    = true;
      attentionParts.push('door thickness not found in schedule or wall assembly');
    }
    // ─────────────────────────────────────────────────────────────────────────

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
        thickness_source: thicknessSource,
        // ── RFI / attention flags ──
        rfi_flag:         isRfiFlagged,
        needs_attention:  isRfiFlagged,
        attention_reason: isRfiFlagged ? attentionParts.join('; ') : null,
        // Placeholder doors excluded from costed BOQ
        exclude_from_boq: isRfiFlagged,
        analysis_source:  'ai_extracted',
      },
      geometry: {
        location: { realLocation: { x, y, z: storey.elevation } },
        dimensions: {
          length: width,
          width:  thicknessM,
          height,
          area:   width * height,
          // Volume zeroed for placeholder — not billable until RFI resolved
          volume: isRfiFlagged ? 0 : width * thicknessM * height,
        },
      },
      quantities: {
        // Placeholder: count is 1 so the opening appears in the element list
        // but the BOQ service must skip elements where exclude_from_boq = true
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
      try { const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({ category: 'drawing', csiDivision: '08 00 00', impact: 'medium',
          description: `Window '${winData.id || 'UNKNOWN'}' on storey '${storey.name}' has no x/y coordinates. Window excluded.`,
          drawingRef: `Floor plan — Window ${winData.id || 'UNKNOWN'}`, costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: 'window_excluded_no_coordinates', discoveredBy: 'createWindowElement' }); } catch { /* non-fatal */ }
      return null;
    }
    const x = winData.x;
    const y = winData.y ?? 0;  // Bug-D: x/y null already checked above, winY fallback

    if (!winData.width || !winData.height) return null;
    // Normalise window dimensions
    const width  = toMetres(winData.width,  'dimension') ?? (winData.width  / 1000);
    const height = toMetres(winData.height, 'dimension') ?? (winData.height / 1000);

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
        const { registerMissingData } = require('./estimator/rfi-generator');
        registerMissingData({
          category: 'specification',
          description: `Window '${winData.id || 'UNKNOWN'}' on storey '${storey.name}' has no frame depth. ` +
            `Required: window schedule column "Depth" or wall assembly detail. ` +
            `Window shown as flagged placeholder — verify frame depth from Division 08 specifications.`,
          csiDivision: '08 50 00', impact: 'low',
          drawingRef: `Window schedule / wall assembly — Window ${winData.id || 'UNKNOWN'}`,
          costImpactLow: 0, costImpactHigh: 0,
          assumptionUsed: 'frame_depth=0.1m',
          discoveredBy: 'createWindowElement',
        });
      } catch { /* non-fatal */ }
      frameDepth = 0.1; // Minimal placeholder to keep element visible
      depthSource = 'estimated_placeholder';
      depthRfi = true;
    }

    const isRfiFlagged = sillRfi || depthRfi;
    const attentionParts: string[] = [];
    if (sillRfi)  attentionParts.push('sill height not found in drawings');
    if (depthRfi) attentionParts.push('frame depth not found in window schedule');

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
        sill_height_source: sillSource,
        depth_source: depthSource,
        rfi_flag: isRfiFlagged,
        needs_attention: isRfiFlagged,
        attention_reason: isRfiFlagged ? attentionParts.join('; ') : null,
        analysis_source: 'ai_extracted',
      },
      geometry: {
        location: { realLocation: { x, y, z: storey.elevation + sillHeight } },
        dimensions: {
          length: width,
          width: frameDepth,
          height,
          area: width * height,
          volume: width * frameDepth * height,
        },
      },
      quantities: {
        metric:   [{ type: 'area', value: width * height, unit: 'm²', name: 'Window Area', source: 'ai_extracted' }],
        imperial: [{ type: 'area', value: width * height * 10.764, unit: 'ft²', name: 'Window Area', source: 'ai_extracted' }],
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
      const storeyName = el.storey?.name || 'Ground';
      if (!storeyMap.has(storeyName)) {
        storeyMap.set(storeyName, {
          name: storeyName,
          elevation: el.storey?.elevation ?? (() => {
            throw new Error(`❌ MISSING STOREY ELEVATION: Element '${el.id || 'UNKNOWN'}' on storey '${el.storey?.name || 'UNKNOWN'}' must have elevation from sections/elevations. Claude must extract actual heights!`);
          })(),
          guid: randomUUID(),
          elementCount: 0
        });
      }
      storeyMap.get(storeyName)!.elementCount++;
    });
    
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
      origin: analysisData?.coordinate_system?.origin || analysisData?.origin || (() => {
        throw new Error('❌ MISSING COORDINATE SYSTEM ORIGIN: Claude must extract the building coordinate system origin from construction documents!\n🔍 Check drawing legends, survey points, or grid reference marks for the project datum.');
      })()
    };
    
    // Try to get perimeter from building_perimeter or building_analysis
    if (analysisData.building_perimeter && Array.isArray(analysisData.building_perimeter)) {
      // Convert from {x, y} to {x, z} format for positioning system
      analysis.perimeter = analysisData.building_perimeter.map((pt: any, index: number) => {
        if (pt.x === undefined || pt.x === null) {
          throw new Error(`❌ MISSING PERIMETER COORDINATES: Point ${index + 1} of building perimeter is missing x coordinate. Claude must extract actual building outline from floor plans!`);
        }
        if (!pt.y && !pt.z) {
          throw new Error(`❌ MISSING PERIMETER COORDINATES: Point ${index + 1} of building perimeter is missing y/z coordinate. Claude must extract actual building outline from floor plans!`);
        }
        return {
          x: Number(pt.x),
          z: Number(pt.y ?? pt.z) // Convert y to z for 3D space
        };
      });
      logger.info(`Extracted building perimeter with ${analysis.perimeter.length} points from Claude analysis`);
    } else if (analysisData.building_analysis?.building_perimeter) {
      analysis.perimeter = analysisData.building_analysis.building_perimeter.map((pt: any, index: number) => {
        if (pt.x === undefined || pt.x === null) {
          throw new Error(`❌ MISSING PERIMETER COORDINATES: Point ${index + 1} of building perimeter (from building_analysis) is missing x coordinate. Claude must extract actual building outline from floor plans!`);
        }
        if (!pt.y && !pt.z) {
          throw new Error(`❌ MISSING PERIMETER COORDINATES: Point ${index + 1} of building perimeter (from building_analysis) is missing y/z coordinate. Claude must extract actual building outline from floor plans!`);
        }
        return {
          x: Number(pt.x),
          z: Number(pt.y ?? pt.z)
        };
      });
      logger.info(`Extracted building perimeter from building_analysis section`);
    }
    
    // Extract dimensions if available
    if (analysisData.building_analysis?.dimensions) {
      const dims = analysisData.building_analysis.dimensions;
      if (!dims.width || dims.width === 0) {
        throw new Error(`❌ MISSING BUILDING WIDTH: Claude must extract actual building width from floor plans or site plans. Cannot proceed with 0 or missing width!`);
      }
      if (!dims.length || dims.length === 0) {
        throw new Error(`❌ MISSING BUILDING LENGTH: Claude must extract actual building length from floor plans or site plans. Cannot proceed with 0 or missing length!`);
      }
      analysis.dimensions = {
        width: Number(dims.width),
        length: Number(dims.length)
      };
      logger.info(`Extracted building dimensions: ${analysis.dimensions.width}m x ${analysis.dimensions.length}m`);
    }
    
    // Try to extract from floor_plates if no perimeter found
    if (!analysis.perimeter && analysisData.floor_plates && Array.isArray(analysisData.floor_plates)) {
      const firstFloor = analysisData.floor_plates[0];
      if (firstFloor?.boundary && Array.isArray(firstFloor.boundary)) {
        analysis.perimeter = firstFloor.boundary.map((pt: any, index: number) => {
          if (pt.x === undefined || pt.x === null) {
            throw new Error(`❌ MISSING FLOOR BOUNDARY COORDINATES: Point ${index + 1} of floor plate boundary is missing x coordinate. Claude must extract actual floor boundary from floor plans!`);
          }
          if (!pt.y && !pt.z) {
            throw new Error(`❌ MISSING FLOOR BOUNDARY COORDINATES: Point ${index + 1} of floor plate boundary is missing y/z coordinate. Claude must extract actual floor boundary from floor plans!`);
          }
          return {
            x: Number(pt.x),
            z: Number(pt.y ?? pt.z)
          };
        });
        logger.info(`Extracted building perimeter from floor_plates boundary`);
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
    facts.location_wind_speed_mph = buildingSpecs.location_wind_speed || (() => {
      throw new Error('❌ MISSING LOCATION WIND SPEED: Claude must extract actual wind speed requirements from structural specifications or local building codes!\n🔍 Check structural general notes and design criteria for wind loads.');
    })();
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
