import { createHash } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { storage } from './storage';
import { AnalysisResult, InsertAnalysisResult, DocumentHash, InsertDocumentHash } from '@shared/schema';

interface SmartAnalysisOptions {
  projectId: string;
  userId: string;
  analysisType: 'similarity' | 'compliance' | 'boq';
  forceFullAnalysis?: boolean;
}

interface AnalysisChangeDetection {
  changedDocuments: any[];
  unchangedDocuments: any[];
  newDocuments: any[];
  removedDocuments: any[];
  totalTokensEstimate: number;
}

export class SmartAnalysisService {
  private anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  /**
   * Performs cost-efficient analysis that only processes changed documents
   */
  async performSmartAnalysis(options: SmartAnalysisOptions): Promise<AnalysisResult> {
    const { projectId, userId, analysisType, forceFullAnalysis = false } = options;
    
    console.log(`🧠 Starting smart ${analysisType} analysis for project ${projectId}...`);
    const startTime = Date.now();
    
    try {
      // 1. Get current project documents
      const currentDocuments = await storage.getProjectDocuments(projectId);
      if (currentDocuments.length === 0) {
        throw new Error('No documents found for analysis');
      }
      
      // 2. Get previous analysis for comparison
      const previousAnalysis = await this.getPreviousAnalysis(projectId, analysisType);
      
      // 3. Detect changes since last analysis
      const changeDetection = await this.detectDocumentChanges(
        currentDocuments, 
        previousAnalysis
      );
      
      console.log(`📊 Change detection: ${changeDetection.changedDocuments.length} changed, ${changeDetection.unchangedDocuments.length} unchanged, ${changeDetection.newDocuments.length} new`);
      
      // 4. Determine if we need to run analysis
      if (!forceFullAnalysis && changeDetection.changedDocuments.length === 0 && changeDetection.newDocuments.length === 0) {
        console.log(`⚡ No changes detected, returning cached analysis`);
        if (previousAnalysis) {
          return previousAnalysis;
        }
      }
      
      // 5. Perform incremental analysis (only on changed/new documents)
      const analysisResult = await this.performIncrementalAnalysis(
        changeDetection,
        previousAnalysis,
        analysisType,
        projectId
      );
      
      // 6. Store analysis result in database
      const storedResult = await this.storeAnalysisResult({
        projectId,
        analysisType,
        revisionId: this.generateRevisionId(currentDocuments),
        analysisVersion: '1.0',
        overallScore: analysisResult.overallScore?.toString(),
        documentCount: currentDocuments.length,
        analysisData: analysisResult,
        summary: analysisResult.summary || 'Analysis completed',
        riskAreas: analysisResult.riskAreas || [],
        recommendations: analysisResult.recommendations || [],
        claudeTokensUsed: analysisResult.tokensUsed || 0,
        processingTime: Math.floor((Date.now() - startTime) / 1000),
        documentsProcessed: changeDetection.changedDocuments.concat(changeDetection.newDocuments).map(d => d.id),
        documentsSkipped: changeDetection.unchangedDocuments.map(d => d.id),
        changedDocuments: changeDetection.changedDocuments.map(d => d.id),
        documentHashes: await this.getCurrentDocumentHashes(currentDocuments),
        previousAnalysisId: previousAnalysis?.id,
        changesSummary: analysisResult.changesSummary,
      });
      
      // 7. Update document hashes for future comparisons
      await this.updateDocumentHashes(currentDocuments);
      
      console.log(`✅ Smart analysis completed in ${Math.floor((Date.now() - startTime) / 1000)}s using ${analysisResult.tokensUsed || 0} tokens`);
      
      return storedResult;
      
    } catch (error) {
      console.error('❌ Smart analysis failed:', error);
      throw error;
    }
  }
  
  /**
   * Detects which documents have changed since last analysis
   */
  private async detectDocumentChanges(
    currentDocuments: any[], 
    previousAnalysis: AnalysisResult | null
  ): Promise<AnalysisChangeDetection> {
    const changedDocuments: any[] = [];
    const unchangedDocuments: any[] = [];
    const newDocuments: any[] = [];
    const removedDocuments: any[] = [];
    
    // Get previous document hashes
    const previousHashes = previousAnalysis?.documentHashes as Record<string, string> || {};
    
    for (const doc of currentDocuments) {
      const currentHash = await this.calculateDocumentHash(doc);
      const previousHash = previousHashes[doc.id];
      
      if (!previousHash) {
        // New document
        newDocuments.push(doc);
      } else if (currentHash !== previousHash) {
        // Changed document
        changedDocuments.push(doc);
      } else {
        // Unchanged document
        unchangedDocuments.push(doc);
      }
    }
    
    // Estimate tokens needed (rough approximation)
    const documentsToProcess = [...changedDocuments, ...newDocuments];
    const totalTokensEstimate = documentsToProcess.length * 2000; // Rough estimate per document
    
    return {
      changedDocuments,
      unchangedDocuments,
      newDocuments,
      removedDocuments,
      totalTokensEstimate
    };
  }
  
