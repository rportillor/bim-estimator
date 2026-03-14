import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ShoppingCart, DollarSign, Package } from "lucide-react";

interface ProductSelectorProps {
  elementId: string;
  elementName: string;
  csiCode?: string;
  currentCost?: number;
}

export function ProductSelector({ elementId, elementName, csiCode, currentCost }: ProductSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectionType, setSelectionType] = useState<'catalog_product' | 'custom_cost'>('catalog_product');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [customCost, setCustomCost] = useState<string>(currentCost?.toString() || '');
  const [customProductName, setCustomProductName] = useState<string>('');
  const [selectionReason, setSelectionReason] = useState<string>('');
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get product options for this element
  const { data: productData, isLoading } = useQuery({
    queryKey: ['/api/elements', elementId, 'products'],
    enabled: isOpen,
  });

  // Set product selection mutation
  const selectProductMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest('POST', `/api/elements/${elementId}/select-product`, data);
    },
    onSuccess: () => {
      toast({
        title: "Product Selected",
        description: "Product selection updated successfully",
      });
      setIsOpen(false);
      // Invalidate BoQ data to refresh costs
      queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
    },
    onError: (_error) => {
      toast({
        title: "Error",
        description: "Failed to update product selection",
        variant: "destructive",
      });
    }
  });

  // Custom cost update mutation
  const updateCostMutation = useMutation({
    mutationFn: async (data: { customCost: number; customProductName?: string }) => {
      return apiRequest('PATCH', `/api/elements/${elementId}/custom-cost`, data);
    },
    onSuccess: () => {
      toast({
        title: "Cost Updated",
        description: "Custom cost updated successfully",
      });
      setIsOpen(false);
      // Invalidate BoQ data to refresh costs
      queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
    },
    onError: (_error) => {
      toast({
        title: "Error",
        description: "Failed to update custom cost",
        variant: "destructive",
      });
    }
  });

  const handleSubmit = () => {
    if (selectionType === 'catalog_product') {
      if (!selectedProductId) {
        toast({
          title: "Selection Required",
          description: "Please select a product from the catalog",
          variant: "destructive",
        });
        return;
      }
      
      selectProductMutation.mutate({
        productId: selectedProductId,
        selectionType: 'catalog_product',
        selectionReason
      });
    } else {
      const cost = parseFloat(customCost);
      if (isNaN(cost) || cost <= 0) {
        toast({
          title: "Invalid Cost",
          description: "Please enter a valid cost amount",
          variant: "destructive",
        });
        return;
      }
      
      updateCostMutation.mutate({
        customCost: cost,
        customProductName: customProductName || undefined
      });
    }
  };

  const products = (productData as any)?.products || [];
  const element = (productData as any)?.element;
  const currentSelection = (productData as any)?.currentSelection;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-8 px-2"
          data-testid={`button-select-product-${elementId}`}
        >
          <ShoppingCart className="h-3 w-3 mr-1" />
          Select Product
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Product Selection - {elementName}</DialogTitle>
          <div className="text-sm text-muted-foreground">
            CSI Code: {csiCode || element?.csiCode || 'Not available'} | Element Type: {element?.elementType}
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Selection Type */}
          <div className="space-y-2">
            <Label>Selection Type</Label>
            <Select value={selectionType} onValueChange={(value: any) => setSelectionType(value)}>
              <SelectTrigger data-testid="select-selection-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="catalog_product">Choose from Catalog</SelectItem>
                <SelectItem value="custom_cost">Enter Custom Cost</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {selectionType === 'catalog_product' ? (
            <div className="space-y-4">
              <div className="text-sm font-medium">
                Available Products for CSI Division {(productData as any)?.csiDivision}
              </div>
              
              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <Card key={i} className="p-4">
                      <div className="animate-pulse space-y-2">
                        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                        <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : products.length === 0 ? (
                <Card className="p-4">
                  <div className="text-center text-muted-foreground">
                    <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    No products found for this CSI division.
                    <div className="text-xs mt-1">CSI Division: {(productData as any)?.csiDivision}</div>
                  </div>
                </Card>
              ) : (
                <div className="space-y-2">
                  {products.map((product: any) => (
                    <Card 
                      key={product.id}
                      className={`p-4 cursor-pointer transition-colors ${
                        selectedProductId === product.id 
                          ? 'border-blue-500 bg-blue-50' 
                          : 'hover:bg-gray-50'
                      }`}
                      onClick={() => setSelectedProductId(product.id)}
                      data-testid={`card-product-${product.id}`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="font-medium">{product.productName}</div>
                          <div className="text-sm text-muted-foreground">{product.manufacturer}</div>
                          <div className="text-sm mt-1">{product.specifications}</div>
                          {product.grade && (
                            <Badge variant="outline" className="mt-1">{product.grade}</Badge>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-green-600">
                            ${product.defaultUnitCost}
                          </div>
                          <div className="text-xs text-muted-foreground">per {product.unit}</div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {/* Selection Reason */}
              <div className="space-y-2">
                <Label htmlFor="selection-reason">Selection Reason (Optional)</Label>
                <Textarea
                  id="selection-reason"
                  placeholder="Why are you choosing this product? (e.g., cost effective, local supplier, previous experience)"
                  value={selectionReason}
                  onChange={(e) => setSelectionReason(e.target.value)}
                  data-testid="textarea-selection-reason"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-sm font-medium">
                Enter Custom Product and Cost
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="custom-product-name">Product Name (Optional)</Label>
                <Input
                  id="custom-product-name"
                  placeholder="e.g., Local Supplier XYZ Concrete 25 MPa"
                  value={customProductName}
                  onChange={(e) => setCustomProductName(e.target.value)}
                  data-testid="input-custom-product-name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="custom-cost">Unit Cost (CAD)</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="custom-cost"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={customCost}
                    onChange={(e) => setCustomCost(e.target.value)}
                    className="pl-9"
                    data-testid="input-custom-cost"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Current Selection Display */}
          {currentSelection && (
            <Card className="bg-blue-50 border-blue-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Current Selection</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-sm">
                  {currentSelection.customProductName || 'Catalog Product'} - 
                  ${currentSelection.customUnitCost || 'Default Cost'}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Selected on {new Date(currentSelection.createdAt).toLocaleDateString()}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-4">
            <Button 
              onClick={handleSubmit}
              disabled={selectProductMutation.isPending || updateCostMutation.isPending}
              className="flex-1"
              data-testid="button-confirm-selection"
            >
              {selectProductMutation.isPending || updateCostMutation.isPending ? (
                "Updating..."
              ) : (
                selectionType === 'catalog_product' ? "Select Product" : "Update Cost"
              )}
            </Button>
            <Button variant="outline" onClick={() => setIsOpen(false)} data-testid="button-cancel-selection">
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}