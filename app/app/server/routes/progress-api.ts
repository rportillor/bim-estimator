// server/routes/progress-api.ts
// ✅ SYSTEM FIX: Real-time progress tracking API endpoints

import { Router } from "express";
import { ProgressTracker } from "../helpers/progress-tracker";

export const progressRouter = Router();

// Get progress for a specific operation
progressRouter.get("/progress/:operationId", (req, res) => {
  try {
    const { operationId } = req.params;
    const tracker = ProgressTracker.getTracker(operationId);
    
    if (!tracker) {
      return res.status(404).json({ 
        error: 'Operation not found',
        message: 'This operation may have completed or expired' 
      });
    }
    
    res.json(tracker.getStatus());
  } catch (error) {
    res.status(500).json({ error: 'Failed to get progress status' });
  }
});

// Get all active operations
progressRouter.get("/progress", (req, res) => {
  try {
    const allTrackers = ProgressTracker.getAllTrackers();
    res.json(allTrackers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get progress status' });
  }
});

// Server-Sent Events for real-time progress updates
progressRouter.get("/progress/:operationId/stream", (req, res) => {
  const { operationId } = req.params;
  
  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });
  
  // Send initial status
  const tracker = ProgressTracker.getTracker(operationId);
  if (tracker) {
    res.write(`data: ${JSON.stringify(tracker.getStatus())}\n\n`);
  } else {
    res.write(`data: ${JSON.stringify({ error: 'Operation not found' })}\n\n`);
    res.end();
    return;
  }
  
  // Set up periodic updates
  const interval = setInterval(() => {
    const currentTracker = ProgressTracker.getTracker(operationId);
    if (currentTracker) {
      const status = currentTracker.getStatus();
      res.write(`data: ${JSON.stringify(status)}\n\n`);
      
      // End stream when operation is complete or failed
      if (status.stage === 'Completed' || status.stage === 'Failed') {
        clearInterval(interval);
        res.end();
      }
    } else {
      clearInterval(interval);
      res.end();
    }
  }, 2000); // Update every 2 seconds
  
  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(interval);
  });
});