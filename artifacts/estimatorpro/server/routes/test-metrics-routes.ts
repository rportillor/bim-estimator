// server/routes/test-metrics-routes.ts
// ═══════════════════════════════════════════════════════════════════════════
// QA/QC Master Plan §14 Test Metrics & Reporting
// API endpoints for test metrics collection, dashboard, and exit criteria
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import {
  recordTestRun, recordDefect, updateDefect,
  generateDashboard, checkExitCriteria,
  getTestRuns, getDefects,
} from '../services/test-metrics-collector';

export const testMetricsRouter = Router();

// POST /api/qa/test-run — record a completed test run
testMetricsRouter.post('/qa/test-run', async (req, res) => {
  try {
    const run = recordTestRun(req.body);
    res.status(201).json(run);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/qa/test-runs?release=v14.4
testMetricsRouter.get('/qa/test-runs', async (req, res) => {
  const runs = getTestRuns();
  const release = req.query.release as string;
  res.json(release ? runs.filter(r => r.releaseVersion === release) : runs);
});

// POST /api/qa/defect — record a new defect
testMetricsRouter.post('/qa/defect', async (req, res) => {
  try {
    const defect = recordDefect(req.body);
    res.status(201).json(defect);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// PATCH /api/qa/defect/:id — update defect status/resolution
testMetricsRouter.patch('/qa/defect/:id', async (req, res) => {
  const defect = updateDefect(req.params.id, req.body);
  if (!defect) return res.status(404).json({ error: 'Defect not found' });
  res.json(defect);
});

// GET /api/qa/defects?release=v14.4&severity=S1
testMetricsRouter.get('/qa/defects', async (req, res) => {
  let result = getDefects();
  if (req.query.release) result = result.filter(d => d.releaseVersion === req.query.release);
  if (req.query.severity) result = result.filter(d => d.severity === req.query.severity);
  if (req.query.status) result = result.filter(d => d.status === req.query.status);
  res.json(result);
});

// GET /api/qa/dashboard/:release — §14.1 Key Metrics Dashboard
testMetricsRouter.get('/qa/dashboard/:release', async (req, res) => {
  const dashboard = generateDashboard(req.params.release, 153);
  res.json(dashboard);
});

// GET /api/qa/exit-criteria/:release — §2.3 Entry/Exit Criteria
testMetricsRouter.get('/qa/exit-criteria/:release', async (req, res) => {
  const result = checkExitCriteria(req.params.release);
  res.json(result);
});

// GET /api/qa/go-no-go/:release — §16 Deployment Authorization
testMetricsRouter.get('/qa/go-no-go/:release', async (req, res) => {
  const exit = checkExitCriteria(req.params.release);
  const dashboard = generateDashboard(req.params.release, 153);
  res.json({
    release: req.params.release,
    decision: exit.passed ? 'GO' : 'NO-GO',
    exitCriteria: exit,
    metrics: {
      passRate: dashboard.passRate,
      codeCoverage: dashboard.codeCoverage,
      openS1S2: dashboard.defects.bySeverity['S1'] || 0 + (dashboard.defects.bySeverity['S2'] || 0),
      defectDensity: dashboard.defectDensity,
    },
    timestamp: new Date().toISOString(),
  });
});
