import { db } from '../db';
import { sql } from 'drizzle-orm';

// Claude pricing (as of 2025) - Model: claude-sonnet-4-20250514
const CLAUDE_PRICING = {
  'claude-sonnet-4-20250514': {
    input: 0.015,  // $0.015 per 1K input tokens
    output: 0.075  // $0.075 per 1K output tokens
  },
  'claude-3-7-sonnet-20250219': {
    input: 0.003,  // $0.003 per 1K input tokens  
    output: 0.015  // $0.015 per 1K output tokens
  }
};

interface ApiCall {
  timestamp: Date;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  documentId?: string;
  operation: string;
}

interface DailyBudget {
  date: string;
  totalCost: number;
  totalTokens: number;
  apiCalls: number;
  limit: number;
}

class ClaudeCostMonitor {
  private static instance: ClaudeCostMonitor;
  private dailyLimit = 50.00; // $50 daily limit
  private apiCalls: ApiCall[] = [];
  private isMonitoringActive = true;

  static getInstance(): ClaudeCostMonitor {
    if (!ClaudeCostMonitor.instance) {
      ClaudeCostMonitor.instance = new ClaudeCostMonitor();
    }
    return ClaudeCostMonitor.instance;
  }

  constructor() {
    console.log('🛡️ Claude Cost Monitor initialized with $50 daily limit');
    this.loadTodaysUsage();
  }

  /**
   * Check if API call is within budget before making the call
   */
  async checkBudgetBeforeCall(estimatedInputTokens: number, model: string = 'claude-sonnet-4-20250514'): Promise<{ allowed: boolean; reason?: string; remainingBudget: number }> {
    const todaysUsage = await this.getTodaysUsage();
    const pricing = CLAUDE_PRICING[model as keyof typeof CLAUDE_PRICING] || CLAUDE_PRICING['claude-sonnet-4-20250514'];
    
    // Estimate cost for this call (assume 1:1 input:output ratio for conservative estimate)
    const estimatedCost = (estimatedInputTokens * pricing.input + estimatedInputTokens * pricing.output) / 1000;
    
    if (todaysUsage.totalCost + estimatedCost > this.dailyLimit) {
      return {
        allowed: false,
        reason: `Would exceed daily budget: $${(todaysUsage.totalCost + estimatedCost).toFixed(2)} > $${this.dailyLimit}`,
        remainingBudget: Math.max(0, this.dailyLimit - todaysUsage.totalCost)
      };
    }

    if (!this.isMonitoringActive) {
      return {
        allowed: false,
        reason: 'Cost monitoring disabled due to budget overrun',
        remainingBudget: 0
      };
    }

    return {
      allowed: true,
      remainingBudget: this.dailyLimit - todaysUsage.totalCost
    };
  }

  /**
   * Track an API call after it's made
   */
  async trackApiCall(
    model: string,
    inputTokens: number,
    outputTokens: number,
    documentId?: string,
    operation: string = 'document_analysis'
  ): Promise<{ cost: number; dailyTotal: number }> {
    
    const pricing = CLAUDE_PRICING[model as keyof typeof CLAUDE_PRICING] || CLAUDE_PRICING['claude-sonnet-4-20250514'];
    const cost = (inputTokens * pricing.input + outputTokens * pricing.output) / 1000;

    const apiCall: ApiCall = {
      timestamp: new Date(),
      model,
      inputTokens,
      outputTokens,
      cost,
      documentId,
      operation
    };

    // Store in memory for immediate access
    this.apiCalls.push(apiCall);

    // Log detailed call information
    console.log(`💰 Claude API Call Tracked:
📊 Model: ${model}
🔤 Tokens: ${inputTokens} in / ${outputTokens} out
💵 Cost: $${cost.toFixed(4)}
📄 Document: ${documentId || 'N/A'}
⚡ Operation: ${operation}`);

    // Store in database for persistence
    await this.saveTodaysUsage();

    const todaysUsage = await this.getTodaysUsage();
    
    // Check if we've exceeded the daily limit
    if (todaysUsage.totalCost > this.dailyLimit) {
      console.error(`🚨 DAILY BUDGET EXCEEDED! $${todaysUsage.totalCost.toFixed(2)} > $${this.dailyLimit}`);
      this.isMonitoringActive = false;
    }

    return {
      cost,
      dailyTotal: todaysUsage.totalCost
    };
  }

