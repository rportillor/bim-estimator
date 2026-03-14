/**
 * 📋 RFI (Request for Information) API Routes
 * Provides endpoints for managing RFIs generated from compliance analysis
 */

import { Router } from 'express';
import { db } from '../db';
import { rfis, rfiAttachments, projects } from '@shared/schema';
import { eq, and, count } from 'drizzle-orm';
import { rfiService } from '../rfi-service';

const router = Router();

/**
 * GET /api/rfis/:projectId - Get all RFIs for a project
 */
router.get('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    
    // Verify project exists
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const summary = await rfiService.getProjectRFISummary(projectId);
    
    res.json({
      projectId,
      summary: summary.summary,
      rfis: summary.rfis
    });
    
  } catch (error) {
    console.error('❌ Failed to get project RFIs:', error);
    res.status(500).json({ error: 'Failed to fetch project RFIs' });
  }
});

/**
 * GET /api/rfis/:projectId/:rfiId - Get specific RFI details
 */
router.get('/:projectId/:rfiId', async (req, res) => {
  try {
    const { projectId, rfiId } = req.params;
    
    const [rfi] = await db
      .select()
      .from(rfis)
      .where(and(eq(rfis.id, rfiId), eq(rfis.projectId, projectId)));
    
    if (!rfi) {
      return res.status(404).json({ error: 'RFI not found' });
    }
    
    // Get attachments
    const attachments = await db
      .select()
      .from(rfiAttachments)
      .where(eq(rfiAttachments.rfiId, rfiId));
    
    res.json({
      rfi,
      attachments
    });
    
  } catch (error) {
    console.error('❌ Failed to get RFI details:', error);
    res.status(500).json({ error: 'Failed to fetch RFI details' });
  }
});

/**
 * PATCH /api/rfis/:projectId/:rfiId - Update RFI status/response
 */
router.patch('/:projectId/:rfiId', async (req, res) => {
  try {
    const { projectId, rfiId } = req.params;
    const { status, responseDetails, reviewedBy } = req.body;
    
    const updateData: any = {};
    
    if (status) {
      updateData.status = status;
      if (status === 'Responded') {
        updateData.answeredAt = new Date();
        updateData.responseReceived = true;
      }
      if (status === 'Closed') {
        updateData.resolvedAt = new Date();
      }
    }
    
    if (responseDetails) {
      updateData.responseDetails = responseDetails;
    }
    
    if (reviewedBy) {
      updateData.answeredBy = reviewedBy;
    }
    
    const [updatedRfi] = await db
      .update(rfis)
      .set(updateData)
      .where(and(eq(rfis.id, rfiId), eq(rfis.projectId, projectId)))
      .returning();
    
    if (!updatedRfi) {
      return res.status(404).json({ error: 'RFI not found' });
    }
    
    res.json({
      message: 'RFI updated successfully',
      rfi: updatedRfi
    });
    
  } catch (error) {
    console.error('❌ Failed to update RFI:', error);
    res.status(500).json({ error: 'Failed to update RFI' });
  }
});

/**
 * POST /api/rfis/:projectId/manual - Create manual RFI (user-generated)
 */
router.post('/:projectId/manual', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { subject, question, priority, fromName, fromCompany, toName, toCompany } = req.body;
    
    // Verify project exists
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Generate RFI number
    const [rfiCount] = await db
      .select({ count: count() })
      .from(rfis)
      .where(eq(rfis.projectId, projectId));
    
    const rfiNumber = `RFI-${(rfiCount.count + 1).toString().padStart(3, '0')}`;
    
    const [newRfi] = await db.insert(rfis).values({
      projectId,
      rfiNumber,
      subject,
      question,
      priority: priority || 'Medium',
      fromName,
      fromCompany,
      toName,
      toCompany,
      // submittedBy field omitted - will be handled when user auth is implemented
      responseRequired: true,
      generatedFromConflict: false
    }).returning();
    
    res.status(201).json({
      message: 'Manual RFI created successfully',
      rfi: newRfi
    });
    
  } catch (error) {
    console.error('❌ Failed to create manual RFI:', error);
    res.status(500).json({ error: 'Failed to create manual RFI' });
  }
});

/**
 * GET /api/rfis/:projectId/stats - Get RFI statistics for project dashboard
 */
router.get('/:projectId/stats', async (req, res) => {
  try {
    const { projectId } = req.params;
    
    const summary = await rfiService.getProjectRFISummary(projectId);
    
    res.json({
      projectId,
      stats: {
        total: summary.summary.total,
        open: summary.summary.open,
        pending: summary.summary.pending,
        resolved: summary.summary.resolved,
        critical: summary.summary.critical,
        high: summary.summary.high,
        autoGenerated: summary.rfis.filter((r: any) => r.generatedFromConflict).length,
        manual: summary.rfis.filter((r: any) => !r.generatedFromConflict).length,
        byType: summary.summary.byType
      }
    });
    
  } catch (error) {
    console.error('❌ Failed to get RFI stats:', error);
    res.status(500).json({ error: 'Failed to fetch RFI statistics' });
  }
});

export default router;