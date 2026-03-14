import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle,
  Sparkles,
  ArrowRight,
  Crown,
  Zap
} from "lucide-react";

export default function SubscriptionSuccess() {
  const [, navigate] = useLocation();
  
  // Get session ID from URL params
  const searchParams = new URLSearchParams(window.location.search);
  const sessionId = searchParams.get('session_id');

  const { data: _session, isLoading } = useQuery({
    queryKey: ['/api/subscription/session', sessionId],
    enabled: !!sessionId,
  });

  useEffect(() => {
    // Redirect to dashboard after 10 seconds
    const timer = setTimeout(() => {
      navigate('/dashboard');
    }, 10000);

    return () => clearTimeout(timer);
  }, [navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-blue-50 to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Confirming your subscription...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-blue-50 to-purple-50 flex items-center justify-center p-6">
      <div className="max-w-2xl w-full">
        
        {/* Success Card */}
        <Card className="text-center shadow-xl border-0 bg-white/90 backdrop-blur">
          <CardHeader className="pb-4">
            <div className="mx-auto w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="h-10 w-10 text-green-600" />
            </div>
            <CardTitle className="text-3xl font-bold text-gray-900 mb-2">
              Welcome to EstimatorPro!
            </CardTitle>
            <p className="text-lg text-gray-600">
              Your subscription has been activated successfully
            </p>
          </CardHeader>

          <CardContent className="space-y-6">
            
            {/* Plan Details */}
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-6">
              <div className="flex items-center justify-center mb-4">
                <Crown className="h-6 w-6 text-purple-600 mr-2" />
                <Badge className="bg-purple-600 text-white px-4 py-1">
                  Professional Plan Active
                </Badge>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div className="text-center">
                  <div className="font-semibold text-gray-900">Projects</div>
                  <div className="text-purple-600">Up to 10</div>
                </div>
                <div className="text-center">
                  <div className="font-semibold text-gray-900">Storage</div>
                  <div className="text-purple-600">5 GB</div>
                </div>
                <div className="text-center">
                  <div className="font-semibold text-gray-900">Support</div>
                  <div className="text-purple-600">Priority</div>
                </div>
              </div>
            </div>

            {/* Features Unlocked */}
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center justify-center">
                <Sparkles className="h-5 w-5 mr-2 text-yellow-500" />
                Features Unlocked
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                {[
                  'Advanced AI Analysis',
                  'Comprehensive BoQ Generation',
                  'All Export Formats',
                  'Building Code Compliance',
                  'BIM Integration',
                  'Priority Support'
                ].map((feature, index) => (
                  <div key={index} className="flex items-center">
                    <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Call to Action */}
            <div className="space-y-4 pt-4">
              <Button 
                onClick={() => navigate('/dashboard')}
                className="w-full md:w-auto bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-8 py-3"
                size="lg"
              >
                <Zap className="h-4 w-4 mr-2" />
                Start Building Your First Project
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
              
              <div className="flex justify-center space-x-4 text-sm">
                <Button variant="outline" onClick={() => navigate('/projects')}>
                  View Projects
                </Button>
                <Button variant="outline" onClick={() => navigate('/reports')}>
                  Manage Billing
                </Button>
              </div>
            </div>

            {/* Auto-redirect Notice */}
            <div className="text-xs text-gray-500 pt-4 border-t">
              You'll be automatically redirected to your dashboard in a few seconds
            </div>
          </CardContent>
        </Card>

        {/* Next Steps */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
          <div className="bg-white/60 backdrop-blur rounded-lg p-4">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-2">
              <span className="text-blue-600 font-semibold">1</span>
            </div>
            <h4 className="font-medium text-gray-900">Upload Documents</h4>
            <p className="text-sm text-gray-600">Start by uploading your construction drawings and specifications</p>
          </div>
          
          <div className="bg-white/60 backdrop-blur rounded-lg p-4">
            <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-2">
              <span className="text-purple-600 font-semibold">2</span>
            </div>
            <h4 className="font-medium text-gray-900">AI Analysis</h4>
            <p className="text-sm text-gray-600">Let our AI analyze and extract quantities automatically</p>
          </div>
          
          <div className="bg-white/60 backdrop-blur rounded-lg p-4">
            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-2">
              <span className="text-green-600 font-semibold">3</span>
            </div>
            <h4 className="font-medium text-gray-900">Generate Reports</h4>
            <p className="text-sm text-gray-600">Export professional BoQ and compliance reports</p>
          </div>
        </div>
      </div>
    </div>
  );
}