/**
 * 🚨 ERROR MONITORING & LOGGING SYSTEM
 * Comprehensive error tracking that would have caught the document viewing issue
 */

interface ErrorContext {
  userId?: string;
  projectId?: string;
  documentId?: string;
  component?: string;
  action?: string;
  url?: string;
  userAgent?: string;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface ErrorLog {
  id: string;
  message: string;
  stack?: string;
  context: ErrorContext;
  resolved: boolean;
  occurrenceCount: number;
}

class ErrorMonitor {
  private errors: ErrorLog[] = [];
  private maxErrors = 1000;
  private consoleEnabled = true;

  constructor() {
    // Set up global error handlers
    this.setupGlobalHandlers();
  }

  private setupGlobalHandlers() {
    // Catch unhandled JavaScript errors
    window.addEventListener('error', (event) => {
      this.logError(new Error(event.message), {
        component: 'Global',
        action: 'Unhandled Error',
        url: window.location.href,
        severity: 'high',
        timestamp: new Date()
      });
    });

    // Catch unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.logError(new Error(event.reason), {
        component: 'Global',
        action: 'Unhandled Promise Rejection',
        url: window.location.href,
        severity: 'high',
        timestamp: new Date()
      });
    });
  }

  public logError(error: Error, context: Partial<ErrorContext> = {}) {
    const errorId = this.generateErrorId(error.message);
    const existingError = this.errors.find(e => e.id === errorId);

    if (existingError) {
      existingError.occurrenceCount++;
      existingError.context.timestamp = new Date();
    } else {
      const errorLog: ErrorLog = {
        id: errorId,
        message: error.message,
        stack: error.stack,
        context: {
          ...context,
          userAgent: navigator.userAgent,
          timestamp: new Date(),
          severity: context.severity || 'medium'
        },
        resolved: false,
        occurrenceCount: 1
      };

      this.errors.unshift(errorLog);
      
      // Keep only the most recent errors
      if (this.errors.length > this.maxErrors) {
        this.errors = this.errors.slice(0, this.maxErrors);
      }
    }

    // Log to console in development
    if (this.consoleEnabled && import.meta.env.DEV) {
      console.error('🚨 Error logged:', {
        message: error.message,
        context,
        stack: error.stack
      });
    }

    // Send to backend in production
    if (!import.meta.env.DEV) {
      this.sendToBackend(errorId);
    }
  }

  public logAuthenticationError(error: Error, action: string) {
    this.logError(error, {
      component: 'Authentication',
      action,
      severity: 'high',
      timestamp: new Date()
    });
  }

  public logDocumentViewingError(error: Error, projectId: string, documentId: string) {
    this.logError(error, {
      component: 'DocumentViewer',
      action: 'View Document',
      projectId,
      documentId,
      severity: 'medium',
      timestamp: new Date()
    });
  }

  public logAPIError(error: Error, endpoint: string, method: string = 'GET') {
    this.logError(error, {
      component: 'API',
      action: `${method} ${endpoint}`,
      url: endpoint,
      severity: 'medium',
      timestamp: new Date()
    });
  }

  public logBIMError(error: Error, action: string, modelId?: string) {
    this.logError(error, {
      component: 'BIM',
      action,
      documentId: modelId,
      severity: 'medium',
      timestamp: new Date()
    });
  }

  public logUploadError(error: Error, fileName: string, fileSize: number) {
    this.logError(error, {
      component: 'FileUpload',
      action: `Upload ${fileName} (${this.formatFileSize(fileSize)})`,
      severity: 'medium',
      timestamp: new Date()
    });
  }

  public getRecentErrors(limit: number = 50): ErrorLog[] {
    return this.errors.slice(0, limit);
  }

  public getCriticalErrors(): ErrorLog[] {
    return this.errors.filter(error => 
      error.context.severity === 'critical' && !error.resolved
    );
  }

  public getErrorsByComponent(component: string): ErrorLog[] {
    return this.errors.filter(error => error.context.component === component);
  }

  public markResolved(errorId: string) {
    const error = this.errors.find(e => e.id === errorId);
    if (error) {
      error.resolved = true;
    }
  }

  public clearOldErrors(daysOld: number = 7) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    this.errors = this.errors.filter(error => 
      error.context.timestamp > cutoffDate
    );
  }

  public getErrorStats() {
    const total = this.errors.length;
    const unresolved = this.errors.filter(e => !e.resolved).length;
    const critical = this.errors.filter(e => e.context.severity === 'critical').length;
    
    const componentStats = this.errors.reduce((stats, error) => {
      const component = error.context.component || 'Unknown';
      stats[component] = (stats[component] || 0) + 1;
      return stats;
    }, {} as Record<string, number>);

    return {
      total,
      unresolved,
      critical,
      resolved: total - unresolved,
      componentBreakdown: componentStats
    };
  }

  private generateErrorId(message: string): string {
    // Create a hash-like ID from the error message
    let hash = 0;
    for (let i = 0; i < message.length; i++) {
      const char = message.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `error_${Math.abs(hash)}`;
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private async sendToBackend(errorId: string) {
    try {
      const error = this.errors.find(e => e.id === errorId);
      if (!error) return;

      const token = localStorage.getItem('auth_token');
      if (!token) return;

      await fetch('/api/errors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          errorId: error.id,
          message: error.message,
          stack: error.stack,
          context: error.context,
          occurrenceCount: error.occurrenceCount
        })
      }).catch(err => {
        console.error('Failed to send error:', err);
        throw err;
      });
    } catch (err) {
      // Silently fail - don't create infinite error loops
      console.warn('Failed to send error to backend:', err);
    }
  }
}

// Create global error monitor instance
export const errorMonitor = new ErrorMonitor();

// Convenience functions for common error scenarios
export const logAuthError = (error: Error, action: string) => {
  errorMonitor.logAuthenticationError(error, action);
};

export const logDocumentError = (error: Error, projectId: string, documentId: string) => {
  errorMonitor.logDocumentViewingError(error, projectId, documentId);
};

export const logAPIError = (error: Error, endpoint: string, method?: string) => {
  errorMonitor.logAPIError(error, endpoint, method);
};

export const logBIMError = (error: Error, action: string, modelId?: string) => {
  errorMonitor.logBIMError(error, action, modelId);
};

export const logUploadError = (error: Error, fileName: string, fileSize: number) => {
  errorMonitor.logUploadError(error, fileName, fileSize);
};

// React hook for error monitoring
export const useErrorMonitor = () => {
  return {
    logError: errorMonitor.logError.bind(errorMonitor),
    logAuthError,
    logDocumentError,
    logAPIError,
    logBIMError,
    logUploadError,
    getRecentErrors: errorMonitor.getRecentErrors.bind(errorMonitor),
    getCriticalErrors: errorMonitor.getCriticalErrors.bind(errorMonitor),
    getErrorStats: errorMonitor.getErrorStats.bind(errorMonitor)
  };
};