/**
 * 🔄 MULTI-STAGE COMPREHENSIVE ANALYSIS
 * 
 * Breaks analysis into manageable parallel/series stages:
 * Stage 1: Regulatory Knowledge Base (All codes/standards) — Claude AI
 * Stage 2: Construction Elements Extraction (Apply knowledge) — Claude AI
 * Stage 3: Clash Detection & Validation — Deterministic engine (SOP 6.4)
 *
 * Stage 3 was previously a Claude prompt-based conflict detector.
 * Now replaced with the deterministic clash-detection-engine.ts which
 * performs AABB geometry analysis against BIM elements in storage.
 * This is faster, reproducible, and follows QS Level 5 methodology.
 */

import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { storage } from '../storage';
import { logger } from '../utils/enterprise-logger';
import { claudeCostMonitor as _claudeCostMonitor } from '../services/claude-cost-monitor';
import {
  runClashDetectionForProject,
  emptyClearanceRequirements,
  type ClashDetectionResult,
} from '../services/clash-detection-engine';

const router = Router();
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface AnalysisStage {
  stage: number;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  results?: any;
  startTime?: Date;
  endTime?: Date;
  tokensUsed?: number;
}

const runningAnalyses = new Map<string, AnalysisStage[]>();

/**
 * POST /api/multi-stage-analysis/:projectId
 * Run comprehensive analysis in optimized stages
 */
router.post('/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const { mode = 'parallel', clearances } = req.body;

  try {
    logger.info(`🔄 Starting multi-stage analysis for project ${projectId} in ${mode} mode`);

    const documents = await storage.getDocumentsByProject(projectId);
    const project = await storage.getProject(projectId);
    const projectName = project?.name
      || `[PROJECT NAME — RFI REQUIRED: project "${projectId}" not found in storage]`;
    const projectLocation = project?.location
      || `[PROJECT LOCATION — RFI REQUIRED: project "${projectId}" not found in storage]`;
    const mainSpec = documents.find(doc =>
      (doc.filename || '').toLowerCase().includes('spec')
    );

    if (!mainSpec || !mainSpec.textContent) {
      return res.status(400).json({
        success: false,
        message: 'No specifications document found'
      });
    }

    // Initialize analysis stages
    const stages: AnalysisStage[] = [
      { stage: 1, name: 'Regulatory Knowledge Base', status: 'pending' },
      { stage: 2, name: 'Construction Elements Extraction', status: 'pending' },
      { stage: 3, name: 'Clash Detection & Validation (SOP 6.4)', status: 'pending' }
    ];

    runningAnalyses.set(projectId, stages);

    if (mode === 'parallel') {
      await runParallelAnalysis(projectId, mainSpec.textContent, stages, clearances, projectName, projectLocation);
    } else {
      await runSeriesAnalysis(projectId, mainSpec.textContent, stages, clearances, projectName, projectLocation);
    }

    // Combine results
    const finalResults = combineStageResults(stages);

    // Store final results
    await storeMultiStageResults(projectId, finalResults);

    res.json({
      success: true,
      message: 'Multi-stage analysis completed',
      mode,
      stages: stages.map(s => ({
        stage: s.stage,
        name: s.name,
        status: s.status,
        tokensUsed: s.tokensUsed,
        duration: s.endTime && s.startTime ?
          s.endTime.getTime() - s.startTime.getTime() : null
      })),
      results: finalResults
    });

  } catch (error) {
    logger.error(`Multi-stage analysis failed for project ${projectId}`, { error });
    runningAnalyses.delete(projectId);

    res.status(500).json({
      success: false,
      message: 'Multi-stage analysis failed',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 1: Comprehensive Regulatory Knowledge Base (Claude AI)
// ═══════════════════════════════════════════════════════════════════════════════

async function runRegulatoryAnalysis(specContent: string, projectName: string, projectLocation: string): Promise<any> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    temperature: 0,
    system: `You are a building code expert. Create a comprehensive regulatory knowledge base for a multi-residential project located at: ${projectLocation || '[LOCATION — RFI REQUIRED]'}.

ANALYZE ALL APPLICABLE CODES AND DETERMINE RELEVANCE:

NBC (National Building Code of Canada):
- Review ALL parts (3,4,5,6,7,8,9) 
- Identify sections that apply to multi-residential construction
- Note specific requirements for this building type

Ontario Building Code:
- Identify provincial amendments to NBC
- Energy efficiency requirements
- Environmental standards specific to Ontario

CSA Standards:
- Structural (concrete, steel, masonry, wood)
- Fire safety and protection systems  
- Electrical and mechanical systems
- Accessibility and environmental

Municipal Requirements:
- Local building standards for the project jurisdiction
- Zoning and development standards
- Regional utilities and infrastructure requirements

OUTPUT: Comprehensive regulatory framework with specific section numbers and requirements.`,

    messages: [{
      role: "user",
      content: `Create comprehensive regulatory knowledge base for this project:

PROJECT: ${projectName}
LOCATION: ${projectLocation || '[LOCATION — RFI REQUIRED]'}

SPECIFICATIONS CONTENT:
${specContent.substring(0, 80000)}

ANALYZE and CORRELATE all relevant building codes, standards, and municipal requirements that apply to this specific project type and location.

Return detailed JSON with complete regulatory framework.`
    }]
  });

  const content = Array.isArray(response.content)
    ? response.content.map((c: any) => c?.text || "").join("\n")
    : (response.content as any)?.text || "";

  return { content, tokensUsed: response.usage?.input_tokens + response.usage?.output_tokens || 0 };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 2: Construction Elements Extraction (Claude AI)
// ═══════════════════════════════════════════════════════════════════════════════

async function runElementsAnalysis(specContent: string, regulatoryKnowledge: any): Promise<any> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8000,
    temperature: 0,
    system: `You are a construction estimator extracting ALL construction elements for BIM modeling and real building construction.

REGULATORY KNOWLEDGE CONTEXT:
${JSON.stringify(regulatoryKnowledge, null, 2).substring(0, 10000)}

USE this regulatory knowledge to ensure every element you extract meets code requirements.

EXTRACT ALL CONSTRUCTION ELEMENTS:
- Apply code requirements to each element specification
- Include manufacturer details and technical specifications
- Focus on physical materials and systems that will be built
- Minimum 50 unique construction elements expected

OUTPUT: Detailed JSON array of construction elements with code compliance integrated.`,

    messages: [{
      role: "user",
      content: `Extract ALL construction elements with code-compliant specifications:

SPECIFICATIONS CONTENT:
${specContent.substring(0, 100000)}

Apply the regulatory knowledge to ensure each element meets applicable code requirements.

Return comprehensive JSON array of construction elements for BOQ generation.`
    }]
  });

  const content = Array.isArray(response.content)
    ? response.content.map((c: any) => c?.text || "").join("\n")
    : (response.content as any)?.text || "";

  return { content, tokensUsed: response.usage?.input_tokens + response.usage?.output_tokens || 0 };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 3: Clash Detection & Validation — DETERMINISTIC ENGINE (SOP 6.4)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Replaces the previous Claude-prompt-based conflict analysis.
