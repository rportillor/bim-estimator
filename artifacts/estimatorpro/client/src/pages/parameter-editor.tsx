/**
 * Parameter Editor Page — Live BIM element editing with undo/redo
 */
import { useState, useCallback } from 'react';
import { useParams } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Undo2, Redo2, Save, Filter, History, Pencil, ChevronRight } from 'lucide-react';

interface ElementSummary {
  id: string;
  type: string;
  name: string;
  category: string;
  storey: string;
  material: string;
  lod?: number;
}

export default function ParameterEditor() {
  const params = useParams<{ projectId?: string; modelId?: string }>();
  const projectId = params.projectId;
  const modelId = params.modelId;
  const queryClient = useQueryClient();

  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [editProperty, setEditProperty] = useState('');
  const [editValue, setEditValue] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStorey, setFilterStorey] = useState('');

  // Fetch elements with optional filter
  const { data: elementsData, isLoading: loadingElements } = useQuery({
    queryKey: ['bim-elements-filter', modelId, filterType, filterStorey],
    queryFn: async () => {
      const body: any = {};
      if (filterType) body.types = [filterType];
      if (filterStorey) body.storeys = [filterStorey];

      const res = await fetch(`/api/bim/models/${modelId}/filter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.json();
    },
    enabled: !!modelId,
  });

  // Fetch transaction history
  const { data: historyData } = useQuery({
    queryKey: ['bim-history', modelId],
    queryFn: async () => {
      const res = await fetch(`/api/bim/models/${modelId}/history`);
      return res.json();
    },
    enabled: !!modelId,
  });

  // Edit mutation
  const editMutation = useMutation({
    mutationFn: async ({ elementId, property, value }: { elementId: string; property: string; value: any }) => {
      const res = await fetch(`/api/bim/models/${modelId}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elementId, property, value }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bim-elements-filter'] });
      queryClient.invalidateQueries({ queryKey: ['bim-history'] });
    },
  });

  // Undo/Redo mutations
  const undoMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/bim/models/${modelId}/undo`, { method: 'POST' });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bim-elements-filter'] });
      queryClient.invalidateQueries({ queryKey: ['bim-history'] });
    },
  });

  const redoMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/bim/models/${modelId}/redo`, { method: 'POST' });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bim-elements-filter'] });
      queryClient.invalidateQueries({ queryKey: ['bim-history'] });
    },
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/bim/models/${modelId}/save`, { method: 'POST' });
      return res.json();
    },
  });

  const handleEdit = useCallback(() => {
    if (!selectedElementId || !editProperty || editValue === '') return;
    const numVal = Number(editValue);
    const value = isNaN(numVal) ? editValue : numVal;
    editMutation.mutate({ elementId: selectedElementId, property: editProperty, value });
  }, [selectedElementId, editProperty, editValue, editMutation]);

  const elements: ElementSummary[] = elementsData?.elements || [];
  const selectedElement = elements.find(e => e.id === selectedElementId);

  if (!modelId) {
    return (
      <div className="p-6">
        <Alert>
          <AlertDescription>Select a project and BIM model to open the parameter editor.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Parameter Editor</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => undoMutation.mutate()}
            disabled={!historyData?.canUndo}
          >
            <Undo2 className="h-4 w-4 mr-1" /> Undo
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => redoMutation.mutate()}
            disabled={!historyData?.canRedo}
          >
            <Redo2 className="h-4 w-4 mr-1" /> Redo
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            <Save className="h-4 w-4 mr-1" /> Save to DB
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Element List */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Elements ({elements.length})</CardTitle>
            <div className="flex gap-2 mt-2">
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Types</SelectItem>
                  <SelectItem value="Wall">Wall</SelectItem>
                  <SelectItem value="Column">Column</SelectItem>
                  <SelectItem value="Beam">Beam</SelectItem>
                  <SelectItem value="Floor Slab">Slab</SelectItem>
                  <SelectItem value="Door">Door</SelectItem>
                  <SelectItem value="Window">Window</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="h-8 text-xs"
                placeholder="Storey"
                value={filterStorey}
                onChange={e => setFilterStorey(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="max-h-[500px] overflow-y-auto p-0">
            {loadingElements ? (
              <p className="p-4 text-sm text-muted-foreground">Loading...</p>
            ) : (
              <div className="divide-y">
                {elements.map(el => (
                  <button
                    key={el.id}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-muted/50 flex items-center gap-2 ${
                      selectedElementId === el.id ? 'bg-muted' : ''
                    }`}
                    onClick={() => setSelectedElementId(el.id)}
                  >
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    <div>
                      <div className="font-medium">{el.name || el.id.slice(0, 12)}</div>
                      <div className="text-xs text-muted-foreground">{el.type} — {el.storey}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Center: Property Editor */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              {selectedElement ? `Edit: ${selectedElement.name}` : 'Select an element'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedElement ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-muted-foreground">Type</div>
                  <div>{selectedElement.type}</div>
                  <div className="text-muted-foreground">Category</div>
                  <div>{selectedElement.category}</div>
                  <div className="text-muted-foreground">Storey</div>
                  <div>{selectedElement.storey}</div>
                  <div className="text-muted-foreground">Material</div>
                  <div>{selectedElement.material}</div>
                  {selectedElement.lod && (
                    <>
                      <div className="text-muted-foreground">LOD</div>
                      <div>{selectedElement.lod}</div>
                    </>
                  )}
                </div>

                <hr />

                <div className="space-y-2">
                  <label className="text-xs font-medium">Property Path</label>
                  <Select value={editProperty} onValueChange={setEditProperty}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select property" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="quantities.height">Height</SelectItem>
                      <SelectItem value="quantities.width">Width</SelectItem>
                      <SelectItem value="quantities.length">Length</SelectItem>
                      <SelectItem value="quantities.thickness">Thickness</SelectItem>
                      <SelectItem value="origin.x">Position X</SelectItem>
                      <SelectItem value="origin.y">Position Y</SelectItem>
                      <SelectItem value="origin.z">Position Z</SelectItem>
                      <SelectItem value="rotation">Rotation</SelectItem>
                      <SelectItem value="material">Material</SelectItem>
                      <SelectItem value="storey">Storey</SelectItem>
                      <SelectItem value="name">Name</SelectItem>
                      <SelectItem value="lod">LOD Level</SelectItem>
                    </SelectContent>
                  </Select>

                  <label className="text-xs font-medium">New Value</label>
                  <Input
                    className="h-8 text-xs"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    placeholder="Enter value"
                  />

                  <Button
                    className="w-full"
                    size="sm"
                    onClick={handleEdit}
                    disabled={!editProperty || editValue === '' || editMutation.isPending}
                  >
                    Apply Change
                  </Button>

                  {editMutation.isError && (
                    <Alert variant="destructive">
                      <AlertDescription className="text-xs">
                        {(editMutation.error as Error)?.message || 'Edit failed'}
                      </AlertDescription>
                    </Alert>
                  )}

                  {editMutation.isSuccess && editMutation.data?.success && (
                    <Alert>
                      <AlertDescription className="text-xs">
                        Applied. {editMutation.data.affectedElements?.length || 0} elements affected.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Click an element from the list to edit its properties.</p>
            )}
          </CardContent>
        </Card>

        {/* Right: Transaction History */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="h-4 w-4" />
              Transaction History
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[500px] overflow-y-auto">
            {historyData?.history?.length > 0 ? (
              <div className="space-y-2">
                {historyData.history.slice().reverse().map((tx: any) => (
                  <div key={tx.id} className="border rounded p-2 text-xs">
                    <div className="font-medium">{tx.description}</div>
                    <div className="text-muted-foreground">
                      {tx.changeCount} changes, {tx.propagatedCount} propagated
                    </div>
                    <div className="text-muted-foreground">
                      {new Date(tx.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No transactions yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {saveMutation.isSuccess && (
        <Alert>
          <AlertDescription>Saved {saveMutation.data?.saved} elements to database.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
