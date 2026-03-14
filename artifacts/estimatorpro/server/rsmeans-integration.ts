/**
 * RSMeans Cost Estimation API Integration for EstimatorPro
 * Professional construction cost database integration
 */

import axios from 'axios';

export type SubscriptionTier = 'basic' | 'professional' | 'enterprise';

export interface GordianCostFactor {
  costFactorKey: string;
  materialCostFactor: number;
  equipmentCostFactor: number;
  installationCostFactor: number;
  totalCostFactor: number;
}

export interface GordianCatalog {
  id: string;
  catalogName: string;
  costDataFormat: 'uni' | 'resi';
  measurementSystem: 'imp' | 'met';
  laborType: 'std' | 'opn' | 'fmr' | 'res' | 'rr' | 'fed' | 'he';
}

export interface RSMeansItem {
  id: string;
  description: string;
  unit: string;
  laborCost: number;
  materialCost: number;
  equipmentCost: number;
  totalCost: number;
  location: string;
  date: string;
  source: 'rsmeans' | 'dodge' | 'craftsman' | 'regional';
}

export interface CostEstimateRequest {
  components: Array<{
    type: string;
    quantity: number;
    unit: string;
    specifications?: any;
  }>;
  projectLocation: {
    city: string;
    state: string;
    zipCode?: string;
  };
  projectType: 'residential' | 'commercial' | 'industrial' | 'institutional';
  timeframe: string; // "2025-Q1"
}

export interface CostEstimateResponse {
  totalCost: number;
  breakdown: {
    labor: number;
    materials: number;
    equipment: number;
    overhead: number;
    profit: number;
  };
  itemizedCosts: RSMeansItem[];
  locationFactors: {
    laborIndex: number;
    materialIndex: number;
    equipmentIndex: number;
  };
  confidence: 'high' | 'medium' | 'low';
  lastUpdated: string;
}

export class RSMeansIntegration {
  private apiKey: string;
  private baseUrl: string;
  private isEnterpriseMode: boolean = false;

  constructor() {
    // Real Gordian RSMeans API configuration
    // WP-R11 FIX: initializeFallbackDatabase() removed.
    // If RSMEANS_API_KEY is absent, getCostEstimate() returns an error response.
    // No fallback cost database is initialised — fabricated costs are not permitted.
    this.apiKey = process.env.RSMEANS_API_KEY || '';
    this.baseUrl = process.env.RSMEANS_API_URL || 'https://dataapi-sb.gordian.com/v1';

    if (!this.apiKey) {
      console.error(
        '❌ [RSMEANS] RSMEANS_API_KEY is not set. ' +
        'getCostEstimate() will return error responses until the key is configured. ' +
        'No fallback cost database will be used — fabricated costs are not permitted.'
      );
    } else {
      console.log('✅ RSMeans API integration ready (Enterprise Mode)');
      this.isEnterpriseMode = true;
    }
  }

  /**
   * Check if user has enterprise access to RSMeans API
   */
  private checkEnterpriseAccess(userTier: SubscriptionTier): boolean {
    return userTier === 'enterprise' && this.isEnterpriseMode;
  }

  /**
   * Get cost estimate for construction components with tier-based access
   */
  async getCostEstimate(
    request: CostEstimateRequest, 
    userTier: SubscriptionTier = 'basic'
  ): Promise<CostEstimateResponse> {
    try {
      // Enterprise users get RSMeans API access
      if (this.checkEnterpriseAccess(userTier)) {
        console.log('🏢 Using Enterprise RSMeans API for high-accuracy estimation');
        return await this.getGordianRSMeansEstimate(request);
      } else {
        throw new Error(`
❌ COST ESTIMATION REQUIRES CLAUDE ANALYSIS

All cost data must come from Claude analyzing actual project specifications.
No hardcoded pricing databases allowed.

User tier: ${userTier}
        `);
      }
    } catch (error) {
      console.error('❌ Cost estimation failed:', error);
      throw new Error(`
🚫 NO FALLBACK COSTS ALLOWED

Claude must extract real pricing from project documents.
Original error: ${error}
      `);
    }
  }

  /**
   * Enhanced location detection for Canadian projects
   */
  private isCanadianLocation(location: { city: string; state: string; zipCode?: string }): boolean {
    const canadianProvinces = ['ON', 'BC', 'AB', 'QC', 'SK', 'MB', 'NS', 'NB', 'NL', 'PE', 'NT', 'YT', 'NU'];
    return canadianProvinces.includes(location.state.toUpperCase());
  }

  /**
   * Get location ID for Gordian API
   */
  private getLocationId(location: { city: string; state: string; zipCode?: string }): string {
    if (this.isCanadianLocation(location)) {
      // Use Canadian location mapping
      const provinceMap: Record<string, string> = {
        'ON': 'ca-on-toronto',
        'BC': 'ca-bc-vancouver', 
        'AB': 'ca-ab-calgary',
        'QC': 'ca-qc-montreal'
        // Add more as needed
      };
      return provinceMap[location.state.toUpperCase()] || 'ca-national';
    }
    
    // Use ZIP code for US locations
    return location.zipCode || 'us-us-national';
  }

  /**
   * Real Gordian RSMeans API integration
   */
  private async getGordianRSMeansEstimate(request: CostEstimateRequest): Promise<CostEstimateResponse> {
    
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };

    // Use metric system for Canadian projects, imperial for US
    const _measurementSystem = this.isCanadianLocation(request.projectLocation) ? 'met' : 'imp';
    
    // Get cost factors for location
    const costFactorsResponse = await axios.get(`${this.baseUrl}/costdata/assembly/costfactors`, {
      headers,
      params: {
        locationId: this.getLocationId(request.projectLocation),
        expand: 'location,release'
      }
    });

