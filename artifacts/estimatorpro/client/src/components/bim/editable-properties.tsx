/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  EDITABLE PROPERTIES PANEL — Round-trip BIM element editing
 *  Allows modifying element parameters from the 3D viewer properties panel.
 *  Changes are sent to the server, constraints are propagated, and the
 *  3D view updates live.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Undo2, Redo2, Move, RotateCw, Maximize2, Grid3x3 } from 'lucide-react';
import type { SelectedElement } from './viewer-3d';
import type { TransformMode } from './transform-controls';
import { formatLength } from './unit-utils';
import type { UnitSystem } from './unit-utils';

interface EditablePropertiesProps {
  selectedElement: SelectedElement | null;
  modelId?: string;
  unitSystem: UnitSystem;
  showBothUnits: boolean;
  // Transform controls
  transformMode: TransformMode;
  onTransformModeChange: (mode: TransformMode) => void;
  snapping: boolean;
  onSnappingChange: (snap: boolean) => void;
  // Undo/redo
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  // Save callback
  onElementUpdate: (elementId: string, updates: Record<string, any>) => Promise<void>;
}

interface EditField {
  key: string;
  label: string;
  value: number | string;
  type: 'number' | 'text' | 'select';
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
}

export default function EditableProperties({
  selectedElement,
  modelId,
  unitSystem,
  showBothUnits,
  transformMode,
  onTransformModeChange,
  snapping,
  onSnappingChange,
  canUndo, canRedo,
  onUndo, onRedo,
  onElementUpdate,
}: EditablePropertiesProps) {
  const [editValues, setEditValues] = useState<Record<string, number | string>>({});
  const [saving, setSaving] = useState(false);

  // Build editable fields from selected element
  const getEditFields = useCallback((): EditField[] => {
    if (!selectedElement) return [];

    const fields: EditField[] = [];
    const dims = selectedElement.dimensions || {};
    const type = (selectedElement.type || '').toLowerCase();

    // Dimension fields
    if (dims.length != null && dims.length > 0) {
      fields.push({ key: 'length', label: 'Length', value: dims.length, type: 'number', unit: 'm', min: 0.1, max: 100, step: 0.05 });
    }
    if (dims.width != null && dims.width > 0) {
      fields.push({ key: 'width', label: 'Width', value: dims.width, type: 'number', unit: 'm', min: 0.05, max: 50, step: 0.05 });
    }
    if (dims.height != null && dims.height > 0) {
      fields.push({ key: 'height', label: 'Height', value: dims.height, type: 'number', unit: 'm', min: 0.1, max: 50, step: 0.05 });
    }
    if (dims.thickness != null && dims.thickness > 0) {
      fields.push({ key: 'thickness', label: 'Thickness', value: dims.thickness, type: 'number', unit: 'm', min: 0.01, max: 2, step: 0.01 });
    }

    // Material
    if (selectedElement.material) {
      fields.push({
        key: 'material', label: 'Material', value: selectedElement.material, type: 'select',
        options: getMaterialOptions(type),
      });
    }

    return fields;
  }, [selectedElement]);

  const handleFieldChange = (key: string, value: number | string) => {
    setEditValues(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!selectedElement || !modelId) return;

    const elementId = selectedElement.properties?.globalId
      || selectedElement.properties?.ifcGuid
      || selectedElement.expressID?.toString()
      || '';

    if (!elementId) return;

    setSaving(true);
    try {
      const updates: Record<string, any> = {};

      // Map edit values to API format
      for (const [key, value] of Object.entries(editValues)) {
        if (['length', 'width', 'height', 'thickness'].includes(key)) {
          if (!updates.dimensions) updates.dimensions = {};
          updates.dimensions[key] = Number(value);
        } else if (key === 'material') {
          updates.material = value;
        }
      }

      await onElementUpdate(elementId, updates);
      setEditValues({});
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = Object.keys(editValues).length > 0;
  const fields = getEditFields();

  return (
    <div className="space-y-3">
      {/* Transform toolbar */}
      <Card className="bg-gray-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Transform Tools</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-1">
            <Button
              size="sm" variant={transformMode === 'translate' ? 'default' : 'outline'}
              onClick={() => onTransformModeChange('translate')}
              title="Move (W)"
            >
              <Move className="h-4 w-4" />
            </Button>
            <Button
              size="sm" variant={transformMode === 'rotate' ? 'default' : 'outline'}
              onClick={() => onTransformModeChange('rotate')}
              title="Rotate (E)"
            >
              <RotateCw className="h-4 w-4" />
            </Button>
            <Button
              size="sm" variant={transformMode === 'scale' ? 'default' : 'outline'}
              onClick={() => onTransformModeChange('scale')}
              title="Scale (R)"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
            <div className="w-px bg-gray-300 mx-1" />
            <Button
              size="sm" variant={snapping ? 'default' : 'outline'}
              onClick={() => onSnappingChange(!snapping)}
              title="Grid Snap"
            >
              <Grid3x3 className="h-4 w-4" />
            </Button>
            <div className="w-px bg-gray-300 mx-1" />
            <Button size="sm" variant="outline" disabled={!canUndo} onClick={onUndo} title="Undo (Ctrl+Z)">
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" disabled={!canRedo} onClick={onRedo} title="Redo (Ctrl+Y)">
              <Redo2 className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Editable properties */}
      {selectedElement && fields.length > 0 && (
        <Card className="bg-gray-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Edit Properties</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {fields.map(field => (
              <div key={field.key} className="flex items-center gap-2">
                <label className="text-xs text-gray-600 w-20 shrink-0">{field.label}:</label>
                {field.type === 'number' ? (
                  <div className="flex items-center gap-1 flex-1">
                    <Input
                      type="number"
                      value={editValues[field.key] ?? field.value}
                      onChange={e => handleFieldChange(field.key, parseFloat(e.target.value))}
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      className="h-7 text-xs"
                    />
                    {field.unit && <span className="text-xs text-gray-500">{field.unit}</span>}
                  </div>
                ) : field.type === 'select' ? (
                  <Select
                    value={(editValues[field.key] as string) || (field.value as string)}
                    onValueChange={v => handleFieldChange(field.key, v)}
                  >
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options?.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type="text"
                    value={editValues[field.key] ?? field.value}
                    onChange={e => handleFieldChange(field.key, e.target.value)}
                    className="h-7 text-xs flex-1"
                  />
                )}
              </div>
            ))}

            {/* Read-only computed values */}
            {selectedElement.volume != null && selectedElement.volume > 0 && (
              <div className="flex items-center gap-2 pt-1 border-t">
                <span className="text-xs text-gray-500 w-20">Volume:</span>
                <span className="text-xs font-medium">
                  {formatLength(selectedElement.volume, unitSystem, showBothUnits).replace(/m$/, 'm³')}
                </span>
              </div>
            )}
            {selectedElement.area != null && selectedElement.area > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-20">Area:</span>
                <span className="text-xs font-medium">
                  {formatLength(selectedElement.area, unitSystem, showBothUnits).replace(/m$/, 'm²')}
                </span>
              </div>
            )}

            {/* Save button */}
            {hasChanges && (
              <Button
                size="sm" className="w-full mt-2"
                onClick={handleSave}
                disabled={saving}
              >
                <Save className="h-4 w-4 mr-1" />
                {saving ? 'Saving...' : 'Apply Changes'}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Keyboard shortcuts */}
      <Card className="bg-gray-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-gray-500">Shortcuts</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-gray-500 space-y-0.5">
          <div>W — Move | E — Rotate | R — Scale</div>
          <div>G — Toggle snap | Esc — Deselect</div>
          <div>Ctrl+Z — Undo | Ctrl+Y — Redo</div>
          <div>Delete — Remove element</div>
        </CardContent>
      </Card>
    </div>
  );
}

function getMaterialOptions(elementType: string): { value: string; label: string }[] {
  if (/wall/.test(elementType)) {
    return [
      { value: 'Concrete', label: 'Concrete' },
      { value: 'Brick', label: 'Brick' },
      { value: 'Steel', label: 'Steel Stud' },
      { value: 'Wood', label: 'Wood Frame' },
      { value: 'CMU', label: 'CMU Block' },
    ];
  }
  if (/column|beam/.test(elementType)) {
    return [
      { value: 'Steel', label: 'Steel' },
      { value: 'Concrete', label: 'Concrete' },
      { value: 'Wood', label: 'Glulam/Wood' },
    ];
  }
  if (/slab|floor/.test(elementType)) {
    return [
      { value: 'Concrete', label: 'Concrete' },
      { value: 'Steel Deck', label: 'Steel Deck' },
      { value: 'Wood', label: 'Wood Joist' },
    ];
  }
  return [
    { value: 'Concrete', label: 'Concrete' },
    { value: 'Steel', label: 'Steel' },
    { value: 'Wood', label: 'Wood' },
    { value: 'Glass', label: 'Glass' },
    { value: 'Aluminum', label: 'Aluminum' },
  ];
}
