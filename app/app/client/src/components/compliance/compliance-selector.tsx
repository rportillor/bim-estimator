import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Shield, 
  Flame, 
  Droplets, 
  Zap, 
  Settings, 
  Wind, 
  Gauge, 
  MapPin,
  Building,
  AlertTriangle,
  CheckCircle,
  Layers,
  Package
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";


interface ComplianceCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  standards: string[];
  required: boolean;
  jurisdiction: "canada" | "us" | "both";
  level: "federal" | "provincial" | "municipal" | "all";
}

const complianceCategories: ComplianceCategory[] = [
  // FEDERAL LEVEL - CANADA
  {
    id: "national_building_code",
    name: "National Building Code of Canada (NBC)",
    description: "Federal building code for all Canadian provinces",
    icon: "Building",
    standards: ["NBC Part 3", "NBC Part 4", "NBC Part 6", "NBC Part 9"],
    required: true,
    jurisdiction: "canada",
    level: "federal"
  },
  {
    id: "canadian_electrical_code",
    name: "Canadian Electrical Code (CEC)",
    description: "Federal electrical safety standards",
    icon: "Zap",
    standards: ["CEC Section 12", "CEC Section 26", "CEC Section 64"],
    required: true,
    jurisdiction: "canada",
    level: "federal"
  },
  {
    id: "national_plumbing_code",
    name: "National Plumbing Code of Canada",
    description: "Federal plumbing and drainage standards",
    icon: "Droplets",
    standards: ["NPC Part 2", "NPC Part 3", "NPC Part 7"],
    required: true,
    jurisdiction: "canada",
    level: "federal"
  },
  {
    id: "national_fire_code",
    name: "National Fire Code of Canada (NFC)",
    description: "Federal fire safety and protection standards",
    icon: "Flame",
    standards: ["NFC Part 2", "NFC Part 3", "NFC Part 5"],
    required: true,
    jurisdiction: "canada",
    level: "federal"
  },
  {
    id: "canadian_accessibility_standards",
    name: "Accessible Canada Act Standards",
    description: "Federal accessibility and barrier-free design",
    icon: "Settings",
    standards: ["ACA Section 117", "CSA B651-18", "AODA Standards"],
    required: false,
    jurisdiction: "canada",
    level: "federal"
  },

  // PROVINCIAL LEVEL - CANADA
  {
    id: "ontario_building_code",
    name: "Ontario Building Code (OBC)",
    description: "Provincial building code for Ontario projects",
    icon: "Building",
    standards: ["OBC Part 1", "OBC Part 3", "OBC Part 4", "OBC Part 9", "OBC Division A"],
    required: true,
    jurisdiction: "canada",
    level: "provincial"
  },
  {
    id: "british_columbia_building_code",
    name: "British Columbia Building Code (BCBC)",
    description: "Provincial building code for BC projects",
    icon: "Building",
    standards: ["BCBC Part 3", "BCBC Part 4", "BCBC Part 9", "BCBC Part 10"],
    required: true,
    jurisdiction: "canada",
    level: "provincial"
  },
  {
    id: "alberta_building_code",
    name: "Alberta Building Code (ABC)",
    description: "Provincial building code for Alberta projects",
    icon: "Building",
    standards: ["ABC Part 3", "ABC Part 4", "ABC Part 9"],
    required: true,
    jurisdiction: "canada",
    level: "provincial"
  },
  {
    id: "quebec_construction_code",
    name: "Quebec Construction Code",
    description: "Provincial construction standards for Quebec",
    icon: "Building",
    standards: ["QCC Chapter I", "QCC Chapter II", "QCC Chapter V"],
    required: true,
    jurisdiction: "canada",
    level: "provincial"
  },

  // MUNICIPAL LEVEL - CANADA
  {
    id: "toronto_building_bylaws",
    name: "Toronto Building By-laws",
    description: "Municipal building regulations for Toronto",
    icon: "Building",
    standards: ["By-law 569-2013", "By-law 438-86", "Zoning By-law 569-2013"],
    required: true,
    jurisdiction: "canada",
    level: "municipal"
  },
  {
    id: "vancouver_building_bylaws",
    name: "Vancouver Building By-laws",
    description: "Municipal building regulations for Vancouver",
    icon: "Building",
    standards: ["By-law No. 12511", "Zoning By-law", "Development By-law"],
    required: true,
    jurisdiction: "canada",
    level: "municipal"
  },
  {
    id: "calgary_land_use_bylaw",
    name: "Calgary Land Use By-law",
    description: "Municipal zoning and development standards",
    icon: "MapPin",
    standards: ["By-law 1P2007", "Development Standards", "Parking Standards"],
    required: true,
    jurisdiction: "canada",
    level: "municipal"
  },

  // FEDERAL LEVEL - US
  {
    id: "international_building_code",
    name: "International Building Code (IBC)",
    description: "US federal commercial building code",
    icon: "Building",
    standards: ["IBC Chapter 7", "IBC Chapter 11", "IBC Chapter 13", "IBC Chapter 16"],
    required: true,
    jurisdiction: "us",
    level: "federal"
  },
  {
    id: "international_residential_code",
    name: "International Residential Code (IRC)",
    description: "US federal residential building code",
    icon: "Building",
    standards: ["IRC Chapter 3", "IRC Chapter 6", "IRC Chapter 8"],
    required: true,
    jurisdiction: "us",
    level: "federal"
  },
  {
    id: "national_electrical_code",
    name: "National Electrical Code (NEC)",
    description: "US federal electrical safety standards",
    icon: "Zap",
    standards: ["NEC Article 210", "NEC Article 250", "NEC Article 700"],
    required: true,
    jurisdiction: "us",
    level: "federal"
  },

  // STATE LEVEL - US
  {
    id: "california_building_code",
    name: "California Building Code (CBC)",
    description: "State building standards for California",
    icon: "Building",
    standards: ["CBC Chapter 7A", "CBC Chapter 16A", "CBC Chapter 17A"],
    required: true,
    jurisdiction: "us",
    level: "provincial"
  },
  {
    id: "new_york_building_code",
    name: "New York State Building Code",
    description: "State building standards for New York",
    icon: "Building",
    standards: ["NYS Building Code", "NYS Residential Code", "NYS Energy Code"],
    required: true,
    jurisdiction: "us",
    level: "provincial"
  },
  {
    id: "texas_building_code",
    name: "Texas Building Code",
    description: "State building standards for Texas",
    icon: "Building",
    standards: ["Texas Accessibility Standards", "Texas Residential Code"],
    required: true,
    jurisdiction: "us",
    level: "provincial"
  },

  // MUNICIPAL LEVEL - US
  {
    id: "nyc_building_code",
    name: "New York City Building Code",
    description: "Municipal building regulations for NYC",
    icon: "Building",
    standards: ["NYC Building Code", "NYC Zoning Resolution", "NYC Fire Code"],
    required: true,
    jurisdiction: "us",
    level: "municipal"
  },
  {
    id: "chicago_building_code",
    name: "Chicago Building Code",
    description: "Municipal building regulations for Chicago",
    icon: "Building",
    standards: ["Chicago Municipal Code Title 14", "Chicago Zoning Ordinance"],
    required: true,
    jurisdiction: "us",
    level: "municipal"
  },
  {
    id: "los_angeles_building_code",
    name: "Los Angeles Building Code",
    description: "Municipal building regulations for LA",
    icon: "Building",
    standards: ["LABC Chapter 91", "LABC Chapter 99", "LA Zoning Code"],
    required: true,
    jurisdiction: "us",
    level: "municipal"
  },

  // SPECIALIZED STANDARDS (ALL LEVELS)
  {
    id: "structural_standards",
    name: "ASCE Structural Standards",
    description: "American structural engineering standards",
    icon: "Building",
    standards: ["ASCE 7-22", "ASCE 41-23"],
    required: true,
    jurisdiction: "us",
    level: "all"
  },
  {
    id: "steel_construction",
    name: "AISC Steel Construction",
    description: "American steel construction standards",
    icon: "Building",
    standards: ["AISC 360-22", "AISC 341-22", "AISC 358-22"],
    required: true,
    jurisdiction: "us",
    level: "all"
  },
  {
    id: "environmental_assessment",
    name: "Environmental Assessment",
    description: "CEAA, NEPA, and environmental legislation",
    icon: "Droplets",
    standards: ["CEAA 2012", "Impact Assessment Act", "NEPA 1969", "CEQ Guidelines"],
    required: true,
    jurisdiction: "both",
    level: "all"
  },
  {
    id: "materials",
    name: "Construction Materials",
    description: "Material specifications and standards",
    icon: "Package",
    standards: ["BNQ 2560-600/2002", "CSA A23.1-09", "CSA A3000-18"],
    required: true,
    jurisdiction: "both",
    level: "all"
  }
];

