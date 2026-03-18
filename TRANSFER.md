# EstimatorPro — Transfer Document
**Project:** The Moorings (Cameron Lake, Ontario)  
**System:** EstimatorPro v16 — AI-powered Construction BIM  
**Active BIM Model:** `41fc242e-300c-490d-849c-2e897757534f`  
**Active Project:** `262dea72-aafd-4ba8-96b0-78bbc2335c62`  
**Date:** March 18, 2026  

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
  estimatorpro/          ← main app (web + server in one artifact)
    client/src/
      components/bim/
        viewer-3d.tsx             ← 3D BIM viewer (Three.js)
        moorings-grid-constants.ts ← ALL 47 gridlines hardcoded
        bim-viewer.tsx            ← wrapper / UI shell
    server/
      routes/bim-generate.ts      ← /generate, /extract-layer endpoints
      real-qto-processor.ts       ← Claude AI + PDF pipeline
      utils/gridline-pdf-parser.ts ← PDF spatial parser for gridlines
  api-server/            ← (separate API artifact, not currently used by BIM)
```

**Geometry conventions (critical — do not change):**
- EW axis = Three.js **X**; NS axis = Three.js **Z** (positive = North); Elevation = Three.js **Y**
- Coordinate origin: Grid A / Grid 9 intersection = `(0, 0, 0)`
- Wing angle: **27.16°** (tan ≈ 0.5131) — applies to grids M–Y and 10–19
- Centreline angle: **13.58°** (tan ≈ 0.2416) — applies to CLa / CL / CLb
- **Correct gridline formula:**
  - axis='X' (EW): `pt1 = (coord + start_m·tanA, Y, start_m)` → `pt2 = (coord + end_m·tanA, Y, end_m)`
  - axis='Y' (NS): `pt1 = (start_m, Y, coord)` → `pt2 = (end_m, Y, coord − (end_m − start_m)·tanA)`

---

## 2. Issues Fixed (Completed)

### 2.1 Wrong 3D gridline formula (sin/cos → tan)
**Problem:** Gridlines A–L (EW) and 1–9 (NS) rendered as diagonals instead of straight lines, and wing gridlines M–Y / 10–19 were incorrectly positioned.  
**Root cause:** Formula used `sin` and `cos` to offset points, producing a circular arc projection instead of a planar shear.  
**Fix:** Replaced with `tan`-based formula — both `pt1` and `pt2` receive the same angular shear. See `moorings-grid-constants.ts` and `viewer-3d.tsx`.

### 2.2 DB-driven gridline rendering replaced with constants
**Problem:** Gridlines depended on a fragile chain: PDF parser → Claude AI → DB insert → query. Any failure in that chain left the viewer with no grid.  
**Fix:** Created `moorings-grid-constants.ts` with all 47 gridlines hardcoded directly from PDF dimension annotations. The viewer now reads from this file only — zero DB/AI dependency for gridlines.

### 2.3 Heuristic analysis-grid fallback removed
**Problem:** A heuristic fallback drew a rough grid from wall/column X-Z positions when no `grid_line` elements were in the DB. It was geometrically wrong and conflicted with the real grid.  
**Fix:** Removed entirely. The static constants renderer runs unconditionally on every floor load.

### 2.4 Duplicate gridline rendering
**Problem:** Both the element loop (DB) and the fallback block were rendering grids simultaneously, doubling lines.  
**Fix:** DB `grid_line` element type now hits `continue` in the element loop. Static renderer is the sole source of grid geometry.

### 2.5 Fast Refresh export conflict
**Problem:** `viewer-3d.tsx` exported both a named function and a `const` on the same name, breaking Vite HMR with a "Fast Refresh only works when a file has exports" warning.  
**Fix:** Consolidated to a single default export.

### 2.6 BIM viewer layout (right panel → bottom panel)
**Problem:** The properties panel was on the right side, consuming horizontal space and compressing the 3D viewport on typical monitors.  
**Fix:** Panel moved to a collapsible bottom drawer. The 3D canvas now uses the full viewport width.

### 2.7 QTO batch caching
**Problem:** Every QTO (Quantity Take-Off) table refresh re-invoked the Claude API at full cost, even when the underlying PDF hadn't changed.  
**Fix:** Added a server-side batch cache keyed on (modelId + floorLevel + elementType). Cache TTL configurable; invalidated on force-refresh.

### 2.8 Extract-layer endpoint
**Problem:** No way to extract only one floor or one element type at a time — every extraction re-processed the entire PDF.  
**Fix:** Added `/api/bim/models/:modelId/extract-layer` POST endpoint. Accepts `{ floorLevel, elementType, forceRefresh }`. Used by the UI floor-selector.

### 2.9 PDF spatial parser (gridlines v4 → v6e)
**Problem:** First-generation gridline extraction relied on text-position heuristics that failed on rotated/skewed annotation text in The Moorings PDF.  
**Fix:** Iteratively rewrote the spatial parser (v4 through v6e), ultimately using PDF operator-stream analysis to find dimension leader lines and match them to grid bubble text. All 47 gridlines now extract correctly.

---

## 3. Issues Currently In Progress

### 3.1 Visual verification of all 47 gridlines in browser ← **ACTIVE**
**Status:** Static renderer is in place and Vite has hot-reloaded the code. A screenshot/browser test has not yet been performed to confirm all 47 lines appear correctly in the 3D viewport.  
**Next step:** Load the BIM viewer for P1 floor, take screenshot, verify line count, colours (EW=orange, NS=yellow, angled=magenta), and label positions.

### 3.2 Building-element ↔ grid coordinate alignment
**Status:** The 3D elements (walls, columns, slabs) are extracted from the PDF and stored in DB with real-world coordinates. The gridlines use a separate coordinate system anchored at A/9=(0,0,0). These two systems need to be confirmed as co-registered — i.e., a column at grid intersection B/8 should visually sit on the B and 8 grid lines.  
**Next step:** After gridline visual passes, pick a known column (e.g., column at B/8) and confirm its rendered position vs. the grid intersection.

---

## 4. Issues Remaining (Not Yet Started)

### 4.1 Ground floor BIM extraction
**Status:** Only P1 (Parking Level 1) has been extracted and verified. Ground floor PDF layer has not been processed.  
**Work needed:** Run `/extract-layer` for `floorLevel=Ground` across all element types (walls, columns, slabs, beams, stairs). Verify element counts against structural drawings.

### 4.2 Upper floors: Floor 2, Floor 3, MPH, Roof
**Status:** Not extracted.  
**Work needed:** Same pipeline as Ground floor. Floor elevations: Floor 2 = +4.000 m, Floor 3 = +7.600 m, MPH = +11.700 m, Roof = +15.800 m.  
**Known issue:** MPH (Multi-Purpose Hall) and Roof have partial wing geometry — the east and west wing ends terminate at different elevations than the rectangular block.

### 4.3 Grid 19 coordinate discrepancy
**Status:** Known, not fixed.  
**Detail:** Grid 19 (southernmost NS grid) has two different values in the source data:
- From cumulative span dimensions: `−27.552 m`  
- From direct PDF anchor (WING_NS_S): `−30.088 m`  
The constants file uses `−30.088 m` for the M–Y span bounds but `−27.552 m` for the grid 19 line itself. This causes a ~2.5 m mismatch at the south wing corner.  
**Work needed:** Survey the original structural drawing to determine which value is correct, then update the constants file.

### 4.4 Element type coverage gaps
**Status:** The Claude AI pipeline handles walls, columns, and slabs well. The following element types have not been validated:
- Beams (complex — many are embedded in slab depths)
- Stairs and ramps
- Curtain wall / glazing elements
- Mechanical/electrical penetrations  
**Work needed:** Review extraction output for each type; tune prompts or add post-processing rules as needed.

### 4.5 QTO quantity accuracy audit
**Status:** The Quantity Take-Off tables display volumes/areas/lengths derived from AI extraction. No independent verification against manual take-off has been performed.  
**Work needed:** Select 20–30 representative elements across element types; compare QTO quantities against manual measurements from the PDF drawings.

### 4.6 User authentication & multi-project support
**Status:** Admin-only single-user (`admin` / `Admin123!`). Authentication is JWT-based but there is no registration, password reset, or role management.  
**Work needed:** Add project-level access control, user registration, password management. Define roles: Owner, Estimator, Viewer.

### 4.7 Export / reporting
**Status:** No export functionality exists.  
**Work needed:** PDF report export for QTO summaries; CSV/Excel export for quantity tables; IFC or glTF export of the 3D model for use in other BIM tools.

### 4.8 Mobile / tablet responsive layout
**Status:** The BIM viewer is not usable on screens below ~1200 px wide.  
**Work needed:** Responsive breakpoints for the properties panel; touch-based orbit controls for the Three.js viewport.

### 4.9 Performance — large model loading
**Status:** The full P1 model (all element types) triggers a single `/elements` API call that returns all records at once. On larger floors this could become slow.  
**Work needed:** Paginate or stream elements by type; add progressive rendering (render structural elements first, then finishes).

---

## 5. Key Reference Values

| Constant | Value | Notes |
|---|---|---|
| Grid A (EW origin) | 0.000 m | rectangular block west edge |
| Grid L (EW) | 41.999 m | rectangular block east edge |
| Grid M (EW) | 45.671 m | wing west edge |
| Grid Y (EW) | 87.472 m | wing east edge |
| Grid 1 (NS) | 40.830 m | rectangular block north edge |
| Grid 9 (NS) | 0.000 m | origin |
| Grid 10 (NS) | 14.819 m | wing north edge |
| Grid 19 (NS) | −30.088 m | wing south edge (disputed, see §4.3) |
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
- **After any server-side change:** restart the `artifacts/estimatorpro: web` workflow, then use `forceRefresh: true` in the next BIM API call to bust the server cache.
- **DB double-escaping:** The `geometry` column stores JSON as a double-escaped string. Use raw text extraction (`::text`), not JSONB operators (`->`), when querying geometry directly in SQL.
- **Claude API key:** stored as `ANTHROPIC_API_KEY` secret. Never log or expose.
- **JWT secret:** stored as `JWT_SECRET` secret.
- **GitHub token:** stored as `GITHUB_TOKEN` secret.
- **Admin credentials:** `admin` / `Admin123!` (dev only — change before any production deployment).
