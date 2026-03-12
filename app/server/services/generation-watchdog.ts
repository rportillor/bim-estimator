// server/services/generation-watchdog.ts
type OnFire = (reason: string) => void;

const timers = new Map<string, NodeJS.Timeout>();
const lastBeat = new Map<string, number>();

export function startWatchdog(modelId: string, idleMs: number, onFire: OnFire) {
  stopWatchdog(modelId);
  lastBeat.set(modelId, Date.now());

  const t = setInterval(() => {
    const last = lastBeat.get(modelId) || 0;
    if (Date.now() - last > idleMs) {
      stopWatchdog(modelId);
      try { onFire(`Watchdog: no heartbeat for ${Math.round((Date.now()-last)/1000)}s`); }
      catch { /* noop */ }
    }
  }, Math.max(2000, Math.floor(idleMs / 3)));

  timers.set(modelId, t);
}

export function heartbeat(modelId: string) {
  lastBeat.set(modelId, Date.now());
}

export function stopWatchdog(modelId: string) {
  const t = timers.get(modelId);
  if (t) clearInterval(t);
  timers.delete(modelId);
  lastBeat.delete(modelId);
}