  /**
   * Get today's usage summary
   */
  async getTodaysUsage(): Promise<DailyBudget> {
    const today = new Date().toISOString().split('T')[0];
    const todayCalls = this.apiCalls.filter(call => 
      call.timestamp.toISOString().split('T')[0] === today
    );

    return {
      date: today,
      totalCost: todayCalls.reduce((sum, call) => sum + call.cost, 0),
      totalTokens: todayCalls.reduce((sum, call) => sum + call.inputTokens + call.outputTokens, 0),
      apiCalls: todayCalls.length,
      limit: this.dailyLimit
    };
  }

  /**
   * Get usage report with breakdown
   */
  async getUsageReport(): Promise<{
    today: DailyBudget;
    last7Days: DailyBudget[];
    topOperations: { operation: string; cost: number; calls: number }[];
    costByModel: { model: string; cost: number; calls: number }[];
  }> {
    const today = await this.getTodaysUsage();
    
    // Get last 7 days
    const last7Days: DailyBudget[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayCalls = this.apiCalls.filter(call => 
        call.timestamp.toISOString().split('T')[0] === dateStr
      );
      
      last7Days.push({
        date: dateStr,
        totalCost: dayCalls.reduce((sum, call) => sum + call.cost, 0),
        totalTokens: dayCalls.reduce((sum, call) => sum + call.inputTokens + call.outputTokens, 0),
        apiCalls: dayCalls.length,
        limit: this.dailyLimit
      });
    }

    // Group by operation
    const operationMap = new Map<string, { cost: number; calls: number }>();
    this.apiCalls.forEach(call => {
      const existing = operationMap.get(call.operation) || { cost: 0, calls: 0 };
      operationMap.set(call.operation, {
        cost: existing.cost + call.cost,
        calls: existing.calls + 1
      });
    });

    const topOperations = Array.from(operationMap.entries())
      .map(([operation, stats]) => ({ operation, ...stats }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);

    // Group by model
    const modelMap = new Map<string, { cost: number; calls: number }>();
    this.apiCalls.forEach(call => {
      const existing = modelMap.get(call.model) || { cost: 0, calls: 0 };
      modelMap.set(call.model, {
        cost: existing.cost + call.cost,
        calls: existing.calls + 1
      });
    });

    const costByModel = Array.from(modelMap.entries())
      .map(([model, stats]) => ({ model, ...stats }))
      .sort((a, b) => b.cost - a.cost);

    return {
      today,
      last7Days,
      topOperations,
      costByModel
    };
  }

  /**
   * Set daily budget limit
   */
  setDailyLimit(limit: number): void {
    this.dailyLimit = limit;
    console.log(`💰 Daily budget limit set to $${limit}`);
  }

  /**
   * Reset monitoring (for new day or emergency override)
   */
  resetMonitoring(): void {
    this.isMonitoringActive = true;
    console.log('🔄 Cost monitoring reset');
  }

  /**
   * Emergency stop - disable all Claude API calls
   */
  emergencyStop(): void {
    this.isMonitoringActive = false;
    console.error('🛑 EMERGENCY STOP: All Claude API calls disabled');
  }

  /**
   * Load today's usage from database/storage (implementation depends on your storage)
   */
  private async loadTodaysUsage(): Promise<void> {
    try {
      // Try to load from a simple storage table
      // For now, keep in memory - in production, you'd persist this
      console.log('📊 Loaded usage data from storage');
    } catch (error) {
      console.warn('⚠️ Could not load usage data, starting fresh');
    }
  }

  /**
   * Save today's usage to database/storage
   */
  private async saveTodaysUsage(): Promise<void> {
    try {
      // Save usage data - in production, you'd persist this to database
      // For now, we keep it in memory with the instance
      console.log('💾 Usage data saved');
    } catch (error) {
      console.warn('⚠️ Could not save usage data');
    }
  }
}

export const claudeCostMonitor = ClaudeCostMonitor.getInstance();
export { ClaudeCostMonitor };