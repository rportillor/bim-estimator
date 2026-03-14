/**
 * Unit conversion utilities for USA imperial and metric construction standards
 * Supports both Canadian (metric) and US (imperial) building codes
 */

export const UNIT_SYSTEMS = {
  METRIC: 'metric',
  IMPERIAL: 'imperial'
} as const;

export type UnitSystem = typeof UNIT_SYSTEMS[keyof typeof UNIT_SYSTEMS];

export interface ConversionFactors {
  METERS_TO_FEET: number;
  SQ_METERS_TO_SQ_FEET: number;
  CU_METERS_TO_CU_FEET: number;
  INCHES_PER_FOOT: number;
  CM_PER_METER: number;
}

export const CONVERSION: ConversionFactors = {
  METERS_TO_FEET: 3.28084,
  SQ_METERS_TO_SQ_FEET: 10.7639,
  CU_METERS_TO_CU_FEET: 35.3147,
  INCHES_PER_FOOT: 12,
  CM_PER_METER: 100
};

/**
 * Convert length between metric and imperial systems
 */
export function convertLength(value: number, from: UnitSystem, to: UnitSystem): number {
  if (from === to) return value;
  
  if (from === UNIT_SYSTEMS.METRIC && to === UNIT_SYSTEMS.IMPERIAL) {
    return value * CONVERSION.METERS_TO_FEET;
  }
  
  if (from === UNIT_SYSTEMS.IMPERIAL && to === UNIT_SYSTEMS.METRIC) {
    return value / CONVERSION.METERS_TO_FEET;
  }
  
  return value;
}

/**
 * Convert area between metric and imperial systems
 */
export function convertArea(value: number, from: UnitSystem, to: UnitSystem): number {
  if (from === to) return value;
  
  if (from === UNIT_SYSTEMS.METRIC && to === UNIT_SYSTEMS.IMPERIAL) {
    return value * CONVERSION.SQ_METERS_TO_SQ_FEET;
  }
  
  if (from === UNIT_SYSTEMS.IMPERIAL && to === UNIT_SYSTEMS.METRIC) {
    return value / CONVERSION.SQ_METERS_TO_SQ_FEET;
  }
  
  return value;
}

/**
 * Convert volume between metric and imperial systems
 */
export function convertVolume(value: number, from: UnitSystem, to: UnitSystem): number {
  if (from === to) return value;
  
  if (from === UNIT_SYSTEMS.METRIC && to === UNIT_SYSTEMS.IMPERIAL) {
    return value * CONVERSION.CU_METERS_TO_CU_FEET;
  }
  
  if (from === UNIT_SYSTEMS.IMPERIAL && to === UNIT_SYSTEMS.METRIC) {
    return value / CONVERSION.CU_METERS_TO_CU_FEET;
  }
  
  return value;
}

/**
 * Format length with appropriate precision and units
 * Enhanced with consistent formatting for construction industry
 */
export function formatLength(value: number, unit: UnitSystem, showBoth: boolean = false): string {
  const absValue = Math.abs(value);
  
  let primary: string;
  let secondary: string;
  
  if (unit === UNIT_SYSTEMS.IMPERIAL) {
    if (absValue >= 1) {
      const feet = Math.floor(absValue);
      const inches = (absValue - feet) * CONVERSION.INCHES_PER_FOOT;
      if (inches >= 1) {
        primary = `${feet}'-${inches.toFixed(1)}"`;
      } else {
        primary = `${absValue.toFixed(2)} ft`;
      }
    } else {
      primary = `${(absValue * CONVERSION.INCHES_PER_FOOT).toFixed(1)} in`;
    }
    
    // Calculate metric equivalent
    if (absValue >= 1) {
      secondary = `${absValue.toFixed(2)} m`;
    } else {
      secondary = `${(absValue * CONVERSION.CM_PER_METER).toFixed(0)} cm`;
    }
  } else {
    if (absValue >= 1) {
      primary = `${absValue.toFixed(2)} m`;
    } else {
      primary = `${(absValue * CONVERSION.CM_PER_METER).toFixed(0)} cm`;
    }
    
    // Calculate imperial equivalent
    const imperialValue = absValue * CONVERSION.METERS_TO_FEET;
    if (imperialValue >= 1) {
      const feet = Math.floor(imperialValue);
      const inches = (imperialValue - feet) * CONVERSION.INCHES_PER_FOOT;
      if (inches >= 1) {
        secondary = `${feet}'-${inches.toFixed(1)}"`;
      } else {
        secondary = `${imperialValue.toFixed(2)} ft`;
      }
    } else {
      secondary = `${(imperialValue * CONVERSION.INCHES_PER_FOOT).toFixed(1)} in`;
    }
  }
  
  return showBoth ? `${primary} (${secondary})` : primary;
}

