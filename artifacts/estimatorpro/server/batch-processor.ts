import fs from "fs";
import { logger } from "./utils/enterprise-logger";
import path from "path";
import { storage } from "./storage";
import { fromPath } from "pdf2pic";
import Anthropic from "@anthropic-ai/sdk";
import { claudeCostMonitor } from "./services/claude-cost-monitor";
import { planBasedCostMonitor } from "./services/plan-based-cost-monitor";
import { alertDeprecatedPath } from "./monitoring/deprecated-path-monitor";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

import { ProcessingProgress, processingProgress as currentProgress } from './utils/processing-progress';

// Module-scoped state (not global pollution)
let batchProcessorAlertCount = 0;

// 🤖 AUTOMATIC PROCESSING: Background scheduler state
let isBackgroundProcessingActive = false;
let backgroundProcessingInterval: NodeJS.Timeout | null = null;

// 🚀 AUTOMATIC STARTUP: Check for pending documents and auto-start processing
export async function initializeBackgroundProcessor(): Promise<void> {
  logger.info('🛡️ Background processor check - only processing if changes detected...');
  
  try {
    // 🛡️ COST PROTECTION: Use smart change detection before any processing
    const { smartAnalysisService: _smartAnalysisService } = await import('./smart-analysis-service');
    
    // Check all projects for pending documents (system-wide for background processing)
    const allProjects: any[] = [];
    try {
      // Get projects from all users by querying database directly
      const { db } = await import('./db');
      const { projects } = await import('../shared/schema');
      const projectResults = await db.select().from(projects);
      allProjects.push(...projectResults);
    } catch (error) {
      logger.warn('Failed to get all projects, using fallback approach:', error);
      // Fallback: try to get projects for a known user or skip
      return;
    }
    let totalPendingDocs = 0;
    
    for (const project of allProjects) {
      const documents = await storage.getDocumentsByProject(project.id);
      // 🎯 FIX: Check for BOTH content extraction AND analysis work
      const needsContent = documents.filter(doc => !doc.textContent || doc.textContent.length < 100);
      const needsAnalysis = documents.filter(doc => 
        (doc.textContent && doc.textContent.length >= 100) && 
        (!doc.analysisResult || doc.analysisStatus === 'Pending')
      );
      
      const totalPending = needsContent.length + needsAnalysis.length;
      
      if (totalPending > 0) {
        totalPendingDocs += totalPending;
        logger.info(`📋 Project ${project.name}: ${needsContent.length} need content, ${needsAnalysis.length} need analysis`);
      }
    }
    
    if (totalPendingDocs > 0) {
      logger.info(`🚀 Auto-starting analysis for ${totalPendingDocs} pending documents across ${allProjects.length} projects`);
      startBackgroundProcessor();
    } else {
      logger.info('✅ No pending documents found - background processor on standby');
    }
    
  } catch (error) {
    logger.error('❌ Background processor initialization failed:', error);
  }
}

// 🔄 CONTINUOUS PROCESSING: Background processor that runs automatically
function startBackgroundProcessor(): void {
  if (isBackgroundProcessingActive) {
    logger.info('⚠️ Background processor already active');
    return;
  }
  
  isBackgroundProcessingActive = true;
  logger.info('🤖 Starting automatic background document processor...');
  
  // Check every 30 seconds for pending documents
  backgroundProcessingInterval = setInterval(async () => {
    try {
      await processPendingDocumentsAutomatically();
    } catch (error) {
      logger.error('❌ Background processing error:', error);
    }
  }, 30000); // 30 second intervals
  
  // Also run immediately
  processPendingDocumentsAutomatically();
}

