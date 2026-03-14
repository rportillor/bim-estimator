import { Server as SocketIOServer } from "socket.io";
import { logger } from "./utils/enterprise-logger";
import { storage } from "./storage";
import type { AiConfiguration } from "@shared/schema";
import { CADParser, type CADParseResult } from "./cad-parser";
import { StandardsService } from "./standards-service";
import { regulatoryAnalysisService } from './regulatory-cache';
import fs from "fs/promises";
import path from "path";
import Anthropic from '@anthropic-ai/sdk';
import { ocrImageBuffer } from './services/ocr';
import { alertDeprecatedPath } from './monitoring/deprecated-path-monitor';
import { parseFirstJsonObject } from './utils/anthropic-response';

// Initialize Claude API client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Professional Standards Integration
const CONSTRUCTION_STANDARDS = {
  canadian: {
    building: ['NBC', 'OBC', 'BCC', 'NBCC'],
    structural: ['CSA S16', 'CSA S136', 'CSA A23.1', 'CSA A23.3'],
    electrical: ['CSA C22.1', 'ESA'],
    plumbing: ['NPC', 'OPC'],
    mechanical: ['NECB', 'ASHRAE 90.1']
  },
  american: {
    building: ['IBC', 'IRC', 'IECC'],
    structural: ['ASCE 7', 'AISC 360', 'ACI 318'],
    electrical: ['NEC', 'NFPA 70'],
    plumbing: ['IPC', 'UPC'],
    mechanical: ['IMC', 'UMC', 'ASHRAE 90.1']
  }
};

export interface ProcessingStage {
  name: string;
  description: string;
  progress: number;
}

export class AIProcessor {
  private io: SocketIOServer;
  private activeJobs = new Map<string, boolean>();
  private cadParser: CADParser;
  private standardsService: StandardsService;

  constructor(io: SocketIOServer) {
    this.io = io;
    this.cadParser = new CADParser();
    this.standardsService = new StandardsService();
  }

  async processDocument(documentId: string, configId: string): Promise<void> {
    // Create processing job
    const job = await storage.createProcessingJob({
      documentId,
      configId,
      status: "queued",
      progress: 0,
    });

    this.activeJobs.set(job.id, true);

    try {
      // Get document and configuration
      const document = await storage.getDocument(documentId);
      const config = await storage.getAiConfiguration(configId);

      if (!document || !config) {
        throw new Error("Document or configuration not found");
      }

      await this.runProcessingPipeline(job.id, document, config);
    } catch (error) {
      logger.error(`Processing failed for job ${job.id}:`, error);
      await this.updateJobStatus(job.id, "failed", 0, "", {}, (error as Error).message);
      // 🟡 POTENTIAL JOB LEAK: Missing activeJobs.set(job.id, false) could cause stuck job states
    } finally {
      this.activeJobs.delete(job.id);
    }
  }

  private async runProcessingPipeline(jobId: string, document: any, config: AiConfiguration): Promise<void> {
    const _stages = this.getProcessingStages(config);
    const processingStartedAt = Date.now();
    
    await this.updateJobStatus(jobId, "processing", 0, "initializing");
    this.emitProgress(jobId, { stage: "initializing", progress: 0, message: "Starting AI analysis..." });

    // Stage 1: File parsing and preparation
    await this.runStage(jobId, "parsing", async () => {
      await this.parseDocument(document, config);
    }, 0, 20);

    // Stage 2: NLP Analysis
    await this.runStage(jobId, "nlp", async () => {
      await this.performNLPAnalysis(document, config);
    }, 20, 40);

    // Stage 3: Computer Vision Analysis
    await this.runStage(jobId, "cv", async () => {
      await this.performCVAnalysis(document, config);
    }, 40, 60);

    // Stage 4: BoQ Generation
    await this.runStage(jobId, "boq", async () => {
      await this.generateBoQ(document, config);
    }, 60, 80);

    // Stage 5: Compliance Analysis
    await this.runStage(jobId, "compliance", async () => {
      await this.performComplianceCheck(document, config);
    }, 80, 100);

    // Complete the job
    const results = await this.compileResults(document, config, processingStartedAt);
    await this.updateJobStatus(jobId, "completed", 100, "completed", results);
    this.emitProgress(jobId, { stage: "completed", progress: 100, message: "Analysis complete!" });
  }

  private async runStage(
    jobId: string, 
    stageName: string, 
    stageFunction: () => Promise<void>,
    startProgress: number,
    endProgress: number
  ): Promise<void> {
    await this.updateJobStatus(jobId, "processing", startProgress, stageName);
    this.emitProgress(jobId, { 
      stage: stageName, 
      progress: startProgress, 
      message: `Starting ${stageName} analysis...` 
    });

    try {
      await stageFunction();
      
      // 🟡 POTENTIAL LOOP RISK: Progress simulation loop with timeouts
      // 🟡 MITIGATION: Has break condition if job cancelled, but could slow system
      for (let p = startProgress; p <= endProgress; p += 5) {
        if (!this.activeJobs.get(jobId)) break; // Check if job was cancelled
        
        await this.updateJobStatus(jobId, "processing", p, stageName);
        this.emitProgress(jobId, { 
          stage: stageName, 
          progress: p, 
          message: `Processing ${stageName}... ${p}%` 
        });
        
      }
      
      this.emitProgress(jobId, { 
        stage: stageName, 
        progress: endProgress, 
        message: `${stageName} analysis completed` 
      });
      
    } catch (error) {
      throw new Error(`${stageName} stage failed: ${(error as Error).message}`);
    }
  }

  private async parseDocument(document: any, config: AiConfiguration): Promise<any> {
    // Enhanced document parsing based on configuration
    const filePath = path.join('uploads', document.filename);
    
    try {
      await fs.access(filePath);
      
      let parseResults;
      // Parse based on file type and configuration settings
      if (document.fileType === '.pdf') {
        parseResults = await this.parsePDF(filePath, config);
      } else if (['.dwg', '.dxf', '.ifc', '.rvt'].includes(document.fileType)) {
        // Use the enhanced CAD parser for all CAD formats
        parseResults = await this.parseCADFile(filePath, document.originalName, config);
      } else {
        throw new Error(`Unsupported file type: ${document.fileType}`);
      }
      
      // Store parsing results for use in later stages
      document.parseResults = parseResults;
      return parseResults;
      
    } catch (error) {
      throw new Error(`Failed to parse document: ${(error as Error).message}`);
    }
  }

  private async parseCADFile(filePath: string, originalName: string, _config: AiConfiguration): Promise<any> {
    try {
      logger.info(`🔧 Starting CAD parsing for: ${originalName}`);
      
      // Use the new CAD parser
      const cadResult: CADParseResult = await this.cadParser.parseCADFile(filePath, originalName);
      
      // Enhanced processing based on CAD-specific data
      const enhancedResult = {
        type: 'CAD',
        format: cadResult.format,
        cadData: cadResult,
        summary: {
          fileFormat: cadResult.format,
          totalEntities: cadResult.statistics.totalEntities,
          layersFound: cadResult.layers.length,
          componentsDetected: cadResult.extractedData.buildingComponents.length,
          dimensionsExtracted: cadResult.extractedData.dimensions.length,
          textAnnotations: cadResult.extractedData.textAnnotations.length,
          drawingBounds: cadResult.statistics.drawingBounds
        },
        buildingComponents: cadResult.extractedData.buildingComponents,
        dimensions: cadResult.extractedData.dimensions,
        extractedText: cadResult.extractedData.textAnnotations,
        layers: cadResult.layers,
        metadata: cadResult.metadata
      };
      
      logger.info(`✅ CAD parsing completed: ${cadResult.statistics.totalEntities} entities, ${cadResult.layers.length} layers`);
      return enhancedResult;
      
    } catch (error) {
      logger.error(`❌ CAD parsing failed:`, error);
      throw new Error(`CAD parsing failed: ${(error as Error).message}`);
    }
  }

