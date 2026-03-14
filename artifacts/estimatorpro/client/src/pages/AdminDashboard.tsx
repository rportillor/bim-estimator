import { AdminCostDashboard } from '@/components/AdminCostDashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Users, Settings, Activity } from 'lucide-react';

export default function AdminDashboard() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto py-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Shield className="h-8 w-8 text-blue-600" />
            Administrator Dashboard
          </h1>
          <p className="text-gray-600 mt-2">
            Comprehensive cost monitoring and plan management for EstimatorPro
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="border-blue-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-blue-600 flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Cost Monitoring
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">Active</div>
              <p className="text-sm text-gray-600">Real-time tracking enabled</p>
            </CardContent>
          </Card>

          <Card className="border-green-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-green-600 flex items-center gap-2">
                <Users className="h-4 w-4" />
                Plan Types
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">6</div>
              <p className="text-sm text-gray-600">Standard, Pro, Enterprise</p>
            </CardContent>
          </Card>

          <Card className="border-orange-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-orange-600 flex items-center gap-2">
                <Settings className="h-4 w-4" />
                75% Alerts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">Enabled</div>
              <p className="text-sm text-gray-600">Automatic notifications</p>
            </CardContent>
          </Card>

          <Card className="border-purple-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-purple-600">
                Access Level
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">Admin</div>
              <p className="text-sm text-gray-600">Full system access</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Cost Dashboard */}
        <AdminCostDashboard />
      </div>
    </div>
  );
}