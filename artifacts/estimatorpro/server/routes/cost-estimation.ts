/**
 * Cost Estimation API Routes
 * Professional construction cost estimation with RSMeans integration
 */

import { Router } from "express";
import { RSMeansIntegration, CostEstimateRequest } from "../rsmeans-integration";
import { z } from "zod";

export const costEstimationRouter = Router();
const rsMeans = new RSMeansIntegration();

// Validation schemas
const CostEstimateRequestSchema = z.object({
  components: z.array(z.object({
    type: z.string(),
    quantity: z.number().positive(),
    unit: z.string(),
    specifications: z.any().optional()
  })),
  projectLocation: z.object({
    city: z.string(),
    state: z.string(),
    zipCode: z.string().optional()
  }),
  projectType: z.enum(['residential', 'commercial', 'industrial', 'institutional']),
  timeframe: z.string()
});

/**
 * POST /api/cost-estimation/estimate
 * Get comprehensive cost estimate for construction components
 */
costEstimationRouter.post("/estimate", async (req, res) => {
  try {
    const validatedRequest = CostEstimateRequestSchema.parse(req.body);
    const estimate = await rsMeans.getCostEstimate(validatedRequest);
    
    res.json({
      success: true,
      estimate,
      metadata: {
        generated: new Date().toISOString(),
        components_analyzed: validatedRequest.components.length,
        api_used: estimate.confidence === 'high' ? 'rsmeans' : 'fallback'
      }
    });
    
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message || "Cost estimation failed",
      details: error.issues || null
    });
  }
});

/**
 * GET /api/cost-estimation/search
 * Search RSMeans database for cost items
 */
costEstimationRouter.get("/search", async (req, res) => {
  try {
    const { q: query, category, location, limit } = req.query;
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        success: false,
        error: "Query parameter 'q' is required"
      });
    }

    const results = await rsMeans.searchCostItems(query, {
      category: category as string,
      location: location as string,
      maxResults: limit ? parseInt(limit as string) : 50
    });

    res.json({
      success: true,
      results,
      count: results.length,
      query: query
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Search failed"
    });
  }
});

/**
 * GET /api/cost-estimation/trends/:region
 * Get market pricing trends for specific region
 */
costEstimationRouter.get("/trends/:region", async (req, res) => {
  try {
    const { region } = req.params;
    const result = await rsMeans.getMarketTrends(region);

    if (!result.available) {
      return res.json({
        success: true,
        available: false,
        region,
        message: result.message,
      });
    }

    res.json({
      success: true,
      available: true,
      region,
      trends: result.trends,
      forecast: result.forecast,
      lastUpdated: result.lastUpdated,
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch market trends"
    });
  }
});

/**
 * POST /api/cost-estimation/quick
 * Quick cost estimation for single component
 */
costEstimationRouter.post("/quick", async (req, res) => {
  try {
    const { componentType, quantity = 1, unit = "SF", location = "National" } = req.body;
    
    if (!componentType) {
      return res.status(400).json({
        success: false,
        error: "componentType is required"
      });
    }

    const quickRequest: CostEstimateRequest = {
      components: [{
        type: componentType,
        quantity,
        unit
      }],
      projectLocation: {
        city: "Average",
        state: location
      },
      projectType: "commercial",
      timeframe: `${new Date().getFullYear()}-Q${Math.ceil((new Date().getMonth() + 1) / 3)}`
    };

    const estimate = await rsMeans.getCostEstimate(quickRequest);

    res.json({
      success: true,
      componentType,
      quantity,
      unit,
      totalCost: estimate.totalCost,
      costPerUnit: estimate.totalCost / quantity,
      breakdown: estimate.breakdown,
      confidence: estimate.confidence
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Quick estimation failed"
    });
  }
});