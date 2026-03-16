import { normaliseElevation, normaliseCoord, normaliseDimensions, toMetres } from './helpers/unit-normaliser';
import { storage } from "./storage";
import { logger as enterpriseLogger } from "./utils/enterprise-logger";
import Anthropic from '@anthropic-ai/sdk';
import { parseFirstJsonObject } from './utils/anthropic-response';
import { publishProgress } from "./routes/progress";
import * as crypto from 'crypto';
import { ElementClassifier } from "./helpers/element-classifier";
import { buildEstimateForModel } from "./estimator/estimate-engine";
import { buildBudgetStructure } from "./estimator/budget-structure";
import {
  registerMissingData,
  generateAllRFIs,
  generateRFISummary,
  formatRFIReport,
  type MissingDataItem,
  type MissingDataCategory,
  type ImpactLevel,
  type RFISummary,
} from "./estimator/rfi-generator";

const logger = {
  info:  (msg: string, data?: any) => enterpriseLogger.info('[CONSTRUCTION] ' + msg, data || ''),
  warn:  (msg: string, data?: any) => enterpriseLogger.info('[CONSTRUCTION] WARN ' + msg, data || ''),
  error: (msg: string, data?: any) => enterpriseLogger.error('[CONSTRUCTION] ' + msg, data || ''),
};

interface Product {
  id: string;
  name: string;
  csiCode: string;
  specification: string;
  manufacturer?: string;
  model?: string;
  properties: Record<string, any>;
}

interface Assembly {
  id: string;
  name: string;
  type: string;
  products: Product[];
  constructionMethod: string;
  properties: Record<string, any>;
}

interface Element {
  id: string;
  type: string;
  assemblies: Assembly[];
  location: string;
  properties: Record<string, any>;
  geometry: Record<string, any>;
}

/**
 * PROPER CONSTRUCTION WORKFLOW:
 * 1. Extract PRODUCTS from specifications
 * 2. Create ASSEMBLIES from products
 * 3. Build ELEMENTS from assemblies  
 * 4. Generate BIM model from elements
 */
export class ConstructionWorkflowProcessor {
  private anthropic: Anthropic;
  private products: Map<string, Product> = new Map();
  private assemblies: Map<string, Assembly> = new Map();
  private elements: Map<string, Element> = new Map();
  private missingData: MissingDataItem[] = [];
  private progressFile: string = '';
  /**
   * Storey name → elevation in metres, populated from Claude's analysis before
   * any element building begins.  Keyed by lower-cased, trimmed storey name.
   * This eliminates the always-null return from getFloorElevation and gives
   * every element its correct z-coordinate without falling back to 0.
   */
  private storeyElevations: Map<string, number> = new Map();
  
  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  
  /**
   * Calculate overall progress percentage
   */
  private calculateOverallProgress(currentChunk: number, totalChunks: number, currentBatch: number, totalBatches: number): number {
    // Calculate progress within current batch
    const batchProgress = (currentChunk / totalChunks) * 100;
    
    // Calculate overall progress across all batches
    const batchWeight = 100 / totalBatches;
    const completedBatchesProgress = (currentBatch - 1) * batchWeight;
    const currentBatchProgress = (batchProgress / 100) * batchWeight;
    
    return Math.round(completedBatchesProgress + currentBatchProgress);
  }
  
  /**
   * Save progress to allow resumption after crashes
   */
  private async saveProgress(modelId: string): Promise<void> {
    try {
      const progress = {
        modelId,
        products: Array.from(this.products.entries()),
        assemblies: Array.from(this.assemblies.entries()),
        elements: Array.from(this.elements.entries()),
        timestamp: new Date().toISOString()
      };
      
      // Calculate accurate progress percentage
      const totalSteps = 4;
      const currentStep = this.elements.size > 0 ? 4 : 
                         this.assemblies.size > 0 ? 3 :
                         this.products.size > 0 ? 2 : 1;
      const progressPercent = Math.round((currentStep / totalSteps) * 100);
      
      // Save progress in geometryData field (accepts JSON)
      await storage.updateBimModel(modelId, {
        geometryData: {
          constructionProgress: JSON.stringify(progress),
          productsFound: this.products.size,
          assembliesCreated: this.assemblies.size,
          elementsBuilt: this.elements.size,
          savedAt: new Date().toISOString(),
          progressPercent: progressPercent
        }
      });
      
      // CRITICAL: Publish real-time progress
      const { publishProgress } = await import('./routes/progress');
      publishProgress(modelId, {
        progress: progressPercent,
        message: `Step ${currentStep}/${totalSteps}: ${
          currentStep === 1 ? 'Extracting products from specifications' :
          currentStep === 2 ? `Found ${this.products.size} products, creating assemblies` :
          currentStep === 3 ? `Created ${this.assemblies.size} assemblies, building elements` :
          `Built ${this.elements.size} elements successfully`
        }`,
        phase: 'processing',
        details: {
          products: this.products.size,
          assemblies: this.assemblies.size,
          elements: this.elements.size
        }
      });
      
      logger.info(`ðŸ’¾ Progress saved: ${this.products.size} products`);
      
      // NO LONGER SAVING PRODUCTS AS BIM ELEMENTS - Products are components, not elements!
      // Elements will be saved only after proper placement with coordinates from drawings
    } catch (error) {
      logger.error('Failed to save progress:', error);
    }
  }
  
  /**
   * Save ONLY final placed elements as BIM elements (NOT products or assemblies)
   */
  private async saveElementsAsBimElements(modelId: string): Promise<void> {
    try {
      // BUG FIX (v15.4): batch upsert instead of individual createBimElement calls.
      // Previous code wrote geometry.position; postprocess then overwrote records via
      // upsertBimElements but convertRealElementToLegacyFormat couldn't read
      // geometry.position so real coordinates were lost.  Now we write
      // geometry.location.realLocation directly and use upsertBimElements for the
      // single batch DELETE + INSERT, matching how postprocessAndSaveBIM operates.

      const elementsToSave: any[] = [];
      const skippedCount = { noCoords: 0 };

      for (const [id, element] of Array.from(this.elements.entries())) {
        // Prefer canonical realLocation key; fall back to legacy position key
        const rl = element.geometry?.location?.realLocation;
        const pos = rl || element.geometry?.position;

        if (!pos || (pos.x === 0 && pos.y === 0 && pos.z === 0)) {
          skippedCount.noCoords++;
          this.trackMissingData(
            'dimension',
            `Element ${id} (${element.type}) has no real coordinates — excluded from BIM model`,
            element.properties?.csiCode?.substring(0, 2) || '00',
            'high',
            {
              floorLabel: element.properties?.floor || element.location,
              costImpactLow: 500,
              costImpactHigh: 5000,
              assumptionUsed: 'Element excluded from model; quantities may be understated',
            }
          );
          continue;
        }

        // Ensure geometry has both keys for maximum compatibility
        const safeGeometry = {
          ...element.geometry,
          position: pos,
          location: {
            ...(element.geometry?.location || {}),
            realLocation: {
              x: Number(pos.x) || 0,
              y: Number(pos.y) || 0,
              z: Number(pos.z) || 0,
            },
          },
        };

        elementsToSave.push({
          id,
          elementId: id,
          type: element.type,
          elementType: element.type,
          name: element.properties?.assemblyName || element.type,
          location: element.location,
          storeyName: element.properties?.floor || null,
          geometry: safeGeometry,
          properties: {
            ...element.properties,
            assemblies: element.assemblies?.map((a: Assembly) => ({
              id: a.id,
              name: a.name,
              products: a.products.map(p => ({ id: p.id, csiCode: p.csiCode, name: p.name })),
            })),
          },
        });
      }

      if (elementsToSave.length === 0) {
        logger.warn(`saveElementsAsBimElements: no placeable elements (${skippedCount.noCoords} skipped — no real coordinates)`);
      } else {
        // GUARD: Never reduce the element count — only allow saves that ADD elements.
        // upsertBimElements does DELETE + INSERT, so saving 2 new elements would wipe
        // 604 existing ones. Instead, only replace if count is growing or equal.
        const existingCount = await storage.getBimElements(modelId).then((e: any[]) => e.length).catch(() => 0);
        if (existingCount > elementsToSave.length) {
          // Fewer new elements than existing — do a merge-only: filter out IDs already
          // in the DB and insert only the genuinely new ones without touching existing.
          const existingEls = await storage.getBimElements(modelId);
          const existingIds = new Set((existingEls as any[]).map((e: any) => e.elementId || e.id));
          const trulyNew = elementsToSave.filter((e: any) => !existingIds.has(e.id || e.elementId));
          if (trulyNew.length > 0) {
            // Insert only the new elements, preserving existing
            await storage.upsertBimElements(modelId, [...existingEls, ...trulyNew]);
            logger.info(`Merged ${trulyNew.length} new placed elements into ${existingCount} existing (total: ${existingCount + trulyNew.length})`);
          } else {
            logger.warn(`saveElementsAsBimElements: GUARD — ${elementsToSave.length} new < ${existingCount} existing, all already present — skipping save`);
          }
        } else {
          await storage.upsertBimElements(modelId, elementsToSave);
          logger.info(`Upserted ${elementsToSave.length} placed elements (${skippedCount.noCoords} skipped — no coords)`);
        }
        const sample = elementsToSave.slice(0, 3);
        for (const el of sample) {
          const p = el.geometry.location.realLocation;
          logger.info(`   OK ${el.type} at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) — ${el.location}`);
        }
      }

      await storage.updateBimModel(modelId, { status: 'processing' });
      await this.addElementClassifications(modelId);
    } catch (error) {
      logger.error('Failed to save BIM elements:', error);
    }
  }

  /**
   * Add classifications for all BIM elements based on extracted data
   */
  private async addElementClassifications(modelId: string): Promise<void> {
    try {
      const elements = await storage.getBimElements(modelId);
      let classifiedCount = 0;
      
      for (const element of elements) {
        const properties = element.properties as any;
        const geometry = element.geometry as any;
        
        // Check if already classified
        const existingClassifications = await storage.getBimElementClassifications(element.id);
        if (existingClassifications.length > 0) continue;
        
        // Create classification input from element data
        const classificationInput = {
          elementId: element.id,
          elementType: properties?.elementType || element.elementType,
          wallType: geometry?.wallType || properties?.wallType,
          mark: properties?.mark || element.elementId,
          name: element.name || properties?.name,
          csiCode: properties?.csiCode,
          specification: properties?.specification,
          documentName: properties?.extractedFrom || properties?.documentName
        };
        
        // Classify the element
        const classification = ElementClassifier.classify(classificationInput);
        
        // Save classification
        await storage.createBimElementClassification(classification);
        classifiedCount++;
      }
      
      logger.info(`ðŸ·ï¸ Added classifications for ${classifiedCount} elements`);
    } catch (error) {
      logger.error('Failed to add element classifications:', error);
    }
  }
  
  /**
   * Extract real position from drawing element properties
   */
  private extractPositionFromDrawing(element: any): { x: number | null; y: number | null; z: number | null } {
    const position = {
      x: null as number | null,
      y: null as number | null,
      z: null as number | null
    };

    // Extract from explicit coordinates
    if (element.properties?.coordinates) {
      position.x = this.parseMetricDimension(element.properties.coordinates.x) || element.properties.coordinates.x;
      position.y = this.parseMetricDimension(element.properties.coordinates.y) || element.properties.coordinates.y;
      position.z = this.parseMetricDimension(element.properties.coordinates.z) || element.properties.coordinates.z;
    }

    // Extract from grid references (e.g., "Grid A-3", "Between Grid B-C")
    // Grid spacing must come from drawings — passed from element properties
    if (element.properties?.gridLocation) {
      const knownSpacing = element.properties?.gridSpacing
        ? this.parseMetricDimension(element.properties.gridSpacing)
        : undefined;
      const gridPos = this.parseGridLocation(
        element.properties.gridLocation,
        knownSpacing || undefined
      );
      if (gridPos) {
        position.x = position.x || gridPos.x;
        position.y = position.y || gridPos.y;
      }
    }

    // Extract from wall centerline for walls
    if (element.properties?.wallStartX !== undefined && element.properties?.wallEndX !== undefined) {
      // Use midpoint for wall position
      position.x = position.x || (element.properties.wallStartX + element.properties.wallEndX) / 2;
      position.y = position.y || (element.properties.wallStartY + element.properties.wallEndY) / 2;
    }

    // Extract from room coordinates
    if (element.properties?.roomCenter) {
      position.x = position.x || element.properties.roomCenter.x;
      position.y = position.y || element.properties.roomCenter.y;
    }

    // Extract floor elevation
    if (element.properties?.floor) {
      position.z = position.z || this.getFloorElevation(element.properties.floor);
    }

    // Extract from mounting height for MEP equipment
    if (element.properties?.mountingHeight) {
      const baseZ = position.z || this.getFloorElevation(element.properties?.floor) || 0;
      const mountHeight = this.parseMetricDimension(element.properties.mountingHeight) || 0;
      position.z = baseZ + mountHeight;
    }

    // Extract from specific element positions
    if (element.properties?.position) {
      position.x = position.x || this.parseMetricDimension(element.properties.position.x) || element.properties.position.x;
      position.y = position.y || this.parseMetricDimension(element.properties.position.y) || element.properties.position.y;
      position.z = position.z || this.parseMetricDimension(element.properties.position.z) || element.properties.position.z;
    }

    return position;
  }