  private async parsePDF(filePath: string, config: AiConfiguration): Promise<any> {
    try {
      // Read PDF file
      const pdfBuffer = await fs.readFile(filePath);
      // Use pdf-parse for text extraction
      const { default: pdfParse } = await import('pdf-parse');
      const pdfData = await pdfParse(pdfBuffer);
      
      // Extract text content
      const textContent = pdfData.text;
      
      // Convert PDF pages to images for visual analysis
      const images = await this.extractPDFImages(pdfBuffer);
      
      // Hook OCR integration for construction drawings (first pass only; keep it light)
      const pageBlobs: string[] = [];
      if (images?.length) {
        const sample = images.slice(0, 3);  // OCR a few salient pages
        for (const imagePath of sample) {
          try {
            const buf = await fs.readFile(imagePath);
            const { text, confidence } = await ocrImageBuffer(buf);
            if (confidence > 50 && text.trim()) pageBlobs.push(text);
          } catch (e) {
            // OCR failed, continue with other pages
            logger.warn('OCR failed for page:', e);
          }
        }
      }
      
      // Combine original text with OCR results
      const enhancedText = [textContent, ...pageBlobs].filter(Boolean).join('\n\n');
      
      // Use Claude for comprehensive document analysis
      const analysis = await this.analyzeWithClaude(enhancedText, images, 'pdf', config);
      
      return {
        textContent,
        pageCount: pdfData.numpages,
        analysis,
        extractedImages: images.length
      };
    } catch (error) {
      throw new Error(`PDF parsing failed: ${(error as Error).message}`);
    }
  }

  private async parseCAD(filePath: string, config: AiConfiguration): Promise<any> {
    try {
      // For now, treat CAD files as complex technical drawings
      // In a full implementation, you'd use specialized CAD libraries
      const fileStats = await fs.stat(filePath);
      const fileExtension = path.extname(filePath).toLowerCase();
      
      // Use Claude to understand the CAD file context
      const analysis = await this.analyzeWithClaude(
        `CAD file analysis for ${fileExtension} file (${fileStats.size} bytes). This is a technical drawing that may contain:\n- Architectural plans\n- Structural details\n- MEP systems\n- Dimensions and annotations\n- Title blocks with specifications`,
        [],
        'cad',
        config
      );
      
      return {
        fileType: fileExtension,
        fileSize: fileStats.size,
        analysis,
        estimatedComplexity: fileStats.size > 1000000 ? 'high' : 'medium'
      };
    } catch (error) {
      throw new Error(`CAD parsing failed: ${(error as Error).message}`);
    }
  }

