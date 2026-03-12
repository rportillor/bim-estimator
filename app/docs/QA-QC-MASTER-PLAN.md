# QA/QC Master Plan — Implementation Map for EstimatorPro v14.4

## Document Reference
Source: `QA_QC_Master_Plan_Updated_v1_1.docx`  
Date: 2026-03-02 | Version: 1.0  
Scope: 20 sections covering full software QA/QC lifecycle

---

## Section → Implementation File Mapping

| Plan § | Section Title | Implementation Files | Status |
|--------|--------------|---------------------|--------|
| §1 | Document Control | This document + transfer manifests | ✅ |
| §2 | Test Strategy Overview | `.github/workflows/ci.yml`, `jest.config.js`, `playwright.config.ts` | ✅ |
| §2.3 | Entry/Exit Criteria | `server/services/test-metrics-collector.ts` (checkExitCriteria) | ✅ |
| §2.4 | Test Governance | `server/routes/test-metrics-routes.ts` | ✅ |
| §2.5 | Test Data Management | `tests/qa/golden-sets.json` (AI evaluation golden sets) | ✅ |
| §2.6 | Regression Strategy | `tests/final-qa-test.ts` (12-level QA), E2E specs | ✅ |
| §3 | Unit Testing | 66 test files, `jest.config.js` (70% branch threshold) | ✅ |
| §4 | Logic & Flow Testing | `tests/final-qa-test.ts` L2-L12 levels | ✅ |
| §5.1-5.3 | Frontend Testing | 21 pages, 112 components, 6 Playwright E2E specs | ✅ |
| §5.4 | Accessibility (WCAG 2.1 AA) | `tests/qa/accessibility-test-suite.ts` | ✅ |
| §6.1 | API Testing | 184 REST endpoints in routes.ts, 61 route files | ✅ |
| §6.2 | Database Testing | Drizzle ORM, `storage.ts`, migrations | ✅ |
| §6.3 | Auth & AuthZ | `server/auth.ts`, `server/middleware/auth-*.ts` | ✅ |
| §6.4 | Service & Middleware | 10 middleware files in `server/middleware/` | ✅ |
| §7.1 | Integration Testing | 20+ integration test files in `server/services/__tests__/` | ✅ |
| §7.2 | E2E Scenarios | 6 Playwright specs, 72 test cases | ✅ |
| §8.1 | OWASP Top 10 | `tests/qa/security-test-suite.ts` (SEC-01 to SEC-22) | ✅ |
| §8.2 | Additional Security | CSP, file upload, tenant security middleware | ✅ |
| §9.1-9.2 | Performance Testing | `lighthouserc.json`, `performance-monitor.ts` | ✅ |
| §9.3 | Frontend Performance | `web-vitals.ts`, `tests/qa/ifc-bim-validation.ts` PF-08 | ✅ |
| §10.1 | Pre-Deployment | `.github/workflows/ci.yml` (5-stage pipeline) | ✅ |
| §10.2 | Post-Deployment Smoke | `server/routes/health-check-routes.ts` (/health/smoke) | ✅ |
| §10.3 | Rollback Plan | `server/middleware/graceful-shutdown.ts` (SIGTERM/SIGINT) | ✅ |
| §11.1 | Failure Scenarios | `tests/qa/resilience-test-suite.ts` (DR-01 to DR-10) | ✅ |
| §11.2 | Backup Verification | Drizzle config, DB management (BK-01 to BK-06) | ✅ |
| §12.1 | UAT Execution | `client/src/pages/uat-signoff.tsx` (10 scenarios) | ✅ |
| §12.2 | UAT Sign-Off Form | `client/src/pages/uat-signoff.tsx` (GO/NO-GO form) | ✅ |
| §13.1 | Severity Classification | `server/services/test-metrics-collector.ts` (S1-S4) | ✅ |
| §13.2 | Defect Lifecycle | `server/services/test-metrics-collector.ts` + `issue-log.ts` | ✅ |
| §13.3 | Defect Report Template | `server/routes/test-metrics-routes.ts` CRUD endpoints | ✅ |
| §14.1 | Key Metrics Dashboard | `client/src/pages/test-dashboard.tsx` | ✅ |
| §14.2 | Reporting Schedule | `server/routes/test-metrics-routes.ts` dashboard API | ✅ |
| §15 | RTM | `server/services/rtm-generator.ts` (25 requirements mapped) | ✅ |
| §16 | Deployment Authorization | `server/routes/test-metrics-routes.ts` (/qa/go-no-go) | ✅ |
| §17.1 | AI/ML Scope | `server/services/ai-processor.ts`, `prompt-library.ts` | ✅ |
| §17.2 | Evaluation Datasets | `tests/qa/ai-evaluation-runner.ts` (golden sets) | ✅ |
| §17.3 | Citation Integrity | `tests/qa/ai-evaluation-runner.ts` (AI-01 to AI-05) | ✅ |
| §17.4 | Model/Prompt Versioning | `tests/qa/ai-evaluation-runner.ts` (AI-06 to AI-10) | ✅ |
| §17.5 | Safety & Abuse | `tests/qa/ai-evaluation-runner.ts` (AI-11 to AI-15) | ✅ |
| §18.1 | IFC Import & Integrity | `tests/qa/ifc-bim-validation.ts` (BIM-01 to BIM-06) | ✅ |
| §18.2 | QTO Validation | `tests/qa/qto-tolerance-benchmark.ts` (tolerance bands) | ✅ |
| §18.3 | Viewer & Evidence Links | `tests/qa/ifc-bim-validation.ts` (BIM-07 to BIM-11) | ✅ |
| §19.1 | Source Library Control | `server/services/source-library-control.ts` (19 sources) | ✅ |
| §19.2 | Deterministic Rules | `tests/qa/compliance-workflow-test.ts` (COM-05 to COM-08) | ✅ |
| §19.3 | Findings & RFI Workflow | `tests/qa/compliance-workflow-test.ts` (COM-09 to COM-11) | ✅ |
| §20.1 | Audit Trail | `tests/qa/export-validation-test.ts` (AUD-01 to AUD-04) | ✅ |
| §20.2 | Export Validation | `tests/qa/export-validation-test.ts` (EXP-01 to EXP-04) | ✅ |