  /**
   * Parse grid location string to coordinates.
   * 
   * CRITICAL: Grid spacing MUST come from actual project drawings.
   * If grid spacing is unknown, this method returns null and registers
   * the gap as missing data for RFI generation per CIQS standards.
   * 
   * The gridSpacing parameter must be provided by the caller from:
   *   - Detected grid axes (grid_axes table, once WP-3 is implemented)
   *   - Claude's structured extraction (properties.gridSpacing)
   *   - User-confirmed project grid configuration
   * 
   * NO HARDCODED DEFAULTS. This is a fundamental QS principle.
   */
  private parseGridLocation(
    gridLocation: string,
    knownGridSpacing?: number
  ): { x: number; y: number } | null {
    if (!gridLocation) return null;

    // Grid spacing must come from drawings — NEVER hardcoded
    const gridSpacing = knownGridSpacing;

    if (!gridSpacing) {
      // Register as missing data for RFI generation
      this.trackMissingData(
        'dimension',
        `Grid spacing unknown for grid reference "${gridLocation}". ` +
        `Cannot calculate element coordinates without structural grid spacing from drawings. ` +
        `Verify grid dimensions on structural foundation plan.`,
        '03 00 00',  // CSI Division 03: Concrete (structural grid)
        'high',
        {
          drawingRef: 'Structural Foundation Plan (S-series)',
          costImpactLow: 0,
          costImpactHigh: 0,
          assumptionUsed: undefined,  // NO assumption — fail cleanly
        }
      );
      logger.warn(
        `⚠️ GRID SPACING UNKNOWN for "${gridLocation}" — ` +
        `RFI registered. Element will use fallback position sources.`
      );
      return null;
    }

    // Parse patterns like "A-3", "Grid B-4", "Between C-D/2-3"
    const simpleGrid = gridLocation.match(/([A-Z])-?(\d+)/i);
    if (simpleGrid) {
      const gridX = simpleGrid[1].charCodeAt(0) - 'A'.charCodeAt(0);
      const gridY = parseInt(simpleGrid[2]) - 1;
      return {
        x: gridX * gridSpacing,
        y: gridY * gridSpacing
      };
    }

    // Parse "Between" patterns
    const betweenPattern = gridLocation.match(/between\s+([A-Z])-([A-Z]).*?(\d+)-(\d+)/i);
    if (betweenPattern) {
      const gridX1 = betweenPattern[1].charCodeAt(0) - 'A'.charCodeAt(0);
      const gridX2 = betweenPattern[2].charCodeAt(0) - 'A'.charCodeAt(0);
      const gridY1 = parseInt(betweenPattern[3]) - 1;
      const gridY2 = parseInt(betweenPattern[4]) - 1;
      return {
        x: ((gridX1 + gridX2) / 2) * gridSpacing,
        y: ((gridY1 + gridY2) / 2) * gridSpacing
      };
    }

    return null;
  }

  /**
   * Determine actual shape of element based on type and properties
   */
  private determineActualShape(element: any): string {
    const elementType = (element.elementType || element.type || '').toLowerCase();
    const properties = element.properties || {};
    
    // Columns can be round, square, or rectangular
    if (elementType === 'column' || elementType.includes('column')) {
      if (properties.shape) {
        return properties.shape.toLowerCase();
      }
      // Check for circular column indicators
      if (properties.diameter || properties.radius) {
        return 'cylinder';
      }
      // Check if dimensions suggest square or rectangular
      if (properties.width && properties.depth) {
        const ratio = Math.abs(properties.width - properties.depth) / Math.max(properties.width, properties.depth);
        if (ratio < 0.1) {
          return 'square_prism'; // Width and depth are nearly equal
        } else {
          return 'rectangular_prism'; // Different width and depth
        }
      }
      // Default for columns
      return 'cylinder';
    }
    
    // Walls are rectangular prisms
    if (elementType === 'wall' || elementType.includes('wall')) {
      return 'rectangular_prism';
    }
    
    // Beams are typically I-beams or rectangular
    if (elementType === 'beam' || elementType.includes('beam')) {
      if (properties.profile && properties.profile.includes('I')) {
        return 'i_beam';
      }
      if (properties.profile && properties.profile.includes('HSS')) {
        return 'hollow_rectangular';
      }
      return 'rectangular_prism';
    }
    
    // Slabs and floors are flat rectangular prisms
    if (elementType === 'slab' || elementType === 'floor') {
      return 'rectangular_prism';
    }
    
    // Doors and windows are rectangular openings
    if (elementType === 'door' || elementType === 'window') {
      return 'rectangular_opening';
    }
    
    // MEP equipment shapes
    if (elementType.includes('tank') || elementType.includes('cylinder')) {
      return 'cylinder';
    }
    
    if (elementType.includes('duct')) {
      if (properties.shape === 'round' || properties.diameter) {
        return 'cylinder';
      }
      return 'rectangular_prism'; // Rectangular duct
    }
    
    if (elementType.includes('pipe') || elementType.includes('conduit')) {
      return 'cylinder';
    }
    
    if (elementType.includes('panel') || elementType.includes('box')) {
      return 'rectangular_prism';
    }
    
    // Default to box shape
    return 'box';
  }

  /**
   * Extract real dimensions from drawing element properties
   */
  private extractDimensionsFromDrawing(element: any): { width: number | null; height: number | null; depth: number | null } {
    const dimensions = {
      width: null as number | null,
      height: null as number | null,
      depth: null as number | null
    };

    // Extract from explicit dimension properties
    if (element.properties?.dimensions) {
      dimensions.width = this.parseMetricDimension(element.properties.dimensions.width);
      dimensions.height = this.parseMetricDimension(element.properties.dimensions.height);
      dimensions.depth = this.parseMetricDimension(element.properties.dimensions.depth);
    }

    // Extract from wall properties
    if (element.properties?.wallStartX !== undefined && element.properties?.wallEndX !== undefined) {
      const dx = element.properties.wallEndX - element.properties.wallStartX;
      const dy = element.properties.wallEndY - element.properties.wallStartY;
      dimensions.width = Math.sqrt(dx * dx + dy * dy);
      dimensions.height = this.parseMetricDimension(element.properties.wallHeight) || element.properties?.wallHeight;
      dimensions.depth = this.parseMetricDimension(element.properties.wallThickness) || element.properties?.wallThickness;
    }

    // Extract from size string (e.g., "3'-0\" x 7'-0\" x 8\"")
    if (element.properties?.size) {
      const parsed = this.parseDimensionString(element.properties.size);
      dimensions.width = dimensions.width || parsed.width;
      dimensions.height = dimensions.height || parsed.height;
      dimensions.depth = dimensions.depth || parsed.depth;
    }

    // Extract from specific element types
    if (element.properties?.elementType) {
      const type = element.properties.elementType.toLowerCase();
      
      // Doors - only use actual dimensions from Claude's analysis
      if (type === 'door' && element.properties?.size) {
        const doorSize = this.parseDimensionString(element.properties.size);
        // NO DEFAULTS - only use what Claude actually found
        if (doorSize.width) dimensions.width = doorSize.width;
        if (doorSize.height) dimensions.height = doorSize.height;
        // depth stays as-is, no default added
      }
      
      // Windows - only use actual dimensions from Claude's analysis
      if (type === 'window' && element.properties?.size) {
        const windowSize = this.parseDimensionString(element.properties.size);
        // NO DEFAULTS - only use what Claude actually found
        if (windowSize.width) dimensions.width = windowSize.width;
        if (windowSize.height) dimensions.height = windowSize.height;
        // depth stays as-is, no default added
      }

      // Columns can be round, square, or rectangular
      if (type === 'column') {
        // Check for diameter (round columns)
        if (element.properties?.diameter) {
          const diameter = this.parseMetricDimension(element.properties.diameter);
          dimensions.width = diameter;
          dimensions.depth = diameter;
          dimensions.height = element.properties?.height || null; // NO DEFAULT
        }
        // Check for rectangular columns with different width/depth
        else if (element.properties?.width && element.properties?.depth) {
          dimensions.width = this.parseMetricDimension(element.properties.width);
          dimensions.depth = this.parseMetricDimension(element.properties.depth);
          dimensions.height = element.properties?.height || null; // NO DEFAULT
        }
        // Check for square columns
        else if (element.properties?.size) {
          const size = this.parseMetricDimension(element.properties.size);
          dimensions.width = size;
          dimensions.depth = size;
          dimensions.height = element.properties?.height || null; // NO DEFAULT
        }
      }

      // Beams - only use actual dimensions from Claude's analysis
      if (type === 'beam') {
        // NO DEFAULTS - only use what Claude actually found
        dimensions.width = element.properties?.length || element.properties?.span || null;
        dimensions.height = this.parseMetricDimension(element.properties?.depth);
        dimensions.depth = this.parseMetricDimension(element.properties?.width);
      }
    }

    return dimensions;
  }

  /**
   * Parse metric dimensions from various formats
   */
  /**
   * Parse any measurement string to metres.
   * Delegates to the canonical unit-normaliser (mm, cm, m, ft, in, ft-in, plain numbers).
   */
  private parseMetricDimension(value: any): number | null {
    return toMetres(value, 'dimension');
  }
  /**
   * Parse dimension string with multiple values
   */
  private parseDimensionString(sizeStr: string): { width: number | null; height: number | null; depth: number | null } {
    const result = {
      width: null as number | null,
      height: null as number | null,
      depth: null as number | null
    };
    
    if (!sizeStr) return result;
    
    // Split by 'x' or 'X' or 'by' or '*'
    const parts = sizeStr.split(/\s*[xXÃ—*]\s*|\s+by\s+/i);
    
    // Parse each part
    const dimensions = parts.map(part => this.parseMetricDimension(part)).filter(d => d !== null);
    
    // Assign dimensions based on count
    if (dimensions.length >= 1) result.width = dimensions[0];
    if (dimensions.length >= 2) result.height = dimensions[1];
    if (dimensions.length >= 3) result.depth = dimensions[2];
    
    // If only two dimensions and one is very small, it might be thickness
    if (dimensions.length === 2 && dimensions[1] && dimensions[1] < 0.05) {
      result.depth = dimensions[1];
      result.height = null;
    }
    
    return result;
  }

  /**
   * Helper: Convert floor name to elevation in meters
   */
  private calculateXFromGrid(properties: any): number | null {
    if (!properties) return null;
    
    // Calculate X coordinate from grid position ONLY if grid spacing is known from drawings
    if (properties.gridX && properties.distanceFromGridX !== undefined && properties.gridSpacing) {
      const gridLetter = properties.gridX.charCodeAt(0) - 'A'.charCodeAt(0);
      const gridSpacing = properties.gridSpacing; // Must come from drawings, NO DEFAULT
      return gridLetter * gridSpacing + (properties.distanceFromGridX || 0);
    }
    
    // Fall back to wall start point if available
    if (properties.wallStartX !== undefined) {
      return properties.wallStartX;
    }
    
    // Return null - NO DEFAULT. Fail fast if position not found in drawings
    // Missing X coordinate tracked for RFI generation
    return null;
  }

  private calculateYFromGrid(properties: any): number | null {
    if (!properties) return null;
    
    // Calculate Y coordinate from grid position ONLY if grid spacing is known from drawings
    if (properties.gridY && properties.distanceFromGridY !== undefined && properties.gridSpacing) {
      const gridNumber = parseInt(properties.gridY) - 1;
      const gridSpacing = properties.gridSpacing; // Must come from drawings, NO DEFAULT
      return gridNumber * gridSpacing + (properties.distanceFromGridY || 0);
    }
    
    // Fall back to wall start point if available
    if (properties.wallStartY !== undefined) {
      return properties.wallStartY;
    }
    
    // Return null - NO DEFAULT. Fail fast if position not found in drawings
    return null;
  }

  private calculateWidth(properties: any): number | null {
    if (!properties) return null;
    
    // For walls, calculate length from start/end points
    if (properties.wallStartX !== undefined && properties.wallEndX !== undefined &&
        properties.wallStartY !== undefined && properties.wallEndY !== undefined) {
      const dx = properties.wallEndX - properties.wallStartX;
      const dy = properties.wallEndY - properties.wallStartY;
      return Math.sqrt(dx * dx + dy * dy);
    }
    
    // Parse from size string
    if (properties.size) {
      return this.parseDimension(properties.size, 'width');
    }
    
    // Return null - NO DEFAULT. Dimensions must come from drawings
    return null;
  }

  private getFloorElevation(floor?: string): number | null {
    if (!floor) return null;

    // ── Primary: use the storey elevation map built from Claude's analysis ──
    // The map is populated at the start of processConstructionDocuments from
    // the claudeAnalysis option.  Lookup is case-insensitive and ignores
    // leading/trailing whitespace.
    const key = floor.trim().toLowerCase();
    if (this.storeyElevations.has(key)) {
      return this.storeyElevations.get(key)!;
    }

    // ── Fuzzy fallback: partial name match ────────────────────────────────
    // Handles cases like "Second Floor" matching a storey named "Floor 2"
    for (const [storey, elev] of this.storeyElevations) {
      if (storey.includes(key) || key.includes(storey)) {
        logger.info(`  ↳ Fuzzy storey match: '${floor}' → '${storey}' (${elev}m)`);
        return elev;
      }
    }

    // ── No match: register RFI only when the map had data (meaningful miss) ─
    if (this.storeyElevations.size > 0) {
      logger.warn(`Floor elevation requested for '${floor}' not found in storey map`);
      this.trackMissingData(
        'dimension',
        `Floor elevation for '${floor}' not found in section/elevation drawings. ` +
          `Available storeys: ${Array.from(this.storeyElevations.keys()).join(', ')}. ` +
          `Required: building sections or elevation drawings showing datum for this floor.`,
        '03',
        'high',
        {
          floorLabel: floor,
          costImpactLow: 2000,
          costImpactHigh: 25000,
          assumptionUsed: 'Floor elevation unknown; z-coordinate will be 0 until RFI resolved',
        }
      );
    }

    return null;
  }
  
  /**
   * Helper: Parse dimensions from strings like "3'-0\" x 7'-0\""
   * This is a simplified version for backward compatibility
   */
  private parseDimension(sizeStr?: string, dimension?: 'width' | 'height' | 'depth'): number | null {
    if (!sizeStr) return null;
    
    // Use the new comprehensive parser
    const parsed = this.parseDimensionString(sizeStr);
    
    if (dimension === 'width') return parsed.width;
    if (dimension === 'height') return parsed.height;
    if (dimension === 'depth') return parsed.depth;
    
    return parsed.width || parsed.height || parsed.depth || null;
  }
  
  /**
   * Load progress to resume from where we left off
   */
  private async loadProgress(modelId: string): Promise<void> {
    try {
      const model = await storage.getBimModel(modelId);
      const geoData = model?.geometryData as any;
      
      if (geoData?.constructionProgress) {
        const progress = JSON.parse(geoData.constructionProgress);
        // Restore collections
        this.products = new Map(progress.products || []);
        this.assemblies = new Map(progress.assemblies || []);
        this.elements = new Map(progress.elements || []);
        
        if (this.products.size > 0 || this.assemblies.size > 0) {
          logger.info(`ðŸ“¥ Resumed from checkpoint: ${this.products.size} products, ${this.assemblies.size} assemblies, ${this.elements.size} elements`);
        }
      }
    } catch (_error) {
      logger.info('No previous progress found, starting fresh');
    }
  }
  
