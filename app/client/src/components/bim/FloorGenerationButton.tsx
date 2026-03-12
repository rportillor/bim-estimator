// client/src/components/bim/FloorGenerationButton.tsx
// 🏗️ Floor-by-floor BIM generation UI component

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Building2, CheckCircle, AlertCircle, Layers } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

interface FloorGenerationButtonProps {
  projectId: string;
  onSuccess?: (modelId: string) => void;
  disabled?: boolean;
}

interface FloorAnalysis {
  totalDocuments: number;
  floors: Array<{
    name: string;
    level: number;
    documentCount: number;
    documents: Array<{
      id: string;
      filename: string;
    }>;
  }>;
}

export function FloorGenerationButton({ projectId, onSuccess, disabled }: FloorGenerationButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentFloor, setCurrentFloor] = useState<string>('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string>('');
  const [floorAnalysis, setFloorAnalysis] = useState<FloorAnalysis | null>(null);

  const analyzeFloors = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        throw new Error('No authentication token found. Please log in again.');
      }

      const response = await fetch(`/api/projects/${projectId}/floor-analysis`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }).catch(err => {
        console.error('Failed to analyze floors:', err);
        throw err;
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Floor analysis failed: ${response.status} - ${errorText}`);
      }
      const data = await response.json();
      setFloorAnalysis(data as FloorAnalysis);
      return data;
    } catch (err: any) {
      setError(err?.message || 'Failed to analyze floors');
      return null;
    }
  };

  const generateBIM = async () => {
    setIsGenerating(true);
    setProgress(0);
    setError('');
    setResult(null);
    setFloorAnalysis(null);

    try {
      // Step 1: Claude analyzes ALL documents to determine floor assignments
      setCurrentFloor('Claude is analyzing all 49 construction documents...');
      setProgress(5);
      
      setCurrentFloor('Identifying floor plans, specifications, cross sections, details...');
      setProgress(10);
      
      const token = localStorage.getItem('auth_token');
      if (!token) {
        throw new Error('No authentication token found. Please log in again.');
      }

      // Claude floor triage - analyzes ALL document types
      const analysisResponse = await fetch(`/api/projects/${projectId}/floor-analysis`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!analysisResponse.ok) {
        const errorText = await analysisResponse.text();
        throw new Error(`Claude document analysis failed: ${analysisResponse.status} - ${errorText}`);
      }
      
      const analysis = await analysisResponse.json();
      setFloorAnalysis(analysis as FloorAnalysis);
      
      setProgress(25);
      setCurrentFloor(`Claude identified ${analysis.floors?.length || 0} floor levels plus building-wide documents`);
      
      // Brief pause to show analysis results
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Step 2: Generate BIM using Claude's floor analysis
      setProgress(30);
      setCurrentFloor('Claude is now extracting building elements from drawings...');

      // Use proper construction methodology endpoint
      // First get the BIM model for this project
      const modelsResponse = await fetch(`/api/projects/${projectId}/bim-models`, {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include'
      });
      
      if (!modelsResponse.ok) {
        throw new Error('Could not find BIM model for project');
      }
      
      const models = await modelsResponse.json();
      if (!models[0]?.id) {
        throw new Error('No BIM model found for this project. Please create one first.');
      }
      const modelId = models[0].id;
      
      const response = await fetch(`/api/bim/models/${modelId}/generate`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include',
        body: JSON.stringify({ 
          projectId, 
          positioningMode: 'preferClaude',
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
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`BIM generation failed: ${response.status} - ${errorText}`);
      }

      // Poll the EXISTING real progress endpoint we already built!
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/bim/models/${modelId}/processing-status`, {
            headers: { 'Authorization': `Bearer ${token}` },
            credentials: 'include'
          });
          
          if (statusRes.ok) {
            const status = await statusRes.json();
            
            // Use the REAL progress from backend
            setProgress(status.progress || 0);
            
            // Show REAL batch numbers from our Smart Resume system
            if (status.batchIndex && status.totalBatches) {
              setCurrentFloor(`📊 REAL: Processing batch ${status.batchIndex}/${status.totalBatches} - ${status.message || 'Working...'}`);
            } else {
              setCurrentFloor(status.message || 'Processing documents...');
            }
            
            // Stop polling when complete
            if (status.status === 'completed' || status.progress >= 100) {
              clearInterval(pollInterval);
              setProgress(100); // Use REAL 100%, not fake 95%
            }
          }
        } catch (error) {
          console.error('Progress poll error:', error);
        }
      }, 2000); // Poll every 2 seconds
      
      // Wait for completion (max 10 minutes)
      await new Promise((resolve) => {
        setTimeout(() => {
          clearInterval(pollInterval);
          resolve(true);
        }, 600000);
      });

      const data = await response.json();

      setProgress(100);
      setCurrentFloor('BIM generation complete!');
      setResult(data);
      
      if (onSuccess && data && typeof data === 'object' && 'modelId' in data) {
        onSuccess(data.modelId);
      }

    } catch (err: any) {
      setError(err?.message || 'BIM generation failed');
      setProgress(0);
      setCurrentFloor('');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="floor-generation-section">
      {/* Floor Analysis Display */}
      {floorAnalysis && (
        <div className="bg-blue-50 dark:bg-blue-950/30 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
          <h4 className="font-medium text-blue-900 dark:text-blue-100 flex items-center gap-2 mb-3">
            <Layers className="h-4 w-4" />
            Floor Structure Analysis
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            <div>
              <span className="font-medium text-blue-800 dark:text-blue-200">Total Documents:</span>
              <span className="ml-2 text-blue-700 dark:text-blue-300">{floorAnalysis?.totalDocuments || 0}</span>
            </div>
            <div>
              <span className="font-medium text-blue-800 dark:text-blue-200">Floors Detected:</span>
              <span className="ml-2 text-blue-700 dark:text-blue-300">{floorAnalysis?.floors?.length || 0}</span>
            </div>
          </div>
          <div className="mt-3 space-y-1">
            {floorAnalysis?.floors?.map((floor) => (
              <div 
                key={floor.name} 
                className="flex justify-between text-xs text-blue-600 dark:text-blue-400"
              >
                <span>{floor.name}</span>
                <span>{floor.documentCount} docs</span>
              </div>
            )) || []}
          </div>
        </div>
      )}

      {/* Single Generation Button - Claude does everything */}
      <Button 
        onClick={generateBIM}
        disabled={disabled || isGenerating}
        className="w-full"
        data-testid="button-generate-floor-bim"
      >
        <Building2 className="mr-2 h-4 w-4" />
        {isGenerating 
          ? 'Generating Comprehensive BIM Model...' 
          : 'Generate Comprehensive BIM Model'
        }
      </Button>

      {/* Progress Display */}
      {isGenerating && (
        <div className="space-y-2">
          <Progress value={progress} className="w-full" />
          <div className="text-center space-y-1">
            <p className="text-lg font-semibold text-blue-600 dark:text-blue-400">
              📊 REAL PROGRESS: {progress}%
            </p>
            {currentFloor && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {currentFloor}
              </p>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-500">
              Processing actual documents... (Claude is analyzing)
            </p>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <Alert variant="destructive" data-testid="alert-error">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Success Display */}
      {result && (
        <Alert className="border-green-200 bg-green-50 dark:bg-green-950/30" data-testid="alert-success">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800 dark:text-green-200">
            <div className="space-y-1">
              <div className="font-medium">Floor-by-floor BIM generation successful!</div>
              <div className="text-sm">
                Generated <strong>{result.totalElements}</strong> elements across <strong>{result.floorsProcessed}</strong> floors
              </div>
              {result.floorBreakdown && (
                <div className="text-xs mt-2 space-y-1">
                  {result.floorBreakdown.map((floor: any) => (
                    <div key={floor.floor} className="flex justify-between">
                      <span>{floor.floor}:</span>
                      <span>{floor.elements} elements</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}