  /**
   * Performs incremental analysis on only the changed documents
   */
  private async performIncrementalAnalysis(
    changeDetection: AnalysisChangeDetection,
    previousAnalysis: AnalysisResult | null,
    analysisType: string,
    projectId: string
  ): Promise<any> {
    const documentsToProcess = [
      ...changeDetection.changedDocuments,
      ...changeDetection.newDocuments
    ];
    
    if (documentsToProcess.length === 0 && previousAnalysis) {
      return previousAnalysis.analysisData;
    }
    
    console.log(`🔄 Processing ${documentsToProcess.length} documents with Claude...`);
    
    // Prepare analysis prompt
    const analysisPrompt = this.buildIncrementalAnalysisPrompt(
      documentsToProcess,
      changeDetection,
      previousAnalysis,
      analysisType
    );
    
    try {
      const analysisResult = await this.callClaudeForAnalysis(analysisPrompt, analysisType);

      // Generate change summary
      if (changeDetection.changedDocuments.length > 0 || changeDetection.newDocuments.length > 0) {
        analysisResult.changesSummary = await this.generateChangesSummary(changeDetection, analysisResult);
      }

      return analysisResult;

    } catch (error) {
      console.error('❌ Claude analysis failed:', error);
      throw error;
    }
  }
  
  /**
   * Builds an efficient prompt for incremental analysis
   */
  private buildIncrementalAnalysisPrompt(
    documentsToProcess: any[],
    changeDetection: AnalysisChangeDetection,
    previousAnalysis: AnalysisResult | null,
    analysisType: string
  ): string {
    const isIncremental = previousAnalysis !== null;
    const changeContext = isIncremental ? 
      `This is an incremental analysis. Previous analysis found ${(previousAnalysis?.riskAreas as string[])?.length || 0} risk areas. Focus on changes.` :
      'This is a full analysis of all documents.';
    
    return `You are analyzing construction documents for ${analysisType} analysis.
    
${changeContext}

Documents to analyze (${documentsToProcess.length} total):
${documentsToProcess.map((doc, i) => `${i + 1}. ${doc.filename} (${doc.fileType})`).join('\n')}

${isIncremental ? `
Previous Analysis Summary:
- Overall Score: ${previousAnalysis?.overallScore || 'N/A'}%
- Risk Areas: ${(previousAnalysis?.riskAreas as string[])?.join(', ') || 'None'}
- Recommendations: ${(previousAnalysis?.recommendations as string[])?.length || 0} items

Focus only on changes and new findings.
` : ''}

Provide analysis in this JSON format:
{
  "overallScore": 85.5,
  "riskAreas": ["area1", "area2"],
  "recommendations": ["rec1", "rec2"],
  "summary": "Brief analysis summary",
  "similarities": [...], // For similarity analysis
  "complianceChecks": [...], // For compliance analysis
  "boqItems": [...] // For BoQ analysis
}

Keep the analysis focused and cost-efficient. Only analyze what's changed or new.`;
  }

  /**
   * Calls the Claude API for real analysis. Replaces the former simulation stub.
   * Parses structured JSON response; throws with full context on parse failure.
   * Never falls back to fabricated data — missing analysis is an RFI, not a default.
   */
  private async callClaudeForAnalysis(prompt: string, analysisType: string): Promise<any> {
    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
    const tokensUsed = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

    // Extract JSON — strict parse, no fallback fabrication
    const jsonMatch =
      responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
      responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error(
        `Claude returned no parseable JSON for ${analysisType} analysis. ` +
        `An RFI must be raised — cannot produce analysis without valid structured response. ` +
        `Response preview: ${responseText.substring(0, 300)}`
      );
    }

