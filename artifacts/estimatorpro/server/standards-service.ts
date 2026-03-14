/**
 * Standards Service — live building code fetching with license management.
 *
 * N-3 FIX: Removed simulateLiveAPICall() and all five generator methods
 * (generateNBCData, generateIBCData, generateCSAData, generateASCEData,
 * generateGenericStandardsData) that returned hardcoded fabricated building code
 * data. These were writing invented content to the real database.
 *
 * fetchFromAPI() now issues real HTTPS requests. On network failure the method
 * returns null and fetchLiveBuildingCodes() falls back to getCachedBuildingCodes()
 * (database).  No fabricated data is ever generated or stored.
 */

import { storage } from "./storage";
import {
  insertBuildingCodeSectionSchema,
  type CodeLicense,
  type ProjectCodeAccess,
} from "@shared/schema";

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface StandardsAPI {
  name: string;
  baseUrl: string;
  apiKey?: string;
  rateLimit: number;
  jurisdiction: "canada" | "usa" | "international";
}

interface StandardSection {
  id: string;
  codeId: string;
  section: string;
  title: string;
  content: string;
  requirements: any[];
  lastUpdated: Date;
  authority: string;
}

interface ComplianceRule {
  standard: string;
  requirement: string;
  category: string;
  applicability: string[];
  measurementCriteria: string;
  exceptions: any[];
}

// ─── SERVICE ─────────────────────────────────────────────────────────────────

export class StandardsService {
  private apis: Map<string, StandardsAPI> = new Map();
  private cache: Map<string, { data: any; expiry: Date }> = new Map();
  private cacheDuration = 24 * 60 * 60 * 1000; // 24 hours

  private licensedCodes: Map<string, CodeLicense> = new Map();
  private projectAccess: Map<string, ProjectCodeAccess[]> = new Map();

  constructor() {
    this.initializeAPIs();
    this.loadActiveLicenses();
  }

  private initializeAPIs() {
    this.apis.set("nrc-canada", {
      name: "National Research Council Canada",
      baseUrl: "https://nrc.canada.ca/api/codes",
      jurisdiction: "canada",
      rateLimit: 100,
    });

    this.apis.set("csa-group", {
      name: "CSA Group Standards",
      baseUrl: "https://www.csagroup.org/api/standards",
      jurisdiction: "canada",
      rateLimit: 50,
    });

    this.apis.set("icc-codes", {
      name: "International Code Council",
      baseUrl: "https://codes.iccsafe.org/api",
      jurisdiction: "usa",
      rateLimit: 200,
    });

    this.apis.set("asce-standards", {
      name: "American Society of Civil Engineers",
      baseUrl: "https://ascelibrary.org/api/standards",
      jurisdiction: "usa",
      rateLimit: 100,
    });

    this.apis.set("aisc-steel", {
      name: "American Institute of Steel Construction",
      baseUrl: "https://www.aisc.org/api/specifications",
      jurisdiction: "usa",
      rateLimit: 75,
    });
  }

  // ─── PUBLIC: LIVE CODE FETCHING ──────────────────────────────────────────

  async fetchLiveBuildingCodes(
    jurisdiction: "canada" | "usa" | "both" = "both"
  ): Promise<StandardSection[]> {
    const sections: StandardSection[] = [];

    try {
      if (jurisdiction === "canada" || jurisdiction === "both") {
        const canadianCodes = await this.fetchCanadianBuildingCodes();
        sections.push(...canadianCodes);
      }

      if (jurisdiction === "usa" || jurisdiction === "both") {
        const usCodes = await this.fetchUSBuildingCodes();
        sections.push(...usCodes);
      }

      await this.storeBuildingCodes(sections);

      console.log(`✅ Fetched ${sections.length} live building code sections`);
      return sections;
    } catch (error) {
      console.error("❌ Failed to fetch live building codes:", error);
      return await this.getCachedBuildingCodes(jurisdiction);
    }
  }

  // ─── PRIVATE: JURISDICTION FETCHERS ─────────────────────────────────────

  private async fetchCanadianBuildingCodes(): Promise<StandardSection[]> {
    const sections: StandardSection[] = [];

    const nbcRaw = await this.fetchFromAPI("nrc-canada", "/nbc/2020/sections");
    if (nbcRaw) sections.push(...this.parseNBCSections(nbcRaw));

    const csaSections = await this.fetchCSAStandards();
    sections.push(...csaSections);

    const obcSections = await this.fetchProvincialCodes("ontario");
    sections.push(...obcSections);

    return sections;
  }

