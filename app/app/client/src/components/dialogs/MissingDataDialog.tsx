import { useState, useEffect } from 'react';

interface MissingDataPoint {
  elementId: string;
  elementType: string;
  missingFields: string[];
  sourceDocument?: string | null;
  message: string;
  severity: 'critical' | 'warning' | 'info';
}

interface Props {
  projectId: string;
  modelId: string;
  isOpen: boolean;
  onClose: () => void;
  onResolved?: () => void;
}

export function MissingDataDialog({ projectId, modelId, isOpen, onClose, onResolved }: Props) {
  const [gaps, setGaps] = useState<MissingDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [updates, setUpdates] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) fetchGaps();
  }, [isOpen, projectId]);

  const fetchGaps = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/projects/${projectId}/missing-data`, {
        headers: { 'Authorization': `Bearer ${token}` }, credentials: 'include'
      });
      if (res.ok) { const data = await res.json(); setGaps(data.gaps || []); }
    } catch (e) { console.error('Failed to fetch missing data:', e); }
    setLoading(false);
  };

  const handleFieldChange = (elementId: string, field: string, value: string) => {
    setUpdates(prev => ({ ...prev, [elementId]: { ...(prev[elementId] || {}), [field]: value } }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('auth_token');
      await fetch(`/api/projects/${projectId}/resolve-missing-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify({ modelId, updates })
      });
      onResolved?.();
      onClose();
    } catch (e) { console.error('Failed to save:', e); }
    setSaving(false);
  };

  if (!isOpen) return null;
  const criticalGaps = gaps.filter(g => g.severity === 'critical');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">Missing Data Resolution</h2>
              <p className="text-sm text-gray-500 mt-1">{criticalGaps.length} items need dimensions before BOQ calculation</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? <p className="text-center py-8 text-gray-500">Loading...</p>
           : gaps.length === 0 ? <p className="text-center py-8 text-green-600 font-medium">All elements have complete data.</p>
           : criticalGaps.map((gap, i) => (
            <div key={i} className="bg-red-50 border border-red-200 rounded-lg p-4 mb-3">
              <div className="flex justify-between mb-2">
                <span className="font-medium capitalize">{gap.elementType} <span className="text-gray-500 text-sm">({gap.elementId})</span></span>
                {gap.sourceDocument && <span className="text-xs text-gray-400">{gap.sourceDocument}</span>}
              </div>
              <p className="text-sm text-gray-600 mb-3">{gap.message}</p>
              <div className="grid grid-cols-3 gap-3">
                {gap.missingFields.map(field => (
                  <div key={field}>
                    <label className="block text-xs font-medium text-gray-700 mb-1 capitalize">{field} (m)</label>
                    <input type="number" step="0.01" placeholder={field}
                      className="w-full border rounded px-3 py-1.5 text-sm"
                      onChange={e => handleFieldChange(gap.elementId, field, e.target.value)}
                      value={updates[gap.elementId]?.[field] || ''} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="p-6 border-t flex justify-end gap-3 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} disabled={saving || !Object.keys(updates).length}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving...' : `Save ${Object.keys(updates).length} Update(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
