// server/routes/rtm-routes.ts
// ═══════════════════════════════════════════════════════════════════════════
// QA/QC Master Plan §15 Requirements Traceability Matrix API
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import {
  generateRTM, getRequirement, getGaps,
  getRequirementsByType, getRequirementsByPriority,
  getAllRequirements, getCoverageByType,
} from '../services/rtm-generator';

export const rtmRouter = Router();

// GET /api/qa/rtm/:release — Full RTM report
rtmRouter.get('/qa/rtm/:release', (req, res) => {
  const report = generateRTM(req.params.release);
  res.json(report);
});

// GET /api/qa/rtm/requirement/:id — Single requirement
rtmRouter.get('/qa/rtm/requirement/:id', (req, res) => {
  const req_ = getRequirement(req.params.id);
  if (!req_) return res.status(404).json({ error: 'Requirement not found' });
  res.json(req_);
});

// GET /api/qa/rtm/gaps — Coverage gaps only
rtmRouter.get('/qa/rtm-gaps', (req, res) => {
  res.json(getGaps());
});

// GET /api/qa/rtm/coverage — Coverage by type summary
rtmRouter.get('/qa/rtm-coverage', (req, res) => {
  res.json(getCoverageByType());
});

// GET /api/qa/requirements?type=functional&priority=critical
rtmRouter.get('/qa/requirements', (req, res) => {
  let result = getAllRequirements();
  if (req.query.type) result = result.filter(r => r.type === req.query.type);
  if (req.query.priority) result = result.filter(r => r.priority === req.query.priority);
  if (req.query.status) result = result.filter(r => r.coverageStatus === req.query.status);
  res.json(result);
});
