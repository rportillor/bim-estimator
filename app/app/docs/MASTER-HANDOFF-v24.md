# ESTIMATORPRO v2 → v3 — MASTER HANDOFF DOCUMENT v24
## Session 17 Deliverables — Prompt Library + QTO QA Engine + OH&P Config
### Date: March 1, 2026

---

# PART A — WHAT THIS IS

This document replaces MASTER-HANDOFF-v23.md.
Upload this file to start any future session.

**NEW IN SESSION 17:** Three modules delivered:
1. `prompt-library.ts` (837 lines) — SOP Part 3, all 6 standardized AI prompts
2. `qto-qa-engine.ts` (1,553 lines) — SOP Part 5, 6 QA rules, maturity scoring, model drop gate
3. `ohp-configuration.ts` (335 lines) — Stream A, OH&P configurability replacing hardcoded 15%/10%

**Total Session 17:** 2,725 new lines across 3 modules.

---

# PART B — SYSTEM OVERVIEW

**v2 Architecture (estimation — complete, stable):**
```
BIM Elements → estimate-engine.ts → BudgetStructure → Monte Carlo → 26 endpoints → 6 UI panels
                                         ↑
                              ohp-configuration.ts (NEW — replaces hardcoded OH&P)
```

**v3 Architecture (coordination — in progress):**
```
prompt-library.ts → extraction-checklists → qto-qa-engine → constructability → clash-engine
       ↓                     ↓                    ↓                ↓                  ↓
   types.ts       document-control-register   selection-sets   sequencing-4d     issue-log
       ↓                                                                             ↓
  naming-convention                                                              governance
```

**Standards:** CSI MasterFormat 2018, CIQS, RICS NRM1/NRM2, AACE RP 18R-97/34R-05, BIM Coordination SOP v1.1 (13 Parts), BCF 2.1, IFC4

---

# PART C — FILE INVENTORY

## Estimator Modules (24 files) — 1 new
*(23 unchanged from v22 + NEW ohp-configuration.ts 335 lines)*

## Router + Shared Data (2 files) — unchanged
*(estimator-router.ts 976 lines, canadian-cost-data.ts 405 lines)*

## Modified Existing Files (5 files) — 2 updated in Session 17
*(construction-workflow-processor.ts, bim-generator.ts, product-routes.ts — unchanged)*
*(cost-estimation-engine.ts — UPDATED: resolveOHP() replaces hardcoded OH&P, 1,054 lines)*
*(estimates.ts — UPDATED: getOverheadProfitCombined() replaces ?? 0.15, 66 lines)*

## Frontend Components (6 files) — unchanged

| File | Lines | Purpose |
|------|-------|---------|
| compliance-panel.tsx | 883 | Codes, Adders, QA/QC, RFIs |
| estimate-dashboard.tsx | 1,201 | AACE badge, waterfall, CSI chart, floor cards |
| monte-carlo-panel.tsx | 798 | Histogram, S-curve, tornado, PERT |
| bid-leveling-panel.tsx | 807 | Division × Bidder heatmap, ranking |
| boe-report-panel.tsx | 767 | 12 AACE RP 34R-05 sections |
| sov-panel.tsx | 509 | Trade-by-trade SOV, retainage, L/M/E |

## BIM Coordination Modules (6 files)

| # | File | Lines | Phase | SOP Coverage | Session |
|---|------|-------|-------|-------------|---------|
| 1 | types.ts | 861 | Phase 1 | Appendix B/C/D, Parts 2/7/8/9/10/11/12 | 16 |
| 2 | naming-convention.ts | 483 | Phase 1 | Part 8.1, 8.2, 8.3, 9 | 16 |
| 3 | selection-sets.ts | 412 | Phase 5A | Part 7.2 Table 2, Part 2 BIM/VDC gates | 16 |
| 4 | clash-engine.ts | 649 | Phase 5A | Parts 7.3, 7.4, 7.5, 7.6, Appendix C | 16 |
| 5 | **prompt-library.ts** | **837** | **Phase 2 (new)** | **Part 3 — All 6 prompts** | **17** |
| 6 | **qto-qa-engine.ts** | **1,553** | **Phase 3** | **Part 5 — QA, maturity, drop gate** | **17** |

