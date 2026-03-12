# EstimatorPro Transfer Manifest — v14.15

**Date:** 2026-03-06  
**From:** v14.14 → v14.15  
**Prepared by:** Claude (QS/BIM Analysis)  
**For:** Ricardo, MCIQS

---

## Cumulative (v14.7 → v14.15)

| Metric | v14.7 | v14.15 | Delta |
|--------|-------|--------|-------|
| TS/TSX Files | 522 | 531 | +9 |
| Total Lines | 140,359 | 148,239 | +7,880 |
| Dead Code Removed (cumulative) | — | 2,001 lines / 7 files | — |

---

## 3 Items Delivered (v14.14 → v14.15)

### Item 1: Routes.ts Mock Data Cleanup — 287 lines removed

Deleted the entire deprecated `runComprehensiveAnalysis()` function (lines 5636-5922):
- Hardcoded BOQ items ("Concrete Foundation - 30 MPa", "Structural Steel Beams - Grade 350W", "Masonry Block Wall - 200mm CMU", "Gypsum Board Partition System")
- Mock 6-stage analysis pipeline (Text Extraction → Table Extraction → BoQ Generation → OCR → AI → Finalize) with `setTimeout` simulations
- `analysisProgress` Map and `runningAnalyses` Set (zero consumers)
- `getAnalysisProgress()` and `getRunningAnalyses()` helper functions (zero consumers)
- Already marked `DEPRECATED` with `CRITICAL DUPLICATE SOURCE` warnings

**routes.ts: 5,922 → 5,635 lines**

### Item 2: Dead Viewer Files — 1,416 lines removed, 2 files deleted

| File | Lines | Consumers | Action |
|------|-------|-----------|--------|
| `bim-3d-viewer.tsx` | 484 | 0 | **DELETED** — Three.js viewer superseded by viewer-3d.tsx |
| `hybrid-3d-viewer.tsx` | 932 | 0 | **DELETED** — Hybrid viewer superseded by viewer-3d.tsx |
| `bim-viewer.tsx` | 72 | 1 (bim.tsx) | **KEPT** — Active wrapper combining Viewer3D + ModelProperties |
| `viewer-3d.tsx` | 1,194 | 3 | **KEPT** — The production 3D viewer |

### Item 3: Full Pipeline Grid→BIM→BOQ Wiring

**`buildEstimateForModel()` now calls `enrichElementsWithGridRefs()`:**
- Resolves projectId from model → project chain
- Calls `enrichElementsWithGridRefs(elements, projectId)` before estimation
- Non-blocking: grid enrichment failure doesn't stop estimation

**Grid reference stamping in estimation loop:**
- `lineCountBefore` tracks line items before each element's classification
- After classification, stamps `gridRef` on all newly-pushed line items
- Every BOQ line item for a structural element (column, beam, wall, slab) now carries its detected grid reference (e.g., "A-3")

**Complete pipeline flow:**
```
Upload drawings → documents table
  ↓
BIM generation → Phase 3.2: grid detection (auto)
  ↓                → Phase 3.3: validation → RFIs
  ↓
Grid schema ← 10 tables populated with detected geometry
  ↓
Element placement ← CWP, structural-seed, QTO use detected grid
  ↓
BOQ estimation ← enrichElementsWithGridRefs() stamps grid refs
  ↓
BOQ line items ← each has gridRef: "A-3" with confidence
  ↓
Grid Review UI ← /projects/:id/grid-review (confirm/reject)
```

---

## Dead Code Removed (Cumulative v14.7 → v14.15)

| Version | File | Lines | Reason |
|---------|------|-------|--------|
| v14.13 | `extract-real-grids.ts` | 226 | Zero consumers, hardcoded spacings |
| v14.13 | `comprehensive-grid-analysis.test.ts` | ~28 | Imported deleted module |
| v14.13 | `extract-true-grids.test.ts` | ~28 | Imported deleted module |
| v14.15 | `routes.ts` mock pipeline | 287 | Deprecated, hardcoded BOQ items |
| v14.15 | `bim-3d-viewer.tsx` | 484 | Zero consumers, superseded |
| v14.15 | `hybrid-3d-viewer.tsx` | 932 | Zero consumers, superseded |
| | **Total removed** | **~2,001** | |

---

## Deployment

```bash
tar xzf transfer-v14.15-COMPLETE.tar.gz && cd v14.15
npm ci && cp .env.example .env
drizzle-kit push
npm run build && npm start
```
