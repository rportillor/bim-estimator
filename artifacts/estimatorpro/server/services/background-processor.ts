import { storage } from "../storage";
import { ConstructionWorkflowProcessor } from "../construction-workflow-processor";
import { publishProgress } from "../routes/progress";

interface ProcessingState {
  projectId: string;
  modelId: string;
  batchIndex: number;
  totalBatches: number;
  startedAt: string;
  lastSavedAt: string;
  status: 'processing' | 'completed' | 'failed' | 'paused';
  progress?: number; // Add optional progress field
}

class BackgroundProcessorService {
  private static instance: BackgroundProcessorService;
  private processingInterval: NodeJS.Timeout | null = null;
  private currentState: ProcessingState | null = null;
  private processor: ConstructionWorkflowProcessor | null = null;
  
  static getInstance(): BackgroundProcessorService {
    if (!this.instance) {
      this.instance = new BackgroundProcessorService();
    }
    return this.instance;
  }
  
  /**
   * Start or resume processing for a model
   */
  async startProcessing(projectId: string, modelId: string): Promise<void> {
    console.log(`🚀 Background processor starting for model ${modelId}`);
    
    // Load saved state if exists
    const savedState = await this.loadProcessingState(modelId);
    if (savedState && savedState.status === 'processing') {
      console.log(`📥 Resuming from batch ${savedState.batchIndex + 1}/${savedState.totalBatches}`);
      this.currentState = savedState;
    } else {
      // Start fresh
      this.currentState = {
        projectId,
        modelId,
        batchIndex: 0,
        totalBatches: 0,
        startedAt: new Date().toISOString(),
        lastSavedAt: new Date().toISOString(),
        status: 'processing'
      };
    }
    
    // Start the processing loop
    this.startProcessingLoop();
  }
  
  /**
   * Main processing loop that runs in background
   */
  private async startProcessingLoop(): Promise<void> {
    if (!this.currentState) return;
    
    // Clear any existing interval
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    
    // Process immediately
    await this.processNextBatch();
    
    // Then check every 5 seconds for more work (faster processing)
    this.processingInterval = setInterval(async () => {
      if (this.currentState?.status === 'processing') {
        await this.processNextBatch();
      } else if (this.currentState?.status === 'completed') {
        console.log('✅ Automated processing complete!');
        this.stopProcessing();
      }
    }, 30000); // Check every 30 seconds to prevent overwhelming
  }
  
  /**
   * Process the next batch of documents
   */
  private async processNextBatch(): Promise<void> {
    if (!this.currentState) return;
    
    try {
      // CRITICAL FIX: Ensure no undefined values when destructuring
      const projectId = this.currentState.projectId || '';
      const modelId = this.currentState.modelId || '';
      const batchIndex = this.currentState.batchIndex ?? 0;
      
      // Get all documents for the project
      const documents = await storage.getDocumentsByProject(projectId);
      
      // Create batches of 5
      const BATCH_SIZE = 5;
      const batches: any[] = [];
      for (let i = 0; i < documents.length; i += BATCH_SIZE) {
        batches.push(documents.slice(i, i + BATCH_SIZE));
      }
      
      this.currentState.totalBatches = batches.length;
      
      // Check if all batches are done
      if (batchIndex >= batches.length) {
        console.log(`✅ All ${batches.length} batches completed for model ${modelId}`);
        this.currentState.status = 'completed';
        await this.saveProcessingState();
        this.stopProcessing();
        
        // Update model status
        await storage.updateBimModel(modelId, { status: 'completed' });
        publishProgress(modelId, { 
          progress: 100, 
          message: 'Processing complete!',
          phase: 'complete'
        });
        return;
      }
      
      // Process current batch
      const currentBatch = batches[batchIndex];
      if (!currentBatch || currentBatch.length === 0) {
        console.error(`❌ No batch found at index ${batchIndex}`);
        this.currentState.batchIndex = batchIndex + 1;
        await this.saveProcessingState();
        return;
      }
      console.log(`📦 Processing batch ${batchIndex + 1}/${batches.length} with ${currentBatch.length} documents`);
      
      // Create or reuse processor
      if (!this.processor) {
        const { ConstructionWorkflowProcessor } = await import('../construction-workflow-processor');
        this.processor = new ConstructionWorkflowProcessor();
      }
      
      // Process this batch (ensure no undefined values)
      const _result = await this.processor.processConstructionDocuments(
        projectId || '',
        currentBatch,
        {
          batch: batchIndex + 1,
          totalBatches: batches.length,
          modelId: modelId || ''
        }
      );
      
      // Update state for next batch
      this.currentState.batchIndex = batchIndex + 1;
      this.currentState.lastSavedAt = new Date().toISOString();
      await this.saveProcessingState();
      
      console.log(`✅ Batch ${batchIndex + 1} complete. Moving to next...`);
      
    } catch (error) {
      console.error(`❌ Background processing error:`, error);
      if (this.currentState) {
        this.currentState.status = 'failed';
        await this.saveProcessingState();
      }
      this.stopProcessing();
    }
  }
  
