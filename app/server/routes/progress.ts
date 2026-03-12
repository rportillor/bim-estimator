import { Router } from 'express';
import { EventEmitter } from 'events';

export const progressRouter = Router();
const progressEmitter = new EventEmitter();
const progressStore = new Map();

export function publishProgress(modelId: string, update: {
  progress: number;
  message: string;
  phase: string;
  details?: any;
}) {
  const normalizedProgress = Math.max(0, Math.min(100, update.progress));
  
  const progressData = {
    ...update,
    progress: normalizedProgress,
    lastUpdate: Date.now()
  };
  
  progressStore.set(modelId, progressData);
  progressEmitter.emit('progress', modelId, progressData);
  
  console.log(`📊 Progress Update [${modelId}]: ${normalizedProgress}% - ${update.message}`);
}

// SSE endpoint for real-time updates
progressRouter.get('/progress/:modelId/stream', (req, res) => {
  const { modelId } = req.params;
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  
  const currentProgress = progressStore.get(modelId);
  if (currentProgress) {
    res.write(`data: ${JSON.stringify(currentProgress)}\n\n`);
  }
  
  const onProgress = (updatedModelId: string, data: any) => {
    if (updatedModelId === modelId) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };
  
  progressEmitter.on('progress', onProgress);
  
  req.on('close', () => {
    progressEmitter.removeListener('progress', onProgress);
  });
});

// HTTP fallback
progressRouter.get('/progress/:modelId', (req, res) => {
  const progress = progressStore.get(req.params.modelId);
  
  if (!progress) {
    return res.json({
      progress: 0,
      message: 'Not started',
      phase: 'waiting'
    });
  }
  
  const isStale = Date.now() - progress.lastUpdate > 5 * 60 * 1000;
  if (isStale) {
    return res.json({
      progress: 100,
      message: 'Process may have completed',
      phase: 'unknown',
      stale: true
    });
  }
  
  res.json(progress);
});

// Legacy support for existing endpoints
progressRouter.get('/bim/models/:id/progress', (req, res) => {
  const { id } = req.params;
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  const currentProgress = progressStore.get(id);
  if (currentProgress) {
    res.write(`data: ${JSON.stringify(currentProgress)}\n\n`);
  }
  
  const onProgress = (modelId: string, data: any) => {
    if (modelId === id) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };
  
  progressEmitter.on('progress', onProgress);
  
  req.on('close', () => {
    progressEmitter.removeListener('progress', onProgress);
  });
});