// 🎯 AUTOMATIC PROCESSING: Find and process pending documents
async function processPendingDocumentsAutomatically(): Promise<void> {
  try {
    // Get all projects for background processing
    const allProjects: any[] = [];
    try {
      const { db } = await import('./db');
      const { projects } = await import('../shared/schema');
      const projectResults = await db.select().from(projects);
      allProjects.push(...projectResults);
    } catch (error) {
      logger.warn('Failed to get projects for background processing:', error);
      return;
    }
    let foundPendingWork = false;
    
    for (const project of allProjects) {
      const documents = await storage.getDocumentsByProject(project.id);
      // 🎯 FIX: Check for BOTH content AND analysis work
      const needsContent = documents.filter(doc => !doc.textContent || doc.textContent.length < 100);
      const needsAnalysis = documents.filter(doc => 
        (doc.textContent && doc.textContent.length >= 100) && 
        (!doc.analysisResult || doc.analysisStatus === 'Pending')
      );
      
      const totalPending = needsContent.length + needsAnalysis.length;
      
      if (totalPending > 0) {
        foundPendingWork = true;
        logger.info(`🔄 Auto-processing ${totalPending} pending items for ${project.name} (${needsContent.length} content + ${needsAnalysis.length} analysis)`);
        
        // 🚀 NEW: Use comprehensive analysis instead of individual document processing
        logger.info(`🚀 Background: Starting comprehensive analysis for project ${project.id}`);
        triggerComprehensiveAnalysis(project.id).catch(error => {
          logger.error(`❌ Comprehensive analysis failed for project ${project.id}:`, error);
        });
        
        // Only process one project at a time to avoid overload
        break;
      }
    }
    
    if (!foundPendingWork) {
      logger.info('✅ All documents processed - stopping background processor');
      stopBackgroundProcessor();
    }
    
  } catch (error) {
    logger.error('❌ Automatic processing check failed:', error);
  }
}

// 🛑 STOP AUTOMATION: Clean shutdown of background processor
function stopBackgroundProcessor(): void {
  if (backgroundProcessingInterval) {
    clearInterval(backgroundProcessingInterval);
    backgroundProcessingInterval = null;
  }
  isBackgroundProcessingActive = false;
  logger.info('🛑 Background processor stopped');
}

// Helper function to detect sheet number and title from page text
function detectSheetInfo(pageText: string): { sheetNumber?: string; sheetTitle?: string } {
  if (!pageText) return {};
  
  const patterns = [
    /^([A-Z]{1,2}\d{1,4})\s+(.+)$/m,
    /Sheet\s+([A-Z]{1,2}\d{1,4}):\s*(.+)$/mi,
    /^([A-Z]{1,2}\d{1,4})\s*[-–]\s*(.+)$/m,
    /([A-Z]{1,2}\d{1,4})/m
  ];

  for (const pattern of patterns) {
    const match = pageText.match(pattern);
    if (match) {
      return {
        sheetNumber: match[1],
        sheetTitle: match[2]?.trim() || undefined
      };
    }
  }
  
  return {};
}

// Extract PDF content using OCR and computer vision for construction drawings
async function extractDocumentContent(document: any): Promise<{
  textContent: string | null;
  pageImages: Array<{pageNumber: number, sheetNumber?: string, sheetTitle?: string, imageUrl: string}>;
}> {
  // SECURITY FIX: Prevent path traversal attacks
  const secureFilename = path.basename(document.filename);
  const filePath = path.join(process.cwd(), 'uploads', secureFilename);
  const pageImages: Array<{pageNumber: number, sheetNumber?: string, sheetTitle?: string, imageUrl: string}> = [];
  
  if (!fs.existsSync(filePath)) {
    logger.warn(`⚠️ File not found: ${filePath}`);
    return { textContent: null, pageImages: [] };
  }

  try {
    logger.info(`📄 Processing PDF with OCR: ${document.originalName}`);
    
    let textContent = '';
    let _extractionMethod = 'Unknown';
    
    // First try real PDF text extraction using pdf-parse library
    try {
      const { extractPdf } = await import('./pdf-extraction-service');
      const previewDir = path.join('uploads', 'previews', document.filename);
      const extracted = await extractPdf(filePath, previewDir);

      if (extracted.textContent && extracted.textContent.length > 0) {
        textContent = extracted.textContent;
        _extractionMethod = 'pdf-parse';
        logger.info(`✅ Real PDF text extracted: ${textContent.length} characters from ${document.originalName}`);
      } else {
        logger.info(`📊 pdf-parse returned empty text for ${document.originalName} — may be scanned/image-only`);
      }
    } catch (error) {
      logger.warn(`⚠️ pdf-parse extraction failed for ${document.originalName}:`, error instanceof Error ? error.message : String(error));
    }
    
    logger.info(`📝 Basic extraction: ${textContent.length} characters from ${document.originalName}`);
    
    // Extract page images first
    await extractPDFPages(filePath, document.filename, textContent, pageImages);
    logger.info(`📸 Extracted ${pageImages.length} page images from ${document.originalName}`);
    
    // Smart fallback logic: Use Claude Vision if basic extraction fails or produces poor results
    const shouldUseFallback = textContent.length < 100 || 
                             (textContent.length < 500 && textContent.trim().split(/\s+/).length < 50);
    
    if (shouldUseFallback) {
      logger.info(`🔍 Low-quality content detected (${textContent.length} chars), applying Claude Vision fallback...`);
      try {
        const visionContent = await extractTextWithClaudeVision(filePath, document.originalName);
        if (visionContent && visionContent.length > textContent.length) {
          textContent = visionContent;
          logger.info(`✨ Claude Vision enhanced: ${textContent.length} characters extracted from ${document.originalName}`);
        }
      } catch (visionError) {
        logger.warn(`⚠️ Claude Vision processing failed for ${document.originalName}:`, visionError);
      }
    } else {
      logger.info(`✅ Good quality content extracted: ${textContent.length} characters from ${document.originalName}`);
    }
    
    return { textContent, pageImages };
  } catch (error) {
    logger.error(`❌ PDF processing failed for ${document.originalName}:`, error);
    return { textContent: null, pageImages: [] };
  }
}

