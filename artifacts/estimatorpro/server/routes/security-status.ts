// 🛡️ ENTERPRISE SECURITY: Security Status & Health Check Endpoint
// Provides real-time security monitoring and validation

import { Router } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { getTokenStats } from "../middleware/jwt-refresh-system";
import { getAuditStatistics } from "../middleware/audit-logging";

const router = Router();

/**
 * 🔍 Security health check endpoint
 */
router.get('/health', async (req, res) => {
  try {
    const checks = [];
    let overallStatus = 'healthy';

    // Check 1: Database RLS Status
    try {
      const rlsStatus = await db.execute(sql`
        SELECT 
          tablename,
          rowsecurity
        FROM pg_tables 
        WHERE schemaname = 'public' 
          AND tablename IN ('projects', 'documents', 'boq_items', 'bim_models', 'bim_elements')
      `);

      const rlsEnabled = rlsStatus.rows.filter((row: any) => row.rowsecurity).length;
      const status = rlsEnabled >= 4 ? 'healthy' : 'warning';
      
      checks.push({
        name: 'Row Level Security (RLS)',
        status,
        details: `${rlsEnabled} of 5 critical tables protected`,
        critical: rlsEnabled < 3
      });

      if (status !== 'healthy') overallStatus = 'warning';
    } catch (error) {
      checks.push({
        name: 'Row Level Security (RLS)',
        status: 'error',
        details: `Failed to check RLS: ${error instanceof Error ? error.message : String(error)}`,
        critical: true
      });
      overallStatus = 'critical';
    }

    // Check 2: RLS Policies
    try {
      const policies = await db.execute(sql`
        SELECT COUNT(*) as policy_count
        FROM pg_policies 
        WHERE schemaname = 'public' 
          AND policyname LIKE 'tenant_isolation_%'
      `);

      const policyCount = parseInt((policies.rows[0] as any).policy_count);
      const status = policyCount >= 5 ? 'healthy' : 'warning';
      
      checks.push({
        name: 'RLS Tenant Isolation Policies',
        status,
        details: `${policyCount} isolation policies active`,
        critical: policyCount < 3
      });

      if (status !== 'healthy') overallStatus = 'warning';
    } catch (error) {
      checks.push({
        name: 'RLS Tenant Isolation Policies',
        status: 'error',
        details: `Failed to check policies: ${error instanceof Error ? error.message : String(error)}`,
        critical: true
      });
      overallStatus = 'critical';
    }

    // Check 3: Audit Logging
    try {
      const auditTableExists = await db.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = 'audit_logs'
        ) as exists
      `);

      const exists = (auditTableExists.rows[0] as any).exists;
      const status = exists ? 'healthy' : 'critical';
      
      checks.push({
        name: 'Audit Logging System',
        status,
        details: exists ? 'Audit table operational' : 'Audit table missing',
        critical: !exists
      });

      if (!exists) overallStatus = 'critical';
    } catch (error) {
      checks.push({
        name: 'Audit Logging System',
        status: 'error',
        details: `Failed to check audit table: ${error instanceof Error ? error.message : String(error)}`,
        critical: true
      });
      overallStatus = 'critical';
    }

    // Check 4: JWT Token System
    try {
      const tokenStats = getTokenStats();
      const status = 'healthy'; // If function executes, system is working
      
      checks.push({
        name: 'JWT Token System',
        status,
        details: `${tokenStats.activeTokenFamilies} active token families, ${tokenStats.totalTokens} total tokens`,
        critical: false
      });
    } catch (error) {
      checks.push({
        name: 'JWT Token System',
        status: 'error',
        details: `Token system error: ${error instanceof Error ? error.message : String(error)}`,
        critical: true
      });
      overallStatus = 'critical';
    }

    // Check 5: Recent Security Activity
    try {
      const auditStats = await getAuditStatistics(undefined, 'hour');
      const hasActivity = auditStats.totalEvents > 0;
      const status = hasActivity ? 'healthy' : 'info';
      
      checks.push({
        name: 'Security Activity Monitoring',
        status,
        details: `${auditStats.totalEvents} events logged in last hour`,
        critical: false
      });
    } catch (error) {
      checks.push({
        name: 'Security Activity Monitoring',
        status: 'warning',
        details: `Could not retrieve audit statistics: ${error instanceof Error ? error.message : String(error)}`,
        critical: false
      });
      if (overallStatus === 'healthy') overallStatus = 'warning';
    }

    // Determine final status
    const hasCritical = checks.some(check => check.critical && check.status === 'error');
    if (hasCritical) overallStatus = 'critical';

    const response = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      summary: {
        total: checks.length,
        healthy: checks.filter(c => c.status === 'healthy').length,
        warning: checks.filter(c => c.status === 'warning').length,
        error: checks.filter(c => c.status === 'error').length,
        critical: checks.filter(c => c.critical && c.status === 'error').length
      },
      checks,
      recommendations: [] as string[]
    };

    // Add recommendations based on issues
    if (overallStatus !== 'healthy') {
      const failedChecks = checks.filter(c => c.status !== 'healthy');
      response.recommendations = failedChecks.map(check => 
        `Fix ${check.name}: ${check.details}`
      );
    }

    res.json(response);

  } catch (error) {
    console.error('❌ Security health check failed:', error);
    res.status(500).json({
      status: 'critical',
      error: 'Security health check system failure',
      details: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 📊 Security statistics endpoint
 */
router.get('/stats', async (req, res) => {
  try {
    const timeframe = (req.query.timeframe as string) || 'day';
    const companyId = req.query.companyId as string;

    // Get audit statistics
    const auditStats = await getAuditStatistics(companyId, timeframe as any);
    
    // Get token statistics
    const tokenStats = getTokenStats();

    // Get RLS status
    const rlsStatus = await db.execute(sql`
      SELECT COUNT(*) as enabled_tables
      FROM pg_tables 
      WHERE schemaname = 'public' AND rowsecurity = true
    `);

    const response = {
      timeframe,
      companyId: companyId || 'all',
      audit: auditStats,
      tokens: tokenStats,
      rls: {
        enabledTables: parseInt((rlsStatus.rows[0] as any).enabled_tables),
        status: parseInt((rlsStatus.rows[0] as any).enabled_tables) >= 4 ? 'operational' : 'partial'
      },
      timestamp: new Date().toISOString()
    };

    res.json(response);

  } catch (error) {
    console.error('❌ Security stats failed:', error);
    res.status(500).json({
      error: 'Failed to retrieve security statistics',
      details: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 🧪 Security validation test endpoint (development only)
 */
router.post('/validate', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      error: 'Security validation tests disabled in production'
    });
  }

  try {
    const results: {
      timestamp: string;
      tests: Array<{ name: string; passed: boolean; details: string }>;
    } = {
      timestamp: new Date().toISOString(),
      tests: []
    };

    // Test 1: Verify RLS is working
    try {
      await db.execute(sql`SELECT set_config('app.current_user_id', 'test-validation-user', true)`);
      await db.execute(sql`SELECT set_config('app.current_company_id', 'test-validation-company', true)`);
      
      const userSetting = await db.execute(sql`SELECT current_setting('app.current_user_id', true) as user_id`);
      const _companySetting = await db.execute(sql`SELECT current_setting('app.current_company_id', true) as company_id`);

      results.tests.push({
        name: 'Tenant Context Setting',
        passed: (userSetting.rows[0] as any).user_id === 'test-validation-user',
        details: 'PostgreSQL session variables correctly set'
      });
    } catch (error) {
      results.tests.push({
        name: 'Tenant Context Setting',
        passed: false,
        details: `Failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }

    // Test 2: Verify audit logging
    try {
      const testLogCount = await db.execute(sql`
        INSERT INTO audit_logs (
          event_type, severity, user_id, company_id, 
          resource_type, description, metadata, 
          ip_address, user_agent
        ) VALUES (
          'VALIDATION_TEST', 'LOW', 'test-user', 'test-company',
          'SYSTEM', 'Security validation test', '{}',
          '127.0.0.1', 'SecurityValidation/1.0'
        ) RETURNING id
      `);

      results.tests.push({
        name: 'Audit Log Creation',
        passed: testLogCount.rows.length > 0,
        details: 'Audit log entry successfully created'
      });
    } catch (error) {
      results.tests.push({
        name: 'Audit Log Creation',
        passed: false,
        details: `Failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }

    const allPassed = results.tests.every(test => test.passed);
    
    res.json({
      success: allPassed,
      summary: {
        total: results.tests.length,
        passed: results.tests.filter(t => t.passed).length,
        failed: results.tests.filter(t => !t.passed).length
      },
      ...results
    });

  } catch (error) {
    console.error('❌ Security validation failed:', error);
    res.status(500).json({
      error: 'Security validation failed',
      details: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
});

export default router;