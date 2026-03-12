// server/services/balanced-assembler.ts
//
// WP-R2 FIX: Removed hardcoded floorHeight:3.2 and floorsGuess:8 defaults
// passed to inferStoreysIfMissing().  The call now passes no opts so that
// inferStoreysIfMissing() applies its own RFI-generation logic when storey
// data is absent.  If inferStoreysIfMissing() returns [] the balancer
// proceeds with zero storeys assigned — callers must check for this and
// surface the RFI to the user rather than silently continuing.

import { seedStructuralFromAnalysis } from "../helpers/structural-seed";
import { expandWithLod } from "../helpers/lod-expander";
import { getLodProfile } from "../helpers/lod-profile";
import { countByFamily } from "../helpers/family";
import { inferStoreysIfMissing } from "../helpers/storey-inference";

type AnyEl = any;
type Storey = { name?: string; elevation?: number };

const num = (v: any, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export async function balancedAssemble(args: {
  baseElements: AnyEl[];
  analysis?: any;
  storeys?: Storey[];
  options?: any;
}) {
  console.log("🧩 [BALANCER] enter");

  let elements: AnyEl[] = Array.isArray(args.baseElements) ? args.baseElements.slice() : [];
  const analysis = args.analysis || {};

  // WP-R2 FIX: No hardcoded opts passed. inferStoreysIfMissing() will:
  //   a) Use incomingStoreys if supplied,
  //   b) Infer from element z-values if ≥2 distinct elevations exist,
  //   c) Use FLOOR_HEIGHT_M env opt-in in development only,
  //   d) Register a critical RFI and return [] if none of the above apply.
  const storeys = inferStoreysIfMissing(
    Array.isArray(args.storeys)
      ? args.storeys.map(s => ({
          name: s.name || `Level ${s.elevation ?? 0}`,
          elevation: s.elevation ?? 0
        }))
      : [],
    elements
    // No opts — defaults are forbidden
  );

  if (storeys.length === 0) {
    console.error(
      "❌ [BALANCER] inferStoreysIfMissing returned empty storey list. " +
      "A critical RFI has been registered. BIM element elevation assignment " +
      "will be skipped. Callers should halt generation until storey data is available."
    );
  }

  console.log(`🧩 [BALANCER] baseElements=${elements.length}, storeys=${storeys.length}, lodOpt=${args?.options?.lod ?? "(none)"}`);

  // 1) Apply storey elevations
  if (storeys.length) {
    const levelToZ = new Map<string, number>();
    for (const s of storeys) levelToZ.set(String(s?.name || `Z${s?.elevation ?? 0}`), Number(s?.elevation ?? 0));
    for (const e of elements) {
      const g = typeof e?.geometry === "string" ? JSON.parse(e.geometry) : (e?.geometry || {});
      const p = g?.location?.realLocation || { x: 0, y: 0, z: 0 };
      const lvl = e?.storey?.name || e?.properties?.level || e?.storeyName || "Ground Floor";
      const elev = levelToZ.get(lvl) ?? 0;
      p.z = elev + (p.z || 0);
      g.location = { ...(g.location || {}), realLocation: p };
      e.geometry = g;
      e.storey = { ...(e.storey || {}), name: lvl, elevation: elev };
    }
  }

  // 2) Decide if we must seed (even when MEP > 0)
  const MIN_BASE_COUNT    = num(process.env.MIN_BASE_STRUCT_ARCH_COUNT, 50);
  const MIN_BASE_FRACTION = num(process.env.MIN_BASE_STRUCT_ARCH_FRACTION, 0.20);

  let counts = countByFamily(elements);
  const total = elements.length;
  const baseTooSmall = (counts.BASE < MIN_BASE_COUNT) || (total > 0 && (counts.BASE / total) < MIN_BASE_FRACTION);

  console.log(`[FAMILY-DEBUG] total=${total} STRUCT=${counts.STRUCT} ARCH=${counts.ARCH} MEP=${counts.MEP} OTHER=${counts.OTHER} BASE=${counts.BASE}`);
  console.log(`[FAMILY-DEBUG] thresholds: minCount=${MIN_BASE_COUNT}, minFrac=${MIN_BASE_FRACTION.toFixed(2)} → baseTooSmall=${baseTooSmall}`);

  if (baseTooSmall) {
    console.warn(`[seed] base too small: STRUCT=${counts.STRUCT} ARCH=${counts.ARCH} of total=${total}. Seeding structural envelope…`);
    const seeded = await seedStructuralFromAnalysis({
      analysis,
      storeys,
      defaults: { wallThk: 0.2, wallH: 3.0, colSize: 0.4, slabThk: 0.2 }
    });
    console.log(`[seed] result: ${seeded.length} elements`);
    if (seeded.length) {
      elements = seeded.concat(elements);
      counts = countByFamily(elements);
    }
  }

  // 3) Document-only mode — no artificial LOD expansion
  console.log("🚫 [DOCUMENT-ONLY] Skipping artificial LOD expansion - using only Claude-extracted elements from construction documents");

  const before = elements.length;
  const documentOnlyElements = elements.slice();

  for (const e of documentOnlyElements) {
    if (!e.storey && storeys.length > 0) {
      const g = typeof e?.geometry === "string" ? JSON.parse(e.geometry) : (e?.geometry || {});
      const z = g?.location?.realLocation?.z || 0;

      let closestStorey = storeys[0];
      let minDist = Math.abs(z - (closestStorey.elevation || 0));
      for (const s of storeys) {
        const dist = Math.abs(z - (s.elevation || 0));
        if (dist < minDist) {
          minDist = dist;
          closestStorey = s;
        }
      }
      e.storey = { name: closestStorey.name || "Ground", elevation: closestStorey.elevation || 0 };
    }
  }

  console.log(`[document-only] kept all ${before} Claude-extracted elements, added 0 artificial elements`);
  console.log("🧩 [BALANCER] exit");
  return { elements: documentOnlyElements };
}