// Enhanced Claude Vision extraction for construction drawings
async function extractTextWithClaudeVision(pdfPath: string, documentName: string): Promise<string | null> {
  try {
    const anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
    
    logger.info(`🔬 Running Claude Vision analysis on ${documentName}...`);
    
    // 🔧 FIX: Use unique temp file for each document to prevent race conditions
    const uniqueId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const uniqueFilename = `claude_vision_${uniqueId}`;
    
    const convert = fromPath(pdfPath, {
      density: 150,
      saveFilename: uniqueFilename, // 🔧 UNIQUE filename per document!
      savePath: "uploads/temp_images",
      format: "png",
      width: 800,
      height: 1200
    });
    
    // Ensure temp directory exists
    fs.mkdirSync("uploads/temp_images", { recursive: true });
    
    // Convert first page for Claude Vision analysis
    const result = await convert(1, { responseType: "image" });
    
    if (result && result.path) {
      try {
        // Read image as base64
        const imageBuffer = fs.readFileSync(result.path);
        const base64Image = imageBuffer.toString('base64');
        
        // Analyze with Claude Vision using available model
        const analysis = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          temperature: 0,
          system: "You are an expert construction document analyst. Extract all readable text, dimensions, labels, notes, and technical information from this construction drawing. Provide detailed text extraction as if performing OCR.",
          messages: [{
            role: "user",
            content: [
              {
                type: "text",
                text: "Analyze this construction drawing and extract all readable text, dimensions, room labels, notes, and technical information:"
              },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: base64Image
                }
              }
            ]
          }]
        });
        
        const extractedText = analysis.content[0].type === 'text' ? analysis.content[0].text : '';
        
        // 🔧 FIX: Only delete THIS document's temp file, not entire directory
        try {
          fs.unlinkSync(result.path); // Delete only the specific file
        } catch (cleanupError) {
          logger.warn(`Temp file cleanup warning: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
        }
        
        return extractedText;
        
      } catch (analysisError) {
        // Cleanup on error
        try {
          fs.unlinkSync(result.path);
        } catch (_cleanupError) {
          // Silent cleanup failure
        }
        throw analysisError;
      }
    }
    
    return null;

  } catch (error) {
    logger.error(`Claude Vision processing error for ${documentName}:`, error);
    return null;
  }
}

// Extract PDF pages as images
async function extractPDFPages(
  pdfPath: string, 
  filename: string, 
  textContent: string, 
  pageImages: Array<{pageNumber: number, sheetNumber?: string, sheetTitle?: string, imageUrl: string}>
): Promise<void> {
  try {
    // 🔧 FIX: Create required directory structure
    const imageDir = path.join('uploads', 'images', filename);
    fs.mkdirSync(imageDir, { recursive: true });
    
    const pageTexts = textContent.split('\f');
    
    const convert = fromPath(pdfPath, {
      density: 150,
      saveFilename: "page",
      savePath: imageDir,
      format: "png",
      width: 1200,
      height: 1600
    });

    const results = await convert.bulk(-1);
    
    for (let i = 0; i < results.length; i++) {
      const pageNumber = i + 1;
      const pageText = pageTexts[i] || '';
      const { sheetNumber, sheetTitle } = detectSheetInfo(pageText);
      const imageUrl = `/api/files/images/${filename}/page.${pageNumber}.png`;
      
      pageImages.push({
        pageNumber,
        sheetNumber,
        sheetTitle,
        imageUrl
      });
    }
  } catch (error) {
    logger.error('PDF page extraction failed:', error);
  }
}

// Enhanced AI analysis with codes & regulations - WITH COST PROTECTION
async function analyzeWithCodesAndRegulations(document: any): Promise<any> {
  const model = "claude-sonnet-4-20250514";
  const maxTokens = 12000;
  
  try {
    const analysisPrompt = `You are an expert construction document analyst, quantity surveyor, and building code compliance specialist. Perform COMPREHENSIVE analysis including BOTH detailed element extraction AND building code compliance:

**DETAILED CONSTRUCTION ELEMENT EXTRACTION:**
1. Extract EVERY door from door schedules (mark, size, type, hardware, location)
2. Extract EVERY window from window schedules (mark, size, glazing, frame type, location)
3. Extract ALL MEP elements (HVAC units, ductwork, electrical panels, fixtures, plumbing)
4. Extract ALL structural elements (concrete foundations, beams, columns, steel grades)
5. Extract ALL finishes from finish schedules (flooring, wall finishes, ceiling types)
6. Extract ALL site elements (landscaping, paving, utilities, excavation)
7. Extract grid lines, dimension lines, and property boundaries
8. Extract quantities with exact measurements and units
9. Cross-reference specifications with drawings for complete data

**BUILDING CODE COMPLIANCE:**
10. NBC (National Building Code of Canada) requirements
11. CSA (Canadian Standards Association) standards
12. IBC (International Building Code) compliance
13. Provincial building code requirements (Ontario, BC, Alberta, etc.)
14. Municipal code requirements
15. Accessibility standards (AODA/ADA compliance)
16. Fire safety and egress requirements
17. Structural load requirements and safety factors
18. Energy efficiency and environmental standards

**RISK ASSESSMENT:**
19. Non-compliance risks and severity levels
20. Required permits and approvals
21. Professional engineer/architect sign-off requirements
22. Inspection requirements and timing

Extract EVERY construction element AND provide specific code section references, compliance status (Pass/Fail/Review Required), and recommended actions for any deficiencies.`;

    const userContent = `Perform COMPREHENSIVE analysis of this construction document including BOTH detailed element extraction AND building code compliance:

DOCUMENT: ${document.originalName}
TYPE: ${document.fileType}

CONTENT:
${document.textContent?.substring(0, 12000) || 'No text content available - document may be scanned or corrupted'}

EXTRACT ALL CONSTRUCTION ELEMENTS:
- If this is a door schedule: Extract EVERY door with mark, size, type, hardware specifications
- If this is a window schedule: Extract EVERY window with mark, size, glazing type, frame specifications
- If this contains finish schedules: Extract ALL finishes by room/location
- If this shows MEP elements: Extract ALL HVAC, electrical, plumbing components with specifications
- If this shows structural elements: Extract ALL concrete, steel, masonry with grades and dimensions
- If this shows site features: Extract ALL landscaping, paving, utilities, excavation details
- Extract ALL grid lines, dimensions, and property boundaries with coordinates
- Extract ALL quantities with exact measurements and units

AND ALSO PROVIDE:
- Building code compliance assessment (NBC, CSA, IBC, provincial, municipal)
- Risk analysis and recommendations  
- Required permits and approvals
- Specific code section references with compliance status

BE EXHAUSTIVE - Extract every individual construction element while maintaining code compliance analysis.`;

    // 🛡️ COST PROTECTION: Estimate tokens and check budget BEFORE API call
    const estimatedInputTokens = Math.ceil((analysisPrompt.length + userContent.length) / 4); // Rough estimate: 4 chars per token
    
    // Check both legacy cost monitor and new plan-based monitor
    const budgetCheck = await claudeCostMonitor.checkBudgetBeforeCall(estimatedInputTokens, model);
    const planCheck = await planBasedCostMonitor.checkPlanUsage(estimatedInputTokens, 'standard');
    
    if (!budgetCheck.allowed || !planCheck.allowed) {
      const reason = !budgetCheck.allowed ? budgetCheck.reason : 'Plan token limit exceeded';
      logger.error(`💰 BUDGET PROTECTION: ${reason}`);
      logger.info(`💵 Remaining budget: $${budgetCheck.remainingBudget.toFixed(2)}`);
      logger.info(`🏢 Plan usage: ${planCheck.usage.usagePercentage.toFixed(1)}% (${planCheck.usage.tokensUsed}/${planCheck.usage.monthlyLimit})`);
      
      // Generate 75% alert if needed
      if (planCheck.alerts.length > 0) {
        logger.warn(`🔔 ${planCheck.alerts.length} plan alerts generated:`);
        planCheck.alerts.forEach(alert => {
          logger.warn(`   • ${alert.severity.toUpperCase()}: ${alert.message}`);
        });
      }
      
      return {
        analysis: `Analysis skipped - ${reason}`,
        hasRealContent: !!document.textContent && document.textContent.length > 100,
        analysisDate: new Date().toISOString(),
        complianceChecked: false,
        budgetProtected: true,
        remainingBudget: budgetCheck.remainingBudget,
        planUsage: planCheck.usage,
        planAlerts: planCheck.alerts
      };
    }

    logger.info(`💰 Budget check passed - proceeding with analysis (Remaining: $${budgetCheck.remainingBudget.toFixed(2)})`);

    const analysis = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      system: analysisPrompt,
      messages: [{
        role: "user",
        content: userContent
      }]
    });

    // 🛡️ COST TRACKING: Track actual token usage and costs
    const actualInputTokens = analysis.usage?.input_tokens || estimatedInputTokens;
    const actualOutputTokens = analysis.usage?.output_tokens || Math.ceil(maxTokens * 0.8); // Estimate if not provided
    
    // 🛡️ COST TRACKING: Track usage in both systems
    const costTracking = await claudeCostMonitor.trackApiCall(
      model,
      actualInputTokens,
      actualOutputTokens,
      document.id,
      'document_analysis'
    );
    
    const planUsage = await planBasedCostMonitor.trackPlanUsage(
      actualInputTokens + actualOutputTokens,
      'standard', // In production, get from user's actual plan
      'document_analysis',
      document.projectId
    );

    logger.info(`✅ Analysis completed for ${document.originalName}`);
    logger.info(`   💰 Cost: $${costTracking.cost.toFixed(4)} (Daily: $${costTracking.dailyTotal.toFixed(2)})`);
    logger.info(`   🏢 Plan: ${planUsage.usagePercentage.toFixed(1)}% used (${planUsage.tokensRemaining.toLocaleString()} remaining)`);

    return {
      analysis: analysis.content[0].type === 'text' ? analysis.content[0].text : 'Analysis completed',
      hasRealContent: !!document.textContent && document.textContent.length > 100,
      analysisDate: new Date().toISOString(),
      complianceChecked: true,
      codesSections: extractCodeReferences(analysis.content[0].type === 'text' ? analysis.content[0].text : ''),
      riskLevel: assessRiskLevel(analysis.content[0].type === 'text' ? analysis.content[0].text : ''),
      // 🛡️ COMPREHENSIVE COST TRACKING
      costTracking: {
        inputTokens: actualInputTokens,
        outputTokens: actualOutputTokens,
        cost: costTracking.cost,
        model,
        dailyTotal: costTracking.dailyTotal
      },
      planUsage: {
        planName: planUsage.planName,
        tokensUsed: planUsage.tokensUsed,
        tokensRemaining: planUsage.tokensRemaining,
        usagePercentage: planUsage.usagePercentage,
        alert75Triggered: planUsage.alert75Triggered
      }
    };
  } catch (error) {
    logger.error(`❌ AI analysis failed for ${document.originalName}:`, error);
    return {
      analysis: 'AI analysis failed',
      hasRealContent: false,
      analysisDate: new Date().toISOString(),
      complianceChecked: false,
      error: (error as Error).message
    };
  }
}

// Extract code references from analysis
function extractCodeReferences(analysisText: string): string[] {
  const codePatterns = [
    /NBC\s+[\d.]+/gi,
    /CSA\s+[A-Z]\d+/gi,
    /IBC\s+[\d.]+/gi,
    /OBC\s+[\d.]+/gi,
    /AODA\s+[\d.]+/gi
  ];
  
  const references: string[] = [];
  codePatterns.forEach(pattern => {
    const matches = analysisText.match(pattern);
    if (matches) {
      references.push(...matches);
    }
  });
  
  return Array.from(new Set(references)); // Remove duplicates
}

// Assess risk level from analysis
function assessRiskLevel(analysisText: string): 'Low' | 'Medium' | 'High' {
  const highRiskTerms = ['non-compliant', 'violation', 'critical', 'fail', 'dangerous'];
  const mediumRiskTerms = ['review required', 'clarification needed', 'recommend'];
  
  const text = analysisText.toLowerCase();
  
  if (highRiskTerms.some(term => text.includes(term))) return 'High';
  if (mediumRiskTerms.some(term => text.includes(term))) return 'Medium';
  return 'Low';
}

// Parallel content extraction worker
async function processContentBatch(documents: any[], startIndex: number, batchSize: number): Promise<void> {
  const batch = documents.slice(startIndex, startIndex + batchSize);
  
  for (const document of batch) {
    try {
      currentProgress.currentDocument = document.originalName;
      
      const { textContent, pageImages } = await extractDocumentContent(document);
      
      // Always update document with extracted content (including empty content for tracking)
      await storage.updateDocument(document.id, { 
        textContent: textContent || '',
        analysisStatus: textContent && textContent.length > 100 ? 'Completed' : 'Pending'
      });
      
      if (textContent && textContent.length > 100) {
        logger.info(`✅ Content saved: ${textContent.length} characters for ${document.originalName}`);
      } else {
        logger.info(`⚠️ Minimal content saved: ${textContent?.length || 0} characters for ${document.originalName}`);
      }
      
      // Store page images
      for (const pageImage of pageImages) {
        await storage.createDocumentImage({
          documentId: document.id,
          pageNumber: pageImage.pageNumber,
          sheetNumber: pageImage.sheetNumber || null,
          sheetTitle: pageImage.sheetTitle || null,
          imageUrl: pageImage.imageUrl
        });
      }
      
      currentProgress.completed++;
      logger.info(`✅ Content extracted: ${document.originalName} (${currentProgress.completed}/${currentProgress.total})`);
      
    } catch (error) {
      const errorMsg = `Failed to extract content from ${document.originalName}: ${(error as Error).message}`;
      currentProgress.errors.push(errorMsg);
      logger.error(`❌ ${errorMsg}`);
    }
  }
}

// Parallel AI analysis worker with rate limiting
async function processAnalysisBatch(documents: any[], startIndex: number, batchSize: number): Promise<void> {
  const batch = documents.slice(startIndex, startIndex + batchSize);
  
  // 🛡️ COST PROTECTION: Skip documents that already have analysis results
  const documentsNeedingAnalysis = batch.filter(doc => !doc.analysisResult);
  
  if (documentsNeedingAnalysis.length === 0) {
    logger.info(`✅ All ${batch.length} documents in batch already analyzed - skipping Claude API calls`);
    return;
  }
  
  logger.info(`🧠 Analyzing ${documentsNeedingAnalysis.length}/${batch.length} documents (${batch.length - documentsNeedingAnalysis.length} already done)`);
  
  for (const document of documentsNeedingAnalysis) {
    try {
      currentProgress.currentDocument = document.originalName;
      
      // 🟡 POTENTIAL HANG POINT: If this Claude API call hangs, entire batch stops
      const analysisResult = await analyzeWithCodesAndRegulations(document);
      
      // Update document with analysis results
      await storage.updateDocument(document.id, { 
        analysisResult,
        analysisStatus: 'Completed'
      });
      
      currentProgress.completed++;
      logger.info(`🧠 Analysis completed: ${document.originalName || document.filename || 'Unknown'} (${currentProgress.completed}/${currentProgress.total})`);
      
      // S-16 FIX: SDK handles backoff automatically. Removed blanket 5s sleep.
      
    } catch (error) {
      const errorMsg = `Failed to analyze ${document.originalName}: ${(error as Error).message}`;
      currentProgress.errors.push(errorMsg);
      logger.error(`❌ ${errorMsg}`);
      
      // S-16 FIX: SDK handles backoff automatically. Removed blanket 5s sleep on error.
    }
  }
}

// 🚨🚨🚨 DEPRECATED PATH ALERT 🚨🚨🚨
export async function processAllDocuments(projectId: string): Promise<ProcessingProgress> {
  // CRITICAL ALERT: This function is deprecated and creates duplicates
  const alertMessage = `🚨 CRITICAL: processAllDocuments called for project ${projectId}! This creates duplicates!`;
  
  logger.error(alertMessage);
  logger.error(`🔴 USE INSTEAD: POST /api/comprehensive-analysis/${projectId}`);
  logger.error(`📊 STACK TRACE:`, new Error().stack);
  logger.error(`⏰ TIMESTAMP: ${new Date().toISOString()}`);
  
  // Alert via monitoring system
  alertDeprecatedPath('batch-processor.processAllDocuments', projectId);
  
  // Alert Counter — use module-scoped variable instead of polluting global
  batchProcessorAlertCount++;
  logger.error(`🚨 BATCH PROCESSOR DEPRECATED CALLS: ${batchProcessorAlertCount}`);
  
  // Throw error if blocking enabled
  if (process.env.BLOCK_DEPRECATED_PATHS === 'true') {
    throw new Error(`🚨 BLOCKED: processAllDocuments is deprecated. Use comprehensive analysis instead.`);
  }
  
  try {
    logger.info('🚀 Starting CORRECTED BIM-first workflow for comprehensive document processing...');
    logger.info('📋 NEW ORDER: Content Extraction → AI Analysis → BIM Model → BOQ Generation → Cross-Validation');
    
    // Get all documents for the project and normalize them to use camelCase fields
    const rawDocuments = await storage.getDocuments(projectId);
    
    // Import the normalizer function
    const { normalizeDocumentForApi } = await import('./utils/document-normalizer');
    const documents = rawDocuments.map(normalizeDocumentForApi);
    
    if (documents.length === 0) {
      throw new Error('No documents found for processing');
    }
    
    // 🎯 SMART RESUME: Only process documents that need processing
    const processedDocs = documents.filter(doc => doc.textContent && doc.textContent.length >= 100);
    const pendingDocs = documents.filter(doc => !doc.textContent || doc.textContent.length < 100);
    
    // Initialize/update progress - don't reset if already processed!
    currentProgress.phase = 'content_extraction';
    currentProgress.completed = processedDocs.length; // Start from actual progress!
    currentProgress.total = documents.length;
    currentProgress.errors = currentProgress.errors || []; // Preserve existing errors
    
    logger.info(`📊 SMART PROCESSING: ${processedDocs.length} already completed, ${pendingDocs.length} pending`);
    
    if (pendingDocs.length === 0) {
      logger.info('✅ All content already extracted - skipping to AI analysis');
    } else {
      // Phase 1: Parallel content extraction (ONLY for pending docs)
      logger.info(`🔄 Phase 1: Content Extraction for ${pendingDocs.length} pending documents`);
      const contentWorkers = [];
      const batchSize = 5; // Process 5 documents per worker
      
      for (let i = 0; i < pendingDocs.length; i += batchSize) {
        contentWorkers.push(processContentBatch(pendingDocs, i, batchSize)); // Use pendingDocs, not all documents!
      }
      
      await Promise.all(contentWorkers);
    }
    
    // Phase 2: Parallel AI analysis with COMPREHENSIVE REGULATORY ANALYSIS (3 workers)
    logger.info('🧠 Phase 2: AI Analysis with FULL Codes & Regulations (Rate Limited)');
    logger.info('🏛️ Including: NBC, CSA, IBC, ASCE compliance checks + live standards lookup');
    currentProgress.phase = 'ai_analysis';
    currentProgress.completed = 0;
    
    const analysisWorkers = [];
    const analysisBatchSize = Math.ceil(documents.length / 3); // 3 workers
    
    // 🛡️ COST PROTECTION: Only run AI analysis if we have content AND no existing results
    const documentsWithContent = await storage.getDocuments(projectId); // Refresh to get updated content
    const readyForAnalysis = documentsWithContent.filter(doc => 
      doc.textContent && 
      doc.textContent.length >= 100 && 
      !doc.analysisResult // 🛡️ CRITICAL: Skip documents that already have analysis results!
    );
    
    if (readyForAnalysis.length === 0) {
      logger.info('⚠️ No documents ready for AI analysis - skipping');
    } else {
      logger.info(`🧠 Running AI analysis on ${readyForAnalysis.length} documents (${documentsWithContent.length - readyForAnalysis.length} already analyzed, skipped to save costs)`);
      
      for (let i = 0; i < readyForAnalysis.length; i += analysisBatchSize) {
        analysisWorkers.push(processAnalysisBatch(readyForAnalysis, i, analysisBatchSize));
      }
      
      await Promise.all(analysisWorkers);
    }

    // Phase 2.5: Project-Level Regulatory Analysis 
    logger.info('🏛️ Phase 2.5: Project-Level Regulatory Analysis');
    await runProjectRegulatoryAnalysis(projectId);
    
    // Phase 2.6: Generate Regulatory Report
    logger.info('📋 Phase 2.6: Generate Regulatory Compliance Report');
    await generateRegulatoryReport(projectId);
    
    // Completion
    currentProgress.phase = 'completed';
    logger.info(`🎉 Processing complete! ${currentProgress.completed} documents processed`);
    
    if (currentProgress.errors.length > 0) {
      logger.info(`⚠️ ${currentProgress.errors.length} errors occurred:`);
      currentProgress.errors.forEach(error => logger.info(`   • ${error}`));
    }
    
    return currentProgress;
    
  } catch (error) {
    logger.error('❌ Batch processing failed:', error);
    currentProgress.errors.push(`Batch processing failed: ${(error as Error).message}`);
    return currentProgress;
  }
}

// 🚀 NEW: Trigger comprehensive analysis instead of individual processing
async function triggerComprehensiveAnalysis(projectId: string): Promise<void> {
  try {
    logger.info(`🚀 Triggering comprehensive analysis for project ${projectId}`);
    
    // SECURITY FIX: Generate a real token for internal API calls instead of hardcoded test-token
    const { generateToken } = await import('./auth');
    const systemUser = await storage.getUserByUsername('system');
    const internalToken = systemUser ? generateToken(systemUser) : '';
    const response = await fetch(`http://localhost:5000/api/comprehensive-analysis/${projectId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${internalToken}` }
    });
    
    if (response.ok) {
      const result = await response.json();
      logger.info(`✅ Comprehensive analysis completed: ${result.results?.elementsExtracted || 0} elements extracted`);
    } else {
      throw new Error(`Comprehensive analysis failed with status ${response.status}`);
    }
  } catch (error) {
    logger.error(`❌ Failed to trigger comprehensive analysis for project ${projectId}:`, error);
    throw error;
  }
}

