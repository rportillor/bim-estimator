// client/src/pages/estimator.tsx
// ═══════════════════════════════════════════════════════════════════════════════
// ESTIMATOR PAGE — QS Level 5 / CIQS Estimating Dashboard
// ═══════════════════════════════════════════════════════════════════════════════
//
// Page wrapper around QSLevel5Dashboard.
//
// Supported routes (all wired in App.tsx):
//   /estimator                              — top-level entry, no project selected
//   /projects/:projectId/estimator          — project-scoped, no model
//   /projects/:projectId/estimator/:modelId — project + model fully scoped
//
// The dashboard component reads projectId and modelId from useParams() itself
// and gracefully handles the absence of either (shows "Select a project").
//
// EU-1 FIX: This page was missing from the codebase. QSLevel5Dashboard existed
// as a component but had no page wrapper and no route in App.tsx, so the 26
// estimator API endpoints were unreachable from the UI.
// ═══════════════════════════════════════════════════════════════════════════════

import QSLevel5Dashboard from "@/components/qs-level5-dashboard";

export default function EstimatorPage() {
  return <QSLevel5Dashboard />;
}