  /**
   * Clear all state for a fresh start
   */
  clearState(): void {
    this.products.clear();
    this.assemblies.clear();
    this.elements.clear();
    this.missingData = [];
    this.storeyElevations.clear();
    logger.info('Cleared all processor state');
  }
  
  /**
   * Track missing data discovered during BIM analysis.
   * Core QS principle: NEVER use defaults — gaps must generate RFIs.
   */
  private trackMissingData(
    category: MissingDataCategory,
    description: string,
    csiDivision: string,
    impact: ImpactLevel,
    opts?: {
      drawingRef?: string;
      specSection?: string;
      floorLabel?: string;
      costImpactLow?: number;
      costImpactHigh?: number;
      assumptionUsed?: string;
    }
  ): MissingDataItem {
    const item = registerMissingData({
      category,
      description,
      csiDivision,
      impact,
      drawingRef: opts?.drawingRef,
      specSection: opts?.specSection,
      floorLabel: opts?.floorLabel,
      costImpactLow: opts?.costImpactLow ?? 0,
      costImpactHigh: opts?.costImpactHigh ?? 0,
      assumptionUsed: opts?.assumptionUsed,
      discoveredBy: 'ConstructionWorkflowProcessor',
    });
    this.missingData.push(item);
    logger.warn(`MISSING DATA [${impact.toUpperCase()}] ${category}: ${description}`);
    return item;
  }
  
