/**
 * 🔍 DETAILED PRODUCT EXTRACTION ROUTE
 * 
 * Processes specifications section-by-section to extract detailed product information
 * that Claude was missing in the comprehensive analysis
 */

import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { storage } from '../storage';
import { logger } from '../utils/enterprise-logger';
import { parseFirstJsonArray } from '../utils/anthropic-response';

const router = Router();
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * POST /api/product-extraction/:projectId
 * Extract detailed product specifications section by section
 */
router.post('/:projectId', async (req, res) => {
  const { projectId } = req.params;
  
  try {
    logger.info(`🔍 Starting detailed product extraction for project ${projectId}`);
    
    // Get the main specifications document
    const documents = await storage.getDocumentsByProject(projectId);
    const mainSpec = documents.find(doc => 
      (doc.filename || '').toLowerCase().includes('spec')
    );
    
    if (!mainSpec || !mainSpec.textContent) {
      return res.status(400).json({
        success: false,
        message: 'No specifications document found with readable content'
      });
    }
    
    logger.info(`📋 Found specifications: ${mainSpec.filename} (${mainSpec.textContent.length} characters)`);
    
    // Split specifications into CSI divisions
    const sections = await extractSpecificationSections(mainSpec.textContent);
    logger.info(`📝 Identified ${sections.length} specification sections`);
    
    // Process each section for detailed product information
    const allProducts = [];
    for (const section of sections) {
      const products = await extractProductsFromSection(section);
      allProducts.push(...products);
      logger.info(`📦 Extracted ${products.length} products from ${section.division}`);
    }
    
    logger.info(`🎯 Total products extracted: ${allProducts.length}`);
    
    res.json({
      success: true,
      message: 'Product extraction completed',
      results: {
        sectionsProcessed: sections.length,
        productsExtracted: allProducts.length,
        products: allProducts
      }
    });
    
  } catch (error) {
    logger.error(`Product extraction failed for project ${projectId}`, { error });
    res.status(500).json({
      success: false,
      message: 'Product extraction failed',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * 📝 Split specifications into manageable sections by CSI divisions
 */
async function extractSpecificationSections(specText: string): Promise<Array<{
  division: string;
  title: string;
  content: string;
}>> {
  const sections = [];
  
  // Look for CSI division patterns
  const divisionPatterns = [
    /DIVISION\s+0?1[^\n]*GENERAL\s+REQUIREMENTS/gi,
    /DIVISION\s+0?2[^\n]*EXISTING\s+CONDITIONS/gi,
    /DIVISION\s+0?3[^\n]*CONCRETE/gi,
    /DIVISION\s+0?4[^\n]*MASONRY/gi,
    /DIVISION\s+0?5[^\n]*METALS/gi,
    /DIVISION\s+0?6[^\n]*WOOD/gi,
    /DIVISION\s+0?7[^\n]*THERMAL/gi,
    /DIVISION\s+0?8[^\n]*OPENINGS/gi,
    /DIVISION\s+0?9[^\n]*FINISHES/gi,
    /DIVISION\s+1[0-4][^\n]*/gi
  ];
  
  // For each division, extract content
  for (let i = 0; i < divisionPatterns.length; i++) {
    const pattern = divisionPatterns[i];
    const match = pattern.exec(specText);
    
    if (match) {
      const startIndex = match.index;
      const nextPattern = divisionPatterns[i + 1];
      let endIndex = specText.length;
      
      if (nextPattern) {
        const nextMatch = nextPattern.exec(specText);
        if (nextMatch && nextMatch.index > startIndex) {
          endIndex = nextMatch.index;
        }
      }
      
      const sectionContent = specText.substring(startIndex, endIndex);
      
      sections.push({
        division: `Division ${String(i + 1).padStart(2, '0')}`,
        title: match[0].trim(),
        content: sectionContent.substring(0, 50000) // Manageable chunks
      });
    }
  }
  
  return sections;
}

/**
 * 🔍 Extract detailed product information from a single specification section
 */
async function extractProductsFromSection(section: {
  division: string;
  title: string;
  content: string;
}): Promise<any[]> {
  
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    temperature: 0,
    system: `You are a construction specifications expert specializing in detailed product extraction. 

FOCUS EXCLUSIVELY ON EXTRACTING PRODUCT INFORMATION from this specification section.

EXTRACT THESE DETAILS FOR EACH PRODUCT:
🏭 Manufacturer Information:
- Company name, product line, model numbers
- Approved equals and alternate manufacturers
- Contact information if provided

📋 Product Specifications:
- Technical properties (strength, thickness, performance ratings)
- Material composition and characteristics  
- Size options and configurations
- Performance standards and certifications

💰 Pricing-Related Information:
- Unit of measure for ordering/pricing
- Standard package sizes
- Installation requirements that affect cost

🎯 APPLICATION DETAILS:
- Where this product is used in the project
- Installation specifications
- Related products that must be used together

LOOK FOR PRODUCT LISTS, MANUFACTURER TABLES, AND SPECIFICATION PARAGRAPHS.

Output detailed JSON array of products found.`,

    messages: [{
      role: "user",
      content: `EXTRACT ALL PRODUCT INFORMATION FROM THIS SPECIFICATION SECTION:

${section.division}: ${section.title}

SPECIFICATION CONTENT:
${section.content}

Focus on finding:
- Product names and model numbers
- Manufacturer details and approved equals
- Technical specifications that affect pricing
- Installation requirements
- Material grades and performance characteristics

Return detailed JSON array of all products with complete specifications.`
    }]
  });
  
  // Parse response
  const content = Array.isArray(response.content) 
    ? response.content.map((c: any) => c?.text || "").join("\n")
    : (response.content as any)?.text || "";
    
  try {
    return parseFirstJsonArray(content);
  } catch (_e) {
    logger.warn(`Failed to parse JSON from ${section.division}`, { content: content.substring(0, 500) });
  }

  return [];
}

export default router;