    const locationFactors = costFactorsResponse.data.items[0]?.costFactors || {
      materialCostFactor: 1.0,
      equipmentCostFactor: 1.0,
      installationCostFactor: 1.0,
      totalCostFactor: 1.0
    };

    // Get cost data for each component
    const itemizedCosts: RSMeansItem[] = [];
    let totalCost = 0;
    let laborTotal = 0;
    let materialsTotal = 0;
    let equipmentTotal = 0;

    for (const component of request.components) {
      const costResponse = await axios.post(
        `${this.baseUrl}/cost-lookup`,
        {
          component: component.type,
          quantity: component.quantity,
          unit: component.unit,
          specifications: component.specifications,
          projectType: request.projectType,
          location: request.projectLocation
        },
        { headers }
      );

      const costData = costResponse.data;
      
      const item: RSMeansItem = {
        id: costData.item_id,
        description: costData.description,
        unit: costData.unit,
        laborCost: costData.labor_cost * locationFactors.labor_index,
        materialCost: costData.material_cost * locationFactors.material_index,
        equipmentCost: costData.equipment_cost * locationFactors.equipment_index,
        totalCost: costData.total_cost * locationFactors.composite_index,
        location: `${request.projectLocation.city}, ${request.projectLocation.state}`,
        date: new Date().toISOString(),
        source: 'rsmeans'
      };

      itemizedCosts.push(item);
      totalCost += item.totalCost * component.quantity;
      laborTotal += item.laborCost * component.quantity;
      materialsTotal += item.materialCost * component.quantity;
      equipmentTotal += item.equipmentCost * component.quantity;
    }

    // Add overhead and profit (typical 15-25%)
    const overhead = totalCost * 0.15;
    const profit = totalCost * 0.10;
    const finalTotal = totalCost + overhead + profit;

    return {
      totalCost: finalTotal,
      breakdown: {
        labor: laborTotal,
        materials: materialsTotal,
        equipment: equipmentTotal,
        overhead,
        profit
      },
      itemizedCosts,
      locationFactors: locationFactors,
      confidence: 'high',
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Location factor calculation for Canada and US
   */
  private getLocationFactor(stateOrProvince: string): number {
    const locationFactors: Record<string, number> = {
      // US States
      'CA': 1.25, 'NY': 1.35, 'TX': 0.95, 'FL': 1.05,
      'IL': 1.15, 'PA': 1.10, 'OH': 0.90, 'GA': 0.85,
      'NC': 0.88, 'MI': 0.95, 'NJ': 1.30, 'VA': 1.05,
      'WA': 1.20, 'AZ': 0.95, 'MA': 1.25, 'TN': 0.82,
      'IN': 0.88, 'MO': 0.90, 'MD': 1.15, 'WI': 0.92,
      
      // Canadian Provinces (CAD pricing factors)
      'ON': 1.08, // Ontario - Toronto/Ottawa higher, rural lower
      'BC': 1.22, // British Columbia - Vancouver premium
      'AB': 0.98, // Alberta - strong economy, moderate costs
      'QC': 1.05, // Quebec - Montreal/Quebec City
      'SK': 0.85, // Saskatchewan - lower cost of living
      'MB': 0.88, // Manitoba - Winnipeg moderate costs
      'NS': 0.92, // Nova Scotia - Halifax moderate
      'NB': 0.85, // New Brunswick - lower costs
      'NL': 0.95, // Newfoundland and Labrador - remote premium
      'PE': 0.90, // Prince Edward Island - lower costs
      'NT': 1.45, // Northwest Territories - remote/harsh climate
      'YT': 1.35, // Yukon - remote premium
      'NU': 1.55  // Nunavut - highest remote premium
    };
    
    return locationFactors[stateOrProvince] || 1.00; // Default to national average
  }

  /**
   * Search RSMeans database for specific items
   */
  async searchCostItems(query: string, filters?: {
    category?: string;
    location?: string;
    maxResults?: number;
  }): Promise<RSMeansItem[]> {
    
    if (this.apiKey) {
      try {
        const response = await axios.get(`${this.baseUrl}/search`, {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          params: {
            q: query,
            category: filters?.category,
            location: filters?.location,
            limit: filters?.maxResults || 50
          }
        });
        
        return response.data.items;
        
      } catch (error) {
        console.error('❌ RSMeans search failed:', error);
      }
    }
    
    // WP-R11 FIX: No fallback database search. RSMEANS_API_KEY required.
    console.error('❌ [RSMEANS] searchCostItems failed: RSMEANS_API_KEY not configured.');
    return [];
  }

  /**
   * Get current market pricing trends.
   * Requires RSMEANS_API_KEY — returns unavailable status without it.
   */
  async getMarketTrends(region: string): Promise<{
    available: boolean;
    message?: string;
    trends?: Record<string, number>;
    forecast?: Record<string, number>;
    lastUpdated?: string;
  }> {
    if (!this.apiKey) {
      return {
        available: false,
        message: 'Market trend data requires RSMeans API integration. Configure RSMEANS_API_KEY environment variable to enable live market data.',
      };
    }

    try {
      const response = await fetch(`${this.baseUrl}/market-trends?region=${encodeURIComponent(region)}`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Accept': 'application/json' },
      });
      if (!response.ok) {
        return {
          available: false,
          message: `RSMeans API returned ${response.status}: ${response.statusText}`,
        };
      }
      const data = await response.json();
      return {
        available: true,
        trends: data.trends,
        forecast: data.forecast,
        lastUpdated: data.lastUpdated || new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        available: false,
        message: `RSMeans API error: ${err.message}`,
      };
    }
  }
}