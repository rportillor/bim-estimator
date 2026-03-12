/**
 * 📋 RFI (Request for Information) Generation Service
 * Automatically generates RFIs based on compliance violations, conflicts, and missing information
 */

import { db } from './db';
import { rfis, rfiAttachments, projects } from '@shared/schema';
import { eq, desc, and, count } from 'drizzle-orm';

export interface ConflictDetectionResult {
  type: 'code_violation' | 'specification_conflict' | 'cross_document_conflict' | 'missing_information' | 'dimensional_discrepancy';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  affectedElements: string[];
  relatedDocuments: string[];
  codeReferences?: string[];
  currentCondition?: string;
  requiredCondition?: string;
  proposedSolution?: string;
}

export interface RFIGenerationOptions {
  projectId: string;
  analysisId: string;
  autoAssign?: boolean;
  priorityOverride?: 'low' | 'medium' | 'high' | 'critical';
}

export class RFIService {
  
  /**
   * 🧠 Generate RFIs from compliance analysis and conflict detection
   */
  async generateRFIsFromAnalysis(
    complianceAnalysis: any, 
    crossDocumentAnalysis: any,
    options: RFIGenerationOptions
  ): Promise<string[]> {
    try {
      console.log(`📋 Generating RFIs for project ${options.projectId} from analysis ${options.analysisId}`);
      
      const conflicts = await this.detectConflicts(complianceAnalysis, crossDocumentAnalysis);
      console.log(`🔍 Detected ${conflicts.length} conflicts requiring RFIs`);
      
      const rfiIds: string[] = [];
      
      for (const conflict of conflicts) {
        const rfiId = await this.createRFI(conflict, options);
        if (rfiId) {
          rfiIds.push(rfiId);
        }
      }
      
      console.log(`✅ Created ${rfiIds.length} RFIs for project analysis`);
      return rfiIds;
      
    } catch (error) {
      console.error('❌ Failed to generate RFIs from analysis:', error);
      throw error;
    }
  }
  
