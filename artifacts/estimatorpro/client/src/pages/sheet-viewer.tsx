/**
 * Sheet Viewer Page — 2D Drawing Production & Viewing
 */
import { useState } from 'react';
import { useParams } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { FileText, Download, Printer, Layers, ZoomIn, ZoomOut } from 'lucide-react';

export default function SheetViewer() {
  const params = useParams<{ projectId?: string; modelId?: string }>();
  const modelId = params.modelId;

  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [projectName, setProjectName] = useState('');
  const [projectNumber, setProjectNumber] = useState('');

  // Generate standard sheet set
  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/bim/models/${modelId}/sheets/standard-set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: projectName || 'Project',
          projectNumber: projectNumber || 'P001',
        }),
      });
      return res.json();
    },
  });

  // Generate single sheet
  const generateSingleMutation = useMutation({
    mutationFn: async (config: any) => {
      const res = await fetch(`/api/bim/models/${modelId}/sheets/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      setSvgContent(data.svg);
      return data;
    },
  });

  const handleDownloadSVG = () => {
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sheet_${selectedSheet || 'drawing'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    if (!svgContent) return;
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html><head><title>Print Sheet</title>
        <style>@page { size: A1 landscape; margin: 0; } body { margin: 0; }</style>
        </head><body>${svgContent}</body></html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  };

  if (!modelId) {
    return (
      <div className="p-6">
        <Alert>
          <AlertDescription>Select a project and BIM model to generate sheets.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="h-6 w-6" />
          Sheet Production
        </h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setZoom(z => Math.max(25, z - 25))}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-sm self-center">{zoom}%</span>
          <Button variant="outline" size="sm" onClick={() => setZoom(z => Math.min(400, z + 25))}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadSVG} disabled={!svgContent}>
            <Download className="h-4 w-4 mr-1" /> Download SVG
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint} disabled={!svgContent}>
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Left Panel: Sheet Controls */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Generate Sheets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs font-medium">Project Name</label>
              <Input
                className="h-8 text-xs mt-1"
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="Project name"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Project Number</label>
              <Input
                className="h-8 text-xs mt-1"
                value={projectNumber}
                onChange={e => setProjectNumber(e.target.value)}
                placeholder="P001"
              />
            </div>

            <Button
              className="w-full"
              size="sm"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
            >
              <Layers className="h-4 w-4 mr-1" />
              Generate Standard Set
            </Button>

            {generateMutation.isPending && (
              <p className="text-xs text-muted-foreground">Generating sheets...</p>
            )}

            {generateMutation.isSuccess && (
              <div className="space-y-2">
                <p className="text-xs font-medium">
                  {generateMutation.data.sheetCount} sheets generated:
                </p>
                {generateMutation.data.sheets?.map((s: any) => (
                  <button
                    key={s.id}
                    className={`w-full text-left px-3 py-2 text-xs border rounded hover:bg-muted/50 ${
                      selectedSheet === s.id ? 'bg-muted border-primary' : ''
                    }`}
                    onClick={() => {
                      setSelectedSheet(s.id);
                      // Generate and show this specific sheet
                      generateSingleMutation.mutate({
                        config: {
                          paperSize: 'A1',
                          orientation: 'landscape',
                          scale: 100,
                          titleBlock: {
                            projectName: projectName || 'Project',
                            projectNumber: projectNumber || 'P001',
                            sheetTitle: s.title,
                            sheetNumber: s.number,
                            drawnBy: 'PROIE AutoDraft',
                            checkedBy: '',
                            date: new Date().toISOString().split('T')[0],
                            revision: 'A',
                            company: 'EstimatorPro',
                          },
                          margins: { top: 10, bottom: 10, left: 20, right: 10 },
                        },
                        views: [{
                          viewConfig: {
                            type: s.title.includes('Plan') ? 'plan' : s.title.includes('Section') ? 'section' : 'elevation',
                            direction: s.title.includes('North') ? 'north' : s.title.includes('South') ? 'south' : s.title.includes('East') ? 'east' : s.title.includes('West') ? 'west' : 'top',
                            storey: s.title.replace('Floor Plan — ', ''),
                            cutHeight: 1.2,
                            showGrid: true,
                            showDimensions: true,
                            showAnnotations: true,
                            showHatching: true,
                            showRoomLabels: true,
                            lineWeights: {
                              cutLine: 0.5,
                              projectedLine: 0.25,
                              dimensionLine: 0.18,
                              gridLine: 0.13,
                              annotationLine: 0.25,
                              hiddenLine: 0.13,
                            },
                          },
                          position: { x: 30, y: 20 },
                          width: 780,
                          height: 540,
                        }],
                      });
                    }}
                  >
                    <div className="font-medium">{s.number}</div>
                    <div className="text-muted-foreground">{s.title}</div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Panel: SVG Viewer */}
        <Card className="lg:col-span-3">
          <CardContent className="p-0">
            {svgContent ? (
              <div
                className="overflow-auto bg-gray-100 p-4"
                style={{ maxHeight: '70vh' }}
              >
                <div
                  style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }}
                  dangerouslySetInnerHTML={{ __html: svgContent }}
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-96 text-muted-foreground">
                <div className="text-center">
                  <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Generate a sheet set, then click a sheet to preview it here.</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
