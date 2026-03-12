/**
 * 🏗️ Shared BIM Types
 * Breaks circular dependencies between bim-generator and real-qto-processor
 *
 * v15.6 changes:
 *   - RealQuantity.source: added 'ai_extracted' | 'rfi_placeholder'
 *   - RealBIMElement.category: added 'Mechanical' | 'Electrical' | 'Plumbing'
 *     (MEP sub-disciplines; host code may store sub-discipline or canonical 'MEP')
 *   - geometry: added polygon? for slab boundary polygons
 *
 * v15.7 changes:
 *   - geometry.location: added realLocation? — the canonical coordinate key read by
 *     viewer-3d.tsx and bim-converter.ts. Direct x/y/z on location are now optional
 *     (kept for legacy compatibility with pre-v15.7 rows already in the database).
 */

export interface AnalysisOptions {
  unitSystem: "metric" | "imperial";
  includeStoreys: boolean;
  computeGeometry: boolean;
  claudeAnalysis?: any;

  // used only for logging/prompts/heuristics
  documentCount?: number;    // number of PDFs discovered for the project
  pagesAnalyzed?: number;    // number of pages we bundled for Claude
  useAllDocuments?: boolean; // Flag for unlimited processing
  enhancedMode?: boolean;    // Enhanced processing with all documents
  aiAnalysis?: any;          // AI analysis data
  buildingDimensions?: any;  // Building dimensions from Claude
  gridSystem?: any;          // Grid system information
  spatialCoordinates?: any;  // Spatial coordinate data
  projectId?: string;        // optional pass-through for storage queries
}

export interface RealQuantity {
  name: string;
  type: 'length' | 'area' | 'volume' | 'weight' | 'count';
  value: number;
  unit: string;
  /**
   * Provenance of this quantity:
   *  ifc_property      — read directly from IFC property set
   *  computed_geometry — derived by geometry engine (area, volume calculations)
   *  ai_estimated      — estimated by Claude from drawing interpretation
   *  ai_extracted      — explicitly extracted from Claude drawing analysis
   *  rfi_placeholder   — placeholder; real value requires an RFI response
   */
  source:
    | 'ifc_property'
    | 'computed_geometry'
    | 'ai_estimated'
    | 'ai_extracted'
    | 'rfi_placeholder';
}

export interface StoreyData {
  // ── Required ──────────────────────────────────────────────────────────────
  name: string;
  elevation: number;        // metres above project datum
  elementCount: number;

  // ── Optional provenance / geometry ────────────────────────────────────────
  guid?: string;            // IFC IfcBuildingStorey GUID
  ceilingHeight?: number;   // metres — clear height floor->ceiling
  floorToFloorHeight?: number; // metres — this floor to next floor above
  ceiling_height?: number;  // alias used by some Claude responses (-> ceilingHeight on write)

  // ── Elevation traceability ─────────────────────────────────────────────────
  // Values: extracted_from_drawings | derived_from_previous_storey |
  //         sequential_3m_estimate | assumed_ground_datum
  elevation_source?: string;
  elevationSource?: string; // camelCase alias — normalised on write

  // ── RFI flag — set whenever elevation is estimated ────────────────────────
  rfi_flag?: boolean;
  rfiFlag?: boolean;        // camelCase alias
}

export interface RealBIMElement {
  id: string;
  type: string;
  name: string;

  /**
   * Element discipline category.
   *  Canonical DB values:  'Architectural' | 'Structural' | 'MEP'
   *  Sub-discipline aliases accepted by processor: 'Mechanical' | 'Electrical' | 'Plumbing'
   *  Storage layer normalises sub-disciplines -> 'MEP' on upsert.
   */
  category:
    | 'Architectural'
    | 'Structural'
    | 'MEP'
    | 'Mechanical'
    | 'Electrical'
    | 'Plumbing';

  // Real quantities in dual units
  quantities: {
    metric: RealQuantity[];
    imperial: RealQuantity[];
  };

  // Storey information
  storey?: {
    name: string;
    guid?: string;
    elevation: number;
  };

  // Enhanced properties
  properties: {
    material?: string;
    description?: string;
    dimensions?: {
      length?: number;
      width?: number;
      height?: number;
      area?: number;
      volume?: number;
    };
    [key: string]: any;
  };

  // 3D Geometry data for positioning
  geometry?: {
    dimensions?: {
      length: number;
      width: number;
      height: number;
      area: number;
      volume: number;
    };
    /**
     * Element location in the building coordinate system (metres).
     *
     * CANONICAL KEY: realLocation — written by all element creators (v15.7+),
     *   read by viewer-3d.tsx getRealLocation() and bim-converter.ts
     *   convertRealElementToLegacyFormat().
     *
     * LEGACY KEYS: x / y / z at the root of this object — present in rows
     *   written before v15.7. The viewer falls back to these if realLocation
     *   is absent. Do not remove them.
     */
    location?: {
      /** Canonical coordinate wrapper — always written by element creators */
      realLocation?: {
        x: number;
        y: number;
        z: number;
      };
      /** Legacy flat coordinates — present in pre-v15.7 DB rows */
      x?: number;
      y?: number;
      z?: number;
      storey?: string;
      elevation?: number;
      /** Legacy nested coords format from some older processors */
      coordinates?: {
        x: number;
        y: number;
        z: number;
      };
    };
    /** Slab / floor plate boundary polygon — array of {x,y} metre points */
    polygon?: Array<{ x: number; y: number }>;
    type?: string;
    originalData?: any;
  };

  // IFC metadata
  ifcInfo?: {
    guid?: string;
    elementId?: string;
    classType?: string;
  };
}
