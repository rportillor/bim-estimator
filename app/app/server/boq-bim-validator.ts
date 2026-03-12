/**
 * [*] BOQ-BIM Cross-Validation System
 * 
 * Implements professional quantity surveying validation by cross-referencing
 * BOQ items with BIM elements to detect discrepancies and ensure accuracy.
 */

import { storage } from './storage';
import { randomUUID } from 'crypto';
import type { BoqItem, BimElement } from '@shared/schema';

export interface ValidationDiscrepancy {
  type: 'missing_bim_element' | 'missing_boq_item' | 'quantity_mismatch' | 'spatial_conflict' | 'material_mismatch';
  severity: 'critical' | 'warning' | 'info';
  description: string;
  boqItemId?: string;
  bimElementId?: string;
  expectedValue?: number;
  actualValue?: number;
  variance?: number;
  recommendation?: string;
}

export interface ValidationResult {
  projectId: string;
  totalBoqItems: number;
  totalBimElements: number;
  mappedItems: number;
  unmappedBoqItems: number;
  unmappedBimElements: number;
  discrepancies: ValidationDiscrepancy[];
  confidenceScore: number;
  validationSummary: {
    spatialAccuracy: number;
    quantityAccuracy: number;
    materialAccuracy: number;
    overallHealth: 'excellent' | 'good' | 'needs_review' | 'critical_issues';
  };
  recommendations: string[];
}

export class BoqBimValidator {
  /**
   * 🎯 Main validation entry point
   */
  async validateProject(projectId: string): Promise<ValidationResult> {
    console.log(`[*] Starting BOQ-BIM validation for project ${projectId}`);
    
    try {
      // Fetch all BOQ items and BIM elements for the project
      const [boqItems, bimElements] = await Promise.all([
        this.getBOQItems(projectId),
        this.getBIMElements(projectId)
      ]);
      
      console.log(`[*]  Found ${boqItems.length} BOQ items and ${bimElements.length} BIM elements`);
      
      // Detect discrepancies
      const discrepancies = await this.detectDiscrepancies(boqItems, bimElements);
      
      // Calculate confidence score
      const confidenceScore = this.calculateConfidenceScore(boqItems, bimElements, discrepancies);
      
      // Generate validation summary
      const validationSummary = this.generateValidationSummary(boqItems, bimElements, discrepancies);
      
      // Create recommendations
      const recommendations = this.generateRecommendations(discrepancies, boqItems, bimElements);
      
      const result: ValidationResult = {
        projectId,
        totalBoqItems: boqItems.length,
        totalBimElements: bimElements.length,
        mappedItems: Math.min(boqItems.length, bimElements.length), // Simplified for now
        unmappedBoqItems: Math.max(0, boqItems.length - bimElements.length),
        unmappedBimElements: Math.max(0, bimElements.length - boqItems.length),
        discrepancies,
        confidenceScore,
        validationSummary,
        recommendations
      };
      
      // Store validation results
      await this.storeValidationResults(result);
      
      console.log(`[*] Validation completed with ${discrepancies.length} discrepancies found`);
      return result;
      
    } catch (error) {
      console.error('[*] BOQ-BIM validation failed:', error);
      throw new Error(`Validation failed: ${(error as Error).message}`);
    }
  }
  
