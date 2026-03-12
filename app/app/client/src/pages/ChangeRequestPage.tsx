import { useParams } from "wouter";
import { ChangeRequestDashboard } from "@/components/change-requests/ChangeRequestDashboard";

export default function ChangeRequestPage() {
  const { projectId } = useParams<{ projectId: string }>();

  if (!projectId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Project Not Found</h2>
          <p className="text-muted-foreground">
            Please select a valid project to view Change Requests.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6">
      <ChangeRequestDashboard projectId={projectId} />
    </div>
  );
}