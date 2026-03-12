# ESTIMATORPRO v2 → v3 — MASTER HANDOFF DOCUMENT v23
## Session 16 Deliverable — BIM Coordination SOP Implementation Begins
### Date: March 1, 2026

---

# PART A — WHAT THIS IS

This document replaces MASTER-HANDOFF-v22.md.
Upload this file + EstimatorPro-v2-session16.tar.gz to start any future session.

**NEW IN SESSION 16:** BIM Coordination SOP implementation started. 4 new modules (2,405 lines) covering foundation types and the clash detection engine core. Full 10-phase implementation plan created.

---

# PART B — SYSTEM OVERVIEW

EstimatorPro is transforming from a cost estimation platform (v2) into a full BIM coordination, clash detection, and project controls platform (v3).

**v2 Architecture (estimation — complete, stable):**
```
BIM Elements → estimate-engine.ts → BudgetStructure → Monte Carlo → 26 endpoints → 6 UI panels
```

**v3 Architecture (coordination — in progress):**
```
BIM Elements → selection-sets.ts → clash-engine.ts → issue-log → reporting → governance
                   ↓                      ↓                ↓           ↓
              types.ts            naming-convention.ts   bcf-export   schedule-linkage
```

**Standards:** CSI MasterFormat 2018, CIQS, RICS NRM1/NRM2, AACE RP 18R-97/34R-05, BIM Coordination SOP v1.1 (13 Parts), BCF 2.1, IFC4

---

# PART C — FILE INVENTORY

## Estimator Modules (23 files) — unchanged, stable
*(Same as v22 — estimate-engine.ts through bid-leveling.ts, 23 files)*

## Router + Shared Data (2 files) — unchanged
*(estimator-router.ts 976 lines, canadian-cost-data.ts 405 lines)*

## Modified Existing Files (3 files) — unchanged
*(construction-workflow-processor.ts, bim-generator.ts, product-routes.ts)*

## Frontend Components (6 files) — unchanged, stable

| File | Lines | Purpose |
|------|-------|---------|
| compliance-panel.tsx | 883 | Codes, Adders, QA/QC, RFIs |
| estimate-dashboard.tsx | 1,201 | AACE badge, waterfall, CSI chart, floor cards |
| monte-carlo-panel.tsx | 798 | Histogram, S-curve, tornado, PERT |
| bid-leveling-panel.tsx | 807 | Division × Bidder heatmap, ranking |
| boe-report-panel.tsx | 767 | 12 AACE RP 34R-05 sections |
| sov-panel.tsx | 509 | Trade-by-trade SOV, retainage, L/M/E |

## NEW: BIM Coordination Modules (4 files) ← SESSION 16

| # | File | Lines | Phase | SOP Coverage |
|---|------|-------|-------|-------------|
| 1 | **types.ts** | **861** | Phase 1 | Appendix B/C/D, Parts 2/7/8/9/10/11/12 |
| 2 | **naming-convention.ts** | **483** | Phase 1 | Part 8.1, 8.2, 8.3, 9 |
| 3 | **selection-sets.ts** | **412** | Phase 5A | Part 7.2 Table 2, Part 2 BIM/VDC gates |
| 4 | **clash-engine.ts** | **649** | Phase 5A | Parts 7.3, 7.4, 7.5, 7.6, Appendix C |

**Total new:** 2,405 lines across 4 files

---

# PART D — SESSION 16 CHANGES IN DETAIL

## Implementation Plan Created

Full 10-phase implementation plan mapped to all 13 SOP Parts:

| Phase | Scope | Est. Lines | SOP Parts |
|-------|-------|-----------|-----------|
| 1 | Foundation Types & Enums | ~400 | App B/C/D, Parts 2/7-12 |
| 2 | Document Control & Extraction | ~800 | Parts 1, 4 |
| 3 | Model QTO QA Engine | ~600 | Part 5 |
| 4 | Constructability & 4D Sequencing | ~700 | Part 6 |
| 5 | Clash Detection Engine (CORE) | ~1,200 | Part 7 |
| 6 | Issue Management & Reporting | ~1,000 | Parts 8, 9, App A |
| 7 | Change Tracking & Trends | ~600 | Part 10 |
| 8 | P6 Schedule Linkage | ~500 | Part 11 |
| 9 | Discipline-Specific Tests | ~700 | Parts 2, 12 |
| 10 | Weekly Governance Engine | ~500 | Part 13 |

