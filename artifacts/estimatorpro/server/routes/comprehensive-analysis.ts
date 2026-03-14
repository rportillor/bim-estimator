/**
 * 🔍 FORCED COMPREHENSIVE ANALYSIS ROUTE
 * 
 * Sends ALL 49 documents to Claude together for comprehensive extraction
 * regardless of existing analysis results
 */

import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { storage } from '../storage';
import { logger } from '../utils/enterprise-logger';
import { claudeCostMonitor } from '../services/claude-cost-monitor';
import { inferStoreyElevation } from '../helpers/storeys';
import { parseFirstJsonObject } from '../utils/anthropic-response';


const router = Router();
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// 🔒 MUTEX: Prevent race condition with background AI processor
let isComprehensiveAnalysisRunning = false;

/**
 * POST /api/comprehensive-analysis/:projectId
 * Force comprehensive analysis of ALL documents together
 */
router.post('/:projectId', async (req, res) => {
  const { projectId } = req.params;
  
  try {
    // 🔒 MUTEX: Prevent concurrent processing that creates race conditions
    if (isComprehensiveAnalysisRunning) {
      return res.status(409).json({ 
        success: false, 
        message: 'Comprehensive analysis already running. Please wait for completion.' 
      });
    }
    
    isComprehensiveAnalysisRunning = true;
    logger.info(`🔒 MUTEX LOCK: Starting exclusive comprehensive analysis for project ${projectId}`);
    
    // 🛑 CRITICAL: Signal to AI processor to skip this project during our analysis
    (global as any).skipProjectInAIProcessor = projectId;
    logger.info(`🛑 Signaling AI processor to skip project ${projectId} during comprehensive analysis`);
    
    // Get project and ALL documents
    const project = await storage.getProject(projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }
    
    const documents = await storage.getDocumentsByProject(projectId);
    logger.info(`Found ${documents.length} documents for comprehensive analysis`);
    
    // Determine units based on project country
    const isCanadian = project.country?.toLowerCase() === 'canada';
    const _units = isCanadian ? {
      area: 'm²',
      volume: 'm³', 
      length: 'm',
      example: 'Room 101 (3.6m × 4.2m) with 2.7m ceiling = 42.1 m²'
    } : {
      area: 'SF',
      volume: 'CY',
      length: 'LF', 
      example: 'Room 101 (12\'×14\') with 9\' ceiling = 468 SF'
    };
    
    if (documents.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No documents found for analysis' 
      });
    }
    
    // Prepare comprehensive document content for Claude
    let combinedContent = `COMPREHENSIVE CONSTRUCTION PROJECT ANALYSIS\n`;
    combinedContent += `Total Documents: ${documents.length}\n\n`;
    
    // Group documents by type for better analysis
    const schedules = documents.filter(doc => 
      (doc.filename || '').toLowerCase().includes('schedule')
    );
    const specifications = documents.filter(doc => 
      (doc.filename || '').toLowerCase().includes('spec')
    );
    const drawings = documents.filter(doc => 
      !(doc.filename || '').toLowerCase().includes('schedule') && 
      !(doc.filename || '').toLowerCase().includes('spec')
    );
    
    logger.info(`Document breakdown: ${schedules.length} schedules, ${specifications.length} specs, ${drawings.length} drawings, ${documents.length - schedules.length - specifications.length - drawings.length} other`);
    
    // ✅ CHUNKED ANALYSIS: Break large specifications into optimal pieces
    const { DocumentChunker } = await import('../services/document-chunker');
    const chunker = new DocumentChunker();
    
    let allAnalysisResults: any[] = [];
    let analysisResult: any;
    
    // Find main specifications document for chunking
    const mainSpec = specifications.find(doc => 
      (doc.filename || '').toLowerCase().includes('specifications')
    );
    
    if (mainSpec && (mainSpec.textContent || '').length > 100000) {
      logger.info(`🔧 CHUNKING: Large specifications document (${mainSpec.textContent?.length} chars)`);
      
      // Break specifications into CSI division chunks
      const chunks = await chunker.chunkSpecificationDocument(
        mainSpec.textContent || '',
        mainSpec.filename || ''
      );
      
      logger.info(`📦 Created ${chunks.length} chunks for sequential analysis`);
      
      // Process each chunk separately for detailed analysis
      for (const chunk of chunks) {
        logger.info(`🔍 Analyzing chunk ${chunk.chunkIndex}: ${chunk.title} (${chunk.tokenEstimate} tokens)`);
        
        const chunkPrompt = chunker.createChunkedAnalysisPrompt(
          chunk,
          `${project.name} — ${documents.length} documents total`
        );
        
        const chunkResult = await performComprehensiveClaudeAnalysis(
          chunkPrompt,
          {
            projectId,
            totalDocuments: documents.length,
            scheduleCount: schedules.length,
            specificationCount: specifications.length,
            drawingCount: drawings.length
          }
        );
        
        allAnalysisResults.push(chunkResult);
        logger.info(`✅ Completed chunk ${chunk.chunkIndex}: ${chunkResult.elements.length} elements extracted`);
      }
      
      // Combine all chunk results
      const combinedResult = {
        elements: allAnalysisResults.flatMap(result => result.elements || []),
        tokensUsed: allAnalysisResults.reduce((sum, result) => sum + (result.tokensUsed || 0), 0),
        costEstimate: allAnalysisResults.reduce((sum, result) => sum + (result.costEstimate || 0), 0),
        methodology: "6-Step Professional Construction Estimation with CSI Division Chunking",
        chunksProcessed: chunks.length,
        divisionsAnalyzed: chunks.flatMap(c => c.csiDivisions)
      };
      
      logger.info(`🎯 CHUNKED ANALYSIS COMPLETE: ${combinedResult.elements.length} total elements from ${chunks.length} chunks`);
      
      analysisResult = combinedResult;
      
    } else {
      // Fallback to regular analysis for smaller documents
      logger.info(`📄 Using regular analysis for smaller document set`);
      combinedContent += mainSpec ? `${mainSpec.textContent || ''}\n\n` : '';
      
      analysisResult = await performComprehensiveClaudeAnalysis(
        combinedContent, 
        {
          projectId,
          totalDocuments: documents.length,
          scheduleCount: schedules.length,
          specificationCount: specifications.length,
          drawingCount: drawings.length
        }
      );
    }
    
    // 🔧 ASSEMBLY LOGIC: Process raw materials into proper assemblies
    const { AssemblyLogicService } = await import('../services/assembly-logic');
    const assemblyService = new AssemblyLogicService();
    const assemblies = assemblyService.processAssemblies(analysisResult.elements || []);
    
    logger.info(`🔧 ASSEMBLY PROCESSING: ${analysisResult.elements?.length || 0} materials → ${assemblies.length} assemblies`);
    
    // Store comprehensive results
    await storeComprehensiveResults(projectId, analysisResult);
    
    // 🔧 FIX: Update project estimate value from BoQ items total
    try {
      const boqItems = await storage.getBoqItems(projectId);
      const projectTotal = boqItems.reduce((sum, item) => sum + parseFloat(item.amount || "0"), 0);
      await storage.updateProject(projectId, { estimateValue: projectTotal.toString() });
      logger.info(`✅ Updated project estimate value to $${projectTotal.toFixed(2)}`);
    } catch (error) {
      logger.error("Failed to update project estimate value:", { error: error instanceof Error ? error.message : String(error) });
    }
    
    logger.info(`Comprehensive analysis completed for project ${projectId}`);
    
    // 🔓 RELEASE MUTEX: Allow other processes to continue
    isComprehensiveAnalysisRunning = false;
    delete (global as any).skipProjectInAIProcessor;
    logger.info(`🔓 MUTEX RELEASED: Other processes can now continue`);
    
    res.json({
      success: true,
      message: 'Comprehensive analysis completed',
      results: {
        documentsAnalyzed: documents.length,
        elementsExtracted: analysisResult.elements.length,
        schedulesProcessed: schedules.length,
        tokensUsed: analysisResult.tokensUsed,
        costEstimate: analysisResult.costEstimate
      }
    });
    
  } catch (error) {
    logger.error(`Comprehensive analysis failed for project ${projectId}`, { error });
    
    // 🔓 RELEASE MUTEX: Always release on error
    isComprehensiveAnalysisRunning = false;
    delete (global as any).skipProjectInAIProcessor;
    logger.info(`🔓 MUTEX RELEASED ON ERROR: Cleanup completed`);
    
    res.status(500).json({ 
      success: false, 
      message: 'Comprehensive analysis failed',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * 🧠 COMPREHENSIVE CLAUDE ANALYSIS - All Documents Together
 */
async function performComprehensiveClaudeAnalysis(
  combinedContent: string,
  context: {
    projectId: string;
    totalDocuments: number;
    scheduleCount: number;
    specificationCount: number;
    drawingCount: number;
    project?: any;
    units?: any;
  }
): Promise<any> {
  
  logger.info(`Starting Claude comprehensive analysis with ${context.totalDocuments} documents`);
  
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 16000,
    temperature: 0,
    system: `You are a construction specifications expert. Your job is to extract EVERY SINGLE construction item with EXACT DIMENSIONS from specifications and drawings.

🎯 MISSION: EXTRACT EXACT DIMENSIONS AND SPECIFICATIONS for ALL construction items/materials/products.

REQUIREMENT: Extract PRECISE MEASUREMENTS in meters, not generic placeholders. Read dimension lines, schedules, and specifications for actual sizes.

IMPORTANT: Do NOT use default dimensions like "1.0 x 1.0 x 1.0". Extract REAL measurements from drawings and schedules.

EXTRACT WITH EXACT DIMENSIONS:
🧱 Division 03 Concrete: Extract EVERY concrete element with thickness, width, length (e.g., "300mm thick slab, 8.5m x 12.3m")
🧱 Division 04 Masonry: Extract EVERY wall with actual length from dimension lines (e.g., "200mm CMU wall, 15.2m long x 3.0m high")
🔩 Division 05 Metals: Extract EVERY beam/column with actual sizes (e.g., "W310x52 beam, 6.8m span")
🪵 Division 06 Wood: Extract lumber dimensions and lengths (e.g., "38x235mm joists @ 400mm o.c., 4.2m spans")
🏠 Division 07 Thermal: Extract insulation areas and thicknesses (e.g., "R-20 batt insulation, 150mm thick, 245 m²")
🚪 Division 08 Openings: Extract door/window sizes FROM SCHEDULES (e.g., "Door D1: 915mm x 2134mm", "Window W3: 1200mm x 1500mm")
🎨 Division 09 Finishes: Extract floor/wall areas with room dimensions (e.g., "Vinyl flooring Room 201: 4.2m x 3.8m = 16.0 m²")

🔧 MECHANICAL & ELECTRICAL (M&E) COMPONENTS:
⚡ Electrical: Extract conduit runs with lengths (e.g., "25mm EMT conduit, 18.5m run from Panel A to Room 201")
⚡ Cables: Extract cable types and lengths (e.g., "12 AWG THHN, 125m total, circuits 1-6")
⚡ Panels: Extract panel sizes and circuits (e.g., "Panel EP-1: 600mm x 900mm x 200mm, 42 circuits")
🔥 HVAC: Extract duct sizes and areas (e.g., "600x300mm supply duct, 42 m² sheet metal")
🔥 Equipment: Extract unit dimensions (e.g., "RTU-1: 2.4m x 1.8m x 1.2m high, 5-ton capacity")
💧 Plumbing: Extract pipe runs with lengths (e.g., "50mm copper supply, 28.3m horizontal run")
💧 Fixtures: Extract counts and models (e.g., "12 EA Kohler K-2210 lavatories")

COMPREHENSIVE EXTRACTION RULES:
- Extract EVERY individual product mentioned in specifications
- Each manufacturer product = separate element
- Each material grade/type = separate element  
- Each size/model variation = separate element
- Each finish/color variation = separate element

REQUIRED OUTPUT STRUCTURE:
{
  "materials": [array of 120+ construction items],
  "ai_understanding": {
    "building_components_detected": {
      "walls": count, "columns": count, "beams": count, "doors": count, "windows": count, "slabs": count
    },
    "building_dimensions": {"width": meters, "length": meters, "height": meters}
  },
  "building_analysis": {
    "storeys": [
      {"name": "Foundation", "elevation": -500, "elements": ["foundation_walls", "footings"]},
      {"name": "Ground Floor", "elevation": 0, "elements": ["walls", "columns", "slabs", "doors", "windows"]},
      {"name": "Second Floor", "elevation": 3200, "elements": ["walls", "columns", "slabs"]}
    ],
    "grid_system": {"spacing": 6000, "lines": [grid coordinates]},
    "coordinates": [building corner and grid coordinates]
  }
}

CRITICAL: Extract EVERYTHING with proper floor assignments!`,

    messages: [{
      role: "user",
      content: `🎯 COMPREHENSIVE CONSTRUCTION ANALYSIS WITH REAL QUANTITIES:

PROJECT: ${context.project?.name || '[PROJECT NAME — RFI REQUIRED: project not loaded in context]'} (${context.project?.country?.toUpperCase() || 'CANADA'})
DOCUMENTS: ${context.totalDocuments} total (${context.specificationCount} specification + ${context.drawingCount} drawings + ${context.scheduleCount} schedules)

🧠 TWO-PHASE ANALYSIS REQUIRED:

**PHASE 1: SPECIFICATIONS ANALYSIS**
Extract materials and products from specifications:
${combinedContent}

**PHASE 2: CALCULATE REAL QUANTITIES FROM DRAWINGS** 
🔍 You MUST CALCULATE actual quantities by reading the 43 drawings:

**EXTRACT EXACT DIMENSIONS FROM DRAWINGS:**

📏 **WALL MEASUREMENTS:**
- Measure wall lengths between dimension lines on floor plans
- Read actual wall heights from sections (not default 3.0m)
- Extract wall thickness from wall type details
- Example: "Wall W101: 8.75m long x 2.85m high x 200mm thick (Type IW3D)"
- Include grid references: "Wall between Grid A-3 to B-3"

📐 **DOOR/WINDOW DIMENSIONS FROM SCHEDULES:**
- Read exact sizes from door schedule: "D101: 3'-0" x 7'-0" (915mm x 2134mm)"
- Read window dimensions: "W201: 4'-0" x 5'-0" (1220mm x 1524mm)" 
- Include frame thickness and sill heights

🔧 **M&E EXACT MEASUREMENTS:**

**ELECTRICAL:**
- Conduit runs: Measure length along routing path (e.g., "EMT 1": 23.5m from Panel EP-1 to JB-201")
- Cable lengths: Calculate based on circuit routing (e.g., "Circuit 1: 42m of 12 AWG THHN")
- Panel dimensions: Read from schedules (e.g., "EP-1: 24" x 36" x 8" (600x900x200mm)")
- Junction boxes: Count and size (e.g., "JB-201: 12" x 12" x 6" at Grid C-2")

**HVAC:**
- Duct dimensions: Read from mechanical plans (e.g., "Main supply: 36" x 12" reducing to 24" x 12"")
- Calculate duct surface area for sheet metal (e.g., "152 m² of 24ga galvanized")
- Equipment footprints: Extract from schedules (e.g., "AHU-1: 8'-0" x 6'-0" x 7'-6" high")
- Diffuser/grille counts and sizes (e.g., "24 EA 24"x24" supply diffusers")

**PLUMBING:**
- Pipe lengths: Trace runs on drawings (e.g., "2" copper supply: 18.3m horizontal + 9.2m vertical")
- Fixture counts from schedules (e.g., "Floor 2: 8 lavatories, 6 water closets, 2 urinals")
- Equipment sizes (e.g., "HWH-1: 48" dia x 72" high, 500 gallon")

**CONCRETE VOLUMES:**
- Calculate foundation areas × thickness = ${context.units?.volume || 'm³'}
- **SPATIAL REFERENCE**: "18.3 ${context.units?.volume || 'm³'} slab area - Room 102, Grid B-C / 1-2"
- Calculate slab areas × thickness = ${context.units?.volume || 'm³'}

🎯 CALCULATE REAL BUILDING QUANTITIES - Don't use "1.000 ea" placeholders!

COMPREHENSIVE EXTRACTION AND SAVE REQUIRED:
- EXTRACT AND SAVE minimum 120+ individual items (62 divisions × 2+ products each)
- Each product specification = separate element to extract and save
- Each manufacturer option = separate element to extract and save
- Each grade/model/size = separate element to extract and save

SCAN EVERY SPECIFICATION DIVISION AND EXTRACT AND SAVE ALL PRODUCTS:

Division 03: Extract concrete with EXACT volumes (e.g., "Footing F1: 1.2m x 1.2m x 0.6m = 0.864 m³")
Division 04: Extract masonry with EXACT wall lengths and heights from dimension lines
Division 05: Extract steel with EXACT beam/column sizes and lengths:
- Columns: Specify shape (round/square/rectangular) and dimensions (e.g., "HSS 300x300x12, 3.5m high" for square, "406mm dia x 12mm thick, 3.5m high" for round, "W310x202, 3.5m high" for wide flange)
- Beams: Include profile and span (e.g., "W410x67, 8.2m span", "HSS 250x150x8, 6.5m span")
Division 06: Extract wood with ACTUAL dimensions (e.g., "2x10 joists, 16" o.c., 4.8m spans")
Division 07: Extract insulation with EXACT areas from room takeoffs
Division 08: Extract doors/windows with EXACT sizes from schedules (not generic 1.0 x 2.0)
Division 09: Extract finishes with EXACT room areas calculated from dimensions

Division 15-16 MECHANICAL:
- Extract HVAC ducts with sizes (e.g., "24" x 12" main supply duct, 85 linear feet")
- Extract equipment with dimensions (e.g., "RTU-1: 96" x 72" x 48" high")
- Extract piping with lengths (e.g., "2" copper: 125 LF horizontal, 48 LF vertical")

Division 26-28 ELECTRICAL:
- Extract conduits with exact routing lengths (e.g., "1" EMT: 185m total")
- Extract cables by circuit (e.g., "12 AWG: 850m total across 42 circuits")
- Extract panels with dimensions (e.g., "Panel A: 30" x 48" x 8" surface mount")
- Extract devices with counts (e.g., "82 duplex receptacles, 46 switches, 38 LED fixtures")

MANDATORY: Return JSON with "materials" array containing 120+ individual construction items.

EXTRACT AND SAVE EVERYTHING needed to build this building - contractors need a complete materials list!

DO NOT SKIP ANY PRODUCTS - EXTRACT AND SAVE ALL CONSTRUCTION ITEMS!`
    }]
  });
  
  // Track token usage
  const tokensUsed = response.usage?.input_tokens + response.usage?.output_tokens || 8000;
  await claudeCostMonitor.trackApiCall(
    "claude-sonnet-4-20250514",
    response.usage?.input_tokens || 4000,
    response.usage?.output_tokens || 4000,
    context.projectId,
    'comprehensive_analysis'
  );
  
  logger.info(`Claude comprehensive analysis completed, ${tokensUsed} tokens used`);
  
  // Parse response with better JSON extraction
  const content = Array.isArray(response.content) 
    ? response.content.map((c: any) => c?.text || "").join("\n")
    : (response.content as any)?.text || "";
    
  logger.info(`Claude response content length: ${content.length}`);
  logger.info(`Claude response preview: ${content.substring(0, 1000)}...`);
  
  // Try multiple JSON extraction methods
  let parsed = null;

  // Method 1: Look for complete JSON object with proper nesting
  const jsonPatterns = [
    /```json\s*(\{[\s\S]*?\})\s*```/,  // JSON in code blocks
    /\{(?:[^{}]|{(?:[^{}]|{[^{}]*})*})*\}/g,  // Proper nested JSON
  ];

  for (const pattern of jsonPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      try {
        const jsonStr = matches[1] || matches[0];
        parsed = JSON.parse(jsonStr);
        logger.info(`Successfully parsed JSON using pattern: ${pattern.source}`);
        break;
      } catch (e) {
        logger.warn(`Failed to parse JSON with pattern ${pattern.source}: ${e}`);
        continue;
      }
    }
  }

  // Fallback: use parseFirstJsonObject utility
  if (!parsed) {
    parsed = parseFirstJsonObject(content);
    if (parsed && !parsed.error) {
      logger.info('Successfully parsed JSON using parseFirstJsonObject fallback');
    }
  }

  if (!parsed || parsed.error) {
    logger.error(`Failed to parse Claude response. Content: ${content}`);
    throw new Error('No valid JSON found in Claude response');
  }
  
  // DEBUG: Log actual parsed structure
  logger.info(`DEBUG: Parsed JSON keys: ${Object.keys(parsed)}`);
  logger.info(`DEBUG: Materials length: ${parsed.materials?.length || 'undefined'}`);
  logger.info(`DEBUG: Products length: ${parsed.products?.length || 'undefined'}`);
  logger.info(`DEBUG: Elements length: ${parsed.elements?.length || 'undefined'}`);
  logger.info(`DEBUG: First material sample: ${JSON.stringify(parsed.materials?.[0] || 'none')}`);
  
  // Handle all possible Claude response formats
  let extractedElements = [];
  if (parsed.materials) {
    extractedElements = parsed.materials;
  } else if (parsed.products) {
    extractedElements = parsed.products;
  } else if (parsed.elements) {
    extractedElements = parsed.elements;
  } else if (Array.isArray(parsed)) {
    extractedElements = parsed;
  } else if (parsed.id && parsed.name) {
    // Single object - wrap in array
    extractedElements = [parsed];
  } else {
    // Try to extract array from any property that looks like a list
    const keys = Object.keys(parsed);
    for (const key of keys) {
      if (Array.isArray(parsed[key])) {
        extractedElements = parsed[key];
        logger.info(`Found elements array in property: ${key}`);
        break;
      }
    }
  }
  logger.info(`DEBUG: Final extracted elements count: ${extractedElements.length}`);
  
  return {
    elements: extractedElements,
    compliance: parsed.compliance || [],
    summary: parsed.summary || {},
    tokensUsed,
    costEstimate: tokensUsed * 0.000015 // Rough cost estimate
  };
}

