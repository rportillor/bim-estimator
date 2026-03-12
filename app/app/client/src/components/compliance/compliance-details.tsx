import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ComplianceCheck } from "@shared/schema";

interface ComplianceDetailsProps {
  complianceChecks?: ComplianceCheck[];
  isLoading: boolean;
}

export default function ComplianceDetails({ complianceChecks, isLoading }: ComplianceDetailsProps) {
  if (isLoading) {
    return (
      <Card className="shadow-sm border">
        <CardHeader>
          <CardTitle>Detailed Compliance Report</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const failedChecks = complianceChecks?.filter(check => check.status === "Failed") || [];
  const reviewRequiredChecks = complianceChecks?.filter(check => check.status === "Review Required") || [];

  const renderComplianceIssue = (check: ComplianceCheck, type: 'failed' | 'review') => {
    const isFailedIssue = type === 'failed';
    const borderColor = isFailedIssue ? 'border-red-200' : 'border-yellow-200';
    const bgColor = isFailedIssue ? 'bg-red-50' : 'bg-yellow-50';
    const iconColor = isFailedIssue ? 'text-red-500' : 'text-yellow-500';
    const textColor = isFailedIssue ? 'text-red-900' : 'text-yellow-900';
    const detailColor = isFailedIssue ? 'text-red-700' : 'text-yellow-700';
    const buttonColor = isFailedIssue ? 'bg-red-600 hover:bg-red-700' : 'bg-yellow-600 hover:bg-yellow-700';

    return (
      <div 
        key={check.id}
        className={`border ${borderColor} rounded-lg p-4 ${bgColor}`}
        data-testid={`compliance-issue-${check.id}`}
      >
        <div className="flex items-start">
          {isFailedIssue ? 
            <XCircle className={`${iconColor} mt-1 mr-3 h-5 w-5`} /> :
            <AlertCircle className={`${iconColor} mt-1 mr-3 h-5 w-5`} />
          }
          <div className="flex-1">
            <h4 className={`font-semibold ${textColor}`}>
              {check.standard} {isFailedIssue ? 'Non-Compliance Issue' : 'Review Required'}
            </h4>
            <p className={`${detailColor} mt-1`}>{check.details}</p>
            {check.recommendation && (
              <div className="mt-3">
                <p className={`text-sm ${detailColor}`}>
                  <strong>Recommendation:</strong> {check.recommendation}
                </p>
              </div>
            )}
            <Button 
              className={`mt-3 text-white text-sm ${buttonColor}`}
              size="sm"
              onClick={() => {
                if (isFailedIssue) {
                  alert(`Generating AI-powered solution for ${check.standard} compliance issue...`);
                } else {
                  alert(`Opening detailed review for ${check.standard} requirement...`);
                }
              }}
              data-testid={`button-${isFailedIssue ? 'generate-solution' : 'review-details'}-${check.id}`}
            >
              {isFailedIssue ? 'Generate Solution' : 'Review Details'}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Card className="shadow-sm border">
      <CardHeader>
        <CardTitle>Detailed Compliance Report</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {failedChecks.map(check => renderComplianceIssue(check, 'failed'))}
          {reviewRequiredChecks.map(check => renderComplianceIssue(check, 'review'))}
          
          {failedChecks.length === 0 && reviewRequiredChecks.length === 0 && (
            <div className="text-center py-8">
              <p className="text-gray-500">No compliance issues found. All checks passed successfully.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
