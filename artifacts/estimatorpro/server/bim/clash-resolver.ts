/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  INTELLIGENT CLASH RESOLUTION — AI-Powered Clash Resolution Engine
 *  Goes beyond detection to propose and apply fixes:
 *  - Reroute MEP around structural obstacles
 *  - Raise/lower elements to clear conflicts
 *  - Resize elements to eliminate overlaps
 *  - Propose penetration sleeves for acceptable crossings
 *  - Priority-based resolution (structural > architectural > MEP)
 *  Uses Claude API for complex multi-element resolution strategies.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { BIMSolid } from './parametric-elements';
import type { ClashResult, ClashType, ClashSeverity } from './clash-detection';
import type { Vec3, AABB } from './geometry-kernel';
import { vec3, v3add, v3sub, v3scale, v3len, v3normalize } from './geometry-kernel';
import { autoRouteMEP, type AutoRoutingParams, type AutoRoutingResult } from './mep-routing';

// ═══════════════════════════════════════════════════════════════════════════════
//  RESOLUTION STRATEGY TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type ResolutionStrategy =
  | 'reroute'          // reroute MEP element around obstacle
  | 'move'             // move element to new position
  | 'resize'           // adjust element dimensions
  | 'raise'            // raise element vertically
  | 'lower'            // lower element vertically
  | 'add_sleeve'       // add penetration sleeve (acceptable crossing)
  | 'add_offset'       // add horizontal offset
  | 'split'            // split element into two around obstacle
  | 'swap_priority'    // change construction sequence
  | 'flag_rfi'         // cannot auto-resolve, create RFI
  | 'accept';          // mark as acceptable (non-issue)

export interface ResolutionProposal {
  id: string;
  clashId: string;
  strategy: ResolutionStrategy;
  description: string;
  confidence: number;         // 0-1 confidence in the proposal
  priority: number;           // 1-10, higher = apply first
  affectedElementIds: string[];
  modifications: ElementModification[];
  newElements?: NewElementSpec[];   // e.g., penetration sleeve
  estimatedCost: number;      // CAD$ impact estimate
  riskLevel: 'low' | 'medium' | 'high';
  requiresReview: boolean;    // needs human approval
  reasoning: string;
}

export interface ElementModification {
  elementId: string;
  property: string;
  oldValue: any;
  newValue: any;
}

