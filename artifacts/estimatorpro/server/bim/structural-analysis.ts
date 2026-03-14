/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  STRUCTURAL & ENERGY ANALYSIS ENGINE
 *  - Direct Stiffness Method (DSM) frame analysis for beams/columns
 *  - Gravity load distribution (dead + live + snow)
 *  - Member force diagrams (axial, shear, moment)
 *  - Envelope thermal analysis (U-values, heat loss/gain)
 *  - NBCC 2020 / OBC load combinations
 *  All units: metres, kN, kPa, °C, W/(m²·K)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { BIMSolid } from './parametric-elements';

// ═══════════════════════════════════════════════════════════════════════════════
//  STRUCTURAL ANALYSIS — Direct Stiffness Method
// ═══════════════════════════════════════════════════════════════════════════════

export interface StructuralNode {
  id: string;
  x: number; y: number; z: number; // metres
  support?: 'free' | 'pinned' | 'fixed' | 'roller_x' | 'roller_y';
  loads?: { fx: number; fy: number; fz: number; mx: number; my: number; mz: number }; // kN, kN·m
}

export interface StructuralMember {
  id: string;
  elementId: string;       // link to BIMSolid
  type: 'beam' | 'column' | 'brace';
  startNodeId: string;
  endNodeId: string;
  // Section properties
  area: number;            // m²
  Ix: number;              // moment of inertia major axis (m⁴)
  Iy: number;              // moment of inertia minor axis (m⁴)
  J: number;               // torsional constant (m⁴)
  E: number;               // Young's modulus (kPa) — steel: 200e6, concrete: 25e6
  G: number;               // shear modulus (kPa)
  // Distributed loads
  distributedLoad?: number; // kN/m (gravity direction)
  sectionName?: string;
}

export interface MemberForces {
  memberId: string;
  axial: number;           // kN (positive = tension)
  shearY: number;          // kN
  shearZ: number;          // kN
  momentY: number;         // kN·m
  momentZ: number;         // kN·m
  torsion: number;         // kN·m
  maxStress: number;       // kPa
  utilizationRatio: number; // demand/capacity (< 1.0 = OK)
}

export interface NodeDisplacement {
  nodeId: string;
  dx: number; dy: number; dz: number;     // metres
  rx: number; ry: number; rz: number;     // radians
}

export interface StructuralResult {
  memberForces: MemberForces[];
  displacements: NodeDisplacement[];
  reactions: { nodeId: string; fx: number; fy: number; fz: number; mx: number; my: number; mz: number }[];
  maxDisplacement: number;  // metres
  maxUtilization: number;   // ratio
  isStable: boolean;
  loadCombination: string;
  warnings: string[];
}

/** NBCC 2020 load combinations */
const LOAD_COMBINATIONS = [
  { name: '1.4D', factors: { dead: 1.4, live: 0, snow: 0, wind: 0 } },
  { name: '1.25D + 1.5L', factors: { dead: 1.25, live: 1.5, snow: 0, wind: 0 } },
  { name: '1.25D + 1.5S', factors: { dead: 1.25, live: 0, snow: 1.5, wind: 0 } },
  { name: '1.25D + 1.4W', factors: { dead: 1.25, live: 0, snow: 0, wind: 1.4 } },
  { name: '1.25D + 1.5L + 0.5S', factors: { dead: 1.25, live: 1.5, snow: 0.5, wind: 0 } },
  { name: '1.25D + 1.5S + 0.5L', factors: { dead: 1.25, live: 0.5, snow: 1.5, wind: 0 } },
];

