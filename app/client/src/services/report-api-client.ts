/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  REPORT API CLIENT — Frontend Service Layer
 *  EstimatorPro v3 — Connects React Dashboard to SOP 7/8 Endpoints
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Usage:
 *    import { reportApi } from './services/report-api-client';
 *    const boq = await reportApi.generateBOQ(projectId, params);
 *    await reportApi.exportIFC(projectId, params);
 *
 *  @module report-api-client
 *  @version 1.0.0
 */


// ══════════════════════════════════════════════════════════════════════════════
//  TYPES — Mirrors server/services/report-generator.ts types
// ══════════════════════════════════════════════════════════════════════════════

export interface ReportParams {
  projectName?: string;
  overhead?: number;
  profit?: number;
  contingency?: number;
  regionalFactor?: number;
  regionName?: string;
  taxRate?: number;
  estimateClass?: string;
  modelId?: string;
  location?: string;
  buildingType?: string;
  grossFloorArea_m2?: number;
  storeyCount?: number;
  constructionType?: string;
  retainageRate?: number;
  startDate?: string;
  authorName?: string;
}

export interface BOQReportLine {
  lineNo: number;
  csiDivision: string;
  csiTitle: string;
  uniformatCode: string;
  description: string;
  unit: string;
  quantity: number;
  materialRate: number;
  labourRate: number;
  equipmentRate: number;
  materialCost: number;
  labourCost: number;
  equipmentCost: number;
  totalCost: number;
  storey: string;
  tradePackage: string;
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'GAP';
  hasEvidence: boolean;
  evidenceRefs: string[];
  elementIds: string[];
}

export interface SubtotalEntry {
  materialCost: number;
  labourCost: number;
  equipmentCost: number;
  totalCost: number;
  lineCount: number;
}

export interface DivisionSubtotal extends SubtotalEntry {
  division: string;
  title: string;
}

export interface StoreySubtotal extends SubtotalEntry {
  storey: string;
}

export interface TradePackageSubtotal extends SubtotalEntry {
  tradePackage: string;
}

export interface ConfidenceSummary {
  highCount: number;
  mediumCount: number;
  lowCount: number;
  gapCount: number;
  overallConfidence: number;
}

export interface BOQReport {
  metadata: ReportMetadata;
  lines: BOQReportLine[];
  divisionSubtotals: DivisionSubtotal[];
  storeySubtotals: StoreySubtotal[];
  tradePackageSubtotals: TradePackageSubtotal[];
  directCost: number;
  overheadAmount: number;
  profitAmount: number;
  contingencyAmount: number;
  taxAmount: number;
  totalProjectCost: number;
  overheadRate: number;
  profitRate: number;
  contingencyRate: number;
  taxRate: number;
  regionalFactor: number;
  regionName: string;
  confidenceSummary: ConfidenceSummary;
  gapWarnings: string[];
}

export interface ReportMetadata {
  reportId: string;
  projectId: string;
  projectName: string;
  reportType: string;
  generatedAt: string;
  version: string;
  standards: string[];
  disclaimer: string;
}

export interface ClashSummary {
  totalClashes: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  informationalCount: number;
  unresolvedCount: number;
  resolvedCount: number;
  rfisRequired: number;
  estimatedReworkCost: number;
  estimatedReworkDays: number;
}

export interface ClashItem {
  clashId: string;
  severity: string;
  category: string;
  elementA: string;
  elementB: string;
  location: string;
  storey: string;
  penetrationDepth_mm: number;
  description: string;
  recommendation: string;
  rfiRequired: boolean;
  estimatedCost: number;
}

export interface ClashReport {
  metadata: ReportMetadata;
  summary: ClashSummary;
  clashes: ClashItem[];
  rfisRequired: any[];
  missingClearanceData: string[];
}

