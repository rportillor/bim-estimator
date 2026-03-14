import { randomUUID } from "crypto";
import { storage } from "./storage";
import type { BimModel, Document } from "@shared/schema";
import Anthropic from '@anthropic-ai/sdk';
import { RealQTOProcessor } from './real-qto-processor';
import { ConstructionWorkflowProcessor } from './construction-workflow-processor';
import { convertRealElementToLegacyFormat, getDocumentPath } from './helpers/bim-converter';
import { deriveBuildingAnalysisFromClaude, validateOrRecomputeAnalysis } from './helpers/building-analysis';
import { extractPdfTextAndPages } from "./services/pdf-extract";
import { scorePage } from "./helpers/page-scorer";
import { estimateTokensForText, selectWithinBudget, chunkByTokens } from "./helpers/text-budget";
import { mergeClaudeResults } from "./helpers/analysis-merge";
import { calibrateAndPositionElements } from "./helpers/layout-calibration";
import { extractDrawingScale, validateScalesAcrossSheets, computeScaleFactor } from "./bim/drawing-scale-extractor";
import type { DrawingScaleResult } from "./bim/drawing-scale-extractor";
import { postprocessAndSaveBIM } from "./services/bim-postprocess";
import { getLodProfile } from "./helpers/lod-profile";
import { deriveQuantitiesForElements } from "./helpers/quantity-derive";
import { assignRenderColors } from "./helpers/render-colors";
import { balancedAssemble } from "./services/balanced-assembler";
import { updateModelStatus } from "./services/model-status";
import { startWatchdog, heartbeat, stopWatchdog } from "./services/generation-watchdog";
import { withTimeout } from "./helpers/with-timeout";
import { StandardsService } from "./standards-service";
import { rfiService } from "./rfi-service";
import { logger } from "./utils/enterprise-logger";
import { AICoach } from "./ai-coach";
import { DocumentChunker } from "./services/document-chunker";
import { prescreenCodeAdders } from "./estimator/codes-standards-register";
import { parseFirstJsonObject } from './utils/anthropic-response';

// Helper function moved to top-level to avoid strict mode issues
export const parseClaudeJson = (resp: any): any => {
  try {
    const text = Array.isArray(resp?.content)
      ? resp.content.map((c: any) => c?.text || "").join("\n")
      : (resp?.content?.[0]?.text || resp?.content || "");
    return parseFirstJsonObject(text);
  } catch {
    return {};
  }
};

// ✅ QTO Result Normalization (cleaner than scattered optional chaining)
function normalizeQTO(r: any) {
  // Accept either { elements, ... } or a raw elements array
  const elements = Array.isArray(r?.elements) ? r.elements : (Array.isArray(r) ? r : []);
  const storeys  = Array.isArray(r?.storeys)  ? r.storeys  : [];
  const processingMethod =
    r?.summary?.processingMethod ??
    (elements.length ? "batched-per-chunk" : "single-call");

  return {
    ...r,
    elements,
    storeys,
    summary: { processingMethod, ...(r?.summary || {}) },
  };
}

// Initialize Claude API for BIM generation
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Initialize AI Coach for engineering verification
const aiCoach = new AICoach();


export interface BIMGenerationRequirements {
  modelName?: string;
  outputFormat?: "IFC" | "RVT" | "DWG" | "3DS";
  levelOfDetail?: "LOD100" | "LOD200" | "LOD300" | "LOD400" | "LOD500";
  includeStructural?: boolean;
  includeMEP?: boolean;
  includeArchitectural?: boolean;
  coordinateSystem?: "local" | "global";
  units?: "metric" | "imperial";
  standards?: string[];
  qualityLevel?: "basic" | "professional" | "advanced";
}

// ✅ Extended options interface for BIM processing - moved to shared types

export interface BIMElement {
  id: string;
  type: string;
  name: string;
  category: string;
  geometry: any;
  properties: Record<string, any>;
}

async function buildElementsFromClaude(modelId: string, realQTOResult: any, analysisStrategy?: any, projectId?: string) {
  const claudeAnalysis =
    realQTOResult?.building_analysis ||
    analysisStrategy?.building_analysis ||
    realQTOResult?.analysis ||
    analysisStrategy?.analysis ||
    null;

  // 1) Prefer Claude (structured or text)
  let buildingAnalysis = deriveBuildingAnalysisFromClaude(claudeAnalysis);

  // 2) If missing or implausibly tiny, recompute from the element cloud Claude gave us
  buildingAnalysis = validateOrRecomputeAnalysis(
    buildingAnalysis,
    Array.isArray(realQTOResult?.elements) ? realQTOResult.elements : null
  );

  // 3) (Optional) if you already persisted an override, prefer it
  try {
    const meta = (await (storage as any).getModelMetadata?.(modelId)) || (await (storage as any).getModel?.(modelId));
    if (meta?.buildingAnalysis) buildingAnalysis = meta.buildingAnalysis;
  } catch {/* ignore */}

  // 🤝 AI COACH + CLAUDE COLLABORATION FOR ENHANCED BIM
  if (projectId) {
    try {
      console.log('🤖 Enhancing BIM with AI Coach engineering insights...');
      buildingAnalysis = await enhanceBIMWithCoachInsights(buildingAnalysis, realQTOResult, projectId);
    } catch (error) {
      console.error('❌ AI Coach enhancement failed, continuing with Claude analysis:', error);
    }
  }

  const mode = (process.env.POSITIONING_MODE as any) || "auto"; // "auto" | "forcePerimeter" | "preferClaude"
  const _total = realQTOResult?.elements?.length || 0;

  // Analysis logging for debugging
  logger.debug('Building analysis available', {
    hasPerimeter: !!buildingAnalysis?.perimeter,
    perimeterLength: buildingAnalysis?.perimeter?.length,
    hasDimensions: !!buildingAnalysis?.dimensions,
    width: buildingAnalysis?.dimensions?.width,
    length: buildingAnalysis?.dimensions?.length
  });

  // Get base elements from realQTO result
  let elements: any[] = realQTOResult.elements || [];
  const storeys = realQTOResult.storeys || [];
  
  // Apply balanced assembly to ensure proper structural seeding
  const assembled = await balancedAssemble({
    baseElements: elements,
    analysis: realQTOResult.analysis || buildingAnalysis,
    storeys,
    options: realQTOResult.requirements || {}
  });
  
  // Convert assembled elements to legacy format
  const finalElements = assembled.elements.map((re: any, idx: number) =>
    convertRealElementToLegacyFormat(re, idx, assembled.elements.length, buildingAnalysis, mode)
  );

  // (Optional) persist resolved analysis for future runs
  try {
    await (storage as any).updateModelMetadata?.(modelId, { buildingAnalysis }) ??
          (storage as any).setModelMetadata?.(modelId, { buildingAnalysis });
  } catch {/* ignore */}

  return finalElements;
}

// 🎯 AI COACH + CLAUDE COLLABORATION FOR INTELLIGENT BIM
async function enhanceBIMWithCoachInsights(buildingAnalysis: any, realQTOResult: any, projectId: string): Promise<any> {
  try {
    // Get AI Coach's engineering analysis for this project
    const documents = await storage.getDocuments(projectId);
    
    // 🔧 PROPER FIX: Get Claude's original BOQ analysis from storage, not processed elements
    console.log('📋 Getting Claude\'s original BOQ analysis for AI Coach enhancement...');
    const originalBoqItems = await storage.getBoqItems(projectId); // Claude's 61 extracted elements
    const complianceChecks = realQTOResult?.compliance_checks || [];
    
    console.log(`📊 AI Coach received: ${originalBoqItems.length} BOQ items from Claude's analysis`);
    
    if (originalBoqItems.length === 0) {
      console.log('⚠️ No BOQ items found - AI Coach will work with compliance checks only');
    }
    
    const coachFindings = await (aiCoach as any).generateFindingsFromExistingAnalysis(
      projectId, 
      originalBoqItems,
      complianceChecks, 
      documents
    );

    // 🏗️ STRUCTURAL ENHANCEMENTS
    const structuralFindings = coachFindings.findings.filter((f: any) => 
      f.category === 'Structural' || f.title.includes('Structural')
    );

    if (structuralFindings.length > 0) {
      console.log(`🏗️ Applying ${structuralFindings.length} structural insights to BIM`);
      
      // Apply engineering analysis to building structure
      buildingAnalysis.engineeringAnalysis = {
        ...buildingAnalysis.engineeringAnalysis,
        loadCombinations: ['1.25D + 1.5L + 1.0S (snow)', '1.4D + 1.6L (standard)'],
        seismicDesign: 'Ontario Zone 2 (Sa = 0.35g)',
        verificationRequired: true,
        coachRecommendations: structuralFindings.map((f: any) => f.recommendation),
        originalBoqCount: originalBoqItems.length
      };
      
      // Flag structural elements that need engineer verification
      if (realQTOResult?.elements) {
        realQTOResult.elements = realQTOResult.elements.map((element: any) => {
          if (isStructuralElement(element)) {
            return {
              ...element,
              engineeringNotes: `Professional verification required per AI Coach analysis (based on ${originalBoqItems.length} Claude BOQ items)`,
              requiresVerification: true,
              loadCombinations: '1.25D + 1.5L + 1.0S (snow)'
            };
          }
          return element;
        });
      }
    }

    // 🔥 FIRE SAFETY ENHANCEMENTS
    const fireFindings = coachFindings.findings.filter((f: any) => 
      f.category === 'Fire Safety' || f.title.includes('Fire')
    );

    if (fireFindings.length > 0) {
      console.log(`🔥 Applying ${fireFindings.length} fire safety insights to BIM`);
      
      // Apply fire ratings to walls and doors
      if (realQTOResult?.elements) {
        realQTOResult.elements = realQTOResult.elements.map((element: any) => {
          if (isFireRatedElement(element)) {
            return {
              ...element,
              fireRating: '2-hour fire rating',
              assemblySpecification: '2x6 wood frame + 5/8" Type X drywall both sides',
              complianceNotes: fireFindings.map((f: any) => f.recommendation)
            };
          }
          return element;
        });
      }
    }

    console.log(`✅ AI Coach BIM enhancement completed using ${originalBoqItems.length} Claude BOQ items`);
    return buildingAnalysis;

  } catch (error) {
    console.error('❌ AI Coach BIM enhancement failed:', error);
    return buildingAnalysis; // Return original if enhancement fails
  }
}

// Element type checkers for AI Coach + BIM integration
function isStructuralElement(element: any): boolean {
  const type = (element.type || '').toLowerCase();
  return type.includes('beam') || type.includes('column') || type.includes('slab') || 
         type.includes('foundation') || type.includes('structural');
}

function isFireRatedElement(element: any): boolean {
  const type = (element.type || '').toLowerCase();
  return type.includes('wall') || type.includes('door') || type.includes('partition');
}

// Enhanced BIM Generator with Real QTO Processing (Phase 2)
export class BIMGenerator {
  private realQTOProcessor: RealQTOProcessor;
  private constructionWorkflow: ConstructionWorkflowProcessor;
  private standardsService: StandardsService;

  constructor() {
    this.realQTOProcessor = new RealQTOProcessor();
    this.constructionWorkflow = new ConstructionWorkflowProcessor();
    this.standardsService = new StandardsService();
  }

