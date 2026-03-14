/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  IFC4 EXPORT ENGINE — TypeScript STEP Serializer
 *  Production-grade IFC export from BIM model elements.
 *  Generates valid IFC4 (ISO 16739-1:2018) STEP files with:
 *  - Full header per ISO 10303-21
 *  - IFCPROJECT → IFCSITE → IFCBUILDING → IFCBUILDINGSTOREY hierarchy
 *  - Proper entity mapping: walls, slabs, columns, beams, doors, windows, MEP
 *  - Extruded solid geometry (IFCEXTRUDEDAREASOLID)
 *  - Material associations (IFCMATERIAL → IFCRELASSOCIATESMATERIAL)
 *  - Property sets (IFCPROPERTYSET → IFCRELDEFINESBYPROPERTIES)
 *  - Quantity sets (IFCELEMENTQUANTITY)
 *  - Spatial containment (IFCRELCONTAINEDINSPATIALSTRUCTURE)
 *  - Owner history and application identity
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface IFCBIMElement {
  id: string;
  elementType?: string;
  type?: string;
  name?: string;
  storey?: string;
  storeyIndex?: number;
  properties?: Record<string, any>;
  geometry?: {
    location?: { realLocation?: { x: number; y: number; z: number } };
    dimensions?: {
      length?: number;
      width?: number;
      height?: number;
      thickness?: number;
      depth?: number;
      area?: number;
      volume?: number;
    };
  };
  material?: string;
  csiDivision?: string;
}

export interface IFCExportOptions {
  projectName?: string;
  projectId?: string;
  description?: string;
  author?: string;
  organization?: string;
  unitSystem?: "metric" | "imperial";
  includeQuantities?: boolean;
  includeProperties?: boolean;
  includeMaterials?: boolean;
  coordinationView?: boolean;
  floorToFloorHeight?: number;
}

