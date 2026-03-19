# Transfer Document: Claude Code → Replit
**Date:** March 19, 2026
**Branch:** main (was estimatorpro-v16 → now v17 tagged on GitHub main)
**Context:** Gridline system overhaul + element placement architecture + 3D viewer UI polish

---

## Revision History

| Rev | Date | Author | Changes |
|-----|------|--------|---------|
| 1.0 | 2026-03-18 | Claude Code | Initial assessment — gridlines, element coordinate problem, IR pipeline plan |
| 1.1 | 2026-03-18 | Replit Agent | Reviewed and corrected Section 4; confirmed pipeline files already in v16; verified anchor values |
| 1.2 | 2026-03-18 | Claude Code | Added grid intersection markers to viewer-3d.tsx (commit ace4f15, +70 lines) |
| 1.3 | 2026-03-18 | Replit Agent | Pulled commit ace4f15; Vite HMR confirmed; browser reload required |
| 2.0 | 2026-03-18 | Claude Code | Complete rewrite — all 7 fixes, generic parser, intersection system, element placement types, construction phases |
| 2.1 | 2026-03-18 | Replit Agent | Synced all Rev 2.0 code — 7 files applied, 3 new shared/ types, server clean restart; 264 intersection markers + 47 gridlines confirmed in console |
| 2.2 | 2026-03-18 | Replit Agent | Fix #1 complete: 47 grid_line DB records deleted; insertion guards added to real-qto-processor.ts + construction-workflow-processor.ts; bulk DELETE endpoint added to bim-element-crud.ts |
| 3.0 | 2026-03-19 | Replit Agent | **V17** — 3D viewer UI polish: dimension chains, label collision, intersection dot colours, camera controls, zoom-to-cursor; tagged v17 on GitHub |

---

## V17 Changes (March 19, 2026 — Replit Agent)

> **GitHub:** `https://github.com/rportillor/bim-estimator` — branch `main`, tag `v17` (commit `9025aa8`)
> All changes are in `artifacts/estimatorpro/client/src/components/bim/viewer-3d.tsx` and `moorings-grid-constants.ts` unless noted.

---

### V17-1: Camera Orientation & Cartesian Fixes

**Problem:** Camera was starting with an inverted or non-standard view — north was not at top, east was not at right.

**Fix:**
- `camera.up.set(0, 1, 0)` — Y-up enforced on every scene rebuild (Plan View sets it to `(0,0,-1)`; 3D view resets it)
- Camera positioned NE of building, looking SW: offset vector `(1, 0.8, 1.2)` normalised × `cameraDistance`
- North → Three.js `−Z`, East → Three.js `+X` (standard cartesian, matches architectural drawings)
- `controls.target` set to building floor level (`box.min.y`), not mid-building centre

---

### V17-2: Rectangular Grid Rendering (A–L × 1–9)

**Confirmed correct.** Grid lines render at exact constants from `moorings-grid-constants.ts`:
- A–L: EW positions, axis='X', straight (angle=0), colour `COL_X_HEX = 0x1177CC` (blue)
- 1–9: NS positions, axis='Y', straight (angle=0), colour `COL_Y_HEX = 0xCC7700` (amber)
- Intersection dots rendered as flat circles (Three.js `CircleGeometry`), colour `0x44AAFF`

---

### V17-3: Wing Grid Rendering (M–Y × 10–19)

**Confirmed correct.** Both families angled at `WING_ANG = 27.16°` (tan = 0.5131):
- M–Y: EW-dominant, `coord + param × tan(WING_ANG)`, colour `COL_ANG_HEX = 0x33BB00` (green)
- 10–19: NS-dominant, `coord − (param − start_m) × tan(WING_ANG)`, same green
- Intersection dots colour `0x88FF44` (bright lime)

**Constants corrected this session:** wrote verified `start_m / end_m` extents for all M–Y and 10–19 gridlines directly into `moorings-grid-constants.ts` based on drawing measurements.

---

### V17-4: CL Lines (CLa / CL / CLb)

**Three parallel CL lines** at `CL_ANG = WING_ANG / 2 = 13.58°` (tan ≈ 0.2416), colour `COL_CL_HEX = 0xDD0099` (magenta):

| Line | EW coord at NS=0 |
|------|-----------------|
| CLa  | 40.525 m        |
| CL   | 43.810 m        |
| CLb  | 47.095 m        |

