import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Calendar, MapPin, Search, Filter, Zap } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertProjectSchema } from "@shared/schema";
import type { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency, formatArea, formatDate } from "@/lib/utils";
import { ProjectTemplateModal } from "@/components/project/ProjectTemplateModal";
import { PROJECT_TEMPLATES } from "@shared/project-templates";
import type { ProjectTemplate } from "@shared/project-templates";

export default function ProjectsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isIpad, setIsIpad] = useState(false);

  useEffect(() => {
    const checkDevice = () => {
      // Enhanced device detection
      const userAgent = navigator.userAgent.toLowerCase();
      const width = window.innerWidth;
      const _height = window.innerHeight;
      
      // More comprehensive iPad detection
      const isIpadDevice = /ipad/.test(userAgent) || 
                          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
                          (/macintosh/.test(userAgent) && Boolean(navigator.maxTouchPoints) && navigator.maxTouchPoints > 1) ||
                          // Also detect based on screen dimensions for tablet-like devices
                          (width >= 768 && width <= 1024 && 'ontouchstart' in window);
      
      const isMobileDevice = (width <= 767 && 'ontouchstart' in window) || 
                            /iphone|ipod|android|webos|blackberry|iemobile|opera mini/i.test(userAgent);
      
      
      setIsIpad(isIpadDevice);
      setIsMobile(Boolean(isMobileDevice && !isIpadDevice));
    };
    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => window.removeEventListener('resize', checkDevice);
  }, []);

  // Handle mobile keyboard focus
  useEffect(() => {
    if (!isCreateDialogOpen || (!isMobile && !isIpad)) return;

    const handleInputFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        setTimeout(() => {
          // Scroll the focused element into view above keyboard
          target.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center',
            inline: 'nearest'
          });
        }, 300); // Wait for keyboard animation
      }
    };

    const handleViewportChange = () => {
      // Detect keyboard appearance by viewport height change
      const focusedElement = document.activeElement as HTMLElement;
      if (focusedElement && (focusedElement.tagName === 'INPUT' || focusedElement.tagName === 'TEXTAREA')) {
        setTimeout(() => {
          focusedElement.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center',
            inline: 'nearest'
          });
        }, 100);
      }
    };

    document.addEventListener('focusin', handleInputFocus);
    window.addEventListener('resize', handleViewportChange);

    return () => {
      document.removeEventListener('focusin', handleInputFocus);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [isCreateDialogOpen, isMobile, isIpad]);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: projects, isLoading } = useQuery<Project[]>({
    queryKey: ['/api/projects'],
  });

  const form = useForm<z.infer<typeof insertProjectSchema>>({
    resolver: zodResolver(insertProjectSchema),
    defaultValues: {
      name: "",
      description: "",
      location: "",
      type: "Commercial",
      country: "canada",
      federalCode: "NBC",
      stateProvincialCode: "",
      municipalCode: "",
      status: "Draft",
      estimateValue: "0",
      buildingArea: "0",
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: async (projectData: z.infer<typeof insertProjectSchema>) => {
      return apiRequest('POST', '/api/projects', projectData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
      toast({
        title: "Success",
        description: "Project created successfully",
      });
      setIsCreateDialogOpen(false);
      form.reset();
      setSelectedTemplate(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create project",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: z.infer<typeof insertProjectSchema>) => {
    createProjectMutation.mutate(data);
  };

  const handleTemplateSelect = (template: ProjectTemplate) => {
    setSelectedTemplate(template);
    setIsTemplateModalOpen(false);
    
    // Pre-fill form with template data
    form.setValue('name', template.name);
    form.setValue('description', template.description);
    form.setValue('type', template.category === 'commercial' ? 'Commercial' : 
                        template.category === 'residential' ? 'Residential' : 
                        template.category === 'industrial' ? 'Industrial' : 'Infrastructure');
    
    // Estimate building area and cost based on template
    const estimatedArea = template.sampleSpecs?.buildingArea?.min || 1500;
    const estimatedCost = template.typicalBudgetRange?.min || 150000;
    
    form.setValue('buildingArea', estimatedArea.toString());
    form.setValue('estimateValue', estimatedCost.toString());
  };

  // Filter projects based on search term and status
  const filteredProjects = projects?.filter(project => {
    const matchesSearch = project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         project.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         project.location?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || project.status === statusFilter;
    return matchesSearch && matchesStatus;
  }) || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading projects...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header with Create Button */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Projects</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">
            Manage your construction projects and estimates
          </p>
        </div>
        <Button 
          onClick={() => setIsCreateDialogOpen(true)}
          data-testid="button-create-project"
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </div>

      {/* Search and Filter Controls */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
          <Input
            placeholder="Search projects..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
          >
            <option value="all">All Status</option>
            <option value="planning">Planning</option>
            <option value="design">Design</option>
            <option value="bidding">Bidding</option>
            <option value="construction">Construction</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>

      {/* Projects Grid */}
      <div className="space-y-6">
        {/* Project Templates Section - Only show if no projects */}
        {filteredProjects.length === 0 && projects?.length === 0 && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg p-6 border border-blue-200 dark:border-blue-800">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Start with a Template</h3>
                <p className="text-gray-600 dark:text-gray-300">Choose from pre-configured project templates to get started quickly</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {PROJECT_TEMPLATES.slice(0, 3).map((template) => (
                <div key={template.id} className="bg-white rounded-lg border p-4 hover:shadow-md transition-shadow cursor-pointer"
                     onClick={() => {
                       setSelectedTemplate(template);
                       setIsCreateDialogOpen(true);
                     }}>
                  <h4 className="font-semibold text-gray-900 mb-2">{template.name}</h4>
                  <p className="text-sm text-gray-600 mb-3">{template.description.slice(0, 100)}...</p>
                  <div className="text-xs text-gray-500">
                    <div>Budget: {template.typicalBudgetRange.min.toLocaleString()} - {template.typicalBudgetRange.max.toLocaleString()} CAD</div>
                    <div>Duration: {template.typicalDuration.min} - {template.typicalDuration.max} {template.typicalDuration.unit}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {filteredProjects.length === 0 && projects?.length !== 0 ? (
          <div className="text-center py-12 text-gray-500">
            No projects match your search criteria.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProjects.map((project) => (
              <Card key={project.id} className="group hover:shadow-lg transition-shadow duration-200 cursor-pointer" onClick={() => window.location.href = `/projects/${project.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg mb-2 group-hover:text-blue-600 transition-colors">
                        <Link href={`/projects/${project.id}`} className="hover:underline cursor-pointer">
                          {project.name}
                        </Link>
                      </CardTitle>
                      <Badge variant={
                        project.status === 'completed' ? 'default' : 
                        project.status === 'construction' ? 'destructive' :
                        project.status === 'bidding' ? 'secondary' : 'outline'
                      }>
                        {project.status.charAt(0).toUpperCase() + project.status.slice(1)}
                      </Badge>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.location.href = `/projects/${project.id}/bim`;
                        }}
                      >
                        <Zap className="mr-1 h-3 w-3" />
                        BIM
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-3">
                    {project.description && (
                      <p className="text-sm text-gray-600 line-clamp-2">{project.description}</p>
                    )}
                    <div className="flex items-center text-sm text-gray-500">
                      <MapPin className="mr-1 h-3 w-3" />
                      {project.location || "Location not specified"}
                    </div>
                    <div className="flex items-center text-sm text-gray-500">
                      <Calendar className="mr-2 h-4 w-4" />
                      Updated {formatDate(project.updatedAt || new Date())}
                    </div>
                    <div className="grid grid-cols-2 gap-4 pt-3 border-t">
                      <div>
                        <p className="text-xs text-gray-500">Estimate Value</p>
                        <p className="font-semibold text-gray-900">{formatCurrency(Number(project.estimateValue) || 0)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Building Area</p>
                        <p className="font-semibold text-gray-900">{formatArea(Number(project.buildingArea) || 0)}</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create Project Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className={`
          ${isMobile || isIpad ? 'max-w-[95vw] max-h-[80vh] mx-auto mt-4' : 'max-w-2xl max-h-[90vh]'}
          overflow-y-auto
        `}
        aria-describedby="dialog-description">
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <div id="dialog-description" className="sr-only">
              Create a new construction project with details like name, location, and description
            </div>
          </DialogHeader>
          <div className={`${isMobile || isIpad ? 'py-2' : 'py-4'}`}>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className={`grid gap-6 ${isIpad ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base font-medium">Project Name</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="Enter project name..." 
                            {...field}
                            value={field.value || ''}
                            className="text-base"
                            style={{ minHeight: '48px', fontSize: '16px' }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="location"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base font-medium">Location</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="City, Province/State, Country" 
                            {...field}
                            value={field.value || ''}
                            className="text-base"
                            style={{ minHeight: '48px', fontSize: '16px' }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base font-medium">Project Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="text-base" style={{ minHeight: '48px', fontSize: '16px' }}>
                              <SelectValue placeholder="Select project type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Residential">Residential</SelectItem>
                            <SelectItem value="Commercial">Commercial</SelectItem>
                            <SelectItem value="Industrial">Industrial</SelectItem>
                            <SelectItem value="Infrastructure">Infrastructure</SelectItem>
                            <SelectItem value="Renovation">Renovation</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base font-medium">Country</FormLabel>
                        <Select onValueChange={(value) => {
                          field.onChange(value);
                          // Reset codes when country changes
                          form.setValue("federalCode", value === "canada" ? "NBC" : "IBC");
                          form.setValue("stateProvincialCode", "");
                          form.setValue("municipalCode", "");
                        }} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="text-base" style={{ minHeight: '48px', fontSize: '16px' }}>
                              <SelectValue placeholder="Select country" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="canada">🇨🇦 Canada</SelectItem>
                            <SelectItem value="usa">🇺🇸 United States</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="federalCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base font-medium">Federal Building Code</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="text-base" style={{ minHeight: '48px', fontSize: '16px' }}>
                              <SelectValue placeholder="Select federal code" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {form.watch("country") === "canada" ? (
                              <SelectItem value="NBC">National Building Code (NBC)</SelectItem>
                            ) : (
                              <>
                                <SelectItem value="IBC">International Building Code (IBC)</SelectItem>
                                <SelectItem value="IRC">International Residential Code (IRC)</SelectItem>
                              </>
                            )}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="stateProvincialCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base font-medium">
                          {form.watch("country") === "canada" ? "Provincial" : "State"} Building Code
                        </FormLabel>
                        <FormControl>
                          <Input 
                            placeholder={form.watch("country") === "canada" ? 
                              "e.g., Ontario Building Code" : 
                              "e.g., California Building Code"
                            } 
                            {...field}
                            value={field.value || ''}
                            className="text-base"
                            style={{ minHeight: '48px', fontSize: '16px' }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="municipalCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base font-medium">Municipal Building Code</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="e.g., Toronto Building Code, City of Vancouver Building Bylaw" 
                            {...field}
                            value={field.value || ''}
                            className="text-base"
                            style={{ minHeight: '48px', fontSize: '16px' }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base font-medium">Description</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Project description..." 
                          {...field}
                          value={field.value || ''}
                          className="text-base resize-none"
                          style={{ minHeight: '120px', fontSize: '16px' }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div>
                  <label className="text-base font-medium">Project Template (Optional)</label>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start text-left font-normal text-base mt-2"
                    onClick={() => setIsTemplateModalOpen(true)}
                    style={{ minHeight: '48px' }}
                  >
                    {selectedTemplate?.name || "Choose a template..."}
                  </Button>
                </div>
              
                <div className="flex justify-end space-x-3 pt-8 pb-8 border-t">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setIsCreateDialogOpen(false)}
                    disabled={createProjectMutation.isPending}
                    className="px-6 py-3 text-base"
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit"
                    disabled={createProjectMutation.isPending}
                    data-testid="button-create-project-submit"
                    className="px-6 py-3 text-base bg-blue-600 hover:bg-blue-700"
                  >
                    {createProjectMutation.isPending ? "Creating..." : "Create Project"}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </DialogContent>
      </Dialog>


      {/* Project Template Modal */}
      <ProjectTemplateModal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        onSelectTemplate={handleTemplateSelect}
        preSelectedTemplate={selectedTemplate}
      />
    </div>
  );
}