Total plan: 24 server modules + 1 router + 7 UI panels = 32 new files, ~10,450 lines

## Phase 1 COMPLETE: Foundation Types (types.ts — 861 lines)

All enums, interfaces, and scoring functions that every other module imports:

| Feature | Count | SOP Ref |
|---------|-------|---------|
| Issue status enums + definitions | 9 statuses | Appendix B, Table 9 |
| Valid status transitions | 9 × n matrix | Appendix B |
| Priority scoring (4 dimensions, weights, calculate function) | complete | Appendix C, Table 10 |
| Evidence reference interface + formatter | 6 types | Part 1 traceability rule |
| Gap policy types | 5 types | Appendix D |
| Clash test definitions (6 standard tests) | CD-001, SC-01/02/03, AC-001/002 | Part 7.3, Table 3 |
| Delta classification | 4 types | Part 10.1 |
| Risk-to-path | 4 types | Part 11.2 |
| Penetration status | 5 types | Part 12.3 |
| Viewpoint types + color overrides | 3 types, 5 colors | Part 9 |
| Selection set definition interface | complete | Part 7.2, Table 2 |
| Coordination element (extended BIM) | 25+ fields | Parts 5, 7 |
| Clash result + group + issue log | full 20-col | Part 8.2, Table 7 |
| Discipline enums | 7 disciplines | Part 2 |
| Document control, extraction, constructability, 4D, schedule interfaces | all | Parts 1-13 |

## Phase 1 COMPLETE: Naming Convention (naming-convention.ts — 483 lines)

| Feature | SOP Ref |
|---------|---------|
| `generateSlug()` — {Level_Zone}-{SystemA_vs_SystemB}-{Grid}-{ShortDesc} | Part 8.1 |
| `generateClashGroupSlug()` — from clash group data | Part 8.1 |
| `generateUniqueSlug()` — collision-safe with sequence numbers | Part 8.1 |
| `slugToTitle()` — human-readable conversion | Part 8.1 |
| `parseSlug()` — reverse parse to components | Part 8.1 |
| `validateSlug()` — well-formedness + UNKNOWN field warnings | Part 8.1 |
| `generateViewpointName()` + `generateAllViewpointNames()` | Part 9 |
| `generateBCFTitle()` + `generateBCFDescription()` + `generateBCFComponent()` | Part 8.3 |
| `ISSUE_LOG_CSV_HEADERS` + `issueToCSVRow()` + `issuesToCSV()` | Part 8.2 |
| Batch grouping: by level, discipline pair, zone | Part 8.4 |
| UNKNOWN field handling: LEVEL_UNKNOWN, ZONE_UNKNOWN, GRID_UNKNOWN | Part 8.1 |

## Phase 5A COMPLETE: Selection Sets (selection-sets.ts — 412 lines)

| Feature | SOP Ref |
|---------|---------|
| 5 selection set definitions per Table 2 | Part 7.2 |
| Primary rules: Category + SystemType + Workset filters | Table 2 |
| Fallback rules: Category + name tokens when SystemType missing | Table 2 |
| IFC class mapping for each set | Table 2 |
| Confidence scoring (high/medium/low based on fallback ratio) | Part 7.2 |
| GAP logging for every fallback match | Part 7.2 |
| Composite sets: MEP_All, Obstructions | Part 7.3 |
| `selectElements()` — primary → fallback with gap tracking | Part 7.2 |
| `selectElementsByIFC()` — IFC entity matching | Table 2 |
| `checkMetadataCompleteness()` — model drop gates | Part 2 BIM/VDC |
| `resolveClashTestSets()` — resolve both sets for a test + metadata checks | Part 7 |
| SystemType ≥ 80% gate for MEP, Level ≥ 90% gate for all | Part 5.2 |

