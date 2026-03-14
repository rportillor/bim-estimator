import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  CloudUpload, X, FileText, CheckCircle, Loader2,
  ArrowRight, FolderOpen, AlertTriangle, Eye,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

interface FileWithProgress {
  file: File;
  progress: number;
  status: 'uploading' | 'completed' | 'error';
  id: string;
}

interface UploadedDoc {
  id: string;
  name: string;
  analysisStatus: string;
}

interface FileDropzoneProps {
  projectId?: string;
  standard?: string;
}

// Poll the project documents every 3s and show real extraction status
function ExtractionStatusPanel({ projectId, uploadedAt }: { projectId: string; uploadedAt: number }) {
  const [, setLocation] = useLocation();

  const { data: rawDocs = [] } = useQuery({
    queryKey: ['/api/projects', projectId, 'documents'],
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/projects/${projectId}/documents`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : Object.values(data);
    },
    refetchInterval: 3000,
    staleTime: 0,
  });

  // Only show docs uploaded in this session (uploaded after we started)
  const sessionDocs = (rawDocs as UploadedDoc[]).filter((d: any) => {
    const createdAt = d.createdAt || d.created_at || d.uploadedAt;
    return !createdAt || new Date(createdAt).getTime() >= uploadedAt - 5000;
  });
  const docs = sessionDocs.length > 0 ? sessionDocs : (rawDocs as UploadedDoc[]);

  const total = docs.length;
  const ready = docs.filter((d: UploadedDoc) => d.analysisStatus === 'Ready' || (d as any).analysis_status === 'Ready').length;
  const processing = docs.filter((d: UploadedDoc) => d.analysisStatus === 'Processing' || (d as any).analysis_status === 'Processing').length;
  const allDone = total > 0 && ready === total;

  return (
    <div className={`mt-6 rounded-xl border p-5 space-y-4 transition-colors ${allDone ? 'border-green-200 bg-green-50' : 'border-blue-200 bg-blue-50'}`}>
      {/* Header */}
      <div className="flex items-center gap-3">
        {allDone
          ? <CheckCircle className="w-6 h-6 text-green-600 shrink-0" />
          : <Loader2 className="w-6 h-6 text-blue-600 shrink-0 animate-spin" />}
        <div>
          <p className="font-semibold text-gray-900">
            {allDone ? 'Text extraction complete' : 'Extracting text from your drawings…'}
          </p>
          <p className="text-sm text-gray-500">
            {allDone
              ? `${ready} of ${total} document${total !== 1 ? 's' : ''} ready. The AI has read all the text from your PDFs.`
              : processing > 0
                ? `${processing} document${processing !== 1 ? 's' : ''} being processed — this usually takes 10–30 seconds per drawing.`
                : `${ready} of ${total} ready — waiting for extraction to start…`}
          </p>
        </div>
        {total > 0 && (
          <Badge className="ml-auto shrink-0 bg-white border-gray-200 text-gray-700">
            {ready}/{total}
          </Badge>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && !allDone && (
        <Progress value={total > 0 ? (ready / total) * 100 : 0} className="h-2" />
      )}

      {/* Document list */}
      {docs.length > 0 && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {docs.map((doc: UploadedDoc) => {
            const status = doc.analysisStatus || (doc as any).analysis_status || 'Pending';
            const isReady = status === 'Ready';
            const isProcessing = status === 'Processing';
            return (
              <div key={doc.id} className="flex items-center gap-2 text-sm bg-white rounded-lg px-3 py-2 border border-gray-100">
                <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <span className="flex-1 truncate text-gray-700">{doc.name || (doc as any).original_name || (doc as any).filename}</span>
                {isReady
                  ? <span className="flex items-center gap-1 text-green-700 text-xs font-medium shrink-0"><CheckCircle className="w-3.5 h-3.5" />Ready</span>
                  : isProcessing
                    ? <span className="flex items-center gap-1 text-blue-600 text-xs shrink-0"><Loader2 className="w-3.5 h-3.5 animate-spin" />Extracting</span>
                    : <span className="text-gray-400 text-xs shrink-0">Pending</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* What happens next */}
      <div className="border-t border-current/10 pt-4 space-y-2">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">What happens next</p>
        <div className="grid gap-2 text-sm">
          <div className={`flex items-center gap-2 ${allDone ? 'text-gray-500 line-through' : 'text-gray-700'}`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${allDone ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-600'}`}>1</div>
            Text extracted from PDFs — AI can now read your drawings
          </div>
          <div className="flex items-center gap-2 text-gray-700">
            <div className="w-5 h-5 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center text-xs font-bold shrink-0">2</div>
            <span>Go to <strong>All Documents</strong> to verify what was read, add comments, or assign for review</span>
          </div>
          <div className="flex items-center gap-2 text-gray-500">
            <div className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-xs font-bold shrink-0">3</div>
            Go to your <strong>project</strong> to run BIM analysis and generate your cost estimate
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3 pt-1">
        <Button
          onClick={() => setLocation('/documents')}
          variant="outline"
          className="flex-1 min-w-[160px] border-gray-300"
        >
          <Eye className="w-4 h-4 mr-2" />
          View in All Documents
        </Button>
        <Button
          onClick={() => setLocation(`/projects/${projectId}`)}
          className={`flex-1 min-w-[160px] ${allDone ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-400 cursor-not-allowed'}`}
          disabled={!allDone}
        >
          <ArrowRight className="w-4 h-4 mr-2" />
          {allDone ? 'Go to Project & Generate BIM' : 'Waiting for extraction…'}
        </Button>
      </div>
    </div>
  );
}

