import { createHash } from 'crypto';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { db } from './db';
import { 
  regulatoryAnalysisCache, 
  projectRegulatoryAnalysis,
  type InsertRegulatoryAnalysisCache,
  type InsertProjectRegulatoryAnalysis,
  type RegulatoryAnalysisCache,
  type ProjectRegulatoryAnalysis
} from '@shared/schema';
import Anthropic from '@anthropic-ai/sdk';

// Initialize Claude API client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface RegulatoryContext {
  federalCode: string;
  stateProvincialCode?: string;
  municipalCode?: string;
  jurisdiction: 'canada' | 'usa';
  projectType?: string;
  location?: string;
}

interface CachedAnalysisResult {
  analysisResult: any;
  complianceRules: any[];
  keyRequirements: any[];
  conflictAreas: any[];
  cacheHit: boolean;
  tokensUsed: number;
}

export class RegulatoryAnalysisService {
  private static readonly CACHE_VERSION = "1.0";
  private static readonly DEFAULT_MODEL = "claude-sonnet-4-20250514";

  /**
   * Generate a unique hash for a regulatory combination
   */
  private generateRegulatoryHash(context: RegulatoryContext): string {
    const components = [
      context.federalCode,
      context.stateProvincialCode || '',
      context.municipalCode || '',
      context.jurisdiction,
      RegulatoryAnalysisService.CACHE_VERSION
    ];
    
    return createHash('sha256')
      .update(components.join('|'))
      .digest('hex');
  }

  /**
   * Check if we have cached analysis for this regulatory combination
   */
  async getCachedAnalysis(context: RegulatoryContext): Promise<RegulatoryAnalysisCache | null> {
    const hash = this.generateRegulatoryHash(context);
    
    try {
      const [cached] = await db
        .select()
        .from(regulatoryAnalysisCache)
        .where(eq(regulatoryAnalysisCache.regulatoryCombinationHash, hash))
        .limit(1);

      if (cached) {
        // Update usage tracking
        await db
          .update(regulatoryAnalysisCache)
          .set({
            usageCount: cached.usageCount + 1,
            lastUsed: new Date()
          })
          .where(eq(regulatoryAnalysisCache.id, cached.id));
        
        console.log(`✅ Cache hit for regulatory combination: ${context.federalCode}${context.stateProvincialCode ? ` + ${context.stateProvincialCode}` : ''}${context.municipalCode ? ` + ${context.municipalCode}` : ''}`);
        return cached;
      }

      return null;
    } catch (error) {
      console.error('❌ Error retrieving cached analysis:', error);
      return null;
    }
  }

  /**
   * Store new regulatory analysis in cache
   */
  async cacheAnalysis(
    context: RegulatoryContext, 
    analysisResult: any, 
    tokensUsed: number
  ): Promise<RegulatoryAnalysisCache> {
    const hash = this.generateRegulatoryHash(context);
    
    const cacheData: InsertRegulatoryAnalysisCache = {
      regulatoryCombinationHash: hash,
      federalCode: context.federalCode,
      stateProvincialCode: context.stateProvincialCode || null,
      municipalCode: context.municipalCode || null,
      jurisdiction: context.jurisdiction,
      analysisResult: analysisResult.fullAnalysis,
      complianceRules: analysisResult.complianceRules || [],
      keyRequirements: analysisResult.keyRequirements || [],
      conflictAreas: analysisResult.conflictAreas || [],
      claudeTokensUsed: tokensUsed,
      claudeModel: RegulatoryAnalysisService.DEFAULT_MODEL,
      analysisVersion: RegulatoryAnalysisService.CACHE_VERSION,
      lastUsed: new Date()
    };

    try {
      const [cached] = await db
        .insert(regulatoryAnalysisCache)
        .values(cacheData)
        .returning();

      console.log(`💾 Cached regulatory analysis for: ${context.federalCode}${context.stateProvincialCode ? ` + ${context.stateProvincialCode}` : ''}${context.municipalCode ? ` + ${context.municipalCode}` : ''}`);
      return cached;
    } catch (error) {
      console.error('❌ Error caching analysis:', error);
      throw error;
    }
  }

