# EstimatorPro Transfer Manifest — v14.13 (Dead Code + Validation + Integration Tests)

**Date:** 2026-03-06  
**From:** v14.12 → v14.13  
**Prepared by:** Claude (QS/BIM Analysis)  
**For:** Ricardo, MCIQS

---

## Cumulative (v14.7 → v14.13)

| Metric | v14.7 | v14.13 | Delta |
|--------|-------|--------|-------|
| TS/TSX Files | 522 | 533 | +11 |
| Total Lines | 140,359 | 149,313 | +8,954 |
| Dead Code Removed | — | 226 lines (1 file) | -226 |
| E2E Tests | 0 | 25 (pipeline) + 10 (integration) | +35 |
| Hardcoded Defaults | 5 | 0 | -5 |

---

## Step 1: Dead Code Sweep

### Deleted: `server/extract-real-grids.ts` (226 lines)
Zero consumers. Legacy Claude-based grid extraction script with hardcoded spacings. Superseded by WP-3/WP-5 geometry pipeline.

### Kept (with justification):
- `server/helpers/grid-detect.ts` (46 lines) — 2 active consumers (`bim-postprocess.ts`, `layout-repair.ts`). Detects grids from BIM element positions — complementary to drawing-based WP detection. No hardcoded spacings.
- `server/services/grid-extractor.ts` (91 lines) — 1 active consumer (`real-qto-processor.ts`). Parses Claude analysis for grid data. Already BEHIND detected grid in v14.12 wiring. No hardcoded spacings.

### Prompt examples (kept, not defaults):
- `comprehensive-analysis.ts:297` — `"spacing": 6000` in JSON format example for Claude
- `bim-generator.ts:1576` — `[0, 6000, 12000, 18000]` as example coordinates with "ACTUAL" prefix
- `bim-generator.ts:1644` — `"6000" between Grid A and Grid B` as example with "Read the dimension values"
- `ai-processor.ts:956` — `"Dimension: 7500mm"` as format example

All are illustrative examples telling Claude what format to extract, prefixed with "e.g.", "ACTUAL", or "Read the...". Not defaults.

## Step 2: E2E Pipeline Test

### `server/services/__tests__/grid-pipeline-e2e.test.ts` (378 lines) — NEW

25 tests validating the complete grid detection pipeline with a synthetic DXF:

**Test DXF:** 4 vertical (A,B,C,D) × 3 horizontal (1,2,3) grid at 7.2m × 8.4m spacing (mm coordinates), with grid bubbles, labels, wall noise, and a short dimension line.

| Category | Tests | What's Validated |
|----------|-------|-----------------|
| Pipeline | 1 | Success + zero errors |
| Components | 1 | Exactly 1 component, MODEL frame |
| Families | 1 | 2 families (horizontal + vertical) |
| Axes | 3 | Count (6-8), confidence > 0.1, LINE type with endpoints |
| Markers | 2 | Detection count > 0, CIRCLE shape |
| Labels | 3 | Detection count > 0, VECTOR_TEXT source, valid normalized text |
| Associations | 2 | Count > 0, valid 5-component score breakdowns |
| Nodes | 2 | Count > 0 (expect ~12), valid coordinates |
| Node-Axes | 1 | 2 links per intersection |
| FK Refs | 1 | All use index-based temp IDs |
| Transform | 1 | mm→meter with scale ≈ 0.001 |
| Validation | 3 | Valid report, no below-minimum spacing, 2 families pass |
| No Defaults | 1 | No 8000mm or 6000mm in output |
| Noise | 2 | Short line filtered, non-grid text rejected |
| Performance | 1 | Under 10 seconds |

## Step 3: Integration Bridge Test

### `server/services/__tests__/grid-integration-bridge.test.ts` (294 lines) — NEW

10 tests validating consumer bridge functions:

| Category | Tests | What's Validated |
|----------|-------|-----------------|
| Validation Engine | 5 | Good grid → valid report; insufficient families → RFI; no labels → high severity; grade A for high confidence; zero axes → FAILED |
| Issue Conversion | 2 | Severity mapping; RFI filter (only generatesRfi=true) |
| ExtractorResult Format | 2 | FK index refs; required fields present |
| Spacing | 1 | 7.2m within range, no below-minimum flag |

---

## Live Validation with The Moorings

The E2E test validates the complete pipeline with synthetic data that represents a realistic Canadian commercial grid. To validate with actual Moorings drawings:

```bash
# 1. Upload a structural PDF or DXF to the project
# 2. Trigger detection:
curl -X POST /api/grid-detection/detect \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<id>","sourceFileId":"<docId>","filename":"S1.01.pdf","storageKey":"<key>"}'

# 3. Check results:
curl /api/grid-detection/run/<runId>/full
curl /api/grid-detection/run/<runId>/stats

# 4. Review in UI: /projects/<id>/grid-review
```

---

## Deployment

```bash
tar xzf transfer-v14.13-COMPLETE.tar.gz && cd v14.13
npm ci && cp .env.example .env
drizzle-kit push
npm run build && npm start
# Run tests: npx jest grid-pipeline-e2e grid-integration-bridge
```
