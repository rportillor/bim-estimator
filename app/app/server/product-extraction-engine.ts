import Anthropic from '@anthropic-ai/sdk';
import { storage } from './storage';
import { logger } from './utils/enterprise-logger';
import type { InsertProductCatalog } from '@shared/schema';

// "claude-sonnet-4-20250514"
const DEFAULT_MODEL_STR = "claude-sonnet-4-20250514";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export class ProductExtractionEngine {
  
  /**
   * Extract products from Claude's existing material analysis and populate product catalog
   * Claude already analyzes specifications and extracts material grades, standards, etc.
   */
  async extractProductsFromSpecifications(projectId: string): Promise<void> {
    logger.info(`Extracting products from Claude analysis for project ${projectId}`);
    
    try {
      // Get existing BIM elements that Claude has already analyzed
      // Get BIM model for project and then elements
      const models = await storage.getBimModels(projectId);
      if (models.length === 0) return;
      
      const elements = await storage.getBimElements(models[0].id);
      
      // Aggregate material specifications across all elements
      const materialSpecs = this.aggregateMaterialSpecifications(elements);
      
      // Use Claude to extract specific product catalog entries
      const products = await this.analyzeSpecificationsForProducts(materialSpecs);
      
      // Populate product catalog
      await storage.upsertProductsFromClaude(products);
      
      logger.info(`Extracted ${products.length} products to catalog`);
      
    } catch (error) {
      console.error("Product extraction failed:", error);
      throw error;
    }
  }

  /**
   * Aggregate material specifications from BIM elements 
   * Claude has already extracted detailed material properties
   */
  private aggregateMaterialSpecifications(elements: any[]): any {
    const specs = {
      concrete: new Set<string>(),
      steel: new Set<string>(),
      masonry: new Set<string>(),
      mechanical: new Set<string>(),
      electrical: new Set<string>(),
      assemblies: new Map<string, any>()
    };

    // Collect specifications from Claude's analysis
    elements.forEach(element => {
      if (element.properties?.material_specs) {
        const material = element.properties.material_specs;
        
        // Concrete specifications
        if (material.concrete_grade) {
          specs.concrete.add(`${material.concrete_grade} - ${material.standard || 'CSA A23.1'}`);
        }
        
        // Steel specifications
        if (material.steel_grade) {
          specs.steel.add(`${material.steel_grade} - ${material.standard || 'CSA S16'}`);
        }
        
        // Assembly-level specifications from properties
        const props = element?.properties as any;
        const assemblyRef = props?.assembly_ref;
        const csiCode = props?.csi_code || props?.itemCode || props?.item_code;
        if (assemblyRef) {
          specs.assemblies.set(assemblyRef, {
            csiDivision: csiCode?.split('.')[0] || '01',
            elementType: element.elementType,
            specifications: material,
            standardCompliance: material.standard ? [material.standard] : []
          });
        }
      }
    });

    return specs;
  }

  /**
   * Use Claude to extract specific product catalog from material specifications
   * Focus on real manufacturer products with pricing and availability
   */
  private async analyzeSpecificationsForProducts(materialSpecs: any): Promise<InsertProductCatalog[]> {
    const prompt = `
    You are a construction product specialist. From these material specifications discovered in construction documents, create a comprehensive product catalog with real Canadian construction products.

    Material Specifications Found:
    - Concrete: ${Array.from(materialSpecs.concrete).join(', ')}
    - Steel: ${Array.from(materialSpecs.steel).join(', ')}
    - Assemblies: ${JSON.stringify(Array.from(materialSpecs.assemblies.entries()), null, 2)}

    Extract real construction products for Ontario construction projects. Focus on:
    1. Major Canadian suppliers (Lafarge Holcim, Sica Concrete, Canam Steel, etc.)
    2. Assembly-specific products organized by CSI Division
    3. Grade variations (20 MPa vs 30 MPa concrete, Grade 300W vs 350W steel)
    4. Current Ontario pricing estimates
    5. Standard compliance (CSA, ASTM, etc.)

    Return a JSON array of products with this structure:
    [
      {
        "csi_division": "03",
        "assembly_reference": "wall_type_1", 
        "product_type": "Ready-Mix Concrete",
        "product_name": "Lafarge 30 MPa Normal Density",
        "manufacturer": "Lafarge Canada",
        "specifications": "30 MPa compressive strength, 75mm slump, CSA A23.1 certified, normal density aggregate",
        "grade": "30 MPa",
        "standard_compliance": ["CSA A23.1", "ASTM C94"],
        "default_unit_cost": 185.00,
        "unit": "m³",
        "availability": "available",
        "discovered_from_document": "specifications",
        "is_claude_recommended": true
      }
    ]

    Include 3-5 product options per major material category. Focus on real products with accurate specifications.
    `;

    const response = await anthropic.messages.create({
      model: DEFAULT_MODEL_STR,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    try {
      const content = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      
      if (!jsonMatch) {
        throw new Error('No JSON array found in Claude response');
      }

      const products = JSON.parse(jsonMatch[0]);
      
      return products.map((product: any) => ({
        csiDivision: product.csi_division,
        assemblyReference: product.assembly_reference,
        productType: product.product_type,
        productName: product.product_name,
        manufacturer: product.manufacturer,
        specifications: product.specifications,
        grade: product.grade,
        standardCompliance: JSON.stringify(product.standard_compliance),
        defaultUnitCost: product.default_unit_cost,
        unit: product.unit,
        availability: product.availability,
        discoveredFromDocument: product.discovered_from_document,
        extractedByClaudeAt: new Date(),
        isClaudeRecommended: product.is_claude_recommended,
      }));
      
    } catch (error) {
      console.error("Failed to parse Claude product extraction:", error);
      return [];
    }
  }

  /**
   * Get available product alternatives for a specific element
   * Used by frontend to show product selection options
   */
  async getProductOptionsForElement(bimElementId: string): Promise<any> {
    const element = await storage.getBimElement(bimElementId);
    
    // Get CSI code from element properties
    const props = element?.properties as any;
    const csiCode = props?.csi_code || props?.itemCode || props?.item_code;
    if (!csiCode) {
      return { products: [], message: "No CSI code found for element" };
    }

    const csiDivision = csiCode.split('.')[0];
    const products = await storage.getProductsByCsiDivision(csiDivision);
    
    // Filter by element type if available
    const filteredProducts = products.filter(product => {
      if (element && element.elementType && product.productType) {
        const elementType = element.elementType || '';
        return product.productType.toLowerCase().includes(elementType.toLowerCase()) ||
               elementType.toLowerCase().includes(product.productType.toLowerCase());
      }
      return true;
    });

    return {
      products: filteredProducts,
      element: element ? {
        id: element.id,
        elementType: element.elementType,
        csiCode: props?.csi_code || props?.itemCode || props?.item_code,
        assemblyRef: props?.assembly_ref
      } : undefined
    };
  }
}

export const productExtractionEngine = new ProductExtractionEngine();