# Transfer Document: Claude Code → Replit
**Date:** March 18, 2026
**Branch:** estimatorpro-v16
**Context:** Gridline system overhaul + element placement architecture

---

## Revision History

| Rev | Date | Author | Changes |
|-----|------|--------|---------|
| 1.0 | 2026-03-18 | Claude Code | Initial assessment — gridlines, element coordinate problem, IR pipeline plan |
| 1.1 | 2026-03-18 | Replit Agent | Reviewed and corrected Section 4; confirmed pipeline files already in v16; verified anchor values |
| 1.2 | 2026-03-18 | Claude Code | Added grid intersection markers to viewer-3d.tsx (commit ace4f15, +70 lines) |
| 1.3 | 2026-03-18 | Replit Agent | Pulled commit ace4f15; Vite HMR confirmed; browser reload required |
| 2.0 | 2026-03-18 | Claude Code | Complete rewrite — all 7 fixes, generic parser, intersection system, element placement types, construction phases |
| 2.1 | 2026-03-18 | Replit Agent | Synced all Rev 2.0 code — 7 files applied, 3 new shared/ types, server clean restart; **264 intersection markers + 47 gridlines confirmed in console** |

---

## 1. Fixes Applied (this session)

### Fix #1: Clean grid_line DB elements
**Files changed:**
- `server/routes/bim-element-crud.ts` — NEW endpoint: `DELETE /api/bim/models/:modelId/elements/grid-lines`
- `server/real-qto-processor.ts` (line ~3431) — GUARD: gridline layer now logs instead of inserting to DB
- `server/construction-workflow-processor.ts` (line ~2788) — GUARD: grid_line elements from Claude logged but not stored

**What it does:** Removes all `grid_line` type elements from the bim_elements table. Prevents future insertions. Static constants renderer is the sole source of gridlines.

**To clean existing DB:** Call `DELETE /api/bim/models/41fc242e-300c-490d-849c-2e897757534f/elements/grid-lines`

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