export interface ExecutiveSummary {
  metadata: ReportMetadata;
  projectOverview: {
    projectName: string;
    location: string;
    buildingType: string;
    grossFloorArea_m2: number;
    storeyCount: number;
    constructionType: string;
  };
  costSummary: {
    directCost: number;
    indirectCost: number;
    contingency: number;
    taxes: number;
    totalProjectCost: number;
    costPerM2: number;
    costPerSF: number;
  };
  confidenceAnalysis: {
    estimateClass: string;
    accuracyRange: { low: number; high: number };
    monteCarloP10: number | null;
    monteCarloP50: number | null;
    monteCarloP90: number | null;
    simulationRuns: number | null;
    dataCompleteness: number;
  };
  riskSummary: {
    totalGaps: number;
    criticalGaps: number;
    rfisRequired: number;
    clashesFound: number;
    criticalClashes: number;
    constructabilityIssues: number;
  };
  recommendations: string[];
  keyAssumptions: string[];
  exclusions: string[];
}

export interface GapRegister {
  metadata: ReportMetadata;
  totalGaps: number;
  criticalGaps: number;
  rfisGenerated: number;
  byDiscipline: Record<string, number>;
  byType: Record<string, number>;
  gaps: any[];
}

export interface ScheduleOfValues {
  metadata: ReportMetadata;
  phases: {
    phaseNumber: number;
    phaseName: string;
    level: string | null;
    scheduledValue: number;
    percentOfTotal: number;
    milestones: string[];
    tradeBreakdown: { trade: string; amount: number }[];
  }[];
  totalContractValue: number;
  retainageRate: number;
}

export interface ExportFormat {
  id: string;
  name: string;
  extension: string;
  mimeType: string;
  description: string;
}

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  reportId?: string;
}


// ══════════════════════════════════════════════════════════════════════════════
//  API CLIENT
// ══════════════════════════════════════════════════════════════════════════════

const API_BASE = '/api';

class ReportApiClient {
  private cache = new Map<string, { data: any; timestamp: number }>();
  private cacheMaxAge = 5 * 60 * 1000; // 5 minutes

  // ── Core HTTP Methods ──────────────────────────────────────────────────

