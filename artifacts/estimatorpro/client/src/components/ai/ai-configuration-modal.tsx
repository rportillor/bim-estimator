import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Brain, Eye, Scan, Target, Settings, Zap, Award } from "lucide-react";

const configSchema = z.object({
  configName: z.string().min(1, "Configuration name is required"),
  processingMode: z.enum(["quick", "standard", "comprehensive", "detailed"]),
  analysisStandards: z.array(z.string()).min(1, "At least one standard must be selected"),
  aiModels: z.object({
    nlp: z.enum(["standard", "advanced"]),
    cv: z.enum(["opencv", "yolo", "detectron"]),
    ocr: z.enum(["tesseract", "advanced"])
  }),
  detectComponents: z.array(z.string()),
  extractionSettings: z.object({
    confidence: z.number().min(0).max(1),
    precision: z.enum(["low", "medium", "high", "ultra"]),
    enableOCR: z.boolean(),
    enableTableExtraction: z.boolean(),
    enableDimensionDetection: z.boolean(),
    enableMEPAnalysis: z.boolean()
  }),
  isDefault: z.boolean()
});

type ConfigForm = z.infer<typeof configSchema>;

interface AIConfigurationModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (_config: ConfigForm) => Promise<void>;
  initialConfig?: Partial<ConfigForm>;
  isLoading?: boolean;
}

const PROCESSING_MODES = [
  { value: "quick", label: "Quick Analysis", icon: Zap, description: "Fast processing for basic requirements", time: "~2 min" },
  { value: "standard", label: "Standard Analysis", icon: Target, description: "Balanced processing with good accuracy", time: "~5 min" },
  { value: "comprehensive", label: "Comprehensive Analysis", icon: Brain, description: "Detailed analysis with all features", time: "~10 min" },
  { value: "detailed", label: "Detailed Analysis", icon: Award, description: "Maximum accuracy and completeness", time: "~15 min" }
];

const ANALYSIS_STANDARDS = [
  { value: "NBC", label: "National Building Code (Canada)", region: "Canada" },
  { value: "CSA", label: "Canadian Standards Association", region: "Canada" },
  { value: "IBC", label: "International Building Code", region: "USA" },
  { value: "ASCE", label: "American Society of Civil Engineers", region: "USA" },
  { value: "AISC", label: "American Institute of Steel Construction", region: "USA" },
  { value: "ACI", label: "American Concrete Institute", region: "USA" }
];

const COMPONENT_TYPES = [
  { value: "walls", label: "Walls", icon: "🏗️" },
  { value: "doors", label: "Doors", icon: "🚪" },
  { value: "windows", label: "Windows", icon: "🪟" },
  { value: "columns", label: "Columns", icon: "🏛️" },
  { value: "beams", label: "Beams", icon: "🏗️" },
  { value: "floors", label: "Floors", icon: "🏗️" },
  { value: "roofs", label: "Roofs", icon: "🏠" },
  { value: "stairs", label: "Stairs", icon: "🪜" },
  { value: "plumbing", label: "Plumbing", icon: "🔧" },
  { value: "electrical", label: "Electrical", icon: "⚡" },
  { value: "mechanical", label: "HVAC", icon: "🌡️" }
];

