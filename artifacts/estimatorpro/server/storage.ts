import { 
  type User, 
  type InsertUser, 
  type Project, 
  type InsertProject,
  type Document,
  type InsertDocument,
  type DocumentImage,
  type InsertDocumentImage,
  type DocumentComment,
  type InsertDocumentComment,
  documentComments,
  type BoqItem,
  type InsertBoqItem,
  type ComplianceCheck,
  type InsertComplianceCheck,
  type Report,
  type InsertReport,
  type AiConfiguration,
  type InsertAiConfiguration,
  type ProcessingJob,
  type InsertProcessingJob,
  type BimModel,
  type InsertBimModel,
  type BimElement,
  type InsertBimElement,
  type BimStorey,
  type InsertBimStorey,
  type BimElementClassification,
  type InsertBimElementClassification,
  type Material,
  type InsertMaterial,
  type LabourRate,
  type InsertLabourRate,
  type EquipmentRate,
  type InsertEquipmentRate,
  type CostFactor,
  type InsertCostFactor,
  type Supplier,
  type InsertSupplier,
  type CostEstimate,
  type InsertCostEstimate,
  type CostEstimateItem,
  type InsertCostEstimateItem,
  type AnalysisResult,
  type InsertAnalysisResult,
  type DocumentHash,
  type InsertDocumentHash,
  type Company,
  type InsertCompany,
  type ProductCatalog,
  type InsertProductCatalog,
  type ElementProductSelection,
  type InsertElementProductSelection,
  users,
  companies,
  projects,
  documents,
  documentImages,
  boqItems,
  complianceChecks,
  reports,
  aiConfigurations,
  processingJobs,
  bimModels,
  bimElements,
  bimStoreys,
  bimElementClassifications,
  analysisResults,
  documentHashes,
  productCatalog,
  elementProductSelections,
  boqVersions,
  rfis,
  rfiResponses,
  changeRequests,
  type Rfi,
  type InsertRfi,
  type RfiResponse,
  type InsertRfiResponse,
  type ChangeRequest,
  type InsertChangeRequest,
  estimateSnapshots, type EstimateSnapshotRow, type InsertEstimateSnapshot,
  vendorQuotes, type VendorQuoteRow, type InsertVendorQuote,
  estimateAlternates, type EstimateAlternateRow, type InsertEstimateAlternate,
  estimateRfis, type EstimateRfiRow, type InsertEstimateRfi,
  constructionSequences,
  type ConstructionSequenceRow,
  type InsertConstructionSequence,
  unitRates, type UnitRate, type InsertUnitRate,
  mepRates, type MepRate, type InsertMepRate,
  regionalFactors, type RegionalFactor, type InsertRegionalFactor,
  projectOhpConfigs, type ProjectOhpConfig, type InsertProjectOhpConfig,
  rateAuditLog, type RateAuditLog, type InsertRateAuditLog,
  rateVersions, type RateVersion, type InsertRateVersion,
  gridDetectionRuns,
  gridComponents,
  gridFamilies,
  gridAxes,
  gridLabels,
  gridAxisLabels,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { PRNG } from "./helpers/prng";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, desc, and, isNull, inArray, sql, like } from "drizzle-orm";
import postgres from "postgres";
import { logger } from "./utils/enterprise-logger";

export interface IStorage {
  // 🔍 BOQ-BIM Validation Methods
  createValidationResult(result: any): Promise<any>;
  createBoqBimMapping(mapping: any): Promise<any>;
  getValidationResults(projectId: string): Promise<any[]>;
  getBoqBimMappings(projectId: string): Promise<any[]>;
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, user: Partial<User>): Promise<User | undefined>;

  // Companies
  getCompany(id: string): Promise<Company | undefined>;
  getCompanies(): Promise<Company[]>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: string, company: Partial<Company>): Promise<Company | undefined>;

  // Projects
  getProjects(userId: string): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: string, project: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<boolean>;

  // Documents
  getDocuments(projectId: string): Promise<Document[]>;
  getDocumentsByProject(projectId: string): Promise<Document[]>;
  getDocument(id: string): Promise<Document | undefined>;
  createDocument(document: InsertDocument): Promise<Document>;
  updateDocument(id: string, document: Partial<InsertDocument>): Promise<Document | undefined>;

  // Document Images
  getDocumentSheets(documentId: string): Promise<DocumentImage[]>;
  createDocumentImage(documentImage: InsertDocumentImage): Promise<DocumentImage>;
  deleteDocument(id: string): Promise<boolean>;

  // Document Comments
  getDocumentComments(documentId: string): Promise<DocumentComment[]>;
  createDocumentComment(comment: InsertDocumentComment): Promise<DocumentComment>;
  resolveDocumentComment(commentId: string, resolvedByName: string): Promise<DocumentComment | undefined>;
  
  // Document Revision Management
  getDocumentRevisions(documentSetId: string): Promise<Document[]>;
  getCurrentDocumentRevisions(projectId: string): Promise<Document[]>;
  createDocumentRevision(baseDocumentId: string, newRevisionData: InsertDocument): Promise<Document>;
  approveDocument(documentId: string, userId: string): Promise<Document | undefined>;
  rejectDocument(documentId: string, userId: string, reason: string): Promise<Document | undefined>;
  updateDocumentReviewStatus(documentId: string, status: string, userId: string): Promise<Document | undefined>;

  // BoQ Items
  getBoqItems(projectId: string): Promise<BoqItem[]>;
  getBoqItem(id: string): Promise<BoqItem | undefined>;
  createBoqItem(boqItem: InsertBoqItem): Promise<BoqItem>;
  updateBoqItem(id: string, boqItem: Partial<InsertBoqItem>): Promise<BoqItem | undefined>;
  deleteBoqItem(id: string): Promise<boolean>;
  deleteBoqItems(projectId: string): Promise<number>; // Est-1: bulk delete by project
  // Est-3: Estimate Snapshots
  createEstimateSnapshot(data: InsertEstimateSnapshot): Promise<EstimateSnapshotRow>;
  getEstimateSnapshots(modelId: string): Promise<EstimateSnapshotRow[]>;
  // Est-3: Vendor Quotes
  createVendorQuote(data: InsertVendorQuote): Promise<VendorQuoteRow>;
  getVendorQuotes(modelId: string): Promise<VendorQuoteRow[]>;
  // Est-3: Estimate Alternates
  createEstimateAlternate(data: InsertEstimateAlternate): Promise<EstimateAlternateRow>;
  getEstimateAlternates(modelId: string): Promise<EstimateAlternateRow[]>;
  // Est-3: Estimate RFIs
  createEstimateRfi(data: InsertEstimateRfi): Promise<EstimateRfiRow>;
  getEstimateRfis(modelId: string): Promise<EstimateRfiRow[]>;
  countEstimateRfis(modelId: string): Promise<number>;

  // Estimation Rate Tables (DB-backed rates)
  getUnitRate(csiCode: string, region?: string | null): Promise<UnitRate | undefined>;
  getUnitRates(filters?: { division?: string; region?: string; source?: string }): Promise<UnitRate[]>;
  upsertUnitRate(rate: InsertUnitRate): Promise<UnitRate>;
  getMepRateByCode(csiCode: string, region?: string | null): Promise<MepRate | undefined>;
  getMepRates(division?: string): Promise<MepRate[]>;
  upsertMepRate(rate: InsertMepRate): Promise<MepRate>;
  getRegionalFactor(regionKey: string): Promise<RegionalFactor | undefined>;
  getRegionalFactors(): Promise<RegionalFactor[]>;
  upsertRegionalFactor(factor: InsertRegionalFactor): Promise<RegionalFactor>;

  // Project OH&P Configuration (DB-persisted)
  getProjectOhpConfig(projectId: string): Promise<ProjectOhpConfig | undefined>;
  upsertProjectOhpConfig(config: InsertProjectOhpConfig): Promise<ProjectOhpConfig>;

  // Rate Audit & Versioning
  createRateAuditEntry(entry: InsertRateAuditLog): Promise<RateAuditLog>;
  getRateAuditLog(tableName?: string, recordId?: string, limit?: number): Promise<RateAuditLog[]>;
  createRateVersion(version: InsertRateVersion): Promise<RateVersion>;
  getRateVersions(tableName: string, recordId: string): Promise<RateVersion[]>;
  getLatestRateVersion(tableName: string, recordId: string): Promise<RateVersion | undefined>;

  // Compliance Checks
  getComplianceChecks(projectId: string): Promise<ComplianceCheck[]>;
  createComplianceCheck(complianceCheck: InsertComplianceCheck): Promise<ComplianceCheck>;
  
  // Reports
  getReports(projectId: string): Promise<Report[]>;
  createReport(report: InsertReport): Promise<Report>;

  // AI Configurations
  getAiConfigurations(projectId: string): Promise<AiConfiguration[]>;
  getAiConfiguration(id: string): Promise<AiConfiguration | undefined>;
  createAiConfiguration(config: InsertAiConfiguration): Promise<AiConfiguration>;
  updateAiConfiguration(id: string, config: Partial<InsertAiConfiguration>): Promise<AiConfiguration | undefined>;
  deleteAiConfiguration(id: string): Promise<boolean>;

  // Processing Jobs
  getProcessingJobs(documentId?: string): Promise<ProcessingJob[]>;
  getProcessingJob(id: string): Promise<ProcessingJob | undefined>;
  createProcessingJob(job: InsertProcessingJob): Promise<ProcessingJob>;
  updateProcessingJob(id: string, job: Partial<InsertProcessingJob>): Promise<ProcessingJob | undefined>;
  deleteProcessingJob(id: string): Promise<boolean>;

  // BIM Models
  getBimModels(projectId: string): Promise<BimModel[]>;
  getBimModel(id: string): Promise<BimModel | undefined>;
  createBimModel(model: InsertBimModel): Promise<BimModel>;
  updateBimModel(id: string, model: Partial<InsertBimModel>): Promise<BimModel | undefined>;
  deleteBimModel(id: string): Promise<boolean>;

  // BIM Elements
  getBimElements(modelId: string): Promise<BimElement[]>;
  getBimElementsByStorey(modelId: string, storeyName: string): Promise<BimElement[]>;
  getAllBimElements(): Promise<BimElement[]>;
  getBimElement(id: string): Promise<BimElement | undefined>;
  createBimElement(element: InsertBimElement): Promise<BimElement>;
  updateBimElement(id: string, element: Partial<InsertBimElement>): Promise<BimElement | undefined>;
  deleteBimElement(id: string): Promise<boolean>;

  // BIM Storeys — first-class relational store for floor data
  getBimStoreys(modelId: string): Promise<BimStorey[]>;
  upsertBimStoreys(modelId: string, storeys: any[]): Promise<void>;
  updateBimStoreyElementCount(modelId: string): Promise<void>;

  // BIM Element Classifications
  getBimElementClassifications(elementId: string): Promise<BimElementClassification[]>;
  createBimElementClassification(classification: InsertBimElementClassification): Promise<BimElementClassification>;
  updateBimElementClassification(id: string, classification: Partial<InsertBimElementClassification>): Promise<BimElementClassification | undefined>;
  upsertBimElements(modelId: string, elements: any[]): Promise<void>;

  // Cost Estimation - Materials
  getMaterials(region?: string): Promise<Material[]>;
  getMaterial(id: string): Promise<Material | undefined>;
  createMaterial(material: InsertMaterial): Promise<Material>;
  updateMaterial(id: string, material: Partial<InsertMaterial>): Promise<Material | undefined>;
  deleteMaterial(id: string): Promise<boolean>;

  // Cost Estimation - Labour Rates
  getLabourRates(region?: string): Promise<LabourRate[]>;
  getLabourRate(id: string): Promise<LabourRate | undefined>;
  createLabourRate(labourRate: InsertLabourRate): Promise<LabourRate>;
  updateLabourRate(id: string, labourRate: Partial<InsertLabourRate>): Promise<LabourRate | undefined>;
  deleteLabourRate(id: string): Promise<boolean>;

  // Cost Estimation - Equipment Rates
  getEquipmentRates(region?: string): Promise<EquipmentRate[]>;
  getEquipmentRate(id: string): Promise<EquipmentRate | undefined>;
  createEquipmentRate(equipmentRate: InsertEquipmentRate): Promise<EquipmentRate>;
  updateEquipmentRate(id: string, equipmentRate: Partial<InsertEquipmentRate>): Promise<EquipmentRate | undefined>;
  deleteEquipmentRate(id: string): Promise<boolean>;

  // Cost Estimation - Cost Factors
  getCostFactors(region?: string): Promise<CostFactor[]>;
  getCostFactor(id: string): Promise<CostFactor | undefined>;
  createCostFactor(costFactor: InsertCostFactor): Promise<CostFactor>;
  updateCostFactor(id: string, costFactor: Partial<InsertCostFactor>): Promise<CostFactor | undefined>;
  deleteCostFactor(id: string): Promise<boolean>;

  // Cost Estimation - Suppliers
  getSuppliers(region?: string): Promise<Supplier[]>;
  getSupplier(id: string): Promise<Supplier | undefined>;
  createSupplier(supplier: InsertSupplier): Promise<Supplier>;
  updateSupplier(id: string, supplier: Partial<InsertSupplier>): Promise<Supplier | undefined>;
  deleteSupplier(id: string): Promise<boolean>;

  // Cost Estimation - Cost Estimates
  getCostEstimates(projectId: string): Promise<CostEstimate[]>;
  getCostEstimate(id: string): Promise<CostEstimate | undefined>;
  createCostEstimate(costEstimate: InsertCostEstimate): Promise<CostEstimate>;
  updateCostEstimate(id: string, costEstimate: Partial<InsertCostEstimate>): Promise<CostEstimate | undefined>;
  deleteCostEstimate(id: string): Promise<boolean>;

  // 🛠️ Product Catalog - Claude-discovered products by CSI assemblies
  getProductsByCsiDivision(csiDivision: string): Promise<ProductCatalog[]>;
  getProductsByAssembly(assemblyReference: string): Promise<ProductCatalog[]>;
  getProduct(id: string): Promise<ProductCatalog | undefined>;
  createProduct(product: InsertProductCatalog): Promise<ProductCatalog>;
  upsertProductsFromClaude(products: InsertProductCatalog[]): Promise<void>;
  
  // 🎯 Element Product Selections - user choices and custom costs
  getElementProductSelection(bimElementId: string): Promise<ElementProductSelection | undefined>;
  setElementProductSelection(selection: InsertElementProductSelection): Promise<ElementProductSelection>;
  updateElementCustomCost(bimElementId: string, customCost: number, customProductName?: string): Promise<ElementProductSelection>;
  getProjectProductSelections(projectId: string): Promise<ElementProductSelection[]>;

  // Cost Estimation - Cost Estimate Items
  getCostEstimateItems(estimateId: string): Promise<CostEstimateItem[]>;
  getCostEstimateItem(id: string): Promise<CostEstimateItem | undefined>;
  createCostEstimateItem(item: InsertCostEstimateItem): Promise<CostEstimateItem>;
  updateCostEstimateItem(id: string, item: Partial<InsertCostEstimateItem>): Promise<CostEstimateItem | undefined>;
  deleteCostEstimateItem(id: string): Promise<boolean>;

  // Building Code Sections
  getBuildingCodeSections(jurisdiction?: string): Promise<any[]>;
  createBuildingCodeSection(data: any): Promise<any>;

  // Analysis Result methods
  getAnalysisResult(id: string): Promise<AnalysisResult | undefined>;
  getLatestAnalysisResult(projectId: string, analysisType: string): Promise<AnalysisResult | null>;
  getAnalysisHistory(projectId: string, analysisType: string): Promise<AnalysisResult[]>;
  createAnalysisResult(analysisResult: InsertAnalysisResult): Promise<AnalysisResult>;
  updateAnalysisResult(id: string, analysisResult: Partial<AnalysisResult>): Promise<AnalysisResult | undefined>;
  deleteAnalysisResult(id: string): Promise<boolean>;

  // Document Hash methods  
  getDocumentHash(documentId: string): Promise<DocumentHash | undefined>;
  upsertDocumentHash(documentHash: InsertDocumentHash): Promise<DocumentHash>;
  getDocumentHashes(documentIds: string[]): Promise<DocumentHash[]>;

  // Project Document methods
  getProjectDocuments(projectId: string): Promise<Document[]>;

  // BOQ Versions — full CRUD
  getBoqVersions(projectId: string): Promise<any[]>;
  getBoqVersion(id: string): Promise<any | undefined>;
  createBoqVersion(data: Record<string, unknown>): Promise<any>;
  updateBoqVersion(id: string, data: Record<string, unknown>): Promise<any | undefined>;
  deleteBoqVersion(id: string): Promise<boolean>;

  // RFIs — full CRUD
  getRfis(projectId: string): Promise<Rfi[]>;
  getRfi(id: string): Promise<Rfi | undefined>;
  createRfi(data: InsertRfi): Promise<Rfi>;
  updateRfi(id: string, data: Partial<InsertRfi>): Promise<Rfi | undefined>;
  deleteRfi(id: string): Promise<boolean>;

  // RFI Responses
  getRfiResponses(rfiId: string): Promise<RfiResponse[]>;
  createRfiResponse(data: InsertRfiResponse): Promise<RfiResponse>;

  // Change Requests — full CRUD
  getChangeRequests(projectId: string): Promise<ChangeRequest[]>;
  getChangeRequest(id: string): Promise<ChangeRequest | undefined>;
  createChangeRequest(data: InsertChangeRequest): Promise<ChangeRequest>;
  updateChangeRequest(id: string, data: Partial<InsertChangeRequest>): Promise<ChangeRequest | undefined>;
  deleteChangeRequest(id: string): Promise<boolean>;

  // BIM Model field/metadata patch helpers (used by model-status service)
  updateBimModelFields(modelId: string, patch: Record<string, unknown>): Promise<BimModel | undefined>;
  updateBimModelMetadata(modelId: string, metadata: Record<string, unknown>): Promise<BimModel | undefined>;

  // Notifications
  getNotifications(userId: string, limit?: number): Promise<any[]>;
  getUnreadNotificationCount(userId: string): Promise<number>;
  createNotification(data: { userId: string; projectId?: string; type?: string; title: string; message: string; link?: string; metadata?: any; }): Promise<any>;
  markNotificationRead(id: string, userId: string): Promise<boolean>;
  markAllNotificationsRead(userId: string): Promise<number>;
  deleteNotification(id: string, userId: string): Promise<boolean>;

  // System Alerts
  getSystemAlerts(onlyOpen?: boolean, limit?: number): Promise<any[]>;
  createSystemAlert(data: { severity?: "info"|"warning"|"error"|"critical"; source: string; title: string; message: string; metadata?: any; }): Promise<any>;
  resolveSystemAlert(id: string, resolvedBy?: string): Promise<boolean>;

  // User Settings
  getUserSettings(userId: string): Promise<any | null>;
  upsertUserSettings(userId: string, patch: Record<string, unknown>): Promise<any>;
}

