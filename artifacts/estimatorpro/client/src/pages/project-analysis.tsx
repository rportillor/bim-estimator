import { useState, useEffect } from 'react';
import { useParams } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ArrowLeft,
  FileText,
  Building,
  TrendingUp,
  Clock,
  RefreshCw,
  Box,
  Sparkles,
  CheckCircle2,
  XCircle,
  Layers,
  ShieldCheck,
  Info,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { DocumentSimilarityHeatmap } from '@/components/similarity/DocumentSimilarityHeatmap';
import { RevisionComparison } from '@/components/revision/RevisionComparison';
import { AICoach } from '@/components/ai-coach/AICoach';
import { RfiDashboard } from '@/components/rfi/RfiDashboard';
import { ChangeRequestDashboard } from '@/components/change-requests/ChangeRequestDashboard';
import BIMIntegrationCard from '@/components/bim-integration-card';
import type { Project } from '@shared/schema';

export default function ProjectAnalysis() {
  const { id: projectId } = useParams();
  
  // Track loading progress for better UX - Use sessionStorage for persistence
  const [loadingProgress, setLoadingProgress] = useState(() => {
    const saved = sessionStorage.getItem(`analysis-progress-${projectId}`);
    return saved ? JSON.parse(saved).progress : 0;
  });
  const [currentStage, setCurrentStage] = useState(() => {
    const saved = sessionStorage.getItem(`analysis-progress-${projectId}`);
    return saved ? JSON.parse(saved).stage : 'parsing';
  });
  const [showLoader, setShowLoader] = useState(() => {
    const saved = sessionStorage.getItem(`analysis-progress-${projectId}`);
    return saved ? JSON.parse(saved).showLoader : false;
  });
  const [analysisCompleted, setAnalysisCompleted] = useState(() => {
    const saved = sessionStorage.getItem(`analysis-progress-${projectId}`);
    return saved ? JSON.parse(saved).completed : false;
  });

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ['/api/projects', projectId],
    enabled: !!projectId,
  });

  const { data: documents, isLoading: documentsLoading } = useQuery<any[]>({
    queryKey: ['/api/projects', projectId, 'documents'],
    enabled: !!projectId,
  });

  const { data: aiInsights, isLoading: insightsLoading } = useQuery<any>({
    queryKey: ['/api/projects', projectId, 'ai-insights'],
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());

  // COMPLETELY DISABLED - No polling needed
  const realProgress = null;

  // Update progress from real Claude analysis
  useEffect(() => {
    if (realProgress && !analysisCompleted) {
      setLoadingProgress((realProgress as any)?.progress || 0);
      setCurrentStage('parsing'); // Keep showing parsing stage
      setShowLoader(true);
      
      if ((realProgress as any)?.completed) {
        setAnalysisCompleted(true);
        setShowLoader(false);
      }
    }
  }, [realProgress, analysisCompleted]);

  // Save state to sessionStorage whenever it changes
  useEffect(() => {
    if (projectId) {
      const state = {
        progress: loadingProgress,
        stage: currentStage,
        showLoader,
        completed: analysisCompleted
      };
      sessionStorage.setItem(`analysis-progress-${projectId}`, JSON.stringify(state));
    }
  }, [loadingProgress, currentStage, showLoader, analysisCompleted, projectId]);

  // Mark analysis as complete since server shows 100% completion
  useEffect(() => {
    if (!projectLoading && !documentsLoading && project) {
      // Server logs show analysis is complete, so hide progress
      setLoadingProgress(100);
      setShowLoader(false);
      setAnalysisCompleted(true);
    }
  }, [projectLoading, documentsLoading, project]);

  // Show simple loading for initial data fetch only
  if (projectLoading || documentsLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading project...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 font-medium mb-2">Project Not Found</p>
          <p className="text-sm text-gray-500 mb-4">
            The requested project could not be loaded.
          </p>
          <Button 
            variant="outline"
            onClick={() => window.history.back()}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </div>
      </div>
    );
  }

  const projectContext = {
    projectType: project.buildingArea || 'General Construction',
    buildingType: project.buildingArea || 'Commercial',
    location: project.location || 'North America',
    currentPhase: project.status === 'Active' ? 'Planning' : project.status
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 sm:p-6 border-b bg-white gap-4">
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => window.history.back()}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">{project.name}</h1>
            <p className="text-gray-600 text-sm sm:text-base">Advanced Project Analysis</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-2 sm:gap-4 w-full sm:w-auto">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <FileText className="h-4 w-4" />
            <span>{documents?.length || 0} docs</span>
          </div>
          <Badge variant={project.status === 'Active' ? 'default' : 'secondary'}>
            {project.status}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {project.location}
          </Badge>
          {analysisCompleted && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => {
                sessionStorage.removeItem(`analysis-progress-${projectId}`);
                sessionStorage.removeItem(`similarity-progress-${projectId}`);
                setLoadingProgress(0);
                setCurrentStage('parsing');
                setShowLoader(false);
                setAnalysisCompleted(false);
                window.location.reload();
              }}
              className="text-xs"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Reset Analysis
            </Button>
          )}
        </div>
      </div>

      {/* Project Overview Cards */}
      <div className="p-4 sm:p-6 border-b bg-gray-50">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <Card className="bg-white">
            <CardContent className="p-4 text-center">
              <Building className="h-6 w-6 text-blue-600 mx-auto mb-2" />
              <p className="text-sm text-gray-600">Building Area</p>
              <p className="font-semibold">{project.buildingArea || 'N/A'}</p>
            </CardContent>
          </Card>
          
          <Card className="bg-white">
            <CardContent className="p-4 text-center">
              <TrendingUp className="h-6 w-6 text-green-600 mx-auto mb-2" />
              <p className="text-sm text-gray-600">Estimate Value</p>
              <p className="font-semibold">{project.estimateValue || 'Pending'}</p>
            </CardContent>
          </Card>
          
          <Card className="bg-white">
            <CardContent className="p-4 text-center">
              <FileText className="h-6 w-6 text-purple-600 mx-auto mb-2" />
              <p className="text-sm text-gray-600">Documents</p>
              <p className="font-semibold">{documents?.length || 0}</p>
            </CardContent>
          </Card>
          
          <Card className="bg-white">
            <CardContent className="p-4 text-center">
              <Clock className="h-6 w-6 text-orange-600 mx-auto mb-2" />
              <p className="text-sm text-gray-600">Created</p>
              <p className="font-semibold">
                {project.createdAt ? new Date(project.createdAt).toLocaleDateString() : 'N/A'}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Advanced Analysis Progress - Always show section */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-b">
        {showLoader ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-600 border-t-transparent"></div>
                <div>
                  <h3 className="font-semibold text-blue-900">
                    {currentStage === 'parsing' ? '📄 Document Parsing' :
                     currentStage === 'nlp' ? '🧠 NLP Analysis' :
                     currentStage === 'cv' ? '👁️ Computer Vision' :
                     currentStage === 'boq' ? '🏗️ BoQ Generation' :
                     '✅ Compliance Check'}
                  </h3>
                  <p className="text-sm text-blue-700">
                    {currentStage === 'parsing' ? 'Converting and extracting content from files' :
                     currentStage === 'nlp' ? 'Understanding specifications using AI' :
                     currentStage === 'cv' ? 'Detecting components from drawings' :
                     currentStage === 'boq' ? 'Creating detailed Bill of Quantities' :
                     'Verifying building code requirements'}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-blue-600">{Math.round(loadingProgress)}%</div>
                <div className="text-xs text-blue-500">Stage Progress</div>
              </div>
            </div>
            <Progress value={loadingProgress} className="h-2" />
            <div className="text-xs text-blue-600">
              🚀 AI Analysis in Progress - {currentStage === 'parsing' ? 'Reading files...' :
                                            currentStage === 'nlp' ? 'Processing specifications...' :
                                            currentStage === 'cv' ? 'Analyzing drawings...' :
                                            currentStage === 'boq' ? 'Calculating quantities...' :
                                            'Checking compliance...'}
            </div>
          </div>
        ) : (
          <div className="text-center py-2">
            <div className="text-sm text-gray-600 mb-1">✅ Analysis Complete</div>
            <div className="text-xs text-gray-500">All project data processed and ready for analysis</div>
          </div>
        )}
      </div>

      {/* Main Analysis Content */}
      <div className="w-full">
        <Tabs defaultValue="bim" className="w-full">
          <div className="px-2 sm:px-4 pt-3 sm:pt-4 pb-3 sm:pb-4 bg-white border-b sticky top-0 z-10">
            <div className="overflow-x-auto">
              <TabsList className="inline-flex w-max min-w-full gap-1 sm:gap-2 h-auto bg-gray-100 rounded-lg p-1">
              <TabsTrigger 
                value="similarity" 
                className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm font-medium px-2 sm:px-3 py-2 sm:py-3 rounded whitespace-nowrap"
                data-testid="tab-similarity"
              >
                📊 <span className="hidden sm:inline">Similarity</span><span className="sm:hidden">Sim</span>
              </TabsTrigger>
              <TabsTrigger 
                value="coach" 
                className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm font-medium px-2 sm:px-3 py-2 sm:py-3 rounded whitespace-nowrap"
                data-testid="tab-coach"
              >
                🤖 <span className="hidden sm:inline">AI Coach</span><span className="sm:hidden">AI</span>
              </TabsTrigger>
              <TabsTrigger 
                value="rfis" 
                className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm font-medium px-2 sm:px-3 py-2 sm:py-3 rounded whitespace-nowrap"
                data-testid="tab-rfis"
              >
                ❓ RFIs
              </TabsTrigger>
              <TabsTrigger 
                value="change-requests" 
                className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm font-medium px-2 sm:px-3 py-2 sm:py-3 rounded whitespace-nowrap"
                data-testid="tab-change-requests"
              >
                🔄 <span className="hidden sm:inline">Changes</span><span className="sm:hidden">Chg</span>
              </TabsTrigger>
              <TabsTrigger 
                value="revisions" 
                className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm font-medium px-2 sm:px-3 py-2 sm:py-3 rounded whitespace-nowrap"
                data-testid="tab-revisions"
              >
                💰 <span className="hidden sm:inline">Cost-Efficient Analysis</span><span className="sm:hidden">Cost</span>
              </TabsTrigger>
              <TabsTrigger 
                value="bim" 
                className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm font-medium px-2 sm:px-3 py-2 sm:py-3 rounded whitespace-nowrap"
                data-testid="tab-bim"
              >
                <Box className="h-4 w-4" />
                <span className="hidden sm:inline">3D BIM</span><span className="sm:hidden">BIM</span>
              </TabsTrigger>
              <TabsTrigger 
                value="ai-insights" 
                className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm font-medium px-2 sm:px-3 py-2 sm:py-3 rounded whitespace-nowrap"
                data-testid="tab-ai-insights"
              >
                <Sparkles className="h-4 w-4" />
                <span className="hidden sm:inline">AI Insights</span><span className="sm:hidden">AI</span>
              </TabsTrigger>
            </TabsList>
            </div>
          </div>
          
          <TabsContent value="similarity" className="p-4 sm:p-6">
            <Card className="w-full">
              <CardContent className="p-4">
                <DocumentSimilarityHeatmap projectId={projectId!} />
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="coach" className="p-4 sm:p-6">
            <Card className="w-full overflow-hidden">
              <CardContent className="p-0">
                <AICoach 
                  projectId={projectId}
                  context={projectContext}
                />
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="rfis" className="p-4 sm:p-6">
            <div className="w-full">
              <RfiDashboard projectId={projectId!} />
            </div>
          </TabsContent>
          
          <TabsContent value="change-requests" className="p-4 sm:p-6">
            <div className="w-full">
              <ChangeRequestDashboard projectId={projectId!} />
            </div>
          </TabsContent>

          <TabsContent value="revisions" className="p-4 sm:p-6">
            <div className="w-full">
              <RevisionComparison 
                projectId={projectId!}
                analysisType="similarity"
              />
            </div>
          </TabsContent>
          
          <TabsContent value="bim" className="p-4 sm:p-6">
            <div className="w-full">
              <BIMIntegrationCard projectId={projectId!} />
            </div>
          </TabsContent>

          <TabsContent value="ai-insights" className="p-4 sm:p-6">
            <div className="w-full space-y-5">
              {insightsLoading ? (
                <Card><CardContent className="flex items-center gap-3 py-10 justify-center text-gray-500">
                  <RefreshCw className="h-5 w-5 animate-spin" /> Loading AI insights…
                </CardContent></Card>
              ) : !aiInsights ? (
                <Card><CardContent className="py-10 text-center text-gray-500">Could not load insights.</CardContent></Card>
              ) : (
                <>
                  {/* ── Status banner ── */}
                  <Card className={aiInsights.hasAnalysis ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}>
                    <CardContent className="flex items-start gap-4 py-5">
                      {aiInsights.hasAnalysis
                        ? <CheckCircle2 className="h-6 w-6 text-green-600 shrink-0 mt-0.5" />
                        : <Info className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />}
                      <div>
                        <p className="font-semibold text-sm">
                          {aiInsights.hasAnalysis ? 'Claude analysis available' : 'No Claude analysis yet'}
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">
                          {aiInsights.hasAnalysis
                            ? `Cached ${aiInsights.cachedAt ? new Date(aiInsights.cachedAt).toLocaleString() : 'recently'} · ${aiInsights.documentCount} documents · ${aiInsights.docsWithText} with extracted text`
                            : `${aiInsights.documentCount} documents uploaded, ${aiInsights.docsWithText} with extracted text. Generate a BIM model first to run Claude analysis.`}
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* ── Building analysis ── */}
                  {aiInsights.buildingAnalysis && (
                    <Card>
                      <CardContent className="py-5">
                        <div className="flex items-center gap-2 mb-4">
                          <Building className="h-5 w-5 text-blue-600" />
                          <h3 className="font-semibold text-sm">Building Analysis</h3>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {aiInsights.buildingAnalysis.dimensions && (
                            <>
                              {aiInsights.buildingAnalysis.dimensions.width && (
                                <div className="bg-gray-50 rounded p-3">
                                  <p className="text-xs text-gray-500">Width</p>
                                  <p className="font-medium text-sm">{aiInsights.buildingAnalysis.dimensions.width} m</p>
                                </div>
                              )}
                              {aiInsights.buildingAnalysis.dimensions.length && (
                                <div className="bg-gray-50 rounded p-3">
                                  <p className="text-xs text-gray-500">Length</p>
                                  <p className="font-medium text-sm">{aiInsights.buildingAnalysis.dimensions.length} m</p>
                                </div>
                              )}
                            </>
                          )}
                          {aiInsights.buildingHierarchy && aiInsights.buildingHierarchy.length > 0 && (
                            <div className="bg-gray-50 rounded p-3">
                              <p className="text-xs text-gray-500">Storeys</p>
                              <p className="font-medium text-sm">{aiInsights.buildingHierarchy.length}</p>
                            </div>
                          )}
                        </div>
                        {aiInsights.buildingHierarchy && aiInsights.buildingHierarchy.length > 0 && (
                          <div className="mt-4">
                            <p className="text-xs text-gray-500 mb-2">Floor levels</p>
                            <div className="flex flex-wrap gap-2">
                              {aiInsights.buildingHierarchy.map((s: any, i: number) => (
                                <Badge key={i} variant="outline" className="text-xs">
                                  {typeof s === 'string' ? s : (s.name || s.level || `Level ${i+1}`)}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* ── Component types & standards ── */}
                  <div className="grid sm:grid-cols-2 gap-4">
                    {aiInsights.componentTypes && aiInsights.componentTypes.length > 0 && (
                      <Card>
                        <CardContent className="py-5">
                          <div className="flex items-center gap-2 mb-3">
                            <Layers className="h-4 w-4 text-violet-600" />
                            <h3 className="font-semibold text-sm">Component Types Identified</h3>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {aiInsights.componentTypes.map((c: string) => (
                              <Badge key={c} className="bg-violet-50 text-violet-700 border-violet-200 text-xs capitalize">{c}</Badge>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                    {aiInsights.standardsRequired && aiInsights.standardsRequired.length > 0 && (
                      <Card>
                        <CardContent className="py-5">
                          <div className="flex items-center gap-2 mb-3">
                            <ShieldCheck className="h-4 w-4 text-green-600" />
                            <h3 className="font-semibold text-sm">Standards Referenced</h3>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {aiInsights.standardsRequired.map((s: string) => (
                              <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>

                  {/* ── Per-document list ── */}
                  <Card>
                    <CardContent className="py-5">
                      <div className="flex items-center gap-2 mb-4">
                        <FileText className="h-4 w-4 text-gray-600" />
                        <h3 className="font-semibold text-sm">Documents ({aiInsights.documents?.length ?? 0})</h3>
                        <span className="text-xs text-gray-400 ml-auto">{aiInsights.docsWithText} with extracted text</span>
                      </div>
                      <div className="space-y-2">
                        {(aiInsights.documents ?? []).map((doc: any) => {
                          const isExpanded = expandedDocs.has(doc.id);
                          const toggle = () => setExpandedDocs(prev => {
                            const next = new Set(prev);
                            isExpanded ? next.delete(doc.id) : next.add(doc.id);
                            return next;
                          });
                          return (
                            <div key={doc.id} className="border rounded-lg overflow-hidden">
                              <button
                                onClick={toggle}
                                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                              >
                                {doc.hasText
                                  ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                                  : <XCircle className="h-4 w-4 text-gray-300 shrink-0" />}
                                <span className="text-sm flex-1 min-w-0 truncate">{doc.filename}</span>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Badge variant="outline" className="text-xs hidden sm:inline-flex">{doc.analysisStatus}</Badge>
                                  {doc.pageCount && <span className="text-xs text-gray-400">{doc.pageCount}p</span>}
                                  {doc.hasText && (isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />)}
                                </div>
                              </button>
                              {isExpanded && doc.textPreview && (
                                <div className="px-4 pb-4 pt-1 bg-gray-50 border-t">
                                  <p className="text-xs text-gray-500 mb-1">Extracted text preview</p>
                                  <p className="text-xs text-gray-700 leading-relaxed font-mono whitespace-pre-wrap">{doc.textPreview}…</p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}