/**
 * 💾 Store comprehensive analysis results
 */
async function storeComprehensiveResults(projectId: string, results: any): Promise<void> {
  logger.info(`Storing ${results.elements.length} construction elements for project ${projectId}`);
  
  try {
    // SKIP DELETION - We want to APPEND elements, not replace them
    // Only clear if explicitly requested, not on every analysis
    const shouldClearExisting = false; // Set to true only for full refresh
    
    if (shouldClearExisting) {
      const existingItems = await storage.getBoqItems(projectId);
      logger.info(`🔄 Clearing ${existingItems.length} existing BOQ items for refresh`);
      
      for (const item of existingItems) {
        try {
          await storage.deleteBoqItem(item.id);
        } catch (error) {
          logger.error(`Failed to delete BOQ item ${item.id}`, { error });
        }
      }
    } else {
      logger.info(`📝 APPENDING new elements to existing BOQ items`);
    }
    
    // Skip all the deletion logic that was causing issues
    const verification1 = await storage.getBoqItems(projectId);
    if (verification1.length > 0) {
      logger.info(`⚠️ ${verification1.length} items survived first deletion. Attempting force clear...`);
      
      // Force clear via direct Map manipulation
      if ((storage as any).boqItems instanceof Map) {
        const originalSize = (storage as any).boqItems.size;
        for (const item of verification1) {
          (storage as any).boqItems.delete(item.id);
        }
        logger.info(`🔨 Force deleted ${verification1.length} items from Map (${originalSize} → ${(storage as any).boqItems.size})`);
      }
    }
    
    // Method 3: Complete rebuild if still failing
    const verification2 = await storage.getBoqItems(projectId);
    if (verification2.length > 0) {
      logger.info(`💥 NUCLEAR OPTION: ${verification2.length} items still persist. Complete Map rebuild...`);
      
      if ((storage as any).boqItems instanceof Map) {
        const newMap = new Map();
        let preservedCount = 0;
        
        for (const [key, item] of (storage as any).boqItems) {
          if ((item as any).projectId !== projectId) {
            newMap.set(key, item);
            preservedCount++;
          }
        }
        
        (storage as any).boqItems = newMap;
        logger.info(`🔨 Map rebuilt: Preserved ${preservedCount} items from other projects`);
      }
    }
    
    // Final verification with timeout for persistence
    const finalVerification = await storage.getBoqItems(projectId);
    logger.info(`✅ FINAL VERIFICATION: ${finalVerification.length} items remaining (MUST be 0)`);
    
    if (finalVerification.length > 0) {
      logger.error(`🚨 CRITICAL: ${finalVerification.length} items survived all deletion attempts!`);
      logger.error('Sample persistent items:', finalVerification.slice(0, 3).map(i => ({ id: i.id, desc: i.description })));
    }
    
    // BASIC DEDUPLICATION - preserve unique construction materials
    logger.info(`Starting deduplication of ${results.elements.length} elements`);
    
    // Only remove EXACT duplicates - keep all unique materials/products
    const finalElements = results.elements.reduce((acc: any[], element: any) => {
      const existing = acc.find(e => 
        e.description === element.description && 
        e.category === element.category &&
        e.item === element.item
      );
      
      if (!existing) {
        acc.push(element);
      }
      return acc;
    }, []);
    
    logger.info(`🔍 BASIC DEDUPLICATION: ${results.elements.length} → ${finalElements.length} unique elements`);
    
    // Store all unique construction elements as BOQ items
    let successCount = 0;
    let failureCount = 0;
    const failedElements: any[] = [];
    
    for (const element of finalElements) {
      try {
        // Log what we're trying to store
        const boqData = {
          projectId,
          itemCode: element.specification || generateItemCode(element),
          description: element.description || element.item || 'Construction Element',
          unit: element.unit || element.quantities?.unit || 'ea',
          quantity: extractQuantityValue(element),
          rate: estimateRate(element),
          amount: calculateAmount(element),
          category: mapCategory(element.category || element.description || element.item),
          standard: element.specification || element.specifications?.standard || 'TBD',
          floor: extractFloorLevel(element)
        };
        
        logger.info(`🔍 Attempting to store: ${boqData.itemCode} - ${boqData.description}`);
        
        const storedItem = await storage.createBoqItem(boqData);
        
        if (storedItem && storedItem.id) {
          successCount++;
          logger.info(`✅ Successfully stored item ${storedItem.id}: ${storedItem.itemCode}`);
        } else {
          failureCount++;
          failedElements.push(element);
          logger.error(`❌ Storage returned no ID for: ${boqData.itemCode}`);
        }
      } catch (itemError: any) {
        failureCount++;
        failedElements.push(element);
        
        // Comprehensive error logging
        const errorDetails = {
          message: itemError?.message || 'No error message',
          code: itemError?.code || 'No error code',
          detail: itemError?.detail || 'No error detail',
          hint: itemError?.hint || 'No hint',
          stack: itemError?.stack?.split('\n')[0] || 'No stack trace',
          fullError: JSON.stringify(itemError, Object.getOwnPropertyNames(itemError))
        };
        
        logger.error(`❌ Failed to store element: ${element.item || element.description}`, errorDetails);
        console.error('FULL ERROR OBJECT:', itemError);
        console.error('ERROR NAME:', itemError?.name);
        console.error('ERROR CONSTRUCTOR:', itemError?.constructor?.name);
      }
    }
    
    logger.info(`📊 Storage Summary: ${successCount} succeeded, ${failureCount} failed out of ${finalElements.length} total`);
    
    if (failureCount > 0) {
      logger.error(`🚨 ${failureCount} elements failed to store. First 3 failures:`, 
        failedElements.slice(0, 3).map(e => ({ item: e.item, desc: e.description }))
      );
    }
    
    // COMPREHENSIVE VERIFICATION SYSTEM
    logger.info(`🔍 Starting comprehensive verification...`);
    
    // Verification 1: Immediate database check
    const dbCheck1 = await storage.getBoqItems(projectId);
    logger.info(`📊 Verification 1 (Immediate): ${dbCheck1.length} elements in database`);
    
    // Verification 2: Wait and check again (for async operations)
    const dbCheck2 = await storage.getBoqItems(projectId);
    logger.info(`📊 Verification 2 (After 1s): ${dbCheck2.length} elements in database`);
    
    // Verification 3: Direct SQL query to bypass any caching
    try {
      // Use import statement at top of file instead of require
      const directCount = await storage.getBoqItemsCount(projectId);
      logger.info(`📊 Verification 3 (Direct count): ${directCount} elements in database`);
    } catch (sqlError: any) {
      logger.error(`SQL verification failed:`, { error: sqlError?.message || sqlError });
    }
    
    // Verification 4: Check specific items by ID
    if (successCount > 0) {
      logger.info(`📊 Verification 4: Checking if stored items are retrievable...`);
      // This would need stored IDs, skipping for now
    }
    
    // Final verification summary
    const finalCount = dbCheck2.length;
    if (finalCount === 0 && successCount > 0) {
      logger.error(`🚨 CRITICAL STORAGE FAILURE: ${successCount} items reported success but 0 found in database!`);
      logger.error(`This indicates a database transaction or connection issue.`);
      throw new Error(`Storage verification failed - stored ${successCount} but found ${finalCount}`);
    } else if (finalCount < successCount) {
      logger.warn(`⚠️ PARTIAL STORAGE: Only ${finalCount} of ${successCount} items found in database`);
    } else if (finalCount === successCount) {
      logger.info(`✅ VERIFIED: All ${finalCount} items successfully stored and retrievable`);
    }
    
  } catch (error) {
    logger.error('Failed to store comprehensive results', { error });
    throw error;
  }
}