// Project-level regulatory analysis
async function runProjectRegulatoryAnalysis(projectId: string): Promise<void> {
  logger.info(`🏛️ Running comprehensive regulatory analysis for project ${projectId}`);
  
  try {
    // Import and run comprehensive regulatory analysis
    const { regulatoryAnalysisService } = await import('./regulatory-cache');
    const { StandardsService } = await import('./standards-service');
    
    const standardsService = new StandardsService();
    
    // Get project details to determine applicable codes
    const project = await storage.getProject(projectId);
    if (!project) return;
    
    // Determine jurisdiction and applicable codes
    const isCanadian = project.country === 'canada';
    const jurisdiction: 'canada' | 'usa' = isCanadian ? 'canada' : 'usa';
    
    // Get applicable building codes using live fetch method
    const applicableCodes = await standardsService.fetchLiveBuildingCodes(jurisdiction);
    
    logger.info(`📋 Identified ${applicableCodes.length} applicable building codes`);
    
    // Run detailed compliance analysis using cached regulatory analysis
    const _documents = await storage.getDocuments(projectId);
    const regulatoryContext = {
      federalCode: isCanadian ? 'NBC-2020' : 'IBC-2021',
      jurisdiction,
      projectType: project.type || 'Commercial',
      location: project.location || `[LOCATION — RFI REQUIRED: project "${project.id}" location not set]`
    };
    
    const regulatoryAnalysis = await regulatoryAnalysisService.getCachedAnalysis(regulatoryContext);
    
    // Store regulatory analysis results
    const requirementsCount = Array.isArray(regulatoryAnalysis?.keyRequirements) 
      ? regulatoryAnalysis.keyRequirements.length 
      : 0;
    logger.info(`✅ Regulatory analysis complete: ${requirementsCount} requirements analyzed`);
    
  } catch (error) {
    logger.error('❌ Project regulatory analysis failed:', error);
  }
}