// Now uses clash-detection-engine.ts which performs AABB geometry analysis
// against BIM elements in storage. Five categories:
//   1. Hard clashes (physical intersection)
//   2. Soft clashes (clearance violations)
//   3. Workflow clashes (construction sequence)
//   4. Code compliance clashes (NBC/OBC/CEC/NFPA)
//   5. Tolerance clashes (proximity warnings)
//
// No Claude API tokens consumed. Deterministic and reproducible.
// ═══════════════════════════════════════════════════════════════════════════════

async function runClashDetectionStage(
  projectId: string,
  clearances?: Record<string, number | null>
): Promise<{ result: ClashDetectionResult | null; error: string | null }> {
  try {
    const mergedClearances = {
      ...emptyClearanceRequirements(),
      ...(clearances || {}),
    };

    const result = await runClashDetectionForProject(projectId, mergedClearances, 50);
    return { result, error: null };
  } catch (error: any) {
    // Non-fatal: clash detection may fail if no BIM model exists yet
    logger.warn(`Stage 3 clash detection skipped: ${error.message}`);
    return {
      result: null,
      error: error.message,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORCHESTRATORS — Parallel and series execution
// ═══════════════════════════════════════════════════════════════════════════════

async function runParallelAnalysis(
  projectId: string,
  specContent: string,
  stages: AnalysisStage[],
  clearances?: Record<string, number | null>,
  projectName: string = '',
  projectLocation: string = '',
): Promise<void> {
  // Stage 1: Regulatory analysis (Claude AI)
  stages[0].status = 'running';
  stages[0].startTime = new Date();
  const stage1Result = await runRegulatoryAnalysis(specContent, projectName, projectLocation);
  stages[0].status = 'completed';
  stages[0].endTime = new Date();
  stages[0].results = stage1Result.content;
  stages[0].tokensUsed = stage1Result.tokensUsed;

  // Stage 2: Elements extraction (Claude AI, depends on stage 1)
  stages[1].status = 'running';
  stages[1].startTime = new Date();
  const stage2Result = await runElementsAnalysis(specContent, stage1Result.content);
  stages[1].status = 'completed';
  stages[1].endTime = new Date();
  stages[1].results = stage2Result.content;
  stages[1].tokensUsed = stage2Result.tokensUsed;

  // Stage 3: Clash Detection (deterministic engine — no API tokens)
  stages[2].status = 'running';
  stages[2].startTime = new Date();
  const stage3Result = await runClashDetectionStage(projectId, clearances);
  stages[2].status = stage3Result.error ? 'failed' : 'completed';
  stages[2].endTime = new Date();
  stages[2].results = stage3Result.result || { error: stage3Result.error, clashes: [] };
  stages[2].tokensUsed = 0; // Deterministic — no API tokens consumed
}

async function runSeriesAnalysis(
  projectId: string,
  specContent: string,
  stages: AnalysisStage[],
  clearances?: Record<string, number | null>,
  projectName: string = '',
  projectLocation: string = '',
): Promise<void> {
  await runParallelAnalysis(projectId, specContent, stages, clearances, projectName, projectLocation);
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESULT COMBINERS AND STORAGE
// ═══════════════════════════════════════════════════════════════════════════════

function combineStageResults(stages: AnalysisStage[]): any {
  const regulatoryKnowledge = stages[0].results;
  const constructionElements = parseElementsFromResponse(stages[1].results || '');
  const clashResult = stages[2].results || {};

  return {
    regulatoryFramework: regulatoryKnowledge,
    elements: constructionElements,
    clashDetection: {
      engine: 'EstimatorPro-ClashDetection-v1',
      methodology: 'CIQS',
      totalClashes: clashResult?.summary?.totalClashes || 0,
      clashes: clashResult?.clashes || [],
      summary: clashResult?.summary || null,
      missingClearanceData: clashResult?.missingClearanceData || [],
      rfisRequired: clashResult?.summary?.rfisRequired || 0,
      error: clashResult?.error || null,
    },
    summary: {
      totalElements: constructionElements.length,
      totalClashes: clashResult?.summary?.totalClashes || 0,
      totalTokens: stages.reduce((sum, s) => sum + (s.tokensUsed || 0), 0),
      clashDetectionTokens: 0, // Deterministic engine — no API cost
    }
  };
}

/**
 * Parse elements from Claude response
 */
function parseElementsFromResponse(response: string): any[] {
  try {
    const jsonMatch = response.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (_e) {
    logger.warn('Failed to parse elements from response');
  }
  return [];
}

/**
 * Store multi-stage results
 */
async function storeMultiStageResults(projectId: string, results: any): Promise<void> {
  logger.info(`Storing ${results.elements.length} elements from multi-stage analysis`);

  // Clear existing BOQ items
  const existingItems = await storage.getBoqItems(projectId);
  for (const item of existingItems) {
    await storage.deleteBoqItem(item.id);
  }

  // Store new elements
  for (const element of results.elements) {
    await storage.createBoqItem({
      projectId,
      itemCode: `${element.category || 'GEN'}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      description: element.description || 'Unknown element',
      quantity: String(element.quantity || 1),
      unit: element.unit || 'Each',
      rate: String(element.unitCost || 0),
      amount: String(element.totalCost || 0),
      category: element.category || 'General',
    });
  }
}

/**
 * GET /api/multi-stage-analysis/:projectId/status
 * Check analysis progress
 */
router.get('/:projectId/status', async (req, res) => {
  const { projectId } = req.params;
  const stages = runningAnalyses.get(projectId);

  if (!stages) {
    return res.status(404).json({
      success: false,
      message: 'No analysis found for this project'
    });
  }

  res.json({
    success: true,
    stages: stages.map(s => ({
      stage: s.stage,
      name: s.name,
      status: s.status
    }))
  });
});

export default router;
