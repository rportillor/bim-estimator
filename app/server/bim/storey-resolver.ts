export type Storey = { name: string; elevation_m: number };
export type Grid = { name: string; x: number; y: number; orientation: "X" | "Y"; spacing_m?: number };

export function resolveStoreys(raw: any): Storey[] {
  const fromAI: Storey[] = Array.isArray(raw?.storeys) ? raw.storeys : [];
  const uniq = new Map<string, Storey>();
  for (const s of fromAI) {
    if (!s?.name) continue;
    uniq.set(s.name, { name: s.name, elevation_m: Number(s.elevation_m) || 0 });
  }
  // Ensure a base level exists
  if (!Array.from(uniq.values()).some(s => Math.abs(s.elevation_m) < 1e-6)) {
    uniq.set("Level 1", { name: "Level 1", elevation_m: 0 });
  }
  return Array.from(uniq.values()).sort((a,b) => a.elevation_m - b.elevation_m);
}

export function resolveGrids(raw: any): Grid[] {
  const fromAI: Grid[] = Array.isArray(raw?.grids) ? raw.grids : [];
  // Optional: enforce consistent orientation/X,Y naming
  return fromAI.map(g => ({
    name: g.name || "",
    x: Number(g.x) || 0,
    y: Number(g.y) || 0,
    orientation: g.orientation === "Y" ? "Y" : "X",
    spacing_m: g.spacing_m ? Number(g.spacing_m) : undefined
  }));
}