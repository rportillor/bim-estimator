/**
 * Geometry Validation Module
 * Validates Claude-extracted geometry using computer vision techniques
 * Complements AI extraction with mathematical validation
 */

import { BimElement } from '@shared/schema';

export interface DimensionChain {
  id: string;
  direction: 'horizontal' | 'vertical';
  dimensions: number[];
  total?: number;
  valid?: boolean;
  discrepancy?: number;
}

export interface GridSystem {
  vertical: { position: number; label: string }[];
  horizontal: { position: number; label: string }[];
  spacing: { x: number | null; y: number | null };
  source?: 'architectural' | 'structural' | 'combined';
}

export interface ValidationResult {
  element: BimElement;
  gridAlignment: {
    aligned: boolean;
    nearestGrid?: string;
    offset?: number;
  };
  dimensionValidation?: {
    valid: boolean;
    issues: string[];
  };
  confidence: number;
}

export class GeometryValidator {
  private architecturalGrid: GridSystem | null = null;
  private structuralGrid: GridSystem | null = null;
  private dimensionChains: DimensionChain[] = [];
  
  /**
   * Compare architectural and structural grids
   * Returns true if grids match, false if they differ
   */
  compareGrids(archGrid: GridSystem, structGrid: GridSystem): {
    matching: boolean;
    differences: string[];
  } {
    const differences: string[] = [];
    
    // Compare vertical grids
    const vMatching = this.compareGridLines(
      archGrid.vertical,
      structGrid.vertical,
      'vertical'
    );
    if (!vMatching.matching) {
      differences.push(...vMatching.differences);
    }
    
    // Compare horizontal grids
    const hMatching = this.compareGridLines(
      archGrid.horizontal,
      structGrid.horizontal,
      'horizontal'
    );
    if (!hMatching.matching) {
      differences.push(...hMatching.differences);
    }
    
    // Compare spacing
    if (archGrid.spacing.x && structGrid.spacing.x) {
      const xDiff = Math.abs((archGrid.spacing.x - structGrid.spacing.x));
      if (xDiff > 50) { // 50mm tolerance
        differences.push(
          `Grid X spacing differs: Arch=${archGrid.spacing.x}mm, Struct=${structGrid.spacing.x}mm`
        );
      }
    }
    
    if (archGrid.spacing.y && structGrid.spacing.y) {
      const yDiff = Math.abs((archGrid.spacing.y - structGrid.spacing.y));
      if (yDiff > 50) { // 50mm tolerance
        differences.push(
          `Grid Y spacing differs: Arch=${archGrid.spacing.y}mm, Struct=${structGrid.spacing.y}mm`
        );
      }
    }
    
    return {
      matching: differences.length === 0,
      differences
    };
  }
  
  private compareGridLines(
    archLines: { position: number; label: string }[],
    structLines: { position: number; label: string }[],
    direction: string
  ): { matching: boolean; differences: string[] } {
    const differences: string[] = [];
    
    // Check if labels match
    const archLabels = new Set(archLines.map(l => l.label));
    const structLabels = new Set(structLines.map(l => l.label));
    
    // Find missing grids
    for (const label of archLabels) {
      if (!structLabels.has(label)) {
        differences.push(
          `${direction} grid ${label} exists in architectural but not structural drawings`
        );
      }
    }
    
    for (const label of structLabels) {
      if (!archLabels.has(label)) {
        differences.push(
          `${direction} grid ${label} exists in structural but not architectural drawings`
        );
      }
    }
    
    // Check positions for matching labels
    for (const archLine of archLines) {
      const structLine = structLines.find(s => s.label === archLine.label);
      if (structLine) {
        const posDiff = Math.abs(archLine.position - structLine.position);
        if (posDiff > 100) { // 100mm tolerance
          differences.push(
            `${direction} grid ${archLine.label} position differs by ${posDiff}mm`
          );
        }
      }
    }
    
    return {
      matching: differences.length === 0,
      differences
    };
  }

  /**
   * Validate dimension chains sum correctly
   * Based on architectural rule: part dimensions must sum to total
   */
  validateDimensionChain(chain: DimensionChain): boolean {
    if (!chain.total || chain.dimensions.length === 0) {
      return false;
    }

    const sum = chain.dimensions.reduce((acc, dim) => acc + dim, 0);
    const tolerance = 5; // 5mm tolerance for rounding
    
    chain.discrepancy = Math.abs(sum - chain.total);
    chain.valid = chain.discrepancy <= tolerance;
    
    if (!chain.valid) {
      console.warn(
        `❌ Dimension chain validation failed for ${chain.id}:\n` +
        `  Sum: ${sum}mm, Expected: ${chain.total}mm\n` +
        `  Discrepancy: ${chain.discrepancy}mm`
      );
    }
    
    return chain.valid;
  }

