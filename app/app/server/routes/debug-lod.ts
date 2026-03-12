import { Router } from "express";
import { storage } from "../storage";
export const debugLodRouter = Router();

function familyKey(e:any){
  return String(e?.elementType || e?.type || e?.category || "UNKNOWN").toUpperCase();
}

debugLodRouter.get("/bim/models/:modelId/debug/lod-stats", async (req,res)=>{
  try{
    const { modelId } = req.params;
    const all = await storage.getBimElements(modelId);
    const totals: Record<string,number> = {};
    let base=0, synth=0, seg=0, grid=0;
    for (const e of all){
      const k = familyKey(e);
      totals[k] = (totals[k]||0)+1;

      const syn = (e?.properties && typeof e.properties === "object") ? (e.properties as any).synthesis : undefined;
      if (syn) {
        synth++;
        if (syn === "segment") seg++;
        if (syn === "grid") grid++;
      } else {
        base++;
      }
    }
    res.json({
      count: all.length,
      base, synthesized: synth, segmentAdds: seg, gridAdds: grid,
      byFamily: totals
    });
  }catch(e:any){
    res.status(500).json({ message: e?.message || "debug-lod failed" });
  }
});