  private getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('auth_token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  private async post<T>(path: string, body?: any): Promise<ApiResponse<T>> {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { data: null, error: err.error || `HTTP ${res.status}` };
      }
      const data = await res.json();
      return { data: data.report || data, error: null, reportId: data.reportId };
    } catch (e: any) {
      return { data: null, error: e.message || 'Network error' };
    }
  }

  private async get<T>(path: string): Promise<ApiResponse<T>> {
    // Check cache
    const cached = this.cache.get(path);
    if (cached && Date.now() - cached.timestamp < this.cacheMaxAge) {
      return { data: cached.data, error: null };
    }

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: this.getAuthHeaders(),
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { data: null, error: err.error || `HTTP ${res.status}` };
      }
      const data = await res.json();
      this.cache.set(path, { data, timestamp: Date.now() });
      return { data, error: null };
    } catch (e: any) {
      return { data: null, error: e.message || 'Network error' };
    }
  }

  private async downloadFile(path: string, body: any, filename: string): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(body),
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { success: false, error: err.error || `HTTP ${res.status}` };
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Download failed' };
    }
  }

  clearCache() {
    this.cache.clear();
  }


  // ── SOP Part 7: Report Generation ──────────────────────────────────────

  async generateBOQ(projectId: string, params: ReportParams = {}): Promise<ApiResponse<BOQReport>> {
    return this.post<BOQReport>(`/reports/boq/${projectId}`, params);
  }

  async generateBOQSummary(projectId: string, params: ReportParams = {}): Promise<ApiResponse<BOQReport>> {
    return this.post<BOQReport>(`/reports/boq-summary/${projectId}`, params);
  }

  async generateBidLeveling(projectId: string, params: ReportParams = {}): Promise<ApiResponse<any>> {
    return this.post(`/reports/bid-leveling/${projectId}`, params);
  }

  async generateClashReport(projectId: string, params: ReportParams = {}): Promise<ApiResponse<ClashReport>> {
    return this.post<ClashReport>(`/reports/clash/${projectId}`, params);
  }

  async generateConstructabilityReport(projectId: string, params: ReportParams = {}): Promise<ApiResponse<any>> {
    return this.post(`/reports/constructability/${projectId}`, params);
  }

  async generateExecutiveSummary(projectId: string, params: ReportParams = {}): Promise<ApiResponse<ExecutiveSummary>> {
    return this.post<ExecutiveSummary>(`/reports/executive-summary/${projectId}`, params);
  }

  async generateGapRegister(projectId: string, params: ReportParams = {}): Promise<ApiResponse<GapRegister>> {
    return this.post<GapRegister>(`/reports/gap-register/${projectId}`, params);
  }

  async generateScheduleOfValues(projectId: string, params: ReportParams = {}): Promise<ApiResponse<ScheduleOfValues>> {
    return this.post<ScheduleOfValues>(`/reports/schedule-of-values/${projectId}`, params);
  }

  /** Generate all reports in parallel */
  async generateAllReports(projectId: string, params: ReportParams = {}): Promise<{
    boq: ApiResponse<BOQReport>;
    clash: ApiResponse<ClashReport>;
    executive: ApiResponse<ExecutiveSummary>;
    gaps: ApiResponse<GapRegister>;
    sov: ApiResponse<ScheduleOfValues>;
  }> {
    const [boq, clash, executive, gaps, sov] = await Promise.all([
      this.generateBOQ(projectId, params),
      this.generateClashReport(projectId, params),
      this.generateExecutiveSummary(projectId, params),
      this.generateGapRegister(projectId, params),
      this.generateScheduleOfValues(projectId, params),
    ]);
    return { boq, clash, executive, gaps, sov };
  }


  // ── Report Retrieval ───────────────────────────────────────────────────

  async getReport(reportId: string): Promise<ApiResponse<any>> {
    return this.get(`/reports/by-id/${reportId}`);
  }

  async getReportText(reportId: string): Promise<ApiResponse<string>> {
    try {
      const res = await fetch(`${API_BASE}/reports/by-id/${reportId}/text`, {
        headers: this.getAuthHeaders(),
        credentials: 'include',
      });
      if (!res.ok) return { data: null, error: `HTTP ${res.status}` };
      const text = await res.text();
      return { data: text, error: null };
    } catch (e: any) {
      return { data: null, error: e.message };
    }
  }

  async listProjectReports(projectId: string): Promise<ApiResponse<{ count: number; reports: any[] }>> {
    return this.get(`/reports/project/${projectId}`);
  }


  // ── SOP Part 8: Export Downloads ───────────────────────────────────────

  async exportIFC(projectId: string, params: ReportParams = {}): Promise<{ success: boolean; error?: string }> {
    const name = (params.projectName || 'EstimatorPro').replace(/[^a-zA-Z0-9]/g, '_');
    return this.downloadFile(`/export/ifc/${projectId}`, params, `${name}.ifc`);
  }

  async exportMSProject(projectId: string, params: ReportParams = {}): Promise<{ success: boolean; error?: string }> {
    const name = (params.projectName || 'EstimatorPro').replace(/[^a-zA-Z0-9]/g, '_');
    return this.downloadFile(`/export/ms-project/${projectId}`, params, `${name}_Schedule.xml`);
  }

  async exportXLSX(projectId: string, params: ReportParams = {}): Promise<{ success: boolean; error?: string }> {
    const name = (params.projectName || 'EstimatorPro').replace(/[^a-zA-Z0-9]/g, '_');
    return this.downloadFile(`/export/xlsx/${projectId}`, params, `${name}_BOQ.xml`);
  }

  async exportCSV(projectId: string, type: 'boq' | 'divisions' | 'trades' | 'bid-leveling' | 'clashes' | 'gaps', params: ReportParams = {}): Promise<{ success: boolean; error?: string }> {
    return this.downloadFile(`/export/csv/${type}/${projectId}`, params, `${type}_${projectId}.csv`);
  }

  async exportJSON(projectId: string, reportType: string, params: ReportParams = {}): Promise<{ success: boolean; error?: string }> {
    return this.downloadFile(`/export/json/${projectId}/${reportType}`, params, `${reportType}_${projectId}.json`);
  }

  async getExportFormats(): Promise<ApiResponse<ExportFormat[]>> {
    const result = await this.get<{ formats: ExportFormat[] }>('/export/formats');
    return { data: result.data?.formats || null, error: result.error };
  }
}


// ══════════════════════════════════════════════════════════════════════════════
//  SINGLETON EXPORT
// ══════════════════════════════════════════════════════════════════════════════

export const reportApi = new ReportApiClient();
export default reportApi;