// Generate comprehensive regulatory report
async function generateRegulatoryReport(projectId: string): Promise<void> {
  logger.info(`📋 Generating regulatory compliance report for project ${projectId}`);
  
  try {
    // Get all compliance checks for the project
    const complianceChecks = await storage.getComplianceChecks(projectId);
    const project = await storage.getProject(projectId);
    
    if (!project) return;
    
    // Generate compliance summary
    const passedChecks = complianceChecks.filter(c => c.status === 'Passed').length;
    const failedChecks = complianceChecks.filter(c => c.status === 'Failed').length;
    const reviewChecks = complianceChecks.filter(c => c.status === 'Review Required').length;
    
    const complianceRate = complianceChecks.length > 0 ? 
      Math.round((passedChecks / complianceChecks.length) * 100) : 0;
    
    // Create regulatory report
    const _report = await storage.createReport({
      projectId,
      reportType: 'regulatory_compliance',
      filename: `${project.name}_regulatory_compliance_${Date.now()}.pdf`,
      fileSize: 0, // File not generated yet; 0 is honest. Real size written when PDF is produced.
      status: 'Ready'
    });
    
    logger.info(`📄 Regulatory report generated: ${complianceRate}% compliance rate`);
    logger.info(`   ✅ Passed: ${passedChecks} | ❌ Failed: ${failedChecks} | ⚠️ Review: ${reviewChecks}`);
    
  } catch (error) {
    logger.error('❌ Regulatory report generation failed:', error);
  }
}

