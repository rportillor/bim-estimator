import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  FileEdit, 
  Clock, 
  CheckCircle, 
  Plus,
  Search,
  Filter,
  DollarSign,
  Calendar,
  Cog,
  TrendingUp,
  Award
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { apiRequest } from "@/lib/queryClient";

interface ChangeRequestDashboardProps {
  projectId: string;
}

const createChangeRequestSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(10, "Description must be at least 10 characters"),
  reason: z.string().min(1, "Reason is required"),
  urgency: z.enum(["Low", "Medium", "High", "Critical"]),
  type: z.enum(["Design Change", "Scope Addition", "Material Change", "Schedule Change", "Other"]),
  requestedBy: z.string().min(1, "Requested by is required"),
  estimatedCost: z.string().optional(),
  estimatedScheduleImpact: z.string().optional(),
  justification: z.string().optional(),
  rfiId: z.string().optional()
});

type CreateChangeRequestForm = z.infer<typeof createChangeRequestSchema>;

export function ChangeRequestDashboard({ projectId }: ChangeRequestDashboardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  // Fetch Change Requests (SECURITY FIX: use apiRequest for auth headers)
  const { data: changeRequests = [], isLoading } = useQuery({
    queryKey: ["/api/projects", projectId, "change-requests"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/projects/${projectId}/change-requests`);
      return res.json();
    }
  });

  // Fetch Change Request statistics (SECURITY FIX: use apiRequest for auth headers)
  const { data: stats } = useQuery({
    queryKey: ["/api/projects", projectId, "change-requests", "stats"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/projects/${projectId}/change-requests/stats`);
      return res.json();
    }
  });

  // Create Change Request mutation (FIX: corrected argument order)
  const createCrMutation = useMutation({
    mutationFn: (data: CreateChangeRequestForm) =>
      apiRequest("POST", `/api/projects/${projectId}/change-requests`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "change-requests"] });
      setIsCreateDialogOpen(false);
      form.reset();
    }
  });

  const form = useForm<CreateChangeRequestForm>({
    resolver: zodResolver(createChangeRequestSchema),
    defaultValues: {
      title: "",
      description: "",
      reason: "",
      urgency: "Medium",
      type: "Design Change",
      requestedBy: "",
      estimatedCost: "",
      estimatedScheduleImpact: "",
      justification: "",
      rfiId: ""
    }
  });

  // Filter Change Requests based on search and status
  const filteredCRs = changeRequests.filter((cr: any) => {
    const matchesSearch = searchQuery === "" || 
      cr.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cr.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cr.reason.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || cr.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Pending": return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "Under Review": return "bg-blue-100 text-blue-800 border-blue-200";
      case "Approved": return "bg-green-100 text-green-800 border-green-200";
      case "Rejected": return "bg-red-100 text-red-800 border-red-200";
      case "Implemented": return "bg-purple-100 text-purple-800 border-purple-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case "Critical": return "bg-red-100 text-red-800 border-red-200";
      case "High": return "bg-orange-100 text-orange-800 border-orange-200";
      case "Medium": return "bg-blue-100 text-blue-800 border-blue-200";
      case "Low": return "bg-green-100 text-green-800 border-green-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const formatCurrency = (amount: string | number | null) => {
    if (!amount) return "N/A";
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(num);
  };

  const onSubmit = (data: CreateChangeRequestForm) => {
    createCrMutation.mutate(data);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center p-8">Loading Change Requests...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Change Requests</h2>
          <p className="text-muted-foreground">Manage project changes and track approvals</p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-change-request">
              <Plus className="w-4 h-4 mr-2" />
              Create Change Request
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Change Request</DialogTitle>
              <DialogDescription>
                Submit a request to modify project scope, design, or specifications
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Brief title for the change request" 
                          {...field} 
                          data-testid="input-cr-title"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Change Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-cr-type">
                              <SelectValue placeholder="Select change type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Design Change">Design Change</SelectItem>
                            <SelectItem value="Scope Addition">Scope Addition</SelectItem>
                            <SelectItem value="Material Change">Material Change</SelectItem>
                            <SelectItem value="Schedule Change">Schedule Change</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="urgency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Urgency</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-cr-urgency">
                              <SelectValue placeholder="Select urgency level" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Low">Low</SelectItem>
                            <SelectItem value="Medium">Medium</SelectItem>
                            <SelectItem value="High">High</SelectItem>
                            <SelectItem value="Critical">Critical</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="requestedBy"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Requested By</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Name of person requesting the change" 
                          {...field} 
                          data-testid="input-cr-requested-by"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Detailed description of the proposed change..." 
                          rows={4}
                          {...field}
                          data-testid="textarea-cr-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="reason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reason</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Why is this change necessary?" 
                          rows={3}
                          {...field}
                          data-testid="textarea-cr-reason"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="estimatedCost"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Estimated Cost (Optional)</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="$0.00" 
                            {...field} 
                            data-testid="input-cr-cost"
                          />
                        </FormControl>
                        <FormDescription>
                          Estimated cost impact of this change
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="estimatedScheduleImpact"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Schedule Impact (Optional)</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="e.g., +2 weeks" 
                            {...field} 
                            data-testid="input-cr-schedule"
                          />
                        </FormControl>
                        <FormDescription>
                          Expected schedule impact
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="justification"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Justification (Optional)</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Additional justification for this change..." 
                          rows={3}
                          {...field}
                          data-testid="textarea-cr-justification"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end space-x-2 pt-4">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setIsCreateDialogOpen(false)}
                    data-testid="button-cancel-cr"
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createCrMutation.isPending}
                    data-testid="button-submit-cr"
                  >
                    {createCrMutation.isPending ? "Creating..." : "Create Change Request"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total CRs</CardTitle>
              <FileEdit className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-crs">{stats.total}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending</CardTitle>
              <Clock className="h-4 w-4 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600" data-testid="text-pending-crs">{stats.pending}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Under Review</CardTitle>
              <TrendingUp className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600" data-testid="text-review-crs">{stats.underReview}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Approved</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600" data-testid="text-approved-crs">{stats.approved}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Implemented</CardTitle>
              <Award className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600" data-testid="text-implemented-crs">{stats.implemented}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Cost Impact</CardTitle>
              <DollarSign className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600" data-testid="text-cost-impact">
                {formatCurrency(stats.totalCostImpact)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters and Search */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder="Search change requests by title, description, or reason..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-crs"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="Pending">Pending</SelectItem>
            <SelectItem value="Under Review">Under Review</SelectItem>
            <SelectItem value="Approved">Approved</SelectItem>
            <SelectItem value="Rejected">Rejected</SelectItem>
            <SelectItem value="Implemented">Implemented</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Change Request List */}
      <div className="space-y-4">
        {filteredCRs.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <div className="text-center">
                <FileEdit className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">No Change Requests Found</h3>
                <p className="text-muted-foreground mb-4">
                  {searchQuery || statusFilter !== "all" 
                    ? "No change requests match your current filters" 
                    : "Create your first change request to get started"}
                </p>
                {!searchQuery && statusFilter === "all" && (
                  <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="button-create-first-cr">
                    <Plus className="w-4 h-4 mr-2" />
                    Create First Change Request
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          filteredCRs.map((cr: any) => (
            <Card key={cr.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg" data-testid={`text-cr-title-${cr.id}`}>
                        {cr.title}
                      </CardTitle>
                      <Badge className={getStatusColor(cr.status)}>
                        {cr.status}
                      </Badge>
                      <Badge className={getUrgencyColor(cr.urgency)}>
                        {cr.urgency}
                      </Badge>
                      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                        {cr.type}
                      </Badge>
                    </div>
                    <CardDescription className="text-sm" data-testid={`text-cr-requested-by-${cr.id}`}>
                      Requested by: {cr.requestedBy}
                    </CardDescription>
                  </div>
                  <div className="text-sm text-muted-foreground text-right">
                    <div className="flex items-center gap-1 mb-1">
                      <Calendar className="w-3 h-3" />
                      {formatDistanceToNow(new Date(cr.createdAt), { addSuffix: true })}
                    </div>
                    {cr.costImpact && (
                      <div className="flex items-center gap-1">
                        <DollarSign className="w-3 h-3" />
                        {formatCurrency(cr.costImpact)}
                      </div>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4" style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                }} data-testid={`text-cr-description-${cr.id}`}>
                  {cr.description}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div>Reason: {cr.reason}</div>
                    {cr.scheduleImpact && (
                      <div>Schedule: {cr.scheduleImpact}</div>
                    )}
                  </div>
                  <Button variant="outline" size="sm" data-testid={`button-view-cr-${cr.id}`}>
                    <Cog className="w-4 h-4 mr-2" />
                    View Details
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}