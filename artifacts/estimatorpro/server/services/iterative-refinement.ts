// server/services/iterative-refinement.ts
// ──────────────────────────────────────────────────────────────────────────────
// Multi-pass iterative refinement engine.
//
// Replicates the human Revit workflow: place → audit → fix → re-audit → repeat.
// Runs N passes (configurable, default 5), each consisting of:
//   1. Run model audit (8 geometric/topological checks)
//   2. Apply auto-fixes for fixable findings
//   3. Re-run audit to verify fixes didn't introduce new issues
//   4. Stop early if score reaches threshold or no improvement between passes
//
// This is the "look at what I placed, then go back and check" loop that was
// missing from the pipeline.
// ──────────────────────────────────────────────────────────────────────────────

import { runModelAudit, type AuditFinding, type AuditResult } from './model-audit-engine';

export interface RefinementConfig {
  /** Maximum number of audit+fix passes (default 5) */
  maxPasses: number;
  /** Score threshold — stop if reached (default 85) */
  targetScore: number;
  /** Minimum improvement between passes — stop if below (default 2 points) */
  minImprovement: number;
  /** Only auto-fix findings at or above this severity (default 'warning') */
  minAutoFixSeverity: 'critical' | 'warning' | 'info';
  /** Maximum fixes per pass to prevent runaway (default 50) */
  maxFixesPerPass: number;
}

const DEFAULT_CONFIG: RefinementConfig = {
  maxPasses: 5,
  targetScore: 85,
  minImprovement: 2,
  minAutoFixSeverity: 'warning',
  maxFixesPerPass: 50,
};

export interface RefinementResult {
  modelId: string;
  passes: AuditResult[];
  totalFixesApplied: number;
  finalScore: number;
  converged: boolean;
  convergenceReason: string;
  elementsModified: number;
  duration_ms: number;
}

// ── Auto-fix implementations ────────────────────────────────────────────────

function loc(e: any): { x: number; y: number; z: number } {
  const g = typeof e.geometry === 'string' ? JSON.parse(e.geometry) : (e.geometry || {});
  const p = g.location?.realLocation || { x: 0, y: 0, z: 0 };
  return { x: Number(p.x) || 0, y: Number(p.y) || 0, z: Number(p.z) || 0 };
}

function setLoc(e: any, x: number, y: number, z: number): void {
  const g = typeof e.geometry === 'string' ? JSON.parse(e.geometry) : (e.geometry || {});
  g.location = g.location || {};
  g.location.realLocation = { x, y, z };
  e.geometry = g;
}

function setDim(e: any, scale: number): void {
  const g = typeof e.geometry === 'string' ? JSON.parse(e.geometry) : (e.geometry || {});
  const d = g.dimensions || {};
  if (d.width) d.width *= scale;
  if (d.height) d.height *= scale;
  if (d.depth) d.depth *= scale;
  if (d.length) d.length *= scale;
  g.dimensions = d;
  e.geometry = g;
}

function eid(e: any): string {
  return e.id || e.elementId || '';
}

function etype(e: any): string {
  return (e.elementType || e.type || e.category || '').toUpperCase();
}

/**
 * Apply auto-fixes for a set of findings.
 * Returns count of successful fixes.
 */
