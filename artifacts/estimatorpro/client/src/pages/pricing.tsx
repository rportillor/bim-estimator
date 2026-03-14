import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { 
  Check, 
  X,
  Building,
  Zap,
  Shield,
  Crown,
  Sparkles,
  ArrowRight,
  Clock,
  Star
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PlanFeature {
  name: string;
  starter: boolean | string;
  pro: boolean | string;
  enterprise: boolean | string;
}

export default function Pricing() {
  const [isAnnual, setIsAnnual] = useState(false);
  const [licenseType, setLicenseType] = useState<'byol' | 'included'>('byol');
  const { toast } = useToast();

  const byolPlans = [
    {
      id: 'starter_byol',
      name: 'Starter',
      displayName: 'Starter (BYOL)',
      icon: Building,
      description: 'Perfect for small contractors with existing licenses',
      monthlyPrice: 49, // Exact price from Stripe
      annualMonthlyEquivalent: 44.10, // Exact price from Stripe (10% discount)
      currency: 'CAD',
      color: 'blue',
      popular: false,
      features: [
        '1 discipline included',
        'Code compliance checker (BYOL)',
        '1 GB secure storage (~20 projects)',
        'PDF/spec/drawing parsing',
        'AI-generated Bill of Quantities',
        'Export to Excel / PDF'
      ],
      limitations: [
        'Building code license not included',
        'Limited to 1 discipline'
      ]
    },
    {
      id: 'pro_byol',
      name: 'Professional',
      displayName: 'Professional (BYOL)',
      icon: Zap,
      description: 'For professionals with existing code subscriptions',
      monthlyPrice: 149, // Exact price from Stripe
      annualMonthlyEquivalent: 134.10, // $1,609.20 ÷ 12 = $134.10 CAD from Stripe
      currency: 'CAD',
      color: 'purple',
      popular: true,
      features: [
        'Any 3 disciplines included',
        '5 GB secure storage (~100 projects)',
        'Code compliance checker (BYOL)',
        '3D BIM model stubs (IFC/Revit)',
        'Team collaboration (up to 10 users)',
        'Priority email support'
      ],
      limitations: [
        'Building code license not included'
      ]
    },
    {
      id: 'enterprise_byol',
      name: 'Enterprise',
      displayName: 'Enterprise (BYOL)',
      icon: Crown,
      description: 'For large organizations with enterprise licenses',
      monthlyPrice: 499, // Exact price from Stripe
      annualMonthlyEquivalent: 449.10, // Exact price from Stripe (10% discount)
      currency: 'CAD',
      color: 'gold',
      popular: false,
      features: [
        'All disciplines (Structural, Mechanical, Electrical, Civil, Architectural)',
        'Code compliance checker (BYOL)',
        '🎯 EXCLUSIVE: Live RSMeans API access (95%+ accuracy)',
        '📊 Real-time market pricing & cost factors',
        '🌎 Metric/Imperial with Canadian provincial factors',
        'Unlimited projects & storage',
        'Integration with ERP & project management tools',
        'Dedicated account manager',
        'SLA-backed uptime',
        'Training & onboarding'
      ],
      limitations: [
        'Building code license not included'
      ]
    }
  ];

  const includedPlans = [
    {
      id: 'starter_included',
      name: 'Starter',
      displayName: 'Starter (Codes Included)',
      icon: Building,
      description: 'Complete starter solution with building codes included',
      monthlyPrice: 99, // Exact price from Stripe
      annualMonthlyEquivalent: 89.10, // $1,069.20 ÷ 12 = $89.10 CAD from Stripe
      currency: 'CAD',
      color: 'blue',
      popular: false,
      features: [
        '1 discipline included',
        'Code compliance checker (inclusive of licenses)',
        '1 GB secure storage (~20 projects)',
        'PDF/spec/drawing parsing',
        'AI-generated Bill of Quantities',
        'Export to Excel / PDF'
      ],
      limitations: []
    },
    {
      id: 'single_project',
      name: 'Single Project',
      displayName: 'Single Project (Codes Included)',
      icon: Building,
      description: 'Complete solution for individual projects',
      price: 349, // Exact price from Stripe
      currency: 'CAD',
      color: 'blue',
      popular: false,
      oneTime: true,
      features: [
        'Upload specs & drawings → get BoQ + BIM stub',
        'Code compliance checker (inclusive of licenses)',
        'Includes 1 GB storage for 1 year',
        'Extra discipline modules: +$100 each',
        'Extra storage: $10/GB'
      ],
      limitations: [
        'Single project only',
        'One-time purchase'
      ]
    },
    {
      id: 'pro_included',
      name: 'Professional', 
      displayName: 'Professional (All Inclusive)',
      icon: Zap,
      description: 'Full-featured solution for growing firms',
      monthlyPrice: 950, // Exact price from Stripe
      annualMonthlyEquivalent: 855, // Exact price from Stripe (10% discount)
      currency: 'CAD',
      color: 'purple',
      popular: true,
      features: [
        'Any 3 disciplines included',
        '5 GB secure storage (~100 projects)',
        'Code compliance checker (inclusive of licenses)',
        '3D BIM model stubs (IFC/Revit)',
        'Team collaboration (up to 10 users)',
        'Priority email support'
      ],
      limitations: []
    },
    {
      id: 'enterprise_included',
      name: 'Enterprise',
      displayName: 'Enterprise (Gold)',
      icon: Crown,
      description: 'Complete enterprise solution with full support',
      monthlyPrice: 5000, // Exact price from Stripe
      annualMonthlyEquivalent: 4500, // Exact price from Stripe (10% discount)
      currency: 'CAD',
      color: 'gold',
      popular: false,
      features: [
        'All disciplines (Structural, Mechanical, Electrical, Civil, Architectural)',
        'Code compliance checker (inclusive of licenses)',
        '🎯 EXCLUSIVE: Live RSMeans API access (95%+ accuracy)',
        '📊 Real-time market pricing & cost factors',
        '🌎 Metric/Imperial with Canadian provincial factors',
        '⚡ Priority RSMeans data processing',
        'Unlimited projects & storage',
        'Integration with ERP & project management tools',
        'Dedicated account manager',
        'SLA-backed uptime',
        'Training & onboarding'
      ],
      limitations: []
    }
  ];

  const plans = licenseType === 'byol' ? byolPlans : includedPlans;

  const detailedFeatures: PlanFeature[] = [
    { name: 'Active Projects', starter: '2', pro: '10', enterprise: 'Unlimited' },
    { name: 'Documents per Project', starter: '10', pro: '50', enterprise: 'Unlimited' },
    { name: 'Storage Space', starter: '1 GB', pro: '5 GB', enterprise: '20 GB' },
    { name: 'AI Analysis', starter: true, pro: true, enterprise: true },
    { name: 'BoQ Generation', starter: 'Basic', pro: 'Advanced', enterprise: 'Advanced' },
    { name: 'PDF Export', starter: true, pro: true, enterprise: true },
    { name: 'Excel Export', starter: false, pro: true, enterprise: true },
    { name: 'Word Export', starter: false, pro: true, enterprise: true },
    { name: 'Compliance Checks', starter: false, pro: true, enterprise: true },
    { name: 'BIM Integration', starter: false, pro: true, enterprise: true },
    { name: 'Custom Integration', starter: false, pro: false, enterprise: true },
    { name: 'Advanced Analytics', starter: false, pro: false, enterprise: true },
    { name: 'Priority Support', starter: false, pro: true, enterprise: true },
    { name: 'Custom Training', starter: false, pro: false, enterprise: true },
    { name: 'SLA Guarantee', starter: false, pro: false, enterprise: true },
  ];

  const checkoutMutation = useMutation({
    mutationFn: async (plan: string) => {
      const response = await apiRequest('POST', '/api/checkout', { plan, isAnnual });
      return response.json();
    },
    onSuccess: (data) => {
      window.location.href = data.checkoutUrl;
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleUpgrade = (planId: string) => {
    checkoutMutation.mutate(planId);
  };

  const formatPlanPrice = (plan: typeof plans[0]) => {
    // Handle one-time payment plans
    if ('oneTime' in plan && plan.oneTime) {
      return {
        price: `$${plan.price} ${plan.currency}`,
        billing: 'one-time payment',
        savings: null
      };
    }
    
    // Handle subscription plans with annual billing
    if (isAnnual && 'annualMonthlyEquivalent' in plan && plan.annualMonthlyEquivalent) {
      // Calculate totals clearly
      const monthlyTotal = plan.monthlyPrice * 12; // What you'd pay monthly for a year
      const annualTotal = plan.annualMonthlyEquivalent * 12; // What you pay with annual discount
      const savings = monthlyTotal - annualTotal; // Total savings
      const savingsPercent = Math.round((savings / monthlyTotal) * 100);
      
      return {
        price: `$${plan.annualMonthlyEquivalent} ${plan.currency}/mo`,
        billing: `$${annualTotal.toFixed(2)} ${plan.currency}/year`,
        savings: `Save $${savings.toFixed(2)} ${plan.currency}/year (${savingsPercent}% off annual)`
      };
    }
    
    // Handle regular monthly subscription plans
    return {
      price: `$${plan.monthlyPrice} ${plan.currency}/mo`,
      billing: 'billed monthly',
      savings: null
    };
  };

  const getColorClasses = (color: string, intensity: 'light' | 'medium' | 'dark' = 'medium') => {
    const colors = {
      blue: {
        light: 'bg-blue-50 text-blue-700 border-blue-200',
        medium: 'bg-blue-600 text-white',
        dark: 'bg-blue-700 text-white'
      },
      purple: {
        light: 'bg-purple-50 text-purple-700 border-purple-200',
        medium: 'bg-purple-600 text-white',
        dark: 'bg-purple-700 text-white'
      },
      gold: {
        light: 'bg-yellow-50 text-yellow-700 border-yellow-200',
        medium: 'bg-yellow-600 text-white',
        dark: 'bg-yellow-700 text-white'
      }
    };
    return colors[color as keyof typeof colors]?.[intensity] || colors.blue[intensity];
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      
      {/* Header */}
      <div className="container mx-auto px-6 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Choose Your Plan
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            AI-Powered Construction Estimating — Faster, Smarter, Code-Compliant.<br/>
            Start with a 14-day free trial. Choose BYOL for existing licenses or get codes included.
          </p>
          
          {/* License Type Toggle */}
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="bg-gray-100 rounded-lg p-1 flex">
              <button
                onClick={() => setLicenseType('byol')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  licenseType === 'byol' 
                    ? 'bg-white text-gray-900 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                BYOL (Bring Your License)
              </button>
              <button
                onClick={() => setLicenseType('included')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  licenseType === 'included' 
                    ? 'bg-white text-gray-900 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Building Codes Included
              </button>
            </div>
          </div>
          
          {/* Annual/Monthly Toggle */}
          <div className="flex items-center justify-center gap-4 mb-8">
            <span className={`text-sm font-medium ${!isAnnual ? 'text-gray-900' : 'text-gray-500'}`}>
              Monthly
            </span>
            <Switch
              checked={isAnnual}
              onCheckedChange={setIsAnnual}
              className="data-[state=checked]:bg-purple-600"
            />
            <span className={`text-sm font-medium ${isAnnual ? 'text-gray-900' : 'text-gray-500'}`}>
              Annual
            </span>
            <Badge variant="secondary" className="bg-green-100 text-green-800">
              Save 10%
            </Badge>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          {plans.map((plan) => {
            const Icon = plan.icon;
            const priceInfo = formatPlanPrice(plan);
            
            return (
              <Card 
                key={plan.id}
                className={`relative transition-all duration-300 hover:shadow-xl ${
                  plan.popular 
                    ? 'ring-2 ring-purple-500 shadow-lg scale-105' 
                    : 'hover:shadow-lg'
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                    <Badge className="bg-purple-600 text-white px-3 py-1">
                      <Star className="h-3 w-3 mr-1" />
                      Most Popular
                    </Badge>
                  </div>
                )}
                
                <CardHeader className="text-center pb-8">
                  <div className={`mx-auto w-12 h-12 rounded-lg ${getColorClasses(plan.color, 'light')} flex items-center justify-center mb-4`}>
                    <Icon className={`h-6 w-6 ${plan.color === 'blue' ? 'text-blue-600' : plan.color === 'purple' ? 'text-purple-600' : 'text-yellow-600'}`} />
                  </div>
                  
                  <CardTitle className="text-2xl font-bold">{plan.name}</CardTitle>
                  <CardDescription className="text-base mt-2">
                    {plan.description}
                  </CardDescription>
                  
                  <div className="mt-6">
                    <div className="flex items-baseline justify-center">
                      <span className="text-5xl font-bold">{priceInfo.price}</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      {priceInfo.billing}
                    </p>
                    {priceInfo.savings && (
                      <p className="text-sm text-green-600 mt-1">
                        {priceInfo.savings}
                      </p>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {plan.features.map((feature, index) => (
                    <div key={index} className="flex items-center">
                      <Check className="h-4 w-4 text-green-500 mr-3 flex-shrink-0" />
                      <span className="text-sm">{feature}</span>
                    </div>
                  ))}
                  
                  {plan.limitations.length > 0 && (
                    <>
                      <Separator className="my-4" />
                      {plan.limitations.map((limitation, index) => (
                        <div key={index} className="flex items-center">
                          <X className="h-4 w-4 text-gray-400 mr-3 flex-shrink-0" />
                          <span className="text-sm text-gray-500">{limitation}</span>
                        </div>
                      ))}
                    </>
                  )}
                </CardContent>

                <CardFooter>
                  <Button
                    onClick={() => handleUpgrade(plan.id)}
                    disabled={checkoutMutation.isPending}
                    className={`w-full ${getColorClasses(plan.color, plan.popular ? 'dark' : 'medium')} hover:shadow-md transition-all duration-200`}
                  >
                    {checkoutMutation.isPending ? (
                      'Processing...'
                    ) : (
                      <>
                        Start Free Trial
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </>
                    )}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>

        {/* Feature Comparison Table */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="px-6 py-4 bg-gray-50 border-b">
            <h3 className="text-lg font-semibold text-gray-900">Detailed Feature Comparison</h3>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-4 px-6 font-medium text-gray-900">Features</th>
                  <th className="text-center py-4 px-6 font-medium text-gray-900">Starter</th>
                  <th className="text-center py-4 px-6 font-medium text-gray-900">Professional</th>
                  <th className="text-center py-4 px-6 font-medium text-gray-900">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {detailedFeatures.map((feature, index) => (
                  <tr key={index} className="border-b last:border-b-0 hover:bg-gray-50">
                    <td className="py-4 px-6 font-medium text-gray-900">{feature.name}</td>
                    <td className="py-4 px-6 text-center">
                      {typeof feature.starter === 'boolean' ? (
                        feature.starter ? (
                          <Check className="h-5 w-5 text-green-500 mx-auto" />
                        ) : (
                          <X className="h-5 w-5 text-gray-300 mx-auto" />
                        )
                      ) : (
                        <span className="text-sm">{feature.starter}</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-center">
                      {typeof feature.pro === 'boolean' ? (
                        feature.pro ? (
                          <Check className="h-5 w-5 text-green-500 mx-auto" />
                        ) : (
                          <X className="h-5 w-5 text-gray-300 mx-auto" />
                        )
                      ) : (
                        <span className="text-sm">{feature.pro}</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-center">
                      {typeof feature.enterprise === 'boolean' ? (
                        feature.enterprise ? (
                          <Check className="h-5 w-5 text-green-500 mx-auto" />
                        ) : (
                          <X className="h-5 w-5 text-gray-300 mx-auto" />
                        )
                      ) : (
                        <span className="text-sm">{feature.enterprise}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* License Information */}
        <div className="mt-12 bg-white rounded-xl shadow-sm border p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Building className="h-8 w-8 text-blue-600" />
              </div>
              <h4 className="text-xl font-bold text-gray-900 mb-2">BYOL (Bring Your Own License)</h4>
              <p className="text-gray-600 text-sm">
                Perfect if you already have building code subscriptions. 
                Upload your licenses and get started at lower monthly costs.
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Shield className="h-8 w-8 text-purple-600" />
              </div>
              <h4 className="text-xl font-bold text-gray-900 mb-2">Building Codes Included</h4>
              <p className="text-gray-600 text-sm">
                Complete solution with all Canadian & US building codes included. 
                No additional licensing fees or setup required.
              </p>
            </div>
          </div>
        </div>

        {/* Trial Information */}
        <div className="mt-8 text-center bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-8">
          <div className="flex items-center justify-center mb-4">
            <Clock className="h-8 w-8 text-blue-600 mr-3" />
            <h3 className="text-2xl font-bold text-gray-900">14-Day Free Trial</h3>
          </div>
          <p className="text-gray-600 mb-6 max-w-2xl mx-auto">
            Try EstimatorPro risk-free for 14 days. {licenseType === 'byol' ? 'Upload your licenses and ' : ''}Access all features, 
            analyze your construction documents, and see how AI can transform your estimation process.
          </p>
          <div className="flex flex-wrap justify-center gap-6 text-sm">
            <div className="flex items-center">
              <Sparkles className="h-4 w-4 text-purple-600 mr-2" />
              <span>{licenseType === 'byol' ? 'Starter plan' : '3 projects, 500MB'} access</span>
            </div>
            <div className="flex items-center">
              <Shield className="h-4 w-4 text-purple-600 mr-2" />
              <span>No commitment</span>
            </div>
            <div className="flex items-center">
              <Zap className="h-4 w-4 text-purple-600 mr-2" />
              <span>Cancel anytime</span>
            </div>
          </div>
        </div>

        {/* Pay-per-Project Option */}
        {licenseType === 'included' && (
          <div className="mt-8 bg-gradient-to-r from-green-50 to-blue-50 rounded-xl p-8 text-center">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Pay-per-Project Option</h3>
            <div className="text-3xl font-bold text-green-600 mb-2">$300 <span className="text-lg text-gray-600">per project</span></div>
            <p className="text-gray-600 mb-4 max-w-2xl mx-auto">
              Perfect for occasional use. Upload specs & drawings → get BoQ + BIM stub. 
              Includes 1 GB storage for 1 year.
            </p>
            <div className="text-sm text-gray-500">
              Extra discipline modules: +$50–$150 each • Extra storage: $10/GB
            </div>
          </div>
        )}
      </div>
    </div>
  );
}