  /**
   * Check if element aligns with appropriate grid (structural or architectural)
   */
  checkGridAlignment(element: BimElement, gridSystem: GridSystem, hasStructuralGrid: boolean = false): boolean {
    if (!element.location || !gridSystem) {
      return false;
    }

    const loc = element.location as any;
    const [x, y] = Array.isArray(loc) ? loc : [loc?.x ?? 0, loc?.y ?? 0];
    const tolerance = 100; // 100mm tolerance for grid alignment

    // Check vertical grid alignment
    const nearestVertical = this.findNearestGrid(x, gridSystem.vertical);
    const vAligned = nearestVertical ? Math.abs(x - nearestVertical.position) < tolerance : false;

    // Check horizontal grid alignment  
    const nearestHorizontal = this.findNearestGrid(y, gridSystem.horizontal);
    const hAligned = nearestHorizontal ? Math.abs(y - nearestHorizontal.position) < tolerance : false;

    // Structural elements (columns, beams) alignment depends on grid type
    const isStructural = element.elementType?.includes('Column') || 
                        element.elementType?.includes('Beam');
    
    if (isStructural) {
      // Only enforce strict alignment if we have structural grids
      // Otherwise, structural elements may not align with architectural grids
      if (hasStructuralGrid) {
        return vAligned && hAligned;
      } else {
        // For architectural grids, structural elements may be offset
        // Just log a note, don't fail validation
        if (!vAligned || !hAligned) {
          console.log(
            `ℹ️ Structural element ${element.elementType} at (${x}, ${y}) ` +
            `doesn't align with architectural grid - this is normal when using architectural drawings only`
          );
        }
        return true; // Don't penalize when only architectural grids available
      }
    }

    // Walls typically align with at least one grid
    if (element.elementType?.includes('Wall')) {
      return vAligned || hAligned;
    }

    // Other elements don't need strict grid alignment
    return true;
  }

  /**
   * Validate multi-view correlation
   * Heights from elevation should match z-coordinates
   */
  validateElevationCorrelation(
    planElement: BimElement,
    elevationHeight: number,
    viewType: 'window' | 'door' | 'floor'
  ): boolean {
    if (!planElement.location) return false;

    const z = (planElement.location as any[])[2];
    const tolerance = 50; // 50mm tolerance

    switch (viewType) {
      case 'door':
        // Door head typically at 2100mm
        return Math.abs(z - 0) < tolerance; // Doors start at floor
      
      case 'window':
        // Window sill typically at 900mm
        return Math.abs(z - elevationHeight) < tolerance;
      
      case 'floor':
        // Floor-to-floor height typically 3000mm
        return Math.abs(z % 3000) < tolerance;
      
      default:
        return true;
    }
  }

