import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  BarChart3, 
  FileText, 
  AlertTriangle, 
  CheckCircle, 
  Activity,
  RefreshCw,
  Eye,
  ZoomIn,
  AlertCircle,
  Info,
  HelpCircle
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

interface ConflictDetail {
  type: 'specification_mismatch' | 'code_violation' | 'material_conflict' | 'timeline_overlap' | 'compliance_gap';
  description: string;
  affectedSections: string[];
  resolution: string;
  impact: 'low' | 'medium' | 'high';
}

interface DocumentSimilarity {
  id?: string;
  documentAId: string;
  documentBId: string;
  documentAName?: string;
  documentBName?: string;
  similarityScore: number;
  overlapType?: 'content' | 'specifications' | 'materials' | 'compliance' | 'schedule';
  overlapTypes?: ('content' | 'specifications' | 'materials' | 'compliance' | 'schedule')[];
  criticalLevel: 'low' | 'medium' | 'high' | 'critical';
  details?: string;
  conflictDescription?: string;
  conflicts?: ConflictDetail[];
  recommendations: string[];
  detectedAt?: string;
}

interface SimilarityMatrix {
  documents: DocumentMetadata[];
  similarities: DocumentSimilarity[];
  overallScore: number;
  riskAreas: string[];
  recommendations: string[];
  lastAnalyzed: string;
}

interface DocumentMetadata {
  id: string;
  name: string;
  type: 'drawings' | 'specifications' | 'contracts' | 'reports' | 'standards';
  complianceStatus: 'compliant' | 'warning' | 'violation' | 'unknown';
}

interface DocumentSimilarityHeatmapProps {
  projectId: string;
}

