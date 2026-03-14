import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ComplianceCheck } from "@shared/schema";

interface ComplianceOverviewProps {
  complianceChecks?: ComplianceCheck[];
  isLoading: boolean;
}

export default function ComplianceOverview({ complianceChecks, isLoading }: ComplianceOverviewProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[...Array(2)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const canadianStandards = complianceChecks?.filter(check => 
    check.standard.includes('NBC') || check.standard.includes('CSA')
  ) || [];

  const usStandards = complianceChecks?.filter(check => 
    check.standard.includes('IBC') || check.standard.includes('ASCE') || check.standard.includes('AISC')
  ) || [];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "Passed":
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "Review Required":
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case "Failed":
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <CheckCircle className="h-5 w-5 text-green-500" />;
    }
  };

  const getStatusBg = (status: string) => {
    switch (status) {
      case "Passed":
        return "bg-green-50";
      case "Review Required":
        return "bg-yellow-50";
      case "Failed":
        return "bg-red-50";
      default:
        return "bg-green-50";
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "Passed":
        return "text-green-600";
      case "Review Required":
        return "text-yellow-600";
      case "Failed":
        return "text-red-600";
      default:
        return "text-green-600";
    }
  };

  const renderStandardsGroup = (standards: ComplianceCheck[], title: string) => (
    <Card className="shadow-sm border">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {standards.map((check) => (
            <div 
              key={check.id}
              className={`flex items-center justify-between p-3 rounded-lg ${getStatusBg(check.status)}`}
              data-testid={`compliance-check-${check.id}`}
            >
              <div className="flex items-center">
                {getStatusIcon(check.status)}
                <span className="font-medium ml-3">{check.standard} - {check.requirement}</span>
              </div>
              <span className={`text-sm ${getStatusText(check.status)}`}>
                {check.status}
              </span>
            </div>
          ))}
          {standards.length === 0 && (
            <p className="text-gray-500 text-sm">No compliance checks available</p>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {renderStandardsGroup(canadianStandards, "Canadian Standards (CSA/NBC)")}
      {renderStandardsGroup(usStandards, "US Standards (IBC/ASCE)")}
    </div>
  );
}