---

# PART D — SESSION 17 CHANGES IN DETAIL

## 1. Prompt Library (prompt-library.ts — 837 lines) — SOP Part 3

Single-source-of-truth for all 6 standardized AI prompts. Consumer modules import the prompt they need.

| Prompt | Function | SOP Ref | Consumer |
|--------|----------|---------|----------|
| 3.1 Drawing Parsing | `getDrawingParsingPrompt()` | Part 3.1 | extraction-checklists.ts |
| 3.2 Model QTO | `getModelQTOPrompt()` | Part 3.2 | qto-qa-engine.ts |
| 3.3 Constructability | `getConstructabilityPrompt()` | Part 3.3 | constructability-engine.ts |
| 3.4 4D Sequencing | `getSequencing4DPrompt()` | Part 3.4 | sequencing-4d.ts |
| 3.5 Cross-Doc QA | `getCrossDocQAPrompt()` | Part 3.5 | extraction-checklists.ts |
| 3.6 Engineering Validation | `getEngineeringValidationPrompt()` | Part 3.6 | discipline-sop.ts |

Utilities: `getPromptById()`, `validatePromptParams()`, `listPrompts()`, `getCorePrinciples()`, `getGapPolicy()`, `getEvidenceFormat()`. 7 typed parameter interfaces, 10 exported functions.

## 2. QTO QA Engine (qto-qa-engine.ts — 1,553 lines) — SOP Part 5

Complete model QTO extraction QA. Quality gate before clash detection.

**SOP 5.1 — 5 Extraction Functions:**
`buildElementIndex()`, `buildCategoryRollups()`, `buildMaterialsTable()`, `buildHostedDependencies()`, `buildMEPConnectivity()`

**SOP 5.2 — 6 Mandatory QA Rules:**

| Rule | Function | Threshold |
|------|----------|-----------|
| R1 ID Stability | `qaRule1_IDStability()` | ≤5% IDs changed across drops |
| R2 Level Assignment | `qaRule2_LevelAssignment()` | ≥90% with level assigned |
| R3 System Metadata | `qaRule3_SystemMetadata()` | ≥80% MEP with SystemType |
| R4 Placeholder Materials | `qaRule4_PlaceholderMaterials()` | ≤10% placeholder |
| R5 Orphan Detection | `qaRule5_OrphanDetection()` | 0 orphans |
| R6 MEP Connectivity | `qaRule6_Connectivity()` | ≤5% unconnected |

**SOP 5.3 — Maturity:** `calculateMaturityScores()` — 4-dimension scoring, COUNTS_ONLY flag.

**Model Drop Gate (SOP Part 2):** `checkModelDropGate()` — 3 gates. Returns accepted/blocked.

**Pipeline:** `runQTOExtraction()` — extract + QA + maturity + gaps + report.

14 interfaces, 21 functions.

## 3. OH&P Configuration (ohp-configuration.ts — 335 lines) — Stream A, A2.7

Replaces hardcoded overhead (15%) and profit (10%) with configurable project-level settings. **Delivered as 3 complete files — no patches:**

| File | Lines | Change |
|------|-------|--------|
| `ohp-configuration.ts` | 335 | NEW — configuration module |
| `cost-estimation-engine.ts` | 1,054 | COMPLETE REPLACEMENT — resolveOHP() at L682-692, warnings at L743-744 |
| `estimates.ts` | 66 | COMPLETE REPLACEMENT — getOverheadProfitCombined() at L32 |

**Resolution priority:** PROJECT_CONFIGURED (HIGH) → REGIONAL_DEFAULT (MEDIUM) → SYSTEM_FALLBACK (LOW + warning).

Key exports: `setProjectOHP()`, `getProjectOHP()`, `resolveOHP()`, `getOverheadProfitCombined()`, `getOverheadAndProfit()`, `validateOHPRates()`. 4 interfaces, 8 functions.

---

# PART E — DEPENDENCY MAP STATUS