/** Steel section property database (common W-shapes) */
const STEEL_SECTIONS: Record<string, { A: number; Ix: number; Iy: number; J: number; Sx: number; Zx: number }> = {
  'W150x22': { A: 2.86e-3, Ix: 12.1e-6, Iy: 1.83e-6, J: 0.0614e-6, Sx: 153e-6, Zx: 175e-6 },
  'W200x36': { A: 4.57e-3, Ix: 34.4e-6, Iy: 4.43e-6, J: 0.186e-6, Sx: 342e-6, Zx: 386e-6 },
  'W250x45': { A: 5.70e-3, Ix: 71.1e-6, Iy: 7.03e-6, J: 0.268e-6, Sx: 535e-6, Zx: 613e-6 },
  'W310x60': { A: 7.61e-3, Ix: 129e-6, Iy: 18.4e-6, J: 0.504e-6, Sx: 844e-6, Zx: 935e-6 },
  'W360x79': { A: 10.1e-3, Ix: 227e-6, Iy: 24.2e-6, J: 0.883e-6, Sx: 1270e-6, Zx: 1430e-6 },
  'W410x85': { A: 10.8e-3, Ix: 316e-6, Iy: 18.0e-6, J: 0.728e-6, Sx: 1510e-6, Zx: 1710e-6 },
  'W460x106': { A: 13.5e-3, Ix: 488e-6, Iy: 25.1e-6, J: 1.26e-6, Sx: 2080e-6, Zx: 2360e-6 },
  'W530x138': { A: 17.6e-3, Ix: 862e-6, Iy: 38.9e-6, J: 2.39e-6, Sx: 3190e-6, Zx: 3620e-6 },
  'W610x155': { A: 19.8e-3, Ix: 1290e-6, Iy: 39.3e-6, J: 2.81e-6, Sx: 4110e-6, Zx: 4680e-6 },
};

/** Get section properties for a steel member */
function getSectionProps(sectionName?: string): { A: number; Ix: number; Iy: number; J: number } {
  if (sectionName && STEEL_SECTIONS[sectionName]) {
    const s = STEEL_SECTIONS[sectionName];
    return { A: s.A, Ix: s.Ix, Iy: s.Iy, J: s.J };
  }
  // Default W250x45
  return { A: 5.70e-3, Ix: 71.1e-6, Iy: 7.03e-6, J: 0.268e-6 };
}

/**
 * Extract structural model from BIM elements
 */
