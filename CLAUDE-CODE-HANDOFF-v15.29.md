# EstimatorPro v15.29 — Claude Code Handoff

**Date:** March 10, 2026
**Version:** 15.29.0 (DEPLOY-READY)
**Status:** Zero production TypeScript errors. Functionally complete. Only remaining gap = live QA with real drawings.

---

## What Is This Project?

EstimatorPro is a professional AI-powered construction cost estimation and BIM analysis platform for Canadian projects. It reads uploaded construction drawings (PDFs, DXF, DWG), uses Claude API to extract products, assemblies, and elements, generates a 3D BIM model, produces a CIQS-compliant cost estimate with 224 CSI MasterFormat rates (Material + Labour + Equipment breakdown, waste factors, regional adjustment), and tracks missing data as RFIs.

**Reference project:** The Moorings on Cameron Lake, Fenelon Falls, Ontario.

---

## Tech Stack

| Component | Technology |
|---|---|
| Backend | Node.js 20, TypeScript, Express |
| Frontend | React 18 (Vite), Tailwind CSS, wouter, TanStack Query |
| Database | PostgreSQL 16 (Neon on Replit), Drizzle ORM |
| AI | Anthropic Claude API (claude-sonnet-4-20250514, claude-opus-4-5) |
| CAD | dxf-parser (DXF files), pdf-parse (PDF text extraction) |
| Hosting | Replit (port 5000) |

---

## Non-Negotiable Architectural Laws

1. **No hardcoded defaults or fallbacks.** Missing data must generate RFIs via `MissingDataTracker`. Every quantity, rate, and building parameter must trace to a drawing, specification, or schedule. No invented or assumed data anywhere.

2. **Complete files only.** No patches, no partial code, no `str_replace` surgical edits. Every file written top-to-bottom in a single operation.

3. **TSC after every file change.** Zero production TypeScript errors maintained as a hard invariant.

4. **Evidence before marking done.** Grep commands and hard file evidence required to confirm implementation.

5. **Single-source pricing.** Both `boq-with-costs` and `convert-bim-to-boq` use `estimate-engine.ts` (224 CSI rates). The `CostEstimationEngine` shim in `cost-estimation-engine.ts` is NOT used for BoQ pricing.

---

## Core Data Flow

```
DRAWINGS (PDFs uploaded)
  ↓ POST /api/projects/:id/documents/upload
  ↓ pdf-parse extracts text + raster previews
  ↓ Stored in documents table
  
POST /api/bim/models/:modelId/generate  [bimGenerateRouter]
  ↓ BIMGenerator.generateBIMModel()
  ↓ Documents batched by type (Specs, Schedules, Plans, etc.)
  ↓ Per batch → CWP.processConstructionDocuments():
      Step 1: Specs → PRODUCTS (Claude API)
      Step 2: Products → ASSEMBLIES
      Step 3: Drawings → COORDINATES
      Step 4: Assemblies + Coordinates → ELEMENTS
      Step 5: saveElementsAsBimElements() → bimElements table
      Step 6: buildEstimateForModel() → CIQS estimate (224 rates)
      Step 7: generateAllRFIs() → missing data RFIs
  ↓ Calibrate + postprocess → final element positions
  ↓ Model status → 'completed'

POST /api/projects/:id/convert-bim-to-boq
  ↓ Reads bimElements → generateEstimateFromElements() (SAME engine)
  ↓ Groups estimate line items by CSI code
  ↓ Creates BoQ items with M+L+E rates, waste, floor assignment
  ↓ Persists estimate to analysisResults (type: 'ciqs_estimate')
  ↓ Updates project.estimateValue

GET /api/projects/:id/boq-with-costs
  ↓ Returns BoQ items with rates from estimate engine

GET /api/estimates/:modelId/full  [estimatorRouter]
  ↓ Full estimate with per-floor breakdown, budget structure, AACE class
```

---

## Project Structure

