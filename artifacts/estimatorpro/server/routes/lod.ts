// server/routes/lod.ts
import { Router } from "express";
import { storage } from "../storage";
import { getLodProfile } from "../helpers/lod-profile";
import { expandWithLod } from "../helpers/lod-expander";
import { inferStoreysIfMissing } from "../helpers/storey-inference";

export const lodRouter = Router();

lodRouter.post("/bim/models/:modelId/reexpand", async (req, res) => {
  try {
    const { modelId } = req.params;
    const profileName = req.body?.profile;
    if (!profileName) {
      return res.status(400).json({ ok:false, message: "LOD profile not specified - must be provided from Claude's analysis or explicit request" });
    }
    const profile = getLodProfile(profileName);

    const model = await storage.getBimModel(modelId);
    const base  = await storage.getBimElements(modelId);
    const storeys = inferStoreysIfMissing((model as any)?.metadata?.storeys, base, {});

    // Get spacing from Claude's analysis - no hardcoded defaults
    const metadata = (model as any)?.metadata || {};
    const analysis = metadata.buildingAnalysis || metadata.analysis || {};
    const mepSpacing = analysis.mepSpacing || {};
    
    // Only include spacing if actually found in Claude's analysis
    const spacingOptions: any = {};
    if (process.env.LOD_LIGHT_SPACING) spacingOptions.light = Number(process.env.LOD_LIGHT_SPACING);
    else if (mepSpacing.light) spacingOptions.light = Number(mepSpacing.light);
    
    if (process.env.LOD_SPRINKLER_SPACING) spacingOptions.sprinkler = Number(process.env.LOD_SPRINKLER_SPACING);
    else if (mepSpacing.sprinkler) spacingOptions.sprinkler = Number(mepSpacing.sprinkler);
    
    if (process.env.LOD_RECEPTACLE_SPACING) spacingOptions.receptacle = Number(process.env.LOD_RECEPTACLE_SPACING);
    else if (mepSpacing.receptacle) spacingOptions.receptacle = Number(mepSpacing.receptacle);
    
    // Only include density if actually configured
    const densityOptions: any = {};
    if (process.env.LOD_LIGHT_DENSITY) densityOptions.light = Number(process.env.LOD_LIGHT_DENSITY);
    if (process.env.LOD_SPRINKLER_DENSITY) densityOptions.sprinkler = Number(process.env.LOD_SPRINKLER_DENSITY);
    if (process.env.LOD_RECEPTACLE_DENSITY) densityOptions.receptacle = Number(process.env.LOD_RECEPTACLE_DENSITY);

    const { elements } = await expandWithLod({
      base,
      storeys,
      options: {
        families: { structBias: 0.3, archBias: 0.4, mepBias: 0.3 },
        includeMechanical: profile.includeMechanical,
        includeElectrical: profile.includeElectrical,
        includePlumbing: profile.includePlumbing,
        elementSplitting: profile.elementSplitting,
        segmentWallsAtOpenings: profile.segmentWalls,
        maxElements: profile.maxElements,
        lod: profile.name,
        density: Object.keys(densityOptions).length > 0 ? densityOptions : undefined,
        spacing: Object.keys(spacingOptions).length > 0 ? spacingOptions : undefined,
        minStructuralFraction: analysis.minStructuralFraction || undefined,
        targetArchitecturalFraction: analysis.targetArchitecturalFraction || undefined,
        maxGridFraction: analysis.maxGridFraction || undefined,
      },
      footprint: { polygon: (model as any)?.metadata?.perimeter || (model as any)?.metadata?.footprint || null }
    });

    if ((storage as any).upsertBimElements) await (storage as any).upsertBimElements(modelId, elements);
    else if ((storage as any).saveBimElements) await (storage as any).saveBimElements(modelId, elements);
    res.json({ ok: true, count: elements.length, profile: profile.name });
  } catch (e:any) {
    res.status(500).json({ ok:false, message: e?.message || "reexpand failed" });
  }
});