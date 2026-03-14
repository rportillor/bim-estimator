import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Link } from 'wouter';
import {
  Box,
  Eye,
  Download,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useSSEProgress } from '@/hooks/use-sse-progress';

interface BIMIntegrationCardProps {
  projectId: string;
}

function getAuthHeaders() {
  const token = localStorage.getItem('auth_token');
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

function elapsed(since: string) {
  const ms = Date.now() - new Date(since).getTime();
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function BIMIntegrationCard({ projectId }: BIMIntegrationCardProps) {
  const [generatingLocal, setGeneratingLocal] = useState(false);
  const [ssePercent, setSsePercent] = useState(0);
  const [sseMsg, setSseMsg] = useState('');
  const [elapsedStr, setElapsedStr] = useState('');
  const startedAtRef = useRef<string | null>(null);
  const { toast } = useToast();

  const { data: documents } = useQuery<any[]>({
    queryKey: ['/api/projects', projectId, 'documents'],
    enabled: !!projectId,
  });

  const { data: bimModels, isLoading, refetch } = useQuery<any[]>({
    queryKey: ['/api/projects', projectId, 'bim-models'],
    enabled: !!projectId,
    refetchInterval: generatingLocal ? 8000 : false,
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
  const dbStatus = latestModel?.status as string | undefined;

  // If the DB already says "generating" on mount, track it
  useEffect(() => {
    if (dbStatus === 'generating' && !generatingLocal) {
      setGeneratingLocal(true);
      startedAtRef.current = latestModel?.createdAt || new Date().toISOString();
    }
    if (dbStatus === 'completed' || dbStatus === 'failed' || dbStatus === 'error') {
      setGeneratingLocal(false);
    }
  }, [dbStatus]);

  // Tick elapsed timer while generating
  useEffect(() => {
    if (!generatingLocal) { setElapsedStr(''); return; }
    const tick = () => {
      if (startedAtRef.current) setElapsedStr(elapsed(startedAtRef.current));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [generatingLocal]);

  // SSE live progress
  const { data: sseProgress } = useSSEProgress(
    latestModel?.id || null,
    generatingLocal && !!latestModel?.id,
  );

  const [docsProcessed, setDocsProcessed] = useState<number | null>(null);
  const [docsTotal, setDocsTotal] = useState<number | null>(null);

  useEffect(() => {
    if (!sseProgress) return;
    setSsePercent(Math.round((sseProgress.progress ?? 0) * 100));
    setSseMsg(sseProgress.message || '');
    if (sseProgress.documentsProcessed != null) setDocsProcessed(sseProgress.documentsProcessed);
    if (sseProgress.totalDocuments != null) setDocsTotal(sseProgress.totalDocuments);

    if (sseProgress.status === 'completed') {
      setGeneratingLocal(false);
      setSsePercent(100);
      setDocsProcessed(null);
      setDocsTotal(null);
      toast({ title: 'BIM model ready', description: 'Your 3D model has been generated.' });
      refetch();
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'bim-models'] });
      setTimeout(() => setSsePercent(0), 3000);
    } else if (sseProgress.status === 'failed' || sseProgress.status === 'error') {
      setGeneratingLocal(false);
      setDocsProcessed(null);
      setDocsTotal(null);
      toast({
        title: 'Generation failed',
        description: sseProgress.error || sseProgress.message || 'Something went wrong.',
        variant: 'destructive',
      });
    }
  }, [sseProgress]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const headers = getAuthHeaders();
      const modelsRes = await fetch(`/api/projects/${projectId}/bim-models`, { headers, credentials: 'include' });
      if (!modelsRes.ok) throw new Error('Could not load BIM model slot');
      const models = await modelsRes.json();
      const modelId = models[0]?.id;
      if (!modelId) throw new Error('No BIM model slot found for this project.');

      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('Request timed out — check the viewer, model may still be processing.')), 600_000),
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
      setGeneratingLocal(false);
      setSsePercent(0);
      setSseMsg('');
      toast({
        title: 'Generation failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const handleGenerate = () => {
    if (!documents?.length) {
      toast({ title: 'No documents', description: 'Upload documents before generating a BIM model.', variant: 'destructive' });
      return;
    }
    setGeneratingLocal(true);
    setSsePercent(2);
    setSseMsg('Starting…');
    startedAtRef.current = new Date().toISOString();
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

  // ── Derived display state ──────────────────────────────────────────────────
  // "generating" from DB is only real if the user kicked it off in this session
  // or if it's very recent (< 2 min). Otherwise treat it as stuck → failed.
  const dbSaysRunning = dbStatus === 'generating' || dbStatus === 'processing';
  const modelAge = latestModel ? Date.now() - new Date(latestModel.updatedAt || latestModel.createdAt || 0).getTime() : Infinity;
  const isStuck = !generatingLocal && dbSaysRunning && modelAge > 2 * 60 * 1000;

  const isGenerating = generatingLocal || (dbSaysRunning && !isStuck);
  const isFailed     = isStuck || (!isGenerating && (dbStatus === 'failed' || dbStatus === 'error'));
  const isReady      = !isGenerating && !isFailed && dbStatus === 'completed';
  const isPending    = !isGenerating && !isFailed && !isReady && !!latestModel;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-10 justify-center text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading BIM data…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-6 space-y-5">

        {/* ── NO MODEL ─────────────────────────────────────────────────────── */}
        {!latestModel && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <Box className="h-4 w-4 shrink-0" />
              No BIM model yet. Generate one from your {documents?.length || 0} uploaded documents.
            </div>
            <Button onClick={handleGenerate} disabled={!documents?.length} className="flex items-center gap-2">
              <Box className="h-4 w-4" />
              Generate BIM Model
            </Button>
          </div>
        )}

        {/* ── GENERATING ───────────────────────────────────────────────────── */}
        {isGenerating && (
          <div className="space-y-4">
            {/* Header row */}
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 text-blue-600 animate-spin shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-sm text-blue-900">Generating BIM model…</p>
                <p className="text-xs text-blue-600 mt-0.5">
                  {elapsedStr && <>{elapsedStr} elapsed · </>}
                  {documents?.length || 0} source documents
                </p>
              </div>
              <Badge variant="secondary">In Progress</Badge>
            </div>

            {/* Document counter — shown as soon as SSE sends doc info */}
            {docsTotal != null && (
              <div className="flex items-center gap-3 px-3 py-2 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-700 tabular-nums leading-none">
                  {docsProcessed ?? 0}
                  <span className="text-base font-normal text-blue-400">/{docsTotal}</span>
                </div>
                <div className="text-xs text-blue-600">documents read</div>
                <div className="ml-auto w-24">
                  <Progress value={docsTotal > 0 ? Math.round(((docsProcessed ?? 0) / docsTotal) * 100) : 0} className="h-1.5" />
                </div>
              </div>
            )}

            {/* Overall progress bar */}
            <div className="space-y-1.5">
              <Progress value={ssePercent || 2} className="h-2" />
              <div className="flex justify-between text-xs text-gray-500">
                <span>{sseMsg || 'Initializing…'}</span>
                <span>{ssePercent > 0 ? `${ssePercent}%` : ''}</span>
              </div>
            </div>

            {/* Steps summary */}
            <div className="grid grid-cols-3 gap-2 text-center text-xs text-gray-500">
              <div className={`p-2 rounded ${ssePercent >= 30 ? 'bg-blue-50 text-blue-700 font-medium' : 'bg-gray-50'}`}>
                Document reading
              </div>
              <div className={`p-2 rounded ${ssePercent >= 60 ? 'bg-blue-50 text-blue-700 font-medium' : 'bg-gray-50'}`}>
                AI extraction
              </div>
              <div className={`p-2 rounded ${ssePercent >= 90 ? 'bg-blue-50 text-blue-700 font-medium' : 'bg-gray-50'}`}>
                3D geometry
              </div>
            </div>
          </div>
        )}

        {/* ── READY ────────────────────────────────────────────────────────── */}
        {isReady && (
          <div className="space-y-4">
            {/* Model info */}
            <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{latestModel.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Generated {new Date(latestModel.createdAt || '').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  {latestModel.elementCount ? ` · ${latestModel.elementCount.toLocaleString()} elements` : ''}
                </p>
              </div>
              <Badge className="bg-green-600 hover:bg-green-600 shrink-0">Ready</Badge>
            </div>

            {/* Primary actions */}
            <div className="flex flex-wrap gap-3">
              <Link href={`/projects/${projectId}/bim`}>
                <Button className="flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  View 3D Model
                </Button>
              </Link>
              <Button variant="outline" onClick={handleExport} className="flex items-center gap-2" data-testid="button-download-ifc">
                <Download className="h-4 w-4" />
                Export IFC
              </Button>
            </div>

            {/* Regenerate — tucked away as secondary option */}
            <div className="pt-1 border-t border-gray-100">
              <button
                onClick={handleGenerate}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                data-testid="button-generate-bim"
              >
                <RefreshCw className="h-3 w-3" />
                Model not working as expected? Force regenerate
              </button>
            </div>
          </div>
        )}

        {/* ── FAILED ───────────────────────────────────────────────────────── */}
        {isFailed && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-sm text-red-800">Generation failed</p>
                <p className="text-xs text-red-600 mt-0.5">
                  {latestModel?.metadata?.error || 'An error occurred during BIM generation.'}
                </p>
              </div>
              <Badge variant="destructive" className="shrink-0">Failed</Badge>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={handleGenerate} className="flex items-center gap-2" data-testid="button-generate-bim">
                <RefreshCw className="h-4 w-4" />
                Regenerate
              </Button>
              {latestModel && (
                <Link href={`/projects/${projectId}/bim`}>
                  <Button variant="outline" className="flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    View Partial Model
                  </Button>
                </Link>
              )}
            </div>
          </div>
        )}

        {/* ── PENDING / UNKNOWN ─────────────────────────────────────────────── */}
        {isPending && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-gray-50 border rounded-lg">
              <Clock className="h-5 w-5 text-gray-500 shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-sm">Model status: {dbStatus}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Created {new Date(latestModel.createdAt || '').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              </div>
            </div>
            <Button onClick={handleGenerate} className="flex items-center gap-2" data-testid="button-generate-bim">
              <RefreshCw className="h-4 w-4" />
              Regenerate
            </Button>
          </div>
        )}

        {/* ── Doc count footnote ───────────────────────────────────────────── */}
        <p className="text-xs text-gray-400">
          {documents?.length || 0} source documents uploaded
        </p>

      </CardContent>
    </Card>
  );
}
