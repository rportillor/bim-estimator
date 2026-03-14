// 🛡️ ENTERPRISE SECURITY: Comprehensive Audit Logging System
// Tracks all sensitive actions for compliance and security monitoring

import { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";

// Audit event types for construction industry
export enum AuditEventType {
  // Document Access Events
  DOCUMENT_VIEW = 'DOCUMENT_VIEW',
  DOCUMENT_DOWNLOAD = 'DOCUMENT_DOWNLOAD',
  DOCUMENT_UPLOAD = 'DOCUMENT_UPLOAD',
  DOCUMENT_DELETE = 'DOCUMENT_DELETE',
  DOCUMENT_SHARE = 'DOCUMENT_SHARE',
  
  // Project Events
  PROJECT_CREATE = 'PROJECT_CREATE',
  PROJECT_VIEW = 'PROJECT_VIEW',
  PROJECT_MODIFY = 'PROJECT_MODIFY',
  PROJECT_DELETE = 'PROJECT_DELETE',
  PROJECT_EXPORT = 'PROJECT_EXPORT',
  
  // BIM Events
  BIM_MODEL_VIEW = 'BIM_MODEL_VIEW',
  BIM_MODEL_EXPORT = 'BIM_MODEL_EXPORT',
  BIM_MODEL_GENERATE = 'BIM_MODEL_GENERATE',
  BIM_ELEMENT_MODIFY = 'BIM_ELEMENT_MODIFY',
  
  // Cost Estimation Events  
  BOQ_GENERATE = 'BOQ_GENERATE',
  BOQ_EXPORT = 'BOQ_EXPORT',
  COST_ESTIMATE_VIEW = 'COST_ESTIMATE_VIEW',
  COST_ESTIMATE_EXPORT = 'COST_ESTIMATE_EXPORT',
  
  // Compliance & Standards Events
  COMPLIANCE_CHECK = 'COMPLIANCE_CHECK',
  BUILDING_CODE_ACCESS = 'BUILDING_CODE_ACCESS',
  STANDARDS_DOWNLOAD = 'STANDARDS_DOWNLOAD',
  
  // Authentication Events
  USER_LOGIN = 'USER_LOGIN',
  USER_LOGOUT = 'USER_LOGOUT',
  USER_LOGIN_FAILED = 'USER_LOGIN_FAILED',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  
  // License & Subscription Events
  LICENSE_UPGRADE = 'LICENSE_UPGRADE',
  LICENSE_DOWNGRADE = 'LICENSE_DOWNGRADE',
  SUBSCRIPTION_CHANGE = 'SUBSCRIPTION_CHANGE',
  FEATURE_ACCESS_DENIED = 'FEATURE_ACCESS_DENIED',
  
  // Security Events
  UNAUTHORIZED_ACCESS = 'UNAUTHORIZED_ACCESS',
  SECURITY_VIOLATION = 'SECURITY_VIOLATION',
  DATA_BREACH_ATTEMPT = 'DATA_BREACH_ATTEMPT',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  
  // Administrative Events
  USER_CREATE = 'USER_CREATE',
  USER_DELETE = 'USER_DELETE',
  COMPANY_CREATE = 'COMPANY_CREATE',
  ROLE_CHANGE = 'ROLE_CHANGE',
  SETTINGS_CHANGE = 'SETTINGS_CHANGE'
}

// Severity levels for audit events
export enum AuditSeverity {
  LOW = 'LOW',           // Normal operations
  MEDIUM = 'MEDIUM',     // Important business actions
  HIGH = 'HIGH',         // Security-sensitive actions
  CRITICAL = 'CRITICAL'  // Security violations, breaches
}

// Audit event interface
export interface AuditEvent {
  eventType: AuditEventType;
  severity: AuditSeverity;
  userId: string | null;
  companyId: string | null;
  resourceType: string;
  resourceId: string | null;
  description: string;
  metadata: Record<string, any>;
  ipAddress: string;
  userAgent: string;
  sessionId?: string;
  tenantContext?: any;
}

/**
 * 📝 Create audit log entry in database
 */
async function createAuditLogEntry(event: AuditEvent): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO audit_logs (
        event_type, severity, user_id, company_id, 
        resource_type, resource_id, description, 
        metadata, ip_address, user_agent, session_id,
        created_at
      ) VALUES (
        ${event.eventType}, ${event.severity}, ${event.userId}, ${event.companyId},
        ${event.resourceType}, ${event.resourceId}, ${event.description},
        ${JSON.stringify(event.metadata)}, ${event.ipAddress}, ${event.userAgent}, ${event.sessionId},
        NOW()
      )
    `);
  } catch (error) {
    console.error('❌ Failed to create audit log entry:', error);
    // Don't throw - audit logging failures shouldn't break the application
  }
}

/**
 * 🔍 Extract request context for audit logging
 */
function extractRequestContext(req: Request): {
  userId: string | null;
  companyId: string | null;
  ipAddress: string;
  userAgent: string;
  sessionId?: string;
  tenantContext?: any;
} {
  const user = (req as any).user;
  const tenantContext = (req as any).tenantContext;
  
  return {
    userId: user?.id || null,
    companyId: user?.companyId || tenantContext?.companyId || null,
    ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown',
    sessionId: (req as any).sessionID || (req as any).session?.id,
    tenantContext
  };
}

/**
 * 📊 Audit middleware factory for different event types
 */
export function auditAction(
  eventType: AuditEventType,
  severity: AuditSeverity,
  resourceType: string,
  options: {
    extractResourceId?: (req: Request) => string | null;
    extractMetadata?: (req: Request, res: Response) => Record<string, any>;
    description?: string | ((req: Request) => string);
  } = {}
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = extractRequestContext(req);
      
      // Extract resource ID
      const resourceId = options.extractResourceId 
        ? options.extractResourceId(req)
        : req.params.id || req.params.projectId || req.params.documentId || null;
      
      // Generate description
      const description = typeof options.description === 'function'
        ? options.description(req)
        : options.description || `${eventType} action on ${resourceType}`;
      
      // Extract metadata
      const baseMetadata = {
        method: req.method,
        path: req.path,
        query: req.query,
        timestamp: new Date().toISOString()
      };
      
      const customMetadata = options.extractMetadata
        ? options.extractMetadata(req, res)
        : {};
      
      const auditEvent: AuditEvent = {
        eventType,
        severity,
        userId: context.userId,
        companyId: context.companyId,
        resourceType,
        resourceId,
        description,
        metadata: { ...baseMetadata, ...customMetadata },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        sessionId: context.sessionId,
        tenantContext: context.tenantContext
      };
      
      // Log after response completes
      res.on('finish', async () => {
        // Add response status to metadata
        auditEvent.metadata.responseStatus = res.statusCode;
        auditEvent.metadata.responseTime = Date.now() - (req as any).startTime;
        
        await createAuditLogEntry(auditEvent);
        
        console.log(`📝 Audit: ${eventType} - User ${context.userId} - ${resourceType} ${resourceId} - Status ${res.statusCode}`);
      });
      
      next();
      
    } catch (error) {
      console.error('❌ Audit middleware error:', error);
      next(); // Continue without audit logging
    }
  };
}

/**
 * 🚨 Log security violation
 */
export async function logSecurityViolation(
  req: Request,
  violationType: string,
  details: Record<string, any>
): Promise<void> {
  const context = extractRequestContext(req);
  
  const auditEvent: AuditEvent = {
    eventType: AuditEventType.SECURITY_VIOLATION,
    severity: AuditSeverity.CRITICAL,
    userId: context.userId,
    companyId: context.companyId,
    resourceType: 'SECURITY',
    resourceId: null,
    description: `Security violation: ${violationType}`,
    metadata: {
      violationType,
      details,
      method: req.method,
      path: req.path,
      query: req.query,
      body: req.body,
      headers: req.headers,
      timestamp: new Date().toISOString()
    },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    sessionId: context.sessionId,
    tenantContext: context.tenantContext
  };
  
  await createAuditLogEntry(auditEvent);
  
  // Also log to console for immediate visibility
  console.error(`🚨 SECURITY VIOLATION: ${violationType} - User ${context.userId} - IP ${context.ipAddress}`);
}

/**
 * 🔐 Log authentication event
 */
export async function logAuthenticationEvent(
  req: Request,
  eventType: AuditEventType,
  userId: string | null,
  success: boolean,
  details: Record<string, any> = {}
): Promise<void> {
  const context = extractRequestContext(req);
  
  const auditEvent: AuditEvent = {
    eventType,
    severity: success ? AuditSeverity.MEDIUM : AuditSeverity.HIGH,
    userId: userId,
    companyId: context.companyId,
    resourceType: 'AUTHENTICATION',
    resourceId: userId,
    description: `${eventType} ${success ? 'successful' : 'failed'}`,
    metadata: {
      success,
      details,
      timestamp: new Date().toISOString()
    },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    sessionId: context.sessionId
  };
  
  await createAuditLogEntry(auditEvent);
}

/**
 * 📈 Get audit statistics for monitoring
 */
export async function getAuditStatistics(
  companyId?: string,
  timeframe: 'hour' | 'day' | 'week' | 'month' = 'day'
): Promise<{
  totalEvents: number;
  securityViolations: number;
  failedLogins: number;
  documentAccess: number;
  highSeverityEvents: number;
}> {
  try {
    // SECURITY FIX: Use parameterized interval instead of sql.raw() to prevent injection
    const intervalMap: Record<string, string> = {
      hour: '1 hour',
      day: '1 day',
      week: '7 days',
      month: '30 days'
    };
    const timeInterval = intervalMap[timeframe] || '1 day';

    const companyFilter = companyId ? sql`AND company_id = ${companyId}` : sql``;

    const results = await db.execute(sql`
      SELECT
        COUNT(*) as total_events,
        COUNT(CASE WHEN event_type LIKE '%SECURITY%' OR event_type LIKE '%VIOLATION%' THEN 1 END) as security_violations,
        COUNT(CASE WHEN event_type = 'USER_LOGIN_FAILED' THEN 1 END) as failed_logins,
        COUNT(CASE WHEN event_type LIKE '%DOCUMENT%' THEN 1 END) as document_access,
        COUNT(CASE WHEN severity IN ('HIGH', 'CRITICAL') THEN 1 END) as high_severity_events
      FROM audit_logs
      WHERE created_at >= NOW() - ${timeInterval}::interval
      ${companyFilter}
    `);
    
    const row = results.rows[0] as any;
    return {
      totalEvents: parseInt(row.total_events) || 0,
      securityViolations: parseInt(row.security_violations) || 0,
      failedLogins: parseInt(row.failed_logins) || 0,
      documentAccess: parseInt(row.document_access) || 0,
      highSeverityEvents: parseInt(row.high_severity_events) || 0
    };
    
  } catch (error) {
    console.error('❌ Failed to get audit statistics:', error);
    return {
      totalEvents: 0,
      securityViolations: 0,
      failedLogins: 0,
      documentAccess: 0,
      highSeverityEvents: 0
    };
  }
}

// Pre-defined audit middleware for common actions
export const auditDocumentView = auditAction(
  AuditEventType.DOCUMENT_VIEW,
  AuditSeverity.LOW,
  'DOCUMENT',
  {
    extractResourceId: (req) => req.params.documentId || req.params.id,
    extractMetadata: (req) => ({
      documentType: req.query.type,
      projectId: req.params.projectId
    })
  }
);

export const auditDocumentDownload = auditAction(
  AuditEventType.DOCUMENT_DOWNLOAD,
  AuditSeverity.MEDIUM,
  'DOCUMENT',
  {
    extractResourceId: (req) => req.params.documentId || req.params.id,
    extractMetadata: (req) => ({
      format: req.query.format,
      projectId: req.params.projectId
    })
  }
);

export const auditProjectExport = auditAction(
  AuditEventType.PROJECT_EXPORT,
  AuditSeverity.HIGH,
  'PROJECT',
  {
    extractResourceId: (req) => req.params.projectId || req.params.id,
    extractMetadata: (req) => ({
      exportFormat: req.query.format || req.body.format,
      includeDocuments: req.query.includeDocuments || req.body.includeDocuments
    })
  }
);

export const auditBOQGenerate = auditAction(
  AuditEventType.BOQ_GENERATE,
  AuditSeverity.MEDIUM,
  'BOQ',
  {
    extractResourceId: (req) => req.params.projectId,
    extractMetadata: (req) => ({
      analysisType: req.body.analysisType,
      includeBIM: req.body.includeBIM
    })
  }
);

export const auditComplianceCheck = auditAction(
  AuditEventType.COMPLIANCE_CHECK,
  AuditSeverity.MEDIUM,
  'COMPLIANCE',
  {
    extractResourceId: (req) => req.params.projectId,
    extractMetadata: (req) => ({
      jurisdiction: req.query.jurisdiction || req.body.jurisdiction,
      buildingType: req.query.buildingType || req.body.buildingType
    })
  }
);