Per BIM Coordination Implementation Plan v1:

```
Phase 1:  Foundation Types & Enums            ✅ DONE (Session 16)
    ↓
Phase 2:  Document Control & Extraction       ⬜ NOT DONE ← NEXT
    ↓
Phase 3:  Model QTO QA Engine                 ✅ DONE (Session 17)
    ↓
Phase 4:  Constructability & 4D Sequencing    ⬜ NOT DONE ← AFTER Phase 2
    ↓
Phase 5:  Clash Detection Engine              ✅ DONE (Session 16)
    ↓
Phase 6:  Issue Management & Reporting        ⬜ NOT DONE
    ↓
Phase 7:  Change Tracking & Trend Analytics   ⬜ NOT DONE
    ↓
Phase 8:  P6 Schedule Linkage                 ⬜ NOT DONE
    ↓
Phase 9:  Discipline-Specific Tests           ⬜ NOT DONE
    ↓
Phase 10: Weekly Governance Engine            ⬜ NOT DONE
```

**Added (not in original v1 map):**
- Prompt Library (prompt-library.ts) ✅ DONE — inserted as prerequisite to all extraction/QA modules

**SKIPPED — must complete before proceeding to Phase 6:**
- **Phase 2 (original): Document Control & Extraction** — feeds into Phase 3
- **Phase 4: Constructability & 4D Sequencing** — feeds into Phase 5

---

# PART F — WHAT IS GENUINELY NOT DONE

## BIM Coordination: Corrected Build Order

| Priority | Phase | Module(s) | Est. Lines | SOP Parts |
|----------|-------|-----------|-----------|-----------|
| **NEXT** | **2 (orig)** | **document-control-register.ts, extraction-checklists.ts** | **~800** | **Parts 1, 4** |
| 2nd | **4** | **constructability-engine.ts, sequencing-4d.ts** | **~700** | **Part 6** |
| 3rd | 6 | issue-log.ts, bcf-export.ts, report-generator.ts, viewpoint-generator.ts | ~1,250 | Parts 8, 9, App A |
| 4th | 7 | delta-tracker.ts, trend-analytics.ts | ~600 | Part 10 |
| 5th | 8 | schedule-linkage.ts, milestone-protection.ts | ~500 | Part 11 |
| 6th | 9 | discipline-sop.ts, test-templates.ts, access-code-checks.ts | ~700 | Parts 2, 12 |
| 7th | 10 | governance-engine.ts | ~500 | Part 13 |
| 8th | Router | bim-coordination-router.ts (~20 endpoints) | ~500 | All |
| 9th | UI | 7 coordination panels | ~3,450 | All |

## Estimation: Items Remaining

| # | Item | Status |
|---|------|--------|
| 1 | Benchmark Comparison Page | TODO |
| 2 | Connect remaining 17 endpoints | TODO (9 of 26 wired) |
| 3 | Maker-checker workflow UI | TODO |
| 4 | Validate canadian-cost-data.ts vs RSMeans | TODO |
| 5 | Validate CSI rate values vs bid data | TODO |
| 6 | Replit deployment testing | TODO |
| 7 | ~~OH&P configurability~~ | **✅ DONE** |
| 8 | Enhance NRM2/SMM7 for MEP | TODO |

---

# PART G — DEPLOYMENT INSTRUCTIONS

```bash
# Estimator modules (24 files)
cp server/estimator/*.ts → Replit server/estimator/
# NEW: server/estimator/ohp-configuration.ts

# Shared + router + modified (5 files)
cp server/canadian-cost-data.ts → Replit server/
cp server/routes/estimator-router.ts → Replit server/routes/
cp server/construction-workflow-processor.ts → Replit server/
cp server/bim-generator.ts → Replit server/
cp server/product-routes.ts → Replit server/

# Frontend components (6 files)
cp client/components/*.tsx → Replit client/components/

# BIM Coordination modules (6 files)
mkdir -p Replit server/bim-coordination/
cp server/bim-coordination/*.ts → Replit server/bim-coordination/
```

