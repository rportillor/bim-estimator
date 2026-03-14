import { useParams } from "wouter";
import { RfiDashboard } from "@/components/rfi/RfiDashboard";

export default function RfiPage() {
  const { projectId } = useParams<{ projectId: string }>();

  if (!projectId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Project Not Found</h2>
          <p className="text-muted-foreground">
            Please select a valid project to view RFIs.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6">
      <RfiDashboard projectId={projectId} />
    </div>
  );
}