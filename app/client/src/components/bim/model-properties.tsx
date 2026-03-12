import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle, Globe, MapPin, FileText } from "lucide-react";
import type { SelectedElement } from "./viewer-3d";
import { UNIT_SYSTEMS, formatLength, formatArea, formatVolume } from "./unit-utils";
import type { UnitSystem } from "./unit-utils";

interface ModelPropertiesProps {
  selectedElement: SelectedElement | null;
  unitSystem: UnitSystem;
  onUnitSystemChange: (unitSystem: UnitSystem) => void;
  showBothUnits: boolean;
  onShowBothUnitsChange: (showBoth: boolean) => void;
  country?: string;
  location?: string;
  buildingCode?: string;
}

const layers = [
  { name: "Structural Elements", visible: true },
  { name: "Architectural", visible: true },
  { name: "MEP Systems", visible: false }
];

export default function ModelProperties({
  selectedElement,
  unitSystem,
  onUnitSystemChange,
  showBothUnits,
  onShowBothUnitsChange,
  country,
  location,
  buildingCode
}: ModelPropertiesProps) {
  return (
    <div className="w-full bg-white overflow-y-auto">
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
        <div>
          <h3 className="text-base sm:text-lg font-semibold mb-2 sm:mb-4">Model Properties</h3>
        </div>
        
        {selectedElement ? (
          <Card className="bg-gray-50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Selected Component</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Type:</span>
                <span className="font-medium" data-testid="component-type">{selectedElement.type}</span>
              </div>
              {selectedElement.material && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Material:</span>
                  <span className="font-medium" data-testid="component-material">{selectedElement.material}</span>
                </div>
              )}
              {selectedElement.dimensions?.height && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Height:</span>
                  <span className="font-medium" data-testid="component-height">
                    {formatLength(selectedElement.dimensions.height, unitSystem, showBothUnits)}
                  </span>
                </div>
              )}
              {selectedElement.volume && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Volume:</span>
                  <span className="font-medium" data-testid="component-volume">
                    {formatVolume(selectedElement.volume, unitSystem, showBothUnits)}
                  </span>
                </div>
              )}
              {selectedElement.area && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Area:</span>
                  <span className="font-medium">
                    {formatArea(selectedElement.area, unitSystem, showBothUnits)}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-gray-50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Selected Component</CardTitle>
            </CardHeader>
            <CardContent className="py-8 text-center text-gray-500 text-sm">
              <p>No component selected</p>
              <p className="text-xs mt-1">Click on a 3D element to view its properties</p>
            </CardContent>
          </Card>
        )}
        
        <Card className="bg-gray-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Unit System</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select value={unitSystem} onValueChange={(value: UnitSystem) => onUnitSystemChange(value)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNIT_SYSTEMS.METRIC}>Metric (m, m², m³)</SelectItem>
                <SelectItem value={UNIT_SYSTEMS.IMPERIAL}>Imperial (ft, ft², ft³)</SelectItem>
              </SelectContent>
            </Select>
            
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="show-both-units"
                checked={showBothUnits}
                onCheckedChange={onShowBothUnitsChange}
              />
              <label 
                htmlFor="show-both-units"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Show both units
              </label>
            </div>
            
            {/* Project Context Info */}
            <div className="space-y-2 pt-2 border-t border-gray-200">
              <div className="text-xs text-gray-600 font-medium">Project Context:</div>
              {country && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Globe className="h-3 w-3" />
                  <span>Country: {country.toUpperCase()}</span>
                </div>
              )}
              {location && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <MapPin className="h-3 w-3" />
                  <span>Location: {location}</span>
                </div>
              )}
              {buildingCode && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <FileText className="h-3 w-3" />
                  <span>Code: {buildingCode}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-gray-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Compliance Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-gray-500">No compliance data available</p>
          </CardContent>
        </Card>
        
        <Card className="bg-gray-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Layer Controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {layers.map((layer, index) => (
              <div key={index} className="flex items-center space-x-2" data-testid={`layer-${index}`}>
                <Checkbox 
                  id={`layer-${index}`}
                  defaultChecked={layer.visible}
                />
                <label 
                  htmlFor={`layer-${index}`}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  {layer.name}
                </label>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
