# Transfer Document: Claude Code → Replit
**Date:** March 18, 2026
**Branch:** estimatorpro-v16
**Context:** Grid alignment and element positioning fixes

---

## Revision History

| Rev | Date | Author | Changes |
|-----|------|--------|---------|
| 1.0 | 2026-03-18 | Claude Code | Initial assessment — gridlines, element coordinate problem, IR pipeline plan |
| 1.1 | 2026-03-18 | Replit Agent | Reviewed and corrected Section 4; confirmed pipeline files already in v16; verified anchor values |

---

## 1. Current State Assessment

### What I found in the codebase audit:

**THREE gridline rendering paths exist:**
1. Static constants renderer (`MOORINGS_GRIDLINES` in `moorings-grid-constants.ts`) — ACTIVE, correct
2. DB grid_line element renderer — SKIPPED at viewer-3d.tsx line 1250
3. Analysis-based heuristic grid — computed and logged at line 720, never rendered (by design)

**The gridline constants are correct:**
- 47 gridlines defined with proper positions from PDF dimension annotations
- Origin A-9 = (0, 0, 0)
- Wing angle 27.16 degrees, CL angle 13.58 degrees
- tan-based formula is mathematically correct

**Verification anchor values (confirmed against constants file by Replit Agent):**
- Grid B = X 4.710 m ✓
- Grid 8 = Z 5.885 m ✓
- Grid L = X 41.999 m ✓

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
- Confirm all 47 lines appear:
  - 12 rectangular EW (A–L): orange
  - 13 wing EW (M–Y): magenta
  - 3 centreline (CLa / CL / CLb): magenta
  - 9 rectangular NS (1–9): yellow
  - 10 wing NS (10–19): magenta
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

## 4. Pipeline Files Status (CORRECTED in Rev 1.1)

### ~~Original claim (Rev 1.0):~~
~~"These files are on `master` but NOT in v16 — need selective merge."~~

### Correction (Rev 1.1 — Replit Agent):
**All pipeline files are already present in v16.** The v16 branch was pushed directly from the Replit master workspace, which contains the full IR pipeline. No merging is required.

Confirmed present at `artifacts/estimatorpro/server/pipeline/`:
- `parameter-resolver.ts` ✓ — converts grid refs → absolute coords
- `mesh-builder.ts` ✓ — builds 3D geometry from resolved params
- `candidate-types.ts` ✓ — IR types with grid references
- `pdf-vector-parser.ts` ✓ — reads grid from PDF text positions
- `sequential-pipeline.ts` ✓
- `stage-types.ts` ✓
- `prompt-builders.ts` ✓
- `view-projection.ts` ✓
- `view-classifier.ts` ✓
- `spatial-matcher.ts` ✓
- `coordinate-transform.ts` ✓
- `grid-bay-zones.ts` ✓
- `candidate-review.ts` ✓

**13 pipeline files total — all present in v16, ready to use.**

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
| Grid 19 coordinate discrepancy | Open | Two values: −27.552 vs −30.088. See TRANSFER.md §4.3 |
| Old grid_line elements in DB | Needs cleanup | Remove from bim_elements table (viewer skips them but DB should be clean) |
| Elements positioned with wrong origin | All P1 elements | Need re-extraction using grid references via IR pipeline |
| PDF parser — angled grid families not separated | Open | Parser treats all alphas as one family; constants file is authoritative now |
| Analysis grid computed but not rendered | By design | Computed for debug logging only; static constants renderer replaced it |

---

## 7. Conventions (DO NOT CHANGE)

From TRANSFER.md:
- EW axis = Three.js X
- NS axis = Three.js Z (positive = North)
- Elevation = Three.js Y
- Origin: Grid A / Grid 9 = (0, 0, 0)
- Wing angle: 27.16 degrees (tan = 0.5131)
- CL angle: 13.58 degrees (tan = 0.2416)
- Grid formula axis='X': `coord + start_m * tan(angle)`
- Grid formula axis='Y': `coord − (end_m − start_m) * tan(angle)`

---

## 8. Replit Agent Review (Rev 1.1)

**Agreement with overall approach: YES.**

The document correctly diagnoses the problem, proposes the right sequence, and identifies the right tools to use. The pipeline already exists and is ready. Specific confirmations:

- Static constants renderer is correct and active ✓
- Elements using wrong coordinates is the core problem ✓
- Grid-first → verify → elements is the right sequence ✓
- IR pipeline (parameter-resolver → grid refs → absolute coords) is the right architecture ✓
- "Do not ask Claude for absolute coordinates" is a critical rule ✓
- Conventions must not change ✓

**One correction made (see Section 4):** Pipeline files are already in v16 — no selective merging needed.

**Next action:** Phase 1 visual verification — load the BIM viewer for P1, confirm all 47 lines render with correct colours and labels, then mark gridlines as done and proceed to Phase 3 element re-extraction via the IR pipeline.
