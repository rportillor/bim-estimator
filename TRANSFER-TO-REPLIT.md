# Transfer Document: Claude Code → Replit
**Date:** March 18, 2026
**Branch:** estimatorpro-v16
**Context:** Grid alignment and element positioning fixes

---

## 1. Current State Assessment

### What I found in the codebase audit:

**THREE gridline rendering paths exist:**
1. Static constants renderer (`MOORINGS_GRIDLINES` in `moorings-grid-constants.ts`) — ACTIVE, correct
2. DB grid_line element renderer — SKIPPED at viewer-3d.tsx line 1250
3. Analysis-based heuristic grid — DETECTED but NEVER RENDERED (logged at line 720)

**The gridline constants are correct:**
- 47 gridlines defined with proper positions from PDF dimension annotations
- Origin A-9 = (0, 0, 0)
- Wing angle 27.16 degrees, CL angle 13.58 degrees
- tan-based formula is mathematically correct

**The problem is NOT the gridlines — it's the ELEMENTS:**
- Elements in the DB were extracted by Claude using absolute PDF coordinates or arbitrary positions
- The grid constants use origin A-9 = (0,0,0)
- If elements were placed with a different origin, they won't align with the grid
- The `coerceWithDatum` function (viewer-3d.tsx lines 762-777) shifts Z only, not XY

### Why elements don't align with grid:
Elements were created by the old pipeline (bim-generator.ts batch processing) which:
- Asked Claude to provide absolute coordinates (not grid references)
- Had no grid to reference (grid extraction happened separately)
- Stored coordinates from Claude's visual estimation of the PDF
- Never used the dimension text or grid intersection positions

The IR pipeline (Stages 5A/5B/5C) was built to fix this — Claude classifies elements by grid reference, code resolves to absolute coords using grid constants. But it was never run because the user was using the old Regen button instead of the Pipeline button.

---

## 2. What Needs to Happen (Phase 1: Gridlines)

### Step 1: Clean the cache
- Remove ALL existing grid_line elements from the bim_elements DB table for this model
- The static constants renderer is the sole source of grid geometry
- No DB grid elements should exist

### Step 2: Verify gridline rendering
- Load the BIM viewer for P1 floor
- Confirm all 47 lines appear: 12 rectangular (A-L, orange), 3 CL (magenta), 13 wing (M-Y, magenta), 9 rectangular NS (1-9, yellow), 10 wing NS (10-19, magenta)
- Labels should appear at the end of each line

### Step 3: Verify origin
- Grid A-9 intersection should be at Three.js position (0, floorY, 0)
- Grid B should be at X=4.710
- Grid 8 should be at Z=5.885
- Grid L should be at X=41.999

---

## 3. What Needs to Happen (Phase 2: Element Placement)

### The correct approach (from BIM standards):
Elements must be positioned BY GRID REFERENCE, not by absolute coordinates.

Example: "Wall EW1 runs from grid A-2 to grid A-5"
- Grid A position: X = 0.0m
- Grid 2 position: Z = 37.355m (from constants)
- Grid 5 position: Z = 21.830m (from constants)
- Wall start: (0.0, floorY, 37.355)
- Wall end: (0.0, floorY, 21.830)
- Wall length: 37.355 - 21.830 = 15.525m

The IR pipeline (parameter-resolver.ts) does exactly this conversion.

### What must NOT happen:
- Claude should NOT provide absolute x,y coordinates
- Elements should NOT be placed at PDF coordinates
- No "coercing" or "detecting" coordinate systems — the grid IS the coordinate system

---

## 4. Files Changed by Claude Code (this session)

### On the estimatorpro-v16 branch:
No files were changed yet — this session was analysis only.

### On the master branch (prior sessions, 60 files):
These changes are on the `master` branch and include the full IR pipeline,
PDF vector parser, grid confirmation dialog, and all fixes. They need to be
selectively merged into v16 if needed.

Key files from master that v16 should consider:
- `server/pipeline/parameter-resolver.ts` — converts grid refs → absolute coords
- `server/pipeline/mesh-builder.ts` — builds 3D geometry from resolved params
- `server/pipeline/candidate-types.ts` — IR types with grid references
- `server/pipeline/pdf-vector-parser.ts` — reads grid from PDF text positions

---

## 5. Architecture Decision: Grid-First Approach

### How it should work:
```
Phase 1: GRID
  moorings-grid-constants.ts defines all 47 gridlines
  Viewer renders them
  User confirms they're correct

Phase 2: LEGEND + SCHEDULES + ASSEMBLIES
  Read patterns, symbols, abbreviations (Stage 0)
  Read door/window schedules (Stage 1)
  Read construction assemblies (Stage 2)
  Read specifications (Stage 3)

Phase 3: ELEMENT PLACEMENT (one floor at a time)
  Claude classifies: "wall EW1 at grid A from grid 2 to grid 5"
  Code resolves: A=0, 2=37.355, 5=21.830 → wall at (0, y, 37.355) to (0, y, 21.830)
  Code looks up: EW1 = 291mm thick (from assembly data)
  Code builds mesh: centerline + 0.146m offset → polygon → extrude

Phase 4: VERIFY
  Element should sit on gridline A, spanning from grid 2 to grid 5
  If not → something is wrong with the grid ref extraction
```

### What we do NOT do:
- Ask Claude to "estimate coordinates from the image"
- Use PDF coordinate space for anything
- Apply scale factors to convert between coordinate systems
- Guess where elements go

---

## 6. Known Issues

| Issue | Status | Notes |
|-------|--------|-------|
| Grid 19 coordinate discrepancy | Open | Two values: -27.552 vs -30.088. See TRANSFER.md §4.3 |
| Old grid_line elements in DB | Needs cleanup | Remove from bim_elements table |
| Elements positioned with wrong origin | All P1 elements | Need re-extraction using grid references |
| PDF parser missing full grid | Partial | Parser found 12 of 25 alpha gridlines |
| Angled grid families not separated | Open | Parser treats all alphas as one family |
| Analysis grid detected but not rendered | By design | Could be useful for verification |

---

## 7. Conventions (DO NOT CHANGE)

From TRANSFER.md:
- EW axis = Three.js X
- NS axis = Three.js Z (positive = North)
- Elevation = Three.js Y
- Origin: Grid A / Grid 9 = (0, 0, 0)
- Wing angle: 27.16 degrees
- CL angle: 13.58 degrees
- Grid formula: coord + start_m * tan(angle) for axis='X'