## Phase 5A COMPLETE: Clash Engine Core (clash-engine.ts — 649 lines)

| Feature | SOP Ref |
|---------|---------|
| **Pipeline:** resolve → detect → filter → dedup → score → rank | Part 7 |
| AABB intersection (signed distance: negative=overlap, positive=gap) | Part 7.3 |
| Spatial hash broad-phase acceleration | — (performance) |
| 6 standard tests: CD-001, SC-01, SC-02, SC-03, AC-001, AC-002 | Table 3 |
| **False positive filtering (4 mandatory rules):** | Part 7.4 |
| Rule 1: Ignore TEMP elements | Part 7.4 |
| Rule 2: Ignore Dev/Test worksets | Part 7.4 |
| Rule 3: Ignore support/hanger ≤10mm (except Code/Access) | Part 7.4 |
| Rule 4: Ignore insulation-only (except Code/Access) | Part 7.4 |
| **De-duplication (3 phases):** | Part 7.5 |
| Phase 1: Exact duplicate removal (unordered ID pair + test) | Part 7.5 |
| Phase 2: Frequency analysis for root-cause attribution | Part 7.5 |
| Phase 3: Group by root-cause element | Part 7.5 |
| System owner assignment (metadata-based, with fallback flagging) | Part 7.5 |
| **Priority scoring:** | Part 7.6, Appendix C |
| 4-dimension rubric (Life-safety, Schedule, Rework, Downstream) | Table 10 |
| Final = max(LifeSafety, round(weighted_sum)) | Appendix C |
| Code/Access issues always listed first, lifeSafety ≥ 3 | Part 7.6 |
| Heuristic scoring by clash count, gap presence, victim count | Part 7.6 |
| `runClashDetection()` — full pipeline across all/selected tests | Part 7 |
| `runSingleClashTest()` — single test execution | Part 7 |
| `quickClashCount()` — dashboard-ready fast count | — |
| `summarizeClashRun()` — aggregated metrics | Part 8.4 |

---

# PART E — ENDPOINTS WIRED TO UI (9 of 26 estimation endpoints)

*(Same as v22 — estimation endpoints unchanged)*

BIM Coordination endpoints: 0 of ~20 planned (router not yet built).

---

# PART F — WHAT IS GENUINELY NOT DONE

## BIM Coordination: Phases Remaining

| Phase | Module(s) | Status | Next Session |
|-------|-----------|--------|-------------|
| **1** | types.ts, naming-convention.ts | **✅ DONE** | — |
| **5A** | selection-sets.ts, clash-engine.ts | **✅ DONE** | — |
| **5B** | *(already in engine)* — filter, dedup, scoring | **✅ DONE** | — |
| **3** | qto-qa-engine.ts | **TODO** | 17 |
| **6** | issue-log.ts, bcf-export.ts, report-generator.ts, viewpoint-generator.ts | **TODO** | 18 |
| **2** | document-control-register.ts, extraction-checklists.ts | **TODO** | 19 |
| **9** | discipline-sop.ts, test-templates.ts, access-code-checks.ts | **TODO** | 19 |
| **7** | delta-tracker.ts, trend-analytics.ts | **TODO** | 20 |
| **8** | schedule-linkage.ts, milestone-protection.ts | **TODO** | 20 |
| **10** | governance-engine.ts | **TODO** | 21 |
| **Router** | bim-coordination-router.ts (~20 endpoints) | **TODO** | 21 |
| **UI** | 7 coordination panels | **TODO** | 21-22 |

## Estimation: Items Remaining (from v22)

| # | Item | Notes |
|---|------|-------|
| 1 | Benchmark Comparison Page | GET /estimates/:modelId/benchmark |
| 2 | Connect remaining 17 estimation endpoints | 9 of 26 wired |
| 3 | Maker-checker workflow UI | POST /approve, /freeze, /reopen |
| 4 | Validate canadian-cost-data.ts | RSMeans cross-check |
| 5 | Validate CSI rate values | Recent bid data |
| 6 | Replit deployment testing | End-to-end |

---

# PART G — DEPLOYMENT INSTRUCTIONS

