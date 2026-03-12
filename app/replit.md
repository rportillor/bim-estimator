# EstimatorPro — Replit Deployment Guide

## Version: v15.29

**EstimatorPro** is a professional AI-powered construction cost estimation and BIM analysis platform for Canadian projects. It complies with CIQS, AACE 18R-97, RICS NRM1/NRM2, CSI MasterFormat 2018, NBC/OBC 2024, CSA G30.18/A23.3, and CCDC standards.

---

## Required Secrets (Replit → Secrets tab)

| Secret | Required | Description |
|---|---|---|
| `DATABASE_URL` | **YES** | Neon PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | **YES** | Claude API key for drawing analysis |
| `JWT_SECRET` | **YES** | Random string ≥32 chars for auth tokens |
| `STRIPE_SECRET_KEY` | Billing only | Stripe secret key (sk_live_… or sk_test_…) |
| `STRIPE_WEBHOOK_SECRET` | Billing only | Stripe webhook signing secret |

---

## First-Time Deployment

```bash
# 1. Install dependencies (Replit does this automatically)
npm install

# 2. Push schema to database — MANDATORY before first start
# v15.29: New columns: building_class, complexity, risk_profile on projects table
npm run db:push

# 3. Delete orphan file (leftover from v14.6, confirmed no consumers)
rm -f client/src/components/bim/bim-3d-viewer_tsx.txt

# 4. Start the application
npm run dev
```

The app serves on **port 5000**. The Vite dev server and Express API share the same port via Vite's proxy configuration.

---

## Subsequent Deployments (no schema changes)

```bash
npm run dev
```

Only run `npm run db:push` again if `shared/schema.ts` was modified.

---

## Production Build

```bash
npm run build
npm run start
```

---

## Architecture

```
Documents (PDFs/DWGs) → Upload → AI Analysis (Claude)
  → BIM Generation (14-batch CWP)
    → Estimate Engine (218 CSI rates, CIQS methodology)
      → BOQ (per-floor, M+L+E breakdown, cost/m², labour-hours)
        → Export (CSV / XLSX / PDF)
```

### Key Files

| File | Purpose |
|---|---|
| `server/estimator/estimate-engine.ts` | 218 CSI rates, CIQS methodology, AACE class |
| `server/construction-workflow-processor.ts` | 14-batch AI document analysis pipeline |
| `server/bim-generator.ts` | BIM element generation from drawings |
| `server/estimator/boe-generator.ts` | Basis of Estimate document (AACE RP 34R-05) |
| `server/estimator/ontario-mep-rates.ts` | Ontario MEP market rates (Div 21–28) |
| `server/routes/estimator-router.ts` | BOQ-with-costs dual-engine endpoint |
| `shared/schema.ts` | Drizzle ORM schema (64 tables) |

---

## QS Compliance Status (v15.29)

| Standard | Requirement | Status |
|---|---|---|
| CIQS | CSI MasterFormat 2018 (34 divisions) | ✅ |
| CIQS | 224 CSI rates with M+L+E breakdown | ✅ |
| CIQS | Waste factors per CSI code | ✅ |
| CIQS | Canadian regional cost adjustment | ✅ |
| CIQS | Single-source pricing (unified engine) | ✅ |
| CIQS | Estimate audit trail (analysisResults) | ✅ |
| AACE 18R-97 | AACE Classes 1–5 classification | ✅ |
| AACE 18R-97 | 8-tier budget structure | ✅ |
| AACE 18R-97 | Basis of Estimate (BoE) | ✅ |
| NRM2 | Measurement rules (m², m³, m, ea) | ✅ |
| NRM1 | UNIFORMAT crosswalk | ✅ |
| CSA G30.18 | Rebar density by seismic zone | ✅ |
| NBC/OBC | Building class cost factor (A/B/C/D) | ✅ |
| NBC/OBC | Codes & standards register | ✅ |

### QS 7-Step Pipeline
| Step | Description | Status |
|---|---|---|
| 1 | Specs → Products (Claude API) | ✅ |
| 2 | Legend as global context | ✅ |
| 3 | Products → Assemblies (section drawings) | ✅ |
| 4 | Assemblies + Coordinates → Elements | ✅ |
| 5 | Elements saved with real coordinates | ✅ |
| 6 | CIQS estimate auto-generated | ✅ |
| 7 | RFIs from missing data | ✅ |

---

## Open RFIs (required before final estimate sign-off)

| RFI | Impact | Description |
|---|---|---|
| RFI-023 | ~600 m² GFA gap | A203/A206/A209 drawings missing (19 units) |
| RFI-SPEC-02 | ±$500K uncertainty | No Div 03 concrete spec — mix design unknown |
| RFI-SPEC-03 | $2.44M as allowance | No MEP specs Div 21–28 |

---

## Environment Variables (Optional Tuning)

These are **optional** — defaults are safe for production. Do not set unless you have a specific reason:

- `UPLOAD_MAX_MB` — max upload file size in MB (default: 100)
- `CLAUDE_TIMEOUT_MS` — AI analysis timeout (default: 300000)
- `NODE_ENV` — set to `production` for production hardening

---

## User Preferences

Preferred communication style: Simple, everyday language.
