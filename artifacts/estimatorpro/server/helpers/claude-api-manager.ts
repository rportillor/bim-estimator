// server/helpers/claude-api-manager.ts
// ✅ SYSTEM FIX: Claude API rate limiting, context management, and error handling

import Anthropic from '@anthropic-ai/sdk';
import { EnhancedErrorHandler } from './enhanced-error-handler';

interface APICall {
  timestamp: number;
  tokens: number;
}

export class ClaudeAPIManager {
  private static instance: ClaudeAPIManager;
  private client: Anthropic;
  private callHistory: APICall[] = [];
  private readonly MAX_CALLS_PER_MINUTE = 50;
  private readonly MAX_TOKENS_PER_REQUEST = 200000; // Claude's context limit
  private readonly RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
  
  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  
  static getInstance(): ClaudeAPIManager {
    if (!ClaudeAPIManager.instance) {
      ClaudeAPIManager.instance = new ClaudeAPIManager();
    }
    return ClaudeAPIManager.instance;
  }
  
  private cleanOldCalls() {
    const cutoff = Date.now() - this.RATE_LIMIT_WINDOW;
    this.callHistory = this.callHistory.filter(call => call.timestamp > cutoff);
  }
  
  private async waitForRateLimit() {
    this.cleanOldCalls();
    
    if (this.callHistory.length >= this.MAX_CALLS_PER_MINUTE) {
      const oldestCall = this.callHistory[0];
      const waitTime = this.RATE_LIMIT_WINDOW - (Date.now() - oldestCall.timestamp);
      
      if (waitTime > 0) {
        console.log(`⏳ Rate limit reached, waiting ${Math.ceil(waitTime / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
  
  private truncateToContextLimit(text: string, reserveTokens = 4000): string {
    const maxInputTokens = this.MAX_TOKENS_PER_REQUEST - reserveTokens;
    const estimatedTokens = this.estimateTokens(text);
    
    if (estimatedTokens <= maxInputTokens) {
      return text;
    }
    
    // Truncate to fit context window
    const maxChars = maxInputTokens * 4;
    const truncated = text.substring(0, maxChars);
    
    console.warn(`⚠️ Text truncated from ${text.length} to ${truncated.length} chars to fit context window`);
    return truncated + "\n\n[CONTENT TRUNCATED DUE TO LENGTH]";
  }
  
  async createMessage(params: {
    model: string;
    max_tokens: number;
    system?: string;
    messages: any[];
  }): Promise<any> {
    try {
      // Rate limiting
      await this.waitForRateLimit();
      
      // Context management - truncate if needed
      const processedMessages = params.messages.map(msg => ({
        ...msg,
        content: typeof msg.content === 'string' 
          ? this.truncateToContextLimit(msg.content) 
          : msg.content
      }));
      
      const processedSystem = params.system 
        ? this.truncateToContextLimit(params.system, params.max_tokens + 1000)
        : undefined;
      
      // Estimate total tokens for this request
      const totalText = [
        processedSystem || '',
        ...processedMessages.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
      ].join(' ');
      
      const estimatedTokens = this.estimateTokens(totalText);
      
      // CRITICAL FIX: Add timeout protection to prevent connection loss
      const API_TIMEOUT = 120000; // 2 minutes timeout

      console.log(`⏱️ Making Claude API call with ${estimatedTokens} tokens (${API_TIMEOUT/1000}s timeout)`);

      const response = await Promise.race([
        this.client.messages.create({
          ...params,
          system: processedSystem,
          messages: processedMessages
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Claude API timeout after 2 minutes')), API_TIMEOUT)
        )
      ]);
      
      // Track the call for rate limiting
      this.callHistory.push({
        timestamp: Date.now(),
        tokens: estimatedTokens
      });
      
      console.log(`✅ Claude API call successful (${estimatedTokens} estimated tokens)`);
      return response;
      
    } catch (error: any) {
      const detailedError = EnhancedErrorHandler.logAndReturnError(error, 'Claude API call');
      
      // Handle timeout specifically
      if (error.message?.includes('timeout')) {
        console.error('⏱️ Claude API timeout detected');
        throw new Error('Claude API call timed out. Document may be too complex or network connection unstable.');
      }

      // Network connection errors
      if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
        throw new Error('Network connection error. Please check your internet connection and try again.');
      }
      
      // Handle specific Claude API errors
      if (error.status === 429) {
        console.log('⏳ Claude rate limit hit, implementing exponential backoff...');
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30s
        throw new Error('Rate limited by Claude API. Please try again in a moment.');
      }
      
      if (error.message?.includes('context_length_exceeded')) {
        throw new Error('Document too large to process. Please upload smaller or fewer documents.');
      }
      
      if (error.status === 401) {
        throw new Error('Claude API authentication failed. Please check API key configuration.');
      }
      
      throw new Error(detailedError.userMessage);
    }
  }
  
  // Convenience method for document analysis
  async analyzeDocument(content: string, analysisType: string = 'general'): Promise<any> {
    const systemPrompt = this.getSystemPromptForAnalysis(analysisType);
    
    return this.createMessage({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Analyze this construction document:\n\n${content}`
      }]
    });
  }
  
  private getSystemPromptForAnalysis(type: string): string {
    const basePrompt = "You are a professional construction document analyst with expertise in building codes, construction methods, and project documentation.";
    
    switch (type) {
      case 'bim':
        return `${basePrompt} Focus on identifying building elements, dimensions, materials, and spatial relationships for BIM model generation.`;
      case 'compliance':
        return `${basePrompt} Focus on building code compliance, safety requirements, and regulatory standards.`;
      case 'boq':
        return `${basePrompt} Focus on quantities, materials, and cost estimation elements.`;
      default:
        return `${basePrompt} Provide a comprehensive analysis of the construction document.`;
    }
  }
  
  // Get current rate limit status
  getRateLimitStatus() {
    this.cleanOldCalls();
    return {
      callsInLastMinute: this.callHistory.length,
      maxCallsPerMinute: this.MAX_CALLS_PER_MINUTE,
      canMakeCall: this.callHistory.length < this.MAX_CALLS_PER_MINUTE
    };
  }
}