```bash
tar -xzf EstimatorPro-v2-session16.tar.gz

# Estimator modules (23 files) — unchanged
cp server/estimator/*.ts → Replit server/estimator/

# Shared + router + modified (3+2 files)
cp server/canadian-cost-data.ts → Replit server/
cp server/routes/estimator-router.ts → Replit server/routes/
cp server/construction-workflow-processor.ts → Replit server/
cp server/bim-generator.ts → Replit server/
cp server/product-routes.ts → Replit server/

# Frontend components (6 files)
cp client/components/*.tsx → Replit client/components/

# NEW: BIM Coordination modules (4 files)
mkdir -p Replit server/bim-coordination/
cp server/bim-coordination/*.ts → Replit server/bim-coordination/
```

---

# PART H — SESSION HISTORY

| Session | Focus | Key Deliverables |
|---------|-------|-----------------|
| 8 | Foundation | estimate-engine.ts, budget-structure.ts, 6 core modules |
| 9 | Expansion | 8 more modules (codes, labor, WBS, RFI, rebar, variants, quotes, alternates) |
| 10 | Benchmarking | benchmark-core + 5 sector packs, uniformat, SOV, versioning |
| 11 | Integration | BOE generator, QA test suite (904 checks) |
| 12 | Wiring + Gap Closure | estimator-router (26 endpoints), NRM2, Monte Carlo, bid-leveling, canadian-cost-data |
| 13 | Pipeline + UI | MissingDataTracker → CWP, bim-gen trigger, compliance-panel.tsx |
| 14 | Frontend + MC | estimate-dashboard, monte-carlo-panel (+ CWP STEP 8), bid-leveling-panel |
| 15 | Report Pages | bid-leveling-panel, boe-report-panel, sov-panel (9 of 26 endpoints wired) |
| **16** | **BIM Coordination SOP** | **Implementation plan (10 phases, 32 files), types.ts (861), naming-convention.ts (483), selection-sets.ts (412), clash-engine.ts (649). Total: 2,405 new lines.** |

---

# PART I — CUMULATIVE METRICS

| Metric | Value |
|--------|-------|
| Production files | **40** (36 estimation + 4 coordination) |
| Total code lines | **~24,700** (~22,300 est. + 2,405 coord.) |
| REST endpoints | 26 (estimation) + 0 (coordination) |
| Endpoints wired to UI | 9 |
| BIM Coordination modules | **4 of 24 planned** |
| SOP Parts covered | **Parts 7.2-7.6, 8.1-8.3, 9, App B/C/D** |
| Clash test definitions | 6 (CD-001, SC-01/02/03, AC-001/002) |
| Selection sets | 5 standard + 2 composite |
| False positive filter rules | 4 (SOP 7.4) |
| De-duplication phases | 3 (SOP 7.5) |
| Priority scoring dimensions | 4 (Appendix C) |
| Status enum states | 9 (Appendix B) |
| CSI rate entries | 284 |
| CSI divisions | 34 |
| UNIFORMAT elements | 75 |
| Canadian regions | 27 |
| QA checks | 283 |
| QS Level 5 compliance | 42/42 (100%) |
| Frontend components | 6 |

---

# PART J — NEXT SESSION PRIORITIES

**Session 17 recommended scope:**

1. **Phase 3: qto-qa-engine.ts** (~600 lines) — SOP Part 5
   - 5 QA rules: ID stability, level assignment, SystemType, materials, orphans
   - MEP connectivity summary
   - QTO maturity scoring
   
2. **Phase 6 start: issue-log.ts** (~400 lines) — SOP Part 8
   - 20-column issue log CRUD
   - Status workflow enforcement
   - Issue creation from clash groups

3. **Phase 6: bcf-export.ts** (~300 lines) — SOP Part 8.3
   - BCF 2.1 XML generation
   - Component mapping (IFC GUIDs)

Estimated: ~1,300 lines, 3 modules

---

*EstimatorPro v3 — Master Handoff Document v23*
*40 files | ~24,700 lines | 26+0 endpoints | 4/24 coordination modules | 42/42 QS Level 5*
