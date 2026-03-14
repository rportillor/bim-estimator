import { EventEmitter } from "events";
const buses = new Map<string, EventEmitter>();
export function getBus(modelId: string) {
  let bus = buses.get(modelId);
  if (!bus) { bus = new EventEmitter(); bus.setMaxListeners(0); buses.set(modelId, bus); }
  return bus;
}
export function publish(modelId: string, payload: any) {
  getBus(modelId).emit("tick", payload);
}