/**
 * Format area with appropriate units and optional dual display
 */
export function formatArea(value: number, unit: UnitSystem, showBoth: boolean = false): string {
  let primary: string;
  let secondary: string;
  
  if (unit === UNIT_SYSTEMS.IMPERIAL) {
    primary = `${value.toFixed(2)} ft²`;
    secondary = `${convertArea(value, UNIT_SYSTEMS.IMPERIAL, UNIT_SYSTEMS.METRIC).toFixed(2)} m²`;
  } else {
    primary = `${value.toFixed(2)} m²`;
    secondary = `${convertArea(value, UNIT_SYSTEMS.METRIC, UNIT_SYSTEMS.IMPERIAL).toFixed(2)} ft²`;
  }
  
  return showBoth ? `${primary} (${secondary})` : primary;
}

/**
 * Format volume with appropriate units and optional dual display
 */
export function formatVolume(value: number, unit: UnitSystem, showBoth: boolean = false): string {
  let primary: string;
  let secondary: string;
  
  if (unit === UNIT_SYSTEMS.IMPERIAL) {
    primary = `${value.toFixed(2)} ft³`;
    secondary = `${convertVolume(value, UNIT_SYSTEMS.IMPERIAL, UNIT_SYSTEMS.METRIC).toFixed(2)} m³`;
  } else {
    primary = `${value.toFixed(2)} m³`;
    secondary = `${convertVolume(value, UNIT_SYSTEMS.METRIC, UNIT_SYSTEMS.IMPERIAL).toFixed(2)} ft³`;
  }
  
  return showBoth ? `${primary} (${secondary})` : primary;
}

/**
 * Get unit system from project location (primary) and building code (backup)
 * Implements dual approach: Location → Building Code → Default Metric
 */
export function getUnitSystemFromProject(
  country?: string, 
  location?: string, 
  buildingCode?: string
): UnitSystem {
  // PRIMARY: Project location/country determines units
  if (country) {
    const imperialCountries = ['usa', 'us', 'united states'];
    if (imperialCountries.some(c => country.toLowerCase().includes(c))) {
      return UNIT_SYSTEMS.IMPERIAL;
    }
  }
  
  // Additional location-based detection
  if (location) {
    const usaLocations = ['usa', 'us', 'united states', 'america'];
    if (usaLocations.some(loc => location.toLowerCase().includes(loc))) {
      return UNIT_SYSTEMS.IMPERIAL;
    }
  }
  
  // BACKUP: Building code confirmation
  if (buildingCode) {
    const usBuildingCodes = ['IBC', 'ASCE', 'AISC', 'ACI', 'ASHRAE'];
    if (usBuildingCodes.some(code => buildingCode.includes(code))) {
      return UNIT_SYSTEMS.IMPERIAL;
    }
  }
  
  // DEFAULT: Metric for all other countries/regions
  return UNIT_SYSTEMS.METRIC;
}

/**
 * Legacy function for building code only (backward compatibility)
 */
export function getUnitSystemFromBuildingCode(buildingCode?: string): UnitSystem {
  return getUnitSystemFromProject(undefined, undefined, buildingCode);
}

/**
 * Format precision based on value size (construction industry standards)
 */
export function getConstructionPrecision(value: number, unit: UnitSystem): number {
  const absValue = Math.abs(value);
  
  if (unit === UNIT_SYSTEMS.IMPERIAL) {
    if (absValue >= 100) return 0; // Large dimensions to nearest foot
    if (absValue >= 1) return 1;   // Medium dimensions to 1/10 foot
    return 2;                      // Small dimensions to 1/100 foot
  } else {
    if (absValue >= 10) return 1;  // Large dimensions to nearest 0.1m
    if (absValue >= 1) return 2;   // Medium dimensions to nearest cm
    return 3;                      // Small dimensions to nearest mm
  }
}