import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { 
  FileText, 
  Brain, 
  Eye, 
  Building,
  CheckCircle,
  Loader2,
  Zap,
  Cpu,
  Database
} from "lucide-react";

interface ProcessingStage {
  id: string;
  name: string;
  description: string;
  icon: any;
  progress: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  estimatedTime: string;
  details: string[];
}

interface AIProcessingLoaderProps {
  isVisible: boolean;
  currentStage?: string;
  progress?: number;
  message?: string;
  onComplete?: () => void;
}

export default function AIProcessingLoader({ 
  isVisible, 
  currentStage = "parsing",
  progress = 0,
  message = "Starting AI analysis...",
  onComplete 
}: AIProcessingLoaderProps) {
  const [stages, setStages] = useState<ProcessingStage[]>([
    {
      id: "parsing",
      name: "Document Parsing",
      description: "Converting and extracting content from uploaded files",
      icon: FileText,
      progress: 0,
      status: 'pending',
      estimatedTime: "30-60 sec",
      details: [
        "Reading PDF structures",
        "Extracting text content", 
        "Processing CAD geometries",
        "Identifying document types"
      ]
    },
    {
      id: "nlp",
      name: "NLP Analysis",
      description: "Understanding specifications and requirements using AI",
      icon: Brain,
      progress: 0,
      status: 'pending',
      estimatedTime: "2-3 min",
      details: [
        "Analyzing project specifications",
        "Extracting material requirements",
        "Identifying compliance criteria",
        "Processing technical documents"
      ]
    },
    {
      id: "cv",
      name: "Computer Vision",
      description: "Detecting building components and dimensions from drawings",
      icon: Eye,
      progress: 0,
      status: 'pending',
      estimatedTime: "1-2 min",
      details: [
        "Scanning architectural drawings",
        "Detecting structural elements",
        "Measuring dimensions",
        "Identifying MEP components"
      ]
    },
    {
      id: "boq",
      name: "BoQ Generation",
      description: "Creating detailed Bill of Quantities with professional standards",
      icon: Building,
      progress: 0,
      status: 'pending',
      estimatedTime: "2-4 min",
      details: [
        "Calculating quantities",
        "Applying CIQS standards",
        "Generating item codes",
        "Regional pricing lookup"
      ]
    },
    {
      id: "compliance",
      name: "Compliance Check",
      description: "Verifying building code requirements and standards",
      icon: CheckCircle,
      progress: 0,
      status: 'pending',
      estimatedTime: "1-2 min",
      details: [
        "Checking NBC 2020 requirements",
        "Validating structural criteria",
        "Fire safety compliance",
        "Accessibility standards"
      ]
    }
  ]);

  const [animationStep, setAnimationStep] = useState(0);

  // Update stage statuses based on current processing stage
  useEffect(() => {
    setStages(prevStages => {
      return prevStages.map(stage => {
        if (stage.id === currentStage) {
          return { ...stage, status: 'processing', progress };
        } else if (prevStages.findIndex(s => s.id === currentStage) > prevStages.findIndex(s => s.id === stage.id)) {
          return { ...stage, status: 'completed', progress: 100 };
        } else {
          return { ...stage, status: 'pending', progress: 0 };
        }
      });
    });
  }, [currentStage, progress]);

  // Animation loop for visual effects
  useEffect(() => {
    if (!isVisible) return;
    
    const interval = setInterval(() => {
      setAnimationStep(prev => (prev + 1) % 100);
    }, 50);

    return () => clearInterval(interval);
  }, [isVisible]);

  // Auto-complete when all stages are done
  useEffect(() => {
    const allCompleted = stages.every(stage => stage.status === 'completed');
    if (allCompleted && onComplete) {
      setTimeout(onComplete, 1000);
    }
  }, [stages, onComplete]);

  if (!isVisible) return null;

  const _getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'processing': return 'bg-blue-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-300';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed': return <Badge className="bg-green-100 text-green-800">Completed</Badge>;
      case 'processing': return <Badge className="bg-blue-100 text-blue-800">Processing</Badge>;
      case 'error': return <Badge className="bg-red-100 text-red-800">Error</Badge>;
      default: return <Badge variant="secondary">Pending</Badge>;
    }
  };

  const currentStageData = stages.find(s => s.id === currentStage);
  const overallProgress = stages.reduce((sum, stage) => sum + stage.progress, 0) / stages.length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        
        {/* Header */}
        <div className="p-6 border-b bg-gradient-to-r from-blue-50 to-purple-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="relative">
                <Cpu className="h-8 w-8 text-blue-600" />
                <div className="absolute -top-1 -right-1">
                  <Zap className="h-4 w-4 text-yellow-500 animate-pulse" />
                </div>
              </div>
              <div className="ml-4">
                <h2 className="text-2xl font-bold text-gray-900">AI Analysis in Progress</h2>
                <p className="text-gray-600">{message}</p>
              </div>
            </div>
            
            <div className="text-right">
              <div className="flex items-center">
                <Database className="h-5 w-5 text-purple-600 mr-2" />
                <span className="text-lg font-bold text-purple-600">
                  {Math.round(overallProgress)}%
                </span>
              </div>
              <p className="text-sm text-gray-500">Overall Progress</p>
            </div>
          </div>
          
          <div className="mt-4">
            <Progress value={overallProgress} className="h-3" />
          </div>
        </div>

        {/* Current Stage Spotlight */}
        {currentStageData && (
          <div className="p-6 bg-gradient-to-r from-blue-50 to-blue-100 border-l-4 border-blue-500">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="relative">
                  <currentStageData.icon className="h-6 w-6 text-blue-600" />
                  <Loader2 className="absolute -top-2 -right-2 h-4 w-4 text-blue-500 animate-spin" />
                </div>
                <div className="ml-4">
                  <h3 className="text-lg font-semibold text-blue-900">
                    Currently: {currentStageData.name}
                  </h3>
                  <p className="text-blue-700">{currentStageData.description}</p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-blue-600">{currentStageData.progress}%</div>
                <p className="text-sm text-blue-600">Est. {currentStageData.estimatedTime}</p>
              </div>
            </div>
            
            <div className="mt-4">
              <Progress value={currentStageData.progress} className="h-2" />
              <div className="mt-2 text-sm text-blue-600">
                {currentStageData.details[Math.floor(animationStep / 25) % currentStageData.details.length]}
              </div>
            </div>
          </div>
        )}

        {/* All Stages List */}
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <Building className="h-5 w-5 mr-2 text-gray-600" />
            Processing Pipeline
          </h3>
          
          <div className="space-y-4">
            {stages.map((stage, _index) => {
              const Icon = stage.icon;
              const isActive = stage.id === currentStage;
              
              return (
                <Card key={stage.id} className={`transition-all duration-300 ${
                  isActive ? 'shadow-lg border-blue-300 scale-105' : 'shadow-sm'
                }`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center flex-1">
                        <div className="relative">
                          <div className={`p-2 rounded-lg ${
                            stage.status === 'completed' ? 'bg-green-100' :
                            stage.status === 'processing' ? 'bg-blue-100' :
                            'bg-gray-100'
                          }`}>
                            <Icon className={`h-5 w-5 ${
                              stage.status === 'completed' ? 'text-green-600' :
                              stage.status === 'processing' ? 'text-blue-600' :
                              'text-gray-500'
                            }`} />
                          </div>
                          
                          {stage.status === 'processing' && (
                            <Loader2 className="absolute -top-1 -right-1 h-4 w-4 text-blue-500 animate-spin" />
                          )}
                          
                          {stage.status === 'completed' && (
                            <CheckCircle className="absolute -top-1 -right-1 h-4 w-4 text-green-500" />
                          )}
                        </div>
                        
                        <div className="ml-4 flex-1">
                          <div className="flex items-center justify-between">
                            <h4 className="font-medium text-gray-900">{stage.name}</h4>
                            {getStatusBadge(stage.status)}
                          </div>
                          <p className="text-sm text-gray-600 mt-1">{stage.description}</p>
                          
                          {stage.status !== 'pending' && (
                            <div className="mt-2">
                              <Progress value={stage.progress} className="h-1.5" />
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="text-right ml-4">
                        <div className="text-lg font-bold">
                          {stage.status === 'completed' ? '✓' : 
                           stage.status === 'processing' ? `${stage.progress}%` : 
                           '—'}
                        </div>
                        <p className="text-xs text-gray-500">{stage.estimatedTime}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t bg-gray-50">
          <div className="flex items-center justify-center text-sm text-gray-600">
            <Zap className="h-4 w-4 mr-2 text-yellow-500" />
            <span>Powered by Claude AI • Real-time NBC 2020 & Building Code Analysis</span>
          </div>
        </div>
        
      </div>
    </div>
  );
}