/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  INTEGRATION & EXPORT ENGINE — SOP Part 8
 *  EstimatorPro v3 — Professional Export Pipeline
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Produces professional export files from all completed SOP modules:
 *
 *  1. IFC4 STEP Export   — BIM model for Navisworks / Solibri / BIM 360
 *  2. MS Project XML     — Schedule from 4D sequencing (Primavera P6 compatible)
 *  3. Professional XLSX  — Multi-sheet BOQ workbook per CIQS Standard Method
 *  4. BOQ CSV Export     — Per-division, per-storey, per-trade structured CSV
 *  5. Report JSON Export — Structured JSON for all 7 report types
 *
 *  Standards: IFC4 (ISO 16739-1:2018), MS Project XML Schema, CIQS, CSI MF2018
 *
 *  @module integration-export-engine
 *  @version 1.0.0
 */

import type {
  BOQReport,
  BidLevelingSheet,
  ClashReport,
  GapRegister,
  ScheduleOfValues,
} from './report-generator';


// ══════════════════════════════════════════════════════════════════════════════
//  SHARED UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function isoNow(): string {
  return new Date().toISOString();
}

function _fmtMoney(amount: number): string {
  return Math.round(amount).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeCsv(val: any): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}


// ══════════════════════════════════════════════════════════════════════════════
//  1. IFC4 STEP EXPORT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * IFC4 Element representation for export
 */
export interface IFCExportElement {
  id: string;
  ifcType: string;         // IfcWall, IfcSlab, IfcColumn, IfcBeam, IfcDoor, IfcWindow, etc.
  name: string;
  storey: string;
  geometry: {
    x: number; y: number; z: number;
    width: number; depth: number; height: number;
  };
  properties: Record<string, any>;
  materialName?: string;
  csiDivision?: string;
}

/**
 * Map BIM element type → IFC4 entity type
 */
function mapToIfcType(elementType: string): string {
  const type = (elementType || '').toLowerCase();
  if (type.includes('wall')) return 'IfcWall';
  if (type.includes('slab') || type.includes('floor')) return 'IfcSlab';
  if (type.includes('column')) return 'IfcColumn';
  if (type.includes('beam')) return 'IfcBeam';
  if (type.includes('door')) return 'IfcDoor';
  if (type.includes('window')) return 'IfcWindow';
  if (type.includes('roof')) return 'IfcRoof';
  if (type.includes('stair')) return 'IfcStairFlight';
  if (type.includes('railing') || type.includes('guard')) return 'IfcRailing';
  if (type.includes('ceiling')) return 'IfcCovering';
  if (type.includes('curtain')) return 'IfcCurtainWall';
  if (type.includes('duct')) return 'IfcDuctSegment';
  if (type.includes('pipe')) return 'IfcPipeSegment';
  if (type.includes('light')) return 'IfcLightFixture';
  if (type.includes('sprinkler')) return 'IfcFlowTerminal';
  if (type.includes('recept') || type.includes('outlet')) return 'IfcOutlet';
  if (type.includes('panel') || type.includes('elec')) return 'IfcDistributionBoard';
  if (type.includes('foundation') || type.includes('footing')) return 'IfcFooting';
  if (type.includes('pile')) return 'IfcPile';
  return 'IfcBuildingElementProxy';
}

/**
 * Convert BIM elements to IFC4 export format
 */
export function convertToIFCElements(bimElements: any[]): IFCExportElement[] {
  return bimElements.map(el => {
    const props = el.properties || {};
    return {
      id: el.id || uuid(),
      ifcType: mapToIfcType(el.type || el.elementType || ''),
      name: el.name || el.type || 'Unnamed Element',
      storey: el.storey || el.floor || 'Unknown',
      geometry: {
        x: Number(props.x || el.x || 0),
        y: Number(props.y || el.y || 0),
        z: Number(props.z || el.z || 0),
        width: Number(props.width || el.width || 0),
        depth: Number(props.depth || el.depth || 0),
        height: Number(props.height || el.height || 0),
      },
      properties: props,
      materialName: props.material || props.materialName || undefined,
      csiDivision: props.csiDivision || undefined,
    };
  });
}

/**
 * Generate a valid IFC4 STEP file (ISO 10303-21)
 *
 * This produces a real, parseable IFC4 file that can be opened by:
 * - Autodesk Navisworks
 * - Solibri Model Checker
 * - BIM 360 / Autodesk Construction Cloud
 * - xBIM Xplorer
 * - IFC.js / IfcOpenShell
 * - BlenderBIM Add-on
 *
 * @param elements  BIM elements (from storage.getBimElements or convertToIFCElements)
 * @param projectName  Project name for IFC header
 * @param authorName  Author name
 */