  /**
   * Get or create regulatory analysis with intelligent caching
   */
  async getOrCreateRegulatoryAnalysis(context: RegulatoryContext): Promise<CachedAnalysisResult> {
    // First check cache
    const cached = await this.getCachedAnalysis(context);
    
    if (cached) {
      return {
        analysisResult: cached.analysisResult,
        complianceRules: cached.complianceRules as any[],
        keyRequirements: cached.keyRequirements as any[],
        conflictAreas: cached.conflictAreas as any[],
        cacheHit: true,
        tokensUsed: 0 // No new tokens used
      };
    }

    // Generate new analysis
    console.log(`🔄 Generating new regulatory analysis for: ${context.federalCode}${context.stateProvincialCode ? ` + ${context.stateProvincialCode}` : ''}${context.municipalCode ? ` + ${context.municipalCode}` : ''}`);
    
    const analysisResult = await this.generateRegulatoryAnalysis(context);
    const tokensUsed = this.estimateTokenUsage(analysisResult);

    // Cache the result
    await this.cacheAnalysis(context, analysisResult, tokensUsed);

    return {
      analysisResult: analysisResult.fullAnalysis,
      complianceRules: analysisResult.complianceRules || [],
      keyRequirements: analysisResult.keyRequirements || [],
      conflictAreas: analysisResult.conflictAreas || [],
      cacheHit: false,
      tokensUsed
    };
  }

  /**
   * Generate fresh regulatory analysis using Claude
   */
  private async generateRegulatoryAnalysis(context: RegulatoryContext): Promise<any> {
    const isCanadian = context.jurisdiction === 'canada';
    
    const systemPrompt = `You are a professional building code compliance expert specializing in ${isCanadian ? 'Canadian' : 'US'} construction regulations.

Analyze the regulatory combination:
- Federal: ${context.federalCode}
- ${isCanadian ? 'Provincial' : 'State'}: ${context.stateProvincialCode || 'Not specified'}
- Municipal: ${context.municipalCode || 'Not specified'}

Provide a comprehensive analysis including:
1. Key compliance requirements from each level
2. Areas where regulations might conflict or overlap
3. Critical safety and structural requirements
4. Accessibility and environmental standards
5. Specific inspection requirements

Return your analysis as JSON with the following structure:
{
  "fullAnalysis": "Detailed narrative analysis",
  "complianceRules": [{"level": "federal|provincial|municipal", "requirement": "", "category": "", "criticality": "high|medium|low"}],
  "keyRequirements": [{"requirement": "", "applicability": "", "reference": ""}],
  "conflictAreas": [{"description": "", "regulations": [], "resolution": ""}]
}`;

    const userPrompt = `Analyze the regulatory framework for ${context.jurisdiction.toUpperCase()} construction projects using:

FEDERAL CODE: ${context.federalCode}
${context.stateProvincialCode ? `${isCanadian ? 'PROVINCIAL' : 'STATE'} CODE: ${context.stateProvincialCode}` : ''}
${context.municipalCode ? `MUNICIPAL CODE: ${context.municipalCode}` : ''}
${context.projectType ? `PROJECT TYPE: ${context.projectType}` : ''}
${context.location ? `LOCATION: ${context.location}` : ''}

Focus on:
- Structural safety requirements
- Fire and life safety codes
- Accessibility compliance (${isCanadian ? 'AODA' : 'ADA'})
- Environmental regulations
- Quality control standards
- Permit and inspection requirements

Identify any conflicts between regulatory levels and provide resolution guidance.`;

    try {
      const response = await anthropic.messages.create({
        model: RegulatoryAnalysisService.DEFAULT_MODEL,
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: userPrompt
        }]
      });

      const analysisText = 'text' in response.content[0] ? response.content[0].text : JSON.stringify(response.content[0]);
      
