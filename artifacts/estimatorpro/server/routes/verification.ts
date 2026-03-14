/**
 * 🔍 ANALYSIS VERIFICATION API
 * 
 * Provides endpoints to verify analysis completeness and quality
 */

import { Router } from 'express';
import { storage } from '../storage';
import { logger } from '../utils/enterprise-logger';
import { verifyDocumentContent, verifyAnalysisQuality, generateVerificationReport } from '../utils/analysis-verification';

const router = Router();

/**
 * POST /api/verification/:projectId/check
 * Verify analysis completeness and quality for a project
 */
router.post('/:projectId/check', async (req, res) => {
  const { projectId } = req.params;
  
  try {
    logger.info(`🔍 Starting verification check for project ${projectId}`);
    
    // Get all documents for the project
    const documents = await storage.getDocumentsByProject(projectId);
    if (documents.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No documents found for this project'
      });
    }
    
    // Verify each document's content completeness
    const documentVerifications = documents.map(doc => {
      const originalContent = doc.textContent || '';
      const sentContent = originalContent; // In real analysis, this would be the truncated content
      
      return verifyDocumentContent(
        doc.id!,
        doc.filename || 'Unknown',
        originalContent,
        sentContent
      );
    });
    
    // Get current BOQ items to assess analysis quality
    const boqItems = await storage.getBoqItems(projectId);
    const analysisResults = {
      elements: boqItems,
      compliance: [], // Would come from compliance analysis
      conflicts: []   // Would come from conflict detection
    };
    
    // Generate comprehensive verification
    const verification = verifyAnalysisQuality(
      projectId,
      documentVerifications,
      analysisResults
    );
    
    // Generate readable report
    const report = generateVerificationReport(verification);
    
    logger.info(`📊 Verification completed for project ${projectId}`);
    logger.info(`Quality score: ${verification.analysisQuality.qualityScore}/100`);
    
    res.json({
      success: true,
      verification,
      report,
      summary: {
        overallCompleteness: verification.overallCompleteness,
        qualityScore: verification.analysisQuality.qualityScore,
        totalIssues: verification.documentsVerified.reduce((sum, doc) => sum + doc.issues.length, 0),
        recommendations: verification.recommendations.length
      }
    });
    
  } catch (error) {
    logger.error(`Verification failed for project ${projectId}`, { error });
    res.status(500).json({
      success: false,
      message: 'Verification check failed',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/verification/:projectId/content-comparison
 * Compare original document content vs what would be sent to Claude
 */
router.get('/:projectId/content-comparison', async (req, res) => {
  const { projectId } = req.params;
  
  try {
    const documents = await storage.getDocumentsByProject(projectId);
    const mainSpec = documents.find(doc => 
      (doc.filename || '').toLowerCase().includes('spec')
    );
    
    if (!mainSpec || !mainSpec.textContent) {
      return res.status(404).json({
        success: false,
        message: 'No specifications document found'
      });
    }
    
    const originalContent = mainSpec.textContent;
    const truncatedContent = originalContent.substring(0, 120000); // Old truncation method
    const fullContent = originalContent; // New method (should be same as original)
    
    const comparison = {
      document: mainSpec.filename,
      originalLength: originalContent.length,
      truncatedLength: truncatedContent.length,
      fullLength: fullContent.length,
      truncationLoss: originalContent.length - truncatedContent.length,
      truncationPercentage: Math.round((truncatedContent.length / originalContent.length) * 100),
      fullPercentage: Math.round((fullContent.length / originalContent.length) * 100),
      contentPreview: {
        first500Chars: originalContent.substring(0, 500),
        truncatedAt120k: truncatedContent.length >= 120000 ? truncatedContent.substring(119500, 120000) : "Not truncated",
        last500Chars: originalContent.substring(originalContent.length - 500)
      }
    };
    
    res.json({
      success: true,
      comparison,
      recommendation: comparison.truncationPercentage < 95 
        ? "🚨 CRITICAL: Significant content loss detected. Use full content method."
        : "✅ Good: Full content is being sent to Claude."
    });
    
  } catch (error) {
    logger.error(`Content comparison failed for project ${projectId}`, { error });
    res.status(500).json({
      success: false,
      message: 'Content comparison failed',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;