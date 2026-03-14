import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Clock,
  DollarSign,
  FileText,
  TrendingUp,
  TrendingDown,
  Zap,
  AlertTriangle,
  CheckCircle,
  ArrowRight,
  RefreshCw
} from 'lucide-react';

interface AnalysisResult {
  id: string;
  analysisType: string;
  revisionId: string;
  overallScore: string | null;
  documentCount: number;
  summary: string | null;
  riskAreas: string[];
  recommendations: string[];
  claudeTokensUsed: number | null;
  processingTime: number | null;
  documentsProcessed: string[];
  documentsSkipped: string[];
  changedDocuments: string[];
  changesSummary: string | null;
  createdAt: string;
}

interface RevisionComparisonProps {
  projectId: string;
  analysisType: 'similarity' | 'compliance' | 'boq';
}

export function RevisionComparison({ projectId, analysisType }: RevisionComparisonProps) {
  const [selectedRevisions, setSelectedRevisions] = useState<{
    baseline?: string;
    comparison?: string;
  }>({});

  // Fetch analysis history
  const { data: analysisHistory, isLoading } = useQuery<AnalysisResult[]>({
    queryKey: ['/api/analysis/history', projectId, analysisType],
    queryFn: async () => {
      const response = await apiRequest('GET', `/api/analysis/history?projectId=${projectId}&analysisType=${analysisType}`);
      return await response.json();
    }
  });

  // Fetch comparison data when both revisions are selected
  const { data: comparisonData, isLoading: isComparing } = useQuery<{
    scoreChange: number;
    documentCountChange: number;
    newRiskAreas: string[];
    resolvedRiskAreas: string[];
    tokensSaved: number;
    timeDifference: number;
  }>({
    queryKey: ['/api/analysis/compare', selectedRevisions.baseline, selectedRevisions.comparison],
    queryFn: async () => {
      const response = await apiRequest('GET', `/api/analysis/compare?baseline=${selectedRevisions.baseline}&comparison=${selectedRevisions.comparison}`);
      return await response.json();
    },
    enabled: !!(selectedRevisions.baseline && selectedRevisions.comparison)
  });

  if (isLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center space-x-2">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <CardTitle>Loading Analysis History...</CardTitle>
          </div>
        </CardHeader>
      </Card>
    );
  }

  if (!analysisHistory || analysisHistory.length < 2) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          At least 2 analysis runs are required for revision comparison. 
          Run another analysis to enable cost-efficient comparison tracking.
        </AlertDescription>
      </Alert>
    );
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getTokensSavedColor = (saved: number) => {
    if (saved > 1000) return 'text-green-600';
    if (saved > 0) return 'text-blue-600';
    return 'text-gray-600';
  };

  return (
    <div className="space-y-6" data-testid="revision-comparison">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Zap className="h-5 w-5 text-blue-600" />
            <span>Cost-Efficient Revision Comparison</span>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Compare analysis revisions and track Claude token savings through smart caching
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Baseline Analysis</label>
              <Select 
                value={selectedRevisions.baseline} 
                onValueChange={(value) => setSelectedRevisions(prev => ({ ...prev, baseline: value }))}
                data-testid="select-baseline-revision"
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select baseline analysis..." />
                </SelectTrigger>
                <SelectContent>
                  {analysisHistory.map((analysis: AnalysisResult) => (
                    <SelectItem key={analysis.id} value={analysis.id}>
                      <div className="flex flex-col">
                        <span className="font-medium">{analysis.revisionId}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(analysis.createdAt)} • Score: {analysis.overallScore || 'N/A'}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Comparison Analysis</label>
              <Select 
                value={selectedRevisions.comparison} 
                onValueChange={(value) => setSelectedRevisions(prev => ({ ...prev, comparison: value }))}
                data-testid="select-comparison-revision"
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select comparison analysis..." />
                </SelectTrigger>
                <SelectContent>
                  {analysisHistory
                    .filter((analysis: AnalysisResult) => analysis.id !== selectedRevisions.baseline)
                    .map((analysis: AnalysisResult) => (
                    <SelectItem key={analysis.id} value={analysis.id}>
                      <div className="flex flex-col">
                        <span className="font-medium">{analysis.revisionId}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(analysis.createdAt)} • Score: {analysis.overallScore || 'N/A'}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {comparisonData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* Score Change */}
          <Card data-testid="card-score-change">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Score Change</p>
                  <div className="flex items-center space-x-2 mt-1">
                    {comparisonData.scoreChange > 0 ? (
                      <TrendingUp className="h-4 w-4 text-green-600" />
                    ) : comparisonData.scoreChange < 0 ? (
                      <TrendingDown className="h-4 w-4 text-red-600" />
                    ) : (
                      <ArrowRight className="h-4 w-4 text-gray-600" />
                    )}
                    <span className={`text-2xl font-bold ${getScoreColor(Math.abs(comparisonData.scoreChange))}`}>
                      {comparisonData.scoreChange > 0 ? '+' : ''}{comparisonData.scoreChange.toFixed(1)}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Documents Changed */}
          <Card data-testid="card-documents-changed">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Document Changes</p>
                  <div className="flex items-center space-x-2 mt-1">
                    <FileText className="h-4 w-4 text-blue-600" />
                    <span className="text-2xl font-bold">{Math.abs(comparisonData.documentCountChange)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {comparisonData.documentCountChange > 0 ? 'Added' : comparisonData.documentCountChange < 0 ? 'Removed' : 'No change'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tokens Saved */}
          <Card data-testid="card-tokens-saved">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Claude Tokens Saved</p>
                  <div className="flex items-center space-x-2 mt-1">
                    <DollarSign className="h-4 w-4 text-green-600" />
                    <span className={`text-2xl font-bold ${getTokensSavedColor(comparisonData.tokensSaved)}`}>
                      {comparisonData.tokensSaved.toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    ~${(comparisonData.tokensSaved * 0.00015).toFixed(2)} saved
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Processing Time */}
          <Card data-testid="card-processing-time">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Time Difference</p>
                  <div className="flex items-center space-x-2 mt-1">
                    <Clock className="h-4 w-4 text-orange-600" />
                    <span className="text-2xl font-bold">{Math.abs(comparisonData.timeDifference)}s</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {comparisonData.timeDifference < 0 ? 'Faster' : 'Slower'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {comparisonData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Risk Areas Changes */}
          <Card data-testid="card-risk-areas">
            <CardHeader>
              <CardTitle className="text-lg">Risk Area Changes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {comparisonData.newRiskAreas && comparisonData.newRiskAreas.length > 0 && (
                <div>
                  <h4 className="font-medium text-red-600 mb-2">🚨 New Risk Areas</h4>
                  <div className="space-y-1">
                    {comparisonData.newRiskAreas.map((risk: string, index: number) => (
                      <Badge key={index} variant="destructive" className="mr-2 mb-2">
                        {risk}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {comparisonData.resolvedRiskAreas && comparisonData.resolvedRiskAreas.length > 0 && (
                <div>
                  <h4 className="font-medium text-green-600 mb-2">✅ Resolved Risk Areas</h4>
                  <div className="space-y-1">
                    {comparisonData.resolvedRiskAreas.map((risk: string, index: number) => (
                      <Badge key={index} variant="outline" className="text-green-600 border-green-600 mr-2 mb-2">
                        {risk}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {(!comparisonData.newRiskAreas?.length && !comparisonData.resolvedRiskAreas?.length) && (
                <div className="text-center py-6 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-2 text-green-600" />
                  <p>No significant risk area changes detected</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cost Efficiency Summary */}
          <Card data-testid="card-efficiency-summary">
            <CardHeader>
              <CardTitle className="text-lg">Cost Efficiency Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Smart Caching Enabled</span>
                  <CheckCircle className="h-4 w-4 text-green-600" />
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm">Incremental Analysis</span>
                  <CheckCircle className="h-4 w-4 text-green-600" />
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm">Change Detection</span>
                  <CheckCircle className="h-4 w-4 text-green-600" />
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Estimated Cost Savings</span>
                    <span className="font-medium text-green-600">
                      ${(comparisonData.tokensSaved * 0.00015).toFixed(2)}
                    </span>
                  </div>
                  
                  <div className="flex justify-between text-sm">
                    <span>Processing Efficiency</span>
                    <span className="font-medium text-blue-600">
                      {comparisonData.timeDifference < 0 ? 
                        `${Math.abs(comparisonData.timeDifference)}s faster` : 
                        'Optimized'
                      }
                    </span>
                  </div>

                  <Progress 
                    value={Math.min(100, (comparisonData.tokensSaved / 10000) * 100)} 
                    className="mt-2"
                  />
                  <p className="text-xs text-muted-foreground">
                    Token efficiency: {Math.min(100, (comparisonData.tokensSaved / 10000) * 100).toFixed(1)}%
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {selectedRevisions.baseline && selectedRevisions.comparison && !comparisonData && isComparing && (
        <Card>
          <CardContent className="flex items-center justify-center py-8">
            <div className="flex items-center space-x-2">
              <RefreshCw className="h-5 w-5 animate-spin" />
              <span>Generating cost-efficient comparison...</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}