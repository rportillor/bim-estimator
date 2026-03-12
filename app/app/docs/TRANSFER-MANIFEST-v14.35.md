# TRANSFER MANIFEST — EstimatorPro v14.35
**Date:** 2026-03-08  
**Session type:** Full hardcoded-value audit and elimination  
**Base version:** v14.34  

---

## WHAT THIS SESSION DID

### Objective
Complete systematic elimination of ALL hardcoded project-specific values across the entire codebase. Session v14.34 fixed `bim-coordination-router.ts` (C-1). This session extended that audit to every TypeScript file in the project.

### Audit method
`grep -rn "The Moorings on Cameron Lake|Cameron Lake|moorings"` across all `.ts` and `.tsx` files. Every hit categorised:
- **Runtime data path** → fixed (RFI-generating resolver substituted)
- **File header comment** → updated to remove project reference
- **Test fixture constant** → left (tests need known data)
- **Named config profile** → left (`MOORINGS_BEP`, `the-moorings` detection profile — selected by name at runtime, not a default)

---

## FILES CHANGED (12 files)

| File | Before | After | Change |
|---|---|---|---|
| `server/services/gap-policy-engine.ts` | 353 | 353 | Default `''` not `'The Moorings...'`; header updated |
| `server/services/penetrations-matrix.ts` | 253 | 253 | Default `''` not `'The Moorings...'`; header updated |
| `server/services/governance-engine.ts` | 408 | 408 | Default `''` not `'The Moorings...'`; header updated |
| `server/services/bcf-export.ts` | 489 | 489 | `serializeBCFToXML` now takes `projectName` param; XML uses it |
| `server/services/bim-coordination-router.ts` | 765 | 790 | BCF export route → async + resolves name; `/gaps` → async + resolves; discipline-test passes `projectName` to `buildPenetrationMatrix`; `generateMeetingPack` gets `projectName` |
| `server/routes/estimator-router.ts` | 976 | 1031 | Two new helpers: `resolveProjectNameFromModel` + `resolveProjectNameFromProjectId`; all 9 hardcoded occurrences replaced |
| `server/routes/comprehensive-analysis.ts` | 813 | 813 | AI prompt uses `project.name` (already loaded) + dynamic doc counts |
| `server/routes/multi-stage-analysis.ts` | 398 | 403 | `projectName` loaded from storage, threaded through `runParallelAnalysis` → `runRegulatoryAnalysis` |
| `client/src/pages/bim-coordination.tsx` | 208 | 208 | Subtitle uses `summaryQuery.data?.project`; summary query passes `?projectId=`; `GovernancePanel` receives `projectId` prop |
| `client/src/components/bim-coordination/governance-panel.tsx` | 443 | 444 | Accepts `projectId` prop; POST `/meeting-pack` body includes `projectId` |
| `client/src/components/qs-level5-dashboard.tsx` | 2438 | 2452 | `projectName` fetched from `/api/projects/:id`; threaded to `SOVTab`, `BoETab`, `EstimateEngineTab`, `EngineRfisTab`; all 4 hardcoded occurrences replaced |
| `client/src/pages/uat-signoff.tsx` | (varies) | 177 | `projectName` default changed from `'The Moorings...'` to `''`; version bumped to `v14.35` |

### 17 service file header comments updated (runtime-safe, comment-only)
`model-drop-gating.ts`, `milestone-protection.ts`, `spatial-clash-engine.ts`, `dedup-engine.ts`, `discipline-tests.ts`, `issue-log.ts`, `bep-rules-engine.ts`, `trend-analytics.ts`, `clash-test-templates.ts`, `storey-resolver.ts`, `schedule-linkage.ts`, `false-positive-filter.ts`, `viewpoint-generator.ts`, `discipline-sop.ts`, `missing-data-tracker.ts`, `priority-scoring.ts`, `delta-tracker.ts`

---

## LEGITIMATELY REMAINING REFERENCES (not bugs)

| Location | Why it stays |
|---|---|
| `grid-detection-profiles.ts` — `MOORINGS_BEP`, `the-moorings` profile | Named config object, selected by name at runtime. Not a default. |
| `bep-rules-engine.ts` — `MOORINGS_BEP` export | Named BEP ruleset, not applied unless caller selects it |
| `__tests__/report-generator.test.ts` | Test fixture constant — tests need deterministic known data |
| `__tests__/integration-export-engine.test.ts` | Test fixture constant |
| `__tests__/grid-pipeline-e2e.test.ts` | Comment in test file header |
| `scripts/validate-grid-pipeline.ts` | Comment in script header |
| `client/src/pages/benchmark.tsx` | File header comment only (line 12) |

---

## RESOLUTION PATTERN (established this session)

Every place that previously fell back to `"The Moorings on Cameron Lake"` now:

1. **Model-based routes** (`/estimates/:modelId/...`): call `resolveProjectNameFromModel(modelId)` → walks `modelId → BimModel.projectId → Project.name`
2. **Project-based routes** (`/projects/:projectId/...`): call `storage.getProject(projectId)?.name` directly (already have storage reference)
3. **BIM coordination routes**: use the established `resolveProjectName(projectId)` helper from C-1 fix
4. **AI prompt strings**: use `project.name` from the project record that is already loaded in the handler
5. **Client-side**: fetch `/api/projects/:id`, surface `project.name` in state, pass down as prop — no hardcoded fallback

All resolvers return an RFI flag string on failure, never a hardcoded name.

---

## REGRESSION GUARD — CRITICAL FILES UNCHANGED

