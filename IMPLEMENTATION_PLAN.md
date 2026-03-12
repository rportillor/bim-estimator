# EstimatorPro v15.29 — Full Fix Implementation Plan

## Phase 1: Deploy Config & Package.json
- C1: Fix `.replit` to `cd app &&` prefix all commands
- C3/C4: Clean `.env` — remove DEV_AUTH_BYPASS, fix CLIENT_ORIGIN, remove duplicate DEFAULT_LOD
- M19: CLIENT_ORIGIN set to specific origin (not `*`)
- H10: Add `nanoid` to package.json dependencies
- M18: Remove `@tailwindcss/vite` (v4 conflict with tailwindcss v3)
- M21: Move test/dev deps to devDependencies
- M5: Remove duplicate DEFAULT_LOD entries in .env

## Phase 2: Stripe Webhook & Error Handler
- C5: Add `express.raw()` route for `/api/webhook` BEFORE `express.json()` body parser
- M8: Move globalErrorHandler AFTER route registration

## Phase 3: Route Authentication & Authorization
- C6: Add `authenticateToken` to `DELETE /api/bim/models/:modelId`
- H1: Add `authenticateToken` to 6 unauthenticated routers (lines 2116-2137)
- H2: Add `requireAdmin` middleware to admin routes with role check
- H3: Identify and remove duplicate route handlers

## Phase 4: Storage getUnitRate Fix
- H4: Add `isNull(unitRates.region)` when no region is specified

## Phase 5: Estimate Engine Fix
- C7: Recompute `li.totalRate` alongside `li.totalCost` after crew factor adjustment

## Phase 6: Seed Idempotency
- M13: Check MEP and regional tables independently (not just unit_rates)

## Phase 7: Frontend API Fixes
- H5: Fix swapped apiRequest args in ChangeRequestDashboard
- H6: Fix bare fetch in rate-manager audit log
- H7: Fix CSV export auth bypass (use apiRequest + blob download)
- H8: Fix bare fetch in ChangeRequestDashboard queries
- H9: Fix bid leveling — await res.json() instead of storing Response

## Phase 8: Rate Manager Validation
- M5: Validate parseFloat inputs (NaN guard)

## Phase 9: Vite/Tailwind Config
- M2: Remove dead `@assets` alias
- M18: Remove `@tailwindcss/vite` from devDependencies

## Phase 10: Root Cleanup
- M6: Delete duplicate config files at root level

## Phase 11: Build Validation
- Run `npm run build` in app/ to verify everything compiles
