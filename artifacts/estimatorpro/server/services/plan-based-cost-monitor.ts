import { db as _db } from '../db';
import { sql as _sql } from 'drizzle-orm';

// Plan-based token allocation system
interface Plan {
  name: 'standard' | 'pro' | 'enterprise';
  monthlyTokens: number;
  dailyTokens: number;
  codesLicense: boolean;
  costPerToken: number;
}

interface PlanUsage {
  planName: string;
  codesLicense: boolean;
  tokensUsed: number;
  tokensRemaining: number;
  monthlyLimit: number;
  dailyLimit: number;
  usagePercentage: number;
  costIncurred: number;
  alert75Triggered: boolean;
}

interface AdminNotification {
  id: string;
  type: 'usage_alert' | 'budget_exceeded' | 'plan_change';
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: Date;
  acknowledged: boolean;
  planName: string;
  usagePercentage?: number;
}

class PlanBasedCostMonitor {
  private static instance: PlanBasedCostMonitor;
  private notifications: AdminNotification[] = [];

  // Plan configurations
  private plans: Record<string, Plan> = {
    standard: {
      name: 'standard',
      monthlyTokens: 100000,    // 100K tokens/month
      dailyTokens: 3333,       // ~100K/30 days
      codesLicense: false,
      costPerToken: 0.000015   // Standard rate
    },
    'standard-codes': {
      name: 'standard',
      monthlyTokens: 150000,    // 150K tokens/month with codes
      dailyTokens: 5000,       // ~150K/30 days
      codesLicense: true,
      costPerToken: 0.000015
    },
    pro: {
      name: 'pro',
      monthlyTokens: 500000,    // 500K tokens/month
      dailyTokens: 16667,      // ~500K/30 days
      codesLicense: false,
      costPerToken: 0.000012   // Pro discount
    },
    'pro-codes': {
      name: 'pro',
      monthlyTokens: 750000,    // 750K tokens/month with codes
      dailyTokens: 25000,      // ~750K/30 days
      codesLicense: true,
      costPerToken: 0.000012
    },
    enterprise: {
      name: 'enterprise',
      monthlyTokens: 2000000,   // 2M tokens/month
      dailyTokens: 66667,      // ~2M/30 days
      codesLicense: false,
      costPerToken: 0.00001    // Enterprise discount
    },
    'enterprise-codes': {
      name: 'enterprise',
      monthlyTokens: 3000000,   // 3M tokens/month with codes
      dailyTokens: 100000,     // ~3M/30 days
      codesLicense: true,
      costPerToken: 0.00001
    }
  };

  static getInstance(): PlanBasedCostMonitor {
    if (!PlanBasedCostMonitor.instance) {
      PlanBasedCostMonitor.instance = new PlanBasedCostMonitor();
    }
    return PlanBasedCostMonitor.instance;
  }

  constructor() {
    console.log('🏢 Plan-based Cost Monitor initialized');
  }

  /**
   * Get current plan configuration for a user/organization
   */
  async getCurrentPlan(_organizationId?: string): Promise<Plan> {
    // In production, you'd fetch this from user/organization settings
    // For now, default to standard plan
    const defaultPlan = 'standard'; // This would come from database
    const hasCodesLicense = false; // This would come from subscription settings
    
    const planKey = hasCodesLicense ? `${defaultPlan}-codes` : defaultPlan;
    return this.plans[planKey] || this.plans.standard;
  }

  /**
   * Check if usage is within plan limits and generate alerts
   */
  async checkPlanUsage(
    tokensUsed: number, 
    planKey: string = 'standard',
    organizationId?: string
  ): Promise<{ allowed: boolean; usage: PlanUsage; alerts: AdminNotification[] }> {
    
    const plan = this.plans[planKey] || this.plans.standard;
    const monthlyUsage = await this.getMonthlyTokenUsage(organizationId);
    const dailyUsage = await this.getDailyTokenUsage(organizationId);
    
    const totalMonthlyUsed = monthlyUsage + tokensUsed;
    const totalDailyUsed = dailyUsage + tokensUsed;
    
    const monthlyPercentage = (totalMonthlyUsed / plan.monthlyTokens) * 100;
    const _dailyPercentage = (totalDailyUsed / plan.dailyTokens) * 100;
    
    const usage: PlanUsage = {
      planName: plan.name,
      codesLicense: plan.codesLicense,
      tokensUsed: totalMonthlyUsed,
      tokensRemaining: plan.monthlyTokens - totalMonthlyUsed,
      monthlyLimit: plan.monthlyTokens,
      dailyLimit: plan.dailyTokens,
      usagePercentage: monthlyPercentage,
      costIncurred: totalMonthlyUsed * plan.costPerToken,
      alert75Triggered: monthlyPercentage >= 75
    };

    const alerts: AdminNotification[] = [];

    // Check for 75% usage alert
    if (monthlyPercentage >= 75 && monthlyPercentage < 90 && !this.hasRecentAlert('75_percent', planKey)) {
      alerts.push(this.createAlert(
        'usage_alert',
        `${plan.name.toUpperCase()} plan at ${monthlyPercentage.toFixed(1)}% usage (${totalMonthlyUsed.toLocaleString()}/${plan.monthlyTokens.toLocaleString()} tokens)`,
        'warning',
        plan.name,
        monthlyPercentage
      ));
    }

    // Check for 90% usage alert
    if (monthlyPercentage >= 90 && monthlyPercentage < 100 && !this.hasRecentAlert('90_percent', planKey)) {
      alerts.push(this.createAlert(
        'usage_alert',
        `${plan.name.toUpperCase()} plan at ${monthlyPercentage.toFixed(1)}% usage - approaching limit!`,
        'critical',
        plan.name,
        monthlyPercentage
      ));
    }

    // Check for over-limit
    if (monthlyPercentage >= 100) {
      alerts.push(this.createAlert(
        'budget_exceeded',
        `${plan.name.toUpperCase()} plan limit exceeded! ${totalMonthlyUsed.toLocaleString()}/${plan.monthlyTokens.toLocaleString()} tokens`,
        'critical',
        plan.name,
        monthlyPercentage
      ));
    }

    // Daily limit check
    const allowed = totalDailyUsed <= plan.dailyTokens && totalMonthlyUsed <= plan.monthlyTokens;

    // Store alerts for admin dashboard
    alerts.forEach(alert => this.notifications.push(alert));

    return { allowed, usage, alerts };
  }

