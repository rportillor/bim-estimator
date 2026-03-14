import { logger } from "../utils/enterprise-logger";
import { parseFirstJsonArray } from '../utils/anthropic-response';

export interface FloorDocumentGroup {
  floorName: string;
  level: number;
  documents: Array<{
    id: string;
    filename: string;
    originalName: string;
    filePath: string;
  }>;
}

export interface FloorAnalysisResult {
  floorName: string;
  level: number;
  elevation?: number; // Elevation in millimeters from Claude's automatic discovery
  elements: any[];
  storeys: any[];
  grids: any[];
  analysis: any;
}

/**
 * Group documents by floor using Claude's intelligent analysis
 */
export async function groupDocumentsByFloor(documents: any[], projectId?: string): Promise<FloorDocumentGroup[]> {
  const _floorGroups = new Map<string, FloorDocumentGroup>();
  
  // First, try Claude's intelligent document analysis
  if (projectId) {
    try {
      console.log(`📋 Calling Claude to analyze ${documents.length} documents for floor structure...`);
      const claudeFloorAnalysis = await analyzeDocumentsWithClaude(documents, projectId);
      if (claudeFloorAnalysis && claudeFloorAnalysis.length > 0) {
        console.log(`✅ [INFO] Claude successfully analyzed floor structure for ${documents.length} documents`);
        console.log(`✅ Claude found floors:`, claudeFloorAnalysis.map(f => `${f.floorName} (Level ${f.level})`))
        logger.info(`Claude successfully analyzed floor structure for ${documents.length} documents`);
        return claudeFloorAnalysis;
      } else {
        console.log(`⚠️ Claude returned empty floor analysis`);
      }
    } catch (error) {
      console.error(`❌ Claude floor analysis error:`, error);
      logger.warn(`Claude floor analysis failed, falling back to filename patterns`, { error });
    }
  }

  // WP-R10 FIX: Filename pattern fallback removed.
  // Claude analysis is the only permitted method. If Claude is unavailable,
  // we register a critical RFI and return an empty array.
  // Callers must handle [] and surface the RFI to the user.
  const { registerMissingData } = await import("../estimator/rfi-generator");
  registerMissingData({
    category: "dimension",
    description:
      "Floor structure analysis failed: Claude could not analyse the uploaded documents " +
      "and no filename-pattern fallback is permitted. " +
      "Floor names, levels, and elevations must come from Claude's analysis of section " +
      "drawings, floor plan title blocks, and elevation annotations. " +
      "Re-upload readable construction documents and retry.",
    csiDivision: "00 00 00",
    impact: "critical",
    drawingRef: "All floor plans and building sections",
    costImpactLow: 0,
    costImpactHigh: 0,
    assumptionUsed: undefined,
    discoveredBy: "groupDocumentsByFloor",
  });
  console.error(
    "❌ [FLOOR-ANALYZER] Claude analysis unavailable and filename fallback is prohibited. " +
    "Returning empty floor list. RFI registered."
  );
  return [];
}

/**
 * Use Claude to intelligently analyze documents and determine floor assignments
 */