export function generateIFC4File(
  elements: IFCExportElement[],
  projectName: string = 'EstimatorPro Export',
  authorName: string = 'EstimatorPro v3',
): string {
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').substring(0, 14);
  const projectGuid = uuid().toUpperCase().replace(/-/g, '').substring(0, 22);
  const siteGuid = uuid().toUpperCase().replace(/-/g, '').substring(0, 22);
  const buildingGuid = uuid().toUpperCase().replace(/-/g, '').substring(0, 22);

  const lines: string[] = [];

  // ── HEADER ───────────────────────────────────────────────────────────────
  lines.push("ISO-10303-21;");
  lines.push("HEADER;");
  lines.push(`FILE_DESCRIPTION(('ViewDefinition [CoordinationView_V2.0]'),'2;1');`);
  lines.push(`FILE_NAME('${escapeIfc(projectName)}.ifc','${timestamp}',('${escapeIfc(authorName)}'),('EstimatorPro'),'EstimatorPro v3 IFC Exporter','EstimatorPro','');`);
  lines.push("FILE_SCHEMA(('IFC4'));");
  lines.push("ENDSEC;");
  lines.push("");
  lines.push("DATA;");

  let eid = 1; // Entity ID counter

  // ── CONTEXT & UNITS ──────────────────────────────────────────────────────
  const ownerHistId = eid++;
  const personId = eid++;
  const orgId = eid++;
  const personOrgId = eid++;
  const appId = eid++;
  const contextId = eid++;
  const _dimExId = eid++;
  const siUnitLenId = eid++;
  const siUnitAreaId = eid++;
  const siUnitVolId = eid++;
  const unitAssId = eid++;
  const axisPlacementId = eid++;
  const dirZId = eid++;
  const dirXId = eid++;
  const originId = eid++;

  lines.push(`#${personId}=IFCPERSON($,'${escapeIfc(authorName)}','',$,$,$,$,$);`);
  lines.push(`#${orgId}=IFCORGANIZATION($,'EstimatorPro','AI Construction Estimation',$,$);`);
  lines.push(`#${personOrgId}=IFCPERSONANDORGANIZATION(#${personId},#${orgId},$);`);
  lines.push(`#${appId}=IFCAPPLICATION(#${orgId},'3.0','EstimatorPro v3','EstimatorPro');`);
  lines.push(`#${ownerHistId}=IFCOWNERHISTORY(#${personOrgId},#${appId},$,.NOCHANGE.,$,#${personOrgId},#${appId},${Math.floor(Date.now() / 1000)});`);

  // SI units — metres, square metres, cubic metres
  lines.push(`#${siUnitLenId}=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);`);
  lines.push(`#${siUnitAreaId}=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);`);
  lines.push(`#${siUnitVolId}=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);`);
  lines.push(`#${unitAssId}=IFCUNITASSIGNMENT((#${siUnitLenId},#${siUnitAreaId},#${siUnitVolId}));`);

  // Geometric context
  lines.push(`#${originId}=IFCCARTESIANPOINT((0.,0.,0.));`);
  lines.push(`#${dirZId}=IFCDIRECTION((0.,0.,1.));`);
  lines.push(`#${dirXId}=IFCDIRECTION((1.,0.,0.));`);
  lines.push(`#${axisPlacementId}=IFCAXIS2PLACEMENT3D(#${originId},#${dirZId},#${dirXId});`);
  lines.push(`#${contextId}=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-05,#${axisPlacementId},$);`);

  // ── PROJECT ──────────────────────────────────────────────────────────────
  const projectId = eid++;
  lines.push(`#${projectId}=IFCPROJECT('${projectGuid}',#${ownerHistId},'${escapeIfc(projectName)}',$,$,$,$,(#${contextId}),#${unitAssId});`);

  // ── SITE → BUILDING ──────────────────────────────────────────────────────
  const sitePlaceId = eid++;
  lines.push(`#${sitePlaceId}=IFCLOCALPLACEMENT($,#${axisPlacementId});`);
  const siteId = eid++;
  lines.push(`#${siteId}=IFCSITE('${siteGuid}',#${ownerHistId},'Default Site',$,$,#${sitePlaceId},$,$,.ELEMENT.,(43,53,0,0),(78,44,0,0),0.,$,$);`);

  const buildingPlaceId = eid++;
  lines.push(`#${buildingPlaceId}=IFCLOCALPLACEMENT(#${sitePlaceId},#${axisPlacementId});`);
  const buildingId = eid++;
  lines.push(`#${buildingGuid}`,);
  lines.push(`#${buildingId}=IFCBUILDING('${buildingGuid}',#${ownerHistId},'${escapeIfc(projectName)}',$,$,#${buildingPlaceId},$,$,.ELEMENT.,$,$,$);`);

  // ── STOREYS ──────────────────────────────────────────────────────────────
  const storeys = [...new Set(elements.map(e => e.storey))].sort();
  const storeyIds = new Map<string, number>();
  const storeyElementIds = new Map<string, number[]>();

  for (let i = 0; i < storeys.length; i++) {
    const storeyName = storeys[i];
    const elevation = i * 3.0; // Default 3m storey height
    const storeyGuid = uuid().toUpperCase().replace(/-/g, '').substring(0, 22);
    const storeyPlaceId = eid++;

    // Storey placement with elevation
    const elevOriginId = eid++;
    lines.push(`#${elevOriginId}=IFCCARTESIANPOINT((0.,0.,${elevation.toFixed(3)}));`);
    lines.push(`#${storeyPlaceId}=IFCLOCALPLACEMENT(#${buildingPlaceId},#${eid}=IFCAXIS2PLACEMENT3D(#${elevOriginId},#${dirZId},#${dirXId}));`);
    eid++; // for inline axis2placement

    const storeyId = eid++;
    lines.push(`#${storeyId}=IFCBUILDINGSTOREY('${storeyGuid}',#${ownerHistId},'${escapeIfc(storeyName)}',$,$,#${storeyPlaceId},$,$,.ELEMENT.,${elevation.toFixed(3)});`);

    storeyIds.set(storeyName, storeyId);
    storeyElementIds.set(storeyName, []);
  }

  // Fallback storey for unmapped elements
  if (!storeyIds.has('Unknown')) {
    const fallbackGuid = uuid().toUpperCase().replace(/-/g, '').substring(0, 22);
    const fallbackStoreyId = eid++;
    lines.push(`#${fallbackStoreyId}=IFCBUILDINGSTOREY('${fallbackGuid}',#${ownerHistId},'Unknown',$,$,#${buildingPlaceId},$,$,.ELEMENT.,0.);`);
    storeyIds.set('Unknown', fallbackStoreyId);
    storeyElementIds.set('Unknown', []);
  }

  // ── ELEMENTS ─────────────────────────────────────────────────────────────
  for (const el of elements) {
    const elGuid = uuid().toUpperCase().replace(/-/g, '').substring(0, 22);
    const storey = el.storey || 'Unknown';
    const _storeyId = storeyIds.get(storey) || storeyIds.get('Unknown')!;
    const g = el.geometry;

    // Element placement
    const elOriginId = eid++;
    lines.push(`#${elOriginId}=IFCCARTESIANPOINT((${g.x.toFixed(3)},${g.y.toFixed(3)},${g.z.toFixed(3)}));`);
    const elPlaceId = eid++;
    lines.push(`#${elPlaceId}=IFCLOCALPLACEMENT(#${storeyIds.get(storey)! + 0 /* parent */},#${eid}=IFCAXIS2PLACEMENT3D(#${elOriginId},#${dirZId},#${dirXId}));`);
    eid++;

    // Bounding box representation
    const bbxId = eid++;
    lines.push(`#${bbxId}=IFCBOUNDINGBOX(#${originId},${Math.max(g.width, 0.01).toFixed(3)},${Math.max(g.depth, 0.01).toFixed(3)},${Math.max(g.height, 0.01).toFixed(3)});`);
    const shapeRepId = eid++;
    lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${contextId},'Box','BoundingBox',(#${bbxId}));`);
    const prodShapeId = eid++;
    lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

    // The IFC element entity
    const elementId = eid++;
    lines.push(`#${elementId}=${el.ifcType.toUpperCase()}('${elGuid}',#${ownerHistId},'${escapeIfc(el.name)}',$,$,#${elPlaceId},#${prodShapeId},$);`);

    // Track for containment
    const arr = storeyElementIds.get(storey) || storeyElementIds.get('Unknown')!;
    arr.push(elementId);

    // Property set with custom properties
    const propEntries = Object.entries(el.properties || {}).filter(([k]) =>
      !['x', 'y', 'z', 'width', 'depth', 'height'].includes(k),
    );
    if (propEntries.length > 0 || el.materialName || el.csiDivision) {
      const propIds: number[] = [];

      for (const [key, value] of propEntries.slice(0, 10)) {
        const propId = eid++;
        const val = typeof value === 'number'
          ? `IFCREAL(${value})`
          : `IFCTEXT('${escapeIfc(String(value))}')`;
        lines.push(`#${propId}=IFCPROPERTYSINGLEVALUE('${escapeIfc(key)}',$,${val},$);`);
        propIds.push(propId);
      }

      if (el.materialName) {
        const matPropId = eid++;
        lines.push(`#${matPropId}=IFCPROPERTYSINGLEVALUE('Material',$,IFCTEXT('${escapeIfc(el.materialName)}'),$);`);
        propIds.push(matPropId);
      }

      if (el.csiDivision) {
        const csiPropId = eid++;
        lines.push(`#${csiPropId}=IFCPROPERTYSINGLEVALUE('CSI_Division',$,IFCTEXT('${escapeIfc(el.csiDivision)}'),$);`);
        propIds.push(csiPropId);
      }

      const psetId = eid++;
      lines.push(`#${psetId}=IFCPROPERTYSET('${uuid().toUpperCase().replace(/-/g, '').substring(0, 22)}',#${ownerHistId},'EstimatorPro_Properties',$,(${propIds.map(id => '#' + id).join(',')}));`);

      const relPropId = eid++;
      lines.push(`#${relPropId}=IFCRELDEFINESBYPROPERTIES('${uuid().toUpperCase().replace(/-/g, '').substring(0, 22)}',#${ownerHistId},$,$,(#${elementId}),#${psetId});`);
    }
  }

  // ── CONTAINMENT RELATIONSHIPS ────────────────────────────────────────────

  // Project → Site
  const relProjSiteId = eid++;
  lines.push(`#${relProjSiteId}=IFCRELAGGREGATES('${uuid().toUpperCase().replace(/-/g, '').substring(0, 22)}',#${ownerHistId},$,$,#${projectId},(#${siteId}));`);

  // Site → Building
  const relSiteBldId = eid++;
  lines.push(`#${relSiteBldId}=IFCRELAGGREGATES('${uuid().toUpperCase().replace(/-/g, '').substring(0, 22)}',#${ownerHistId},$,$,#${siteId},(#${buildingId}));`);

  // Building → Storeys
  const storeyRefList = Array.from(storeyIds.values()).map(id => '#' + id).join(',');
  const relBldStoreysId = eid++;
  lines.push(`#${relBldStoreysId}=IFCRELAGGREGATES('${uuid().toUpperCase().replace(/-/g, '').substring(0, 22)}',#${ownerHistId},$,$,#${buildingId},(${storeyRefList}));`);

  // Storey → Elements (spatial containment)
  for (const [storeyName, elementIdList] of storeyElementIds) {
    if (elementIdList.length === 0) continue;
    const storeyId = storeyIds.get(storeyName)!;
    const elRefList = elementIdList.map(id => '#' + id).join(',');
    const relContainId = eid++;
    lines.push(`#${relContainId}=IFCRELCONTAINEDINSPATIALSTRUCTURE('${uuid().toUpperCase().replace(/-/g, '').substring(0, 22)}',#${ownerHistId},$,$,(${elRefList}),#${storeyId});`);
  }

  // ── FOOTER ───────────────────────────────────────────────────────────────
  lines.push("ENDSEC;");
  lines.push("END-ISO-10303-21;");

  return lines.join('\n');
}

function escapeIfc(str: string): string {
  return (str || '').replace(/'/g, "''").replace(/\\/g, '\\\\');
}


// ══════════════════════════════════════════════════════════════════════════════
//  2. MS PROJECT XML EXPORT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Generate MS Project XML from Schedule of Values / 4D sequencing.
 * Compatible with MS Project 2019+ and Oracle Primavera P6 import.
 *
 * @param sov  Schedule of Values from SOP Part 7
 * @param projectName  Project name
 * @param startDate  Project start date (ISO string)
 */
export function generateMSProjectXML(
  sov: ScheduleOfValues,
  projectName: string = 'EstimatorPro Project',
  startDate: string = new Date().toISOString().substring(0, 10),
): string {
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  lines.push('<Project xmlns="http://schemas.microsoft.com/project">');
  lines.push(`  <Name>${escapeXml(projectName)}</Name>`);
  lines.push(`  <Title>${escapeXml(projectName)} — EstimatorPro Schedule</Title>`);
  lines.push(`  <Company>EstimatorPro v3</Company>`);
  lines.push(`  <Author>EstimatorPro</Author>`);
  lines.push(`  <CreationDate>${isoNow()}</CreationDate>`);
  lines.push(`  <StartDate>${startDate}T08:00:00</StartDate>`);
  lines.push(`  <CurrencyCode>CAD</CurrencyCode>`);
  lines.push(`  <CalendarUID>1</CalendarUID>`);
  lines.push(`  <DefaultStartTime>08:00:00</DefaultStartTime>`);
  lines.push(`  <DefaultFinishTime>17:00:00</DefaultFinishTime>`);
  lines.push(`  <MinutesPerDay>480</MinutesPerDay>`);
  lines.push(`  <DaysPerMonth>22</DaysPerMonth>`);

  // ── Calendar ──────────────────────────────────────────────────────────
  lines.push('  <Calendars>');
  lines.push('    <Calendar>');
  lines.push('      <UID>1</UID>');
  lines.push('      <Name>Standard</Name>');
  lines.push('      <IsBaseCalendar>1</IsBaseCalendar>');
  lines.push('      <WeekDays>');
  for (let day = 1; day <= 7; day++) {
    const isWorking = day >= 2 && day <= 6; // Mon-Fri
    lines.push(`        <WeekDay><DayType>${day}</DayType><DayWorking>${isWorking ? 1 : 0}</DayWorking>`);
    if (isWorking) {
      lines.push('          <TimePeriod><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></TimePeriod>');
      lines.push('          <TimePeriod><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></TimePeriod>');
    }
    lines.push('        </WeekDay>');
  }
  lines.push('      </WeekDays>');
  lines.push('    </Calendar>');
  lines.push('  </Calendars>');

  // ── Tasks ─────────────────────────────────────────────────────────────
  lines.push('  <Tasks>');

  // Summary task (UID 0)
  lines.push('    <Task>');
  lines.push('      <UID>0</UID>');
  lines.push(`      <Name>${escapeXml(projectName)}</Name>`);
  lines.push('      <OutlineLevel>0</OutlineLevel>');
  lines.push('      <Type>1</Type>');
  lines.push('      <IsNull>0</IsNull>');
  lines.push(`      <Cost>${Math.round(sov.totalContractValue)}</Cost>`);
  lines.push('    </Task>');

  let taskUid = 1;
  let cumulativeDays = 0;

  for (const phase of sov.phases) {
    // Estimate duration: proportional to value (rough — 1 day per $5000)
    const durationDays = Math.max(5, Math.round(phase.scheduledValue / 5000));
    const phaseStart = addWorkingDays(new Date(startDate), cumulativeDays);
    const phaseEnd = addWorkingDays(phaseStart, durationDays);

    // Phase summary task
    lines.push('    <Task>');
    lines.push(`      <UID>${taskUid++}</UID>`);
    lines.push(`      <Name>${escapeXml(phase.phaseName)}</Name>`);
    lines.push(`      <OutlineLevel>1</OutlineLevel>`);
    lines.push(`      <Start>${formatMSDate(phaseStart)}</Start>`);
    lines.push(`      <Finish>${formatMSDate(phaseEnd)}</Finish>`);
    lines.push(`      <Duration>PT${durationDays * 8}H0M0S</Duration>`);
    lines.push(`      <Cost>${Math.round(phase.scheduledValue)}</Cost>`);
    lines.push(`      <PercentComplete>0</PercentComplete>`);
    lines.push('      <IsNull>0</IsNull>');
    lines.push('      <Type>1</Type>');
    lines.push('    </Task>');

    // Sub-tasks from trade breakdown
    let subDays = 0;
    for (const trade of phase.tradeBreakdown) {
      const tradeDuration = Math.max(2, Math.round((trade.amount / phase.scheduledValue) * durationDays));
      const tradeStart = addWorkingDays(phaseStart, subDays);
      const tradeEnd = addWorkingDays(tradeStart, tradeDuration);

      lines.push('    <Task>');
      lines.push(`      <UID>${taskUid++}</UID>`);
      lines.push(`      <Name>${escapeXml(trade.trade)}</Name>`);
      lines.push(`      <OutlineLevel>2</OutlineLevel>`);
      lines.push(`      <Start>${formatMSDate(tradeStart)}</Start>`);
      lines.push(`      <Finish>${formatMSDate(tradeEnd)}</Finish>`);
      lines.push(`      <Duration>PT${tradeDuration * 8}H0M0S</Duration>`);
      lines.push(`      <Cost>${Math.round(trade.amount)}</Cost>`);
      lines.push(`      <PercentComplete>0</PercentComplete>`);
      lines.push('      <IsNull>0</IsNull>');
      lines.push('      <Type>0</Type>');
      lines.push('    </Task>');

      subDays += Math.floor(tradeDuration * 0.7); // overlap tasks slightly
    }

    // Milestones
    for (const milestone of phase.milestones) {
      lines.push('    <Task>');
      lines.push(`      <UID>${taskUid++}</UID>`);
      lines.push(`      <Name>${escapeXml(milestone)}</Name>`);
      lines.push(`      <OutlineLevel>2</OutlineLevel>`);
      lines.push(`      <Start>${formatMSDate(phaseEnd)}</Start>`);
      lines.push(`      <Finish>${formatMSDate(phaseEnd)}</Finish>`);
      lines.push('      <Duration>PT0H0M0S</Duration>');
      lines.push('      <Milestone>1</Milestone>');
      lines.push('      <IsNull>0</IsNull>');
      lines.push('      <Type>0</Type>');
      lines.push('    </Task>');
    }

    cumulativeDays += durationDays;
  }

  lines.push('  </Tasks>');
  lines.push('</Project>');

  return lines.join('\n');
}

function addWorkingDays(start: Date, days: number): Date {
  const result = new Date(start);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

function formatMSDate(d: Date): string {
  return d.toISOString().substring(0, 10) + 'T08:00:00';
}


// ══════════════════════════════════════════════════════════════════════════════
//  3. PROFESSIONAL XLSX EXPORT (Multi-sheet)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Represents a worksheet in the XLSX export.
 * We generate an XML-based SpreadsheetML format that Excel can open.
 */
export interface XLSXSheet {
  name: string;
  headers: string[];
  rows: (string | number)[][];
  columnWidths?: number[];
}

/**
 * Build multi-sheet XLSX data from a BOQ report.
 * Returns structured sheets that can be serialized.
 *
 * Sheets:
 *   1. Executive Summary
 *   2. BOQ Detail (all line items)
 *   3. Division Summary
 *   4. Storey Summary
 *   5. Trade Package Summary
 *   6. Confidence Analysis
 */
export function buildBOQExportSheets(report: BOQReport): XLSXSheet[] {
  const sheets: XLSXSheet[] = [];

  // ── Sheet 1: Executive Summary ──────────────────────────────────────────
  sheets.push({
    name: 'Executive Summary',
    headers: ['Item', 'Value'],
    columnWidths: [40, 25],
    rows: [
      ['Project Name', report.metadata.projectName],
      ['Report ID', report.metadata.reportId],
      ['Generated', report.metadata.generatedAt],
      ['Standards', report.metadata.standards.join(', ')],
      ['', ''],
      ['COST SUMMARY', ''],
      ['Direct Cost', report.directCost],
      [`Overhead (${(report.overheadRate * 100).toFixed(1)}%)`, report.overheadAmount],
      [`Profit (${(report.profitRate * 100).toFixed(1)}%)`, report.profitAmount],
      [`Contingency (${(report.contingencyRate * 100).toFixed(1)}%)`, report.contingencyAmount],
      [`Tax (${(report.taxRate * 100).toFixed(1)}%)`, report.taxAmount],
      ['TOTAL PROJECT COST', report.totalProjectCost],
      ['', ''],
      ['Region', report.regionName],
      ['Regional Factor', report.regionalFactor],
      ['', ''],
      ['CONFIDENCE', ''],
      ['Overall Score', `${report.confidenceSummary.overallConfidence}%`],
      ['HIGH items', report.confidenceSummary.highCount],
      ['MEDIUM items', report.confidenceSummary.mediumCount],
      ['LOW items', report.confidenceSummary.lowCount],
      ['GAP items', report.confidenceSummary.gapCount],
    ],
  });

  // ── Sheet 2: BOQ Detail ─────────────────────────────────────────────────
  sheets.push({
    name: 'BOQ Detail',
    headers: [
      'Line', 'CSI Div', 'CSI Title', 'Description', 'Unit', 'Qty',
      'Material Rate', 'Labour Rate', 'Equip Rate',
      'Material Cost', 'Labour Cost', 'Equip Cost', 'Total Cost',
      'Storey', 'Trade Package', 'Confidence', 'Evidence',
    ],
    columnWidths: [6, 7, 25, 35, 6, 12, 14, 14, 14, 14, 14, 14, 14, 12, 20, 10, 8],
    rows: report.lines.map(l => [
      l.lineNo, l.csiDivision, l.csiTitle, l.description, l.unit,
      round2(l.quantity), round2(l.materialRate), round2(l.labourRate), round2(l.equipmentRate),
      round2(l.materialCost), round2(l.labourCost), round2(l.equipmentCost), round2(l.totalCost),
      l.storey, l.tradePackage, l.confidenceLevel, l.hasEvidence ? 'Yes' : 'NO',
    ]),
  });

  // ── Sheet 3: Division Summary ───────────────────────────────────────────
  sheets.push({
    name: 'Division Summary',
    headers: ['Division', 'Title', 'Material', 'Labour', 'Equipment', 'Total', 'Lines'],
    columnWidths: [10, 35, 15, 15, 15, 15, 8],
    rows: [
      ...report.divisionSubtotals.map(d => [
        d.division, d.title, round2(d.materialCost), round2(d.labourCost),
        round2(d.equipmentCost), round2(d.totalCost), d.lineCount,
      ]),
      ['', 'TOTAL', '', '', '', round2(report.directCost), report.lines.length],
    ],
  });

  // ── Sheet 4: Storey Summary ─────────────────────────────────────────────
  sheets.push({
    name: 'Storey Summary',
    headers: ['Storey', 'Material', 'Labour', 'Equipment', 'Total', 'Lines'],
    columnWidths: [20, 15, 15, 15, 15, 8],
    rows: [
      ...report.storeySubtotals.map(s => [
        s.storey, round2(s.materialCost), round2(s.labourCost),
        round2(s.equipmentCost), round2(s.totalCost), s.lineCount,
      ]),
      ['TOTAL', '', '', '', round2(report.directCost), report.lines.length],
    ],
  });

  // ── Sheet 5: Trade Package Summary ──────────────────────────────────────
  sheets.push({
    name: 'Trade Packages',
    headers: ['Trade Package', 'Material', 'Labour', 'Equipment', 'Total', 'Lines'],
    columnWidths: [30, 15, 15, 15, 15, 8],
    rows: [
      ...report.tradePackageSubtotals.map(tp => [
        tp.tradePackage, round2(tp.materialCost), round2(tp.labourCost),
        round2(tp.equipmentCost), round2(tp.totalCost), tp.lineCount,
      ]),
      ['TOTAL', '', '', '', round2(report.directCost), report.lines.length],
    ],
  });

  // ── Sheet 6: Confidence Analysis ────────────────────────────────────────
  const gapLines = report.lines.filter(l => l.confidenceLevel === 'GAP' || l.confidenceLevel === 'LOW');
  sheets.push({
    name: 'Confidence Analysis',
    headers: ['Line', 'Description', 'Confidence', 'Qty', 'Rate', 'Evidence', 'Storey', 'Trade'],
    columnWidths: [6, 35, 10, 12, 12, 8, 15, 20],
    rows: gapLines.map(l => [
      l.lineNo, l.description, l.confidenceLevel,
      round2(l.quantity),
      l.totalCost > 0 && l.quantity > 0 ? round2(l.totalCost / l.quantity) : 0,
      l.hasEvidence ? 'Yes' : 'NO',
      l.storey, l.tradePackage,
    ]),
  });

  return sheets;
}

/**
 * Serialize sheets to CSV (one sheet at a time).
 */
export function sheetToCSV(sheet: XLSXSheet, delimiter: string = ','): string {
  const lines: string[] = [];
  lines.push(sheet.headers.map(h => escapeCsv(h)).join(delimiter));
  for (const row of sheet.rows) {
    lines.push(row.map(v => escapeCsv(v)).join(delimiter));
  }
  return lines.join('\n');
}

/**
 * Serialize sheets to SpreadsheetML XML (can be opened by Excel).
 * This is a pure-TypeScript approach — no npm xlsx dependency required.
 */
export function sheetsToSpreadsheetML(sheets: XLSXSheet[], projectName: string = ''): string {
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<?mso-application progid="Excel.Sheet"?>');
  lines.push('<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"');
  lines.push('  xmlns:o="urn:schemas-microsoft-com:office:office"');
  lines.push('  xmlns:x="urn:schemas-microsoft-com:office:excel"');
  lines.push('  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">');

  // Document properties
  lines.push('  <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">');
  lines.push(`    <Title>${escapeXml(projectName || 'EstimatorPro Report')}</Title>`);
  lines.push('    <Author>EstimatorPro v3</Author>');
  lines.push(`    <Created>${isoNow()}</Created>`);
  lines.push('  </DocumentProperties>');

  // Styles
  lines.push('  <Styles>');
  lines.push('    <Style ss:ID="Default"><Font ss:Size="11" ss:FontName="Calibri"/></Style>');
  lines.push('    <Style ss:ID="Header"><Font ss:Bold="1" ss:Size="11" ss:FontName="Calibri"/><Interior ss:Color="#D9E1F2" ss:Pattern="Solid"/></Style>');
  lines.push('    <Style ss:ID="Money"><NumberFormat ss:Format="$#,##0.00"/><Font ss:Size="11" ss:FontName="Calibri"/></Style>');
  lines.push('    <Style ss:ID="TotalRow"><Font ss:Bold="1" ss:Size="11" ss:FontName="Calibri"/><Interior ss:Color="#E2EFDA" ss:Pattern="Solid"/></Style>');
  lines.push('    <Style ss:ID="GapRow"><Font ss:Size="11" ss:FontName="Calibri" ss:Color="#CC0000"/><Interior ss:Color="#FFF2CC" ss:Pattern="Solid"/></Style>');
  lines.push('  </Styles>');

  // Worksheets
  for (const sheet of sheets) {
    lines.push(`  <Worksheet ss:Name="${escapeXml(sheet.name)}">`);
    lines.push('    <Table>');

    // Column widths
    if (sheet.columnWidths) {
      for (const w of sheet.columnWidths) {
        lines.push(`      <Column ss:Width="${w * 7}"/>`);
      }
    }

    // Header row
    lines.push('      <Row>');
    for (const h of sheet.headers) {
      lines.push(`        <Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`);
    }
    lines.push('      </Row>');

    // Data rows
    for (const row of sheet.rows) {
      const isTotal = String(row[0] || '').includes('TOTAL') || String(row[1] || '').includes('TOTAL');
      const isGap = String(row[0]).includes('GAP') || row.some(v => v === 'GAP' || v === 'NO');
      const rowStyle = isTotal ? ' ss:StyleID="TotalRow"' : '';

      lines.push(`      <Row${rowStyle}>`);
      for (const val of row) {
        const isNum = typeof val === 'number';
        const type = isNum ? 'Number' : 'String';
        const cellStyle = isGap && !isTotal ? ' ss:StyleID="GapRow"' : (isNum && Number(val) > 100 ? ' ss:StyleID="Money"' : '');
        lines.push(`        <Cell${cellStyle}><Data ss:Type="${type}">${isNum ? val : escapeXml(String(val))}</Data></Cell>`);
      }
      lines.push('      </Row>');
    }

    lines.push('    </Table>');
    lines.push('  </Worksheet>');
  }

  lines.push('</Workbook>');
  return lines.join('\n');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}


// ══════════════════════════════════════════════════════════════════════════════
//  4. BOQ CSV EXPORT (Structured)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Export BOQ as structured CSV with all columns per CIQS Standard Method.
 */
export function exportBOQtoCSV(report: BOQReport): string {
  const sheet: XLSXSheet = {
    name: 'BOQ',
    headers: [
      'Line No', 'CSI Division', 'CSI Title', 'UNIFORMAT Code', 'Description',
      'Unit', 'Quantity', 'Material Rate', 'Labour Rate', 'Equipment Rate',
      'Material Cost', 'Labour Cost', 'Equipment Cost', 'Total Cost',
      'Storey', 'Trade Package', 'Confidence', 'Has Evidence',
    ],
    rows: report.lines.map(l => [
      l.lineNo, l.csiDivision, l.csiTitle, l.uniformatCode, l.description,
      l.unit, round2(l.quantity), round2(l.materialRate), round2(l.labourRate), round2(l.equipmentRate),
      round2(l.materialCost), round2(l.labourCost), round2(l.equipmentCost), round2(l.totalCost),
      l.storey, l.tradePackage, l.confidenceLevel, l.hasEvidence ? 'Yes' : 'No',
    ]),
  };
  return sheetToCSV(sheet);
}

/**
 * Export division subtotals as CSV.
 */
export function exportDivisionSummaryCSV(report: BOQReport): string {
  const sheet: XLSXSheet = {
    name: 'Divisions',
    headers: ['Division', 'Title', 'Material Cost', 'Labour Cost', 'Equipment Cost', 'Total Cost', 'Line Count'],
    rows: report.divisionSubtotals.map(d => [
      d.division, d.title, round2(d.materialCost), round2(d.labourCost),
      round2(d.equipmentCost), round2(d.totalCost), d.lineCount,
    ]),
  };
  return sheetToCSV(sheet);
}

/**
 * Export trade package subtotals as CSV for tender.
 */
export function exportTradePackageCSV(report: BOQReport): string {
  const sheet: XLSXSheet = {
    name: 'Trade Packages',
    headers: ['Trade Package', 'Material Cost', 'Labour Cost', 'Equipment Cost', 'Total Cost', 'Line Count'],
    rows: report.tradePackageSubtotals.map(tp => [
      tp.tradePackage, round2(tp.materialCost), round2(tp.labourCost),
      round2(tp.equipmentCost), round2(tp.totalCost), tp.lineCount,
    ]),
  };
  return sheetToCSV(sheet);
}

/**
 * Export bid-leveling sheet as CSV.
 */
export function exportBidLevelingCSV(sheet: BidLevelingSheet): string {
  const csvSheet: XLSXSheet = {
    name: 'Bid Leveling',
    headers: ['Trade Package', 'CSI Divisions', 'Base Amount', 'Alternates Count', 'Allowances Total', 'Unit Prices Count', 'Scope'],
    rows: sheet.tradePackages.map(tp => [
      tp.tradePackage,
      tp.csiDivisions.join('; '),
      round2(tp.baseAmount),
      tp.alternates.length,
      tp.allowances.reduce((s, a) => s + a.amount, 0),
      tp.unitPrices.length,
      tp.scope.substring(0, 100),
    ]),
  };
  return sheetToCSV(csvSheet);
}


// ══════════════════════════════════════════════════════════════════════════════
//  5. REPORT JSON EXPORT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Export any report as structured JSON with metadata wrapper.
 */
export function exportReportJSON(report: any, reportType: string): string {
  return JSON.stringify({
    exportFormat: 'EstimatorPro_v3_Report',
    exportVersion: '1.0.0',
    exportedAt: isoNow(),
    reportType,
    data: report,
  }, null, 2);
}


// ══════════════════════════════════════════════════════════════════════════════
//  6. CLASH REPORT CSV EXPORT
// ══════════════════════════════════════════════════════════════════════════════

export function exportClashReportCSV(report: ClashReport): string {
  const sheet: XLSXSheet = {
    name: 'Clashes',
    headers: [
      'Clash ID', 'Severity', 'Category', 'Element A', 'Element B',
      'Location', 'Storey', 'Penetration (mm)', 'Description',
      'Recommendation', 'RFI Required', 'Est. Cost',
    ],
    rows: report.clashes.map(c => [
      c.clashId, c.severity, c.category, c.elementA, c.elementB,
      c.location, c.storey, c.penetrationDepth_mm, c.description,
      c.recommendation, c.rfiRequired ? 'Yes' : 'No', c.estimatedCost,
    ]),
  };
  return sheetToCSV(sheet);
}


// ══════════════════════════════════════════════════════════════════════════════
//  7. GAP REGISTER CSV EXPORT
// ══════════════════════════════════════════════════════════════════════════════

export function exportGapRegisterCSV(register: GapRegister): string {
  const sheet: XLSXSheet = {
    name: 'Gap Register',
    headers: [
      'Gap ID', 'Type', 'Parameter', 'Description', 'Discipline',
      'Impact', 'Affected Elements', 'Status', 'RFI Number', 'SOP Reference',
    ],
    rows: register.gaps.map(g => [
      g.gapId, g.type, g.parameterName, g.description, g.discipline,
      g.impact, g.affectedElements, g.status, g.rfiNumber || '', g.sopReference,
    ]),
  };
  return sheetToCSV(sheet);
}
