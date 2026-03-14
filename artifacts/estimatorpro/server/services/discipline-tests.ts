/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  DISCIPLINE-SPECIFIC TESTS — SOP Part 12
 *  EstimatorPro v14.35 — Project-agnostic
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Specialized clash/compliance tests beyond the generic engine:
 *    1. Sleeve/firestop verification (penetration → sleeve → firestop system ref)
 *    2. Access panel keep-out (600×600 clearance proxy boxes)
 *    3. Equipment service clearance (ServiceClearance_mm zones)
 *    4. Shaft/riser validation (occupancy, fill %, congestion)
 *    5. Code-specific checks (NFPA, CEC, OBC)
 *
 *  Standards: NBC 2020, OBC 2024, NFPA 13, CEC, CSA B214, CIQS
 *  Consumed by: bim-coordination-router.ts, governance-engine.ts
 *  Depends on:  clash-detection-engine.ts (ResolvedElement, AABB)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { ResolvedElement, AABB, Discipline } from './clash-detection-engine';
import { aabbOverlaps, aabbMinDistance } from './spatial-clash-engine';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type PenetrationStatus = 'OK' | 'SLEEVE_MISSING' | 'FIRESTOP_UNDEFINED' | 'RATING_UNKNOWN' | 'SIZE_UNKNOWN';

export interface PenetrationRecord {
  id: string;
  level: string;
  zone: string;
  gridRef: string;
  hostElement: { id: string; name: string; type: string; discipline: Discipline };
  penetratingElement: { id: string; name: string; type: string; discipline: Discipline };
  sleevePresent: boolean;
  sleeveId: string | null;
  firestopSystem: string | null;
  fireRatingRequired: string | null;
  fireRatingProvided: string | null;
  penetrationSize_mm: number | null;
  status: PenetrationStatus;
  rfiRequired: boolean;
  description: string;
}

export interface AccessPanelCheck {
  elementId: string;
  elementName: string;
  elementType: string;
  requiredClearance_mm: number;
  actualClearance_mm: number;
  obstructingElements: string[];
  passed: boolean;
  description: string;
}

export interface EquipmentClearanceCheck {
  equipmentId: string;
  equipmentName: string;
  requiredClearance_mm: number;
  serviceDirection: string;       // 'FRONT' | 'SIDE' | 'TOP' | 'ALL'
  actualClearance_mm: number;
  obstructingElements: string[];
  passed: boolean;
  codeReference: string;
  description: string;
}

export interface ShaftValidation {
  shaftId: string;
  shaftName: string;
  level: string;
  totalArea_m2: number;
  occupiedArea_m2: number;
  fillPercent: number;
  maxFillPercent: number;          // From specs
  elementCount: number;
  congested: boolean;
  elements: Array<{ id: string; name: string; discipline: Discipline; area_m2: number }>;
  status: 'OK' | 'CONGESTED' | 'OVER_CAPACITY';
  description: string;
}

