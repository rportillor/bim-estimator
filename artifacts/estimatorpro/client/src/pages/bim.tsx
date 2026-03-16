import { useState } from "react";
import { useParams , Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import BimViewer from "@/components/bim/bim-viewer";
import { FloorGenerationButton } from "@/components/bim/FloorGenerationButton";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Layers, Eye, Download, ArrowLeft, Building, Zap, AlertTriangle, Grid } from "lucide-react";
import { MissingDataDialog } from "@/components/dialogs/MissingDataDialog";
import { GridConfirmationDialog } from "@/components/bim/GridConfirmationDialog";
import { CandidateReviewPanel } from "@/components/pipeline/CandidateReviewPanel";

export default function BIM() {
  const params = useParams();
  const projectId = params.projectId;
  const modelId = params.modelId;
  const [showMissingData, setShowMissingData] = useState(false);
  const [showGridConfig, setShowGridConfig] = useState(false);
  const [showCandidateReview, setShowCandidateReview] = useState(false);

  // Fetch project details if projectId is provided
  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['/api/projects', projectId],
    enabled: !!projectId
  });

  // Fetch all projects if no specific projectId is selected
  const { data: allProjects, isLoading: allProjectsLoading } = useQuery({
    queryKey: ['/api/projects'],
    enabled: !projectId
  });

  // Fetch BIM models for the project
  const { data: bimModels = [], isLoading: modelsLoading } = useQuery<any[]>({
    queryKey: ['/api/projects', projectId, 'bim-models'],
    enabled: !!projectId
  });

  const activeModel = modelId 
    ? bimModels?.find((model: any) => model.id === modelId)
    : bimModels?.find((model: any) => (model.status === 'ready' || model.status === 'completed') && model.elementCount > 0) 
      || bimModels?.filter((m: any) => m.status === 'completed')?.sort((a: any, b: any) => (b.elementCount || 0) - (a.elementCount || 0))?.[0] 
      || bimModels?.[0]; // Prioritize largest completed model

  // Debug logging
  if (modelId && bimModels?.length > 0) {
    console.log('🏗️ BIM Debug:', { 
      modelId, 
      activeModel: activeModel?.name, 
      status: activeModel?.status,
      elementCount: activeModel?.elementCount 
    });
  }

  if (projectLoading || modelsLoading || (!projectId && allProjectsLoading)) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Loading BIM viewer...</p>
        </div>
      </div>
    );
  }

  if (projectId && !project) {
    return (
      <div className="p-6">
        <Alert>
          <AlertDescription>Project not found or you don't have access to it.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <header className="bg-white p-3 sm:p-6 border-b flex-shrink-0">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-4">
            {projectId && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="flex-shrink-0"
                onClick={() => window.history.back()}
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Back</span>
                <span className="sm:hidden">Back</span>
              </Button>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="text-lg sm:text-3xl font-bold text-gray-900 truncate">
                {project && typeof project === 'object' && 'name' in project && project.name ? `${project.name} - BIM Viewer` : '3D BIM Viewer'}
              </h2>
              <p className="text-gray-600 mt-1 text-xs sm:text-base truncate">
                {activeModel 
                  ? `Viewing: ${activeModel.name}`
                  : 'Interactive 3D model generated from your drawings'
                }
              </p>
            </div>
          </div>
          <div className="flex gap-2 sm:gap-3 overflow-x-auto">
            {/* Enhanced Model Management */}
            {bimModels && bimModels.length > 0 && (
              <div className="flex items-center gap-2 bg-blue-50 px-3 py-1 rounded-lg border border-blue-200">
                <Building className="h-4 w-4 text-blue-600" />
                <span className="text-xs font-medium text-blue-800">Models: {bimModels.length}</span>
                {bimModels.length > 1 && (
                  <select 
                    value={activeModel?.id || ''} 
                    onChange={(e) => {
                      const selectedModelId = e.target.value;
                      if (selectedModelId && projectId) {
                        window.location.href = `/projects/${projectId}/bim/${selectedModelId}`;
                      }
                    }}
                    className="px-2 py-1 text-xs border border-blue-300 rounded bg-white flex-shrink-0 min-w-32"
                  >
                    {bimModels.map((model: any, index: number) => {
                      const date = new Date(model.created_at || model.createdAt).toLocaleDateString();
                      const time = new Date(model.created_at || model.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                      return (
                        <option key={model.id} value={model.id}>
                          Model {index + 1} ({date} {time})
                        </option>
                      );
                    })}
                  </select>
                )}
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    if (projectId) {
                      window.location.href = `/projects/${projectId}/estimate`;
                    }
                  }}
                  className="text-xs px-2 py-1 h-6 bg-green-50 border-green-300 text-green-700 hover:bg-green-100"
                  title="Generate new model"
                >
                  + New
                </Button>
              </div>
            )}
            
            {/* Model Actions */}
            {activeModel && (
              <div className="flex items-center gap-1 bg-gray-50 px-2 py-1 rounded border border-gray-200">
                <Button 
                  variant="outline" 
                  size="sm"
                  disabled={activeModel?.status === 'generating' || activeModel?.status === 'processing'}
                  onClick={async () => {
                    if (activeModel?.status === 'generating' || activeModel?.status === 'processing') {
                      alert('Model is already being generated. Please wait for it to complete.');
                      return;
                    }
                    if (activeModel?.id && confirm('Regenerate this BIM model with latest settings?')) {
                      try {
                        // Use proper construction methodology for regeneration
                        const token = localStorage.getItem('auth_token');
                        const response = await fetch(`/api/bim/models/${activeModel.id}/generate`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                          credentials: 'include',
                          body: JSON.stringify({ 
                            projectId: projectId || activeModel.projectId,
                            positioningMode: 'preferClaude'
                          })
                        }).catch(err => {
                          console.error('Failed to regenerate:', err);
                          throw err;
                        });
                        if (response.ok) {
                          alert('Regenerating using construction methodology: specs→products→assemblies→elements');
                          window.location.reload();
                        }
                      } catch {
                        alert('Regeneration must use construction methodology. Use the Generate button to create elements properly.');
                      }
                    }
                  }}
                  className="text-xs px-2 py-1 h-6 bg-orange-50 border-orange-300 text-orange-700 hover:bg-orange-100"
                  title={activeModel?.status === 'generating' ? 'Model is currently generating...' : 'Regenerate current model'}
                >
                  {activeModel?.status === 'generating' ? (
                    <><span className="animate-spin inline-block">⟳</span> Generating...</>
                  ) : (
                    <>⟳ Regen</>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={activeModel?.status === 'generating' || activeModel?.status === 'processing'}
                  onClick={async () => {
                    if (!projectId) return;
                    if (!confirm('Start full sequential pipeline?\n\nThis will:\n1. Extract schedules (door/window sizes)\n2. Extract sections (wall/slab assemblies)\n3. Extract specifications (materials)\n4. Extract grid (you will confirm)\n5. Place elements with real dimensions\n\nExisting elements will be replaced. Uses Claude API credits.')) return;
                    try {
                      const token = localStorage.getItem('auth_token');
                      const resp = await fetch(`/api/bim/pipeline/${projectId}/start`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                      });
                      if (resp.ok) {
                        const data = await resp.json();
                        alert(`Pipeline started (Model: ${data.modelId}). Check status in the console.\n\nThe pipeline will pause at grid confirmation — you will need to confirm the grid before elements are placed.`);
                        window.location.reload();
                      } else {
                        const err = await resp.json().catch(() => ({ message: 'Unknown error' }));
                        alert(`Failed to start pipeline: ${err.message}`);
                      }
                    } catch (e) { alert(`Failed: ${(e as Error).message}`); }
                  }}
                  className="text-xs px-2 py-1 h-6 bg-green-50 border-green-300 text-green-700 hover:bg-green-100"
                  title="Run the full 5-stage sequential pipeline: Schedules → Sections → Specs → Grid → Floor Plans"
                >
                  Pipeline
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCandidateReview(true)}
                  className="text-xs px-2 py-1 h-6 hover:bg-purple-100 border-purple-300 text-purple-700"
                  title="Review unresolved pipeline candidates and fill missing values"
                >
                  Review
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowGridConfig(true)}
                  className="text-xs px-2 py-1 h-6 hover:bg-blue-100 border-blue-300 text-blue-700"
                  data-testid="button-grid-config"
                  title="Configure grid coordinate system"
                >
                  <Grid className="h-3 w-3 mr-1" />
                  Grid
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const event = new CustomEvent('toggleLayers', { detail: { modelId: activeModel?.id } });
                    window.dispatchEvent(event);
                  }}
                  className="text-xs px-2 py-1 h-6 hover:bg-gray-100"
                  data-testid="button-layers"
                  title="Toggle layer visibility"
                >
                  <Layers className="h-3 w-3 mr-1" />
                  Layers
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    const event = new CustomEvent('cycleViewMode', { detail: { modelId: activeModel?.id } });
                    window.dispatchEvent(event);
                  }}
                  className="text-xs px-2 py-1 h-6 hover:bg-gray-100"
                  data-testid="button-view-options"
                  title="Change viewing mode"
                >
                  <Eye className="h-3 w-3 mr-1" />
                  View
                </Button>
              </div>
            )}
            <Button 
              size="sm"
              onClick={async () => {
                if (!activeModel?.id) {
                  alert('No active model to export');
                  return;
                }
                try {
                  const token = localStorage.getItem('auth_token');
                  const response = await fetch(`/api/bim-models/${activeModel.id}/ifc`, {
                    headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                    credentials: 'include'
                  }).catch(err => {
                    console.error('Failed to fetch IFC:', err);
                    throw err;
                  });
                  if (response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${activeModel.name || 'model'}.ifc`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                  } else {
                    alert('Export failed. Please try again.');
                  }
                } catch {
                  alert('Export failed. Please try again.');
                }
              }}
              className="bg-primary text-white hover:bg-blue-700 flex-shrink-0"
              data-testid="button-export-ifc"
              title="Download IFC file"
            >
              <Download className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Export IFC</span>
            </Button>
            {/* Missing Data Resolution — "No Default Values" principle */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowMissingData(true)}
              className="border-amber-300 text-amber-700 hover:bg-amber-50 flex-shrink-0"
              title="Review and resolve missing data gaps"
            >
              <AlertTriangle className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Missing Data</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!projectId) return;
                if (!confirm('Clear cached analysis and re-run Claude with updated prompts? This will use API credits.')) return;
                try {
                  const token = localStorage.getItem('auth_token');
                  const resp = await fetch(`/api/projects/${projectId}/clear-analysis-cache`, {
                    method: 'POST',
                    headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
                  });
                  if (resp.ok) {
                    const data = await resp.json();
                    alert(`${data.message}\n\nClick "Regen" to start fresh analysis.`);
                  } else {
                    alert('Failed to clear cache.');
                  }
                } catch { alert('Failed to clear cache.'); }
              }}
              className="border-red-300 text-red-700 hover:bg-red-50 flex-shrink-0 text-xs px-2 py-1 h-6"
              title="Clear cached Claude analysis — next regeneration will re-analyze all documents"
            >
              <Zap className="h-3 w-3 mr-1" />
              <span className="hidden sm:inline">Re-analyze</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1">
        {!projectId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-2xl">
              <div className="w-16 h-16 bg-blue-200 rounded-lg mx-auto mb-4 flex items-center justify-center">
                <Building className="h-8 w-8 text-blue-600" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Project for BIM Visualization</h3>
              <p className="text-gray-600 mb-6">
                Choose one of your projects to view and generate 3D BIM models with professional quantity take-offs.
              </p>
              
              {/* Project Selection Grid */}
              {allProjects && Array.isArray(allProjects) && allProjects.length > 0 ? (
                <div className="grid gap-4 max-w-4xl">
                  {allProjects.map((proj: any) => (
                    <Link key={proj.id} href={`/projects/${proj.id}/bim`} className="block">
                      <div className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all cursor-pointer text-left">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-100 rounded">
                              <Building className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                              <h4 className="font-medium text-gray-900">{proj.name}</h4>
                              <p className="text-sm text-gray-600">
                                {proj.location && proj.country ? `${proj.location}, ${proj.country.toUpperCase()}` : 'Location not specified'}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-blue-600 font-medium">View BIM →</div>
                            <div className="text-xs text-gray-500">
                              {new Date(proj.createdAt || '').toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center">
                  <p className="text-gray-500 mb-4">No projects found. Create a project first to generate BIM models.</p>
                  <Link href="/projects">
                    <Button>
                      <Building className="h-4 w-4 mr-2" />
                      Go to Projects
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Enhanced Model Management Panel - Only show when not viewing a specific model */}
            {bimModels && bimModels.length > 1 && !modelId && (
              <div className="bg-white border-b">
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Building className="h-5 w-5 text-blue-600" />
                      BIM Models ({bimModels.length})
                    </h3>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {bimModels.map((model: any, index: number) => {
                      const date = new Date(model.created_at || model.createdAt);
                      const isActive = activeModel?.id === model.id;
                      return (
                        <div 
                          key={model.id} 
                          className={`p-3 border rounded-lg transition-all cursor-pointer ${
                            isActive
                              ? 'border-blue-500 bg-blue-50 shadow-md' 
                              : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50 hover:shadow-sm'
                          }`}
                          onClick={() => {
                            console.log('🎯 Card clicked:', { modelId: model.id, status: model.status, elements: model.elementCount, isActive });
                            if (projectId && !isActive && (model.status === 'ready' || model.status === 'completed') && model.elementCount > 0) {
                              const url = `/projects/${projectId}/bim/${model.id}`;
                              console.log('🚀 Card Navigation:', url);
                              window.location.href = url;
                            }
                          }}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="min-w-0 flex-1">
                              <h4 className={`font-medium text-sm truncate ${
                                isActive ? 'text-blue-900' : 'text-gray-900'
                              }`}>
                                Model {index + 1}
                                {isActive && <span className="ml-2 text-xs bg-blue-200 text-blue-800 px-1 rounded">Current</span>}
                              </h4>
                              <p className="text-xs text-gray-500 mt-1">
                                {date.toLocaleDateString()} at {date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                              </p>
                            </div>
                            {isActive && (
                              <div className="h-2 w-2 bg-blue-500 rounded-full flex-shrink-0"></div>
                            )}
                          </div>
                          
                          <div className="flex items-center justify-between text-xs text-gray-600">
                            <div className="flex items-center gap-2">
                              <span>Elements: {model.elementCount || '0'}</span>
                              {model.status === 'failed' && (
                                <span className="bg-red-100 text-red-700 px-1 rounded text-xs">Failed</span>
                              )}
                              {model.status === 'generating' && (
                                <>
                                  <span className="bg-yellow-100 text-yellow-700 px-1 rounded text-xs">Generating</span>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      if (confirm('Stop generating this model?')) {
                                        try {
                                          const token = localStorage.getItem('auth_token');
                                          const response = await fetch(`/api/bim/models/${model.id}/stop-processing`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                                            credentials: 'include'
                                          });
                                          if (response.ok) {
                                            window.location.reload();
                                          }
                                        } catch (error) {
                                          console.error('Failed to stop generation:', error);
                                        }
                                      }
                                    }}
                                    className="text-xs px-2 py-1 h-5 bg-red-50 border-red-300 text-red-700 hover:bg-red-100 ml-1"
                                    title="Stop generation"
                                  >
                                    Stop
                                  </Button>
                                </>
                              )}
                              {(model.status === 'ready' || model.status === 'completed') && model.elementCount > 0 && (
                                <span className="bg-green-100 text-green-700 px-1 rounded text-xs">Ready</span>
                              )}
                            </div>
                            {!isActive && (model.status === 'ready' || model.status === 'completed') && model.elementCount > 0 && (
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); window.location.href = `/projects/${projectId}/bim/${model.id}`; }}
                                className="text-xs px-3 py-2 h-8 bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100 touch-manipulation"
                                style={{ minWidth: '60px', touchAction: 'manipulation' }}
                              >
                                View 3D
                              </Button>
                            )}
                            {!isActive && model.status === 'failed' && (
                              <Button 
                                variant="outline" 
                                size="sm"
                                disabled
                                className="text-xs px-2 py-1 h-6 bg-gray-50 border-gray-300 text-gray-500"
                              >
                                Failed
                              </Button>
                            )}
                            {!isActive && model.status === 'completed' && model.elementCount === 0 && (
                              <Button 
                                variant="outline" 
                                size="sm"
                                disabled
                                className="text-xs px-2 py-1 h-6 bg-gray-50 border-gray-300 text-gray-500"
                              >
                                Empty
                              </Button>
                            )}
                            {isActive && (
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm('Regenerate this model with latest settings?')) {
                                    const token = localStorage.getItem('auth_token');
                                    fetch(`/api/bim/models/${model.id}/reexpand`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                                      credentials: 'include',
                                      body: JSON.stringify({ profile: 'detailed' })
                                    }).then(() => window.location.reload())
                                      .catch(() => alert('Regeneration failed'));
                                  }
                                }}
                                className="text-xs px-1 py-0 h-5 bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100"
                                title="Regenerate model"
                              >
                                ⟳
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            
            {/* BIM Viewer Content - Show viewer when model is selected */}
            {modelId && activeModel ? (
              <div className="flex-1 h-full">
                <BimViewer 
                  projectId={projectId}
                  modelId={activeModel.id}
                  country={project && typeof project === 'object' && 'country' in project ? (project as any).country : undefined}
                  location={project && typeof project === 'object' && 'location' in project ? (project as any).location : undefined}
                  buildingCode={project && typeof project === 'object' && 'buildingCode' in project ? (project as any).buildingCode : undefined}
                />
              </div>
            ) : (!bimModels || bimModels.length === 0) ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center max-w-2xl">
              <div className="w-20 h-20 bg-blue-100 rounded-xl mx-auto mb-6 flex items-center justify-center">
                <Building className="h-10 w-10 text-blue-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">No BIM Models Yet</h3>
              <p className="text-gray-600 mb-6">
                Generate your first 3D BIM model from your construction documents. Claude will analyze all your specifications, drawings, and details to create an accurate building model.
              </p>
              
              <div className="max-w-md mx-auto">
                <div className="p-6 border-2 border-blue-200 rounded-lg hover:border-blue-400 transition-colors bg-blue-50">
                  <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-lg mx-auto mb-4">
                    <Zap className="h-6 w-6 text-blue-600" />
                  </div>
                  <h4 className="font-semibold text-gray-900 mb-2">Generate BIM Model with Claude Analysis</h4>
                  <p className="text-sm text-gray-600 mb-4">
                    Claude AI analyzes all your construction documents (specifications, drawings, details, cross-sections) to extract real building elements with accurate quantities and CSI codes.
                  </p>
                  {projectId && (
                    <FloorGenerationButton 
                      projectId={projectId}
                      onSuccess={(modelId) => {
                        window.location.href = `/projects/${projectId}/bim/${modelId}`;
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
            ) : (
              /* Model Selection Grid - Only when no specific model selected */
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center max-w-4xl">
                  <div className="w-20 h-20 bg-blue-100 rounded-xl mx-auto mb-6 flex items-center justify-center">
                    <Building className="h-10 w-10 text-blue-600" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-3">Select a BIM Model to View</h3>
                  <p className="text-gray-600 mb-6">
                    Choose one of your generated 3D models to view and explore in the BIM viewer.
                  </p>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {bimModels.map((model: any, index: number) => {
                      const date = new Date(model.created_at || model.createdAt);
                      const isWorking = model.status === 'ready' && model.elementCount > 0;
                      return (
                        <div 
                          key={model.id} 
                          className={`p-4 border-2 rounded-lg transition-all ${
                            isWorking
                              ? 'border-blue-200 hover:border-blue-400 hover:bg-blue-50 cursor-pointer' 
                              : 'border-gray-200 bg-gray-50'
                          }`}
                          onClick={() => {
                            if (isWorking && projectId) {
                              window.location.href = `/projects/${projectId}/bim/${model.id}`;
                            }
                          }}
                        >
                          <div className="text-center">
                            <div className={`w-12 h-12 rounded-lg mx-auto mb-3 flex items-center justify-center ${
                              isWorking ? 'bg-blue-100' : 'bg-gray-200'
                            }`}>
                              <Building className={`h-6 w-6 ${isWorking ? 'text-blue-600' : 'text-gray-500'}`} />
                            </div>
                            <h4 className="font-medium text-gray-900 mb-1">Model {index + 1}</h4>
                            <p className="text-xs text-gray-500 mb-2">
                              {date.toLocaleDateString()} at {date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            </p>
                            <div className="flex items-center justify-center gap-2 mb-3">
                              <span className="text-xs text-gray-600">Elements: {model.elementCount || '0'}</span>
                              {model.status === 'failed' && (
                                <span className="bg-red-100 text-red-700 px-1 rounded text-xs">Failed</span>
                              )}
                              {(model.status === 'ready' || model.status === 'completed') && model.elementCount > 0 && (
                                <span className="bg-green-100 text-green-700 px-1 rounded text-xs">Ready</span>
                              )}
                            </div>
                            {isWorking ? (
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  console.log('🚀 Main View 3D clicked:', { modelId: model.id, status: model.status });
                                  if (model.id && projectId) {
                                    const url = `/projects/${projectId}/bim/${model.id}`;
                                    console.log('🚀 Navigating to:', url);
                                    window.location.href = url;
                                  } else {
                                    console.log('❌ Cannot navigate: missing model or projectId');
                                  }
                                }}
                                className="w-full bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100 touch-manipulation"
                                style={{ touchAction: 'manipulation' }}
                              >
                                View 3D Model
                              </Button>
                            ) : (
                              <Button 
                                variant="outline" 
                                size="sm"
                                disabled
                                className="w-full bg-gray-50 border-gray-300 text-gray-500"
                              >
                                {model.status === 'failed' ? 'Model Failed' : 'Not Ready'}
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Missing Data Resolution Dialog — "No Default Values" */}
      {projectId && (
        <MissingDataDialog
          projectId={projectId}
          modelId={activeModel?.id || ''}
          isOpen={showMissingData}
          onClose={() => setShowMissingData(false)}
          onResolved={() => {
            // Refresh BIM model data after user provides missing dimensions
            window.location.reload();
          }}
        />
      )}

      {/* Grid Confirmation Dialog */}
      {projectId && (
        <GridConfirmationDialog
          projectId={projectId}
          open={showGridConfig}
          onOpenChange={setShowGridConfig}
          onConfirmed={() => {
            window.location.reload();
          }}
        />
      )}

      {/* Candidate Review Panel */}
      {activeModel?.id && (
        <CandidateReviewPanel
          modelId={activeModel.id}
          open={showCandidateReview}
          onOpenChange={setShowCandidateReview}
          onResolved={() => {
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}
