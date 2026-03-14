import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { autoResumeProcessing } from "./services/background-processor";
import { setupVite, serveStatic, log } from "./vite";
import { setupWebSocket } from "./websocket";
import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";
import cors from "cors";
import { sanitizeInput, securityLogger } from "./security";
import { globalErrorHandler } from "./middleware/error-handler";
import { setupCSPHeaders, setupCSRFProtection, setupSecureCookies, handleCSPViolation } from "./middleware/csp-security";
import { setupGracefulShutdown } from "./middleware/graceful-shutdown";
import { authenticateToken, register, login } from "./auth";
import { startSimilarityEvictionScheduler } from "./services/similarity-scheduler";
import { storage } from "./storage";

// ── Idx-only routers (NOT registered in routes.ts) ──────────────────────────
import authTokensRouter from "./routes/auth-tokens";
import securityStatusRouter from "./routes/security-status";
import { footprintRouter } from "./routes/footprint";
import { uploadsRouter } from "./routes/uploads";
import { costEstimationRouter } from "./routes/cost-estimation";
import { exportRouter } from "./routes/export-routes";
import { reportRouter } from "./routes/report-routes";
import verificationRouter from "./routes/verification";
import { processingStatusRouter } from "./routes/processing-status";

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: All other routers (bimGenerateRouter, estimatorRouter,
// estimatesCIQSRouter, clashDetectionRouter, gridDetectionRouter, etc.) are
// registered exclusively inside registerRoutes() in routes.ts WITH
// authenticateToken middleware. Their former mounts here (without auth) have
// been REMOVED — they were silently bypassing authentication.
// routes.ts is the canonical and only registration point for those routers.
// ─────────────────────────────────────────────────────────────────────────────

const app = express();

// Trust proxy for rate limiting accuracy in production
app.set("trust proxy", 1);

// Enterprise security headers with CSP
app.use(setupCSPHeaders);
app.use(setupCSRFProtection);
app.use(setupSecureCookies);

// Legacy security headers (backwards compatibility)
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  // X-Frame-Options: allow embedding in Replit preview iframe (dev); deny in production
  if (process.env.NODE_ENV !== "development") {
    res.setHeader("X-Frame-Options", "DENY");
  }
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.removeHeader("X-Powered-By");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  next();
});

// CORS — allow Replit preview domains in development; lock down in production
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // server-to-server / curl
    if (process.env.CLIENT_ORIGIN && process.env.CLIENT_ORIGIN !== "*") {
      return callback(null, origin === process.env.CLIENT_ORIGIN);
    }
    if (process.env.NODE_ENV === "development") {
      // Allow all replit.dev preview domains and localhost
      if (/\.replit\.dev$/.test(origin) || /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
    }
    return callback(null, false);
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-CSRF-Token"],
}));

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: "Too many requests from this IP, please try again later.", retryAfter: "15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many login attempts from this IP, please try again later.", retryAfter: "15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 100,
  delayMs: () => 500,
  validate: { delayMs: false },
});

app.use("/api/", generalLimiter);
app.use("/api/", speedLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);

// Stripe webhook needs raw body — must be registered BEFORE express.json()
app.post("/api/webhook", express.raw({ type: "application/json" }));

// Body parsing
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false, limit: "5mb" }));

// Security middleware
app.use(securityLogger);
app.use(sanitizeInput);

