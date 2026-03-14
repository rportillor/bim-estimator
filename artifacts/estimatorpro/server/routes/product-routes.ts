import type { Express } from "express";
import { storage } from "../storage";
import { authenticateToken } from "../auth";

export function setupProductRoutes(app: Express) {
  // Product Selection API Routes

  // Get product options for a specific BIM element
  app.get('/api/elements/:elementId/products', authenticateToken, async (req, res) => {
    try {
      const elementId = req.params.elementId;

      const element = await storage.getBimElement(elementId);
      if (!element) {
        return res.status(404).json({ error: 'Element not found' });
      }

      const props = element.properties as any;
      const csiCode = props?.csi_code || props?.itemCode || props?.item_code;

      if (!csiCode) {
        return res.json({ products: [], message: "No CSI code found for element" });
      }

      const csiDivision = csiCode.split('.')[0];
      const products = await storage.getProductsByCsiDivision(csiDivision);
      const currentSelection = await storage.getElementProductSelection(elementId);

      res.json({
        element: { id: element.id, elementType: element.elementType, csiCode, name: element.name },
        products,
        currentSelection,
        csiDivision,
      });
    } catch (error) {
      console.error('Error fetching product options:', error);
      res.status(500).json({ error: 'Failed to fetch product options' });
    }
  });

  // Set product selection for an element
  app.post('/api/elements/:elementId/select-product', authenticateToken, async (req, res) => {
    try {
      const elementId = req.params.elementId;
      const { productId, selectionType, customProductName, customUnitCost, selectionReason } = req.body;

      const selection = await storage.setElementProductSelection({
        bimElementId: elementId,
        productId: productId || null,
        selectionType: selectionType || 'catalog_product',
        customProductName,
        customUnitCost,
        selectionReason,
        selectedByUser: 'current_user',
      });

      res.json(selection);
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

      // FIX: was './product-extraction-engine' (wrong — resolves to server/routes/product-extraction-engine)
      // Correct path from server/routes/ to server/ root is '../product-extraction-engine'
      const { productExtractionEngine } = await import('../product-extraction-engine');

      await productExtractionEngine.extractProductsFromSpecifications(projectId);

      res.json({ message: 'Product catalog initialized successfully' });
    } catch (error) {
      console.error('Error initializing product catalog:', error);
      res.status(500).json({ error: 'Failed to initialize product catalog' });
    }
  });
}
