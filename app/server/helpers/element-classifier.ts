/**
 * Element Classification Helper
 * Maps extracted element data from construction documents to standardized categories
 */

import { InsertBimElementClassification } from "@shared/schema";

export interface ClassificationInput {
  elementId: string;
  elementType?: string;
  wallType?: string;
  mark?: string;
  name?: string;
  csiCode?: string;
  specification?: string;
  documentName?: string;
}

export class ElementClassifier {
  /**
   * Determine primary type from extracted element data
   */
  static determinePrimaryType(input: ClassificationInput): string {
    const { elementType, mark, name, specification, csiCode } = input;
    
    // Use Claude's extracted element type first
    if (elementType) {
      const typeUpper = elementType.toUpperCase();
      
      if (typeUpper.includes('DOOR')) return 'door';
      if (typeUpper.includes('WINDOW')) return 'window';
      if (typeUpper.includes('WALL')) return 'wall';
      if (typeUpper.includes('COLUMN')) return 'structure';
      if (typeUpper.includes('BEAM')) return 'structure';
      if (typeUpper.includes('SLAB')) return 'structure';
      if (typeUpper.includes('FOUNDATION')) return 'structure';
      
      // M&E equipment types
      if (['AHU', 'VAV', 'FCU', 'HVAC', 'PANEL', 'EQUIPMENT', 'TRANSFORMER', 'GENERATOR']
        .some(type => typeUpper.includes(type))) {
        return 'mAndE';
      }
      
      // Plumbing fixtures
      if (['PLUMBING', 'WC', 'SINK', 'LAVATORY', 'URINAL', 'SHOWER', 'DRAIN']
        .some(type => typeUpper.includes(type))) {
        return 'plumbing';
      }
    }
    
    // Check mark patterns (D101, W101, etc.)
    if (mark) {
      if (mark.match(/^D\d+/)) return 'door';
      if (mark.match(/^W\d+/)) return 'window';
      if (mark.match(/^(EP|ME|HVAC)/)) return 'mAndE';
      if (mark.match(/^(P|PL)\d+/)) return 'plumbing';
    }
    
    // Check name patterns as fallback
    if (name) {
      const nameUpper = name.toUpperCase();
      if (nameUpper.includes('DOOR')) return 'door';
      if (nameUpper.includes('WINDOW')) return 'window';
      if (nameUpper.includes('WALL')) return 'wall';
      if (nameUpper.includes('WASHROOM') || nameUpper.includes('WC')) return 'plumbing';
    }
    
    // Check specification/CSI codes
    if (specification || csiCode) {
      const spec = (specification || csiCode || '').toUpperCase();
      if (spec.includes('08 1') || spec.includes('DOOR')) return 'door';
      if (spec.includes('08 5') || spec.includes('WINDOW')) return 'window';
      if (spec.includes('09 2') || spec.includes('GYPSUM')) return 'wall';
      if (spec.includes('23 ') || spec.includes('HVAC')) return 'mAndE';
      if (spec.includes('22 ') || spec.includes('PLUMB')) return 'plumbing';
      if (spec.includes('03 ') || spec.includes('CONCRETE')) return 'structure';
    }
    
    return 'other';
  }
  
  /**
   * Determine sub-type from extracted data
   */
  static determineSubType(input: ClassificationInput): string | null {
    const { wallType, mark, elementType } = input;
    
    // Wall types (W1, W2, W3, etc.)
    if (wallType) return wallType;
    
    // Door/window marks (D101, W101, etc.)
    if (mark) return mark;
    
    // Equipment IDs
    if (elementType && elementType.includes('-')) {
      return elementType; // e.g., "AHU-01", "EP-1"
    }
    
    return null;
  }
  
  /**
   * Calculate confidence score based on data quality
   */
  static calculateConfidence(input: ClassificationInput): number {
    let confidence = 0.5; // Base confidence
    
    // Higher confidence if elementType is explicitly provided
    if (input.elementType) confidence += 0.3;
    
    // Additional confidence for marks/IDs
    if (input.mark) confidence += 0.1;
    
    // Additional confidence for wall types
    if (input.wallType) confidence += 0.1;
    
    // Additional confidence for specification reference
    if (input.specification || input.csiCode) confidence += 0.1;
    
    // Cap at 1.0
    return Math.min(confidence, 1.0);
  }
  
  /**
   * Determine source of classification
   */
  static determineSource(input: ClassificationInput): string {
    if (input.documentName) {
      const docUpper = input.documentName.toUpperCase();
      if (docUpper.includes('LEGEND')) return 'legend';
      if (docUpper.includes('SCHEDULE')) return 'schedule';
      if (docUpper.includes('SPECIFICATION')) return 'specification';
    }
    
    // Default to AI analysis if element type was extracted
    if (input.elementType || input.wallType || input.mark) {
      return 'ai_analysis';
    }
    
    return 'ai_analysis';
  }
  
  /**
   * Create a classification record for a BIM element
   */
  static classify(input: ClassificationInput): InsertBimElementClassification {
    const primaryType = this.determinePrimaryType(input);
    const subType = this.determineSubType(input);
    const confidence = this.calculateConfidence(input);
    const source = this.determineSource(input);
    
    return {
      elementId: input.elementId,
      primaryType,
      subType,
      specRef: input.specification || null,
      symbolId: input.mark || null,
      source,
      confidence: String(confidence),
      extractedFrom: input.documentName || null,
      extractionMethod: 'claude_analysis'
    };
  }
  
  /**
   * Batch classify multiple elements
   */
  static classifyBatch(elements: ClassificationInput[]): InsertBimElementClassification[] {
    return elements.map(element => this.classify(element));
  }
}