import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import QuickInsights from "@/components/dashboard/quick-insights";
import RecentProjects from "@/components/dashboard/recent-projects";
import { AICoach } from "@/components/ai-coach/AICoach";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { Project } from "@shared/schema";
import { z } from "zod";

const createProjectFormSchema = z.object({
  name: z.string().min(1, "Project name is required"),
  description: z.string().optional(),
  location: z.string().min(1, "Location is required"),
  type: z.string().min(1, "Project type is required"),
  country: z.enum(["canada", "usa"]).default("canada"),
  federalCode: z.string().min(1, "Federal code is required"),
  stateProvincialCode: z.string().optional(),
  municipalCode: z.string().optional(),
  status: z.string().default("Draft"),
});

type CreateProjectForm = z.infer<typeof createProjectFormSchema>;

export default function Dashboard() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isIpad, setIsIpad] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => {
    return localStorage.getItem('dashboard_selected_project_id') || '';
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    const checkDevice = () => {
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
          target.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center',
            inline: 'nearest'
          });
        }, 300);
      }
    };

    const handleViewportChange = () => {
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
  
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['/api/dashboard/stats'],
  });

  const { data: projects, isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ['/api/projects'],
  });

  // Initialize selectedProjectId when projects load
  useEffect(() => {
    if (projects && projects.length > 0 && !selectedProjectId) {
      const firstProjectId = projects[0].id;
      setSelectedProjectId(firstProjectId);
      localStorage.setItem('dashboard_selected_project_id', firstProjectId);
    }
  }, [projects, selectedProjectId]);

  // Save selectedProjectId to localStorage when it changes
  useEffect(() => {
    if (selectedProjectId) {
      localStorage.setItem('dashboard_selected_project_id', selectedProjectId);
    }
  }, [selectedProjectId]);

  const form = useForm<CreateProjectForm>({
    resolver: zodResolver(createProjectFormSchema),
    defaultValues: {
      name: "",
      description: "",
      location: "",
      type: "Commercial",
      country: "canada" as const,
      federalCode: "NBC", // Default to National Building Code for Canada
      stateProvincialCode: "",
      municipalCode: "",
      status: "Draft",
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: (data: CreateProjectForm) => 
      apiRequest("POST", "/api/projects", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      setIsCreateDialogOpen(false);
      form.reset();
      toast({
        title: "Success",
        description: "Project created successfully!",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create project",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: CreateProjectForm) => {
    createProjectMutation.mutate(data);
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden">
      <header className="bg-white p-4 sm:p-6 border-b">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 truncate">Project Dashboard</h2>
            <p className="text-gray-600 mt-1 text-sm sm:text-base">Manage your construction estimation projects</p>
          </div>
          <Button 
            className="bg-primary text-white hover:bg-blue-700 w-full sm:w-auto flex-shrink-0"
            data-testid="button-new-project"
            onClick={() => setIsCreateDialogOpen(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </div>
      </header>

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-full">
        <QuickInsights stats={stats as any} isLoading={statsLoading} />
        
        {/* AI Coach and Recent Projects Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 md:gap-6">
          {/* Recent Projects - 2/3 width */}
          <div className="lg:col-span-2 order-1 lg:order-1">
            <RecentProjects projects={projects} isLoading={projectsLoading} />
          </div>
          
          {/* AI Coach - 1/3 width, responsive height */}
          <div className="lg:col-span-1 order-2 lg:order-2">
            <Card className={`
              shadow-sm border overflow-hidden
              ${isMobile ? 'h-[500px]' : isIpad ? 'h-[550px]' : 'h-[600px]'}
            `}>
              <CardHeader className="pb-2 px-4 pt-3 border-b">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm font-medium">AI Coach Analysis</CardTitle>
                  {projects && projects.length > 0 && (
                    <Select
                      value={selectedProjectId}
                      onValueChange={setSelectedProjectId}
                    >
                      <SelectTrigger className="w-[180px] h-8 text-xs">
                        <SelectValue placeholder="Select project" />
                      </SelectTrigger>
                      <SelectContent>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            <span className="truncate">{project.name}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0 h-[calc(100%-60px)]">
                <AICoach 
                  projectId={selectedProjectId || undefined}
                  context={{
                    projectType: projects?.find(p => p.id === selectedProjectId)?.type || 'General Construction',
                    location: projects?.find(p => p.id === selectedProjectId)?.location || 'North America'
                  }}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Create Project Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className={`
          ${isMobile ? 'max-w-[95vw] max-h-[85vh] mx-2' : isIpad ? 'max-w-[90vw] max-h-[80vh] mx-auto mt-4' : 'max-w-2xl max-h-[90vh]'}
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
                    <FormLabel>Project Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter project name..." {...field} />
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
                      <Textarea placeholder="Project description..." {...field} />
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
                    <FormLabel>Location</FormLabel>
                    <FormControl>
                      <Input placeholder="City, Province/State, Country" {...field} />
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
                    <FormLabel>Project Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
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
                    <FormLabel>Country</FormLabel>
                    <Select onValueChange={(value) => {
                      field.onChange(value);
                      // Reset codes when country changes
                      form.setValue("federalCode", value === "canada" ? "NBC" : "IBC");
                      form.setValue("stateProvincialCode", "");
                      form.setValue("municipalCode", "");
                    }} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
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
                    <FormLabel>Federal Building Code</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
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
                    <FormLabel>
                      {form.watch("country") === "canada" ? "Provincial" : "State"} Building Code
                    </FormLabel>
                    <FormControl>
                      <Input 
                        placeholder={form.watch("country") === "canada" ? 
                          "e.g., Ontario Building Code" : 
                          "e.g., California Building Code"
                        } 
                        {...field} 
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
                    <FormLabel>Municipal Building Code</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="e.g., Toronto Building Code, City of Vancouver Building Bylaw" 
                        {...field} 
                          />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
                  />
                </div>
                
                <div className="flex justify-end space-x-2 pt-4">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setIsCreateDialogOpen(false)}
                  disabled={createProjectMutation.isPending}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit"
                  disabled={createProjectMutation.isPending}
                  data-testid="button-create-project-submit"
                >
                  {createProjectMutation.isPending ? "Creating..." : "Create Project"}
                </Button>
              </div>
              </form>
            </Form>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
