import FileDropzone from "@/components/upload/file-dropzone";
import ProcessingOptions from "@/components/upload/processing-options";
import { useParams, useLocation } from "wouter";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FolderOpen, Upload as UploadIcon, CheckCircle } from "lucide-react";
import type { Project } from "@shared/schema";

function StepBadge({ n, done }: { n: number; done?: boolean }) {
  return (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
      done ? 'bg-green-100 text-green-700' : 'bg-blue-600 text-white'
    }`}>
      {done ? <CheckCircle className="w-4 h-4" /> : n}
    </div>
  );
}

export default function Upload() {
  const { projectId } = useParams<{ projectId: string }>();
  const [, setLocation] = useLocation();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [standard, setStandard] = useState<string>("CA");

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['/api/projects'],
  });

  // ── No project selected ──────────────────────────────────────────────────
  if (!projectId) {
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
                    <SelectValue placeholder="Choose a project…" />
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
                  onClick={() => selectedProjectId && setLocation(`/projects/${selectedProjectId}/upload`)}
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

  // ── Project selected ─────────────────────────────────────────────────────
  return (
    <div>
      <header className="bg-white p-6 border-b">
        <div className="flex items-center gap-3">
          <UploadIcon className="h-7 w-7 text-blue-600" />
          <div>
            <h2 className="text-3xl font-bold text-gray-900">Upload Documents</h2>
            <p className="text-gray-600 mt-0.5">
              Upload your construction drawings and specs — the AI reads the text and prepares your cost estimate
            </p>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-4xl space-y-8">

        {/* ── Step 1: Standards ── */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <StepBadge n={1} done={!!standard} />
            <div>
              <h3 className="font-semibold text-gray-900">Choose construction standards</h3>
              <p className="text-sm text-gray-500">Tells the AI which building codes and pricing to use when reading your drawings</p>
            </div>
          </div>
          <ProcessingOptions standard={standard} onStandardChange={setStandard} />
        </div>

        {/* ── Step 2: Drop zone ── */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <StepBadge n={2} />
            <div>
              <h3 className="font-semibold text-gray-900">Upload your drawings</h3>
              <p className="text-sm text-gray-500">Drop files below — the AI will extract the text automatically as each file is received</p>
            </div>
          </div>
          <FileDropzone projectId={projectId} standard={standard} />
        </div>

      </div>
    </div>
  );
}