export function AIConfigurationModal({ 
  open, 
  onClose, 
  onSave, 
  initialConfig,
  isLoading = false 
}: AIConfigurationModalProps) {
  const [activeTab, setActiveTab] = useState("general");

  const form = useForm<ConfigForm>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      configName: initialConfig?.configName || "",
      processingMode: initialConfig?.processingMode || "standard",
      analysisStandards: initialConfig?.analysisStandards || ["NBC", "CSA"],
      aiModels: {
        nlp: initialConfig?.aiModels?.nlp || "standard",
        cv: initialConfig?.aiModels?.cv || "opencv",
        ocr: initialConfig?.aiModels?.ocr || "tesseract"
      },
      detectComponents: initialConfig?.detectComponents || ["walls", "doors", "windows"],
      extractionSettings: {
        confidence: initialConfig?.extractionSettings?.confidence || 0.8,
        precision: initialConfig?.extractionSettings?.precision || "medium",
        enableOCR: initialConfig?.extractionSettings?.enableOCR ?? true,
        enableTableExtraction: initialConfig?.extractionSettings?.enableTableExtraction ?? true,
        enableDimensionDetection: initialConfig?.extractionSettings?.enableDimensionDetection ?? true,
        enableMEPAnalysis: initialConfig?.extractionSettings?.enableMEPAnalysis ?? false
      },
      isDefault: initialConfig?.isDefault || false
    }
  });

  const handleSubmit = async (data: ConfigForm) => {
    await onSave(data);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Analysis Configuration
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="general" className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  General
                </TabsTrigger>
                <TabsTrigger value="models" className="flex items-center gap-2">
                  <Brain className="h-4 w-4" />
                  AI Models
                </TabsTrigger>
                <TabsTrigger value="components" className="flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Detection
                </TabsTrigger>
                <TabsTrigger value="advanced" className="flex items-center gap-2">
                  <Scan className="h-4 w-4" />
                  Advanced
                </TabsTrigger>
              </TabsList>

              <TabsContent value="general" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Basic Configuration</CardTitle>
                    <CardDescription>Set up the basic parameters for AI analysis</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="configName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Configuration Name</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., High-Accuracy Commercial Analysis" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="processingMode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Processing Mode</FormLabel>
                          <div className="grid grid-cols-2 gap-3">
                            {PROCESSING_MODES.map((mode) => {
                              const Icon = mode.icon;
                              return (
                                <Card 
                                  key={mode.value}
                                  className={`cursor-pointer border-2 transition-colors ${
                                    field.value === mode.value 
                                      ? 'border-primary bg-primary/5' 
                                      : 'border-muted hover:border-primary/50'
                                  }`}
                                  onClick={() => field.onChange(mode.value)}
                                >
                                  <CardContent className="p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                      <Icon className="h-4 w-4" />
                                      <span className="font-medium">{mode.label}</span>
                                      <Badge variant="outline" className="ml-auto">{mode.time}</Badge>
                                    </div>
                                    <p className="text-sm text-muted-foreground">{mode.description}</p>
                                  </CardContent>
                                </Card>
                              );
                            })}
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="analysisStandards"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Building Standards & Codes</FormLabel>
                          <FormDescription>Select the standards to apply during analysis</FormDescription>
                          <div className="grid grid-cols-2 gap-3">
                            {ANALYSIS_STANDARDS.map((standard) => (
                              <div key={standard.value} className="flex items-center space-x-2">
                                <Checkbox
                                  id={standard.value}
                                  checked={field.value?.includes(standard.value)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      field.onChange([...field.value, standard.value]);
                                    } else {
                                      field.onChange(field.value?.filter((s) => s !== standard.value));
                                    }
                                  }}
                                />
                                <Label htmlFor={standard.value} className="flex-1">
                                  <span className="font-medium">{standard.label}</span>
                                  <Badge variant="secondary" className="ml-2">{standard.region}</Badge>
                                </Label>
                              </div>
                            ))}
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="models" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>AI Model Selection</CardTitle>
                    <CardDescription>Choose the AI models for different analysis tasks</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <FormField
                      control={form.control}
                      name="aiModels.nlp"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Natural Language Processing</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select NLP model" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="standard">Standard - spaCy based processing</SelectItem>
                              <SelectItem value="advanced">Advanced - Transformer models (BERT/GPT)</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            Advanced models provide better understanding of complex specifications
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="aiModels.cv"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Computer Vision</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select CV model" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="opencv">OpenCV - Traditional computer vision</SelectItem>
                              <SelectItem value="yolo">YOLO - Real-time object detection</SelectItem>
                              <SelectItem value="detectron">Detectron2 - Advanced instance segmentation</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            YOLO and Detectron2 provide superior accuracy for complex drawings
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="aiModels.ocr"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Optical Character Recognition</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select OCR model" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="tesseract">Tesseract - Open source OCR</SelectItem>
                              <SelectItem value="advanced">Advanced - Cloud-based OCR with higher accuracy</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            Advanced OCR provides better accuracy for handwritten text and complex layouts
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="components" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Component Detection</CardTitle>
                    <CardDescription>Select which building components to detect and analyze</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FormField
                      control={form.control}
                      name="detectComponents"
                      render={({ field }) => (
                        <FormItem>
                          <div className="grid grid-cols-3 gap-3">
                            {COMPONENT_TYPES.map((component) => (
                              <div key={component.value} className="flex items-center space-x-2">
                                <Checkbox
                                  id={component.value}
                                  checked={field.value?.includes(component.value)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      field.onChange([...field.value, component.value]);
                                    } else {
                                      field.onChange(field.value?.filter((c) => c !== component.value));
                                    }
                                  }}
                                />
                                <Label htmlFor={component.value} className="flex items-center gap-2">
                                  <span>{component.icon}</span>
                                  {component.label}
                                </Label>
                              </div>
                            ))}
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="advanced" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Advanced Settings</CardTitle>
                    <CardDescription>Fine-tune the extraction and processing parameters</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <FormField
                      control={form.control}
                      name="extractionSettings.confidence"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confidence Threshold: {(field.value * 100).toFixed(0)}%</FormLabel>
                          <FormControl>
                            <Slider
                              min={0.5}
                              max={0.95}
                              step={0.05}
                              value={[field.value]}
                              onValueChange={([value]) => field.onChange(value)}
                              className="w-full"
                            />
                          </FormControl>
                          <FormDescription>
                            Higher values improve accuracy but may miss some elements
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="extractionSettings.precision"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Processing Precision</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="low">Low - Fastest processing</SelectItem>
                              <SelectItem value="medium">Medium - Balanced speed/quality</SelectItem>
                              <SelectItem value="high">High - Better accuracy</SelectItem>
                              <SelectItem value="ultra">Ultra - Maximum precision</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Separator />

                    <div className="space-y-4">
                      <h4 className="text-sm font-medium">Feature Toggles</h4>
                      
                      <FormField
                        control={form.control}
                        name="extractionSettings.enableOCR"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                            <div className="space-y-0.5">
                              <FormLabel>OCR Processing</FormLabel>
                              <FormDescription>
                                Extract text from scanned documents and drawings
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="extractionSettings.enableTableExtraction"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                            <div className="space-y-0.5">
                              <FormLabel>Table Extraction</FormLabel>
                              <FormDescription>
                                Detect and extract data from tables and schedules
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="extractionSettings.enableDimensionDetection"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                            <div className="space-y-0.5">
                              <FormLabel>Dimension Detection</FormLabel>
                              <FormDescription>
                                Automatically detect and extract dimensions from drawings
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="extractionSettings.enableMEPAnalysis"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                            <div className="space-y-0.5">
                              <FormLabel>MEP System Analysis</FormLabel>
                              <FormDescription>
                                Analyze mechanical, electrical, and plumbing systems
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>

                    <Separator />

                    <FormField
                      control={form.control}
                      name="isDefault"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                          <div className="space-y-0.5">
                            <FormLabel>Set as Default Configuration</FormLabel>
                            <FormDescription>
                              Use this configuration for new document uploads
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onClose && onClose()}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Saving..." : "Save Configuration"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}