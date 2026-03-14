// server/services/bim-facade.ts  — v15.13
// Canonical BIM API facade.
// Delegates to BIMGenerator so the facade is never a dead-end.

import { publishProgress } from "../routes/progress";
import { postprocessAndSaveBIM_LEGACY as _postprocessAndSave } from "./bim-postprocess";
import { storage } from "../storage";

type BimElement = any;

export type GenerateOpts = {
  projectId: string;
  modelId: string;
  unitSystem: "metric" | "imperial";
  analysis?: any;
  buildingLayout?: any;
  gridSystem?: any;
  lod?: string;
};

export const BIM = {
  /** Full BIM generation via BIMGenerator (specs→products→assemblies→elements). */
  async assemble(opts: GenerateOpts): Promise<BimElement[]> {
    const { projectId, modelId, lod = "detailed" } = opts;

    publishProgress(modelId, { progress: 5, phase: "init", message: "Resolving documents…" });

    const docs = await storage.getDocumentsByProject(projectId);
    if (!docs.length) {
      throw new Error(`No documents found for project ${projectId}. Upload drawings first.`);
    }

    publishProgress(modelId, { progress: 15, phase: "generate", message: "Starting BIM generation…" });

    const { BIMGenerator } = await import("../bim-generator");
    const generator = new BIMGenerator();

    const bimModel = await generator.generateBIMModel(projectId, docs, {
      lod,
      levelOfDetail: lod,
      units: opts.unitSystem,
      coordinateSystem: "global",
    } as any);

    publishProgress(modelId, { progress: 90, phase: "complete", message: "Fetching saved elements…" });

    const elements = await storage.getBimElements(bimModel.id);

    publishProgress(modelId, { progress: 100, phase: "complete", message: `${elements.length} elements saved` });

    return elements;
  },

  /** CIQS/AACE quantity takeoff from saved BIM elements. */
  async estimate(modelId: string) {
    publishProgress(modelId, { progress: 82, phase: "estimate", message: "CIQS/AACE quantity takeoff" });
    const elements: BimElement[] = await storage.getBimElements(modelId);
    // Full estimate pipeline lives in /api/estimates/ciqs/:modelId
    publishProgress(modelId, { progress: 90, phase: "estimate", message: "Use POST /api/estimates/ciqs/:modelId for full estimate" });
    return { elementCount: elements.length };
  },
};