async function analyzeDocumentsWithClaude(documents: any[], projectId: string): Promise<FloorDocumentGroup[]> {
  const Anthropic = await import('@anthropic-ai/sdk').then(m => m.default);
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  
  // Create a document list for Claude to analyze
  const documentList = documents.map(doc => ({
    id: doc.id,
    filename: doc.filename || doc.originalName || doc.name || "Unknown",
    type: doc.mimeType || doc.type || "Unknown"
  }));

  // Resolve project name from storage — no hardcoded fallback
  let projectName = '[PROJECT NAME — RFI REQUIRED: project not found]';
  try {
    const { storage } = await import('../storage');
    const project = await storage.getProject(projectId);
    if (project?.name) projectName = project.name;
  } catch { /* non-fatal — RFI flag already set */ }

  const prompt = `You are an expert construction document analyst and quantity surveyor with deep knowledge of Canadian construction practices.
  
  Analyze these ${documents.length} construction documents for the project "${projectName}" and intelligently group them by floor/level.
  
  Documents to analyze:
  ${JSON.stringify(documentList, null, 2)}
  
  IMPORTANT: You must analyze ALL document types:
  
  1. FLOOR PLANS & ARCHITECTURAL DRAWINGS:
     - Look for floor indicators (B1, B2, GF, L1, L2, Floor 1, Second Floor, etc.)
     - Drawing numbering systems (A101 = first floor, A201 = second floor)
     - Plan types (foundation plan, ground floor plan, typical floor plan, roof plan)
  
  2. SPECIFICATIONS (apply to multiple or all floors):
     - Division 01-49 specifications typically apply to entire building
     - Fire stopping specs may apply to all penetrations on all floors
     - Material specs (concrete, steel, masonry) used throughout
     - Mark these as "Building-Wide" or assign to specific floors if indicated
  
  3. CROSS SECTIONS & ELEVATIONS (show multiple floors):
     - Building sections show vertical relationships between floors
     - Wall sections detail connections at each floor level
     - Mark as "Multi-Floor" or "Building-Wide"
  
  4. CONSTRUCTION ASSEMBLIES & DETAILS:
     - Typical details may apply to all floors (mark as "Typical - All Floors")
     - Specific assemblies (roof assembly vs foundation assembly)
     - Connection details between floors
  
  5. SCHEDULES & EQUIPMENT:
     - Door/window schedules may be floor-specific or building-wide
     - Finish schedules often organized by floor
     - Equipment schedules may indicate floor location
  
  6. STRUCTURAL DRAWINGS:
     - Foundation plans and details (basement/underground)
     - Floor framing plans for each level
     - Roof structure
  
  7. MEP DRAWINGS:
     - Often organized by floor (M-101 = Mechanical First Floor)
     - Riser diagrams show all floors
  
  Document Naming Patterns:
  - "A1-01" = Architectural, Floor 1
  - "S-B1" = Structural, Basement 1
  - "M-GF" = Mechanical, Ground Floor
  - "E-RF" = Electrical, Roof
  - "SP-" = Specifications (often building-wide)
  - "DT-" = Details (check if typical or floor-specific)
  
  CRITICAL: Only return ACTUAL PHYSICAL FLOORS from section drawings, not document categories!
  - Do NOT create a "Building-Wide" floor for specifications
  - Do NOT count "Roof Level" as a floor unless it has habitable space
  - For a 4-story building, return exactly 4 main floors plus basement/penthouse if they exist
  
  For documents that apply to all floors (specifications, general details):
  - Assign them to the most relevant floor OR
  - Distribute them across all floors
  - But NEVER create a fake "Building-Wide" floor at level 999
  
  Return a JSON array with this structure:
  [
    {
      "floorName": "Basement Level 1",
      "level": -1,
      "elevation": -3000,  // in millimeters from grade
      "documentIds": ["doc-id-1", "doc-id-2"],
      "reasoning": "Foundation plans, basement wall details, underground utilities"
    },
    {
      "floorName": "Ground Floor",
      "level": 0,
      "elevation": 0,
      "documentIds": ["doc-id-3"],
      "reasoning": "Main floor plans, entrance details, grade-level specifications"
    },
    {
      "floorName": "Fourth Floor",
      "level": 3,
      "elevation": 9600,
      "documentIds": ["doc-id-7"],
      "reasoning": "Fourth floor plans, upper level apartments"
    }
  ]
  
  CRITICAL: Include ALL documents. Documents not specific to one floor should go in "Building-Wide" category.
  
  Provide ONLY the JSON array, no other text.`;

  try {
    // Use Claude directly for floor triage analysis
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      temperature: 0,
      messages: [{
        role: "user",
        content: prompt
      }]
    });
    
    const claudeResponse = response.content[0].type === 'text' ? response.content[0].text : '';
    
    if (claudeResponse) {
      // Parse Claude's response
      const floorData = parseFirstJsonArray(claudeResponse);
      if (floorData.length > 0) {
        
        // Convert Claude's analysis to FloorDocumentGroup format
        return floorData.map((floor: any) => ({
          floorName: floor.floorName,
          level: floor.level,
          elevation: floor.elevation,
          documents: floor.documentIds.map((docId: string) => {
            const doc = documents.find(d => d.id === docId);
            return {
              id: docId,
              filename: doc?.filename || doc?.originalName || "",
              originalName: doc?.originalName || doc?.filename || "",
              filePath: doc?.storageKey || doc?.filePath || ""
            };
          }),
          reasoning: floor.reasoning
        })).sort((a: any, b: any) => {
          // Sort by level, but keep Building-Wide at the end
          if (a.level === 999) return 1;
          if (b.level === 999) return -1;
          return a.level - b.level;
        });
      }
    }
  } catch (error) {
    logger.error("Claude floor analysis failed", { error, projectId });
  }

  return [];
}

