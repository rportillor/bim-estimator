/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  IFC4 IMPORT ENGINE — Parse STEP files into BIMSolid geometry
 *  Supports IFC4 (ISO 16739-1:2018) STEP-encoded files.
 *  Extracts:
 *  - Spatial hierarchy (Project → Site → Building → Storey → Elements)
 *  - Geometry representations (ExtrudedAreaSolid, SweptSolid, Brep)
 *  - Property sets and quantity sets
 *  - Material associations
 *  - Element relationships (host/void, aggregation)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import {
  type Vec2, type Vec3, type Mesh, type Profile2D,
  vec2, vec3, v3add, v3sub, v3scale, v3normalize, v3cross, v3len,
  rectProfile, circleProfile, iProfile,
  extrudeProfile, createBox, createCylinder,
  mergeMeshes, transformMesh, meshBoundingBox, meshVolume, meshSurfaceArea, meshLateralArea,
  mat4Identity, mat4Translation, mat4RotationZ, mat4RotationX, mat4RotationY, mat4Mul, mat4TransformPoint,
  type Mat4, emptyMesh, serializeMesh,
} from './geometry-kernel';

import {
  type BIMSolid, type WallAssembly, WALL_ASSEMBLIES,
  inferWallAssembly, serializeBIMSolid,
} from './parametric-elements';

// ═══════════════════════════════════════════════════════════════════════════════
//  STEP PARSER — Tokenize and parse IFC STEP file
// ═══════════════════════════════════════════════════════════════════════════════

interface StepEntity {
  id: number;
  type: string;
  args: any[];
}

interface ParsedIFC {
  entities: Map<number, StepEntity>;
  schema: string;
  fileName?: string;
}

/** Parse an IFC STEP file into entity map */
export function parseSTEP(content: string): ParsedIFC {
  const entities = new Map<number, StepEntity>();
  let schema = 'IFC4';

  // Extract schema
  const schemaMatch = content.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/);
  if (schemaMatch) schema = schemaMatch[1];

  // Parse DATA section
  const dataMatch = content.match(/DATA\s*;([\s\S]*?)ENDSEC\s*;/);
  if (!dataMatch) return { entities, schema };

  const dataSection = dataMatch[1];

  // Parse each entity line: #id=ENTITY_TYPE(args);
  const entityRegex = /#(\d+)\s*=\s*(\w+)\s*\(([\s\S]*?)\)\s*;/g;
  let match;

  while ((match = entityRegex.exec(dataSection)) !== null) {
    const id = parseInt(match[1]);
    const type = match[2].toUpperCase();
    const argsStr = match[3];

    try {
      const args = parseSTEPArgs(argsStr);
      entities.set(id, { id, type, args });
    } catch {
      // Skip malformed entities
      entities.set(id, { id, type, args: [] });
    }
  }

  return { entities, schema };
}

function parseSTEPArgs(str: string): any[] {
  const args: any[] = [];
  let depth = 0;
  let current = '';
  let inString = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (ch === "'" && !inString) {
      inString = true;
      current += ch;
    } else if (ch === "'" && inString) {
      // Check for escaped quote ''
      if (i + 1 < str.length && str[i + 1] === "'") {
        current += "''";
        i++;
      } else {
        inString = false;
        current += ch;
      }
    } else if (inString) {
      current += ch;
    } else if (ch === '(') {
      if (depth === 0) {
        current = '';
        depth++;
      } else {
        current += ch;
        depth++;
      }
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        // Parse the sub-list
        args.push(parseSTEPArgs(current));
        current = '';
      } else {
        current += ch;
      }
    } else if (ch === ',' && depth === 0) {
      args.push(parseSTEPValue(current.trim()));
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    args.push(parseSTEPValue(current.trim()));
  }

  return args;
}

