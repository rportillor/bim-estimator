// server/helpers/storeys.ts
// No hardcoded floor heights - only use actual measurements from Claude's analysis
export function inferStoreyElevation(name?: string, floorHeightMm?: number): number | null {
  const s = (name || "").toLowerCase();
  
  // If no floor height from Claude's analysis, return null (no fake elevations)
  if (!floorHeightMm) {
    // Only return 0 for ground floor since that's a real reference point
    if (/ground|grade|main|l1|level 1|p1/.test(s)) return 0;
    // For all other floors, return null to indicate unknown elevation
    return null;
  }
  
  // Underground/Foundation levels
  if (/underground|foundation|basement|parking/.test(s)) {
    return -floorHeightMm; // Below ground level in millimeters
  }
  
  // Ground floor is always at elevation 0
  if (/ground|grade|main|l1|level 1|p1/.test(s)) return 0;
  
  // Second floor and above - use actual floor height from Claude
  if (/second|level 2|l2/.test(s)) return floorHeightMm;
  if (/third|level 3|l3/.test(s)) return floorHeightMm * 2;
  if (/fourth|level 4|l4/.test(s)) return floorHeightMm * 3;
  if (/roof|penthouse/.test(s)) return floorHeightMm * 3; // Typical roof level
  
  // Generic level parsing (L1, Level 1, etc.)
  const m = s.match(/(?:l|level)\s*(\d+)/);
  if (m) {
    const n = parseInt(m[1],10);
    return floorHeightMm * (n - 1);     // Use actual floor height from Claude
  }
  
  return 0; // Default to ground level
}