  /**
   * Track token usage for a specific plan
   */
  async trackPlanUsage(
    tokensUsed: number,
    planKey: string,
    operation: string,
    organizationId?: string
  ): Promise<PlanUsage> {
    
    const { usage } = await this.checkPlanUsage(tokensUsed, planKey, organizationId);
    
    // Log usage tracking
    console.log(`📊 Plan Usage Tracked:
🏢 Plan: ${usage.planName.toUpperCase()}${usage.codesLicense ? ' + Codes' : ''}
🔢 Tokens: ${tokensUsed.toLocaleString()} (Operation: ${operation})
📈 Monthly: ${usage.tokensUsed.toLocaleString()}/${usage.monthlyLimit.toLocaleString()} (${usage.usagePercentage.toFixed(1)}%)
💰 Cost: $${usage.costIncurred.toFixed(4)}
🎯 Remaining: ${usage.tokensRemaining.toLocaleString()} tokens`);

    return usage;
  }

  /**
   * Get all administrator notifications
   */
  getAdminNotifications(): AdminNotification[] {
    return this.notifications
      .filter(n => !n.acknowledged)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Acknowledge an admin notification
   */
  acknowledgeNotification(notificationId: string): void {
    const notification = this.notifications.find(n => n.id === notificationId);
    if (notification) {
      notification.acknowledged = true;
    }
  }

  /**
   * Get usage summary for all plans
   */
  async getAdminUsageSummary(): Promise<{
    plans: PlanUsage[];
    alerts: AdminNotification[];
    totalCost: number;
    totalTokens: number;
  }> {
    
    const planUsages: PlanUsage[] = [];
    let totalCost = 0;
    let totalTokens = 0;

    // Get usage for each plan type
    for (const [_planKey, plan] of Object.entries(this.plans)) {
      const monthlyUsage = await this.getMonthlyTokenUsage();
      const usage: PlanUsage = {
        planName: plan.name,
        codesLicense: plan.codesLicense,
        tokensUsed: monthlyUsage,
        tokensRemaining: plan.monthlyTokens - monthlyUsage,
        monthlyLimit: plan.monthlyTokens,
        dailyLimit: plan.dailyTokens,
        usagePercentage: (monthlyUsage / plan.monthlyTokens) * 100,
        costIncurred: monthlyUsage * plan.costPerToken,
        alert75Triggered: (monthlyUsage / plan.monthlyTokens) * 100 >= 75
      };
      
      planUsages.push(usage);
      totalCost += usage.costIncurred;
      totalTokens += usage.tokensUsed;
    }

    return {
      plans: planUsages,
      alerts: this.getAdminNotifications(),
      totalCost,
      totalTokens
    };
  }

  /**
   * Update plan for organization
   */
  async updatePlan(
    organizationId: string,
    planName: 'standard' | 'pro' | 'enterprise',
    codesLicense: boolean = false
  ): Promise<void> {
    
    const planKey = codesLicense ? `${planName}-codes` : planName;
    
    // In production, save to database
    console.log(`🔄 Plan updated: Organization ${organizationId} → ${planKey}`);
    
    // Create notification
    const alert = this.createAlert(
      'plan_change',
      `Plan updated to ${planName.toUpperCase()}${codesLicense ? ' + Codes License' : ''}`,
      'info',
      planName
    );
    
    this.notifications.push(alert);
  }

  // Private helper methods

  private async getMonthlyTokenUsage(_organizationId?: string): Promise<number> {
    // Get actual usage from Claude cost monitor
    try {
      const { claudeCostMonitor } = await import('./claude-cost-monitor.js');
      const usage = await claudeCostMonitor.getTodaysUsage();
      return Math.round(usage.totalTokens || 0);
    } catch (error) {
      console.error('Failed to get monthly token usage:', error);
      return 0; // Return 0 instead of random value
    }
  }

  private async getDailyTokenUsage(_organizationId?: string): Promise<number> {
    // Get actual usage from Claude cost monitor
    try {
      const { claudeCostMonitor } = await import('./claude-cost-monitor.js');
      const usage = await claudeCostMonitor.getTodaysUsage();
      return Math.round(usage.totalTokens || 0);
    } catch (error) {
      console.error('Failed to get daily token usage:', error);
      return 0; // Return 0 instead of random value
    }
  }

  private hasRecentAlert(type: string, planKey: string): boolean {
    const oneHour = 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - oneHour);
    
    return this.notifications.some(n => 
      n.message.includes(type) && 
      n.planName === planKey && 
      n.timestamp > cutoff
    );
  }

  private createAlert(
    type: AdminNotification['type'],
    message: string,
    severity: AdminNotification['severity'],
    planName: string,
    usagePercentage?: number
  ): AdminNotification {
    return {
      id: `alert_${Date.now()}_system`,
      type,
      message,
      severity,
      timestamp: new Date(),
      acknowledged: false,
      planName,
      usagePercentage
    };
  }
}

export const planBasedCostMonitor = PlanBasedCostMonitor.getInstance();
export { PlanBasedCostMonitor, type Plan, type PlanUsage, type AdminNotification };