function parseSTEPValue(val: string): any {
  if (val === '$') return null;
  if (val === '*') return undefined;
  if (val === '.T.') return true;
  if (val === '.F.') return false;

  // Enum value
  if (val.startsWith('.') && val.endsWith('.')) return val.slice(1, -1);

  // Entity reference
  if (val.startsWith('#')) return { ref: parseInt(val.slice(1)) };

  // String
  if (val.startsWith("'") && val.endsWith("'")) return val.slice(1, -1).replace(/''/g, "'");

  // Number
  const num = Number(val);
  if (!isNaN(num)) return num;

  // Typed value like IFCLENGTHMEASURE(0.3)
  const typedMatch = val.match(/^(\w+)\((.+)\)$/);
  if (typedMatch) {
    const innerVal = parseSTEPValue(typedMatch[2].trim());
    return { type: typedMatch[1], value: innerVal };
  }

  return val;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  IFC ENTITY RESOLVERS
// ═══════════════════════════════════════════════════════════════════════════════

function resolveRef(entities: Map<number, StepEntity>, val: any): StepEntity | null {
  if (!val || typeof val !== 'object' || !('ref' in val)) return null;
  return entities.get(val.ref) || null;
}

function resolveString(val: any): string {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && 'value' in val) return String(val.value);
  return '';
}

