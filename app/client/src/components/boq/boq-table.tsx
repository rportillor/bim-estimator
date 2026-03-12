import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useMemo } from "react";
import type { BoqItem } from "@shared/schema";
import { ProductSelector } from "./product-selector";

interface BoqTableProps {
  boqItems?: BoqItem[];
  isLoading: boolean;
}

export default function BoqTable({ boqItems, isLoading }: BoqTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState<'cumulative' | 'by-floor'>('cumulative');
  const itemsPerPage = 50; // Show 50 items per page for performance
  
  // Floor breakdown logic
  const { processedItems, floorSummary } = useMemo(() => {
    if (!boqItems?.length) {
      return { processedItems: [], floorSummary: [] };
    }

    if (viewMode === 'cumulative') {
      // Aggregate quantities by item code for cumulative view
      const aggregated = boqItems.reduce((acc: any[], item) => {
        const existing = acc.find(a => a.itemCode === item.itemCode);
        if (existing) {
          existing.quantity = (parseFloat(existing.quantity) + parseFloat(item.quantity)).toFixed(3);
          existing.amount = (parseFloat(existing.amount || "0") + parseFloat(item.amount || "0")).toFixed(2);
          existing.floor = 'All Floors';
        } else {
          acc.push({ ...item, floor: 'All Floors' });
        }
        return acc;
      }, []);
      
      return { processedItems: aggregated, floorSummary: [] };
    } else {
      // Group by floor for breakdown view
      const byFloor = boqItems.reduce((acc: Record<string, any[]>, item) => {
        const floor = item.floor || 'Unknown';
        if (!acc[floor]) acc[floor] = [];
        acc[floor].push(item);
        return acc;
      }, {});
      
      const floorTotals = Object.entries(byFloor).map(([floor, items]) => ({
        floor,
        items: items.length,
        value: items.reduce((sum, item) => sum + parseFloat(item.amount || "0"), 0)
      }));
      
      return { processedItems: boqItems, floorSummary: floorTotals };
    }
  }, [boqItems, viewMode]);

  // Pagination logic
  const { paginatedItems, totalPages, startIndex, endIndex } = useMemo(() => {
    if (!processedItems?.length) {
      return { paginatedItems: [], totalPages: 0, startIndex: 0, endIndex: 0 };
    }
    
    const total = Math.ceil(processedItems.length / itemsPerPage);
    const start = (currentPage - 1) * itemsPerPage;
    const end = Math.min(start + itemsPerPage, processedItems.length);
    const items = processedItems.slice(start, end);
    
    return {
      paginatedItems: items,
      totalPages: total,
      startIndex: start + 1,
      endIndex: end
    };
  }, [processedItems, currentPage, itemsPerPage]);
  
  // Reset to page 1 when items change (e.g., after filtering)
  useMemo(() => {
    setCurrentPage(1);
  }, [boqItems?.length]);
  if (isLoading) {
    return (
      <Card className="shadow-sm border">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Quantity Breakdown</CardTitle>
            <div className="flex gap-2">
              <Button
                variant={viewMode === 'cumulative' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('cumulative')}
                data-testid="button-cumulative-view"
              >
                Cumulative
              </Button>
              <Button
                variant={viewMode === 'by-floor' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('by-floor')}
                data-testid="button-floor-view"
              >
                By Floor
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const formatCurrency = (value: string) => {
    if (value === "N/A") return "N/A";
    const num = parseFloat(value);
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(num);
  };

  const formatQuantity = (value: string) => {
    return parseFloat(value).toLocaleString();
  };

  const getStandardBadge = (standard: string | null) => {
    if (!standard) return null;
    
    const standardColors: { [key: string]: string } = {
      'CSA A23.1': 'bg-green-100 text-green-800',
      'CSA S16': 'bg-blue-100 text-blue-800', 
      'NBC 9.25': 'bg-purple-100 text-purple-800',
      'NBC 9.23': 'bg-green-100 text-green-800'
    };

    return (
      <Badge className={standardColors[standard] || 'bg-gray-100 text-gray-800'}>
        {standard}
      </Badge>
    );
  };

  return (
    <Card className="shadow-sm border">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle>Quantity Breakdown</CardTitle>
          <div className="flex gap-2">
            <Button
              variant={viewMode === 'cumulative' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('cumulative')}
              data-testid="button-cumulative-view"
            >
              Cumulative
            </Button>
            <Button
              variant={viewMode === 'by-floor' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('by-floor')}
              data-testid="button-floor-view"
            >
              By Floor
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Floor Summary for By-Floor View */}
        {viewMode === 'by-floor' && floorSummary.length > 0 && (
          <Card className="bg-blue-50 border-blue-200 mb-6">
            <CardHeader>
              <CardTitle className="text-blue-800">Floor Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {floorSummary.map((floor) => (
                  <div key={floor.floor} className="text-center">
                    <div className="text-sm text-blue-600 font-medium">{floor.floor}</div>
                    <div className="text-xs text-blue-500">{floor.items} items</div>
                    <div className="text-sm font-semibold text-blue-800">
                      {new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(floor.value)}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Mobile Card Layout */}
        <div className="block md:hidden space-y-4">
          {paginatedItems.map((item) => (
            <Card key={item.id} className="p-4" data-testid={`boq-card-${item.id}`}>
              <div className="space-y-3">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="font-medium text-sm">{item.itemCode}</div>
                    <div className="text-sm text-gray-900 mt-1">{item.description}</div>
                  </div>
                  <div className="ml-2">
                    {getStandardBadge(item.standard)}
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-gray-500">Quantity</div>
                    <div className="font-medium">{formatQuantity(item.quantity)} {item.unit}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Rate</div>
                    <div className={`font-medium ${item.rate === "N/A" ? "text-red-600" : "text-gray-900"}`}>
                      {formatCurrency(item.rate)}
                    </div>
                  </div>
                </div>
                
                <div className="flex justify-between items-center pt-2 border-t">
                  <div>
                    <div className="text-gray-500 text-sm">Amount</div>
                    <div className={`font-semibold ${item.amount === "N/A" ? "text-red-600" : "text-gray-900"}`}>
                      {formatCurrency(item.amount)}
                    </div>
                  </div>
                  <ProductSelector 
                    elementId={item.id}
                    elementName={item.description}
                    csiCode={item.itemCode}
                    currentCost={item.rate !== "N/A" ? parseFloat(item.rate) : undefined}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Desktop Table Layout */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Item Code
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Description
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Floor
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Unit
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Quantity
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Rate (CAD)
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Standard
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Product Selection
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {paginatedItems.map((item, index) => (
                <tr key={item.id} data-testid={`boq-row-${item.id}`}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {item.itemCode}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {item.description}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {item.floor || 'TBD'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {item.unit}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatQuantity(item.quantity)}
                  </td>
                  <td className={`px-6 py-4 whitespace-nowrap text-sm ${item.rate === "N/A" ? "text-red-600 bg-red-50 font-semibold" : "text-gray-900"}`}>
                    {formatCurrency(item.rate)}
                    {item.rate === "N/A" && (
                      <span className="ml-2 text-xs text-red-500">(Not calculated)</span>
                    )}
                  </td>
                  <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${item.amount === "N/A" ? "text-red-600 bg-red-50 font-semibold" : "text-gray-900"}`}>
                    {formatCurrency(item.amount)}
                    {item.amount === "N/A" && (
                      <span className="ml-2 text-xs text-red-500">(Not calculated)</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStandardBadge(item.standard)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <ProductSelector 
                      elementId={item.id}
                      elementName={item.description}
                      csiCode={item.itemCode}
                      currentCost={item.rate !== "N/A" ? parseFloat(item.rate) : undefined}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-6 border-t bg-gray-50">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">
              Showing {startIndex}-{endIndex} of {boqItems?.length || 0} items
              {totalPages > 1 && (
                <span className="ml-2 text-gray-500">
                  (Page {currentPage} of {totalPages})
                </span>
              )}
            </span>
            <div className="flex gap-2 items-center">
              <Button 
                variant="outline" 
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                data-testid="button-previous-page"
              >
                Previous
              </Button>
              
              {/* Page numbers for easy navigation */}
              {totalPages > 1 && (
                <div className="flex gap-1">
                  {[...Array(Math.min(5, totalPages))].map((_, i) => {
                    const pageNum = currentPage <= 3 ? i + 1 : currentPage - 2 + i;
                    if (pageNum > totalPages) return null;
                    
                    return (
                      <Button
                        key={pageNum}
                        variant={pageNum === currentPage ? "default" : "outline"}
                        size="sm"
                        className="w-8 h-8 p-0"
                        onClick={() => setCurrentPage(pageNum)}
                        data-testid={`button-page-${pageNum}`}
                      >
                        {pageNum}
                      </Button>
                    );
                  })}
                  {totalPages > 5 && currentPage < totalPages - 2 && (
                    <span className="text-gray-400 px-2">...</span>
                  )}
                </div>
              )}
              
              <Button 
                variant="outline"
                size="sm" 
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                data-testid="button-next-page"
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