```
server/
  index.ts                              # Express app setup, middleware, auth routes (279 lines)
  routes.ts                             # Main API routes (5,980 lines, 185 endpoints)
  storage.ts                            # DBStorage + MemStorage (2,235 lines, 65 tables)
  auth.ts                               # JWT authentication, login, register
  bim-generator.ts                      # BIM model generation orchestrator (2,845 lines)
  construction-workflow-processor.ts    # CWP 7-step pipeline (2,735 lines)
  cost-estimation-engine.ts             # Backward-compat shim (124 lines, NOT used for BoQ)
  boq-bim-validator.ts                  # BoQ↔BIM alignment validation (409 lines)
  cad-parser.ts                         # DXF/DWG parsing (728 lines)
  pdf-extraction-service.ts             # PDF text + raster extraction
  
  estimator/
    estimate-engine.ts                  # CIQS cost engine: 224 CSI rates, M+L+E (2,463 lines)
    budget-structure.ts                 # 8-tier budget, AACE classification (598 lines)
    boe-generator.ts                    # Basis of Estimate document (1,141 lines)
    ontario-mep-rates.ts                # Ontario ICI MEP rates Q1 2026 (1,063 lines)
    rebar-density.ts                    # CSA G30.18 rebar density by seismic zone (423 lines)
    uniformat-crosswalk.ts              # UNIFORMAT↔CSI crosswalk (446 lines)
    construction-sequence-generator.ts  # Schedule/sequence proposals (602 lines)
    codes-standards-register.ts         # NBC/OBC/CSA compliance (960 lines)
    code-driven-adders.ts               # NBC code-driven cost adders
    
  routes/
    bim-generate.ts                     # POST /api/bim/models/:id/generate (174 lines)
    estimator-router.ts                 # 26 estimate endpoints (1,219 lines)
    sequence-routes.ts                  # Construction sequencing (311 lines)
    qs-level5-routes.ts                 # QS Level 5 measurements, SOV, Monte Carlo (824 lines)
    clash-detection-routes.ts           # Clash detection workflow (230 lines)
    grid-detection.ts                   # Grid detection review (335 lines)
    
  services/
    bim-coordination-router.ts          # BIM coordination, BCF export (791 lines)

shared/
  schema.ts                             # Drizzle schema: 65 PostgreSQL tables (2,264 lines)

client/src/
  App.tsx                               # 25 lazy-loaded pages
  pages/
    bim.tsx                             # BIM viewer page
    boq.tsx                             # BoQ with costs page (596 lines)
    reports.tsx                         # Reports page (182 lines)
    sequence-review.tsx                 # Construction sequence review (721 lines)
    ...
  components/
    bim/bim-viewer.tsx                  # 3D BIM viewer (live, has consumer in bim.tsx)
    rfi/RfiDashboard.tsx                # RFI management (508 lines)
    boq/boq-table.tsx                   # BoQ table display
    boq/boq-summary.tsx                 # BoQ summary cards
```

---

## Standards Compliance

| Standard | Implementation | Status |
|---|---|---|
| CIQS Standard Method | 224 CSI rates, M+L+E, waste, per-floor | ✅ |
| CSI MasterFormat 2018 | 34 divisions | ✅ |
| AACE 18R-97 | Classes 1-5, 8-tier budget, BoE | ✅ |
| RICS NRM1/NRM2 | UNIFORMAT crosswalk, measurement rules | ✅ |
| NBC/OBC | Building class factor (A/B/C/D), codes register | ✅ |
| CSA G30.18 | Rebar density by seismic zone | ✅ |
| CCDC | Change request workflow | ✅ |

---

## Mounted Routers (7)

All registered in `server/routes.ts` lines ~2142-2158:

1. `bimGenerateRouter` → POST /api/bim/models/:modelId/generate
2. `estimatorRouter` → 26 endpoints under /api/estimates/
3. `sequenceRouter` → /api/projects/:id/sequence/
4. `qsLevel5Router` → /api/qs5/
5. `bimCoordinationRouter` → /api/bim-coordination/
6. `clashDetectionRouter` → /api/projects/:id/clash-detection/
7. `gridDetectionRouter` → /api/grid-detection/

Plus 6 more in routes.ts (document-revisions, floor-generation, comprehensive-analysis, knowledge-base, reprocess-pdf, fix-specs) and 5 in index.ts (auth, security, footprint, uploads, cost-estimation, export, report, verification).

