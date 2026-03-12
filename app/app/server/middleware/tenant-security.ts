// 🛡️ ENTERPRISE SECURITY: Multi-Tenant Row-Level Security (RLS) Implementation
// This middleware enforces data isolation at the database level using Postgres RLS

import { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";

interface TenantUser {
  id: string;
  companyId: string | null;
  username: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      tenantContext?: {
        userId: string;
        companyId: string | null;
        username: string;
        role: string;
      };
    }
  }
}

/**
 * 🏛️ Set tenant isolation context for database queries
 * This enforces Row-Level Security policies at the PostgreSQL level
 */
export async function setTenantContext(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user as TenantUser;
    
    if (!user) {
      // Skip tenant context for unauthenticated requests
      return next();
    }

    // Set PostgreSQL session variables for RLS policies
    // These variables are used by RLS policies to filter data
    await db.execute(sql`SELECT set_config('app.current_user_id', ${user.id}, true)`);
    
    // Set company context - critical for multi-tenant isolation
    if (user.companyId) {
      await db.execute(sql`SELECT set_config('app.current_company_id', ${user.companyId}, true)`);
    } else {
      // Solo practitioners or users without company get personal isolation
      await db.execute(sql`SELECT set_config('app.current_company_id', ${user.id}, true)`);
    }
    
    // Set user role for role-based access control
    await db.execute(sql`SELECT set_config('app.current_user_role', ${user.role}, true)`);

    // Store tenant context for application logic
    req.tenantContext = {
      userId: user.id,
      companyId: user.companyId,
      username: user.username,
      role: user.role
    };

    console.log(`🏛️ Tenant context set: User ${user.username} (${user.id}), Company ${user.companyId || 'personal'}`);
    
    next();
  } catch (error) {
    console.error('❌ Failed to set tenant context:', error);
    // Security: Fail securely - deny access on context setup failure
    return res.status(500).json({ 
      error: 'Security context setup failed',
      code: 'TENANT_CONTEXT_ERROR'
    });
  }
}

/**
 * 🔒 Verify tenant context is properly set
 * Use this for sensitive endpoints requiring confirmed isolation
 */
export function requireTenantContext(req: Request, res: Response, next: NextFunction) {
  if (!req.tenantContext) {
    return res.status(403).json({ 
      error: 'Tenant context required for this operation',
      code: 'MISSING_TENANT_CONTEXT'
    });
  }
  next();
}

/**
 * 🏢 Company admin access control
 * Ensures only company admins can access company-wide resources
 */
export function requireCompanyAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user as TenantUser;
  
  if (!user?.companyId) {
    return res.status(403).json({
      error: 'Company membership required',
      code: 'NO_COMPANY_ACCESS'
    });
  }

  // Check isCompanyAdmin flag on user object
  const fullUser = (req as any).user;
  if (!fullUser?.isCompanyAdmin) {
    return res.status(403).json({
      error: 'Company admin access required',
      code: 'NOT_COMPANY_ADMIN'
    });
  }
  next();
}

/**
 * 🔍 Get current tenant context for use in application logic
 */
export function getCurrentTenantContext(req: Request): {
  userId: string;
  companyId: string | null;
  username: string;
  role: string;
} | null {
  return req.tenantContext || null;
}

/**
 * 🧹 Clear tenant context (for cleanup/testing)
 */
export async function clearTenantContext() {
  try {
    await db.execute(sql`SELECT set_config('app.current_user_id', NULL, true)`);
    await db.execute(sql`SELECT set_config('app.current_company_id', NULL, true)`);
    await db.execute(sql`SELECT set_config('app.current_user_role', NULL, true)`);
  } catch (error) {
    console.error('❌ Failed to clear tenant context:', error);
  }
}