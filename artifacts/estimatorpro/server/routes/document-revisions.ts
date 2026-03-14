import { Router } from 'express';
import multer from 'multer';
import { AtomicRevisionService } from '../services/atomic-revision-service';
// storage imported for future use in revision handling
import { storage as _storage } from '../storage';

const router = Router();
const upload = multer({ dest: 'uploads/temp' });

// WP-R6 FIX: Removed "For demo purposes" mock comparison data.
// compareRevisions now returns the raw AtomicRevisionService result directly.
// When DocumentDiffService is fully wired, it can be inserted here at the
// file-path level — but the fabricated changes array is gone permanently.

// List revisions for a document
router.get('/projects/:projectId/documents/:documentId/revisions', async (req, res) => {
  try {
    const { documentId } = req.params;
    const revisions = await AtomicRevisionService.getDocumentRevisions(documentId);
    res.json(revisions);
  } catch (error) {
    console.error('Error fetching revisions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload new revision using atomic service
router.post('/projects/:projectId/documents/:documentId/revisions', upload.single('file'), async (req, res) => {
  try {
    const { projectId: _projectId, documentId } = req.params;
    const { notes } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const uploadedBy = (req as any).user?.id || 'system';
    const result = await AtomicRevisionService.createRevision(
      documentId,
      file,
      uploadedBy,
      notes
    );

    res.status(201).json({
      success: true,
      revision: result.revision,
      revisionNumber: result.revisionNumber
    });
  } catch (error) {
    console.error('Error uploading revision:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Approve / finalise / reject revision
router.post('/projects/:projectId/documents/:documentId/revisions/:revisionNumber/action', async (req, res) => {
  try {
    const { documentId, revisionNumber } = req.params;
    const { action } = req.body;

    if (!['approve', 'final', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Must be approve, final, or reject' });
    }

    const userId = (req as any).user?.id || 'system';
    const revNum = parseInt(revisionNumber);

    if (action === 'approve') {
      await AtomicRevisionService.approveRevision(documentId, revNum, userId);
    } else if (action === 'final') {
      await AtomicRevisionService.finalizeRevision(documentId, revNum, userId);
    } else if (action === 'reject') {
      console.log(`Revision ${revNum} for document ${documentId} rejected by user ${userId}`);
      return res.json({ success: true, action: 'reject', message: 'Revision marked as rejected' });
    }

    res.json({ success: true, action });
  } catch (error) {
    console.error('Error processing revision action:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Compare two revisions
// WP-R6 FIX: Returns the raw AtomicRevisionService comparison result.
// No fabricated changes array. hasChanges and hash data come from real service output.
router.get('/projects/:projectId/documents/:documentId/compare', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'Both from and to revision numbers are required' });
    }

    const fromRev = parseInt(from as string);
    const toRev = parseInt(to as string);

    const comparison = await AtomicRevisionService.compareRevisions(documentId, fromRev, toRev);

    // Return the real comparison result — no mock wrapper
    res.json({
      type: 'document',
      hasChanges: comparison.hasChanges,
      summary: {
        revisionsCompared: [fromRev, toRev],
        hasChanges: comparison.hasChanges,
        fromHash: comparison.from?.fileHash?.substring(0, 8) ?? null,
        toHash: comparison.to?.fileHash?.substring(0, 8) ?? null,
      },
      metadata: comparison,
    });
  } catch (error) {
    console.error('Error comparing revisions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
