/**
 * 🔍 ANALYSIS VERIFICATION SYSTEM
 * 
 * Verifies that Claude receives complete document content and validates analysis quality
 */

import { logger } from './enterprise-logger';

export interface DocumentVerification {
  documentId: string;
  filename: string;
  originalCharCount: number;
  sentToClaudeCharCount: number;
  completenessPercentage: number;
  verified: boolean;
  issues: string[];
}

export interface AnalysisVerification {
  projectId: string;
  totalDocuments: number;
  totalOriginalChars: number;
  totalSentToClaudeChars: number;
  overallCompleteness: number;
  documentsVerified: DocumentVerification[];
  analysisQuality: {
    elementsExtracted: number;
    complianceItemsFound: number;
    conflictsDetected: number;
    manufacturerDetailsFound: number;
    expectedMinimumElements: number;
    qualityScore: number;
  };
  recommendations: string[];
}

/**
 * 🔍 Verify document content completeness before sending to Claude
 */
export function verifyDocumentContent(
  documentId: string,
  filename: string,
  originalContent: string,
  contentSentToClaude: string
): DocumentVerification {
  
  const originalCharCount = originalContent.length;
  const sentCharCount = contentSentToClaude.length;
  const completenessPercentage = Math.round((sentCharCount / originalCharCount) * 100);
  
  const issues: string[] = [];
  let verified = true;
  
  // Check for significant content loss
  if (completenessPercentage < 95) {
    issues.push(`Content truncated: ${completenessPercentage}% sent to Claude`);
    verified = false;
  }
  
  // Check for common truncation indicators
  if (contentSentToClaude.includes('[CONTENT TRUNCATED]') || 
      contentSentToClaude.includes('[SPECIFICATIONS CONTENT CONTINUES]')) {
    issues.push('Explicit truncation indicators found');
    verified = false;
  }
  
  // Verify critical sections are present
  const criticalSections = [
    'DIVISION 01', 'DIVISION 03', 'DIVISION 05', 'DIVISION 08',
    'MANUFACTURER', 'PRODUCT', 'SPECIFICATION'
  ];
  
  for (const section of criticalSections) {
    if (originalContent.includes(section) && !contentSentToClaude.includes(section)) {
      issues.push(`Critical section missing: ${section}`);
      verified = false;
    }
  }
  
  logger.info(`📋 Document verification for ${filename}:`, {
    originalChars: originalCharCount,
    sentChars: sentCharCount,
    completeness: `${completenessPercentage}%`,
    verified,
    issues: issues.length
  });
  
  return {
    documentId,
    filename,
    originalCharCount,
    sentToClaudeCharCount: sentCharCount,
    completenessPercentage,
    verified,
    issues
  };
}

/**
 * 🎯 Verify analysis quality and completeness
 */
export function verifyAnalysisQuality(
  projectId: string,
  documentsVerified: DocumentVerification[],
  analysisResults: any
): AnalysisVerification {
  
  const totalDocuments = documentsVerified.length;
  const totalOriginalChars = documentsVerified.reduce((sum, doc) => sum + doc.originalCharCount, 0);
  const totalSentToClaudeChars = documentsVerified.reduce((sum, doc) => sum + doc.sentToClaudeCharCount, 0);
  const overallCompleteness = Math.round((totalSentToClaudeChars / totalOriginalChars) * 100);
  
  // Analyze extraction quality
  const elementsExtracted = analysisResults.elements?.length || 0;
  const complianceItemsFound = analysisResults.compliance?.length || 0;
  const conflictsDetected = analysisResults.conflicts?.length || 0;
  
  // Count manufacturer details
  const manufacturerDetailsFound = analysisResults.elements?.filter((el: any) => 
    el.manufacturer || el.productLine || el.modelNumber
  ).length || 0;
  
  // Expected minimums based on project size (390-page specifications)
  const expectedMinimumElements = 50; // For a project this size
  
  // Calculate quality score
  let qualityScore = 0;
  if (elementsExtracted >= expectedMinimumElements) qualityScore += 30;
  if (complianceItemsFound >= 10) qualityScore += 25;
  if (manufacturerDetailsFound >= 20) qualityScore += 25;
  if (overallCompleteness >= 95) qualityScore += 20;
  
  // Generate recommendations
  const recommendations: string[] = [];
  
  if (overallCompleteness < 95) {
    recommendations.push(`🚨 CRITICAL: Only ${overallCompleteness}% of content sent to Claude`);
  }
  
  if (elementsExtracted < expectedMinimumElements) {
    recommendations.push(`📋 Low element extraction: ${elementsExtracted}/${expectedMinimumElements} expected`);
  }
  
  if (manufacturerDetailsFound < 20) {
    recommendations.push(`🏭 Missing manufacturer details: Only ${manufacturerDetailsFound} products with manufacturer info`);
  }
  
  if (conflictsDetected === 0) {
    recommendations.push(`⚠️ No construction conflicts detected - may need explicit conflict analysis`);
  }
  
  if (complianceItemsFound < 10) {
    recommendations.push(`🏛️ Limited building code analysis: Only ${complianceItemsFound} compliance items found`);
  }
  
  return {
    projectId,
    totalDocuments,
    totalOriginalChars,
    totalSentToClaudeChars,
    overallCompleteness,
    documentsVerified,
    analysisQuality: {
      elementsExtracted,
      complianceItemsFound,
      conflictsDetected,
      manufacturerDetailsFound,
      expectedMinimumElements,
      qualityScore
    },
    recommendations
  };
}

/**
 * 📊 Generate verification report
 */
export function generateVerificationReport(verification: AnalysisVerification): string {
  const { analysisQuality, overallCompleteness, recommendations } = verification;
  
  let report = `
🔍 ANALYSIS VERIFICATION REPORT
=====================================

📊 CONTENT COMPLETENESS:
- Overall completeness: ${overallCompleteness}%
- Documents verified: ${verification.totalDocuments}
- Total original content: ${(verification.totalOriginalChars / 1000).toFixed(1)}K characters
- Sent to Claude: ${(verification.totalSentToClaudeChars / 1000).toFixed(1)}K characters

🎯 EXTRACTION QUALITY:
- Construction elements: ${analysisQuality.elementsExtracted}/${analysisQuality.expectedMinimumElements} expected
- Building code compliance: ${analysisQuality.complianceItemsFound} items
- Construction conflicts: ${analysisQuality.conflictsDetected} detected
- Manufacturer details: ${analysisQuality.manufacturerDetailsFound} products
- Quality score: ${analysisQuality.qualityScore}/100

`;

  if (recommendations.length > 0) {
    report += `\n🚨 RECOMMENDATIONS:\n`;
    recommendations.forEach(rec => report += `- ${rec}\n`);
  }
  
  return report;
}