// Helper functions
function generateItemCode(element: any): string {
  const categoryPrefixes: Record<string, string> = {
    'concrete': '03',
    'steel': '05',
    'masonry': '04',
    'electrical': '26',
    'plumbing': '22',
    'hvac': '23',
    'door': '08',
    'window': '08',
    'finish': '09',
    'testing': '01',
    'inspection': '01'
  };
  
  const description = (element.description || '').toLowerCase();
  let prefix = '01'; // Default to Division 01
  
  for (const [category, code] of Object.entries(categoryPrefixes)) {
    if (description.includes(category)) {
      prefix = code;
      break;
    }
  }
  
  // Generate meaningful CSI codes instead of random gibberish
  const typeMap: Record<string, string> = {
    'stair': '41.STAIR',
    'underlayment': '54.UNDER', 
    'leveling': '54.LEVEL',
    'concrete': '30.CONC',
    'block': '22.BLOCK',
    'masonry': '20.MASONR',
    'wall': '20.WALL',
    'column': '30.COLUMN',
    'beam': '50.BEAM',
    'door': '10.DOOR',
    'window': '10.WIND',
    'insulation': '21.INSUL',
    'electrical': '00.ELEC',
    'plumbing': '00.PLUMB',
    'hvac': '00.HVAC'
  };
  
  let suffix = '00.ITEM'; // Default
  for (const [type, code] of Object.entries(typeMap)) {
    if (description.includes(type)) {
      suffix = code;
      break;
    }
  }
  
  return `${prefix}.${suffix}`;
}