export interface DisciplineTestResult {
  testDate: string;
  penetrations: PenetrationRecord[];
  accessChecks: AccessPanelCheck[];
  equipmentChecks: EquipmentClearanceCheck[];
  shaftValidations: ShaftValidation[];
  summary: {
    totalPenetrations: number;
    sleevesMissing: number;
    firestopsUndefined: number;
    accessViolations: number;
    equipmentViolations: number;
    congestedShafts: number;
    rfisRequired: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. PENETRATION DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

const STRUCTURAL_TYPES = ['column', 'beam', 'slab', 'wall', 'foundation'];
const MEP_TYPES = ['duct', 'pipe', 'conduit', 'cable tray'];
const SLEEVE_KEYWORDS = ['sleeve', 'penetration', 'opening', 'core hole', 'corehole'];
const _FIRESTOP_KEYWORDS = ['firestop', 'fire stop', 'fire_stop', 'intumescent'];

/**
 * Detect penetrations between MEP and structural elements.
 */
export function detectPenetrations(
  elements: ResolvedElement[],
  sleeveElements: ResolvedElement[] = [],
): PenetrationRecord[] {
  const structural = elements.filter(el =>
    el.discipline === 'structural' || STRUCTURAL_TYPES.some(t => el.elementType.toLowerCase().includes(t))
  );
  const mep = elements.filter(el =>
    ['mechanical', 'electrical', 'plumbing', 'fire_protection'].includes(el.discipline) ||
    MEP_TYPES.some(t => el.elementType.toLowerCase().includes(t))
  );

  // Index sleeves by location for quick lookup
  const sleeveLookup = sleeveElements.length > 0 ? sleeveElements : elements.filter(el =>
    SLEEVE_KEYWORDS.some(k => el.name.toLowerCase().includes(k) || el.elementType.toLowerCase().includes(k))
  );

  const penetrations: PenetrationRecord[] = [];
  let penIdx = 0;

  for (const strEl of structural) {
    for (const mepEl of mep) {
      if (!aabbOverlaps(strEl.bbox, mepEl.bbox)) continue;

      penIdx++;
      const penId = `PEN-${String(penIdx).padStart(4, '0')}`;

      // Check for sleeve at penetration location
      const sleeve = sleeveLookup.find(s => {
        const dist = aabbMinDistance(s.bbox, mepEl.bbox);
        return dist < 0.1; // Within 100mm
      });

      // Check for firestop
      const fireRatingRequired = strEl.properties?.Fire_Rating || strEl.properties?.fireRating || null;
      const firestopSystem = sleeve?.properties?.FirestopSystem || sleeve?.properties?.firestop_system || null;

      let status: PenetrationStatus = 'OK';
      let rfiRequired = false;

      if (!sleeve) {
        status = 'SLEEVE_MISSING';
        rfiRequired = true;
      } else if (fireRatingRequired && !firestopSystem) {
        status = 'FIRESTOP_UNDEFINED';
        rfiRequired = true;
      } else if (fireRatingRequired && !fireRatingRequired.match(/\d/)) {
        status = 'RATING_UNKNOWN';
        rfiRequired = true;
      }

      const mepSize = Math.max(mepEl.dimensions?.width || 0, mepEl.dimensions?.height || 0);
      if (mepSize === 0) {
        status = 'SIZE_UNKNOWN';
      }

      penetrations.push({
        id: penId,
        level: strEl.storey || 'UNKNOWN',
        zone: strEl.properties?.zone || '',
        gridRef: strEl.properties?.gridRef || '',
        hostElement: {
          id: strEl.id || strEl.elementId,
          name: strEl.name,
          type: strEl.elementType,
          discipline: strEl.discipline,
        },
        penetratingElement: {
          id: mepEl.id || mepEl.elementId,
          name: mepEl.name,
          type: mepEl.elementType,
          discipline: mepEl.discipline,
        },
        sleevePresent: !!sleeve,
        sleeveId: sleeve ? (sleeve.id || sleeve.elementId) : null,
        firestopSystem,
        fireRatingRequired,
        fireRatingProvided: firestopSystem ? fireRatingRequired : null,
        penetrationSize_mm: mepSize > 0 ? Math.round(mepSize * 1000) : null,
        status,
        rfiRequired,
        description: `${mepEl.name} penetrates ${strEl.name} at ${strEl.storey || 'unknown level'} — ${status}`,
      });
    }
  }

  return penetrations;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. ACCESS PANEL CLEARANCE
// ═══════════════════════════════════════════════════════════════════════════════

const ACCESS_PANEL_CLEARANCE_MM = 600; // 600×600mm standard access panel

export function checkAccessPanelClearance(
  accessPoints: ResolvedElement[],
  allElements: ResolvedElement[],
  requiredClearance_mm: number = ACCESS_PANEL_CLEARANCE_MM,
): AccessPanelCheck[] {
  const clearance_m = requiredClearance_mm / 1000;
  const results: AccessPanelCheck[] = [];

  for (const ap of accessPoints) {
    const proxyBox: AABB = {
      minX: ap.bbox.minX - clearance_m,
      minY: ap.bbox.minY - clearance_m,
      minZ: ap.bbox.minZ,
      maxX: ap.bbox.maxX + clearance_m,
      maxY: ap.bbox.maxY + clearance_m,
      maxZ: ap.bbox.maxZ + clearance_m,
    };

    const obstructing = allElements.filter(el => {
      if ((el.id || el.elementId) === (ap.id || ap.elementId)) return false;
      return aabbOverlaps(proxyBox, el.bbox);
    });

    const minDist = obstructing.length > 0
      ? Math.min(...obstructing.map(el => aabbMinDistance(ap.bbox, el.bbox) * 1000))
      : requiredClearance_mm;

    results.push({
      elementId: ap.id || ap.elementId,
      elementName: ap.name,
      elementType: ap.elementType,
      requiredClearance_mm,
      actualClearance_mm: Math.round(minDist),
      obstructingElements: obstructing.map(el => el.id || el.elementId),
      passed: obstructing.length === 0,
      description: obstructing.length === 0
        ? `Access panel ${ap.name} has adequate clearance`
        : `Access panel ${ap.name} obstructed by ${obstructing.length} element(s) — clearance ${minDist.toFixed(0)}mm < ${requiredClearance_mm}mm`,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. EQUIPMENT SERVICE CLEARANCE
// ═══════════════════════════════════════════════════════════════════════════════

export function checkEquipmentClearance(
  equipment: ResolvedElement[],
  allElements: ResolvedElement[],
): EquipmentClearanceCheck[] {
  const results: EquipmentClearanceCheck[] = [];

  for (const eq of equipment) {
    const reqClearance = eq.properties?.ServiceClearance_mm
      || eq.properties?.serviceClearance
      || null;

    if (reqClearance === null) continue; // No requirement defined

    const clearance_m = Number(reqClearance) / 1000;
    if (isNaN(clearance_m) || clearance_m <= 0) continue;

    const serviceBox: AABB = {
      minX: eq.bbox.minX - clearance_m,
      minY: eq.bbox.minY - clearance_m,
      minZ: eq.bbox.minZ,
      maxX: eq.bbox.maxX + clearance_m,
      maxY: eq.bbox.maxY + clearance_m,
      maxZ: eq.bbox.maxZ + clearance_m,
    };

    const obstructing = allElements.filter(el => {
      if ((el.id || el.elementId) === (eq.id || eq.elementId)) return false;
      return aabbOverlaps(serviceBox, el.bbox);
    });

    const minDist = obstructing.length > 0
      ? Math.min(...obstructing.map(el => aabbMinDistance(eq.bbox, el.bbox) * 1000))
      : Number(reqClearance);

    results.push({
      equipmentId: eq.id || eq.elementId,
      equipmentName: eq.name,
      requiredClearance_mm: Number(reqClearance),
      serviceDirection: eq.properties?.serviceDirection || 'ALL',
      actualClearance_mm: Math.round(minDist),
      obstructingElements: obstructing.map(el => el.id || el.elementId),
      passed: obstructing.length === 0,
      codeReference: eq.discipline === 'electrical' ? 'CEC 26-402' : 'Project spec',
      description: obstructing.length === 0
        ? `Equipment ${eq.name} has adequate service clearance`
        : `Equipment ${eq.name} service zone violated by ${obstructing.length} element(s)`,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. SHAFT / RISER VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_MAX_SHAFT_FILL = 0.40; // 40% maximum fill ratio

export function validateShafts(
  shaftElements: ResolvedElement[],
  routedElements: ResolvedElement[],
  maxFillPercent: number = DEFAULT_MAX_SHAFT_FILL,
): ShaftValidation[] {
  const results: ShaftValidation[] = [];

  for (const shaft of shaftElements) {
    const shaftArea = (shaft.bbox.maxX - shaft.bbox.minX) * (shaft.bbox.maxY - shaft.bbox.minY);

    // Find elements routed through this shaft
    const contained = routedElements.filter(el => aabbOverlaps(shaft.bbox, el.bbox));
    const occupiedArea = contained.reduce((sum, el) => {
      const elArea = (el.bbox.maxX - el.bbox.minX) * (el.bbox.maxY - el.bbox.minY);
      return sum + elArea;
    }, 0);

    const fillPercent = shaftArea > 0 ? occupiedArea / shaftArea : 0;
    const congested = fillPercent > maxFillPercent;

    results.push({
      shaftId: shaft.id || shaft.elementId,
      shaftName: shaft.name,
      level: shaft.storey || 'UNKNOWN',
      totalArea_m2: Math.round(shaftArea * 1000) / 1000,
      occupiedArea_m2: Math.round(occupiedArea * 1000) / 1000,
      fillPercent: Math.round(fillPercent * 100),
      maxFillPercent: Math.round(maxFillPercent * 100),
      elementCount: contained.length,
      congested,
      elements: contained.map(el => ({
        id: el.id || el.elementId,
        name: el.name,
        discipline: el.discipline,
        area_m2: Math.round(((el.bbox.maxX - el.bbox.minX) * (el.bbox.maxY - el.bbox.minY)) * 1000) / 1000,
      })),
      status: fillPercent > maxFillPercent * 1.5 ? 'OVER_CAPACITY' : congested ? 'CONGESTED' : 'OK',
      description: congested
        ? `Shaft ${shaft.name} at ${(fillPercent * 100).toFixed(0)}% fill (max ${(maxFillPercent * 100).toFixed(0)}%) — ${contained.length} elements`
        : `Shaft ${shaft.name} at ${(fillPercent * 100).toFixed(0)}% fill — within limits`,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. FULL TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════════

export function runDisciplineTests(elements: ResolvedElement[]): DisciplineTestResult {
  const accessKeywords = ['access', 'panel', 'door', 'hatch', 'damper'];
  const equipKeywords = ['equipment', 'ahu', 'rtu', 'vav', 'panel', 'switchgear', 'transformer', 'pump'];
  const shaftKeywords = ['shaft', 'riser', 'chase', 'duct shaft'];

  const accessPoints = elements.filter(el =>
    accessKeywords.some(k => el.name.toLowerCase().includes(k) || el.elementType.toLowerCase().includes(k))
  );
  const equipment = elements.filter(el =>
    equipKeywords.some(k => el.name.toLowerCase().includes(k) || el.elementType.toLowerCase().includes(k))
  );
  const shafts = elements.filter(el =>
    shaftKeywords.some(k => el.name.toLowerCase().includes(k) || el.elementType.toLowerCase().includes(k))
  );
  const mepElements = elements.filter(el =>
    ['mechanical', 'electrical', 'plumbing', 'fire_protection'].includes(el.discipline)
  );

  const penetrations = detectPenetrations(elements);
  const accessChecks = checkAccessPanelClearance(accessPoints, elements);
  const equipmentChecks = checkEquipmentClearance(equipment, elements);
  const shaftValidations = validateShafts(shafts, mepElements);

  return {
    testDate: new Date().toISOString(),
    penetrations,
    accessChecks,
    equipmentChecks,
    shaftValidations,
    summary: {
      totalPenetrations: penetrations.length,
      sleevesMissing: penetrations.filter(p => p.status === 'SLEEVE_MISSING').length,
      firestopsUndefined: penetrations.filter(p => p.status === 'FIRESTOP_UNDEFINED').length,
      accessViolations: accessChecks.filter(a => !a.passed).length,
      equipmentViolations: equipmentChecks.filter(e => !e.passed).length,
      congestedShafts: shaftValidations.filter(s => s.congested).length,
      rfisRequired: penetrations.filter(p => p.rfiRequired).length,
    },
  };
}