function resolveNumber(val: any): number {
  if (typeof val === 'number') return val;
  if (val && typeof val === 'object' && 'value' in val) return Number(val.value) || 0;
  return 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GEOMETRY EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

function resolveCartesianPoint(entities: Map<number, StepEntity>, ref: any): Vec3 {
  const entity = resolveRef(entities, ref);
  if (!entity || entity.type !== 'IFCCARTESIANPOINT') return vec3(0, 0, 0);
  const coords = entity.args[0];
  if (Array.isArray(coords)) {
    return vec3(
      Number(coords[0]) || 0,
      Number(coords[1]) || 0,
      coords.length > 2 ? (Number(coords[2]) || 0) : 0,
    );
  }
  return vec3(0, 0, 0);
}

function resolveDirection(entities: Map<number, StepEntity>, ref: any): Vec3 {
  const entity = resolveRef(entities, ref);
  if (!entity || entity.type !== 'IFCDIRECTION') return vec3(0, 0, 1);
  const coords = entity.args[0];
  if (Array.isArray(coords)) {
    return v3normalize(vec3(
      Number(coords[0]) || 0,
      Number(coords[1]) || 0,
      coords.length > 2 ? (Number(coords[2]) || 0) : 0,
    ));
  }
  return vec3(0, 0, 1);
}

function resolveAxis2Placement3D(entities: Map<number, StepEntity>, ref: any): Mat4 {
  const entity = resolveRef(entities, ref);
  if (!entity) return mat4Identity();

  const location = resolveCartesianPoint(entities, entity.args[0]);
  const zDir = entity.args[1] ? resolveDirection(entities, entity.args[1]) : vec3(0, 0, 1);
  const xDir = entity.args[2] ? resolveDirection(entities, entity.args[2]) : vec3(1, 0, 0);
  const yDir = v3cross(zDir, xDir);

  const m = new Float64Array(16);
  m[0] = xDir.x; m[1] = xDir.y; m[2] = xDir.z;
  m[4] = yDir.x; m[5] = yDir.y; m[6] = yDir.z;
  m[8] = zDir.x; m[9] = zDir.y; m[10] = zDir.z;
  m[12] = location.x; m[13] = location.y; m[14] = location.z;
  m[15] = 1;
  return { m };
}

function resolveLocalPlacement(entities: Map<number, StepEntity>, ref: any): Mat4 {
  const entity = resolveRef(entities, ref);
  if (!entity || entity.type !== 'IFCLOCALPLACEMENT') return mat4Identity();

  const parentRef = entity.args[0];
  const relPlacement = resolveAxis2Placement3D(entities, entity.args[1]);

  if (parentRef) {
    const parentMat = resolveLocalPlacement(entities, parentRef);
    return mat4Mul(parentMat, relPlacement);
  }
  return relPlacement;
}

function resolveProfile(entities: Map<number, StepEntity>, ref: any): Profile2D {
  const entity = resolveRef(entities, ref);
  if (!entity) return rectProfile(1, 1);

  switch (entity.type) {
    case 'IFCRECTANGLEPROFILEDEF': {
      const xDim = resolveNumber(entity.args[2]) || 1;
      const yDim = resolveNumber(entity.args[3]) || 1;
      return rectProfile(xDim, yDim);
    }
    case 'IFCCIRCLEPROFILEDEF': {
      const radius = resolveNumber(entity.args[2]) || 0.5;
      return circleProfile(radius, 24);
    }
    case 'IFCISHAPEPROFILEDEF': {
      const w = resolveNumber(entity.args[2]) || 0.3;
      const h = resolveNumber(entity.args[3]) || 0.3;
      const tw = resolveNumber(entity.args[4]) || 0.01;
      const tf = resolveNumber(entity.args[5]) || 0.015;
      return iProfile(w, h, tw, tf);
    }
    case 'IFCARBITRARYCLOSEDPROFILEDEF': {
      // Parse polyline
      const curveRef = entity.args[1];
      const curve = resolveRef(entities, curveRef);
      if (curve && curve.type === 'IFCPOLYLINE') {
        const pts: Vec2[] = [];
        for (const ptRef of curve.args[0] || []) {
          const pt = resolveCartesianPoint(entities, ptRef);
          pts.push(vec2(pt.x, pt.y));
        }
        if (pts.length >= 3) return { outer: pts, holes: [] };
      }
      return rectProfile(1, 1);
    }
    default:
      return rectProfile(1, 1);
  }
}

function resolveRepresentationGeometry(entities: Map<number, StepEntity>, productEntity: StepEntity): Mesh {
  // Find the product's representation
  const repRef = productEntity.args[6]; // ObjectPlacement at [5], Representation at [6]
  const repEntity = resolveRef(entities, repRef);
  if (!repEntity) return emptyMesh();

  // IFCPRODUCTDEFINITIONSHAPE → Representations list
  const reps = repEntity.args[2]; // Representations
  if (!Array.isArray(reps)) return emptyMesh();

  for (const repItemRef of reps) {
    const repItem = resolveRef(entities, repItemRef);
    if (!repItem) continue;

    // IFCSHAPEREPRESENTATION
    const repType = resolveString(repItem.args[1]); // 'Body', 'Axis', etc.
    if (repType !== 'Body' && repType !== 'SweptSolid') continue;

    const items = repItem.args[3]; // Items
    if (!Array.isArray(items)) continue;

    const meshes: Mesh[] = [];
    for (const itemRef of items) {
      const item = resolveRef(entities, itemRef);
      if (!item) continue;

      const m = resolveGeometryItem(entities, item);
      if (m.triangles.length > 0) meshes.push(m);
    }

    if (meshes.length > 0) return mergeMeshes(...meshes);
  }

  return emptyMesh();
}

function resolveGeometryItem(entities: Map<number, StepEntity>, item: StepEntity): Mesh {
  switch (item.type) {
    case 'IFCEXTRUDEDAREASOLID': {
      const profile = resolveProfile(entities, item.args[0]);
      const position = resolveAxis2Placement3D(entities, item.args[1]);
      const direction = item.args[2] ? resolveDirection(entities, item.args[2]) : vec3(0, 0, 1);
      const depth = resolveNumber(item.args[3]) || 1;

      let mesh = extrudeProfile(profile, depth, direction);
      mesh = transformMesh(mesh, position);
      return mesh;
    }

    case 'IFCFACETEDBREP': {
      // Parse closed shell
      const shellRef = item.args[0];
      const shell = resolveRef(entities, shellRef);
      if (!shell) return emptyMesh();
      return parseBrepShell(entities, shell);
    }

    case 'IFCBOOLEANCLIPPINGRESULT':
    case 'IFCBOOLEANRESULT': {
      // Simplified: just use the first operand
      const firstOp = resolveRef(entities, item.args[1]);
      if (firstOp) return resolveGeometryItem(entities, firstOp);
      return emptyMesh();
    }

    case 'IFCMAPPEDITEM': {
      const sourceRef = resolveRef(entities, item.args[0]);
      const targetRef = item.args[1];
      if (!sourceRef) return emptyMesh();

      // IFCREPRESENTATIONMAP
      const mapOrigin = resolveAxis2Placement3D(entities, sourceRef.args[0]);
      const mapRep = resolveRef(entities, sourceRef.args[1]);
      if (!mapRep) return emptyMesh();

      // Process mapped representation items
      const meshes: Mesh[] = [];
      const repItems = mapRep.args[3];
      if (Array.isArray(repItems)) {
        for (const ri of repItems) {
          const riEntity = resolveRef(entities, ri);
          if (riEntity) {
            meshes.push(resolveGeometryItem(entities, riEntity));
          }
        }
      }

      let mesh = mergeMeshes(...meshes);
      mesh = transformMesh(mesh, mapOrigin);

      // Apply target transform
      if (targetRef) {
        const targetEntity = resolveRef(entities, targetRef);
        if (targetEntity && targetEntity.type === 'IFCCARTESIANTRANSFORMATIONOPERATOR3D') {
          const targetMat = resolveCartesianTransform(entities, targetEntity);
          mesh = transformMesh(mesh, targetMat);
        }
      }

      return mesh;
    }

    default:
      return emptyMesh();
  }
}

function parseBrepShell(entities: Map<number, StepEntity>, shell: StepEntity): Mesh {
  const faces = shell.args[0]; // CfsFaces
  if (!Array.isArray(faces)) return emptyMesh();

  const tris: any[] = [];
  for (const faceRef of faces) {
    const face = resolveRef(entities, faceRef);
    if (!face) continue;

    // IFCFACE → Bounds
    const bounds = face.args[0];
    if (!Array.isArray(bounds)) continue;

    for (const boundRef of bounds) {
      const bound = resolveRef(entities, boundRef);
      if (!bound) continue;

      // IFCFACEOUTERBOUND or IFCFACEBOUND → Bound (loop)
      const loopRef = bound.args[0];
      const loop = resolveRef(entities, loopRef);
      if (!loop) continue;

      // IFCPOLYLOOP → Polygon
      if (loop.type === 'IFCPOLYLOOP') {
        const pts: Vec3[] = [];
        for (const ptRef of loop.args[0] || []) {
          pts.push(resolveCartesianPoint(entities, ptRef));
        }

        // Fan triangulation of the face polygon
        for (let i = 1; i < pts.length - 1; i++) {
          const { createTriangle } = require('./geometry-kernel');
          tris.push(createTriangle(pts[0], pts[i], pts[i + 1]));
        }
      }
    }
  }

  return { triangles: tris };
}

function resolveCartesianTransform(entities: Map<number, StepEntity>, entity: StepEntity): Mat4 {
  // Simplified transform operator
  const origin = entity.args[3] ? resolveCartesianPoint(entities, entity.args[3]) : vec3(0, 0, 0);
  return mat4Translation(origin);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PROPERTY & QUANTITY EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

interface ExtractedProperties {
  material?: string;
  properties: Record<string, any>;
  quantities: Record<string, number>;
}

function extractProperties(entities: Map<number, StepEntity>, elementId: number): ExtractedProperties {
  const props: Record<string, any> = {};
  const quantities: Record<string, number> = {};
  let material: string | undefined;

  // Find IFCRELDEFINESBYPROPERTIES targeting this element
  for (const [, entity] of entities) {
    if (entity.type === 'IFCRELDEFINESBYPROPERTIES') {
      const relatedObjects = entity.args[4]; // RelatedObjects
      if (!Array.isArray(relatedObjects)) continue;

      const matches = relatedObjects.some((r: any) => r?.ref === elementId);
      if (!matches) continue;

      const defRef = entity.args[5]; // RelatingPropertyDefinition
      const def = resolveRef(entities, defRef);
      if (!def) continue;

      if (def.type === 'IFCPROPERTYSET') {
        const psetProps = def.args[4]; // HasProperties
        if (Array.isArray(psetProps)) {
          for (const propRef of psetProps) {
            const prop = resolveRef(entities, propRef);
            if (prop && prop.type === 'IFCPROPERTYSINGLEVALUE') {
              const name = resolveString(prop.args[0]);
              const val = prop.args[2];
              props[name] = val?.value ?? val;
            }
          }
        }
      } else if (def.type === 'IFCELEMENTQUANTITY') {
        const qProps = def.args[5]; // Quantities
        if (Array.isArray(qProps)) {
          for (const qRef of qProps) {
            const q = resolveRef(entities, qRef);
            if (!q) continue;
            const name = resolveString(q.args[0]);
            if (['IFCQUANTITYLENGTH', 'IFCQUANTITYAREA', 'IFCQUANTITYVOLUME', 'IFCQUANTITYWEIGHT'].includes(q.type)) {
              quantities[name] = resolveNumber(q.args[3]);
            }
          }
        }
      }
    }

    // Material associations
    if (entity.type === 'IFCRELASSOCIATESMATERIAL') {
      const relatedObjects = entity.args[4];
      if (!Array.isArray(relatedObjects)) continue;
      const matches = relatedObjects.some((r: any) => r?.ref === elementId);
      if (!matches) continue;

      const matRef = entity.args[5];
      const mat = resolveRef(entities, matRef);
      if (mat) {
        if (mat.type === 'IFCMATERIAL') {
          material = resolveString(mat.args[0]);
        } else if (mat.type === 'IFCMATERIALLAYERSETUSAGE') {
          const layerSetRef = mat.args[0];
          const layerSet = resolveRef(entities, layerSetRef);
          if (layerSet && layerSet.type === 'IFCMATERIALLAYERSET') {
            const layers = layerSet.args[0];
            if (Array.isArray(layers) && layers.length > 0) {
              const firstLayer = resolveRef(entities, layers[0]);
              if (firstLayer) {
                const layerMat = resolveRef(entities, firstLayer.args[0]);
                if (layerMat) material = resolveString(layerMat.args[0]);
              }
            }
          }
        }
      }
    }
  }

  return { material, properties: props, quantities };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SPATIAL HIERARCHY EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

interface StoreyInfo {
  name: string;
  elevation: number;
  entityId: number;
}

function extractStoreys(parsed: ParsedIFC): StoreyInfo[] {
  const storeys: StoreyInfo[] = [];
  for (const [id, entity] of parsed.entities) {
    if (entity.type === 'IFCBUILDINGSTOREY') {
      storeys.push({
        name: resolveString(entity.args[2]) || `Level ${storeys.length + 1}`,
        elevation: resolveNumber(entity.args[9]),
        entityId: id,
      });
    }
  }
  return storeys.sort((a, b) => a.elevation - b.elevation);
}

function findElementStorey(parsed: ParsedIFC, elementId: number, storeys: StoreyInfo[]): StoreyInfo | null {
  // Find IFCRELCONTAINEDINSPATIALSTRUCTURE
  for (const [, entity] of parsed.entities) {
    if (entity.type !== 'IFCRELCONTAINEDINSPATIALSTRUCTURE') continue;

    const elements = entity.args[4]; // RelatedElements
    if (!Array.isArray(elements)) continue;
    const matches = elements.some((r: any) => r?.ref === elementId);
    if (!matches) continue;

    const storeyRef = entity.args[5]; // RelatingStructure
    if (!storeyRef?.ref) continue;

    return storeys.find(s => s.entityId === storeyRef.ref) || null;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  IFC CLASS → BIM ELEMENT TYPE MAPPING
// ═══════════════════════════════════════════════════════════════════════════════

const IFC_CLASS_MAP: Record<string, { type: string; category: BIMSolid['category'] }> = {
  IFCWALL: { type: 'Wall', category: 'Architectural' },
  IFCWALLSTANDARDCASE: { type: 'Wall', category: 'Architectural' },
  IFCCURTAINWALL: { type: 'Curtain Wall', category: 'Architectural' },
  IFCSLAB: { type: 'Floor Slab', category: 'Structural' },
  IFCCOLUMN: { type: 'Column', category: 'Structural' },
  IFCBEAM: { type: 'Beam', category: 'Structural' },
  IFCDOOR: { type: 'Door', category: 'Architectural' },
  IFCWINDOW: { type: 'Window', category: 'Architectural' },
  IFCSTAIRFLIGHT: { type: 'Stair', category: 'Architectural' },
  IFCSTAIR: { type: 'Stair', category: 'Architectural' },
  IFCRAILING: { type: 'Railing', category: 'Architectural' },
  IFCRAMP: { type: 'Ramp', category: 'Architectural' },
  IFCROOF: { type: 'Roof', category: 'Architectural' },
  IFCFOOTING: { type: 'Footing', category: 'Structural' },
  IFCPILE: { type: 'Pile', category: 'Structural' },
  IFCDUCTSEGMENT: { type: 'Duct', category: 'MEP' },
  IFCPIPESEGMENT: { type: 'Pipe', category: 'MEP' },
  IFCCABLESEGMENT: { type: 'Cable', category: 'MEP' },
  IFCLIGHTFIXTURE: { type: 'Light', category: 'MEP' },
  IFCFLOWTERMINAL: { type: 'Terminal', category: 'MEP' },
  IFCELECTRICAPPLIANCE: { type: 'Electrical', category: 'MEP' },
  IFCFURNISHINGELEMENT: { type: 'Furniture', category: 'Architectural' },
  IFCCOVERING: { type: 'Covering', category: 'Architectural' },
  IFCBUILDINGELEMENTPROXY: { type: 'Proxy', category: 'Architectural' },
};

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN IMPORT FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

export interface IFCImportResult {
  elements: BIMSolid[];
  storeys: StoreyInfo[];
  projectName: string;
  buildingName: string;
  stats: {
    totalEntities: number;
    totalElements: number;
    withGeometry: number;
    withoutGeometry: number;
    byType: Record<string, number>;
    byStorey: Record<string, number>;
  };
}

/** Import an IFC4 STEP file and convert to BIMSolid array */
export function importIFC(content: string): IFCImportResult {
  const parsed = parseSTEP(content);
  const storeys = extractStoreys(parsed);

  // Extract project/building names
  let projectName = 'Imported Project';
  let buildingName = 'Building';
  for (const [, entity] of parsed.entities) {
    if (entity.type === 'IFCPROJECT') {
      projectName = resolveString(entity.args[2]) || projectName;
    }
    if (entity.type === 'IFCBUILDING') {
      buildingName = resolveString(entity.args[2]) || buildingName;
    }
  }

  // Collect all building elements
  const elementTypes = new Set(Object.keys(IFC_CLASS_MAP));
  const elements: BIMSolid[] = [];
  const stats = {
    totalEntities: parsed.entities.size,
    totalElements: 0,
    withGeometry: 0,
    withoutGeometry: 0,
    byType: {} as Record<string, number>,
    byStorey: {} as Record<string, number>,
  };

  for (const [id, entity] of parsed.entities) {
    if (!elementTypes.has(entity.type)) continue;

    stats.totalElements++;
    const mapping = IFC_CLASS_MAP[entity.type]!;

    // Extract placement
    const placementRef = entity.args[5]; // ObjectPlacement
    const placement = resolveLocalPlacement(parsed.entities, placementRef);

    // Extract geometry
    let mesh = resolveRepresentationGeometry(parsed.entities, entity);
    const hasGeometry = mesh.triangles.length > 0;

    if (hasGeometry) {
      // Apply placement transform
      mesh = transformMesh(mesh, placement);
      stats.withGeometry++;
    } else {
      // Fallback: create a box from property dimensions
      const { quantities } = extractProperties(parsed.entities, id);
      const w = quantities['Width'] || quantities['Length'] || 1;
      const h = quantities['Height'] || 3;
      const d = quantities['Depth'] || quantities['Thickness'] || 0.2;
      mesh = createBox(w, h, d);
      mesh = transformMesh(mesh, placement);
      stats.withoutGeometry++;
    }

    // Find storey
    const storey = findElementStorey(parsed, id, storeys);
    const storeyName = storey?.name || 'Level 1';
    const elevation = storey?.elevation || 0;

    // Extract properties and material
    const { material, properties, quantities } = extractProperties(parsed.entities, id);

    const name = resolveString(entity.args[2]) || `${mapping.type} ${id}`;
    const origin = mat4TransformPoint(placement, vec3(0, 0, 0));

    const vol = meshVolume(mesh);
    const surfArea = meshSurfaceArea(mesh);
    const latArea = meshLateralArea(mesh);
    const bb = meshBoundingBox(mesh);

    const bimSolid: BIMSolid = {
      id: `ifc_${id}`,
      type: mapping.type,
      name,
      category: mapping.category,
      storey: storeyName,
      elevation,
      mesh,
      boundingBox: bb,
      quantities: {
        volume: quantities['NetVolume'] || vol,
        surfaceArea: quantities['NetSurfaceArea'] || surfArea,
        lateralArea: quantities['NetSideArea'] || latArea,
        length: quantities['Length'] || quantities['NetLength'],
        width: quantities['Width'],
        height: quantities['Height'] || (bb.max.z - bb.min.z),
        thickness: quantities['Thickness'] || quantities['Width'],
        weight: quantities['NetWeight'],
        profileArea: quantities['CrossSectionArea'],
      },
      material: material || 'Unknown',
      hostedIds: [],
      connectedIds: [],
      origin,
      rotation: 0,
      ifcClass: entity.type,
      ifcGuid: resolveString(entity.args[0]) || `ifc_${id}`,
      source: 'ifc_imported',
    };

    // Merge extracted properties
    Object.assign(bimSolid, { properties });

    elements.push(bimSolid);

    // Stats
    stats.byType[mapping.type] = (stats.byType[mapping.type] || 0) + 1;
    stats.byStorey[storeyName] = (stats.byStorey[storeyName] || 0) + 1;
  }

  // Resolve host/void relationships
  resolveHostRelationships(parsed, elements);

  return { elements, storeys, projectName, buildingName, stats };
}

function resolveHostRelationships(parsed: ParsedIFC, elements: BIMSolid[]): void {
  const elementMap = new Map(elements.map(e => [e.id, e]));

  for (const [, entity] of parsed.entities) {
    // IFCRELVOIDSELEMENT — door/window voids in walls
    if (entity.type === 'IFCRELVOIDSELEMENT') {
      const hostRef = entity.args[4]; // RelatingBuildingElement
      const voidRef = entity.args[5]; // RelatedOpeningElement
      if (hostRef?.ref && voidRef?.ref) {
        const host = elementMap.get(`ifc_${hostRef.ref}`);
        const void_ = elementMap.get(`ifc_${voidRef.ref}`);
        if (host && void_) {
          void_.hostId = host.id;
          host.hostedIds.push(void_.id);
        }
      }
    }

    // IFCRELFILLSELEMENT — opening filled by door/window
    if (entity.type === 'IFCRELFILLSELEMENT') {
      const openingRef = entity.args[4];
      const fillingRef = entity.args[5];
      if (openingRef?.ref && fillingRef?.ref) {
        const filling = elementMap.get(`ifc_${fillingRef.ref}`);
        if (filling) {
          // Find the wall that hosts this opening
          for (const [, e2] of parsed.entities) {
            if (e2.type === 'IFCRELVOIDSELEMENT' && e2.args[5]?.ref === openingRef.ref) {
              const wallId = `ifc_${e2.args[4]?.ref}`;
              const wall = elementMap.get(wallId);
              if (wall) {
                filling.hostId = wall.id;
                wall.hostedIds.push(filling.id);
              }
            }
          }
        }
      }
    }
  }
}
