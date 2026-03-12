// client/src/pages/reports.tsx
// Deployment fix: removed hardcoded 'project-1'. projectId is resolved from
// the URL path (e.g. /projects/:id/reports) or from the user's first project.
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import ReportTemplates from "@/components/reports/report-templates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Download, Trash2, FolderOpen } from "lucide-react";
import type { Report } from "@shared/schema";

export default function Reports() {
  const [location] = useLocation();

  // Resolve projectId from URL — supports both /projects/:id/reports and /reports
  const projectIdFromUrl = location.includes("/projects/")
    ? location.split("/projects/")[1]?.split("/")[0] ?? null
    : null;

  // If not in a project URL, fall back to the user's first project
  const { data: projects } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/projects"],
    enabled: !projectIdFromUrl,
  });

  const projectId = projectIdFromUrl ?? projects?.[0]?.id ?? null;

  const { data: reports, isLoading } = useQuery<Report[]>({
    queryKey: [`/api/projects/${projectId}/reports`],
    enabled: !!projectId,
  });

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formatDate = (date: Date | null) => {
    if (!date) return "Unknown";
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 24) return `${diffHours} hours ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} ${diffDays === 1 ? "day" : "days"} ago`;
  };

  if (!projectId) {
    return (
      <div>
        <header className="bg-white p-6 border-b">
          <h2 className="text-3xl font-bold text-gray-900">Reports & Export</h2>
          <p className="text-gray-600 mt-1">Generate and export estimation reports</p>
        </header>
        <div className="p-6">
          <Card className="shadow-sm border">
            <CardContent className="p-12 text-center">
              <FolderOpen className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 text-lg font-medium">No project selected</p>
              <p className="text-gray-400 mt-2 text-sm">
                Open a project first, then navigate to Reports to generate exports.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div>
      <header className="bg-white p-6 border-b">
        <h2 className="text-3xl font-bold text-gray-900">Reports & Export</h2>
        <p className="text-gray-600 mt-1">Generate and export estimation reports</p>
      </header>

      <div className="p-6 space-y-6">
        <ReportTemplates projectId={projectId} />

        <Card className="shadow-sm border">
          <CardHeader>
            <CardTitle>Recent Exports</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      {["Report Type", "Generated", "Size", "Status", "Actions"].map((h) => (
                        <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {reports?.map((report: Report) => (
                      <tr key={report.id} data-testid={`report-row-${report.id}`}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <FileText className="h-5 w-5 text-red-500" />
                            <span className="ml-3 text-sm font-medium text-gray-900">
                              {report.reportType}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatDate(report.generatedAt)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatFileSize(report.fileSize)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            report.status === "Ready" ? "bg-green-100 text-green-800" :
                            report.status === "Generating" ? "bg-yellow-100 text-yellow-800" :
                            "bg-red-100 text-red-800"
                          }`}>
                            {report.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-primary hover:text-blue-900"
                            onClick={() => {
                              const link = document.createElement("a");
                              link.href = `/api/reports/${report.id}/download`;
                              link.download = `${report.reportType}-${report.id}.pdf`;
                              link.click();
                            }}
                            data-testid={`button-download-${report.id}`}
                          >
                            <Download className="h-4 w-4 mr-1" />
                            Download
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-gray-600 hover:text-gray-900"
                            onClick={() => {
                              if (confirm(`Delete the ${report.reportType} report?`)) {
                                alert("Delete will be wired to DELETE /api/reports/:id");
                              }
                            }}
                            data-testid={`button-delete-${report.id}`}
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Delete
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {(!reports || reports.length === 0) && (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                          No reports generated yet. Use the templates above to generate your first report.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
