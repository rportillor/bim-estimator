// server/helpers/session-tracker.ts
// ✅ SYSTEM FIX: Session tracking to prevent duplicate analysis operations

export class SessionTracker {
  private static runningOperations = new Map<string, Set<string>>();
  
  /**
   * Check if operation is already running for a project
   */
  static isRunning(projectId: string, operationType: string): boolean {
    const projectOps = this.runningOperations.get(projectId);
    return projectOps ? projectOps.has(operationType) : false;
  }
  
  /**
   * Mark operation as started
   */
  static startOperation(projectId: string, operationType: string): void {
    if (!this.runningOperations.has(projectId)) {
      this.runningOperations.set(projectId, new Set());
    }
    this.runningOperations.get(projectId)!.add(operationType);
    
    console.log(`🔄 Started operation: ${operationType} for project ${projectId}`);
    
    // Auto-cleanup after 30 minutes to prevent stuck sessions
    setTimeout(() => {
      this.endOperation(projectId, operationType);
    }, 30 * 60 * 1000);
  }
  
  /**
   * Mark operation as completed
   */
  static endOperation(projectId: string, operationType: string): void {
    const projectOps = this.runningOperations.get(projectId);
    if (projectOps) {
      projectOps.delete(operationType);
      if (projectOps.size === 0) {
        this.runningOperations.delete(projectId);
      }
    }
    console.log(`✅ Completed operation: ${operationType} for project ${projectId}`);
  }
  
  /**
   * Get all running operations for debugging
   */
  static getRunningOperations(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    this.runningOperations.forEach((operations, projectId) => {
      result[projectId] = Array.from(operations);
    });
    return result;
  }
  
  /**
   * Clear all operations for a project (emergency cleanup)
   */
  static clearProject(projectId: string): void {
    this.runningOperations.delete(projectId);
    console.log(`🧹 Cleared all operations for project ${projectId}`);
  }
}