  /**
   * 🚨 Detect discrepancies between BOQ and BIM
   */
  private async detectDiscrepancies(
    boqItems: BoqItem[], 
    bimElements: BimElement[]
  ): Promise<ValidationDiscrepancy[]> {
    const discrepancies: ValidationDiscrepancy[] = [];
    
    // 1. Check if we have a BIM model at all
    if (bimElements.length === 0 && boqItems.length > 0) {
      discrepancies.push({
        type: 'missing_bim_element',
        severity: 'critical',
        description: `Project has ${boqItems.length} BOQ items but NO BIM model exists`,
        recommendation: 'Generate BIM model first - cannot verify quantities without 3D representation'
      });
      return discrepancies;
    }
    
    // 2. Check if we have BOQ items
    if (boqItems.length === 0 && bimElements.length > 0) {
      discrepancies.push({
        type: 'missing_boq_item',
        severity: 'critical',
        description: `Project has ${bimElements.length} BIM elements but NO BOQ items`,
        recommendation: 'Generate BOQ from BIM model - cannot estimate costs without quantities'
      });
      return discrepancies;
    }
    
    // 3. Major count discrepancies
    const countRatio = boqItems.length / Math.max(bimElements.length, 1);
    if (countRatio > 2) {
      discrepancies.push({
        type: 'missing_bim_element',
        severity: 'critical',
        description: `BOQ has ${boqItems.length} items but BIM has only ${bimElements.length} elements`,
        expectedValue: boqItems.length,
        actualValue: bimElements.length,
        variance: countRatio,
        recommendation: 'Review BIM model - many BOQ items have no corresponding 3D elements'
      });
    } else if (countRatio < 0.5) {
      discrepancies.push({
        type: 'missing_boq_item',
        severity: 'warning',
        description: `BIM has ${bimElements.length} elements but BOQ has only ${boqItems.length} items`,
        expectedValue: bimElements.length,
        actualValue: boqItems.length,
        variance: 1 / countRatio,
        recommendation: 'Review BOQ - many BIM elements may not be costed'
      });
    }
    
    // 4. Category mismatches
    const boqCategories = new Set(boqItems.map(item => item.category));
    const bimCategories = new Set(bimElements.map(elem => elem.category || 'Unknown'));
    
    const missingBimCategories = Array.from(boqCategories).filter(cat => !bimCategories.has(cat));
    const missingBoqCategories = Array.from(bimCategories).filter(cat => !boqCategories.has(cat));
    
    missingBimCategories.forEach(category => {
      const itemCount = boqItems.filter(item => item.category === category).length;
      discrepancies.push({
        type: 'missing_bim_element',
        severity: 'warning',
        description: `BOQ category "${category}" (${itemCount} items) has no corresponding BIM elements`,
        recommendation: `Check if "${category}" elements are modeled in BIM`
      });
    });
    
    missingBoqCategories.forEach(category => {
      const elemCount = bimElements.filter(elem => elem.category === category).length;
      discrepancies.push({
        type: 'missing_boq_item',
        severity: 'warning',
        description: `BIM category "${category}" (${elemCount} elements) has no corresponding BOQ items`,
        recommendation: `Consider adding "${category}" items to BOQ if they have cost implications`
      });
    });
    
    return discrepancies;
  }
  
  /**
   * [*]  Calculate overall confidence score
   */
  private calculateConfidenceScore(
    boqItems: BoqItem[], 
    bimElements: BimElement[], 
    discrepancies: ValidationDiscrepancy[]
  ): number {
    if (boqItems.length === 0 && bimElements.length === 0) return 0;
    
    const criticalIssues = discrepancies.filter(d => d.severity === 'critical').length;
    const warningIssues = discrepancies.filter(d => d.severity === 'warning').length;
    
    // Start with base score based on data availability
    let baseScore = 50;
    if (boqItems.length > 0 && bimElements.length > 0) {
      baseScore = 80; // Both BOQ and BIM exist
    } else if (boqItems.length > 0 || bimElements.length > 0) {
      baseScore = 40; // Only one exists
    }
    
    // Penalize for issues
    const penaltyFactor = Math.max(0, 1 - (criticalIssues * 0.3) - (warningIssues * 0.1));
    
    return Math.round(baseScore * penaltyFactor);
  }
  