function applyAutoFixes(
  elements: any[],
  findings: AuditFinding[],
  config: RefinementConfig,
): number {
  const elById = new Map<string, any>();
  for (const e of elements) {
    const id = eid(e);
    if (id) elById.set(id, e);
  }

  let fixCount = 0;
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  const minSev = severityOrder[config.minAutoFixSeverity];

  // Sort by severity (critical first)
  const fixable = findings
    .filter(f => f.autoFixable && severityOrder[f.severity] <= minSev)
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
    .slice(0, config.maxFixesPerPass);

  for (const finding of fixable) {
    const fix = finding.suggestedFix;
    if (!fix) continue;

    try {
      switch (fix.action) {
        case 'move': {
          const target = fix.targetElementId ? elById.get(fix.targetElementId) : null;
          if (!target) break;

          if (fix.params?.newX != null || fix.params?.newY != null) {
            // Direct coordinate fix (e.g., column alignment)
            const p = loc(target);
            setLoc(target,
              fix.params.newX ?? p.x,
              fix.params.newY ?? p.y,
              fix.params.newZ ?? p.z
            );
            fixCount++;
          } else if (fix.params?.snapTo === 'nearest_wall_centreline') {
            // Snap opening to nearest wall
            const oLoc = loc(target);
            const walls = elements.filter(e => /(WALL|PARTITION)/.test(etype(e)));
            let bestDist = Infinity;
            let bestPoint: { x: number; y: number } | null = null;

            for (const wall of walls) {
              const s = wall.properties?.start;
              const en = wall.properties?.end;
              if (!s || !en) continue;

              // Project onto wall segment
              const dx = Number(en.x) - Number(s.x);
              const dy = Number(en.y) - Number(s.y);
              const len2 = dx * dx + dy * dy;
              if (len2 < 1e-6) continue;
              let t = ((oLoc.x - Number(s.x)) * dx + (oLoc.y - Number(s.y)) * dy) / len2;
              t = Math.max(0, Math.min(1, t));
              const proj = { x: Number(s.x) + t * dx, y: Number(s.y) + t * dy };
              const dist = Math.sqrt((oLoc.x - proj.x) ** 2 + (oLoc.y - proj.y) ** 2);

              if (dist < bestDist) {
                bestDist = dist;
                bestPoint = proj;
              }
            }

            if (bestPoint && bestDist > 0.01) {
              setLoc(target, bestPoint.x, bestPoint.y, oLoc.z);
              fixCount++;
            }
          } else if (fix.params?.snapEndpoints && fix.params?.snapTarget === 'nearest_column_or_wall') {
            // Snap beam endpoints to nearest support
            const bLoc = loc(target);
            const supports = elements.filter(e =>
              /(COLUMN|PILLAR|POST|WALL)/.test(etype(e))
            );
            let bestDist = Infinity;
            let bestSup: { x: number; y: number } | null = null;

            for (const sup of supports) {
              const sLoc = loc(sup);
              const d = Math.sqrt((bLoc.x - sLoc.x) ** 2 + (bLoc.y - sLoc.y) ** 2);
              if (d < bestDist && d > 0.01) {
                bestDist = d;
                bestSup = { x: sLoc.x, y: sLoc.y };
              }
            }

            // Only move if improvement is significant but not too far
            if (bestSup && bestDist < 5.0 && bestDist > 0.3) {
              // Move midpoint toward nearest support
              const midX = (bLoc.x + bestSup.x) / 2;
              const midY = (bLoc.y + bestSup.y) / 2;
              setLoc(target, midX, midY, bLoc.z);
              fixCount++;
            }
          } else if (fix.params?.clearStructure) {
            // Move MEP to clear structural element
            const mepLoc = loc(target);
            const structEl = elById.get(fix.params.clearStructure);
            if (structEl) {
              const sLoc = loc(structEl);
              const sDims = structEl.geometry?.dimensions || {};
              const sHeight = Number(sDims.height || 3);
              // Move MEP above or below structure
              if (fix.params.preferDirection === 'z_up') {
                setLoc(target, mepLoc.x, mepLoc.y, sLoc.z + sHeight + 0.1);
              } else {
                setLoc(target, mepLoc.x, mepLoc.y, sLoc.z - 0.3);
              }
              fixCount++;
            }
          }
          break;
        }

        case 'extend': {
          // Extend wall endpoint to snap to nearest unpaired endpoint
          const target = fix.targetElementId ? elById.get(fix.targetElementId) : null;
          if (!target || !target.properties) break;

          const endpoint = fix.params?.endpoint as 'start' | 'end';
          const tolerance = Number(fix.params?.tolerance || 1.5);

          const currentPoint = target.properties[endpoint];
          if (!currentPoint) break;

          // Find nearest other wall endpoint
          let bestDist = Infinity;
          let bestPoint: { x: number; y: number } | null = null;

          for (const other of elements) {
            if (eid(other) === eid(target)) continue;
            if (!/(WALL|PARTITION)/.test(etype(other))) continue;
            const otherEp = other.properties?.start;
            const otherEnd = other.properties?.end;
            if (!otherEp || !otherEnd) continue;

            for (const pt of [otherEp, otherEnd]) {
              const dist = Math.sqrt(
                (Number(currentPoint.x) - Number(pt.x)) ** 2 +
                (Number(currentPoint.y) - Number(pt.y)) ** 2
              );
              if (dist < bestDist && dist > 0.01 && dist < tolerance) {
                bestDist = dist;
                bestPoint = { x: Number(pt.x), y: Number(pt.y) };
              }
            }
          }

          if (bestPoint) {
            target.properties[endpoint] = { ...currentPoint, x: bestPoint.x, y: bestPoint.y };
            fixCount++;
          }
          break;
        }

        case 'resize': {
          const target = fix.targetElementId ? elById.get(fix.targetElementId) : null;
          if (!target) break;

          if (fix.params?.scaleBy) {
            setDim(target, fix.params.scaleBy);
            fixCount++;
          }
          break;
        }

        case 'reassign_storey': {
          // Find the correct storey based on element Z
          const target = fix.targetElementId ? elById.get(fix.targetElementId) : null;
          if (!target) break;

          const currentZ = loc(target).z;
          const expectedZ = fix.params?.expectedZ;

          // If element is way off, move it to the expected elevation
          if (expectedZ != null && Math.abs(currentZ - expectedZ) > 2.0) {
            const p = loc(target);
            setLoc(target, p.x, p.y, expectedZ);
            fixCount++;
          }
          break;
        }

        case 'add': {
          // Add missing slab elements
          if (fix.params?.elementType === 'SLAB' && fix.params?.storey) {
            const targetStorey = fix.params.storey;
            // Find elements on this storey to determine slab bounds
            const storeyElements = elements.filter(e =>
              (e.storey?.name || e.properties?.level || e.storeyName) === targetStorey
            );
            if (storeyElements.length === 0) break;

            // Compute bounding box of storey elements
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            let avgZ = 0;
            for (const e of storeyElements) {
              const p = loc(e);
              minX = Math.min(minX, p.x);
              minY = Math.min(minY, p.y);
              maxX = Math.max(maxX, p.x);
              maxY = Math.max(maxY, p.y);
              avgZ += p.z;
            }
            avgZ /= storeyElements.length;

            const width = Math.max(1, maxX - minX + 1);
            const depth = Math.max(1, maxY - minY + 1);
            const midX = (minX + maxX) / 2;
            const midY = (minY + maxY) / 2;

            const slabId = `slab_auto_${targetStorey}_${Date.now()}`;
            elements.push({
              id: slabId,
              elementId: slabId,
              elementType: 'SLAB',
              type: 'SLAB',
              category: 'Structural',
              name: `Floor Slab - ${targetStorey}`,
              geometry: {
                location: { realLocation: { x: midX, y: midY, z: avgZ } },
                dimensions: { width, height: 0.2, depth },
              },
              properties: { isAutoGenerated: true, refinementPass: true },
              storey: { name: targetStorey },
              storeyName: targetStorey,
            });
            fixCount++;
          }
          break;
        }
      }
    } catch (fixErr) {
      // Individual fix failure is non-fatal
      console.warn(`⚠️ Auto-fix failed for ${finding.id}: ${(fixErr as any)?.message}`);
    }
  }

  return fixCount;
}

