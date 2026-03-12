import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import ComplianceOverview from "@/components/compliance/compliance-overview";
import ComplianceDetails from "@/components/compliance/compliance-details";
import ComplianceSelector from "@/components/compliance/compliance-selector";
import type { ComplianceCheck } from "@shared/schema";

export default function Compliance() {
  // Resolve project ID from route params; fall back to first available project
  const params = useParams<{ projectId?: string }>();

  const { data: projects } = useQuery<{ id: string }[]>({
    queryKey: ['/api/projects'],
    enabled: !params.projectId,
  });

  const projectId: string | undefined = params.projectId ?? projects?.[0]?.id;

  const { data: complianceChecks, isLoading } = useQuery<ComplianceCheck[]>({
    queryKey: ['/api/projects', projectId, 'compliance-checks'],
    queryFn: async () => {
      if (!projectId) return [];
      const res = await apiRequest("GET", `/api/projects/${projectId}/compliance-checks`);
      return res.json();
    },
    enabled: !!projectId,
  });

  if (!projectId) {
    return (
      <div className="p-6">
        <p className="text-gray-500">No project selected. Open a project to view compliance checks.</p>
      </div>
    );
  }

  return (
    <div>
      <header className="bg-white p-6 border-b">
        <h2 className="text-3xl font-bold text-gray-900">Compliance Verification</h2>
        <p className="text-gray-600 mt-1">
          Comprehensive verification against ULC, fire protection, plumbing, electrical, HVAC, and all building systems
        </p>
      </header>

      <div className="p-6 space-y-8">
        <ComplianceSelector projectId={projectId} />
        <ComplianceOverview complianceChecks={complianceChecks} isLoading={isLoading} />
        <ComplianceDetails complianceChecks={complianceChecks} isLoading={isLoading} />
      </div>
    </div>
  );
}
