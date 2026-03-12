// server/services/similarity-scheduler.ts
import { evictByAge, evictToCap, evictProjectToCap } from "./similarity-evict";

export function startSimilarityEvictionScheduler() {
  const intervalMs   = Number(process.env.SIM_EVICT_INTERVAL_MS ?? 6 * 60 * 60 * 1000); // 6h
  const maxAgeDays   = Number(process.env.SIM_EVICT_MAX_AGE_DAYS ?? 90);
  const maxRows      = Number(process.env.SIM_EVICT_MAX_ROWS ?? 100000);
  const projCap      = Number(process.env.SIM_EVICT_PROJECT_MAX_PAIRS ?? 0); // 0 = disabled
  const projMode     = (process.env.SIM_EVICT_PROJECT_MODE ?? "score") as "score" | "recent";
  const projListCSV  = process.env.SIM_EVICT_PROJECT_IDS || ""; // comma-separated projectIds (optional)

  const projectIds = projListCSV
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const runOnce = async () => {
    try {
      const d1 = await evictByAge(maxAgeDays);
      const d2 = await evictToCap(maxRows);
      console.log(`[sim-evict] age>${maxAgeDays}d → ${d1} deleted; cap ${maxRows} → ${d2} deleted`);

      if (projCap > 0 && projectIds.length) {
        for (const pid of projectIds) {
          try {
            const r = await evictProjectToCap(pid, projCap, projMode);
            console.log(`[sim-evict] project=${pid} cap=${projCap} mode=${projMode} → deleted=${r.deleted}, kept=${r.kept}, total=${r.total}`);
          } catch (e: any) {
            console.warn(`[sim-evict] project=${pid} failed:`, e?.message || e);
          }
        }
      }
    } catch (e: any) {
      console.warn("[sim-evict] scheduler error:", e?.message || e);
    }
  };

  // initial delay so we don't hit DB at cold start
  setTimeout(runOnce, 5000);
  setInterval(runOnce, Math.max(60_000, intervalMs));
}