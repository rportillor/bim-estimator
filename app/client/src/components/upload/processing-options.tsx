import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Settings, Brain, Table, Eye, Search, FileText, MapPin, Shield } from "lucide-react";

interface ProcessingOptionsProps {
  onOptionsChange?: (options: ProcessingConfig) => void;
}

interface ProcessingConfig {
  modes: {
    textExtraction: boolean;
    tableExtraction: boolean;
    ocrExtraction: boolean;
    aiUnderstanding: boolean;
  };
  standards: string;
  outputFormats: string[];
  priority: string;
}

export default function ProcessingOptions({ onOptionsChange }: ProcessingOptionsProps) {
  const [config, setConfig] = useState<ProcessingConfig>({
    modes: {
      textExtraction: true,
      tableExtraction: true,
      ocrExtraction: true,
      aiUnderstanding: true
    },
    standards: "BOTH",
    outputFormats: ["excel", "ifc", "json"],
    priority: "accuracy"
  });

  const updateConfig = (updates: Partial<ProcessingConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    onOptionsChange?.(newConfig);
  };

  const updateModes = (mode: keyof ProcessingConfig["modes"], enabled: boolean) => {
    const newModes = { ...config.modes, [mode]: enabled };
    updateConfig({ modes: newModes });
  };

  const toggleOutputFormat = (format: string) => {
    const newFormats = config.outputFormats.includes(format)
      ? config.outputFormats.filter(f => f !== format)
      : [...config.outputFormats, format];
    updateConfig({ outputFormats: newFormats });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Processing Modes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Processing Modes
          </CardTitle>
          <CardDescription>
            Select which analysis methods to apply to your documents
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="textExtraction"
              checked={config.modes.textExtraction}
              onCheckedChange={(checked) => updateModes("textExtraction", checked as boolean)}
              data-testid="checkbox-text-extraction"
            />
            <div className="grid gap-1.5 leading-none">
              <Label 
                htmlFor="textExtraction"
                className="flex items-center gap-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                <FileText className="h-4 w-4" />
                Text Extraction
              </Label>
              <p className="text-xs text-muted-foreground">
                Extract specifications, clauses, and contract text
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="tableExtraction"
              checked={config.modes.tableExtraction}
              onCheckedChange={(checked) => updateModes("tableExtraction", checked as boolean)}
              data-testid="checkbox-table-extraction"
            />
            <div className="grid gap-1.5 leading-none">
              <Label 
                htmlFor="tableExtraction"
                className="flex items-center gap-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                <Table className="h-4 w-4" />
                Table Extraction
              </Label>
              <p className="text-xs text-muted-foreground">
                Parse BoQ schedules and material requirement tables
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="ocrExtraction"
              checked={config.modes.ocrExtraction}
              onCheckedChange={(checked) => updateModes("ocrExtraction", checked as boolean)}
              data-testid="checkbox-ocr-extraction"
            />
            <div className="grid gap-1.5 leading-none">
              <Label 
                htmlFor="ocrExtraction"
                className="flex items-center gap-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                <Eye className="h-4 w-4" />
                OCR Extraction
              </Label>
              <p className="text-xs text-muted-foreground">
                Process scanned drawings and handwritten specifications
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="aiUnderstanding"
              checked={config.modes.aiUnderstanding}
              onCheckedChange={(checked) => updateModes("aiUnderstanding", checked as boolean)}
              data-testid="checkbox-ai-understanding"
            />
            <div className="grid gap-1.5 leading-none">
              <Label 
                htmlFor="aiUnderstanding"
                className="flex items-center gap-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                <Brain className="h-4 w-4" />
                AI Understanding
              </Label>
              <p className="text-xs text-muted-foreground">
                Advanced NLP and computer vision analysis
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Configuration Options */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Analysis Configuration
          </CardTitle>
          <CardDescription>
            Configure standards, output formats, and processing priority
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Standards Selection */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Construction Standards
            </Label>
            <Select value={config.standards} onValueChange={(value) => updateConfig({ standards: value })}>
              <SelectTrigger data-testid="select-standards">
                <SelectValue placeholder="Select standards" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CA">Canadian Standards (NBC, CSA)</SelectItem>
                <SelectItem value="US">US Standards (IBC, ASTM, AISC)</SelectItem>
                <SelectItem value="BOTH">Both Canadian & US Standards</SelectItem>
                <SelectItem value="CUSTOM">Custom Standards</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Output Formats */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Export Formats
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "excel", label: "Excel BoQ" },
                { id: "ifc", label: "IFC Model" },
                { id: "json", label: "JSON Data" },
                { id: "pdf", label: "PDF Report" }
              ].map((format) => (
                <div key={format.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={format.id}
                    checked={config.outputFormats.includes(format.id)}
                    onCheckedChange={() => toggleOutputFormat(format.id)}
                    data-testid={`checkbox-format-${format.id}`}
                  />
                  <Label htmlFor={format.id} className="text-sm">
                    {format.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {/* Processing Priority */}
          <div className="space-y-2">
            <Label>Processing Priority</Label>
            <Select value={config.priority} onValueChange={(value) => updateConfig({ priority: value })}>
              <SelectTrigger data-testid="select-priority">
                <SelectValue placeholder="Select priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="speed">Speed (Faster processing)</SelectItem>
                <SelectItem value="accuracy">Accuracy (Higher precision)</SelectItem>
                <SelectItem value="comprehensive">Comprehensive (All features)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Processing Summary */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Processing Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <h4 className="font-medium mb-2">Active Modes</h4>
              <ul className="space-y-1 text-muted-foreground">
                {Object.entries(config.modes)
                  .filter(([_, enabled]) => enabled)
                  .map(([mode, _]) => (
                    <li key={mode} className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      {mode.replace(/([A-Z])/g, ' $1').toLowerCase()}
                    </li>
                  ))}
              </ul>
            </div>
            
            <div>
              <h4 className="font-medium mb-2">Standards & Priority</h4>
              <div className="space-y-1 text-muted-foreground">
                <p>Standards: {config.standards === "BOTH" ? "Canadian & US" : config.standards}</p>
                <p>Priority: {config.priority}</p>
                <p>Formats: {config.outputFormats.length} selected</p>
              </div>
            </div>
            
            <div>
              <h4 className="font-medium mb-2">Expected Outputs</h4>
              <ul className="space-y-1 text-muted-foreground">
                <li>• Bill of Quantities (BoQ)</li>
                <li>• Component detection</li>
                <li>• Compliance checks</li>
                <li>• 3D BIM model</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}