interface ComplianceSelectorProps {
  projectId: string;
}

export default function ComplianceSelector({ projectId }: ComplianceSelectorProps) {
  const [projectJurisdiction, setProjectJurisdiction] = useState<"canada" | "us">("canada");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [jurisdiction, setJurisdiction] = useState<string>("federal");
  const [province, setProvince] = useState<string>("");
  const [priority, setPriority] = useState<string>("standard");
  const [unselectedRequiredCategories, setUnselectedRequiredCategories] = useState<string[]>([]);

  // Update selected categories when project jurisdiction or level changes (hierarchical)
  const updateRequiredCategories = (newJurisdiction: "canada" | "us", jurisdictionLevel: string = jurisdiction, selectedProvince: string = province) => {
    const requiredForJurisdiction = complianceCategories
      .filter(cat => {
        const matchesCountry = cat.jurisdiction === newJurisdiction || cat.jurisdiction === "both";
        
        // Hierarchical level filtering for required codes
        let matchesLevel = false;
        if (jurisdictionLevel === "federal") {
          matchesLevel = cat.level === "federal" || cat.level === "all";
        } else if (jurisdictionLevel === "provincial") {
          matchesLevel = cat.level === "federal" || cat.level === "provincial" || cat.level === "all";
        } else if (jurisdictionLevel === "municipal") {
          matchesLevel = cat.level === "federal" || cat.level === "provincial" || cat.level === "municipal" || cat.level === "all";
        } else if (jurisdictionLevel === "custom") {
          matchesLevel = true;
        }
        
        // Province/State specific filtering for required codes
        let matchesLocation = true;
        if ((jurisdictionLevel === "provincial" || jurisdictionLevel === "municipal") && cat.level === "provincial") {
          if (!selectedProvince) {
            // No province selected yet - exclude ALL provincial codes from auto-selection
            matchesLocation = false;
          } else {
            // Province is selected - only auto-select if there's an exact match
            const validProvinceMatches = [
              { province: "ON", codeId: "ontario_building_code" },
              { province: "BC", codeId: "british_columbia_building_code" },
              { province: "AB", codeId: "alberta_building_code" },
              { province: "QC", codeId: "quebec_construction_code" },
              { province: "CA", codeId: "california_building_code" },
              { province: "NY", codeId: "new_york_building_code" },
              { province: "TX", codeId: "texas_building_code" }
            ];
            
            const matchingCode = validProvinceMatches.find(match => match.province === selectedProvince);
            
            if (matchingCode) {
              // Province has a specific code - only select that one
              if (cat.id !== matchingCode.codeId) matchesLocation = false;
            } else {
              // Province has no specific code - exclude all provincial codes
              matchesLocation = false;
            }
          }
        }
        
        if ((jurisdictionLevel === "municipal") && cat.level === "municipal") {
          if (!selectedProvince) {
            // No province selected yet - exclude ALL municipal codes from auto-selection
            matchesLocation = false;
          } else {
            // Province is selected - only auto-select if there's an exact match
            const validMunicipalMatches = [
              { province: "ON", codeId: "toronto_building_bylaws" },
              { province: "BC", codeId: "vancouver_building_bylaws" },
              { province: "AB", codeId: "calgary_land_use_bylaw" },
              { province: "NY", codeId: "nyc_building_code" },
              { province: "IL", codeId: "chicago_building_code" },
              { province: "CA", codeId: "los_angeles_building_code" }
            ];
            
            const matchingMunicipalCode = validMunicipalMatches.find(match => match.province === selectedProvince);
            
            if (matchingMunicipalCode) {
              // Province has a municipal code - only select that one
              if (cat.id !== matchingMunicipalCode.codeId) matchesLocation = false;
            } else {
              // Province has no municipal code - exclude all municipal codes
              matchesLocation = false;
            }
          }
        }
        
        return cat.required && matchesCountry && matchesLevel && matchesLocation;
      })
      .map(cat => cat.id);
    setSelectedCategories(requiredForJurisdiction);
  };

  // Initialize with Canadian federal codes by default
  React.useEffect(() => {
    updateRequiredCategories("canada", "federal", "");
  }, []);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const runComplianceMutation = useMutation({
    mutationFn: async (config: { categories: string[], jurisdiction: string, province?: string, priority: string }) => {
      return await apiRequest("POST", `/api/projects/${projectId}/compliance-checks/comprehensive`, config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/compliance-checks`] });
      toast({
        title: "Compliance checks initiated",
        description: `Running ${selectedCategories.length} compliance verification modules`,
      });
    },
    onError: () => {
      toast({
        title: "Failed to start compliance checks",
        description: "There was an error initiating the compliance verification",
        variant: "destructive",
      });
    },
  });

  const getIcon = (iconName: string) => {
    const icons = {
      Building, Flame, Droplets, Zap, Settings, Wind, Gauge, MapPin, Shield, Layers, Package
    };
    const IconComponent = icons[iconName as keyof typeof icons] || Shield;
    return <IconComponent className="h-5 w-5" />;
  };

  const toggleCategory = (categoryId: string) => {
    const category = complianceCategories.find(cat => cat.id === categoryId);
    const isRequired = category?.required && (category.jurisdiction === projectJurisdiction || category.jurisdiction === "both");
    
    // In custom mode, allow unselecting required categories but track them
    if (jurisdiction !== "custom" && isRequired) {
      return; // Can't deselect required categories outside custom mode
    }
    
    setSelectedCategories(prev => {
      const isCurrentlySelected = prev.includes(categoryId);
      
      if (isCurrentlySelected) {
        // Unselecting - if it's a required category in custom mode, track it
        if (jurisdiction === "custom" && isRequired) {
          setUnselectedRequiredCategories(prevUnselected => 
            prevUnselected.includes(categoryId) 
              ? prevUnselected 
              : [...prevUnselected, categoryId]
          );
        }
        return prev.filter(id => id !== categoryId);
      } else {
        // Selecting - if it was an unselected required category, remove from tracking
        if (jurisdiction === "custom" && isRequired) {
          setUnselectedRequiredCategories(prevUnselected => 
            prevUnselected.filter(id => id !== categoryId)
          );
        }
        return [...prev, categoryId];
      }
    });
  };

  const handleJurisdictionChange = (newJurisdiction: "canada" | "us") => {
    setProjectJurisdiction(newJurisdiction);
    // Clear province selection when switching countries
    setProvince("");
    updateRequiredCategories(newJurisdiction, jurisdiction, "");
  };

  // Update selected categories when jurisdiction level changes
  const handleJurisdictionLevelChange = (newLevel: string) => {
    setJurisdiction(newLevel);
    // Clear unselected required tracking when leaving custom mode
    if (newLevel !== "custom") {
      setUnselectedRequiredCategories([]);
    }
    updateRequiredCategories(projectJurisdiction, newLevel, province);
  };

  // Update selected categories when province changes
  const handleProvinceChange = (newProvince: string) => {
    setProvince(newProvince);
    updateRequiredCategories(projectJurisdiction, jurisdiction, newProvince);
  };

  // Filter categories by current jurisdiction AND jurisdiction level (hierarchical) AND specific location
  const availableCategories = complianceCategories.filter(
    cat => {
      // First filter by country
      const matchesCountry = cat.jurisdiction === projectJurisdiction || cat.jurisdiction === "both";
      
      // Hierarchical level filtering: show current level and all levels below
      let matchesLevel = false;
      if (jurisdiction === "federal") {
        matchesLevel = cat.level === "federal" || cat.level === "all";
      } else if (jurisdiction === "provincial") {
        matchesLevel = cat.level === "federal" || cat.level === "provincial" || cat.level === "all";
      } else if (jurisdiction === "municipal") {
        matchesLevel = cat.level === "federal" || cat.level === "provincial" || cat.level === "municipal" || cat.level === "all";
      } else if (jurisdiction === "custom") {
        matchesLevel = true; // Show all for custom
      }
      
      // Province/State specific filtering
      let matchesLocation = true;
      if ((jurisdiction === "provincial" || jurisdiction === "municipal") && province && cat.level === "provincial") {
        // For provincial codes, only show if there's an exact match, otherwise hide all provincial codes
        const validProvinceMatches = [
          { province: "ON", codeId: "ontario_building_code" },
          { province: "BC", codeId: "british_columbia_building_code" },
          { province: "AB", codeId: "alberta_building_code" },
          { province: "QC", codeId: "quebec_construction_code" },
          { province: "CA", codeId: "california_building_code" },
          { province: "NY", codeId: "new_york_building_code" },
          { province: "TX", codeId: "texas_building_code" }
        ];
        
        const matchingCode = validProvinceMatches.find(match => match.province === province);
        
        if (matchingCode) {
          // Province has a specific code - only show that one
          if (cat.id !== matchingCode.codeId) matchesLocation = false;
        } else {
          // Province has no specific code - hide all provincial codes
          matchesLocation = false;
        }
      }
      
      if ((jurisdiction === "municipal") && province && cat.level === "municipal") {
        // For municipal codes, only show if there's an exact match for the province/state
        const validMunicipalMatches = [
          { province: "ON", codeId: "toronto_building_bylaws" },
          { province: "BC", codeId: "vancouver_building_bylaws" },
          { province: "AB", codeId: "calgary_land_use_bylaw" },
          { province: "NY", codeId: "nyc_building_code" },
          { province: "IL", codeId: "chicago_building_code" },
          { province: "CA", codeId: "los_angeles_building_code" }
        ];
        
        const matchingMunicipalCode = validMunicipalMatches.find(match => match.province === province);
        
        if (matchingMunicipalCode) {
          // Province has a municipal code - only show that one
          if (cat.id !== matchingMunicipalCode.codeId) matchesLocation = false;
        } else {
          // Province has no municipal code - hide all municipal codes
          matchesLocation = false;
        }
      }
      
      return matchesCountry && matchesLevel && matchesLocation;
    }
  );

  const runComplianceChecks = () => {
    runComplianceMutation.mutate({
      categories: selectedCategories,
      jurisdiction,
      province,
      priority
    });
  };

  const selectedCount = selectedCategories.length;
  const totalStandards = complianceCategories
    .filter(cat => selectedCategories.includes(cat.id))
    .reduce((total, cat) => total + cat.standards.length, 0);

  return (
    <div className="space-y-6">
      {/* Configuration Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Compliance Verification Configuration
          </CardTitle>
          <CardDescription>
            Select which building systems and standards to verify against your project
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Project Location</Label>
              <Select 
                value={projectJurisdiction} 
                onValueChange={(value: "canada" | "us") => handleJurisdictionChange(value)}
              >
                <SelectTrigger data-testid="select-project-jurisdiction">
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="canada">Canada</SelectItem>
                  <SelectItem value="us">United States</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Jurisdiction Level</Label>
              <Select value={jurisdiction} onValueChange={handleJurisdictionLevelChange}>
                <SelectTrigger data-testid="select-jurisdiction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="federal">Federal Standards</SelectItem>
                  <SelectItem value="provincial">Provincial/State Standards</SelectItem>
                  <SelectItem value="municipal">Municipal Standards</SelectItem>
                  <SelectItem value="custom">Custom Requirements</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {(jurisdiction === "provincial" || jurisdiction === "municipal") && (
              <div className="space-y-2">
                <Label>Province/State</Label>
                <Select value={province} onValueChange={handleProvinceChange}>
                  <SelectTrigger data-testid="select-province">
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {projectJurisdiction === "canada" ? (
                      // Canadian Provinces and Territories
                      <>
                        <SelectItem value="ON">Ontario</SelectItem>
                        <SelectItem value="BC">British Columbia</SelectItem>
                        <SelectItem value="AB">Alberta</SelectItem>
                        <SelectItem value="QC">Quebec</SelectItem>
                        <SelectItem value="NS">Nova Scotia</SelectItem>
                        <SelectItem value="NB">New Brunswick</SelectItem>
                        <SelectItem value="MB">Manitoba</SelectItem>
                        <SelectItem value="SK">Saskatchewan</SelectItem>
                        <SelectItem value="PE">Prince Edward Island</SelectItem>
                        <SelectItem value="NL">Newfoundland and Labrador</SelectItem>
                        <SelectItem value="YT">Yukon</SelectItem>
                        <SelectItem value="NT">Northwest Territories</SelectItem>
                        <SelectItem value="NU">Nunavut</SelectItem>
                      </>
                    ) : (
                      // US States
                      <>
                        <SelectItem value="CA">California</SelectItem>
                        <SelectItem value="NY">New York</SelectItem>
                        <SelectItem value="TX">Texas</SelectItem>
                        <SelectItem value="FL">Florida</SelectItem>
                        <SelectItem value="IL">Illinois</SelectItem>
                        <SelectItem value="PA">Pennsylvania</SelectItem>
                        <SelectItem value="OH">Ohio</SelectItem>
                        <SelectItem value="GA">Georgia</SelectItem>
                        <SelectItem value="NC">North Carolina</SelectItem>
                        <SelectItem value="MI">Michigan</SelectItem>
                        <SelectItem value="WA">Washington</SelectItem>
                        <SelectItem value="AZ">Arizona</SelectItem>
                        <SelectItem value="MA">Massachusetts</SelectItem>
                        <SelectItem value="CO">Colorado</SelectItem>
                        <SelectItem value="OR">Oregon</SelectItem>
                        <SelectItem value="NV">Nevada</SelectItem>
                        <SelectItem value="NJ">New Jersey</SelectItem>
                        <SelectItem value="VA">Virginia</SelectItem>
                        <SelectItem value="TN">Tennessee</SelectItem>
                        <SelectItem value="IN">Indiana</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
            
            <div className="space-y-2">
              <Label>Verification Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger data-testid="select-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="essential">Essential Only</SelectItem>
                  <SelectItem value="standard">Standard Checks</SelectItem>
                  <SelectItem value="comprehensive">Comprehensive Review</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="flex items-center justify-between pt-4">
            <div className="flex gap-2">
              <Badge variant="outline">{selectedCount} categories selected</Badge>
              <Badge variant="outline">{totalStandards} standards to verify</Badge>
              {province && <Badge variant="outline">{province} specific codes</Badge>}
            </div>
            <Button 
              onClick={runComplianceChecks}
              disabled={
                selectedCategories.length === 0 || 
                runComplianceMutation.isPending ||
                ((jurisdiction === "provincial" || jurisdiction === "municipal") && !province)
              }
              data-testid="button-run-compliance"
            >
              {runComplianceMutation.isPending ? "Running..." : "Run Compliance Checks"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Warning for unselected required categories in custom mode */}
      {jurisdiction === "custom" && unselectedRequiredCategories.length > 0 && (
        <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
            <div>
              <h4 className="font-medium text-yellow-800 dark:text-yellow-200 mb-2">
                ⚠️ Cost Impact Warning
              </h4>
              <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-3">
                You have unselected {unselectedRequiredCategories.length} required compliance section{unselectedRequiredCategories.length > 1 ? 's' : ''}. 
                Removing these from the analysis might have a <strong>substantial impact on cost accuracy</strong> and could lead to:
              </p>
              <ul className="text-sm text-yellow-700 dark:text-yellow-300 list-disc list-inside space-y-1 mb-3">
                <li>Underestimated material and labor costs</li>
                <li>Missing regulatory compliance costs</li>
                <li>Potential project delays and rework</li>
                <li>Inaccurate risk assessment</li>
              </ul>
              <div className="text-xs text-yellow-600 dark:text-yellow-400">
                <strong>Unselected required sections:</strong>{' '}
                {unselectedRequiredCategories.map(catId => {
                  const category = complianceCategories.find(cat => cat.id === catId);
                  return category?.name;
                }).join(', ')}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Category Selection Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {availableCategories.map((category) => {
          const isSelected = selectedCategories.includes(category.id);
          const isRequired = category.required && (category.jurisdiction === projectJurisdiction || category.jurisdiction === "both");
          
          return (
            <Card 
              key={category.id}
              className={`cursor-pointer transition-all ${
                isSelected 
                  ? "ring-2 ring-primary bg-primary/5" 
                  : "hover:bg-gray-50"
              } ${isRequired ? "border-amber-200 bg-amber-50/50" : ""}`}
              onClick={() => toggleCategory(category.id)}
              data-testid={`compliance-category-${category.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex items-center gap-2">
                    <Checkbox 
                      checked={isSelected}
                      disabled={isRequired && jurisdiction !== "custom"}
                      onChange={() => {}} // Controlled by card click
                      data-testid={`checkbox-${category.id}`}
                    />
                    <div className={`p-2 rounded-lg ${
                      isSelected ? "bg-primary text-white" : "bg-gray-100"
                    }`}>
                      {getIcon(category.icon)}
                    </div>
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-gray-900">{category.name}</h4>
                      {isRequired && (
                        <Badge 
                          variant={jurisdiction === "custom" && !isSelected ? "destructive" : "secondary"} 
                          className="text-xs"
                        >
                          {jurisdiction === "custom" && !isSelected ? "Required (Unselected)" : "Required"}
                        </Badge>
                      )}
                      {isSelected && !isRequired && (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      )}
                    </div>
                    
                    <p className="text-sm text-gray-600 mb-3">
                      {category.description}
                    </p>
                    
                    <div className="flex flex-wrap gap-1">
                      {category.standards.slice(0, 3).map((standard) => (
                        <Badge 
                          key={standard}
                          variant="outline" 
                          className="text-xs"
                        >
                          {standard}
                        </Badge>
                      ))}
                      {category.standards.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{category.standards.length - 3} more
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Selected Summary */}
      {selectedCategories.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Verification Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {complianceCategories
                .filter(cat => selectedCategories.includes(cat.id))
                .map((category) => (
                  <div key={category.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="p-1.5 bg-primary/10 rounded">
                        {getIcon(category.icon)}
                      </div>
                      <div>
                        <p className="font-medium">{category.name}</p>
                        <p className="text-sm text-gray-600">{category.standards.length} standards</p>
                      </div>
                    </div>
                    <Badge variant="outline">
                      {category.required ? "Required" : "Optional"}
                    </Badge>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}