export class MemStorage implements Partial<IStorage> {
  private users: Map<string, User> = new Map();
  private companies: Map<string, Company> = new Map();
  private projects: Map<string, Project> = new Map();
  private documents: Map<string, Document> = new Map();
  private boqItems: Map<string, BoqItem> = new Map();
  private complianceChecks: Map<string, ComplianceCheck> = new Map();
  private reports: Map<string, Report> = new Map();

  constructor() {
    // Start with empty storage - no sample data
  }

  // User methods
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    // Debug: Looking for user with username
    const user = Array.from(this.users.values()).find(user => user.username === username);
    // Debug: User lookup result
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { 
      ...insertUser, 
      id,
      role: insertUser.role || "Construction Manager",
      // ✅ FIX: Ensure email is string | null, not undefined
      email: insertUser.email || null,
      createdAt: new Date(),
      updatedAt: new Date(),
      companyId: null,
      isCompanyAdmin: false,
      subscriptionId: null,
      subscriptionStatus: null,
      stripeCustomerId: null,
      plan: "trial",
      subscriptionTier: "basic", // ✅ FIX: Use valid subscription tier
      trialEndsAt: null,
      subscriptionEndsAt: null,
    };
    this.users.set(id, user);
    return user;
  }

  async updateUser(id: string, user: Partial<User>): Promise<User | undefined> {
    const existingUser = this.users.get(id);
    if (!existingUser) return undefined;

    const updatedUser = { ...existingUser, ...user, updatedAt: new Date() };
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  // Company methods
  async getCompany(id: string): Promise<Company | undefined> {
    return this.companies.get(id);
  }

  async getCompanies(): Promise<Company[]> {
    return Array.from(this.companies.values());
  }

  async createCompany(insertCompany: InsertCompany): Promise<Company> {
    const id = randomUUID();
    const company: Company = { 
      ...insertCompany, 
      id,
      role: insertCompany.role || "Solo_Practitioner",
      // ✅ FIX: Provide required allowedDisciplines field  
      allowedDisciplines: insertCompany.allowedDisciplines || ["General"],
      isSoloPractitioner: insertCompany.isSoloPractitioner ?? false,
      licenseNumber: insertCompany.licenseNumber || null,
      contactEmail: insertCompany.contactEmail || null,
      address: insertCompany.address || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.companies.set(id, company);
    return company;
  }

  async updateCompany(id: string, company: Partial<Company>): Promise<Company | undefined> {
    const existingCompany = this.companies.get(id);
    if (!existingCompany) return undefined;

    const updatedCompany = { ...existingCompany, ...company, updatedAt: new Date() };
    this.companies.set(id, updatedCompany);
    return updatedCompany;
  }

  // Project methods
  async getProjects(userId: string): Promise<Project[]> {
    return Array.from(this.projects.values()).filter(project => project.userId === userId);
  }

  async getProject(id: string): Promise<Project | undefined> {
    return this.projects.get(id);
  }

  async createProject(insertProject: InsertProject): Promise<Project> {
    const id = randomUUID();
    const project: Project = {
      ...insertProject,
      id,
      description: insertProject.description || null,
      // ✅ FIX: Ensure required fields are always provided and handle undefined values
      type: insertProject.type || "Commercial",
      country: insertProject.country || "canada",
      federalCode: insertProject.federalCode || "NBC",
      location: insertProject.location || "Unknown",
      status: insertProject.status || "Draft",
      stateProvincialCode: insertProject.stateProvincialCode || null,
      municipalCode: insertProject.municipalCode || null,
      estimateValue: insertProject.estimateValue || null,
      buildingArea: insertProject.buildingArea || null,
      rateSystem: insertProject.rateSystem || "ciqs",
      buildingClass: insertProject.buildingClass || 'B',
      complexity: insertProject.complexity || 'medium',
      riskProfile: insertProject.riskProfile || 'medium',
      userId: insertProject.userId || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.projects.set(id, project);
    return project;
  }

  async updateProject(id: string, updateData: Partial<InsertProject>): Promise<Project | undefined> {
    const project = this.projects.get(id);
    if (!project) return undefined;
    
    const updatedProject = {
      ...project,
      ...updateData,
      updatedAt: new Date()
    };
    this.projects.set(id, updatedProject);
    return updatedProject;
  }

  async deleteProject(id: string): Promise<boolean> {
    return this.projects.delete(id);
  }

  // Document methods
  async getDocuments(projectId: string): Promise<Document[]> {
    return Array.from(this.documents.values()).filter(doc => doc.projectId === projectId);
  }

  async getDocumentsByProject(projectId: string): Promise<Document[]> {
    return this.getDocuments(projectId);
  }

  async getDocument(id: string): Promise<Document | undefined> {
    return this.documents.get(id);
  }

  async createDocument(insertDocument: InsertDocument): Promise<Document> {
    const id = randomUUID();
    const document: Document = {
      ...insertDocument,
      id,
      projectId: insertDocument.projectId ?? '',
      // ✅ FIX: Ensure fileSize is number|null, not undefined
      fileSize: insertDocument.fileSize ?? null,
      pageCount: insertDocument.pageCount ?? null,
      textContent: insertDocument.textContent ?? null,
      pageText: insertDocument.pageText ?? null,
      rasterPreviews: insertDocument.rasterPreviews ?? null,
      vectorHints: insertDocument.vectorHints ?? null,
      // ✅ FIX: Ensure storageKey is string|null, not undefined
      storageKey: insertDocument.storageKey ?? '',
      analysisStatus: insertDocument.analysisStatus || "Pending",
      analysisResult: insertDocument.analysisResult || null,
      // ✅ FIX: Add missing required timestamp fields
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.documents.set(id, document);
    return document;
  }

  async updateDocument(id: string, updateData: Partial<InsertDocument>): Promise<Document | undefined> {
    const document = this.documents.get(id);
    if (!document) return undefined;
    
    const updatedDocument = { ...document, ...updateData };
    this.documents.set(id, updatedDocument);
    return updatedDocument;
  }

  async deleteDocument(id: string): Promise<boolean> {
    return this.documents.delete(id);
  }

  // Document Images methods (not implemented in MemStorage)
  async getDocumentSheets(_documentId: string): Promise<DocumentImage[]> {
    return [];
  }

  async createDocumentImage(insertDocumentImage: InsertDocumentImage): Promise<DocumentImage> {
    const id = randomUUID();
    const documentImage: DocumentImage = {
      ...insertDocumentImage,
      id,
      // ✅ FIX: Ensure sheetNumber and sheetTitle are string|null, not undefined
      sheetNumber: insertDocumentImage.sheetNumber || null,
      sheetTitle: insertDocumentImage.sheetTitle || null,
      createdAt: new Date(),
    };
    return documentImage;
  }

  // Document Comments (in-memory)
  private documentComments: Map<string, DocumentComment> = new Map();

  async getDocumentComments(documentId: string): Promise<DocumentComment[]> {
    return Array.from(this.documentComments.values())
      .filter(c => c.documentId === documentId)
      .sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime());
  }

  async createDocumentComment(comment: InsertDocumentComment): Promise<DocumentComment> {
    const id = randomUUID();
    const newComment: DocumentComment = {
      ...comment,
      id,
      resolved: false,
      resolvedAt: null,
      resolvedByName: null,
      createdAt: new Date(),
    };
    this.documentComments.set(id, newComment);
    return newComment;
  }

  async resolveDocumentComment(commentId: string, resolvedByName: string): Promise<DocumentComment | undefined> {
    const comment = this.documentComments.get(commentId);
    if (!comment) return undefined;
    const updated = { ...comment, resolved: true, resolvedAt: new Date(), resolvedByName };
    this.documentComments.set(commentId, updated);
    return updated;
  }

  // Simplified document management (removed revision features)
  async getDocumentRevisions(documentSetId: string): Promise<Document[]> {
    return Array.from(this.documents.values())
      .filter(doc => doc.projectId === documentSetId)
      .sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
  }

  async getCurrentDocumentRevisions(projectId: string): Promise<Document[]> {
    return Array.from(this.documents.values())
      .filter(doc => doc.projectId === projectId);
  }

  async createDocumentRevision(baseDocumentId: string, newRevisionData: InsertDocument): Promise<Document> {
    return this.createDocument(newRevisionData);
  }

  async approveDocument(documentId: string, _userId: string): Promise<Document | undefined> {
    return this.updateDocument(documentId, { analysisStatus: 'Approved' });
  }

  async rejectDocument(documentId: string, _userId: string, _reason: string): Promise<Document | undefined> {
    return this.updateDocument(documentId, { analysisStatus: 'Rejected' });
  }

  async updateDocumentReviewStatus(documentId: string, status: string, _userId: string): Promise<Document | undefined> {
    return this.updateDocument(documentId, { analysisStatus: status });
  }

  // BoQ Item methods
  async getBoqItems(projectId: string): Promise<BoqItem[]> {
    return Array.from(this.boqItems.values()).filter(item => item.projectId === projectId);
  }
  
  async getBoqItemsCount(projectId: string): Promise<number> {
    return Array.from(this.boqItems.values()).filter(item => item.projectId === projectId).length;
  }

  async getBoqItem(id: string): Promise<BoqItem | undefined> {
    return this.boqItems.get(id);
  }

  async createBoqItem(insertBoqItem: InsertBoqItem): Promise<BoqItem> {
    const id = randomUUID();
    const boqItem: BoqItem = {
      ...insertBoqItem,
      id,
      projectId: insertBoqItem.projectId ?? '',
      description: insertBoqItem.description || '',
      itemCode: insertBoqItem.itemCode || '',
      unit: insertBoqItem.unit || '',
      quantity: insertBoqItem.quantity || '0',
      rate: insertBoqItem.rate || '0',
      amount: insertBoqItem.amount || '0',
      category: insertBoqItem.category || '',
      standard: insertBoqItem.standard || null,
      floor: insertBoqItem.floor || null,
      createdAt: new Date()
    };
    this.boqItems.set(id, boqItem);
    return boqItem;
  }

  async updateBoqItem(id: string, updateData: Partial<InsertBoqItem>): Promise<BoqItem | undefined> {
    const boqItem = this.boqItems.get(id);
    if (!boqItem) return undefined;
    
    const updatedBoqItem = { ...boqItem, ...updateData };
    this.boqItems.set(id, updatedBoqItem);
    return updatedBoqItem;
  }

  async deleteBoqItem(id: string): Promise<boolean> {
    return this.boqItems.delete(id);
  }

  // Est-1: bulk delete all BOQ items for a project
  async deleteBoqItems(projectId: string): Promise<number> {
    let count = 0;
    for (const [id, item] of this.boqItems) {
      if (item.projectId === projectId) {
        this.boqItems.delete(id);
        count++;
      }
    }
    return count;
  }

  // Est-3: Estimate Snapshots (in-memory fallback)
  async createEstimateSnapshot(data: InsertEstimateSnapshot): Promise<EstimateSnapshotRow> {
    const row = { ...data, id: randomUUID(), createdAt: new Date() } as EstimateSnapshotRow;
    return row;
  }
  async getEstimateSnapshots(_modelId: string): Promise<EstimateSnapshotRow[]> { return []; }

  // Est-3: Vendor Quotes (in-memory fallback)
  async createVendorQuote(data: InsertVendorQuote): Promise<VendorQuoteRow> {
    const row = { ...data, id: randomUUID(), createdAt: new Date() } as VendorQuoteRow;
    return row;
  }
  async getVendorQuotes(_modelId: string): Promise<VendorQuoteRow[]> { return []; }

  // Est-3: Estimate Alternates (in-memory fallback)
  async createEstimateAlternate(data: InsertEstimateAlternate): Promise<EstimateAlternateRow> {
    const row = { ...data, id: randomUUID(), createdAt: new Date() } as EstimateAlternateRow;
    return row;
  }
  async getEstimateAlternates(_modelId: string): Promise<EstimateAlternateRow[]> { return []; }

  // Est-3: Estimate RFIs (in-memory fallback)
  async createEstimateRfi(data: InsertEstimateRfi): Promise<EstimateRfiRow> {
    const row = { ...data, id: randomUUID(), createdAt: new Date() } as EstimateRfiRow;
    return row;
  }
  async getEstimateRfis(_modelId: string): Promise<EstimateRfiRow[]> { return []; }
  async countEstimateRfis(_modelId: string): Promise<number> { return 0; }

  // Rate tables (in-memory fallback — returns empty, engine falls back to hardcoded)
  async getUnitRate(_csiCode: string, _region?: string | null): Promise<UnitRate | undefined> { return undefined; }
  async getUnitRates(_filters?: any): Promise<UnitRate[]> { return []; }
  async upsertUnitRate(rate: InsertUnitRate): Promise<UnitRate> { return { ...rate, id: randomUUID(), createdAt: new Date(), updatedAt: new Date() } as UnitRate; }
  async getMepRateByCode(_csiCode: string, _region?: string | null): Promise<MepRate | undefined> { return undefined; }
  async getMepRates(_division?: string): Promise<MepRate[]> { return []; }
  async upsertMepRate(rate: InsertMepRate): Promise<MepRate> { return { ...rate, id: randomUUID(), createdAt: new Date(), updatedAt: new Date() } as MepRate; }
  async getRegionalFactor(_regionKey: string): Promise<RegionalFactor | undefined> { return undefined; }
  async getRegionalFactors(): Promise<RegionalFactor[]> { return []; }
  async upsertRegionalFactor(factor: InsertRegionalFactor): Promise<RegionalFactor> { return { ...factor, id: randomUUID(), createdAt: new Date(), updatedAt: new Date() } as RegionalFactor; }
  async getProjectOhpConfig(_projectId: string): Promise<ProjectOhpConfig | undefined> { return undefined; }
  async upsertProjectOhpConfig(config: InsertProjectOhpConfig): Promise<ProjectOhpConfig> { return { ...config, id: randomUUID(), createdAt: new Date(), updatedAt: new Date() } as ProjectOhpConfig; }

  // Rate Audit & Versioning (in-memory stubs)
  async createRateAuditEntry(entry: InsertRateAuditLog): Promise<RateAuditLog> { return { ...entry, id: randomUUID(), createdAt: new Date() } as RateAuditLog; }
  async getRateAuditLog(_tableName?: string, _recordId?: string, _limit?: number): Promise<RateAuditLog[]> { return []; }
  async createRateVersion(version: InsertRateVersion): Promise<RateVersion> { return { ...version, id: randomUUID(), createdAt: new Date() } as RateVersion; }
  async getRateVersions(_tableName: string, _recordId: string): Promise<RateVersion[]> { return []; }
  async getLatestRateVersion(_tableName: string, _recordId: string): Promise<RateVersion | undefined> { return undefined; }

  // 🔍 BOQ-BIM Validation Methods
  async createValidationResult(result: any): Promise<any> {
    const id = randomUUID();
    const validationResult = {
      ...result,
      id,
      createdAt: new Date()
    };
    // Store in memory (simplified for now)
    return validationResult;
  }

  async createBoqBimMapping(mapping: any): Promise<any> {
    const id = randomUUID();
    const boqBimMapping = {
      ...mapping,
      id,
      createdAt: new Date()
    };
    // Store in memory (simplified for now)
    return boqBimMapping;
  }

  async getValidationResults(_projectId: string): Promise<any[]> {
    // Return empty array for now - would fetch from database
    return [];
  }

  async getBoqBimMappings(_projectId: string): Promise<any[]> {
    // Return empty array for now - would fetch from database
    return [];
  }

  // Compliance Check methods
  async getComplianceChecks(projectId: string): Promise<ComplianceCheck[]> {
    return Array.from(this.complianceChecks.values()).filter(check => check.projectId === projectId);
  }

  async createComplianceCheck(insertComplianceCheck: InsertComplianceCheck): Promise<ComplianceCheck> {
    const id = randomUUID();
    const complianceCheck: ComplianceCheck = {
      ...insertComplianceCheck,
      id,
      projectId: insertComplianceCheck.projectId ?? '',
      standard: insertComplianceCheck.standard || '',
      requirement: insertComplianceCheck.requirement || '',
      status: insertComplianceCheck.status || "Not Applicable",
      details: insertComplianceCheck.details || null,
      recommendation: insertComplianceCheck.recommendation || null,
      createdAt: new Date()
    };
    this.complianceChecks.set(id, complianceCheck);
    return complianceCheck;
  }

  // Report methods
  async getReports(projectId: string): Promise<Report[]> {
    return Array.from(this.reports.values()).filter(report => report.projectId === projectId);
  }

  async createReport(insertReport: InsertReport): Promise<Report> {
    const id = randomUUID();
    const report: Report = {
      ...insertReport,
      id,
      projectId: insertReport.projectId ?? '',
      filename: insertReport.filename || '',
      fileSize: insertReport.fileSize || 0,
      reportType: insertReport.reportType || '',
      status: insertReport.status || "Ready",
      generatedAt: new Date()
    };
    this.reports.set(id, report);
    return report;
  }

  // Building Code Section methods (in-memory storage)
  async getBuildingCodeSections(_jurisdiction?: string): Promise<any[]> {
    // Return empty array for in-memory storage - would need database for real data
    return [];
  }

  async createBuildingCodeSection(data: any): Promise<any> {
    // For in-memory storage, just return the data with an ID
    return { ...data, id: randomUUID() };
  }
}

// Database connection
const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);

export class DBStorage implements Partial<IStorage> {
  private db = drizzle(client);
  
  // User methods
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id));
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username));
    return result[0];
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(users.createdAt);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await db.insert(users).values(insertUser).returning();
    return result[0];
  }

  async updateUser(id: string, updateData: Partial<User>): Promise<User | undefined> {
    const result = await db.update(users)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return result[0];
  }

  // Company methods
  async getCompany(id: string): Promise<Company | undefined> {
    const result = await db.select().from(companies).where(eq(companies.id, id));
    return result[0];
  }

  async getCompanies(limit = 100, offset = 0): Promise<Company[]> {
    return await db.select().from(companies).limit(limit).offset(offset);
  }

  async createCompany(insertCompany: InsertCompany): Promise<Company> {
    const result = await db.insert(companies).values(insertCompany).returning();
    return result[0];
  }

  async updateCompany(id: string, updateData: Partial<Company>): Promise<Company | undefined> {
    const result = await db.update(companies)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(companies.id, id))
      .returning();
    return result[0];
  }

  // Project methods
  async getProjects(userId: string): Promise<Project[]> {
    return await db.select().from(projects).where(eq(projects.userId, userId));
  }

  async getProject(id: string): Promise<Project | undefined> {
    const result = await db.select().from(projects).where(eq(projects.id, id));
    return result[0];
  }

  async createProject(insertProject: InsertProject): Promise<Project> {
    const result = await db.insert(projects).values({
      ...insertProject,
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning();
    return result[0];
  }

  async updateProject(id: string, updateData: Partial<InsertProject>): Promise<Project | undefined> {
    const result = await db.update(projects)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return result[0];
  }

  async deleteProject(id: string): Promise<boolean> {
    const result = await db.delete(projects).where(eq(projects.id, id));
    return result.length > 0;
  }

  // Document methods
  async getDocuments(projectId: string): Promise<Document[]> {
    return await db.select().from(documents).where(eq(documents.projectId, projectId));
  }

  async getDocumentsByProject(projectId: string): Promise<Document[]> {
    return this.getDocuments(projectId);
  }

  async getDocument(id: string): Promise<Document | undefined> {
    const result = await db.select().from(documents).where(eq(documents.id, id));
    return result[0];
  }

  async createDocument(insertDocument: InsertDocument): Promise<Document> {
    const result = await db.insert(documents).values({
      ...insertDocument,
      // ✅ FIX: Use correct field name from schema
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning();
    return result[0];
  }

  async updateDocument(id: string, updateData: Partial<InsertDocument>): Promise<Document | undefined> {
    const result = await db.update(documents)
      .set(updateData)
      .where(eq(documents.id, id))
      .returning();
    return result[0];
  }

  async deleteDocument(id: string): Promise<boolean> {
    const result = await db.delete(documents).where(eq(documents.id, id)).returning({ id: documents.id });
    return result.length > 0;
  }

  // Document Images methods
  async getDocumentSheets(documentId: string): Promise<DocumentImage[]> {
    const result = await db.select()
      .from(documentImages)
      .where(eq(documentImages.documentId, documentId))
      .orderBy(documentImages.pageNumber);
    return result;
  }

  async createDocumentImage(insertDocumentImage: InsertDocumentImage): Promise<DocumentImage> {
    const result = await db.insert(documentImages).values(insertDocumentImage).returning();
    return result[0];
  }

  // Document Comments
  async getDocumentComments(documentId: string): Promise<DocumentComment[]> {
    return await db.select().from(documentComments)
      .where(eq(documentComments.documentId, documentId))
      .orderBy(documentComments.createdAt);
  }

  async createDocumentComment(comment: InsertDocumentComment): Promise<DocumentComment> {
    const result = await db.insert(documentComments).values(comment).returning();
    return result[0];
  }

  async resolveDocumentComment(commentId: string, resolvedByName: string): Promise<DocumentComment | undefined> {
    const result = await db.update(documentComments)
      .set({ resolved: true, resolvedAt: new Date(), resolvedByName })
      .where(eq(documentComments.id, commentId))
      .returning();
    return result[0];
  }

  // BoQ Item methods
  async getBoqItems(projectId: string): Promise<BoqItem[]> {
    return await db.select().from(boqItems).where(eq(boqItems.projectId, projectId));
  }
  
  async getBoqItemsCount(projectId: string): Promise<number> {
    const result = await db.select().from(boqItems).where(eq(boqItems.projectId, projectId));
    return result.length;
  }

  async getBoqItem(id: string): Promise<BoqItem | undefined> {
    const result = await db.select().from(boqItems).where(eq(boqItems.id, id));
    return result[0];
  }

  async createBoqItem(insertBoqItem: InsertBoqItem): Promise<BoqItem> {
    const result = await db.insert(boqItems).values(insertBoqItem).returning();
    return result[0];
  }

  async updateBoqItem(id: string, updateData: Partial<InsertBoqItem>): Promise<BoqItem | undefined> {
    const result = await db.update(boqItems)
      .set(updateData)
      .where(eq(boqItems.id, id))
      .returning();
    return result[0];
  }

  async deleteBoqItem(id: string): Promise<boolean> {
    const result = await db.delete(boqItems).where(eq(boqItems.id, id));
    return result.length > 0;
  }

  // Est-1: bulk delete all BOQ items for a project before re-generating
  async deleteBoqItems(projectId: string): Promise<number> {
    const result = await db.delete(boqItems).where(eq(boqItems.projectId, projectId));
    return (result as any).rowCount ?? 0;
  }

  // Est-3: Estimate Snapshots — DB persistence
  async createEstimateSnapshot(data: InsertEstimateSnapshot): Promise<EstimateSnapshotRow> {
    const result = await db.insert(estimateSnapshots).values(data).returning();
    return result[0];
  }
  async getEstimateSnapshots(modelId: string): Promise<EstimateSnapshotRow[]> {
    return await db.select().from(estimateSnapshots)
      .where(eq(estimateSnapshots.modelId, modelId))
      .orderBy(desc(estimateSnapshots.createdAt));
  }

  // Est-3: Vendor Quotes — DB persistence
  async createVendorQuote(data: InsertVendorQuote): Promise<VendorQuoteRow> {
    const result = await db.insert(vendorQuotes).values(data).returning();
    return result[0];
  }
  async getVendorQuotes(modelId: string): Promise<VendorQuoteRow[]> {
    return await db.select().from(vendorQuotes)
      .where(eq(vendorQuotes.modelId, modelId))
      .orderBy(desc(vendorQuotes.createdAt));
  }

  // Est-3: Estimate Alternates — DB persistence
  async createEstimateAlternate(data: InsertEstimateAlternate): Promise<EstimateAlternateRow> {
    const result = await db.insert(estimateAlternates).values(data).returning();
    return result[0];
  }
  async getEstimateAlternates(modelId: string): Promise<EstimateAlternateRow[]> {
    return await db.select().from(estimateAlternates)
      .where(eq(estimateAlternates.modelId, modelId))
      .orderBy(desc(estimateAlternates.createdAt));
  }

  // Est-3: Estimate RFIs — DB persistence
  async createEstimateRfi(data: InsertEstimateRfi): Promise<EstimateRfiRow> {
    const result = await db.insert(estimateRfis).values(data).returning();
    return result[0];
  }
  async getEstimateRfis(modelId: string): Promise<EstimateRfiRow[]> {
    return await db.select().from(estimateRfis)
      .where(eq(estimateRfis.modelId, modelId))
      .orderBy(desc(estimateRfis.createdAt));
  }
  async countEstimateRfis(modelId: string): Promise<number> {
    const rows = await db.select().from(estimateRfis).where(eq(estimateRfis.modelId, modelId));
    return rows.length;
  }

  // ── Rate Tables — DB-backed estimation rates ──

  async getUnitRate(csiCode: string, region?: string | null): Promise<UnitRate | undefined> {
    const conditions = region
      ? and(eq(unitRates.csiCode, csiCode), eq(unitRates.region, region))
      : and(eq(unitRates.csiCode, csiCode), isNull(unitRates.region));
    const rows = await db.select().from(unitRates).where(conditions).limit(1);
    return rows[0] ?? undefined;
  }

  async getUnitRates(filters?: { division?: string; region?: string; source?: string }): Promise<UnitRate[]> {
    let query = db.select().from(unitRates);
    // Apply filters if provided — filter in JS for simplicity with Drizzle
    const rows = await query.orderBy(unitRates.csiCode);
    if (!filters) return rows;
    return rows.filter(r => {
      if (filters.division && !r.csiCode.startsWith(filters.division)) return false;
      if (filters.region && r.region !== filters.region) return false;
      if (filters.source && r.source !== filters.source) return false;
      return true;
    });
  }

  async upsertUnitRate(rate: InsertUnitRate): Promise<UnitRate> {
    // Try update first by csiCode + region
    const existing = await this.getUnitRate(rate.csiCode, rate.region);
    if (existing) {
      const result = await db.update(unitRates)
        .set({ ...rate, updatedAt: new Date() })
        .where(eq(unitRates.id, existing.id))
        .returning();
      return result[0];
    }
    const result = await db.insert(unitRates).values(rate).returning();
    return result[0];
  }

  async getMepRateByCode(csiCode: string, region?: string | null): Promise<MepRate | undefined> {
    const conditions = region
      ? and(eq(mepRates.csiCode, csiCode), eq(mepRates.region, region))
      : eq(mepRates.csiCode, csiCode);
    const rows = await db.select().from(mepRates).where(conditions).limit(1);
    return rows[0] ?? undefined;
  }

  async getMepRates(division?: string): Promise<MepRate[]> {
    if (division) {
      return await db.select().from(mepRates)
        .where(eq(mepRates.division, division))
        .orderBy(mepRates.csiCode);
    }
    return await db.select().from(mepRates).orderBy(mepRates.csiCode);
  }

  async upsertMepRate(rate: InsertMepRate): Promise<MepRate> {
    const existing = await this.getMepRateByCode(rate.csiCode, rate.region);
    if (existing) {
      const result = await db.update(mepRates)
        .set({ ...rate, updatedAt: new Date() })
        .where(eq(mepRates.id, existing.id))
        .returning();
      return result[0];
    }
    const result = await db.insert(mepRates).values(rate).returning();
    return result[0];
  }

  async getRegionalFactor(regionKey: string): Promise<RegionalFactor | undefined> {
    const rows = await db.select().from(regionalFactors)
      .where(eq(regionalFactors.regionKey, regionKey)).limit(1);
    return rows[0] ?? undefined;
  }

  async getRegionalFactors(): Promise<RegionalFactor[]> {
    return await db.select().from(regionalFactors).orderBy(regionalFactors.regionKey);
  }

  async upsertRegionalFactor(factor: InsertRegionalFactor): Promise<RegionalFactor> {
    const existing = await this.getRegionalFactor(factor.regionKey);
    if (existing) {
      const result = await db.update(regionalFactors)
        .set({ ...factor, updatedAt: new Date() })
        .where(eq(regionalFactors.id, existing.id))
        .returning();
      return result[0];
    }
    const result = await db.insert(regionalFactors).values(factor).returning();
    return result[0];
  }

  async getProjectOhpConfig(projectId: string): Promise<ProjectOhpConfig | undefined> {
    const rows = await db.select().from(projectOhpConfigs)
      .where(eq(projectOhpConfigs.projectId, projectId)).limit(1);
    return rows[0] ?? undefined;
  }

  async upsertProjectOhpConfig(config: InsertProjectOhpConfig): Promise<ProjectOhpConfig> {
    const existing = await this.getProjectOhpConfig(config.projectId);
    if (existing) {
      const result = await db.update(projectOhpConfigs)
        .set({ ...config, updatedAt: new Date() })
        .where(eq(projectOhpConfigs.id, existing.id))
        .returning();
      return result[0];
    }
    const result = await db.insert(projectOhpConfigs).values(config).returning();
    return result[0];
  }

  // Rate Audit Log methods
  async createRateAuditEntry(entry: InsertRateAuditLog): Promise<RateAuditLog> {
    const result = await db.insert(rateAuditLog).values(entry).returning();
    return result[0];
  }

  async getRateAuditLog(tableName?: string, recordId?: string, limit: number = 100): Promise<RateAuditLog[]> {
    let query = db.select().from(rateAuditLog);
    const conditions = [];
    if (tableName) conditions.push(eq(rateAuditLog.tableName, tableName));
    if (recordId) conditions.push(eq(rateAuditLog.recordId, recordId));
    if (conditions.length > 0) {
      query = query.where(conditions.length === 1 ? conditions[0] : and(...conditions)) as any;
    }
    return await (query as any).orderBy(desc(rateAuditLog.createdAt)).limit(limit);
  }

  // Rate Version methods
  async createRateVersion(version: InsertRateVersion): Promise<RateVersion> {
    const result = await db.insert(rateVersions).values(version).returning();
    return result[0];
  }

  async getRateVersions(tableName: string, recordId: string): Promise<RateVersion[]> {
    return await db.select().from(rateVersions)
      .where(and(eq(rateVersions.tableName, tableName), eq(rateVersions.recordId, recordId)))
      .orderBy(desc(rateVersions.version));
  }

  async getLatestRateVersion(tableName: string, recordId: string): Promise<RateVersion | undefined> {
    const rows = await db.select().from(rateVersions)
      .where(and(eq(rateVersions.tableName, tableName), eq(rateVersions.recordId, recordId)))
      .orderBy(desc(rateVersions.version))
      .limit(1);
    return rows[0] ?? undefined;
  }

  // Compliance Check methods
  async getComplianceChecks(projectId: string): Promise<ComplianceCheck[]> {
    return await db.select().from(complianceChecks).where(eq(complianceChecks.projectId, projectId));
  }

  async createComplianceCheck(insertComplianceCheck: InsertComplianceCheck): Promise<ComplianceCheck> {
    const result = await db.insert(complianceChecks).values(insertComplianceCheck).returning();
    return result[0];
  }

  // Report methods
  async getReports(projectId: string): Promise<Report[]> {
    return await db.select().from(reports).where(eq(reports.projectId, projectId));
  }

  async createReport(insertReport: InsertReport): Promise<Report> {
    const result = await db.insert(reports).values(insertReport).returning();
    return result[0];
  }

  // Building Code Section methods  
  async getBuildingCodeSections(jurisdiction?: string): Promise<any[]> {
    // ✅ FIX: Import properly and construct query correctly
    const { buildingCodeSections } = await import("@shared/schema");
    let baseQuery = db.select().from(buildingCodeSections);
    
    if (jurisdiction && jurisdiction !== 'both') {
      return await baseQuery.where(eq(buildingCodeSections.jurisdiction, jurisdiction));
    }
    
    return await baseQuery;
  }

  async createBuildingCodeSection(data: any): Promise<any> {
    const { buildingCodeSections } = await import("@shared/schema");
    const result = await db.insert(buildingCodeSections).values(data).returning();
    return result[0];
  }

  // AI Configuration methods
  async getAiConfigurations(projectId: string): Promise<AiConfiguration[]> {
    return await db.select().from(aiConfigurations).where(eq(aiConfigurations.projectId, projectId));
  }

  async getAiConfiguration(id: string): Promise<AiConfiguration | undefined> {
    const result = await db.select().from(aiConfigurations).where(eq(aiConfigurations.id, id));
    return result[0];
  }

  async createAiConfiguration(insertConfig: InsertAiConfiguration): Promise<AiConfiguration> {
    const result = await db.insert(aiConfigurations).values({
      ...insertConfig,
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning();
    return result[0];
  }

  async updateAiConfiguration(id: string, updateData: Partial<InsertAiConfiguration>): Promise<AiConfiguration | undefined> {
    const result = await db.update(aiConfigurations)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(aiConfigurations.id, id))
      .returning();
    return result[0];
  }

  async deleteAiConfiguration(id: string): Promise<boolean> {
    const result = await db.delete(aiConfigurations).where(eq(aiConfigurations.id, id));
    return result.length > 0;
  }

  // Processing Job methods
  async getProcessingJobs(documentId?: string): Promise<ProcessingJob[]> {
    if (documentId) {
      return await db.select().from(processingJobs).where(eq(processingJobs.documentId, documentId));
    }
    return await db.select().from(processingJobs);
  }

  async getProcessingJob(id: string): Promise<ProcessingJob | undefined> {
    const result = await db.select().from(processingJobs).where(eq(processingJobs.id, id));
    return result[0];
  }

  async createProcessingJob(insertJob: InsertProcessingJob): Promise<ProcessingJob> {
    const result = await db.insert(processingJobs).values({
      ...insertJob,
      createdAt: new Date()
    }).returning();
    return result[0];
  }

  async updateProcessingJob(id: string, updateData: Partial<InsertProcessingJob>): Promise<ProcessingJob | undefined> {
    const result = await db.update(processingJobs)
      .set(updateData)
      .where(eq(processingJobs.id, id))
      .returning();
    return result[0];
  }

  async deleteProcessingJob(id: string): Promise<boolean> {
    const result = await db.delete(processingJobs).where(eq(processingJobs.id, id));
    return result.length > 0;
  }

  // BIM Models methods
  async getBimModels(projectId: string): Promise<BimModel[]> {
    // Always return models sorted by most recent first
    const models = await db.select().from(bimModels)
      .where(eq(bimModels.projectId, projectId))
      .orderBy(desc(bimModels.createdAt));
    
    // Clean up old incomplete models (keep only last 3)
    if (models.length > 3) {
      const oldModels = models.slice(3).filter(m => m.status !== 'completed');
      for (const old of oldModels) {
        await this.deleteBimModel(old.id);
      }
    }
    
    return models.slice(0, 3); // Return only the 3 most recent
  }

  async getBimModel(id: string): Promise<BimModel | undefined> {
    const result = await db.select().from(bimModels).where(eq(bimModels.id, id));
    return result[0];
  }

  async createBimModel(insertModel: InsertBimModel): Promise<BimModel> {
    const result = await db.insert(bimModels).values({
      ...insertModel,
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning();
    return result[0];
  }

  async updateBimModel(id: string, updateData: Partial<InsertBimModel>): Promise<BimModel | undefined> {
    const result = await db.update(bimModels)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(bimModels.id, id))
      .returning();
    return result[0];
  }

  // Status update methods for model-status service
  async updateBimModelStatus(modelId: string, patch: { status?: string; progress?: number; message?: string; error?: string }) {
    const model = await this.getBimModel(modelId);
    if (!model) return null;

    // Update model with status fields, storing progress/message in metadata
    const currentMetadata = typeof model.metadata === 'string' ? JSON.parse(model.metadata) : (model.metadata || {});
    const updatedMetadata = {
      ...currentMetadata,
      progress: typeof patch.progress === 'number' ? patch.progress : currentMetadata.progress,
      lastMessage: patch.message !== undefined ? patch.message : currentMetadata.lastMessage,
      lastError: patch.error !== undefined ? patch.error : currentMetadata.lastError,
      _updatedAt: new Date().toISOString()
    };

    const result = await db.update(bimModels)
      .set({ 
        status: patch.status || model.status,
        metadata: JSON.stringify(updatedMetadata),
        updatedAt: new Date() 
      })
      .where(eq(bimModels.id, modelId))
      .returning();
    
    return result[0] || null;
  }

  async deleteBimModel(id: string): Promise<boolean> {
    // With CASCADE DELETE in schema, this will automatically delete all elements
    const result = await db.delete(bimModels).where(eq(bimModels.id, id));
    return (result as any).rowCount > 0;
  }

  // S-04: BOQ Versions — real DB query, no mock data
  async getBoqVersions(projectId: string): Promise<any[]> {
    return await db
      .select()
      .from(boqVersions)
      .where(eq(boqVersions.projectId, projectId))
      .orderBy(desc(boqVersions.createdAt));
  }

  // S-14: BOQ Versions full CRUD
  async getBoqVersion(id: string): Promise<any | undefined> {
    const result = await db.select().from(boqVersions).where(eq(boqVersions.id, id));
    return result[0];
  }

  async createBoqVersion(data: Record<string, unknown>): Promise<any> {
    const result = await db.insert(boqVersions).values(data as any).returning();
    return result[0];
  }

  async updateBoqVersion(id: string, data: Record<string, unknown>): Promise<any | undefined> {
    const result = await db.update(boqVersions).set(data as any).where(eq(boqVersions.id, id)).returning();
    return result[0];
  }

  async deleteBoqVersion(id: string): Promise<boolean> {
    const result = await db.delete(boqVersions).where(eq(boqVersions.id, id));
    return (result as any).rowCount > 0;
  }

  // S-14: RFIs full CRUD
  async getRfis(projectId: string): Promise<Rfi[]> {
    return await db
      .select()
      .from(rfis)
      .where(eq(rfis.projectId, projectId))
      .orderBy(desc(rfis.createdAt));
  }

  async getRfi(id: string): Promise<Rfi | undefined> {
    const result = await db.select().from(rfis).where(eq(rfis.id, id));
    return result[0];
  }

  async createRfi(data: InsertRfi): Promise<Rfi> {
    const result = await db.insert(rfis).values(data).returning();
    return result[0];
  }

  async updateRfi(id: string, data: Partial<InsertRfi>): Promise<Rfi | undefined> {
    const result = await db
      .update(rfis)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(rfis.id, id))
      .returning();
    return result[0];
  }

  async deleteRfi(id: string): Promise<boolean> {
    const result = await db.delete(rfis).where(eq(rfis.id, id));
    return (result as any).rowCount > 0;
  }

  // S-14: RFI Responses
  async getRfiResponses(rfiId: string): Promise<RfiResponse[]> {
    return await db
      .select()
      .from(rfiResponses)
      .where(eq(rfiResponses.rfiId, rfiId))
      .orderBy(desc(rfiResponses.createdAt));
  }

  async createRfiResponse(data: InsertRfiResponse): Promise<RfiResponse> {
    const result = await db.insert(rfiResponses).values(data).returning();
    return result[0];
  }

  // S-14: Change Requests full CRUD
  async getChangeRequests(projectId: string): Promise<ChangeRequest[]> {
    return await db
      .select()
      .from(changeRequests)
      .where(eq(changeRequests.projectId, projectId))
      .orderBy(desc(changeRequests.createdAt));
  }

  async getChangeRequest(id: string): Promise<ChangeRequest | undefined> {
    const result = await db.select().from(changeRequests).where(eq(changeRequests.id, id));
    return result[0];
  }

  async createChangeRequest(data: InsertChangeRequest): Promise<ChangeRequest> {
    const result = await db.insert(changeRequests).values(data).returning();
    return result[0];
  }

  async updateChangeRequest(id: string, data: Partial<InsertChangeRequest>): Promise<ChangeRequest | undefined> {
    const result = await db
      .update(changeRequests)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(changeRequests.id, id))
      .returning();
    return result[0];
  }

  async deleteChangeRequest(id: string): Promise<boolean> {
    const result = await db.delete(changeRequests).where(eq(changeRequests.id, id));
    return (result as any).rowCount > 0;
  }

  // S-07: BIM model field patch — thin wrapper over updateBimModel
  // Called by model-status.ts; previously guarded by typeof check and silently no-opd
  async updateBimModelFields(
    modelId: string,
    patch: Record<string, unknown>
  ): Promise<BimModel | undefined> {
    return this.updateBimModel(modelId, patch as Partial<InsertBimModel>);
  }

  // S-07: BIM model metadata merge — merges new metadata into existing JSON blob
  // Called by model-status.ts; previously guarded by typeof check and silently no-opd
  async updateBimModelMetadata(
    modelId: string,
    metadata: Record<string, unknown>
  ): Promise<BimModel | undefined> {
    const model = await this.getBimModel(modelId);
    if (!model) {
      logger.warn(`updateBimModelMetadata: model ${modelId} not found`);
      return undefined;
    }
    const current =
      typeof model.metadata === "string"
        ? JSON.parse(model.metadata)
        : (model.metadata ?? {});
    const merged = { ...current, ...metadata, _updatedAt: new Date().toISOString() };
    return this.updateBimModel(modelId, { metadata: JSON.stringify(merged) } as Partial<InsertBimModel>);
  }

  // BIM Elements methods
  async getBimElements(modelId: string): Promise<BimElement[]> {
    return await db.select().from(bimElements).where(eq(bimElements.modelId, modelId));
  }

  async getBimElementsByStorey(modelId: string, storeyName: string): Promise<BimElement[]> {
    return await db.select().from(bimElements).where(
      and(eq(bimElements.modelId, modelId), eq(bimElements.storeyName, storeyName))
    );
  }

  async getAllBimElements(): Promise<BimElement[]> {
    return await db.select().from(bimElements).limit(50000);
  }

  async getBimElement(id: string): Promise<BimElement | undefined> {
    const result = await db.select().from(bimElements).where(eq(bimElements.id, id));
    return result[0];
  }

  async createBimElement(insertElement: InsertBimElement): Promise<BimElement> {
    // 🛡️ COORDINATE VALIDATION: Reject elements with invalid positioning data
    if (insertElement.geometry && typeof insertElement.geometry === 'object') {
      const geometry = insertElement.geometry as any;
      if (geometry.location) {
        const { x, y, z } = geometry.location;
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
          logger.error(`Rejected BIM element ${insertElement.name}: Invalid coordinates (${x}, ${y}, ${z})`);
          throw new Error(`Cannot store BIM element with invalid coordinates: ${insertElement.name}`);
        }
      }
    }
    
    const result = await db.insert(bimElements).values({
      ...insertElement,
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning();
    return result[0];
  }

  async upsertBimElements(modelId: string, elements: any[]): Promise<void> {
    // 🚀 BATCH DELETE: Clear existing elements efficiently
    await db.delete(bimElements).where(eq(bimElements.modelId, modelId));
    
    // 🚀 BATCH INSERT: Process elements in batches for better performance
    const batchSize = 100;
    for (let i = 0; i < elements.length; i += batchSize) {
      const batch = elements.slice(i, i + batchSize);
      const insertElements: InsertBimElement[] = [];
      
      for (const element of batch) {
        const insertElement: InsertBimElement = {
          elementId: element.id || element.elementId || `elem_${Date.now()}_${new PRNG(`${modelId}_${Date.now()}`).next().toString(36).substring(2, 8)}`,
          modelId,
          elementType: element.type || element.elementType || "unknown",
          // Normalise MEP sub-disciplines to canonical 'MEP' for DB storage
          category: (() => {
            const c = element.category;
            if (c === 'Mechanical' || c === 'Electrical' || c === 'Plumbing') return 'MEP';
            return c;
          })(),
          name: element.name,
          geometry: element.geometry,
          properties: typeof element.properties === 'string' ? element.properties : JSON.stringify(element.properties || {}),
          location: typeof element.location === 'string' ? element.location : JSON.stringify(element.location || {}),
          // ✅ FIX: Use 'material' field, not 'materials' (schema mismatch)
          material: element.material || element.materials || null,
          // ✅ FIX: quantity must be a plain number for the decimal column — never pass an object
          quantity: (() => {
            const q = element.quantity;
            if (typeof q === 'number' && Number.isFinite(q)) return q;
            if (typeof q === 'string' && Number.isFinite(Number(q))) return Number(q);
            return null;
          })(),
          storeyGuid: element.storey?.guid || element.storeyGuid,
          // ── storeyName: written to enable direct relational queries ──────────
          // Source priority: element.storey.name → element.storeyName → element.properties.storey.name
          storeyName: element.storey?.name || element.storeyName || element.properties?.storey?.name || null,
          elevation: (() => {
            const e = element.storey?.elevation ?? element.elevation ?? null;
            if (e === null || e === undefined) return null;
            const n = Number(e);
            return Number.isFinite(n) ? n : null;
          })(),
          quantityMetric: (() => {
            const v = element.quantities?.metric?.find((q: any) => q.type === 'volume')?.value;
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
          })(),
          unit: (() => {
            const v = element.quantities?.metric?.find((q: any) => q.type === 'area')?.value;
            return v != null ? String(v) : '0';
          })(),
          quantityImperial: (() => {
            const v = element.quantities?.imperial?.find((q: any) => q.type === 'volume')?.value;
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
          })(),
          // ── RFI / Attention flags (v15) ──────────────────────────────────────
          // Read from element.properties (set by createDoorElement / createWallElement / etc.)
          // or directly from element root for forward-compat
          rfiFlag:        !!(element.properties?.rfi_flag         || element.rfiFlag         || false),
          needsAttention: !!(element.properties?.needs_attention  || element.needsAttention  || false),
          attentionReason:   element.properties?.attention_reason ?? element.attentionReason ?? null,
          // ─────────────────────────────────────────────────────────────────────
        };
        insertElements.push(insertElement);
      }
      
      // 🚀 BATCH INSERT: Insert all elements in this batch at once
      // v15.13b: Sanitize geometry coordinates — NaN/Infinity → 0 so DB insert never fails
      // v15.31: Clamp all decimal(10,3) fields to ±9,999,999.999 to prevent numeric overflow
      //         (volumes in mm³ can exceed 10^9; quantities are also susceptible).
      const DECIMAL_MAX = 9_999_999.999;
      const clampDecimal = (v: any): number | null => {
        if (v === null || v === undefined) return null;
        const n = Number(v);
        if (!Number.isFinite(n)) return null;
        return Math.max(-DECIMAL_MAX, Math.min(DECIMAL_MAX, n));
      };
      if (insertElements.length > 0) {
        const sanitize = (v: any) => {
          const n = Number(v);
          return Number.isFinite(n) ? n : 0;
        };
        const sanitizeGeom = (geom: any) => {
          if (!geom) return geom;
          const g = typeof geom === 'string' ? (() => { try { return JSON.parse(geom); } catch { return {}; } })() : geom;
          if (g?.location?.realLocation) {
            g.location.realLocation.x = sanitize(g.location.realLocation.x);
            g.location.realLocation.y = sanitize(g.location.realLocation.y);
            g.location.realLocation.z = sanitize(g.location.realLocation.z);
          }
          return g;
        };
        await db.insert(bimElements).values(insertElements.map(el => ({
          ...el,
          geometry: sanitizeGeom(el.geometry),
          // Clamp all decimal(10,3) fields — never let overflow reach the DB
          quantity:        clampDecimal(el.quantity),
          elevation:       clampDecimal(el.elevation),
          quantityMetric:  clampDecimal(el.quantityMetric),
          quantityImperial: clampDecimal(el.quantityImperial),
          createdAt: new Date(),
          updatedAt: new Date()
        })));
      }
    }
  }

  async updateBimElement(id: string, updateData: Partial<InsertBimElement>): Promise<BimElement | undefined> {
    const result = await db.update(bimElements)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(bimElements.id, id))
      .returning();
    return result[0];
  }

  async deleteBimElement(id: string): Promise<boolean> {
    const result = await db.delete(bimElements).where(eq(bimElements.id, id));
    return result.length > 0;
  }

  /**
   * Insert the confirmed 47 gridlines (28 alpha + 19 numeric) into the 10-table grid
   * hierarchy.  Coordinates are derived from the element bounding box of the model so
   * no values are hard-coded; if the model has no elements yet a 1 m fallback spacing
   * is used and the function returns a `sparse` flag so the caller can retry later.
   *
   * Idempotent: if a detection run for the same model already exists it is deleted
   * and rebuilt from scratch.
   */
  async saveConfirmedGridlines(
    modelId: string,
    sourceDocId: string,
    projectId: string,
    alphaLabels: string[],
    numericLabels: string[],
  ): Promise<{ runId: string; axisCount: number; sparse: boolean }> {
    const MARGIN = 2;

    // ── 1. Derive coordinate space from existing elements ──────────────────
    const elements = await db.select().from(bimElements).where(eq(bimElements.modelId, modelId));

    let xMin = 0, xMax = 0, yMin = 0, yMax = 0;
    let sparse = true;

    if (elements.length > 0) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const el of elements) {
        const geom = el.geometry as any;
        const loc = geom?.location?.realLocation ?? geom?.location;
        if (loc && typeof loc.x === 'number' && typeof loc.y === 'number' && Number.isFinite(loc.x) && Number.isFinite(loc.y)) {
          xs.push(loc.x);
          ys.push(loc.y);
        }
      }
      if (xs.length >= 2 && ys.length >= 2) {
        xMin = Math.min(...xs);
        xMax = Math.max(...xs);
        yMin = Math.min(...ys);
        yMax = Math.max(...ys);
        sparse = xMax - xMin < 0.01 || yMax - yMin < 0.01;
      }
    }

    if (sparse) {
      // Fall back to normalised 1 m spacing so records can still be created
      xMin = 0; xMax = Math.max(1, numericLabels.length - 1);
      yMin = 0; yMax = Math.max(1, alphaLabels.length - 1);
    }

    const totalX = xMax - xMin;
    const totalY = yMax - yMin;

    // ── 2. Purge any prior confirmed run for this model ─────────────────────
    // detection runs are project-scoped; find by the notes prefix we stamp on insert
    await db.delete(gridDetectionRuns).where(
      and(
        eq(gridDetectionRuns.projectId, projectId),
        like(gridDetectionRuns.notes, `confirmed-gridlines:${modelId}%`)
      )
    );

    // ── 3. Detection run ────────────────────────────────────────────────────
    const now = new Date();
    const [run] = await db.insert(gridDetectionRuns).values({
      projectId,
      sourceFileId: sourceDocId,
      inputType: 'PDF_VECTOR',
      parameters: {},
      toolVersions: { detectorVersion: 'confirmed-v1' },
      status: 'SUCCESS',
      startedAt: now,
      finishedAt: now,
      triggeredBy: 'manual',
      notes: `confirmed-gridlines:${modelId} — user-verified ${alphaLabels.length} alpha + ${numericLabels.length} numeric`,
    }).returning();

    // ── 4. Grid component ────────────────────────────────────────────────────
    const [component] = await db.insert(gridComponents).values({
      runId: run.id,
      name: 'Main Grid — The Moorings',
      bboxMinX: String(xMin - MARGIN),
      bboxMinY: String(yMin - MARGIN),
      bboxMaxX: String(xMax + MARGIN),
      bboxMaxY: String(yMax + MARGIN),
      primaryFrame: 'MODEL',
      confidence: '1.000',
    }).returning();

    // ── 5. Grid families ────────────────────────────────────────────────────
    // Alpha family: lines run parallel to Y-axis (vertical lines in plan)
    //   theta = 90°, direction = (0, 1), normal = (1, 0)
    //   offsetD = x-position of the line
    const [alphaFamily] = await db.insert(gridFamilies).values({
      componentId: component.id,
      thetaDeg: '90.0000',
      directionVecX: '0.00000000',
      directionVecY: '1.00000000',
      normalVecX: '1.00000000',
      normalVecY: '0.00000000',
      familyRank: 1,
      confidence: '1.000',
    }).returning();

    // Numeric family: lines run parallel to X-axis (horizontal lines in plan)
    //   theta = 0°, direction = (1, 0), normal = (0, 1)
    //   offsetD = y-position of the line
    const [numericFamily] = await db.insert(gridFamilies).values({
      componentId: component.id,
      thetaDeg: '0.0000',
      directionVecX: '1.00000000',
      directionVecY: '0.00000000',
      normalVecX: '0.00000000',
      normalVecY: '1.00000000',
      familyRank: 2,
      confidence: '1.000',
    }).returning();

    // ── 6. Axes + labels + axis-labels ──────────────────────────────────────
    let axisCount = 0;

    // Alpha axes: evenly spaced along X
    const alphaStep = alphaLabels.length > 1 ? totalX / (alphaLabels.length - 1) : 0;
    for (let i = 0; i < alphaLabels.length; i++) {
      const label = alphaLabels[i];
      const offsetD = xMin + i * alphaStep;
      const [axis] = await db.insert(gridAxes).values({
        familyId: alphaFamily.id,
        geometryType: 'LINE',
        p0X: String(offsetD),
        p0Y: String(yMin - MARGIN),
        p1X: String(offsetD),
        p1Y: String(yMax + MARGIN),
        offsetD: String(offsetD),
        extentMinT: '0',
        extentMaxT: String(yMax - yMin + 2 * MARGIN),
        totalMergedLength: String(yMax - yMin + 2 * MARGIN),
        confidence: '1.000',
        status: 'CONFIRMED',
      }).returning();

      const [gridLabel] = await db.insert(gridLabels).values({
        rawText: label,
        normText: label.toUpperCase(),
        textSource: 'VECTOR_TEXT',
        textConfidence: '1.000',
        bbox: { minX: offsetD - 0.5, minY: yMax + MARGIN, maxX: offsetD + 0.5, maxY: yMax + MARGIN + 1 },
        evidenceFileId: sourceDocId,
      }).returning();

      await db.insert(gridAxisLabels).values({
        axisId: axis.id,
        labelId: gridLabel.id,
        scoreTotal: '1.000',
        scoreBreakdown: { endpointProximity: 1, perpendicularDistance: 1, directionalAlignment: 1, markerSupport: 1, textQuality: 1 },
        associationType: 'END_LABEL',
        status: 'CONFIRMED',
      });

      axisCount++;
    }

    // Numeric axes: evenly spaced along Y
    const numericStep = numericLabels.length > 1 ? totalY / (numericLabels.length - 1) : 0;
    for (let j = 0; j < numericLabels.length; j++) {
      const label = numericLabels[j];
      const offsetD = yMin + j * numericStep;
      const [axis] = await db.insert(gridAxes).values({
        familyId: numericFamily.id,
        geometryType: 'LINE',
        p0X: String(xMin - MARGIN),
        p0Y: String(offsetD),
        p1X: String(xMax + MARGIN),
        p1Y: String(offsetD),
        offsetD: String(offsetD),
        extentMinT: '0',
        extentMaxT: String(xMax - xMin + 2 * MARGIN),
        totalMergedLength: String(xMax - xMin + 2 * MARGIN),
        confidence: '1.000',
        status: 'CONFIRMED',
      }).returning();

      const [gridLabel] = await db.insert(gridLabels).values({
        rawText: label,
        normText: label.toUpperCase(),
        textSource: 'VECTOR_TEXT',
        textConfidence: '1.000',
        bbox: { minX: xMin - MARGIN - 1, minY: offsetD - 0.5, maxX: xMin - MARGIN, maxY: offsetD + 0.5 },
        evidenceFileId: sourceDocId,
      }).returning();

      await db.insert(gridAxisLabels).values({
        axisId: axis.id,
        labelId: gridLabel.id,
        scoreTotal: '1.000',
        scoreBreakdown: { endpointProximity: 1, perpendicularDistance: 1, directionalAlignment: 1, markerSupport: 1, textQuality: 1 },
        associationType: 'END_LABEL',
        status: 'CONFIRMED',
      });

      axisCount++;
    }

    return { runId: run.id, axisCount, sparse };
  }

  // BIM Element Classifications
  async getBimElementClassifications(elementId: string): Promise<BimElementClassification[]> {
    return await db.select().from(bimElementClassifications).where(eq(bimElementClassifications.elementId, elementId));
  }
  
  async createBimElementClassification(classification: InsertBimElementClassification): Promise<BimElementClassification> {
    const result = await db.insert(bimElementClassifications).values({
      ...classification,
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning();
    return result[0];
  }
  
  async updateBimElementClassification(id: string, updateData: Partial<InsertBimElementClassification>): Promise<BimElementClassification | undefined> {
    const result = await db.update(bimElementClassifications)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(bimElementClassifications.id, id))
      .returning();
    return result[0];
  }

  // Analysis Result methods
  async getAnalysisResult(id: string): Promise<AnalysisResult | undefined> {
    const result = await db.select().from(analysisResults).where(eq(analysisResults.id, id));
    return result[0];
  }

  async getLatestAnalysisResult(projectId: string, analysisType: string): Promise<AnalysisResult | null> {
    // ✅ FIX: Use 'and()' for multiple conditions, not multiple .where() calls
    const { and } = await import("drizzle-orm");
    const result = await db.select()
      .from(analysisResults)
      .where(and(
        eq(analysisResults.projectId, projectId),
        eq(analysisResults.analysisType, analysisType)
      ))
      .orderBy(analysisResults.createdAt)
      .limit(1);
    return result[0] || null;
  }

  async getAnalysisHistory(projectId: string, analysisType: string): Promise<AnalysisResult[]> {
    // ✅ FIX: Use 'and()' for multiple conditions, not multiple .where() calls
    const { and } = await import("drizzle-orm");
    return await db.select()
      .from(analysisResults)
      .where(and(
        eq(analysisResults.projectId, projectId),
        eq(analysisResults.analysisType, analysisType)
      ))
      .orderBy(analysisResults.createdAt);
  }

  async createAnalysisResult(analysisResult: InsertAnalysisResult): Promise<AnalysisResult> {
    const result = await db.insert(analysisResults).values(analysisResult).returning();
    return result[0];
  }

  async updateAnalysisResult(id: string, analysisResult: Partial<AnalysisResult>): Promise<AnalysisResult | undefined> {
    const result = await db.update(analysisResults)
      .set(analysisResult)
      .where(eq(analysisResults.id, id))
      .returning();
    return result[0];
  }

  async deleteAnalysisResult(id: string): Promise<boolean> {
    const result = await db.delete(analysisResults).where(eq(analysisResults.id, id));
    return (result as any).rowCount > 0;
  }

  // Document Hash methods
  async getDocumentHash(documentId: string): Promise<DocumentHash | undefined> {
    const result = await db.select().from(documentHashes).where(eq(documentHashes.documentId, documentId));
    return result[0];
  }

  async upsertDocumentHash(documentHash: InsertDocumentHash): Promise<DocumentHash> {
    const existing = await this.getDocumentHash(documentHash.documentId);
    if (existing) {
      const result = await db.update(documentHashes)
        .set(documentHash)
        .where(eq(documentHashes.documentId, documentHash.documentId))
        .returning();
      return result[0];
    } else {
      const result = await db.insert(documentHashes).values(documentHash).returning();
      return result[0];
    }
  }

  async getDocumentHashes(documentIds: string[]): Promise<DocumentHash[]> {
    if (documentIds.length === 0) return [];
    return await db.select().from(documentHashes).where(inArray(documentHashes.documentId, documentIds));
  }

  // Project Document methods
  async getProjectDocuments(projectId: string): Promise<Document[]> {
    return this.getDocuments(projectId);
  }

  // Document approval workflow methods
  async getDocumentRevisions(documentSetId: string): Promise<Document[]> {
    return await db.select().from(documents).where(eq(documents.projectId, documentSetId));
  }

  async approveDocument(documentId: string, _userId: string): Promise<Document | undefined> {
    return await this.updateDocument(documentId, { analysisStatus: 'Approved' });
  }

  async rejectDocument(documentId: string, _userId: string, _reason: string): Promise<Document | undefined> {
    return await this.updateDocument(documentId, { analysisStatus: 'Rejected' });
  }

  async updateDocumentReviewStatus(documentId: string, status: string, _userId: string): Promise<Document | undefined> {
    return await this.updateDocument(documentId, { analysisStatus: status });
  }

  // 🔍 BOQ-BIM Validation Methods (DB Implementation)
  async createValidationResult(result: any): Promise<any> {
    try {
      // Store validation result in analysisResults table
      const validationData = {
        projectId: result.projectId,
        analysisType: 'boq_bim_validation',
        revisionId: result.revisionId || randomUUID(),
        analysisData: result,
        documentCount: result.documentCount || 1,
        overallScore: result.confidence || 0.8,
        metadata: {
          validationType: result.validationType || 'standard',
          elementsValidated: result.elementsValidated || 0,
          issuesFound: result.issuesFound || 0
        }
      };
      
      const [savedResult] = await db.insert(analysisResults).values(validationData).returning();
      logger.info('Stored validation result', { projectId: result.projectId, resultId: savedResult.id });
      return savedResult;
    } catch (error) {
      logger.error('Failed to store validation result', { error, projectId: result.projectId });
      throw error;
    }
  }

  async createBoqBimMapping(mapping: any): Promise<any> {
    try {
      // Store BOQ-BIM mapping in analysisResults table with specific type
      const mappingData = {
        projectId: mapping.projectId,
        analysisType: 'boq_bim_mapping',
        revisionId: mapping.revisionId || randomUUID(),
        analysisData: mapping,
        documentCount: mapping.documentCount || 1,
        overallScore: mapping.confidence || 0.9,
        metadata: {
          boqItems: mapping.boqItems || 0,
          bimElements: mapping.bimElements || 0,
          mappedItems: mapping.mappedItems || 0,
          mappingAccuracy: mapping.mappingAccuracy || 0
        }
      };
      
      const [savedMapping] = await db.insert(analysisResults).values(mappingData).returning();
      logger.info('Stored BOQ-BIM mapping', { projectId: mapping.projectId, mappingId: savedMapping.id });
      return savedMapping;
    } catch (error) {
      logger.error('Failed to store BOQ-BIM mapping', { error, projectId: mapping.projectId });
      throw error;
    }
  }

  async getValidationResults(projectId: string): Promise<any[]> {
    try {
      const results = await db
        .select()
        .from(analysisResults)
        .where(
          and(
            eq(analysisResults.projectId, projectId),
            eq(analysisResults.analysisType, 'boq_bim_validation')
          )
        )
        .orderBy(desc(analysisResults.createdAt));
      
      logger.debug('Retrieved validation results', { projectId, count: results.length });
      return results;
    } catch (error) {
      logger.error('Failed to fetch validation results', { error, projectId });
      return [];
    }
  }

  async getBoqBimMappings(projectId: string): Promise<any[]> {
    try {
      const mappings = await db
        .select()
        .from(analysisResults)
        .where(
          and(
            eq(analysisResults.projectId, projectId),
            eq(analysisResults.analysisType, 'boq_bim_mapping')
          )
        )
        .orderBy(desc(analysisResults.createdAt));
      
      logger.debug('Retrieved BOQ-BIM mappings', { projectId, count: mappings.length });
      return mappings;
    } catch (error) {
      logger.error('Failed to fetch BOQ-BIM mappings', { error, projectId });
      return [];
    }
  }
  // 🛠️ Product Catalog Operations
  async getProductsByCsiDivision(csiDivision: string): Promise<ProductCatalog[]> {
    return await db
      .select()
      .from(productCatalog)
      .where(eq(productCatalog.csiDivision, csiDivision));
  }

  async getProductsByAssembly(assemblyReference: string): Promise<ProductCatalog[]> {
    return await db
      .select()
      .from(productCatalog)
      .where(eq(productCatalog.assemblyReference, assemblyReference));
  }

  async getProduct(id: string): Promise<ProductCatalog | undefined> {
    const [product] = await db
      .select()
      .from(productCatalog)
      .where(eq(productCatalog.id, id));
    return product;
  }

  async createProduct(product: InsertProductCatalog): Promise<ProductCatalog> {
    const [newProduct] = await db
      .insert(productCatalog)
      .values(product)
      .returning();
    return newProduct;
  }

  async upsertProductsFromClaude(products: InsertProductCatalog[]): Promise<void> {
    for (const product of products) {
      await db
        .insert(productCatalog)
        .values(product)
        .onConflictDoNothing();
    }
  }

  // 🎯 Element Product Selection Operations
  async getElementProductSelection(bimElementId: string): Promise<ElementProductSelection | undefined> {
    const [selection] = await db
      .select()
      .from(elementProductSelections)
      .where(eq(elementProductSelections.bimElementId, bimElementId));
    return selection;
  }

  async setElementProductSelection(selection: InsertElementProductSelection): Promise<ElementProductSelection> {
    const [newSelection] = await db
      .insert(elementProductSelections)
      .values(selection)
      .onConflictDoUpdate({
        target: elementProductSelections.bimElementId,
        set: {
          productId: selection.productId,
          selectionType: selection.selectionType,
          customProductName: selection.customProductName,
          customUnitCost: selection.customUnitCost,
          customSpecifications: selection.customSpecifications,
          selectionReason: selection.selectionReason,
          selectionNotes: selection.selectionNotes,
          updatedAt: new Date(),
        },
      })
      .returning();
    return newSelection;
  }

  async updateElementCustomCost(bimElementId: string, customCost: number, customProductName?: string): Promise<ElementProductSelection> {
    const [updatedSelection] = await db
      .insert(elementProductSelections)
      .values({
        bimElementId,
        selectionType: "custom_cost" as const,
        customUnitCost: customCost.toString(),
        customProductName: customProductName || null,
      })
      .onConflictDoUpdate({
        target: elementProductSelections.bimElementId,
        set: {
          selectionType: "custom_cost" as const,
          customUnitCost: customCost.toString(),
          customProductName: customProductName || null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return updatedSelection;
  }

  async getProjectProductSelections(projectId: string): Promise<ElementProductSelection[]> {
    const results = await db
      .select({
        id: elementProductSelections.id,
        createdAt: elementProductSelections.createdAt,
        updatedAt: elementProductSelections.updatedAt,
        bimElementId: elementProductSelections.bimElementId,
        productId: elementProductSelections.productId,
        selectionType: elementProductSelections.selectionType,
        customProductName: elementProductSelections.customProductName,
        customUnitCost: elementProductSelections.customUnitCost,
        customSpecifications: elementProductSelections.customSpecifications,
        selectionReason: elementProductSelections.selectionReason,
        selectionNotes: elementProductSelections.selectionNotes,
        selectedByUser: elementProductSelections.selectedByUser
      })
      .from(elementProductSelections)
      .innerJoin(bimElements, eq(elementProductSelections.bimElementId, bimElements.id))
      .innerJoin(bimModels, eq(bimElements.modelId, bimModels.id))
      .where(eq(bimModels.projectId, projectId));
    return results;
  }

  // ── Phase 2 stubs — referenced by routes, implementations pending ─────────
  // These methods are called by export/report routes but are not yet
  // implemented. They return empty/null safely so routes degrade gracefully.

  async getEstimateByProject(_projectId: string): Promise<any | null> {
    return null; // Phase 2: full estimate persistence
  }

  async getClashResults(_modelId: string): Promise<any[]> {
    return []; // Phase 2: clash detection results
  }

  async getConstructabilityAnalysis(_projectId: string): Promise<any | null> {
    return null; // Phase 2: constructability analysis
  }

  async getMonteCarloResult(_projectId: string): Promise<any | null> {
    return null; // Phase 2: Monte Carlo simulation results
  }

  // Legacy stub alias — used by export-routes.ts; returns latest confirmed sequence
  async getSequencingModel(projectId: string): Promise<any | null> {
    return this.getLatestConstructionSequence(projectId, undefined);
  }

  // ── Construction Sequence CRUD ────────────────────────────────────────────

  async createConstructionSequence(data: InsertConstructionSequence): Promise<ConstructionSequenceRow> {
    const [row] = await db
      .insert(constructionSequences)
      .values({ ...data, id: randomUUID() })
      .returning();
    return row;
  }

  async getConstructionSequence(id: string): Promise<ConstructionSequenceRow | null> {
    const [row] = await db
      .select()
      .from(constructionSequences)
      .where(eq(constructionSequences.id, id))
      .limit(1);
    return row ?? null;
  }

  async getLatestConstructionSequence(
    projectId: string,
    modelId?: string,
  ): Promise<ConstructionSequenceRow | null> {
    const conditions = modelId
      ? and(
          eq(constructionSequences.projectId, projectId),
          eq(constructionSequences.modelId, modelId),
        )
      : eq(constructionSequences.projectId, projectId);

    const [row] = await db
      .select()
      .from(constructionSequences)
      .where(conditions)
      .orderBy(desc(constructionSequences.createdAt))
      .limit(1);
    return row ?? null;
  }

  async confirmConstructionSequence(
    id: string,
    patch: {
      confirmedData: any;
      confirmedBy:   string;
      confirmedAt:   Date;
      qsNotes:       string | null;
      status:        string;
    },
  ): Promise<ConstructionSequenceRow> {
    const [row] = await db
      .update(constructionSequences)
      .set({
        confirmedData: patch.confirmedData,
        confirmedBy:   patch.confirmedBy,
        confirmedAt:   patch.confirmedAt,
        qsNotes:       patch.qsNotes,
        status:        patch.status,
        updatedAt:     new Date(),
      })
      .where(eq(constructionSequences.id, id))
      .returning();
    return row;
  }

  async updateSequenceExport(
    id: string,
    patch: { lastExportedAt: Date; lastExportFormat: string; status?: string },
  ): Promise<void> {
    await db
      .update(constructionSequences)
      .set({
        lastExportedAt:   patch.lastExportedAt,
        lastExportFormat: patch.lastExportFormat,
        ...(patch.status ? { status: patch.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(constructionSequences.id, id));
  }

  async deleteConstructionSequence(id: string): Promise<void> {
    await db
      .delete(constructionSequences)
      .where(eq(constructionSequences.id, id));
  }

  async getProjectGaps(_projectId: string): Promise<any[]> {
    return []; // Phase 2: gap analysis results
  }

  async getProcessingJobsByDocument(documentId: string): Promise<any[]> {
    return this.getProcessingJobs(documentId);
  }

  // ── BIM Storeys — first-class relational store ──────────────────────────────
  
  async getBimStoreys(modelId: string): Promise<BimStorey[]> {
    // Returns all storeys for a model, sorted by elevation ascending (lowest floor first).
    // This is the canonical read path — no blob parsing, no defaults.
    const rows = await db
      .select()
      .from(bimStoreys)
      .where(eq(bimStoreys.modelId, modelId))
      .orderBy(bimStoreys.sortOrder);
    return rows;
  }

  async upsertBimStoreys(modelId: string, storeys: any[]): Promise<void> {
    if (!storeys || storeys.length === 0) return;

    // Delete existing storeys for this model then batch-insert.
    // This is safe because upsertBimElements runs first and elements keep their
    // storeyName strings — we are only rebuilding the index table.
    await db.delete(bimStoreys).where(eq(bimStoreys.modelId, modelId));

    // Normalise and sort by elevation so sortOrder is stable
    const normalised = storeys
      .map((s: any) => ({
        name:               String(s.name || s.level || 'Unknown'),
        elevation:          Number(s.elevation ?? 0),
        ceilingHeight:      s.ceilingHeight ?? s.ceiling_height ?? null,
        floorToFloorHeight: s.floorToFloorHeight ?? s.floor_to_floor_height_m ?? null,
        guid:               s.guid ?? null,
        // Normalise elevationSource from either camelCase or snake_case
        elevationSource:    s.elevationSource ?? s.elevation_source ?? 'extracted_from_drawings',
        rfiFlag:            !!(s.rfi_flag || s.rfiFlag || false),
        rfiId:              s.rfiId ?? s.rfi_id ?? null,
        elementCount:       Number(s.elementCount ?? 0),
      }))
      .sort((a, b) => a.elevation - b.elevation);

    const insertRows: InsertBimStorey[] = normalised.map((s, idx) => ({
      modelId,
      name:               s.name,
      elevation:          String(s.elevation),
      ceilingHeight:      s.ceilingHeight !== null ? String(s.ceilingHeight) : null,
      floorToFloorHeight: s.floorToFloorHeight !== null ? String(s.floorToFloorHeight) : null,
      guid:               s.guid,
      elevationSource:    s.elevationSource,
      rfiFlag:            s.rfiFlag,
      rfiId:              s.rfiId,
      elementCount:       s.elementCount,
      sortOrder:          idx,
    }));

    const batchSize = 50;
    for (let i = 0; i < insertRows.length; i += batchSize) {
      await db.insert(bimStoreys).values(
        insertRows.slice(i, i + batchSize).map(r => ({
          ...r, createdAt: new Date(), updatedAt: new Date()
        }))
      );
    }
  }

  async updateBimStoreyElementCount(modelId: string): Promise<void> {
    // Batch update: count elements per storey in one query, then update all storeys
    const counts = await db
      .select({
        storeyName: bimElements.storeyName,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(bimElements)
      .where(eq(bimElements.modelId, modelId))
      .groupBy(bimElements.storeyName);

    const countMap = new Map(counts.map(c => [c.storeyName, c.count]));
    const storeyRows = await this.getBimStoreys(modelId);
    const now = new Date();

    await Promise.all(
      storeyRows.map(storey =>
        db.update(bimStoreys)
          .set({ elementCount: countMap.get(storey.name) ?? 0, updatedAt: now })
          .where(and(eq(bimStoreys.modelId, modelId), eq(bimStoreys.name, storey.name)))
      )
    );
  }


  // ─── Notifications ──────────────────────────────────────────────────────

  async getNotifications(userId: string, limit = 50): Promise<any[]> {
    try {
      const { notifications } = await import("@shared/schema");
      const { desc, eq } = await import("drizzle-orm");
      return await db.select().from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(limit);
    } catch (e: any) {
      logger.warn("getNotifications:", e?.message);
      return [];
    }
  }

  async getUnreadNotificationCount(userId: string): Promise<number> {
    try {
      const { notifications } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const rows = await db.select().from(notifications)
        .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
      return rows.length;
    } catch { return 0; }
  }

  async createNotification(data: {
    userId: string; projectId?: string;
    type?: "bim_complete" | "estimate_ready" | "rfi_update" | "compliance_alert" | "document_processed" | "analysis_complete" | "system" | "mention";
    title: string; message: string; link?: string; metadata?: Record<string, unknown>;
  }): Promise<any> {
    const { notifications } = await import("@shared/schema");
    const result = await db.insert(notifications).values({
      userId: data.userId,
      projectId: data.projectId ?? null,
      type: data.type ?? "system",
      title: data.title,
      message: data.message,
      link: data.link ?? null,
      metadata: data.metadata ?? null,
      isRead: false,
    }).returning();
    return result[0];
  }

  async markNotificationRead(id: string, userId: string): Promise<boolean> {
    try {
      const { notifications } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      await db.update(notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
      return true;
    } catch { return false; }
  }

  async markAllNotificationsRead(userId: string): Promise<number> {
    try {
      const { notifications } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const rows = await db.update(notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
        .returning();
      return rows.length;
    } catch { return 0; }
  }

  async deleteNotification(id: string, userId: string): Promise<boolean> {
    try {
      const { notifications } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      await db.delete(notifications)
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
      return true;
    } catch { return false; }
  }

  // ─── System Alerts ──────────────────────────────────────────────────────

  async getSystemAlerts(onlyOpen = true, limit = 100): Promise<any[]> {
    try {
      const { systemAlerts } = await import("@shared/schema");
      const { desc, eq } = await import("drizzle-orm");
      const q = db.select().from(systemAlerts).orderBy(desc(systemAlerts.createdAt)).limit(limit);
      if (onlyOpen) {
        return await db.select().from(systemAlerts)
          .where(eq(systemAlerts.isResolved, false))
          .orderBy(desc(systemAlerts.createdAt)).limit(limit);
      }
      return await q;
    } catch (e: any) {
      logger.warn("getSystemAlerts:", e?.message);
      return [];
    }
  }

  async createSystemAlert(data: {
    severity?: "info"|"warning"|"error"|"critical";
    source: string; title: string; message: string; metadata?: any;
  }): Promise<any> {
    const { systemAlerts } = await import("@shared/schema");
    const result = await db.insert(systemAlerts).values({
      severity: data.severity ?? "info",
      source: data.source,
      title: data.title,
      message: data.message,
      metadata: data.metadata ?? null,
      isResolved: false,
    }).returning();
    return result[0];
  }

  async resolveSystemAlert(id: string, resolvedBy?: string): Promise<boolean> {
    try {
      const { systemAlerts } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(systemAlerts)
        .set({ isResolved: true, resolvedAt: new Date(), resolvedBy: resolvedBy ?? null })
        .where(eq(systemAlerts.id, id));
      return true;
    } catch { return false; }
  }

  // ─── User Settings ──────────────────────────────────────────────────────

  async getUserSettings(userId: string): Promise<any | null> {
    try {
      const { userSettings } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
      return rows[0] ?? null;
    } catch (e: any) {
      logger.warn("getUserSettings:", e?.message);
      return null;
    }
  }

  async upsertUserSettings(userId: string, patch: Record<string, unknown>): Promise<any> {
    const { userSettings } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const existing = await this.getUserSettings(userId);
    if (existing) {
      const rows = await db.update(userSettings)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(userSettings.userId, userId))
        .returning();
      return rows[0];
    } else {
      const rows = await db.insert(userSettings).values({
        userId,
        theme: (patch.theme as string) ?? "light",
        language: (patch.language as string) ?? "en",
        measurementUnit: (patch.measurementUnit as string) ?? "metric",
        currency: (patch.currency as string) ?? "CAD",
        notifyEmail: (patch.notifyEmail as boolean) ?? true,
        notifyPush: (patch.notifyPush as boolean) ?? false,
        notifyBimDone: (patch.notifyBimDone as boolean) ?? true,
        notifyRfiUpdate: (patch.notifyRfiUpdate as boolean) ?? true,
        analyticsEnabled: (patch.analyticsEnabled as boolean) ?? true,
      } as any).returning();
      return rows[0];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
}

// Initialize sample data in the database
async function initializeSampleData() {
  try {
    // Check if data already exists
    const existingUsers = await db.select().from(users).limit(1);
    if (existingUsers.length > 0) {
      return; // Data already exists
    }

    // Create sample user with hashed password
    const bcrypt = await import("bcryptjs");
    const hashedPassword = await bcrypt.hash("password123", 12);
    
    const sampleUser = await db.insert(users).values({
      username: "john.doe",
      password: hashedPassword,
      name: "John Doe",
      role: "Construction Manager"
    }).returning();

    // Create sample project
    const sampleProject = await db.insert(projects).values({
      name: "Downtown Office Complex",
      description: "Modern office building with sustainable features",
      location: "Toronto, ON",
      // ✅ FIX: Add required fields to match schema
      type: "Commercial",
      country: "canada",
      federalCode: "NBC",
      status: "Completed",
      estimateValue: "485000.00",
      buildingArea: "12450.00",
      userId: sampleUser[0].id
    }).returning();

    // Create sample BoQ items
    await db.insert(boqItems).values([
      {
        projectId: sampleProject[0].id,
        itemCode: "03.30.10",
        description: "Ready-mix concrete, 30 MPa, for footings",
        unit: "m³",
        quantity: "125.500",
        rate: "185.00",
        amount: "23217.50",
        standard: "CSA A23.1",
        category: "Concrete Work"
      },
      {
        projectId: sampleProject[0].id,
        itemCode: "05.12.13",
        description: "Structural steel beams, W310x74",
        unit: "kg",
        quantity: "8750.000",
        rate: "3.25",
        amount: "28437.50",
        standard: "CSA S16",
        category: "Structural Steel"
      }
    ]);

    // Create sample compliance checks
    await db.insert(complianceChecks).values([
      {
        projectId: sampleProject[0].id,
        standard: "NBC 9.23",
        requirement: "Structural Load Requirements",
        status: "Passed",
        details: "All structural elements meet NBC load requirements",
        recommendation: null
      },
      {
        projectId: sampleProject[0].id,
        standard: "AISC 360",
        requirement: "Steel Design Standards",
        status: "Failed",
        details: "Beam W310x74 at Grid Line A-3 exceeds maximum deflection limit of L/360",
        recommendation: "Increase beam size to W310x97 or add intermediate support"
      }
    ]);

    logger.info("Sample data initialized in database");
  } catch (error) {
    logger.warn("Sample data already exists or error initializing", { error });
  }
}

// Create storage instance with database
const dbStorage = new DBStorage();

// Initialize sample data
initializeSampleData();

export const storage = dbStorage;