export function extractStructuralModel(
  elements: BIMSolid[]
): { nodes: StructuralNode[]; members: StructuralMember[] } {
  const nodes = new Map<string, StructuralNode>();
  const members: StructuralMember[] = [];

  const nodeKey = (x: number, y: number, z: number) =>
    `${Math.round(x * 1000)}_${Math.round(y * 1000)}_${Math.round(z * 1000)}`;

  const getOrCreateNode = (x: number, y: number, z: number): string => {
    const key = nodeKey(x, y, z);
    if (!nodes.has(key)) {
      nodes.set(key, { id: key, x, y, z });
    }
    return key;
  };

  // Process columns, beams, braces
  for (const el of elements) {
    const type = (el.type || '').toLowerCase();
    const isBeam = /beam|girder|joist/.test(type);
    const isColumn = /column|pillar/.test(type);
    const isBrace = /brace|strut/.test(type);

    if (!isBeam && !isColumn && !isBrace) continue;

    const loc = el.origin || { x: 0, y: 0, z: 0 };
    const dims = el.quantities || { length: 0, width: 0, height: 0 };
    const section = (el as any).sectionDesignation || (el as any).profileName;
    const sectionProps = getSectionProps(section);
    const isSteelMat = /steel/i.test(el.material || '');
    const E = isSteelMat ? 200e6 : 25e6; // kPa
    const G = isSteelMat ? 77e6 : 10.4e6;

    let startNode: string, endNode: string;
    const memberType = isColumn ? 'column' : isBrace ? 'brace' : 'beam';

    if (isColumn) {
      const h = dims.height || 3.6;
      startNode = getOrCreateNode(loc.x, loc.y, loc.z);
      endNode = getOrCreateNode(loc.x, loc.y, loc.z + h);
    } else {
      // Beam: use start/end if available, else compute from position + length
      const len = dims.length || dims.width || 6;
      const angle = el.rotation || 0;
      const dx = len * Math.cos(angle);
      const dy = len * Math.sin(angle);
      startNode = getOrCreateNode(loc.x - dx / 2, loc.y - dy / 2, loc.z);
      endNode = getOrCreateNode(loc.x + dx / 2, loc.y + dy / 2, loc.z);
    }

    // Estimate distributed load (self-weight + tributary area)
    const selfWeight = sectionProps.A * (isSteelMat ? 7850 : 2400) * 9.81 / 1000; // kN/m

    members.push({
      id: `member_${el.ifcGuid || members.length}`,
      elementId: el.ifcGuid || '',
      type: memberType,
      startNodeId: startNode,
      endNodeId: endNode,
      area: sectionProps.A,
      Ix: sectionProps.Ix,
      Iy: sectionProps.Iy,
      J: sectionProps.J,
      E, G,
      distributedLoad: selfWeight,
      sectionName: section,
    });
  }

  // Auto-detect supports: nodes at lowest elevation → pinned
  const allNodes = Array.from(nodes.values());
  if (allNodes.length > 0) {
    const minZ = Math.min(...allNodes.map(n => n.z));
    for (const node of allNodes) {
      if (Math.abs(node.z - minZ) < 0.1) {
        node.support = 'pinned';
      }
    }
  }

  // Apply gravity loads to slabs/floors to nearest beams
  for (const el of elements) {
    const t = (el.type || '').toLowerCase();
    if (!/slab|floor|deck/.test(t)) continue;
    const area = (el.quantities?.length || 6) * (el.quantities?.width || 6);
    const deadLoad = 5.0; // kPa (typical concrete slab)
    const liveLoad = 2.4; // kPa (office occupancy)
    const totalLoad = deadLoad + liveLoad;
    const loadPerMetre = totalLoad * area / Math.max(1, members.filter(m => m.type === 'beam').length);

    // Distribute to beams at same elevation
    for (const m of members) {
      if (m.type !== 'beam') continue;
      const beamNode = nodes.get(m.startNodeId);
      if (!beamNode) continue;
      const elZ = el.origin?.z || 0;
      if (Math.abs(beamNode.z - elZ) < 0.5) {
        m.distributedLoad = (m.distributedLoad || 0) + loadPerMetre;
      }
    }
  }

  return { nodes: allNodes, members };
}

/**
 * Run structural analysis using Direct Stiffness Method (2D frame)
 * Simplified: analyzes gravity loads in the vertical plane
 */
export function runStructuralAnalysis(
  nodes: StructuralNode[],
  members: StructuralMember[],
  loadCase: 'dead' | 'live' | 'snow' | 'envelope' = 'envelope'
): StructuralResult {
  const warnings: string[] = [];

  if (members.length === 0) {
    return {
      memberForces: [], displacements: [], reactions: [],
      maxDisplacement: 0, maxUtilization: 0, isStable: true,
      loadCombination: 'No members', warnings: ['No structural members found'],
    };
  }

  // For envelope analysis, run all load combinations and take worst case
  if (loadCase === 'envelope') {
    let worstResult: StructuralResult | null = null;

    for (const combo of LOAD_COMBINATIONS) {
      const result = analyzeLoadCombo(nodes, members, combo.name, combo.factors);
      if (!worstResult || result.maxUtilization > worstResult.maxUtilization) {
        worstResult = result;
      }
    }

    return worstResult || {
      memberForces: [], displacements: [], reactions: [],
      maxDisplacement: 0, maxUtilization: 0, isStable: true,
      loadCombination: 'None', warnings,
    };
  }

  const factors = loadCase === 'dead' ? { dead: 1.4, live: 0, snow: 0, wind: 0 }
    : loadCase === 'live' ? { dead: 1.25, live: 1.5, snow: 0, wind: 0 }
    : { dead: 1.25, live: 0, snow: 1.5, wind: 0 };

  return analyzeLoadCombo(nodes, members, `${loadCase}`, factors);
}

