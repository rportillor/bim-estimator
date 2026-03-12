import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Brain, 
  Settings, 
  Zap, 
  Eye, 
  Scan,
  Target,
  Award,
  Plus,
  Edit,
  Trash2,
  Download,
  Upload
} from "lucide-react";
import { AIConfigurationModal } from "@/components/ai/ai-configuration-modal";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface AIConfiguration {
  id: string;
  name: string;
  processingMode: "quick" | "standard" | "comprehensive" | "detailed";
  analysisStandards: string[];
  aiModels: {
    nlp: "standard" | "advanced";
    cv: "opencv" | "yolo" | "detectron";
    ocr: "tesseract" | "advanced";
  };
  detectComponents: string[];
  extractionSettings: {
    confidence: number;
    precision: "low" | "medium" | "high" | "ultra";
    enableOCR: boolean;
    enableTableExtraction: boolean;
    enableDimensionDetection: boolean;
    enableMEPAnalysis: boolean;
  };
  isDefault: boolean;
  createdAt: string;
  lastUsed?: string;
  usageCount: number;
  estimatedProcessingTime: string;
}

interface AIUsageStats {
  totalProcessingJobs: number;
  successRate: number;
  avgProcessingTime: number;
  topConfigurations: Array<{
    id: string;
    name: string;
    usageCount: number;
    successRate: number;
  }>;
}

export default function AIConfigurationPage() {
  const [showModal, setShowModal] = useState(false);
  const [editingConfig, setEditingConfig] = useState<AIConfiguration | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: configurations, isLoading } = useQuery<AIConfiguration[]>({
    queryKey: ['/api/ai/configurations'],
    retry: false,
  });

  const { data: usageStats } = useQuery<AIUsageStats>({
    queryKey: ['/api/ai/usage-stats'],
    retry: false,
  });

  const createConfigMutation = useMutation({
    mutationFn: async (config: any) => {
      return apiRequest("POST", '/api/ai/configurations', config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai/configurations'] });
      setShowModal(false);
      setEditingConfig(null);
      toast({
        title: "Configuration saved",
        description: "AI configuration has been saved successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error saving configuration",
        description: error.message || "Failed to save AI configuration.",
        variant: "destructive",
      });
    },
  });

  const deleteConfigMutation = useMutation({
    mutationFn: async (configId: string) => {
      return apiRequest("DELETE", `/api/ai/configurations/${configId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai/configurations'] });
      toast({
        title: "Configuration deleted",
        description: "AI configuration has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error deleting configuration",
        description: error.message || "Failed to delete AI configuration.",
        variant: "destructive",
      });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (configId: string) => {
      return apiRequest("POST", `/api/ai/configurations/${configId}/set-default`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai/configurations'] });
      toast({
        title: "Default configuration updated",
        description: "New default AI configuration has been set.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to set default configuration",
        description: error.message || "Could not update default configuration.",
        variant: "destructive",
      });
    },
  });

  const handleEditConfig = (config: AIConfiguration) => {
    setEditingConfig(config);
    setShowModal(true);
  };

  const handleDeleteConfig = (configId: string) => {
    if (confirm("Are you sure you want to delete this configuration?")) {
      deleteConfigMutation.mutate(configId);
    }
  };

  const getModeIcon = (mode: string) => {
    switch (mode) {
      case "quick":
        return <Zap className="h-4 w-4" />;
      case "standard":
        return <Target className="h-4 w-4" />;
      case "comprehensive":
        return <Brain className="h-4 w-4" />;
      case "detailed":
        return <Award className="h-4 w-4" />;
      default:
        return <Settings className="h-4 w-4" />;
    }
  };

  const getModeColor = (mode: string) => {
    switch (mode) {
      case "quick":
        return "bg-green-100 text-green-800";
      case "standard":
        return "bg-blue-100 text-blue-800";
      case "comprehensive":
        return "bg-purple-100 text-purple-800";
      case "detailed":
        return "bg-orange-100 text-orange-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="ai-configuration-page">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold" data-testid="page-title">AI Configuration</h1>
          <p className="text-muted-foreground">
            Configure AI analysis settings for construction document processing
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline"
            data-testid="button-import"
          >
            <Upload className="h-4 w-4 mr-2" />
            Import Config
          </Button>
          <Button 
            onClick={() => setShowModal(true)}
            data-testid="button-create"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Configuration
          </Button>
        </div>
      </div>

      {/* Usage Statistics */}
      {usageStats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Jobs</p>
                  <p className="text-2xl font-bold">{usageStats.totalProcessingJobs}</p>
                </div>
                <Brain className="h-8 w-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Success Rate</p>
                  <p className="text-2xl font-bold text-green-600">{usageStats.successRate}%</p>
                </div>
                <Target className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Avg Processing</p>
                  <p className="text-2xl font-bold">{Math.round(usageStats.avgProcessingTime)}m</p>
                </div>
                <Zap className="h-8 w-8 text-yellow-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Configurations</p>
                  <p className="text-2xl font-bold">{configurations?.length || 0}</p>
                </div>
                <Settings className="h-8 w-8 text-purple-500" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Configurations List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Configurations
          </CardTitle>
          <CardDescription>
            Manage your AI analysis configurations for different project types and requirements
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!configurations || configurations.length === 0 ? (
            <Alert>
              <Brain className="h-4 w-4" />
              <AlertDescription>
                No AI configurations found. Create your first configuration to start processing construction documents.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {configurations.map((config) => (
                <Card key={config.id} className="relative" data-testid={`config-${config.id}`}>
                  {config.isDefault && (
                    <Badge className="absolute top-2 right-2" variant="default">
                      Default
                    </Badge>
                  )}
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{config.name}</CardTitle>
                      <div className="flex items-center gap-1">
                        {getModeIcon(config.processingMode)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge 
                        variant="outline" 
                        className={getModeColor(config.processingMode)}
                      >
                        {config.processingMode}
                      </Badge>
                      <Badge variant="outline">
                        {config.estimatedProcessingTime}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-sm space-y-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Standards:</span>
                        <span>{config.analysisStandards.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Components:</span>
                        <span>{config.detectComponents.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Usage:</span>
                        <span>{config.usageCount} times</span>
                      </div>
                      {config.lastUsed && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Last used:</span>
                          <span>{new Date(config.lastUsed).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEditConfig(config)}
                        data-testid={`button-edit-${config.id}`}
                      >
                        <Edit className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                      {!config.isDefault && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDefaultMutation.mutate(config.id)}
                            data-testid={`button-default-${config.id}`}
                          >
                            Set Default
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeleteConfig(config.id)}
                            data-testid={`button-delete-${config.id}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Configuration Modal */}
      <AIConfigurationModal
        open={showModal}
        onClose={() => {
          setShowModal(false);
          setEditingConfig(null);
        }}
        onSave={async (config) => {
          await createConfigMutation.mutateAsync(config);
        }}
        initialConfig={editingConfig || undefined}
        isLoading={createConfigMutation.isPending}
      />
    </div>
  );
}