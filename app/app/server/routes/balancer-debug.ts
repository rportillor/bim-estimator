// server/routes/balancer-debug.ts
import { Router } from "express";
import { storage } from "../storage";
import { balancedAssemble } from "../services/balanced-assembler";
import { countByFamily } from "../helpers/family";

export const balancerDebugRouter = Router();

// Show the env values the balancer will read
balancerDebugRouter.get("/balancer/env", (_req, res) => {
  res.json({
    DEFAULT_LOD: process.env.DEFAULT_LOD || "(default:detailed@code)",
    MIN_BASE_STRUCT_ARCH_COUNT: process.env.MIN_BASE_STRUCT_ARCH_COUNT || "(default:50@code)",
    MIN_BASE_STRUCT_ARCH_FRACTION: process.env.MIN_BASE_STRUCT_ARCH_FRACTION || "(default:0.20@code)",
    LOD_MIN_STRUCT_FRAC: process.env.LOD_MIN_STRUCT_FRAC || "(default:0.25@code)",
    LOD_TARG_ARCH_FRAC: process.env.LOD_TARG_ARCH_FRAC || "(default:0.30@code)",
    LOD_MAX_GRID_FRAC: process.env.LOD_MAX_GRID_FRAC || "(default:0.45@code)"
  });
});

// Dry-run the balancer on an existing model (no writes unless ?save=1)
balancerDebugRouter.post("/bim/models/:modelId/debug/balancer-dryrun", async (req, res) => {
  try {
    const { modelId } = req.params;
    const save = String(req.query.save || "0") === "1";

    const base = await storage.getBimElements(modelId); // your storage method
    const before = { total: base.length, ...countByFamily(base) };

    // Try to load analysis/storeys if you keep them in metadata; otherwise pass empty
    const analysis = {}; // optional: plug in ensureFootprintForModel(...) if you have it
    const storeys: any[] = [];

    const assembled = await balancedAssemble({
      baseElements: base,
      analysis,
      storeys,
      options: {}
    });

    const after = { total: assembled.elements.length, ...countByFamily(assembled.elements) };

    if (save) {
      if ((storage as any).saveBimElementsBulk) {
        await (storage as any).saveBimElementsBulk(modelId, assembled.elements);
      } else if ((storage as any).saveBimElements) {
        await (storage as any).saveBimElements(modelId, assembled.elements);
      } else {
        // fallback: clear+insert one by one if you have those helpers
      }
    }

    res.json({ saveApplied: save, before, after, sampleOut: assembled.elements.slice(0, 5) });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "balancer dryrun error" });
  }
});