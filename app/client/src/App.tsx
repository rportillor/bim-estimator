import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import MainLayout from "@/components/layout/main-layout";
import { Loader2 } from "lucide-react";
import { lazy, Suspense } from "react";

const Dashboard = lazy(() => import("@/pages/dashboard"));
const Projects = lazy(() => import("@/pages/projects"));
const ProjectAnalysis = lazy(() => import("@/pages/project-analysis"));
const Upload = lazy(() => import("@/pages/upload"));
const Documents = lazy(() => import("@/pages/documents"));
const BoQ = lazy(() => import("@/pages/boq"));
const BIM = lazy(() => import("@/pages/bim"));
const Compliance = lazy(() => import("@/pages/compliance"));
const Reports = lazy(() => import("@/pages/reports"));
const Profile = lazy(() => import("@/pages/profile"));
const Settings = lazy(() => import("@/pages/settings"));
const RfiPage = lazy(() => import("@/pages/RfiPage"));
const ChangeRequestPage = lazy(() => import("@/pages/ChangeRequestPage"));
const GridReview = lazy(() => import("@/pages/grid-review"));
const Pricing = lazy(() => import("@/pages/pricing"));
const SubscriptionSuccess = lazy(() => import("@/pages/subscription-success"));
const AdminDashboard = lazy(() => import("@/pages/AdminDashboard"));
const ReportDashboard = lazy(() => import("@/pages/report-dashboard"));
const BIMCoordination = lazy(() => import("@/pages/bim-coordination"));
const AuthPage = lazy(() => import("@/pages/auth"));
const NotFound = lazy(() => import("@/pages/not-found"));
const UatSignoff = lazy(() => import("@/pages/uat-signoff"));
const TestDashboard = lazy(() => import("@/pages/test-dashboard"));
const AIConfiguration = lazy(() => import("@/pages/ai-configuration"));
// EU-1 FIX: QS Level 5 / CIQS Estimating Dashboard — was missing, unreachable from UI
const Estimator = lazy(() => import("@/pages/estimator"));
// M-4: Benchmark Comparison page — server-side modules were complete, page was missing
const Benchmark = lazy(() => import("@/pages/benchmark"));

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="text-center">
      <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
      <p className="text-sm text-muted-foreground">Loading page...</p>
    </div>
  </div>
);

// Role-based route guard for admin pages
function AdminRoute() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "Admin" || user?.role === "super_admin";
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-muted-foreground">You do not have permission to access the admin dashboard.</p>
        </div>
      </div>
    );
  }
  return <AdminDashboard />;
}

function AuthenticatedRouter() {
  return (
    <MainLayout>
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/projects" component={Projects} />
          <Route path="/projects/:id" component={ProjectAnalysis} />
          <Route path="/projects/:id/analysis" component={ProjectAnalysis} />
          <Route path="/projects/:projectId/rfis" component={RfiPage} />
          <Route path="/projects/:projectId/change-requests" component={ChangeRequestPage} />
          <Route path="/projects/:projectId/grid-review" component={GridReview} />
          <Route path="/projects/:projectId/bim-coordination" component={BIMCoordination} />
          <Route path="/projects/:projectId/upload" component={Upload} />
          <Route path="/upload" component={Upload} />
          <Route path="/documents" component={Documents} />
          <Route path="/boq" component={BoQ} />
          <Route path="/bim" component={BIM} />
          <Route path="/projects/:projectId/bim" component={BIM} />
          <Route path="/projects/:projectId/bim/:modelId" component={BIM} />
          <Route path="/compliance" component={Compliance} />
          <Route path="/reports" component={Reports} />
          <Route path="/reports/dashboard" component={ReportDashboard} />
          <Route path="/profile" component={Profile} />
          <Route path="/settings" component={Settings} />
          <Route path="/admin" component={AdminRoute} />
          <Route path="/coordination" component={BIMCoordination} />
          <Route path="/projects/:projectId/coordination" component={BIMCoordination} />
          <Route path="/projects/:projectId/coordination/:modelId" component={BIMCoordination} />
          {/* EU-1 + EU-4 FIX: Estimator routes — QS Level 5 / CIQS dashboard */}
          <Route path="/estimator" component={Estimator} />
          <Route path="/projects/:projectId/estimator" component={Estimator} />
          <Route path="/projects/:projectId/estimator/:modelId" component={Estimator} />
          {/* M-4: Benchmark Comparison */}
          <Route path="/benchmark" component={Benchmark} />
          <Route path="/projects/:projectId/benchmark" component={Benchmark} />
          <Route path="/projects/:projectId/benchmark/:modelId" component={Benchmark} />
          {/* QA */}
          <Route path="/qa/dashboard" component={TestDashboard} />
          <Route path="/qa/uat-signoff" component={UatSignoff} />
          <Route path="/settings/ai" component={AIConfiguration} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </MainLayout>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading EstimatorPro...</p>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/pricing" component={Pricing} />
        <Route path="/subscription/success" component={SubscriptionSuccess} />
        <Route>
          {isAuthenticated ? <AuthenticatedRouter /> : <AuthPage />}
        </Route>
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <div className="app-bg min-h-screen">
            <AppContent />
          </div>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
