import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  AlertTriangle, 
  Shield, 
  Bell,
  CheckCircle,
  XCircle
} from 'lucide-react';

interface PlanUsage {
  planName: string;
  codesLicense: boolean;
  tokensUsed: number;
  tokensRemaining: number;
  monthlyLimit: number;
  dailyLimit: number;
  usagePercentage: number;
  costIncurred: number;
  alert75Triggered: boolean;
}

interface AdminNotification {
  id: string;
  type: 'usage_alert' | 'budget_exceeded' | 'plan_change';
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
  acknowledged: boolean;
  planName: string;
  usagePercentage?: number;
}

interface AdminUsageSummary {
  plans: PlanUsage[];
  alerts: AdminNotification[];
  totalCost: number;
  totalTokens: number;
}

export function AdminCostDashboard() {
  const { data: summary, isLoading, refetch } = useQuery<{ success: boolean; data: AdminUsageSummary }>({
    queryKey: ['/api/admin/usage-summary'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const acknowledgeAlert = async (alertId: string) => {
    try {
      await fetch(`/api/admin/notifications/${alertId}/acknowledge`, {
        method: 'POST',
      }).catch(err => {
        console.error('Failed to acknowledge alert:', err);
        throw err;
      });
      refetch();
    } catch (error) {
      console.error('Failed to acknowledge alert:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <Shield className="h-6 w-6" />
          Administrator Cost Dashboard
        </h1>
        <div className="animate-pulse">Loading cost monitoring data...</div>
      </div>
    );
  }

  const usageData = summary?.data;
  if (!usageData) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Administrator Cost Dashboard</h1>
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>No usage data available</AlertDescription>
        </Alert>
      </div>
    );
  }

  // Get alerts by severity
  const criticalAlerts = usageData.alerts.filter(a => a.severity === 'critical');
  const warningAlerts = usageData.alerts.filter(a => a.severity === 'warning');

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="h-6 w-6" />
          Administrator Cost Dashboard
        </h1>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            Auto-refresh: 30s
          </Badge>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Critical Alerts */}
      {criticalAlerts.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="font-semibold mb-2">Critical Alerts ({criticalAlerts.length})</div>
            {criticalAlerts.slice(0, 3).map(alert => (
              <div key={alert.id} className="flex items-center justify-between py-1">
                <span className="text-sm">{alert.message}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => acknowledgeAlert(alert.id)}
                >
                  Acknowledge
                </Button>
              </div>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {/* Warning Alerts */}
      {warningAlerts.length > 0 && (
        <Alert>
          <Bell className="h-4 w-4" />
          <AlertDescription>
            <div className="font-semibold mb-2">Usage Warnings ({warningAlerts.length})</div>
            {warningAlerts.slice(0, 2).map(alert => (
              <div key={alert.id} className="flex items-center justify-between py-1">
                <span className="text-sm">{alert.message}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => acknowledgeAlert(alert.id)}
                >
                  Acknowledge
                </Button>
              </div>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Monthly Cost</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ${usageData.totalCost.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Tokens Used</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {usageData.totalTokens.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Active Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {usageData.alerts.length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Plans Monitored</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {usageData.plans.length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Plan Usage Details */}
      <div className="grid gap-4">
        <h2 className="text-xl font-semibold">Plan Usage Details</h2>
        
        {usageData.plans.map((plan, index) => {
          const isOver75 = plan.usagePercentage >= 75;
          const isOver90 = plan.usagePercentage >= 90;
          const isOverLimit = plan.usagePercentage >= 100;
          
          return (
            <Card key={index} className={`${isOverLimit ? 'border-red-500' : isOver90 ? 'border-orange-500' : ''}`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <span className="capitalize">{plan.planName}</span>
                    {plan.codesLicense && (
                      <Badge variant="secondary">+ Codes License</Badge>
                    )}
                    {plan.alert75Triggered && (
                      <Badge variant="destructive">75% Alert</Badge>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {isOverLimit ? (
                      <XCircle className="h-5 w-5 text-red-500" />
                    ) : (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Usage Progress Bar */}
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span>Monthly Usage</span>
                    <span className="font-medium">
                      {plan.usagePercentage.toFixed(1)}% 
                      ({plan.tokensUsed.toLocaleString()}/{plan.monthlyLimit.toLocaleString()} tokens)
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div 
                      className={`h-3 rounded-full transition-all duration-300 ${
                        isOverLimit ? 'bg-red-500' : 
                        isOver90 ? 'bg-orange-500' : 
                        isOver75 ? 'bg-yellow-500' : 
                        'bg-green-500'
                      }`}
                      style={{ width: `${Math.min(plan.usagePercentage, 100)}%` }}
                    />
                  </div>
                </div>

                {/* Usage Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="font-medium">Tokens Remaining</div>
                    <div className="text-blue-600">
                      {plan.tokensRemaining.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Daily Limit</div>
                    <div>{plan.dailyLimit.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="font-medium">Current Cost</div>
                    <div className="text-green-600">
                      ${plan.costIncurred.toFixed(4)}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Status</div>
                    <div className={`font-medium ${
                      isOverLimit ? 'text-red-600' : 
                      isOver75 ? 'text-orange-600' : 
                      'text-green-600'
                    }`}>
                      {isOverLimit ? 'Over Limit' : 
                       isOver75 ? 'High Usage' : 
                       'Normal'}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* All Notifications */}
      {usageData.alerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              All Notifications ({usageData.alerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {usageData.alerts.map(alert => (
                <div 
                  key={alert.id} 
                  className={`p-3 rounded-lg border ${
                    alert.severity === 'critical' ? 'border-red-200 bg-red-50' :
                    alert.severity === 'warning' ? 'border-orange-200 bg-orange-50' :
                    'border-blue-200 bg-blue-50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge 
                          variant={
                            alert.severity === 'critical' ? 'destructive' :
                            alert.severity === 'warning' ? 'default' :
                            'secondary'
                          }
                        >
                          {alert.severity.toUpperCase()}
                        </Badge>
                        <span className="text-sm text-gray-600">
                          {new Date(alert.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-sm">{alert.message}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => acknowledgeAlert(alert.id)}
                    >
                      Acknowledge
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}