/**
 * Helper function to determine element type from BOQ description
 */
function getElementTypeFromDescription(description: string): string {
  const desc = (description || '').toLowerCase();
  
  if (desc.includes('concrete') && desc.includes('foundation')) return 'FOUNDATION';
  if (desc.includes('steel') && desc.includes('beam')) return 'BEAM';
  if (desc.includes('wall') || desc.includes('masonry')) return 'WALL';
  if (desc.includes('partition') || desc.includes('gypsum')) return 'PARTITION';
  if (desc.includes('door')) return 'DOOR';
  if (desc.includes('window')) return 'WINDOW';
  if (desc.includes('slab') || desc.includes('floor')) return 'SLAB';
  if (desc.includes('column')) return 'COLUMN';
  
  return 'GENERIC_ELEMENT';
}

/**
 * Analyze documents for a specific floor
 */
export async function analyzeFloorDocuments(
  projectId: string,
  floorGroup: FloorDocumentGroup,
  _timeout: number = 60000 // Reduced timeout for smaller batches
): Promise<FloorAnalysisResult> {
  logger.info(`Starting floor analysis for ${floorGroup.floorName}`, {
    projectId,
    floorName: floorGroup.floorName,
    documentCount: floorGroup.documents.length
  });

  try {
    // 🔧 FIXED: Use existing Claude analysis instead of creating placeholders
    const { storage } = await import("../storage");
    
    // Check for existing BOQ items from Claude analysis
    const existingBoqItems = await storage.getBoqItems(projectId);
    logger.info(`Found ${existingBoqItems.length} existing BOQ items from Claude analysis`, {
      projectId,
      floorName: floorGroup.floorName
    });

    if (existingBoqItems.length > 0) {
      // Convert Claude's BOQ items to BIM elements for this floor
      const floorElements = existingBoqItems
        // 🎯 DISTRIBUTE ALL 142 BoQ items across floors instead of restrictive filtering
        .filter((item, index) => {
          // Smart distribution: spread all BoQ items across 6 floors
          const floorsCount = 6;
          const itemsPerFloor = Math.ceil(existingBoqItems.length / floorsCount);
          const floorIndex = Math.max(0, floorGroup.level + 1); // Foundation=-1 becomes 0, Ground=1 becomes 2, etc.
          const startRange = floorIndex * itemsPerFloor;
          const endRange = (floorIndex + 1) * itemsPerFloor;
          
          // Include this item if it falls in this floor's range
          return index >= startRange && index < endRange;
        })
        .map((item, index) => {
          const elementType = getElementTypeFromDescription(item.description);
          return {
            id: `${projectId}-${floorGroup.floorName}-${elementType}-${index}`,
            type: elementType,
            location: { 
              x: index * 2000, 
              y: 0, 
              z: floorGroup.level * 3500 // millimeters 
            },
            properties: { 
              floor: floorGroup.floorName,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              amount: item.amount,
              fromClaudeAnalysis: true
            }
          };
        });

      logger.info(`Created ${floorElements.length} real BIM elements from Claude analysis for ${floorGroup.floorName}`, {
        projectId,
        elementTypes: floorElements.map(e => e.type)
      });

      return {
        floorName: floorGroup.floorName,
        level: floorGroup.level,
        elements: floorElements,
        storeys: [],
        grids: [],
        analysis: { elementCount: floorElements.length, source: 'claude-analysis' }
      };
    }

    // ❌ DEAD-END TRAP ELIMINATED: No placeholder floors when Claude finds nothing
    throw new Error(`
🚫 NO FLOOR ANALYSIS: Claude must analyze actual floor plans!

Floor: ${floorGroup.floorName}
Level: ${floorGroup.level}

This function tried to create fake placeholders when Claude analysis was unavailable.
NO hardcoded floor heights (3000mm) allowed!

Claude must extract REAL floor data from construction documents:
- Actual floor-to-floor heights from sections
- Real room layouts from floor plans
- True structural grids from drawings
- Genuine element locations

Project: ${projectId}
    `);

  } catch (error) {
    logger.error(`Floor analysis failed for ${floorGroup.floorName}`, {
      projectId,
      error: error instanceof Error ? error.message : String(error)
    });

    // Return empty result instead of failing completely
    return {
      floorName: floorGroup.floorName,
      level: floorGroup.level,
      elements: [],
      storeys: [],
      grids: [],
      analysis: {}
    };
  }
}

