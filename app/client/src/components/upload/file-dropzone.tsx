import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CloudUpload, X, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface FileWithProgress {
  file: File;
  progress: number;
  status: 'uploading' | 'completed' | 'error';
  id: string;
}

interface FileDropzoneProps {
  projectId?: string;
}

export default function FileDropzone({ projectId }: FileDropzoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<FileWithProgress[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      if (!projectId) {
        throw new Error('Project ID is required for file upload');
      }
      return await apiRequest("POST", `/api/projects/${projectId}/documents/upload`, formData);
    },
    onSuccess: () => {
      setFiles(prev => prev.map(f => ({ ...f, status: 'completed' })));
      queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
      toast({
        title: "Upload successful",
        description: "Files have been uploaded and analysis started",
      });
    },
    onError: (error: any) => {
      console.log('Upload error:', error);
      setFiles(prev => prev.map(f => ({ ...f, status: 'error' })));
      toast({
        title: "Upload failed",
        description: error?.message || "There was an error uploading your files",
        variant: "destructive",
      });
    },
  });

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    handleFiles(droppedFiles);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      handleFiles(selectedFiles);
    }
  };

  const handleFiles = (fileList: File[]) => {
    const allowedTypes = ['.pdf', '.dwg', '.dxf', '.ifc', '.rvt'];
    const validFiles = fileList.filter(file => {
      const extension = '.' + file.name.split('.').pop()?.toLowerCase();
      return allowedTypes.includes(extension);
    });

    if (validFiles.length === 0) {
      toast({
        title: "Invalid file type",
        description: "Please upload PDF, DWG, DXF, IFC, or Revit files only",
        variant: "destructive",
      });
      return;
    }

    const newFiles: FileWithProgress[] = validFiles.map(file => ({
      file,
      progress: 0,
      status: 'uploading',
      id: Math.random().toString(36).substring(7)
    }));

    setFiles(prev => [...prev, ...newFiles]);

    // Simulate upload progress and then make actual upload
    const formData = new FormData();
    validFiles.forEach(file => {
      formData.append('files', file);
    });

    // Fast progress simulation without loops
    newFiles.forEach((fileItem, index) => {
      let progress = 0;
      const interval = setInterval(() => {
        progress += 25; // Faster progress increments
        if (progress >= 100) {
          progress = 100;
          clearInterval(interval);
          setFiles(prev => prev.map(f => 
            f.id === fileItem.id ? { ...f, progress: 100, status: 'completed' } : f
          ));
          return; // Stop the interval
        }
        setFiles(prev => prev.map(f => 
          f.id === fileItem.id ? { ...f, progress } : f
        ));
      }, 100); // Faster interval but shorter duration
    });

    uploadMutation.mutate(formData);
  };

  const removeFile = (fileId: string) => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <Card className="shadow-sm border">
      <CardContent className="p-8">
        <div 
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer ${
            dragOver ? 'border-primary bg-blue-50' : 'border-gray-300 hover:border-primary'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          data-testid="file-dropzone"
        >
          <div className="mx-auto w-16 h-16 bg-primary bg-opacity-10 rounded-full flex items-center justify-center mb-4">
            <CloudUpload className="text-primary text-2xl h-8 w-8" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Drop your files here</h3>
          <p className="text-gray-600 mb-4">or click to browse</p>
          <p className="text-sm text-gray-500">Supports: PDF, DWG, DXF, IFC, Revit files up to 100MB</p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept=".pdf,.dwg,.dxf,.ifc,.rvt"
            onChange={handleFileInputChange}
            data-testid="file-input"
          />
        </div>

        {files.length > 0 && (
          <div className="mt-6 space-y-4">
            <h4 className="font-medium text-gray-900">Uploading Files</h4>
            {files.map((fileItem) => (
              <div key={fileItem.id} className="bg-gray-50 rounded-lg p-4" data-testid={`file-upload-${fileItem.id}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center">
                    <FileText className="mr-2 h-4 w-4 text-gray-500" />
                    <span className="text-sm font-medium text-gray-900">{fileItem.file.name}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-500">{formatFileSize(fileItem.file.size)}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(fileItem.id)}
                      data-testid={`button-remove-file-${fileItem.id}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="w-full">
                  <Progress 
                    value={fileItem.progress} 
                    className="h-2"
                    data-testid={`progress-${fileItem.id}`}
                  />
                </div>
                <div className="flex justify-between mt-1 text-xs text-gray-500">
                  <span>
                    {fileItem.status === 'uploading' && 'Uploading...'}
                    {fileItem.status === 'completed' && 'Upload complete'}
                    {fileItem.status === 'error' && 'Upload failed'}
                  </span>
                  <span>{Math.round(fileItem.progress)}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