- CL line spacing: `CL_SPACING = 3.285 m`
- CL zone bridges the rectangular and wing sections
- Intersection dots with rect × wing lines rendered as magenta circles `0xFF44CC`
- Note: `CL_ANG` is NOT exported from constants — always computed inline as `WING_ANG / 2`

---

### V17-5: Dimension Chains

Architectural-style dimension chains drawn outside the building footprint:

| Chain | Offset from grid | Direction | Tick step |
|-------|-----------------|-----------|-----------|
| A–L (EW spacings) | `CHAIN_OFFSET = 7 m` south of Grid 9 | Along EW axis | 10 m major |
| 1–9 (NS spacings) | `CHAIN_OFFSET = 7 m` west of Grid A | Along NS axis | 10 m major |
| M–Y (wing EW) | `CHAIN_OFFSET = 7 m` south-west of wing | Along wing axis | 10 m major |
| 10–19 (wing NS) | `CHAIN_OFFSET = 7 m` north-west of wing | Along wing axis | 10 m major |
| CL zone (CLa/CL/CLb) | `CHAIN_OFFSET = 11 m` | Perpendicular to CL | — |

- Tick height: `TICK_H = 0.8 m`
- Chain lines drawn in the same colour as their grid family
- Dimension text sprites placed at midpoint of each bay
- Chain labels use `sizeAttenuation: true` (world-space, scales with zoom)

---

### V17-6: Label Placement — 5-Position Collision Algorithm

**Problem:** Grid bubble labels and intersection labels stacked on top of each other.

**Algorithm:**
```
QUAD_R = 0.6 m   (radius of intersection dot — keep labels outside this)
LABEL_CLEAR = 0.9 m  (minimum clearance between placed labels)

For each label, try positions in order:
  1. [0, 0]  — at the dot itself (preferred if no conflicts)
  2. East    (+EW)
  3. West    (−EW)
  4. South   (+NS in viewer = −Z direction)
  5. North   (−NS in viewer = +Z direction)

If all 5 conflict → fall back to dot position (label stays but may overlap)

Placed label registry:
  lPlacedEW[]  — EW axis labels already placed
  lPlacedNS[]  — NS axis labels already placed
  (separate registries to avoid cross-family false conflicts)
```

One uniform rule applies to ALL grid families (rect, wing, CL).

---

### V17-7: Intersection Label Styling

| Element | Style |
|---------|-------|
| Grid bubble (circle behind label) | Sprite, `1.5 × 1.5 m`, `sizeAttenuation: true` |
| Intersection label (e.g. "A-9") | Sprite, `1.8 × 0.56 m`, canvas 256×80 px |
| Dim tick label (numeric value) | Sprite, `1.8 × 0.9 m`, canvas 256×128 px |
| Chain bay label | Sprite, `2.0 × 0.9 m`, canvas 256×128 px |
| Angle label | Sprite, `2.0 × 1.0 m`, canvas 256×128 px |

**Text colours:**
- CL family labels: `#FF44CC` (magenta)
- Wing family labels: `#88FF44` (bright green)
- All other labels: `#FFE033` (yellow-gold)

**CLa/CLb conflict fix:** CLa and CLb share very close EW coords — their intersection labels were rendering on top of each other. Fixed by applying forced East/West offset for CLa vs CLb respectively in the placement loop.

---

### V17-8: Camera Controls Remapping

| Action | Input |
|--------|-------|
| Pan (all directions) | Left drag |
| Orbit / rotate | Right drag |
| Zoom | Scroll wheel |
| Zoom to cursor | Enabled (`zoomToCursor = true`) |

- `controls.zoomToCursor = true` — scroll wheel zooms toward wherever the cursor is pointing, NOT just the fixed orbit target. Allows descending to floor level by hovering over a gridline and scrolling in.
- `controls.minDistance = 0.05 m` — allows zooming right up to individual grid dots
- `controls.maxDistance` — not capped (allows full overview)

---

### V17-9: Floor-Level Orbit Target

**Problem:** Orbit target was at building centre height (Y ≈ −2.3 m). Zooming in stopped at mid-building, never reaching the grid floor (Y ≈ −4.65 m).

**Fix:**
```typescript
// Initial camera setup (after model load)
const floorTarget = new THREE.Vector3(center.x, box.min.y, center.z);
controls.target.copy(floorTarget);
camera.position.copy(floorTarget).add(cameraOffset);

// Reset View button
const floorY = c.y - s.y * 0.5;
controls.target.set(c.x, floorY, c.z);
camera.position.set(c.x + ne.x, floorY + ne.y, c.z + ne.z);
```