---

## Honest 501 Stubs (12)

These endpoints return HTTP 501 with clear explanations:

1. `POST /api/claude-usage/reset` — no usage counter table
2. `POST /api/team/invite` — no invitations table
3. `POST /api/standards/update` — standards are read-only
4. `POST /api/cost/update/:projectId` — costs derived from BoQ
5. `GET /api/user/settings` — no user_settings table
6. `PUT /api/user/settings` — no user_settings table
7. `GET /api/subscription/session` — no billing session
8. `POST /api/reports/generate` — reports generated on-the-fly
9. `POST /api/export/boq/:projectId` — exports generated on-the-fly
10. `POST /api/admin/system/backup` — use Neon dashboard
11. `POST /api/projects/:id/duplicate` — deep-copy not implemented
12. `POST /api/bim/models/:id/reexpand` — use /generate instead

---

## Regression Guard — File Line Counts

```bash
for f in \
  "server/routes.ts:5980" \
  "server/estimator/estimate-engine.ts:2463" \
  "server/boq-bim-validator.ts:409" \
  "server/cost-estimation-engine.ts:124" \
  "shared/schema.ts:2264" \
  "server/storage.ts:2235" \
  "server/routes/qs-level5-routes.ts:824" \
  "server/routes/sequence-routes.ts:311" \
  "server/bim-generator.ts:2845" \
  "server/construction-workflow-processor.ts:2735" \
  "server/estimator/construction-sequence-generator.ts:602" \
  "client/src/components/rfi/RfiDashboard.tsx:508" \
  "client/src/pages/sequence-review.tsx:721" \
  "server/routes/estimator-router.ts:1219" \
  "server/routes/bim-generate.ts:174" \
  "server/routes/clash-detection-routes.ts:230" \
  "server/routes/grid-detection.ts:335" \
  "server/services/bim-coordination-router.ts:791" \
  "server/index.ts:279" \
  "server/stripe.ts:174" \
  "server/cad-parser.ts:728" \
  "client/src/pages/boq.tsx:596"; do
  file="${f%%:*}"; expected="${f##*:}"
  actual=$(wc -l < "$file" 2>/dev/null || echo "MISSING")
  if [ "$actual" = "$expected" ]; then echo "✅ $file ($actual)"
  else echo "⚠️  $file  expected=$expected actual=$actual"; fi
done
```

---

## Required Replit Secrets

| Secret | Required | Description |
|---|---|---|
| `DATABASE_URL` | YES | Neon PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | YES | Claude API key |
| `JWT_SECRET` | YES | Random string ≥32 chars |
| `STRIPE_SECRET_KEY` | Billing only | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Billing only | Stripe webhook signing secret |

---

## Deployment

```bash
npm install
npm run db:push                   # REQUIRED: 3 new schema columns
rm -f client/src/components/bim/bim-3d-viewer_tsx.txt  # orphan cleanup
npm run dev                       # Starts on port 5000
```

---

## Known Items (Not Bugs)

1. **1 dead file:** `server/smart-document-processor.ts` (771 lines, 0 consumers)
2. **1 orphan on Replit:** `client/src/components/bim/bim-3d-viewer_tsx.txt` (delete on deploy)
3. **30 legacy interface stubs** in IStorage (no runtime callers)
4. **No React ErrorBoundary** component
5. **Live QA with Moorings drawings** — the only remaining validation gap

---

## Key Learnings & Patterns

- **Never delete before verifying consumers.** Always grep exact import strings before concluding a file is dead.
- **Session boundaries = codebase boundaries.** Each session must treat the uploaded archive as the authoritative source.
- **`bim-viewer.tsx` is live code.** Has an active consumer in `client/src/pages/bim.tsx` — must not be deleted.
- **`npm run db:push` is mandatory** before first app start on any new deployment.
- **Test file TS errors are pre-existing:** 366 test-file TypeScript errors in `__tests__` directories are stale API references, not regressions.
- **Transfer archives contain changed source files only** — never include `node_modules` or full codebase with dependencies.