export default function FileDropzone({ projectId, standard }: FileDropzoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<FileWithProgress[]>([]);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [uploadedAt] = useState(() => Date.now());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      if (!projectId) throw new Error('Project ID is required for file upload');
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/projects/${projectId}/documents/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      setFiles(prev => prev.map(f => ({ ...f, status: 'completed', progress: 100 })));
      setUploadComplete(true);
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'documents'] });
    },
    onError: (error: any) => {
      setFiles(prev => prev.map(f => ({ ...f, status: 'error' })));
      toast({
        title: 'Upload failed',
        description: error?.message || 'There was an error uploading your files',
        variant: 'destructive',
      });
    },
  });

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); handleFiles(Array.from(e.dataTransfer.files)); };
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files) handleFiles(Array.from(e.target.files)); };

  const handleFiles = (fileList: File[]) => {
    const allowed = ['.pdf', '.dwg', '.dxf', '.ifc', '.rvt'];
    const valid = fileList.filter(f => allowed.includes('.' + f.name.split('.').pop()?.toLowerCase()));
    if (valid.length === 0) {
      toast({ title: 'Invalid file type', description: 'Please upload PDF, DWG, DXF, IFC, or Revit files only', variant: 'destructive' });
      return;
    }

    const newFiles: FileWithProgress[] = valid.map(file => ({
      file, progress: 0, status: 'uploading', id: Math.random().toString(36).substring(7)
    }));
    setFiles(prev => [...prev, ...newFiles]);
    setUploadComplete(false);

    // Animate progress while upload happens
    newFiles.forEach(item => {
      let pct = 0;
      const iv = setInterval(() => {
        pct = Math.min(pct + 15, 90); // Cap at 90% until server confirms
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, progress: pct } : f));
        if (pct >= 90) clearInterval(iv);
      }, 200);
    });

    const formData = new FormData();
    valid.forEach(f => formData.append('files', f));
    if (standard) formData.append('standard', standard);
    uploadMutation.mutate(formData);
  };

  const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));
  const formatSize = (b: number) => {
    const k = 1024, sizes = ['Bytes','KB','MB','GB'], i = Math.floor(Math.log(b)/Math.log(k));
    return parseFloat((b/Math.pow(k,i)).toFixed(1)) + ' ' + sizes[i];
  };

  const hasErrors = files.some(f => f.status === 'error');

  return (
    <Card className="shadow-sm border">
      <CardContent className="p-8">
        {/* Drop zone — hide once upload is complete */}
        {!uploadComplete && (
          <div
            className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer ${
              dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            data-testid="file-dropzone"
          >
            <div className="mx-auto w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
              <CloudUpload className="text-blue-600 h-8 w-8" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Drop your drawings here</h3>
            <p className="text-gray-500 mb-1">or click to browse</p>
            <p className="text-sm text-gray-400">PDF, DWG, DXF, IFC, Revit · up to 100 MB per file · multiple files supported</p>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept=".pdf,.dwg,.dxf,.ifc,.rvt"
              onChange={handleFileInputChange}
              data-testid="file-input"
            />
          </div>
        )}

        {/* File list */}
        {files.length > 0 && (
          <div className={`space-y-3 ${!uploadComplete ? 'mt-6' : ''}`}>
            {!uploadComplete && <h4 className="font-medium text-gray-800">Uploading {files.length} file{files.length !== 1 ? 's' : ''}…</h4>}
            {files.map(item => (
              <div key={item.id} className={`rounded-lg border px-4 py-3 ${
                item.status === 'completed' ? 'bg-green-50 border-green-200' :
                item.status === 'error' ? 'bg-red-50 border-red-200' :
                'bg-gray-50 border-gray-200'
              }`} data-testid={`file-upload-${item.id}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                    <span className="text-sm font-medium text-gray-900 truncate">{item.file.name}</span>
                    <span className="text-xs text-gray-400 shrink-0">{formatSize(item.file.size)}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {item.status === 'completed' && <CheckCircle className="h-4 w-4 text-green-600" />}
                    {item.status === 'error' && <AlertTriangle className="h-4 w-4 text-red-500" />}
                    {item.status === 'uploading' && <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />}
                    {!uploadComplete && (
                      <button onClick={() => removeFile(item.id)} className="text-gray-400 hover:text-gray-600">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                <Progress value={item.progress} className="h-1.5" data-testid={`progress-${item.id}`} />
                <p className="text-xs text-gray-500 mt-1">
                  {item.status === 'uploading' && `Uploading… ${Math.round(item.progress)}%`}
                  {item.status === 'completed' && 'Uploaded — text extraction starting automatically'}
                  {item.status === 'error' && 'Upload failed — please try again'}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Error: retry */}
        {hasErrors && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800">Some files failed to upload</p>
              <p className="text-xs text-red-600">Check your connection and try again, or upload individual files.</p>
            </div>
            <Button size="sm" variant="outline" className="border-red-300 text-red-700" onClick={() => setFiles([])}>Clear</Button>
          </div>
        )}

        {/* Post-upload status panel */}
        {uploadComplete && projectId && (
          <ExtractionStatusPanel projectId={projectId} uploadedAt={uploadedAt} />
        )}

        {/* Upload more button after completion */}
        {uploadComplete && (
          <div className="mt-4 text-center">
            <button
              onClick={() => { setFiles([]); setUploadComplete(false); }}
              className="text-sm text-blue-600 hover:underline flex items-center gap-1 mx-auto"
            >
              <CloudUpload className="w-3.5 h-3.5" />Upload more files
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