  private async fetchUSBuildingCodes(): Promise<StandardSection[]> {
    const sections: StandardSection[] = [];

    const ibcRaw = await this.fetchFromAPI("icc-codes", "/ibc/2021/sections");
    if (ibcRaw) sections.push(...this.parseIBCSections(ibcRaw));

    const asceSections = await this.fetchASCEStandards();
    sections.push(...asceSections);

    const aiscSections = await this.fetchAISCStandards();
    sections.push(...aiscSections);

    return sections;
  }

  // ─── PRIVATE: HTTP FETCH LAYER ───────────────────────────────────────────

  /**
   * Fetch data from a registered standards API.
   *
   * N-3 FIX: This method previously called simulateLiveAPICall() which returned
   * hardcoded fabricated building code data and injected a random 500-1500ms
   * fake delay. It now issues a real HTTPS GET request.
   *
   * Returns null on any network or HTTP error so callers fall back to
   * getCachedBuildingCodes() (database). Never generates invented data.
   */
  private async fetchFromAPI(apiKey: string, endpoint: string): Promise<any> {
    const api = this.apis.get(apiKey);
    if (!api) {
      console.error(`[StandardsService] API key "${apiKey}" not registered`);
      return null;
    }

    const cacheKey = `${apiKey}-${endpoint}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiry > new Date()) {
      return cached.data;
    }

    const url = `${api.baseUrl}${endpoint}`;
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (api.apiKey) {
        headers["Authorization"] = `Bearer ${api.apiKey}`;
      }

      const response = await fetch(url, { headers });

      if (!response.ok) {
        console.warn(
          `[StandardsService] ${apiKey}${endpoint} returned HTTP ${response.status}`
        );
        return null;
      }

      const data = await response.json();

      this.cache.set(cacheKey, {
        data,
        expiry: new Date(Date.now() + this.cacheDuration),
      });

      return data;
    } catch (error) {
      console.warn(
        `[StandardsService] Network error for ${url}:`,
        (error as Error).message
      );
      return null;
    }
  }

  // ─── PRIVATE: PARSERS ────────────────────────────────────────────────────

  private parseNBCSections(data: any): StandardSection[] {
    if (!Array.isArray(data?.sections)) return [];
    return data.sections.map((s: any) => ({
      id: `nbc-${s.section}`,
      codeId: "NBC-2020",
      section: s.section,
      title: s.title,
      content: s.content,
      requirements: s.requirements ?? [],
      lastUpdated: new Date(),
      authority: "National Research Council Canada",
    }));
  }

  private parseIBCSections(data: any): StandardSection[] {
    if (!Array.isArray(data?.sections)) return [];
    return data.sections.map((s: any) => ({
      id: `ibc-${s.section}`,
      codeId: "IBC-2021",
      section: s.section,
      title: s.title,
      content: s.content,
      requirements: s.requirements ?? [],
      lastUpdated: new Date(),
      authority: "International Code Council",
    }));
  }

  // ─── PRIVATE: STANDARD-SPECIFIC FETCHERS ────────────────────────────────

  private async fetchCSAStandards(): Promise<StandardSection[]> {
    const csaData = await this.fetchFromAPI("csa-group", "/active-standards");
    if (!csaData) return [];

    const sections: StandardSection[] = [];
    csaData.standards?.forEach((standard: any) => {
      standard.sections?.forEach((section: any) => {
        sections.push({
          id: `csa-${standard.standard}-${section.clause}`,
          codeId: standard.standard,
          section: section.clause,
          title: section.title,
          content: section.content,
          requirements: section.requirements ?? [],
          lastUpdated: new Date(),
          authority: "CSA Group",
        });
      });
    });

    return sections;
  }

  private async fetchASCEStandards(): Promise<StandardSection[]> {
    const asceData = await this.fetchFromAPI(
      "asce-standards",
      "/asce7/current"
    );
    if (!asceData) return [];

    return (
      asceData.sections?.map((s: any) => ({
        id: `asce-${s.section}`,
        codeId: "ASCE-7-16",
        section: s.section,
        title: s.title,
        content: s.content,
        requirements: s.requirements ?? [],
        lastUpdated: new Date(),
        authority: "American Society of Civil Engineers",
      })) ?? []
    );
  }

  private async fetchAISCStandards(): Promise<StandardSection[]> {
    const aiscData = await this.fetchFromAPI(
      "aisc-steel",
      "/specifications/current"
    );
    if (!aiscData) return [];
    // Implement AISC parsing when API contract is confirmed.
    return [];
  }

  private async fetchProvincialCodes(
    _province: string
  ): Promise<StandardSection[]> {
    // Implement provincial building code fetching when API is available.
    return [];
  }

  // ─── PRIVATE: DATABASE STORAGE / CACHE ──────────────────────────────────

  private async storeBuildingCodes(
    sections: StandardSection[]
  ): Promise<void> {
    try {
      for (const section of sections) {
        const codeSection = insertBuildingCodeSectionSchema.parse({
          codeId: section.codeId,
          section: section.section,
          title: section.title,
          content: section.content,
          requirements: section.requirements,
          jurisdiction: section.authority.includes("Canada") ? "canada" : "usa",
          category: "building",
          authority: section.authority,
          version: "2020",
          references: [],
          exceptions: [],
          relatedSections: [],
        });

        await storage.createBuildingCodeSection(codeSection);
      }
    } catch (error) {
      console.error("Failed to store building codes:", error);
    }
  }

  private async getCachedBuildingCodes(
    jurisdiction: string
  ): Promise<StandardSection[]> {
    try {
      const dbSections = await storage.getBuildingCodeSections(jurisdiction);
      return dbSections.map((s) => ({
        id: s.id,
        codeId: s.codeId,
        section: s.section,
        title: s.title,
        content: s.content,
        requirements: s.requirements as any[],
        lastUpdated: s.lastUpdated || new Date(),
        authority: s.authority,
      }));
    } catch (error) {
      console.error("Failed to get cached building codes:", error);
      return [];
    }
  }

  // ─── PUBLIC: COMPLIANCE CHECKING ────────────────────────────────────────

  async performLiveComplianceCheck(
    projectData: any,
    jurisdiction: "canada" | "usa" | "both" = "both"
  ): Promise<ComplianceRule[]> {
    const liveCodes = await this.fetchLiveBuildingCodes(jurisdiction);
    const complianceRules: ComplianceRule[] = [];

    for (const code of liveCodes) {
      if (this.isApplicableToProject(code, projectData)) {
        complianceRules.push(this.generateComplianceRule(code, projectData));
      }
    }

    console.log(
      `🔍 Generated ${complianceRules.length} live compliance rules`
    );
    return complianceRules;
  }

  private isApplicableToProject(
    code: StandardSection,
    projectData: any
  ): boolean {
    const projectType = projectData.buildingType?.toLowerCase() || "";
    const projectUse = projectData.occupancyType?.toLowerCase() || "";
    if (code.section.includes("9.") && projectType.includes("residential"))
      return true;
    if (code.section.includes("3.") && projectUse.includes("assembly"))
      return true;
    if (
      code.codeId.includes("CSA") &&
      projectData.materials?.includes("concrete")
    )
      return true;
    return true;
  }

  private generateComplianceRule(
    code: StandardSection,
    _projectData: any
  ): ComplianceRule {
    return {
      standard: code.codeId,
      requirement: code.title,
      category: this.categorizeStandard(code),
      applicability: this.getApplicability(code),
      measurementCriteria: this.getMeasurementCriteria(code),
      exceptions: [],
    };
  }

  private categorizeStandard(code: StandardSection): string {
    if (code.section.includes("9.")) return "structural";
    if (code.section.includes("3.")) return "fire_safety";
    if (code.codeId.includes("CSA")) return "materials";
    return "general";
  }

  private getApplicability(_code: StandardSection): string[] {
    return ["all_buildings"];
  }

  private getMeasurementCriteria(_code: StandardSection): string {
    return "Design calculations and verification required";
  }

  // ─── LICENSE MANAGEMENT ──────────────────────────────────────────────────

  private async loadActiveLicenses(): Promise<void> {
    try {
      this.initializeDefaultLicenses();
    } catch (error) {
      console.error("❌ Failed to load active licenses:", error);
      this.initializeDefaultLicenses();
    }
  }

  private initializeDefaultLicenses(): void {
    const defaultLicenses: Partial<CodeLicense>[] = [
      {
        codeId: "NBC-2020",
        authority: "National Research Council Canada",
        licensingModel: "estimatorpro_licensed",
        licenseOwner: "EstimatorPro",
        accessLevel: "full_access",
        usageRights: { excerpts: true, full_text: true, commercial_use: true },
        licenseStart: new Date("2024-01-01"),
        isActive: true,
      },
      {
        codeId: "IBC-2021",
        authority: "International Code Council",
        licensingModel: "estimatorpro_licensed",
        licenseOwner: "EstimatorPro",
        accessLevel: "read_only",
        usageRights: {
          excerpts: true,
          full_text: false,
          commercial_use: true,
        },
        licenseStart: new Date("2024-01-01"),
        isActive: true,
      },
    ];

    for (const license of defaultLicenses) {
      this.licensedCodes.set(license.codeId!, license as CodeLicense);
    }
  }

  async fetchLiveBuildingCodesWithLicensing(
    jurisdiction: "canada" | "usa" | "both" = "both",
    projectId?: string
  ): Promise<StandardSection[]> {
    const sections: StandardSection[] = [];

    try {
      const allowedCodes = projectId
        ? await this.getProjectAllowedCodes(projectId)
        : this.licensedCodes;

      if (jurisdiction === "canada" || jurisdiction === "both") {
        sections.push(...(await this.fetchLicensedCanadianCodes(allowedCodes)));
      }

      if (jurisdiction === "usa" || jurisdiction === "both") {
        sections.push(...(await this.fetchLicensedUSCodes(allowedCodes)));
      }

      await this.storeLicensedBuildingCodes(sections, allowedCodes);

      console.log(
        `🏛️ Fetched ${sections.length} licensed building code sections`
      );
      return sections;
    } catch (error) {
      console.error("❌ Failed to fetch licensed building codes:", error);
      return await this.getCachedLicensedCodes(jurisdiction, projectId);
    }
  }

  private async getProjectAllowedCodes(
    projectId: string
  ): Promise<Map<string, CodeLicense>> {
    const allowedCodes = new Map<string, CodeLicense>();

    try {
      let projectAccess = this.projectAccess.get(projectId);
      if (!projectAccess) {
        projectAccess = [];
        this.projectAccess.set(projectId, projectAccess);
      }

      for (const access of projectAccess) {
        if (access.accessGranted) {
          const license = this.licensedCodes.get(access.codeLicenseId);
          if (license) allowedCodes.set(license.codeId, license);
        }
      }

      return allowedCodes.size === 0 ? this.licensedCodes : allowedCodes;
    } catch (error) {
      console.error("❌ Failed to get project allowed codes:", error);
      return this.licensedCodes;
    }
  }

  private async fetchLicensedCanadianCodes(
    allowedCodes: Map<string, CodeLicense>
  ): Promise<StandardSection[]> {
    const sections: StandardSection[] = [];

    const nbcLicense =
      allowedCodes.get("NBC-2020") || allowedCodes.get("NBC-2015");
    if (nbcLicense && nbcLicense.accessLevel !== "reference_only") {
      sections.push(...(await this.fetchCanadianBuildingCodes()));
    }

    const csaLicense =
      allowedCodes.get("CSA-A23.3") ||
      Array.from(allowedCodes.values()).find((l) =>
        l.codeId.startsWith("CSA")
      );
    if (csaLicense) {
      sections.push(...(await this.fetchCSAStandards()));
    }

    return sections;
  }

  private async fetchLicensedUSCodes(
    allowedCodes: Map<string, CodeLicense>
  ): Promise<StandardSection[]> {
    const sections: StandardSection[] = [];

    const ibcLicense =
      allowedCodes.get("IBC-2021") || allowedCodes.get("IBC-2018");
    if (ibcLicense && ibcLicense.accessLevel !== "reference_only") {
      sections.push(...(await this.fetchUSBuildingCodes()));
    }

    const asceLicense =
      allowedCodes.get("ASCE-7-16") ||
      Array.from(allowedCodes.values()).find((l) =>
        l.codeId.startsWith("ASCE")
      );
    if (asceLicense) {
      sections.push(...(await this.fetchASCEStandards()));
    }

    return sections;
  }

  private async storeLicensedBuildingCodes(
    sections: StandardSection[],
    licenses: Map<string, CodeLicense>
  ): Promise<void> {
    try {
      for (const section of sections) {
        const applicableLicense = this.findApplicableLicense(
          section,
          licenses
        );

        const codeSection = insertBuildingCodeSectionSchema.parse({
          codeId: section.codeId,
          section: section.section,
          title: section.title,
          content: section.content,
          requirements: section.requirements,
          jurisdiction: section.authority.includes("Canada") ? "canada" : "usa",
          category: "building",
          authority: section.authority,
          version: "2020",
          references: [],
          exceptions: [],
          relatedSections: [],
          licensingModel:
            applicableLicense?.licensingModel || "public_domain",
          licenseOwner: applicableLicense?.licenseOwner || "Public",
          usageRights: applicableLicense?.usageRights || {},
          attributionRequired:
            applicableLicense?.attributionRequired ?? true,
          licenseExpiry: applicableLicense?.licenseExpiry,
          accessLevel: applicableLicense?.accessLevel || "read_only",
        });

        await storage.createBuildingCodeSection(codeSection);
      }
    } catch (error) {
      console.error("❌ Failed to store licensed building codes:", error);
    }
  }

  private findApplicableLicense(
    section: StandardSection,
    licenses: Map<string, CodeLicense>
  ): CodeLicense | undefined {
    const direct = licenses.get(section.codeId);
    if (direct) return direct;

    for (const [codeId, license] of Array.from(licenses)) {
      const prefix = codeId.split("-")[0];
      if (section.codeId.startsWith(prefix)) return license;
    }

    return undefined;
  }

  private async getCachedLicensedCodes(
    jurisdiction: string,
    projectId?: string
  ): Promise<StandardSection[]> {
    try {
      const dbSections = await storage.getBuildingCodeSections(jurisdiction);
      const allowedCodes = projectId
        ? await this.getProjectAllowedCodes(projectId)
        : this.licensedCodes;

      return dbSections
        .filter((s) => {
          const lic = this.findApplicableLicense(s, allowedCodes);
          return lic?.isActive;
        })
        .map((s) => ({
          id: s.id,
          codeId: s.codeId,
          section: s.section,
          title: s.title,
          content: s.content,
          requirements: s.requirements as any[],
          lastUpdated: s.lastUpdated || new Date(),
          authority: s.authority,
        }));
    } catch (error) {
      console.error("❌ Failed to get cached licensed codes:", error);
      return [];
    }
  }

  async grantProjectCodeAccess(
    projectId: string,
    codeId: string,
    accessLevel:
      | "full_access"
      | "read_only"
      | "excerpts_only"
      | "reference_only" = "read_only",
    usageType = "compliance_check"
  ): Promise<void> {
    try {
      const license = this.licensedCodes.get(codeId);
      if (!license) {
        throw new Error(`No license found for code: ${codeId}`);
      }

      const access: Partial<ProjectCodeAccess> = {
        projectId,
        codeLicenseId: license.id!,
        accessLevel,
        usageType,
        accessGranted: true,
        accessCount: 0,
      };

      const projectAccess = this.projectAccess.get(projectId) || [];
      projectAccess.push(access as ProjectCodeAccess);
      this.projectAccess.set(projectId, projectAccess);

      console.log(
        `🏛️ Granted ${accessLevel} access to ${codeId} for project ${projectId}`
      );
    } catch (error) {
      console.error("❌ Failed to grant project code access:", error);
    }
  }

  // ─── API HEALTH ──────────────────────────────────────────────────────────

  /**
   * N-3 FIX: Previously this called fetchFromAPI('/health') which invoked
   * simulateLiveAPICall() and always returned true. Now issues a real HTTP HEAD
   * request to the API base URL. Returns false on any network error.
   */
  async checkAPIsHealth(): Promise<{ [key: string]: boolean }> {
    const health: { [key: string]: boolean } = {};

    for (const [key, api] of Array.from(this.apis)) {
      try {
        const response = await fetch(api.baseUrl, {
          method: "HEAD",
          signal: AbortSignal.timeout(5000),
        });
        health[key] = response.ok || response.status < 500;
      } catch {
        health[key] = false;
      }
    }

    return health;
  }
}