  /**
   * Save current processing state to database
   */
  private async saveProcessingState(): Promise<void> {
    if (!this.currentState) return;
    
    try {
      const { modelId } = this.currentState;
      
      // CRITICAL FIX: Remove ALL undefined values before saving
      const cleanState = {
        projectId: this.currentState.projectId || '',
        modelId: this.currentState.modelId || '',
        batchIndex: this.currentState.batchIndex ?? 0,
        totalBatches: this.currentState.totalBatches ?? 10,
        progress: this.currentState.progress ?? 0,
        status: this.currentState.status || 'processing',
        lastSavedAt: this.currentState.lastSavedAt || new Date().toISOString()
      };
      
      // Double-check no undefined values
      Object.keys(cleanState).forEach(key => {
        if (cleanState[key as keyof typeof cleanState] === undefined) {
          console.warn(`⚠️ Undefined value found for ${key}, setting default`);
          (cleanState as any)[key] = key === 'batchIndex' || key === 'totalBatches' || key === 'progress' ? 0 : '';
        }
      });
      
      await storage.updateBimModel(modelId, {
        geometryData: {
          processingState: cleanState,
          savedAt: new Date().toISOString()
        }
      });
      console.log(`💾 Processing state saved for batch ${cleanState.batchIndex}/${cleanState.totalBatches}`);
    } catch (error) {
      console.error('Failed to save processing state:', error);
      // Don't re-throw - prevent crash
    }
  }
  
  /**
   * Load saved processing state from database
   */
  private async loadProcessingState(modelId: string): Promise<ProcessingState | null> {
    try {
      const model = await storage.getBimModel(modelId);
      const geoData = model?.geometryData as any;
      if (geoData?.processingState) {
        return geoData.processingState as ProcessingState;
      }
    } catch (error) {
      console.error('Failed to load processing state:', error);
    }
    return null;
  }
  
  /**
   * Stop background processing
   */
  stopProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    this.currentState = null;
    this.processor = null;
    console.log('🛑 Background processor stopped');
  }
  
  /**
   * Check if processing is active
   */
  isProcessing(): boolean {
    return this.currentState?.status === 'processing';
  }
  
  /**
   * Get current processing status
   */
  getStatus(): ProcessingState | null {
    return this.currentState;
  }
}

export const backgroundProcessor = BackgroundProcessorService.getInstance();

/**
 * Auto-resume on startup — marks any orphaned generating/processing models as failed
 * so users see the "Regenerate" button instead of an infinite spinner.
 */
export async function autoResumeProcessing(): Promise<void> {
  console.log('🔍 Checking for incomplete processing tasks...');
  
  try {
    const { db } = await import('../db');
    const { bimModels } = await import('../../shared/schema');
    const { inArray, sql } = await import('drizzle-orm');
    
    const result = await db
      .update(bimModels)
      .set({ status: 'failed', updatedAt: sql`NOW()` })
      .where(inArray(bimModels.status, ['generating', 'processing']))
      .returning({ id: bimModels.id });

    if (result.length > 0) {
      console.log(`⚠️ Marked ${result.length} orphaned model(s) as failed on startup: ${result.map(r => r.id).join(', ')}`);
      // Force-release the extraction lock — the server restarted mid-generation so
      // no legitimate lock owner exists. Without this, users get a 409 for up to
      // 2 minutes (2× heartbeat interval) while the stale lock appears active.
      const { ExtractionLockManager } = await import('../extraction-lock-manager');
      await ExtractionLockManager.forceReleaseLock();
    } else {
      console.log('✅ No orphaned BIM models found');
    }
  } catch (error) {
    console.error('Failed to clean up orphaned models:', error);
  }
}