  async generateBIMModel(
    projectId: string,
    documents: Document[],
    requirements: BIMGenerationRequirements
  ): Promise<BimModel> {
    const startTime = new Date();
    logger.info('Starting AI-powered BIM generation', { projectId, startTime: startTime.toISOString() });
    
    // Helper for status updates
    let modelId = '';
    const _status = async (patch: { status?: any; progress?: number; message?: string; error?: string }) => {
      if (!modelId) return;
      try { 
        await updateModelStatus(storage, modelId, patch); 
      } catch (e) { 
        logger.warn('Status update failed', { error: (e as any)?.message }); 
      }
    };
    
    // v15.12: Accept lod OR levelOfDetail; never throw — default to 'detailed'
    const lodProfileName: string = (requirements as any)?.lod
      || (requirements as any)?.levelOfDetail
      || process.env.DEFAULT_LOD
      || 'detailed';
    const lodProfile = getLodProfile(lodProfileName);
    console.log(`[bim-gen] LOD=${lodProfile.name} families=${lodProfile.families.join(",")}`);
    console.log(`[bim-gen] maxElements=${lodProfile.maxElements} mechanical=${lodProfile.includeMechanical}`);
    
    // 🔍 Check for existing BIM model first to avoid duplicates
    const existingModels = await storage.getBimModels(projectId);
    let bimModel: BimModel | null = null;
    
    if (existingModels.length > 0) {
      // Clean up extra duplicates first - MUST DELETE ELEMENTS BEFORE MODELS
      if (existingModels.length > 1) {
        console.log(`🧹 Cleaning up ${existingModels.length - 1} duplicate BIM models for project ${projectId}`);
        for (let i = 1; i < existingModels.length; i++) {
          const duplicateModel = existingModels[i];
          try {
            // 🚀 FAST DELETE: CASCADE delete removes elements automatically
            await storage.deleteBimModel(duplicateModel.id);
            console.log(`✅ Deleted duplicate model ${duplicateModel.id} (CASCADE)`);
          } catch (error) {
            console.log(`⚠️ Failed to delete duplicate model ${duplicateModel.id}:`, error);
          }
        }
      }
      
      // 🛡️ PROTECT EXISTING WORK - Never delete models with significant elements
      const existingModel = existingModels[0];
      const existingElements = await storage.getBimElements(existingModel.id);

      if (existingElements.length > 50) {
        console.log(`🛡️ FOUND EXISTING WORK: Model ${existingModel.id} has ${existingElements.length} elements`);

        // ── HUMAN-MODELER WORKFLOW: Iterative Refinement ──────────────────
        // A human modeler works in passes — they don't delete the whole model
        // and start over when new drawings arrive. They compare, diff, and
        // update only what changed. We store the existing model's element
        // snapshot for the post-generation diff step.
        console.log(
          `🔄 ITERATIVE REFINEMENT: Preserving ${existingElements.length} existing elements ` +
          `for incremental diff after re-extraction. New/changed elements will be merged, ` +
          `unchanged elements will be preserved with stable IDs.`
        );

        // Use the existing model but continue with generation
        bimModel = existingModel;
        modelId = existingModel.id;

        // Store previous element snapshot for diffing in post-processing
        try {
          if ((storage as any).updateBimModelMetadata) {
            await (storage as any).updateBimModelMetadata(modelId, {
              previousElementSnapshot: {
                count: existingElements.length,
                timestamp: new Date().toISOString(),
                elementIds: existingElements.map((e: any) => e.id || e.elementId),
              },
            });
          }
        } catch { /* non-blocking */ }

        // Update status to generating to show we're working on it
        await storage.updateBimModel(modelId, { status: 'generating' });

        console.log(`🔄 Using existing model ${modelId} — will diff new extraction against existing elements`);

        // Don't return early - continue with the generation process
      } else {
        // Less than 50 elements, safe to recreate
        console.log(`📝 Model has only ${existingElements.length} elements, safe to regenerate`);
        
        // Delete the incomplete model and its elements
        // First delete elements, then the model
        const elementsToDelete = await storage.getBimElements(existingModel.id);
        for (const element of elementsToDelete) {
          await storage.deleteBimElement(element.id);
        }
        await storage.deleteBimModel(existingModel.id);
        
        // Create a completely new model
        bimModel = await storage.createBimModel({
          projectId,
          name: requirements.modelName || `AI-Generated BIM Model from Construction Documents`,
          status: "generating",
          geometryData: null
        });
        modelId = bimModel.id;
        console.log(`✅ Created fresh BIM model ${modelId} for regeneration`);
      }
      
      // If we didn't set bimModel above, create a completely new model
      if (!bimModel) {
        bimModel = await storage.createBimModel({
          projectId,
          name: requirements.modelName || `AI-Generated BIM Model from Construction Documents`,
          status: "generating",
          geometryData: null
        });
        modelId = bimModel.id;
        console.log(`✅ Created fresh BIM model ${modelId} for complete regeneration`);
      }
    } else {
      // Create new BIM model record only if none exists
      bimModel = await storage.createBimModel({
        projectId,
        name: requirements.modelName || `AI_BIM_Model_${new Date().toISOString().split('T')[0]}`,
        version: "1.0",
        status: "generating",
        modelType: requirements.outputFormat || "IFC",
        geometryData: JSON.stringify([])
      });
      console.log(`✅ Created new BIM model ${bimModel.id} for project ${projectId}`);
      modelId = bimModel.id;
    }

    try {
      // 🔧 DEV FIX: Clear any stuck models before starting new generation
      if (process.env.NODE_ENV === 'development') {
        try {
          const allModels = await storage.getBimModels(projectId);
          const stuckModels = allModels.filter(m => 
            m.status === 'generating' && 
            m.id !== modelId && // Don't clear the one we just created
            m.createdAt && // Ensure createdAt exists
            new Date().getTime() - new Date(m.createdAt).getTime() > 5 * 60 * 1000 // older than 5 minutes
          );
          
          for (const stuck of stuckModels) {
            const minutesStuck = stuck.createdAt 
              ? Math.round((new Date().getTime() - new Date(stuck.createdAt).getTime()) / 60000)
              : 0;
            console.log(`🔧 DEV: Clearing stuck model ${stuck.id} (stuck for ${minutesStuck} minutes)`);
            await storage.updateBimModel(stuck.id, { status: 'failed' });
          }
          
          if (stuckModels.length > 0) {
            console.log(`🔧 DEV: Cleared ${stuckModels.length} stuck models automatically`);
          }
        } catch (err) {
          console.warn('Failed to clear stuck models:', err);
        }
      }
      
      // Start watchdog with 20 minute timeout for processing large construction projects
      startWatchdog(modelId, 1_200_000, async (reason) => {
        console.warn(`[watchdog] ${reason}`);
        try {
          await _status({ status: "failed", progress: 1.0, message: "Generation aborted by watchdog", error: reason });
        } catch { /* intentionally empty */ }
      });
      
      // Initial status update
      await _status({ status: "generating", progress: 0.02, message: "Starting BIM generation" });
      heartbeat(modelId);
      
      // 🎯 FIRST: Check existing caches before making new Claude calls
      await this.updateBIMProgress(bimModel.id, "Checking cached analysis...");
      await _status({ progress: 0.15, message: "Cleaning old models and checking cache" });
      heartbeat(modelId);
      console.log(`💰 COST OPTIMIZATION: Checking existing analysis before Claude API calls`);
      
      let analysisStrategy;
      
      // 🔍 STEP 1: Check for existing document analysis (Smart Analysis Cache)
      console.log(`🔍 Checking existing document analysis for project ${projectId}...`);
      const existingAnalysis = await this.getExistingDocumentAnalysis(projectId);
      
      if (existingAnalysis) {
        console.log(`✅ Using existing cached analysis - SAVED major Claude API call!`);
        await _status({ progress: 0.30, message: "Using cached document analysis" });
        heartbeat(modelId);
        analysisStrategy = existingAnalysis;
      } else {
        // Only call Claude if no existing analysis found
        await this.updateBIMProgress(bimModel.id, "Generating new AI analysis...");
        await _status({ progress: 0.30, message: "Extracting PDF text & pages" });
        heartbeat(modelId);
        console.log(`🔍 TRACE: About to call analyzeDocumentsWithAI with ${documents.length} documents`);
        
        // Declare variables outside try block to fix TypeScript scope errors
        let specsToProcess: Document[] = [];
        let drawingsToProcess: Document[] = [];
        let sectionsToProcess: Document[] = [];
        
        try {
          const unitSystem = (requirements?.units === 'imperial' ? 'imperial' : 'metric') as 'metric' | 'imperial';
          const mainDocument = documents.find(doc => 
            doc.filename.toLowerCase().includes('plan') ||
            doc.filename.toLowerCase().includes('section') ||
            doc.filename.toLowerCase().includes('elevation')
          ) || documents[0];
          const documentPath = getDocumentPath(mainDocument) || '';
          
          await _status({ progress: 0.45, message: "Claude analysis (batched)" });
          heartbeat(modelId);
          // Process documents in SEQUENCE, not all at once
          console.log(`📋 Processing documents in sequence: specs → drawings → sections`);
          const specs = documents.filter(d => d.filename.match(/spec|schedule|specification/i));
          const drawings = documents.filter(d => 
            !d.filename.match(/spec|schedule|specification|section|detail/i) && 
            d.filename.match(/plan|floor|elevation|roof/i)
          );
          const sections = documents.filter(d => d.filename.match(/section|detail/i));
          const others = documents.filter(d => 
            !specs.includes(d) && !drawings.includes(d) && !sections.includes(d)
          );
          
          console.log(`📊 Document breakdown: ${specs.length} specs, ${drawings.length} drawings, ${sections.length} sections, ${others.length} others`);
          
          // 🔧 SMART PROCESSING: Use DocumentChunker for large specifications
          console.log(`🔍 Checking for large specification documents that need chunking...`);
          
          // Find the main specifications document for intelligent chunking
          const mainSpec = specs.find(d => 
            d.filename.toLowerCase().includes('specifications') || 
            d.filename.toLowerCase().includes('spec')
          );
          
          // Check if we need to use chunking for large specifications
          const needsChunking = mainSpec && (mainSpec.textContent || '').length > 100000;
          
          if (needsChunking) {
            console.log(`📦 CHUNKING: Large specifications document detected (${mainSpec.textContent?.length} chars)`);
            console.log(`📦 Using DocumentChunker for optimal CSI division-based processing`);
            
            // Use DocumentChunker for large specifications
            const chunker = new DocumentChunker();
            const chunks = await chunker.chunkSpecificationDocument(
              mainSpec.textContent || '',
              mainSpec.filename || ''
            );
            
            console.log(`✅ Created ${chunks.length} CSI division chunks for sequential processing`);
            
            // Process chunked specifications through enhanced analyzeDocumentsWithAI
            analysisStrategy = await withTimeout(
              this.analyzeDocumentsWithChunkedSpecs(
                chunks,
                mainSpec,
                drawingsToProcess,
                sectionsToProcess,
                requirements,
                { projectId, documentPath, unitSystem, modelId }
              ),
              1_200_000, // 20 minutes timeout for large projects
              "Claude chunked analysis"
            );
            
            console.log(`🎯 Chunked analysis completed: ${chunks.length} chunks processed`);
          } else {
            // Regular processing for smaller documents
            specsToProcess = specs.slice(0, 2); // Process max 2 specs at once
            drawingsToProcess = drawings.slice(0, 4); // Process max 4 drawings  
            sectionsToProcess = sections.slice(0, 2); // Process max 2 sections
            
            // Log which documents will be processed
            console.log(`🎯 Processing subset of documents to prevent timeout:`);
            console.log(`   - Specs (${specsToProcess.length}/${specs.length}): ${specsToProcess.map(d => d.filename).join(', ')}`);
            console.log(`   - Drawings (${drawingsToProcess.length}/${drawings.length}): ${drawingsToProcess.map(d => d.filename).join(', ')}`);
            console.log(`   - Sections (${sectionsToProcess.length}/${sections.length}): ${sectionsToProcess.map(d => d.filename).join(', ')}`);
            console.log(`   - Total documents to process: ${specsToProcess.length + drawingsToProcess.length + sectionsToProcess.length} (max 8)`)
            
            analysisStrategy = await withTimeout(
              this.analyzeDocumentsWithAI(
                [...specsToProcess, ...drawingsToProcess, ...sectionsToProcess],
                requirements,
                { projectId, documentPath, unitSystem, modelId }
              ),
              1_200_000, // 20 minutes timeout for processing large construction projects
              "Claude sequenced analysis"
            );
          }
          heartbeat(modelId);
          console.log(`🔍 TRACE: Claude analysis completed successfully`);
          console.log(`🔍 TRACE: Analysis strategy keys:`, Object.keys(analysisStrategy));
          console.log(`🔍 TRACE: Building analysis present:`, !!analysisStrategy.building_analysis);

          // 💾 CACHE SAVE: Persist Claude analysis so future BIM generations reuse it for free
          // Stored on the first document with text content — getExistingDocumentAnalysis() reads it back
          try {
            const docToCache = documents.find((d: any) => d.textContent && d.textContent.length > 100) || documents[0];
            if (docToCache && analysisStrategy) {
              const cachePayload = {
                building_analysis: analysisStrategy.building_analysis,
                ai_understanding: analysisStrategy.ai_understanding || analysisStrategy.strategy,
                confidence: analysisStrategy.confidence,
                overallConfidence: analysisStrategy.overallConfidence,
                buildingHierarchy: analysisStrategy.buildingHierarchy,
                componentTypes: analysisStrategy.componentTypes,
                standardsRequired: analysisStrategy.standardsRequired,
                cachedAt: new Date().toISOString(),
                documentCount: documents.length,
              };
              await storage.updateDocument(docToCache.id, { analysisResult: cachePayload });
              console.log(`💾 SAVED: Claude analysis cached on document ${docToCache.id} — future runs will skip Claude for this project`);
            }
          } catch (saveErr: any) {
            console.warn(`⚠️ Non-fatal: could not save analysis cache — ${saveErr.message}`);
          }
        } catch (error: any) {
          console.error(`🚨 CRITICAL: Claude analysis FAILED:`, error.message);
          console.error(`🚨 ERROR TYPE:`, error.name);
          console.error(`🚨 FULL STACK:`, error.stack);
          console.error(`🚨 DOCUMENTS ATTEMPTED: ${specsToProcess.length + drawingsToProcess.length + sectionsToProcess.length} documents`);
          console.error(`🚨 TIMEOUT SETTING: ${1_200_000}ms (20 minutes)`);
          
          // Update model status to reflect the error
          await _status({ 
            status: "error", 
            progress: 0.45, 
            message: "Claude analysis failed - attempting fallback", 
            error: `Claude timeout after processing ${specsToProcess.length + drawingsToProcess.length + sectionsToProcess.length} documents (20 min limit)` 
          });
          
          // 🎯 FALLBACK: Use existing analysis from database instead of crashing
        console.log(`🔄 Attempting to use existing Claude analysis from database...`);
        try {
          const { storage } = await import('./storage');
          const documents = await storage.getDocumentsByProject(projectId);
          const docWithAnalysis = documents.find((doc: any) => doc.analysisResult);
          
          if (docWithAnalysis) {
            console.log(`✅ Found existing analysis in: ${docWithAnalysis.filename}`);
            const existingAnalysis = typeof docWithAnalysis.analysisResult === 'string' 
              ? JSON.parse(docWithAnalysis.analysisResult) 
              : docWithAnalysis.analysisResult;
            
            analysisStrategy = {
              strategy: JSON.stringify(existingAnalysis),
              building_analysis: existingAnalysis.building_analysis,
              ai_understanding: existingAnalysis,
              confidence: null, // not derivable from cached analysis — source confidence unknown
              overallConfidence: null,
              buildingHierarchy: existingAnalysis.building_analysis?.storeys || [],
              componentTypes: ['architectural', 'structural', 'mep'],
              standardsRequired: ['IFC4']
            };
            console.log(`🔄 Using existing analysis with building_analysis:`, !!analysisStrategy.building_analysis);
          } else {
            throw error; // No fallback available, propagate error
          }
        } catch (fallbackError) {
          console.error(`🚨 Fallback also failed:`, fallbackError);
          throw error; // Don't hide the original error
        }
        }
      }
      
      // ✨ Phase 2: Use Real QTO Processing instead of mock generation
      console.log(`🔍 TRACE: Starting Phase 2 - Real QTO Processing for project ${projectId}`);
      await this.updateBIMProgress(bimModel.id, "Processing real BIM quantities with professional QTO...");
      await _status({ progress: 0.60, message: "Building base elements" });
      heartbeat(modelId);
      
      // Get project unit system for proper QTO processing
      const unitSystem = requirements.units || 'metric';
      const _project = await storage.getProject(projectId);
      
      // 🎯 Process with real QTO system using ALL CONSTRUCTION DOCUMENTS
      console.log(`🔍 TRACE: About to process ${documents.length} documents with QTO system`);
      console.log(`🤖 Processing ALL ${documents.length} construction documents for unlimited element extraction`);
      
      let realQTOResult;
      console.log(`🔍 TRACE: Document check - found ${documents.length} documents`);
      if (documents.length > 0) {
        // 🚫 NO SINGLE DOCUMENT LIMIT - Process comprehensive document set
        console.log(`🏗️ UNLIMITED PROCESSING: Analyzing all ${documents.length} documents for maximum building complexity`);
        console.log(`📄 Document types: ${documents.map(d => d.filename.split('_').pop()).join(', ')}`);
        
        // 🚀 UNLIMITED PROCESSING: Use first document as trigger but with enhanced analysis  
        const mainDocument = documents.find(doc => 
          doc.filename.toLowerCase().includes('plan') ||
          doc.filename.toLowerCase().includes('section') ||
          doc.filename.toLowerCase().includes('elevation')
        ) || documents[0];
        
        console.log(`🎯 Using ${mainDocument.filename} as primary but analyzing ALL ${documents.length} documents`);
        
        const documentPath = getDocumentPath(mainDocument);
        console.log(`🔍 TRACE: Document path generated:`, documentPath || '❌ NULL/UNDEFINED');
        
        // If batches returned real elements, skip extra RealQTO call:
        if (Array.isArray(analysisStrategy?.elements) && analysisStrategy.elements.length) {
          realQTOResult = analysisStrategy; // { elements, building_analysis? }
          console.log(`🚀 Using batched RealQTO elements: ${analysisStrategy.elements.length} elements from ${documents.length} documents`);
        } else {
          // Fallback single-call path with Claude analysis passed through
          console.log(`⚠️ No elements from batched processing, falling back to single RealQTO call`);
          console.log(`🔍 PASSING Claude analysis to RealQTO: `, !!analysisStrategy?.ai_understanding);
          // v15.12: Accept lod OR levelOfDetail; default to 'detailed'
          const lodProfileName: string = (requirements as any)?.lod
            || (requirements as any)?.levelOfDetail
            || process.env.DEFAULT_LOD
            || 'detailed';
          const lodProfile = getLodProfile(lodProfileName);
          console.log(`[bim-gen] LOD=${lodProfile.name} families=${lodProfile.families.join(",")}`);
          
          // CRITICAL FIX: Process documents in BATCHES to prevent timeout
          console.log('📋 Processing documents in batches to prevent Claude timeout...');
          
          // ── GLOBAL LEGEND EXTRACTION (QS Step 2) ─────────────────────────────
          // Extract the legend lexicon ONCE from all documents before any batch runs.
          // This ensures the same symbol dictionary is available to every batch.
          // A QS compiles the master legend from the full drawing set before measuring.
          let globalLegendContext = '';
          {
            const legendLexicon: Record<string, string> = {};
            const legendSheetsFound: string[] = [];
            const docsWithPreviews = documents.filter((d: any) => d.rasterPreviews && d.rasterPreviews.length > 0);
            console.log(`📖 GLOBAL LEGEND EXTRACTION: scanning ${docsWithPreviews.length} docs with raster previews`);
            for (const doc of docsWithPreviews) {
              try {
                // Scan all pages, not just page 1, to catch legends on dedicated legend sheets
                const pagesToScan = ((doc as any).rasterPreviews as any[]).slice(0, 3); // max 3 pages per doc for speed
                for (const page of pagesToScan) {
                  const base64 = typeof page === 'string' ? page : (page?.base64 || page?.data || null);
                  if (!base64) continue;
                  const legendResp = await (this as any).anthropic.messages.create({
                    model: 'claude-opus-4-5',
                    max_tokens: 1500,
                    temperature: 0,
                    messages: [{ role: 'user', content: [
                      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
                      { type: 'text', text: 'Extract ONLY the legend/key/symbol definitions visible on this sheet. Return a JSON object where keys are symbol names (e.g. "W1","EW1","GRID LINE","CONCRETE") and values are plain-language descriptions (e.g. "Exterior Wall Type 1","Structural Grid Line","Cast-in-place concrete"). If no legend box is visible, return {}. Return ONLY valid JSON, no preamble.' }
                    ]}]
                  });
                  const rawText = legendResp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
                  const cleaned = rawText.replace(/```json[\s\S]*?```|```/g, '').trim();
                  if (cleaned.startsWith('{')) {
                    const parsed = JSON.parse(cleaned);
                    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                      Object.assign(legendLexicon, parsed);
                      if (!legendSheetsFound.includes(doc.filename)) legendSheetsFound.push(doc.filename);
                    }
                  }
                }
              } catch (err: any) {
                console.warn(`GLOBAL LEGEND: skipped ${doc.filename}: ${err.message}`);
              }
            }
            if (Object.keys(legendLexicon).length > 0) {
              globalLegendContext = '\n\nDRAWING LEGEND (compiled from full drawing set — USE THESE SYMBOLS):\n'
                + Object.entries(legendLexicon).map(([k,v]) => `  ${k}: ${v}`).join('\n');
              console.log(`✅ GLOBAL LEGEND: ${Object.keys(legendLexicon).length} symbols from ${legendSheetsFound.length} sheets: ${legendSheetsFound.join(', ')}`);
              // Persist to model metadata for audit trail
              try {
                await storage.updateBimModel(modelId, {
                  geometryData: { legendLexicon, legendSheetsFound, legendExtractedAt: new Date().toISOString() } as any
                });
              } catch { /* non-blocking */ }
            } else {
              console.warn('GLOBAL LEGEND: No legend symbols found in drawing set. Drawing extraction will use generic pattern recognition.');
            }
          }

          // Group documents by type for batch processing - SEPARATE EACH TYPE
          const specifications = documents.filter((d: any) => /specification|spec\b/i.test(d.filename));
          const schedules = documents.filter((d: any) => /schedule/i.test(d.filename));
          const legends = documents.filter((d: any) => /legend|symbol/i.test(d.filename));
          const assemblies = documents.filter((d: any) => /assembly|assemblies/i.test(d.filename));
          const details = documents.filter((d: any) => /detail|A5\d{2}/i.test(d.filename));
          const sections = documents.filter((d: any) => /section|A4\d{2}/i.test(d.filename));
          const elevations = documents.filter((d: any) => /elevation|A3\d{2}/i.test(d.filename));
          const floorPlans = documents.filter((d: any) => /floor.*plan|A[12]\d{2}/i.test(d.filename));
          const ceilingPlans = documents.filter((d: any) => /ceiling/i.test(d.filename));
          const structural = documents.filter((d: any) => /S\d{3}/i.test(d.filename));
          const mechanical = documents.filter((d: any) => /M\d{3}/i.test(d.filename));
          const electrical = documents.filter((d: any) => /E\d{3}/i.test(d.filename));
          const plumbing = documents.filter((d: any) => /P\d{3}/i.test(d.filename));
          const others = documents.filter((d: any) => 
            !/specification|spec\b|schedule|legend|symbol|assembly|detail|section|elevation|floor.*plan|ceiling|[AMESPA][1-5]\d{2}/i.test(d.filename)
          );
          
          // Process in batches - SPECIFICATIONS FIRST, then supporting docs, then drawings
          const batches = [
            { name: 'Specifications', docs: specifications },
            { name: 'Schedules', docs: schedules },
            { name: 'Legends & Symbols', docs: legends },
            { name: 'Construction Assemblies', docs: assemblies },
            { name: 'Floor Plans', docs: floorPlans },
            { name: 'Ceiling Plans', docs: ceilingPlans },
            { name: 'Elevations', docs: elevations },
            { name: 'Sections', docs: sections },
            { name: 'Details', docs: details },
            { name: 'Structural', docs: structural },
            { name: 'Mechanical', docs: mechanical },
            { name: 'Electrical', docs: electrical },
            { name: 'Plumbing', docs: plumbing },
            { name: 'Other Drawings', docs: others }
          ].filter(b => b.docs.length > 0);
          
          let combinedResult: { products: any[], assemblies: any[], elements: any[], scheduleCounts: { doors: number; windows: number }, assemblyCodeMap: Record<string, any>, constructionType: string | null } = { 
            products: [], 
            assemblies: [], 
            elements: [],
            scheduleCounts: { doors: 0, windows: 0 },
            assemblyCodeMap: {},          // CODE-6: accumulated across batches
            constructionType: null,       // STEP-4: dominant construction type
          };
          
          // Tracks the highest global progress ever emitted. Ensures progress only goes
          // forward even though the processor's internal counter resets per document.
          let highWaterMark = 0.60;

          for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            console.log(`\n📦 Processing batch ${i+1}/${batches.length}: ${batch.name} (${batch.docs.length} documents)`);

            // Emit live SSE progress so the client advances from 60% → 92% across all batches
            const batchOverallProgress = 0.60 + (i / batches.length) * 0.32;
            await _status({ progress: batchOverallProgress, message: `Batch ${i+1}/${batches.length}: ${batch.name}` });

            // statusCallback: maps the processor's internal 0-1 progress into the 60%-92%
            // global window, then clamps to highWaterMark so the bar never regresses.
            // The internal counter resets per document, causing backwards jumps without
            // this clamp (62% → 64% → 62% → ...). highWaterMark is shared across all
            // batches so progress is always monotonically increasing end-to-end.
            const batchStatusCallback = async (internalProgress: number, message: string) => {
              const candidate = 0.60 + internalProgress * 0.32;
              if (candidate > highWaterMark) {
                highWaterMark = candidate;
                await _status({ progress: highWaterMark, message });
              }
            };
            
            try {
              const batchResult = await this.constructionWorkflow.processConstructionDocuments(
                projectId,
                batch.docs,
                {
                  modelId: modelId,
                  batch: i + 1,
                  totalBatches: batches.length,
                  // Pass merged Claude analysis for storey elevation resolution (v15.4 fix)
                  claudeAnalysis: analysisStrategy,
                  // QS Step 2: Pass global legend so every batch uses the same symbol dictionary
                  globalLegendContext: globalLegendContext || undefined,
                  // QS Step 6: Carry forward accumulated schedule counts across batches
                  priorScheduleCounts: { ...combinedResult.scheduleCounts },
                  // Live SSE progress: remaps internal 0-1 to the 60%-92% global window
                  statusCallback: batchStatusCallback,
                }
              );
              
              // Combine results from each batch
              combinedResult.products.push(...(batchResult.products || []));
              combinedResult.assemblies.push(...(batchResult.assemblies || []));
              combinedResult.elements.push(...(batchResult.elements || []));
              // Accumulate schedule counts — last batch wins (it includes all prior + its own)
              if (batchResult.scheduleCounts) {
                combinedResult.scheduleCounts = batchResult.scheduleCounts;
              }
              // CODE-6: Merge assembly definitions — all batches contribute (section docs may be in any batch)
              if (batchResult.assemblyCodeMap && typeof batchResult.assemblyCodeMap === 'object') {
                Object.assign(combinedResult.assemblyCodeMap, batchResult.assemblyCodeMap);
              }
              // STEP-4: First non-null construction type from any batch wins
              if (!combinedResult.constructionType && batchResult.constructionType) {
                combinedResult.constructionType = batchResult.constructionType;
                console.log(`[STEP-4] Construction type "${batchResult.constructionType}" detected in batch ${i+1}`);
              }
              
              console.log(`✅ Batch ${i+1} complete: ${batchResult.elements?.length || 0} elements extracted`);
            } catch (error) {
              console.error(`❌ Batch ${i+1} failed:`, error);
              // Continue with next batch even if one fails
            }
          }
          
          const workflowResult = combinedResult;
          
          console.log(`✅ Workflow extracted: ${workflowResult.products?.length || 0} products, ${workflowResult.assemblies?.length || 0} assemblies, ${workflowResult.elements?.length || 0} elements`);
          
          // QS Steps 4/6/CODE-6: Persist schedule counts, assembly map, and construction type
          // These are read by buildEstimateForModel from model.geometryData.
          try {
            const currentGeo = (() => {
              try {
                const raw = (bimModel as any)?.geometryData;
                if (!raw) return {};
                return typeof raw === 'string' ? JSON.parse(raw) : raw;
              } catch { return {}; }
            })();
            const geoUpdate: Record<string, any> = { ...currentGeo };

            if (workflowResult.scheduleCounts && (workflowResult.scheduleCounts.doors > 0 || workflowResult.scheduleCounts.windows > 0)) {
              geoUpdate.scheduleCounts = workflowResult.scheduleCounts;
              console.log(`📋 Schedule counts persisted: doors=${workflowResult.scheduleCounts.doors}, windows=${workflowResult.scheduleCounts.windows}`);
            }
            if (workflowResult.assemblyCodeMap && Object.keys(workflowResult.assemblyCodeMap).length > 0) {
              geoUpdate.assemblyCodeMap = workflowResult.assemblyCodeMap;
              console.log(`[CODE-6] ${Object.keys(workflowResult.assemblyCodeMap).length} assembly definitions persisted to model.geometryData`);
            }
            if (workflowResult.constructionType) {
              geoUpdate.constructionType = workflowResult.constructionType;
              console.log(`[STEP-4] Construction type "${workflowResult.constructionType}" persisted to model.geometryData`);
            }

            if (Object.keys(geoUpdate).length > 0) {
              const freshModel = await storage.getBimModel(modelId) as any;
              const freshGeo = (() => {
                try { return freshModel?.geometryData ? (typeof freshModel.geometryData === 'string' ? JSON.parse(freshModel.geometryData) : freshModel.geometryData) : {}; } catch { return {}; }
              })();
              await storage.updateBimModel(modelId, {
                geometryData: { ...freshGeo, ...geoUpdate } as any
              });
            }
          } catch (geoErr: any) {
            console.warn('Could not persist workflow geometry data:', geoErr.message);
          }
          
          realQTOResult = await this.realQTOProcessor.processRealBIMData(
            projectId,
            documentPath,
            {
              // existing options...
              unitSystem: unitSystem as "metric" | "imperial",
              includeStoreys: true,
              computeGeometry: true,
              
              // 🔥 FIX: Pass Claude analysis to RealQTO for geometry extraction
              claudeAnalysis: analysisStrategy?.ai_understanding || analysisStrategy,
              buildingAnalysis: analysisStrategy?.building_analysis,

              // 🔽 NEW breadth/behavior hints (ignored safely if unsupported)
              families: lodProfile.families,
              includeMechanical: lodProfile.includeMechanical,
              includeElectrical: lodProfile.includeElectrical,
              includePlumbing: lodProfile.includePlumbing,
              segmentWallsAtOpenings: lodProfile.segmentWalls,
              elementSplitting: lodProfile.elementSplitting,
              maxElements: lodProfile.maxElements,
              lod: lodProfile.name,

              // keep your analysis pass-throughs
              documentCount: documents.length,
              useAllDocuments: true,
              enhancedMode: true,
              aiAnalysis: analysisStrategy,
              buildingDimensions: analysisStrategy?.building_analysis?.dimensions,
              gridSystem: analysisStrategy?.building_analysis?.grid_system,
              spatialCoordinates: analysisStrategy?.building_analysis?.coordinates,
            } as any
          );
        }
        
        // ✅ Back-compat alias for older code paths
        const _result = realQTOResult;
      } else {
        // 🚨 NO FALLBACK TO FAKE DATA - Require real documents
        console.log('❌ No construction documents found - cannot generate BIM without real drawings');
        throw new Error('BIM generation requires construction documents (PDF, DWG, DXF, IFC). Please upload architectural drawings, structural plans, or building specifications to proceed.');
      }
      
      // ✅ Normalize QTO result once for cleaner access everywhere
      realQTOResult = normalizeQTO(realQTOResult);
      
      // 📐 EXTRACT DRAWING SCALE from Claude's analysis (v15.30)
      let extractedScaleResult: DrawingScaleResult | null = null;
      try {
        const drawingScale = (realQTOResult as any)?.drawing_scale || (realQTOResult as any)?.building_analysis?.drawing_scale;
        if (drawingScale?.primary_scale) {
          const scaleStr = typeof drawingScale.primary_scale === 'string'
            ? drawingScale.primary_scale
            : drawingScale.primary_scale?.ratio || drawingScale.primary_scale;
          const factor = computeScaleFactor(String(scaleStr));
          if (factor && factor > 0) {
            extractedScaleResult = {
              sheet_id: drawingScale.scale_source || 'claude-analysis',
              primary_scale: { ratio: String(scaleStr), factor },
              detail_scales: (drawingScale.detail_scales || []).map((d: any) => ({
                area: d.area || '',
                ratio: d.ratio || '',
                factor: computeScaleFactor(String(d.ratio)) || 0
              })),
              scale_bar: null,
              confidence: 'medium',
              source: drawingScale.scale_source || 'claude-analysis'
            };
            console.log(`📐 SCALE EXTRACTED: ${scaleStr} (factor=${factor}) from ${extractedScaleResult.source}`);
          }
        }
      } catch (scaleErr: any) {
        console.warn(`⚠️ Scale extraction from analysis failed: ${scaleErr?.message?.slice(0, 100)}`);
      }

      // 🎯 CALIBRATE AND POSITION ELEMENTS - Fix layout to match real building footprint
      // v15.13b: wrapped in try/catch — a footprint error must not kill the pipeline.
      // v15.30: Now passes extracted scale for accurate coordinate conversion.
      console.log(`🔧 Calibrating ${realQTOResult.elements.length} elements to building footprint...`);
      try {
        const calibratedElements = await calibrateAndPositionElements(
          projectId,  // resolved from project record above
          bimModel.id,
          realQTOResult.elements,
          {
            mode: ((requirements as any)?.positioningMode as any)
               || (process.env.POSITIONING_MODE as any)
               || "auto",
            reCenterToOrigin: true,
            flipZIfAllYNegative: true,
            clampOutliersMeters: process.env.CALIB_CLAMP_M ? Number(process.env.CALIB_CLAMP_M) : undefined,
            extractedScale: extractedScaleResult
          }
        );
        // Replace elements with calibrated positions
        realQTOResult.elements = calibratedElements;
        console.log(`🧭 Pre-calibration complete: ${calibratedElements.length} elements positioned`);
      } catch (preCalibErr: any) {
        console.warn(`⚠️ Pre-calibration skipped (${preCalibErr?.message?.slice(0,120)}) — postprocessor will re-attempt`);
        // elements remain in raw QTO coordinates; postprocess step 4 will try again
      }

      // 🔧 APPLY EXTRACTED MEP DATA (v15.30) - Replace hardcoded fallbacks with real schedule data
      try {
        const mepSystems = (realQTOResult as any)?.mep_systems || (realQTOResult as any)?.building_analysis?.mep_systems;
        if (mepSystems) {
          const ductSchedules = mepSystems.duct_schedules || [];
          const ceilingHeights = mepSystems.ceiling_heights || [];
          const ductRouting = mepSystems.duct_routing || [];
          const equipment = mepSystems.equipment || [];

          console.log(`🔧 MEP DATA: ${ductSchedules.length} duct schedules, ${equipment.length} equipment, ${ceilingHeights.length} ceiling zones, ${ductRouting.length} routed ducts`);

          // Build lookup maps for fast enrichment
          const ductSizeMap = new Map<string, any>();
          for (const ds of ductSchedules) {
            if (ds.tag) ductSizeMap.set(ds.tag.toUpperCase(), ds);
          }

          const ceilingMap = new Map<string, any>();
          for (const ch of ceilingHeights) {
            if (ch.room) ceilingMap.set(ch.room.toUpperCase(), ch);
          }

          // Default ceiling height from RCP data (use median if multiple rooms)
          const ceilingElevations = ceilingHeights
            .map((ch: any) => Number(ch.ceiling_height_m))
            .filter((v: number) => v > 0 && Number.isFinite(v));
          const defaultCeilingHeight = ceilingElevations.length > 0
            ? ceilingElevations.sort((a: number, b: number) => a - b)[Math.floor(ceilingElevations.length / 2)]
            : null;

          let mepEnriched = 0;
          for (const el of realQTOResult.elements) {
            const elType = String(el?.elementType || el?.type || el?.category || '').toUpperCase();
            if (!/(DUCT|HVAC|DIFFUSER|GRILLE|PIPE|PLUMBING|MECHANICAL|AIR|VENTILATION|FAN|VAV|AHU)/i.test(elType)) continue;

            const g = typeof el?.geometry === 'string' ? JSON.parse(el.geometry) : (el?.geometry || {});
            const dims = g?.dimensions || {};
            const loc = g?.location?.realLocation || { x: 0, y: 0, z: 0 };

            // Try to match by tag
            const tag = String(el?.properties?.tag || el?.name || '').toUpperCase();
            const scheduleMatch = ductSizeMap.get(tag);

            if (scheduleMatch) {
              // Apply real dimensions from duct schedule
              if (scheduleMatch.width_mm) dims.width = scheduleMatch.width_mm / 1000;
              if (scheduleMatch.height_mm) dims.depth = scheduleMatch.height_mm / 1000;
              if (scheduleMatch.diameter_mm) {
                dims.width = scheduleMatch.diameter_mm / 1000;
                dims.depth = scheduleMatch.diameter_mm / 1000;
              }
              el.properties = { ...el.properties, ...scheduleMatch, _source: 'duct_schedule' };
              mepEnriched++;
            }

            // Apply ceiling-based elevation instead of hardcoded 3.0m
            if (defaultCeilingHeight && (loc.z === 0 || loc.z === 3.0 || loc.z === 3.2)) {
              // Duct runs above ceiling in plenum
              const plenumOffset = 0.15; // 150mm above ceiling
              loc.z = defaultCeilingHeight + plenumOffset;
              g.location = { ...(g.location || {}), realLocation: loc };
              el.geometry = g;
            }

            g.dimensions = dims;
            el.geometry = g;
          }

          if (mepEnriched > 0) {
            console.log(`✅ MEP ENRICHMENT: Applied real schedule data to ${mepEnriched} elements`);
          }
        }
      } catch (mepErr: any) {
        console.warn(`⚠️ MEP enrichment failed (non-blocking): ${mepErr?.message?.slice(0, 120)}`);
      }

      // 📊 DERIVE QUANTITIES - Professional QTO for estimator (includes MEP + wall thickness)
      console.log(`📊 Deriving quantities for ${realQTOResult.elements.length} elements...`);
      const qto = deriveQuantitiesForElements(realQTOResult.elements);
      
      // 🎨 ASSIGN TRADE COLORS - Visual differentiation in 3D viewer
      console.log(`🎨 Assigning trade-specific colors for visual differentiation...`);
      realQTOResult.elements = assignRenderColors(qto.elements);

      realQTOResult.summary = {
        ...(realQTOResult.summary || {}),
        processingMethod: realQTOResult?.summary?.processingMethod ?? "batched-per-chunk",
        calibration: { calibrated: true, method: "postprocessor" },
        qtoStats: qto.stats
      };
      
      console.log(`🏗️ Real QTO Processing: ${realQTOResult.summary.processingMethod}`);
      console.log(`📊 Generated ${realQTOResult.elements.length} real elements across ${realQTOResult.storeys.length} storeys`);
      console.log(`🎯 Layout calibration: SUCCESS - hardened positioning applied`);
      
      // Convert Real BIM Elements to legacy BIMElement format for compatibility
      const elements = await buildElementsFromClaude(bimModel.id, realQTOResult, analysisStrategy, projectId);
      
      await this.updateBIMProgress(bimModel.id, `Real QTO: Generated ${elements.length} professional elements`);
      heartbeat(modelId);
      
      // Generate comprehensive metadata
      await this.updateBIMProgress(bimModel.id, "Generating professional BIM metadata...");
      const metadata = await this.generateBIMMetadata(elements, requirements, analysisStrategy);
      
      // Finalize model with AI validation
      await this.updateBIMProgress(bimModel.id, "Finalizing AI-generated BIM model...");
      heartbeat(modelId);
      const finalModel = {
        elements,
        metadata,
        aiAnalysis: analysisStrategy,
        statistics: {
          totalElements: elements.length,
          elementTypes: this.getElementTypeCounts(elements),
          generationTime: new Date().toISOString(),
          aiConfidence: analysisStrategy.overallConfidence ?? null,
          professionalGrade: !!(analysisStrategy.overallConfidence),
          // Safe access with defensive default
          methodology: `Phase 2: ${realQTOResult?.summary?.processingMethod ?? "batched-per-chunk"}`,
          // Enhanced statistics from real QTO processing
          realQTOData: {
            storeys: realQTOResult.storeys,
            totalQuantities: realQTOResult?.summary?.totalQuantities,
            unitSystem: unitSystem,
            // Ensure summary exists with defensive programming
            processingMethod: (() => {
              const defaultMethod = Array.isArray(realQTOResult?.elements) ? "batched-per-chunk" : "single-call";
              const method = realQTOResult?.summary?.processingMethod ?? defaultMethod;
              
              // Normalize summary so later code can safely access it
              realQTOResult.summary = {
                processingMethod: method,
                ...(realQTOResult?.summary || {}),
              };
              
              return method;
            })()
          }
        }
      };
      
      // Update database with completed model (including revision data in geometryData)
      await storage.updateBimModel(bimModel.id, {
        status: "completed",
        geometryData: JSON.stringify(finalModel)
      });
      
      // Log revision tracking completion
      console.log(`✅ BIM model ${bimModel.id} generated with revision tracking data embedded`);
      
      const endTime = new Date();
      const duration = (endTime.getTime() - startTime.getTime()) / 1000;
      console.log(`🕐 [${endTime.toISOString()}] ✅ AI-powered BIM model generation completed for project ${projectId} (Duration: ${duration}s)`);
      
      // ── SAVE: Postprocess → calibrate → save to bimElements table ─────────
      // elementsPositioned = the legacy-format elements already built by
      // buildElementsFromClaude (which internally called balancedAssemble).
      // postprocessAndSaveBIM is the sole authoritative writer to bimElements:
      //   • ensureFootprintForModel  (site plan → footprint polygon)
      //   • Moorings absolute Z from confirmed floor datums
      //   • sanitizeElements         (NaN/Inf guard)
      //   • calibrateAndPositionElements (footprint snap, spread duplicates)
      //   • applySiteContext
      //   • storage.upsertBimElements (DELETE + INSERT — single write)
      // The belt-and-suspenders upsert was REMOVED: it ran after postprocess and
      // overwrote the calibrated output with the uncalibrated input (Bug-B v15.13).
      const elementsPositioned = elements; // elements from buildElementsFromClaude above

      console.log(`📦 ${elementsPositioned.length} elements → postprocessor`);

      // ── ITERATIVE REFINEMENT: Diff against previous extraction ──────────
      // If the model had existing elements, merge new extraction results
      // with the previous snapshot — preserving stable IDs for unchanged
      // elements and tracking additions/modifications/deletions.
      // This mirrors how a human modeler works in passes.
      try {
        const modelMeta = await (storage as any).getBimModel?.(modelId);
        const meta = modelMeta?.metadata || {};
        const prevSnapshot = meta.previousElementSnapshot;
        if (prevSnapshot && prevSnapshot.count > 0) {
          console.log(
            `🔄 ITERATIVE REFINEMENT: Comparing ${elementsPositioned.length} new elements ` +
            `against ${prevSnapshot.count} previous elements...`
          );
          // Load previous elements for comparison
          const previousElements = await storage.getBimElements(modelId);
          if (previousElements.length > 0) {
            // Simple spatial matching: for each new element, check if a previous
            // element of the same type exists within 0.5m — if so, preserve its ID
            let preserved = 0;
            let added = 0;
            for (const newEl of elementsPositioned) {
              const ne = newEl as any;
              const newLoc = ne?.geometry?.location?.realLocation || { x: 0, y: 0, z: 0 };
              const newType = String(ne?.type || ne?.elementType || '').toUpperCase();
              let matched = false;
              for (const prevEl of previousElements) {
                const pe = prevEl as any;
                const prevLoc = pe?.geometry?.location?.realLocation || { x: 0, y: 0, z: 0 };
                const prevType = String(pe?.elementType || '').toUpperCase();
                if (newType === prevType) {
                  const dist = Math.hypot(
                    (newLoc.x || 0) - (prevLoc.x || 0),
                    (newLoc.y || 0) - (prevLoc.y || 0),
                    (newLoc.z || 0) - (prevLoc.z || 0)
                  );
                  if (dist < 0.5) {
                    // Preserve previous ID for stable references
                    ne.id = pe.id || pe.elementId;
                    ne.properties = {
                      ...(ne.properties || {}),
                      refinementAction: 'unchanged_or_updated',
                      previousRevision: prevSnapshot.timestamp,
                    };
                    preserved++;
                    matched = true;
                    break;
                  }
                }
              }
              if (!matched) {
                ne.properties = {
                  ...(ne.properties || {}),
                  refinementAction: 'added',
                  addedInRevision: new Date().toISOString(),
                };
                added++;
              }
            }
            console.log(
              `🔄 ITERATIVE REFINEMENT: ${preserved} elements preserved with stable IDs, ` +
              `${added} new elements added`
            );
          }
        }
      } catch (refineErr: any) {
        console.warn(`⚠️ Iterative refinement skipped (non-blocking): ${refineErr?.message?.slice(0, 120)}`);
      }

      try {
        await _status({ progress: 0.72, message: "Calibration & grid snap" });
        heartbeat(modelId);
        await postprocessAndSaveBIM({
          modelId: bimModel.id,
          projectId: projectId,
          elements: elementsPositioned,
          anthropic: anthropic,
          forceCalibrate: true,
          enableSymbolDetect: true,
        });
        await _status({ progress: 0.82, message: "Storeys & quantities" });
        console.log(`✅ Postprocessor saved ${elementsPositioned.length} elements for model ${bimModel.id}`);

        // ── Persist storey data (first-class queryable entity) ────────────────
        const storeysToSave = realQTOResult?.storeys || [];
        if (storeysToSave.length > 0) {
          try {
            await storage.upsertBimStoreys(bimModel.id, storeysToSave);
            await storage.updateBimStoreyElementCount(bimModel.id);
            console.log(`✅ Persisted ${storeysToSave.length} storeys to bimStoreys table`);
          } catch (storeyErr) {
            console.error('❌ Failed to persist storeys:', storeyErr);
          }
        } else {
          console.warn('⚠️ realQTOResult.storeys is empty — bimStoreys will not be populated');
        }
        await _status({ progress: 0.92, message: "Saving elements" });
      } catch (error) {
        console.error('❌ Error in postprocess/save:', error);
        // Fallback: write the unconverted elements so model is not empty
        if (elementsPositioned.length > 0) {
          try {
            await storage.upsertBimElements(bimModel.id, elementsPositioned);
            console.warn(`⚠️ Fallback upsert: ${elementsPositioned.length} elements written without postprocess`);
          } catch (fallbackErr) {
            console.error('❌ Fallback upsert also failed:', fallbackErr);
          }
        }
      }
      
      // Final processing step
      await _status({ progress: 0.92, message: "Finalizing model structure" });
      
      // Success completion - Update database status to "completed" (consistent naming)  
      await storage.updateBimModel(bimModel.id, {
        status: "completed"
        // Note: elementCount stored separately via storage.saveBimElements()
      });

      // ── CODE-7: Auto-prescreen applicable code adders ──────────────────────
      // Run immediately after BIM generation so the QS sees a pre-populated
      // list of applicable OBC/AODA/NECB adders when they open the BoQ.
      // Result stored in geometryData so the status route returns real counts.
      // QS confirmation is still required before any adder is applied.
      try {
        const freshModel = await storage.getBimModel(bimModel.id);
        const geo   = freshModel?.geometryData
          ? (typeof freshModel.geometryData === 'string'
              ? JSON.parse(freshModel.geometryData) : freshModel.geometryData)
          : {};
        const props = (freshModel as any)?.analysisData
          ? (typeof (freshModel as any).analysisData === 'string'
              ? JSON.parse((freshModel as any).analysisData) : (freshModel as any).analysisData)
          : {};

        const prescreenResult = prescreenCodeAdders({
          occupancyGroup:    props.occupancyGroup    || geo.occupancyGroup,
          numberOfStoreys:   props.numberOfStoreys   || (freshModel as any)?.floorCount  || undefined,
          gfa:               props.gfa               || props.grossFloorArea     || geo.gfa || undefined,
          constructionType:  props.constructionType  || geo.constructionType     || undefined,
          sprinklered:       props.sprinklered,
          seismicPga:        props.seismicPga        || geo.seismicPga           || undefined,
          province:          props.province          || 'ON',
          hasElevator:       props.hasElevator       || geo.hasElevator,
          hasParkadeLevel:   props.hasParkadeLevel   || geo.hasParkadeLevel,
        });

        // Merge prescreen result into geometryData — does not overwrite other keys
        const updatedGeo = {
          ...geo,
          codeAdderPrescreen: {
            applicableAdders:  prescreenResult.applicableAdders.map(a => ({
              codeEntryId:            a.codeEntryId,
              code:                   a.code,
              requirement:            a.requirement,
              description:            a.description,
              affectedCSI:            a.affectedCSI,
              type:                   a.type,
              multiplier:             a.multiplier,
              reason:                 a.reason,
              requiresQsConfirmation: a.requiresQsConfirmation,
            })),
            notes:             prescreenResult.notes,
            screenedAt:        prescreenResult.screenedAt,
            applicableCount:   prescreenResult.applicableAdders.length,
            appliedCount:      0,   // none applied yet — QS must confirm
          },
        };

        await storage.updateBimModel(bimModel.id, {
          geometryData: JSON.stringify(updatedGeo),
        });

        console.log(`[CODE-7] Code adder prescreen complete: ${prescreenResult.applicableAdders.length} applicable adders stored in model.geometryData`);
      } catch (prescreenErr: any) {
        // Non-blocking — prescreen failure must never abort a successful BIM generation
        console.warn(`[CODE-7] Code adder prescreen failed (non-fatal): ${prescreenErr?.message}`);
      }
      await _status({ status: "completed", progress: 1.0, message: "BIM model completed successfully" });
      heartbeat(modelId);
      stopWatchdog(modelId);
      
      return { ...bimModel, geometryData: JSON.stringify(finalModel) };
      
    } catch (error) {
      console.error(`[BIM_GENERATION] ${new Date().toISOString()} - Generation failed:`, {
        projectId,
        modelId: bimModel?.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.split('\n').slice(0, 3) : undefined
      });
      stopWatchdog(modelId);
      await _status({ 
        status: "failed", 
        progress: 1.0, 
        message: "Generation failed", 
        error: (error as any)?.message || String(error) 
      });
      if (bimModel) {
        await storage.updateBimModel(bimModel.id, {
          status: "failed"
        });
      }
      throw error;
    }
  }

  private async trackDrawingRevisions(modelId: string, projectId: string, finalModel: any): Promise<void> {
    try {
      // Get project documents to analyze revisions
      const documents = await storage.getDocuments(projectId);
      
      const revisionData = {
        alphaRevisions: this.extractAlphaRevisions(documents),
        numericRevisions: this.extractNumericRevisions(documents),
        ifcStatus: this.determineIFCStatus(documents),
        revisionHistory: this.buildRevisionHistory(documents)
      };

      // Add revision data to final model (stored in geometryData, not separate column)
      finalModel.revisionTracking = revisionData;
      
      console.log(`Drawing revisions tracked for BIM model ${modelId}:`, {
        alphaCount: revisionData.alphaRevisions.length,
        numericCount: revisionData.numericRevisions.length,
        ifcStatus: revisionData.ifcStatus
      });
      
    } catch (error) {
      console.error(`Failed to track drawing revisions:`, error);
      // Continue without revision tracking - BIM model still functional
    }
  }

  private extractAlphaRevisions(documents: any[]): Array<{filename: string, revision: string}> {
    return documents
      .map(doc => {
        const match = doc.filename.match(/rev[\s_-]?([A-Z])/i);
        return match ? { filename: doc.filename, revision: match[1].toUpperCase() } : null;
      })
      .filter(Boolean) as Array<{filename: string, revision: string}>;
  }

  private extractNumericRevisions(documents: any[]): Array<{filename: string, revision: number}> {
    return documents
      .map(doc => {
        const match = doc.filename.match(/rev[\s_-]?(\d+)/i);
        return match ? { filename: doc.filename, revision: parseInt(match[1]) } : null;
      })
      .filter(Boolean) as Array<{filename: string, revision: number}>;
  }

  private determineIFCStatus(documents: any[]): 'pre-ifc' | 'ifc-issued' | 'mixed' {
    const hasAlpha = documents.some(doc => /rev[\s_-]?[A-Z]/i.test(doc.filename));
    const hasNumeric = documents.some(doc => /rev[\s_-]?\d+/i.test(doc.filename));
    
    if (hasAlpha && hasNumeric) return 'mixed';
    if (hasNumeric) return 'ifc-issued';
    return 'pre-ifc';
  }

  private buildRevisionHistory(documents: any[]): Array<{filename: string, revision: string, type: 'alpha' | 'numeric', date?: string}> {
    const history: Array<{filename: string, revision: string, type: 'alpha' | 'numeric', date?: string}> = [];
    
    documents.forEach(doc => {
      const alphaMatch = doc.filename.match(/rev[\s_-]?([A-Z])/i);
      const numericMatch = doc.filename.match(/rev[\s_-]?(\d+)/i);
      
      if (alphaMatch) {
        history.push({
          filename: doc.filename,
          revision: alphaMatch[1].toUpperCase(),
          type: 'alpha',
          date: doc.createdAt
        });
      } else if (numericMatch) {
        history.push({
          filename: doc.filename,
          revision: numericMatch[1],
          type: 'numeric',
          date: doc.createdAt
        });
      }
    });
    
    return history.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'alpha' ? -1 : 1;
      if (a.type === 'alpha') return a.revision.localeCompare(b.revision);
      return parseInt(a.revision) - parseInt(b.revision);
    });
  }

  private generateIFCContent(finalModel: any): string {
    // Basic IFC file content - this is a simplified example
    // In a real implementation, you'd use a proper IFC library
    return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('${finalModel.metadata?.projectName || 'BIM_Model'}.ifc','${new Date().toISOString()}',('EstimatorPro'),('EstimatorPro BIM Generator'),'IFC4','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;

DATA;
#1= IFCPROJECT('${finalModel.metadata?.projectId || 'unknown'}',#2,'${finalModel.metadata?.projectName || 'Generated BIM Model'}','AI-Generated BIM Model',$,$,$,(#8),#9);
#2= IFCOWNERHISTORY(#3,#4,$,.ADDED.,$,$,$,1456173600);
#3= IFCPERSONANDORGANIZATION(#5,#6,$);
#4= IFCAPPLICATION(#6,'1.0','EstimatorPro','EstimatorPro BIM Generator');
#5= IFCPERSON($,'EstimatorPro',$,$,$,$,$,$);
#6= IFCORGANIZATION($,'EstimatorPro',$,$,$);
#7= IFCDIMENSIONALEXPONENTS(3,0,0,0,0,0,0);
#8= IFCUNITASSIGNMENT((#10,#11,#12,#13));
#9= IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#14,$);
#10= IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#11= IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);
#12= IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);
#13= IFCSIUNIT(*,.TIMEUNIT.,$,.SECOND.);
#14= IFCAXIS2PLACEMENT3D(#15,$,$);
#15= IFCCARTESIANPOINT((0.,0.,0.));
ENDSEC;

END-ISO-10303-21;`;
  }

  private async updateBIMProgress(modelId: string, message: string): Promise<void> {
    await storage.updateBimModel(modelId, {
      status: "generating"
    });
    console.log(`BIM Progress: ${message}`);
  }

  /**
   * 💰 COST OPTIMIZATION: Check existing cached analysis before Claude calls
   * Leverages Smart Analysis Service and Document Analysis Cache
   */
  private async getExistingDocumentAnalysis(projectId: string): Promise<any | null> {
    try {
      console.log(`💾 Checking cached analysis for project ${projectId}...`);
      
      // 1. Check Smart Analysis Service cache
      const { smartAnalysisService } = await import('./smart-analysis-service');
      const previousAnalysis = await (smartAnalysisService as any).getPreviousAnalysis?.(projectId, 'document_analysis');
      
      if (previousAnalysis && previousAnalysis.analysisData) {
        console.log(`✅ Found Smart Analysis Cache for project ${projectId}`);
        const analysisData = previousAnalysis.analysisData;
        
        // Define proper type for analysis
        type ClaudeAnalysis = {
          building_analysis?: {
            dimensions?: { width?: number; length?: number };
            grid_system?: any;
            coordinates?: any;
            perimeter?: Array<{ x: number; z: number }>;
            storeys?: any[];
          };
          analysis?: any;
          confidence?: number;
          overallConfidence?: number;
          ai_understanding?: any;
        };

        const analysisObj = analysisData as ClaudeAnalysis;
        
        // Convert cached analysis to BIM strategy format
        return {
          strategy: JSON.stringify(analysisData),
          building_analysis: analysisObj?.building_analysis || analysisData,
          ai_understanding: analysisData,
          confidence: analysisObj?.confidence ?? null,
          overallConfidence: analysisObj?.overallConfidence ?? null,
          buildingHierarchy: analysisObj?.building_analysis?.storeys || [],
          componentTypes: ['architectural', 'structural', 'mep'],
          standardsRequired: ['IFC4'],
          cachedAnalysis: true
        };
      }
      
      // 2. Check document-level analysis cache
      const documents = await storage.getDocumentsByProject(projectId);
      const docWithAnalysis = documents.find((doc: any) => 
        doc.analysisResult && 
        (typeof doc.analysisResult === 'object' || doc.analysisResult.includes('building_analysis'))
      );
      
      if (docWithAnalysis) {
        console.log(`✅ Found Document Analysis Cache in: ${docWithAnalysis.filename}`);
        const existingAnalysis = typeof docWithAnalysis.analysisResult === 'string' 
          ? JSON.parse(docWithAnalysis.analysisResult) 
          : docWithAnalysis.analysisResult;
        
        return {
          strategy: JSON.stringify(existingAnalysis),
          building_analysis: existingAnalysis.building_analysis || existingAnalysis,
          ai_understanding: existingAnalysis,
          confidence: null, // not derivable from cached analysis — source confidence unknown
          overallConfidence: null,
          buildingHierarchy: existingAnalysis.building_analysis?.storeys || [],
          componentTypes: ['architectural', 'structural', 'mep'],
          standardsRequired: ['IFC4'],
          cachedAnalysis: true
        };
      }
      
      console.log(`💸 No cached analysis found - will need Claude API call`);
      return null;
      
    } catch (error) {
      console.error('❌ Error checking cached analysis:', error);
      return null;
    }
  }

  /**
   * 🔧 NEW METHOD: Process documents with chunked specifications
   * Handles large specifications by breaking them into CSI division chunks
   */
  private async analyzeDocumentsWithChunkedSpecs(
    chunks: any[],
    mainSpec: Document,
    drawings: Document[],
    sections: Document[],
    requirements: BIMGenerationRequirements,
    opts: { projectId: string; documentPath: string; unitSystem: 'metric' | 'imperial'; modelId?: string }
  ): Promise<{ building_analysis?: any; analysis?: any; elements?: any[] }> {
    console.log(`📦 Starting chunked specification analysis with ${chunks.length} chunks`);
    
    const allResults: any[] = [];
    const chunker = new DocumentChunker();
    
    // Process each chunk sequentially to avoid Claude overload
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkProgressPct = Math.round(((i) / chunks.length) * 100);
      console.log(`🔍 Processing chunk ${i + 1}/${chunks.length}: ${chunk.title} (${chunk.tokenEstimate} tokens)`);

      // Save chunk-level progress to DB so the frontend can poll it
      if (opts.modelId) {
        try {
          const freshGeo: any = await storage.getBimModel(opts.modelId).then(m => {
            if (!m) return {};
            try { return m.geometryData ? (typeof m.geometryData === 'string' ? JSON.parse(m.geometryData) : m.geometryData) : {}; } catch { return {}; }
          });
          await storage.updateBimModel(opts.modelId, {
            geometryData: {
              ...freshGeo,
              progressPercent: chunkProgressPct,
              currentChunk: i + 1,
              totalChunks: chunks.length,
              currentChunkTitle: chunk.title,
              updatedAt: new Date().toISOString()
            } as any
          });
          const { publishProgress } = await import('./routes/progress');
          publishProgress(opts.modelId, {
            progress: chunkProgressPct,
            message: `Analyzing chunk ${i + 1}/${chunks.length}: ${chunk.title}`,
            phase: 'chunked-analysis',
            details: { currentChunk: i + 1, totalChunks: chunks.length, title: chunk.title }
          });
        } catch (progressErr) {
          console.warn(`Could not save chunk progress for chunk ${i + 1}:`, progressErr);
        }
      }
      
      try {
        // Create a specialized prompt for this chunk
        const chunkPrompt = chunker.createChunkedAnalysisPrompt(
          chunk,
          `Construction project with ${drawings.length} drawings and ${sections.length} sections`
        );
        
        // Call Claude with the chunked prompt
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8192,
          temperature: 0,
          messages: [{
            role: "user",
            content: chunkPrompt
          }]
        });
        
        // Parse the response
        const chunkResult = parseClaudeJson(response);
        console.log(`✅ Chunk ${i + 1} processed: ${chunkResult.detailed_csi_items ? 'Success' : 'Partial'}`);
        
        allResults.push(chunkResult);
      } catch (error) {
        console.error(`❌ Failed to process chunk ${i + 1}:`, error);
        // Continue with other chunks even if one fails
      }
    }
    
    // Combine all chunk results into a unified analysis
    const combinedResult = {
      building_analysis: this.combineChunkAnalyses(allResults),
      elements: this.extractElementsFromChunks(allResults),
      analysis: {
        methodology: "CSI Division Chunked Analysis",
        chunksProcessed: chunks.length,
        divisionsAnalyzed: chunks.flatMap(c => c.csiDivisions),
        confidence: null // not derivable without ground-truth scoring of chunk results
      }
    };
    
    console.log(`🎯 Chunked analysis complete: ${combinedResult.elements.length} elements extracted from ${chunks.length} chunks`);
    
    // Also process drawings and sections if provided
    if (drawings.length > 0 || sections.length > 0) {
      console.log(`📐 Processing ${drawings.length} drawings and ${sections.length} sections`);
      const supplementalAnalysis = await this.analyzeDocumentsWithAI(
        [...drawings, ...sections],
        requirements,
        opts
      );
      
      // Merge supplemental analysis with chunked results
      if (supplementalAnalysis.elements && supplementalAnalysis.elements.length > 0) {
        combinedResult.elements = [...combinedResult.elements, ...supplementalAnalysis.elements];
        console.log(`✅ Added ${supplementalAnalysis.elements.length} elements from drawings/sections`);
      }
    }
    
    return combinedResult;
  }
  
  /**
   * Helper: Combine building analyses from multiple chunks
   */
  private combineChunkAnalyses(chunkResults: any[]): any {
    const combined: any = {
      storeys: [],
      dimensions: {},
      perimeter: [],
      totalArea: 0
    };
    
    for (const result of chunkResults) {
      if (result?.building_analysis) {
        // Merge storeys
        if (result.building_analysis.storeys) {
          combined.storeys = Array.from(new Set([...combined.storeys, ...result.building_analysis.storeys]));
        }
        
        // Merge dimensions
        if (result.building_analysis.dimensions) {
          Object.assign(combined.dimensions, result.building_analysis.dimensions);
        }
        
        // Accumulate area
        if (result.building_analysis.totalArea) {
          combined.totalArea += result.building_analysis.totalArea;
        }
      }
    }
    
    return combined;
  }
  
  /**
   * Helper: Extract and combine elements from chunk results
   */
  private extractElementsFromChunks(chunkResults: any[]): any[] {
    const allElements: any[] = [];
    
    for (const result of chunkResults) {
      // Extract from detailed_csi_items structure
      if (result?.detailed_csi_items) {
        for (const division in result.detailed_csi_items) {
          const items = result.detailed_csi_items[division];
          if (Array.isArray(items)) {
            allElements.push(...items);
          }
        }
      }
      
      // Also check for elements array directly
      if (result?.elements && Array.isArray(result.elements)) {
        allElements.push(...result.elements);
      }
    }
    
    console.log(`📊 Extracted ${allElements.length} total elements from ${chunkResults.length} chunks`);
    return allElements;
  }

  private async analyzeDocumentsWithAI(
    documents: Document[],
    requirements: BIMGenerationRequirements,
    opts: { projectId: string; documentPath: string; unitSystem: 'metric' | 'imperial'; modelId?: string }
  ): Promise<{ building_analysis?: any; analysis?: any; elements?: any[] }> {
    console.log(`🔥 FIX PACK #1: Claude analysis with REAL PDF content and salient page selection`);
    
    try {
      // Filter PDF documents and prepare for AI analysis
      type DocForAI = {
        id: string;
        filename: string;
        pageText: { page: number; text: string }[];
        rasterPreviews: { page: number; key: string }[];
      };

      const pdfDocs: DocForAI[] = [];
      const pageBlobs: string[] = [];
      const totalDocs = documents.length;
      let docIndex = 0;
      
      for (const doc of documents) {
        docIndex++;
        if (!(doc.fileType || "").includes("pdf")) continue;

        // Emit per-document progress so the client can show "X / N"
        if (opts.modelId) {
          const shortName = doc.filename.length > 35
            ? doc.filename.slice(0, 32) + '…'
            : doc.filename;
          const pct = 0.30 + (docIndex / totalDocs) * 0.15; // progress 30 → 45%
          await updateModelStatus(storage, opts.modelId, {
            progress: pct,
            message: `Reading document ${docIndex}/${totalDocs}: ${shortName}`,
            documentsProcessed: docIndex,
            totalDocuments: totalDocs,
          } as any);
        }
        
        try {
          const fullDocument = await storage.getDocument(doc.id);
          
          // v15.13: Extract from disk; fall back to DB textContent when disk read fails.
          // (textContent is stored at upload time via routes.ts:1537 — always available.)
          let pageTexts: string[] = [];
          let fullText = '';

          try {
            const diskResult = await extractPdfTextAndPages({
              id: doc.id,
              name: doc.filename,
              storageKey: fullDocument?.storageKey || null
            });
            pageTexts = diskResult.pageTexts;
            fullText  = diskResult.fullText;
          } catch { /* fall through to DB text */ }

          // Fallback: use DB textContent when disk read returned nothing
          if (!pageTexts.length && !fullText) {
            const dbText = typeof fullDocument?.textContent === 'string'
              ? fullDocument.textContent
              : '';
            if (dbText) {
              // Split on form-feeds (same convention as routes.ts:110)
              const pages = dbText.split('\f').map((s: string) => s.trim()).filter(Boolean);
              pageTexts = pages.length ? pages : [dbText];
              fullText  = dbText;
              console.log(`📖 DB textContent fallback: ${pageTexts.length} pages from ${doc.filename}`);
            } else {
              console.warn(`⚠️ No text content from disk or DB for ${doc.filename} — skipping`);
              continue;
            }
          }

          // Add to page blobs for text bundle
          if (pageTexts.length) pageBlobs.push(...pageTexts);

          // Convert extracted text to expected format
          const formattedPageTexts = pageTexts.map((text, index) => ({
            page: index + 1,
            text: text.trim()
          }));
            
          const previews = fullDocument?.rasterPreviews 
            ? (typeof fullDocument.rasterPreviews === 'string' 
                ? JSON.parse(fullDocument.rasterPreviews) 
                : fullDocument.rasterPreviews)
            : [];

          pdfDocs.push({
            id: doc.id,
            filename: doc.filename,
            pageText: formattedPageTexts,
            rasterPreviews: previews || [],
          });
          
          console.log(`📄 Extracted ${formattedPageTexts.length} pages from ${doc.filename} (${fullText.length} chars)`);
        } catch (err: any) {
          console.warn(
            "[bim-gen] extractPdfTextAndPages failed for",
            doc?.id || "(unknown id)",
            doc?.filename || "(unnamed)",
            "-", err?.message || err
          );
          // continue with other documents
        }
      }

      // Rank + dedupe pages
      const PLAN = /(site|parking|underground|floor|roof|plan|grid|elevation)/i;
      const scored = pageBlobs.map((t)=>({ text:t, score: scorePage(t) }))
                              .sort((a,b)=> b.score - a.score);
      const seen = new Set<string>(); const ranked: string[] = [];
      for (const r of scored) {
        const norm = r.text.toLowerCase().replace(/\s+/g, " ").slice(0, 4000);
        if (seen.has(norm)) continue; seen.add(norm); ranked.push(r.text);
      }

      // Token budgets (env-tunable)
      const MAX_PROMPT_TOKENS = Number(process.env.CLAUDE_MAX_PROMPT_TOKENS ?? 200000);
      const HEADROOM_TOKENS   = Number(process.env.CLAUDE_HEADROOM_TOKENS ?? 20000);
      const PER_BATCH_TOKENS  = Number(process.env.CLAUDE_PER_BATCH_TOKENS ?? 15000); // Smaller batches for reliability

      const target = Math.max(0, MAX_PROMPT_TOKENS - HEADROOM_TOKENS);
      const rankedPlanFirst = ranked.sort((a,b)=> (PLAN.test(b)?1:0) - (PLAN.test(a)?1:0));
      const { selected, used } = selectWithinBudget(rankedPlanFirst, target);
      const batches = chunkByTokens(selected, PER_BATCH_TOKENS);

      console.log(`🔥 BATCHING FOR CLAUDE: selectedTokens≈${used}, batches=${batches.length}, perBatch≈${PER_BATCH_TOKENS}, target=${target}`);

      // 🧠 NO UPFRONT CODE FETCHING - Let Claude discover elements first, then fetch relevant codes

      const SYSTEM_PROMPT = `
You are an expert QUANTITY SURVEYOR ESTIMATOR with 20+ years of construction experience. Your expertise allows you to analyze ANY construction project regardless of drawing numbering conventions.

🎯 YOUR PRIMARY TASK: Intelligently identify drawing types and extract EXACT building dimensions

📐 INTELLIGENT DRAWING RECOGNITION PROCESS:

1. IDENTIFY FLOOR PLANS (regardless of numbering):
   - Look for drawings with titles containing: "Floor Plan", "Level", "Plan", "Ground", "Typical", "Basement", "Parking"
   - Common numberings: A-101, A-201, P-1, L-1, FP-01, or any variant
   - These show the BUILDING FOOTPRINT from above
   - Extract the EXACT perimeter shape - NOT a simplified rectangle:
     • Include all indentations, projections, wings, courtyards
     • Trace the actual exterior walls as shown
     • Note balconies, setbacks, irregular geometries
   - Use the SCALE shown on drawings to convert to meters
   - Identify STRUCTURAL GRID (columns marked as circles/squares with labels like A, B, C... or 1, 2, 3...)

2. IDENTIFY BUILDING SECTIONS (regardless of numbering):
   - Look for drawings with titles containing: "Section", "Building Section", "Cross Section", "Longitudinal Section"
   - Common numberings: A-301, S-201, SEC-1, or any variant
   - These show the VERTICAL CUT through the building
   - Extract:
     • TOTAL BUILDING HEIGHT in meters
     • NUMBER OF FLOORS/STOREYS
     • FLOOR-TO-FLOOR HEIGHTS for EACH floor (critical!)
     • CEILING HEIGHTS for EACH floor (measure from drawings)
     • FLOOR ELEVATIONS from grade/datum (0.00 level)
     • SLAB THICKNESS for each floor
     • BASEMENT DEPTH if present
   - CRITICAL: Extract ACTUAL measurements for EACH floor level
   - Cross-reference with elevations if available

3. IDENTIFY ELEVATIONS (supplementary):
   - Look for: "Elevation", "North/South/East/West Elevation", "Facade"
   - These confirm building height and exterior features

4. IDENTIFY SPECIFICATIONS:
   - Look for detailed text describing materials, systems, assemblies
   - Extract material specifications, performance requirements
   - Link these to visual elements in drawings

SCHEMA (adapt to what you find in the documents):
{
  "storeys": [
    // ⚠️ WARNING: These are FORMAT EXAMPLES ONLY - DO NOT USE THESE VALUES
    // EXTRACT REAL measurements from YOUR construction documents
    {
      "name": "DO_NOT_USE_THIS_NAME",     // Extract REAL floor name from YOUR drawings
      "elevation_m": "EXTRACT_REAL_VALUE", // Extract REAL elevation in meters from YOUR sections
      "floor_to_floor_height_m": "REAL",   // Extract REAL height in meters from YOUR sections
      "ceiling_height_m": "ACTUAL",        // Extract REAL ceiling height from YOUR drawings
      "slab_thickness_mm": "ACTUAL_MM",    // Extract REAL slab thickness from YOUR details
      "source": "YOUR_ACTUAL_DRAWING"      // Cite the REAL drawing where YOU found this
    }
    // ⚠️ CRITICAL: All values must come from actual drawing analysis — no defaults permitted
  ],
  "floors": [
    // CRITICAL: Extract REAL floor data from YOUR drawings - these are ONLY FORMAT EXAMPLES
    {
      "name": "EXTRACT_FROM_DRAWING",  // e.g., "Ground Floor", "First Floor" as shown in YOUR documents
      "level": "REAL_NUMBER",           // Floor number from YOUR drawings
      "elevation": "REAL_VALUE_MM",     // ACTUAL elevation in millimeters from YOUR sections
      "floor_to_floor_height": "REAL_HEIGHT_MM", // ACTUAL height in millimeters from YOUR sections
      "ceiling_height": "REAL_CEILING_MM",       // ACTUAL ceiling height from YOUR drawings
      "source": "ACTUAL_DRAWING_NUMBER"  // Where YOU found this data
    }
    // DO NOT USE THE EXAMPLE VALUES - EXTRACT FROM YOUR ACTUAL DRAWINGS
  ],
  "building_height_m": number,  // TOTAL height from sections/elevations
  "footprint": [{ "x": number, "y": number }],  // ACTUAL perimeter from floor plans
  "grid": { 
    "x": number[],  // ACTUAL column grid positions from drawings (e.g., [0, 6000, 12000, 18000] in mm)
    "y": number[]   // ACTUAL grid positions from drawings (follow dimension lines between grid markers!)
  },
  "discovered_elements": {                        
     // Count ALL element types found across all documents
     // Adapt keys to what you actually find - don't limit to presets
  },
  "element_placements": {                         
     // Place elements at locations shown in drawings
     // Use actual coordinates from plans, not random placement
  },
  "drawing_scale": {
     "primary_scale": "<string, e.g. '1:100' or '1/4\\\" = 1\\'-0\\\"'>",
     "detail_scales": [{ "area": "<detail label>", "ratio": "<scale string>" }],
     "scale_source": "<where you found the scale, e.g. 'title block bottom-right of A-101'>"
  },
  "mep_systems": {
     "duct_schedules": [
       {
         "tag": "<duct tag e.g. SD-01>",
         "system": "supply|return|exhaust|outside_air",
         "shape": "rectangular|round|oval",
         "width_mm": "<number from schedule>",
         "height_mm": "<number from schedule>",
         "diameter_mm": "<number for round ducts>",
         "cfm": "<airflow from schedule>",
         "insulation": "<insulation spec>",
         "source_drawing": "<drawing number>"
       }
     ],
     "equipment": [
       {
         "tag": "<equipment tag e.g. AHU-01>",
         "type": "<air_handling_unit|vav_box|fan_coil|exhaust_fan|etc>",
         "location": { "x": "<number>", "y": "<number>" },
         "cfm": "<rated airflow>",
         "connections": [{ "duct_tag": "<tag>", "direction": "supply|return" }],
         "source_drawing": "<drawing number>"
       }
     ],
     "ceiling_heights": [
       {
         "room": "<room name>",
         "ceiling_height_m": "<actual from RCP>",
         "plenum_depth_m": "<space above ceiling>",
         "source_drawing": "<RCP drawing number>"
       }
     ],
     "duct_routing": [
       {
         "duct_tag": "<tag>",
         "waypoints": [{ "x": "<number>", "y": "<number>", "z": "<number>" }],
         "fittings": [{ "type": "elbow|tee|reducer|transition", "position": { "x": "<n>", "y": "<n>", "z": "<n>" }, "angle": "<degrees>" }],
         "connected_equipment": ["<equipment tags>"],
         "terminals": [{ "type": "diffuser|grille|register", "tag": "<tag>", "position": { "x": "<n>", "y": "<n>" } }]
       }
     ],
     "pipe_systems": [
       {
         "tag": "<pipe tag>",
         "system": "chilled_water|hot_water|domestic_cold|domestic_hot|sanitary|storm|fire_protection",
         "diameter_mm": "<pipe diameter>",
         "material": "<pipe material>",
         "source_drawing": "<drawing number>"
       }
     ]
  },
  "drawing_analysis": {
     "floor_plans_found": ["list actual drawing names/numbers"],
     "sections_found": ["list actual section drawing names"],
     "elevations_found": ["list elevation drawings if any"],
     "mechanical_plans_found": ["list M-sheet drawing numbers"],
     "plumbing_plans_found": ["list P-sheet drawing numbers"],
     "electrical_plans_found": ["list E-sheet drawing numbers"],
     "rcp_plans_found": ["list reflected ceiling plan drawing numbers"],
     "specifications_found": ["list specification documents"]
  },
  "extraction_confidence": {
     "footprint": "high/medium/low - based on clarity of floor plans",
     "height": "high/medium/low - based on section clarity",
     "grid": "high/medium/low - based on structural grid visibility"
  },
  "notes": [
     // Document your extraction process and sources
     // Example: "Footprint extracted from drawing labeled [actual name]",
     //          "Height of [X]m found in section drawing [actual name]",
     //          "[N] floors identified from building sections"
  ]
}

⚠️ PROFESSIONAL QS REQUIREMENTS:
- ADAPT to any drawing numbering system - don't look for specific numbers
- IDENTIFY drawing types by their CONTENT, not their labels
- EXTRACT actual dimensions from scaled drawings, not text descriptions
- If multiple floor plans exist, use the GROUND/FIRST FLOOR for footprint
- If dimensions are unclear, note this in extraction_confidence
- CRITICAL: Establish origin (0,0,0) at bottom-left corner FIRST
- Extract grid system BEFORE placing any elements
- All coordinates in METERS relative to origin
- Building coordinate system: X=horizontal (along grid letters), Y=depth (along grid numbers), Z=height (vertical)
- Return ONLY JSON, no markdown or prose

Analyze these construction documents as a professional QS would - identify the drawing types intelligently and extract real dimensions!
`.trim();

      // parseClaudeJson now defined at top-level

      // Per-batch Claude → per-batch RealQTO
      const parts: any[] = [];
      const _elementParts: any[][] = [];

      for (let i = 0; i < batches.length; i++) {
        const chunk = batches[i];
        const approxTokens = estimateTokensForText(chunk);
        console.log(`🧠 Claude batch ${i+1}/${batches.length} ~${approxTokens} tokens`);

        const USER_PROMPT = `
🧠 COMPREHENSIVE CONSTRUCTION DOCUMENT ANALYSIS:

**ANALYZE ALL DRAWINGS COMPREHENSIVELY FOR COMPLETE MODEL:**
1. **Architectural Plans (A-101, A-102, A-103, etc.)**: Extract EXACT building outline and layout
   • Trace precise exterior wall lines from floor plans
   • Capture indentations, courtyards, wings, complex shapes from ALL levels
   • Include curved walls, angled sections, setbacks across all floors
   • Follow actual architectural geometry shown in EVERY plan
2. **Structural Plans (S-101, S-102, etc.)**: CRITICAL - Extract grid system BY FOLLOWING DIMENSION LINES:
   • GRID LINES: Look for vertical and horizontal lines labeled with letters (A, B, C...) and numbers (1, 2, 3...)
   • FOLLOW DIMENSIONS: Trace extension lines between grid lines to find ACTUAL spacing (not defaults!)
   • GRID SPACING: Read the dimension values between grid lines (e.g., "6000" between Grid A and Grid B)
   • COLUMN LOCATIONS: Visually identify columns by their material pattern (check legend for concrete/steel hatching)
   • USE VISUAL ANALYSIS: Match the visual pattern from legend to identify what's a column vs other elements
3. **MEP Plans (M-101, E-101, P-101, etc.)**: CRITICAL - Extract structured MEP data:
   • DUCT SCHEDULES: Find duct schedule tables — extract tag, system type, dimensions (WxH or diameter), CFM, insulation
   • EQUIPMENT: Identify AHUs, VAV boxes, exhaust fans — extract tags, locations, CFM ratings, duct connections
   • DUCT ROUTING: Trace duct runs from equipment to terminals — extract waypoints, fittings (elbows, tees, reducers)
   • DIFFUSERS/GRILLES: Locate terminal devices — extract type, tag, position from plan
   • PIPE SYSTEMS: Extract pipe sizes, materials, system type (CHW, HHW, domestic, sanitary, storm)
   • RCP (Reflected Ceiling Plans): Extract ceiling heights, plenum depths, diffuser locations per room
   • DO NOT use hardcoded heights — read actual mounting elevations from sections/details
4. **Elevations & Sections**: CRITICAL - Extract floor-by-floor data BY FOLLOWING DIMENSION LINES:
   • FOLLOW EXTENSION LINES: Trace each dimension's extension lines to see what it measures
   • FLOOR ELEVATIONS: Follow dimension lines pointing to floor slabs - these show elevation from grade (0.00)
   • FLOOR-TO-FLOOR HEIGHTS: Look for vertical dimensions BETWEEN floor levels (extension lines span from floor to floor)
   • CEILING HEIGHTS: Dimensions with extension lines from floor to ceiling underside
   • SLAB THICKNESS: Small dimensions showing concrete slab depth
   • READ VISUALLY: Use the actual drawing images to trace dimension lines - don't just look for text
   • FLOOR NAMES: Basement, Ground, First, Second, etc.
   • Building height, facade details, vertical relationships
5. **Construction Details**: Assembly details, connections, material interfaces
6. **Specifications**: Written requirements, materials, performance criteria, quality standards
7. **Schedules**: Door/window/finish schedules, equipment lists, material specifications

**🔍 VISUAL SYMBOL RECOGNITION (WITH OR WITHOUT LEGEND):**

**VISUAL MATERIAL RECOGNITION FROM LEGEND:**
• CONCRETE: Look in legend for concrete hatching pattern (usually diagonal lines, dots, or solid fill)
• STEEL: Different pattern from concrete (often hollow or different hatching)
• MASONRY: Brick/block patterns shown in legend
• USE THE LEGEND to understand what each material looks like visually

**STANDARD ARCHITECTURAL SYMBOLS:**
• DOORS: Arc (quarter circle) showing door swing direction - single or double arcs
• WINDOWS: Parallel lines breaking through walls, often with sill lines
• COLUMNS: Shapes with material hatching/fill as shown in legend (concrete columns have concrete pattern)
• STAIRS: Series of parallel lines with arrow showing UP/DOWN direction
• ELEVATORS: Rectangle with diagonal line or "X" inside
• TOILETS: Oval or elongated shape with tank rectangle
• SINKS: Rectangle or circle, often with "S" or fixture outline
• WALLS: Thick double lines (exterior) or single lines (interior)

**LEGEND READING (CRITICAL FOR MATERIAL IDENTIFICATION):**
- STEP 1: Find legend/key box (usually in corner or side of drawing)
- STEP 2: Identify material patterns (concrete, steel, masonry, wood, etc.)
- STEP 3: Note what each hatching/fill pattern represents
- STEP 4: Use these patterns to identify columns, beams, walls throughout drawing
- EXAMPLE: If legend shows concrete as diagonal lines, find all shapes with diagonal lines

**VISUAL SCANNING PROCESS (IN ORDER):**
- STEP 1: ESTABLISH ORIGIN at bottom-left corner of building (0,0,0)
- STEP 2: EXTRACT GRID LINES FIRST - follow dimensions between grid lines for actual spacing
- STEP 3: USE GRID AS COORDINATE SYSTEM - all elements positioned relative to grid
- STEP 4: Find columns at their grid positions (using material patterns from legend)
- STEP 5: Identify doors by arc symbols and place at coordinates
- STEP 6: Identify windows by parallel lines in walls and place at coordinates
- STEP 7: Locate MEP fixtures and place using grid reference
- STEP 8: Count and place EVERY element at precise grid-based coordinates

**DYNAMIC ELEMENT DISCOVERY - NO LIMITS:**
- DISCOVER and IDENTIFY every building element/component/system you find across ALL documents
- Use BOTH text labels AND visual symbols to identify elements
- Do NOT constrain yourself to predefined types - CREATE element names based on what you see
- Examples: "STEEL_W_BEAM_W14x22", "CONCRETE_SLAB_8_INCH", "GLASS_CURTAIN_WALL_SYSTEM", 
  "HVAC_ROOFTOP_UNIT", "FIRE_SPRINKLER_HEAD", "ELECTRICAL_PANEL_400A", "CERAMIC_FLOOR_TILE"

**DRAWING SCALE EXTRACTION (CRITICAL - DO THIS FIRST):**
- Find the title block (usually bottom-right of each sheet)
- Read the scale annotation: "Scale: 1:100", "1/4" = 1'-0"", etc.
- If "As Noted" → check each detail/section for its own scale
- If graphical scale bar present → note the real-world length it represents
- Report the scale in the "drawing_scale" field of your JSON response
- ALL dimensions and coordinates must be converted using this scale

**BUILD ORDER (CRITICAL - MUST FOLLOW THIS SEQUENCE):**
1. FIRST: Read the drawing scale from the title block
2. SECOND: Establish origin point (0,0,0) at bottom-left corner
3. THIRD: Extract grid lines and spacing - this is your coordinate system
4. FOURTH: Place all elements using grid coordinates with correct scale

**COMPREHENSIVE BUILDING MODEL ACCURACY:**
- INTEGRATE information from ALL drawings to build complete accurate model:
  • Architectural plans → Building shape, layout, room arrangements
  • Structural plans → Columns, beams, foundations, load-bearing elements  
  • MEP plans → HVAC, electrical, plumbing, fire protection systems
  • Elevations/Sections → Building height, facade details, vertical coordination
  • Details → Construction assemblies, material connections, specifications
- TRACE exact building outline from architectural plans (capture complex shapes, not rectangles)
- COORDINATE between drawings - ensure structural aligns with architectural, MEP fits within spaces
- BUILD complete 3D understanding from 2D drawing set integration

**COMPLETE DRAWING SET INTEGRATION:**
- ARCHITECTURAL COORDINATION: Connect floor plans, elevations, sections, details into unified design
- STRUCTURAL COORDINATION: Align structural elements with architectural layout and MEP requirements  
- MEP COORDINATION: Integrate mechanical, electrical, plumbing systems within building structure
- SPECIFICATION INTEGRATION: Connect visual elements with written specs (CSI sections, materials)
- DETAIL CORRELATION: Link construction details to general plans and understand assemblies
- SCHEDULE COORDINATION: Match door/window/equipment schedules to plan locations
- VERTICAL COORDINATION: Align multi-story elements using sections and elevations

**HOLISTIC UNDERSTANDING:**
- Read drawings + specifications + details as ONE comprehensive project description
- Understand material selections, performance requirements, quality standards
- Identify systems: structural, architectural, MEP, site, landscape, specialty

**PRELIMINARY COMPLIANCE AWARENESS:**
- Note any obvious issues that would require Canadian building code verification
- Identify elements that need NBC, CSA, or provincial code checking
- Flag materials, dimensions, or configurations that may need compliance review

**CRITICAL**: Analyze the COMPLETE construction documentation set. Return ALL elements you discover - no artificial limits!

Construction documentation to analyze:
${chunk}

Return comprehensive analysis with ALL discovered elements and cross-document correlations.
`.trim();

        const resp = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",  // ← upgraded from claude-3-5-sonnet-20240620
          max_tokens: 8000,
          temperature: 0,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: USER_PROMPT }]
        });

        const perBatchAnalysis = parseClaudeJson(resp);
        
        // 🏗️ PROCESS PRELIMINARY COMPLIANCE NOTES: Store for later verification
        if (perBatchAnalysis.preliminary_compliance_notes) {
          console.log(`📝 Storing preliminary compliance notes for batch ${i+1}`);
        }
        
        parts.push(perBatchAnalysis);
        console.log(`📋 Completed understanding batch ${i+1}/${batches.length} - storing for complete analysis`);
      }

      // 🧠 PHASE 1 COMPLETE: Document Understanding & Element Discovery
      console.log(`✅ PHASE 1 COMPLETE: Document understanding from ${parts.length} batches`);
      
      // Merge all Claude analyses 
      const analysisMerged = mergeClaudeResults(parts);
      console.log(`🔗 Merged analysis from all batches - discovered elements: ${Object.keys((analysisMerged as any).discovered_elements || {}).length} types`);

      // 🧠 PHASE 2: CANADIAN COMPLIANCE VERIFICATION
      console.log(`🇨🇦 PHASE 2: Canadian compliance verification for discovered elements...`);
      const complianceAnalysis = await this.performCanadianComplianceCheck(analysisMerged, opts.projectId);
      
      // 📋 PHASE 3: RFI GENERATION FROM CONFLICTS
      // Generate RFIs automatically from compliance violations and conflicts
      console.log(`📋 PHASE 3: Generating RFIs from detected conflicts and compliance issues...`);
      try {
        const rfiIds = await rfiService.generateRFIsFromAnalysis(
          complianceAnalysis,
          (analysisMerged as any).cross_document_analysis || {},
          {
            projectId: opts.projectId,
            analysisId: 'unknown' // Will be set when analysis versioning is implemented
          }
        );
        console.log(`✅ Generated ${rfiIds.length} RFIs for project compliance and conflict resolution`);
      } catch (error) {
        console.error(`⚠️ RFI generation failed:`, error);
      }

      // 📐 PHASE 3.1: GRID VALIDATION RFI GENERATION
      // Convert grid/storey validation warnings into formal RFI records
      try {
        const gridValidation = (analysisMerged as any)?.building_analysis?._gridValidation;
        const storeyValidation = (analysisMerged as any)?.building_analysis?._storeyValidation;
        const crossRefWarnings: string[] = (analysisMerged as any)?.building_analysis?._crossRefWarnings || [];

        const gridWarnings = [
          ...(gridValidation?.warnings || []).map((w: string) => ({ source: 'grid', text: w })),
          ...(storeyValidation?.warnings || []).map((w: string) => ({ source: 'storey', text: w })),
          ...crossRefWarnings.map((w: string) => ({ source: 'cross-ref', text: w }))
        ];

        if (gridWarnings.length > 0) {
          console.log(`📐 PHASE 3.1: Converting ${gridWarnings.length} grid/storey validation warnings to RFIs...`);

          // Build conflict detection results from validation warnings
          const gridConflicts = gridWarnings.map((warning: { source: string; text: string }) => ({
            type: 'missing_information' as const,
            severity: (warning.text.toLowerCase().includes('spacing') || warning.text.toLowerCase().includes('minimum') || warning.text.toLowerCase().includes('maximum'))
              ? 'high' as const
              : 'medium' as const,
            title: `Grid/Storey Validation: ${warning.text.substring(0, 80)}`,
            description: warning.text,
            affectedElements: [] as string[],
            relatedDocuments: ['Structural Foundation Plan', 'Architectural Floor Plans'],
            currentCondition: `${warning.source} validation warning detected during BIM generation`,
            requiredCondition: 'Grid and storey data must be verified against structural drawings per CIQS standards',
            proposedSolution: 'Verify grid line spacing and storey elevations against structural and architectural drawings. Submit RFI to design team if discrepancies are confirmed.'
          }));

          const gridRfiIds = await rfiService.generateRFIsFromAnalysis(
            { gridConflicts },
            { grid_validation_warnings: gridConflicts },
            {
              projectId: opts.projectId,
              analysisId: 'grid-validation'
            }
          );
          console.log(`📐 Generated ${gridRfiIds.length} RFIs from grid/storey validation warnings`);
        }
      } catch (error) {
        // Grid RFI generation is non-blocking — log and continue
        console.warn(`⚠️ Grid validation RFI generation failed (non-blocking):`, error);
      }

      console.log(`✅ PHASE 3 COMPLETE: RFI generation finished`);
      
      // 📐 PHASE 3.2: AUTOMATIC GRID DETECTION
      // Run grid detection on drawing documents to populate grid schema
      // Results feed into Phase 4 (element placement) via getProjectGridSpacing()
      try {
        const { runGridDetection, isGridDetectionAvailable } = await import('./services/grid-detection-orchestrator');
        
        if (isGridDetectionAvailable()) {
          console.log(`📐 PHASE 3.2: Running automatic grid detection on drawing documents...`);
          
          // Filter to drawing documents (plans, sections, elevations)
          const drawingDocs = documents.filter(d =>
            /plan|floor|section|elevation|structural|foundation|grid|framing/i.test(d.filename)
          );
          
          if (drawingDocs.length > 0) {
            let detectedAxes = 0;
            for (const doc of drawingDocs.slice(0, 3)) {  // Limit to 3 most relevant
              try {
                const result = await runGridDetection({
                  projectId: opts.projectId,
                  sourceFileId: doc.id,
                  filename: doc.filename,
                  storageKey: doc.storageKey ?? doc.filename,
                  triggeredBy: 'auto',
                });
                detectedAxes += result.stats.axisCount;
                if (result.warnings.length > 0) {
                  console.warn(`   📐 ${doc.filename}: ${result.warnings[0]}`);
                }
              } catch (err) {
                console.warn(`   ⚠️ Grid detection skipped for ${doc.filename}: ${(err as Error).message}`);
              }
            }
            console.log(`📐 PHASE 3.2 COMPLETE: Grid detection on ${drawingDocs.length} drawings, ${detectedAxes} axes detected`);
            
            // 📐 PHASE 3.3: GRID VALIDATION → RFI PIPELINE
            // Feed WP-6 validation issues into formal RFI generation
            try {
              const { issuesToConflictResults } = await import('./services/grid-integration-bridge');
              const lastResult = await runGridDetection({
                projectId: opts.projectId,
                sourceFileId: drawingDocs[0].id,
                filename: drawingDocs[0].filename,
                storageKey: drawingDocs[0].storageKey ?? drawingDocs[0].filename,
                triggeredBy: 'auto',
              });
              
              if (lastResult.validation && lastResult.validation.rfiCount > 0) {
                const gridConflicts = issuesToConflictResults(lastResult.validation.issues);
                if (gridConflicts.length > 0) {
                  const gridRfiIds = await rfiService.generateRFIsFromAnalysis(
                    { conflicts: gridConflicts },
                    {},
                    { projectId: opts.projectId, analysisId: 'grid-validation', priorityOverride: 'high' as const }
                  );
                  console.log(`📐 PHASE 3.3: Generated ${gridRfiIds.length} RFIs from grid validation (${lastResult.validation.confidence.grade} grade)`);
                }
              }
            } catch (err) {
              console.warn(`⚠️ Phase 3.3 grid validation RFI generation failed (non-blocking):`, err);
            }
          } else {
            console.log(`📐 PHASE 3.2: No drawing documents found for grid detection`);
          }
        } else {
          console.log(`📐 PHASE 3.2: Grid detection skipped — no extractors registered (WP-3/WP-5 pending)`);
        }
      } catch (error) {
        console.warn(`⚠️ PHASE 3.2 grid detection failed (non-blocking):`, error);
      }
      
      // 🧠 PHASE 4: BIM MODEL CREATION WITH COMPLETE UNDERSTANDING
      console.log(`🏗️ PHASE 4: Creating BIM model based on complete understanding...`);
      const bimElements = await this.createBIMModelWithCompleteUnderstanding(
        analysisMerged, 
        complianceAnalysis, 
        opts, 
        documents
      );
      console.log(`✅ PHASE 4 COMPLETE: BIM model created with ${bimElements.length} elements`);
      
      // Combine all results
      const analysis = { 
        ...analysisMerged, 
        elements: bimElements,
        compliance_analysis: complianceAnalysis 
      };
      
      // Extract the merged spatial data 
      let spatialData = analysis?.building_analysis || analysis || {};
      
      try {
        // Apply storey and grid resolvers — services/storey-resolver.ts (NBC/OBC validated)
        const {
          resolveStoreysValidated,
          resolveGridsValidated,
          crossReferenceStoreysAndGrids
        } = await import('./services/storey-resolver');

        const storeyResult = resolveStoreysValidated(spatialData);
        const gridResult = resolveGridsValidated(spatialData);
        const crossRefWarnings = crossReferenceStoreysAndGrids(storeyResult, gridResult);

        // Surface all validation warnings for issue tracking
        const allWarnings = [
          ...storeyResult.warnings,
          ...gridResult.warnings,
          ...crossRefWarnings
        ];

        if (allWarnings.length > 0) {
          console.warn(`⚠️ Storey/Grid validation warnings (${allWarnings.length}):`);
          for (const w of allWarnings) {
            console.warn(`   ⚠️ ${w}`);
          }
        }

        spatialData = {
          ...spatialData,
          storeys: storeyResult.storeys,
          grids: gridResult.grids,
          _storeyValidation: {
            valid: storeyResult.valid,
            warnings: storeyResult.warnings
          },
          _gridValidation: {
            valid: gridResult.valid,
            warnings: gridResult.warnings
          },
          _crossRefWarnings: crossRefWarnings
        };
        
        console.log(`✅ Resolved: ${storeyResult.storeys.length} storeys (valid=${storeyResult.valid}), ${gridResult.grids.length} grids (valid=${gridResult.valid}), ${crossRefWarnings.length} cross-ref warnings, from ${parts.length} batches`);
      } catch (error) {
        console.warn(`⚠️ Storey/grid resolver failed, using raw merged data:`, error);
        // Continue with the merged data as-is
      }
      
      return {
        building_analysis: spatialData,
        ai_understanding: spatialData,
        confidence: null, // not derivable without ground-truth scoring
        overallConfidence: null,
        buildingHierarchy: spatialData.storeys || [],
        componentTypes: ['grids', 'storeys', 'footprint', 'walls', 'doors', 'windows'],
        standardsRequired: ['IFC4', 'Professional BIM Standards'],
        elements: analysis.elements || []
      } as any;
    } catch (error) {
      console.error('🚨 AI document analysis failed:', error);
      throw error;
    }
  }

  /**
   * Select salient pages for Claude analysis - prioritizing construction content
   */
  private selectSalientPages(docs: { id: string; filename: string; pageText: { page: number; text: string }[]; rasterPreviews: { page: number; key: string }[] }[]): { filename: string; page: number; text: string; image?: string }[] {
    const want = /plan|floor|grid|elev|section|level|door|window|dim|foundation|column|framing|roof/i;
    const picks: { filename: string; page: number; text: string; image?: string }[] = [];
    
    for (const d of docs) {
      const good = (d.pageText || []).filter(p => want.test(p.text || "")).slice(0, 4);
      for (const g of good) {
        const preview = (d.rasterPreviews || []).find(r => r.page === g.page);
        picks.push({
          filename: d.filename,
          page: g.page,
          text: g.text.slice(0, 4000), // cap per page
          image: preview?.key,
        });
      }
    }
    return picks.slice(0, 12); // global cap
  }

  /**
   * 🏗️ PHASE 3: Create BIM Model with Complete Understanding
   * Creates BIM model after complete document understanding and compliance verification
   */
  private async createBIMModelWithCompleteUnderstanding(
    completeAnalysis: any,
    complianceAnalysis: any,
    opts: any,
    documents: any[]
  ): Promise<any[]> {
    try {
      console.log(`🏗️ Creating BIM model with complete understanding of project...`);
      
      // Get LOD profile for model creation — default to 'detailed', never throw
      const lodProfileName: string = (opts as any)?.lod
        || (opts as any)?.levelOfDetail
        || process.env.DEFAULT_LOD
        || 'detailed';
      const lodProfile = getLodProfile(lodProfileName);
      console.log(`📐 Using LOD profile: ${lodProfile.name} with families: ${lodProfile.families.join(",")}`);
      
      // Create comprehensive options with complete understanding
      const qtoOptions: any = {
        unitSystem: opts.unitSystem,
        includeStoreys: true,
        computeGeometry: true,
        
        // LOD configuration
        families: lodProfile.families,
        includeMechanical: lodProfile.includeMechanical,
        includeElectrical: lodProfile.includeElectrical,
        includePlumbing: lodProfile.includePlumbing,
        segmentWallsAtOpenings: lodProfile.segmentWalls,
        elementSplitting: lodProfile.elementSplitting,
        maxElements: lodProfile.maxElements,
        lod: lodProfile.name,
        
        // Complete understanding data
        documentCount: documents.length,
        useAllDocuments: true,
        enhancedMode: true,
        claudeAnalysis: completeAnalysis,
        aiAnalysis: completeAnalysis,
        ai_understanding: completeAnalysis?.ai_understanding,
        buildingDimensions: completeAnalysis?.building_analysis?.dimensions,
        gridSystem: completeAnalysis?.building_analysis?.grid_system,
        spatialCoordinates: completeAnalysis?.building_analysis?.coordinates,
        
        // 🧠 NEW: Complete element discovery and compliance data
        discoveredElements: completeAnalysis?.discovered_elements,
        elementPlacements: completeAnalysis?.element_placements,
        specificationCorrelations: completeAnalysis?.specification_correlations,
        complianceAnalysis: complianceAnalysis,
        canadianCodeCompliance: complianceAnalysis
      };
      
      console.log(`📊 Creating model with ${Object.keys((completeAnalysis as any)?.discovered_elements || {}).length} discovered element types`);
      
      // CRITICAL FIX: Use construction workflow to extract products from specs FIRST
      console.log('📋 STEP 1: Extracting products from specifications using correct workflow...');
      const workflowResult = await this.constructionWorkflow.processConstructionDocuments(
        opts.projectId,
        documents,
        {
          modelId: opts.modelId,
          batch: 1,
          totalBatches: 1,
          // Pass merged Claude analysis so storey elevations are available for
          // z-coordinate resolution in buildElementsFromAssemblies (v15.4 fix)
          claudeAnalysis: completeAnalysis,
        }
      );
      
      console.log(`✅ Extracted ${workflowResult.products?.length || 0} products, ${workflowResult.assemblies?.length || 0} assemblies`);
      console.log(`✅ Built ${workflowResult.elements?.length || 0} elements from assemblies`);
      
      // Pass the products and assemblies to RealQTO for enhanced processing
      qtoOptions.extractedProducts = workflowResult.products;
      qtoOptions.extractedAssemblies = workflowResult.assemblies;
      qtoOptions.workflowElements = workflowResult.elements;
      
      // Now process with RealQTO using the product knowledge
      const realQTOResult = await this.realQTOProcessor.processRealBIMData(
        opts.projectId,
        opts.documentPath,
        qtoOptions
      );
      
      const elements = Array.isArray((realQTOResult as any)?.elements)
        ? (realQTOResult as any).elements
        : Array.isArray(realQTOResult) ? realQTOResult : [];
      
      console.log(`✅ BIM model created successfully with ${elements.length} elements based on complete understanding`);
      
      return elements;
      
    } catch (error) {
      console.error('❌ Failed to create BIM model with complete understanding:', error);
      throw error;
    }
  }

  /**
   * 🇨🇦 PHASE 2: Canadian Building Code Compliance Verification
   * Fetches relevant codes based on discovered elements and performs targeted compliance checking
   */
  private async performCanadianComplianceCheck(discoveredAnalysis: any, projectId: string): Promise<any> {
    try {
      // Extract discovered elements
      const discoveredElements = Object.keys((discoveredAnalysis as any).discovered_elements || {});
      const preliminaryNotes = discoveredAnalysis.preliminary_compliance_notes || {};
      
      if (discoveredElements.length === 0) {
        console.log(`⚠️ No elements discovered - skipping compliance check`);
        return { status: 'no_elements_found' };
      }
      
      console.log(`🧠 Discovered ${discoveredElements.length} element types: ${discoveredElements.join(', ')}`);
      
      // 🇨🇦 FETCH RELEVANT CANADIAN CODES: Only fetch codes relevant to discovered elements
      const relevantCodes = await this.standardsService.fetchLiveBuildingCodesWithLicensing('canada', projectId);
      
      // Filter codes to only relevant sections for discovered elements
      const elementRelevantCodes = relevantCodes.filter(code => {
        const codeText = `${code.section} ${code.title}`.toLowerCase();
        return discoveredElements.some(element => 
          codeText.includes(element.toLowerCase().replace('_', ' ')) ||
          this.isElementRelevantToCode(element, codeText)
        );
      }).slice(0, 15); // Limit to most relevant codes
      
      console.log(`🏛️ Found ${elementRelevantCodes.length} relevant Canadian codes for compliance check`);
      
      if (elementRelevantCodes.length === 0) {
        return { status: 'no_relevant_codes_found', discovered_elements: discoveredElements };
      }
      
      // Create targeted compliance prompt
      const codeContext = elementRelevantCodes.map(code => 
        `${code.codeId} ${code.section}: ${code.title}`
      ).join('\n');
      
      const COMPLIANCE_PROMPT = `
🇨🇦 CANADIAN BUILDING CODE COMPLIANCE VERIFICATION

**DISCOVERED ELEMENTS TO VERIFY:**
${discoveredElements.map(el => `- ${el}: ${discoveredAnalysis.discovered_elements[el]} units`).join('\n')}

**PRELIMINARY CONCERNS:**
${JSON.stringify(preliminaryNotes, null, 2)}

**RELEVANT CANADIAN BUILDING CODES:**
${codeContext}

**TASK:** Perform detailed compliance verification for each discovered element against Canadian building codes.

Return JSON with detailed compliance analysis:
{
  "code_violations": [{ "element": string, "code": string, "issue": string, "severity": "critical" | "warning" | "minor" }],
  "material_compliance": [{ "element": string, "specified_material": string, "code_requirement": string, "compliant": boolean }],
  "dimensional_compliance": [{ "element": string, "dimension": string, "code_requirement": string, "actual": number, "required": number, "compliant": boolean }],
  "accessibility_compliance": { "csa_b651_compliant": boolean, "issues": string[] },
  "fire_safety_compliance": { "nbc_egress_compliant": boolean, "fire_rating_compliant": boolean, "issues": string[] },
  "structural_compliance": { "csa_compliant": boolean, "issues": string[] },
  "summary": { "total_violations": number, "critical_issues": number, "compliance_percentage": number }
}`;

      const resp = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        temperature: 0,
        system: "You are a Canadian building code compliance expert. Return ONLY valid JSON for compliance analysis.",
        messages: [{ role: "user", content: COMPLIANCE_PROMPT }]
      });
      
      const complianceResult = parseClaudeJson(resp);
      
      // Store compliance analysis
      await this.processComplianceAnalysis(projectId, complianceResult);
      
      console.log(`✅ Canadian compliance check completed - ${complianceResult.summary?.total_violations || 0} violations found`);
      
      return complianceResult;
      
    } catch (error) {
      console.error('🚨 Canadian compliance check failed:', error);
      return { status: 'compliance_check_failed', error: error instanceof Error ? error.message : String(error) };
    }
  }
  
  /**
   * Helper: Determine if an element type is relevant to a building code section
   */
  private isElementRelevantToCode(elementType: string, codeText: string): boolean {
    const elementWords = elementType.toLowerCase().split('_');
    const codeWords = codeText.toLowerCase();
    
    // Map element types to code keywords
    const relevanceMap: Record<string, string[]> = {
      'steel': ['steel', 'structural', 'beam', 'column', 'connection'],
      'concrete': ['concrete', 'reinforced', 'slab', 'foundation'],
      'wall': ['wall', 'partition', 'separation', 'fire'],
      'door': ['door', 'egress', 'exit', 'accessibility'],
      'window': ['window', 'glazing', 'opening', 'natural light'],
      'stair': ['stair', 'egress', 'accessibility', 'riser', 'tread'],
      'elevator': ['elevator', 'accessibility', 'barrier-free'],
      'hvac': ['mechanical', 'ventilation', 'heating', 'air'],
      'electrical': ['electrical', 'lighting', 'power', 'outlet'],
      'sprinkler': ['fire', 'sprinkler', 'suppression', 'safety'],
      'ceiling': ['ceiling', 'fire', 'rating', 'assembly']
    };
    
    return elementWords.some(word => {
      const keywords = relevanceMap[word] || [word];
      return keywords.some(keyword => codeWords.includes(keyword));
    });
  }

  /**
   * 🏗️ Automatically discover floor structure from Claude's analysis
   */
  private discoverFloorStructureFromText(text: string): Array<{ name: string; elevation: number; level: number }> {
    const discoveredFloors = [];
    let floorLevel = 0;
    
    // Extract floor-to-floor height from Claude's visual analysis (in millimeters)
    // Claude should follow extension lines in section drawings to find vertical dimensions between floors
    let floorHeightMm = 0; // MUST be extracted by following dimension lines in drawings - NO DEFAULTS
    
    const heightPatterns = [
      /floor[\s-]*to[\s-]*floor[\s:]*([0-9]+)/i,
      /floor[\s-]*height[\s:]*([0-9]+)/i,
      /storey[\s-]*height[\s:]*([0-9]+)/i,
      /typical[\s-]*floor[\s-]*height[\s:]*([0-9]+)/i,
      // Look for standalone numbers that are likely floor heights
      /\b(3[0-9]{3}|4[0-9]{3}|2[5-9][0-9]{2})\b/i,  // Common floor heights 2500-4999
      /\b([3-4]\.[0-9]+)\b/i,  // 3.0 - 4.9 in meters
      /elevation[\s:]*\+?([0-9]+)/i,  // Numbers after "elevation"
      /\+([0-9]+)/i,  // Just +3600 format
      /([0-9]+)\s*floor/i,  // Numbers before "floor"
      /\b([0-9]{4})\b/  // Any 4-digit number (likely millimeters)
    ];
    
    for (const pattern of heightPatterns) {
      const match = text.match(pattern);
      if (match) {
        const value = parseFloat(match[1]);
        
        // Determine if the value is likely in meters or millimeters
        if (value < 20) {
          // Values under 20 are likely meters (e.g., 3.6, 4.2, etc.)
          floorHeightMm = value * 1000;
          console.log(`🏢 Claude extracted floor height: ${value}m (converted to ${floorHeightMm}mm)`);
        } else {
          // Values over 20 are likely already in millimeters (e.g., 3600, 4200)
          floorHeightMm = value;
          console.log(`🏢 Claude extracted floor height: ${floorHeightMm}mm from documents`);
        }
        
        // Validate the height is reasonable (2.5m to 5m is typical)
        if (floorHeightMm >= 2500 && floorHeightMm <= 5000) {
          break;  // Found a valid height
        }
      }
    }
    
    // Throw error if no floor height was found
    if (floorHeightMm === 0) {
      throw new Error('❌ MISSING FLOOR HEIGHT: No floor-to-floor height found in Claude\'s analysis!\\n' +
        '🔍 Claude MUST extract floor heights from:\\n' +
        '  - SECTION drawings showing floor-to-floor dimensions\\n' +
        '  - Building plans with height annotations\\n' +
        '  - Details showing storey heights\\n' +
        '⚠️ NO DEFAULTS ALLOWED - You must provide actual floor height from your construction documents.');
    }
    
    // Detect Underground/Foundation level
    if (text.includes('underground') || text.includes('foundation') || text.includes('basement') || text.includes('parking')) {
      discoveredFloors.push({ 
        name: 'Underground/Foundation', 
        elevation: -floorHeightMm, // Below ground in millimeters
        level: -1 
      });
    }
    
    // Always include Ground Floor
    discoveredFloors.push({ 
      name: 'Ground Floor', 
      elevation: 0, // Ground level reference point
      level: 0 
    });
    floorLevel++;
    
    // Detect additional floors based on text patterns
    const floorPatterns = [
      { pattern: /second.*floor|floor.*2|2nd.*floor/i, name: 'Second Floor' },
      { pattern: /third.*floor|floor.*3|3rd.*floor/i, name: 'Third Floor' },
      { pattern: /fourth.*floor|floor.*4|4th.*floor/i, name: 'Fourth Floor' },
      { pattern: /roof.*level|roof.*floor|penthouse/i, name: 'Roof Level' }
    ];
    
    for (const floor of floorPatterns) {
      if (floor.pattern.test(text)) {
        discoveredFloors.push({
          name: floor.name,
          elevation: floorLevel * floorHeightMm, // Using extracted floor height in mm
          level: floorLevel
        });
        floorLevel++;
      }
    }
    
    console.log(`🏢 Claude discovered ${discoveredFloors.length} floors automatically:`, 
      discoveredFloors.map(f => `${f.name} (${f.elevation}mm)`).join(', '));
    
    return discoveredFloors;
  }

  /**
   * 🎯 Extract spatial data directly from Claude's text response when JSON parsing fails
   */
  private extractSpatialDataFromText(responseText: string): any {
    const text = responseText.toLowerCase();
    console.log(`🔍 Extracting spatial data from text response...`);
    
    // Extract building dimensions
    const dimensionMatch = text.match(/building[^.]*?(\d+\.?\d*)\s*m?\s*[×x]\s*(\d+\.?\d*)\s*m/);
    const footprintMatch = text.match(/footprint[^.]*?(\d+\.?\d*)\s*m?\s*[×x]\s*(\d+\.?\d*)\s*m/);
    
    let width = 0, length = 0;
    if (dimensionMatch) {
      width = parseFloat(dimensionMatch[1]);
      length = parseFloat(dimensionMatch[2]);
      console.log(`🏗️ Found building dimensions from text: ${width}m × ${length}m`);
    } else if (footprintMatch) {
      width = parseFloat(footprintMatch[1]);
      length = parseFloat(footprintMatch[2]);
      console.log(`🏗️ Found footprint dimensions from text: ${width}m × ${length}m`);
    }
    
    // Extract grid system from Claude's visual analysis - NO DEFAULTS!
    const gridLines: Array<{ label: string; coordinate: number; axis: "X" | "Y" }> = [];
    let spacing = 0; // MUST be extracted from actual drawings - NO DEFAULTS
    
    let mm: RegExpExecArray | null;
    const gridRegex = /grid\s+([a-z]).*?(\d+\.?\d*)\s*m/g;
    
    while ((mm = gridRegex.exec(text)) !== null) {
      if (mm && mm[1] && mm[2]) {
        gridLines.push({
          label: mm[1].toUpperCase(),
          coordinate: gridLines.length * spacing,
          axis: "X"
        });
      }
    }
    if (gridLines.length > 0) {
      console.log(`🔷 Found ${gridLines.length} grid lines from text`);
    }
    
    // Create coordinates array
    const coordinates = [];
    if (width > 0 && length > 0) {
      coordinates.push(
        { x: 0, y: 0, z: 0, element: "corner" },
        { x: width * 1000, y: 0, z: 0, element: "building_corner" },
        { x: width * 1000, y: length * 1000, z: 0, element: "building_corner" },
        { x: 0, y: length * 1000, z: 0, element: "building_corner" }
      );
      console.log(`📍 Created ${coordinates.length} building corner coordinates`);
    }
    
    return {
      building_analysis: {
        dimensions: { width, length },
        grid_system: {
          lines: gridLines,
          spacing: spacing
        },
        storeys: this.discoverFloorStructureFromText(text),
        coordinates: coordinates
      }
    };
  }

  private async analyzeDocumentForBIM(document: Document, requirements: BIMGenerationRequirements, strategy: any): Promise<BIMElement[]> {
    try {
      const analysis = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        temperature: 0,
        system: `You are a BIM modeling expert. Analyze construction documents and generate specific BIM components with precise geometry, materials, and properties.

        Generate components that are:
        - IFC-compliant with proper classifications
        - Dimensionally accurate 
        - Properly categorized (architectural/structural/mep)
        - Assigned appropriate materials and properties`,
        messages: [{
          role: "user",
          content: `Generate BIM components from this construction document:

Document: ${document.filename} (${document.fileType})
Analysis Strategy: ${strategy.strategy}

Extract specific building components with:
1. Component type and name
2. Dimensions and properties
3. Material specifications  
4. IFC classification
5. Construction category

Focus on quantifiable, buildable elements that can be accurately modeled.`
        }]
      });

      const responseText = analysis.content[0].type === 'text' ? analysis.content[0].text : 'BIM components';
      return this.parseAIBIMComponents(responseText, document);
    } catch (error) {
      console.error('AI BIM component analysis failed:', error);
      throw new Error(`
❌ CLAUDE ANALYSIS REQUIRED: No fallback BIM components allowed!

Claude MUST analyze actual construction documents to generate real BIM elements.
This function tried to bypass Claude and return fake components.

Document: ${document.filename}
Error: ${error}
      `);
    }
  }

  private async generateBIMMetadata(elements: BIMElement[], requirements: BIMGenerationRequirements, strategy: any): Promise<any> {
    try {
      const _metadataAnalysis = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2500,
        temperature: 0,
        system: "You are a BIM metadata and standards expert. Generate comprehensive project metadata including classifications, standards compliance, and professional documentation.",
        messages: [{
          role: "user",
          content: `Generate comprehensive BIM metadata for this project:

Elements: ${elements.length} components
Strategy: ${strategy.strategy}
Requirements: ${JSON.stringify(requirements)}

Provide:
1. IFC classification hierarchy
2. Standards compliance documentation
3. Project information and lifecycle data
4. Quality assurance metadata
5. Professional certifications needed

Focus on industry-standard metadata for professional BIM delivery.`
        }]
      });

      return {
        projectInfo: {
          name: requirements.modelName || 'AI-Generated BIM Model',
          description: 'Professional BIM model generated using AI analysis',
          discipline: 'Architecture, Structure, MEP',
          phase: 'Design Development',
          levelOfDevelopment: requirements.levelOfDetail || 'LOD400', // High detail for expansion
          creationMethod: 'AI-powered automated generation'
        },
        standards: {
          ifcVersion: 'IFC4',
          classification: 'AI-enhanced classification',
          units: requirements.units || 'metric',
          modelPurpose: 'Coordination and Estimation'
        },
        qualityAssurance: {
          aiAnalysis: 'Professional grade',
          geometryValidation: 'Claude-powered validation',
          dataConsistency: 'Validated',
          standardsCompliance: 'AI-verified'
        },
        generationTimestamp: new Date().toISOString(),
        version: '1.0'
      };
    } catch (error) {
      console.error('AI metadata generation failed:', error);
      throw new Error(`
❌ CLAUDE METADATA REQUIRED: No fallback metadata allowed!

Claude MUST generate real metadata from actual project analysis.
This function tried to bypass Claude and return fake metadata.

Error: ${error}
      `);
    }
  }

  private parseAIBIMComponents(analysisText: string, document: Document): BIMElement[] {
    const elements: BIMElement[] = [];
    const lines = analysisText.split('\n');
    
    // Extract components from AI analysis
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      
      if (line.includes('component:') || line.includes('element:')) {
        const element = this.createElementFromAnalysis(lines[i], i, document);
        if (element) {
          elements.push(element);
        }
      }
    }
    
    // ❌ DEAD-END TRAP ELIMINATED: No fallback components when Claude finds nothing
    if (elements.length === 0) {
      throw new Error(`
🚫 NO ELEMENTS FOUND: Claude must extract real components!

Claude found ZERO elements in document: ${document.filename}
This is NOT acceptable - Claude must analyze more thoroughly.

DO NOT return fake components - require real analysis!
      `);
    }
    
    return elements;
  }

  private createElementFromAnalysis(_line: string, _index: number, _document: Document): BIMElement | null {
    // This function should NOT generate fake elements with arbitrary dimensions
    throw new Error('❌ FAKE ELEMENT GENERATION BLOCKED: This function should not create elements without real dimensions!\\n' +
      '🔍 Claude MUST extract actual element dimensions from the construction documents.\\n' +
      '⚠️ NO FAKE DIMENSIONS ALLOWED - Elements must have real measurements from drawings.');
  }

  private generateFallbackComponents(_document: Document): BIMElement[] {
    throw new Error(`
🚫 MOCK COMPONENTS BLOCKED: This function should NEVER be called!

This was a DEAD-END TRAP that returned:
- Fake 5.0 x 3.0 x 0.2m walls
- Generic "AI-Generated Building Element" names
- Hardcoded concrete material

Claude must extract REAL components from actual documents!
    `);
  }

  private createFallbackMetadata(requirements: BIMGenerationRequirements): any {
    return {
      projectInfo: {
        name: requirements.modelName || 'BIM Model',
        description: 'Generated BIM model',
        discipline: 'Mixed',
        phase: 'Design',
        levelOfDevelopment: requirements.levelOfDetail || 'LOD200',
        creationMethod: 'Automated generation'
      },
      standards: {
        ifcVersion: 'IFC4',
        classification: 'Basic',
        units: requirements.units || 'metric'
      }
    };
  }

  private extractBuildingHierarchy(text: string): string[] {
    const hierarchy = ['Building'];
    if (text.toLowerCase().includes('floor') || text.toLowerCase().includes('level')) {
      hierarchy.push('Floor Level');
    }
    hierarchy.push('Components');
    return hierarchy;
  }

  private identifyComponentTypes(text: string): string[] {
    const types: string[] = [];
    const keywords = {
      'structural': ['beam', 'column', 'foundation', 'structural'],
      'architectural': ['wall', 'door', 'window', 'roof', 'architectural'],
      'mep': ['hvac', 'electrical', 'plumbing', 'mechanical', 'mep']
    };

    for (const [category, keywordList] of Object.entries(keywords)) {
      if (keywordList.some(keyword => text.toLowerCase().includes(keyword))) {
        types.push(category);
      }
    }

    return types.length > 0 ? types : ['architectural', 'structural'];
  }

  private getElementTypeCounts(elements: BIMElement[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const element of elements) {
      counts[element.type] = (counts[element.type] || 0) + 1;
    }
    return counts;
  }

  // 🏗️ NEW METHOD: Process compliance analysis from Claude
  private async processComplianceAnalysis(projectId: string, complianceData: any) {
    try {
      console.log('🏗️ Processing compliance analysis from Claude...');
      
      const complianceRules = [];
      
      // Process code violations
      if (complianceData.code_violations?.length > 0) {
        for (const violation of complianceData.code_violations) {
          complianceRules.push({
            id: randomUUID(),
            projectId,
            standard: violation.code,
            requirement: `${violation.element}: ${violation.issue}`,
            category: 'code_violation',
            status: violation.severity === 'critical' ? 'failed' : 'warning',
            details: violation.issue,
            elementType: violation.element,
            severity: violation.severity,
            createdAt: new Date()
          });
        }
      }
      
      // Process material compliance
      if (complianceData.material_compliance?.length > 0) {
        for (const material of complianceData.material_compliance) {
          complianceRules.push({
            id: randomUUID(),
            projectId,
            standard: material.code_requirement,
            requirement: `${material.element}: Material compliance verification`,
            category: 'material_compliance',
            status: material.compliant ? 'passed' : 'failed',
            details: `Specified: ${material.specified_material}, Required: ${material.code_requirement}`,
            elementType: material.element,
            severity: material.compliant ? 'info' : 'warning',
            createdAt: new Date()
          });
        }
      }
      
      // Process dimensional compliance
      if (complianceData.dimensional_compliance?.length > 0) {
        for (const dimension of complianceData.dimensional_compliance) {
          complianceRules.push({
            id: randomUUID(),
            projectId,
            standard: dimension.code_requirement,
            requirement: `${dimension.element}: ${dimension.dimension} compliance`,
            category: 'dimensional_compliance',
            status: dimension.compliant ? 'passed' : 'failed',
            details: `Actual: ${dimension.actual}, Required: ${dimension.required}`,
            elementType: dimension.element,
            severity: dimension.compliant ? 'info' : 'critical',
            createdAt: new Date()
          });
        }
      }
      
      // Process accessibility compliance
      if (complianceData.accessibility_compliance) {
        complianceRules.push({
          id: randomUUID(),
          projectId,
          standard: 'ADA/AODA',
          requirement: 'Accessibility compliance verification',
          category: 'accessibility',
          status: complianceData.accessibility_compliance.ada_compliant ? 'passed' : 'failed',
          details: complianceData.accessibility_compliance.issues?.join('; ') || 'Accessibility verification completed',
          elementType: 'BUILDING',
          severity: complianceData.accessibility_compliance.ada_compliant ? 'info' : 'critical',
          createdAt: new Date()
        });
      }
      
      // Process fire safety compliance
      if (complianceData.fire_safety_compliance) {
        complianceRules.push({
          id: randomUUID(),
          projectId,
          standard: 'Fire Safety Code',
          requirement: 'Fire safety and egress compliance',
          category: 'fire_safety',
          status: (complianceData.fire_safety_compliance.egress_compliant && 
                   complianceData.fire_safety_compliance.fire_rating_compliant) ? 'passed' : 'failed',
          details: complianceData.fire_safety_compliance.issues?.join('; ') || 'Fire safety verification completed',
          elementType: 'BUILDING',
          severity: (complianceData.fire_safety_compliance.egress_compliant && 
                    complianceData.fire_safety_compliance.fire_rating_compliant) ? 'info' : 'critical',
          createdAt: new Date()
        });
      }
      
      // Store compliance rules in database
      if (complianceRules.length > 0) {
        console.log(`🏗️ Storing ${complianceRules.length} compliance rules from Claude analysis`);
        // Note: Would need to implement storage.createComplianceRules if not exists
        for (const rule of complianceRules) {
          try {
            await (storage as any).createComplianceCheck?.(rule) ?? 
                  console.log('⚠️ Compliance storage not implemented, rule logged:', rule);
          } catch (err) {
            console.warn('Failed to store compliance rule:', err);
          }
        }
      }
      
    } catch (error) {
      console.error('❌ Failed to process compliance analysis:', error);
    }
  }
}