// ── Main refinement loop ────────────────────────────────────────────────────

/**
 * Run the iterative refinement loop on a set of BIM elements.
 * Modifies elements in-place and returns a summary of all passes.
 */
export function runIterativeRefinement(
  elements: any[],
  modelId: string,
  config?: Partial<RefinementConfig>,
): RefinementResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();
  const passes: AuditResult[] = [];
  let totalFixes = 0;
  let lastScore = -1;
  let converged = false;
  let convergenceReason = '';
  const modifiedElementIds = new Set<string>();

  console.log(`🔄 ITERATIVE REFINEMENT: starting (maxPasses=${cfg.maxPasses}, targetScore=${cfg.targetScore})`);

  for (let pass = 1; pass <= cfg.maxPasses; pass++) {
    // 1. Run audit
    const audit = runModelAudit(elements, modelId, pass);
    passes.push(audit);

    // 2. Check convergence conditions
    if (audit.summary.score >= cfg.targetScore) {
      converged = true;
      convergenceReason = `Target score ${cfg.targetScore} reached (score=${audit.summary.score})`;
      console.log(`✅ REFINEMENT: converged at pass ${pass} — ${convergenceReason}`);
      break;
    }

    if (pass > 1 && lastScore >= 0) {
      const improvement = audit.summary.score - lastScore;
      if (improvement < cfg.minImprovement) {
        converged = true;
        convergenceReason = `Improvement plateau (Δ=${improvement.toFixed(1)} < ${cfg.minImprovement})`;
        console.log(`✅ REFINEMENT: converged at pass ${pass} — ${convergenceReason}`);
        break;
      }
    }

    if (audit.summary.autoFixable === 0) {
      converged = true;
      convergenceReason = 'No auto-fixable findings remaining';
      console.log(`✅ REFINEMENT: converged at pass ${pass} — ${convergenceReason}`);
      break;
    }

    lastScore = audit.summary.score;

    // 3. Apply auto-fixes
    const fixable = audit.findings.filter(f => f.autoFixable);
    const fixCount = applyAutoFixes(elements, fixable, cfg);
    totalFixes += fixCount;

    // Track modified elements
    for (const f of fixable) {
      for (const id of f.elementIds) modifiedElementIds.add(id);
      if (f.suggestedFix?.targetElementId) modifiedElementIds.add(f.suggestedFix.targetElementId);
    }

    console.log(`🔄 REFINEMENT pass ${pass}: score=${audit.summary.score}, fixes=${fixCount}, total=${totalFixes}`);

    // 4. If last pass, run one final audit for the record
    if (pass === cfg.maxPasses) {
      const finalAudit = runModelAudit(elements, modelId, pass + 1);
      passes.push(finalAudit);
      convergenceReason = `Max passes (${cfg.maxPasses}) reached — final score ${finalAudit.summary.score}`;
    }
  }

  const duration = Date.now() - startTime;
  const finalScore = passes[passes.length - 1]?.summary.score ?? 0;

  console.log(
    `🔄 ITERATIVE REFINEMENT: complete in ${duration}ms — ` +
    `${passes.length} passes, ${totalFixes} fixes, ` +
    `score ${passes[0]?.summary.score ?? 0} → ${finalScore} ` +
    `(${modifiedElementIds.size} elements modified)`
  );

  return {
    modelId,
    passes,
    totalFixesApplied: totalFixes,
    finalScore,
    converged,
    convergenceReason,
    elementsModified: modifiedElementIds.size,
    duration_ms: duration,
  };
}
