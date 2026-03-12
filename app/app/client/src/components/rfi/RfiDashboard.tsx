import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  FileText, 
  Clock, 
  CheckCircle, 
  AlertTriangle, 
  Plus, 
  Search,
  MessageSquare,
  Filter,
  Users,
  Calendar,
  TrendingUp
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface RfiDashboardProps {
  projectId: string;
}

const createRfiSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  question: z.string().min(10, "Question must be at least 10 characters"),
  priority: z.enum(["Low", "Medium", "High", "Critical"]),
  fromName: z.string().min(1, "From name is required"),
  fromCompany: z.string().optional(),
  toName: z.string().min(1, "To name is required"),
  toCompany: z.string().optional(),
  reason: z.string().optional(),
  description: z.string().optional()
});

type CreateRfiForm = z.infer<typeof createRfiSchema>;

export function RfiDashboard({ projectId }: RfiDashboardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch RFIs
  // Use default auth-injecting queryFn (getQueryFn from queryClient).
  // queryKey items are joined as URL path: /api/projects/{id}/rfis
  const { data: rfis = [], isLoading } = useQuery<any[]>({
    queryKey: [`/api/projects/${projectId}/rfis`],
    enabled: !!projectId,
  });

  // Fetch RFI statistics — default queryFn handles auth token via localStorage
  const { data: stats } = useQuery<{ total: number; open: number; inProgress: number; responded: number; aiGenerated: number }>({
    queryKey: [`/api/projects/${projectId}/rfis/stats`],
    enabled: !!projectId,
  });

  // Create RFI mutation
  const createRfiMutation = useMutation({
    mutationFn: (data: CreateRfiForm) => 
      apiRequest("POST", `/api/projects/${projectId}/rfis`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "rfis"] });
      setIsCreateDialogOpen(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create RFI",
        description: error.message || "An unexpected error occurred while creating the RFI.",
        variant: "destructive"
      });
    }
  });

  const form = useForm<CreateRfiForm>({
    resolver: zodResolver(createRfiSchema),
    defaultValues: {
      subject: "",
      question: "",
      priority: "Medium",
      fromName: "",
      fromCompany: "",
      toName: "",
      toCompany: "",
      reason: "",
      description: ""
    }
  });

  // Filter RFIs based on search and status
  const filteredRfis = rfis.filter((rfi: any) => {
    const matchesSearch = searchQuery === "" || 
      rfi.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rfi.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rfi.rfiNumber.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || rfi.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Open": return "bg-blue-100 text-blue-800 border-blue-200";
      case "In Progress": return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "Responded": return "bg-green-100 text-green-800 border-green-200";
      case "Closed": return "bg-gray-100 text-gray-800 border-gray-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "Critical": return "bg-red-100 text-red-800 border-red-200";
      case "High": return "bg-orange-100 text-orange-800 border-orange-200";
      case "Medium": return "bg-blue-100 text-blue-800 border-blue-200";
      case "Low": return "bg-green-100 text-green-800 border-green-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const onSubmit = (data: CreateRfiForm) => {
    createRfiMutation.mutate(data);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center p-8">Loading RFIs...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Requests for Information</h2>
          <p className="text-muted-foreground">Manage project RFIs and track responses</p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-rfi">
              <Plus className="w-4 h-4 mr-2" />
              Create RFI
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New RFI</DialogTitle>
              <DialogDescription>
                Submit a request for information to clarify project details
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="subject"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Subject</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Brief description of your question" 
                          {...field} 
                          data-testid="input-rfi-subject"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="fromName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>From Name</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="Your name" 
                            {...field} 
                            data-testid="input-rfi-from-name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="fromCompany"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>From Company</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="Your company" 
                            {...field} 
                            data-testid="input-rfi-from-company"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="toName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>To Name</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="Recipient name" 
                            {...field} 
                            data-testid="input-rfi-to-name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="toCompany"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>To Company</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="Recipient company" 
                            {...field} 
                            data-testid="input-rfi-to-company"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Priority</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-rfi-priority">
                            <SelectValue placeholder="Select priority level" />
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

                <FormField
                  control={form.control}
                  name="question"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Question</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Detailed description of what you need clarification on..." 
                          rows={4}
                          {...field}
                          data-testid="textarea-rfi-question"
                        />
                      </FormControl>
                      <FormDescription>
                        Provide as much detail as possible to get accurate responses
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="reason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reason (Optional)</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Why is this information needed?" 
                          rows={2}
                          {...field}
                          data-testid="textarea-rfi-reason"
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
                    data-testid="button-cancel-rfi"
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createRfiMutation.isPending}
                    data-testid="button-submit-rfi"
                  >
                    {createRfiMutation.isPending ? "Creating..." : "Create RFI"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total RFIs</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-rfis">{stats.total}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Open</CardTitle>
              <Clock className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600" data-testid="text-open-rfis">{stats.open}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">In Progress</CardTitle>
              <TrendingUp className="h-4 w-4 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600" data-testid="text-inprogress-rfis">{stats.inProgress}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Responded</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600" data-testid="text-responded-rfis">{stats.responded}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">AI Generated</CardTitle>
              <AlertTriangle className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600" data-testid="text-ai-rfis">{stats.aiGenerated}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters and Search */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder="Search RFIs by subject, question, or number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-rfis"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="Open">Open</SelectItem>
            <SelectItem value="In Progress">In Progress</SelectItem>
            <SelectItem value="Responded">Responded</SelectItem>
            <SelectItem value="Closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* RFI List */}
      <div className="space-y-4">
        {filteredRfis.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <div className="text-center">
                <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">No RFIs Found</h3>
                <p className="text-muted-foreground mb-4">
                  {searchQuery || statusFilter !== "all" 
                    ? "No RFIs match your current filters" 
                    : "Create your first RFI to get started"}
                </p>
                {!searchQuery && statusFilter === "all" && (
                  <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="button-create-first-rfi">
                    <Plus className="w-4 h-4 mr-2" />
                    Create First RFI
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          filteredRfis.map((rfi: any) => (
            <Card key={rfi.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg" data-testid={`text-rfi-number-${rfi.id}`}>
                        {rfi.rfiNumber}
                      </CardTitle>
                      <Badge className={getStatusColor(rfi.status)}>
                        {rfi.status}
                      </Badge>
                      <Badge className={getPriorityColor(rfi.priority)}>
                        {rfi.priority}
                      </Badge>
                      {rfi.generatedFromConflict && (
                        <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                          AI Generated
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="text-base font-medium" data-testid={`text-rfi-subject-${rfi.id}`}>
                      {rfi.subject}
                    </CardDescription>
                  </div>
                  <div className="text-sm text-muted-foreground text-right">
                    <div className="flex items-center gap-1 mb-1">
                      <Calendar className="w-3 h-3" />
                      {formatDistanceToNow(new Date(rfi.createdAt), { addSuffix: true })}
                    </div>
                    <div className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {rfi.fromName} → {rfi.toName}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4" style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                }} data-testid={`text-rfi-question-${rfi.id}`}>
                  {rfi.question}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div>From: {rfi.fromName} ({rfi.fromCompany || 'N/A'})</div>
                    <div>To: {rfi.toName} ({rfi.toCompany || 'N/A'})</div>
                  </div>
                  <Button variant="outline" size="sm" data-testid={`button-view-rfi-${rfi.id}`}>
                    <MessageSquare className="w-4 h-4 mr-2" />
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