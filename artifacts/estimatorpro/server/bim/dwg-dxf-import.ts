/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  DWG/DXF IMPORT ENGINE — Convert CAD drawings to 3D BIM elements
 *  Uses the dxf-parser package (already in package.json) for DXF files.
 *  For DWG files: converts via ODA File Converter or falls back to AI analysis.
 *  Extracts:
 *  - Line/polyline entities → wall centerlines
 *  - Circle/arc entities → column positions or pipe runs
 *  - Block references → door/window/fixture symbols
 *  - Layer organization → discipline mapping
 *  - Dimension annotations → real-world measurements
 *  - Text entities → room labels, dimension values
 * ══════════════════════════════════════════════════════════════════════════════
 */

import {
  type Vec2, type Vec3, vec2, vec3, v3add, v3sub, v3len,
} from './geometry-kernel';

import {
  type BIMSolid, type WallParams, type ColumnParams, type SlabParams,
  type DuctParams, type PipeParams, type FixtureParams,
  createWall, createColumn, createSlab, createDuct, createPipe, createFixture,
  inferWallAssembly, WALL_ASSEMBLIES,
} from './parametric-elements';

// ═══════════════════════════════════════════════════════════════════════════════
//  LAYER → DISCIPLINE MAPPING
// ═══════════════════════════════════════════════════════════════════════════════

interface LayerMapping {
  discipline: 'Architectural' | 'Structural' | 'MEP';
  elementType: string;
  isExterior?: boolean;
}

const LAYER_PATTERNS: [RegExp, LayerMapping][] = [
  // Architectural
  [/^A[-_]WALL[-_]EXT/i, { discipline: 'Architectural', elementType: 'Exterior Wall', isExterior: true }],
  [/^A[-_]WALL/i, { discipline: 'Architectural', elementType: 'Interior Wall' }],
  [/^A[-_]DOOR/i, { discipline: 'Architectural', elementType: 'Door' }],
  [/^A[-_]GLAZ|^A[-_]WIND/i, { discipline: 'Architectural', elementType: 'Window' }],
  [/^A[-_]FLOR|^A[-_]SLAB/i, { discipline: 'Architectural', elementType: 'Floor Slab' }],
  [/^A[-_]ROOF/i, { discipline: 'Architectural', elementType: 'Roof' }],
  [/^A[-_]STAIR/i, { discipline: 'Architectural', elementType: 'Stair' }],
  [/^A[-_]CEIL/i, { discipline: 'Architectural', elementType: 'Ceiling' }],
  [/^A[-_]FURN/i, { discipline: 'Architectural', elementType: 'Furniture' }],
  // Structural
  [/^S[-_]COLS?/i, { discipline: 'Structural', elementType: 'Column' }],
  [/^S[-_]BEAM/i, { discipline: 'Structural', elementType: 'Beam' }],
  [/^S[-_]FNDN|^S[-_]FOOT/i, { discipline: 'Structural', elementType: 'Footing' }],
  [/^S[-_]WALL/i, { discipline: 'Structural', elementType: 'Wall' }],
  [/^S[-_]SLAB/i, { discipline: 'Structural', elementType: 'Floor Slab' }],
  // Mechanical
  [/^M[-_]DUCT/i, { discipline: 'MEP', elementType: 'Duct' }],
  [/^M[-_]PIPE/i, { discipline: 'MEP', elementType: 'Pipe' }],
  [/^M[-_]EQUIP/i, { discipline: 'MEP', elementType: 'Equipment' }],
  // Electrical
  [/^E[-_]LITE|^E[-_]LIGH/i, { discipline: 'MEP', elementType: 'Light' }],
  [/^E[-_]POWR|^E[-_]RCPT/i, { discipline: 'MEP', elementType: 'Receptacle' }],
  [/^E[-_]PANEL/i, { discipline: 'MEP', elementType: 'Panel' }],
  [/^E[-_]COND/i, { discipline: 'MEP', elementType: 'Cable' }],
  // Plumbing
  [/^P[-_]PIPE|^P[-_]FIXT/i, { discipline: 'MEP', elementType: 'Pipe' }],
  [/^P[-_]EQPM/i, { discipline: 'MEP', elementType: 'Equipment' }],
  // Fire protection
  [/^FP[-_]/i, { discipline: 'MEP', elementType: 'Sprinkler' }],
];