  /**
   * MAIN WORKFLOW: Process documents in proper construction sequence
   */
  async processConstructionDocuments(
    projectId: string,
    documents: any[],
    options?: {
      batch?: number;
      totalBatches?: number;
      modelId?: string;
      maxChunks?: number;
      /** Pass the merged Claude building_analysis so storey elevations can be
       *  resolved for z-coordinate assignment.  When present, every element's
       *  geometry.location.realLocation.z is set from the real storey datum
       *  rather than defaulting to 0. */
      claudeAnalysis?: any;
      /** Global legend lexicon extracted once by BIMGenerator before batches begin.
       *  When provided, Phase 0 is skipped for this batch and this lexicon is used
       *  instead — ensures every batch uses the same symbol dictionary. */
      globalLegendContext?: string;
      /** Accumulated schedule counts from prior batches (Schedules batch).
       *  CWP adds to these from products found in THIS batch and returns the totals. */
      priorScheduleCounts?: { doors: number; windows: number };
      /** Optional SSE callback (browser-visible). The caller (bim-generator) provides a
       *  batch-windowed version that remaps internal 0-1 progress to the batch's global
       *  range so the browser progress bar never regresses. */
      statusCallback?: (progress: number, message: string) => Promise<void>;
    }
  ): Promise<any> {
    const batchInfo = options ? ` (Batch ${options.batch}/${options.totalBatches})` : '';

    // ── Populate storey elevation map from Claude's analysis ─────────────────
    // This must run before any elements are built so getFloorElevation() works.
    this.storeyElevations.clear();
    const analysisData = options?.claudeAnalysis;
    const storeyArray: any[] =
      analysisData?.storeys ||
      analysisData?.building_analysis?.storeys ||
      analysisData?.floors ||
      analysisData?.building_analysis?.floors ||
      [];
    for (const s of storeyArray) {
      const rawName: string = s?.name || s?.level || '';
      if (!rawName) continue;
      // elevation_m (storey-resolver format) takes priority, then elevation (metres),
      // then elevation_mm / elevation_ft for legacy formats
      // Use canonical unit-normaliser — handles elevation_m (storey schema),
      // elevation_mm (floor schema), bare numbers in any unit, ft/in imperial
      const elevM = normaliseElevation({
        elevation_m:   s.elevation_m,
        elevation_mm:  s.elevation_mm,
        elevation_raw: (s.elevation_m === undefined && s.elevation_mm === undefined)
                       ? (s.elevation ?? s.height_above_datum ?? 0) : undefined,
      });
      if (elevM !== null && Number.isFinite(elevM)) {
        this.storeyElevations.set(rawName.trim().toLowerCase(), elevM);
      }
    }
    // ── Sanity check: detect drawing-coordinate contamination ──────────────
    // If we have 3+ storeys but max elevation < 2m, the values are likely
    // drawing-scale coordinates (e.g. 0.257m) not real floor heights (e.g. 4.65m).
    // In that case, clear the map and try loading from the DB's bimStoreys table.
    if (this.storeyElevations.size >= 3) {
      const maxElev = Math.max(...Array.from(this.storeyElevations.values()));
      if (maxElev < 2.0) {
        logger.warn(
          `⚠️ Storey elevation sanity check FAILED: ${this.storeyElevations.size} storeys but max elevation=${maxElev.toFixed(4)}m — ` +
          `likely drawing-coordinate contamination. Clearing and falling back to DB storeys.`
        );
        this.storeyElevations.clear();
      }
    }

    // ── Fallback: load from bimStoreys table if map is empty ─────────────
    if (this.storeyElevations.size === 0 && projectId) {
      try {
        const models = await storage.getBimModels(projectId);
        const model = models?.[0];
        if (model?.id && typeof (storage as any).getBimStoreys === 'function') {
          const dbStoreys = await (storage as any).getBimStoreys(model.id);
          if (Array.isArray(dbStoreys) && dbStoreys.length > 0) {
            for (const s of dbStoreys) {
              const name = String(s.name || '').trim().toLowerCase();
              const elev = Number(s.elevation ?? 0);
              if (name && Number.isFinite(elev)) {
                this.storeyElevations.set(name, elev);
              }
            }
            logger.info(
              `🏢 Storey elevations loaded from DB: ${Array.from(this.storeyElevations.entries())
                .map(([n, e]) => `${n}=${e}m`).join(', ')}`
            );
          }
        }
      } catch (err: any) {
        logger.warn(`Failed to load DB storeys: ${err?.message}`);
      }
    }

    if (this.storeyElevations.size > 0) {
      logger.info(
        `🏢 Storey elevation map: ${Array.from(this.storeyElevations.entries())
          .map(([n, e]) => `${n}=${e}m`).join(', ')}`
      );
    } else {
      logger.warn('⚠️ No storey elevations available — element z-coordinates will default to 0 and RFIs will be raised');
    }

    // S-08 FIX: Load real project name — never hardcode. Register RFI if null.
    const projectRecord = await storage.getProject(projectId);
    let projectName: string | null = projectRecord?.name ?? null;
    if (!projectName) {
      this.missingData.push(this.trackMissingData(
        'coordination',
        'Project name not found — reports and RFI summaries will omit project identity until resolved.',
        '01',
        'high',
        { assumptionUsed: `PROJECT-${projectId}` }
      ) as any);
      logger.warn(`⚠️ S-08: projectName is null for projectId=${projectId}. RFI registered.`);
      projectName = `PROJECT-${projectId}`;
    }
    logger.info(`ðŸ—ï¸ Starting PROPER construction workflow for ${documents.length} documents${batchInfo}`);
    
    // For first batch, clear state to ensure fresh start
    if (options?.batch === 1) {
      this.clearState();
    }
    
    // Use the modelId passed from the route (which already created the model)
    const modelId = options?.modelId;
    if (!modelId) {
      throw new Error('Model ID is required for construction workflow processing');
    }
    logger.info(`ðŸ¤– Automated processing for BIM model: ${modelId}`);
    
    // Load existing progress if resuming
    await this.loadProgress(modelId);

    // ══ PHASE 0: DEDICATED LEGEND LEXICON EXTRACTION (CODE-3) ════════════════
    // When BIMGenerator has pre-extracted a global legend (options.globalLegendContext),
    // skip per-batch Phase 0 and use the global lexicon directly.
    // Otherwise run per-batch extraction (single-document or test scenarios).
    // ═════════════════════════════════════════════════════════════════════════
    let legendContextBlock: string;
    if (options?.globalLegendContext) {
      // Global legend provided by BIMGenerator — use it directly, skip per-batch extraction
      legendContextBlock = options.globalLegendContext;
      logger.info('PHASE 0 SKIPPED: Using global legend lexicon from BIMGenerator');
    } else {
      logger.info('PHASE 0: Extracting legend lexicon from drawing sheets (per-batch fallback)...');
    const legendLexicon: Record<string, string> = {};
    const legendSheetsFound: string[] = [];
    const docsWithPreviews = documents.filter(d => d.rasterPreviews && d.rasterPreviews.length > 0);

    for (const doc of docsWithPreviews) {
      try {
        const firstPage = doc.rasterPreviews[0];
        const base64 = typeof firstPage === 'string' ? firstPage : (firstPage?.base64 || firstPage?.data || null);
        if (!base64) continue;
        const legendResp = await this.anthropic.messages.create({
          model: 'claude-opus-4-5',
          max_tokens: 1500,
          temperature: 0,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
            { type: 'text', text: 'Extract ONLY the legend/key/symbol definitions visible on this sheet. Return a JSON object where keys are symbol names (e.g. "W1","EW1","GRID LINE") and values are plain-language descriptions. If no legend box is visible, return {}. Return ONLY valid JSON, no preamble.' }
          ]}]
        });
        const rawText = legendResp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
        const cleaned = rawText.replace(/```json[\s\S]*?```|```/g, '').trim();
        if (cleaned.startsWith('{')) {
          const parsed = JSON.parse(cleaned);
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            Object.assign(legendLexicon, parsed);
            legendSheetsFound.push(doc.filename);
          }
        }
      } catch (legendErr) {
        logger.warn(`PHASE 0: legend extraction skipped for ${doc.filename}: ${(legendErr as any)?.message}`);
      }
    }

    if (Object.keys(legendLexicon).length > 0) {
      logger.info(`PHASE 0 COMPLETE: ${Object.keys(legendLexicon).length} symbols from ${legendSheetsFound.length} sheets.`);
      try {
        await storage.updateBimModel(modelId, { geometryData: { legendLexicon, legendSheetsFound, legendExtractedAt: new Date().toISOString() } as any });
      } catch (saveErr) {
        logger.warn('PHASE 0: could not persist legend lexicon: ' + (saveErr as any)?.message);
      }
    } else {
      logger.warn('PHASE 0: No legend symbols found. Extraction will use generic assumptions.');
      this.missingData.push(this.trackMissingData('detail', 'No legend or symbol key found on any drawing sheet.', '01', 'medium', {}) as any);
    }

      legendContextBlock = Object.keys(legendLexicon).length > 0
        ? '\n\nDRAWING LEGEND (extracted from this set — USE THESE):\n' + Object.entries(legendLexicon).map(([k,v]) => `  ${k}: ${v}`).join('\n')
        : '';
    } // end per-batch Phase 0

    // Track schedule counts — seed from prior batches if provided
    const scheduleDoorCount  = { value: options?.priorScheduleCounts?.doors   ?? 0 };
    const scheduleWindowCount = { value: options?.priorScheduleCounts?.windows ?? 0 };

    // STEP 1: Extract PRODUCTS from specifications and schedules
    logger.info("STEP 1: Extracting PRODUCTS from specifications and schedules...");
    const specDocs = documents.filter(d => 
      /specification|spec|assembly|assemblies|legend|note|general|schedule/i.test(d.filename)
    );
    
    // Process specs one at a time with progress saving
    for (let i = 0; i < specDocs.length; i++) {
      const doc = specDocs[i];
      logger.info(`Processing spec document ${i+1}/${specDocs.length}: ${doc.filename}`);
      
      try {
        const products = await this.extractProductsFromSpec(doc, { ...options, projectName, legendContext: legendContextBlock });
        
        logger.info(`   ðŸ” Extracted ${products.length} products from ${doc.filename}`);
        
        // CODE-5: Tally door and window QUANTITIES from schedule documents.
        // Only count if the product carries an explicit numeric quantity — counting
        // product TYPE entries (e.g. "D01 Hollow Metal Door" = 1 entry) vs BIM element
        // INSTANCES is an apples-to-oranges comparison that produces false positives.
        const isScheduleDoc = /schedule/i.test(doc.filename || '');
        if (isScheduleDoc) {
          let doorsAdded = 0;
          let windowsAdded = 0;
          for (const p of products) {
            const isDoor   = /^08\.1/i.test(p.csiCode || '') || /door/i.test(p.name || '') || /^DOOR_/.test(p.id || '');
            const isWindow = /^08\.[35]/i.test(p.csiCode || '') || /window|glazing/i.test(p.name || '') || /^WINDOW_/.test(p.id || '');
            // Only add to count if the product has an explicit quantity field > 0
            const qty = typeof p.properties?.quantity === 'number'
              ? p.properties.quantity
              : typeof p.properties?.qty === 'number'
              ? p.properties.qty
              : 0;
            if (isDoor   && qty > 0) { scheduleDoorCount.value   += qty; doorsAdded   += qty; }
            if (isWindow && qty > 0) { scheduleWindowCount.value += qty; windowsAdded += qty; }
          }
          if (doorsAdded > 0 || windowsAdded > 0) {
            logger.info(`   CODE-5: Schedule quantities — doors: ${scheduleDoorCount.value}, windows: ${scheduleWindowCount.value}`);
          } else {
            logger.info(`   CODE-5: Schedule document "${doc.filename}" has no explicit door/window quantities — skipping count (${products.length} product types found)`);
          }
        }

        // Add to Map
        for (const product of products) {
          this.products.set(product.id, product);
          if (this.products.size <= 5 || this.products.size % 10 === 0) {
            logger.info(`   ðŸ“¦ Product: ${product.csiCode || 'NO_CODE'} - ${product.name || 'NO_DESC'}`);
          }
        }
        
        logger.info(`   âœ… Processed document: ${this.products.size} products collected`);
      } catch (error) {
        logger.error(`   âŒ Failed to process ${doc.filename}:`, error);
        // Continue with next document instead of crashing
      }
    }
    
    logger.info(`âœ… Found ${this.products.size} PRODUCTS from specifications`);
    
    // LOG SAMPLE OF PRODUCTS FOR VERIFICATION
    if (this.products.size > 0) {
      logger.info('ðŸ“¦ Sample of extracted products:');
      let count = 0;
      for (const [_id, product] of Array.from(this.products.entries())) {
        if (count++ < 10) {
          const code = product.csiCode || product.id;
          const desc = product.name || null;
          const unit = product.properties?.unit || 'EA';
          logger.info(`   - ${code}: ${desc} [${unit}]`);
        }
      }
      if (this.products.size > 10) {
        logger.info(`   ... and ${this.products.size - 10} more products`);
      }
    }

    // ── CODE-6: Extract wall assembly definitions from section/detail drawings ──
    // QS Step 3: read section drawings to get per-layer wall build-ups.
    // Only runs when this batch contains section/detail documents AND has
    // raster previews. Non-fatal — if it fails, assemblyCodeMap stays empty.
    let assemblyCodeMap: Record<string, any> = {};
    const sectionDocs = documents.filter((d: any) =>
      /section|detail|assembly|wall.type|wall.sched/i.test(d.filename || '') &&
      d.rasterPreviews && d.rasterPreviews.length > 0
    );
    if (sectionDocs.length > 0) {
      try {
        assemblyCodeMap = await this.extractSectionAssemblies(sectionDocs, legendContextBlock, projectName);
        if (Object.keys(assemblyCodeMap).length > 0) {
          logger.info(`[CODE-6] ${Object.keys(assemblyCodeMap).length} assembly types: ${Object.keys(assemblyCodeMap).join(', ')}`);
        }
      } catch (err) {
        logger.warn(`[CODE-6] Section assembly extraction failed (non-fatal): ${err}`);
      }
    }

    // STEP 2: Create ASSEMBLIES from products
    logger.info("ðŸ”§ STEP 2: Creating ASSEMBLIES from products...");
    const assemblies = await this.createAssembliesFromProducts();
    assemblies.forEach(assembly => this.assemblies.set(assembly.id, assembly));
    
    logger.info(`âœ… Created ${this.assemblies.size} ASSEMBLIES`);
    
    // STEP 3: Extract COORDINATES from drawings first
    logger.info("ðŸ“ STEP 3: Extracting element COORDINATES from drawings...");
    const drawingDocs = documents.filter(d => 
      /floor|plan|elevation|section|detail|stair|wall|mechanical|electrical|assembly|penthouse/i.test(d.filename)
    );
    
    // Extract coordinates from all drawings
    const coordinatesMap = new Map<string, any>();
    for (const doc of drawingDocs) {
      try {
        const coords = await this.extractCoordinatesFromDrawing(doc, legendContextBlock);
        coords.forEach((coord: any) => coordinatesMap.set(coord.id, coord));
        logger.info(`   ðŸ“ Extracted ${coords.length} coordinate sets from ${doc.filename}`);
      } catch (error) {
        logger.error(`Failed to extract coordinates from ${doc.filename}:`, error);
      }
    }
    
    logger.info(`âœ… Extracted ${coordinatesMap.size} total coordinate sets from drawings`);
    
        // ── CODE-4: Grid Discrepancy → Structured RFI ─────────────────────────────
    // When architectural and structural grids diverge, create a typed RFI record
    // in the database so the QS can see it in the RFI dashboard.
    try {
      const { buildNonUniformGridsFromAnalysis: _buildNonUniformGridsFromAnalysis } = await import('./services/grid-extractor');
      const archGrid = options?.claudeAnalysis?.building_analysis?.architectural_grid_system;
      const structGrid = options?.claudeAnalysis?.building_analysis?.structural_grid_system;
      if (archGrid && structGrid && projectId) {
        const archX = (archGrid.x || []).map((a: any) => a.pos ?? a);
        const structX = (structGrid.x || []).map((a: any) => a.pos ?? a);
        const maxDiff = archX.reduce((mx: number, ax: number, i: number) => {
          const sx = structX[i] ?? ax;
          return Math.max(mx, Math.abs(ax - sx));
        }, 0);
        if (maxDiff > 0.05) { // >50mm discrepancy
          logger.warn(`CODE-4: Arch/structural grid discrepancy detected: max offset ${(maxDiff*1000).toFixed(0)}mm — creating RFI`);
          try {
            const { RfiService } = await import('./services/rfi-service');
            await RfiService.createRfi({
              projectId,
              rfiNumber: `AUTO-GRID-${Date.now().toString(36).toUpperCase()}`,
              subject: 'Grid Discrepancy: Architectural vs Structural',
              question: `Architectural grid and structural grid do not align. Maximum detected offset: ${(maxDiff*1000).toFixed(0)} mm. Please confirm which grid governs column placement and revise the other drawing set accordingly.`,
              description: `Auto-generated by EstimatorPro grid analysis. Architectural grid x-positions: [${archX.slice(0,4).map((v: number) => v.toFixed(3)).join(', ')}...]. Structural grid x-positions: [${structX.slice(0,4).map((v: number) => v.toFixed(3)).join(', ')}...].`,
              priority: 'High',
              status: 'Open',
              fromName: 'EstimatorPro',
              fromCompany: 'AI System',
              toName: 'Architect / Structural Engineer',
              reason: 'Grid Coordination',
              submittedBy: null,
              generatedFromConflict: true,
              relatedConflicts: { type: 'GRID_DISCREPANCY', maxOffsetMm: Math.round(maxDiff * 1000) },
            } as any);
            logger.info('CODE-4: Grid discrepancy RFI created in database');
          } catch (rfiErr) {
            logger.warn('CODE-4: Could not persist grid RFI: ' + (rfiErr as any)?.message);
          }
        }
      }
    } catch (gridErr) {
      logger.warn('CODE-4: Grid discrepancy check non-fatal error: ' + (gridErr as any)?.message);
    }

    // STEP 4: Build ELEMENTS by placing assemblies at extracted coordinates
    logger.info("ðŸ—ï¸ STEP 4: Building ELEMENTS by placing assemblies at coordinates...");
    const elements = await this.buildElementsFromAssemblies(
      Array.from(this.assemblies.values()),
      Array.from(coordinatesMap.values())
    );
    
    elements.forEach(element => this.elements.set(element.id, element));
    logger.info(`âœ… Built ${this.elements.size} ELEMENTS from assemblies and coordinates`);
    
    logger.info(`âœ… Built ${this.elements.size} ELEMENTS from all drawings`);
    
    // STEP 5: Save ONLY properly placed elements to database
    logger.info("STEP 5: Saving properly placed elements with real coordinates...");
    await this.saveElementsAsBimElements(modelId);
    
    // Get the saved elements for return
    const savedElements = await storage.getBimElements(modelId)
    
    logger.info(`ðŸŽ‰ SUCCESS! Saved ${savedElements.length} elements using proper construction methodology`);
    
    // UPDATE ELEMENT COUNT: Critical for UI progress display
    if (savedElements.length > 0) {
      try {
        const allElements = await storage.getBimElements(modelId);
        await storage.updateBimModel(modelId, {
          status: 'processing'
        });
        logger.info(`ðŸ“Š Updated model element count: ${allElements.length} total elements`);
      } catch (error) {
        logger.error('Failed to update element count:', error);
      }
    }
    

    // ── CODE-5: Schedule vs Plan Count Reconciliation ──────────────────────────
    // Compare door/window counts extracted from elements vs schedule totals.
    // >10% variance → RFI + elements flagged as UNVERIFIED_COUNT.
    if (scheduleDoorCount.value > 0 || scheduleWindowCount.value > 0) {
      const elemDoors   = savedElements.filter((e: any) => /door/i.test(e.elementType || e.type || '')).length;
      const elemWindows = savedElements.filter((e: any) => /window|glazing/i.test(e.elementType || e.type || '')).length;
      const doorVariance   = scheduleDoorCount.value   > 0 ? Math.abs(elemDoors   - scheduleDoorCount.value)   / scheduleDoorCount.value   : 0;
      const windowVariance = scheduleWindowCount.value > 0 ? Math.abs(elemWindows - scheduleWindowCount.value) / scheduleWindowCount.value : 0;
      const THRESHOLD = 0.10;

      if (doorVariance > THRESHOLD && projectId) {
        logger.warn(`CODE-5: Door count mismatch — ${elemDoors} elements vs ${scheduleDoorCount.value} in schedule (${(doorVariance*100).toFixed(1)}%)`);
        try {
          await storage.createRfi({
            projectId,
            rfiNumber: `AUTO-DR-${Date.now().toString(36).toUpperCase()}`,
            subject: 'Door Count Discrepancy: Floor Plan vs Door Schedule',
            question: `Floor plan extraction yielded ${elemDoors} doors. Door schedule shows ${scheduleDoorCount.value} units. Variance: ${(doorVariance*100).toFixed(1)}%. Please reconcile and confirm total door count before QTO is finalized.`,
            description: 'Auto-generated by EstimatorPro CODE-5 schedule reconciliation pass.',
            priority: 'High',
            status: 'Open',
            fromName: 'EstimatorPro',
            fromCompany: 'AI System',
            toName: 'Architect',
            submittedBy: null,
          } as any);
          logger.info('CODE-5: Door count RFI persisted to database');
        } catch (rfiErr) {
          logger.warn('CODE-5: Could not persist door RFI: ' + (rfiErr as any)?.message);
        }
      }

      if (windowVariance > THRESHOLD && projectId) {
        logger.warn(`CODE-5: Window count mismatch — ${elemWindows} elements vs ${scheduleWindowCount.value} in schedule (${(windowVariance*100).toFixed(1)}%)`);
        try {
          await storage.createRfi({
            projectId,
            rfiNumber: `AUTO-WD-${Date.now().toString(36).toUpperCase()}`,
            subject: 'Window Count Discrepancy: Floor Plan vs Window Schedule',
            question: `Floor plan extraction yielded ${elemWindows} windows. Window schedule shows ${scheduleWindowCount.value} units. Variance: ${(windowVariance*100).toFixed(1)}%. Please reconcile before cladding and glazing QTO is finalized.`,
            description: 'Auto-generated by EstimatorPro CODE-5 schedule reconciliation pass.',
            priority: 'High',
            status: 'Open',
            fromName: 'EstimatorPro',
            fromCompany: 'AI System',
            toName: 'Architect',
            submittedBy: null,
          } as any);
          logger.info('CODE-5: Window count RFI persisted to database');
        } catch (rfiErr) {
          logger.warn('CODE-5: Could not persist window RFI: ' + (rfiErr as any)?.message);
        }
      }
    }

        // STEP 6: AUTO-GENERATE ESTIMATE from saved BIM elements
    logger.info("STEP 6: Auto-generating CIQS estimate from BIM elements...");
    let estimateResult: any = null;
    let budgetResult: any = null;
    if (savedElements.length > 0) {
      try {
        estimateResult = await buildEstimateForModel(modelId, {
          scheduleDocCounts: {
            doors:   scheduleDoorCount.value,
            windows: scheduleWindowCount.value,
          },
        });
        const totalFormatted = estimateResult.grandTotal.toLocaleString("en-CA", { style: "currency", currency: "CAD" });
        logger.info(`   Estimate generated: ${totalFormatted}`);
        logger.info(`   ${estimateResult.lineItemCount} line items across ${estimateResult.floors.length} floors`);
        
        budgetResult = buildBudgetStructure(estimateResult, {
          projectName: projectName,
          region: projectRecord?.location || `[LOCATION — RFI REQUIRED: project "${projectId}" location not set]`,
        });
        logger.info(`   AACE Class: ${budgetResult.aaceClass.estimateClass} (${budgetResult.aaceClass.className})`);
        const budgetFormatted = budgetResult.GRAND_TOTAL.toLocaleString("en-CA", { style: "currency", currency: "CAD" });
        logger.info(`   Budget total: ${budgetFormatted}`);
        logger.info("   8-tier structure: direct > preliminaries > contingency > escalation > overhead > permits > taxes > grand total");
      } catch (estimateError) {
        logger.error("Auto-estimate generation failed (non-fatal):", estimateError);
        logger.info("   Elements saved successfully. Estimate available via /api/estimates/:modelId/full");
      }
    } else {
      logger.warn("No elements saved. Skipping auto-estimate generation.");
    }
    
    // STEP 7: AUTO-GENERATE RFIs from missing data discovered during analysis
    logger.info("STEP 7: Generating RFIs from missing data discovered during processing...");
    let rfiSummary: RFISummary | null = null;
    if (this.missingData.length > 0) {
      try {
        const rfis = generateAllRFIs(
          this.missingData,
          projectName,
          "EstimatorPro CWP"
        );
        rfiSummary = generateRFISummary(this.missingData, rfis, projectName);
        logger.info(`   Generated ${rfis.length} RFIs from ${this.missingData.length} missing data items`);
        logger.info(`   Cost uncertainty: $${rfiSummary.totalCostUncertaintyLow.toLocaleString()} to $${rfiSummary.totalCostUncertaintyHigh.toLocaleString()}`);
        if (rfiSummary.criticalItems.length > 0) {
          logger.warn(`   ${rfiSummary.criticalItems.length} CRITICAL items require immediate attention`);
        }
        // Log the formatted report for console visibility
        logger.info(formatRFIReport(rfiSummary));
      } catch (rfiError) {
        logger.error("RFI generation failed (non-fatal):", rfiError);
      }
    } else {
      logger.info("   No missing data detected - no RFIs needed (all data complete)");
    }
    
    const result = {
      products: Array.from(this.products.values()),
      assemblies: Array.from(this.assemblies.values()),
      elements: savedElements,
      scheduleCounts: {
        doors:   scheduleDoorCount.value,
        windows: scheduleWindowCount.value,
      },
      // CODE-6: Assembly definitions from section drawings (may be empty for non-section batches)
      assemblyCodeMap,
      // STEP-4: dominant construction type detected from this batch's products
      constructionType: (() => {
        // Infer from product names / CSI codes in this batch
        const allNames = Array.from(this.products.values()).map((p: any) =>
          `${p.name || ''} ${p.csiCode || ''} ${p.properties?.material || ''}`.toLowerCase()
        ).join(' ');
        if (/precast|tilt.up/.test(allNames))          return 'precast-concrete';
        if (/structural steel|steel frame|steel joist/.test(allNames)) return 'steel-frame';
        if (/glulam|clt|mass timber|heavy timber/.test(allNames))      return 'heavy-timber';
        if (/wood frame|stud|platform frame|2x/.test(allNames))        return 'wood-frame';
        if (/masonry|cmu|brick/.test(allNames))                        return 'masonry-bearing';
        if (/concrete|rebar|formwork|slab|column/.test(allNames))      return 'cip-concrete';
        return null; // unknown — BIMGenerator will accumulate across batches
      })(),
      estimate: estimateResult ? {
        totalCost: estimateResult.grandTotal,
        lineItems: estimateResult.lineItemCount,
        floors: estimateResult.floors.length,
        aaceClass: budgetResult?.aaceClass?.estimateClass ?? 0,
        currency: 'CAD',
        methodology: 'CIQS',
      } : null,
      budget: budgetResult ? {
        grandTotal: budgetResult.GRAND_TOTAL,
        directCost: budgetResult.directCost.subtotal,
        contingency: budgetResult.contingency?.totalContingency || 0,
        taxes: budgetResult.taxes?.subtotal || 0,
      } : null,
      rfiSummary: rfiSummary ? {
        totalMissingItems: rfiSummary.totalMissingItems,
        totalRFIs: rfiSummary.totalRFIs,
        criticalItems: rfiSummary.criticalItems.length,
        costUncertaintyLow: rfiSummary.totalCostUncertaintyLow,
        costUncertaintyHigh: rfiSummary.totalCostUncertaintyHigh,
        rfisByPriority: rfiSummary.rfisByPriority,
        rfis: rfiSummary.rfis,
        missingData: rfiSummary.missingData,
      } : null,
      summary: {
        productsFound: this.products.size,
        assembliesCreated: this.assemblies.size,
        elementsSaved: savedElements.length,
        estimateGenerated: !!estimateResult,
        missingDataItems: this.missingData.length,
        rfisGenerated: rfiSummary?.totalRFIs || 0,
        methodology: 'specs>products>assemblies>elements>estimate>budget>rfis'
      }
    };
    
    // CRITICAL LOG: Confirm what we're returning to BIM Generator
    logger.info('ðŸš€ WORKFLOW COMPLETE - Returning to BIM Generator:');
    logger.info(`   ðŸ“¦ ${result.products.length} products with CSI codes`);
    logger.info(`   ðŸ”§ ${result.assemblies.length} assemblies built from products`);
    logger.info(`   ðŸ—ï¸ ${result.elements.length} elements with product-based codes`);
    
    return result;
  }
  
  /**
  // ─────────────────────────────────────────────────────────────────────────
  // CODE-6: Extract wall assembly definitions from section/detail drawings
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * CODE-6 — QS Step 3: Read section and detail drawings to extract wall
   * assembly type codes and their layer build-up.
   *
   * A professional QS always reads wall sections before pricing — the assembly
   * type code (e.g. EW1, IW3D) tells you the layer build-up: substrate,
   * insulation, air barrier, cladding, finish, fire rating, etc. This data
   * is stored in model.geometryData.assemblyCodeMap so estimate-engine can
   * generate per-layer line items instead of generic wall items.
   *
   * Claude is asked to return a JSON object keyed by assembly code, each value
   * being { description, fireRating, totalThicknessMm, constructionType, layers[] }.
   * Only CSI-codeable layers are included.
   */
  async extractSectionAssemblies(
    sectionDocs: any[],
    legendContext: string,
    projectName: string
  ): Promise<Record<string, any>> {
    if (sectionDocs.length === 0) return {};

    // Select docs with raster previews (visual section drawings)
    const visualDocs = sectionDocs.filter(d => d.rasterPreviews && d.rasterPreviews.length > 0);
    if (visualDocs.length === 0) return {};

    logger.info(`[CODE-6] Extracting wall assemblies from ${visualDocs.length} section/detail drawings`);

    const assemblyMap: Record<string, any> = {};

    for (const doc of visualDocs.slice(0, 6)) { // cap at 6 section docs per batch
      try {
        const preview = doc.rasterPreviews[0];
        if (!preview?.base64) continue;

        const prompt = `You are an expert quantity surveyor (MCIQS) reading a section or detail drawing.

Project: ${projectName}
Legend context: ${legendContext || 'None provided'}

Identify ALL wall/floor/roof assembly type codes visible in this drawing.
For each assembly code (e.g. EW1, IW3D, W-2HR, FLR-1, RF-1), extract:
- code: the assembly type code label
- description: full plain-language description
- fireRating: fire resistance rating if shown (e.g. "2-hour", "1-hour", "none")
- totalThicknessMm: overall assembly thickness in mm
- constructionType: one of "cip-concrete", "precast-concrete", "steel-frame", "wood-frame", "heavy-timber", "masonry-bearing", "mixed"
- layers: array of layers FROM OUTSIDE TO INSIDE, each with:
  - csiCode: the most appropriate rate code from this list ONLY:
      Div 03 concrete: 033000-CONC, 033000-FORM, 033000-REBAR, 034000-PRECAST
      Div 04 masonry: 042000-CMU, 042000-BRICK, 044000-STONE
      Div 05 metals: 054000-CFS-FRAME, 054000-CLAD, 055000-MISC-MTL
      Div 06 wood: 061000-FRAMING, 061700-STRUCT-PANEL
      Div 07 envelope: 071000-WATERPROOF, 072000-INSULATION, 072500-AIR-BARRIER, 074000-METAL-PANEL, 079000-SEALANTS
      Div 09 finishes: 092500-DRYWALL, 093000-TILE, 099000-PAINT
  - description: e.g. "75mm mineral wool batt insulation"
  - thicknessMm: thickness of THIS layer in mm
  - unit: "area" for sheet/batt materials, "volume" for solid layers, "length" for trim
  - quantityMultiplier: 1.0 normally, 2.0 for both sides of a wall

Return ONLY valid JSON, no preamble:
{
  "assemblies": [
    {
      "code": "EW1",
      "description": "Exterior Wall Type 1",
      "fireRating": "2-hour",
      "totalThicknessMm": 350,
      "constructionType": "cip-concrete",
      "layers": [
        { "csiCode": "074000-METAL-PANEL", "description": "Aluminum composite cladding", "thicknessMm": 4, "unit": "area", "quantityMultiplier": 1 },
        { "csiCode": "072000-INSULATION", "description": "75mm rigid mineral wool insulation", "thicknessMm": 75, "unit": "area", "quantityMultiplier": 1 },
        { "csiCode": "072500-AIR-BARRIER", "description": "Self-adhered membrane air barrier", "thicknessMm": 2, "unit": "area", "quantityMultiplier": 1 },
        { "csiCode": "033000-CONC", "description": "200mm CIP concrete wall", "thicknessMm": 200, "unit": "volume", "quantityMultiplier": 1 },
        { "csiCode": "092500-DRYWALL", "description": "2-layer 16mm Type X drywall (fire rating)", "thicknessMm": 32, "unit": "area", "quantityMultiplier": 1 }
      ]
    }
  ]
}

If no assembly codes are visible, return { "assemblies": [] }.
Return ONLY valid JSON.`;

        const response = await this.anthropic.messages.create({
          model: 'claude-opus-4-5',
          max_tokens: 2000,
          temperature: 0,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: preview.contentType || 'image/png', data: preview.base64 } },
              { type: 'text', text: prompt },
            ],
          }],
        });

        const raw = (response.content.find((b: any) => b.type === 'text') as any)?.text || '';
        const parsed = parseFirstJsonObject(raw);
        if (!parsed || parsed.error) continue;
        const assemblies: any[] = parsed.assemblies || [];

        for (const asm of assemblies) {
          if (!asm.code || !Array.isArray(asm.layers) || asm.layers.length === 0) continue;
          const key = String(asm.code).toUpperCase();
          if (!assemblyMap[key]) {
            assemblyMap[key] = {
              code: key,
              description: asm.description || key,
              fireRating: asm.fireRating,
              totalThicknessMm: asm.totalThicknessMm,
              constructionType: asm.constructionType,
              layers: asm.layers.filter((l: any) => l.csiCode && l.description),
            };
            logger.info(`[CODE-6] Assembly extracted: ${key} — ${asm.layers.length} layers (${asm.description})`);
          }
        }
      } catch (err) {
        logger.warn(`[CODE-6] Assembly extraction failed for ${doc.filename}: ${err}`);
      }
    }

    logger.info(`[CODE-6] Total assemblies extracted: ${Object.keys(assemblyMap).length}`);
    return assemblyMap;
  }

  /**
   * Extract PRODUCTS from specification documents
   */
  private async extractProductsFromSpec(doc: any, options?: { batch?: number, totalBatches?: number, modelId?: string, maxChunks?: number, startChunk?: number, projectName?: string, legendContext?: string, statusCallback?: (progress: number, message: string) => Promise<void> }): Promise<Product[]> {
    // Check if this is a schedule document that needs visual analysis
    const isSchedule = doc.filename?.includes('SCHEDULE');
    if (isSchedule && doc.rasterPreviews && doc.rasterPreviews.length > 0) {
      return await this.extractProductsFromVisualSchedule(doc, options);
    }
    // Get FULL document text - CRITICAL FIX: Use textContent field from database
    const fullDocText = doc.textContent || doc.text || doc.content || '';
    
    if (!fullDocText || fullDocText.length === 0) {
      logger.warn(`âš ï¸ Document ${doc.filename} has no text content - Claude won't find products!`);
      logger.warn(`   Available fields: ${Object.keys(doc).join(', ')}`);
    } else {
      logger.info(`âœ… Document ${doc.filename} has ${fullDocText.length} characters of text content`);
    }
    
    // BREAK LARGE SPECS INTO SMALLER CHUNKS TO PREVENT TIMEOUTS
    const MAX_CHUNK_SIZE = 20000; // Optimized chunk size to reduce API calls while avoiding timeouts
    const OPTIMAL_CHUNK_SIZE = Math.min(MAX_CHUNK_SIZE, Math.max(5000, Math.floor(fullDocText.length / 8))); // Fewer, larger chunks for efficiency (target ~8 chunks)
    const chunks: string[] = [];
    
    if (fullDocText.length <= OPTIMAL_CHUNK_SIZE) {
      chunks.push(fullDocText);
    } else {
      // Split at logical boundaries (sections, divisions)
      const sections = fullDocText.split(/\n(?=\d+\.\d+|SECTION|DIVISION|PART)/);
      let currentChunk = '';
      
      for (const section of sections) {
        if ((currentChunk + section).length > OPTIMAL_CHUNK_SIZE && currentChunk) {
          chunks.push(currentChunk);
          currentChunk = section;
        } else {
          currentChunk += '\n' + section;
        }
      }
      if (currentChunk) chunks.push(currentChunk);
    }
    
    logger.info(`ðŸ“„ Processing ${doc.filename}: ${fullDocText.length} chars in ${chunks.length} chunks`);
    
    const allProducts: Product[] = [];
    let productCounter = this.products.size + 1;

    // Load per-chunk product cache so a restart can skip already-processed chunks
    const chunkCache: Record<number, any[]> = (doc.analysisResult as any)?.chunkProductsCache ?? {};
    if (Object.keys(chunkCache).length > 0) {
      logger.info(`   📦 Chunk cache loaded for ${doc.filename}: ${Object.keys(chunkCache).length} chunks already processed`);
    }

    // Process ALL chunks but with breaks between them, support resuming from specific chunk
    const startChunk = options?.startChunk || 1; // 1-based for user clarity
    const startIndex = Math.max(0, startChunk - 1); // Convert to 0-based for array
    const maxChunksPerRun = options?.maxChunks || chunks.length; // Process all chunks
    const chunksToProcess = Math.min(chunks.length, maxChunksPerRun);
    
    if (startIndex > 0) {
      logger.info(`   â© RESUMING from chunk ${startChunk} (skipping first ${startIndex} chunks)`);
    }
    if (chunksToProcess < chunks.length) {
      logger.info(`   âš ï¸ Processing chunks ${startChunk} to ${chunksToProcess} of ${chunks.length} chunks (timeout prevention)`);
    }
    
    // Process chunks with limit, starting from specified index
    for (let i = startIndex; i < chunksToProcess; i++) {
      const docText = chunks[i];
      logger.info(`   Processing chunk ${i+1}/${chunks.length} (${docText.length} chars)`);
      
      // Report accurate progress AND SAVE TO DATABASE!
      if (options?.modelId) {
        const overallProgress = this.calculateOverallProgress(i + 1, chunks.length, options.batch || 1, options.totalBatches || 1);
        
        // CRITICAL: Save progress to database so the endpoint can read it!
        try {
          await storage.updateBimModel(options.modelId, {
            geometryData: {
              processingState: {
                status: 'processing',
                batchIndex: options.batch || 1,
                totalBatches: options.totalBatches || 1, 
                currentChunk: i + 1,
                totalChunks: chunks.length,
                progress: overallProgress,
                lastSavedAt: new Date().toISOString()
              }
            }
          });
          logger.info(`ðŸ’¾ Progress saved to DB: ${overallProgress}% (Batch ${options.batch}/${options.totalBatches}, Chunk ${i+1}/${chunks.length})`);
        } catch (error) {
          logger.error('âš ï¸ Failed to save progress to DB:', error);
        }
        
        publishProgress(options.modelId, {
          progress: overallProgress,
          phase: "processing",
          message: `Batch ${options.batch || 1}/${options.totalBatches || 1}: Analyzing chunk ${i+1}/${chunks.length}`,
          details: {
            currentChunk: i + 1,
            totalChunks: chunks.length,
            productsFound: this.products.size,
            currentBatch: options.batch || 1,
            totalBatches: options.totalBatches || 1
          }
        });
        // Also fire the SSE callback (browser-visible) if provided by the caller.
        // The caller (bim-generator batch loop) remaps overallProgress (0-100) to the
        // batch's global window so the browser progress bar never goes backwards.
        if (options.statusCallback) {
          const msg = `Batch ${options.batch || 1}/${options.totalBatches || 1}: Analyzing chunk ${i+1}/${chunks.length}`;
          await options.statusCallback(overallProgress / 100, msg).catch(() => {});
        }
      }
      
      // Add delay between EACH chunk to avoid overwhelming Claude
      if (i > 0) {
        logger.info(`   â¸ï¸ Brief pause before next chunk...`);
        // S-17 FIX: SDK handles backoff automatically. Removed blanket 500ms sleep per chunk.
      }
      
      const prompt = `You are a construction estimator analyzing specifications for ${options?.projectName || 'this project'}.
This is chunk ${i+1} of ${chunks.length} from the document.

${doc.filename?.includes('SCHEDULE') ? `
IMPORTANT: This is a DOOR/WINDOW SCHEDULE containing tables listing EVERY individual door and window in the building.
Extract EACH door and window from the schedule table as a separate product.
Naming convention by floor (applies to ALL elements):
DOORS:
- Basement: DB01, DB02, DB03... 
- Floor 1/Ground: D101, D102, D103... (100 series)
- Floor 2: D201, D202, D203... (200 series)  
- Floor 3: D301, D302, D303... (300 series)
- Floor 4: D401, D402... (400 series)
- Mechanical Floors: DM01, DM02, DM03... or D501, D502...
- Penthouse: DP01, DP02... or D501, D502... (500 series)

WINDOWS:
- Basement: WB01, WB02, WB03...
- Floor 1/Ground: W101, W102, W103... (100 series)
- Floor 2: W201, W202, W203... (200 series)
- Floor 3: W301, W302, W303... (300 series)  
- Mechanical: WM01, WM02, WM03...

M&E EQUIPMENT:
- Mechanical Equipment: ME101, ME201, ME301... (by floor)
- Electrical Panels: EP101, EP201, EP301... (by floor)
- HVAC Units: HVAC101, HVAC201, HVAC301... (by floor)
- Fire/Life Safety: FS101, FS201, FS301... (by floor)
Each row in the schedule table represents ONE door or window that must be extracted.
CRITICAL: Extract EVERY door/window mark shown in the schedule - we need to cross-reference with floor plans.
` : ''}

${doc.filename?.includes('FLOOR') || doc.filename?.includes('PLAN') ? `
CRITICAL: This is a FLOOR PLAN - extract COMPLETE SPATIAL CONTEXT for ALL elements:

ROOM INFORMATION:
- Room numbers (101, 102, 201, 202, etc.)
- Room names (Living Room, Kitchen, Bedroom 1, etc.)
- Room coordinates (center point X,Y from grid lines)
- Room dimensions (length x width in meters)

WALL INFORMATION:
- Wall type (W1, W2, W3 from legend - exterior, interior, fire-rated, etc.)
- Wall start point coordinates (X1,Y1 from grid lines)
- Wall end point coordinates (X2,Y2 from grid lines)
- Wall thickness (150mm, 200mm, etc.)
- Wall height (floor-to-floor or floor-to-ceiling)

M&E EQUIPMENT LOCATION:
- Equipment mark (ME101, EP201, HVAC301, etc.)
- Equipment type (AHU, Panel, VAV Box, etc.)
- Grid location (B-3, C-5, etc.)
- Room location (which room it's in)
- Elevation/height (mounted at 2.4m, ceiling level, etc.)
- Coordinates (X,Y position from grid lines)

DOORS & WINDOWS:
- Mark (D101, W201, etc.)
- Room connection (from Room 101 to Corridor)
- Wall location (which wall segment)
- Distance from grid line (2.5m from Grid A, etc.)

GRID REFERENCE:
- Grid lines visible (A, B, C... and 1, 2, 3...)
- Grid spacing (typical 8m, 6m, etc.)
- Building origin point (Grid A-1 corner)
` : ''}

Extract ALL PRODUCTS (materials, components, systems) from this section. Look for:
- Door marks (D101, D201, D301... by floor)
- Window marks (W101, W201, W301... by floor)  
- M&E equipment marks (ME101, EP201, HVAC301... by floor)
- Electrical panels, mechanical equipment, HVAC units
- Fire/life safety equipment (sprinklers, alarms, exits)
- CSI division codes (e.g., 04 21 00 Clay Unit Masonry)
- Manufacturer names and model numbers
- Material properties and specifications
- Product descriptions
- SPATIAL LOCATION DATA (floor, room, grid position)

Return JSON format:
{
  "products": [
    {
      "id": "DOOR_D201" for a floor 2 door, "WINDOW_W301" for floor 3 window (door/window number indicates floor: 100=Floor1, 200=Floor2, 300=Floor3),
      "name": "Door D201" or "Window W301" based on actual mark number,
      "csiCode": "08.11.00" for doors, "08.51.00" for windows, or appropriate CSI code,
      "specification": "3'-0" x 7'-0" Single Swing Door" or "4'-0" x 5'-0" Fixed Window" or material spec,
      "manufacturer": "Manufacturer name if available",
      "model": "Model number if available",
      "properties": {
        "mark": "D101" or "W101" or "ME201" for element marks,
        "elementType": "Door" or "Window" or "Wall" or "AHU" or "Panel",
        "location": "Exterior" or "Interior" (CRITICAL: identify if element is exterior or interior),
        "exposure": "North" or "South" or "East" or "West" or "Internal" (for exterior elements),
        "size": "3'-0" x 7'-0"" for doors/windows,
        "type": "Single Swing" or "Fixed" or "Interior Wall Type W2",
        "material": "Wood" or "Aluminum" or "Steel" or "Masonry",
        "floor": "Ground Floor" or "Floor 1" or "Floor 2" or "Floor 3",
        "roomNumber": "101" or "201" or "301" (just the number),
        "roomName": "Living Room" or "Kitchen" or "Bedroom 1",
        "roomFrom": "Room 101" (for doors - which room it connects from),
        "roomTo": "Corridor" (for doors - which room it connects to),
        "gridLocation": "B-3" or "C-5" (grid intersection),
        "gridX": "B" (grid column),
        "gridY": "3" (grid row),
        "distanceFromGridX": 2.5 (meters from grid line),
        "distanceFromGridY": 4.0 (meters from grid line),
        "xCoordinate": 12.5 (absolute X in meters from origin A-1),
        "yCoordinate": 18.0 (absolute Y in meters from origin A-1),
        "zCoordinate": 3.5 (elevation in meters),
        "wallType": "W1" or "W2" or "W3" (from wall legend),
        "wallThickness": 200 (in mm),
        "wallHeight": 3200 (in mm),
        "wallStartX": 10.0 (for walls - start point X),
        "wallStartY": 15.0 (for walls - start point Y),
        "wallEndX": 18.0 (for walls - end point X),
        "wallEndY": 15.0 (for walls - end point Y),
        "equipmentType": "Air Handling Unit" or "Electrical Panel",
        "mountingHeight": 2.4 (meters above floor),
        "orientation": "North" or "South" or "East" or "West"
      }
    }
  ]
}

SPECIFICATION TEXT:
${docText}

Extract EVERY product mentioned, even if details are incomplete.`;

      // Cache hit: reuse previously extracted products for this chunk, skip Claude
      if (chunkCache[i]) {
        const cached = chunkCache[i] as Product[];
        productCounter += cached.length;
        allProducts.push(...cached);
        logger.info(`   ✅ Cache hit: chunk ${i+1}/${chunks.length} — ${cached.length} products (no Claude call)`);
        if (options?.statusCallback && options?.modelId) {
          const pct = this.calculateOverallProgress(i + 1, chunks.length, options.batch || 1, options.totalBatches || 1);
          await options.statusCallback(pct / 100, `Batch ${options.batch || 1}/${options.totalBatches || 1}: Chunk ${i+1}/${chunks.length} (cached)`).catch(() => {});
        }
        continue;
      }

      try {
        const response = await this.anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8192, // INCREASED for complete responses
          temperature: 0,
          messages: [{ role: "user", content: prompt }]
        });

        const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
        const result = this.parseJSONResponse(responseText);

        if (result?.products) {
          // Add truly unique product IDs for each chunk to prevent duplicates
          const timestamp = Date.now();
          const chunkProducts = result.products.map((p: any, idx: number) => {
            // For doors/windows with floor info, ensure floor is in the ID
            let uniqueId = p.id;
            
            if (!uniqueId) {
              uniqueId = `PROD_${timestamp}_${String(productCounter + idx).padStart(3, '0')}`;
            } else if (p.properties?.floor && !uniqueId.includes(p.properties.floor.toUpperCase().replace(/\s+/g, ''))) {
              // Add floor to ID if not already included
              const floorPart = p.properties.floor.toUpperCase().replace(/\s+/g, '').replace('FLOOR', 'F');
              uniqueId = `${uniqueId}_${floorPart}`;
            }
            
            return {
              ...p,
              id: uniqueId
            };
          });
          productCounter += chunkProducts.length;
          allProducts.push(...chunkProducts);

          // Persist this chunk's products so a restart can skip this Claude call next time
          try {
            const freshDoc = await storage.getDocument(doc.id);
            const existingResult = (freshDoc?.analysisResult as any) ?? {};
            const updatedCache = { ...(existingResult.chunkProductsCache ?? {}), [i]: chunkProducts };
            await storage.updateDocument(doc.id, { analysisResult: { ...existingResult, chunkProductsCache: updatedCache } });
            logger.info(`   💾 Chunk ${i+1} cached (${chunkProducts.length} products) — will skip Claude on retry`);
          } catch (cacheErr: any) {
            logger.warn(`   ⚠️ Non-fatal: chunk cache write failed — ${cacheErr.message}`);
          }

          logger.info(`   Found ${chunkProducts.length} products in chunk ${i+1}`);
          
          // LOG FIRST FEW PRODUCTS FROM THIS CHUNK
          if (chunkProducts.length > 0) {
            logger.info(`   ðŸ“¦ First products from chunk:`);
            chunkProducts.slice(0, 3).forEach((p: any) => {
              logger.info(`      - ${p.csiCode || 'NO_CODE'}: ${p.name || p.description || 'NO_NAME'}`);
            });
          }
          
          // NOTE: Products are NOT saved to bimElements here.
          // They are intermediate data used to build assemblies → elements.
          // Only fully-placed elements (with real coordinates) are written
          // to bimElements in saveElementsAsBimElements via upsertBimElements.
          // Writing Products early caused spurious elementType='Product' rows
          // that were overwritten on every generation and wasted DB writes.
        }
      } catch (error) {
        logger.error(`Failed to process chunk ${i+1}:`, error);
      }
    }
    
