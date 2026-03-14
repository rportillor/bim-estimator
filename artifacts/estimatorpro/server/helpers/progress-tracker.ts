// server/helpers/progress-tracker.ts
// ✅ SYSTEM FIX: Real-time progress tracking for long operations

export interface ProgressUpdate {
  id: string;
  operation: string;
  progress: number; // 0-100
  stage: string;
  details?: string;
  timestamp: number;
  errors?: string[];
}

export class ProgressTracker {
  private static trackers = new Map<string, ProgressTracker>();
  
  private id: string;
  private operation: string;
  private progress = 0;
  private stage = 'Starting';
  private details?: string;
  private errors: string[] = [];
  private startTime = Date.now();
  
  constructor(id: string, operation: string) {
    this.id = id;
    this.operation = operation;
    ProgressTracker.trackers.set(id, this);
  }
  
  updateProgress(progress: number, stage: string, details?: string) {
    this.progress = Math.max(0, Math.min(100, progress));
    this.stage = stage;
    this.details = details;
    
    const duration = Date.now() - this.startTime;
    console.log(`📊 [${this.id}] ${this.operation}: ${this.progress}% - ${stage} (${duration}ms) ${details || ''}`);
  }
  
  addError(error: string | Error) {
    const errorMsg = typeof error === 'string' ? error : error.message;
    this.errors.push(errorMsg);
    console.error(`❌ [${this.id}] ${this.operation}: ${errorMsg}`);
  }
  
  complete(finalDetails?: string) {
    this.progress = 100;
    this.stage = 'Completed';
    this.details = finalDetails || 'Operation completed successfully';
    
    const duration = Date.now() - this.startTime;
    console.log(`✅ [${this.id}] ${this.operation} completed in ${duration}ms`);
    
    // Keep tracker for 5 minutes for client queries
    setTimeout(() => ProgressTracker.trackers.delete(this.id), 5 * 60 * 1000);
  }
  
  fail(error: string | Error) {
    this.addError(error);
    this.stage = 'Failed';
    this.progress = 0;
    
    const duration = Date.now() - this.startTime;
    console.error(`💥 [${this.id}] ${this.operation} failed after ${duration}ms`);
  }
  
  getStatus(): ProgressUpdate {
    return {
      id: this.id,
      operation: this.operation,
      progress: this.progress,
      stage: this.stage,
      details: this.details,
      timestamp: Date.now(),
      errors: this.errors.length > 0 ? this.errors : undefined
    };
  }
  
  static getTracker(id: string): ProgressTracker | undefined {
    return ProgressTracker.trackers.get(id);
  }
  
  static getAllTrackers(): ProgressUpdate[] {
    return Array.from(ProgressTracker.trackers.values()).map(t => t.getStatus());
  }
}