  /**
   * [*] Generate validation summary
   */
  private generateValidationSummary(
    boqItems: BoqItem[], 
    bimElements: BimElement[], 
    discrepancies: ValidationDiscrepancy[]
  ) {
    // GAP-2 FIX: All three accuracy scores genuinely computed from data
    const spatialAccuracy  = this.calculateSpatialAccuracy(bimElements);
    const quantityAccuracy = this.calculateQuantityAccuracy(boqItems, bimElements);
    const materialAccuracy = this.calculateMaterialAccuracy(boqItems, bimElements);

    const avgAccuracy = (spatialAccuracy + quantityAccuracy + materialAccuracy) / 3;

    let overallHealth: 'excellent' | 'good' | 'needs_review' | 'critical_issues';
    const criticalCount = discrepancies.filter(d => d.severity === 'critical').length;

    if (criticalCount > 0) {
      overallHealth = 'critical_issues';
    } else if (avgAccuracy > 90) {
      overallHealth = 'excellent';
    } else if (avgAccuracy > 75) {
      overallHealth = 'good';
    } else {
      overallHealth = 'needs_review';
    }

    return {
      spatialAccuracy:  Math.round(spatialAccuracy),
      quantityAccuracy: Math.round(quantityAccuracy),
      materialAccuracy: Math.round(materialAccuracy),
      overallHealth
    };
  }
  
  /**
   * [*]  Calculate material accuracy based on actual matching
   */
  private calculateMaterialAccuracy(boqItems: BoqItem[], bimElements: BimElement[]): number {
    if (boqItems.length === 0 || bimElements.length === 0) return 0;
    
    let matchedMaterials = 0;
    let totalComparisons = 0;
    
    // Compare materials between BOQ and BIM elements
    for (const boqItem of boqItems) {
      const matchingBimElement = bimElements.find(bim => 
        bim.elementType === boqItem.category || 
        (bim.properties as any)?.csiCode === boqItem.itemCode
      );
      
      if (matchingBimElement) {
        totalComparisons++;
        const boqMaterial = (boqItem as any).material || boqItem.description?.toLowerCase();
        const bimMaterial = (matchingBimElement as any).materials || 
                           (matchingBimElement.properties as any)?.material?.toLowerCase();
        
        if (boqMaterial && bimMaterial && boqMaterial.includes(bimMaterial)) {
          matchedMaterials++;
        }
      }
    }
    
    return totalComparisons > 0 ? Math.round((matchedMaterials / totalComparisons) * 100) : 0;
  }
  
