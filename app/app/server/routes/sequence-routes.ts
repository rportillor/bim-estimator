// server/routes/sequence-routes.ts
// =============================================================================
// CONSTRUCTION SEQUENCE ROUTES
// =============================================================================
//
// Endpoints:
//
//   POST /api/projects/:projectId/sequence/propose
//     → AI generates a proposed sequence from the model; status = 'proposed'
//     → Saves to constructionSequences table; returns proposal for UI review
//
//   GET  /api/projects/:projectId/sequence
//     → Returns the latest sequence (proposed or confirmed)
//
//   PUT  /api/projects/:projectId/sequence/:sequenceId/confirm
//     → QS submits confirmed (possibly edited) activity list
//     → status → 'confirmed'; confirmedData saved; ready for P6 export
//
//   POST /api/projects/:projectId/sequence/:sequenceId/export/xer
//     → Download Primavera P6 XER file (confirmed sequences only)
//
//   POST /api/projects/:projectId/sequence/:sequenceId/export/ms-project
//     → Download MS Project XML (confirmed or proposed)
//
//   DELETE /api/projects/:projectId/sequence/:sequenceId
//     → Reject and delete a proposed sequence
//
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { authenticateToken } from '../auth';
import { storage } from '../storage';
import {
  ConstructionSequenceGenerator,
  generateP6XER,
  generateSequenceMSProjectXML,
  type ConstructionSequenceProposal,
  type SequenceActivity,
} from '../estimator/construction-sequence-generator';

export const sequenceRouter = Router();
sequenceRouter.use(authenticateToken);

// ─── POST /api/projects/:projectId/sequence/propose ─────────────────────────

sequenceRouter.post('/projects/:projectId/sequence/propose', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { modelId, projectStartDate } = req.body;

  if (!modelId) {
    return res.status(400).json({ error: 'modelId is required' });
  }

  try {
    // 1. Load BIM model
    const model = await storage.getBimModel(modelId);
    if (!model) return res.status(404).json({ error: 'BIM model not found' });
    if (model.projectId !== projectId) {
      return res.status(403).json({ error: 'Model does not belong to this project' });
    }

    // 2. Load project
    const project = await storage.getProject(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // 3. Load estimate
    const estimateRows = await (storage as any).getEstimateByModel?.(modelId) ?? null;
    if (!estimateRows) {
      return res.status(400).json({
        error: 'No estimate found for this model. Run the estimate first.',
      });
    }

    // 4. Load BIM storeys for ordered floor list
    const storeys = await storage.getBimStoreys(modelId);
    const floors  = storeys.length > 0
      ? storeys.map((s: any) => s.name || s.storeyName || `Floor ${s.sortOrder}`)
      : ['B1', 'Ground', '1st', '2nd', '3rd', '4th', '5th'];

    // 5. Extract geometry metadata
    const geo      = (model.geometryData as any) || {};
    const analysis = ((model as any).analysisData) || {};

    const constructionType = geo.constructionType || analysis.constructionType || 'cip-concrete';
    const gfa              = geo.gfa || analysis.gfa || analysis.grossFloorArea || 0;
    const occupancyGroup   = analysis.occupancyGroup || geo.occupancyGroup || null;
    const seismicZone      = analysis.seismicZone || geo.seismicZone || null;

    // 6. Generate proposal
    const generator = new ConstructionSequenceGenerator();
    const proposal  = await generator.propose({
      projectId,
      modelId,
      projectName:      project.name,
      constructionType,
      floors,
      floorCount:       (model as any).floorCount || floors.length,
      gfa:              Number(gfa),
      estimate:         estimateRows,
      projectStartDate: projectStartDate || null,
      occupancyGroup,
      seismicZone,
      geometryData:     geo,
    });

    // 7. Save to DB
    const saved = await (storage as any).createConstructionSequence({
      projectId,
      modelId,
      status:           'proposed',
      proposedData:     proposal,
      confirmedData:    null,
      confirmedBy:      null,
      confirmedAt:      null,
      qsNotes:          null,
      aiRationale:      proposal.rationale,
      aiWarnings:       proposal.warnings,
      projectStartDate: proposal.estimatedStartDate,
      workingDaysPerWeek: 5,
      holidays:         [],
    });

    res.json({
      sequenceId:  saved.id,
      status:      'proposed',
      proposal,
      message:     `AI proposed ${proposal.activities.length} activities over ${proposal.totalDurationDays} working days. Review and confirm before exporting to P6.`,
    });

  } catch (err: any) {
    console.error('[sequence/propose]', err);
    res.status(500).json({ error: 'Failed to generate sequence proposal', details: err.message });
  }
});

// ─── GET /api/projects/:projectId/sequence ───────────────────────────────────

sequenceRouter.get('/projects/:projectId/sequence', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { modelId }   = req.query as { modelId?: string };

  try {
    const seq = await (storage as any).getLatestConstructionSequence(projectId, modelId);
    if (!seq) {
      return res.status(404).json({ error: 'No construction sequence found for this project' });
    }
    res.json(seq);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch sequence', details: err.message });
  }
});

// ─── PUT /api/projects/:projectId/sequence/:sequenceId/confirm ───────────────