      try {
        return JSON.parse(analysisText);
      } catch (parseError) {
        // Fallback if JSON parsing fails
        return {
          fullAnalysis: analysisText,
          complianceRules: [],
          keyRequirements: [],
          conflictAreas: []
        };
      }
    } catch (error) {
      console.error('❌ Error generating regulatory analysis:', error);
      throw error;
    }
  }

  /**
   * Link cached analysis to a specific project
   */
  async linkAnalysisToProject(
    projectId: string, 
    cacheId: string, 
    customData?: {
      customRequirements?: any[];
      exemptions?: any[];
      riskAssessment?: any;
    }
  ): Promise<ProjectRegulatoryAnalysis> {
    const linkData: InsertProjectRegulatoryAnalysis = {
      projectId,
      cacheId,
      customRequirements: customData?.customRequirements || [],
      exemptions: customData?.exemptions || [],
      applicableRules: [], // Will be populated based on project analysis
      riskAssessment: customData?.riskAssessment || {},
      recommendedActions: []
    };

    try {
      const [link] = await db
        .insert(projectRegulatoryAnalysis)
        .values(linkData)
        .returning();

      return link;
    } catch (error) {
      console.error('❌ Error linking analysis to project:', error);
      throw error;
    }
  }

  /**
   * Get project-specific regulatory analysis
   */
  async getProjectRegulatoryAnalysis(projectId: string): Promise<{
    cache: RegulatoryAnalysisCache;
    project: ProjectRegulatoryAnalysis;
  } | null> {
    try {
      const result = await db
        .select({
          cache: regulatoryAnalysisCache,
          project: projectRegulatoryAnalysis
        })
        .from(projectRegulatoryAnalysis)
        .innerJoin(
          regulatoryAnalysisCache,
          eq(projectRegulatoryAnalysis.cacheId, regulatoryAnalysisCache.id)
        )
        .where(eq(projectRegulatoryAnalysis.projectId, projectId))
        .orderBy(desc(projectRegulatoryAnalysis.createdAt))
        .limit(1);

      return result[0] || null;
    } catch (error) {
      console.error('❌ Error retrieving project regulatory analysis:', error);
      return null;
    }
  }

  /**
   * Get cache statistics for monitoring
   */
  async getCacheStats(): Promise<{
    totalEntries: number;
    canadianEntries: number;
    usEntries: number;
    totalTokensSaved: number;
    averageUsageCount: number;
  }> {
    try {
      const totalEntries = await db.select().from(regulatoryAnalysisCache);
      const canadianEntries = await db.select().from(regulatoryAnalysisCache).where(eq(regulatoryAnalysisCache.jurisdiction, 'canada'));
      const usEntries = await db.select().from(regulatoryAnalysisCache).where(eq(regulatoryAnalysisCache.jurisdiction, 'usa'));
      
      let totalTokens = 0;
      let totalUsage = 0;
      
      for (const entry of totalEntries) {
        totalTokens += entry.claudeTokensUsed;
        totalUsage += entry.usageCount;
      }
      
      const tokensSaved = totalEntries.length > 0 ? (totalUsage - totalEntries.length) * (totalTokens / totalEntries.length) : 0;

      return {
        totalEntries: totalEntries.length,
        canadianEntries: canadianEntries.length,
        usEntries: usEntries.length,
        totalTokensSaved: Math.round(tokensSaved),
        averageUsageCount: totalEntries.length > 0 ? Math.round(totalUsage / totalEntries.length) : 0
      };
    } catch (error) {
      console.error('❌ Error getting cache stats:', error);
      return {
        totalEntries: 0,
        canadianEntries: 0,
        usEntries: 0,
        totalTokensSaved: 0,
        averageUsageCount: 0
      };
    }
  }

  /**
   * Estimate token usage for billing tracking
   */
  private estimateTokenUsage(analysisResult: any): number {
    const analysisText = JSON.stringify(analysisResult);
    // Rough estimation: ~4 characters per token
    return Math.ceil(analysisText.length / 4);
  }

  /**
   * Clear old cache entries (for maintenance)
   */
  async clearOldCache(daysOld: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    try {
      const oldEntries = await db
        .select()
        .from(regulatoryAnalysisCache)
        .where(
          and(
            eq(regulatoryAnalysisCache.usageCount, 1) // Only used once
          )
        );

      let deletedCount = 0;
      for (const entry of oldEntries) {
        if (entry.lastUsed && new Date(entry.lastUsed) < cutoffDate) {
          await db.delete(regulatoryAnalysisCache).where(eq(regulatoryAnalysisCache.id, entry.id));
          deletedCount++;
        }
      }

      console.log(`🧹 Cleaned up ${deletedCount} old cache entries`);
      return deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning cache:', error);
      return 0;
    }
  }
}

export const regulatoryAnalysisService = new RegulatoryAnalysisService();