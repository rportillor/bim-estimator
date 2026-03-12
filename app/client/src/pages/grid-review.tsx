// client/src/pages/grid-review.tsx
// Grid Review & Human-in-the-Loop page
// Routes: /projects/:projectId/grid-review

import { useParams } from "wouter";
import { GridReviewDashboard } from "@/components/grid/GridReviewDashboard";

export default function GridReviewPage() {
  const { projectId } = useParams<{ projectId: string }>();

  if (!projectId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Project Not Found</h2>
          <p className="text-muted-foreground">
            Please select a valid project to review grid detection results.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6">
      <GridReviewDashboard projectId={projectId} />
    </div>
  );
}
