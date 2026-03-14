import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, Clock, Loader2, FileText, Table, Eye, Brain } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useQuery } from "@tanstack/react-query";

interface AIAnalysisStatusProps {
  projectId?: string;
}

export default function AIAnalysisStatus({ projectId }: AIAnalysisStatusProps) {
  const [realTimeProgress, setRealTimeProgress] = useState<number>(0);
  const [_currentStage, setCurrentStage] = useState<string>("analyzing");

  // Get real-time analysis progress
  const { data: progressData, refetch: _refetch, isLoading: _progressLoading } = useQuery({
    queryKey: ['/api/projects', projectId, 'similarity'],
    enabled: !!projectId,
    refetchInterval: false, // Disable polling - analysis complete
  });

  useEffect(() => {
    if ((progressData as any)?.progress) {
      setRealTimeProgress((progressData as any).progress);
      setCurrentStage((progressData as any).status || "analyzing");
    }
  }, [progressData]);

  const getAnalysisStages = () => [
    {
      name: "Document Parsing",
      description: "Processing construction drawings and specifications",
      status: realTimeProgress > 0 ? "completed" : "pending",
      icon: "FileText"
    },
    {
      name: "Content Extraction", 
      description: "Extracting BoQ schedules and technical specifications",
      status: realTimeProgress > 25 ? "completed" : realTimeProgress > 0 ? "processing" : "pending",
      icon: "Table"
    },
    {
      name: "Claude Sonnet 4 Analysis",
      description: "Advanced AI analysis with enhanced positioning system", 
      status: realTimeProgress > 50 ? "completed" : realTimeProgress > 25 ? "processing" : "pending",
      icon: "Brain"
    },
    {
      name: "BIM Generation",
      description: "Creating 3D models with type-aware positioning",
      status: realTimeProgress >= 100 ? "completed" : realTimeProgress > 75 ? "processing" : "pending",
      icon: "Eye"
    }
  ];
  const getProcessingIcon = (iconName: string) => {
    switch (iconName) {
      case "FileText":
        return <FileText className="h-4 w-4" />;
      case "Table":
        return <Table className="h-4 w-4" />;
      case "Eye":
        return <Eye className="h-4 w-4" />;
      case "Brain":
        return <Brain className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "processing":
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
      case "pending":
        return <Clock className="h-5 w-5 text-gray-400" />;
      default:
        return <Clock className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStatusBg = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-50";
      case "processing":
        return "bg-blue-50";
      case "pending":
        return "bg-gray-50";
      default:
        return "bg-gray-50";
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "completed":
        return "Completed";
      case "processing":
        return "Processing...";
      case "pending":
        return "Pending";
      default:
        return "Pending";
    }
  };

  const analysisStages = getAnalysisStages();

  return (
    <Card className="shadow-sm border">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>AI Analysis Pipeline</span>
          {projectId && realTimeProgress > 0 && realTimeProgress < 100 && (
            <span className="text-sm font-normal text-blue-600">
              {realTimeProgress.toFixed(1)}% Complete
            </span>
          )}
        </CardTitle>
        {projectId && realTimeProgress > 0 && realTimeProgress < 100 && (
          <Progress value={realTimeProgress} className="w-full" />
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {analysisStages.map((stage, index) => (
            <div 
              key={index} 
              className={`flex items-center p-4 rounded-lg ${getStatusBg(stage.status)}`}
              data-testid={`analysis-stage-${index}`}
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white shadow-sm">
                {getProcessingIcon(stage.icon)}
              </div>
              <div className="ml-4 flex-1">
                <p className="font-medium text-gray-900 flex items-center gap-2">
                  {stage.name}
                  {getStatusIcon(stage.status)}
                </p>
                <p className="text-sm text-gray-600">{stage.description}</p>
              </div>
              <span 
                className="text-sm font-medium"
                data-testid={`status-${index}`}
              >
                {getStatusText(stage.status)}
              </span>
            </div>
          ))}
        </div>
        {projectId && realTimeProgress >= 100 && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800 font-medium">
              ✅ Analysis Complete! Your enhanced BIM models are ready.
            </p>
          </div>
        )}
        {projectId && realTimeProgress > 0 && realTimeProgress < 100 && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              🔄 <strong>Claude Sonnet 4</strong> is analyzing your construction documents with enhanced positioning...
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