export function DocumentSimilarityHeatmap({ projectId }: DocumentSimilarityHeatmapProps) {
  const [_selectedCell, _setSelectedCell] = useState<{row: number, col: number, similarity?: DocumentSimilarity} | null>(null);
  const [_viewMode, _setViewMode] = useState<'heatmap' | 'details'>('heatmap');
  const [analysisProgress, setAnalysisProgress] = useState(() => {
    const saved = sessionStorage.getItem(`similarity-progress-${projectId}`);
    return saved ? JSON.parse(saved).progress : 0;
  });
  const [currentTask, setCurrentTask] = useState(() => {
    const saved = sessionStorage.getItem(`similarity-progress-${projectId}`);
    return saved ? JSON.parse(saved).task : 'Initializing analysis...';
  });
  const [analysisCompleted, setAnalysisCompleted] = useState(() => {
    const saved = sessionStorage.getItem(`similarity-progress-${projectId}`);
    const completed = saved ? JSON.parse(saved).completed : false;
    // If we already have the matrix data, mark as completed to stop polling
    return completed;
  });

  // Fetch project documents first to check count
  const { data: documents } = useQuery<any[]>({
    queryKey: ['/api/projects', projectId, 'documents'],
    enabled: !!projectId,
  });

  // COMPLETELY DISABLED - No progress polling needed
  const realProgress = null;

  // Fetch similarity matrix
  const { data: matrix, isLoading, refetch, isRefetching } = useQuery<SimilarityMatrix>({
    queryKey: ['/api/projects', projectId, 'similarity'],
    enabled: !!projectId && documents && documents.length >= 2,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Save progress state to sessionStorage
  useEffect(() => {
    if (projectId) {
      const state = {
        progress: analysisProgress,
        task: currentTask,
        completed: analysisCompleted
      };
      sessionStorage.setItem(`similarity-progress-${projectId}`, JSON.stringify(state));
    }
  }, [analysisProgress, currentTask, analysisCompleted, projectId]);

  // Use real progress from backend instead of simulation
  useEffect(() => {
    if (realProgress && !analysisCompleted) {
      setAnalysisProgress((realProgress as any)?.progress || 0);
      setCurrentTask((realProgress as any)?.currentTask || '');
      
      if ((realProgress as any)?.completed || ((realProgress as any)?.progress || 0) >= 100) {
        setAnalysisCompleted(true);
        setAnalysisProgress((realProgress as any)?.error ? 0 : 100);
      }
    }
  }, [realProgress, analysisCompleted]);

  // Check if we have matrix data and mark as complete to stop polling
  useEffect(() => {
    if (matrix && (matrix as any).matrix && (matrix as any).matrix.length > 0 && !analysisCompleted) {
      console.log('📊 Matrix data detected, stopping polling');
      setAnalysisCompleted(true);
      setAnalysisProgress(100);
    }
  }, [matrix, analysisCompleted]);

  // Show error state if analysis failed
  if ((realProgress as any)?.error) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center text-red-600">
            <AlertCircle className="h-5 w-5 mr-2" />
            Analysis Failed
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <h4 className="font-semibold text-red-800 mb-2">Error Details</h4>
            <p className="text-red-700 mb-3">{(realProgress as any)?.error?.message || 'Unknown error occurred'}</p>
            <p className="text-sm text-red-600">
              Please try again or contact support if the issue persists.
            </p>
          </div>
          
          <div className="flex gap-2">
              <Button 
                onClick={() => {
                  sessionStorage.removeItem(`similarity-progress-${projectId}`);
                  setAnalysisProgress(0);
                  setCurrentTask('Initializing analysis...');
                  setAnalysisCompleted(false);
                  window.location.reload();
                }}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry Analysis
              </Button>
              <Button 
                variant="outline"
                onClick={() => {
                  alert('Contact support with error details: ' + (realProgress as any)?.error?.message);
                }}
              >
                Get Help
              </Button>
            </div>
        </CardContent>
      </Card>
    );
  }

  // Show loading state with progress
  if (isLoading && !analysisCompleted) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center">
            <BarChart3 className="h-5 w-5 mr-2" />
            Document Similarity Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-96">
            <div className="text-center w-full max-w-md">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-6"></div>
              
              <p className="text-gray-600 font-medium mb-2">Analyzing document similarities...</p>
              <p className="text-sm text-gray-500 mb-4">
                Processing {documents?.length || 0} documents
              </p>
              
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-gray-600 text-left flex-1 pr-2 break-words">
                    {(realProgress as any)?.currentTask || currentTask}
                  </span>
                  <span className="text-sm font-bold text-blue-600 flex-shrink-0">
                    {Math.round((realProgress as any)?.progress || analysisProgress)}%
                  </span>
                </div>
                <Progress value={(realProgress as any)?.progress || analysisProgress} className="h-2" />
                {realProgress && (
                  <div className="text-xs text-gray-500 mt-2 text-center">
                    Step {(realProgress as any)?.currentStep || 1}/{(realProgress as any)?.totalSteps || 1} • Live Claude Analysis
                  </div>
                )}
              </div>
              
              <p className="text-xs text-gray-400">
                This may take a few moments for large document sets
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Check if we have enough documents
  if (!documents || documents.length < 2) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center">
            <BarChart3 className="h-5 w-5 mr-2" />
            Document Similarity Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 font-medium mb-2">Insufficient Documents</p>
              <p className="text-sm text-gray-500 mb-4">
                Upload at least 2 documents to enable similarity analysis
              </p>
              <p className="text-xs text-gray-400">
                Supported formats: PDF, DWG, DXF, IFC, RVT
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show analysis in progress if matrix is not ready
  if (!matrix) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center">
            <BarChart3 className="h-5 w-5 mr-2" />
            Document Similarity Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-96">
            <div className="text-center w-full max-w-md px-4">
              <div className="animate-pulse">
                <BarChart3 className="h-12 w-12 text-blue-400 mx-auto mb-4" />
              </div>
              <p className="text-gray-600 font-medium mb-2">Analysis In Progress</p>
              <p className="text-sm text-gray-500 mb-6">
                Claude AI analyzing {documents.length} documents for similarities and conflicts
              </p>
              
              {/* Real progress display */}
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm text-gray-600 text-left flex-1 pr-2 break-words">
                    {(realProgress as any)?.currentTask || 'Initializing analysis...'}
                  </span>
                  <span className="text-sm font-bold text-blue-600 flex-shrink-0">
                    {Math.round((realProgress as any)?.progress || 0)}%
                  </span>
                </div>
                <Progress value={(realProgress as any)?.progress || 0} className="h-2" />
                {realProgress && (
                  <div className="text-xs text-gray-500 mt-2 text-center">
                    Step {(realProgress as any)?.currentStep || 1}/{(realProgress as any)?.totalSteps || 1} • Live Claude Analysis
                  </div>
                )}
              </div>
              
              <Button 
                onClick={() => {
                  sessionStorage.clear();
                  localStorage.clear();
                  window.location.reload();
                }} 
                variant="outline" 
                size="sm"
                disabled={isRefetching}
                className="w-full"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
                Force Refresh
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Main analysis view with matrix data available
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center">
            <BarChart3 className="h-5 w-5 mr-2" />
            Document Similarity Analysis
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-sm">
              {matrix.documents?.length || documents.length} Documents
            </Badge>
            
            {/* Help Dialog */}
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <HelpCircle className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="flex items-center">
                    <Info className="h-5 w-5 mr-2 text-blue-600" />
                    Understanding Document Similarity Percentages
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <h3 className="font-semibold text-blue-900 mb-2">What do the percentages mean?</h3>
                    <p className="text-blue-800 text-sm">
                      The percentages show how much your construction documents overlap or conflict with each other. 
                      Think of it like comparing two shopping lists to see how many items are duplicated.
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="border rounded-lg p-3">
                      <div className="flex items-center mb-2">
                        <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
                        <span className="font-medium text-green-700">0% - 15%: Good</span>
                      </div>
                      <p className="text-sm text-gray-600">
                        Documents are mostly unique with minimal overlap. This is normal and healthy for a construction project.
                      </p>
                    </div>
                    
                    <div className="border rounded-lg p-3">
                      <div className="flex items-center mb-2">
                        <div className="w-3 h-3 bg-yellow-500 rounded-full mr-2"></div>
                        <span className="font-medium text-yellow-700">15% - 35%: Moderate</span>
                      </div>
                      <p className="text-sm text-gray-600">
                        Some overlapping information. May indicate coordination needed between different trades or phases.
                      </p>
                    </div>
                    
                    <div className="border rounded-lg p-3">
                      <div className="flex items-center mb-2">
                        <div className="w-3 h-3 bg-orange-500 rounded-full mr-2"></div>
                        <span className="font-medium text-orange-700">35% - 60%: High</span>
                      </div>
                      <p className="text-sm text-gray-600">
                        Significant overlap that could lead to confusion, redundant work, or conflicting instructions.
                      </p>
                    </div>
                    
                    <div className="border rounded-lg p-3">
                      <div className="flex items-center mb-2">
                        <div className="w-3 h-3 bg-red-500 rounded-full mr-2"></div>
                        <span className="font-medium text-red-700">60%+: Critical</span>
                      </div>
                      <p className="text-sm text-gray-600">
                        Major conflicts or duplication. Immediate attention needed to prevent costly mistakes.
                      </p>
                    </div>
                  </div>
                  
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h3 className="font-semibold text-gray-900 mb-2">Real Example:</h3>
                    <p className="text-sm text-gray-700 mb-2">
                      If your architectural drawings and electrical plans show <strong>12.5% overlap</strong>, it means:
                    </p>
                    <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
                      <li>12.5% of the content is discussing the same building elements</li>
                      <li>This could be things like wall locations, room dimensions, or equipment placement</li>
                      <li>It's normal for some overlap, but high percentages might indicate conflicting specifications</li>
                    </ul>
                  </div>
                  
                  <div className="bg-orange-50 p-4 rounded-lg">
                    <h3 className="font-semibold text-orange-900 mb-2">Types of Conflicts Detected:</h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><strong>Content:</strong> Same information in multiple docs</div>
                      <div><strong>Materials:</strong> Conflicting material specifications</div>
                      <div><strong>Compliance:</strong> Different code requirements</div>
                      <div><strong>Specifications:</strong> Contradictory technical details</div>
                      <div><strong>Schedule:</strong> Timeline conflicts</div>
                      <div><strong>Standards:</strong> Different building standards referenced</div>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isRefetching}
            >
              <RefreshCw className={`h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Similarity Score Legend - Always Visible */}
          <div className="bg-gradient-to-r from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-4 mb-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="font-semibold text-blue-900 mb-2 flex items-center">
                  <Info className="h-4 w-4 mr-2" />
                  Understanding Similarity Percentages
                </h3>
                <p className="text-sm text-blue-800 mb-3">
                  The percentages show how much your documents overlap or conflict. Think of it like comparing blueprints to find duplicated or conflicting information.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
                    <div>
                      <span className="font-medium">0-15%:</span> Good
                      <div className="text-gray-600">Minimal overlap</div>
                    </div>
                  </div>
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-yellow-500 rounded-full mr-2"></div>
                    <div>
                      <span className="font-medium">15-35%:</span> Moderate
                      <div className="text-gray-600">Coordination needed</div>
                    </div>
                  </div>
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-orange-500 rounded-full mr-2"></div>
                    <div>
                      <span className="font-medium">35-60%:</span> High
                      <div className="text-gray-600">Potential conflicts</div>
                    </div>
                  </div>
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-red-500 rounded-full mr-2"></div>
                    <div>
                      <span className="font-medium">60%+:</span> Critical
                      <div className="text-gray-600">Major conflicts</div>
                    </div>
                  </div>
                </div>
              </div>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="ml-2">
                    <HelpCircle className="h-4 w-4" />
                    <span className="ml-1">More Details</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle className="flex items-center">
                      <Info className="h-5 w-5 mr-2 text-blue-600" />
                      Complete Guide to Document Similarity
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <h3 className="font-semibold text-gray-900 mb-2">Real Example:</h3>
                      <p className="text-sm text-gray-700 mb-2">
                        If your architectural drawings and electrical plans show <strong>12.5% overlap</strong>, it means:
                      </p>
                      <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
                        <li>12.5% of the content is discussing the same building elements</li>
                        <li>This could be wall locations, room dimensions, or equipment placement</li>
                        <li>Some overlap is normal, but high percentages indicate potential conflicts</li>
                      </ul>
                    </div>
                    
                    <div className="bg-orange-50 p-4 rounded-lg">
                      <h3 className="font-semibold text-orange-900 mb-2">What 0% Really Means:</h3>
                      <p className="text-sm text-orange-800">
                        <strong>0% similarity</strong> means the documents have no overlapping content - they're discussing completely different aspects of your project. This is ideal between unrelated trades (e.g., landscaping vs. electrical).
                      </p>
                    </div>
                    
                    <div className="bg-red-50 p-4 rounded-lg">
                      <h3 className="font-semibold text-red-900 mb-2">When to Take Action:</h3>
                      <ul className="text-sm text-red-800 space-y-1 list-disc list-inside">
                        <li><strong>Above 35%:</strong> Review for conflicting specifications immediately</li>
                        <li><strong>Above 60%:</strong> Stop work and resolve conflicts before proceeding</li>
                        <li><strong>Multiple high scores:</strong> Consider a coordination meeting with all trades</li>
                      </ul>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Overall Score & Statistics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 text-center relative">
                <div className={`text-2xl font-bold ${
                  (matrix.overallScore || 0) < 15 ? 'text-green-600' :
                  (matrix.overallScore || 0) < 35 ? 'text-yellow-600' :
                  (matrix.overallScore || 0) < 60 ? 'text-orange-600' :
                  'text-red-600'
                }`}>
                  {matrix.overallScore?.toFixed(1) || '0.0'}%
                </div>
                <p className="text-sm text-gray-600">Overall Similarity</p>
                <div className="text-xs text-gray-500 mt-1">
                  {(matrix.overallScore || 0) < 15 ? 'Good - Minimal overlap' :
                   (matrix.overallScore || 0) < 35 ? 'Moderate - Review needed' :
                   (matrix.overallScore || 0) < 60 ? 'High - Conflicts likely' :
                   'Critical - Immediate action'}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">
                  {matrix.documents?.length || 0}
                </div>
                <p className="text-sm text-gray-600">Documents Analyzed</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-orange-600">
                  {matrix.similarities?.filter(s => s.criticalLevel === 'high' || s.criticalLevel === 'critical').length || 0}
                </div>
                <p className="text-sm text-gray-600">High Priority Issues</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-red-600">
                  {matrix.similarities?.reduce((acc, s) => acc + (s.overlapTypes?.length || (s.overlapType ? 1 : 0)), 0) || 0}
                </div>
                <p className="text-sm text-gray-600">Total Conflicts</p>
              </CardContent>
            </Card>
          </div>

          {/* Detailed Conflict Breakdown by Specialty */}
          {matrix.similarities && matrix.similarities.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center text-lg">
                  <AlertTriangle className="h-5 w-5 mr-2 text-orange-600" />
                  Conflict Analysis by Specialty & Code Type
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Specialty Breakdown */}
                  <div>
                    <h4 className="font-medium text-gray-900 mb-3">By Construction Specialty</h4>
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                      {['content', 'specifications', 'materials', 'compliance', 'schedule'].map(type => {
                        const conflicts = matrix.similarities?.filter(s => 
                          (s.overlapTypes && s.overlapTypes.includes(type as any)) || 
                          s.overlapType === type
                        ) || [];
                        const avgScore = conflicts.length > 0 ? (conflicts.reduce((acc, s) => acc + s.similarityScore, 0) / conflicts.length) : 0;
                        const criticalCount = conflicts.filter(c => c.criticalLevel === 'high' || c.criticalLevel === 'critical').length;
                        
                        const typeDescriptions: Record<string, string> = {
                          'content': 'Duplicate information',
                          'specifications': 'Conflicting specs',
                          'materials': 'Material conflicts',
                          'compliance': 'Code violations',
                          'schedule': 'Timeline conflicts'
                        };
                        
                        return (
                          <div key={type} className={`p-3 border rounded-lg text-center ${
                            avgScore > 50 ? 'bg-red-50 border-red-200' : 
                            avgScore > 25 ? 'bg-orange-50 border-orange-200' : 
                            'bg-green-50 border-green-200'
                          }`}>
                            <div className={`text-lg font-bold ${
                              avgScore > 50 ? 'text-red-600' : 
                              avgScore > 25 ? 'text-orange-600' : 
                              'text-green-600'
                            }`}>
                              {avgScore.toFixed(1)}%
                            </div>
                            <div className="text-sm font-medium capitalize">{type}</div>
                            <div className="text-xs text-gray-500">{typeDescriptions[type]}</div>
                            <div className="text-xs text-gray-600 mt-1">
                              {conflicts.length === 0 ? 'No conflicts' : 
                               conflicts.length === 1 ? '1 conflict' : 
                               `${conflicts.length} conflicts`}
                            </div>
                            {criticalCount > 0 && (
                              <div className="text-xs text-red-600 font-medium mt-1">
                                <AlertCircle className="h-3 w-3 inline mr-1" />
                                {criticalCount} critical
                              </div>
                            )}
                            <div className="text-xs text-gray-400 mt-1">
                              {avgScore === 0 ? 'Documents are independent' :
                               avgScore < 15 ? 'Normal overlap' :
                               avgScore < 35 ? 'Review recommended' :
                               'Action required'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Code & Standard Types */}
                  <div>
                    <h4 className="font-medium text-gray-900 mb-3">Conflict Types Detected</h4>
                    <div className="flex flex-wrap gap-2">
                      {Array.from(new Set([
                        ...matrix.similarities?.flatMap(s => s.overlapTypes || []) || [],
                        ...matrix.similarities?.map(s => s.overlapType).filter(Boolean) || []
                      ])).map(type => {
                        const count = matrix.similarities?.filter(s => 
                          type && ((s.overlapTypes && s.overlapTypes.includes(type)) || s.overlapType === type)
                        ).length || 0;
                        const avgSeverity = matrix.similarities?.filter(s => 
                          type && ((s.overlapTypes && s.overlapTypes.includes(type)) || s.overlapType === type)
                        ).reduce((acc, s, _, arr) => acc + (s.criticalLevel === 'critical' ? 4 : s.criticalLevel === 'high' ? 3 : s.criticalLevel === 'medium' ? 2 : 1) / arr.length, 0) || 1;
                        
                        return (
                          <Badge 
                            key={type} 
                            variant={avgSeverity >= 3 ? 'destructive' : avgSeverity >= 2 ? 'secondary' : 'outline'}
                            className="text-sm"
                          >
                            {type ? (type.charAt(0).toUpperCase() + type.slice(1)) : 'Unknown'} ({count})
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Risk Areas */}
          {matrix.riskAreas && matrix.riskAreas.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-gray-900">Risk Areas Identified</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {matrix.riskAreas.map((risk, index) => (
                  <div key={index} className="flex items-start gap-3 p-3 bg-orange-50 rounded-lg">
                    <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-orange-900">{risk}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {matrix.recommendations && matrix.recommendations.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-gray-900">Recommendations</h3>
              <div className="space-y-2">
                {matrix.recommendations.map((rec, index) => (
                  <div key={index} className="flex items-start gap-3 p-3 bg-green-50 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-green-900">{rec}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Detailed Document Conflict Analysis */}
          {matrix.similarities && matrix.similarities.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <FileText className="h-5 w-5 mr-2" />
                  Detailed Conflict Analysis ({matrix.similarities.length} comparisons)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {matrix.similarities.slice(0, 15).map((sim) => (
                    <div key={sim.id} className={`border rounded-lg p-4 ${
                      sim.criticalLevel === 'critical' ? 'border-red-300 bg-red-50' :
                      sim.criticalLevel === 'high' ? 'border-orange-300 bg-orange-50' :
                      sim.criticalLevel === 'medium' ? 'border-yellow-300 bg-yellow-50' :
                      'border-gray-200 bg-gray-50'
                    }`}>
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <h4 className="font-medium text-sm flex items-center">
                            {sim.criticalLevel === 'critical' && <AlertCircle className="h-4 w-4 text-red-600 mr-1" />}
                            {sim.criticalLevel === 'high' && <AlertTriangle className="h-4 w-4 text-orange-600 mr-1" />}
                            {sim.documentAName} ↔ {sim.documentBName}
                          </h4>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <Badge variant={sim.criticalLevel === 'high' || sim.criticalLevel === 'critical' ? 'destructive' : 'secondary'}>
                            {sim.similarityScore.toFixed(1)}% overlap
                          </Badge>
                          <Badge variant="outline" className="capitalize">
                            {sim.criticalLevel}
                          </Badge>
                        </div>
                      </div>
                      
                      {/* Project-Specific Context for this Similarity Score */}
                      <div className="mb-3">
                        <div className="bg-blue-50 border border-blue-200 rounded p-2">
                          <p className="text-xs text-blue-800 font-medium mb-1">
                            📊 What {sim.similarityScore.toFixed(1)}% means for your project:
                          </p>
                          <p className="text-xs text-blue-700">
                            {sim.similarityScore < 5 
                              ? `These documents have minimal overlap (${sim.similarityScore.toFixed(1)}%). This usually means they cover different aspects of construction - which is good for project organization.`
                              : sim.similarityScore < 15
                              ? `Low overlap (${sim.similarityScore.toFixed(1)}%) indicates these documents complement each other with some shared elements like dimensions or materials.`
                              : sim.similarityScore < 35
                              ? `Moderate overlap (${sim.similarityScore.toFixed(1)}%) suggests these documents address similar building components. Check for any conflicting specifications.`
                              : `High overlap (${sim.similarityScore.toFixed(1)}%) means significant content duplication. This could indicate conflicting requirements or redundant information.`
                            }
                          </p>
                        </div>
                      </div>

                      {/* Detailed Conflict Description */}
                      <div className="mb-3">
                        <p className="text-sm text-gray-700 font-medium mb-1">Analysis Details:</p>
                        <p className="text-sm text-gray-600">{sim.details || sim.conflictDescription || 'No specific conflict description available'}</p>
                      </div>

                      {/* Overlap Types with Icons */}
                      {((sim.overlapTypes && sim.overlapTypes.length > 0) || sim.overlapType) && (
                        <div className="mb-3">
                          <p className="text-sm text-gray-700 font-medium mb-2">Affected Areas:</p>
                          <div className="flex flex-wrap gap-2">
                            {(sim.overlapTypes || [sim.overlapType].filter(Boolean)).map((type) => (
                              <Badge key={type} variant="outline" className="text-xs flex items-center">
                                {type === 'compliance' && <AlertTriangle className="h-3 w-3 mr-1" />}
                                {type === 'specifications' && <FileText className="h-3 w-3 mr-1" />}
                                {type === 'materials' && <Activity className="h-3 w-3 mr-1" />}
                                {type === 'schedule' && <Eye className="h-3 w-3 mr-1" />}
                                {type === 'content' && <ZoomIn className="h-3 w-3 mr-1" />}
                                {type!.charAt(0).toUpperCase() + type!.slice(1)}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Recommendations */}
                      {sim.recommendations && sim.recommendations.length > 0 && (
                        <div>
                          <p className="text-sm text-gray-700 font-medium mb-1">Recommendations:</p>
                          <ul className="text-sm text-gray-600 space-y-1">
                            {sim.recommendations.slice(0, 3).map((rec, idx) => (
                              <li key={idx} className="flex items-start">
                                <CheckCircle className="h-3 w-3 text-green-600 mr-1 mt-0.5 flex-shrink-0" />
                                {rec}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                  
                  {matrix.similarities.length > 15 && (
                    <div className="text-center p-4 text-gray-500 text-sm">
                      Showing top 15 conflicts. {matrix.similarities.length - 15} more conflicts detected.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Last analyzed timestamp */}
          <div className="text-xs text-gray-500 text-center pt-4 border-t">
            Last analyzed: {matrix.lastAnalyzed ? new Date(matrix.lastAnalyzed).toLocaleString() : 'Unknown'}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}