import { desc, like } from "drizzle-orm";
import { db } from "../db";
import { rfis } from "@shared/schema";

// Generate unique RFI number for a project
export async function generateRfiNumber(_projectId: string): Promise<string> {
  const year = new Date().getFullYear();
  
  // Get the latest RFI number for this project and year
  const latestRfis = await db
    .select()
    .from(rfis)
    .where(
      like(rfis.rfiNumber, `RFI-${year}-%`)
    )
    .orderBy(desc(rfis.rfiNumber))
    .limit(1);

  let nextNumber = 1;
  
  if (latestRfis.length > 0) {
    const latestNumber = latestRfis[0].rfiNumber;
    const match = latestNumber.match(/RFI-\d{4}-(\d+)/);
    if (match) {
      nextNumber = parseInt(match[1]) + 1;
    }
  }

  return `RFI-${year}-${nextNumber.toString().padStart(4, '0')}`;
}

// Calculate RFI priority based on impact assessment
export function calculateRfiPriority(impactAssessment: any): "Low" | "Medium" | "High" | "Critical" {
  if (!impactAssessment) return "Medium";

  const { costImpact, scheduleImpact, safetyImpact, complianceImpact } = impactAssessment;

  // Critical: Safety or major compliance issues
  if (safetyImpact === "high" || complianceImpact === "critical") {
    return "Critical";
  }

  // High: Significant cost or schedule impact
  if (costImpact > 50000 || scheduleImpact > 14) {
    return "High";
  }

  // Medium: Moderate impact
  if (costImpact > 10000 || scheduleImpact > 7) {
    return "Medium";
  }

  // Low: Minor impact
  return "Low";
}

// Format RFI status for display
export function formatRfiStatus(status: string): string {
  const statusMap: Record<string, string> = {
    "Open": "🔵 Open",
    "In Progress": "🟡 In Progress",
    "Responded": "🟢 Responded",
    "Closed": "⚫ Closed",
    "Cancelled": "🔴 Cancelled"
  };

  return statusMap[status] || status;
}

// Calculate response time in business days
export function calculateResponseTime(createdAt: Date, respondedAt?: Date): number {
  if (!respondedAt) return 0;

  const diffTime = respondedAt.getTime() - createdAt.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  // Simple business days calculation (exclude weekends)
  let businessDays = 0;
  const startDate = new Date(createdAt);
  
  for (let i = 0; i < diffDays; i++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + i);
    const dayOfWeek = currentDate.getDay();
    
    // Monday (1) to Friday (5) are business days
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      businessDays++;
    }
  }

  return businessDays;
}

// Validate RFI data
export function validateRfiData(rfiData: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!rfiData.subject?.trim()) {
    errors.push("Subject is required");
  }

  if (!rfiData.question?.trim()) {
    errors.push("Question is required");
  }

  if (!rfiData.fromName?.trim()) {
    errors.push("From name is required");
  }

  if (!rfiData.toName?.trim()) {
    errors.push("To name is required");
  }

  if (!rfiData.projectId?.trim()) {
    errors.push("Project ID is required");
  }

  if (!rfiData.submittedBy?.trim()) {
    errors.push("Submitted by is required");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// Generate RFI summary for notifications
export function generateRfiSummary(rfi: any): string {
  return `RFI ${rfi.rfiNumber}: ${rfi.subject}\n` +
         `Priority: ${rfi.priority}\n` +
         `From: ${rfi.fromName} (${rfi.fromCompany || 'N/A'})\n` +
         `To: ${rfi.toName} (${rfi.toCompany || 'N/A'})\n` +
         `Question: ${rfi.question.substring(0, 200)}${rfi.question.length > 200 ? '...' : ''}`;
}