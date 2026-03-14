import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ProjectTemplatePreview } from "./ProjectTemplatePreview";
import { PROJECT_TEMPLATES, type ProjectTemplate } from "@shared/project-templates";

interface ProjectTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (_template: ProjectTemplate) => void;
  preSelectedTemplate?: ProjectTemplate | null;
}

export function ProjectTemplateModal({
  isOpen,
  onClose,
  onSelectTemplate,
  preSelectedTemplate
}: ProjectTemplateModalProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate | null>(
    preSelectedTemplate || null
  );
  const [currentStep, setCurrentStep] = useState<'browse' | 'details' | 'confirm'>('browse');
  const [showSparkles, setShowSparkles] = useState(false);

  useEffect(() => {
    if (preSelectedTemplate) {
      setSelectedTemplate(preSelectedTemplate);
      setCurrentStep('details');
    }
  }, [preSelectedTemplate]);

  // Trigger sparkles animation when template is selected
  useEffect(() => {
    if (selectedTemplate) {
      setShowSparkles(true);
      const timer = setTimeout(() => setShowSparkles(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [selectedTemplate]);

  const handleTemplateSelect = (template: ProjectTemplate) => {
    setSelectedTemplate(template);
    setCurrentStep('details');
  };

  const handleConfirmSelection = () => {
    if (selectedTemplate) {
      onSelectTemplate(selectedTemplate);
      onClose();
    }
  };

  const handleBack = () => {
    if (currentStep === 'details') {
      setCurrentStep('browse');
    } else if (currentStep === 'confirm') {
      setCurrentStep('details');
    }
  };

  const modalVariants = {
    hidden: { 
      opacity: 0, 
      scale: 0.8,
      rotateX: -15,
    },
    visible: { 
      opacity: 1, 
      scale: 1,
      rotateX: 0,
      transition: {
        duration: 0.4,
        ease: "easeOut"
      }
    },
    exit: { 
      opacity: 0, 
      scale: 0.9,
      rotateX: 10,
      transition: {
        duration: 0.3,
        ease: "easeIn"
      }
    }
  };

  const contentVariants = {
    hidden: { opacity: 0, x: 20 },
    visible: { 
      opacity: 1, 
      x: 0,
      transition: {
        duration: 0.3,
        ease: "easeOut"
      }
    },
    exit: { 
      opacity: 0, 
      x: -20,
      transition: {
        duration: 0.2,
        ease: "easeIn"
      }
    }
  };

  const sparkleVariants = {
    hidden: { scale: 0, rotate: -180 },
    visible: { 
      scale: [0, 1.2, 1], 
      rotate: [0, 180, 360],
      transition: {
        duration: 0.6,
        ease: "easeOut"
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl max-h-[90vh] p-0 overflow-hidden">
        <motion.div
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="relative"
        >
          {/* Header */}
          <DialogHeader className="relative px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                {currentStep !== 'browse' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleBack}
                    className="p-2"
                  >
                    <ArrowLeft size={18} />
                  </Button>
                )}
                <div>
                  <DialogTitle className="flex items-center text-xl font-bold text-gray-900">
                    <Sparkles className="mr-2 text-blue-600" size={24} />
                    Choose Your Project Template
                    {showSparkles && (
                      <motion.div
                        variants={sparkleVariants}
                        initial="hidden"
                        animate="visible"
                        className="ml-2"
                      >
                        <Sparkles className="text-yellow-500" size={20} />
                      </motion.div>
                    )}
                  </DialogTitle>
                  <p className="text-sm text-gray-600 mt-1">
                    {currentStep === 'browse' && "Select a template that matches your project type and requirements"}
                    {currentStep === 'details' && selectedTemplate && `Reviewing: ${selectedTemplate.name}`}
                    {currentStep === 'confirm' && "Confirm your template selection"}
                  </p>
                </div>
              </div>
              
              {/* Progress Indicator */}
              <div className="flex items-center space-x-2">
                <div className="flex space-x-1">
                  {['browse', 'details'].map((step, _index) => (
                    <div
                      key={step}
                      className={`w-2 h-2 rounded-full transition-all duration-300 ${
                        step === currentStep || (step === 'browse' && currentStep === 'details')
                          ? 'bg-blue-600' 
                          : 'bg-gray-300'
                      }`}
                    />
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onClose && onClose()}
                  className="p-2 hover:bg-gray-100"
                >
                  <X size={18} />
                </Button>
              </div>
            </div>
          </DialogHeader>

          {/* Content */}
          <div className="px-6 py-6 max-h-[calc(90vh-140px)] overflow-y-auto">
            <AnimatePresence mode="wait">
              {currentStep === 'browse' && (
                <motion.div
                  key="browse"
                  variants={contentVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <ProjectTemplatePreview
                    onSelectTemplate={handleTemplateSelect}
                    selectedTemplate={selectedTemplate}
                  />
                </motion.div>
              )}

              {currentStep === 'details' && selectedTemplate && (
                <motion.div
                  key="details"
                  variants={contentVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="space-y-6"
                >
                  {/* Template Hero Section */}
                  <motion.div
                    className="relative rounded-2xl overflow-hidden shadow-xl"
                    style={{
                      background: `linear-gradient(135deg, ${selectedTemplate.gradientFrom}, ${selectedTemplate.gradientTo})`,
                    }}
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.4, delay: 0.1 }}
                  >
                    <div className="absolute inset-0 bg-black/10" />
                    <div className="relative p-8 text-white">
                      <div className="flex items-center space-x-4 mb-4">
                        <div className="p-4 bg-white/20 rounded-xl backdrop-blur-sm">
                          {React.createElement(
                            require('lucide-react')[selectedTemplate.icon] || require('lucide-react').Building2,
                            { size: 40, className: "text-white" }
                          )}
                        </div>
                        <div>
                          <h2 className="text-3xl font-bold">{selectedTemplate.name}</h2>
                          <p className="text-white/90 text-lg">{selectedTemplate.description}</p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
                        <div className="bg-white/20 rounded-lg p-4 backdrop-blur-sm">
                          <p className="text-white/80 text-sm">Budget Range</p>
                          <p className="text-xl font-bold">{selectedTemplate.typicalBudgetRange.min.toLocaleString()} - {selectedTemplate.typicalBudgetRange.max.toLocaleString()}</p>
                        </div>
                        <div className="bg-white/20 rounded-lg p-4 backdrop-blur-sm">
                          <p className="text-white/80 text-sm">Duration</p>
                          <p className="text-xl font-bold">{selectedTemplate.typicalDuration.min}-{selectedTemplate.typicalDuration.max} {selectedTemplate.typicalDuration.unit}</p>
                        </div>
                        <div className="bg-white/20 rounded-lg p-4 backdrop-blur-sm">
                          <p className="text-white/80 text-sm">Team Size</p>
                          <p className="text-xl font-bold">{selectedTemplate.typicalTeamSize} members</p>
                        </div>
                        <div className="bg-white/20 rounded-lg p-4 backdrop-blur-sm">
                          <p className="text-white/80 text-sm">Complexity</p>
                          <p className="text-xl font-bold">{selectedTemplate.complexityLevel}</p>
                        </div>
                      </div>
                    </div>
                  </motion.div>

                  {/* Detailed Information Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Key Features */}
                    <motion.div
                      className="bg-white rounded-xl border border-gray-200 p-6"
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.4, delay: 0.2 }}
                    >
                      <h3 className="text-xl font-bold text-gray-900 mb-4">Key Features</h3>
                      <ul className="space-y-3">
                        {selectedTemplate.keyFeatures.map((feature, index) => (
                          <motion.li
                            key={index}
                            className="flex items-start space-x-3"
                            initial={{ x: -10, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            transition={{ duration: 0.3, delay: 0.3 + index * 0.1 }}
                          >
                            <div className="w-2 h-2 bg-blue-600 rounded-full mt-2 flex-shrink-0" />
                            <span className="text-gray-700">{feature}</span>
                          </motion.li>
                        ))}
                      </ul>
                    </motion.div>

                    {/* Deliverables */}
                    <motion.div
                      className="bg-white rounded-xl border border-gray-200 p-6"
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.4, delay: 0.3 }}
                    >
                      <h3 className="text-xl font-bold text-gray-900 mb-4">Key Deliverables</h3>
                      <ul className="space-y-3">
                        {selectedTemplate.deliverables.slice(0, 6).map((deliverable, index) => (
                          <motion.li
                            key={index}
                            className="flex items-start space-x-3"
                            initial={{ x: -10, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            transition={{ duration: 0.3, delay: 0.4 + index * 0.1 }}
                          >
                            <div className="w-2 h-2 bg-green-600 rounded-full mt-2 flex-shrink-0" />
                            <span className="text-gray-700">{deliverable}</span>
                          </motion.li>
                        ))}
                      </ul>
                    </motion.div>

                    {/* Team & Roles */}
                    <motion.div
                      className="bg-white rounded-xl border border-gray-200 p-6"
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.4, delay: 0.4 }}
                    >
                      <h3 className="text-xl font-bold text-gray-900 mb-4">Team & Key Roles</h3>
                      <div className="grid grid-cols-2 gap-3">
                        {selectedTemplate.keyRoles.map((role, index) => (
                          <motion.div
                            key={index}
                            className="bg-gray-50 rounded-lg p-3 text-center"
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ duration: 0.3, delay: 0.5 + index * 0.1 }}
                          >
                            <span className="text-sm font-medium text-gray-700">{role}</span>
                          </motion.div>
                        ))}
                      </div>
                    </motion.div>

                    {/* Risks & Standards */}
                    <motion.div
                      className="bg-white rounded-xl border border-gray-200 p-6"
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.4, delay: 0.5 }}
                    >
                      <h3 className="text-xl font-bold text-gray-900 mb-4">Risks & Standards</h3>
                      <div className="space-y-4">
                        <div>
                          <h4 className="font-medium text-gray-900 mb-2">Common Risks:</h4>
                          <ul className="space-y-1">
                            {selectedTemplate.commonRisks.slice(0, 3).map((risk, index) => (
                              <li key={index} className="text-sm text-gray-600">• {risk}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <h4 className="font-medium text-gray-900 mb-2">Standards (Canada):</h4>
                          <div className="flex flex-wrap gap-2">
                            {selectedTemplate.commonStandards.canada.map((standard, index) => (
                              <span key={index} className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                                {standard}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {currentStep === 'browse' && `${PROJECT_TEMPLATES.length} templates available`}
              {currentStep === 'details' && selectedTemplate && "Review template details and confirm selection"}
            </div>
            
            <div className="flex space-x-3">
              {currentStep === 'details' && (
                <>
                  <Button variant="outline" onClick={handleBack}>
                    Back to Templates
                  </Button>
                  <motion.div
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Button onClick={handleConfirmSelection} className="bg-blue-600 hover:bg-blue-700">
                      Select This Template
                      <ArrowRight size={16} className="ml-2" />
                    </Button>
                  </motion.div>
                </>
              )}
            </div>
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}