    logger.info(`âœ… Total products extracted from ${doc.filename}: ${allProducts.length}`);
    return allProducts;
  }
  
  /**
   * Create REAL construction ASSEMBLIES from discovered products
   */
  private async createAssembliesFromProducts(): Promise<Assembly[]> {
    const productsArray = Array.from(this.products.values());
    
    // Group products by CSI division for better assembly creation
    const productsByDivision = new Map<string, Product[]>();
    productsArray.forEach(product => {
      const division = product.csiCode ? product.csiCode.substring(0, 2) : '00';
      if (!productsByDivision.has(division)) {
        productsByDivision.set(division, []);
      }
      productsByDivision.get(division)!.push(product);
    });
    
    const productsList = productsArray.map(p => `${p.id}: ${p.name} (${p.csiCode || 'NO_CODE'})`).join('\n');
    
    const prompt = `You are a construction estimator creating REAL CONSTRUCTION ASSEMBLIES from building products.

Available PRODUCTS (${productsArray.length} total):
${productsList}

CREATE COMPREHENSIVE CONSTRUCTION ASSEMBLIES by combining related products. Each assembly represents how products come together to form a building element.

RULES:
1. Each assembly must have a unique itemCode like "04.20.EW1" (division.section.type#)
2. Assemblies combine multiple products into constructable units
3. Include ALL necessary products for each assembly type
4. Be specific about construction methods and sequences

EXAMPLES OF PROPER ASSEMBLIES:
- Exterior Wall Type 1: brick veneer + air barrier + insulation + vapor barrier + metal studs + gypsum board
- Interior Partition Type A: gypsum board + metal studs + insulation + gypsum board
- Concrete Column Type C1: rebar + concrete + formwork
- Steel Beam Type B1: steel beam + fireproofing + primer + paint

Return JSON format:
{
  "assemblies": [
    {
      "id": "ASM_04_20_EW1",
      "name": "Exterior Wall Type 1 - Brick Veneer",
      "type": "wall",
      "itemCode": "04.20.EW1",
      "products": ["PROD_001", "PROD_002", "PROD_003", "PROD_004", "PROD_005"],
      "constructionMethod": "Install metal studs @ 16" o.c., apply vapor barrier, install R-20 batt insulation, attach 5/8" gypsum board interior, apply air barrier exterior, install brick ties, lay brick veneer with 1" air gap",
      "properties": {
        "thickness": "12 inches",
        "rValue": "R-20",
        "fireRating": "2-hour",
        "stc": "55",
        "structuralType": "non-bearing"
      }
    }
  ]
}

Create COMPREHENSIVE assemblies for:
1. Exterior walls (multiple types if specs indicate)
2. Interior walls/partitions 
3. Structural elements (columns, beams)
4. Floor/ceiling assemblies
5. Roofing assemblies
6. Any special assemblies mentioned in the products

Use actual product IDs from the list above. Create realistic assemblies based on the available products.`;

    try {
      const response = await this.anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        temperature: 0,
        messages: [{ role: "user", content: prompt }]
      });

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
      const result = this.parseJSONResponse(responseText);

      // Expand assemblies with actual product objects and validate
      const assemblies = result?.assemblies || [];
      const validAssemblies = assemblies.map((assembly: any) => {
        const expandedAssembly = {
          ...assembly,
          id: assembly.id || `ASM_${crypto.randomUUID()}`,
          itemCode: assembly.itemCode || assembly.id?.replace('ASM_', ''),
          products: assembly.products?.map((productId: string) => this.products.get(productId)).filter(Boolean) || []
        };
        
        // Log assembly creation for verification
        logger.info(`   ðŸ”§ Created assembly: ${expandedAssembly.itemCode} - ${expandedAssembly.name} with ${expandedAssembly.products.length} products`);
        
        return expandedAssembly;
      }).filter((a: Assembly) => a.products.length > 0); // Only keep assemblies with actual products
      
      logger.info(`âœ… Created ${validAssemblies.length} valid assemblies from ${productsArray.length} products`);
      return validAssemblies;
    } catch (error) {
      logger.error("Failed to create assemblies:", error);
      // Create basic assemblies as fallback
      return this.createBasicAssembliesFromProducts(productsArray);
    }
  }
  
  /**
   * Fallback: Create basic assemblies if AI fails
   */
  private createBasicAssembliesFromProducts(products: Product[]): Assembly[] {
    const assemblies: Assembly[] = [];
    
    // Group products by type/division to create basic assemblies
    const wallProducts = products.filter(p => p.name?.toLowerCase().includes('wall') || p.csiCode?.startsWith('04') || p.csiCode?.startsWith('09'));
    const columnProducts = products.filter(p => p.name?.toLowerCase().includes('column') || p.csiCode?.startsWith('03'));
    const _beamProducts = products.filter(p => p.name?.toLowerCase().includes('beam') || p.csiCode?.startsWith('05'));
    
    if (wallProducts.length > 0) {
      assemblies.push({
        id: 'ASM_WALL_BASIC',
        name: 'Basic Wall Assembly',
        type: 'wall',
        products: wallProducts.slice(0, 5), // Take up to 5 wall-related products
        constructionMethod: 'Standard wall construction',
        properties: { itemCode: '04.20.W1' }
      });
    }
    
    if (columnProducts.length > 0) {
      assemblies.push({
        id: 'ASM_COLUMN_BASIC',
        name: 'Basic Column Assembly',
        type: 'column',
        products: columnProducts.slice(0, 3),
        constructionMethod: 'Standard column construction',
        properties: { itemCode: '03.30.C1' }
      });
    }
    
    return assemblies;
  }
  
  /**
   * Extract COORDINATES from drawings for element placement
   */
  private async extractCoordinatesFromDrawing(doc: any, legendContext?: string): Promise<any[]> {
    logger.info(`ðŸ“ Extracting coordinates from ${doc.filename}`);
    
    const textContent = doc.textContent || doc.text || doc.content || '';
    if (!textContent) {
      logger.warn(`âš ï¸ No text content for ${doc.filename}`);
      return [];
    }
    
    const prompt = `You are a construction estimator extracting EXACT COORDINATES from construction drawings.

DRAWING: ${doc.filename}${legendContext || ''}
TEXT CONTENT (first 10000 chars):
${textContent.substring(0, 10000)}

EXTRACT EVERY ELEMENT'S LOCATION from this drawing. Look for:
1. Grid references (A-1, B-2, etc.) and convert to coordinates
2. Dimensions and offsets from grid lines
3. Floor/level assignments (Ground Floor, Second Floor, etc.)
4. Room names and numbers
5. Wall centerline coordinates
6. Column grid intersections
7. Door and window locations

For floor plans, extract the ACTUAL grid spacing from dimension annotations between grid lines:
- Look for dimension strings between grid bubbles (e.g., "7200", "8400", "6000")
- Convert dimensions to meters (if in mm, divide by 1000; if in feet, multiply by 0.3048)
- Report gridSpacing in the output for each element
- If grid spacing cannot be determined from the drawing, set gridSpacing to null
  and note "GRID_SPACING_UNKNOWN" in the description — DO NOT assume any default spacing
- Grid labels: extract actual labels from drawing (letters, numbers, or mixed)

For elevations/sections, extract ACTUAL floor-to-floor heights from section drawings:
- Look for elevation annotations, level markers, and dimension strings
- If floor heights cannot be determined, set elevation to null
  and note "ELEVATION_UNKNOWN" in the description — DO NOT assume default heights

Return JSON format:
{
  "gridSpacing": { "x": null, "y": null, "unit": "m", "note": "Extract from dimension annotations or set null if unknown" },
  "coordinates": [
    {
      "id": "COORD_001",
      "elementType": "wall",
      "location": "Grid A-1 to A-5",
      "floor": "Ground Floor",
      "gridSpacing": 7.2,
      "position": { "x": 0, "y": 0, "z": 0 },
      "endPosition": { "x": 0, "y": 28.8, "z": 0 },
      "length": 28.8,
      "height": null,
      "description": "Exterior wall along Grid A"
    },
    {
      "id": "COORD_002", 
      "elementType": "column",
      "location": "Grid B-2",
      "floor": "Ground Floor",
      "gridSpacing": 7.2,
      "position": { "x": 7.2, "y": 7.2, "z": 0 },
      "dimensions": { "width": 0.6, "depth": 0.6, "height": null },
      "description": "Concrete column at B-2"
    }
  ]
}

Extract ALL element locations visible in this drawing. Be specific with coordinates.`;

    try {
      const response = await this.anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        temperature: 0,
        messages: [{ role: "user", content: prompt }]
      });

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
      const result = this.parseJSONResponse(responseText);
      const coordinates = result?.coordinates || [];
      
      logger.info(`   ðŸ“ Extracted ${coordinates.length} coordinate sets from ${doc.filename}`);
      
      // Log sample coordinates for verification
      if (coordinates.length > 0) {
        const sample = coordinates[0];
        logger.info(`   Sample: ${sample.elementType} at (${sample.position?.x}, ${sample.position?.y}, ${sample.position?.z}) - ${sample.description}`);
      }
      
      return coordinates;
    } catch (error) {
      logger.error(`Failed to extract coordinates from ${doc.filename}:`, error);
      return [];
    }
  }
  
  /**
   * Build ELEMENTS by placing assemblies at extracted coordinates
   */
  private async buildElementsFromAssemblies(assemblies: Assembly[], coordinates: any[]): Promise<Element[]> {
    logger.info(`ðŸ—ï¸ Building elements from ${assemblies.length} assemblies and ${coordinates.length} coordinate sets`);
    
    const elements: Element[] = [];
    let elementId = 1;
    
    // Match assemblies to coordinate locations
    for (const coord of coordinates) {
      // Find matching assembly for this element type
      const matchingAssembly = assemblies.find(a => 
        a.type.toLowerCase() === coord.elementType?.toLowerCase() ||
        (coord.elementType === 'wall' && a.type === 'wall') ||
        (coord.elementType === 'column' && a.type === 'column') ||
        (coord.elementType === 'beam' && a.type === 'beam')
      );
      
      if (!matchingAssembly) {
        logger.warn(`No assembly found for ${coord.elementType} at ${coord.location}`);
      this.trackMissingData(
        'detail',
        `No construction assembly defined for ${coord.elementType} at ${coord.location}`,
        '00',
        'medium',
        {
          floorLabel: coord.floor,
          costImpactLow: 1000,
          costImpactHigh: 10000,
          assumptionUsed: 'Element has coordinates but no assembly; cannot estimate cost',
        }
      );
      continue;
      }
      
      // Create element with real placement
      const element: Element = {
        id: `ELEM_${String(elementId++).padStart(4, '0')}`,
        type: coord.elementType || matchingAssembly.type,
        assemblies: [matchingAssembly],
        location: coord.location || `${coord.floor || 'Unknown'} - ${coord.description || ''}`.trim(),
        properties: {
          floor: coord.floor,
          gridLocation: coord.location,
          description: coord.description,
          itemCode: matchingAssembly.properties?.itemCode || matchingAssembly.id,
          assemblyName: matchingAssembly.name,
          products: matchingAssembly.products.map(p => ({
            id: p.id,
            name: p.name,
            csiCode: p.csiCode
          }))
        },
        geometry: (() => {
          // ── BUG FIX (v15.4): write geometry.location.realLocation ──────────
          // The viewer (viewer-3d.tsx getRealLocation) reads:
          //   e?.geometry?.location?.realLocation  (first priority)
          // The converter (bim-converter.ts convertRealElementToLegacyFormat) reads:
          //   real?.geometry?.location?.realLocation  (first priority)
          // Writing geometry.position caused both to fall through to origin (0,0,0).
          //
          // Z-coordinate: resolve from storeyElevations map populated by
          // processConstructionDocuments from Claude's building_analysis.
          // coord.position.z from Claude is often 0 (Claude doesn't know elevations
          // from plan drawings alone); the map provides the real datum.
          // Normalise raw position through unit-normaliser (handles mm, cm, m, ft, ft-in)
          const rawPos = coord.position || { x: 0, y: 0, z: 0 };
          const normPos = normaliseCoord(rawPos) || { x: 0, y: 0, z: 0 };

          // Z: prefer storey elevation map; add any non-zero z offset from Claude
          const storeyZ = this.getFloorElevation(coord.floor) ?? null;
          const localZ  = normPos.z !== 0 ? normPos.z : 0;
          const resolvedZ = storeyZ !== null ? storeyZ + localZ : localZ;

          // Normalise dimensions through unit-normaliser
          const rawDims = coord.dimensions || {};
          const normDims = normaliseDimensions({
            width:     rawDims.width  ?? coord.width  ?? coord.length  ?? null,
            height:    rawDims.height ?? coord.height ?? null,
            depth:     rawDims.depth  ?? coord.depth  ?? coord.thickness ?? null,
          });

          const realLocation = { x: normPos.x, y: normPos.y, z: resolvedZ };

          return {
            // Keep position for any legacy consumers
            position: rawPos,
            // Canonical key read by viewer and converter
            location: { realLocation },
            endPosition: coord.endPosition,
            dimensions: normDims,
            shape: this.determineShapeFromType(coord.elementType),
          };
        })(),
      };

      elements.push(element);

      // Log element creation for first few
      if (elements.length <= 5) {
        const pos = element.geometry.location.realLocation;
        logger.info(`   ✅ Created ${element.type}: ${element.properties.itemCode} at (${pos.x}, ${pos.y}, ${pos.z}) - ${element.location}`);
      }
    }
    
    // WP-R1 FIX: If assemblies exist but no coordinates could be extracted from drawings,
    // register a CRITICAL RFI and return an empty array.
    // Under no circumstances fabricate grid placements with hardcoded spacing.
    if (elements.length === 0 && assemblies.length > 0) {
      logger.warn('⛔ No coordinates found — assemblies cannot be placed without drawing data');
      this.trackMissingData(
        'dimension',
        `No element coordinates could be extracted from drawings. ` +
        `${assemblies.length} assemblies are defined but have no placement data. ` +
        `Floor plans must be re-submitted with readable dimension annotations and grid references. ` +
        `BIM generation cannot proceed without drawing-derived coordinates — ` +
        `fabricated placements are not permitted under CIQS methodology.`,
        '00 00 00',
        'critical',
        {
          drawingRef: 'All floor plans and structural drawings',
          costImpactLow: 0,
          costImpactHigh: 0,
          assumptionUsed: undefined,
        }
      );
      logger.warn(`⛔ RFI registered for missing placement coordinates. Returning empty element array.`);
      return [];
    }
    
    logger.info(`âœ… Created ${elements.length} placed elements`);
    return elements;
  }
  
  /**
   * Determine shape based on element type
   */
  private determineShapeFromType(elementType: string): string {
    const type = (elementType || '').toLowerCase();
    if (type.includes('column')) return 'rectangular';
    if (type.includes('beam')) return 'rectangular';
    if (type.includes('wall')) return 'rectangular';
    if (type.includes('slab')) return 'rectangular';
    if (type.includes('door')) return 'rectangular';
    if (type.includes('window')) return 'rectangular';
    return 'box';
  }
  
  /**
   * Legacy method - kept for compatibility but redirects to new flow
   */
  private async buildElementsFromDrawings(doc: any): Promise<Element[]> {
    logger.info(`ðŸ“ Processing drawing ${doc.filename} with ENHANCED TEXT ANALYSIS`);
    
    // Use text-based analysis directly - no raster previews needed
    const textContent = doc.textContent || doc.text || doc.content || '';
    
    if (!textContent) {
      logger.warn(`âš ï¸ No text content for ${doc.filename} - skipping`);
      return [];
    }
    
    const assembliesArray = Array.from(this.assemblies.values());
    const assembliesList = assembliesArray.map(a => `${a.id}: ${a.name}`).join('\n');
    
    const allElements: Element[] = [];
    let elementCounter = this.elements.size + 1;
    
    // FIRST: Use existing comprehensive drawing analysis services
    try {
      const analyzerModule = await import('./services/drawing-analyzer.js');
      const { analyzeDrawingsForFacts } = analyzerModule;
      
      // Analyze using existing legend lexicon and drawing analyzer
      const projectId = doc.project_id || doc.projectId || '';
      const drawingFacts = await analyzeDrawingsForFacts(projectId, [doc]);
      
      // THEN: Extract elements using existing services ONLY if we found real facts
      if (doc.filename.match(/floor.*plan|section|underground|parking/i) && drawingFacts?.facts) {
        const hasRealFacts = drawingFacts.facts.lighting || drawingFacts.facts.sprinklers || 
                            drawingFacts.facts.receptacles || drawingFacts.facts.panels?.length || 
                            drawingFacts.facts.legendHits?.length;
        if (hasRealFacts) {
          const extractedElements = await this.extractElementsUsingExistingServices(doc, drawingFacts);
          allElements.push(...extractedElements);
        }
      }
    } catch (error) {
      logger.warn('Could not use existing analysis services, continuing with standard analysis:', error);
      // Continue with standard Claude visual analysis
    }
    
    // For each page/preview, analyze with Claude's vision
    const previews = doc.rasterPreviews || [];
    logger.info(`   Processing ${previews.length} visual pages`);
    
    for (let i = 0; i < Math.max(1, previews.length); i++) {
      const preview = previews[i];
      logger.info(`   Processing visual page ${i+1}/${previews.length || 1}`);
      
      // Prepare multimodal content for Claude
      const messages: any[] = [];
      
      if (preview?.filePath) {
        // Include VISUAL drawing content
        const fs = await import('fs/promises');
        try {
          const imageBuffer = await fs.readFile(preview.filePath);
          const base64Image = imageBuffer.toString('base64');
          
          messages.push({
            role: "user",
            content: [
              {
                type: "text",
                text: `You are a construction estimator extracting EVERY SINGLE building component visible in this drawing.

IMPORTANT: Extract ALL individual elements you can see - NO LIMITS!
Do not group or summarize - extract each individual component separately.

${doc.filename.includes('FLOOR') || doc.filename.includes('PLAN') ? `
This is a FLOOR PLAN - extract:
- EVERY wall segment you see
- EVERY door with its actual marking from the drawing
- EVERY window with its actual marking from the drawing
- EVERY room/space as labeled in the drawing
- ALL fixtures exactly as shown
- ALL symbols exactly as drawn
- Use the actual labels and markings from the drawing` : ''}

${doc.filename.includes('ELEVATION') ? `
This is an ELEVATION - extract:
- EVERY window on each floor
- EVERY floor level with height
- ALL exterior wall segments
- ALL roof elements
- ALL visible dimensions` : ''}

${doc.filename.includes('SECTION') ? `
This is a SECTION - extract:
- EVERY floor slab with thickness
- EVERY wall shown in section
- ALL structural elements (beams, columns)
- ALL vertical dimensions` : ''}

${doc.filename.includes('CEILING') ? `
This is a CEILING PLAN - extract:
- EVERY light fixture location (not "lighting system", but each fixture)
- EVERY sprinkler head location
- EVERY HVAC diffuser/grille
- ALL ceiling mounted equipment` : ''}

Available ASSEMBLIES:
${assembliesList}

Return JSON with EVERY INDIVIDUAL element you can identify (no limits):
{
  "elements": [
    // Extract elements with actual values from the drawing
    // Use real coordinates, dimensions, and labels you see
    // Do not make up labels or values
  ]
}`
              },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: base64Image
                }
              }
            ]
          });
          
        } catch (error) {
          logger.error(`Failed to load image ${preview.filePath}:`, error);
          // Fallback to text-only analysis
          messages.push({
            role: "user", 
            content: `Analyze the text content from this drawing page and extract building elements.

Available ASSEMBLIES:
${assembliesList}

Drawing content: ${doc.textContent || 'No text content available'}`
          });
        }
      } else {
        // Text-only fallback
        logger.warn(`   No visual preview for page ${i+1}, using text analysis`);
        messages.push({
          role: "user", 
          content: `Analyze the text content from this drawing and extract building elements.

Available ASSEMBLIES:
${assembliesList}

Drawing content: ${doc.textContent || 'No text content available'}`
        });
      }

      try {
        const response = await this.anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8192,
          temperature: 0,
          messages: messages
        });

        const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
        const result = this.parseJSONResponse(responseText);

        if (result?.elements) {
          // Expand elements with actual assembly objects and unique IDs
          const pageElements = result.elements.map((element: any, idx: number) => ({
            ...element,
            id: `ELM_${String(elementCounter + idx).padStart(3, '0')}`,
            assemblies: element.assemblies ? element.assemblies.map((assemblyId: string) => this.assemblies.get(assemblyId)).filter(Boolean) : []
          }));
          elementCounter += pageElements.length;
          allElements.push(...pageElements);
          logger.info(`   Found ${pageElements.length} elements from visual analysis of page ${i+1}`);
        }
      } catch (error) {
        logger.error(`Failed to process visual page ${i+1}:`, error);
      }
    }
    
    logger.info(`âœ… Total elements extracted from ${doc.filename} with VISUAL ANALYSIS: ${allElements.length}`);
    return allElements;
  }
  
  /**
   * Generate missing raster previews for documents that don't have them
   */
  private async generateMissingRasterPreviews(doc: any): Promise<void> {
    try {
      // Try to get the document with full content from database
      const { storage } = await import('./storage');
      const fullDoc = await storage.getDocument(doc.id);
      
      if (fullDoc?.rasterPreviews) {
        // Update our local doc object with the previews from database
        doc.rasterPreviews = fullDoc.rasterPreviews;
        logger.info(`âœ… Found ${doc.rasterPreviews.length} raster previews from database for ${doc.filename}`);
      } else {
        logger.warn(`âš ï¸ No raster previews available for ${doc.filename} - visual analysis may be limited`);
        // Set empty array so processing can continue
        doc.rasterPreviews = [];
      }
    } catch (error) {
      logger.error(`Failed to get raster previews for ${doc.filename}:`, error);
      doc.rasterPreviews = [];
    }
  }
  
  /**
   * Extract products from visual schedule tables (door and window schedules)
   */
  private async extractProductsFromVisualSchedule(doc: any, _options?: any): Promise<Product[]> {
    logger.info(`ðŸ“‹ Processing VISUAL SCHEDULE: ${doc.filename}`);
    const allProducts: Product[] = [];
    let _productCounter = 1;
    
    for (let i = 0; i < doc.rasterPreviews.length; i++) {
      const preview = doc.rasterPreviews[i];
      if (!preview?.filePath) continue;
      
      try {
        const fs = await import('fs/promises');
        const imageBuffer = await fs.readFile(preview.filePath);
        const imageBase64 = imageBuffer.toString('base64');
        
        const messages = [{
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: `CRITICAL: This is a DOOR and WINDOW SCHEDULE table. Extract EVERY individual door and window listed.

Each row in the table represents ONE door or window that MUST be extracted as a separate product.

Look for:
- Door marks: D101, D102, D103, D201, D202, etc.
- Window marks: W101, W102, W103, W201, W202, etc.
- Sizes (width x height)
- Types (Single Swing, Double Swing, Fixed, Casement, etc.)
- Materials (Wood, Aluminum, Steel, etc.)
- Locations (Ground Floor, Second Floor, etc.)

Return JSON with EVERY door and window you see in the schedule:
{
  "products": [
    {
      "id": "DOOR_D101",
      "name": "Door D101",
      "csiCode": "08.11.00",
      "specification": "3'-0" x 7'-0" Single Swing Door",
      "manufacturer": "",
      "model": "",
      "properties": {
        "mark": "D101",
        "size": "3'-0" x 7'-0"",
        "type": "Single Swing",
        "material": "Wood",
        "location": "Ground Floor"
      }
    },
    {
      "id": "WINDOW_W101",
      "name": "Window W101",
      "csiCode": "08.51.00",
      "specification": "4'-0" x 5'-0" Fixed Window",
      "manufacturer": "",
      "model": "",
      "properties": {
        "mark": "W101",
        "size": "4'-0" x 5'-0"",
        "type": "Fixed",
        "glazing": "Double",
        "location": "Ground Floor"
      }
    }
  ]
}

Extract EVERY SINGLE door and window in the schedule table. There should be MANY (typically 20-100+).`
            },
            {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: "image/png" as const,
                data: imageBase64
              }
            }
          ]
        }];
        
        const response = await this.anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8192,
          temperature: 0,
          messages: messages
        });

        const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
        const result = this.parseJSONResponse(responseText);

        if (result?.products) {
          logger.info(`   âœ… Found ${result.products.length} doors/windows in schedule page ${i+1}`);
          allProducts.push(...result.products);
        }
      } catch (error) {
        logger.error(`Failed to process schedule page ${i+1}:`, error);
      }
    }
    
    logger.info(`âœ… Total products extracted from visual schedule: ${allProducts.length}`);
    return allProducts;
  }

  /**
   * Extract elements using existing comprehensive analysis services
   */
  private async extractElementsUsingExistingServices(doc: any, drawingFacts: any): Promise<Element[]> {
    logger.info(`ðŸ”§ USING EXISTING SERVICES for element extraction from ${doc.filename}`);
    
    const elements: Element[] = [];
    let elementId = 1;
    
    // Convert drawing facts into Element format
    if (drawingFacts.facts) {
      const facts = drawingFacts.facts;
      
      // Process legend hits - these are actual symbols found
      if (facts.legendHits && Array.isArray(facts.legendHits)) {
        for (const hit of facts.legendHits) {
          const element: Element = {
            id: `LEGEND_${hit.type}_${elementId++}`,
            type: hit.type.toLowerCase(),
            assemblies: [],
            location: `Page ${hit.page}`,
            properties: {
              symbol_type: hit.type,
              source: 'legend-lexicon',
              found_on_page: hit.page,
              confidence: 'high'
            },
            geometry: {
              position: { 
                x: hit.x || (elementId * 3), // Use actual x coordinate if available
                y: hit.y || (elementId * 3), // Use actual y coordinate if available
                z: hit.elevation || 0 // Use floor elevation
              },
              type: 'symbol'
            }
          };
          elements.push(element);
        }
        logger.info(`   ðŸ“‹ Found ${facts.legendHits.length} legend symbols`);
      }
      
      // Process MEP systems if identified
      if (facts.lighting || facts.sprinklers || facts.receptacles) {
        // Claude will provide actual spacing from visual analysis
        // For now, mark that these systems exist for proper estimation
        if (facts.lighting) {
          logger.info(`   ðŸ’¡ Lighting system identified in ${doc.filename}`);
        }
        if (facts.sprinklers) {
          logger.info(`   ðŸš¿ Sprinkler system identified in ${doc.filename}`);
        }
        if (facts.receptacles) {
          logger.info(`   ðŸ”Œ Receptacle system identified in ${doc.filename}`);
        }
      }
      
      // Process electrical panels
      if (facts.panels && Array.isArray(facts.panels)) {
        for (const panel of facts.panels) {
          const element: Element = {
            id: `PANEL_${panel.tag}_${elementId++}`,
            type: 'electrical_panel',
            assemblies: [],
            location: 'Electrical Room',
            properties: {
              tag: panel.tag,
              amperage: panel.amps,
              circuits: panel.circuits,
              source: 'drawing-analyzer',
              confidence: 'high'
            },
            geometry: {
              type: 'equipment',
              dimensions: { width: 1, height: 2, depth: 0.3 }
            }
          };
          elements.push(element);
        }
        logger.info(`   âš¡ Found ${facts.panels.length} electrical panels`);
      }
    }
    
    logger.info(`   âœ… Extracted ${elements.length} elements using existing services`);
    return elements;
  }

  /**
   * Extract GRID LINES visually from floor plans and sections using learned symbols
   */
  private async extractGridLinesVisually(doc: any, gridSymbols: any): Promise<Element[]> {
    logger.info(`ðŸ“ VISUAL GRID EXTRACTION for ${doc.filename}`);
    
    const gridElements: Element[] = [];
    const previews = doc.rasterPreviews || [];
    
    for (let i = 0; i < previews.length; i++) {
      const preview = previews[i];
      
      // Create custom prompt based on legend analysis
      const verticalSymbols = gridSymbols.vertical_grids || {};
      const horizontalSymbols = gridSymbols.horizontal_grids || {};
      
      const prompt = `Identify structural grid lines in this construction drawing based on the specific symbols used.

GRID SYMBOL CHARACTERISTICS (learned from legend analysis):

**Vertical Grid Lines:**
- Symbol type: ${verticalSymbols.symbol_type || 'circle'}
- Contains: ${verticalSymbols.contains || 'single letter'}
- Typical position: ${verticalSymbols.typical_position || 'top and bottom edges'}
- Example labels seen: ${JSON.stringify(verticalSymbols.example_labels || ['A', 'B', 'C'])}
- Visual notes: ${verticalSymbols.visual_description || 'Standard grid symbols'}

**Horizontal Grid Lines:**
- Symbol type: ${horizontalSymbols.symbol_type || 'circle'}  
- Contains: ${horizontalSymbols.contains || 'single number'}
- Typical position: ${horizontalSymbols.typical_position || 'left and right edges'}
- Example labels seen: ${JSON.stringify(horizontalSymbols.example_labels || ['1', '2', '3'])}
- Visual notes: ${horizontalSymbols.visual_description || 'Standard grid symbols'}

SEARCH STRATEGY:
1. Look at the ${verticalSymbols.typical_position || 'edges'} for vertical grid symbols
2. Look at the ${horizontalSymbols.typical_position || 'edges'} for horizontal grid symbols  
3. Find ${verticalSymbols.symbol_type || 'circles'} containing ${verticalSymbols.contains || 'single letters'}
4. Find ${horizontalSymbols.symbol_type || 'circles'} containing ${horizontalSymbols.contains || 'single numbers'}

AVOID CONFUSION WITH:
- Room numbers, detail callouts, section markers
- Dimension text, elevation markers, door/window tags
- Any symbols that don't match the learned grid pattern

Return ALL grid lines you find matching these specific characteristics:
{
  "grid_lines": [
    {
      "id": "GRID_V_A",
      "type": "grid_line",
      "direction": "vertical", 
      "label": "A",
      "confidence": "high|medium|low",
      "location_description": "Where you found it on the drawing"
    },
    {
      "id": "GRID_H_1",
      "type": "grid_line",
      "direction": "horizontal",
      "label": "1", 
      "confidence": "high|medium|low",
      "location_description": "Where you found it on the drawing"
    }
  ]
}`;

      try {
        const response = await this.anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          temperature: 0,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: preview.mimeType || "image/png",
                  data: preview.base64Data
                }
              }
            ]
          }]
        });
        
        const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
        const result = this.parseJSONResponse(responseText);
        
        if (result?.grid_lines) {
          logger.info(`   ðŸŽ¯ Found ${result.grid_lines.length} grid lines in page ${i+1}`);
          
          // Convert to Element format
          for (const gridLine of result.grid_lines) {
            const element: Element = {
              id: `${gridLine.id}_${Date.now()}`,
              type: 'grid_line',
              assemblies: [], // Grid lines don't have assemblies
              location: `Floor Plan - ${doc.filename}`,
              properties: {
                direction: gridLine.direction,
                label: gridLine.label,
                confidence: gridLine.confidence || 'medium',
                source_document: doc.filename,
                page: i + 1
              },
              geometry: {
                position: gridLine.estimated_position || { x: 0, y: 0, z: 0 },
                type: 'line',
                direction: gridLine.direction
              }
            };
            gridElements.push(element);
          }
        }
      } catch (error) {
        logger.error(`Failed to extract grids from page ${i+1}:`, error);
      }
    }
    
    logger.info(`ðŸ“ Extracted ${gridElements.length} grid lines from ${doc.filename}`);
    return gridElements;
  }

  private parseJSONResponse(responseText: string): any {
    try {
      // Clean and extract JSON from response
      let jsonStr = responseText;

      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);

      if (jsonMatch) {
        jsonStr = jsonMatch[1] || jsonMatch[0];
      } else {
        // Fallback: use parseFirstJsonObject utility
        const fallbackParsed = parseFirstJsonObject(responseText);
        if (fallbackParsed && !fallbackParsed.error) {
          return fallbackParsed;
        }
      }
      
      // Clean up common JSON issues
      jsonStr = jsonStr
        .replace(/,\s*([}\]])/g, '$1')  // Remove trailing commas
        .replace(/([{,]\s*)(\w+):/g, '$1"$2":'); // Quote unquoted keys
      
      return JSON.parse(jsonStr);
    } catch (_error) {
      logger.error("Failed to parse JSON response. Full response length:", responseText.length);
      logger.error("Response start:", responseText.substring(0, 200));
      logger.error("Response end:", responseText.substring(responseText.length - 200));
      
      // Try to salvage partial data
      try {
        // Look for products array even in incomplete JSON
        const productsMatch = responseText.match(/"products"\s*:\s*\[([\s\S]*?)\]/);
        if (productsMatch) {
          return { products: JSON.parse('[' + productsMatch[1] + ']') };
        }
      } catch (_e) {
        logger.error("Could not salvage partial data");
      }
      return null;
    }
  }
}