    let parsed: any;
    try {
      const jsonStr = (jsonMatch[1] || jsonMatch[0]).replace(/,\s*([}\]])/g, '$1');
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      throw new Error(
        `JSON parse failed for ${analysisType} analysis result. ` +
        `Raw error: ${parseError instanceof Error ? parseError.message : String(parseError)}. ` +
        `An RFI must be raised — analysis data is not machine-readable.`
      );
    }

    return {
      overallScore: parsed.overallScore ?? null,
      riskAreas: Array.isArray(parsed.riskAreas) ? parsed.riskAreas : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      summary: parsed.summary ?? null,
      similarities: Array.isArray(parsed.similarities) ? parsed.similarities : [],
      complianceChecks: Array.isArray(parsed.complianceChecks) ? parsed.complianceChecks : [],
      boqItems: Array.isArray(parsed.boqItems) ? parsed.boqItems : [],
      tokensUsed,
    };
  }

  /**
   * Generates a summary of what changed between analyses
   */
  private async generateChangesSummary(
    changeDetection: AnalysisChangeDetection,
    analysisResult: any
  ): Promise<string> {
    const changes = [];
    
    if (changeDetection.newDocuments.length > 0) {
      changes.push(`Added ${changeDetection.newDocuments.length} new documents`);
    }
    
    if (changeDetection.changedDocuments.length > 0) {
      changes.push(`Updated ${changeDetection.changedDocuments.length} existing documents`);
    }
    
    return changes.join(', ') || 'No significant changes detected';
  }
  
  /**
   * Calculates SHA-256 hash of document content for change detection
   */
  private async calculateDocumentHash(document: any): Promise<string> {
    const contentToHash = `${document.filename}-${document.fileSize}-${document.uploadedAt}`;
    return createHash('sha256').update(contentToHash).digest('hex');
  }
  
  /**
   * Gets the previous analysis for comparison
   */
  private async getPreviousAnalysis(projectId: string, analysisType: string): Promise<AnalysisResult | null> {
    try {
      return await storage.getLatestAnalysisResult(projectId, analysisType);
    } catch (error) {
      console.log('No previous analysis found');
      return null;
    }
  }
  
  /**
   * Stores analysis result in database
   */
  private async storeAnalysisResult(data: InsertAnalysisResult): Promise<AnalysisResult> {
    return await storage.createAnalysisResult(data);
  }
  
  /**
   * Updates document hashes for future change detection
   */
  private async updateDocumentHashes(documents: any[]): Promise<void> {
    for (const doc of documents) {
      const hash = await this.calculateDocumentHash(doc);
      await storage.upsertDocumentHash({
        documentId: doc.id,
        contentHash: hash,
        extractedContentHash: hash, // For now, same as content hash
      });
    }
  }
  
  /**
   * Gets current document hashes as a mapping
   */
  private async getCurrentDocumentHashes(documents: any[]): Promise<Record<string, string>> {
    const hashes: Record<string, string> = {};
    
    for (const doc of documents) {
      hashes[doc.id] = await this.calculateDocumentHash(doc);
    }
    
    return hashes;
  }
  
  /**
   * Generates a revision ID based on document set
   */
  private generateRevisionId(documents: any[]): string {
    const timestamp = new Date().toISOString().slice(0, 10);
    return `rev-${timestamp}-${documents.length}docs`;
  }
  
  /**
   * Gets analysis history for a project
   */
  async getAnalysisHistory(projectId: string, analysisType: string): Promise<AnalysisResult[]> {
    return await storage.getAnalysisHistory(projectId, analysisType);
  }
  
  /**
   * Compares two analysis results for differences
   */
  async compareAnalyses(analysisId1: string, analysisId2: string): Promise<any> {
    const [analysis1, analysis2] = await Promise.all([
      storage.getAnalysisResult(analysisId1),
      storage.getAnalysisResult(analysisId2)
    ]);
    
    if (!analysis1 || !analysis2) {
      throw new Error('One or both analyses not found');
    }
    
    return {
      scoreChange: Number(analysis2.overallScore || 0) - Number(analysis1.overallScore || 0),
      documentCountChange: analysis2.documentCount - analysis1.documentCount,
      newRiskAreas: ((analysis2.riskAreas as string[]) || []).filter(
        area => !((analysis1.riskAreas as string[]) || []).includes(area)
      ),
      resolvedRiskAreas: ((analysis1.riskAreas as string[]) || []).filter(
        area => !((analysis2.riskAreas as string[]) || []).includes(area)
      ),
      tokensSaved: (analysis1.claudeTokensUsed || 0) - (analysis2.claudeTokensUsed || 0),
      timeDifference: Math.floor(
        (new Date(analysis2.createdAt!).getTime() - new Date(analysis1.createdAt!).getTime()) / 1000
      )
    };
  }
}

// Export singleton instance
export const smartAnalysisService = new SmartAnalysisService();