/**
 * 🚨 DEPRECATED PATH MONITORING SYSTEM
 * 
 * This module monitors and alerts when deprecated code paths are used
 * to prevent regression back to duplicate-generating behaviors.
 */

interface DeprecatedPathAlert {
  path: string;
  projectId?: string;
  documentId?: string;
  timestamp: Date;
  stackTrace: string;
  count: number;
}

class DeprecatedPathMonitor {
  private alerts: DeprecatedPathAlert[] = [];
  private totalAlerts = 0;

  /**
   * 🚨 CRITICAL ALERT: Log deprecated path usage
   */
  logDeprecatedPath(
    path: string, 
    projectId?: string, 
    documentId?: string,
    stackTrace?: string
  ): void {
    this.totalAlerts++;
    
    const alert: DeprecatedPathAlert = {
      path,
      projectId,
      documentId,
      timestamp: new Date(),
      stackTrace: stackTrace || new Error().stack || 'No stack trace',
      count: this.totalAlerts
    };
    
    this.alerts.push(alert);
    
    // Keep only last 100 alerts to prevent memory issues
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }
    
    // CRITICAL CONSOLE ALERTS
    console.error(`🚨🚨🚨 DEPRECATED PATH ALERT #${this.totalAlerts} 🚨🚨🚨`);
    console.error(`📍 PATH: ${path}`);
    console.error(`📊 PROJECT: ${projectId || 'Unknown'}`);
    console.error(`📄 DOCUMENT: ${documentId || 'Unknown'}`);
    console.error(`⏰ TIME: ${alert.timestamp.toISOString()}`);
    console.error(`🔴 STACK: ${stackTrace}`);
    console.error(`📈 TOTAL ALERTS: ${this.totalAlerts}`);
    console.error(`🚨🚨🚨 END ALERT #${this.totalAlerts} 🚨🚨🚨`);
    
    // Alert thresholds
    if (this.totalAlerts === 1) {
      console.error(`🚨 FIRST DEPRECATED PATH USAGE DETECTED!`);
    } else if (this.totalAlerts === 5) {
      console.error(`🚨 5 DEPRECATED PATH USAGES - INVESTIGATE IMMEDIATELY!`);
    } else if (this.totalAlerts >= 10) {
      console.error(`🚨 ${this.totalAlerts} DEPRECATED PATH USAGES - CRITICAL SYSTEM ISSUE!`);
    }
  }

  /**
   * Get current alert statistics
   */
  getStats(): {
    totalAlerts: number;
    recentAlerts: DeprecatedPathAlert[];
    alertsByPath: Record<string, number>;
  } {
    const alertsByPath: Record<string, number> = {};
    this.alerts.forEach(alert => {
      alertsByPath[alert.path] = (alertsByPath[alert.path] || 0) + 1;
    });

    return {
      totalAlerts: this.totalAlerts,
      recentAlerts: this.alerts.slice(-10), // Last 10 alerts
      alertsByPath
    };
  }

  /**
   * Check if system is using deprecated paths
   */
  hasDeprecatedUsage(): boolean {
    return this.totalAlerts > 0;
  }

  /**
   * Reset monitoring (for testing)
   */
  reset(): void {
    this.alerts = [];
    this.totalAlerts = 0;
  }
}

// Global singleton instance
export const deprecatedPathMonitor = new DeprecatedPathMonitor();

/**
 * 🚨 CONVENIENCE FUNCTION: Quick alert for deprecated paths
 */
export function alertDeprecatedPath(
  path: string,
  projectId?: string,
  documentId?: string
): void {
  deprecatedPathMonitor.logDeprecatedPath(
    path, 
    projectId, 
    documentId, 
    new Error().stack
  );
}

/**
 * 🔍 MIDDLEWARE: Check for deprecated path usage in responses
 */
export function checkForDeprecatedUsage(): {
  hasAlerts: boolean;
  alertCount: number;
  recentPaths: string[];
} {
  const stats = deprecatedPathMonitor.getStats();
  return {
    hasAlerts: stats.totalAlerts > 0,
    alertCount: stats.totalAlerts,
    recentPaths: stats.recentAlerts.map(a => a.path)
  };
}