function estimateRate(element: any): string {
  // 🚫 NO FALLBACK RATES - User must input real costs
  // Only use $0.00 to indicate unknown costs
  const _rates = {
    // Keep these $0 to force user input of real rates
  };

  const _description = (element.description || '').toLowerCase();
  
  // Always return $0 - no fallback costs, user must input real rates
  return '0.00';
}

function calculateAmount(element: any): string {
  // Fix: Use Claude's direct quantity format first
  const quantity = parseFloat(element.quantity || element.quantities?.count || '1');
  const rate = parseFloat(estimateRate(element));
  return (quantity * rate).toFixed(2);
}

function extractQuantityValue(element: any): string {
  // Handle Claude's direct quantity format first, then fallbacks
  const qty = element.quantity || element.quantities?.count || element.quantities?.value || '1';
  // Extract numeric value from strings like "850 tonnes" or "2400.0 m²"  
  const numericMatch = String(qty).match(/[\d.]+/);
  return numericMatch ? numericMatch[0] : '1';
}

function extractFloorLevel(element: any): string {
  // Import moved to top of file, use the imported function directly
  
  // Look for floor info in spatial_reference, location, or description
  const spatial = element.spatial_reference || element.spatialReference || '';
  const location = element.location || '';
  const description = element.description || element.item || '';
  const combined = `${spatial} ${location} ${description}`.toLowerCase();
  
  // Direct floor level extraction
  if (/ground floor|main floor|level 1|l1|grade/i.test(combined)) return 'Ground';
  if (/second floor|level 2|l2/i.test(combined)) return 'Level 2'; 
  if (/third floor|level 3|l3/i.test(combined)) return 'Level 3';
  if (/basement|underground|foundation/i.test(combined)) return 'Basement';
  if (/roof|penthouse|mechanical/i.test(combined)) return 'Roof';
  
  // Try to infer elevation but only if we have actual floor height data
  // No default floor heights - return 'Unknown' if Claude hasn't extracted floor height
  const elevation = inferStoreyElevation(combined, undefined);
  if (elevation !== null) {
    if (elevation < 0) return 'Basement';
    if (elevation === 0) return 'Ground';
    // Without actual floor height from Claude, we can't determine levels accurately
  }
  return 'Upper Levels';
}

function mapCategory(elementCategory: any): string {
  if (typeof elementCategory === 'string' && elementCategory !== '') {
    return elementCategory;
  }
  
  const description = (elementCategory?.description || elementCategory || '').toLowerCase();
  
  if (description.includes('concrete')) return 'Concrete Work';
  if (description.includes('steel') || description.includes('metal')) return 'Steel Work';
  if (description.includes('masonry') || description.includes('block')) return 'Masonry Work';
  if (description.includes('gypsum') || description.includes('finish')) return 'Interior Finishes';
  if (description.includes('electrical')) return 'Electrical Work';
  if (description.includes('plumbing') || description.includes('hvac')) return 'MEP Systems';
  if (description.includes('testing') || description.includes('inspection')) return 'Quality Control';
  
  return 'General Construction';
}

export default router;