export interface NewElementSpec {
  type: string;
  name: string;
  position: Vec3;
  dimensions: { width?: number; height?: number; length?: number; diameter?: number };
  material: string;
  storey: string;
  purpose: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RESOLUTION RULES — Domain knowledge for automatic resolution
// ═══════════════════════════════════════════════════════════════════════════════

interface ResolutionRule {
  name: string;
  applies: (clash: ClashResult, elA: BIMSolid, elB: BIMSolid) => boolean;
  propose: (clash: ClashResult, elA: BIMSolid, elB: BIMSolid, elements: Map<string, BIMSolid>) => ResolutionProposal[];
}

const PRIORITY_ORDER: Record<string, number> = {
  'Structural': 100,
  'Architectural': 50,
  'MEP': 10,
};

/** Determine which element should yield based on discipline priority */
function yieldingElement(elA: BIMSolid, elB: BIMSolid): { yielding: BIMSolid; fixed: BIMSolid } {
  const prioA = PRIORITY_ORDER[elA.category] || 0;
  const prioB = PRIORITY_ORDER[elB.category] || 0;

  if (prioA >= prioB) return { fixed: elA, yielding: elB };
  return { fixed: elB, yielding: elA };
}

function makeId(): string {
  return `res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const RESOLUTION_RULES: ResolutionRule[] = [
  // ── Rule 1: MEP vs Structural → Reroute MEP ──────────────────────
  {
    name: 'MEP_reroute_around_structural',
    applies: (clash, elA, elB) => {
      const hasMEP = elA.category === 'MEP' || elB.category === 'MEP';
      const hasStructural = elA.category === 'Structural' || elB.category === 'Structural';
      return hasMEP && hasStructural;
    },
    propose: (clash, elA, elB, elements) => {
      const { yielding, fixed } = yieldingElement(elA, elB);
      const proposals: ResolutionProposal[] = [];

      // Strategy 1: Reroute below/above the structural element
      const structBB = fixed.boundingBox;
      const clearance = 0.05; // 50mm clearance

      // Option A: Route above
      const raiseAmount = structBB.max.z - yielding.origin.z + clearance;
      if (raiseAmount > 0 && raiseAmount < 2) {
        proposals.push({
          id: makeId(),
          clashId: clash.id,
          strategy: 'raise',
          description: `Raise ${yielding.type} "${yielding.name}" by ${(raiseAmount * 1000).toFixed(0)}mm to clear ${fixed.type} "${fixed.name}"`,
          confidence: 0.85,
          priority: 7,
          affectedElementIds: [yielding.id],
          modifications: [{
            elementId: yielding.id,
            property: 'origin.z',
            oldValue: yielding.origin.z,
            newValue: yielding.origin.z + raiseAmount,
          }],
          estimatedCost: raiseAmount * 50, // rough additional cost per metre of height change
          riskLevel: 'low',
          requiresReview: false,
          reasoning: `Moving ${yielding.type} above ${fixed.type} maintains ${clearance * 1000}mm clearance. Structural elements have priority over MEP.`,
        });
      }

      // Option B: Route below
      const lowerAmount = yielding.origin.z - structBB.min.z + clearance;
      if (lowerAmount > 0 && lowerAmount < 2) {
        proposals.push({
          id: makeId(),
          clashId: clash.id,
          strategy: 'lower',
          description: `Lower ${yielding.type} "${yielding.name}" by ${(lowerAmount * 1000).toFixed(0)}mm below ${fixed.type} "${fixed.name}"`,
          confidence: 0.75,
          priority: 6,
          affectedElementIds: [yielding.id],
          modifications: [{
            elementId: yielding.id,
            property: 'origin.z',
            oldValue: yielding.origin.z,
            newValue: yielding.origin.z - lowerAmount,
          }],
          estimatedCost: lowerAmount * 50,
          riskLevel: 'low',
          requiresReview: false,
          reasoning: `Moving ${yielding.type} below ${fixed.type} maintains ${clearance * 1000}mm clearance.`,
        });
      }

      // Option C: Add penetration sleeve (if small MEP through structural)
      const mepSize = yielding.quantities.width || (yielding.quantities as any).diameter || 0.1;
      if (mepSize <= 0.15 && fixed.type === 'Beam') {
        proposals.push({
          id: makeId(),
          clashId: clash.id,
          strategy: 'add_sleeve',
          description: `Add ${(mepSize * 1000 + 50).toFixed(0)}mm penetration sleeve through ${fixed.type} "${fixed.name}" for ${yielding.type} "${yielding.name}"`,
          confidence: 0.70,
          priority: 5,
          affectedElementIds: [yielding.id, fixed.id],
          modifications: [],
          newElements: [{
            type: 'Sleeve',
            name: `Sleeve for ${yielding.name}`,
            position: clash.point,
            dimensions: { diameter: mepSize + 0.05, length: fixed.quantities.width || 0.3 },
            material: 'Steel',
            storey: yielding.storey,
            purpose: 'Penetration sleeve for MEP through beam',
          }],
          estimatedCost: 150,
          riskLevel: 'medium',
          requiresReview: true,
          reasoning: `Small MEP element (${(mepSize * 1000).toFixed(0)}mm) can pass through beam with properly sized sleeve. Requires structural engineer review.`,
        });
      }

      return proposals;
    },
  },

  // ── Rule 2: MEP vs MEP → Route one around the other ──────────────
  {
    name: 'MEP_vs_MEP_priority_reroute',
    applies: (clash, elA, elB) => {
      return elA.category === 'MEP' && elB.category === 'MEP';
    },
    propose: (clash, elA, elB) => {
      // Larger MEP stays, smaller reroutes
      const sizeA = (elA.quantities.width || 0.1) * (elA.quantities.height || 0.1);
      const sizeB = (elB.quantities.width || 0.1) * (elB.quantities.height || 0.1);
      const yielding = sizeA <= sizeB ? elA : elB;
      const fixed = yielding === elA ? elB : elA;

      const offset = (fixed.quantities.width || 0.1) / 2 + (yielding.quantities.width || 0.1) / 2 + 0.05;

      return [{
        id: makeId(),
        clashId: clash.id,
        strategy: 'add_offset',
        description: `Offset ${yielding.type} "${yielding.name}" by ${(offset * 1000).toFixed(0)}mm to clear ${fixed.type} "${fixed.name}"`,
        confidence: 0.80,
        priority: 5,
        affectedElementIds: [yielding.id],
        modifications: [{
          elementId: yielding.id,
          property: 'origin.y',
          oldValue: yielding.origin.y,
          newValue: yielding.origin.y + offset,
        }],
        estimatedCost: offset * 100,
        riskLevel: 'low',
        requiresReview: false,
        reasoning: `Smaller ${yielding.type} (${(Math.sqrt(sizeA) * 1000).toFixed(0)}mm) rerouted around larger ${fixed.type} (${(Math.sqrt(sizeB) * 1000).toFixed(0)}mm).`,
      }];
    },
  },

  // ── Rule 3: Wall vs Wall → Trim/join ──────────────────────────────
  {
    name: 'wall_wall_join',
    applies: (clash, elA, elB) => {
      return elA.type === 'Wall' && elB.type === 'Wall';
    },
    propose: (clash, elA, elB) => {
      // Walls overlapping usually means they need a proper join
      return [{
        id: makeId(),
        clashId: clash.id,
        strategy: 'accept',
        description: `Wall "${elA.name}" and Wall "${elB.name}" overlap at join — expected behavior for wall-to-wall connection`,
        confidence: 0.90,
        priority: 1,
        affectedElementIds: [elA.id, elB.id],
        modifications: [],
        estimatedCost: 0,
        riskLevel: 'low',
        requiresReview: false,
        reasoning: 'Wall-to-wall intersections at corners/joins are expected. The parametric constraint system handles proper wall joins.',
      }];
    },
  },

  // ── Rule 4: Slab vs Wall → Normal connection ─────────────────────
  {
    name: 'slab_wall_connection',
    applies: (clash, elA, elB) => {
      return (elA.type.includes('Slab') && elB.type === 'Wall') ||
             (elB.type.includes('Slab') && elA.type === 'Wall');
    },
    propose: (clash, elA, elB) => {
      return [{
        id: makeId(),
        clashId: clash.id,
        strategy: 'accept',
        description: `${elA.type} and ${elB.type} intersection is a normal construction joint`,
        confidence: 0.95,
        priority: 1,
        affectedElementIds: [elA.id, elB.id],
        modifications: [],
        estimatedCost: 0,
        riskLevel: 'low',
        requiresReview: false,
        reasoning: 'Slab-wall intersections are standard construction joints. No resolution needed.',
      }];
    },
  },

  // ── Rule 5: Architectural vs Structural → Architectural yields ────
  {
    name: 'arch_vs_structural',
    applies: (clash, elA, elB) => {
      return (elA.category === 'Architectural' && elB.category === 'Structural') ||
             (elB.category === 'Architectural' && elA.category === 'Structural');
    },
    propose: (clash, elA, elB) => {
      const { yielding, fixed } = yieldingElement(elA, elB);
      const proposals: ResolutionProposal[] = [];

      // Move architectural element away from structural
      const dirAway = v3normalize(v3sub(yielding.origin, fixed.origin));
      const moveDistance = Math.sqrt(clash.overlapVolume) + 0.05;

      proposals.push({
        id: makeId(),
        clashId: clash.id,
        strategy: 'move',
        description: `Move ${yielding.type} "${yielding.name}" ${(moveDistance * 1000).toFixed(0)}mm away from ${fixed.type} "${fixed.name}"`,
        confidence: 0.70,
        priority: 6,
        affectedElementIds: [yielding.id],
        modifications: [
          {
            elementId: yielding.id,
            property: 'origin.x',
            oldValue: yielding.origin.x,
            newValue: yielding.origin.x + dirAway.x * moveDistance,
          },
          {
            elementId: yielding.id,
            property: 'origin.y',
            oldValue: yielding.origin.y,
            newValue: yielding.origin.y + dirAway.y * moveDistance,
          },
        ],
        estimatedCost: moveDistance * 200,
        riskLevel: 'medium',
        requiresReview: true,
        reasoning: `Structural elements are fixed. Architectural element repositioned to eliminate clash.`,
      });

      return proposals;
    },
  },

  // ── Rule 6: Clearance violations → Add offset ────────────────────
  {
    name: 'clearance_offset',
    applies: (clash) => {
      return clash.type === 'clearance';
    },
    propose: (clash, elA, elB) => {
      const { yielding, fixed } = yieldingElement(elA, elB);
      const needed = 0.05 - clash.distance; // minimum clearance - current distance

      if (needed <= 0) return [];

      const dir = v3normalize(v3sub(yielding.origin, fixed.origin));

      return [{
        id: makeId(),
        clashId: clash.id,
        strategy: 'add_offset',
        description: `Increase clearance between ${elA.name} and ${elB.name} by ${(needed * 1000).toFixed(0)}mm`,
        confidence: 0.85,
        priority: 4,
        affectedElementIds: [yielding.id],
        modifications: [
          {
            elementId: yielding.id,
            property: 'origin.x',
            oldValue: yielding.origin.x,
            newValue: yielding.origin.x + dir.x * needed,
          },
          {
            elementId: yielding.id,
            property: 'origin.y',
            oldValue: yielding.origin.y,
            newValue: yielding.origin.y + dir.y * needed,
          },
        ],
        estimatedCost: 0,
        riskLevel: 'low',
        requiresReview: false,
        reasoning: `Minimum 50mm clearance required per NBC. Current clearance: ${(clash.distance * 1000).toFixed(0)}mm.`,
      }];
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN RESOLUTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

export interface ResolutionBatch {
  clashCount: number;
  proposalCount: number;
  autoResolvable: number;
  requiresReview: number;
  unresolvable: number;
  proposals: ResolutionProposal[];
  estimatedTotalCost: number;
}

/**
 * Generate resolution proposals for all detected clashes.
 */
export function generateResolutions(
  clashes: ClashResult[],
  elements: Map<string, BIMSolid>,
): ResolutionBatch {
  const proposals: ResolutionProposal[] = [];

  for (const clash of clashes) {
    const elA = elements.get(clash.elementA.id);
    const elB = elements.get(clash.elementB.id);
    if (!elA || !elB) continue;

    let matched = false;
    for (const rule of RESOLUTION_RULES) {
      if (rule.applies(clash, elA, elB)) {
        const ruleProposals = rule.propose(clash, elA, elB, elements);
        proposals.push(...ruleProposals);
        matched = true;
        break;
      }
    }

    // Fallback: flag as RFI
    if (!matched) {
      proposals.push({
        id: makeId(),
        clashId: clash.id,
        strategy: 'flag_rfi',
        description: `Cannot auto-resolve: ${clash.description}`,
        confidence: 0,
        priority: 1,
        affectedElementIds: [clash.elementA.id, clash.elementB.id],
        modifications: [],
        estimatedCost: 0,
        riskLevel: 'high',
        requiresReview: true,
        reasoning: 'No automatic resolution rule matched. Manual review required.',
      });
    }
  }

  // Sort by priority (highest first)
  proposals.sort((a, b) => b.priority - a.priority);

  const autoResolvable = proposals.filter(p => !p.requiresReview && p.strategy !== 'flag_rfi').length;
  const requiresReview = proposals.filter(p => p.requiresReview).length;
  const unresolvable = proposals.filter(p => p.strategy === 'flag_rfi').length;

  return {
    clashCount: clashes.length,
    proposalCount: proposals.length,
    autoResolvable,
    requiresReview,
    unresolvable,
    proposals,
    estimatedTotalCost: proposals.reduce((sum, p) => sum + p.estimatedCost, 0),
  };
}

/**
 * Apply approved resolution proposals to the model.
 * Returns list of modifications actually applied.
 */
export function applyResolutions(
  proposals: ResolutionProposal[],
  elements: Map<string, BIMSolid>,
): {
  applied: string[];
  skipped: string[];
  modifications: ElementModification[];
  newElements: NewElementSpec[];
} {
  const applied: string[] = [];
  const skipped: string[] = [];
  const allModifications: ElementModification[] = [];
  const allNewElements: NewElementSpec[] = [];

  // Check for conflicting proposals (same element modified by multiple proposals)
  const modifiedElements = new Set<string>();

  for (const proposal of proposals) {
    if (proposal.strategy === 'accept' || proposal.strategy === 'flag_rfi') {
      applied.push(proposal.id);
      continue;
    }

    // Check for conflicts
    const hasConflict = proposal.affectedElementIds.some(id => modifiedElements.has(id));
    if (hasConflict) {
      skipped.push(proposal.id);
      continue;
    }

    // Apply modifications
    let success = true;
    for (const mod of proposal.modifications) {
      const el = elements.get(mod.elementId);
      if (!el) {
        success = false;
        break;
      }

      // Apply the modification
      const parts = mod.property.split('.');
      let target: any = el;
      for (let i = 0; i < parts.length - 1; i++) {
        target = target[parts[i]];
        if (target == null) { success = false; break; }
      }
      if (!success) break;
      target[parts[parts.length - 1]] = mod.newValue;
    }

    if (success) {
      applied.push(proposal.id);
      allModifications.push(...proposal.modifications);
      if (proposal.newElements) allNewElements.push(...proposal.newElements);
      for (const id of proposal.affectedElementIds) modifiedElements.add(id);
    } else {
      skipped.push(proposal.id);
    }
  }

  return { applied, skipped, modifications: allModifications, newElements: allNewElements };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AI-POWERED RESOLUTION — Complex multi-element strategies via Claude
// ═══════════════════════════════════════════════════════════════════════════════

export interface AIResolutionRequest {
  clashes: ClashResult[];
  elementSummaries: Array<{
    id: string;
    type: string;
    name: string;
    category: string;
    storey: string;
    material: string;
    dimensions: { width?: number; height?: number; length?: number };
    position: Vec3;
  }>;
  projectContext: {
    buildingType: string;
    buildingCode: string;
    region: string;
  };
}

export interface AIResolutionResponse {
  proposals: ResolutionProposal[];
  overallStrategy: string;
  riskAssessment: string;
  estimatedImpact: string;
}

/**
 * Build the AI prompt for complex clash resolution.
 * This is called by the API route handler which has access to Claude.
 */
export function buildResolutionPrompt(request: AIResolutionRequest): string {
  const clashSummary = request.clashes.map(c =>
    `- ${c.description} (severity: ${c.severity}, overlap: ${(c.overlapVolume * 1e6).toFixed(0)} cm³)`
  ).join('\n');

  const elementSummary = request.elementSummaries.map(e =>
    `- ${e.type} "${e.name}" (${e.category}, ${e.storey}, ${e.material}, ` +
    `${e.dimensions.width ? (e.dimensions.width * 1000).toFixed(0) + 'mm' : 'N/A'} wide)`
  ).join('\n');

  return `You are a BIM coordination specialist. Analyze these clashes and propose resolutions.

Building: ${request.projectContext.buildingType}
Code: ${request.projectContext.buildingCode}
Region: ${request.projectContext.region}

CLASHES:
${clashSummary}

ELEMENTS INVOLVED:
${elementSummary}

RULES:
1. Structural elements NEVER move. MEP routes around them.
2. Maintain minimum 50mm clearance per NBC.
3. Penetration sleeves require structural engineer approval.
4. Prefer vertical rerouting (raise/lower) over horizontal rerouting.
5. Minimize construction cost impact.

For each clash, provide:
- Strategy: reroute | move | resize | raise | lower | add_sleeve | accept | flag_rfi
- Specific modifications with property names and values
- Confidence (0-1)
- Risk level: low | medium | high
- Cost estimate in CAD$
- Reasoning

Respond in JSON format with a "proposals" array.`;
}

/**
 * Parse AI response into resolution proposals.
 */
export function parseAIResolutions(
  aiResponse: string,
  clashes: ClashResult[],
): ResolutionProposal[] {
  try {
    // Extract JSON from response
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    const proposals: ResolutionProposal[] = [];

    if (Array.isArray(parsed.proposals)) {
      for (const p of parsed.proposals) {
        proposals.push({
          id: makeId(),
          clashId: p.clashId || clashes[0]?.id || 'unknown',
          strategy: p.strategy || 'flag_rfi',
          description: p.description || 'AI-proposed resolution',
          confidence: typeof p.confidence === 'number' ? p.confidence : 0.5,
          priority: typeof p.priority === 'number' ? p.priority : 5,
          affectedElementIds: Array.isArray(p.affectedElementIds) ? p.affectedElementIds : [],
          modifications: Array.isArray(p.modifications) ? p.modifications : [],
          newElements: Array.isArray(p.newElements) ? p.newElements : undefined,
          estimatedCost: typeof p.estimatedCost === 'number' ? p.estimatedCost : 0,
          riskLevel: p.riskLevel || 'medium',
          requiresReview: true, // AI proposals always need review
          reasoning: p.reasoning || 'AI-generated proposal',
        });
      }
    }

    return proposals;
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RESOLUTION REPORT — Summary for stakeholders
// ═══════════════════════════════════════════════════════════════════════════════

export interface ResolutionReport {
  generatedAt: string;
  totalClashes: number;
  resolved: number;
  pendingReview: number;
  unresolvable: number;
  totalCostImpact: number;
  byStrategy: Record<string, number>;
  bySeverity: Record<string, { total: number; resolved: number }>;
  byDiscipline: Record<string, number>;
  details: Array<{
    clashDescription: string;
    resolution: string;
    strategy: ResolutionStrategy;
    confidence: number;
    costImpact: number;
    status: 'applied' | 'pending_review' | 'unresolvable';
  }>;
}

export function generateResolutionReport(
  batch: ResolutionBatch,
  applied: string[],
): ResolutionReport {
  const byStrategy: Record<string, number> = {};
  const bySeverity: Record<string, { total: number; resolved: number }> = {};
  const byDiscipline: Record<string, number> = {};

  for (const p of batch.proposals) {
    byStrategy[p.strategy] = (byStrategy[p.strategy] || 0) + 1;
  }

  const details = batch.proposals.map(p => ({
    clashDescription: p.description,
    resolution: p.description,
    strategy: p.strategy,
    confidence: p.confidence,
    costImpact: p.estimatedCost,
    status: (applied.includes(p.id)
      ? 'applied'
      : p.strategy === 'flag_rfi'
        ? 'unresolvable'
        : 'pending_review') as 'applied' | 'pending_review' | 'unresolvable',
  }));

  return {
    generatedAt: new Date().toISOString(),
    totalClashes: batch.clashCount,
    resolved: applied.length,
    pendingReview: batch.requiresReview,
    unresolvable: batch.unresolvable,
    totalCostImpact: batch.estimatedTotalCost,
    byStrategy,
    bySeverity,
    byDiscipline,
    details,
  };
}