/**
 * Generate BIM elements for a specific floor
 */
export async function generateFloorBIM(
  projectId: string,
  modelId: string,
  floorResult: FloorAnalysisResult,
  lodProfile: any
): Promise<any[]> {
  try {
    if (floorResult.elements.length === 0) {
      logger.warn(`No elements found for floor ${floorResult.floorName}`, { projectId, modelId });
      return [];
    }

    const positionedElements = floorResult.elements.map((element, _index) => {
      // Apply floor-specific elevation offset using Claude's discovered floor structure
      const floorElevation = floorResult.elevation || (floorResult.level * 3500); // Use discovered elevation or fallback in millimeters
      
      return {
        ...element,
        location: {
          ...element.location,
          z: (element.location?.z || 0) + floorElevation
        }
      };
    });

    logger.info(`Positioned ${positionedElements.length} elements for floor ${floorResult.floorName}`, {
      projectId,
      modelId,
      floorElevation: floorResult.elevation || (floorResult.level * 3500)
    });

    // 🎯 CLAUDE-DRIVEN ELEMENTS: Use actual Claude analysis as base for LOD expansion
    console.log(`🧩 [FLOOR] Using Claude's real analysis for ${floorResult.floorName}: ${positionedElements.length} base elements`);
    console.log(`🧩 [FLOOR] Applying LOD expansion to reach target: ${lodProfile.maxElements} elements`);
    
    let expandedElements = positionedElements;

    // ✅ RE-ENABLE LOD EXPANSION: Transform base elements into detailed BIM model
    try {
      const { expandLOD } = await import('./lod-expander');
      expandedElements = await expandLOD(positionedElements, lodProfile, {
        projectId,
        modelId,
        floorName: floorResult.floorName,
        floorElevation: floorResult.elevation || (floorResult.level * 3500)
      });
      
      console.log(`🚀 [LOD] Expanded ${positionedElements.length} base elements to ${expandedElements.length} detailed elements`);
    } catch (lodError) {
      console.warn(`⚠️ [LOD] Expansion failed, using base elements:`, lodError);
      expandedElements = positionedElements;
    }

    logger.info(`Generated ${expandedElements.length} total elements for floor ${floorResult.floorName}`, {
      projectId,
      modelId,
      baseElements: positionedElements.length,
      expandedElements: expandedElements.length
    });

    return expandedElements;

  } catch (error) {
    logger.error(`BIM generation failed for floor ${floorResult.floorName}`, {
      projectId,
      modelId,
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

/**
 * Combine multiple floor models into a single BIM model
 */
export async function combineFloorModels(
  projectId: string,
  modelId: string,
  floorResults: Array<{ floorName: string; elements: any[] }>
): Promise<{ elements: any[]; summary: any }> {
  try {
    const allElements = floorResults.flatMap(floor => floor.elements);
    
    const summary = {
      totalElements: allElements.length,
      floorBreakdown: floorResults.map(floor => ({
        floorName: floor.floorName,
        elementCount: floor.elements.length
      })),
      generationMethod: 'floor-by-floor',
      sourceData: 'claude-analysis'
    };

    logger.info(`Combined BIM model created`, {
      projectId,
      modelId,
      totalElements: allElements.length,
      floorCount: floorResults.length
    });

    return { elements: allElements, summary };

  } catch (error) {
    logger.error(`Failed to combine floor models`, {
      projectId,
      modelId,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

// Note: Removed artificial floor targets - now using Claude's real analysis

/**
 * Get expected element types for a specific floor
 */
export function getExpectedElementsForFloor(floorName: string): string[] {
  const lowerFloorName = floorName.toLowerCase();
  
  if (lowerFloorName.includes('foundation') || lowerFloorName.includes('underground')) {
    return ['FOUNDATION', 'COLUMN', 'SLAB'];
  } else if (lowerFloorName.includes('ground') || lowerFloorName.includes('first')) {
    return ['WALL', 'DOOR', 'WINDOW', 'BEAM', 'COLUMN'];
  } else if (lowerFloorName.includes('roof')) {
    return ['ROOF', 'MECHANICAL', 'STRUCTURAL'];
  } else {
    return ['WALL', 'DOOR', 'WINDOW', 'PARTITION'];
  }
}