sequenceRouter.put('/projects/:projectId/sequence/:sequenceId/confirm', async (req: Request, res: Response) => {
  const { projectId, sequenceId } = req.params;
  const { activities, qsNotes, projectStartDate }: {
    activities:       SequenceActivity[];
    qsNotes:          string;
    projectStartDate: string;
  } = req.body;

  if (!activities || !Array.isArray(activities) || activities.length === 0) {
    return res.status(400).json({ error: 'activities array is required and must not be empty' });
  }

  try {
    const existing = await (storage as any).getConstructionSequence(sequenceId);
    if (!existing) return res.status(404).json({ error: 'Sequence not found' });
    if (existing.projectId !== projectId) {
      return res.status(403).json({ error: 'Sequence does not belong to this project' });
    }

    // Mark any QS-edited activities
    const proposed: ConstructionSequenceProposal = existing.proposedData as any;
    const proposedMap = new Map(proposed.activities.map(a => [a.activityId, a]));

    const confirmedActivities: SequenceActivity[] = activities.map(a => ({
      ...a,
      qsEdited: isEdited(a, proposedMap.get(a.activityId)),
    }));

    const confirmedData: ConstructionSequenceProposal = {
      ...proposed,
      activities:    confirmedActivities,
      estimatedStartDate: projectStartDate || proposed.estimatedStartDate,
    };

    const updated = await (storage as any).confirmConstructionSequence(sequenceId, {
      confirmedData,
      confirmedBy:  (req as any).user?.id || 'qs-user',
      confirmedAt:  new Date(),
      qsNotes:      qsNotes || null,
      status:       'confirmed',
    });

    res.json({
      sequenceId,
      status:    'confirmed',
      confirmed: updated,
      message:   `Sequence confirmed with ${confirmedActivities.length} activities. Ready to export to Primavera P6.`,
    });

  } catch (err: any) {
    console.error('[sequence/confirm]', err);
    res.status(500).json({ error: 'Failed to confirm sequence', details: err.message });
  }
});

// ─── POST /api/projects/:projectId/sequence/:sequenceId/export/xer ──────────

sequenceRouter.post('/projects/:projectId/sequence/:sequenceId/export/xer', async (req: Request, res: Response) => {
  const { projectId, sequenceId } = req.params;

  try {
    const seq = await (storage as any).getConstructionSequence(sequenceId);
    if (!seq) return res.status(404).json({ error: 'Sequence not found' });
    if (seq.projectId !== projectId) return res.status(403).json({ error: 'Forbidden' });

    if (seq.status !== 'confirmed') {
      return res.status(400).json({
        error: 'Sequence must be confirmed by the QS before exporting to P6.',
        status: seq.status,
      });
    }

    const proposal: ConstructionSequenceProposal = (seq.confirmedData || seq.proposedData) as any;
    const project  = await storage.getProject(projectId);
    const projCode = (project?.name || 'PROJ').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 10);

    const xer      = generateP6XER(proposal, projCode);
    const filename = `${projCode}_P6_Schedule.xer`;

    // Update export audit trail
    await (storage as any).updateSequenceExport(sequenceId, {
      lastExportedAt:     new Date(),
      lastExportFormat:   'xer',
      status:             'exported',
    });

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xer);

  } catch (err: any) {
    console.error('[sequence/export/xer]', err);
    res.status(500).json({ error: 'Failed to export XER', details: err.message });
  }
});

// ─── POST /api/projects/:projectId/sequence/:sequenceId/export/ms-project ───

sequenceRouter.post('/projects/:projectId/sequence/:sequenceId/export/ms-project', async (req: Request, res: Response) => {
  const { projectId, sequenceId } = req.params;

  try {
    const seq = await (storage as any).getConstructionSequence(sequenceId);
    if (!seq) return res.status(404).json({ error: 'Sequence not found' });
    if (seq.projectId !== projectId) return res.status(403).json({ error: 'Forbidden' });

    const proposal: ConstructionSequenceProposal = (seq.confirmedData || seq.proposedData) as any;
    const project   = await storage.getProject(projectId);
    const projCode  = (project?.name || 'PROJ').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 10);

    const xml      = generateSequenceMSProjectXML(proposal, projCode);
    const filename = `${projCode}_Schedule.xml`;

    await (storage as any).updateSequenceExport?.(sequenceId, {
      lastExportedAt:   new Date(),
      lastExportFormat: 'ms-project-xml',
    });

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xml);

  } catch (err: any) {
    res.status(500).json({ error: 'Failed to export MS Project XML', details: err.message });
  }
});

// ─── DELETE /api/projects/:projectId/sequence/:sequenceId ───────────────────

sequenceRouter.delete('/projects/:projectId/sequence/:sequenceId', async (req: Request, res: Response) => {
  const { projectId, sequenceId } = req.params;

  try {
    const seq = await (storage as any).getConstructionSequence(sequenceId);
    if (!seq) return res.status(404).json({ error: 'Sequence not found' });
    if (seq.projectId !== projectId) return res.status(403).json({ error: 'Forbidden' });

    await (storage as any).deleteConstructionSequence(sequenceId);
    res.json({ message: 'Sequence deleted. You may generate a new proposal.' });

  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete sequence', details: err.message });
  }
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function isEdited(current: SequenceActivity, original?: SequenceActivity): boolean {
  if (!original) return true; // new activity added by QS
  return (
    current.durationDays !== original.durationDays ||
    current.predecessors.join(',') !== original.predecessors.join(',') ||
    current.lagDays !== original.lagDays ||
    current.name !== original.name ||
    current.floors.join(',') !== original.floors.join(',')
  );
}
