import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Building, 
  DollarSign, 
  Clock, 
  CheckCircle,
  AlertTriangle,
  FileText,
  TrendingUp,
  PieChart,
  Target,
  Activity
} from "lucide-react";

interface QuickInsightsProps {
  stats?: {
    activeProjects: number;
    totalEstimates: string;
    avgTime: string;
    complianceRate: string;
  };
  isLoading: boolean;
}

export default function QuickInsights({ stats, isLoading }: QuickInsightsProps) {
  // Extended insights data
  const { data: insights, isLoading: insightsLoading } = useQuery({
    queryKey: ['/api/dashboard/insights'],
    enabled: !isLoading,
  });

  const loading = isLoading || insightsLoading;

  // Check if this is a new user with no data
  const hasData = (stats?.activeProjects || 0) > 0 || ((insights as any)?.recentActivity?.documentsProcessed || 0) > 0;
  
  // Use real data from API or fallback to zeros
  const safeStats = {
    activeProjects: stats?.activeProjects || 0,
    totalEstimates: stats?.totalEstimates || "$0.0M",
    avgTime: stats?.avgTime || "0 hrs", 
    complianceRate: stats?.complianceRate || "0%"
  };

  const safeInsights = insights ? {
    costBreakdown: (insights as any).costBreakdown || { materials: 0, labor: 0, equipment: 0, overhead: 0 },
    complianceDetails: (insights as any).complianceDetails || { passed: 0, warning: 0, failed: 0, total: 0, overallScore: 0 },
    recentActivity: (insights as any).recentActivity || { documentsProcessed: 0, boqItemsGenerated: 0, complianceChecks: 0 },
    trends: (insights as any).trends || { projectGrowth: 0, estimateAccuracy: 0, processingEfficiency: 0 }
  } : {
    costBreakdown: { materials: 0, labor: 0, equipment: 0, overhead: 0 },
    complianceDetails: { passed: 0, warning: 0, failed: 0, total: 0, overallScore: 0 },
    recentActivity: { documentsProcessed: 0, boqItemsGenerated: 0, complianceChecks: 0 },
    trends: { projectGrowth: 0, estimateAccuracy: 0, processingEfficiency: 0 }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {[...Array(8)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const mainStats = [
    {
      label: "Active Projects",
      value: safeStats.activeProjects,
      icon: Building,
      bgColor: "bg-blue-50",
      iconColor: "text-blue-600",
      trend: hasData ? 0 : null,
      description: "Currently under analysis",
      emptyMessage: "Upload documents to start"
    },
    {
      label: "Total Estimates",
      value: safeStats.totalEstimates,
      icon: DollarSign,
      bgColor: "bg-green-50",
      iconColor: "text-green-600",
      trend: hasData ? 0 : null,
      description: "Cumulative project value",
      emptyMessage: "Estimates will appear here"
    },
    {
      label: "Avg. Processing Time",
      value: safeStats.avgTime,
      icon: Clock,
      bgColor: "bg-orange-50",
      iconColor: "text-orange-600",
      trend: hasData ? 0 : null,
      description: "AI analysis duration",
      emptyMessage: "Tracks analysis speed"
    },
    {
      label: "Compliance Rate",
      value: safeStats.complianceRate,
      icon: CheckCircle,
      bgColor: "bg-emerald-50",
      iconColor: "text-emerald-600",
      trend: hasData ? 0 : null,
      description: "Building code adherence",
      emptyMessage: "Shows code compliance"
    }
  ];

  const costBreakdown = safeInsights.costBreakdown;
  const complianceDetails = safeInsights.complianceDetails; 
  const activityStats = safeInsights.recentActivity;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Main Statistics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
        {mainStats.map((stat, index) => {
          const Icon = stat.icon;
          const isPositiveTrend = (stat.trend || 0) >= 0;
          
          return (
            <Card key={index} className="shadow-sm border hover:shadow-md transition-shadow">
              <CardContent className="p-4 sm:p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center">
                    <div className={`p-2 sm:p-3 ${stat.bgColor} rounded-lg`}>
                      <Icon className={`${stat.iconColor} h-5 w-5 sm:h-6 sm:w-6`} />
                    </div>
                    <div className="ml-3 sm:ml-4 min-w-0 flex-1">
                      <p className="text-xs sm:text-sm text-gray-600 truncate">{stat.label}</p>
                      <p className="text-xl sm:text-2xl font-bold truncate" data-testid={`stat-${stat.label.toLowerCase().replace(/\s+/g, '-')}`}>
                        {stat.value}
                      </p>
                      <p className="text-xs text-gray-500 mt-1 truncate">{stat.description}</p>
                    </div>
                  </div>
                  {stat.trend !== null ? (
                    <div className="text-right flex-shrink-0">
                      <div className={`flex items-center text-xs sm:text-sm ${
                        isPositiveTrend ? 'text-green-600' : 'text-red-600'
                      }`}>
                        <TrendingUp className={`h-3 w-3 sm:h-4 sm:w-4 mr-1 ${
                          isPositiveTrend ? '' : 'transform rotate-180'
                        }`} />
                        {Math.abs(stat.trend || 0)}%
                      </div>
                      <p className="text-xs text-gray-500">vs last month</p>
                    </div>
                  ) : (
                    <div className="text-right flex-shrink-0">
                      <Badge variant="secondary" className="bg-blue-100 text-blue-700 text-xs">
                        New
                      </Badge>
                      <p className="text-xs text-gray-500 mt-1">
                        {(stat as any).emptyMessage}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Detailed Insights Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        
        {/* Cost Breakdown */}
        <Card className="shadow-sm border">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center text-lg">
              <PieChart className="h-5 w-5 mr-2 text-blue-600" />
              Cost Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Materials</span>
                <span className="text-sm text-gray-600">{costBreakdown.materials}%</span>
              </div>
              <Progress value={costBreakdown.materials} className="h-2" />
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Labor</span>
                <span className="text-sm text-gray-600">{costBreakdown.labor}%</span>
              </div>
              <Progress value={costBreakdown.labor} className="h-2" />
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Equipment</span>
                <span className="text-sm text-gray-600">{costBreakdown.equipment}%</span>
              </div>
              <Progress value={costBreakdown.equipment} className="h-2" />
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Overhead</span>
                <span className="text-sm text-gray-600">{costBreakdown.overhead}%</span>
              </div>
              <Progress value={costBreakdown.overhead} className="h-2" />
            </div>
          </CardContent>
        </Card>

        {/* Compliance Status */}
        <Card className="shadow-sm border">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center text-lg">
              <Target className="h-5 w-5 mr-2 text-emerald-600" />
              Compliance Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <CheckCircle className="h-4 w-4 text-green-600 mr-2" />
                <span className="text-sm font-medium">Passed</span>
              </div>
              <Badge variant="secondary" className="bg-green-100 text-green-800">
                {complianceDetails.passed}
              </Badge>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <AlertTriangle className="h-4 w-4 text-yellow-600 mr-2" />
                <span className="text-sm font-medium">Warnings</span>
              </div>
              <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                {complianceDetails.warning}
              </Badge>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <AlertTriangle className="h-4 w-4 text-red-600 mr-2" />
                <span className="text-sm font-medium">Failed</span>
              </div>
              <Badge variant="secondary" className="bg-red-100 text-red-800">
                {complianceDetails.failed}
              </Badge>
            </div>
            
            <div className="pt-2 border-t">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Overall Score</span>
                <span className="text-green-600 font-bold">
                  {complianceDetails.total > 0 
                    ? `${Math.round((complianceDetails.passed / complianceDetails.total) * 100)}%`
                    : (complianceDetails as any).overallScore !== undefined 
                      ? `${(complianceDetails as any).overallScore}%`
                      : "0%"
                  }
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="shadow-sm border">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center text-lg">
              <Activity className="h-5 w-5 mr-2 text-purple-600" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <FileText className="h-4 w-4 text-blue-600 mr-2" />
                <span className="text-sm font-medium">Documents Processed</span>
              </div>
              <span className="text-lg font-bold text-blue-600">
                {activityStats.documentsProcessed}
              </span>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Building className="h-4 w-4 text-green-600 mr-2" />
                <span className="text-sm font-medium">BoQ Items Generated</span>
              </div>
              <span className="text-lg font-bold text-green-600">
                {activityStats.boqItemsGenerated.toLocaleString()}
              </span>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <CheckCircle className="h-4 w-4 text-emerald-600 mr-2" />
                <span className="text-sm font-medium">Compliance Checks</span>
              </div>
              <span className="text-lg font-bold text-emerald-600">
                {activityStats.complianceChecks}
              </span>
            </div>
            
            <div className="pt-2 border-t">
              <p className="text-xs text-gray-500">Last 30 days activity</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}