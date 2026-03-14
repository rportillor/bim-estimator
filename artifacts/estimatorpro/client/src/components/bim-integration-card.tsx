import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link } from 'wouter';
import {
  Box,
  Eye,
  Download,
  Loader2,
  CheckCircle,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useSSEProgress } from '@/hooks/use-sse-progress';

interface BIMIntegrationCardProps {
  projectId: string;
}

function getAuthHeaders() {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

export default function BIMIntegrationCard({ projectId }: BIMIntegrationCardProps) {
  const [generating, setGenerating] = useState(false);
  const [currentModelId, setCurrentModelId] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState('');
  const { toast } = useToast();

  const { data: documents } = useQuery<any[]>({
    queryKey: ['/api/projects', projectId, 'documents'],
    enabled: !!projectId,
  });

  const { data: bimModels, isLoading, refetch } = useQuery<any[]>({
    queryKey: ['/api/projects', projectId, 'bim-models'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/bim-models`, {
        headers: getAuthHeaders(),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Failed: ${res.statusText}`);
      return res.json();
    },
  });

  const latestModel = bimModels?.[0];

  const { data: sseProgress } = useSSEProgress(
    latestModel?.id || null,
    generating && !!latestModel?.id,
  );

  useEffect(() => {
    if (!sseProgress) return;
    setProgressMsg(sseProgress.message || '');
    if (sseProgress.status === 'completed') {
      setGenerating(false);
      setCurrentModelId(null);
      toast({ title: "BIM model ready", description: "Your 3D model has been generated." });
      refetch();
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'bim-models'] });
    } else if (sseProgress.status === 'failed') {
      setGenerating(false);
      setCurrentModelId(null);
      toast({ title: "Generation failed", description: sseProgress.error || sseProgress.message, variant: "destructive" });
    }
  }, [sseProgress]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const headers = getAuthHeaders();
      const modelsRes = await fetch(`/api/projects/${projectId}/bim-models`, { headers, credentials: 'include' });
      if (!modelsRes.ok) throw new Error('Could not find BIM model for project');
      const models = await modelsRes.json();
      const modelId = models[0]?.id;
      if (!modelId) throw new Error('No BIM model slot found. Contact support.');
      setCurrentModelId(modelId);

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timed out — check the viewer, it may have completed.')), 600_000),
      );
      const req = fetch(`/api/bim/models/${modelId}/generate`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          projectId,
          positioningMode: 'preferClaude',
          levelOfDetail: 'LOD300',
          includeStructural: true,
          includeMEP: true,
          includeArchitectural: true,
          qualityLevel: 'professional',
        }),
      });
      const res = await Promise.race([req, timeout]) as Response;
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        throw new Error(err.message || err.error || 'Generation failed');
      }
      return res.json();
    },
    onSuccess: () => {
      refetch();
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'bim-models'] });
    },
    onError: (err: Error) => {
      setGenerating(false);
      setCurrentModelId(null);
      toast({
        title: "Generation failed",
        description: err.message.includes('timed out')
          ? "Request timed out — check the BIM viewer, the model may have been created."
          : err.message,
        variant: "destructive",
      });
    },
  });

  const handleGenerate = () => {
    if (!documents?.length) {
      toast({ title: "No documents", description: "Upload documents before generating a BIM model.", variant: "destructive" });
      return;
    }
    setGenerating(true);
    setProgressMsg('Starting…');
    generateMutation.mutate();
  };

  const handleExport = () => {
    if (!latestModel) return;
    const link = document.createElement('a');
    link.href = `/api/bim/models/${latestModel.id}/download-v2`;
    link.download = `${latestModel.name}.ifc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-10 justify-center text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-6 space-y-6">

        {/* ── Model status ── */}
        {latestModel ? (
          <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
            <Box className="h-5 w-5 text-blue-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{latestModel.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {new Date(latestModel.createdAt || '').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                {latestModel.elementCount ? ` · ${latestModel.elementCount} elements` : ''}
              </p>
            </div>
            <Badge variant={latestModel.status === 'completed' && !generating ? 'default' : 'secondary'}>
              {generating ? (
                <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Generating</>
              ) : latestModel.status === 'completed' ? (
                <><CheckCircle className="h-3 w-3 mr-1" /> Ready</>
              ) : (
                <><AlertCircle className="h-3 w-3 mr-1" /> {latestModel.status}</>
              )}
            </Badge>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <AlertCircle className="h-4 w-4 shrink-0" />
            No BIM model yet. Click "Generate" to create one from your {documents?.length || 0} uploaded documents.
          </div>
        )}

        {/* ── Progress message while generating ── */}
        {generating && progressMsg && (
          <p className="text-sm text-blue-700 text-center animate-pulse">{progressMsg}</p>
        )}

        {/* ── Actions ── */}
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={handleGenerate}
            disabled={generating || !documents?.length}
            className="flex items-center gap-2"
            data-testid="button-generate-bim"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {latestModel ? 'Re-generate' : 'Generate BIM Model'}
          </Button>

          {latestModel && (
            <>
              <Link href={`/projects/${projectId}/bim`}>
                <Button variant="outline" className="flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  View 3D
                </Button>
              </Link>

              <Button variant="outline" onClick={handleExport} className="flex items-center gap-2" data-testid="button-download-ifc">
                <Download className="h-4 w-4" />
                Export IFC
              </Button>
            </>
          )}
        </div>

        {/* ── Doc count footnote ── */}
        <p className="text-xs text-gray-400">
          {documents?.length || 0} source documents · {documents?.filter(d => d.analysisStatus === 'Ready').length || 0} ready
        </p>

      </CardContent>
    </Card>
  );
}