  /**
   * 🔍 Detect conflicts and issues that require RFIs
   */
  private async detectConflicts(
    complianceAnalysis: any, 
    crossDocumentAnalysis: any
  ): Promise<ConflictDetectionResult[]> {
    const conflicts: ConflictDetectionResult[] = [];
    
    // 🏛️ CODE VIOLATIONS → RFIs
    if (complianceAnalysis?.code_violations) {
      for (const violation of complianceAnalysis.code_violations) {
        conflicts.push({
          type: 'code_violation' as const,
          severity: this.mapSeverity(violation.severity),
          title: `Code Violation: ${violation.element} - ${violation.code}`,
          description: `Element "${violation.element}" violates ${violation.code}: ${violation.issue}`,
          affectedElements: [violation.element],
          relatedDocuments: [], // Will be populated based on element location
          codeReferences: [violation.code],
          currentCondition: `Current design shows ${violation.element} that does not comply with ${violation.code}`,
          requiredCondition: `${violation.element} must comply with ${violation.code} requirements`,
          proposedSolution: `Review and revise ${violation.element} design to meet ${violation.code} specifications`
        });
      }
    }
    
    // 📋 MATERIAL COMPLIANCE → RFIs
    if (complianceAnalysis?.material_compliance) {
      for (const material of complianceAnalysis.material_compliance) {
        if (!material.compliant) {
          conflicts.push({
            type: 'specification_conflict' as const,
            severity: 'high' as const,
            title: `Material Specification Conflict: ${material.element}`,
            description: `Element "${material.element}" material specification does not meet code requirements`,
            affectedElements: [material.element],
            relatedDocuments: [],
            codeReferences: [material.code_requirement],
            currentCondition: `Specified material: ${material.specified_material}`,
            requiredCondition: `Required per code: ${material.code_requirement}`,
            proposedSolution: `Update material specification to comply with code requirements`
          });
        }
      }
    }
    
    // 📏 DIMENSIONAL COMPLIANCE → RFIs
    if (complianceAnalysis?.dimensional_compliance) {
      for (const dimension of complianceAnalysis.dimensional_compliance) {
        if (!dimension.compliant) {
          conflicts.push({
            type: 'dimensional_discrepancy' as const,
            severity: 'high' as const,
            title: `Dimensional Non-Compliance: ${dimension.element}`,
            description: `Element "${dimension.element}" dimensions do not meet code requirements`,
            affectedElements: [dimension.element],
            relatedDocuments: [],
            codeReferences: [dimension.code_requirement],
            currentCondition: `Current ${dimension.dimension}: ${dimension.actual}`,
            requiredCondition: `Required ${dimension.dimension}: ${dimension.required}`,
            proposedSolution: `Adjust ${dimension.element} ${dimension.dimension} to meet code requirements`
          });
        }
      }
    }
    
    // ♿ ACCESSIBILITY ISSUES → RFIs
    if (complianceAnalysis?.accessibility_compliance && !complianceAnalysis.accessibility_compliance.csa_b651_compliant) {
      conflicts.push({
        type: 'code_violation' as const,
        severity: 'critical' as const,
        title: 'Accessibility Non-Compliance (CSA B651)',
        description: 'Project does not meet Canadian accessibility requirements',
        affectedElements: ['ACCESSIBILITY_FEATURES'],
        relatedDocuments: [],
        codeReferences: ['CSA-B651'],
        currentCondition: 'Current design fails accessibility compliance',
        requiredCondition: 'Must comply with CSA B651 accessibility standards',
        proposedSolution: 'Review and implement accessibility requirements per CSA B651'
      });
    }
    
    // 🔥 FIRE SAFETY ISSUES → RFIs
    if (complianceAnalysis?.fire_safety_compliance) {
      const fireSafety = complianceAnalysis.fire_safety_compliance;
      if (!fireSafety.nbc_egress_compliant || !fireSafety.fire_rating_compliant) {
        conflicts.push({
          type: 'code_violation' as const,
          severity: 'critical' as const,
          title: 'Fire Safety Non-Compliance (NBC)',
          description: 'Project does not meet National Building Code fire safety requirements',
          affectedElements: ['FIRE_SAFETY_SYSTEMS'],
          relatedDocuments: [],
          codeReferences: ['NBC-3.4', 'NBC-3.1'],
          currentCondition: 'Current design fails fire safety compliance',
          requiredCondition: 'Must comply with NBC fire safety and egress requirements',
          proposedSolution: 'Review and implement fire safety measures per NBC requirements'
        });
      }
    }
    
    // 🔗 CROSS-DOCUMENT CONFLICTS → RFIs
    if (crossDocumentAnalysis?.conflicts) {
      for (const conflict of crossDocumentAnalysis.conflicts) {
        conflicts.push({
          type: 'cross_document_conflict' as const,
          severity: 'medium' as const,
          title: `Document Conflict: ${conflict.type}`,
          description: `Conflict found between documents: ${conflict.description}`,
          affectedElements: conflict.affected_elements || [],
          relatedDocuments: conflict.documents || [],
          currentCondition: conflict.current_state,
          requiredCondition: 'Clarification needed on correct information',
          proposedSolution: 'Review conflicting documents and provide clarification'
        });
      }
    }
    
    return conflicts;
  }
  