**OH&P Integration — Complete Replacement Files (no patches):**
```bash
# NEW module:
cp server/estimator/ohp-configuration.ts → Replit server/estimator/

# COMPLETE REPLACEMENT — cost-estimation-engine.ts (1,054 lines)
# Lines 682-692: resolveOHP() replaces hardcoded || 0.15 / || 0.10
# Lines 743-744: OH&P confidence + warnings added to assumptions
cp server/cost-estimation-engine.ts → Replit server/cost-estimation-engine.ts

# COMPLETE REPLACEMENT — estimates.ts (66 lines)
# Line 32: getOverheadProfitCombined() replaces ?? 0.15
cp server/routes/estimates.ts → Replit server/routes/estimates.ts
```

---

# PART H — SESSION HISTORY

| Session | Focus | Key Deliverables |
|---------|-------|-----------------|
| 8 | Foundation | estimate-engine.ts, budget-structure.ts, 6 core modules |
| 9 | Expansion | 8 modules (codes, labor, WBS, RFI, rebar, variants, quotes, alternates) |
| 10 | Benchmarking | benchmark-core + 5 sector packs, uniformat, SOV, versioning |
| 11 | Integration | BOE generator, QA test suite (904 checks) |
| 12 | Wiring + Gap | estimator-router (26 endpoints), NRM2, Monte Carlo, bid-leveling, canadian-cost-data |
| 13 | Pipeline + UI | MissingDataTracker → CWP, bim-gen trigger, compliance-panel.tsx |
| 14 | Frontend + MC | estimate-dashboard, monte-carlo-panel, bid-leveling-panel |
| 15 | Report Pages | bid-leveling-panel, boe-report-panel, sov-panel (9 of 26 endpoints wired) |
| 16 | BIM Coord SOP | types.ts (861), naming-convention.ts (483), selection-sets.ts (412), clash-engine.ts (649) |
| **17** | **Prompt + QTO + OH&P** | **prompt-library.ts (837), qto-qa-engine.ts (1,553), ohp-configuration.ts (335)** |

---

# PART I — CUMULATIVE METRICS

| Metric | Value |
|--------|-------|
| Production files | **43** (37 estimation + 6 coordination) |
| Total code lines | **~27,400** (~22,600 est. + 4,795 coord.) |
| REST endpoints | 26 (estimation) + 0 (coordination) |
| Endpoints wired to UI | 9 |
| BIM Coordination modules | **6 of ~25 planned** |
| SOP Parts covered | **Parts 3, 5, 7.2-7.6, 8.1-8.3, 9, App B/C/D** |
| Prompt templates | 6 (3.1 through 3.6) |
| QTO QA rules | 6 mandatory (SOP 5.2) |
| Model drop gate checks | 3 (Level, SystemType, ID stability) |
| Clash test definitions | 6 (CD-001, SC-01/02/03, AC-001/002) |
| Selection sets | 5 standard + 2 composite |
| CSI rate entries | 284 |
| CSI divisions | 34 |
| UNIFORMAT elements | 75 |
| Canadian regions | 27 |
| QS Level 5 compliance | 42/42 (100%) |
| Frontend components | 6 |

---

# PART J — NEXT SESSION PRIORITIES

**Following the dependency map in order:**

1. **Phase 2 (original): Document Control & Structured Extraction** (~800 lines)
   - `document-control-register.ts` (~400 lines) — SOP Parts 1, 4.1
   - `extraction-checklists.ts` (~400 lines) — SOP Part 4.2, 4.3
   - Consumes Prompts 3.1 and 3.5 from prompt-library.ts

2. **Phase 4: Constructability & 4D Sequencing** (~700 lines)
   - `constructability-engine.ts` (~400 lines) — SOP Part 6.1, 6.3
   - `sequencing-4d.ts` (~300 lines) — SOP Part 6.2
   - Consumes Prompts 3.3 and 3.4 from prompt-library.ts

3. **Then** Phase 6: Issue Management & Reporting

---

*EstimatorPro v3 — Master Handoff Document v24*
*43 files | ~27,400 lines | 26+0 endpoints | 6/25 coordination modules | 42/42 QS Level 5*
