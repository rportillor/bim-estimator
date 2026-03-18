# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Contains EstimatorPro — a full-stack AI-powered construction cost estimation and BIM analysis platform.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm

### EstimatorPro (`artifacts/estimatorpro`)
- **Frontend**: React 18 + Vite + Tailwind CSS + shadcn/ui + Wouter routing
- **Backend**: Express 4 + TypeScript (tsx) — serves both API and Vite dev middleware
- **Database**: PostgreSQL + Drizzle ORM (`shared/schema.ts` — 64+ tables)
- **AI**: Anthropic Claude SDK (`@anthropic-ai/sdk`)
- **Auth**: JWT + Passport + bcryptjs + express-session
- **Payments**: Stripe (optional — disabled if STRIPE_SECRET_KEY not set)
- **File handling**: Multer, sharp, pdf-parse, pdf2pic, tesseract.js, dxf-parser
- **BIM**: web-ifc, three.js, socket.io WebSocket
- **Standards**: CIQS, AACE 18R-97, RICS NRM1/NRM2, CSI MasterFormat 2018, NBC/OBC 2024

### Shared Monorepo Packages (legacy)
- `artifacts/api-server` — Express health-check API
- `lib/api-spec` — OpenAPI spec + Orval codegen
- `lib/api-zod` / `lib/api-client-react` — Generated schemas/hooks

## Structure

```text
artifacts/estimatorpro/
├── server/              # Express API + all backend modules
│   ├── index.ts         # Entry point — reads PORT, starts server
│   ├── routes.ts        # Main router (5,365 lines — all REST endpoints)
│   ├── auth.ts          # JWT + Passport auth
│   ├── storage.ts       # Database access layer (Drizzle)
│   ├── estimator/       # 24 estimation modules (CIQS, AACE, BOQ, etc.)
│   ├── services/        # BIM coordination, clash detection, etc.
│   ├── routes/          # Modular sub-routers
│   └── middleware/      # CSP, auth, rate limiting, graceful shutdown
├── client/src/          # React frontend
│   ├── App.tsx          # Root router
│   ├── pages/           # 20+ pages (dashboard, projects, BIM, BOQ, etc.)
│   └── components/      # All UI components
├── shared/
│   └── schema.ts        # Drizzle schema (64+ PostgreSQL tables)
├── vite.config.ts       # Vite — root is client/, outDir is dist/public/
├── drizzle.config.ts    # Points to shared/schema.ts
└── package.json         # Full dependency list (v15.31.0)
```

## Required Secrets

| Secret | Required | Purpose |
|--------|----------|---------|
| `DATABASE_URL` | YES | PostgreSQL connection (auto-provisioned by Replit) |
| `ANTHROPIC_API_KEY` | YES | Claude API for AI drawing analysis |
| `JWT_SECRET` | YES | Signs authentication tokens (32+ char random string) |
| `STRIPE_SECRET_KEY` | Optional | Stripe billing (app runs without it) |
| `STRIPE_WEBHOOK_SECRET` | Optional | Stripe webhooks |

## Dev Commands

```bash
# Start dev server (Express + Vite middleware on PORT)
pnpm --filter @workspace/estimatorpro run dev

# Push DB schema changes
pnpm --filter @workspace/estimatorpro run db:push
```

## BIM Gridline System (The Moorings, P1)

### Geometry conventions (Three.js)
- X = east-west (EW), Z = north-south (NS, +north), Y = elevation (up)
- Origin: Grid A (EW=0), Grid 9 (NS=0), P1 elevation = −4.65 m

### Parser (gridline-pdf-parser.ts)
- `layer = 'gridlines'` in `real-qto-processor.ts`
- Key values: M_ew@grid9=45.671m, grid10_NS=14.819m, grid19_NS=−30.088m, Y_ew=87.472m, L_ew=41.999m
- Wing angle: 27.16° (two 13.58° turns from bearing 166.42°)
- After server restart, always `forceRefresh:true` via POST `/extract-layer`

### Viewer formula (viewer-3d.tsx)
```
axis='X': pt1=(coord + startM·tanA, y, startM), pt2=(coord + endM·tanA, y, endM)
axis='Y': pt1=(startM, y, coord),               pt2=(endM, y, coord − (endM−startM)·tanA)
```
- `coord` for X-family = EW position at NS=0; `startM`/`endM` = NS world values
- `coord` for Y-family = NS at EW=startM; `startM`/`endM` = EW world values
- Works for any angle (0° rectangular, 13.58° CL, 27.16° wing)

## Version History

- v15.31 — Full audit fixes: auth, webhook, rate engine, deploy config; BIM gridline formula fixed
- v14.36 — Dead code elimination (11 files removed, 0 TS errors)
- v14.35 — Complete hardcoded-value audit (no project-specific fallbacks)

## Architecture

```
Documents (PDFs/DWGs) → Upload → AI Analysis (Claude)
  → BIM Generation (14-batch CWP)
    → Estimate Engine (224 CSI rates, CIQS methodology)
      → BOQ (per-floor, M+L+E breakdown, cost/m², labour-hours)
        → Export (CSV / XLSX / PDF)
```

## User Preferences

Preferred communication style: Simple, everyday language.