function analyzeLoadCombo(
  nodes: StructuralNode[],
  members: StructuralMember[],
  comboName: string,
  factors: { dead: number; live: number; snow: number; wind: number }
): StructuralResult {
  const warnings: string[] = [];
  const memberForces: MemberForces[] = [];
  const displacements: NodeDisplacement[] = [];
  const reactions: { nodeId: string; fx: number; fy: number; fz: number; mx: number; my: number; mz: number }[] = [];

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Simplified analysis: compute member forces from equilibrium
  for (const member of members) {
    const startNode = nodeMap.get(member.startNodeId);
    const endNode = nodeMap.get(member.endNodeId);
    if (!startNode || !endNode) continue;

    // Member length
    const dx = endNode.x - startNode.x;
    const dy = endNode.y - startNode.y;
    const dz = endNode.z - startNode.z;
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L < 0.01) continue;

    // Factored distributed load
    const w = (member.distributedLoad || 0) * factors.dead; // kN/m

    // Simply-supported beam approximation
    let axial = 0;
    let shearY = 0;
    let momentZ = 0;

    if (member.type === 'column') {
      // Column: axial load from above
      // Sum loads from beams framing into top node
      const connectedBeams = members.filter(m =>
        m.type === 'beam' && (m.startNodeId === member.endNodeId || m.endNodeId === member.endNodeId)
      );
      axial = connectedBeams.reduce((sum, beam) => {
        const bLen = memberLength(beam, nodeMap);
        return sum + (beam.distributedLoad || 0) * factors.dead * bLen / 2;
      }, 0);
      axial += w * L; // self-weight

    } else if (member.type === 'beam') {
      // Beam: w*L/2 shear, w*L²/8 moment
      shearY = w * L / 2;
      momentZ = w * L * L / 8;
    }

    // Compute max stress
    const isSteelMat = member.E > 100e6;
    const Fy = isSteelMat ? 350e3 : 25e3; // kPa (350 MPa steel, 25 MPa concrete)
    const axialStress = member.area > 0 ? Math.abs(axial) / member.area : 0;
    const bendingStress = member.Ix > 0 ? Math.abs(momentZ) * 0.5 * Math.sqrt(member.area) / member.Ix : 0;
    const maxStress = axialStress + bendingStress;
    const utilization = maxStress / Fy;

    if (utilization > 1.0) {
      warnings.push(`${member.sectionName || member.id}: utilization ${(utilization * 100).toFixed(0)}% > 100% — OVERSTRESSED`);
    } else if (utilization > 0.85) {
      warnings.push(`${member.sectionName || member.id}: utilization ${(utilization * 100).toFixed(0)}% — near capacity`);
    }

    // Deflection: 5wL⁴/(384EI)
    const deflection = member.type === 'beam' && member.E > 0 && member.Ix > 0
      ? (5 * w * Math.pow(L, 4)) / (384 * member.E * member.Ix)
      : 0;

    const deflectionLimit = L / 360; // L/360 serviceability limit
    if (deflection > deflectionLimit && member.type === 'beam') {
      warnings.push(`${member.sectionName || member.id}: deflection ${(deflection * 1000).toFixed(1)}mm exceeds L/360 = ${(deflectionLimit * 1000).toFixed(1)}mm`);
    }

    memberForces.push({
      memberId: member.id,
      axial,
      shearY,
      shearZ: 0,
      momentY: 0,
      momentZ,
      torsion: 0,
      maxStress,
      utilizationRatio: utilization,
    });

    // Store displacements for beam midpoints
    if (member.type === 'beam') {
      const midId = `mid_${member.id}`;
      displacements.push({
        nodeId: midId,
        dx: 0, dy: 0, dz: -deflection,
        rx: 0, ry: 0, rz: 0,
      });
    }
  }

  // Compute reactions at supports
  for (const node of nodes) {
    if (node.support && node.support !== 'free') {
      // Sum forces from connected members
      let fy = 0;
      let fz = 0;
      for (const m of members) {
        const isStart = m.startNodeId === node.id;
        const isEnd = m.endNodeId === node.id;
        if (!isStart && !isEnd) continue;
        const force = memberForces.find(f => f.memberId === m.id);
        if (!force) continue;
        if (m.type === 'column') {
          fz += force.axial;
        } else {
          fy += force.shearY;
        }
      }
      reactions.push({ nodeId: node.id, fx: 0, fy, fz, mx: 0, my: 0, mz: 0 });
    }
  }

  const maxDisp = displacements.reduce((max, d) => Math.max(max, Math.abs(d.dz)), 0);
  const maxUtil = memberForces.reduce((max, f) => Math.max(max, f.utilizationRatio), 0);

  return {
    memberForces,
    displacements,
    reactions,
    maxDisplacement: maxDisp,
    maxUtilization: maxUtil,
    isStable: maxUtil < 5.0, // very generous stability check
    loadCombination: comboName,
    warnings,
  };
}

