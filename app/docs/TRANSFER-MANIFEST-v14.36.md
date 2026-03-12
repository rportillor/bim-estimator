# EstimatorPro v14.36 — Transfer Manifest

## Version
v14.36 — Dead Code Elimination Phase 5

## Archive
`EstimatorPro-v14.36-FULL-DEPLOY.tar.gz`  
Extract: `tar xzf EstimatorPro-v14.36-FULL-DEPLOY.tar.gz --strip-components=1`  
Files: 582 total | Source .ts/.tsx: 467

## Changes from v14.35

### Issue Tracker — Closed This Session

| ID | Issue | Status |
|---|---|---|
| WP-4 | Register raster-grid-extractor in orchestrator | **ALREADY DONE** — confirmed in routes.ts L1940 |
| WP-5 | Register pdf-grid-extractor in orchestrator | **ALREADY DONE** — confirmed in routes.ts L1937 |
| DC-1 | bim-coordination/document-control-register.ts — truncated, zero consumers, sole TS compile error | **CLOSED — DELETED** |
| DC-2 | bim-coordination/clash-engine.ts — superseded by spatial-clash-engine.ts, zero consumers | **CLOSED — DELETED** |
| DC-3 | bim-coordination/naming-convention.ts — zero consumers | **CLOSED — DELETED** |
| DC-4 | bim-coordination/selection-sets.ts — zero consumers | **CLOSED — DELETED** |
| DC-5 | server/routes/documents.ts — never registered in routes.ts, duplicate functionality | **CLOSED — DELETED** |
| DC-6 | server/helpers/estimator.ts + cost-catalog.ts + qto.ts — dead island, superseded by server/estimator/estimate-engine.ts | **CLOSED — DELETED** |
| DC-7 | client/components/documents/DocumentRevisionHistory.tsx — zero consumers | **CLOSED — DELETED** |
| DC-8 | client/components/documents/DocumentComparison.tsx — zero consumers | **CLOSED — DELETED** |
| DC-9 | client/components/bim-coordination/index.ts — barrel re-export never imported (lazy imports used directly) | **CLOSED — DELETED** |

### Files Deleted (11 files, 2,744 lines removed)

| File | Lines | Reason |
|---|---|---|
| `server/bim-coordination/clash-engine.ts` | 649 | Superseded by `services/spatial-clash-engine.ts` |
| `server/bim-coordination/document-control-register.ts` | 341 | Truncated file, zero consumers, **sole TS compile error** |
| `server/bim-coordination/naming-convention.ts` | 483 | Zero consumers |
| `server/bim-coordination/selection-sets.ts` | 412 | Zero consumers |
| `server/routes/documents.ts` | 36 | Never registered in routes.ts |
| `server/helpers/estimator.ts` | 108 | Dead island — superseded by `server/estimator/estimate-engine.ts` |
| `server/helpers/cost-catalog.ts` | 30 | Only consumer was helpers/estimator.ts (now deleted) |
| `server/helpers/qto.ts` | 72 | Only consumer was helpers/estimator.ts (now deleted) |
| `client/src/components/documents/DocumentRevisionHistory.tsx` | 310 | Zero consumers anywhere |
| `client/src/components/documents/DocumentComparison.tsx` | 291 | Zero consumers anywhere |
| `client/src/components/bim-coordination/index.ts` | 12 | Barrel export; bim-coordination.tsx uses lazy() direct imports |

### Files Kept (verified LIVE)

| File | Reason Live |
|---|---|
| `server/bim-coordination/types.ts` | Imported by `services/qto-qa-engine.ts` |
| `server/helpers/bim-converter.ts` etc. | All verified via grep — consumed |
| `server/services/pdf-grid-extractor.ts` | Side-effect import in routes.ts L1937 |
| `server/services/raster-grid-extractor.ts` | Side-effect import in routes.ts L1940 |
| `server/services/grid-detection-profiles.ts` | Lazy-imported by routes/grid-detection.ts L234,265,277 |
| `client/src/components/ui/*` (shadcn) | Standard UI library — kept as installed |

### TypeScript Status
- **Before this session**: 1 source error (`bim-coordination/document-control-register.ts:342 — '*/' expected`)
- **After this session**: 0 source errors
- Ambient errors for `@types/jest`, `@types/node`, `vite/client` are environment-only (node_modules not installed in build environment); these resolve on `npm install`

### Critical Files — Unchanged (regression guard)

| File | Expected lines | Status |
|---|---|---|
| `server/estimator/estimate-engine.ts` | 1,683 | ✅ |
| `server/estimator/ontario-mep-rates.ts` | 1,063 | ✅ |
| `server/estimator/boe-generator.ts` | 1,121 | ✅ |
| `server/routes/qs-level5-routes.ts` | 775 | ✅ |
| `server/routes.ts` | 5,365 | ✅ |
| `server/storage.ts` | 1,688 | ✅ |
| `shared/schema.ts` | 1,981 | ✅ |
| `server/index.ts` | 279 | ✅ |

## Deployment

```bash
tar xzf EstimatorPro-v14.36-FULL-DEPLOY.tar.gz --strip-components=1
npm run db:push    # H-1: REQUIRED — 127 PostgreSQL tables
npm start          # port 5000
```

## Open Items Remaining

| ID | Item | Blocking? |
|---|---|---|
| H-1 | `npm run db:push` in Replit shell | YES — must run before first use |
| M-6 | Live smoke test with Moorings drawings | NO — QA validation |

**All code-level issues are now closed.** The codebase has zero source TypeScript errors, zero hardcoded project-specific values in runtime paths, zero dead code islands, and all grid detection extractors are registered.

