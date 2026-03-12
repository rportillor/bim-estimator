import type { Express } from "express";
import { storage } from './storage';
import { authenticateToken } from './auth';
import { registerQuote, generateQuoteRegister, formatQuoteRegisterReport } from './estimator/vendor-quotes';
import { buildEstimateForModel } from './estimator/estimate-engine';

export function setupProductRoutes(app: Express) {
  // ─── Product Selection API Routes ───

  // Get product options for a specific BIM element (e.g., sealants for concrete slab)
  app.get('/api/elements/:elementId/products', authenticateToken, async (req, res) => {
    try {
      const elementId = req.params.elementId;
      
      const element = await storage.getBimElement(elementId);
      if (!element) {
        return res.status(404).json({ error: 'Element not found' });
      }

      // Get CSI code from element to find matching products
      const props = element.properties as any;
      const csiCode = props?.csi_code || props?.itemCode || props?.item_code;
      
      if (!csiCode) {
        return res.json({ products: [], message: "No CSI code found for element" });
      }

      const csiDivision = csiCode.split('.')[0];
      const products = await storage.getProductsByCsiDivision(csiDivision);
      
      // Also get current selection if any
      const currentSelection = await storage.getElementProductSelection(elementId);
      
      res.json({
        element: {
          id: element.id,
          elementType: element.elementType,
          csiCode,
          name: element.name
        },
        products,
        currentSelection,
        csiDivision
      });
    } catch (error) {
      console.error('Error fetching product options:', error);
      res.status(500).json({ error: 'Failed to fetch product options' });
    }
  });

  // Set product selection for an element AND register it as a vendor quote
  app.post('/api/elements/:elementId/select-product', authenticateToken, async (req, res) => {
    try {
      const elementId = req.params.elementId;
      const { productId, selectionType, customProductName, customUnitCost, selectionReason } = req.body;
      
      // Save product selection to database
      const selection = await storage.setElementProductSelection({
        bimElementId: elementId,
        productId: productId || null,
        selectionType: selectionType || 'catalog_product',
        customProductName,
        customUnitCost,
        selectionReason,
        selectedByUser: 'current_user'
      });
      
      // Register as a vendor quote if it has cost data
      let quoteRegistration = null;
      if (customUnitCost || productId) {
        try {
          const element = await storage.getBimElement(elementId);
          const props = element?.properties as any;
          const csiCode = props?.csi_code || props?.itemCode || props?.item_code || '';
          const csiDivision = csiCode ? csiCode.substring(0, 2) : '00';

          // Look up product details if productId provided
          let vendorName = 'User Selection';
          let productName = customProductName || '';
          let unitCost = customUnitCost || 0;

          if (productId) {
            const products = await storage.getProductsByCsiDivision(csiDivision);
            const matchedProduct = products.find((p: any) => p.id === productId);
            if (matchedProduct) {
              vendorName = (matchedProduct as any).manufacturer || 'Catalog';
              productName = (matchedProduct as any).name || productName;
              unitCost = unitCost || (matchedProduct as any).unitCost || 0;
            }
          }

          // Build the estimate to pass to registerQuote
          const estimate = await buildEstimateForModel(element?.modelId || '');

          quoteRegistration = registerQuote({
            quoteId: `QT-${Date.now()}`,
            vendorName,
            lineItemDescription: productName || `Product for ${element?.elementType || 'element'}`,
            scopeDescription: selectionReason || `Selected for element ${elementId}`,
            csiDivision,
            csiSubdivision: csiCode || `${csiDivision}0000`,
            quotedAmount: (unitCost || 0),
            quotedUnitRate: unitCost || 0,
            quotedUnit: props?.unit || 'EA',
            includesLabor: false,
            includesMaterial: true,
            includesEquipment: false,
            quoteDate: new Date().toISOString().split('T')[0],
            validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            status: 'PENDING' as any,
          }, estimate);
        } catch (quoteError) {
          console.error('Vendor quote registration failed (non-fatal):', quoteError);
        }
      }

      res.json({
        selection,
        quoteRegistered: !!quoteRegistration,
        quote: quoteRegistration || undefined,
      });
    } catch (error) {
      console.error('Error setting product selection:', error);
      res.status(500).json({ error: 'Failed to set product selection' });
    }
  });

  // Update custom cost for an element
  app.patch('/api/elements/:elementId/custom-cost', authenticateToken, async (req, res) => {
    try {
      const elementId = req.params.elementId;
      const { customCost, customProductName } = req.body;
      
      const selection = await storage.updateElementCustomCost(elementId, customCost, customProductName);
      
      res.json(selection);
    } catch (error) {
      console.error('Error updating custom cost:', error);
      res.status(500).json({ error: 'Failed to update custom cost' });
    }
  });

  // Get all products in a CSI division
  app.get('/api/products/csi/:division', authenticateToken, async (req, res) => {
    try {
      const division = req.params.division;
      const products = await storage.getProductsByCsiDivision(division);
      
      res.json(products);
    } catch (error) {
      console.error('Error fetching products by CSI division:', error);
      res.status(500).json({ error: 'Failed to fetch products' });
    }
  });

  // Initialize product catalog from existing Claude analysis
  app.post('/api/projects/:projectId/initialize-products', authenticateToken, async (req, res) => {
    try {
      const projectId = req.params.projectId;
      
      // Import the product extraction engine
      const { productExtractionEngine } = await import('./product-extraction-engine');
      
      await productExtractionEngine.extractProductsFromSpecifications(projectId);
      
      res.json({ message: 'Product catalog initialized successfully' });
    } catch (error) {
      console.error('Error initializing product catalog:', error);
      res.status(500).json({ error: 'Failed to initialize product catalog' });
    }
  });

  // ─── Vendor Quote Register (read-only — writes happen via select-product above) ───
  
  // Get full quote register for a model's estimate
  app.get('/api/estimates/:modelId/quote-register', authenticateToken, async (req, res) => {
    try {
      const { modelId } = req.params;
      const estimate = await buildEstimateForModel(modelId);
      const register = generateQuoteRegister([], estimate, `Model ${modelId}`);
      
      res.json({
        modelId,
        register,
        report: formatQuoteRegisterReport(register),
      });
    } catch (error) {
      console.error('Error generating quote register:', error);
      res.status(500).json({ error: 'Failed to generate quote register' });
    }
  });
}
