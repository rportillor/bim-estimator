import { useState, useCallback } from "react";
import Viewer3D, { type SelectedElement } from "./viewer-3d";
import ModelProperties from "./model-properties";
import { getUnitSystemFromProject } from "./unit-utils";
import type { UnitSystem } from "./unit-utils";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";

interface BimViewerProps {
  projectId?: string;
  modelId?: string;
  country?: string;
  location?: string;
  buildingCode?: string;
}

export default function BimViewer({
  projectId: _projectId,
  modelId,
  country,
  location,
  buildingCode
}: BimViewerProps) {
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);
  const [showBothUnits, setShowBothUnits] = useState<boolean>(false);
  const [panelOpen, setPanelOpen] = useState<boolean>(false);
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(() => {
    return getUnitSystemFromProject(country, location, buildingCode);
  });

  const getIfcUrl = () => undefined;

  const togglePanel = useCallback(() => {
    setPanelOpen(p => {
      const next = !p;
      // Let Three.js know it needs to resize after the panel animates open/closed
      setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
      setTimeout(() => window.dispatchEvent(new Event("resize")), 200);
      return next;
    });
  }, []);

  const handleElementSelect = useCallback((el: SelectedElement | null) => {
    setSelectedElement(el);
    // Auto-open the panel when an element is selected
    if (el && !panelOpen) {
      setPanelOpen(true);
      setTimeout(() => window.dispatchEvent(new Event("resize")), 200);
    }
  }, [panelOpen]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── 3D Viewer — takes all available space ── */}
      <div className="flex-1 min-h-0 relative">
        <Viewer3D
          ifcUrl={getIfcUrl()}
          modelId={modelId}
          onElementSelect={handleElementSelect}
          unitSystem={unitSystem}
        />

        {/* Toggle button: bottom-right corner, always visible */}
        <button
          onClick={togglePanel}
          className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-700 shadow-md hover:bg-white hover:shadow-lg transition-all"
          title={panelOpen ? "Hide properties panel" : "Show properties panel"}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {selectedElement ? (
            <span className="max-w-[120px] truncate">{selectedElement.name || "Element"}</span>
          ) : (
            "Properties"
          )}
          {panelOpen ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* ── Bottom Properties Panel — collapsible ── */}
      <div
        className={`flex-shrink-0 bg-white border-t border-gray-200 transition-all duration-200 overflow-hidden ${
          panelOpen ? "h-72" : "h-0"
        }`}
      >
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