  /**
   * 📋 Create individual RFI from detected conflict using existing schema
   */
  private async createRFI(
    conflict: ConflictDetectionResult, 
    options: RFIGenerationOptions
  ): Promise<string | null> {
    try {
      // Generate next RFI number for project
      const rfiNumber = await this.generateNextRFINumber(options.projectId);
      
      // Map to existing RFI schema fields
      const priority = this.mapToPriorityEnum(options.priorityOverride || conflict.severity);
      
      const [rfi] = await db.insert(rfis).values({
        projectId: options.projectId,
        rfiNumber,
        subject: conflict.title,
        question: `${conflict.description}\n\nCurrent Condition: ${conflict.currentCondition || 'Not specified'}\nRequired Condition: ${conflict.requiredCondition || 'See applicable codes'}\nProposed Solution: ${conflict.proposedSolution || 'Under review'}`,
        priority,
        status: "Open",
        fromName: "EstimatorPro AI System",
        fromCompany: "EstimatorPro",
        toName: "Project Team",
        toCompany: "Project Team",
        submittedBy: null, // Will need to handle system-generated RFIs
        responseRequired: true,
        generatedFromConflict: true,
        relatedConflicts: JSON.stringify(conflict.affectedElements),
        aiSuggestedResponse: conflict.proposedSolution || null,
        impactAssessment: JSON.stringify({
          type: conflict.type,
          severity: conflict.severity,
          documents: conflict.relatedDocuments,
          sourceAnalysisId: options.analysisId
        })
      }).returning();
      
      console.log(`📋 Created RFI ${rfiNumber}: ${conflict.title}`);
      return rfi.id;
      
    } catch (error) {
      console.error(`❌ Failed to create RFI for conflict:`, error);
      return null;
    }
  }
  
  /**
   * 🎯 Map severity to existing priority enum
   */
  private mapToPriorityEnum(severity: string): 'Low' | 'Medium' | 'High' | 'Critical' {
    switch (severity?.toLowerCase()) {
      case 'critical': return 'Critical';
      case 'high': return 'High';
      case 'medium': return 'Medium';
      case 'low': return 'Low';
      default: return 'Medium';
    }
  }
  
  /**
   * 🔢 Generate next sequential RFI number for project
   */
  private async generateNextRFINumber(projectId: string): Promise<string> {
    try {
      const [result] = await db
        .select({ count: count() })
        .from(rfis)
        .where(eq(rfis.projectId, projectId));
      
      const nextNumber = (result?.count || 0) + 1;
      return `RFI-${nextNumber.toString().padStart(3, '0')}`;
      
    } catch (error) {
      console.error('❌ Failed to generate RFI number:', error);
      return `RFI-${Date.now()}`; // Fallback
    }
  }
  
  /**
   * 🎯 Map analysis severity to RFI priority
   */
  private mapSeverity(severity: string): 'low' | 'medium' | 'high' | 'critical' {
    switch (severity?.toLowerCase()) {
      case 'critical': return 'critical';
      case 'major': case 'high': return 'high';
      case 'warning': case 'medium': return 'medium';
      case 'minor': case 'low': return 'low';
      default: return 'medium';
    }
  }
  
  /**
   * 📊 Get RFI summary for project
   */
  async getProjectRFISummary(projectId: string): Promise<any> {
    try {
      const rfiList = await db
        .select()
        .from(rfis)
        .where(eq(rfis.projectId, projectId))
        .orderBy(desc(rfis.createdAt));
      
      const summary = {
        total: rfiList.length,
        open: rfiList.filter(r => r.status === 'Open').length,
        pending: rfiList.filter(r => r.status === 'In Progress').length,
        resolved: rfiList.filter(r => r.status === 'Responded').length,
        critical: rfiList.filter(r => r.priority === 'Critical').length,
        high: rfiList.filter(r => r.priority === 'High').length,
        byType: {} as Record<string, number>
      };
      
      // Count by type (based on conflict type if available)
      for (const rfi of rfiList) {
        const rfiType = rfi.generatedFromConflict ? 'Generated' : 'Manual';
        summary.byType[rfiType] = (summary.byType[rfiType] || 0) + 1;
      }
      
      return {
        summary,
        rfis: rfiList
      };
      
    } catch (error) {
      console.error('❌ Failed to get RFI summary:', error);
      throw error;
    }
  }
}

export const rfiService = new RFIService();