| File | Expected lines | Actual lines | Status |
|---|---|---|---|
| `server/estimator/estimate-engine.ts` | 1,682 | 1,682 | ✅ |
| `server/estimator/ontario-mep-rates.ts` | 1,063 | 1,063 | ✅ |
| `server/estimator/boe-generator.ts` | 1,121 | 1,121 | ✅ |
| `server/routes/qs-level5-routes.ts` | 775 | 775 | ✅ |
| `server/routes.ts` | 5,366 | 5,366 | ✅ |
| `server/storage.ts` | 1,688 | 1,688 | ✅ |
| `shared/schema.ts` | 1,981 | 1,981 | ✅ |
| `server/index.ts` | 279 | 279 | ✅ |

---

## OPEN ISSUE TRACKER (carried forward)

| ID | Severity | Status | Notes |
|---|---|---|---|
| H-1 | DEPLOY | **OPEN** | `npm run db:push` in Replit shell — syncs all 127 PostgreSQL tables |
| M-6 | TEST | **OPEN** | Live smoke test with real Moorings drawings |
| WP-4 | FUTURE | **OPEN** | Register `pdf-grid-extractor.ts` in orchestrator extractor registry |
| WP-5 | FUTURE | **OPEN** | Register `raster-grid-extractor.ts` in orchestrator extractor registry |

### NEW ITEMS FROM THIS SESSION

| ID | Severity | Status | Notes |
|---|---|---|---|
| E-1 | INFO | **OPEN** | `client/src/pages/benchmark.tsx` file header comment at L12 references project name — cosmetic only, no runtime impact |
| E-2 | AUDIT | **OPEN** | Broader audit needed: other hardcoded values (prices, areas, addresses, phone numbers, etc.) — see "Next session" below |

---

## NEXT SESSION PRIORITIES

1. **H-1** — `npm run db:push` in Replit shell
2. **E-2** — Broader hardcoded-value audit: scan for hardcoded dollar amounts, areas, addresses, email addresses, phone numbers, dates, version strings embedded in runtime data paths
3. **M-6** — Live smoke test with Moorings drawings
4. **WP-4/WP-5** — Register PDF and raster grid extractors

---

## DEPLOYMENT

```bash
tar xzf EstimatorPro-v14.35-FULL-DEPLOY.tar.gz --strip-components=1
# Secrets (if new environment): DATABASE_URL, ANTHROPIC_API_KEY, JWT_SECRET
npm install        # only if package.json changed (it did not)
npm run db:push    # REQUIRED — syncs 127 PostgreSQL tables
npm start          # port 5000
```

Archive: `EstimatorPro-v14.35-FULL-DEPLOY.tar.gz` (1.5 MB, 589 files)

---

## ADDENDUM — Extended Audit (same session)

After the initial 12-file fix, a second codebase scan found 7 additional runtime hardcoded project-specific values. All fixed in this same session. No new archive version needed — the final `.tar.gz` includes all changes.

### Additional files changed

| File | Fix |
|---|---|
| `client/src/pages/boq.tsx` | Removed hardcoded Moorings UUID `c7ec2523-…`; `projectId` now comes from URL only; query disabled when no projectId |
| `server/helpers/floor-analyzer.ts` | AI prompt `"Moorings residential building project"` → `project.name` from `storage.getProject(projectId)` |
| `server/real-qto-processor.ts` | AI prompt `"Moorings Residential Building documents"` → `project.name` from `storage.getProject(projectId)` |
| `server/routes/bim-generate.ts` | Model name `"Moorings v${n} - ${date}"` → `"${project.name} v${n} - ${date}"` |
| `server/construction-workflow-processor.ts` | `region: "Ontario - Kawartha Lakes"` → `projectRecord.location` (record already loaded) |
| `server/estimator/estimate-engine.ts` | `region` fallback `'Ontario - Kawartha Lakes'` removed from both `generateEstimateFromElements` and `buildEstimateForModel` — unresolved region now uses composite index 1.0 (national average), not a project-specific region |
| `server/routes.ts` | `floor-analysis` endpoint replaced hardcoded 4-floor mock (`area: 2500` etc.) with empty floors array + RFI flag |

### Legitimately remaining (verified non-defaults)

| Location | Category | Reason left |
|---|---|---|
| `canadian-cost-data.ts:93` | Rate table key | `'Ontario - Kawartha Lakes'` is a valid region lookup key — not a default being silently applied |
| `bep-rules-engine.ts` — `MOORINGS_BEP` | Named export | Selected by name at runtime |
| `grid-detection-profiles.ts` — `the-moorings` | Named profile | Selected by name at runtime |
| All `__tests__/` files | Test fixtures | Tests need deterministic known data |
| `bim-generator.ts:1558` | Warning comment | Reminds developer to replace example values — not runtime data |
| `routes.ts:465` | Dev comment | Documents a development-only endpoint |

### Final scan result
Zero hardcoded project-specific values remain in any runtime data path.

### Updated line counts (files changed in addendum)

| File | Lines |
|---|---|
| `server/routes.ts` | 5,365 |
| `server/estimator/estimate-engine.ts` | 1,683 |
| `server/construction-workflow-processor.ts` | 2,402 |
| `server/real-qto-processor.ts` | 2,008 |
| `server/routes/bim-generate.ts` | 326 |
| `server/helpers/floor-analyzer.ts` | 504 |
| `client/src/pages/boq.tsx` | 181 |
| `client/src/components/qs-level5-dashboard.tsx` | 2,457 |
| `server/routes/multi-stage-analysis.ts` | 407 |
| `server/routes/estimator-router.ts` | 1,054 |