---

## QA Test Suites — Run Commands

```bash
# Full QA suite (12 levels, 217 tests)
npx tsx tests/final-qa-test.ts

# QA/QC Master Plan test suites
npx tsx tests/qa/security-test-suite.ts        # §8 OWASP/Security
npx tsx tests/qa/ai-evaluation-runner.ts        # §17 AI/ML Validation
npx tsx tests/qa/accessibility-test-suite.ts    # §5.4 WCAG 2.1 AA
npx tsx tests/qa/qto-tolerance-benchmark.ts     # §18.2 QTO Tolerances
npx tsx tests/qa/ifc-bim-validation.ts          # §18.1/18.3 BIM/IFC
npx tsx tests/qa/compliance-workflow-test.ts     # §19 Codes/Standards
npx tsx tests/qa/resilience-test-suite.ts       # §11 DR/Resilience
npx tsx tests/qa/export-validation-test.ts      # §20 Audit/Exports

# E2E Playwright
npx playwright test

# Unit tests with coverage
npm test -- --coverage
```

## New Files Created for QA/QC Master Plan

| # | File | Plan Section | Lines |
|---|------|-------------|-------|
| 1 | `server/middleware/graceful-shutdown.ts` | §10.3, §11.1 | ~65 |
| 2 | `.github/workflows/ci.yml` | §2.4, §10.1 | ~95 |
| 3 | `server/services/test-metrics-collector.ts` | §13, §14 | ~200 |
| 4 | `server/routes/test-metrics-routes.ts` | §14, §16 | ~65 |
| 5 | `tests/qa/security-test-suite.ts` | §8 | ~200 |
| 6 | `tests/qa/ai-evaluation-runner.ts` | §17 | ~250 |
| 7 | `tests/qa/accessibility-test-suite.ts` | §5.4 | ~190 |
| 8 | `client/src/pages/uat-signoff.tsx` | §12 | ~150 |
| 9 | `client/src/pages/test-dashboard.tsx` | §14, §16 | ~130 |
| 10 | `tests/qa/qto-tolerance-benchmark.ts` | §18.2 | ~180 |
| 11 | `tests/qa/ifc-bim-validation.ts` | §18.1, §18.3, §9.3 | ~160 |
| 12 | `tests/qa/compliance-workflow-test.ts` | §19 | ~170 |
| 13 | `server/services/source-library-control.ts` | §19.1 | ~230 |
| 14 | `tests/qa/resilience-test-suite.ts` | §11 | ~170 |
| 15 | `server/routes/health-check-routes.ts` | §10.2, §11.1 | ~145 |
| 16 | `server/services/rtm-generator.ts` | §15 | ~210 |
| 17 | `server/routes/rtm-routes.ts` | §15 | ~40 |
| 18 | `tests/qa/export-validation-test.ts` | §20 | ~160 |
| 19 | `docs/QA-QC-MASTER-PLAN.md` | Reference | This file |
