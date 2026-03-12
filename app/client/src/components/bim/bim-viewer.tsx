import { useState, useEffect } from "react";
import { useParams } from "wouter";
import Viewer3D, { type SelectedElement } from "./viewer-3d";
import ModelProperties from "./model-properties";
import { UNIT_SYSTEMS, getUnitSystemFromProject } from "./unit-utils";
import type { UnitSystem } from "./unit-utils";
import { useQuery } from "@tanstack/react-query";

interface BimViewerProps {
  projectId?: string;
  modelId?: string;
  country?: string;
  location?: string;
  buildingCode?: string;
}

export default function BimViewer({ 
  projectId, 
  modelId, 
  country, 
  location, 
  buildingCode 
}: BimViewerProps) {
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);
  const [showBothUnits, setShowBothUnits] = useState<boolean>(false);
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(() => {
    // DUAL APPROACH: Location → Building Code → Default Metric
    return getUnitSystemFromProject(country, location, buildingCode);
  });

  // Interface for BIM model data
  interface BimModel {
    filePath?: string;
    id: string;
    name: string;
  }

  // Generate IFC file URL for the model (demo implementation)
  const getIfcUrl = () => {
    // Always return undefined to force 3D generation from BIM element data
    // instead of trying to load non-existent IFC files
    return undefined;
  };

  return (
    <div className="flex flex-col md:flex-row h-full">
      {/* Main 3D Viewer - Responsive for all devices */}
      <div className="flex-1 min-w-0 h-full">
        <Viewer3D
          ifcUrl={getIfcUrl()}
          modelId={modelId}
          onElementSelect={setSelectedElement}
          unitSystem={unitSystem}
        />
      </div>
      
      {/* Properties Panel - Responsive: Bottom on mobile/tablet portrait, Right on tablet landscape/desktop */}
      <div className="w-full md:w-80 lg:w-96 md:flex-shrink-0 h-64 md:h-full bg-white border-t md:border-t-0 md:border-l border-gray-200">
        <ModelProperties
          selectedElement={selectedElement}
          unitSystem={unitSystem}
          onUnitSystemChange={setUnitSystem}
          showBothUnits={showBothUnits}
          onShowBothUnitsChange={setShowBothUnits}
          country={country}
          location={location}
          buildingCode={buildingCode}
        />
      </div>
    </div>
  );
}
