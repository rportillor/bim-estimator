# EstimatorPro — Transfer Document
**Project:** The Moorings (Cameron Lake, Ontario)
**System:** EstimatorPro v16
**Active BIM Model:** `41fc242e-300c-490d-849c-2e897757534f`
**Active Project:** `262dea72-aafd-4ba8-96b0-78bbc2335c62`

---

## Revision History

| Rev | Date | Author | Changes |
|-----|------|--------|---------|
| 1.0 | 2026-03-18 | Replit Agent | Initial document — architecture, fixed issues, pending work |
| 1.1 | 2026-03-18 | Replit Agent | Aligned with TRANSFER-TO-REPLIT.md Rev 1.1; confirmed pipeline files present; updated known issues |

---

## 1. Architecture Overview

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React + Vite + TypeScript | BIM viewer, QTO tables, admin UI |
| Backend | Express + TypeScript | REST API, BIM element storage, PDF processing |
| Database | PostgreSQL (Drizzle ORM) | Models, projects, BIM elements |
| 3D Viewer | Three.js | 3D structural grid + element rendering |
| AI Pipeline | Claude Anthropic API | PDF → structured BIM element extraction |

**Monorepo layout (pnpm workspaces):**
```
artifacts/
  estimatorpro/
    client/src/components/bim/
      viewer-3d.tsx                 ← 3D BIM viewer (Three.js)
      moorings-grid-constants.ts    ← ALL 47 gridlines hardcoded — authoritative source
      bim-viewer.tsx                ← wrapper / UI shell
    server/
      routes/bim-generate.ts        ← /generate, /extract-layer endpoints
      real-qto-processor.ts         ← Claude AI + PDF pipeline
      utils/gridline-pdf-parser.ts  ← PDF spatial parser (gridlines)
      pipeline/                     ← IR pipeline — 13 files (all present in v16)
        parameter-resolver.ts       ← grid refs → absolute coords
        mesh-builder.ts             ← 3D geometry from resolved params
        candidate-types.ts          ← IR types with grid references
        pdf-vector-parser.ts        ← reads grid from PDF text positions
        sequential-pipeline.ts
        stage-types.ts
        prompt-builders.ts
        view-projection.ts
        view-classifier.ts
        spatial-matcher.ts
        coordinate-transform.ts
        grid-bay-zones.ts
        candidate-review.ts
```

**Geometry conventions (do not change):**
- EW axis = Three.js **X**; NS axis = Three.js **Z** (positive = North); Elevation = Three.js **Y**
- Coordinate origin: Grid A / Grid 9 intersection = `(0, 0, 0)`
- Wing angle: **27.16°** (tan ≈ 0.5131) — grids M–Y and 10–19
- Centreline angle: **13.58°** (tan ≈ 0.2416) — CLa / CL / CLb
- **Gridline formula:**
  - axis='X' (EW): `pt1 = (coord + start_m·tanA, Y, start_m)` → `pt2 = (coord + end_m·tanA, Y, end_m)`
  - axis='Y' (NS): `pt1 = (start_m, Y, coord)` → `pt2 = (end_m, Y, coord − (end_m − start_m)·tanA)`

---

## 2. Issues Fixed (Completed)

### 2.1 Wrong 3D gridline formula (sin/cos → tan)
**Problem:** Gridlines rendered as diagonals instead of straight lines due to sin/cos producing circular arc projection.
**Fix:** Replaced with tan-based formula in `moorings-grid-constants.ts` and `viewer-3d.tsx`.

### 2.2 DB-driven gridline rendering replaced with constants
**Problem:** Gridlines depended on a fragile PDF parser → Claude → DB insert → query chain.
**Fix:** `moorings-grid-constants.ts` hardcodes all 47 gridlines from PDF annotations. DB path hits `continue` in the element loop — zero DB/AI dependency for gridlines.

### 2.3 Heuristic analysis-grid fallback removed
**Problem:** Heuristic fallback drew a geometrically wrong grid from wall/column positions.
**Fix:** Removed. Static constants renderer runs unconditionally on every floor load.

### 2.4 Duplicate gridline rendering
**Problem:** DB element loop and fallback block both rendering simultaneously.
**Fix:** DB `grid_line` elements hit `continue`. Static renderer is sole source.

### 2.5 Fast Refresh export conflict
**Problem:** Duplicate exports in `viewer-3d.tsx` broke Vite HMR.
**Fix:** Consolidated to single default export.

### 2.6 BIM viewer layout (right panel → bottom panel)
**Problem:** Properties panel on right compressed the 3D viewport.
**Fix:** Panel moved to collapsible bottom drawer.

### 2.7 QTO batch caching
**Problem:** Every QTO refresh re-invoked Claude API at full cost.
**Fix:** Server-side batch cache keyed on (modelId + floorLevel + elementType).

### 2.8 Extract-layer endpoint
**Problem:** No way to extract a single floor or element type independently.
**Fix:** `/api/bim/models/:modelId/extract-layer` POST endpoint with `{ floorLevel, elementType, forceRefresh }`.

### 2.9 PDF spatial parser (gridlines v4 → v6e)
**Problem:** Heuristic text-position parser failed on rotated annotations.
**Fix:** Rewrote using PDF operator-stream analysis to match dimension leaders to grid bubble text. All 47 gridlines extract correctly.

