import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, List, Square } from "lucide-react";
import type { BoqItem } from "@shared/schema";

interface BoqSummaryProps {
  boqItems?: BoqItem[];
  isLoading: boolean;
}

export default function BoqSummary({ boqItems, isLoading }: BoqSummaryProps) {
  // Calculate totals excluding N/A values
  const calculateTotals = (items: BoqItem[] | undefined) => {
    if (!Array.isArray(items) || items.length === 0) {
      return { 
        totalValue: 0, 
        calculatedItems: 0, 
        incompleteItems: 0, 
        hasIncompleteData: false 
      };
    }
    
    const validItems = items.filter(item => item.amount !== "N/A" && item.amount !== "0");
    const incompleteItems = items.filter(item => item.amount === "N/A").length;
    const totalValue = validItems.reduce((sum, item) => sum + parseFloat(item.amount || "0"), 0);
    
    return {
      totalValue,
      calculatedItems: validItems.length,
      incompleteItems,
      hasIncompleteData: incompleteItems > 0
    };
  };

  // Calculate actual building area from BoQ items
  const calculateBuildingArea = (items: BoqItem[] | undefined) => {
    if (!Array.isArray(items) || items.length === 0) return "0 m²";
    
    const areaItems = items.filter(item => 
      item.unit === 'm²' && 
      (item.description?.toLowerCase().includes('area') || 
       item.description?.toLowerCase().includes('floor') ||
       item.description?.toLowerCase().includes('building') ||
       item.itemCode?.startsWith('01.') // Site work and building areas
      )
    );
    
    const totalArea = areaItems.reduce((sum, item) => {
      const quantity = parseFloat(item.quantity) || 0;
      return sum + quantity;
    }, 0);
    
    // If no specific area items found, estimate from wall areas and other components
    if (totalArea === 0) {
      const wallItems = items.filter(item => 
        item.unit === 'm²' && 
        item.description?.toLowerCase().includes('wall')
      );
      
      const totalWallArea = wallItems.reduce((sum, item) => {
        const quantity = parseFloat(item.quantity) || 0;
        return sum + quantity;
      }, 0);
      
      // Rough estimate: wall area / 4 (assuming 4 walls for perimeter)
      const estimatedArea = totalWallArea > 0 ? Math.round(totalWallArea / 4) : 0;
      return estimatedArea > 0 ? `${estimatedArea.toLocaleString()} m² (est.)` : "0 m²";
    }
    
    return `${Math.round(totalArea).toLocaleString()} m²`;
  };
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[...Array(3)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const totals = calculateTotals(boqItems);
  const lineItems = boqItems?.length || 0;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(value);
  };

  const summaryData = [
    {
      label: "Total Project Value",
      value: formatCurrency(totals.totalValue),
      subtitle: totals.hasIncompleteData ? `(${totals.calculatedItems} of ${lineItems} items calculated)` : null,
      icon: DollarSign,
      iconColor: "text-green-500"
    },
    {
      label: "Total Line Items", 
      value: lineItems.toString(),
      subtitle: totals.hasIncompleteData ? `${totals.incompleteItems} incomplete` : null,
      icon: List,
      iconColor: "text-blue-500"
    },
    {
      label: "Building Area",
      value: calculateBuildingArea(boqItems),
      subtitle: null,
      icon: Square,
      iconColor: "text-purple-500"
    }
  ];

  return (
    <div className="space-y-6">
      {/* Disclaimer for incomplete data */}
      {totals.hasIncompleteData && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <span className="text-red-600 font-semibold">⚠️</span>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">
                Incomplete Cost Data Notice
              </h3>
              <div className="mt-2 text-sm text-red-700">
                <p>
                  <strong>{totals.incompleteItems} of {lineItems} items</strong> have incomplete cost data marked as "N/A" (highlighted in red below). 
                  These items are <strong>excluded from the total calculation</strong> to prevent misleading estimates.
                </p>
                <p className="mt-1 text-xs">
                  Complete cost data for all items to get accurate project totals.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {summaryData.map((item, index) => {
          const Icon = item.icon;
          return (
            <Card key={index} className="shadow-sm border">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">{item.label}</p>
                    <p 
                      className="text-2xl font-bold text-gray-900"
                      data-testid={`summary-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      {item.value}
                    </p>
                    {item.subtitle && (
                      <p className="text-xs text-gray-500 mt-1">{item.subtitle}</p>
                    )}
                  </div>
                  <Icon className={`text-2xl h-8 w-8 ${item.iconColor}`} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