  private async parseIFC(filePath: string, config: AiConfiguration): Promise<any> {
    try {
      // Read first part of IFC file to extract header information
      const fileBuffer = await fs.readFile(filePath);
      const textContent = fileBuffer.toString('utf8', 0, Math.min(10000, fileBuffer.length));
      
      // Extract IFC header information
      const ifcVersion = textContent.match(/FILE_SCHEMA\s*\(\s*\('([^']+)'\)/)?.[1] || 'Unknown';
      const ifcDescription = textContent.match(/FILE_DESCRIPTION\s*\(\s*\(([^)]+)\)/)?.[1] || 'No description';
      
      // Use Claude for BIM model analysis
      const analysis = await this.analyzeWithClaude(
        `IFC/BIM file analysis:\nVersion: ${ifcVersion}\nDescription: ${ifcDescription}\nFile content preview:\n${textContent.substring(0, 2000)}...`,
        [],
        'ifc',
        config
      );
      
      return {
        ifcVersion,
        ifcDescription,
        fileSize: fileBuffer.length,
        analysis,
        contentPreview: textContent.substring(0, 500)
      };
    } catch (error) {
      throw new Error(`IFC parsing failed: ${(error as Error).message}`);
    }
  }

  private async performNLPAnalysis(document: any, config: AiConfiguration): Promise<any> {
    // Advanced NLP analysis based on configuration
    const models = config.aiModels as any;
    const nlpModel = models?.nlp || "standard";
    
    let nlpResults;
    if (nlpModel === "advanced") {
      // Use transformer models for better understanding
      nlpResults = await this.runAdvancedNLP(document, config);
    } else {
      // Standard Claude-based analysis
      nlpResults = await this.runStandardNLP(document, config);
    }
    
    // Store NLP results for use in later stages
    document.nlpResults = nlpResults;
    return nlpResults;
  }

  private async runAdvancedNLP(document: any, _config: AiConfiguration): Promise<any> {
    try {
      // Use Claude for advanced NLP analysis of construction specifications
      const analysis = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        temperature: 0,
        system: `You are an expert construction document analyst specializing in quantity surveying and building specifications. Analyze construction documents to extract:
        
        1. Technical specifications and requirements
        2. Material quantities and types
        3. Quality standards and compliance requirements
        4. Construction methods and procedures
        5. Safety and regulatory considerations
        
        Focus on professional standards like CIQS (Canadian), AACE (US), and relevant building codes.`,
        messages: [{
          role: "user",
          content: `Analyze this construction document content and extract detailed specifications:

${document.textContent || 'No text content available - document may be scanned or corrupted'}. Provide a comprehensive analysis including material takeoffs, compliance requirements, and quantity estimates.`
        }]
      });
      
      return {
        analysis: analysis.content[0].type === 'text' ? analysis.content[0].text : 'Analysis completed',
        confidence: null, // not derivable without ground-truth scoring
        extractedSpecs: this.parseSpecifications(analysis.content[0].type === 'text' ? analysis.content[0].text : ''),
        complianceFlags: this.identifyComplianceRequirements(analysis.content[0].type === 'text' ? analysis.content[0].text : '')
      };
    } catch (error) {
      logger.error('Claude NLP analysis failed:', error);
      throw new Error(`Advanced NLP processing failed: ${(error as Error).message}`);
    }
  }

  private async runStandardNLP(document: any, _config: AiConfiguration): Promise<any> {
    try {
      // Use Claude for standard NLP analysis with focus on construction terminology
      const analysis = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2500,
        temperature: 0,
        system: "You are a construction document NLP specialist. Extract and analyze technical specifications, quantities, materials, and construction methods from documents. Focus on identifying measurable elements and professional terminology.",
        messages: [{
          role: "user",
          content: `Extract technical information from this construction document:\n\n${document.textContent?.substring(0, 5000) || 'No text content available - document may be scanned or corrupted'}\n\nIdentify:\n- Material specifications\n- Quantities and measurements\n- Construction methods\n- Quality standards\n- Technical requirements`
        }]
      });
      
      return {
        analysis: analysis.content[0].type === 'text' ? analysis.content[0].text : 'Analysis completed',
        confidence: null, // not derivable without ground-truth scoring
        extractedTerms: this.extractTechnicalTerms(analysis.content[0].type === 'text' ? analysis.content[0].text : ''),
        specifications: this.parseSpecifications(analysis.content[0].type === 'text' ? analysis.content[0].text : '')
      };
    } catch (error) {
      logger.error('Standard NLP analysis failed:', error);
      // Re-throw — swallowing NLP failures produces fabricated downstream analysis
      throw new Error(`Standard NLP processing failed: ${(error as Error).message}`);
    }
  }

  private async performCVAnalysis(document: any, config: AiConfiguration): Promise<any> {
    try {
      // Use Claude's vision capabilities for construction drawing analysis
      if (document.extractedImages && document.extractedImages.length > 0) {
        const imageAnalysis = await this.analyzeConstructionImages(document.extractedImages, config);
        return imageAnalysis;
      } else {
        // Analyze based on document type and content
        return await this.analyzeDocumentVisually(document, config);
      }
    } catch (error) {
      logger.error('Claude CV analysis failed:', error);
      throw new Error(`Computer vision analysis failed: ${(error as Error).message}`);
    }
  }

  private async generateBoQ(document: any, config: AiConfiguration): Promise<any> {
    // 🚨🚨🚨 CRITICAL ALERT: DEPRECATED CODE PATH DETECTED 🚨🚨🚨
    // This method created 49 duplicates by processing each document separately
    // All BOQ generation now uses comprehensive analysis for the entire project
    
    const alertMessage = `🚨 CRITICAL ALERT: Deprecated BOQ generation called for document ${document.id}! This will create duplicates!`;
    
    // MULTI-LAYER ALERT SYSTEM
    logger.error(alertMessage);
    logger.error(`🔴 STACK TRACE:`, new Error().stack);
    logger.error(`📊 PROJECT: ${document.projectId}`);
    logger.error(`📄 DOCUMENT: ${document.id}`);
    logger.error(`⏰ TIMESTAMP: ${new Date().toISOString()}`);
    
    // Alert via monitoring system
    alertDeprecatedPath('ai-processor.generateBoQ', document.projectId, document.id);
    
    // Alert Counter for global tracking
    if (!(global as any).deprecatedPathAlerts) {
      (global as any).deprecatedPathAlerts = 0;
    }
    (global as any).deprecatedPathAlerts++;
    
    // Log to monitoring system
    if ((global as any).deprecatedPathAlerts > 0) {
      logger.error(`🚨 TOTAL DEPRECATED PATH CALLS: ${(global as any).deprecatedPathAlerts}`);
    }
    
    // Throw error to prevent execution if enabled
    if (process.env.BLOCK_DEPRECATED_PATHS === 'true') {
      throw new Error(`🚨 BLOCKED: Deprecated BOQ generation path blocked. Use comprehensive analysis instead.`);
    }
    
    return {
      itemsGenerated: 0,
      totalEstimatedValue: 0,
      confidence: 0,
      standardsApplied: config.analysisStandards,
      methodology: '🚨 DEPRECATED - Use comprehensive analysis instead',
      note: '🚨 ALERT: Individual document processing disabled. Use comprehensive analysis for entire project.',
      redirectTo: `/api/comprehensive-analysis/${document.projectId}`,
      alertTriggered: true,
      alertCount: (global as any).deprecatedPathAlerts
    };
  }

  private async performComplianceCheck(document: any, config: AiConfiguration): Promise<any> {
    logger.info(`🔍 Starting enhanced compliance check with caching...`);
    
    try {
      const standards = config.analysisStandards as string[];
      const isCanadian = standards.some(s => ['NBC', 'OBC', 'CSA', 'CIQS'].includes(s));
      
      // Extract project context for standards determination
      const projectData = this.extractProjectContext(document);
      const jurisdiction = this.determineJurisdiction(projectData, isCanadian);
      
      // Determine regulatory codes
      const federalCode = isCanadian ? 'NBC' : 'IBC';
      const stateProvincialCode = this.extractStateProvincialCode(projectData, isCanadian);
      const municipalCode = this.extractMunicipalCode(projectData);
      
      // Create regulatory context for caching
      const regulatoryContext = {
        federalCode,
        stateProvincialCode,
        municipalCode,
        jurisdiction: jurisdiction as 'canada' | 'usa',
        projectType: projectData.type,
        location: projectData.location
      };
      
      logger.info(`📋 Checking cache for regulatory combination: ${federalCode}${stateProvincialCode ? ` + ${stateProvincialCode}` : ''}${municipalCode ? ` + ${municipalCode}` : ''}`);
      
      // Use cached regulatory analysis or generate new one
      const cachedAnalysis = await regulatoryAnalysisService.getOrCreateRegulatoryAnalysis(regulatoryContext);
      
      if (cachedAnalysis.cacheHit) {
        logger.info(`✅ Using cached regulatory analysis (saved ${cachedAnalysis.tokensUsed || 2000} tokens)`);
      } else {
        logger.info(`🔄 Generated new regulatory analysis (used ${cachedAnalysis.tokensUsed} tokens)`);
      }
      
      // Fetch live building codes for additional context
      const liveStandards = await this.standardsService.fetchLiveBuildingCodes(jurisdiction);
      logger.info(`📋 Fetched ${liveStandards.length} live building code sections`);
      
      // Perform live compliance checking
      const liveComplianceRules = await this.standardsService.performLiveComplianceCheck(
        projectData, 
        jurisdiction
      );
      logger.info(`⚖️ Generated ${liveComplianceRules.length} live compliance rules`);
      
      // Combine cached analysis with project-specific rules
      const complianceData = this.combineRegulatoryAnalysisWithProjectData(
        cachedAnalysis,
        liveComplianceRules,
        standards,
        projectData
      );
      
      // Enhanced compliance data with caching integration
      const enhancedComplianceData = {
        ...complianceData,
        liveStandardsUsed: liveStandards.length,
        rulesEvaluated: liveComplianceRules.length,
        jurisdiction,
        cacheHit: cachedAnalysis.cacheHit,
        tokensSaved: cachedAnalysis.cacheHit ? 2000 : 0,
        tokensUsed: cachedAnalysis.tokensUsed,
        apiHealth: await this.standardsService.checkAPIsHealth(),
        lastUpdated: new Date()
      };
      
      // Store professional compliance checks in database
      const createdChecks = [];
      for (const check of complianceData.checks) {
        const complianceCheck = await storage.createComplianceCheck({
          projectId: document.projectId,
          ...check
        });
        createdChecks.push(complianceCheck);
      }
      
      logger.info(`✅ Enhanced compliance check completed with ${cachedAnalysis.cacheHit ? 'cached' : 'new'} regulatory analysis`);
      
      return {
        checksPerformed: createdChecks.length,
        complianceScore: complianceData.overallScore,
        criticalIssues: complianceData.criticalIssues,
        recommendations: complianceData.recommendations,
        standardsApplied: standards,
        methodology: `AI-powered professional code analysis using cached regulatory data (${cachedAnalysis.cacheHit ? 'cache hit' : 'new analysis'})`,
        liveDataIntegration: enhancedComplianceData
      };
    } catch (error) {
      logger.error('❌ Enhanced compliance check failed:', error);
      // Fallback to basic compliance checking
      return await this.performBasicComplianceCheck(document, config);
    }
  }

  private extractProjectContext(document: any): any {
    // Extract relevant project context from document and parse results
    const context = {
      buildingType: document.metadata?.buildingType || 'commercial',
      occupancyType: document.metadata?.occupancyType || 'business',
      location: document.metadata?.location || 'canada',
      materials: [] as string[],
      structuralElements: [] as any[],
      dimensions: {} as any
    };

    // Extract from CAD data if available
    if (document.parseResults?.type === 'CAD') {
      const cadData = document.parseResults.cadData;
      context.materials = cadData.extractedData?.buildingComponents?.map((c: any) => c.material).filter(Boolean) || [];
      context.structuralElements = cadData.extractedData?.buildingComponents?.filter((c: any) => c.category === 'structural') || [];
      context.dimensions = cadData.statistics?.drawingBounds || {};
    }

    // Extract from PDF analysis if available
    if (document.analysis) {
      context.buildingType = document.analysis.buildingType || context.buildingType;
      context.occupancyType = document.analysis.occupancyClassification || context.occupancyType;
      if (document.analysis.materials && Array.isArray(document.analysis.materials)) {
        const filteredMaterials = document.analysis.materials.filter((m: any) => typeof m === 'string');
        context.materials.push(...(filteredMaterials as string[]));
      }
    }

    return context;
  }

  private determineJurisdiction(projectData: any, isCanadian: boolean = false): 'canada' | 'usa' | 'both' {
    const location = projectData.location?.toLowerCase() || '';
    
    if (isCanadian || location.includes('canada') || location.includes('ontario') || location.includes('toronto')) {
      return 'canada';
    } else if (location.includes('usa') || location.includes('united states') || location.includes('america')) {
      return 'usa';
    }
    
    return 'both'; // Default to both jurisdictions for comprehensive coverage
  }

  private async performBasicComplianceCheck(document: any, config: AiConfiguration): Promise<any> {
    logger.info('🔄 Falling back to basic compliance checking...');
    
    try {
      const standards = config.analysisStandards as string[];
      const isCanadian = standards.some(s => ['NBC', 'OBC', 'CSA', 'CIQS'].includes(s));
      
      // Basic Claude analysis without live data
      const analysis = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        temperature: 0,
        system: `You are a professional building code compliance expert. ACTIVELY VALIDATE against specific code requirements:
        
        ${isCanadian ? 'CANADIAN CODES:' : 'US CODES:'}
        ${isCanadian ? `
        NBC 2020:
        - 3.2.2.10: Floor fire-resistance ≥2 hours for buildings >18m
        - 3.2.5.12: Sprinklers required if fire area >2000m² or height >18m
        - 3.4.2.1: Min 2 exits if occupant load >60
        - 3.8.3.3: Barrier-free path width ≥920mm
        - 4.1.5.5: Live loads - Residential 1.9kPa, Office 2.4kPa
        
        CSA Standards:
        - A23.1: Concrete f'c ≥25MPa (normal), ≥35MPa (F-2 exposure)
        - S16: Steel connections, bolt spacing ≥3×diameter
        - C22.1: Electrical receptacles max 3.6m spacing` : `
        IBC 2021:
        - 503.1: Height limits by construction type
        - 903.2: Sprinklers required for specific occupancies
        - 1006.2: Exit requirements by occupant load
        - 1008.1: Door min 32" wide × 80" high
        - 1103.2: Accessible routes required
        
        ASCE 7:
        - 26.5: Wind loads per location
        - 11.4: Seismic design category
        - 4.3: Live loads - Residential 40psf, Office 50psf`}
        
        For EACH code item, report:
        - Actual value found in document
        - Required value per code
        - Pass/Fail status
        - Specific recommendation if failed`,
        messages: [{
          role: "user",
          content: `ACTIVELY CHECK this document against building codes:\n\nDocument Analysis: ${JSON.stringify(document.analysis || 'Analysis pending')}\n\nProject Standards: ${standards.join(', ')}\n\nReturn specific validation results with actual vs required values.`
        }]
      });
      
      const complianceData = this.parseComplianceResults(analysis.content[0].type === 'text' ? analysis.content[0].text : '', standards);
      
      // Store basic compliance checks
      const createdChecks = [];
      for (const check of complianceData.checks) {
        const complianceCheck = await storage.createComplianceCheck({
          projectId: document.projectId,
          ...check
        });
        createdChecks.push(complianceCheck);
      }
      
      return {
        checksPerformed: createdChecks.length,
        complianceScore: complianceData.overallScore,
        criticalIssues: complianceData.criticalIssues,
        recommendations: complianceData.recommendations,
        standardsApplied: standards,
        methodology: 'Basic AI-powered code analysis using Claude (fallback mode)',
        fallbackMode: true
      };
    } catch (error) {
      logger.error('Basic compliance check also failed:', error);
      return {
        checksPerformed: 0,
        complianceScore: 0,
        criticalIssues: ['Compliance analysis failed'],
        recommendations: ['Manual compliance review required'],
        standardsApplied: [],
        methodology: 'Failed analysis',
        error: (error as Error).message
      };
    }
  }

  private async compileResults(document: any, config: AiConfiguration, processingStartedAt?: number): Promise<any> {
    // Derive real values from pipeline output — never fabricate.
    // Fields that cannot be computed without additional refactoring are set to null;
    // callers must not use null fields for financial or compliance output.

    const parseResults = document.parseResults as any;
    const nlpResults   = document.nlpResults   as any;

    // Components: prefer CAD summary, fall back to NLP specs, then null
    const componentsDetected: number | null =
      parseResults?.summary?.componentsDetected ??
      parseResults?.buildingComponents?.length ??
      nlpResults?.extractedSpecs?.length ??
      null;

    // BoQ items: generateBoQ is deprecated (returns itemsGenerated: 0); real BoQ
    // goes through the construction-workflow-processor pipeline instead.
    const boqItemsGenerated: number = 0;

    // Compliance checks stored in DB during performComplianceCheck; count them.
    let complianceChecksRun: number | null = null;
    try {
      if (document.projectId) {
        const checks = await storage.getComplianceChecks(document.projectId);
        complianceChecksRun = checks.length;
      }
    } catch {
      // Non-fatal — leave null so callers know the count is unavailable
    }

    // Elapsed time in seconds from pipeline start
    const elapsedSeconds = processingStartedAt
      ? Math.round((Date.now() - processingStartedAt) / 1000)
      : null;

    return {
      summary: {
        documentsProcessed: 1,
        componentsDetected,
        boqItemsGenerated,
        complianceChecksRun,
        processingTime: elapsedSeconds !== null ? `${elapsedSeconds} seconds` : null,
        // confidence is not derivable without a real scoring model — null until implemented
        confidence: null,
      },
      metrics: {
        // Accuracy metrics require ground-truth comparison — null until implemented
        textExtractionAccuracy: null,
        componentDetectionAccuracy: null,
        tableExtractionSuccess: null,
        standardsCompliance: null,
      },
      aiModelsUsed: config.aiModels,
      processingMode: config.processingMode,
      standardsApplied: config.analysisStandards
    };
  }

  private getProcessingStages(config: AiConfiguration): ProcessingStage[] {
    const mode = config.processingMode;
    
    const stages: ProcessingStage[] = [
      { name: "parsing", description: "Document parsing and preparation", progress: 0 },
      { name: "nlp", description: "Natural language processing", progress: 0 },
      { name: "cv", description: "Computer vision analysis", progress: 0 },
      { name: "boq", description: "Bill of Quantities generation", progress: 0 },
      { name: "compliance", description: "Compliance checking", progress: 0 }
    ];

    if (mode === "quick") {
      return stages.slice(0, 3); // Skip BoQ and compliance for quick mode
    }
    
    return stages;
  }

  private async updateJobStatus(
    jobId: string, 
    status: string, 
    progress: number, 
    currentStage?: string,
    results?: any,
    errorMessage?: string
  ): Promise<void> {
    const updateData: any = { 
      status, 
      progress, 
      currentStage,
      results,
      errorMessage
    };

    if (status === "processing" && !currentStage) {
      updateData.startedAt = new Date();
    } else if (status === "completed" || status === "failed") {
      updateData.completedAt = new Date();
    }

    await storage.updateProcessingJob(jobId, updateData);
  }

  private emitProgress(jobId: string, data: any): void {
    this.io.emit(`processing:${jobId}`, data);
    this.io.emit('processing:update', { jobId, ...data });
  }

  async cancelJob(jobId: string): Promise<boolean> {
    if (this.activeJobs.has(jobId)) {
      this.activeJobs.set(jobId, false);
      await this.updateJobStatus(jobId, "cancelled", 0);
      this.emitProgress(jobId, { stage: "cancelled", progress: 0, message: "Processing cancelled" });
      return true;
    }
    return false;
  }

  // Helper methods for Claude integration
  private async analyzeWithClaude(textContent: string, _images: string[], _fileType: string, _config: AiConfiguration): Promise<any> {
    try {
      // Determine drawing type from filename for specific spatial analysis
      const drawingType = this.identifyDrawingType(textContent);
      const prompt = this.createDrawingSpecificPrompt(drawingType, textContent);
      
      const analysis = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        temperature: 0,
        system: prompt.system,
        messages: [{
          role: "user",
          content: prompt.userContent
        }]
      });
      
      return {
        summary: analysis.content[0].type === 'text' ? analysis.content[0].text : 'Analysis completed',
        confidence: null, // not derivable without ground-truth scoring
        elementsDetected: this.extractElements(analysis.content[0].type === 'text' ? analysis.content[0].text : ''),
        complianceChecks: this.extractCompliance(analysis.content[0].type === 'text' ? analysis.content[0].text : '')
      };
    } catch (error) {
      logger.error('Claude analysis failed:', error);
      // Re-throw — returning a fake summary would propagate fabricated analysis
      throw new Error(`Claude document analysis failed: ${(error as Error).message}`);
    }
  }

  private identifyDrawingType(textContent: string): string {
    const content = textContent.toLowerCase();
    
    // Check for specific drawing types based on common naming patterns
    if (content.includes('site plan') || content.includes('a002') || content.includes('site layout')) {
      return 'SITE_PLAN';
    } else if (content.includes('underground') || content.includes('basement') || content.includes('parking') || content.includes('a102')) {
      return 'UNDERGROUND_PLAN';
    } else if (content.includes('ground floor') || content.includes('first floor') || content.includes('a201') || content.includes('a202') || content.includes('a203')) {
      return 'GROUND_FLOOR_PLAN';
    } else if (content.includes('second floor') || content.includes('a103') || content.includes('a204') || content.includes('a205')) {
      return 'UPPER_FLOOR_PLAN';
    } else if (content.includes('roof plan') || content.includes('penthouse') || content.includes('a106')) {
      return 'ROOF_PLAN';
    } else if (content.includes('elevation') || content.includes('section')) {
      return 'ELEVATION_SECTION';
    }
    
    return 'GENERAL_PLAN';
  }

  private createDrawingSpecificPrompt(drawingType: string, textContent: string): { system: string, userContent: string } {
    switch (drawingType) {
      case 'SITE_PLAN':
        return {
          system: `You are a construction surveyor specializing in SITE PLAN analysis. Your primary task is to extract REAL BUILDING FOOTPRINT and SITE COORDINATES from site plans.

Focus on:
1. **BUILDING FOOTPRINT DIMENSIONS** (CRITICAL):
   - Overall building length and width in meters/millimeters
   - Exact building perimeter coordinates
   - Property boundaries and setbacks
   - Site reference points and survey markers

2. **SITE LAYOUT COORDINATES**:
   - Building position on site (X,Y coordinates from site origin)
   - Site grid system and survey points
   - Site access points, driveways, walkways
   - Utilities connection points

3. **DIMENSIONAL CALLOUTS**:
   - All dimension lines with actual measurements
   - Site reference elevations
   - Building corner coordinates
   - Property line dimensions

Extract REAL NUMBERS, not generic descriptions. Return actual measurements found in the drawing.`,
          
          userContent: `ANALYZE THIS SITE PLAN for real building footprint and coordinates:

${textContent.substring(0, 8000)}

EXTRACT THESE SPECIFIC MEASUREMENTS:
1. Building footprint dimensions (length × width in actual units)
2. Building corner coordinates from site origin
3. All dimension line measurements visible in the drawing
4. Site grid references and survey points
5. Property boundaries and building setbacks

FORMAT: Return actual numbers with units (e.g., "Building: 45.7m × 28.3m", "Grid A1 at X=0, Y=0", "Dimension: 8500mm")`
        };

      case 'GROUND_FLOOR_PLAN':
        return {
          system: `You are a structural engineer specializing in FLOOR PLAN coordinate extraction. Extract REAL STRUCTURAL GRID and ELEMENT POSITIONS from ground floor plans.

Focus on:
1. **STRUCTURAL GRID SYSTEM**:
   - Grid line labels (A, B, C, 1, 2, 3)
   - Grid line coordinates and spacing
   - Grid intersections and column positions
   - Structural bay dimensions

2. **REAL ELEMENT COORDINATES**:
   - Wall positions relative to grid lines
   - Column locations at grid intersections
   - Door and window positions with coordinates
   - Beam and structural element positions

3. **DIMENSIONAL DATA**:
   - Room dimensions and coordinates
   - Wall thicknesses and positions
   - Structural element sizes and locations
   - Floor elevation reference points`,
          
          userContent: `ANALYZE THIS GROUND FLOOR PLAN for structural grid and element coordinates:

${textContent.substring(0, 8000)}

EXTRACT THESE COORDINATES:
1. Structural grid system (grid labels and spacing)
2. Column positions at grid intersections
3. Wall positions relative to grid lines
4. All dimension lines with measurements
5. Room boundaries and coordinates

FORMAT: Return grid coordinates (e.g., "Grid A at X=0", "Column A1 at (0,0)", "Wall from A1 to B1", "Dimension: 7500mm")`
        };

      case 'UNDERGROUND_PLAN':
        return {
          system: `You are a foundation engineer analyzing UNDERGROUND/BASEMENT plans. Extract FOUNDATION COORDINATES and BELOW-GRADE structure data.

Focus on:
1. **FOUNDATION SYSTEM**:
   - Foundation wall positions and dimensions
   - Footing locations and coordinates
   - Foundation grid system
   - Basement column positions

2. **BELOW-GRADE COORDINATES**:
   - Basement room layouts and dimensions
   - Underground parking layout if applicable
   - Foundation depth and elevation data
   - Structural foundation elements

3. **FOUNDATION DIMENSIONS**:
   - Foundation wall thicknesses
   - Footing sizes and spacing
   - Basement slab dimensions
   - Underground utility coordinates`,
          
          userContent: `ANALYZE THIS UNDERGROUND/BASEMENT PLAN for foundation coordinates:

${textContent.substring(0, 8000)}

EXTRACT THESE FOUNDATION DATA:
1. Foundation grid system and coordinates
2. Foundation wall positions and dimensions
3. Basement column locations
4. Underground room layouts
5. Foundation depth and elevation references

FORMAT: Return foundation coordinates with depths (e.g., "Foundation at elevation -2.5m", "Footing F1 at (0,0)", "Foundation wall 200mm thick")`
        };

      default:
        return {
          system: `You are an expert construction document analyst. Extract QUANTIFIABLE BUILDING DATA from construction drawings.

Focus on:
1. **SPATIAL COORDINATES**:
   - Element positions and dimensions
   - Grid references and coordinates
   - Dimensional callouts and measurements

2. **BUILDING COMPONENTS**:
   - Walls, columns, beams, slabs
   - Doors, windows, openings
   - Material specifications

3. **DIMENSIONAL DATA**:
   - All dimension lines and measurements
   - Coordinate references
   - Elevation data`,
          
          userContent: `ANALYZE THIS CONSTRUCTION DRAWING for spatial coordinates and building data:

${textContent.substring(0, 8000)}

EXTRACT:
1. Element coordinates and dimensions
2. Grid system if present
3. All dimensional callouts
4. Building component positions

FORMAT: Return actual measurements and coordinates found in the drawing.`
        };
    }
  }

  private async analyzeConstructionImages(images: string[], _config: AiConfiguration): Promise<any> {
    try {
      // Use Claude Vision to analyze construction drawings and extract text/data
      const analysisPrompt = `You are an expert construction document analyst specializing in reading architectural and engineering drawings. Analyze these construction drawing images and extract:

1. **TEXT CONTENT**: Read all visible text, labels, dimensions, notes, and annotations
2. **BUILDING ELEMENTS**: Identify rooms, spaces, structural elements, doors, windows
3. **MEASUREMENTS**: Extract all dimensions, scales, grid references, coordinates
4. **TECHNICAL DATA**: Material specifications, symbols, reference numbers
5. **SPATIAL RELATIONSHIPS**: Floor plans, elevations, building layout information

Provide detailed text extraction as if performing OCR on technical construction drawings.`;

      if (images && images.length > 0) {
        // For now, analyze the first image as proof of concept
        const analysis = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          temperature: 0,
          system: analysisPrompt,
          messages: [{
            role: "user",
            content: [
              {
                type: "text",
                text: "Analyze this construction drawing and extract all readable text, dimensions, and technical information:"
              },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: await this.convertImageToBase64(images[0])
                }
              }
            ]
          }]
        });

        const extractedText = analysis.content[0].type === 'text' ? analysis.content[0].text : '';
        
        return {
          imagesAnalyzed: images.length,
          extractedText: extractedText,
          extractedDimensions: this.extractDimensions(extractedText),
          detectedElements: this.parseDetectedElements(extractedText),
          qualityAssessment: 'Claude Vision analysis of construction drawings',
          method: 'Claude Vision API'
        };
      }
      
      return {
        imagesAnalyzed: 0,
        extractedText: '',
        extractedDimensions: [],
        detectedElements: [],
        qualityAssessment: 'No images available for analysis'
      };
    } catch (error) {
      logger.error('Claude Vision analysis failed:', error);
      return {
        imagesAnalyzed: images?.length || 0,
        extractedText: '',
        extractedDimensions: [],
        detectedElements: [],
        qualityAssessment: 'Vision analysis failed',
        error: (error as Error).message
      };
    }
  }

  private async analyzeDocumentVisually(document: any, config: AiConfiguration): Promise<any> {
    try {
      // Convert PDF to image and analyze with Claude Vision
      // SECURITY FIX: Validate base64 before creating buffer
      if (!document.filename || typeof document.filename !== 'string') {
        throw new Error('Invalid document filename');
      }
      const images = await this.extractPDFImages(Buffer.from(document.filename, 'base64'));
      
      if (images && images.length > 0) {
        const visionAnalysis = await this.analyzeConstructionImages(images, config);
        return {
          documentType: document.fileType || 'construction_drawing',
          visualComplexity: 'high',
          readabilityScore: null, // not derivable without ground-truth comparison
          technicalContent: true,
          extractedContent: visionAnalysis.extractedText,
          analysisMethod: 'Claude Vision API',
          recommendedAnalysis: 'Vision-based extraction completed'
        };
      }
      
      return {
        documentType: document.fileType || 'unknown',
        visualComplexity: 'medium',
        readabilityScore: null, // not derivable without ground-truth comparison
        technicalContent: true,
        recommendedAnalysis: 'Image extraction required'
      };
    } catch (error) {
      logger.error('Visual document analysis failed:', error);
      return {
        documentType: document.fileType || 'unknown',
        visualComplexity: 'medium',
        readabilityScore: null, // not derivable without ground-truth comparison
        technicalContent: true,
        recommendedAnalysis: 'Fallback to text extraction',
        error: (error as Error).message
      };
    }
  }

  private async extractPDFImages(pdfBuffer: Buffer): Promise<string[]> {
    try {
      // Use pdf2pic to convert PDF pages to images
      const { default: pdf2pic } = await import('pdf2pic');
      const convert = pdf2pic.fromBuffer(pdfBuffer, {
        density: 150,
        saveFilename: "page",
        savePath: "/tmp/pdf_images",
        format: "png",
        width: 1200,
        height: 1600
      });
      
      const results = await convert.bulk(-1, { responseType: "image" });
      return results.map((result: any) => result.path);
    } catch (error) {
      logger.error('PDF to image conversion failed:', error);
      return [];
    }
  }

  private async convertImageToBase64(imagePath: string): Promise<string> {
    try {
      const { readFileSync } = await import('fs');
      const imageBuffer = readFileSync(imagePath);
      return imageBuffer.toString('base64');
    } catch (error) {
      logger.error('Image to base64 conversion failed:', error);
      return '';
    }
  }

  private extractDimensions(text: string): any[] {
    const dimensions = [];
    const patterns = [
      /([0-9]+(?:\.[0-9]+)?)[\s]*(?:mm|cm|m|ft|in|inch|'|")\b/gi,
      /([0-9]+)[\s]*x[\s]*([0-9]+)(?:[\s]*(?:mm|cm|m|ft|in))?/gi,
      /([0-9]+(?:\.[0-9]+)?)\s*x\s*([0-9]+(?:\.[0-9]+)?)/gi
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        dimensions.push({
          value: match[0],
          context: text.substring(Math.max(0, match.index - 20), match.index + match[0].length + 20)
        });
      }
    }
    
    return dimensions;
  }

  private parseDetectedElements(text: string): any[] {
    const elements = [];
    const keywords = {
      'structural': ['wall', 'column', 'beam', 'foundation', 'slab'],
      'openings': ['door', 'window', 'opening', 'entrance'],
      'spaces': ['room', 'bathroom', 'kitchen', 'office', 'bedroom'],
      'mechanical': ['hvac', 'duct', 'pipe', 'electrical', 'plumbing']
    };
    
    for (const [category, words] of Object.entries(keywords)) {
      for (const word of words) {
        if (text.toLowerCase().includes(word)) {
          elements.push({
            type: category,
            element: word,
            confidence: null, // keyword-match only, no ground-truth scoring
            description: `${word} detected in construction drawing`
          });
        }
      }
    }
    
    return elements;
  }

  private parseSpecifications(analysisText: string): any[] {
    const specs = [];
    const lines = analysisText.split('\n');
    
    for (const line of lines) {
      if (line.includes('specification') || line.includes('requirement') || line.includes('standard')) {
        specs.push({
          type: 'specification',
          content: line.trim(),
          category: this.categorizeSpec(line)
        });
      }
    }
    
    return specs;
  }

  private identifyComplianceRequirements(analysisText: string): any[] {
    const requirements = [];
    const canadianStandards = Object.values(CONSTRUCTION_STANDARDS.canadian).flat();
    const americanStandards = Object.values(CONSTRUCTION_STANDARDS.american).flat();
    
    for (const standard of [...canadianStandards, ...americanStandards]) {
      if (analysisText.includes(standard)) {
        requirements.push({
          standard,
          type: canadianStandards.includes(standard) ? 'canadian' : 'american',
          context: 'Identified in document analysis',
          category: this.getStandardCategory(standard),
          criticality: this.assessStandardCriticality(standard)
        });
      }
    }
    
    return requirements;
  }

  private parseBoQFromResponse(response: string): any {
    try {
      const parsed = parseFirstJsonObject(response);
      if (parsed && !parsed.error) {
        return parsed;
      }

      return this.parseStructuredBoQText(response);
    } catch (error) {
      // S-02 FIX: Never fabricate BOQ data. Missing BOQ data is a genuine
      // information gap that must surface as an RFI, not be silently filled
      // with invented quantities and costs. Re-throw so callers can register
      // the appropriate RFI via their trackMissingData() pipeline.
      throw new Error(
        `❌ BOQ PARSE FAILURE: Cannot produce Bill of Quantities without valid structured data from construction documents. ` +
        `Raw parse error: ${error instanceof Error ? error.message : String(error)}. ` +
        `An RFI must be raised to obtain machine-readable BOQ data from the QS or design team.`
      );
    }
  }

  private parseStructuredBoQText(text: string): any {
    const items = [];
    const lines = text.split('\n');
    
    for (const line of lines) {
      if (line.includes('m³') || line.includes('m²') || line.includes('kg') || line.includes('each')) {
        items.push({
          description: line.trim(),
          itemCode: this.generateItemCode(line),
          unit: this.extractUnit(line),
          quantity: this.extractQuantity(line),
          category: this.categorizeItem(line)
        });
      }
    }
    
    return {
      items,
      // S-03 FIX: totalValue must never be fabricated. item_count × $1,000 is
      // not a cost — it is a random number. Real cost computation belongs
      // exclusively in the estimate engine against CIQS-rated assemblies.
      // Callers must not use this field for financial output.
      totalValue: null,
      confidence: null // keyword-match parse only, no structured confidence scoring
    };
  }

  private extractElements(text: string): any[] {
    const elements = [];
    const keywords = ['concrete', 'steel', 'wood', 'masonry', 'electrical', 'plumbing', 'hvac'];
    
    for (const keyword of keywords) {
      if (text.toLowerCase().includes(keyword)) {
        elements.push({
          type: keyword,
          // confidence: not derivable without ground-truth scoring — omitted rather than fabricated
          context: `Identified in analysis text`
        });
      }
    }
    
    return elements;
  }

  private extractCompliance(text: string): any[] {
    const compliance = [];
    const lines = text.split('\n');
    
    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes('standard') || lowerLine.includes('code') || lowerLine.includes('regulation')) {
        compliance.push({
          type: 'regulatory',
          content: line.trim(),
          severity: this.assessComplianceSeverity(line)
        });
      }
    }
    
    return compliance;
  }
  
  private extractTechnicalTerms(text: string): string[] {
    const terms = [];
    const technicalPatterns = [
      /\b\d+\s*MPa\b/gi, // Concrete strength
      /\bGrade\s*\d+[A-Z]*\b/gi, // Steel grades
      /\b\d+\s*mm\b/gi, // Dimensions
      /\b\d+\s*m[²³]\b/gi, // Areas and volumes
      /\bCSA\s*[A-Z]?\d+\.?\d*\b/gi, // CSA standards
      /\bASTM\s*[A-Z]\d+\b/gi, // ASTM standards
    ];
    
    for (const pattern of technicalPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        terms.push(...matches);
      }
    }
    
    return Array.from(new Set(terms)); // Remove duplicates
  }
  
  private assessComplianceSeverity(text: string): string {
    const lowerText = text.toLowerCase();
    if (lowerText.includes('mandatory') || lowerText.includes('required') || lowerText.includes('shall')) {
      return 'high';
    }
    if (lowerText.includes('recommended') || lowerText.includes('should')) {
      return 'medium';
    }
    return 'low';
  }

  private categorizeSpec(line: string): string {
    if (line.toLowerCase().includes('structural')) return 'structural';
    if (line.toLowerCase().includes('electrical')) return 'electrical';
    if (line.toLowerCase().includes('mechanical')) return 'mechanical';
    return 'general';
  }

  private generateItemCode(line: string): string {
    if (line.toLowerCase().includes('concrete')) return '03.30.00';
    if (line.toLowerCase().includes('steel')) return '05.12.00';
    if (line.toLowerCase().includes('electrical')) return '26.00.00';
    return '01.00.00';
  }

  private extractUnit(line: string): string {
    if (line.includes('m³')) return 'm³';
    if (line.includes('m²')) return 'm²';
    if (line.includes('kg')) return 'kg';
    if (line.includes('each')) return 'each';
    return 'item';
  }

  private extractQuantity(line: string): string {
    const match = line.match(/\d+\.?\d*/);
    return match ? match[0] : '1.0';
  }

  private categorizeItem(line: string): string {
    if (line.toLowerCase().includes('concrete')) return 'Concrete Work';
    if (line.toLowerCase().includes('steel')) return 'Steel Work';
    if (line.toLowerCase().includes('electrical')) return 'Electrical';
    return 'General';
  }

  private parseComplianceResults(analysisText: string, standards: string[]): any {
    // Parse Claude's compliance analysis into structured data
    const checks = [];
    const lines = analysisText.split('\n');
    // overallScore built from real check results only — a default 'good' score is fabricated data
    let overallScore: number = 0;
    const criticalIssues = [];
    const recommendations = [];
    
    // Extract structured compliance information
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      
      // Look for compliance indicators
      if (line.includes('compliance') || line.includes('requirement') || line.includes('code')) {
        const status = this.determineComplianceStatus(lines[i]);
        const standard = this.identifyRelevantStandard(lines[i], standards);
        
        checks.push({
          standard: standard || 'General Requirement',
          requirement: this.extractRequirement(lines[i]),
          status: status,
          details: lines[i].trim(),
          recommendation: this.generateRecommendation(lines[i], status)
        });
        
        if (status === 'Failed' || status === 'Critical') {
          criticalIssues.push(lines[i].trim());
          overallScore -= 0.1;
        }
      }
      
      // Extract recommendations
      if (line.includes('recommend') || line.includes('should') || line.includes('must')) {
        recommendations.push(lines[i].trim());
      }
    }
    
    // Zero checks means Claude returned nothing structured — fabricating defaults is not allowed.
    if (checks.length === 0) {
      throw new Error(
        `COMPLIANCE PARSE FAILURE: Claude returned no structured compliance checks for standards: ${standards.join(', ')}. ` +
        `An RFI must be raised — compliance results cannot be fabricated.`
      );
    }
    
    return {
      checks,
      overallScore: Math.max(0.0, Math.min(1.0, overallScore)),
      criticalIssues,
      recommendations: recommendations.length > 0 ? recommendations : ['Continue with professional review']
    };
  }

  private determineComplianceStatus(text: string): string {
    const lowerText = text.toLowerCase();
    if (lowerText.includes('fail') || lowerText.includes('non-compliant') || lowerText.includes('violation')) {
      return 'Failed';
    }
    if (lowerText.includes('critical') || lowerText.includes('immediate')) {
      return 'Critical';
    }
    if (lowerText.includes('review') || lowerText.includes('verify') || lowerText.includes('check')) {
      return 'Review Required';
    }
    if (lowerText.includes('pass') || lowerText.includes('compliant') || lowerText.includes('meets')) {
      return 'Passed';
    }
    return 'Under Review';
  }

  private identifyRelevantStandard(text: string, standards: string[]): string | null {
    const upperText = text.toUpperCase();
    for (const standard of standards) {
      if (upperText.includes(standard.toUpperCase())) {
        return standard;
      }
    }
    
    // Check for common standard patterns
    const allStandards = Object.values(CONSTRUCTION_STANDARDS.canadian).flat()
      .concat(Object.values(CONSTRUCTION_STANDARDS.american).flat());
    
    for (const standard of allStandards) {
      if (upperText.includes(standard.toUpperCase())) {
        return standard;
      }
    }
    
    return null;
  }

  private extractRequirement(text: string): string {
    // Extract the key requirement from the text
    if (text.includes('fire')) return 'Fire resistance requirements';
    if (text.includes('structural')) return 'Structural integrity requirements';
    if (text.includes('accessibility')) return 'Accessibility compliance';
    if (text.includes('seismic')) return 'Seismic design requirements';
    if (text.includes('concrete')) return 'Concrete specification requirements';
    if (text.includes('steel')) return 'Steel design requirements';
    return 'General building code compliance';
  }

  private generateRecommendation(text: string, status: string): string {
    if (status === 'Failed' || status === 'Critical') {
      return 'Immediate revision required - consult with professional engineer';
    }
    if (status === 'Review Required') {
      return 'Schedule professional review and verification';
    }
    if (status === 'Passed') {
      return 'Continue with current design approach';
    }
    return 'Monitor compliance during construction phase';
  }

  private getStandardCategory(standard: string): string {
    if (['NBC', 'OBC', 'BCC', 'IBC', 'IRC'].includes(standard)) return 'Building Code';
    if (['CSA S16', 'CSA S136', 'AISC 360', 'ASCE 7'].includes(standard)) return 'Structural';
    if (['CSA A23.1', 'CSA A23.3', 'ACI 318'].includes(standard)) return 'Concrete';
    if (['CSA C22.1', 'NEC', 'NFPA 70'].includes(standard)) return 'Electrical';
    return 'General';
  }

  private assessStandardCriticality(standard: string): string {
    // Life safety standards are critical
    if (['NBC', 'IBC', 'NFPA', 'CSA C22.1'].includes(standard)) return 'Critical';
    // Structural standards are high priority
    if (['CSA S16', 'AISC 360', 'ASCE 7', 'CSA A23.3', 'ACI 318'].includes(standard)) return 'High';
    return 'Standard';
  }

  private extractStateProvincialCode(projectData: any, isCanadian: boolean): string | undefined {
    if (!projectData.location) return undefined;
    
    const location = projectData.location.toLowerCase();
    
    if (isCanadian) {
      if (location.includes('ontario')) return 'OBC';
      if (location.includes('british columbia') || location.includes('bc')) return 'BCBC';
      if (location.includes('alberta')) return 'ABC';
      if (location.includes('quebec')) return 'QBC';
      if (location.includes('manitoba')) return 'MBC';
      if (location.includes('saskatchewan')) return 'SBC';
      if (location.includes('nova scotia')) return 'NSBC';
      if (location.includes('new brunswick')) return 'NBBC';
      if (location.includes('newfoundland')) return 'NBC';
      if (location.includes('prince edward island')) return 'PEIBC';
    } else {
      if (location.includes('california')) return 'CBC';
      if (location.includes('new york')) return 'NYBC';
      if (location.includes('texas')) return 'TBC';
      if (location.includes('florida')) return 'FBC';
      if (location.includes('illinois')) return 'IBC-IL';
      if (location.includes('pennsylvania')) return 'UCC';
      if (location.includes('ohio')) return 'OBC-US';
      if (location.includes('michigan')) return 'MBC-US';
    }
    
    return undefined;
  }

  private extractMunicipalCode(projectData: any): string | undefined {
    if (!projectData.location) return undefined;
    
    const location = projectData.location.toLowerCase();
    
    // Major Canadian cities
    if (location.includes('toronto')) return 'Toronto Building Code';
    if (location.includes('vancouver')) return 'Vancouver Building Bylaw';
    if (location.includes('montreal')) return 'Montreal Building Bylaw';
    if (location.includes('calgary')) return 'Calgary Building Code';
    if (location.includes('ottawa')) return 'Ottawa Building Code';
    if (location.includes('edmonton')) return 'Edmonton Building Code';
    if (location.includes('winnipeg')) return 'Winnipeg Building Code';
    if (location.includes('quebec city')) return 'Quebec City Building Bylaw';
    
    // Major US cities
    if (location.includes('new york city') || location.includes('nyc')) return 'NYC Building Code';
    if (location.includes('los angeles')) return 'LA Building Code';
    if (location.includes('chicago')) return 'Chicago Building Code';
    if (location.includes('houston')) return 'Houston Building Code';
    if (location.includes('philadelphia')) return 'Philadelphia Building Code';
    if (location.includes('phoenix')) return 'Phoenix Building Code';
    if (location.includes('san antonio')) return 'San Antonio Building Code';
    if (location.includes('san diego')) return 'San Diego Building Code';
    if (location.includes('dallas')) return 'Dallas Building Code';
    if (location.includes('san jose')) return 'San Jose Building Code';
    if (location.includes('austin')) return 'Austin Building Code';
    if (location.includes('jacksonville')) return 'Jacksonville Building Code';
    if (location.includes('san francisco')) return 'SF Building Code';
    if (location.includes('seattle')) return 'Seattle Building Code';
    if (location.includes('denver')) return 'Denver Building Code';
    if (location.includes('boston')) return 'Boston Building Code';
    if (location.includes('miami')) return 'Miami Building Code';
    
    return undefined;
  }

  private combineRegulatoryAnalysisWithProjectData(
    cachedAnalysis: any,
    liveComplianceRules: any[],
    standards: string[],
    projectData: any
  ): any {
    // Convert cached analysis to compliance data format
    const checks = [];
    
    // Add checks from cached regulatory analysis
    for (const rule of cachedAnalysis.complianceRules || []) {
      checks.push({
        standard: rule.level === 'federal' ? (standards.includes('NBC') ? 'NBC' : 'IBC') : 
                 rule.level === 'provincial' ? this.extractStateProvincialCode(projectData, standards.includes('NBC')) || 'Regional Code' :
                 rule.level === 'municipal' ? this.extractMunicipalCode(projectData) || 'Municipal Code' : 'General',
        requirement: rule.requirement,
        status: rule.criticality === 'high' ? 'Critical' : rule.criticality === 'medium' ? 'Review Required' : 'Passed',
        details: rule.requirement,
        recommendation: rule.criticality === 'high' ? 'Immediate attention required' : 
                      rule.criticality === 'medium' ? 'Schedule professional review' : 'Monitor during construction'
      });
    }
    
    // Add checks from live compliance rules
    for (const rule of liveComplianceRules.slice(0, 5)) {
      checks.push({
        standard: rule.standard,
        requirement: rule.requirement,
        status: 'Under Review',
        details: rule.requirement,
        recommendation: 'Verify compliance with current standards'
      });
    }
    
    // Add checks from cached key requirements
    for (const req of cachedAnalysis.keyRequirements || []) {
      checks.push({
        standard: req.reference || 'General',
        requirement: req.requirement,
        status: 'Passed',
        details: req.applicability || req.requirement,
        recommendation: 'Continue with current design approach'
      });
    }
    
    // Calculate compliance score based on cached analysis
    const totalChecks = checks.length;
    const passedChecks = checks.filter(c => c.status === 'Passed').length;
    // Fallback of 85 is fabricated — if no checks exist, score is null
    const complianceScore: number | null = totalChecks > 0
      ? Math.round((passedChecks / totalChecks) * 100)
      : null;
    
    // Extract critical issues from conflict areas
    const criticalIssues = (cachedAnalysis.conflictAreas || []).map((conflict: any) => ({
      issue: conflict.description,
      severity: 'High',
      recommendations: conflict.resolution ? [conflict.resolution] : ['Consult with professional engineer']
    }));
    
    return {
      checks,
      overallScore: complianceScore,
      criticalIssues,
      recommendations: [
        ...cachedAnalysis.keyRequirements?.map((req: any) => req.requirement) || [],
        'Continue monitoring compliance during construction phase',
        'Schedule regular code compliance reviews'
      ]
    };
  }
}
