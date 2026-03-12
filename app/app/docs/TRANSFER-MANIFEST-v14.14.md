# EstimatorPro Transfer Manifest — v14.14

**Date:** 2026-03-06  
**From:** v14.13 → v14.14  
**Prepared by:** Claude (QS/BIM Analysis)  
**For:** Ricardo, MCIQS

---

## Cumulative (v14.7 → v14.14)

| Metric | v14.7 | v14.14 | Delta |
|--------|-------|--------|-------|
| TS/TSX Files | 522 | 533 | +11 |
| Total Lines | 140,359 | 149,919 | +9,560 |
| API Endpoints | (existing) | +17 grid detection | +17 |
| Named Profiles | 0 | 5 | +5 |
| E2E Tests | 0 | 35 | +35 |

---

## 5 Items Delivered (v14.13 → v14.14)

### Item 1: Dead Code — Broken Test Cleanup
- Deleted `comprehensive-grid-analysis.test.ts` and `extract-true-grids.test.ts` (importing deleted modules)
- **Net: -56 lines, -2 files**

### Item 2: Live Deployment Validation Script
- `server/scripts/validate-grid-pipeline.ts` (281 lines) — 8-check validation runner
- `POST /api/grid-detection/validate-pipeline` endpoint
- Checks: system status, documents, detection execution, result quality, validation grade, consumer bridge, storage persistence, API routes
- Outputs structured report with PASS/FAIL/WARN per check + production readiness recommendation

### Item 3: v14.6 Remaining Integration Wiring
- Added missing `<Route path="/projects/:projectId/bim-coordination">` to App.tsx
- All 3 routers, 2 pages, and graceful shutdown now fully wired

### Item 4: Estimate Engine Grid Traceability
- `EstimateLineItem.gridRef?: string` — grid reference field on every BOQ line item
- `enrichElementsWithGridRefs(elements, projectId)` — async pre-processor resolves element positions to nearest detected grid intersection labels
- `pushItem()` accepts and passes through `gridRef` parameter
- Main estimation loop extracts gridRef from element properties
- **Every BOQ line item now traceable to a grid intersection (e.g., "Column at A-3")**

### Item 5: Real-World QA — Detection Parameter Profiles
- `server/services/grid-detection-profiles.ts` (269 lines)
- 5 named profiles: `canadian-commercial` (default), `canadian-residential`, `industrial`, `imperial`, `the-moorings`
- 7 tunable parameters with descriptions, ranges, and tuning advice
- Environment variable overrides (GRID_ANGLE_EPS_DEG, GRID_OFFSET_TOL_MM, etc.)
- `GET /api/grid-detection/profiles` — list available profiles
- `GET /api/grid-detection/tuning-guide` — parameter descriptions and ranges
- `POST /api/grid-detection/detect` — now accepts `profile` parameter

---

## Complete API Endpoint Inventory (17 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| GET | /runs/:projectId | List detection runs |
| GET | /run/:runId | Run details |
| GET | /run/:runId/full | Full grid hierarchy |
| GET | /run/:runId/stats | Dashboard statistics |
| GET | /run/:runId/needs-review | Review queue |
| PUT | /axis/:axisId/status | Confirm/reject axis |
| PUT | /axis-label/:id/status | Confirm/reject label |
| GET | /project/:projectId/system | Grid system for CWP |
| GET | /transforms/:projectId | Coordinate transforms |
| POST | /detect | Trigger detection (with profile) |
| GET | /status | System capabilities |
| GET | /project/:projectId/spacing | Grid spacing for CWP |
| POST | /validate-pipeline | Live validation |
| GET | /profiles | Available profiles |
| GET | /tuning-guide | Parameter tuning guide |

---

## Deployment

```bash
tar xzf transfer-v14.14-COMPLETE.tar.gz && cd v14.14
npm ci && cp .env.example .env
drizzle-kit push
npm run build && npm start

# Live validation:
curl -X POST /api/grid-detection/validate-pipeline \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<id>"}'

# Detection with profile:
curl -X POST /api/grid-detection/detect \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<id>","sourceFileId":"<id>","filename":"S1.01.pdf","storageKey":"<key>","profile":"the-moorings"}'

# Tuning guide:
curl /api/grid-detection/tuning-guide
```