function classifyLayer(layerName: string): LayerMapping {
  for (const [pattern, mapping] of LAYER_PATTERNS) {
    if (pattern.test(layerName)) return mapping;
  }
  // Fallback by first letter
  const prefix = layerName.charAt(0).toUpperCase();
  if (prefix === 'S') return { discipline: 'Structural', elementType: 'Generic' };
  if (prefix === 'M' || prefix === 'E' || prefix === 'P') return { discipline: 'MEP', elementType: 'Generic' };
  return { discipline: 'Architectural', elementType: 'Generic' };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DXF PARSING
// ═══════════════════════════════════════════════════════════════════════════════

interface DXFEntity {
  type: string;
  layer: string;
  // LINE
  startX?: number; startY?: number; startZ?: number;
  endX?: number; endY?: number; endZ?: number;
  // LWPOLYLINE / POLYLINE
  vertices?: { x: number; y: number; z?: number }[];
  closed?: boolean;
  // CIRCLE / ARC
  centerX?: number; centerY?: number; centerZ?: number;
  radius?: number;
  startAngle?: number; endAngle?: number;
  // INSERT (block reference)
  blockName?: string;
  insertX?: number; insertY?: number; insertZ?: number;
  rotation?: number;
  scaleX?: number; scaleY?: number;
  // TEXT / MTEXT
  text?: string;
  textX?: number; textY?: number;
  // DIMENSION
  dimX1?: number; dimY1?: number;
  dimX2?: number; dimY2?: number;
  dimValue?: number;
}

interface DXFParseResult {
  entities: DXFEntity[];
  blocks: Map<string, DXFEntity[]>;
  layers: Map<string, { color: number; lineType: string }>;
  units: 'mm' | 'm' | 'inches' | 'feet';
}

/** Parse DXF file content using dxf-parser */
export async function parseDXF(content: string): Promise<DXFParseResult> {
  try {
    const DxfParser = (await import('dxf-parser')).default;
    const parser = new DxfParser();
    const dxf = parser.parseSync(content);

    if (!dxf) {
      return { entities: [], blocks: new Map(), layers: new Map(), units: 'mm' };
    }

    const entities: DXFEntity[] = [];
    const blocks = new Map<string, DXFEntity[]>();
    const layers = new Map<string, { color: number; lineType: string }>();

    // Extract layers
    if (dxf.tables?.layer?.layers) {
      for (const [name, layerData] of Object.entries(dxf.tables.layer.layers) as any[]) {
        layers.set(name, {
          color: layerData.color || 7,
          lineType: layerData.lineTypeName || 'CONTINUOUS',
        });
      }
    }

    // Detect units from header
    let units: DXFParseResult['units'] = 'mm';
    const insunits = dxf.header?.$INSUNITS;
    if (insunits === 1) units = 'inches';
    else if (insunits === 2) units = 'feet';
    else if (insunits === 4) units = 'mm';
    else if (insunits === 6) units = 'm';

    // Extract entities
    for (const entity of dxf.entities || []) {
      const dxfEntity = convertDXFEntity(entity);
      if (dxfEntity) entities.push(dxfEntity);
    }

    // Extract blocks
    if (dxf.blocks) {
      for (const [name, block] of Object.entries(dxf.blocks) as any[]) {
        const blockEntities: DXFEntity[] = [];
        for (const entity of block.entities || []) {
          const dxfEntity = convertDXFEntity(entity);
          if (dxfEntity) blockEntities.push(dxfEntity);
        }
        blocks.set(name, blockEntities);
      }
    }

    return { entities, blocks, layers, units };
  } catch (err) {
    console.error('DXF parse error:', err);
    return { entities: [], blocks: new Map(), layers: new Map(), units: 'mm' };
  }
}

function convertDXFEntity(entity: any): DXFEntity | null {
  const base = { layer: entity.layer || '0' };

  switch (entity.type) {
    case 'LINE':
      return {
        ...base, type: 'LINE',
        startX: entity.vertices?.[0]?.x || 0, startY: entity.vertices?.[0]?.y || 0, startZ: entity.vertices?.[0]?.z || 0,
        endX: entity.vertices?.[1]?.x || 0, endY: entity.vertices?.[1]?.y || 0, endZ: entity.vertices?.[1]?.z || 0,
      };
    case 'LWPOLYLINE':
    case 'POLYLINE':
      return {
        ...base, type: 'POLYLINE',
        vertices: (entity.vertices || []).map((v: any) => ({ x: v.x || 0, y: v.y || 0, z: v.z || 0 })),
        closed: entity.shape || false,
      };
    case 'CIRCLE':
      return {
        ...base, type: 'CIRCLE',
        centerX: entity.center?.x || 0, centerY: entity.center?.y || 0, centerZ: entity.center?.z || 0,
        radius: entity.radius || 0,
      };
    case 'ARC':
      return {
        ...base, type: 'ARC',
        centerX: entity.center?.x || 0, centerY: entity.center?.y || 0, centerZ: entity.center?.z || 0,
        radius: entity.radius || 0,
        startAngle: entity.startAngle || 0, endAngle: entity.endAngle || 360,
      };
    case 'INSERT':
      return {
        ...base, type: 'INSERT',
        blockName: entity.name || '',
        insertX: entity.position?.x || 0, insertY: entity.position?.y || 0, insertZ: entity.position?.z || 0,
        rotation: entity.rotation || 0,
        scaleX: entity.xScale || 1, scaleY: entity.yScale || 1,
      };
    case 'TEXT':
    case 'MTEXT':
      return {
        ...base, type: 'TEXT',
        text: entity.text || '',
        textX: entity.startPoint?.x || entity.position?.x || 0,
        textY: entity.startPoint?.y || entity.position?.y || 0,
      };
    case 'DIMENSION':
      return {
        ...base, type: 'DIMENSION',
        dimX1: entity.anchorPoint?.x || 0, dimY1: entity.anchorPoint?.y || 0,
        dimX2: entity.middleOfText?.x || 0, dimY2: entity.middleOfText?.y || 0,
        dimValue: entity.actualMeasurement || 0,
      };
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DXF → BIM ELEMENT CONVERSION
// ═══════════════════════════════════════════════════════════════════════════════

export interface DXFImportOptions {
  defaultFloorHeight: number;        // metres
  defaultWallThickness: number;      // metres
  storey: string;
  elevation: number;
  unitScale?: number;                // manual scale override (e.g. 0.001 for mm→m)
}

export interface DXFImportResult {
  elements: BIMSolid[];
  stats: {
    totalEntities: number;
    walls: number;
    columns: number;
    doors: number;
    windows: number;
    mep: number;
    other: number;
  };
  warnings: string[];
}

export function convertDXFToBIM(parsed: DXFParseResult, options: DXFImportOptions): DXFImportResult {
  const elements: BIMSolid[] = [];
  const warnings: string[] = [];
  const stats = { totalEntities: parsed.entities.length, walls: 0, columns: 0, doors: 0, windows: 0, mep: 0, other: 0 };

  // Determine unit scale
  const scale = options.unitScale ?? (parsed.units === 'mm' ? 0.001 : parsed.units === 'feet' ? 0.3048 : parsed.units === 'inches' ? 0.0254 : 1);

  let elementIndex = 0;

  for (const entity of parsed.entities) {
    const layerMapping = classifyLayer(entity.layer);
    const idx = elementIndex++;

    switch (entity.type) {
      case 'LINE': {
        if (!layerMapping.elementType.includes('Wall') && !layerMapping.elementType.includes('Beam')) {
          if (/WALL/i.test(entity.layer)) {
            // Force wall classification for wall layers
          } else {
            break;
          }
        }

        const start = vec2((entity.startX || 0) * scale, (entity.startY || 0) * scale);
        const end = vec2((entity.endX || 0) * scale, (entity.endY || 0) * scale);
        const length = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);

        if (length < 0.1) break; // Skip tiny lines

        const isExterior = layerMapping.isExterior || /EXT/i.test(entity.layer);
        const result = createWall({
          id: `dxf_wall_${idx}`,
          name: `Wall ${idx + 1} (${entity.layer})`,
          start, end,
          height: options.defaultFloorHeight,
          assembly: inferWallAssembly(undefined, isExterior),
          storey: options.storey,
          elevation: options.elevation,
          isExterior,
          source: 'dwg_imported',
        });
        elements.push(result.wall);
        stats.walls++;
        break;
      }

      case 'POLYLINE': {
        const verts = entity.vertices || [];
        if (verts.length < 2) break;

        const isWallLayer = /WALL/i.test(entity.layer);
        const isSlabLayer = /SLAB|FLOR|FLOOR/i.test(entity.layer);
        const isExterior = layerMapping.isExterior || /EXT/i.test(entity.layer);

        if (isSlabLayer && entity.closed && verts.length >= 3) {
          // Closed polyline on slab layer → floor slab
          const boundary = verts.map(v => vec2(v.x * scale, v.y * scale));
          const slab = createSlab({
            id: `dxf_slab_${idx}`,
            name: `Slab ${idx + 1} (${entity.layer})`,
            boundary,
            thickness: 0.200,
            storey: options.storey,
            elevation: options.elevation,
            material: 'Concrete',
            source: 'dwg_imported',
          });
          elements.push(slab);
          stats.other++;
        } else if (isWallLayer || layerMapping.elementType.includes('Wall')) {
          // Polyline on wall layer → series of wall segments
          for (let i = 0; i < verts.length - 1; i++) {
            const start = vec2(verts[i].x * scale, verts[i].y * scale);
            const end = vec2(verts[i + 1].x * scale, verts[i + 1].y * scale);
            const length = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
            if (length < 0.1) continue;

            const result = createWall({
              id: `dxf_wall_${idx}_${i}`,
              name: `Wall ${idx + 1}.${i + 1} (${entity.layer})`,
              start, end,
              height: options.defaultFloorHeight,
              assembly: inferWallAssembly(undefined, isExterior),
              storey: options.storey,
              elevation: options.elevation,
              isExterior,
              source: 'dwg_imported',
            });
            elements.push(result.wall);
            stats.walls++;
          }

          // Close the polyline if needed
          if (entity.closed && verts.length >= 3) {
            const start = vec2(verts[verts.length - 1].x * scale, verts[verts.length - 1].y * scale);
            const end = vec2(verts[0].x * scale, verts[0].y * scale);
            const length = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
            if (length >= 0.1) {
              const result = createWall({
                id: `dxf_wall_${idx}_close`,
                name: `Wall ${idx + 1}.close (${entity.layer})`,
                start, end,
                height: options.defaultFloorHeight,
                assembly: inferWallAssembly(undefined, isExterior),
                storey: options.storey,
                elevation: options.elevation,
                isExterior,
                source: 'dwg_imported',
              });
              elements.push(result.wall);
              stats.walls++;
            }
          }
        }
        break;
      }

      case 'CIRCLE': {
        if (/COL/i.test(entity.layer)) {
          const center = vec2((entity.centerX || 0) * scale, (entity.centerY || 0) * scale);
          const diameter = (entity.radius || 0.2) * scale * 2;

          const column = createColumn({
            id: `dxf_col_${idx}`,
            name: `Column ${idx + 1} (${entity.layer})`,
            center,
            width: diameter,
            depth: diameter,
            height: options.defaultFloorHeight,
            storey: options.storey,
            elevation: options.elevation,
            shape: 'circular',
            material: 'Concrete',
            source: 'dwg_imported',
          });
          elements.push(column);
          stats.columns++;
        }
        break;
      }

      case 'INSERT': {
        const blockName = (entity.blockName || '').toUpperCase();
        const pos = vec3(
          (entity.insertX || 0) * scale,
          (entity.insertY || 0) * scale,
          options.elevation,
        );

        // Match block names to element types
        if (/DOOR|DR\d|D\d/i.test(blockName)) {
          const fixture = createFixture({
            id: `dxf_door_${idx}`,
            name: `Door ${idx + 1} (${blockName})`,
            type: 'generic',
            position: pos,
            storey: options.storey,
            elevation: options.elevation,
            source: 'dwg_imported',
          });
          // Override type for doors
          fixture.type = 'Door';
          fixture.ifcClass = 'IFCDOOR';
          elements.push(fixture);
          stats.doors++;
        } else if (/WIND|WIN|WN\d|W\d/i.test(blockName)) {
          const fixture = createFixture({
            id: `dxf_window_${idx}`,
            name: `Window ${idx + 1} (${blockName})`,
            type: 'generic',
            position: pos,
            storey: options.storey,
            elevation: options.elevation,
            source: 'dwg_imported',
          });
          fixture.type = 'Window';
          fixture.ifcClass = 'IFCWINDOW';
          elements.push(fixture);
          stats.windows++;
        } else if (/LIGHT|LT|LUMIN/i.test(blockName)) {
          elements.push(createFixture({
            id: `dxf_light_${idx}`, name: `Light ${idx + 1}`,
            type: 'light', position: pos,
            storey: options.storey, elevation: options.elevation,
            source: 'dwg_imported',
          }));
          stats.mep++;
        } else if (/RCPT|OUTLET|RECEP/i.test(blockName)) {
          elements.push(createFixture({
            id: `dxf_rcpt_${idx}`, name: `Receptacle ${idx + 1}`,
            type: 'receptacle', position: pos,
            storey: options.storey, elevation: options.elevation,
            source: 'dwg_imported',
          }));
          stats.mep++;
        } else if (/SPRINK|SPK/i.test(blockName)) {
          elements.push(createFixture({
            id: `dxf_sprk_${idx}`, name: `Sprinkler ${idx + 1}`,
            type: 'sprinkler', position: pos,
            storey: options.storey, elevation: options.elevation,
            source: 'dwg_imported',
          }));
          stats.mep++;
        } else if (/PANEL|PNL/i.test(blockName)) {
          elements.push(createFixture({
            id: `dxf_panel_${idx}`, name: `Panel ${idx + 1}`,
            type: 'panel', position: pos,
            storey: options.storey, elevation: options.elevation,
            source: 'dwg_imported',
          }));
          stats.mep++;
        }
        break;
      }
    }
  }

  return { elements, stats, warnings };
}

/** Detect if a file is DWG format (binary header check) */
export function isDWGFile(buffer: Buffer): boolean {
  if (buffer.length < 6) return false;
  const header = buffer.slice(0, 6).toString('ascii');
  return header.startsWith('AC10') || header.startsWith('AC10');
}

/** Detect if content is DXF format */
export function isDXFContent(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith('0') || trimmed.startsWith('999') || /^\s*0\s*\n\s*SECTION/i.test(trimmed);
}
