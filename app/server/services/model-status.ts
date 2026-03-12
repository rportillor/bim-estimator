// server/services/model-status.ts
// Safe, storage-agnostic model status updates with graceful fallbacks.

import { publish } from "./progress-bus";

type StatusVal = "queued" | "generating" | "postprocessing" | "completed" | "failed";
type StatusPatch = {
  status?: StatusVal;
  progress?: number;         // 0..1
  message?: string | null;   // last status message for UI
  error?: string | null;     // last error details if failed
  meta?: Record<string, any>;
};

export async function updateModelStatus(storage: any, modelId: string, patch: StatusPatch) {
  if (typeof storage?.updateBimModelStatus === "function") {
    const result = await storage.updateBimModelStatus(modelId, patch);
    publish(modelId, {
      ts: Date.now(),
      ...patch,
    });
    return result;
  }
  if (typeof storage?.updateBimModelFields === "function") {
    const result = await storage.updateBimModelFields(modelId, patch);
    publish(modelId, {
      ts: Date.now(),
      ...patch,
    });
    return result;
  }

  if (typeof storage?.getBimModel === "function" && typeof storage?.updateBimModelMetadata === "function") {
    const model = await storage.getBimModel(modelId);
    const merged = {
      ...(model?.metadata || {}),
      status: patch.status ?? (model?.metadata?.status || "queued"),
      progress: typeof patch.progress === "number" ? patch.progress : (model?.metadata?.progress ?? 0),
      lastMessage: patch.message ?? (model?.metadata?.lastMessage ?? null),
      lastError: patch.error ?? (model?.metadata?.lastError ?? null),
      ...(patch.meta || {}),
      _updatedAt: new Date().toISOString(),
    };
    const result = await storage.updateBimModelMetadata(modelId, merged);
    publish(modelId, {
      ts: Date.now(),
      ...patch,
    });
    return result;
  }
  console.warn("[status] No writable storage method found; status not persisted.");
  publish(modelId, {
    ts: Date.now(),
    ...patch,
  });
  return null;
}

export function coerceStatus(v: any): StatusVal {
  const s = String(v || "").toLowerCase();
  return (["queued","generating","postprocessing","completed","failed"] as const).includes(s as any) ? (s as StatusVal) : "generating";
}