export interface IFCExportStats {
  totalElements: number;
  byIFCClass: Record<string, number>;
  byStorey: Record<string, number>;
  withGeometry: number;
  withMaterial: number;
  entityCount: number;
  estimatedFileSize: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ENTITY ID ALLOCATOR
// ═══════════════════════════════════════════════════════════════════════════════

class EntityAllocator {
  private nextId = 1;
  allocate(): number {
    return this.nextId++;
  }
  current(): number {
    return this.nextId - 1;
  }
  total(): number {
    return this.nextId - 1;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STEP ENCODING HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function stepString(s: string | undefined | null): string {
  if (!s) return "$";
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function stepReal(n: number | undefined | null): string {
  if (n === undefined || n === null || isNaN(n)) return "0.";
  const fixed = n.toFixed(6);
  // Ensure decimal point exists for IFC compliance
  return fixed.includes(".") ? fixed : fixed + ".";
}

function stepRef(id: number): string {
  return `#${id}`;
}

function stepList(refs: number[]): string {
  if (refs.length === 0) return "()";
  return `(${refs.map(stepRef).join(",")})`;
}

/** Generate a 22-character IFC GlobalId (base64-ish encoding) */
function generateGUID(): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
  let result = "";
  for (let i = 0; i < 22; i++) {
    result += chars[Math.floor(Math.random() * 64)];
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  IFC ELEMENT TYPE MAPPER
// ═══════════════════════════════════════════════════════════════════════════════

export function mapToIFCClass(elementType: string): string {
  const t = (elementType || "").toUpperCase();
  if (/CURTAIN/.test(t)) return "IFCCURTAINWALL";
  if (/WALL/.test(t)) return "IFCWALL";
  if (/ROOF/.test(t)) return "IFCROOF";
  if (/(SLAB|FLOOR|DECK)/.test(t)) return "IFCSLAB";
  if (/COLUMN/.test(t)) return "IFCCOLUMN";
  if (/BEAM/.test(t)) return "IFCBEAM";
  if (/(FOOTING|FOUNDATION)/.test(t)) return "IFCFOOTING";
  if (/PILE/.test(t)) return "IFCPILE";
  if (/STAIR/.test(t)) return "IFCSTAIRFLIGHT";
  if (/RAMP/.test(t)) return "IFCRAMP";
  if (/DOOR/.test(t)) return "IFCDOOR";
  if (/WINDOW/.test(t)) return "IFCWINDOW";
  if (/RAILING/.test(t)) return "IFCRAILING";
  if (/(DUCT|HVAC)/.test(t)) return "IFCDUCTSEGMENT";
  if (/PIPE/.test(t)) return "IFCPIPESEGMENT";
  if (/(LIGHT|LUMINAIRE)/.test(t)) return "IFCLIGHTFIXTURE";
  if (/SPRINKLER/.test(t)) return "IFCFLOWTERMINAL";
  if (/(RECEPTACLE|OUTLET|SWITCH|PANEL)/.test(t)) return "IFCELECTRICAPPLIANCE";
  if (/(CABLE|WIRE|CONDUIT)/.test(t)) return "IFCCABLESEGMENT";
  if (/FURNISH/.test(t)) return "IFCFURNISHINGELEMENT";
  if (/(COVERING|INSULATION|MEMBRANE)/.test(t)) return "IFCCOVERING";
  return "IFCBUILDINGELEMENTPROXY";
}

function mapSlabPredefined(elementType: string): string {
  const t = (elementType || "").toUpperCase();
  if (/ROOF/.test(t)) return "ROOF";
  if (/LANDING/.test(t)) return "LANDING";
  if (/BASESLAB/.test(t)) return "BASESLAB";
  return "FLOOR";
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

export function generateIFC4Document(
  elements: IFCBIMElement[],
  options: IFCExportOptions = {}
): string {
  const alloc = new EntityAllocator();
  const lines: string[] = [];
  const o = {
    projectName: options.projectName || "EstimatorPro Export",
    projectId: options.projectId || generateGUID(),
    description: options.description || "BIM Model Export",
    author: options.author || "EstimatorPro v3",
    organization: options.organization || "CIQS Professional",
    unitSystem: options.unitSystem || "metric",
    includeQuantities: options.includeQuantities !== false,
    includeProperties: options.includeProperties !== false,
    includeMaterials: options.includeMaterials !== false,
    // N-1 FIX: No default for floorToFloorHeight. If absent, storey elevations
    // are set to 0.0 (ground plane) and flagged ELEVATION_UNKNOWN in the IFC file.
    // Callers must supply options.floorToFloorHeight from real drawing data.
    ftf: options.floorToFloorHeight ?? null,
  };

  function emit(id: number, entity: string): void {
    lines.push(`#${id}=${entity};`);
  }

  // ─────────────────────────────────────────────────────────────────────
  //  HEADER
  // ─────────────────────────────────────────────────────────────────────

  const header = [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView_V2.0]'),'2;1');",
    `FILE_NAME(${stepString(o.projectId + ".ifc")},'${new Date().toISOString()}',(${stepString(o.author)}),(${stepString(o.organization)}),'EstimatorPro v3','EstimatorPro IFC Export','');`,
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "",
    "DATA;",
  ].join("\n");

  // ─────────────────────────────────────────────────────────────────────
  //  PERSON / ORGANIZATION / APPLICATION / OWNER HISTORY
  // ─────────────────────────────────────────────────────────────────────

  const personId = alloc.allocate();
  emit(personId, `IFCPERSON($,$,${stepString(o.author)},$,$,$,$,$)`);

  const orgId = alloc.allocate();
  emit(
    orgId,
    `IFCORGANIZATION($,${stepString(o.organization)},${stepString("Construction estimation platform")},$,$)`
  );

  const personOrgId = alloc.allocate();
  emit(
    personOrgId,
    `IFCPERSONANDORGANIZATION(${stepRef(personId)},${stepRef(orgId)},$)`
  );

  const appId = alloc.allocate();
  emit(
    appId,
    `IFCAPPLICATION(${stepRef(orgId)},'3.0',${stepString("EstimatorPro")},'EP3')`
  );

  const ownerHistId = alloc.allocate();
  const ts = Math.floor(Date.now() / 1000);
  emit(
    ownerHistId,
    `IFCOWNERHISTORY(${stepRef(personOrgId)},${stepRef(appId)},$,.READWRITE.,$,$,$,${ts})`
  );

  // ─────────────────────────────────────────────────────────────────────
  //  UNITS
  // ─────────────────────────────────────────────────────────────────────

  const lengthUnitId = alloc.allocate();
  const areaUnitId = alloc.allocate();
  const volumeUnitId = alloc.allocate();
  const angleUnitId = alloc.allocate();
  const solidAngleUnitId = alloc.allocate();

  if (o.unitSystem === "metric") {
    emit(lengthUnitId, "IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)");
    emit(areaUnitId, "IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)");
    emit(volumeUnitId, "IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)");
  } else {
    // Imperial — conversion-based
    const baseMeter = alloc.allocate();
    emit(baseMeter, "IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)");
    const dimExp = alloc.allocate();
    emit(dimExp, "IFCDIMENSIONALEXPONENTS(1,0,0,0,0,0,0)");
    emit(
      lengthUnitId,
      `IFCCONVERSIONBASEDUNIT(${stepRef(dimExp)},.LENGTHUNIT.,'FOOT',IFCMEASUREWITHUNIT(IFCLENGTHMEASURE(0.3048),${stepRef(baseMeter)}))`
    );
    emit(areaUnitId, "IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)");
    emit(volumeUnitId, "IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)");
  }
  emit(angleUnitId, "IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)");
  emit(solidAngleUnitId, "IFCSIUNIT(*,.SOLIDANGLEUNIT.,$,.STERADIAN.)");

  const unitAssignId = alloc.allocate();
  emit(
    unitAssignId,
    `IFCUNITASSIGNMENT(${stepList([lengthUnitId, areaUnitId, volumeUnitId, angleUnitId, solidAngleUnitId])})`
  );

  // ─────────────────────────────────────────────────────────────────────
  //  GEOMETRIC CONTEXT
  // ─────────────────────────────────────────────────────────────────────

  const worldOriginId = alloc.allocate();
  emit(worldOriginId, "IFCCARTESIANPOINT((0.,0.,0.))");

  const zDirId = alloc.allocate();
  emit(zDirId, "IFCDIRECTION((0.,0.,1.))");

  const xDirId = alloc.allocate();
  emit(xDirId, "IFCDIRECTION((1.,0.,0.))");

  const worldAxisId = alloc.allocate();
  emit(
    worldAxisId,
    `IFCAXIS2PLACEMENT3D(${stepRef(worldOriginId)},${stepRef(zDirId)},${stepRef(xDirId)})`
  );

  const geomCtxId = alloc.allocate();
  emit(
    geomCtxId,
    `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,${stepRef(worldAxisId)},$)`
  );

  const bodyCtxId = alloc.allocate();
  emit(
    bodyCtxId,
    `IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${stepRef(geomCtxId)},$,.MODEL_VIEW.,$)`
  );

  // ─────────────────────────────────────────────────────────────────────
  //  PROJECT
  // ─────────────────────────────────────────────────────────────────────

  const projId = alloc.allocate();
  emit(
    projId,
    `IFCPROJECT('${generateGUID()}',${stepRef(ownerHistId)},${stepString(o.projectName)},${stepString(o.description)},$,$,$,(${stepRef(geomCtxId)}),${stepRef(unitAssignId)})`
  );

  // ─────────────────────────────────────────────────────────────────────
  //  SITE
  // ─────────────────────────────────────────────────────────────────────

  const sitePlaceId = alloc.allocate();
  emit(sitePlaceId, `IFCLOCALPLACEMENT($,${stepRef(worldAxisId)})`);

  const siteId = alloc.allocate();
  emit(
    siteId,
    `IFCSITE('${generateGUID()}',${stepRef(ownerHistId)},'Default Site',$,$,${stepRef(sitePlaceId)},$,$,.ELEMENT.,$,$,$,$,$)`
  );

  const relProjSiteId = alloc.allocate();
  emit(
    relProjSiteId,
    `IFCRELAGGREGATES('${generateGUID()}',${stepRef(ownerHistId)},$,$,${stepRef(projId)},(${stepRef(siteId)}))`
  );

  // ─────────────────────────────────────────────────────────────────────
  //  BUILDING
  // ─────────────────────────────────────────────────────────────────────

  const bldgPlaceId = alloc.allocate();
  emit(
    bldgPlaceId,
    `IFCLOCALPLACEMENT(${stepRef(sitePlaceId)},${stepRef(worldAxisId)})`
  );

  const bldgId = alloc.allocate();
  emit(
    bldgId,
    `IFCBUILDING('${generateGUID()}',${stepRef(ownerHistId)},${stepString(o.projectName)},$,$,${stepRef(bldgPlaceId)},$,$,.ELEMENT.,$,$,$)`
  );

  const relSiteBldgId = alloc.allocate();
  emit(
    relSiteBldgId,
    `IFCRELAGGREGATES('${generateGUID()}',${stepRef(ownerHistId)},$,$,${stepRef(siteId)},(${stepRef(bldgId)}))`
  );

  // ─────────────────────────────────────────────────────────────────────
  //  STOREYS
  // ─────────────────────────────────────────────────────────────────────

  const storeyNames = Array.from(
    new Set(elements.map((e) => e.storey || "Level 1"))
  ).sort((a, b) => {
    const ai = parseInt(a.replace(/\D/g, "")) || 0;
    const bi = parseInt(b.replace(/\D/g, "")) || 0;
    return ai - bi;
  });

  const storeyMap = new Map<
    string,
    { entityId: number; placementId: number; elevation: number }
  >();
  const storeyEntityIds: number[] = [];

  // N-1 FIX: log error if ftf is null so the caller can register an RFI
  if (o.ftf === null && storeyNames.length > 1) {
    console.error(
      "❌ [IFC-EXPORT] options.floorToFloorHeight was not supplied. " +
      "All storeys will be placed at elevation 0.0 (ground plane). " +
      "The caller must obtain floor-to-floor height from section drawings before exporting IFC. " +
      "Each storey will carry an ELEVATION_UNKNOWN property set flag."
    );
  }

  for (let i = 0; i < storeyNames.length; i++) {
    const name = storeyNames[i];
    // N-1 FIX: use real ftf only; null ftf → 0.0 for every storey
    const elevation = o.ftf !== null ? i * o.ftf : 0.0;
    const elevationKnown = o.ftf !== null;

    const ptId = alloc.allocate();
    emit(ptId, `IFCCARTESIANPOINT((0.,0.,${stepReal(elevation)}))`);

    const axId = alloc.allocate();
    emit(
      axId,
      `IFCAXIS2PLACEMENT3D(${stepRef(ptId)},${stepRef(zDirId)},${stepRef(xDirId)})`
    );

    const plId = alloc.allocate();
    emit(
      plId,
      `IFCLOCALPLACEMENT(${stepRef(bldgPlaceId)},${stepRef(axId)})`
    );

    const stId = alloc.allocate();
    emit(
      stId,
      `IFCBUILDINGSTOREY('${generateGUID()}',${stepRef(ownerHistId)},${stepString(name)},$,$,${stepRef(plId)},$,$,.ELEMENT.,${stepReal(elevation)})`
    );

    // N-1 FIX: flag unknown elevations in the IFC property set
    if (!elevationKnown) {
      const unknownPropId = alloc.allocate();
      emit(unknownPropId, `IFCPROPERTYSINGLEVALUE('ELEVATION_UNKNOWN',$,IFCBOOLEAN(.TRUE.),$)`);
      const unknownPsetId = alloc.allocate();
      emit(unknownPsetId, `IFCPROPERTYSET('${generateGUID()}',${stepRef(ownerHistId)},'EP_StoreyWarnings',$,(${stepRef(unknownPropId)}))`);
      const unknownRelId = alloc.allocate();
      emit(unknownRelId, `IFCRELDEFINESBYPROPERTIES('${generateGUID()}',${stepRef(ownerHistId)},$,$,(${stepRef(stId)}),${stepRef(unknownPsetId)})`);
    }
    storeyMap.set(name, { entityId: stId, placementId: plId, elevation });
    storeyEntityIds.push(stId);
  }

  if (storeyEntityIds.length > 0) {
    const relId = alloc.allocate();
    emit(
      relId,
      `IFCRELAGGREGATES('${generateGUID()}',${stepRef(ownerHistId)},$,$,${stepRef(bldgId)},${stepList(storeyEntityIds)})`
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  //  MATERIAL CACHE (dedup)
  // ─────────────────────────────────────────────────────────────────────

  const materialCache = new Map<string, number>();

  function getOrCreateMaterial(matName: string): number {
    if (materialCache.has(matName)) return materialCache.get(matName)!;
    const mId = alloc.allocate();
    emit(mId, `IFCMATERIAL(${stepString(matName)},$,$)`);
    materialCache.set(matName, mId);
    return mId;
  }

  // ─────────────────────────────────────────────────────────────────────
  //  ELEMENTS
  // ─────────────────────────────────────────────────────────────────────

  const elementsByStorey = new Map<string, number[]>();

  for (const elem of elements) {
    const storeyName = elem.storey || "Level 1";
    const si = storeyMap.get(storeyName);
    if (!si) continue;

    const ifcClass = mapToIFCClass(elem.elementType || elem.type || "");
    const elemName =
      elem.name ||
      elem.properties?.name ||
      elem.elementType ||
      elem.type ||
      "Element";

    const dims = elem.geometry?.dimensions || elem.properties?.dimensions || {};
    const loc = elem.geometry?.location?.realLocation || { x: 0, y: 0, z: 0 };

    // ── Placement ──────────────────────────────────────────────────────
    const ePtId = alloc.allocate();
    const relZ = loc.z - si.elevation;
    emit(ePtId, `IFCCARTESIANPOINT((${stepReal(loc.x)},${stepReal(loc.y)},${stepReal(relZ)}))`);

    const eAxId = alloc.allocate();
    emit(
      eAxId,
      `IFCAXIS2PLACEMENT3D(${stepRef(ePtId)},${stepRef(zDirId)},${stepRef(xDirId)})`
    );

    const ePlId = alloc.allocate();
    emit(
      ePlId,
      `IFCLOCALPLACEMENT(${stepRef(si.placementId)},${stepRef(eAxId)})`
    );

    // ── Geometry (extruded rectangle) ──────────────────────────────────
    let shapeDefId: number | null = null;
    const w = dims.width || dims.thickness || 0.2;
    const l = dims.length || dims.depth || 1.0;
    const h = dims.height || 3.0;

    if (w > 0 && l > 0 && h > 0) {
      const profOriginId = alloc.allocate();
      emit(profOriginId, "IFCCARTESIANPOINT((0.,0.))");

      const ax2d = alloc.allocate();
      emit(ax2d, `IFCAXIS2PLACEMENT2D(${stepRef(profOriginId)},$)`);

      const profId = alloc.allocate();
      emit(
        profId,
        `IFCRECTANGLEPROFILEDEF(.AREA.,$,${stepRef(ax2d)},${stepReal(l)},${stepReal(w)})`
      );

      const extDirId = alloc.allocate();
      emit(extDirId, "IFCDIRECTION((0.,0.,1.))");

      const extOriginId = alloc.allocate();
      emit(extOriginId, "IFCCARTESIANPOINT((0.,0.,0.))");

      const extAxId = alloc.allocate();
      emit(extAxId, `IFCAXIS2PLACEMENT3D(${stepRef(extOriginId)},$,$)`);

      const solidId = alloc.allocate();
      emit(
        solidId,
        `IFCEXTRUDEDAREASOLID(${stepRef(profId)},${stepRef(extAxId)},${stepRef(extDirId)},${stepReal(h)})`
      );

      const shapeRepId = alloc.allocate();
      emit(
        shapeRepId,
        `IFCSHAPEREPRESENTATION(${stepRef(bodyCtxId)},'Body','SweptSolid',(${stepRef(solidId)}))`
      );

      shapeDefId = alloc.allocate();
      emit(
        shapeDefId,
        `IFCPRODUCTDEFINITIONSHAPE($,$,(${stepRef(shapeRepId)}))`
      );
    }

    // ── Entity ─────────────────────────────────────────────────────────
    const eId = alloc.allocate();
    const shapeArg = shapeDefId ? stepRef(shapeDefId) : "$";
    const guid = generateGUID();

    switch (ifcClass) {
      case "IFCWALL":
        emit(eId, `IFCWALL('${guid}',${stepRef(ownerHistId)},${stepString(elemName)},$,$,${stepRef(ePlId)},${shapeArg},$,.NOTDEFINED.)`);
        break;
      case "IFCSLAB":
        emit(eId, `IFCSLAB('${guid}',${stepRef(ownerHistId)},${stepString(elemName)},$,$,${stepRef(ePlId)},${shapeArg},$,.${mapSlabPredefined(elem.elementType || "")}.)`);
        break;
      case "IFCCOLUMN":
        emit(eId, `IFCCOLUMN('${guid}',${stepRef(ownerHistId)},${stepString(elemName)},$,$,${stepRef(ePlId)},${shapeArg},$,.COLUMN.)`);
        break;
      case "IFCBEAM":
        emit(eId, `IFCBEAM('${guid}',${stepRef(ownerHistId)},${stepString(elemName)},$,$,${stepRef(ePlId)},${shapeArg},$,.BEAM.)`);
        break;
      case "IFCDOOR": {
        const dh = dims.height || 2.1;
        const dw = dims.width || 0.9;
        emit(eId, `IFCDOOR('${guid}',${stepRef(ownerHistId)},${stepString(elemName)},$,$,${stepRef(ePlId)},${shapeArg},$,${stepReal(dh)},${stepReal(dw)},.DOOR.,$,$)`);
        break;
      }
      case "IFCWINDOW": {
        const wh = dims.height || 1.2;
        const ww = dims.width || 1.0;
        emit(eId, `IFCWINDOW('${guid}',${stepRef(ownerHistId)},${stepString(elemName)},$,$,${stepRef(ePlId)},${shapeArg},$,${stepReal(wh)},${stepReal(ww)},.WINDOW.,$,$)`);
        break;
      }
      case "IFCFOOTING":
        emit(eId, `IFCFOOTING('${guid}',${stepRef(ownerHistId)},${stepString(elemName)},$,$,${stepRef(ePlId)},${shapeArg},$,.STRIP_FOOTING.)`);
        break;
      case "IFCRAILING":
        emit(eId, `IFCRAILING('${guid}',${stepRef(ownerHistId)},${stepString(elemName)},$,$,${stepRef(ePlId)},${shapeArg},$,.HANDRAIL.)`);
        break;
      case "IFCROOF":
        emit(eId, `IFCROOF('${guid}',${stepRef(ownerHistId)},${stepString(elemName)},$,$,${stepRef(ePlId)},${shapeArg},$,.GABLE_ROOF.)`);
        break;
      case "IFCSTAIRFLIGHT":
        emit(eId, `IFCSTAIRFLIGHT('${guid}',${stepRef(ownerHistId)},${stepString(elemName)},$,$,${stepRef(ePlId)},${shapeArg},$,$,$,$,$,.STRAIGHT.)`);
        break;
      default:
        emit(eId, `IFCBUILDINGELEMENTPROXY('${guid}',${stepRef(ownerHistId)},${stepString(elemName)},${stepString(ifcClass)},$,${stepRef(ePlId)},${shapeArg},$,.NOTDEFINED.)`);
        break;
    }

    // Track for spatial containment
    const arr = elementsByStorey.get(storeyName) || [];
    arr.push(eId);
    elementsByStorey.set(storeyName, arr);

    // ── Material association ───────────────────────────────────────────
    if (o.includeMaterials && elem.material) {
      const matId = getOrCreateMaterial(elem.material);
      const relMatId = alloc.allocate();
      emit(
        relMatId,
        `IFCRELASSOCIATESMATERIAL('${generateGUID()}',${stepRef(ownerHistId)},$,$,(${stepRef(eId)}),${stepRef(matId)})`
      );
    }

    // ── Property set ──────────────────────────────────────────────────
    if (o.includeProperties && elem.properties) {
      const propIds: number[] = [];
      for (const [key, val] of Object.entries(elem.properties)) {
        if (
          val === undefined ||
          val === null ||
          key === "dimensions" ||
          key === "name"
        )
          continue;
        if (typeof val === "object") continue;

        const pId = alloc.allocate();
        if (typeof val === "number") {
          emit(
            pId,
            `IFCPROPERTYSINGLEVALUE(${stepString(key)},$,IFCREAL(${stepReal(val)}),$)`
          );
        } else if (typeof val === "boolean") {
          emit(
            pId,
            `IFCPROPERTYSINGLEVALUE(${stepString(key)},$,IFCBOOLEAN(.${val ? "TRUE" : "FALSE"}.),$ )`
          );
        } else {
          emit(
            pId,
            `IFCPROPERTYSINGLEVALUE(${stepString(key)},$,IFCTEXT(${stepString(String(val))}),$)`
          );
        }
        propIds.push(pId);
      }

      // CSI Division as property
      if (elem.csiDivision) {
        const csiPropId = alloc.allocate();
        emit(
          csiPropId,
          `IFCPROPERTYSINGLEVALUE('CSI_Division',$,IFCTEXT(${stepString(elem.csiDivision)}),$)`
        );
        propIds.push(csiPropId);
      }

      if (propIds.length > 0) {
        const psetId = alloc.allocate();
        emit(
          psetId,
          `IFCPROPERTYSET('${generateGUID()}',${stepRef(ownerHistId)},'EP_Properties',$,${stepList(propIds)})`
        );

        const relPsetId = alloc.allocate();
        emit(
          relPsetId,
          `IFCRELDEFINESBYPROPERTIES('${generateGUID()}',${stepRef(ownerHistId)},$,$,(${stepRef(eId)}),${stepRef(psetId)})`
        );
      }
    }

    // ── Quantity set ──────────────────────────────────────────────────
    if (o.includeQuantities) {
      const qIds: number[] = [];
      const area = dims.area || w * l;
      const volume = dims.volume || w * l * h;

      if (area > 0) {
        const qId = alloc.allocate();
        emit(qId, `IFCQUANTITYAREA('NetArea',$,$,${stepReal(area)},$)`);
        qIds.push(qId);
      }
      if (volume > 0) {
        const qId = alloc.allocate();
        emit(qId, `IFCQUANTITYVOLUME('NetVolume',$,$,${stepReal(volume)},$)`);
        qIds.push(qId);
      }
      if (h > 0) {
        const qId = alloc.allocate();
        emit(qId, `IFCQUANTITYLENGTH('Height',$,$,${stepReal(h)},$)`);
        qIds.push(qId);
      }
      if (l > 0) {
        const qId = alloc.allocate();
        emit(qId, `IFCQUANTITYLENGTH('Length',$,$,${stepReal(l)},$)`);
        qIds.push(qId);
      }

      if (qIds.length > 0) {
        const eqId = alloc.allocate();
        emit(
          eqId,
          `IFCELEMENTQUANTITY('${generateGUID()}',${stepRef(ownerHistId)},'BaseQuantities',$,$,${stepList(qIds)})`
        );

        const relQId = alloc.allocate();
        emit(
          relQId,
          `IFCRELDEFINESBYPROPERTIES('${generateGUID()}',${stepRef(ownerHistId)},$,$,(${stepRef(eId)}),${stepRef(eqId)})`
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //  SPATIAL CONTAINMENT
  // ─────────────────────────────────────────────────────────────────────

  for (const [storeyName, elemIds] of elementsByStorey.entries()) {
    const si = storeyMap.get(storeyName);
    if (!si || elemIds.length === 0) continue;

    const relId = alloc.allocate();
    emit(
      relId,
      `IFCRELCONTAINEDINSPATIALSTRUCTURE('${generateGUID()}',${stepRef(ownerHistId)},$,$,${stepList(elemIds)},${stepRef(si.entityId)})`
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  //  ASSEMBLE DOCUMENT
  // ─────────────────────────────────────────────────────────────────────

  return [header, ...lines, "ENDSEC;", "END-ISO-10303-21;"].join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
//  EXPORT STATISTICS
// ═══════════════════════════════════════════════════════════════════════════════

export function getIFCExportStats(elements: IFCBIMElement[]): IFCExportStats {
  const byClass: Record<string, number> = {};
  const byStorey: Record<string, number> = {};
  let withGeo = 0;
  let withMat = 0;

  for (const e of elements) {
    const cls = mapToIFCClass(e.elementType || e.type || "");
    byClass[cls] = (byClass[cls] || 0) + 1;

    const s = e.storey || "Level 1";
    byStorey[s] = (byStorey[s] || 0) + 1;

    if (e.geometry?.dimensions) withGeo++;
    if (e.material) withMat++;
  }

  // Rough estimate: ~25 entities per element + ~30 base entities
  const entityCount = elements.length * 25 + 30;
  const approxBytes = elements.length * 900 + 6000;
  const estimatedFileSize =
    approxBytes < 1024 * 1024
      ? `${Math.round(approxBytes / 1024)} KB`
      : `${(approxBytes / (1024 * 1024)).toFixed(1)} MB`;

  return {
    totalElements: elements.length,
    byIFCClass: byClass,
    byStorey,
    withGeometry: withGeo,
    withMaterial: withMat,
    entityCount,
    estimatedFileSize,
  };
}
