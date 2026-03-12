// client/src/components/reports/report-templates.tsx
// Deployment fix: removed hardcoded 'project-1'. Accepts projectId as a
// required prop so the parent page supplies the real project context.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  FileText,
  FileSpreadsheet,
  Shield,
  Box,
  BarChart3,
  File,
  Download,
} from "lucide-react";

interface ReportTemplatesProps {
  projectId: string;
}

const reportTemplates = [
  {
    id: "complete-boq",
    title: "Complete BoQ Report",
    description: "Comprehensive Bill of Quantities with all items, rates, and totals",
    icon: FileText,
    bgColor: "bg-red-100",
    iconColor: "text-red-600",
    buttonColor: "bg-red-600 hover:bg-red-700",
  },
  {
    id: "excel-workbook",
    title: "Excel Workbook",
    description: "Editable spreadsheet with quantities, formulas, and calculations",
    icon: FileSpreadsheet,
    bgColor: "bg-green-100",
    iconColor: "text-green-600",
    buttonColor: "bg-green-600 hover:bg-green-700",
  },
  {
    id: "compliance-report",
    title: "Compliance Report",
    description: "Detailed compliance analysis with recommendations",
    icon: Shield,
    bgColor: "bg-blue-100",
    iconColor: "text-blue-600",
    buttonColor: "bg-blue-600 hover:bg-blue-700",
  },
  {
    id: "bim-export",
    title: "BIM Model Export",
    description: "Export 3D model in IFC or Revit format",
    icon: Box,
    bgColor: "bg-purple-100",
    iconColor: "text-purple-600",
    buttonColor: "bg-purple-600 hover:bg-purple-700",
  },
  {
    id: "cost-analysis",
    title: "Cost Analysis",
    description: "Detailed cost breakdown and analysis charts",
    icon: BarChart3,
    bgColor: "bg-yellow-100",
    iconColor: "text-yellow-600",
    buttonColor: "bg-yellow-600 hover:bg-yellow-700",
  },
  {
    id: "tender-document",
    title: "Tender Document",
    description: "Formatted tender document with all specifications",
    icon: File,
    bgColor: "bg-indigo-100",
    iconColor: "text-indigo-600",
    buttonColor: "bg-indigo-600 hover:bg-indigo-700",
  },
];

export default function ReportTemplates({ projectId }: ReportTemplatesProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const generateReportMutation = useMutation({
    mutationFn: async (reportType: string) => {
      return await apiRequest("POST", `/api/projects/${projectId}/reports`, { reportType });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/projects/${projectId}/reports`],
      });
      toast({
        title: "Report generated successfully",
        description: `${data.reportType} is ready for download`,
      });
    },
    onError: () => {
      toast({
        title: "Report generation failed",
        description: "There was an error generating the report",
        variant: "destructive",
      });
    },
  });

  const handleGenerateReport = (template: (typeof reportTemplates)[0]) => {
    generateReportMutation.mutate(template.title);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {reportTemplates.map((template) => {
        const Icon = template.icon;
        const isLoading = generateReportMutation.isPending;

        return (
          <Card
            key={template.id}
            className="hover:shadow-md transition-shadow cursor-pointer"
            data-testid={`report-template-${template.id}`}
          >
            <CardContent className="p-6">
              <div
                className={`w-12 h-12 ${template.bgColor} rounded-lg flex items-center justify-center mb-4`}
              >
                <Icon className={`${template.iconColor} text-xl h-6 w-6`} />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">{template.title}</h3>
              <p className="text-sm text-gray-600 mb-4">{template.description}</p>
              <Button
                className={`w-full text-white transition-colors ${template.buttonColor}`}
                onClick={() => handleGenerateReport(template)}
                disabled={isLoading}
                data-testid={`button-generate-${template.id}`}
              >
                <Download className="mr-2 h-4 w-4" />
                {isLoading
                  ? "Generating..."
                  : template.id === "excel-workbook"
                  ? "Export Excel"
                  : template.id === "bim-export"
                  ? "Export IFC"
                  : "Generate PDF"}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
