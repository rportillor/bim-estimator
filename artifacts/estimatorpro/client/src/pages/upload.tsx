import FileDropzone from "@/components/upload/file-dropzone";
import AIAnalysisStatus from "@/components/upload/ai-analysis-status";
import ProcessingOptions from "@/components/upload/processing-options";
import { useParams, useLocation } from "wouter";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FolderOpen } from "lucide-react";
import type { Project } from "@shared/schema";

export default function Upload() {
  const { projectId } = useParams<{ projectId: string }>();
  const [, setLocation] = useLocation();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['/api/projects'],
  });

  // If no projectId in URL, show project selector
  if (!projectId) {
    const handleProjectSelect = () => {
      if (selectedProjectId) {
        setLocation(`/projects/${selectedProjectId}/upload`);
      }
    };

    return (
      <div>
        <header className="bg-white p-6 border-b">
          <h2 className="text-3xl font-bold text-gray-900">Upload Documents</h2>
          <p className="text-gray-600 mt-1">Select a project to upload construction drawings and specifications</p>
        </header>

        <div className="p-6">
          <Card className="max-w-md mx-auto">
            <CardContent className="p-6">
              <div className="text-center mb-6">
                <FolderOpen className="h-12 w-12 text-blue-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Select Project</h3>
                <p className="text-gray-600">Choose which project to upload documents to</p>
              </div>
              
              <div className="space-y-4">
                <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a project..." />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                <Button 
                  onClick={handleProjectSelect} 
                  disabled={!selectedProjectId}
                  className="w-full"
                  data-testid="button-continue-upload"
                >
                  Continue to Upload
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div>
      <header className="bg-white p-6 border-b">
        <h2 className="text-3xl font-bold text-gray-900">Upload Documents</h2>
        <p className="text-gray-600 mt-1">Upload construction drawings and specifications for comprehensive AI analysis</p>
      </header>

      <div className="p-6 space-y-8">
        <FileDropzone projectId={projectId} />
        
        <div>
          <h3 className="text-xl font-semibold text-gray-900 mb-4">Processing Configuration</h3>
          <ProcessingOptions />
        </div>
        
        <AIAnalysisStatus projectId={projectId} />
      </div>
    </div>
  );
}
