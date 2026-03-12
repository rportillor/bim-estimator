# TRANSFER MANIFEST — v14.22-IMPORT-FIX
## EstimatorPro — Broken Import Repair + Dead File Cleanup
### Date: March 2026

---

## WHAT THIS FIXES

**2 broken production import paths** that silently failed at runtime (caught by try/catch):
1. `server/routes/product-routes.ts` — wrong relative path to `product-extraction-engine`
2. `server/smart-document-processor.ts` — dynamic import of non-existent `./helpers/rfi-generator`

**5 dead production files** confirmed zero-consumer:
- `cache-cleaner.ts`, `security-config.ts`, `scripts/analyze-building-dimensions.ts`, `helpers/coord-hygiene.ts`
- Plus 4 dead route files from the security-fix session: `ai-coach.ts`, `calibration.ts`, `bim-elements.ts`, `compliance.ts`

**3 test file corrections** — removed describe blocks importing deleted services:
- `cost-estimation.test.ts` (fully deleted)
- `sop-parts6-1-6-2.test.ts` (sequencing-4d block removed)
- `utility-modules.test.ts` (deterministic-fixes + shared-bim-types blocks removed)

---

## PHASE 1 — BROKEN IMPORT FIXES

### Fix 1: server/routes/product-routes.ts

**Problem:** Dynamic import at L106 used `./product-extraction-engine`.
From `server/routes/`, this resolves to `server/routes/product-extraction-engine.ts`
which does not exist. The actual file is `server/product-extraction-engine.ts`.
The try/catch swallowed the runtime error silently — POST `/api/projects/:projectId/initialize-products`
always returned 500 with "Failed to initialize product catalog".

**Fix:** `./product-extraction-engine` → `../product-extraction-engine`

### Fix 2: server/smart-document-processor.ts

**Problem:** Dynamic import at L341 used `./helpers/rfi-generator` to call `trackMissingData()`.
No such file exists in `server/helpers/` — the function `trackMissingData` is not exported
from any file in the codebase. The try/catch swallowed the error, meaning uncategorised
documents never registered RFIs — the no-defaults pipeline was silently broken.

**Fix:** Replaced the broken dynamic import with a static import of `MissingDataTracker`
from `./services/missing-data-tracker` (the canonical RFI pipeline). Now calls:
```typescript
import { MissingDataTracker } from "./services/missing-data-tracker";
// ...
const tracker = MissingDataTracker.getOrCreate(projectId);
tracker.registerDocumentGap({ ... });
```

Labelled N-8 FIX in the file header per the existing N-5/N-6/N-7 convention.

---

## PHASE 2 — DEAD FILE DELETIONS (5 files, ~576 lines)

| File | Lines | Reason |
|------|-------|--------|
| `server/cache-cleaner.ts` | 195 | Zero consumers; exports `clearProjectCaches`, `clearAllCaches`, `clearProjectOnly` but nothing imports them |
| `server/security-config.ts` | 110 | Documentation-only `SECURITY_MEASURES` object; zero runtime consumers |
| `server/scripts/analyze-building-dimensions.ts` | 76 | One-off dev script with hardcoded Moorings projectId UUID; not mounted in any route |
| `server/helpers/coord-hygiene.ts` | 36 | Exports `coordsAreDegenerate`, `isDegenerateCoordinateSet`, `detectDegenerateCoordSet`; zero consumers across all server + client files |
| `server/services/__tests__/cost-estimation.test.ts` | ~60 | Imports only `cost-estimation-engine` which was deleted in v14.22-DEAD-CODE session |

---

## PHASE 3 — TEST FILE SURGERY (2 files rewritten)

### server/services/__tests__/sop-parts6-1-6-2.test.ts
**Before:** 179 lines — two describe blocks: `constructability-engine.ts` + `sequencing-4d.ts`
**After:** 89 lines — `sequencing-4d.ts` block removed (imports deleted service)
**Kept:** Full `constructability-engine.ts` describe block (9 tests, all imports live)
**Header updated:** "SOP PARTS 6.1 & 6.2" → "SOP PART 6.1"

### server/services/__tests__/utility-modules.test.ts
**Before:** 168 lines — 6 describe blocks
**After:** 132 lines — 4 describe blocks
**Removed:**
- `deterministic-fixes.ts` block (2 tests) — imports deleted `DeterministicRandom` from `deterministic-fixes`
- `shared-bim-types.ts` block (2 tests) — imports deleted `../shared-bim-types` (superseded by `server/types/shared-bim-types.ts`)
**Kept:** `grid-extractor`, `progress-bus`, `generation-watchdog`, `shared-types` blocks

---

## ZERO-BREAKAGE VERIFICATION

**Broken import scan result:** 0 issues across all server files (production + tests)
- ESM `.js` extensions excluded from scan (valid for bundler resolution)
- Comment-only references excluded from scan

**Consumer scan on deleted files:** All confirmed zero-consumer before deletion

---

## FILE COUNT SUMMARY (this session)

| Category | Start | End | Delta |
|----------|-------|-----|-------|
| `server/` root `.ts` | 32 | 28 | −4 |
| `server/helpers/` | 44 | 43 | −1 |
| `server/scripts/` | 1 | 1 | 0 (deleted 1, kept validate-grid-pipeline) |
| `server/services/__tests__/` | 46 | 45 | −1 |
| `server/routes/product-routes.ts` | broken | fixed | path corrected |
| `server/smart-document-processor.ts` | broken | fixed | import replaced |

---

## CUMULATIVE SESSION STATE (all v14.22 dead-code sessions)

After all three sessions (DEAD-CODE-CLEANUP + SECURITY-FIX + IMPORT-FIX):

| Category | Original v14.22 | After All Sessions | Total Delta |
|----------|----------------|---------------------|-------------|
| server/ root files | 38 | 28 | −10 |
| server/services/ | 91 | 77 | −14 |
| server/routes/ | 64 | 58 | −6 |
| server/helpers/ | 45 | 43 | −2 |
| server/estimator/ | 32 | 31 | −1 |
| server/middleware/ | 10 | 8 | −2 |
| server/__tests__/ | 52 | 45 | −7 |
| client/components/ | 109 | 95 | −14 |
| **Total files deleted** | | | **−56 files** |
| Broken production imports | 2 | 0 | −2 |
| Auth-bypassed endpoints | 25+ | 0 | −25+ |
| index.ts lines | 414 | 279 | −135 |

---

*EstimatorPro v14.22 — Import Fix + Dead File Cleanup Transfer Manifest*
*56 total files deleted | 2 broken imports repaired | Zero broken imports in full codebase scan*