Both the initial load and the Reset View button now target floor level.

---

### V17-10: Element Dimension Labels Removed

**Problem:** Each building element had a floating "L: 37.4m / H: 4.7m / T: 0.30m" sprite rendered at `scale = Math.max(0.5, Math.min(2, dims.width / 5))`. For large slabs (width = 37.4 m → scale = 2), this was a 2 × 2 m sprite that dominated the screen when zoomed in. Distance measurement lines (orange) on wall elements were similarly clutter.

**Fix:** Both `createDimensionLabel` sprite block and the `createDistanceLine` block removed entirely from the element rendering loop. Element properties (L / H / T) are shown in the right panel when the user clicks on an element.

---

### V17 — Files Changed

| File | Changes |
|------|---------|
| `client/src/components/bim/viewer-3d.tsx` | Dimension chains (all families), label collision algorithm, intersection dot colours, sprite sizes, camera target at floor level, zoomToCursor, Reset View fix, element dimension labels removed, distance lines removed |
| `client/src/components/bim/moorings-grid-constants.ts` | Corrected `start_m` / `end_m` extents for M–Y and 10–19 wing gridlines |

---

### V17 — Known Open Items (carry forward)

| Item | Priority | Notes |
|------|----------|-------|
| Verify all rect × wing intersections fall exactly ON the CL line in viewer | High | Geometrically they should — needs visual confirmation in browser |
| Legends: make horizontal, move below floor visibility toggle | Medium | Currently vertical stacked in right panel |
| Left panel: make collapsible | Medium | Expands viewport area when hidden |
| Building elements vs grid coordinate alignment | High | Elements render but coordinates may not match grid intersections |
| Full P1 model render verification | High | All 38 elements loaded, positions need cross-check vs drawings |
| Automated build for Ground / Floor 2 / Floor 3 / MPH / Roof | Low | Blocked until P1 is verified |
| `sizeAttenuation: false` is NOT usable | — | Causes uncontrolled label sizing in this Three.js setup — do not attempt |

---

## 1. Fixes Applied (this session — V16)

### Fix #1: Clean grid_line DB elements
**Files changed:**
- `server/routes/bim-element-crud.ts` — NEW endpoint: `DELETE /api/bim/models/:modelId/elements/grid-lines`
- `server/real-qto-processor.ts` (line ~3431) — GUARD: gridline layer now logs instead of inserting to DB
- `server/construction-workflow-processor.ts` (line ~2788) — GUARD: grid_line elements from Claude logged but not stored

**What it does:** Removes all `grid_line` type elements from the bim_elements table. Prevents future insertions. Static constants renderer is the sole source of gridlines.

**DONE (Rev 2.2):** 47 grid_line DB records deleted directly. DB now contains only real elements (walls, doors, stairs, MEP, slab). Bulk delete endpoint available at DELETE /api/bim/models/:modelId/elements/type/grid_line for future use.

### Fix #2: Single gridline rendering verified
**File:** `client/src/components/bim/viewer-3d.tsx` (line ~620)
**Result:** Scene clear removes ALL objects except GridHelper and AxesHelper. Static gridlines re-added from constants. No duplicate rendering path exists.

### Fix #3: Parameter-resolver uses grid constants
**File:** `server/pipeline/parameter-resolver.ts`
- `buildGridMap()` now reads from `MOORINGS_GRIDLINES` constants as PRIMARY source
- Falls back to pipeline GridData only for labels not in constants
- Alpha gridlines (axis='X') → EW positions, Numeric (axis='Y') → NS positions

### Fix #3b: Grid intersection for angled gridlines
**File:** `shared/grid-types.ts` — NEW: `computeGridIntersection(alpha, numeric, gridlines)`
- Solves parametric line equations for ANY two gridlines at ANY angles
- Alpha: EW = coord + NS × tan(angle)
- Numeric: NS = coord − (EW − start_m) × tan(angle)
- Handles straight×straight, straight×angled, angled×angled

**File:** `server/pipeline/parameter-resolver.ts` — `resolveGridPosition()` uses `computeGridIntersection()` as primary method

### Fix #3c: Generic grid functions
**File:** `shared/grid-types.ts` — ALL functions accept `gridlines[]` parameter
- `computeGridIntersection(alpha, numeric, gridlines)` — any project
- `getGridline(label, gridlines)` — any project
- `computeGridEndpoints(gridlines, floorY)` — any project

