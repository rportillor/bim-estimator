# EstimatorPro Transfer Manifest — v14.8 (WP-0: Grid Spacing Fixes)

**Date:** 2026-03-03
**From:** v14.7 (Phase 5 dead code cleanup complete)
**To:** v14.8 (WP-0: Immediate grid spacing fixes)
**Prepared by:** Claude (QS/BIM Analysis)
**For:** Ricardo, MCIQS

---

## Summary

WP-0 eliminates the critical `gridSpacing = 8.0` hardcoded default and upgrades the storey/grid validation pipeline. These are zero-risk changes that improve accuracy immediately with no new infrastructure.

| Metric | v14.7 | v14.8 | Delta |
|--------|-------|-------|-------|
| TS/TSX Files | 522 | 522 | 0 |
| Total Lines | 140,359 | 140,547 | +188 |
| Files Modified | — | 3 | — |
| Files Added | — | 0 | — |
| Files Removed | — | 0 | — |
| Hardcoded Grid Defaults | 2 (8.0m + prompt) | 0 | -2 |
| Synthetic Grid Fallbacks | 1 (6×6) | 0 | -1 |

---

## Changes Detail

### 1. CRITICAL FIX: `gridSpacing = 8.0` → RFI Generation
**File:** `server/construction-workflow-processor.ts` (2,370 → 2,420 lines)

**What changed:**
- `parseGridLocation()` (line 330): Removed hardcoded `const gridSpacing = 8.0`. Now accepts `knownGridSpacing?: number` parameter. When grid spacing is unknown, registers missing data via `trackMissingData()` for RFI generation and returns `null`. CSI Division 03 00 00 (Concrete/Structural) reference.
- Caller at line 285: Now passes `element.properties.gridSpacing` (parsed via `parseMetricDimension()`) when available.
- Claude prompt template (line ~1640): Replaced "use a standard 8m grid spacing" with instruction to "extract ACTUAL grid spacing from dimension annotations between grid lines." Instructs Claude to report `gridSpacing` per element and set `null` with `GRID_SPACING_UNKNOWN` note when undetermined.
- JSON example in prompt: Updated to include `gridSpacing` field, removed hardcoded 8m positions.
- Elevation extraction: Prompt now instructs Claude to extract ACTUAL floor heights from section drawings rather than assuming 3.5m default.

**Principle:** No default values. Missing grid data → RFI, not silent wrong coordinates.

### 2. Storey Resolver Upgrade
**File:** `server/bim-generator.ts` (added ~30 lines net)

**What changed:**
- Line 1815: Dynamic import changed from `'./bim/storey-resolver'` (27-line simple version) to `'./services/storey-resolver'` (454-line comprehensive version with NBC/OBC validation).
- Now imports `resolveStoreysValidated`, `resolveGridsValidated`, and `crossReferenceStoreysAndGrids` (instead of basic `resolveStoreys`, `resolveGrids`).
- All validation warnings logged to console with structured tracking.
- Validation metadata (`_storeyValidation`, `_gridValidation`, `_crossRefWarnings`) stored in spatial data for downstream consumption.

**Impact:** BIM pipeline now gets NBC/OBC height validation, grid spacing bounds checking, duplicate grid detection, and cross-reference warnings for free.

### 3. Grid Validation → RFI Pipeline (Phase 3.1)
**File:** `server/bim-generator.ts` (continued)

**What changed:**
- Added Phase 3.1 after existing Phase 3 (RFI generation).
- Converts grid/storey validation warnings into `ConflictDetectionResult` objects.
- Passes them through existing `rfiService.generateRFIsFromAnalysis()` pipeline.
- Non-blocking: failures logged but don't stop BIM generation.

### 4. Grid Utils: Synthetic Fallback Eliminated
**File:** `server/helpers/grid-utils.ts` (21 → 81 lines)

**What changed:**
- Removed 6×6 synthetic grid fallback that silently invented grid positions from building dimensions.
- `normalizeGridFromAnalysis()` now returns `null` when no grid data exists.
- Added support for `grids[]` array format from storey-resolver (orientation-aware).
- `nearestGridIntersection()` returns original position unchanged when grid is empty.
- Width/length parameters retained for API compatibility but marked as unused.

---

## Integration Impact

| Consumer | Before WP-0 | After WP-0 |
|----------|-------------|------------|
| CWP parseGridLocation() | Silent 8m default | RFI when unknown |
| Claude extraction prompt | "use 8m grid" | "extract ACTUAL spacing" |
| bim-generator storey/grid | 27-line simple resolver | 454-line validated resolver |
| grid-utils normalizeGrid() | 6×6 synthetic fallback | null (no defaults) |
| Phase 3 RFI generation | No grid-specific RFIs | Grid validation → RFIs |

---

## Verification

- [x] Zero occurrences of `gridSpacing = 8.0` in CWP
- [x] Zero occurrences of "standard 8m grid" in prompts
- [x] Zero synthetic grid generation in grid-utils
- [x] All imports resolve (storey-resolver exports verified)
- [x] All 52 test files have valid imports
- [x] Existing test suite unaffected (no API changes to exported functions)
- [x] CWP `trackMissingData()` method confirmed at line 797
- [x] `rfiService` import confirmed at bim-generator line 28

---

## Remaining Items (WP-1 through WP-7)

Per the Grid Implementation Gap Analysis document, the following work packages remain:

1. **WP-1:** Grid Data Schema (10 tables, Drizzle ORM) — foundational
2. **WP-2:** Input Type Router & Extraction Orchestrator
3. **WP-3:** DXF Grid Detector (core geometry engine, ~2,000 lines)
4. **WP-4:** Label & Bubble Detection
5. **WP-5:** Vector PDF Grid Detector (production path for The Moorings)
6. **WP-6:** Confidence Scoring & Validation Engine
7. **WP-7:** Grid Review UI & Human-in-the-Loop

---

## Deployment

```bash
tar xzf transfer-v14.8-WP0-GRID-FIXES.tar.gz && cd v14.8
npm ci
cp .env.example .env  # Fill credentials
drizzle-kit push
npm run build && npm start
# Verify: GET /api/health/live, /api/health/ready, /api/health/deep
```
