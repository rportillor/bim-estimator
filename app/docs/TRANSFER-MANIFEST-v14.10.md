# EstimatorPro Transfer Manifest — v14.10 (WP-6: Confidence Scoring & Validation)

**Date:** 2026-03-06  
**From:** v14.9 → v14.10  
**Prepared by:** Claude (QS/BIM Analysis)  
**For:** Ricardo, MCIQS

---

## Cumulative Summary (v14.7 → v14.10)

| Metric | v14.7 | v14.10 | Delta |
|--------|-------|--------|-------|
| TS/TSX Files | 522 | 529 | +7 |
| Total Lines | 140,359 | 147,516 | +7,157 |
| Schema Tables | (existing) | +10 grid tables | +10 |
| Grid Extractors | 0 | 2 (DXF + PDF) | +2 |
| Validation Rules | 0 | 15 domain/topology/label/confidence | +15 |
| Hardcoded Defaults | 3 | 0 | -3 |

---

## WP History (all included in v14.10)

| WP | Version | Description | Lines |
|----|---------|-------------|-------|
| WP-0 | v14.8 | Hardcode elimination | +188 |
| WP-1 | v14.8 | 10-table schema + storage + API | +1,425 |
| WP-2 | v14.8 | Orchestrator + FK remapping | +862 |
| WP-3 | v14.8 | DXF geometry engine | +1,518 |
| WP-4 | v14.8 | Enhanced label engine | +1,450 |
| WP-5 | v14.9 | Vector PDF extractor | +967 |
| **WP-6** | **v14.10** | **Confidence scoring & validation** | **+747** |

---

## WP-6: Confidence Scoring & Validation Engine (v14.9 → v14.10)

### `server/services/grid-validation-engine.ts` (703 lines) — NEW

Post-extraction validation engine with 4 validation categories and unified confidence model.

**Domain Validation (NBC/OBC):**

| Rule Code | Severity | Description |
|-----------|----------|-------------|
| GRID_SPACING_BELOW_MIN | high | Spacing < 1.0m (NBC minimum) |
| GRID_SPACING_ABOVE_MAX | medium | Spacing > 30.0m (practical maximum) |
| GRID_SPACING_ATYPICAL | info | Outside 3.0–12.0m typical Canadian commercial range |
| GRID_POSSIBLE_MISSING_LINE | medium | Gap at ~2× average spacing → missed intermediate line |

**Topological Validation:**

| Rule Code | Severity | Description |
|-----------|----------|-------------|
| GRID_INSUFFICIENT_FAMILIES | critical/high | < 2 orientation families detected |
| GRID_MANY_FAMILIES | low | > 4 families (possible false positives) |
| GRID_NON_ORTHOGONAL | medium | Primary families not perpendicular (> 5° deviation) |
| GRID_FEW_AXES_IN_FAMILY | medium | Family has < 2 axes |
| GRID_LOW_NODE_COVERAGE | medium | < 50% expected intersections found |

**Label Validation:**

| Rule Code | Severity | Description |
|-----------|----------|-------------|
| GRID_NO_LABELS | high | Zero labels detected → RFI |
| GRID_UNLABELED_AXES | variable | Coverage < 50% → high + RFI |
| GRID_LABELS_NEED_REVIEW | medium/high | > 50% axes need human review |
| GRID_DUPLICATE_LABELS | medium | Same label text on multiple axes |

**Confidence Validation:**

| Rule Code | Severity | Description |
|-----------|----------|-------------|
| GRID_LOW_CONFIDENCE_AXES | medium | Axes below 0.15 threshold |
| GRID_RUN_CONFIDENCE_LOW | critical | Overall run < 25% minimum → RFI |
| GRID_QUALITY_GRADE_LOW | medium/high | Grade D or F |

**Unified Confidence Model:**

```
runConfidence = 0.30 × axisMean
             + 0.15 × familyScore
             + 0.25 × (labelCoverage×0.7 + autoAssignRate×0.3)
             + 0.15 × nodeCoverage × nodeConfidence
             + 0.15 × min(1, axisCount/4)
```

Quality grades: A (≥85%), B (≥70%), C (≥50%), D (≥30%), F (<30%)

**RFI Integration:**  
`issuesToConflictResults()` converts validation issues (where `generatesRfi=true`) to the conflict detection format consumed by `rfi-service.generateRFIsFromAnalysis()`.

### `server/services/grid-detection-orchestrator.ts` (+44 lines → 841 lines)

Pipeline now 8 steps (was 7):
1. Classify → 2. Create run → 3. Load buffer → 4. Get extractor → 5. Extract → **6. Validate & Score** → 7. Persist → 8. Update status

`GridDetectionResult` now includes `validation: ValidationReport | null`.
Final run status now driven by validation's `recommendedStatus` (SUCCESS/PARTIAL/FAILED).

---

## Pipeline Architecture (Complete)

```
POST /api/grid-detection/detect
  │
  ▼
orchestrator.runGridDetection()
  ├── Step 1: classifyInput()
  ├── Step 2: createDetectionRun()
  ├── Step 3: loadFileBuffer()
  ├── Step 4: getExtractorForType()
  ├── Step 5: extractor.extract()
  │     ├── dxf-grid-extractor (DXF/DWG)
  │     └── pdf-grid-extractor (PDF_VECTOR)
  │         └── grid-label-engine (shared)
  │
  ├── Step 6: validateAndScore()  ← NEW (WP-6)
  │     ├── validateDomain()      — NBC/OBC spacing rules
  │     ├── validateTopology()    — families, orthogonality, nodes
  │     ├── validateLabeling()    — coverage, duplicates, review items
  │     ├── computeConfidence()   — weighted aggregation → grade
  │     └── validateConfidence()  — threshold checks
  │
  ├── Step 7: persistExtractorResults()
  └── Step 8: updateDetectionRunStatus()
```

---

## Remaining Work Packages

| WP | Description | Depends On | Estimated Lines |
|----|-------------|------------|-----------------|
| WP-7 | Grid Review UI & Human-in-the-Loop | WP-6 | ~1,000 |

---

## Deployment

```bash
tar xzf transfer-v14.10-COMPLETE.tar.gz && cd v14.10
npm ci && cp .env.example .env
drizzle-kit push
npm run build && npm start
```
