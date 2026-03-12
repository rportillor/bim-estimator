import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Link } from 'wouter';
import { 
  Box, 
  Eye, 
  Download, 
  Loader2, 
  Building2, 
  CheckCircle,
  Clock,
  Play
} from 'lucide-react';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useSSEProgress } from '@/hooks/use-sse-progress';
import { ProgressSpinner } from '@/components/ProgressSpinner';

interface BIMIntegrationCardProps {
  projectId: string;
}

// Helper function for consistent auth headers
function getAuthHeaders() {
  // Get standardized auth_token from localStorage
  const token = localStorage.getItem("auth_token");
  const h: Record<string,string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

export default function BIMIntegrationCard({ projectId }: BIMIntegrationCardProps) {
  const [generatingBIM, setGeneratingBIM] = useState(false);
  const [currentGenerationModelId, setCurrentGenerationModelId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressStep, setProgressStep] = useState('');
  const { toast } = useToast();

  // Fetch project documents
  const { data: documents, isLoading: documentsLoading } = useQuery<any[]>({
    queryKey: ['/api/projects', projectId, 'documents'],
    enabled: !!projectId
  });

  // Fetch existing BIM models with proper auth headers
  const { data: bimModels, isLoading: modelsLoading, refetch: refetchModels } = useQuery<any[]>({
    queryKey: ['/api/projects', projectId, 'bim-models'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/bim-models`, {
        method: "GET",
        headers: getAuthHeaders(),
        credentials: "include",  // send cookies too
      }).catch(err => {
        console.error('Failed to fetch BIM models:', err);
        throw err;
      });
      if (!res.ok) throw new Error(`Failed to fetch models: ${res.statusText}`);
      return res.json();
    }
  });

  // Get real-time BIM generation status via SSE
  const latestModel = bimModels?.[0];
  const { data: sseProgress } = useSSEProgress(
    latestModel?.id || null,
    generatingBIM && !!latestModel?.id
  );

  // Update progress from SSE data
  useEffect(() => {
    if (sseProgress) {
      const progressPercent = Math.round(sseProgress.progress * 100);
      setProgress(progressPercent);
      setProgressStep(sseProgress.message || '');
      
      // Handle completion or failure
      if (sseProgress.status === 'completed') {
        setGeneratingBIM(false);
        setCurrentGenerationModelId(null);
        setProgress(100);
        setProgressStep('✅ BIM model generated successfully!');
        toast({
          title: "🏗️ BIM Model Generated Successfully!",
          description: "Your BIM model is ready with 3D geometry and real quantity data. Click 'View BIM' to explore."
        });
        refetchModels();
        queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'bim-models'] });
        setTimeout(() => {
          setProgress(0);
          setProgressStep('');
        }, 3000);
      } else if (sseProgress.status === 'failed') {
        setGeneratingBIM(false);
        setCurrentGenerationModelId(null);
        toast({
          title: "⚠️ BIM Generation Failed",
          description: sseProgress.error || sseProgress.message || "Generation failed",
          variant: "destructive"
        });
        setProgress(0);
        setProgressStep('');
      }
    }
  }, [sseProgress, refetchModels, queryClient, projectId, toast]);

  // Generate BIM Model mutation with timeout protection
  const generateBIMMutation = useMutation({
    mutationFn: async ({ modelName }: { modelName?: string }) => {
      // Use consistent auth headers
      const headers = getAuthHeaders();

      // 🚨 ADD TIMEOUT PROTECTION (10 minutes max for complex BIM generation)
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('BIM generation timed out after 10 minutes. The process may have completed successfully - please check the BIM viewer.')), 600000)
      );

      // Use proper construction methodology endpoint
      // First get the BIM model for this project
      const modelsResponse = await fetch(`/api/projects/${projectId}/bim-models`, {
        headers,
        credentials: 'include'
      });
      
      if (!modelsResponse.ok) {
        throw new Error('Could not find BIM model for project');
      }
      
      const models = await modelsResponse.json();
      const modelId = models[0]?.id;
      if (!modelId) {
        throw new Error('No BIM model found for this project. Please create one first.');
      }
      
      // Track the modelId for progress tracking
      setCurrentGenerationModelId(modelId);
      
      const fetchPromise = fetch(`/api/bim/models/${modelId}/generate`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ 
          projectId, 
          positioningMode: 'preferClaude',
          modelName,
          // CRITICAL: Enable all comprehensive features
          enableRealCoordinates: true,
          enableTransactionSafety: true,
          useConstructionWorkflow: true,
          enhancedMode: true,
          fullDocumentAnalysis: true,
          levelOfDetail: 'LOD300',
          includeStructural: true,
          includeMEP: true,
          includeArchitectural: true,
          qualityLevel: 'professional'
        })
      }).catch(err => {
        console.error('Failed to generate BIM model using construction methodology:', err);
        throw err;
      });

      const response = await Promise.race([fetchPromise, timeoutPromise]) as Response;
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: `HTTP ${response.status}: ${response.statusText}` }));
        throw new Error(error.message || error.error || 'Failed to generate BIM model');
      }
      return response.json();
    },
    onSuccess: (data) => {
      console.log('✅ BIM generation started successfully! Response:', data);
      // Progress is now handled by SSE, just refresh queries
      refetchModels();
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'bim-models'] });
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'bim-elements'] });
    },
    onError: (error: Error) => {
      console.error('[BIM_FRONTEND]', new Date().toISOString(), '- Generation failed:', {
        projectId: projectId,
        error: error instanceof Error ? error.message : String(error),
        details: error
      });
      console.error('❌ Full error details:', JSON.stringify(error, null, 2));
      
      // Better error message extraction
      let errorMessage = 'Unknown error occurred during BIM generation';
      if (error?.message) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else if (error && typeof error === 'object' && 'error' in error) {
        errorMessage = (error as any).error;
      }
      
      toast({
        title: "⚠️ BIM Generation Failed",
        description: errorMessage.includes('timeout') 
          ? "Generation may have timed out. Please check the BIM viewer - your model might have been created successfully."
          : "BIM generation encountered an issue. Please check if the model was created successfully in the BIM viewer.",
        variant: "destructive"
      });
    },
    onSettled: () => {
      // Generation is now tracked by SSE - only clean up local state if not generating
      if (!generatingBIM) {
        setProgress(0);
        setProgressStep('');
        setCurrentGenerationModelId(null);
      }
    }
  });

  const handleGenerateBIM = async () => {
    if (!documents || documents.length === 0) {
      toast({
        title: "No Documents Found",
        description: "Please upload documents before generating a BIM model.",
        variant: "destructive"
      });
      return;
    }

    // 🚀 START LOADING STATE WITH PROGRESS TRACKING
    setGeneratingBIM(true);
    setProgress(0);
    setProgressStep('Initializing...');
    
    // 🔄 PROGRESS SIMULATION: Update progress every 3 seconds
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        const newProgress = Math.min(prev + Math.random() * 15 + 5, 95);
        
        // Update step based on progress
        if (newProgress < 20) {
          setProgressStep('🧹 Cleaning up old models...');
        } else if (newProgress < 40) {
          setProgressStep('📄 Analyzing construction documents...');
        } else if (newProgress < 60) {
          setProgressStep('🤖 AI extracting building elements...');
        } else if (newProgress < 80) {
          setProgressStep('🏗️ Generating 3D geometry...');
        } else {
          setProgressStep('💾 Storing BIM elements to database...');
        }
        
        return newProgress;
      });
    }, 2000);

    // Store interval ID to clear it later
    (window as any).bimProgressInterval = progressInterval;
    
    // ✅ SKIP FRONTEND CLEANUP: Server handles cleanup automatically during generation
    console.log('🚀 Starting BIM generation - server will handle cleanup automatically');
    
    toast({
      title: "🚀 Starting BIM Generation",
      description: `Processing ${documents.length} documents with AI analysis...`,
    });

    // Use the first analyzed document or first document
    const analyzedDoc = documents.find(doc => doc.analyzed) || documents[0];
    if (!analyzedDoc) {
      toast({
        title: "No Suitable Document",
        description: "Please ensure documents are uploaded and analyzed.",
        variant: "destructive"
      });
      return;
    }

    setGeneratingBIM(true);
    console.log('🚀 Starting BIM generation that WILL store coordinates to database...');
    generateBIMMutation.mutate({
      modelName: `BIM Model - ${new Date().toLocaleDateString()}`
    });
  };

  
  if (documentsLoading || modelsLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span>Loading BIM data...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 max-w-full">
      {/* BIM Overview Card */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Box className="h-5 w-5 text-blue-600" />
            3D BIM Models & Visualization
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 overflow-x-auto">
          {/* Quick Stats - Mobile Responsive */}
          <div className="grid grid-cols-3 gap-2 sm:gap-4 p-3 sm:p-4 bg-gray-50 rounded-lg">
            <div className="text-center">
              <div className="text-xl sm:text-2xl font-bold text-blue-600">{bimModels?.length || 0}</div>
              <div className="text-xs sm:text-sm text-gray-600">BIM Models</div>
            </div>
            <div className="text-center">
              <div className="text-xl sm:text-2xl font-bold text-green-600">{documents?.length || 0}</div>
              <div className="text-xs sm:text-sm text-gray-600">Source Docs</div>
            </div>
            <div className="text-center">
              <div className="text-xl sm:text-2xl font-bold text-purple-600">
                {generatingBIM 
                  ? `${Math.ceil((progress / 100) * (documents?.length || 0))} of ${documents?.length || 0}`
                  : `${documents?.filter(d => d.analyzed).length || 0} of ${documents?.length || 0}`
                }
              </div>
              <div className="text-xs sm:text-sm text-gray-600">
                {generatingBIM ? "Processing" : "Analyzed"}
              </div>
            </div>
          </div>

          {/* Latest Model Status - Mobile Responsive */}
          {latestModel ? (
            <div className="p-3 sm:p-4 bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="p-2 bg-white rounded-lg shadow-sm flex-shrink-0">
                    <Building2 className="h-5 w-5 text-green-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-gray-900 text-sm sm:text-base truncate">{latestModel.name}</h3>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mt-1">
                      <Badge variant={
                        (latestModel.status === 'completed' && !generatingBIM) ? 'default' : 
                        (latestModel.status === 'generating' || generatingBIM) ? 'destructive' : 
                        'secondary'
                      } className="w-fit">
                        {(latestModel.status === 'completed' && !generatingBIM) ? (
                          <><CheckCircle className="h-3 w-3 mr-1" /> Ready</>
                        ) : (latestModel.status === 'generating' || generatingBIM) ? (
                          <><Clock className="h-3 w-3 mr-1 animate-spin" /> Generating</>
                        ) : (
                          <><Clock className="h-3 w-3 mr-1" /> {latestModel.status}</>
                        )}
                      </Badge>
                      <span className="text-xs sm:text-sm text-gray-500 truncate">
                        {latestModel.version} • {new Date(latestModel.createdAt || '').toLocaleDateString()} at {new Date(latestModel.createdAt || '').toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                      </span>
                    </div>
                  </div>
                </div>
                <Link href={`/projects/${projectId}/bim/${latestModel.id}`}>
                  <Button size="sm" className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto">
                    <Eye className="h-4 w-4 mr-2" />
                    <span>View 3D</span>
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <Alert>
              <Box className="h-4 w-4" />
              <AlertDescription>
                No BIM models generated yet. Create your first 3D BIM model from uploaded documents.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Generation & Actions Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="h-5 w-5 text-purple-600" />
            BIM Generation & Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {generatingBIM && (
            <div className="p-4 bg-blue-50 rounded-lg border">
              <div className="flex items-center gap-4">
                <ProgressSpinner 
                  modelId={currentGenerationModelId}
                  size="medium"
                  showPercentage={true}
                  showMessage={true}
                />
                <div className="flex-1">
                  <div className="font-medium text-blue-900">Comprehensive BIM Generation in Progress</div>
                  <div className="text-sm text-blue-700 mt-1">
                    Using advanced construction workflow: Specifications → Products → Assemblies → Elements
                  </div>
                  <div className="text-xs text-blue-600 mt-2">
                    Processing {documents?.length || 0} construction documents
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-3 max-w-full">
            <Button 
              onClick={handleGenerateBIM}
              disabled={generatingBIM || !documents || documents.length === 0}
              className="w-full justify-start h-auto p-4 relative overflow-hidden"
              data-testid="button-generate-bim"
            >
              {generatingBIM && (
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-500 opacity-90 flex items-center justify-center">
                  <div className="flex items-center gap-2 text-white">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="font-medium">Processing...</span>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded">
                  {generatingBIM ? (
                    <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
                  ) : (
                    <Box className="h-5 w-5 text-blue-600" />
                  )}
                </div>
                <div className="text-left">
                  <div className="font-medium">
                    {generatingBIM ? "Generating Comprehensive BIM Model..." : "Generate Comprehensive BIM Model"}
                  </div>
                  <div className="text-sm opacity-75">
                    Professional construction workflow: Specs → Products → Assemblies → Elements
                  </div>
                </div>
              </div>
            </Button>

            {latestModel && (
              <>
                <Link href={`/projects/${projectId}/bim`} className="block">
                  <Button variant="outline" className="w-full justify-start h-auto p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-green-100 rounded">
                        <Eye className="h-5 w-5 text-green-600" />
                      </div>
                      <div className="text-left">
                        <div className="font-medium">Open BIM Viewer</div>
                        <div className="text-sm text-gray-600">
                          Interactive 3D visualization with dual unit support
                        </div>
                      </div>
                    </div>
                  </Button>
                </Link>

                <Button 
                  variant="outline" 
                  className="w-full justify-start h-auto p-4"
                  onClick={() => {
                    const url = `/api/bim-models/${latestModel.id}/ifc`;
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `${latestModel.name}.ifc`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                  data-testid="button-download-ifc"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-100 rounded">
                      <Download className="h-5 w-5 text-purple-600" />
                    </div>
                    <div className="text-left">
                      <div className="font-medium">Export IFC Model</div>
                      <div className="text-sm text-gray-600">
                        Download industry-standard IFC file for external tools
                      </div>
                    </div>
                  </div>
                </Button>
              </>
            )}
          </div>

          {/* Feature Highlights */}
          <div className="mt-6 p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg border">
            <h4 className="font-medium text-gray-900 mb-3">✨ Professional BIM Features</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span>AI-powered generation</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span>Real quantity take-off</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span>Metric & Imperial units</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span>IFC export ready</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span>Interactive 3D viewer</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span>Professional standards</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}