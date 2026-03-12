import { Building2, Home, Factory, Truck, Calendar, DollarSign, Users, FileText } from "lucide-react";

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  icon: string; // Icon name for dynamic loading
  category: "commercial" | "residential" | "industrial" | "infrastructure";
  
  // Visual characteristics
  primaryColor: string;
  gradientFrom: string;
  gradientTo: string;
  
  // Project characteristics
  typicalBudgetRange: {
    min: number;
    max: number;
    currency: string;
  };
  
  typicalDuration: {
    min: number;
    max: number;
    unit: "months" | "weeks";
  };
  
  // Key features and deliverables
  keyFeatures: string[];
  deliverables: string[];
  
  // Compliance and standards
  commonStandards: {
    canada: string[];
    usa: string[];
  };
  
  // Sample specifications
  sampleSpecs: {
    buildingArea: { min: number; max: number; unit: string };
    floors: { min: number; max: number };
    occupancy: string;
  };
  
  // Team and resources
  typicalTeamSize: number;
  keyRoles: string[];
  
  // Risk factors
  commonRisks: string[];
  complexityLevel: "Low" | "Medium" | "High" | "Very High";
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "commercial-office",
    name: "Commercial Office Building",
    description: "Multi-story office buildings, retail spaces, and mixed-use commercial developments with modern amenities and sustainable design.",
    icon: "Building2",
    category: "commercial",
    primaryColor: "#3B82F6",
    gradientFrom: "#3B82F6",
    gradientTo: "#1D4ED8",
    
    typicalBudgetRange: {
      min: 500000,
      max: 50000000,
      currency: "CAD"
    },
    
    typicalDuration: {
      min: 8,
      max: 36,
      unit: "months"
    },
    
    keyFeatures: [
      "Modern HVAC systems with energy recovery",
      "Open concept office layouts with flexibility",
      "Integrated smart building technologies",
      "Sustainable materials and LEED certification",
      "Advanced fire safety and security systems",
      "Underground parking and loading docks"
    ],
    
    deliverables: [
      "Architectural drawings and 3D renderings",
      "Structural engineering calculations",
      "MEP (Mechanical, Electrical, Plumbing) plans",
      "Bill of Quantities with detailed cost breakdown",
      "Project schedule and milestone timeline",
      "Building code compliance reports",
      "Environmental impact assessment",
      "Construction specifications and material lists"
    ],
    
    commonStandards: {
      canada: ["National Building Code (NBC)", "CSA Standards", "Ontario Building Code"],
      usa: ["International Building Code (IBC)", "ASCE Standards", "Local Building Codes"]
    },
    
    sampleSpecs: {
      buildingArea: { min: 186, max: 9290, unit: "m²" },
      floors: { min: 2, max: 40 },
      occupancy: "Business and Assembly"
    },
    
    typicalTeamSize: 12,
    keyRoles: [
      "Project Manager",
      "Architect", 
      "Structural Engineer",
      "MEP Engineer",
      "Cost Estimator",
      "Building Code Specialist"
    ],
    
    commonRisks: [
      "Complex zoning and permitting requirements",
      "Coordination between multiple building systems",
      "Material cost fluctuations",
      "Weather delays for high-rise construction"
    ],
    complexityLevel: "High"
  },
  
  {
    id: "residential-housing",
    name: "Residential Housing",
    description: "Single-family homes, townhouses, and multi-unit residential developments designed for comfort, efficiency, and modern living.",
    icon: "Home",
    category: "residential",
    primaryColor: "#10B981",
    gradientFrom: "#10B981",
    gradientTo: "#059669",
    
    typicalBudgetRange: {
      min: 150000,
      max: 2000000,
      currency: "CAD"
    },
    
    typicalDuration: {
      min: 3,
      max: 18,
      unit: "months"
    },
    
    keyFeatures: [
      "Energy-efficient building envelope",
      "Modern kitchen and bathroom designs",
      "Open-concept living spaces",
      "Smart home technology integration",
      "Sustainable building materials",
      "Outdoor living spaces and landscaping"
    ],
    
    deliverables: [
      "Architectural floor plans and elevations",
      "Foundation and framing details",
      "Electrical and plumbing schematics", 
      "Material specifications and finishes",
      "Energy efficiency calculations",
      "Residential building code compliance",
      "Construction timeline and budget",
      "Landscape and site development plans"
    ],
    
    commonStandards: {
      canada: ["National Building Code (NBC)", "CSA Standards", "Provincial Residential Codes"],
      usa: ["International Residential Code (IRC)", "Local Residential Building Codes"]
    },
    
    sampleSpecs: {
      buildingArea: { min: 74, max: 743, unit: "m²" },
      floors: { min: 1, max: 3 },
      occupancy: "Residential Single/Multi-Family"
    },
    
    typicalTeamSize: 8,
    keyRoles: [
      "Residential Architect",
      "Project Coordinator",
      "Structural Engineer", 
      "Electrical Contractor",
      "Plumbing Contractor",
      "Interior Designer"
    ],
    
    commonRisks: [
      "Weather delays during construction",
      "Material delivery and supply chain issues",
      "Soil conditions and foundation challenges",
      "Utility connection and service availability"
    ],
    complexityLevel: "Medium"
  },
  
  {
    id: "industrial-manufacturing",
    name: "Industrial & Manufacturing",
    description: "Manufacturing facilities, warehouses, and industrial complexes designed for efficient operations, safety, and regulatory compliance.",
    icon: "Factory",
    category: "industrial",
    primaryColor: "#F59E0B",
    gradientFrom: "#F59E0B",
    gradientTo: "#D97706",
    
    typicalBudgetRange: {
      min: 1000000,
      max: 100000000,
      currency: "CAD"
    },
    
    typicalDuration: {
      min: 6,
      max: 48,
      unit: "months"
    },
    
    keyFeatures: [
      "Heavy-duty structural systems for equipment",
      "Specialized HVAC for industrial processes",
      "High-bay storage and clear span construction",
      "Crane systems and material handling equipment",
      "Safety systems and emergency protocols",
      "Environmental controls and waste management"
    ],
    
    deliverables: [
      "Industrial facility layout and design",
      "Heavy structural engineering calculations",
      "Process piping and utility systems",
      "Safety and environmental compliance reports",
      "Equipment foundation and anchor plans",
      "Fire protection and suppression systems",
      "Construction phasing and logistics plans",
      "Specialized material and equipment specifications"
    ],
    
    commonStandards: {
      canada: ["National Building Code (NBC)", "CSA Industrial Standards", "Provincial Safety Codes"],
      usa: ["International Building Code (IBC)", "OSHA Standards", "Industrial Building Codes"]
    },
    
    sampleSpecs: {
      buildingArea: { min: 929, max: 46451, unit: "m²" },
      floors: { min: 1, max: 5 },
      occupancy: "Industrial and Factory"
    },
    
    typicalTeamSize: 15,
    keyRoles: [
      "Industrial Engineer",
      "Process Engineer",
      "Structural Engineer",
      "Safety Specialist",
      "Environmental Consultant",
      "Project Manager"
    ],
    
    commonRisks: [
      "Complex industrial process requirements",
      "Environmental and safety regulatory compliance",
      "Specialized equipment procurement and installation",
      "Utility capacity and infrastructure upgrades"
    ],
    complexityLevel: "Very High"
  },
  
  {
    id: "infrastructure-public",
    name: "Infrastructure & Public Works",
    description: "Roads, bridges, utilities, and public infrastructure projects that form the backbone of communities and transportation networks.",
    icon: "Truck",
    category: "infrastructure",
    primaryColor: "#8B5CF6",
    gradientFrom: "#8B5CF6",
    gradientTo: "#7C3AED",
    
    typicalBudgetRange: {
      min: 500000,
      max: 500000000,
      currency: "CAD"
    },
    
    typicalDuration: {
      min: 6,
      max: 60,
      unit: "months"
    },
    
    keyFeatures: [
      "Durable materials for long-term performance",
      "Traffic management and safety systems",
      "Underground utility coordination",
      "Environmental protection measures",
      "Accessibility and universal design",
      "Smart infrastructure and monitoring systems"
    ],
    
    deliverables: [
      "Civil engineering drawings and specifications",
      "Geotechnical investigation reports",
      "Traffic impact assessment and management plans",
      "Environmental impact studies",
      "Utility coordination and relocation plans",
      "Public consultation and stakeholder reports",
      "Construction staging and logistics plans",
      "Asset management and maintenance schedules"
    ],
    
    commonStandards: {
      canada: ["Canadian Highway Bridge Design Code", "Municipal Design Standards", "Provincial Transportation Standards"],
      usa: ["AASHTO Standards", "Federal Highway Administration Guidelines", "State DOT Standards"]
    },
    
    sampleSpecs: {
      buildingArea: { min: 305, max: 304800, unit: "linear m" },
      floors: { min: 1, max: 1 },
      occupancy: "Public Assembly and Transportation"
    },
    
    typicalTeamSize: 20,
    keyRoles: [
      "Civil Engineer",
      "Transportation Engineer", 
      "Geotechnical Engineer",
      "Environmental Specialist",
      "Public Consultation Coordinator",
      "Construction Manager"
    ],
    
    commonRisks: [
      "Complex regulatory approval processes",
      "Public opposition and stakeholder concerns",
      "Unknown subsurface conditions",
      "Weather-dependent construction schedules",
      "Utility conflicts and relocations"
    ],
    complexityLevel: "Very High"
  }
];

// Helper functions for template data
export const getTemplateById = (id: string): ProjectTemplate | undefined => {
  return PROJECT_TEMPLATES.find(template => template.id === id);
};

export const getTemplatesByCategory = (category: ProjectTemplate['category']): ProjectTemplate[] => {
  return PROJECT_TEMPLATES.filter(template => template.category === category);
};

export const formatBudgetRange = (range: ProjectTemplate['typicalBudgetRange']): string => {
  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return `$${(num / 1000000).toFixed(1)}M`;
    } else if (num >= 1000) {
      return `$${(num / 1000).toFixed(0)}K`;
    } else {
      return `$${num.toLocaleString()}`;
    }
  };
  
  return `${formatNumber(range.min)} - ${formatNumber(range.max)} ${range.currency}`;
};

export const formatDuration = (duration: ProjectTemplate['typicalDuration']): string => {
  if (duration.min === duration.max) {
    return `${duration.min} ${duration.unit}`;
  }
  return `${duration.min}-${duration.max} ${duration.unit}`;
};