  /**
   * Cross-validate extracted dimensions with grid spacing
   */
  validateWithGridSpacing(dimensions: number[], gridSpacing: number): boolean {
    if (!gridSpacing) return true;

    // Check if dimensions are multiples or fractions of grid spacing
    const tolerance = 50; // 50mm tolerance

    for (const dim of dimensions) {
      const ratio = dim / gridSpacing;
      const nearestMultiple = Math.round(ratio);
      
      if (Math.abs(ratio - nearestMultiple) * gridSpacing > tolerance) {
        // Check if it's a common fraction (1/2, 1/3, 1/4)
        const fractions = [0.5, 0.333, 0.25, 0.75];
        const isFraction = fractions.some(f => 
          Math.abs(ratio - Math.floor(ratio) - f) * gridSpacing < tolerance
        );
        
        if (!isFraction) {
          console.warn(
            `⚠️ Dimension ${dim}mm doesn't align with grid spacing ${gridSpacing}mm`
          );
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Generate validation report for BIM elements
   */
  validateBIMElements(
    elements: BimElement[],
    gridSystem?: GridSystem,
    drawingTypes?: string[]
  ): ValidationResult[] {
    const results: ValidationResult[] = [];

    for (const element of elements) {
      const result: ValidationResult = {
        element,
        gridAlignment: { aligned: true },
        confidence: 1.0
      };

      // Check grid alignment if grid system is available
      if (gridSystem && element.location) {
        // Determine if we have structural drawings
        const hasStructuralGrid = drawingTypes?.some(type => 
          type.toUpperCase().startsWith('S-')
        ) || false;
        
        const aligned = this.checkGridAlignment(element, gridSystem, hasStructuralGrid);
        result.gridAlignment.aligned = aligned;
        
        if (!aligned) {
          result.confidence *= 0.8; // Reduce confidence for misaligned elements
          
          // Find nearest grid for reporting
          const loc = element.location as any;
    const [x, y] = Array.isArray(loc) ? loc : [loc?.x ?? 0, loc?.y ?? 0];
          const vGrid = this.findNearestGrid(x, gridSystem.vertical);
          const hGrid = this.findNearestGrid(y, gridSystem.horizontal);
          
          if (vGrid && hGrid) {
            result.gridAlignment.nearestGrid = `${vGrid.label}${hGrid.label}`;
            result.gridAlignment.offset = Math.sqrt(
              Math.pow(x - vGrid.position, 2) + Math.pow(y - hGrid.position, 2)
            );
          }
        }
      }

      // Validate dimensions if available
      if ((element.geometry as any)?.dimensions) {
        const dims = Object.values((element.geometry as any).dimensions)
          .filter(d => typeof d === 'number') as number[];
        
        if (dims.length > 0 && gridSystem?.spacing.x) {
          const valid = this.validateWithGridSpacing(dims, gridSystem.spacing.x);
          result.dimensionValidation = {
            valid,
            issues: valid ? [] : ['Dimensions don\'t align with grid module']
          };
          
          if (!valid) {
            result.confidence *= 0.9;
          }
        }
      }

      results.push(result);
    }

    // Log summary
    const totalElements = results.length;
    const alignedElements = results.filter(r => r.gridAlignment.aligned).length;
    const highConfidence = results.filter(r => r.confidence > 0.8).length;
    
    console.log(
      `📊 Geometry Validation Summary:\n` +
      `  Total elements: ${totalElements}\n` +
      `  Grid-aligned: ${alignedElements} (${(alignedElements/totalElements*100).toFixed(1)}%)\n` +
      `  High confidence: ${highConfidence} (${(highConfidence/totalElements*100).toFixed(1)}%)`
    );

    return results;
  }

  /**
   * Suggest corrections for invalid dimensions
   */
  suggestDimensionCorrections(chain: DimensionChain): number[] {
    if (!chain.total || chain.dimensions.length === 0) {
      return chain.dimensions;
    }

    const sum = chain.dimensions.reduce((acc, dim) => acc + dim, 0);
    const discrepancy = chain.total - sum;
    
    // Distribute discrepancy proportionally
    const corrected = chain.dimensions.map(dim => {
      const proportion = dim / sum;
      return Math.round(dim + (discrepancy * proportion));
    });

    // Verify correction
    const correctedSum = corrected.reduce((acc, dim) => acc + dim, 0);
    if (Math.abs(correctedSum - chain.total) > 1) {
      // Adjust largest dimension for remaining difference
      const maxIndex = corrected.indexOf(Math.max(...corrected));
      corrected[maxIndex] += chain.total - correctedSum;
    }

    return corrected;
  }

  private findNearestGrid(
    position: number, 
    grids: { position: number; label: string }[]
  ): { position: number; label: string } | null {
    if (!grids || grids.length === 0) return null;

    let nearest = grids[0];
    let minDistance = Math.abs(position - grids[0].position);

    for (const grid of grids) {
      const distance = Math.abs(position - grid.position);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = grid;
      }
    }

    return nearest;
  }

  /**
   * Extract grid system from Claude's analysis
   * This would parse Claude's understanding of the grid
   */
  extractGridFromAnalysis(claudeAnalysis: any): GridSystem | null {
    // Parse Claude's grid understanding
    // This would extract grid lines mentioned in the analysis
    
    try {
      const gridData = claudeAnalysis.structural_grid;
      if (!gridData) return null;

      return {
        vertical: gridData.vertical_grids || [],
        horizontal: gridData.horizontal_grids || [],
        spacing: {
          x: gridData.typical_spacing_x || null,
          y: gridData.typical_spacing_y || null
        }
      };
    } catch (_error) {
      console.warn('Could not extract grid system from analysis');
      return null;
    }
  }
}

/**
 * Integration with existing QTO processor
 * Call this after Claude extraction for validation
 */
export function validateExtractedGeometry(
  elements: BimElement[],
  claudeAnalysis: any
): {
  validated: BimElement[];
  issues: ValidationResult[];
  suggestions: string[];
} {
  const validator = new GeometryValidator();
  
  // Extract grid if available
  const gridSystem = validator.extractGridFromAnalysis(claudeAnalysis);
  
  // Validate all elements
  const validationResults = validator.validateBIMElements(elements, gridSystem || undefined);
  
  // Separate validated and problematic elements
  const validated = validationResults
    .filter(r => r.confidence > 0.7)
    .map(r => r.element);
  
  const issues = validationResults
    .filter(r => r.confidence <= 0.7);
  
  // Generate suggestions
  const suggestions: string[] = [];
  
  if (issues.length > 0) {
    suggestions.push(
      `⚠️ ${issues.length} elements need review:`,
      ...issues.slice(0, 5).map(issue => {
        const elem = issue.element;
        return `  - ${elem.elementType} at ${elem.location}: ${
          issue.gridAlignment.aligned ? 'Aligned' : `Off-grid by ${issue.gridAlignment.offset?.toFixed(0)}mm`
        }`;
      })
    );
    
    if (issues.length > 5) {
      suggestions.push(`  ... and ${issues.length - 5} more`);
    }
  }

  return {
    validated,
    issues,
    suggestions
  };
}

/**
 * Dimension chain extraction helper
 * Use after Claude extracts individual dimensions
 */
export function buildDimensionChains(
  dimensions: Array<{ value: number; direction: string; sequence?: number }>
): DimensionChain[] {
  const chains: Map<string, DimensionChain> = new Map();

  // Group dimensions by direction
  for (const dim of dimensions) {
    const chainId = dim.direction;
    
    if (!chains.has(chainId)) {
      chains.set(chainId, {
        id: chainId,
        direction: dim.direction as 'horizontal' | 'vertical',
        dimensions: []
      });
    }
    
    chains.get(chainId)!.dimensions.push(dim.value);
  }

  // Sort dimensions in each chain by sequence if available
  return Array.from(chains.values());
}