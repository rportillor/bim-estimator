import express, { type Express } from "express";
import cors from "cors";
import { createProxyMiddleware } from "http-proxy-middleware";

const app: Express = express();

app.use(cors());

// Health check — handled directly, no body parsing needed
app.get("/api/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// Proxy everything else to EstimatorPro.
// This must come BEFORE express.json() so the raw request body stream is still intact.
const estimatorPort = process.env.ESTIMATORPRO_PORT || "22800";
app.use(
  createProxyMiddleware({
    target: `http://localhost:${estimatorPort}`,
    changeOrigin: true,
  })
);

export default app;
