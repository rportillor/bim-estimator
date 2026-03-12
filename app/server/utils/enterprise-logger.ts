// server/utils/enterprise-logger.ts
// ✅ SECURITY: Enterprise-grade structured logging with security event tracking

interface LogLevel {
  DEBUG: 0;
  INFO: 1;
  WARN: 2;
  ERROR: 3;
  SECURITY: 4;
  CRITICAL: 5;
}

interface LogEntry {
  timestamp: string;
  level: keyof LogLevel;
  message: string;
  metadata?: Record<string, any>;
  userId?: string;
  requestId?: string;
  securityEvent?: boolean;
}

class EnterpriseLogger {
  private logLevel: keyof LogLevel;
  private securityEvents: LogEntry[] = [];
  private maxSecurityEvents = 1000;
  
  constructor() {
    this.logLevel = (process.env.LOG_LEVEL as keyof LogLevel) || 'INFO';
  }
  
  private shouldLog(level: keyof LogLevel): boolean {
    const levels: LogLevel = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, SECURITY: 4, CRITICAL: 5 };
    return levels[level] >= levels[this.logLevel];
  }
  
  private createLogEntry(
    level: keyof LogLevel,
    message: string,
    metadata?: Record<string, any>,
    securityEvent = false
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata: this.sanitizeMetadata(metadata),
      securityEvent
    };
  }
  
  private sanitizeMetadata(metadata?: Record<string, any>): Record<string, any> | undefined {
    if (!metadata) return undefined;
    
    const sanitized = { ...metadata };
    
    // Remove sensitive fields
    const sensitiveFields = ['password', 'token', 'apiKey', 'secret', 'credit_card'];
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }
  
  private output(entry: LogEntry): void {
    if (entry.securityEvent) {
      this.securityEvents.push(entry);
      if (this.securityEvents.length > this.maxSecurityEvents) {
        this.securityEvents.shift();
      }
    }
    
    // Format for different environments
    if (process.env.NODE_ENV === 'production') {
      // Structured JSON logging for production
      console.log(JSON.stringify(entry));
    } else {
      // Human-readable format for development
      const emoji = entry.level === 'SECURITY' ? '🔒' : 
                   entry.level === 'ERROR' ? '❌' : 
                   entry.level === 'WARN' ? '⚠️' : 
                   entry.level === 'CRITICAL' ? '🚨' : '✅';
      
      console.log(`${emoji} [${entry.level}] ${entry.message}`, 
                  entry.metadata ? JSON.stringify(entry.metadata, null, 2) : '');
    }
  }
  
  debug(message: string, metadata?: Record<string, any> | unknown): void {
    if (this.shouldLog('DEBUG')) {
      this.output(this.createLogEntry('DEBUG', message, metadata as Record<string, any>));
    }
  }
  
  info(message: string, metadata?: Record<string, any> | unknown): void {
    if (this.shouldLog('INFO')) {
      this.output(this.createLogEntry('INFO', message, metadata as Record<string, any>));
    }
  }
  
  warn(message: string, metadata?: Record<string, any> | unknown): void {
    if (this.shouldLog('WARN')) {
      this.output(this.createLogEntry('WARN', message, metadata as Record<string, any>));
    }
  }
  
  error(message: string, metadata?: Record<string, any> | unknown): void {
    if (this.shouldLog('ERROR')) {
      this.output(this.createLogEntry('ERROR', message, metadata as Record<string, any>));
    }
  }
  
  security(message: string, metadata?: Record<string, any> | unknown): void {
    if (this.shouldLog('SECURITY')) {
      this.output(this.createLogEntry('SECURITY', message, metadata as Record<string, any>, true));
    }
  }
  
  critical(message: string, metadata?: Record<string, any>): void {
    if (this.shouldLog('CRITICAL')) {
      this.output(this.createLogEntry('CRITICAL', message, metadata, true));
    }
  }
  
  // Security event aggregation for monitoring
  getSecurityEvents(limit = 100): LogEntry[] {
    return this.securityEvents.slice(-limit);
  }
  
  // Performance and audit logging
  async withTiming<T>(
    operation: string,
    fn: () => Promise<T>,
    userId?: string
  ): Promise<T> {
    const start = Date.now();
    const requestId = Math.random().toString(36).substr(2, 9);
    
    this.info(`Operation started: ${operation}`, { requestId, userId });
    
    try {
      const result = await fn();
      const duration = Date.now() - start;
      
      this.info(`Operation completed: ${operation}`, {
        requestId,
        userId,
        duration: `${duration}ms`,
        status: 'success'
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      
      this.error(`Operation failed: ${operation}`, {
        requestId,
        userId,
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error),
        status: 'failed'
      });
      
      throw error;
    }
  }
}

export const logger = new EnterpriseLogger();

// Security event tracking helpers
export const securityLogger = {
  authAttempt: (success: boolean, username: string, ip: string) => {
    logger.security(`Authentication ${success ? 'successful' : 'failed'}`, {
      username,
      ip,
      success
    });
  },
  
  dataAccess: (resource: string, userId: string, action: string) => {
    logger.security(`Data access: ${action} on ${resource}`, {
      resource,
      userId,
      action
    });
  },
  
  fileUpload: (filename: string, fileSize: number, userId: string) => {
    logger.security(`File uploaded: ${filename}`, {
      filename,
      fileSize,
      userId
    });
  },
  
  suspiciousActivity: (activity: string, details: Record<string, any>) => {
    logger.security(`Suspicious activity detected: ${activity}`, details);
  }
};