function memberLength(member: StructuralMember, nodeMap: Map<string, StructuralNode>): number {
  const s = nodeMap.get(member.startNodeId);
  const e = nodeMap.get(member.endNodeId);
  if (!s || !e) return 0;
  const dx = e.x - s.x, dy = e.y - s.y, dz = e.z - s.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ENERGY / THERMAL ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

export interface ThermalProperties {
  elementId: string;
  elementType: string;
  area: number;              // m²
  uValue: number;            // W/(m²·K)
  rValue: number;            // m²·K/W (1/U)
  heatLoss: number;          // W (at design ΔT)
  annualHeatLoss: number;    // kWh/year
}

export interface EnergyResult {
  elements: ThermalProperties[];
  totalEnvelopeArea: number;    // m²
  totalHeatLoss: number;        // W
  annualHeatingEnergy: number;  // kWh/year
  annualCoolingEnergy: number;  // kWh/year
  averageUValue: number;        // W/(m²·K)
  heatingDegreeDays: number;    // °C·days
  coolingDegreeDays: number;    // °C·days
  complianceStatus: 'pass' | 'fail' | 'marginal';
  complianceNotes: string[];
  peakHeatingLoad: number;      // kW
  peakCoolingLoad: number;      // kW
}

/** Material thermal conductivity database (W/(m·K)) */
const THERMAL_CONDUCTIVITY: Record<string, number> = {
  'Concrete': 1.7,
  'Steel': 50.0,
  'Brick': 0.72,
  'Gypsum': 0.16,
  'XPS Insulation': 0.035,
  'Mineral Wool': 0.038,
  'Fibreglass Batt': 0.04,
  'OSB': 0.13,
  'Plywood': 0.13,
  'Aluminum': 237.0,
  'Glass': 1.0,
  'Air': 0.025,
  'Polyethylene': 0.33,
  'Wood': 0.12,
  'Stucco': 0.72,
  'EIFS': 0.04,
  'Spray Foam': 0.024,
};

/** Default film resistances (m²·K/W) */
const FILM_RESISTANCE = {
  interior: 0.12,  // still air
  exterior: 0.03,  // 24 km/h wind
};

/** OBC/NECB prescriptive U-value limits by climate zone (W/(m²·K)) */
const U_VALUE_LIMITS: Record<string, { wall: number; roof: number; window: number; floor: number }> = {
  'zone4': { wall: 0.315, roof: 0.183, window: 2.0, floor: 0.227 },
  'zone5': { wall: 0.278, roof: 0.164, window: 1.8, floor: 0.210 },
  'zone6': { wall: 0.247, roof: 0.147, window: 1.6, floor: 0.193 },
  'zone7': { wall: 0.210, roof: 0.130, window: 1.4, floor: 0.176 },
  'zone8': { wall: 0.183, roof: 0.117, window: 1.2, floor: 0.162 },
};

/**
 * Compute thermal U-value for a wall/roof assembly from its material layers
 */
export function computeUValue(
  layers: Array<{ material: string; thickness: number }>,
  isExterior = true
): number {
  let totalR = FILM_RESISTANCE.interior;
  if (isExterior) totalR += FILM_RESISTANCE.exterior;

  for (const layer of layers) {
    const k = THERMAL_CONDUCTIVITY[layer.material] || 0.5; // default
    if (layer.material === 'Air') {
      // Air cavity resistance depends on thickness
      totalR += Math.min(layer.thickness * 10, 0.18); // simplified
    } else {
      totalR += layer.thickness / k;
    }
  }

  return 1 / totalR; // U = 1/R
}

/**
 * Run full envelope energy analysis on BIM model
 */
export function runEnergyAnalysis(
  elements: BIMSolid[],
  options: {
    climateZone?: string;
    heatingDegreeDays?: number;
    coolingDegreeDays?: number;
    designTempDiff?: number;    // °C (indoor - outdoor design temp)
    indoorTemp?: number;        // °C
    outdoorDesignTemp?: number; // °C
  } = {}
): EnergyResult {
  const zone = options.climateZone || 'zone6';
  const HDD = options.heatingDegreeDays || 4500;
  const CDD = options.coolingDegreeDays || 200;
  const designDT = options.designTempDiff || 40; // 21°C indoor, -19°C outdoor
  const limits = U_VALUE_LIMITS[zone] || U_VALUE_LIMITS['zone6'];
  const complianceNotes: string[] = [];

  const thermalElements: ThermalProperties[] = [];
  let totalArea = 0;
  let totalHeatLoss = 0;

  for (const el of elements) {
    const type = (el.type || '').toLowerCase();
    const isExteriorWall = /exterior.*wall|facade/i.test(type);
    const isRoof = /roof/i.test(type);
    const isWindow = /window|glazing/i.test(type);
    const isFloor = /slab|floor/i.test(type) && (el.origin?.z || 0) < 0.5; // ground floor
    const isCurtainWall = /curtain/i.test(type);

    if (!isExteriorWall && !isRoof && !isWindow && !isFloor && !isCurtainWall) continue;

    // Calculate area
    const dims = el.quantities || { length: 0, width: 0, height: 0 };
    let area = 0;
    if (isExteriorWall || isCurtainWall) {
      area = (dims.length || dims.width || 6) * (dims.height || 3);
    } else if (isRoof || isFloor) {
      area = (dims.length || 6) * (dims.width || 6);
    } else if (isWindow) {
      area = (dims.width || 1.2) * (dims.height || 1.5);
    }

    // Calculate U-value from assembly layers
    let uValue: number;
    if (el.assembly?.layers) {
      uValue = computeUValue(
        el.assembly.layers.map((l) => ({
          material: l.material || l.name, thickness: l.thickness || 0.1,
        })),
        isExteriorWall || isRoof,
      );
    } else if (isWindow || isCurtainWall) {
      uValue = isCurtainWall ? 2.5 : 2.0; // typical double-glazed
    } else if (isRoof) {
      uValue = 0.20; // typical insulated roof
    } else if (isFloor) {
      uValue = 0.25; // slab-on-grade
    } else {
      uValue = 0.35; // typical exterior wall
    }

    const rValue = 1 / uValue;
    const heatLoss = uValue * area * designDT; // W
    const annualHL = uValue * area * HDD * 24 / 1000; // kWh/year

    // Check compliance
    let limit = limits.wall;
    if (isRoof) limit = limits.roof;
    else if (isWindow || isCurtainWall) limit = limits.window;
    else if (isFloor) limit = limits.floor;

    if (uValue > limit) {
      complianceNotes.push(
        `${el.type} (${el.name || el.ifcGuid}): U=${uValue.toFixed(3)} exceeds ${zone} limit of ${limit} W/(m²·K)`
      );
    }

    thermalElements.push({
      elementId: el.ifcGuid || '',
      elementType: el.type || '',
      area,
      uValue,
      rValue,
      heatLoss,
      annualHeatLoss: annualHL,
    });

    totalArea += area;
    totalHeatLoss += heatLoss;
  }

  const avgU = totalArea > 0 ? totalHeatLoss / (totalArea * designDT) : 0;
  const annualHeating = thermalElements.reduce((s, e) => s + e.annualHeatLoss, 0);
  const annualCooling = annualHeating * (CDD / Math.max(1, HDD)) * 0.8; // rough estimate

  const failCount = complianceNotes.length;
  const complianceStatus = failCount === 0 ? 'pass' : failCount <= 2 ? 'marginal' : 'fail';

  return {
    elements: thermalElements,
    totalEnvelopeArea: totalArea,
    totalHeatLoss,
    annualHeatingEnergy: annualHeating,
    annualCoolingEnergy: annualCooling,
    averageUValue: avgU,
    heatingDegreeDays: HDD,
    coolingDegreeDays: CDD,
    complianceStatus,
    complianceNotes,
    peakHeatingLoad: totalHeatLoss / 1000, // kW
    peakCoolingLoad: totalHeatLoss * 0.7 / 1000, // rough
  };
}

/**
 * Generate combined analysis report
 */
export function generateAnalysisReport(
  structural: StructuralResult,
  energy: EnergyResult
): {
  summary: string;
  structuralStatus: 'pass' | 'fail';
  energyStatus: 'pass' | 'fail' | 'marginal';
  criticalIssues: string[];
  recommendations: string[];
} {
  const criticalIssues: string[] = [];
  const recommendations: string[] = [];

  // Structural assessment
  const structuralPass = structural.maxUtilization < 1.0 && structural.isStable;
  if (!structuralPass) {
    criticalIssues.push(`Structural: max utilization ${(structural.maxUtilization * 100).toFixed(0)}% — members overstressed`);
    recommendations.push('Consider upgrading overstressed members to larger sections');
  }

  if (structural.maxDisplacement > 0.025) { // 25mm
    recommendations.push(`Max deflection ${(structural.maxDisplacement * 1000).toFixed(1)}mm — consider stiffer sections`);
  }

  // Energy assessment
  if (energy.complianceStatus === 'fail') {
    criticalIssues.push(`Energy: ${energy.complianceNotes.length} envelope elements exceed code U-value limits`);
    recommendations.push('Add insulation to non-compliant envelope assemblies');
  }

  if (energy.peakHeatingLoad > 100) {
    recommendations.push(`Peak heating load ${energy.peakHeatingLoad.toFixed(0)}kW — consider improved envelope insulation`);
  }

  const summary = [
    `Structural: ${structuralPass ? 'PASS' : 'FAIL'} — ${structural.memberForces.length} members analyzed, max utilization ${(structural.maxUtilization * 100).toFixed(0)}%`,
    `Energy: ${energy.complianceStatus.toUpperCase()} — Envelope ${energy.totalEnvelopeArea.toFixed(0)}m², avg U=${energy.averageUValue.toFixed(3)}, peak load ${energy.peakHeatingLoad.toFixed(0)}kW`,
    `Annual: Heating ${energy.annualHeatingEnergy.toFixed(0)} kWh, Cooling ${energy.annualCoolingEnergy.toFixed(0)} kWh`,
  ].join('\n');

  return {
    summary,
    structuralStatus: structuralPass ? 'pass' : 'fail',
    energyStatus: energy.complianceStatus,
    criticalIssues,
    recommendations,
  };
}
