import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shield, Eye, Users, Lock, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

const DISCIPLINES = [
  'Architectural', 'Structural', 'Mechanical', 'Electrical', 
  'Plumbing', 'Civil', 'Fire_Protection', 'Landscape',
  'Specifications', 'Contracts', 'Reports', 'General'
];

const COMPANY_ROLES = {
  'General_Contractor': { color: 'bg-green-100 text-green-800', icon: Shield, name: 'General Contractor' },
  'Architect': { color: 'bg-blue-100 text-blue-800', icon: Users, name: 'Architect' },
  'Structural_Engineer': { color: 'bg-purple-100 text-purple-800', icon: Users, name: 'Structural Engineer' },
  'MEP_Engineer': { color: 'bg-orange-100 text-orange-800', icon: Users, name: 'MEP Engineer' },
  'Civil_Engineer': { color: 'bg-yellow-100 text-yellow-800', icon: Users, name: 'Civil Engineer' },
  'Specialty_Contractor': { color: 'bg-red-100 text-red-800', icon: Users, name: 'Specialty Contractor' },
  'Consultant': { color: 'bg-gray-100 text-gray-800', icon: Eye, name: 'Consultant' },
  'Owner_Representative': { color: 'bg-indigo-100 text-indigo-800', icon: Shield, name: 'Owner Representative' },
  'Solo_Practitioner': { color: 'bg-teal-100 text-teal-800', icon: CheckCircle, name: 'Solo Practitioner' }
};

interface UserAccess {
  companyName: string;
  companyRole: string;
  allowedDisciplines: string[];
  isSoloPractitioner: boolean;
  isCompanyAdmin: boolean;
  userRole: string;
}

export function UserAccessPanel() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [requestDiscipline, setRequestDiscipline] = useState('');
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch user access information
  const { data: userAccess, isLoading } = useQuery<UserAccess>({
    queryKey: ['/api/user/access'],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch('/api/user/access', { headers }).catch(err => {
        console.error('Failed to fetch user access:', err);
        throw err;
      });
      if (!res.ok) throw new Error('Failed to fetch user access');
      return res.json();
    }
  });

  // Request access to new discipline
  const requestAccessMutation = useMutation({
    mutationFn: (discipline: string) => 
      apiRequest('POST', '/api/user/request-access', { discipline }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user/access'] });
      setIsDialogOpen(false);
      setRequestDiscipline('');
      toast({
        title: 'Access requested',
        description: 'Your request has been submitted for review.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Request failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-gray-500">Loading access information...</div>
        </CardContent>
      </Card>
    );
  }

  if (!userAccess) {
    return null;
  }

  const companyRoleInfo = COMPANY_ROLES[userAccess.companyRole as keyof typeof COMPANY_ROLES] || COMPANY_ROLES.Solo_Practitioner;
  const RoleIcon = companyRoleInfo.icon;

  const availableDisciplines = DISCIPLINES.filter(
    d => !(userAccess.allowedDisciplines || []).includes(d)
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-5 w-5" />
          Document Access Control
        </CardTitle>
        <CardDescription>
          Your access permissions and available construction disciplines
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Company Info */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Company</span>
              <Badge className={companyRoleInfo.color}>
                <RoleIcon className="w-3 h-3 mr-1" />
                {companyRoleInfo.name}
              </Badge>
            </div>
            <p className="text-sm font-medium text-gray-900">{userAccess.companyName}</p>
            <p className="text-xs text-gray-500 mt-1">
              {userAccess.isSoloPractitioner && 'Solo practice - Full access to all construction disciplines'}
              {userAccess.companyRole === 'General_Contractor' && 'Overall project coordination and management'}
              {userAccess.companyRole === 'Architect' && 'Design lead and architectural documentation'}
              {userAccess.companyRole === 'Structural_Engineer' && 'Structural design and engineering calculations'}
              {!userAccess.isSoloPractitioner && userAccess.companyRole !== 'General_Contractor' && userAccess.companyRole !== 'Architect' && userAccess.companyRole !== 'Structural_Engineer' && 'Specialized construction services and documentation'}
            </p>
          </div>

          {/* Company Scope & Disciplines */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">
                Company Scope ({(userAccess.allowedDisciplines || []).length} disciplines)
              </span>
              {userAccess.isSoloPractitioner && (
                <Badge className="bg-teal-100 text-teal-800 text-xs">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Full Access
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(userAccess.allowedDisciplines || []).map((discipline) => (
                <Badge key={discipline} variant="secondary" className="text-xs">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  {discipline.replace('_', ' ')}
                </Badge>
              ))}
            </div>
            {!userAccess.isSoloPractitioner && availableDisciplines.length > 0 && (
              <div className="mt-2">
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" data-testid="button-request-access">
                      Expand Company Scope
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Request Additional Discipline Access</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <p className="text-sm text-gray-600">
                        Request access to additional construction disciplines for your company.
                      </p>
                      <div>
                        <label className="text-sm font-medium">Select Discipline</label>
                        <Select value={requestDiscipline} onValueChange={setRequestDiscipline}>
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="Choose a discipline..." />
                          </SelectTrigger>
                          <SelectContent>
                            {availableDisciplines.map((discipline) => (
                              <SelectItem key={discipline} value={discipline}>
                                {discipline.replace('_', ' ')}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button 
                          variant="outline" 
                          onClick={() => setIsDialogOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button 
                          onClick={() => requestAccessMutation.mutate(requestDiscipline)}
                          disabled={!requestDiscipline || requestAccessMutation.isPending}
                          data-testid="button-submit-request"
                        >
                          {requestAccessMutation.isPending ? 'Submitting...' : 'Submit Request'}
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </div>

          {/* Privacy Notice */}
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-blue-800">
                <p className="font-medium mb-1">Company-Based Access Control</p>
                <p>
                  Document access is controlled by your company's role and scope on the project. 
                  {userAccess.isSoloPractitioner 
                    ? 'As a solo practitioner, you have access to all construction disciplines.' 
                    : `Your company (${userAccess.companyName}) has access to specific disciplines based on your contracted scope.`
                  }
                </p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}