---

## 3. Issues Currently In Progress

### 3.1 Visual verification of all 47 gridlines in browser ← ACTIVE
**Status:** Static renderer deployed and Vite hot-reloaded. Browser screenshot not yet taken.
**Next step:** Load BIM viewer for P1 floor, confirm 47 lines with correct colours (EW orange, NS yellow, angled/wing/CL magenta) and labels.

### 3.2 Element coordinate alignment with grid
**Status:** Diagnosed. Elements in the DB were placed using Claude's visual estimation of PDF coordinates, not grid references. They will not align with the A/9=(0,0,0) grid origin.
**Next step:** After gridline visual verification passes, re-extract P1 elements using the IR pipeline (parameter-resolver.ts) so elements are positioned by grid intersection reference.

---

## 4. Issues Remaining (Not Yet Started)

### 4.1 DB cleanup — old grid_line elements
**Detail:** Old `grid_line` records remain in `bim_elements`. The viewer skips them (`continue` in element loop) so they don't affect rendering, but the DB should be clean.
**Work needed:** Delete all `grid_line` type elements for this model from `bim_elements` table.

### 4.2 Grid 19 coordinate discrepancy
**Detail:** Grid 19 has two source values: −27.552 m (cumulative spans) vs −30.088 m (direct PDF anchor). Constants file uses −30.088 for span bounds but −27.552 for the grid 19 line itself. ~2.5 m mismatch at south wing corner.
**Work needed:** Confirm against original structural drawing; update constants file.

### 4.3 Ground floor BIM extraction
**Status:** Only P1 extracted and verified. Ground floor not processed.
**Work needed:** Run IR pipeline for `floorLevel=Ground` — walls, columns, slabs, beams, stairs.

### 4.4 Upper floors: Floor 2, Floor 3, MPH, Roof
**Status:** Not extracted.
**Work needed:** IR pipeline for each. Elevations: Floor 2=+4.000 m, Floor 3=+7.600 m, MPH=+11.700 m, Roof=+15.800 m. Note: MPH and Roof have partial wing geometry.

### 4.5 Element type coverage gaps
**Status:** Walls, columns, slabs partially validated. Not validated: beams, stairs, ramps, curtain wall/glazing, MEP penetrations.

### 4.6 QTO quantity accuracy audit
**Status:** No independent verification against manual take-off.
**Work needed:** Select 20–30 representative elements; compare QTO quantities against manual measurements.

### 4.7 User authentication and multi-project support
**Status:** Admin-only single user (`admin` / `Admin123!`). No registration, password reset, or roles.
**Work needed:** Project-level access control, user registration, role management (Owner, Estimator, Viewer).

### 4.8 Export and reporting
**Status:** No export exists.
**Work needed:** PDF QTO report, CSV/Excel quantity export, IFC or glTF model export.

### 4.9 Mobile / tablet responsive layout
**Status:** Not usable below ~1200 px.
**Work needed:** Responsive breakpoints; touch-based orbit controls for Three.js viewport.

### 4.10 Performance — large model loading
**Status:** Single `/elements` API call returns all records at once.
**Work needed:** Paginate or stream by type; progressive rendering (structural first, then finishes).

---

## 5. Key Reference Values

| Constant | Value | Notes |
|---|---|---|
| Grid A (EW origin) | 0.000 m | rectangular block west edge |
| Grid B (EW) | 4.710 m | confirmed against constants file |
| Grid L (EW) | 41.999 m | rectangular block east edge |
| Grid M (EW) | 45.671 m | wing west edge |
| Grid Y (EW) | 87.472 m | wing east edge |
| Grid 8 (NS) | 5.885 m | confirmed against constants file |
| Grid 9 (NS) | 0.000 m | origin |
| Grid 1 (NS) | 40.830 m | rectangular block north edge |
| Grid 10 (NS) | 14.819 m | wing north edge |
| Grid 19 (NS) | −30.088 m | wing south edge (disputed — see §4.2) |
| Wing angle | 27.16° | tan = 0.5131 |
| CL angle | 13.58° | tan = 0.2416 |
| P1 elevation | −4.650 m | parking level 1 |
| Ground elevation | 0.000 m | datum |
| Floor 2 elevation | +4.000 m | |
| Floor 3 elevation | +7.600 m | |
| MPH elevation | +11.700 m | |
| Roof elevation | +15.800 m | |

---

## 6. Development Notes

- **Never hardcode values outside `moorings-grid-constants.ts`** — all geometric constants belong there with named anchors and comments.
- **After any server-side change:** restart the `artifacts/estimatorpro: web` workflow, then use `forceRefresh: true` on the next BIM API call to bust server cache.
- **DB double-escaping:** The `geometry` column stores JSON as a double-escaped string. Use raw text extraction (`::text`), not JSONB operators (`->`), when querying geometry directly in SQL.
- **IR pipeline is ready:** All 13 pipeline files are present in v16 under `server/pipeline/`. Use `parameter-resolver.ts` to convert grid references to absolute coordinates — do not ask Claude for absolute x,y values.
- **Claude API key:** stored as `ANTHROPIC_API_KEY` secret.
- **JWT secret:** stored as `JWT_SECRET` secret.
- **Admin credentials:** `admin` / `Admin123!` (dev only — change before production).