### Fix #4: Generic PDF grid parser (v5.1)
**File:** `server/utils/gridline-pdf-parser.ts` — COMPLETE REWRITE (1084 lines)

**ZERO hardcoded values.** Removed:
- No 166.42° bearing constant
- No 4710mm A-B spacing
- No 35.149 scale factor
- No Y/X band positions
- No project-specific family detection

**Generic algorithm:**
1. Extract text items with positions (pdf.js-extract)
2. Find grid labels — auto-detect font height via mode detection
3. Group into families — cluster by position, fit lines via regression
4. Detect angles — from label positions, not hardcoded bearings
5. Find dimension text — metric (mm) and imperial (ft-in)
6. Match dimensions to gaps — spatial midpoint matching
7. Estimate scale — median of dimension/distance ratios
8. Accumulate positions — from 0, summing matched dimensions
9. Origin = bottom-left corner (leftmost alpha, bottommost numeric)
10. Compute extents — cross-reference alpha and numeric families

**Output:** Both `ParsedGridLine[]` (backward compat) and `GridlineDefinition[]`

### Fix #5: Element Placement Record system
**File:** `shared/element-placement-types.ts` — NEW (328 lines)

**Types defined:**
- `GridIntersectionCoord` — every grid intersection with 3D coordinates (x, y, z)
- `GridCoordinateTable` — all intersections for a project with verification chain
- `ElementPlacementRecord` — full element record with:
  - Grid references (start + end intersection labels)
  - 3D coordinates (start, end, centerline) — Z = field elevation
  - Angle rotation from grid axis
  - Offset from grid to centerline
  - Thickness/height/width/depth from correlated documents
  - Assembly code + mark linking to schedules/assemblies
  - Direction convention (always left-to-right, clockwise)
  - Source documents tracking
  - Verification status (parser → AI visual → user confirmed)
- `ElementPlacementTable` — all elements for a floor

**Functions:**
- `computeAllIntersections(gridlines, floorElev, projectId)` — generates full intersection table with validity check (only where gridlines physically cross)
- `createPlacementRecord(type, gridStart, gridEnd, gridTable, properties)` — creates element from grid references

### Fix #6: Grid intersection markers in viewer
**File:** `client/src/components/bim/viewer-3d.tsx` (after line ~1859)
- Computes all valid intersections from MOORINGS_GRIDLINES
- Renders green spheres at orthogonal intersections
- Renders magenta spheres at angled intersections
- Labels each intersection with grid reference (A-9, B-8, M-12, etc.)
- Extent overlap check prevents invalid intersections

### Fix #7: Gridline API endpoints
**File:** `server/routes/bim-generate.ts`
- `POST /bim/models/:modelId/parse-gridlines` — runs parser, computes intersections
- `GET /bim/models/:modelId/grid-table` — get current verified grid
- `POST /bim/models/:modelId/confirm-grid-table` — user confirms grid

---

## 2. New Files Created

| File | Purpose |
|------|---------|
| `shared/grid-types.ts` | Generic gridline types + intersection math (any project) |
| `shared/element-placement-types.ts` | Element placement records + intersection table |

---

## 3. Files Modified

| File | What changed |
|------|-------------|
| `server/routes/bim-element-crud.ts` | Added DELETE grid-lines endpoint |
| `server/real-qto-processor.ts` | Guarded grid_line insertion |
| `server/construction-workflow-processor.ts` | Guarded grid_line insertion |
| `server/pipeline/parameter-resolver.ts` | Uses grid constants + intersection math |
| `server/utils/gridline-pdf-parser.ts` | Complete rewrite — generic v5.1 |
| `server/routes/bim-generate.ts` | Added gridline API endpoints |
| `client/src/components/bim/viewer-3d.tsx` | Intersection markers + improved scene clear |
| `shared/moorings-grid-constants.ts` | Kept GridlineDefinition type, functions in grid-types.ts |

---

## 4. Verified Grid Intersections (sample)

Computed from `MOORINGS_GRIDLINES` using `computeGridIntersection()`:

