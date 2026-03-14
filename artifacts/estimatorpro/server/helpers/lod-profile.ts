// server/helpers/lod-profile.ts

export type LODProfile = {
  name: string;
  maxElements: number;              // hard target for expanded element count
  includeMechanical: boolean;
  includeElectrical: boolean;
  includePlumbing: boolean;
  elementSplitting: boolean;        // split long walls/beams, panelize slabs
  segmentWalls: boolean;
  families: string[];               // BACKWARD COMPATIBILITY: array of family names
  familyWeights: {                  // NEW: weights for expansion prioritization
    structBias: number;
    archBias: number;
    mepBias: number;
  };
};

const profiles: Record<string, LODProfile> = {
  standard: {
    name: "standard",
    maxElements: 6000,
    includeMechanical: true,
    includeElectrical: true,
    includePlumbing: true,
    elementSplitting: true,
    segmentWalls: true,
    families: ["WALL", "SLAB", "FLOOR", "BEAM", "COLUMN", "FOUNDATION", "STAIR", "DOOR", "WINDOW"],
    familyWeights: { structBias: 1.0, archBias: 1.0, mepBias: 1.0 }
  },
  detailed: {
    name: "detailed",
    maxElements: 50000,             // ← realistic target for commercial projects
    includeMechanical: true,
    includeElectrical: true,
    includePlumbing: true,
    elementSplitting: true,
    segmentWalls: true,
    families: [
      "WALL", "PARTITION", "SLAB", "FLOOR", "BEAM", "COLUMN", "FOUNDATION",
      "STAIR", "RAMP", "DOOR", "WINDOW", "OPENING", "CURTAIN_WALL",
      "ROOF", "CEILING", "LIGHT_FIXTURE", "SPRINKLER", "RECEPTACLE"
    ],
    familyWeights: { structBias: 1.2, archBias: 1.2, mepBias: 1.0 }
  },
  max: {
    name: "max",
    maxElements: 150000,
    includeMechanical: true,
    includeElectrical: true,
    includePlumbing: true,
    elementSplitting: true,
    segmentWalls: true,
    families: ["*"], // All families
    familyWeights: { structBias: 1.3, archBias: 1.3, mepBias: 1.1 }
  }
};

export function getLodProfile(name?: string): LODProfile {
  const key = String(name || "max").toLowerCase();
  return profiles[key] || profiles["max"];
}

// Legacy compatibility
export type LOD = "coarse" | "standard" | "detailed" | "max";
export type LodProfile = LODProfile;