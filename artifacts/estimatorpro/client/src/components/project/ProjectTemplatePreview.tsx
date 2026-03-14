import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Building2, 
  Home, 
  Factory, 
  Truck, 
  Calendar, 
  DollarSign, 
  Users, 
  FileText,
  Clock,
  AlertTriangle,
  CheckCircle,
  ArrowRight,
  Zap
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  PROJECT_TEMPLATES, 
  type ProjectTemplate, 
  formatBudgetRange, 
  formatDuration 
} from "@shared/project-templates";

// Icon mapping for dynamic loading
const ICON_MAP = {
  Building2,
  Home,
  Factory,
  Truck,
  Calendar,
  DollarSign,
  Users,
  FileText,
  Clock,
  AlertTriangle,
  CheckCircle,
  ArrowRight,
  Zap
};

interface ProjectTemplatePreviewProps {
  onSelectTemplate: (_template: ProjectTemplate) => void;
  selectedTemplate?: ProjectTemplate | null;
  className?: string;
}

export function ProjectTemplatePreview({
  onSelectTemplate,
  selectedTemplate,
  className = ""
}: ProjectTemplatePreviewProps) {
  const [hoveredTemplate, setHoveredTemplate] = useState<string | null>(null);
  const [selectedView, setSelectedView] = useState<'grid' | 'detailed'>('grid');

  const getIcon = (iconName: string) => {
    const IconComponent = ICON_MAP[iconName as keyof typeof ICON_MAP];
    return IconComponent || Building2;
  };

  const getComplexityColor = (level: string) => {
    switch (level) {
      case 'Low': return 'bg-green-100 text-green-800';
      case 'Medium': return 'bg-yellow-100 text-yellow-800';
      case 'High': return 'bg-orange-100 text-orange-800';
      case 'Very High': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className={`w-full ${className}`}>
      {/* View Toggle */}
      <div className="flex justify-center mb-8">
        <div className="inline-flex bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setSelectedView('grid')}
            className={`px-4 py-2 rounded-md transition-all duration-200 ${
              selectedView === 'grid'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Grid View
          </button>
          <button
            onClick={() => setSelectedView('detailed')}
            className={`px-4 py-2 rounded-md transition-all duration-200 ${
              selectedView === 'detailed'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Detailed View
          </button>
        </div>
      </div>

      {/* Templates Grid */}
      <AnimatePresence mode="wait">
        {selectedView === 'grid' ? (
          <motion.div
            key="grid"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            {PROJECT_TEMPLATES.map((template) => {
              const IconComponent = getIcon(template.icon);
              const isHovered = hoveredTemplate === template.id;
              const isSelected = selectedTemplate?.id === template.id;

              return (
                <motion.div
                  key={template.id}
                  className="relative group cursor-pointer"
                  onMouseEnter={() => setHoveredTemplate(template.id)}
                  onMouseLeave={() => setHoveredTemplate(null)}
                  onClick={() => onSelectTemplate(template)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  style={{ perspective: '1000px' }}
                >
                  <motion.div
                    className={`
                      relative w-full h-80 rounded-xl overflow-hidden shadow-lg
                      transition-all duration-500 transform-gpu
                      ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2' : ''}
                      ${isHovered ? 'shadow-2xl' : 'shadow-lg'}
                    `}
                    style={{
                      background: `linear-gradient(135deg, ${template.gradientFrom}, ${template.gradientTo})`,
                      transformStyle: 'preserve-3d',
                    }}
                    animate={{
                      rotateX: isHovered ? -5 : 0,
                      rotateY: isHovered ? 5 : 0,
                    }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  >
                    {/* Background Pattern */}
                    <div className="absolute inset-0 opacity-10">
                      <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-white transform translate-x-16 -translate-y-16" />
                      <div className="absolute bottom-0 left-0 w-24 h-24 rounded-full bg-white transform -translate-x-12 translate-y-12" />
                    </div>

                    {/* Content */}
                    <div className="relative h-full p-6 flex flex-col justify-between text-white">
                      {/* Header */}
                      <div>
                        <motion.div
                          className="flex items-center justify-between mb-4"
                          animate={{
                            y: isHovered ? -2 : 0,
                          }}
                          transition={{ duration: 0.3 }}
                        >
                          <IconComponent size={32} className="text-white" />
                          <Badge 
                            className={`${getComplexityColor(template.complexityLevel)} text-xs`}
                          >
                            {template.complexityLevel}
                          </Badge>
                        </motion.div>

                        <motion.h3 
                          className="text-xl font-bold mb-2"
                          animate={{
                            y: isHovered ? -2 : 0,
                          }}
                          transition={{ duration: 0.3, delay: 0.1 }}
                        >
                          {template.name}
                        </motion.h3>
                        
                        <motion.p 
                          className="text-white/90 text-sm leading-relaxed"
                          animate={{
                            y: isHovered ? -2 : 0,
                          }}
                          transition={{ duration: 0.3, delay: 0.2 }}
                        >
                          {template.description.slice(0, 100)}...
                        </motion.p>
                      </div>

                      {/* Quick Stats */}
                      <motion.div 
                        className="space-y-2"
                        animate={{
                          y: isHovered ? -2 : 0,
                        }}
                        transition={{ duration: 0.3, delay: 0.3 }}
                      >
                        <div className="flex items-center text-sm text-white/90">
                          <DollarSign size={16} className="mr-2" />
                          {formatBudgetRange(template.typicalBudgetRange)}
                        </div>
                        <div className="flex items-center text-sm text-white/90">
                          <Clock size={16} className="mr-2" />
                          {formatDuration(template.typicalDuration)}
                        </div>
                        <div className="flex items-center text-sm text-white/90">
                          <Users size={16} className="mr-2" />
                          {template.typicalTeamSize} team members
                        </div>
                      </motion.div>
                    </div>

                    {/* Hover Overlay */}
                    <motion.div
                      className="absolute inset-0 bg-black/20 flex items-center justify-center"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: isHovered ? 1 : 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      <motion.div
                        className="text-white text-center"
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ 
                          scale: isHovered ? 1 : 0.8, 
                          opacity: isHovered ? 1 : 0 
                        }}
                        transition={{ duration: 0.3, delay: 0.1 }}
                      >
                        <CheckCircle size={48} className="mx-auto mb-2" />
                        <p className="font-semibold">Select Template</p>
                      </motion.div>
                    </motion.div>

                    {/* Selection Indicator */}
                    {isSelected && (
                      <motion.div
                        className="absolute top-4 right-4"
                        initial={{ scale: 0, rotate: -180 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ duration: 0.4, type: "spring" }}
                      >
                        <CheckCircle size={24} className="text-white" fill="currentColor" />
                      </motion.div>
                    )}
                  </motion.div>
                </motion.div>
              );
            })}
          </motion.div>
        ) : (
          <motion.div
            key="detailed"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="space-y-6"
          >
            {PROJECT_TEMPLATES.map((template) => {
              const IconComponent = getIcon(template.icon);
              const isSelected = selectedTemplate?.id === template.id;

              return (
                <motion.div
                  key={template.id}
                  className={`
                    relative bg-white rounded-xl border-2 transition-all duration-300 cursor-pointer
                    ${isSelected ? 'border-blue-500 shadow-lg' : 'border-gray-200 hover:border-gray-300 hover:shadow-md'}
                  `}
                  onClick={() => onSelectTemplate(template)}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                >
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center space-x-4">
                        <div 
                          className="p-3 rounded-lg"
                          style={{ backgroundColor: `${template.primaryColor}20` }}
                        >
                          <IconComponent 
                            size={32} 
                            style={{ color: template.primaryColor }}
                          />
                        </div>
                        <div>
                          <h3 className="text-2xl font-bold text-gray-900">{template.name}</h3>
                          <p className="text-gray-600 mt-1">{template.description}</p>
                        </div>
                      </div>
                      <Badge className={getComplexityColor(template.complexityLevel)}>
                        {template.complexityLevel} Complexity
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {/* Project Overview */}
                      <div className="space-y-4">
                        <h4 className="font-semibold text-gray-900 flex items-center">
                          <FileText size={16} className="mr-2" />
                          Project Overview
                        </h4>
                        <div className="space-y-3 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">Budget Range:</span>
                            <span className="font-medium">{formatBudgetRange(template.typicalBudgetRange)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">Duration:</span>
                            <span className="font-medium">{formatDuration(template.typicalDuration)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">Team Size:</span>
                            <span className="font-medium">{template.typicalTeamSize} members</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">Building Area:</span>
                            <span className="font-medium">
                              {template.sampleSpecs.buildingArea.min.toLocaleString()} - {template.sampleSpecs.buildingArea.max.toLocaleString()} {template.sampleSpecs.buildingArea.unit}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Key Features */}
                      <div className="space-y-4">
                        <h4 className="font-semibold text-gray-900 flex items-center">
                          <Zap size={16} className="mr-2" />
                          Key Features
                        </h4>
                        <ul className="space-y-2 text-sm">
                          {template.keyFeatures.slice(0, 4).map((feature, index) => (
                            <li key={index} className="flex items-start">
                              <CheckCircle size={14} className="text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                              <span className="text-gray-700">{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Risks & Compliance */}
                      <div className="space-y-4">
                        <h4 className="font-semibold text-gray-900 flex items-center">
                          <AlertTriangle size={16} className="mr-2" />
                          Risks & Standards
                        </h4>
                        <div className="space-y-3 text-sm">
                          <div>
                            <span className="text-gray-600 block mb-1">Common Risks:</span>
                            <ul className="space-y-1">
                              {template.commonRisks.slice(0, 2).map((risk, index) => (
                                <li key={index} className="text-gray-700 text-xs">• {risk}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <span className="text-gray-600 block mb-1">Standards (Canada):</span>
                            <div className="flex flex-wrap gap-1">
                              {template.commonStandards.canada.slice(0, 2).map((standard, index) => (
                                <Badge key={index} variant="outline" className="text-xs">
                                  {standard.length > 15 ? `${standard.slice(0, 15)}...` : standard}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Selection Button */}
                    <div className="mt-6 flex justify-end">
                      <Button
                        onClick={() => onSelectTemplate(template)}
                        className={`
                          ${isSelected ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-900 hover:bg-gray-800'}
                          transition-all duration-200
                        `}
                      >
                        {isSelected ? (
                          <>
                            <CheckCircle size={16} className="mr-2" />
                            Selected
                          </>
                        ) : (
                          <>
                            Select Template
                            <ArrowRight size={16} className="ml-2" />
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Selection Glow Effect */}
                  {isSelected && (
                    <motion.div
                      className="absolute inset-0 rounded-xl pointer-events-none"
                      style={{
                        background: `linear-gradient(135deg, ${template.gradientFrom}15, ${template.gradientTo}15)`,
                      }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3 }}
                    />
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Selected Template Summary */}
      <AnimatePresence>
        {selectedTemplate && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            className="mt-8 p-6 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div 
                  className="p-3 rounded-lg"
                  style={{ backgroundColor: `${selectedTemplate.primaryColor}20` }}
                >
                  {React.createElement(getIcon(selectedTemplate.icon), {
                    size: 24,
                    style: { color: selectedTemplate.primaryColor }
                  })}
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900">Selected: {selectedTemplate.name}</h4>
                  <p className="text-sm text-gray-600">
                    {formatBudgetRange(selectedTemplate.typicalBudgetRange)} • {formatDuration(selectedTemplate.typicalDuration)}
                  </p>
                </div>
              </div>
              <Badge className={getComplexityColor(selectedTemplate.complexityLevel)}>
                {selectedTemplate.complexityLevel}
              </Badge>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}