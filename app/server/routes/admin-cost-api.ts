/**
 * Admin Cost API — plan usage monitoring and administration.
 *
 * N-8 FIX: Rewrote requireAdmin middleware.
 *
 *   REMOVED:
 *     - req.headers['x-admin-token'] === 'admin123'
 *       Hardcoded secret in source code. Trivially bypassable by anyone who
 *       reads the repository.
 *     - process.env.NODE_ENV === 'development'
 *       Blanket admin grant to every request in the development environment.
 *       Any local or staging deploy had unrestricted admin access.
 *
 *   ADDED:
 *     - authenticateToken applied before requireAdmin on every route so that
 *       req.user is always populated when requireAdmin runs.
 *     - req.user.role === 'admin' is the primary gate (real RBAC).
 *     - x-admin-token header is accepted ONLY when process.env.ADMIN_API_KEY
 *       is set and the header value matches it exactly. If ADMIN_API_KEY is
 *       absent the header check is disabled — no hardcoded fallback.
 *     - ADMIN_API_KEY documented in .env.example.
 */

import { Router } from 'express';
import { planBasedCostMonitor } from '../services/plan-based-cost-monitor';
import { authenticateToken } from '../auth';

const router = Router();

// ─── ADMIN MIDDLEWARE ────────────────────────────────────────────────────────

/**
 * requireAdmin — must run AFTER authenticateToken so req.user is populated.
 *
 * Grants access when either:
 *   (a) req.user.role === 'admin'  — standard RBAC path
 *   (b) x-admin-token header matches process.env.ADMIN_API_KEY — service-to-
 *       service path (only active when ADMIN_API_KEY env var is configured)
 *
 * Neither NODE_ENV nor any hardcoded token ever grants access.
 */
const requireAdmin = (req: any, res: any, next: any): void => {
  // Path (a): role-based access — req.user guaranteed by authenticateToken
  if (req.user?.role === 'admin') {
    return next();
  }

  // Path (b): service-to-service API key — only when env var is configured
  const adminApiKey = process.env.ADMIN_API_KEY;
  if (
    adminApiKey &&
    req.headers['x-admin-token'] === adminApiKey
  ) {
    return next();
  }

  res.status(403).json({
    success: false,
    error: 'Administrator access required',
  });
};

// ─── ROUTES ──────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/usage-summary
 */
router.get(
  '/admin/usage-summary',
  authenticateToken,
  requireAdmin,
  async (_req, res) => {
    try {
      const summary = await planBasedCostMonitor.getAdminUsageSummary();
      res.json({ success: true, data: summary });
    } catch (error) {
      console.error('Error getting admin usage summary:', error);
      res.status(500).json({ success: false, error: 'Failed to get usage summary' });
    }
  }
);

/**
 * GET /api/admin/plan-usage/:planKey
 */
router.get(
  '/admin/plan-usage/:planKey',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { planKey } = req.params;
      const { organizationId } = req.query;

      const result = await planBasedCostMonitor.checkPlanUsage(
        0,
        planKey,
        organizationId as string
      );

      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error getting plan usage:', error);
      res.status(500).json({ success: false, error: 'Failed to get plan usage' });
    }
  }
);

/**
 * POST /api/admin/update-plan
 */
router.post(
  '/admin/update-plan',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { organizationId, planName, codesLicense } = req.body;

      if (!organizationId || !planName) {
        return res.status(400).json({
          success: false,
          error: 'Organization ID and plan name are required',
        });
      }

      if (!['standard', 'pro', 'enterprise'].includes(planName)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid plan name. Must be: standard, pro, or enterprise',
        });
      }

      await planBasedCostMonitor.updatePlan(
        organizationId,
        planName,
        codesLicense || false
      );

      res.json({
        success: true,
        message: `Plan updated to ${planName}${codesLicense ? ' + Codes License' : ''}`,
      });
    } catch (error) {
      console.error('Error updating plan:', error);
      res.status(500).json({ success: false, error: 'Failed to update plan' });
    }
  }
);

/**
 * GET /api/admin/notifications
 */
router.get(
  '/admin/notifications',
  authenticateToken,
  requireAdmin,
  async (_req, res) => {
    try {
      const notifications = planBasedCostMonitor.getAdminNotifications();
      res.json({ success: true, data: notifications });
    } catch (error) {
      console.error('Error getting notifications:', error);
      res.status(500).json({ success: false, error: 'Failed to get notifications' });
    }
  }
);

/**
 * POST /api/admin/notifications/:notificationId/acknowledge
 */
router.post(
  '/admin/notifications/:notificationId/acknowledge',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { notificationId } = req.params;
      planBasedCostMonitor.acknowledgeNotification(notificationId);
      res.json({ success: true, message: 'Notification acknowledged' });
    } catch (error) {
      console.error('Error acknowledging notification:', error);
      res.status(500).json({ success: false, error: 'Failed to acknowledge notification' });
    }
  }
);

/**
 * GET /api/admin/plan-configs
 */
router.get(
  '/admin/plan-configs',
  authenticateToken,
  requireAdmin,
  async (_req, res) => {
    try {
      const planConfigs = {
        standard: {
          name: 'Standard',
          monthlyTokens: 100000,
          dailyTokens: 3333,
          basePrice: '$29/month',
          codesLicenseTokens: 150000,
          codesLicensePrice: '$49/month',
        },
        pro: {
          name: 'Pro',
          monthlyTokens: 500000,
          dailyTokens: 16667,
          basePrice: '$99/month',
          codesLicenseTokens: 750000,
          codesLicensePrice: '$149/month',
        },
        enterprise: {
          name: 'Enterprise',
          monthlyTokens: 2000000,
          dailyTokens: 66667,
          basePrice: '$299/month',
          codesLicenseTokens: 3000000,
          codesLicensePrice: '$449/month',
        },
      };

      res.json({ success: true, data: planConfigs });
    } catch (error) {
      console.error('Error getting plan configs:', error);
      res.status(500).json({ success: false, error: 'Failed to get plan configurations' });
    }
  }
);

/**
 * POST /api/admin/check-all-plans
 */
router.post(
  '/admin/check-all-plans',
  authenticateToken,
  requireAdmin,
  async (_req, res) => {
    try {
      const summary = await planBasedCostMonitor.getAdminUsageSummary();

      const alertCounts = {
        critical: summary.alerts.filter((a: any) => a.severity === 'critical').length,
        warning:  summary.alerts.filter((a: any) => a.severity === 'warning').length,
        info:     summary.alerts.filter((a: any) => a.severity === 'info').length,
      };

      res.json({
        success: true,
        message: 'Plan usage check completed',
        data: {
          plansChecked: summary.plans.length,
          alertsGenerated: summary.alerts.length,
          alertCounts,
        },
      });
    } catch (error) {
      console.error('Error checking all plans:', error);
      res.status(500).json({ success: false, error: 'Failed to check plans' });
    }
  }
);

export default router;