  /**
   * [*] Generate actionable recommendations
   */
  private generateRecommendations(
    discrepancies: ValidationDiscrepancy[], 
    boqItems: BoqItem[], 
    bimElements: BimElement[]
  ): string[] {
    const recommendations: string[] = [];
    
    const criticalIssues = discrepancies.filter(d => d.severity === 'critical').length;
    const missingBimElements = discrepancies.filter(d => d.type === 'missing_bim_element').length;
    const missingBoqItems = discrepancies.filter(d => d.type === 'missing_boq_item').length;
    
    if (bimElements.length === 0 && boqItems.length > 0) {
      recommendations.push('🏗️ CRITICAL: Generate BIM model first - BOQ cannot be verified without 3D representation');
      recommendations.push('[*] Use construction documents to create 3D model, then extract quantities');
    } else if (boqItems.length === 0 && bimElements.length > 0) {
      recommendations.push('[*] CRITICAL: Generate BOQ from BIM model - cost estimation requires quantities');
      recommendations.push('[*]  Extract quantities from 3D elements to create comprehensive BOQ');
    } else if (criticalIssues > 0) {
      recommendations.push(`🚨 Address ${criticalIssues} critical issues before proceeding with cost estimation`);
    }
    
    if (missingBimElements > 0) {
      recommendations.push(`[*] Review ${missingBimElements} BOQ items that lack 3D representation`);
    }
    
    if (missingBoqItems > 0) {
      recommendations.push(`[*] Consider costing ${missingBoqItems} BIM elements that appear in model`);
    }
    
    if (recommendations.length === 0 && boqItems.length > 0 && bimElements.length > 0) {
      recommendations.push('[*] BOQ and BIM model are reasonably aligned - proceed with validation');
    }
    
    return recommendations;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // GAP-2 FIX: Two new computed accuracy helpers replace the old hardcoded values
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Spatial accuracy = % of BIM elements with valid 3-D coordinates.
   * An element is "placed" when any of x, y, z in its realLocation is non-zero.
   */
  private calculateSpatialAccuracy(bimElements: BimElement[]): number {
    if (bimElements.length === 0) return 0;
    let placed = 0;
    for (const elem of bimElements) {
      let geo: any = elem.geometry;
      if (typeof geo === 'string') {
        try { geo = JSON.parse(geo); } catch { geo = {}; }
      }
      const loc = geo?.location?.realLocation ?? geo?.location ?? {};
      const x = Number(loc.x ?? 0);
      const y = Number(loc.y ?? 0);
      const z = Number(loc.z ?? (elem as any).elevation ?? 0);
      if (x !== 0 || y !== 0 || z !== 0) placed++;
    }
    return (placed / bimElements.length) * 100;
  }

  /**
   * Quantity accuracy = 1 - mean normalised variance between BIM quantities
   * and BoQ quantities for pairs matched by CSI code or element type.
   * Returns 0 when no matchable pairs exist.
   */
  private calculateQuantityAccuracy(boqItems: BoqItem[], bimElements: BimElement[]): number {
    if (boqItems.length === 0 || bimElements.length === 0) return 0;
    let totalVariance = 0;
    let comparisons   = 0;
    for (const boqItem of boqItems) {
      const boqQty = parseFloat(boqItem.quantity || '0');
      if (boqQty <= 0) continue;
      const match = bimElements.find(bim => {
        const bimCsi  = (bim.properties as any)?.csiCode
                     ?? (bim.properties as any)?.csi_code ?? '';
        const bimType = (bim.elementType ?? '').toLowerCase();
        const boqCat  = (boqItem.category ?? '').toLowerCase();
        const boqCode = (boqItem.itemCode ?? '');
        return (
          (boqCode && bimCsi && boqCode.startsWith(bimCsi.substring(0, 4))) ||
          bimType === boqCat
        );
      });
      if (!match) continue;
      const bimQty =
        parseFloat((match as any).quantity ?? '0') ||
        parseFloat((match.properties as any)?.area   ?? '0') ||
        parseFloat((match.properties as any)?.volume ?? '0') || 0;
      if (bimQty <= 0) continue;
      const variance = Math.abs(boqQty - bimQty) / Math.max(boqQty, bimQty);
      totalVariance += Math.min(variance, 1);
      comparisons++;
    }
    if (comparisons === 0) return 0;
    return Math.max(0, (1 - totalVariance / comparisons) * 100);
  }

  // Helper methods
  private async getBOQItems(projectId: string): Promise<BoqItem[]> {
    return await storage.getBoqItems(projectId);
  }
  
  private async getBIMElements(projectId: string): Promise<BimElement[]> {
    const bimModels = await storage.getBimModels(projectId);
    if (bimModels.length === 0) return [];
    
    return await storage.getBimElements(bimModels[0].id);
  }
  
  private async storeValidationResults(result: ValidationResult): Promise<void> {
    try {
      // GAP-4 FIX: Persist to analysisResults table via storage.createValidationResult()
      await storage.createValidationResult({
        projectId:         result.projectId,
        validationType:    'boq_bim_cross_validation',
        confidence:        result.confidenceScore / 100,
        elementsValidated: result.totalBimElements,
        issuesFound:       result.discrepancies.length,
        documentCount:     1,
        validationSummary: result.validationSummary,
        discrepancies:     result.discrepancies,
        recommendations:   result.recommendations,
      });
      console.log(`Validation result persisted: ${result.discrepancies.length} discrepancies, confidence: ${result.confidenceScore}%`);
    } catch (error) {
      // Non-fatal: log but do not rethrow so the API still returns the result
      console.warn('Failed to persist validation result:', error);
    }
  }
}

// Export singleton instance
export const boqBimValidator = new BoqBimValidator();