// Cache-control for API responses
app.use((req, res, next) => {
  res.removeHeader("X-Powered-By");
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse && !path.includes("/auth") && !path.includes("/login") && !path.includes("/register")) {
        const sanitized = { ...capturedJsonResponse };
        for (const key of ['password', 'token', 'accessToken', 'refreshToken', 'apiKey', 'secret', 'stripeCustomerId']) {
          if (key in sanitized) sanitized[key] = '[REDACTED]';
        }
        logLine += ` :: ${JSON.stringify(sanitized)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    }
  });

  next();
});

// ── BIM elements endpoint (authenticated) ───────────────────────────────────
app.get("/api/bim/models/:modelId/elements", authenticateToken, async (req, res) => {
  try {
    const modelId = req.params.modelId;
    const all = await storage.getBimElements(modelId);
    const limit = Math.max(0, Number(req.query.limit ?? 0));   // 0 = return all
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    const data = limit ? all.slice(offset, offset + limit) : all;
    res.json({ data, total: all.length, limit: limit || all.length, offset });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Failed to read BIM elements" });
  }
});

// ── Authentication routes (no wrapper — these ARE the auth) ─────────────────
app.use("/api/auth", authTokensRouter);

// Register + login must be declared here (before the /api protected middlewares below)
// so authenticateToken on those middlewares doesn't intercept them first.
app.post("/api/auth/register", register);
app.post("/api/auth/login", login);

// ── Security monitoring (authenticated — exposes internal system details) ────
app.use("/api/security", authenticateToken, securityStatusRouter);

// ── CSP violation reporting ───────────────────────────────────────────────────
app.post("/api/csp-violation", express.json({ type: "application/csp-report" }), handleCSPViolation);

// ── Idx-only routers (with authentication) ───────────────────────────────────
// These endpoints are NOT in routes.ts.

// POST /api/bim/models/:modelId/footprint/ensure
app.use("/api", authenticateToken, footprintRouter);

// /api/uploads/initiate | /uploads/:id/chunk | /uploads/:id/complete
// SECURITY FIX: Added authenticateToken — uploads were previously unauthenticated
app.use("/api", authenticateToken, uploadsRouter);

// GET|POST /api/cost-estimation/estimate|search|trends/:region|quick
app.use("/api/cost-estimation", authenticateToken, costEstimationRouter);

// POST /api/export/*  (IFC4, MS Project XML, XLSX, CSV, JSON exports)
app.use("/api", authenticateToken, exportRouter);

// POST /api/reports/*  (BOQ, Bid-Leveling, Clash, Constructability, Executive, Gap, SOV)
app.use("/api", authenticateToken, reportRouter);

// POST /api/verification/:projectId/check
// GET  /api/verification/:projectId/content-comparison
app.use("/api/verification", authenticateToken, verificationRouter);

// Processing status — scoped to /api/bim/models so auth only applies to these routes
app.use("/api/bim/models", processingStatusRouter);

// ── Background services ───────────────────────────────────────────────────────
startSimilarityEvictionScheduler();

// Background processor: production-only or explicit opt-in
if (process.env.NODE_ENV === "production" || process.env.FORCE_BACKGROUND_PROCESSOR === "true") {
  (async () => {
    try {
      setTimeout(async () => {
        const { initializeBackgroundProcessor } = await import("./batch-processor");
        await initializeBackgroundProcessor();
      }, 10000);
    } catch (error) {
      console.error("Failed to initialize background processor:", error);
    }
  })();
}

// ── Async startup ─────────────────────────────────────────────────────────────
(async () => {
  // registerRoutes() mounts ALL other routers WITH authenticateToken middleware.
  // See server/routes.ts for the canonical, authoritative route registration.
  const server = await registerRoutes(app);

  // Dev utility: list all registered routes (authenticated, dev-only)
  if (process.env.NODE_ENV === "development") {
    function listRoutes(application: any) {
      const out: any[] = [];
      application._router.stack.forEach((layer: any) => {
        if (layer.route) {
          out.push({ path: layer.route.path, methods: Object.keys(layer.route.methods) });
        } else if (layer.name === "router" && layer.handle?.stack) {
          layer.handle.stack.forEach((l: any) => {
            if (l.route) out.push({ path: l.route.path, methods: Object.keys(l.route.methods) });
          });
        }
      });
      return out;
    }
    app.get("/api/__routes", authenticateToken, (_req, res) => res.json(listRoutes(app)));
  }

  // Global error handler — MUST be registered after all routes
  app.use(globalErrorHandler);

  // Express error handler (after all routes)
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    if (!res.headersSent) {
      res.status(status).json({ message });
    }
    // Log the error instead of re-throwing (which would crash the process)
    console.error(`[ERROR] ${status}: ${message}`, err.stack || err);
  });

  // Serve frontend
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  setupWebSocket(server);

  server.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
    log(`serving on port ${port} with WebSocket support`);

    // QA/QC Master Plan §10.3 — Graceful Shutdown (SIGTERM/SIGINT drain)
    setupGracefulShutdown(server, { timeout: 30000 });

    // Seed DB rate tables from hardcoded constants (idempotent)
    import('./seed-rates').then(m => m.seedRateTables()).catch(err => {
      console.warn('[startup] Rate table seeding failed (non-blocking):', err.message);
    });

    // Auto-resume any interrupted BIM processing on startup
    setTimeout(() => {
      autoResumeProcessing().catch(error => {
        console.error("Failed to auto-resume BIM processing:", error);
      });
    }, 5000);
  });
})();