```
RECTANGULAR (A-L × 1-9):
  A-9   EW =  0.000m  NS =  0.000m   ← ORIGIN
  B-9   EW =  4.710m  NS =  0.000m
  A-8   EW =  0.000m  NS =  5.885m
  B-8   EW =  4.710m  NS =  5.885m
  L-1   EW = 41.999m  NS = 40.830m
  L-9   EW = 41.999m  NS =  0.000m

WING (M-Y × 10-19, both angled at 27.16°):
  M-10  EW = 51.690m  NS = 11.731m
  M-12  EW = 48.349m  NS =  5.220m
  Y-19  EW = 67.572m  NS =-38.788m
```

---

## 5. Construction Phases (agreed approach)

| Phase | What | Status |
|-------|------|--------|
| 1 | **Gridlines** — parse, compute intersections, verify, confirm | IN PROGRESS |
| 2 | Perimeter walls | Not started |
| 3 | Electrical + plumbing rough-in | Not started |
| 4 | Columns + interior walls | Not started |
| 5 | Electrical + plumbing finish | Not started |
| 6 | Exterior civil works | Not started |
| 7 | Painting | Not started |
| 8 | Finishing electrical + plumbing after painting | Not started |
| 9 | Commissioning | Not started |

**Approach:** Complete each phase before moving to the next. Start with underground parking (P1), then move up floor by floor.

---

## 6. Architecture Decisions

### Origin rule
Origin (0,0,0) = intersection of leftmost and bottommost gridlines. Always. For any project. Program determines this automatically.

### Element positioning
Elements are positioned BY GRID REFERENCE, not by absolute coordinates. Claude classifies elements by grid label, code resolves to coordinates using grid intersection math.

### Direction convention
Start/End always left-to-right, clockwise. This determines interior vs exterior face for thickness offset.

### Z coordinate
Z = field elevation (real-world position for construction layout). Separate from `height_m` which is for estimation/cost calculation.

### No hardcoded values
The parser, resolver, and mesh builder are generic. The Moorings constants file is verified output data for this project — not a template that needs manual editing.

### Information correlation
Thickness, width, height come from correlated documents (assemblies, schedules, sections, specifications). NOT from the floor plan. The floor plan provides POSITION (grid reference). Other documents provide DIMENSIONS.

---

## 7. Conventions (DO NOT CHANGE)

- EW axis = Three.js **X**
- NS axis = Three.js **Z** (positive = North)
- Elevation = Three.js **Y**
- Origin: bottom-left gridline intersection = (0, 0, 0)
- Grid formula axis='X': `coord + start_m * tan(angle)`
- Grid formula axis='Y': `coord - (end_m - start_m) * tan(angle)`
- Wing angle: 27.16 degrees (tan = 0.5131)
- CL angle: 13.58 degrees (tan = 0.2416)

---

## 8. Grid Intersection Markers (Rev 1.2 / 1.3)

### What Claude Code added (commit ace4f15):
- Computes all valid intersections from MOORINGS_GRIDLINES
- Green spheres at orthogonal intersections, magenta at angled
- Label sprites showing grid reference (A-9, M-10, etc.)
- Extent overlap check prevents invalid intersections
- Console logs intersection count

### What Replit Agent did (Rev 1.3):
- Pulled and applied to workspace
- Vite HMR confirmed
- Browser reload needed to render markers

### How to verify:
1. Load BIM viewer → P1 floor
2. Green dots at rectangular intersections (A-L × 1-9)
3. Magenta dots at wing/CL intersections
4. Console: `Rendered X grid intersection markers` (expect ~200-300)
5. Origin A-9 should be at Three.js (0, -4.65, 0)

---

## 9. What Replit Should Do Next

1. Pull `estimatorpro-v16` branch
2. Run `npm install` (pdf.js-extract added)
3. Call `DELETE /api/bim/models/41fc242e-300c-490d-849c-2e897757534f/elements/grid-lines` to clean old DB grid elements
4. Load BIM viewer — verify all 47 gridlines render with intersection markers
5. Check intersection markers against A101 drawing — report any mispositions
6. Once gridlines are confirmed, we proceed to Phase 2 (perimeter walls)

---

## 9. Known Issues

| Issue | Status | Notes |
|-------|--------|-------|
| Grid 19 discrepancy (-27.552 vs -30.088) | Open | See TRANSFER.md §4.3 |
| Parser may not find all labels on complex drawings | Mitigated | v5.1 has wider clustering, multi-char support |
| Angled grid families not perfectly separated by parser | Mitigated | Constants file is authoritative for this project |
| CL gridlines extent may not match building edge | Open | CL lines bridge rectangular and wing sections |
