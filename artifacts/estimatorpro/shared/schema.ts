import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, integer, boolean, jsonb, unique, index, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Database enums for type safety (inspired by Prisma approach)
export const documentTypeEnum = pgEnum("document_type", ["drawing", "spec", "detail", "report", "other"]);
export const productSelectionStatusEnum = pgEnum("product_selection_status", ["default", "user_selected", "custom_cost"]);
export const revisionStatusEnum = pgEnum("revision_status", ["pending", "draft", "approved", "final", "rejected"]);
export const reviewStatusEnum = pgEnum("review_status", ["Draft", "Under Review", "Approved", "Rejected"]);
export const analysisStatusEnum = pgEnum("analysis_status", ["Pending", "Processing", "Completed", "Failed"]);
export const complianceStatusEnum = pgEnum("compliance_status", ["Passed", "Failed", "Review Required", "Not Applicable"]);
export const subscriptionTierEnum = pgEnum("subscription_tier", ["basic", "professional", "enterprise"]);

// Building code licensing enums
export const licensingModelEnum = pgEnum("licensing_model", ["estimatorpro_licensed", "client_licensed", "public_domain", "subscription_based"]);
export const codeAccessLevelEnum = pgEnum("code_access_level", ["full_access", "read_only", "excerpts_only", "reference_only"]);

// RFI and Change Request enums
export const rfiStatusEnum = pgEnum("rfi_status", ["Open", "In Progress", "Responded", "Closed", "Cancelled"]);
export const changeRequestStatusEnum = pgEnum("change_request_status", ["Pending", "Under Review", "Approved", "Rejected", "Implemented"]);
export const priorityEnum = pgEnum("priority", ["Low", "Medium", "High", "Critical"]);

// Construction discipline enum for access control
export const constructionDisciplineEnum = pgEnum("construction_discipline", [
  "Architectural",      // A-series drawings, design documents
  "Structural",         // S-series drawings, structural calcs
  "Mechanical",         // M-series drawings, HVAC systems
  "Electrical",         // E-series drawings, power systems
  "Plumbing",          // P-series drawings, water/waste systems
  "Civil",             // C-series drawings, site work
  "Fire_Protection",    // FP-series drawings, fire safety
  "Landscape",         // L-series drawings, landscaping
  "Specifications",     // Written specifications
  "Contracts",         // Contract documents
  "Reports",           // Engineering reports, assessments
  "General"            // General documents, project management
]);

// Company roles in construction projects
export const companyRoleEnum = pgEnum("company_role", [
  "General_Contractor",     // Overall project management
  "Architect",             // Design lead, architectural documents
  "Structural_Engineer",    // Structural design and calculations
  "MEP_Engineer",          // Mechanical, Electrical, Plumbing design
  "Civil_Engineer",        // Site work, utilities
  "Specialty_Contractor",  // Fire protection, elevators, etc.
  "Consultant",           // Various consulting roles
  "Owner_Representative", // Client/owner side
  "Solo_Practitioner"     // One-person company (access to all)
]);

// Document visibility levels
export const documentVisibilityEnum = pgEnum("document_visibility", [
  "Public",            // All project team members
  "Discipline",        // Only users with matching discipline
  "Role_Limited",      // Based on user role hierarchy
  "Confidential"       // Only specific users/admins
]);

// Companies table for construction firms
export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  role: companyRoleEnum("role").notNull().default("Solo_Practitioner"),
  allowedDisciplines: jsonb("allowed_disciplines").notNull().default("[\"General\"]"),
  isSoloPractitioner: boolean("is_solo_practitioner").notNull().default(false),
  licenseNumber: text("license_number"),
  contactEmail: text("contact_email"),
  address: text("address"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("Construction Manager"),
  // Company association
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "set null" }),
  isCompanyAdmin: boolean("is_company_admin").notNull().default(false),
  email: text("email").unique(),
  stripeCustomerId: text("stripe_customer_id").unique(),
  subscriptionId: text("subscription_id"),
  plan: text("plan").notNull().default("trial"), // trial, starter, pro, enterprise
  subscriptionTier: subscriptionTierEnum("subscription_tier").notNull().default("basic"), // Cost estimation tier
  subscriptionStatus: text("subscription_status").default("trialing"), // trialing, active, past_due, canceled, unpaid
  trialEndsAt: timestamp("trial_ends_at"),
  subscriptionEndsAt: timestamp("subscription_ends_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  companyIdIdx: index("users_company_id_idx").on(table.companyId),
}));

export const subscriptions = pgTable("subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripePriceId: text("stripe_price_id").notNull(),
  plan: text("plan").notNull(), // starter, pro, enterprise
  status: text("status").notNull(), // trialing, active, past_due, canceled, unpaid
  currentPeriodStart: timestamp("current_period_start").notNull(),
  currentPeriodEnd: timestamp("current_period_end").notNull(),
  trialStart: timestamp("trial_start"),
  trialEnd: timestamp("trial_end"),
  canceledAt: timestamp("canceled_at"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
  metadata: jsonb("metadata").default("{}"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  userIdIdx: index("subscriptions_user_id_idx").on(table.userId),
  statusIdx: index("subscriptions_status_idx").on(table.status),
}));

export const planLimits = pgTable("plan_limits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  plan: text("plan").notNull().unique(), // starter, pro, enterprise
  maxProjects: integer("max_projects").notNull(),
  maxDocumentsPerProject: integer("max_documents_per_project").notNull(),
  maxStorageGB: integer("max_storage_gb").notNull(),
  aiAnalysisEnabled: boolean("ai_analysis_enabled").notNull().default(true),
  exportFormats: jsonb("export_formats").notNull().default("[]"), // ["pdf", "excel", "word"]
  bimIntegration: boolean("bim_integration").notNull().default(false),
  prioritySupport: boolean("priority_support").notNull().default(false),
  features: jsonb("features").notNull().default("[]"), // Additional feature flags
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  location: text("location").notNull(),
  type: text("type").notNull().default("Commercial"), // Commercial, Residential, Industrial, etc.
  country: text("country").notNull().default("canada"), // canada, usa
  federalCode: text("federal_code").notNull(), // NBC, IBC, etc.
  stateProvincialCode: text("state_provincial_code"), // Ontario Building Code, California Building Code, etc.
  municipalCode: text("municipal_code"), // Toronto Building Code, etc.
  status: text("status").notNull().default("Draft"), // Draft, In Progress, Completed, On Hold
  estimateValue: decimal("estimate_value", { precision: 12, scale: 2 }),
  buildingArea: decimal("building_area", { precision: 10, scale: 2 }),
  // Est-7: Rate system choice — persisted per project so exports & UI stay in sync
  // 'ciqs'        → estimate-engine.ts CSI_RATES (218 entries, M+L+E breakdown, CIQS methodology)
  // 'quicktakeoff' → rates.ts keyword rules (60 entries, single all-in rate, fast QTO)
  rateSystem: text("rate_system").notNull().default("ciqs"),
  // v15.29: Estimation parameters — exposed on project so cost engine uses project-specific values
  buildingClass: text("building_class").default("B"),         // NBC/OBC building class: A, B, C, D
  complexity: text("complexity").default("medium"),           // low, medium, high
  riskProfile: text("risk_profile").default("medium"),        // low, medium, high
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
}, (table) => ({
  userIdIdx: index("projects_user_id_idx").on(table.userId),
}));

export const documents = pgTable("documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(), // User's original filename
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size"),
  storageKey: text("storage_key").notNull(),
  analysisStatus: text("analysis_status").notNull().default("Pending"),

  // NEW: persist parsed content
  pageCount: integer("page_count"),
  textContent: text("text_content"),
  pageText: jsonb("page_text"),        // [{ page: number, text: string }]
  rasterPreviews: jsonb("raster_previews"), // [{ page: number, key: string }]
  vectorHints: jsonb("vector_hints"),  // optional: grids/levels parsed later

  analysisResult: jsonb("analysis_result"),
  reviewStatus: text("review_status").default("draft"), // draft, approved, rejected
  reviewedAt: timestamp("reviewed_at"),
  assignedReviewerId: varchar("assigned_reviewer_id").references(() => users.id, { onDelete: "set null" }),
  assignedReviewerNote: text("assigned_reviewer_note"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  projectIdIdx: index("documents_project_id_idx").on(table.projectId),
  analysisStatusIdx: index("documents_analysis_status_idx").on(table.analysisStatus),
  reviewStatusIdx: index("documents_review_status_idx").on(table.reviewStatus),
  createdAtIdx: index("documents_created_at_idx").on(table.createdAt),
}));

// Document images table for storing per-page images with sheet metadata
export const documentImages = pgTable("document_images", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number").notNull(),
  sheetNumber: varchar("sheet_number", { length: 50 }), // e.g. "A201", "S101"
  sheetTitle: text("sheet_title"), // e.g. "Exterior Elevations", "Foundation Plan"
  imageUrl: text("image_url").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  documentIdIdx: index("document_images_document_id_idx").on(table.documentId),
  pageNumberIdx: index("document_images_page_number_idx").on(table.pageNumber),
  sheetNumberIdx: index("document_images_sheet_number_idx").on(table.sheetNumber),
}));

// Atomic revision counter table (inspired by Prisma approach)
export const revisionCounters = pgTable("revision_counters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").notNull().unique().references(() => documents.id, { onDelete: "cascade" }),
  lastRevision: integer("last_revision").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  documentIdIdx: index("revision_counters_document_id_idx").on(table.documentId),
}));

// Document Revisions table - better normalized approach with proper constraints
export const documentRevisions = pgTable("document_revisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  revisionNumber: integer("revision_number").notNull(),
  filePath: text("file_path").notNull(),
  fileHash: text("file_hash").notNull(),
  uploadedBy: varchar("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  status: revisionStatusEnum("status").notNull().default("pending"),
  notes: text("notes"),
  fileMime: text("file_mime"),
  fileSize: integer("file_size"),
  changeDescription: text("change_description"),
  impactAnalysis: jsonb("impact_analysis"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  // Enhanced indexing strategy (inspired by Prisma approach)
  documentIdIdx: index("document_revisions_document_id_idx").on(table.documentId),
  statusIdx: index("document_revisions_status_idx").on(table.status),
  createdAtIdx: index("document_revisions_created_at_idx").on(table.createdAt),
  // Unique constraint to prevent duplicate revision numbers per document
  uniqueRevision: unique("document_revisions_document_revision_unique").on(table.documentId, table.revisionNumber),
}));

export const boqItems = pgTable("boq_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  itemCode: text("item_code").notNull(),
  description: text("description").notNull(),
  unit: text("unit").notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 3 }).notNull(),
  rate: decimal("rate", { precision: 10, scale: 2 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  standard: text("standard"),
  category: text("category").notNull(),
  floor: text("floor"), // Floor/level assignment (e.g., "Ground", "Level 2", "Roof")
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  projectIdIdx: index("boq_items_project_id_idx").on(table.projectId),
}));

// BOQ Versions table for saving different BOQ versions
export const boqVersions = pgTable("boq_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  versionName: text("version_name").notNull(),
  description: text("description"),
  savedBy: varchar("saved_by").references(() => users.id, { onDelete: "set null" }),
  totalValue: decimal("total_value", { precision: 15, scale: 2 }),
  elementCount: integer("element_count"),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  projectIdIdx: index("boq_versions_project_id_idx").on(table.projectId),
  createdAtIdx: index("boq_versions_created_at_idx").on(table.createdAt),
}));

// BOQ Version Items - stores the actual BOQ data for each version
export const boqVersionItems = pgTable("boq_version_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  versionId: varchar("version_id").notNull().references(() => boqVersions.id, { onDelete: "cascade" }),
  itemCode: text("item_code").notNull(),
  description: text("description").notNull(),
  unit: text("unit").notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 3 }).notNull(),
  rate: decimal("rate", { precision: 10, scale: 2 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  category: text("category").notNull(),
  standard: text("standard"),
  elementType: text("element_type"),
  floor: text("floor"), // Floor/level assignment (e.g., "Ground", "Level 2", "Roof")
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  versionIdIdx: index("boq_version_items_version_id_idx").on(table.versionId),
}));

export const complianceChecks = pgTable("compliance_checks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  standard: text("standard").notNull(), // CSA, NBC, IBC, ASCE, etc.
  requirement: text("requirement").notNull(),
  status: text("status").notNull().default("Not Applicable"), // Keep as text for now to avoid migration issues
  details: text("details"),
  recommendation: text("recommendation"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  // Enhanced indexing for compliance queries
  projectIdIdx: index("compliance_checks_project_id_idx").on(table.projectId),
  statusIdx: index("compliance_checks_status_idx").on(table.status),
  standardIdx: index("compliance_checks_standard_idx").on(table.standard),
  projectStatusIdx: index("compliance_checks_project_status_idx").on(table.projectId, table.status),
}));

// Table to store the comprehensive National Building Code content
export const buildingCodeSections = pgTable("building_code_sections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  codeId: text("code_id").notNull(), // NBC-2020, IBC-2021, etc.
  division: text("division"), // A, B, C
  part: text("part"), // 1, 2, 3, etc.
  section: text("section"), // 9.10, 3.2.3, etc.
  subsection: text("subsection"), // 9.10.3.1, etc.
  title: text("title").notNull(),
  content: text("content").notNull(),
  requirements: jsonb("requirements").notNull().default("[]"), // Array of requirement objects
  references: jsonb("references").notNull().default("[]"), // Array of reference codes
  jurisdiction: text("jurisdiction").notNull(), // canada, usa, international
  category: text("category").notNull(), // building, structural, mechanical, etc.
  authority: text("authority").notNull(), // National Research Council Canada, etc.
  version: text("version").notNull(), // 2020, 2021, etc.
  effectiveDate: timestamp("effective_date"),
  lastUpdated: timestamp("last_updated").defaultNow(),
  applicability: text("applicability"), // What types of buildings this applies to
  measurementCriteria: text("measurement_criteria"), // How compliance is measured
  exceptions: jsonb("exceptions").notNull().default("[]"), // Array of exceptions
  relatedSections: jsonb("related_sections").notNull().default("[]"), // Array of related section IDs
  
  // 🏛️ LICENSING FIELDS
  licensingModel: licensingModelEnum("licensing_model").notNull().default("public_domain"),
  licenseOwner: text("license_owner"), // "EstimatorPro" or client company name
  usageRights: jsonb("usage_rights").notNull().default("{}"), // Detailed usage permissions
  attributionRequired: boolean("attribution_required").notNull().default(true),
  licenseExpiry: timestamp("license_expiry"), // For subscription-based codes
  accessLevel: codeAccessLevelEnum("access_level").notNull().default("read_only"),
}, (table) => ({
  codeIdIdx: index("building_code_sections_code_id_idx").on(table.codeId),
  jurisdictionIdx: index("building_code_sections_jurisdiction_idx").on(table.jurisdiction),
  categoryIdx: index("building_code_sections_category_idx").on(table.category),
  sectionIdx: index("building_code_sections_section_idx").on(table.section),
}));

export const reports = pgTable("reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  reportType: text("report_type").notNull(),
  filename: text("filename").notNull(),
  fileSize: integer("file_size").notNull(),
  status: text("status").notNull().default("Ready"), // Generating, Ready, Failed
  generatedAt: timestamp("generated_at").defaultNow(),
}, (table) => ({
  projectIdIdx: index("reports_project_id_idx").on(table.projectId),
}));

// 🔍 BOQ-BIM Validation System
export const validationResults = pgTable("validation_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  validationType: text("validation_type").notNull(), // 'boq_bim_cross_check', 'spatial_verification', 'quantity_audit'
  status: text("status").notNull().default("pending"), // pending, completed, failed
  totalItems: integer("total_items").notNull().default(0),
  validItems: integer("valid_items").notNull().default(0),
  invalidItems: integer("invalid_items").notNull().default(0),
  discrepancies: jsonb("discrepancies").notNull().default("[]"), // Array of discrepancy objects
  confidenceScore: decimal("confidence_score", { precision: 5, scale: 2 }).default("0.00"), // Overall confidence 0-100
  validationSummary: jsonb("validation_summary").notNull().default("{}"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  projectIdIdx: index("validation_results_project_id_idx").on(table.projectId),
  statusIdx: index("validation_results_status_idx").on(table.status),
}));

export const boqBimMappings = pgTable("boq_bim_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  boqItemId: varchar("boq_item_id").references(() => boqItems.id, { onDelete: "set null" }),
  bimElementId: varchar("bim_element_id").references(() => bimElements.id, { onDelete: "set null" }),
  mappingType: text("mapping_type").notNull(), // 'exact_match', 'partial_match', 'inferred', 'manual'
  confidenceLevel: decimal("confidence_level", { precision: 5, scale: 2 }).notNull(), // 0-100
  quantityVariance: decimal("quantity_variance", { precision: 10, scale: 3 }).default("0.000"), // Difference between BOQ and BIM quantities
  spatialVerified: boolean("spatial_verified").default(false),
  discrepancyFlags: jsonb("discrepancy_flags").notNull().default("[]"), // Array of specific issues
  reviewStatus: text("review_status").default("pending"), // pending, approved, requires_attention
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  lastValidated: timestamp("last_validated").defaultNow(),
}, (table) => ({
  projectIdIdx: index("boq_bim_mappings_project_id_idx").on(table.projectId),
  boqItemIdIdx: index("boq_bim_mappings_boq_item_id_idx").on(table.boqItemId),
  bimElementIdIdx: index("boq_bim_mappings_bim_element_id_idx").on(table.bimElementId),
}));

// 🏛️ NEW: Code License Registry - Track EstimatorPro vs client-owned licenses
export const codeLicenses = pgTable("code_licenses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  codeId: text("code_id").notNull(), // NBC-2020, IBC-2021, CSA-A23.3, etc.
  authority: text("authority").notNull(), // National Research Council Canada, ICC, CSA Group
  licensingModel: licensingModelEnum("licensing_model").notNull(),
  licenseOwner: text("license_owner").notNull(), // "EstimatorPro" or client company name
  clientCompanyId: varchar("client_company_id").references(() => companies.id, { onDelete: "set null" }), // If client-licensed
  
  // License Details
  subscriptionLevel: text("subscription_level"), // basic, professional, enterprise
  accessLevel: codeAccessLevelEnum("access_level").notNull().default("read_only"),
  usageRights: jsonb("usage_rights").notNull().default("{}"), // { excerpts: boolean, full_text: boolean, commercial_use: boolean }
  attributionRequired: boolean("attribution_required").notNull().default(true),
  
  // Validity
  licenseStart: timestamp("license_start").notNull(),
  licenseExpiry: timestamp("license_expiry"),
  isActive: boolean("is_active").notNull().default(true),
  
  // Legal
  contractNumber: text("contract_number"),
  legalTerms: text("legal_terms"),
  usageLimits: jsonb("usage_limits").notNull().default("{}"), // { max_users: number, max_projects: number }
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  codeIdIdx: index("code_licenses_code_id_idx").on(table.codeId),
  ownerIdx: index("code_licenses_owner_idx").on(table.licenseOwner),
  companyIdx: index("code_licenses_company_idx").on(table.clientCompanyId),
}));

// 🏛️ NEW: Project Code Access - Link projects to appropriate licenses
export const projectCodeAccess = pgTable("project_code_access", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  codeLicenseId: varchar("code_license_id").notNull().references(() => codeLicenses.id),
  
  // Access Control
  accessGranted: boolean("access_granted").notNull().default(true),
  accessLevel: codeAccessLevelEnum("access_level").notNull(),
  usageType: text("usage_type").notNull(), // "compliance_check", "reference", "full_analysis"
  
  // Usage Tracking
  firstAccess: timestamp("first_access").defaultNow(),
  lastAccess: timestamp("last_access").defaultNow(),
  accessCount: integer("access_count").notNull().default(0),
  
  // Legal Compliance
  attributionProvided: boolean("attribution_provided").notNull().default(false),
  attributionText: text("attribution_text"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  projectIdIdx: index("project_code_access_project_idx").on(table.projectId),
  licenseIdIdx: index("project_code_access_license_idx").on(table.codeLicenseId),
  projectLicenseIdx: unique("project_code_access_project_license_unique").on(table.projectId, table.codeLicenseId),
}));

// BIM Models table
export const bimModels = pgTable("bim_models", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  modelType: varchar("model_type", { length: 50 }).notNull().default("architectural"), // architectural, structural, mep
  status: varchar("status", { length: 50 }).notNull().default("generating"), // generating, ready, error
  geometryData: jsonb("geometry_data"), // 3D geometry in JSON format
  ifcData: text("ifc_data"), // IFC file content
  fileUrl: varchar("file_url", { length: 500 }),
  fileSize: integer("file_size"), // in bytes
  boundingBox: jsonb("bounding_box"), // { min: [x,y,z], max: [x,y,z] }
  components: jsonb("components"), // Array of building components
  materials: jsonb("materials"), // Material definitions
  units: varchar("units", { length: 20 }).default("metric"), // metric, imperial
  version: varchar("version", { length: 100 }).default("1.0"),
  metadata: jsonb("metadata").default("{}"), // Progress tracking and generation metadata
  elementCount: integer("element_count").default(0), // Number of BIM elements in model
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  projectIdIdx: index("bim_models_project_id_idx").on(table.projectId),
}));

// BIM Elements table - individual building components
export const bimElements = pgTable("bim_elements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  modelId: varchar("model_id").notNull().references(() => bimModels.id, { onDelete: "cascade" }),
  elementType: varchar("element_type", { length: 100 }).notNull(), // wall, door, window, beam, column, etc.
  elementId: varchar("element_id", { length: 100 }).notNull(), // unique identifier within model
  name: varchar("name", { length: 255 }),
  geometry: jsonb("geometry").notNull(), // 3D geometry data
  properties: jsonb("properties"), // Element properties (material, dimensions, etc.)
  location: jsonb("location"), // Position and orientation
  parentId: varchar("parent_id"), // For hierarchical relationships
  level: varchar("level", { length: 100 }), // Building level/floor (legacy)
  
  // Enhanced storey information for Phase 2
  storeyName: varchar("storey_name", { length: 100 }), // "Ground Floor", "Level 1", etc.
  storeyGuid: varchar("storey_guid", { length: 36 }), // IFC Building Storey GUID
  elevation: decimal("elevation", { precision: 10, scale: 3 }), // Height above datum (mm precision)
  category: varchar("category", { length: 100 }), // Structural, architectural, MEP
  material: varchar("material", { length: 255 }),
  // Enhanced quantity information with dual unit support
  quantity: decimal("quantity", { precision: 10, scale: 2 }),
  unit: varchar("unit", { length: 50 }),
  quantityMetric: decimal("quantity_metric", { precision: 10, scale: 2 }), // Always in metric
  quantityImperial: decimal("quantity_imperial", { precision: 10, scale: 2 }), // Always in imperial
  ifcGuid: varchar("ifc_guid", { length: 36 }), // IFC Global Unique Identifier
  // ─── RFI / Attention flags ─────────────────────────────────────────────────
  rfiFlag: boolean("rfi_flag").notNull().default(false),
  rfiId: varchar("rfi_id", { length: 36 }),
  needsAttention: boolean("needs_attention").notNull().default(false),
  attentionReason: text("attention_reason"),
  // ─── Phase 2: LOD, Phase, Workset, Revision ───────────────────────────────
  lod: integer("lod"), // LOD level: 100, 200, 300, 350, 400, 500 (BIM Forum spec)
  phaseId: varchar("phase_id", { length: 20 }), // WBS code e.g. "1.3.2"
  phaseName: varchar("phase_name", { length: 100 }), // e.g. "Foundations & Substructure"
  createdPhase: varchar("created_phase", { length: 100 }), // phase when element is built
  demolishedPhase: varchar("demolished_phase", { length: 100 }), // phase when removed (reno)
  worksetId: varchar("workset_id", { length: 20 }), // e.g. "WS_STRUCT"
  worksetName: varchar("workset_name", { length: 100 }), // e.g. "Structural"
  discipline: varchar("discipline", { length: 50 }), // Architectural, Structural, Mechanical, etc.
  revisionNumber: integer("revision_number"), // model revision number
  revisionAction: varchar("revision_action", { length: 20 }), // added, modified, deleted, unchanged
  // ─── Rebar / Connection data (JSON) ───────────────────────────────────────
  rebarData: jsonb("rebar_data"), // RebarInfo JSON (total weight, bars, cover)
  connectionData: jsonb("connection_data"), // ConnectionDetail[] JSON
  // ───────────────────────────────────────────────────────────────────────────
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  modelIdIdx: index("bim_elements_model_id_idx").on(table.modelId),
  elementTypeIdx: index("bim_elements_element_type_idx").on(table.elementType),
  createdAtIdx: index("bim_elements_created_at_idx").on(table.createdAt),
  lodIdx: index("bim_elements_lod_idx").on(table.lod),
  phaseIdIdx: index("bim_elements_phase_id_idx").on(table.phaseId),
  worksetIdIdx: index("bim_elements_workset_id_idx").on(table.worksetId),
}));

// Analysis Results Storage - for revision comparison
export const analysisResults = pgTable("analysis_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  analysisType: varchar("analysis_type", { length: 50 }).notNull(), // similarity, compliance, boq
  revisionId: varchar("revision_id").notNull(), // Links to document revision
  analysisVersion: varchar("analysis_version", { length: 10 }).notNull().default("1.0"),
  
  // 🧠 NEW: Claude Analysis System Versioning
  claudeSystemVersion: varchar("claude_system_version", { length: 20 }).notNull().default("v1_hardcoded"), // v1_hardcoded, v2_dynamic
  elementDiscoveryMethod: varchar("element_discovery_method", { length: 30 }).notNull().default("predefined"), // predefined, dynamic_discovery
  complianceMethod: varchar("compliance_method", { length: 30 }).notNull().default("upfront_codes"), // upfront_codes, targeted_codes
  
  // Core analysis data
  overallScore: decimal("overall_score", { precision: 5, scale: 2 }),
  documentCount: integer("document_count").notNull(),
  analysisData: jsonb("analysis_data").notNull(), // Full analysis results
  summary: text("summary"), // Human-readable summary
  riskAreas: jsonb("risk_areas").notNull().default("[]"), // Array of risk areas
  recommendations: jsonb("recommendations").notNull().default("[]"), // Array of recommendations
  
  // Cost tracking
  claudeTokensUsed: integer("claude_tokens_used").default(0),
  processingTime: integer("processing_time"), // seconds
  documentsProcessed: jsonb("documents_processed").notNull().default("[]"), // Array of document IDs
  documentsSkipped: jsonb("documents_skipped").notNull().default("[]"), // Array of skipped docs (unchanged)
  
  // Change detection
  changedDocuments: jsonb("changed_documents").notNull().default("[]"), // Only docs that changed
  documentHashes: jsonb("document_hashes").notNull().default("{}"), // Document hash mapping
  previousAnalysisId: varchar("previous_analysis_id"), // Links to previous analysis
  changesSummary: text("changes_summary"), // AI summary of what changed
  
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  projectIdIdx: index("analysis_results_project_id_idx").on(table.projectId),
  analysisTypeIdx: index("analysis_results_analysis_type_idx").on(table.analysisType),
  revisionIdIdx: index("analysis_results_revision_id_idx").on(table.revisionId),
  createdAtIdx: index("analysis_results_created_at_idx").on(table.createdAt),
  projectAnalysisTypeIdx: index("analysis_results_project_analysis_type_idx").on(table.projectId, table.analysisType),
}));

// 🧠 Analysis System Baseline Snapshot - tracks current system capabilities
export const analysisSystemBaseline = pgTable("analysis_system_baseline", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  systemVersion: varchar("system_version", { length: 20 }).notNull(), // v1_hardcoded, v2_dynamic
  
  // Current Analysis Capabilities
  totalBimElements: integer("total_bim_elements").notNull(),
  uniqueElementTypes: integer("unique_element_types").notNull(),
  elementTypesList: jsonb("element_types_list").notNull().default("[]"),
  
  // Compliance Capabilities
  totalComplianceChecks: integer("total_compliance_checks").notNull(),
  uniqueStandards: integer("unique_standards").notNull(),
  standardsList: jsonb("standards_list").notNull().default("[]"),
  
  // System Characteristics
  elementDiscoveryMethod: varchar("element_discovery_method", { length: 30 }).notNull(),
  complianceApproach: varchar("compliance_approach", { length: 50 }).notNull(),
  codeHandlingMethod: varchar("code_handling_method", { length: 30 }).notNull(),
  
  // Performance Metrics
  avgAnalysisTime: integer("avg_analysis_time_seconds"),
  avgTokensUsed: integer("avg_tokens_used"),
  
  // Metadata
  description: text("description"),
  snapshotDate: timestamp("snapshot_date").defaultNow(),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
}, (table) => ({
  systemVersionIdx: index("analysis_system_baseline_version_idx").on(table.systemVersion),
  snapshotDateIdx: index("analysis_system_baseline_date_idx").on(table.snapshotDate),
}));

// 🧠 Analysis Comparison Results - tracks before vs after comparisons
export const analysisComparisons = pgTable("analysis_comparisons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  
  // Comparison details
  oldAnalysisId: varchar("old_analysis_id").references(() => analysisResults.id, { onDelete: "set null" }),
  newAnalysisId: varchar("new_analysis_id").references(() => analysisResults.id, { onDelete: "set null" }),
  oldSystemVersion: varchar("old_system_version", { length: 20 }).notNull(),
  newSystemVersion: varchar("new_system_version", { length: 20 }).notNull(),
  
  // Element Discovery Comparison
  oldElementCount: integer("old_element_count").notNull(),
  newElementCount: integer("new_element_count").notNull(),
  elementCountDelta: integer("element_count_delta").notNull(),
  
  oldElementTypes: jsonb("old_element_types").notNull().default("[]"),
  newElementTypes: jsonb("new_element_types").notNull().default("[]"),
  newlyDiscoveredTypes: jsonb("newly_discovered_types").notNull().default("[]"),
  
  // Compliance Comparison
  oldComplianceChecks: integer("old_compliance_checks").notNull(),
  newComplianceChecks: integer("new_compliance_checks").notNull(),
  complianceChecksDelta: integer("compliance_checks_delta").notNull(),
  
  // Performance Comparison
  oldAnalysisTime: integer("old_analysis_time_seconds"),
  newAnalysisTime: integer("new_analysis_time_seconds"),
  oldTokensUsed: integer("old_tokens_used"),
  newTokensUsed: integer("new_tokens_used"),
  
  // Quality Metrics
  accuracyImprovement: decimal("accuracy_improvement", { precision: 5, scale: 2 }),
  completenessImprovement: decimal("completeness_improvement", { precision: 5, scale: 2 }),
  
  // Summary
  comparisonSummary: text("comparison_summary"),
  recommendedAction: varchar("recommended_action", { length: 50 }), // keep_old, use_new, hybrid_approach
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  projectIdIdx: index("analysis_comparisons_project_id_idx").on(table.projectId),
  oldSystemVersionIdx: index("analysis_comparisons_old_version_idx").on(table.oldSystemVersion),
  newSystemVersionIdx: index("analysis_comparisons_new_version_idx").on(table.newSystemVersion),
  createdAtIdx: index("analysis_comparisons_created_at_idx").on(table.createdAt),
}));

// Document content hashes for change detection
export const documentHashes = pgTable("document_hashes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").notNull().references(() => documents.id),
  contentHash: varchar("content_hash", { length: 64 }).notNull(), // SHA-256 hash
  extractedContentHash: varchar("extracted_content_hash", { length: 64 }), // Hash of AI-extracted content
  lastAnalyzed: timestamp("last_analyzed").defaultNow(),
}, (table) => ({
  documentIdIdx: index("document_hashes_document_id_idx").on(table.documentId),
  contentHashIdx: index("document_hashes_content_hash_idx").on(table.contentHash),
}));

export const aiConfigurations = pgTable("ai_configurations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  configName: text("config_name").notNull(),
  processingMode: text("processing_mode").notNull().default("comprehensive"), // quick, standard, comprehensive, detailed
  analysisStandards: jsonb("analysis_standards").notNull().default("[]"), // ["NBC", "CSA", "IBC", etc.]
  aiModels: jsonb("ai_models").notNull().default("{}"), // {nlp: "advanced", cv: "yolo", ocr: "tesseract"}
  detectComponents: jsonb("detect_components").notNull().default("[]"), // ["walls", "doors", "windows", "MEP"]
  extractionSettings: jsonb("extraction_settings").notNull().default("{}"), // {confidence: 0.8, precision: "high"}
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  projectIdIdx: index("ai_configurations_project_id_idx").on(table.projectId),
  isDefaultIdx: index("ai_configurations_is_default_idx").on(table.isDefault),
}));

export const processingJobs = pgTable("processing_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").references(() => documents.id, { onDelete: "cascade" }),
  configId: varchar("config_id").references(() => aiConfigurations.id, { onDelete: "set null" }),
  status: text("status").notNull().default("queued"), // queued, processing, completed, failed, cancelled
  progress: integer("progress").notNull().default(0), // 0-100
  currentStage: text("current_stage"), // "parsing", "nlp", "cv", "boq", "compliance"
  stageDetails: jsonb("stage_details").default("{}"),
  results: jsonb("results").default("{}"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  documentIdIdx: index("processing_jobs_document_id_idx").on(table.documentId),
  statusIdx: index("processing_jobs_status_idx").on(table.status),
}));

// Regulatory Analysis Cache - stores Claude's analysis results for regulatory combinations
export const regulatoryAnalysisCache = pgTable("regulatory_analysis_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Regulatory combination key (hash of federal + state/provincial + municipal codes)
  regulatoryCombinationHash: varchar("regulatory_combination_hash", { length: 64 }).notNull().unique(),
  
  // Individual regulatory codes
  federalCode: text("federal_code").notNull(), // NBC, IBC, etc.
  stateProvincialCode: text("state_provincial_code"), // Ontario Building Code, California Building Code, etc.
  municipalCode: text("municipal_code"), // Toronto Building Code, NYC Building Code, etc.
  jurisdiction: text("jurisdiction").notNull(), // canada, usa
  
  // Analysis content from Claude
  analysisResult: jsonb("analysis_result").notNull(), // Full Claude analysis
  complianceRules: jsonb("compliance_rules").notNull().default("[]"), // Extracted compliance rules
  keyRequirements: jsonb("key_requirements").notNull().default("[]"), // Key regulatory requirements
  conflictAreas: jsonb("conflict_areas").notNull().default("[]"), // Areas where regulations might conflict
  
  // Usage tracking
  usageCount: integer("usage_count").notNull().default(1),
  lastUsed: timestamp("last_used").defaultNow(),
  
  // Claude API tracking
  claudeTokensUsed: integer("claude_tokens_used").notNull(),
  claudeModel: text("claude_model").notNull().default("claude-sonnet-4-20250514"),
  analysisVersion: text("analysis_version").notNull().default("1.0"), // For cache invalidation
  
  // Cache metadata
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  federalCodeIdx: index("regulatory_cache_federal_code_idx").on(table.federalCode),
  jurisdictionIdx: index("regulatory_cache_jurisdiction_idx").on(table.jurisdiction),
  lastUsedIdx: index("regulatory_cache_last_used_idx").on(table.lastUsed),
  usageCountIdx: index("regulatory_cache_usage_count_idx").on(table.usageCount),
}));

// Project-specific regulatory analysis results (links projects to cached analysis)
export const projectRegulatoryAnalysis = pgTable("project_regulatory_analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  cacheId: varchar("cache_id").notNull().references(() => regulatoryAnalysisCache.id),
  
  // Project-specific customizations
  customRequirements: jsonb("custom_requirements").default("[]"), // Additional project-specific requirements
  exemptions: jsonb("exemptions").default("[]"), // Regulatory exemptions for this project
  
  // Analysis results specific to this project
  applicableRules: jsonb("applicable_rules").notNull().default("[]"), // Rules that apply to this specific project
  riskAssessment: jsonb("risk_assessment").default("{}"), // Risk analysis for this project
  recommendedActions: jsonb("recommended_actions").default("[]"), // Recommended compliance actions
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  projectIdIdx: index("project_regulatory_project_id_idx").on(table.projectId),
  cacheIdIdx: index("project_regulatory_cache_id_idx").on(table.cacheId),
  // Ensure one analysis per project per regulatory combination
  uniqueProjectCache: unique("project_regulatory_unique").on(table.projectId, table.cacheId),
}));

// Document Similarity Cache - stores Claude's document pair analysis results to avoid re-analysis
export const documentSimilarityCache = pgTable("document_similarity_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Document pair identification (hash of sorted document IDs)
  documentPairHash: varchar("document_pair_hash", { length: 64 }).notNull().unique(),
  
  // Individual document IDs
  documentAId: varchar("document_a_id").notNull(),
  documentBId: varchar("document_b_id").notNull(),
  
  // Document content hashes (to detect if documents changed)
  documentAContentHash: varchar("document_a_content_hash", { length: 64 }).notNull(),
  documentBContentHash: varchar("document_b_content_hash", { length: 64 }).notNull(),
  
  // Analysis results from Claude
  analysisResult: jsonb("analysis_result").notNull(), // Full Claude similarity analysis
  similarityScore: decimal("similarity_score", { precision: 4, scale: 3 }).notNull(), // 0.000-1.000
  overlapType: text("overlap_type").notNull(), // content, compliance, specifications, materials, schedule
  details: text("details").notNull(),
  conflicts: jsonb("conflicts").notNull().default("[]"), // Array of conflict objects
  recommendations: jsonb("recommendations").notNull().default("[]"), // Array of recommendations
  criticalLevel: text("critical_level").notNull(), // low, medium, high, critical
  
  // Usage tracking
  usageCount: integer("usage_count").notNull().default(1),
  lastUsed: timestamp("last_used").defaultNow(),
  
  // Claude API tracking
  claudeTokensUsed: integer("claude_tokens_used").notNull(),
  claudeModel: text("claude_model").notNull().default("claude-sonnet-4-20250514"),
  analysisVersion: text("analysis_version").notNull().default("1.0"), // For cache invalidation
  
  // Cache metadata
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  documentAIdIdx: index("doc_similarity_cache_doc_a_idx").on(table.documentAId),
  documentBIdIdx: index("doc_similarity_cache_doc_b_idx").on(table.documentBId),
  lastUsedIdx: index("doc_similarity_cache_last_used_idx").on(table.lastUsed),
  usageCountIdx: index("doc_similarity_cache_usage_count_idx").on(table.usageCount),
  similarityScoreIdx: index("doc_similarity_cache_score_idx").on(table.similarityScore),
}));

// RFI Management Tables
export const rfis = pgTable("rfis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  rfiNumber: varchar("rfi_number", { length: 100 }).notNull().unique(),
  
  // Document reference fields
  documentId: varchar("document_id").references(() => documents.id),
  documentRevision: varchar("document_revision"),
  documentReference: text("document_reference"),
  
  // RFI content
  subject: text("subject").notNull(),
  question: text("question").notNull(),
  priority: priorityEnum("priority").notNull().default("Medium"),
  responseRequired: boolean("response_required").notNull().default(true),
  responseRequestedBy: timestamp("response_requested_by"),
  
  // Participants
  fromName: text("from_name").notNull(),
  fromCompany: text("from_company"),
  toName: text("to_name").notNull(),
  toCompany: text("to_company"),
  submittedBy: varchar("submitted_by").references(() => users.id, { onDelete: "set null" }),

  // Status and workflow
  status: rfiStatusEnum("status").notNull().default("Open"),
  answeredBy: varchar("answered_by").references(() => users.id, { onDelete: "set null" }),
  answeredAt: timestamp("answered_at"),
  
  // AI Enhancement fields
  generatedFromConflict: boolean("generated_from_conflict").default(false),
  relatedConflicts: jsonb("related_conflicts").default("[]"),
  aiSuggestedResponse: text("ai_suggested_response"),
  impactAssessment: jsonb("impact_assessment"),
  
  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  projectIdIdx: index("rfis_project_id_idx").on(table.projectId),
  statusIdx: index("rfis_status_idx").on(table.status),
  submittedByIdx: index("rfis_submitted_by_idx").on(table.submittedBy),
  rfiNumberIdx: index("rfis_rfi_number_idx").on(table.rfiNumber),
  createdAtIdx: index("rfis_created_at_idx").on(table.createdAt),
}));

export const rfiResponses = pgTable("rfi_responses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rfiId: varchar("rfi_id").notNull().references(() => rfis.id, { onDelete: "cascade" }),
  
  // Response content
  response: text("response").notNull(),
  responseType: text("response_type").notNull().default("comment"), // comment, clarification, official_response
  isOfficial: boolean("is_official").notNull().default(false),
  
  // Responder information
  responderName: text("responder_name").notNull(),
  responderCompany: text("responder_company"),
  responderId: varchar("responder_id").references(() => users.id, { onDelete: "set null" }),
  
  // AI Enhancement
  aiGenerated: boolean("ai_generated").default(false),
  aiConfidence: decimal("ai_confidence", { precision: 3, scale: 2 }),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  rfiIdIdx: index("rfi_responses_rfi_id_idx").on(table.rfiId),
  isOfficialIdx: index("rfi_responses_is_official_idx").on(table.isOfficial),
}));

export const rfiAttachments = pgTable("rfi_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rfiId: varchar("rfi_id").notNull().references(() => rfis.id, { onDelete: "cascade" }),
  
  // File information
  fileName: text("file_name").notNull(),
  originalName: text("original_name").notNull(),
  filePath: text("file_path").notNull(),
  fileMime: text("file_mime"),
  fileSize: integer("file_size"),
  fileHash: text("file_hash"),
  
  // Upload metadata
  uploadedBy: varchar("uploaded_by").notNull().references(() => users.id),
  description: text("description"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  rfiIdIdx: index("rfi_attachments_rfi_id_idx").on(table.rfiId),
}));

// Change Request Management Tables
export const changeRequests = pgTable("change_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  rfiId: varchar("rfi_id").references(() => rfis.id), // Optional link to originating RFI
  
  // Change request content
  title: text("title").notNull(),
  description: text("description").notNull(),
  reason: text("reason").notNull(),
  priority: priorityEnum("priority").notNull().default("Medium"),
  
  // Impact analysis
  costImpact: decimal("cost_impact", { precision: 12, scale: 2 }),
  scheduleImpact: integer("schedule_impact_days"), // Impact in days
  scopeImpact: text("scope_impact"),
  qualityImpact: text("quality_impact"),
  riskImpact: text("risk_impact"),
  
  // Workflow
  status: changeRequestStatusEnum("status").notNull().default("Pending"),
  submittedBy: varchar("submitted_by").notNull().references(() => users.id),
  reviewedBy: varchar("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  approvedBy: varchar("approved_by").references(() => users.id, { onDelete: "set null" }),
  implementedBy: varchar("implemented_by").references(() => users.id, { onDelete: "set null" }),
  
  // AI Enhancement fields
  aiGeneratedImpact: jsonb("ai_generated_impact"),
  affectedBoqItems: jsonb("affected_boq_items").default("[]"),
  affectedDocuments: jsonb("affected_documents").default("[]"),
  estimateRevisionRequired: boolean("estimate_revision_required").default(false),
  bimModelUpdateRequired: boolean("bim_model_update_required").default(false),
  
  // Review details
  reviewNotes: text("review_notes"),
  rejectionReason: text("rejection_reason"),
  implementationNotes: text("implementation_notes"),
  
  // Timestamps
  submittedAt: timestamp("submitted_at").defaultNow(),
  reviewedAt: timestamp("reviewed_at"),
  approvedAt: timestamp("approved_at"),
  implementedAt: timestamp("implemented_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  projectIdIdx: index("change_requests_project_id_idx").on(table.projectId),
  statusIdx: index("change_requests_status_idx").on(table.status),
  submittedByIdx: index("change_requests_submitted_by_idx").on(table.submittedBy),
  rfiIdIdx: index("change_requests_rfi_id_idx").on(table.rfiId),
  createdAtIdx: index("change_requests_created_at_idx").on(table.createdAt),
}));

export const changeRequestAttachments = pgTable("change_request_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  changeRequestId: varchar("change_request_id").notNull().references(() => changeRequests.id, { onDelete: "cascade" }),
  
  // File information
  fileName: text("file_name").notNull(),
  originalName: text("original_name").notNull(),
  filePath: text("file_path").notNull(),
  fileMime: text("file_mime"),
  fileSize: integer("file_size"),
  fileHash: text("file_hash"),
  
  // Upload metadata
  uploadedBy: varchar("uploaded_by").notNull().references(() => users.id),
  description: text("description"),
  attachmentType: text("attachment_type").default("supporting_document"), // supporting_document, technical_drawing, cost_analysis
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  changeRequestIdIdx: index("change_request_attachments_cr_id_idx").on(table.changeRequestId),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  username: z.string().min(3, "Username must be at least 3 characters").max(100),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required").max(255),
  email: z.string().email("Invalid email address").optional().nullable(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  plan: z.enum(["starter", "pro", "enterprise"]),
  status: z.enum(["trialing", "active", "past_due", "canceled", "unpaid"]),
});

export const insertPlanLimitSchema = createInsertSchema(planLimits).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  name: z.string().min(1, "Project name is required").max(500),
  location: z.string().min(1, "Location is required"),
  country: z.enum(["canada", "usa"]),
  status: z.enum(["Draft", "In Progress", "Completed", "On Hold"]).default("Draft"),
  rateSystem: z.enum(["ciqs", "quicktakeoff"]).default("ciqs"),
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  filename: z.string().min(1, "Filename is required"),
  originalName: z.string().min(1, "Original name is required"),
  fileType: z.string().min(1, "File type is required"),
  storageKey: z.string().min(1, "Storage key is required"),
  projectId: z.string().min(1, "Project ID is required"),
});

export const insertBuildingCodeSectionSchema = createInsertSchema(buildingCodeSections).omit({
  id: true,
});

export const insertBoqItemSchema = createInsertSchema(boqItems).omit({
  id: true,
  createdAt: true,
});

export const insertComplianceCheckSchema = createInsertSchema(complianceChecks).omit({
  id: true,
  createdAt: true,
});

export const insertReportSchema = createInsertSchema(reports).omit({
  id: true,
});

export const insertAiConfigurationSchema = createInsertSchema(aiConfigurations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProcessingJobSchema = createInsertSchema(processingJobs).omit({
  id: true,
  createdAt: true,
});

// RFI and Change Request insert schemas
export const insertRfiSchema = createInsertSchema(rfis).omit({
  id: true,
  status: true,
  answeredBy: true,
  answeredAt: true,
  aiSuggestedResponse: true,
  submittedBy: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  subject: z.string().min(1, "Subject is required").max(500),
  question: z.string().min(1, "Question is required"),
  fromName: z.string().min(1, "From name is required"),
  toName: z.string().min(1, "To name is required"),
  projectId: z.string().min(1, "Project ID is required"),
  rfiNumber: z.string().min(1, "RFI number is required"),
});

export const insertRfiResponseSchema = createInsertSchema(rfiResponses).omit({
  id: true,
  createdAt: true,
  aiConfidence: true,
});

export const insertRfiAttachmentSchema = createInsertSchema(rfiAttachments).omit({
  id: true,
  createdAt: true,
});

export const insertChangeRequestSchema = createInsertSchema(changeRequests).omit({
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  title: z.string().min(1, "Title is required").max(500),
  description: z.string().min(1, "Description is required"),
  reason: z.string().min(1, "Reason is required"),
  projectId: z.string().min(1, "Project ID is required"),
  submittedBy: z.string().min(1, "Submitter is required"),
});

export const insertChangeRequestAttachmentSchema = createInsertSchema(changeRequestAttachments).omit({
  id: true,
  createdAt: true,
});

export const insertAnalysisResultSchema = createInsertSchema(analysisResults).omit({
  id: true,
  createdAt: true,
});

export const insertDocumentHashSchema = createInsertSchema(documentHashes).omit({
  id: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Company type exports
export type Company = typeof companies.$inferSelect;
export type InsertCompany = typeof companies.$inferInsert;

export type InsertAnalysisResult = z.infer<typeof insertAnalysisResultSchema>;
export type AnalysisResult = typeof analysisResults.$inferSelect;

export type InsertDocumentHash = z.infer<typeof insertDocumentHashSchema>;
export type DocumentHash = typeof documentHashes.$inferSelect;

export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptions.$inferSelect;

export type InsertPlanLimit = z.infer<typeof insertPlanLimitSchema>;
export type PlanLimit = typeof planLimits.$inferSelect;

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documents.$inferSelect;

export type InsertBuildingCodeSection = z.infer<typeof insertBuildingCodeSectionSchema>;
export type BuildingCodeSection = typeof buildingCodeSections.$inferSelect;

// 🏛️ NEW: Code License Types
export const insertCodeLicenseSchema = createInsertSchema(codeLicenses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCodeLicense = z.infer<typeof insertCodeLicenseSchema>;
export type CodeLicense = typeof codeLicenses.$inferSelect;

export const insertProjectCodeAccessSchema = createInsertSchema(projectCodeAccess).omit({
  id: true,
  firstAccess: true,
  lastAccess: true,
  createdAt: true,
});
export type InsertProjectCodeAccess = z.infer<typeof insertProjectCodeAccessSchema>;
export type ProjectCodeAccess = typeof projectCodeAccess.$inferSelect;

// Document revision management service (simplified)
export class DocumentRevisionService {
  // Create a new revision of an existing document
  static createRevision(baseDoc: Document, _notes?: string): Partial<InsertDocument> {
    return {
      projectId: baseDoc.projectId,
      filename: baseDoc.filename,
      fileType: baseDoc.fileType,
      fileSize: baseDoc.fileSize,
      analysisStatus: "Pending",
    };
  }

  // Get revision history for documents in a project
  static getRevisionChain(documents: Document[], projectId: string): Document[] {
    return documents
      .filter(doc => doc.projectId === projectId)
      .sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateA - dateB;
      });
  }

  // Get current documents
  static getCurrentRevisions(documents: Document[]): Document[] {
    return documents; // Simplified - return all documents
  }
}

export type InsertBoqItem = z.infer<typeof insertBoqItemSchema>;
export type BoqItem = typeof boqItems.$inferSelect;

export type InsertComplianceCheck = z.infer<typeof insertComplianceCheckSchema>;
export type ComplianceCheck = typeof complianceChecks.$inferSelect;

export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reports.$inferSelect;

export type InsertAiConfiguration = z.infer<typeof insertAiConfigurationSchema>;
export type AiConfiguration = typeof aiConfigurations.$inferSelect;

export type InsertProcessingJob = z.infer<typeof insertProcessingJobSchema>;
export type ProcessingJob = typeof processingJobs.$inferSelect;

// RFI and Change Request types
export type InsertRfi = z.infer<typeof insertRfiSchema>;
export type Rfi = typeof rfis.$inferSelect;

export type InsertRfiResponse = z.infer<typeof insertRfiResponseSchema>;
export type RfiResponse = typeof rfiResponses.$inferSelect;

export type InsertRfiAttachment = z.infer<typeof insertRfiAttachmentSchema>;
export type RfiAttachment = typeof rfiAttachments.$inferSelect;

export type InsertChangeRequest = z.infer<typeof insertChangeRequestSchema>;
export type ChangeRequest = typeof changeRequests.$inferSelect;

export type InsertChangeRequestAttachment = z.infer<typeof insertChangeRequestAttachmentSchema>;
export type ChangeRequestAttachment = typeof changeRequestAttachments.$inferSelect;

export const insertBimModelSchema = createInsertSchema(bimModels).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  metadata: true,
  elementCount: true,
});

export const insertBimElementSchema = createInsertSchema(bimElements).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBimModel = z.infer<typeof insertBimModelSchema>;
export type BimModel = typeof bimModels.$inferSelect;

export type InsertBimElement = z.infer<typeof insertBimElementSchema>;
export type BimElement = typeof bimElements.$inferSelect;

// ─── BIM Storeys table — FIRST-CLASS source of truth for floor data ──────────
// Every storey extracted from or inferred from construction documents is stored
// here with its elevation source so the QS can see exactly what was extracted
// vs what was estimated, and which floors have outstanding RFIs.
// The bimElements.storeyName column must always match a row in this table.
// ─────────────────────────────────────────────────────────────────────────────
export const bimStoreys = pgTable("bim_storeys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  modelId: varchar("model_id").notNull().references(() => bimModels.id, { onDelete: "cascade" }),

  // Identity
  name: varchar("name", { length: 100 }).notNull(),           // e.g. "Ground Floor", "Level 2"
  guid: varchar("guid", { length: 36 }),                       // IFC IfcBuildingStorey GUID if available

  // Elevation data — always in metres above project datum (0 = ground datum)
  elevation: decimal("elevation", { precision: 10, scale: 3 }).notNull(),
  ceilingHeight: decimal("ceiling_height", { precision: 10, scale: 3 }),       // m — clear height from floor to ceiling
  floorToFloorHeight: decimal("floor_to_floor_height", { precision: 10, scale: 3 }), // m — floor to next floor above

  // Provenance — how was this elevation determined?
  // Values: extracted_from_drawings | derived_from_previous_storey |
  //         sequential_3m_estimate | assumed_ground_datum
  elevationSource: varchar("elevation_source", { length: 60 }).notNull(),

  // RFI flag — set whenever elevation is estimated rather than extracted
  rfiFlag: boolean("rfi_flag").notNull().default(false),
  rfiId: varchar("rfi_id", { length: 36 }),   // FK to rfis.id once RFI record is created

  // Counters — updated after upsertBimElements so queries are fast
  elementCount: integer("element_count").notNull().default(0),

  // Sort order (0 = lowest floor, ascending) for display ordering
  sortOrder: integer("sort_order").notNull().default(0),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  modelIdIdx: index("bim_storeys_model_id_idx").on(table.modelId),
  nameIdx:    index("bim_storeys_name_idx").on(table.modelId, table.name),
}));

export const insertBimStoreySchema = createInsertSchema(bimStoreys).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertBimStorey = z.infer<typeof insertBimStoreySchema>;
export type BimStorey = typeof bimStoreys.$inferSelect;

// BIM Element Classification Table - for proper categorization based on extracted data
export const bimElementClassifications = pgTable("bim_element_classifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  elementId: varchar("element_id").notNull().references(() => bimElements.id, { onDelete: "cascade" }),
  
  // Primary classification categories
  primaryType: varchar("primary_type", { length: 50 }).notNull(), // door, window, wall, mAndE, plumbing, structure, other
  subType: varchar("sub_type", { length: 100 }), // W1, W2, D101, AHU-01, etc.
  
  // Reference to source documents
  specRef: text("spec_ref"), // Reference to specification/schedule document
  symbolId: varchar("symbol_id", { length: 100 }), // Legend symbol reference
  
  // Source tracking
  source: varchar("source", { length: 50 }).notNull().default("ai_analysis"), // legend, schedule, specification, ai_analysis
  confidence: decimal("confidence", { precision: 3, scale: 2 }).notNull().default("0.85"), // 0.00-1.00 confidence score
  
  // Additional metadata
  extractedFrom: text("extracted_from"), // Document name or section where classification was extracted
  extractionMethod: varchar("extraction_method", { length: 100 }), // claude_analysis, ocr_pattern, manual
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  elementIdIdx: index("bim_element_classifications_element_id_idx").on(table.elementId),
  primaryTypeIdx: index("bim_element_classifications_primary_type_idx").on(table.primaryType),
  subTypeIdx: index("bim_element_classifications_sub_type_idx").on(table.subType),
  sourceIdx: index("bim_element_classifications_source_idx").on(table.source),
}));

export const insertBimElementClassificationSchema = createInsertSchema(bimElementClassifications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBimElementClassification = z.infer<typeof insertBimElementClassificationSchema>;
export type BimElementClassification = typeof bimElementClassifications.$inferSelect;

// Cost Estimation Tables

// Material pricing database
export const materials = pgTable("materials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  subcategory: varchar("subcategory", { length: 100 }),
  description: text("description"),
  unit: varchar("unit", { length: 20 }).notNull(),
  basePrice: decimal("base_price", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("CAD"),
  supplierId: varchar("supplier_id"),
  region: varchar("region", { length: 100 }).notNull(),
  specifications: jsonb("specifications"),
  properties: jsonb("properties"),
  isActive: boolean("is_active").notNull().default(true),
  effectiveDate: timestamp("effective_date").defaultNow(),
  expiryDate: timestamp("expiry_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
}, (table) => ({
  categoryIdx: index("materials_category_idx").on(table.category),
  regionIdx: index("materials_region_idx").on(table.region),
}));

// Labour rates database
export const labourRates = pgTable("labour_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  trade: varchar("trade", { length: 100 }).notNull(),
  skillLevel: varchar("skill_level", { length: 50 }).notNull(),
  hourlyRate: decimal("hourly_rate", { precision: 8, scale: 2 }).notNull(),
  overtimeRate: decimal("overtime_rate", { precision: 8, scale: 2 }),
  region: varchar("region", { length: 100 }).notNull(),
  unionRate: boolean("union_rate").notNull().default(false),
  benefits: decimal("benefits", { precision: 8, scale: 2 }),
  productivity: decimal("productivity", { precision: 5, scale: 2 }).default("1.00"),
  currency: varchar("currency", { length: 3 }).notNull().default("CAD"),
  effectiveDate: timestamp("effective_date").defaultNow(),
  expiryDate: timestamp("expiry_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
}, (table) => ({
  tradeIdx: index("labour_rates_trade_idx").on(table.trade),
  regionIdx: index("labour_rates_region_idx").on(table.region),
}));

// Equipment rates database
export const equipmentRates = pgTable("equipment_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  type: varchar("type", { length: 100 }).notNull(),
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }),
  dailyRate: decimal("daily_rate", { precision: 10, scale: 2 }),
  weeklyRate: decimal("weekly_rate", { precision: 10, scale: 2 }),
  monthlyRate: decimal("monthly_rate", { precision: 10, scale: 2 }),
  operatingCost: decimal("operating_cost", { precision: 8, scale: 2 }),
  fuelConsumption: decimal("fuel_consumption", { precision: 6, scale: 2 }),
  region: varchar("region", { length: 100 }).notNull(),
  supplierId: varchar("supplier_id"),
  specifications: jsonb("specifications"),
  currency: varchar("currency", { length: 3 }).notNull().default("CAD"),
  isActive: boolean("is_active").notNull().default(true),
  effectiveDate: timestamp("effective_date").defaultNow(),
  expiryDate: timestamp("expiry_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
}, (table) => ({
  categoryIdx: index("equipment_rates_category_idx").on(table.category),
  regionIdx: index("equipment_rates_region_idx").on(table.region),
}));

// Regional cost factors
export const costFactors = pgTable("cost_factors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  region: varchar("region", { length: 100 }).notNull(),
  province: varchar("province", { length: 50 }),
  city: varchar("city", { length: 100 }),
  materialFactor: decimal("material_factor", { precision: 5, scale: 3 }).notNull().default("1.000"),
  labourFactor: decimal("labour_factor", { precision: 5, scale: 3 }).notNull().default("1.000"),
  equipmentFactor: decimal("equipment_factor", { precision: 5, scale: 3 }).notNull().default("1.000"),
  transportFactor: decimal("transport_factor", { precision: 5, scale: 3 }).notNull().default("1.000"),
  overheadFactor: decimal("overhead_factor", { precision: 5, scale: 3 }).notNull().default("1.150"),
  profitMargin: decimal("profit_margin", { precision: 5, scale: 3 }).notNull().default("0.100"),
  taxRate: decimal("tax_rate", { precision: 5, scale: 3 }).notNull().default("0.130"),
  contingency: decimal("contingency", { precision: 5, scale: 3 }).notNull().default("0.050"),
  escalation: decimal("escalation", { precision: 5, scale: 3 }).notNull().default("0.020"),
  effectiveDate: timestamp("effective_date").defaultNow(),
  expiryDate: timestamp("expiry_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
}, (table) => ({
  regionIdx: index("cost_factors_region_idx").on(table.region),
}));

// Suppliers database
export const suppliers = pgTable("suppliers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  contactPerson: varchar("contact_person", { length: 255 }),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  province: varchar("province", { length: 50 }),
  postalCode: varchar("postal_code", { length: 20 }),
  country: varchar("country", { length: 100 }).notNull().default("Canada"),
  website: varchar("website", { length: 255 }),
  rating: decimal("rating", { precision: 3, scale: 1 }),
  certifications: jsonb("certifications"),
  serviceRegions: jsonb("service_regions"),
  specialties: jsonb("specialties"),
  paymentTerms: varchar("payment_terms", { length: 100 }),
  deliveryTime: integer("delivery_time"),
  minimumOrder: decimal("minimum_order", { precision: 10, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
}, (table) => ({
  categoryIdx: index("suppliers_category_idx").on(table.category),
}));

// Cost estimates table
export const costEstimates = pgTable("cost_estimates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  region: varchar("region", { length: 100 }).notNull(),
  estimationType: varchar("estimation_type", { length: 50 }).notNull().default("detailed"),
  status: varchar("status", { length: 50 }).notNull().default("draft"),
  
  // Cost breakdown
  materialCost: decimal("material_cost", { precision: 15, scale: 2 }).notNull().default("0.00"),
  labourCost: decimal("labour_cost", { precision: 15, scale: 2 }).notNull().default("0.00"),
  equipmentCost: decimal("equipment_cost", { precision: 15, scale: 2 }).notNull().default("0.00"),
  subcontractorCost: decimal("subcontractor_cost", { precision: 15, scale: 2 }).notNull().default("0.00"),
  overheadCost: decimal("overhead_cost", { precision: 15, scale: 2 }).notNull().default("0.00"),
  profitAmount: decimal("profit_amount", { precision: 15, scale: 2 }).notNull().default("0.00"),
  contingencyAmount: decimal("contingency_amount", { precision: 15, scale: 2 }).notNull().default("0.00"),
  taxAmount: decimal("tax_amount", { precision: 15, scale: 2 }).notNull().default("0.00"),
  
  subtotal: decimal("subtotal", { precision: 15, scale: 2 }).notNull().default("0.00"),
  totalCost: decimal("total_cost", { precision: 15, scale: 2 }).notNull().default("0.00"),
  
  // Estimation parameters
  estimationData: jsonb("estimation_data"),
  assumptions: jsonb("assumptions"),
  riskFactors: jsonb("risk_factors"),
  
  currency: varchar("currency", { length: 3 }).notNull().default("CAD"),
  validityPeriod: integer("validity_period").default(30),
  createdBy: varchar("created_by").notNull(),
  approvedBy: varchar("approved_by"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
}, (table) => ({
  projectIdIdx: index("cost_estimates_project_id_idx").on(table.projectId),
  statusIdx: index("cost_estimates_status_idx").on(table.status),
}));

// Cost estimate line items
export const costEstimateItems = pgTable("cost_estimate_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => costEstimates.id, { onDelete: "cascade" }),
  category: varchar("category", { length: 100 }).notNull(),
  itemCode: varchar("item_code", { length: 50 }),
  description: text("description").notNull(),
  
  // Quantities and rates
  quantity: decimal("quantity", { precision: 15, scale: 4 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull(),
  unitRate: decimal("unit_rate", { precision: 12, scale: 4 }).notNull(),
  lineTotal: decimal("line_total", { precision: 15, scale: 2 }).notNull(),
  
  // Cost components
  materialCost: decimal("material_cost", { precision: 12, scale: 2 }).default("0.00"),
  labourCost: decimal("labour_cost", { precision: 12, scale: 2 }).default("0.00"),
  equipmentCost: decimal("equipment_cost", { precision: 12, scale: 2 }).default("0.00"),
  subcontractorCost: decimal("subcontractor_cost", { precision: 12, scale: 2 }).default("0.00"),
  
  // References
  materialId: varchar("material_id").references(() => materials.id, { onDelete: "set null" }),
  labourId: varchar("labour_id").references(() => labourRates.id, { onDelete: "set null" }),
  equipmentId: varchar("equipment_id").references(() => equipmentRates.id, { onDelete: "set null" }),
  supplierId: varchar("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  
  // Additional data
  specifications: jsonb("specifications"),
  notes: text("notes"),
  riskLevel: varchar("risk_level", { length: 20 }).default("medium"),
  confidence: decimal("confidence", { precision: 5, scale: 2 }).default("0.80"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
}, (table) => ({
  estimateIdIdx: index("cost_estimate_items_estimate_id_idx").on(table.estimateId),
  categoryIdx: index("cost_estimate_items_category_idx").on(table.category),
}));

// Schema exports for cost estimation
export const insertMaterialSchema = createInsertSchema(materials).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMaterial = z.infer<typeof insertMaterialSchema>;
export type Material = typeof materials.$inferSelect;

export const insertLabourRateSchema = createInsertSchema(labourRates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLabourRate = z.infer<typeof insertLabourRateSchema>;
export type LabourRate = typeof labourRates.$inferSelect;

export const insertEquipmentRateSchema = createInsertSchema(equipmentRates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEquipmentRate = z.infer<typeof insertEquipmentRateSchema>;
export type EquipmentRate = typeof equipmentRates.$inferSelect;

export const insertCostFactorSchema = createInsertSchema(costFactors).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCostFactor = z.infer<typeof insertCostFactorSchema>;
export type CostFactor = typeof costFactors.$inferSelect;

export const insertSupplierSchema = createInsertSchema(suppliers).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliers.$inferSelect;

export const insertCostEstimateSchema = createInsertSchema(costEstimates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCostEstimate = z.infer<typeof insertCostEstimateSchema>;
export type CostEstimate = typeof costEstimates.$inferSelect;

export const insertCostEstimateItemSchema = createInsertSchema(costEstimateItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCostEstimateItem = z.infer<typeof insertCostEstimateItemSchema>;
export type CostEstimateItem = typeof costEstimateItems.$inferSelect;

// Regulatory Analysis Cache schemas
export const insertRegulatoryAnalysisCacheSchema = createInsertSchema(regulatoryAnalysisCache).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRegulatoryAnalysisCache = z.infer<typeof insertRegulatoryAnalysisCacheSchema>;
export type RegulatoryAnalysisCache = typeof regulatoryAnalysisCache.$inferSelect;

export const insertProjectRegulatoryAnalysisSchema = createInsertSchema(projectRegulatoryAnalysis).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProjectRegulatoryAnalysis = z.infer<typeof insertProjectRegulatoryAnalysisSchema>;
export type ProjectRegulatoryAnalysis = typeof projectRegulatoryAnalysis.$inferSelect;

// Document Similarity Cache schemas
export const insertDocumentSimilarityCacheSchema = createInsertSchema(documentSimilarityCache).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastUsed: true,
  usageCount: true,
});
export type InsertDocumentSimilarityCache = z.infer<typeof insertDocumentSimilarityCacheSchema>;
export type DocumentSimilarityCache = typeof documentSimilarityCache.$inferSelect;

// Document Images schemas
export const insertDocumentImageSchema = createInsertSchema(documentImages).omit({
  id: true,
  createdAt: true,
});
export type InsertDocumentImage = z.infer<typeof insertDocumentImageSchema>;
export type DocumentImage = typeof documentImages.$inferSelect;

// Cost items table for regional pricing data
export const costItems = pgTable("cost_items", {
  id: varchar("id").primaryKey(),
  code: varchar("code").notNull(),        // MasterFormat / Uniformat
  description: text("description").notNull(),
  unit: varchar("unit").notNull(),        // m, m², m³, ea
  baseRate: decimal("base_rate").notNull(), // CAD
  region: varchar("region").default("CA-ON"),
  notes: text("notes"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  codeIdx: index("cost_items_code_idx").on(table.code),
  regionIdx: index("cost_items_region_idx").on(table.region),
}));

export const insertCostItemSchema = createInsertSchema(costItems);
export type InsertCostItem = z.infer<typeof insertCostItemSchema>;
export type CostItem = typeof costItems.$inferSelect;

// 🛠️ Product Catalog - Claude-discovered products organized by CSI assemblies
export const productCatalog = pgTable("product_catalog", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  csiDivision: varchar("csi_division", { length: 10 }).notNull(), // "04.20", "03.30", etc.
  assemblyReference: varchar("assembly_reference", { length: 50 }), // "IW3D", "EW1", "Type D1"
  productType: varchar("product_type", { length: 100 }).notNull(), // "concrete", "steel", "masonry"
  
  // Product Details from Claude Analysis
  productName: text("product_name").notNull(), // "30 MPa Concrete", "Sica Portland Cement"
  manufacturer: varchar("manufacturer", { length: 100 }), // "Sica", "Holcim", "Lafarge"
  specifications: text("specifications").notNull(), // Full spec text from Claude
  grade: varchar("grade", { length: 50 }), // "30 MPa", "Grade 350W", "Type I"
  standardCompliance: jsonb("standard_compliance").default("[]"), // ["CSA A23.1", "ASTM C150"]
  
  // Costing
  defaultUnitCost: decimal("default_unit_cost", { precision: 10, scale: 2 }),
  unit: varchar("unit", { length: 20 }).notNull(), // "m3", "kg", "ea"
  availability: varchar("availability", { length: 50 }).default("available"), // available, special_order, discontinued
  
  // Claude Discovery Metadata
  discoveredFromDocument: varchar("discovered_from_document"),
  extractedByClaudeAt: timestamp("extracted_by_claude_at").defaultNow(),
  isClaudeRecommended: boolean("is_claude_recommended").default(false),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  csiDivisionIdx: index("product_catalog_csi_division_idx").on(table.csiDivision),
  assemblyRefIdx: index("product_catalog_assembly_ref_idx").on(table.assemblyReference),
  productTypeIdx: index("product_catalog_product_type_idx").on(table.productType),
  manufacturerIdx: index("product_catalog_manufacturer_idx").on(table.manufacturer),
}));

// 🎯 Element Product Selections - tracks user choices for specific BIM elements
export const elementProductSelections = pgTable("element_product_selections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bimElementId: varchar("bim_element_id").notNull().references(() => bimElements.id, { onDelete: "cascade" }),
  productId: varchar("product_id").references(() => productCatalog.id, { onDelete: "set null" }),
  
  // User Selection Data
  selectionType: productSelectionStatusEnum("selection_type").notNull().default("default"),
  customProductName: text("custom_product_name"), // If user defines custom product
  customUnitCost: decimal("custom_unit_cost", { precision: 10, scale: 2 }),
  customSpecifications: text("custom_specifications"),
  
  // Selection Metadata
  selectedByUser: varchar("selected_by_user"), // User ID who made selection
  selectionReason: text("selection_reason"), // Why user chose this product
  selectionNotes: text("selection_notes"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  bimElementIdx: index("element_product_selections_element_idx").on(table.bimElementId),
  productIdx: index("element_product_selections_product_idx").on(table.productId),
  selectionTypeIdx: index("element_product_selections_type_idx").on(table.selectionType),
  // Ensure one selection per element
  uniqueElementSelection: unique("element_product_unique").on(table.bimElementId),
}));

// Insert and select types for product system
export const insertProductCatalogSchema = createInsertSchema(productCatalog).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProductCatalog = z.infer<typeof insertProductCatalogSchema>;
export type ProductCatalog = typeof productCatalog.$inferSelect;

export const insertElementProductSelectionSchema = createInsertSchema(elementProductSelections).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertElementProductSelection = z.infer<typeof insertElementProductSelectionSchema>;
export type ElementProductSelection = typeof elementProductSelections.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// GRID LINE RECOGNITION SCHEMA — v1.1 §12
// ═══════════════════════════════════════════════════════════════════════════════
//
// 10-table relational schema for professional-grade grid detection, labeling,
// and intersection tracking. Supports:
//   - Multi-format input (RVT, DXF, vector PDF, raster PDF, images)
//   - Non-perpendicular / angled / multi-family grids
//   - Direction-agnostic labeling (no assumption that vertical = letters)
//   - Full audit trail with evidence pointers and confidence scoring
//   - Human-in-the-loop review workflow with correction persistence
//
// Hierarchy:
//   DetectionRun → GridComponent → GridFamily → GridAxis
//                                             → GridMarker → GridLabel
//                                → GridNode ←→ GridAxis (via GridNodeAxes)
//                                             → GridAxisLabel (association)
//   CoordinateTransform (standalone, per project/source)
//
// Standards: CIQS Standard Method, v1.1 Grid Line Recognition Specification
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Grid Detection Enums ────────────────────────────────────────────────────

export const gridInputTypeEnum = pgEnum("grid_input_type", [
  "RVT",           // Revit native (highest reliability)
  "DXF",           // AutoCAD DXF (vector, parsed with ezdxf)
  "DWG",           // AutoCAD DWG (requires ODA/Teigha conversion)
  "PDF_VECTOR",    // Vector PDF (exported drawings)
  "PDF_RASTER",    // Scanned PDF (requires CV + OCR)
  "IMAGE",         // Standalone image (PNG, JPG, TIFF)
]);

export const gridDetectionStatusEnum = pgEnum("grid_detection_status", [
  "SUCCESS",       // Detection completed without errors
  "PARTIAL",       // Detection completed with warnings / low confidence areas
  "FAILED",        // Detection failed — manual review required
]);

export const gridGeometryTypeEnum = pgEnum("grid_geometry_type", [
  "LINE",          // Straight line segment (most common)
  "POLYLINE",      // Multi-segment polyline
  "ARC",           // Curved grid (rare but exists in some structures)
]);

export const gridMarkerShapeEnum = pgEnum("grid_marker_shape", [
  "CIRCLE",        // Standard grid bubble (most common)
  "HEX",           // Hexagonal tag
  "RECT",          // Rectangular tag
  "BLOCK",         // CAD block insert (DXF/DWG)
  "UNKNOWN",       // Detected but shape unclassified
]);

export const gridTextSourceEnum = pgEnum("grid_text_source", [
  "VECTOR_TEXT",   // Extracted from vector text objects (confidence = 1.0)
  "OCR",           // Optical character recognition from raster
]);

export const gridAssociationTypeEnum = pgEnum("grid_association_type", [
  "END_LABEL",     // Label at axis endpoint (most common)
  "MID_LABEL",     // Label along mid-span of axis
  "MARKER_LABEL",  // Label inside a detected marker/bubble
]);

export const gridReviewStatusEnum = pgEnum("grid_review_status", [
  "AUTO",          // Machine-detected, not yet reviewed
  "NEEDS_REVIEW",  // Flagged for human review (low confidence or conflict)
  "CONFIRMED",     // Human-confirmed correct
  "REJECTED",      // Human-rejected (false positive)
]);

export const gridCoordFrameEnum = pgEnum("grid_coord_frame", [
  "MODEL",         // Model/world coordinates (RVT, CAD native units)
  "SHEET",         // Sheet/layout space coordinates
  "PDF_USER",      // PDF user-space coordinates
  "IMAGE_PX",      // Image pixel coordinates
]);

export const gridCalibrationMethodEnum = pgEnum("grid_calibration_method", [
  "RVT_NATIVE",    // Revit native coordinates (no calibration needed)
  "CAD_UNITS",     // CAD file units (INSUNITS header)
  "SHEET_SCALE",   // Scale derived from sheet scale annotation
  "USER_2PT",      // User-defined two-point calibration
  "DIMENSION_REF", // Calibrated against known dimension annotation
  "OTHER",         // Other calibration method
]);

// ─── Table 1: Detection Runs ─────────────────────────────────────────────────
// One execution of the grid detector. Freezes all parameters for auditability.

export const gridDetectionRuns = pgTable("grid_detection_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sourceFileId: varchar("source_file_id").notNull().references(() => documents.id, { onDelete: "cascade" }),

  // What was detected
  sheetId: varchar("sheet_id", { length: 100 }),       // Sheet name/number within multi-sheet file
  viewId: varchar("view_id", { length: 100 }),          // View name (for RVT)
  pageNo: integer("page_no"),                            // Page number (for PDF)

  // Input classification
  inputType: gridInputTypeEnum("input_type").notNull(),

  // Frozen parameters for auditability (v1.1 §13 heuristics)
  parameters: jsonb("parameters").notNull(),             // All thresholds/tolerances used
  // Expected shape: {
  //   candidateMinLengthPct: number,  // §13.1: min segment length as % of content width
  //   straightnessTolDeg: number,     // §13.1: max angular deviation for straightness
  //   angleClusterEpsDeg: number,     // §13.2: DBSCAN angle clustering epsilon
  //   angleClusterMinSupport: number, // §13.2: minimum cluster support
  //   offsetToleranceMm: number,      // §13.3: offset clustering tolerance
  //   gapMergeToleranceMm: number,    // §13.3: gap merge tolerance
  //   markerSearchRadiusPct: number,  // §13.4: bubble search radius as % of diagonal
  //   markerAreaMinPct: number,       // §13.4: min marker area as % of page
  //   markerAreaMaxPct: number,       // §13.4: max marker area as % of page
  //   labelScoreWeights: object,      // §14.2: scoring weights
  //   autoAssignThreshold: number,    // §14.3: auto-assign score threshold
  //   reviewThreshold: number,        // §14.3: needs-review threshold
  // }

  // Tool versions for reproducibility
  toolVersions: jsonb("tool_versions").notNull(),        // Extraction tool versions
  // Expected shape: {
  //   pdfParser: string,
  //   dxfParser: string,
  //   ocrEngine: string,
  //   ocrModel: string,
  //   detectorVersion: string,
  // }

  // Execution
  status: gridDetectionStatusEnum("status").notNull(),
  startedAt: timestamp("started_at").notNull(),
  finishedAt: timestamp("finished_at"),

  // Audit
  triggeredBy: varchar("triggered_by", { length: 100 }), // "auto", "manual", user ID
  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  projectIdx: index("grid_detection_runs_project_idx").on(table.projectId),
  sourceFileIdx: index("grid_detection_runs_source_file_idx").on(table.sourceFileId),
  statusIdx: index("grid_detection_runs_status_idx").on(table.status),
}));

// ─── Table 2: Grid Components ────────────────────────────────────────────────
// A connected grid network on a given sheet/view/model.
// Supports rotated wings, partial grids, and multiple independent networks.

export const gridComponents = pgTable("grid_components", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => gridDetectionRuns.id, { onDelete: "cascade" }),

  name: varchar("name", { length: 100 }),               // Optional: "Main", "Annex-Rotated", etc.

  // Bounding box in primary coordinate frame
  bboxMinX: decimal("bbox_min_x", { precision: 15, scale: 6 }).notNull(),
  bboxMinY: decimal("bbox_min_y", { precision: 15, scale: 6 }).notNull(),
  bboxMaxX: decimal("bbox_max_x", { precision: 15, scale: 6 }).notNull(),
  bboxMaxY: decimal("bbox_max_y", { precision: 15, scale: 6 }).notNull(),

  primaryFrame: gridCoordFrameEnum("primary_frame").notNull(),
  confidence: decimal("confidence", { precision: 4, scale: 3 }).notNull(), // 0.000–1.000

  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  runIdx: index("grid_components_run_idx").on(table.runId),
}));

// ─── Table 3: Grid Families ──────────────────────────────────────────────────
// Orientation cluster: a set of approximately parallel axes within a component.
// Supports N families (not just 2) for angled/skewed grids per v1.1 §7.

export const gridFamilies = pgTable("grid_families", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  componentId: varchar("component_id").notNull().references(() => gridComponents.id, { onDelete: "cascade" }),

  // Representative orientation (v1.1 §4.2)
  thetaDeg: decimal("theta_deg", { precision: 8, scale: 4 }).notNull(),     // Angle in [0, 180) degrees
  directionVecX: decimal("direction_vec_x", { precision: 10, scale: 8 }).notNull(), // Unit direction vector X
  directionVecY: decimal("direction_vec_y", { precision: 10, scale: 8 }).notNull(), // Unit direction vector Y
  normalVecX: decimal("normal_vec_x", { precision: 10, scale: 8 }).notNull(),       // Unit normal vector X
  normalVecY: decimal("normal_vec_y", { precision: 10, scale: 8 }).notNull(),       // Unit normal vector Y

  familyRank: integer("family_rank"),                    // 1..N by dominance (total axis length)
  confidence: decimal("confidence", { precision: 4, scale: 3 }).notNull(),

  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  componentIdx: index("grid_families_component_idx").on(table.componentId),
}));

// ─── Table 4: Grid Axes ─────────────────────────────────────────────────────
// A single consolidated grid axis with geometry and confidence.
// Represents the final merged line after segment consolidation (v1.1 §4.3).

export const gridAxes = pgTable("grid_axes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  familyId: varchar("family_id").notNull().references(() => gridFamilies.id, { onDelete: "cascade" }),

  // Geometry
  geometryType: gridGeometryTypeEnum("geometry_type").notNull(),

  // Line endpoints in primary coordinate frame (required for LINE type)
  p0X: decimal("p0_x", { precision: 15, scale: 6 }),
  p0Y: decimal("p0_y", { precision: 15, scale: 6 }),
  p1X: decimal("p1_x", { precision: 15, scale: 6 }),
  p1Y: decimal("p1_y", { precision: 15, scale: 6 }),

  // For POLYLINE: array of points [{x, y}, ...]
  polylinePoints: jsonb("polyline_points"),

  // Signed offset along family normal (for geometric ordering within family)
  offsetD: decimal("offset_d", { precision: 15, scale: 6 }).notNull(),

  // Optional parametric extent along family direction
  extentMinT: decimal("extent_min_t", { precision: 15, scale: 6 }),
  extentMaxT: decimal("extent_max_t", { precision: 15, scale: 6 }),

  // Style cues for debugging/QA
  axisStyle: jsonb("axis_style"),
  // Expected shape: { layer?: string, linetype?: string, strokeWidth?: number, color?: string }

  // Segment statistics (from merging step)
  segmentCount: integer("segment_count"),                 // How many raw segments merged into this axis
  totalMergedLength: decimal("total_merged_length", { precision: 12, scale: 3 }), // Total length in primary frame units

  // Confidence and review status
  confidence: decimal("confidence", { precision: 4, scale: 3 }).notNull(),
  status: gridReviewStatusEnum("status").notNull().default("AUTO"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  familyIdx: index("grid_axes_family_idx").on(table.familyId),
  statusIdx: index("grid_axes_status_idx").on(table.status),
  offsetIdx: index("grid_axes_offset_idx").on(table.offsetD),
}));

// ─── Table 5: Grid Markers ──────────────────────────────────────────────────
// Detected grid bubble/tag symbol near axis endpoints or along axis.
// v1.1 §5.1 step 18-19.

export const gridMarkers = pgTable("grid_markers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  axisId: varchar("axis_id").references(() => gridAxes.id, { onDelete: "set null" }), // Null if not yet associated

  markerShape: gridMarkerShapeEnum("marker_shape"),

  // Center coordinates in primary frame
  centerX: decimal("center_x", { precision: 15, scale: 6 }).notNull(),
  centerY: decimal("center_y", { precision: 15, scale: 6 }).notNull(),

  // Bounding box for overlay rendering and OCR cropping
  bbox: jsonb("bbox").notNull(),
  // Expected shape: { minX: number, minY: number, maxX: number, maxY: number }

  confidence: decimal("confidence", { precision: 4, scale: 3 }).notNull(),

  // Evidence pointer: file, page, and drawing coordinates
  evidenceFileId: varchar("evidence_file_id").references(() => documents.id, { onDelete: "set null" }),
  evidencePage: integer("evidence_page"),
  evidenceBbox: jsonb("evidence_bbox"),               // Bounding box in source coordinates

  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  axisIdx: index("grid_markers_axis_idx").on(table.axisId),
}));

// ─── Table 6: Grid Labels ───────────────────────────────────────────────────
// Extracted text token from vector text or OCR. Stores both raw and normalized.
// v1.1 §5.1 step 20-21.

export const gridLabels = pgTable("grid_labels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  markerId: varchar("marker_id").references(() => gridMarkers.id, { onDelete: "set null" }), // If extracted from marker region

  // Text content
  rawText: text("raw_text").notNull(),                   // Exactly as extracted (e.g., "A", "01", "G-3")
  normText: varchar("norm_text", { length: 20 }),        // Normalized token: trimmed, uppercased, OCR corrected
  // Normalization: trim, uppercase, fix O→0, I→1 per context (v1.1 §5.1 step 21)

  textSource: gridTextSourceEnum("text_source").notNull(),
  textConfidence: decimal("text_confidence", { precision: 4, scale: 3 }).notNull(), // OCR confidence or 1.0 for vector

  // Location in primary frame
  bbox: jsonb("bbox").notNull(),
  // Expected shape: { minX: number, minY: number, maxX: number, maxY: number }

  // Evidence pointer
  evidenceFileId: varchar("evidence_file_id").references(() => documents.id, { onDelete: "set null" }),
  evidencePage: integer("evidence_page"),

  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  markerIdx: index("grid_labels_marker_idx").on(table.markerId),
  normTextIdx: index("grid_labels_norm_text_idx").on(table.normText),
}));

// ─── Table 7: Grid Axis Labels (Association) ────────────────────────────────
// Links labels to axes with scored, auditable associations.
// v1.1 §14: weighted scoring with configurable thresholds.

export const gridAxisLabels = pgTable("grid_axis_labels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  axisId: varchar("axis_id").notNull().references(() => gridAxes.id, { onDelete: "cascade" }),
  labelId: varchar("label_id").notNull().references(() => gridLabels.id, { onDelete: "cascade" }),

  // Association scoring (v1.1 §14.1-14.2)
  scoreTotal: decimal("score_total", { precision: 4, scale: 3 }).notNull(),  // 0.000–1.000
  scoreBreakdown: jsonb("score_breakdown").notNull(),
  // Expected shape: {
  //   endpointProximity: number,     // S_end: 0-1 (weight 0.35)
  //   perpendicularDistance: number,  // S_perp: 0-1 (weight 0.25)
  //   directionalAlignment: number,  // S_align: 0-1 (weight 0.15)
  //   markerSupport: number,         // S_mark: 0-1 (weight 0.15)
  //   textQuality: number,           // S_text: 0-1 (weight 0.10)
  // }

  associationType: gridAssociationTypeEnum("association_type").notNull(),
  status: gridReviewStatusEnum("status").notNull().default("AUTO"),
  // Decision thresholds (v1.1 §14.3):
  //   AUTO if scoreTotal >= 0.75 and margin >= 0.10
  //   NEEDS_REVIEW if 0.55 <= scoreTotal < 0.75 or margin < 0.10
  //   Unassigned if scoreTotal < 0.55

  // Reviewer info (populated during human-in-the-loop review)
  reviewedBy: varchar("reviewed_by", { length: 100 }),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  axisIdx: index("grid_axis_labels_axis_idx").on(table.axisId),
  labelIdx: index("grid_axis_labels_label_idx").on(table.labelId),
  statusIdx: index("grid_axis_labels_status_idx").on(table.status),
  // One confirmed label per axis per review cycle
  uniqueConfirmedLabel: unique("grid_axis_labels_unique_confirmed").on(table.axisId, table.status),
}));

// ─── Table 8: Grid Nodes ────────────────────────────────────────────────────
// Intersection points between axes from different families.
// v1.1 §4.4 steps 14-16. Used for element placement and downstream referencing.

export const gridNodes = pgTable("grid_nodes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  componentId: varchar("component_id").notNull().references(() => gridComponents.id, { onDelete: "cascade" }),

  // Intersection coordinates in component primary frame
  x: decimal("x", { precision: 15, scale: 6 }).notNull(),
  y: decimal("y", { precision: 15, scale: 6 }).notNull(),

  // Derived reference label (e.g., "A-1", "B-04") populated after label association
  referenceLabel: varchar("reference_label", { length: 20 }),

  // Confidence based on contributing axis confidences + intersection validity
  confidence: decimal("confidence", { precision: 4, scale: 3 }).notNull(),

  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  componentIdx: index("grid_nodes_component_idx").on(table.componentId),
  coordIdx: index("grid_nodes_coord_idx").on(table.x, table.y),
  refLabelIdx: index("grid_nodes_ref_label_idx").on(table.referenceLabel),
}));

// ─── Table 9: Grid Node Axes (Link Table) ───────────────────────────────────
// Many-to-many: which axes contribute to each intersection node.
// Supports multi-family intersections and curved grids.

export const gridNodeAxes = pgTable("grid_node_axes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  nodeId: varchar("node_id").notNull().references(() => gridNodes.id, { onDelete: "cascade" }),
  axisId: varchar("axis_id").notNull().references(() => gridAxes.id, { onDelete: "cascade" }),

  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  nodeIdx: index("grid_node_axes_node_idx").on(table.nodeId),
  axisIdx: index("grid_node_axes_axis_idx").on(table.axisId),
  uniqueNodeAxis: unique("grid_node_axes_unique").on(table.nodeId, table.axisId),
}));

// ─── Table 10: Coordinate Transforms ────────────────────────────────────────
// Persisted affine transforms between coordinate frames.
// v1.1 §8: units, scale, and world coordinate mapping.

export const gridCoordinateTransforms = pgTable("grid_coordinate_transforms", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),

  // Source references
  sourceFileId: varchar("source_file_id").references(() => documents.id, { onDelete: "set null" }),
  sheetId: varchar("sheet_id", { length: 100 }),
  pageNo: integer("page_no"),

  // Transform definition
  fromFrame: gridCoordFrameEnum("from_frame").notNull(),
  toFrame: gridCoordFrameEnum("to_frame").notNull(),

  // Affine transform matrix: [[a, b, tx], [c, d, ty]]
  // For 2D affine: x' = a*x + b*y + tx, y' = c*x + d*y + ty
  matrix2x3: jsonb("matrix_2x3").notNull(),
  // Expected shape: [[number, number, number], [number, number, number]]

  // Explicit components (redundant with matrix, but useful for queries)
  scale: decimal("scale", { precision: 15, scale: 10 }),
  rotationDeg: decimal("rotation_deg", { precision: 10, scale: 6 }),
  translationX: decimal("translation_x", { precision: 15, scale: 6 }),
  translationY: decimal("translation_y", { precision: 15, scale: 6 }),

  // Calibration metadata
  calibrationMethod: gridCalibrationMethodEnum("calibration_method").notNull(),
  rmsError: decimal("rms_error", { precision: 10, scale: 6 }),  // Calibration error if derived

  // Source units
  sourceUnit: varchar("source_unit", { length: 20 }),    // "mm", "m", "ft", "in", "px"
  targetUnit: varchar("target_unit", { length: 20 }),    // "m" (always normalize to meters)

  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  projectIdx: index("grid_coord_transforms_project_idx").on(table.projectId),
  sourceFileIdx: index("grid_coord_transforms_source_file_idx").on(table.sourceFileId),
}));

// ─── Insert Schemas & Type Exports ──────────────────────────────────────────

export const insertGridDetectionRunSchema = createInsertSchema(gridDetectionRuns).omit({ id: true, createdAt: true });
export type InsertGridDetectionRun = z.infer<typeof insertGridDetectionRunSchema>;
export type GridDetectionRun = typeof gridDetectionRuns.$inferSelect;

export const insertGridComponentSchema = createInsertSchema(gridComponents).omit({ id: true, createdAt: true });
export type InsertGridComponent = z.infer<typeof insertGridComponentSchema>;
export type GridComponent = typeof gridComponents.$inferSelect;

export const insertGridFamilySchema = createInsertSchema(gridFamilies).omit({ id: true, createdAt: true });
export type InsertGridFamily = z.infer<typeof insertGridFamilySchema>;
export type GridFamily = typeof gridFamilies.$inferSelect;

export const insertGridAxisSchema = createInsertSchema(gridAxes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGridAxis = z.infer<typeof insertGridAxisSchema>;
export type GridAxis = typeof gridAxes.$inferSelect;

export const insertGridMarkerSchema = createInsertSchema(gridMarkers).omit({ id: true, createdAt: true });
export type InsertGridMarker = z.infer<typeof insertGridMarkerSchema>;
export type GridMarker = typeof gridMarkers.$inferSelect;

export const insertGridLabelSchema = createInsertSchema(gridLabels).omit({ id: true, createdAt: true });
export type InsertGridLabel = z.infer<typeof insertGridLabelSchema>;
export type GridLabel = typeof gridLabels.$inferSelect;

export const insertGridAxisLabelSchema = createInsertSchema(gridAxisLabels).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGridAxisLabel = z.infer<typeof insertGridAxisLabelSchema>;
export type GridAxisLabel = typeof gridAxisLabels.$inferSelect;

export const insertGridNodeSchema = createInsertSchema(gridNodes).omit({ id: true, createdAt: true });
export type InsertGridNode = z.infer<typeof insertGridNodeSchema>;
export type GridNode = typeof gridNodes.$inferSelect;

export const insertGridNodeAxisSchema = createInsertSchema(gridNodeAxes).omit({ id: true, createdAt: true });
export type InsertGridNodeAxis = z.infer<typeof insertGridNodeAxisSchema>;
export type GridNodeAxis = typeof gridNodeAxes.$inferSelect;

export const insertGridCoordinateTransformSchema = createInsertSchema(gridCoordinateTransforms).omit({ id: true, createdAt: true });
export type InsertGridCoordinateTransform = z.infer<typeof insertGridCoordinateTransformSchema>;
export type GridCoordinateTransform = typeof gridCoordinateTransforms.$inferSelect;

// ─── Notifications ───────────────────────────────────────────────────────────
// In-app notifications for users: BIM complete, estimate ready, RFI update, etc.

export const notificationTypeEnum = pgEnum("notification_type", [
  "bim_complete", "estimate_ready", "rfi_update", "compliance_alert",
  "document_processed", "analysis_complete", "system", "mention"
]);

export const notifications = pgTable("notifications", {
  id:        varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  userId:    varchar("user_id", { length: 36 }).notNull()
               .references(() => users.id, { onDelete: "cascade" }),
  projectId: varchar("project_id", { length: 36 })
               .references(() => projects.id, { onDelete: "cascade" }),
  type:      notificationTypeEnum("type").notNull().default("system"),
  title:     varchar("title", { length: 255 }).notNull(),
  message:   text("message").notNull(),
  link:      varchar("link", { length: 500 }),        // optional deep-link URL
  isRead:    boolean("is_read").notNull().default(false),
  metadata:  jsonb("metadata"),                        // arbitrary extra data
  createdAt: timestamp("created_at").defaultNow().notNull(),
  readAt:    timestamp("read_at"),
}, (table) => ({
  userIdx:    index("notifications_user_idx").on(table.userId),
  projectIdx: index("notifications_project_idx").on(table.projectId),
  readIdx:    index("notifications_read_idx").on(table.isRead),
  createdIdx: index("notifications_created_idx").on(table.createdAt),
  userReadIdx: index("notifications_user_read_idx").on(table.userId, table.isRead),
}));

export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// ─── System Alerts ───────────────────────────────────────────────────────────
// Admin-visible operational alerts: DB lag, queue backup, high token usage, etc.

export const alertSeverityEnum = pgEnum("alert_severity", [
  "info", "warning", "error", "critical"
]);

export const systemAlerts = pgTable("system_alerts", {
  id:           varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  severity:     alertSeverityEnum("severity").notNull().default("info"),
  source:       varchar("source", { length: 100 }).notNull(),  // e.g. "bim-generator", "db", "stripe"
  title:        varchar("title", { length: 255 }).notNull(),
  message:      text("message").notNull(),
  isResolved:   boolean("is_resolved").notNull().default(false),
  resolvedAt:   timestamp("resolved_at"),
  resolvedBy:   varchar("resolved_by", { length: 36 })
                  .references(() => users.id, { onDelete: "set null" }),
  metadata:     jsonb("metadata"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  severityIdx:    index("system_alerts_severity_idx").on(table.severity),
  resolvedIdx:    index("system_alerts_resolved_idx").on(table.isResolved),
  createdIdx:     index("system_alerts_created_idx").on(table.createdAt),
}));

export const insertSystemAlertSchema = createInsertSchema(systemAlerts).omit({ id: true, createdAt: true });
export type InsertSystemAlert = z.infer<typeof insertSystemAlertSchema>;
export type SystemAlert = typeof systemAlerts.$inferSelect;

// ─── User Settings ────────────────────────────────────────────────────────────
// Persisted per-user preferences: theme, notifications, units, language.

export const userSettings = pgTable("user_settings", {
  id:              varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  userId:          varchar("user_id", { length: 36 }).notNull().unique()
                     .references(() => users.id, { onDelete: "cascade" }),
  // Display
  theme:           varchar("theme", { length: 20 }).notNull().default("light"),
  language:        varchar("language", { length: 10 }).notNull().default("en"),
  // Units
  measurementUnit: varchar("measurement_unit", { length: 10 }).notNull().default("metric"),
  currency:        varchar("currency", { length: 5 }).notNull().default("CAD"),
  // Notifications
  notifyEmail:     boolean("notify_email").notNull().default(true),
  notifyPush:      boolean("notify_push").notNull().default(false),
  notifyBimDone:   boolean("notify_bim_done").notNull().default(true),
  notifyRfiUpdate: boolean("notify_rfi_update").notNull().default(true),
  // Privacy
  analyticsEnabled: boolean("analytics_enabled").notNull().default(true),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("user_settings_user_idx").on(table.userId),
}));

export const insertUserSettingsSchema = createInsertSchema(userSettings).omit({ id: true, updatedAt: true });
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;
export type UserSettings = typeof userSettings.$inferSelect;

// ─── Est-3: Estimate Snapshots ───────────────────────────────────────────────
// Persists estimate version snapshots that were previously lost in-memory.
export const estimateSnapshots = pgTable("estimate_snapshots", {
  id:             varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  modelId:        varchar("model_id").notNull(),
  revisionNumber: integer("revision_number").notNull(),
  revisionLabel:  varchar("revision_label", { length: 20 }).notNull(),
  note:           text("note"),
  snapshot:       jsonb("snapshot").notNull(),          // Full EstimateSnapshot JSON
  createdAt:      timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ modelIdx: index("est_snap_model_idx").on(t.modelId) }));

export const insertEstimateSnapshotSchema = createInsertSchema(estimateSnapshots).omit({ id: true, createdAt: true });
export type InsertEstimateSnapshot = z.infer<typeof insertEstimateSnapshotSchema>;
export type EstimateSnapshotRow = typeof estimateSnapshots.$inferSelect;

// ─── Est-3: Vendor Quotes ────────────────────────────────────────────────────
export const vendorQuotes = pgTable("vendor_quotes", {
  id:           varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  modelId:      varchar("model_id").notNull(),
  vendorName:   varchar("vendor_name", { length: 255 }).notNull(),
  csiDivision:  varchar("csi_division", { length: 20 }),
  description:  text("description"),
  amount:       decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency:     varchar("currency", { length: 5 }).notNull().default("CAD"),
  validUntil:   timestamp("valid_until"),
  quoteData:    jsonb("quote_data").notNull(),           // Full VendorQuote JSON
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ modelIdx: index("vendor_quote_model_idx").on(t.modelId) }));

export const insertVendorQuoteSchema = createInsertSchema(vendorQuotes).omit({ id: true, createdAt: true });
export type InsertVendorQuote = z.infer<typeof insertVendorQuoteSchema>;
export type VendorQuoteRow = typeof vendorQuotes.$inferSelect;

// ─── Est-3: Estimate Alternates ──────────────────────────────────────────────
export const estimateAlternates = pgTable("estimate_alternates", {
  id:            varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  modelId:       varchar("model_id").notNull(),
  title:         varchar("title", { length: 255 }).notNull(),
  description:   text("description"),
  deltaAmount:   decimal("delta_amount", { precision: 12, scale: 2 }),
  currency:      varchar("currency", { length: 5 }).notNull().default("CAD"),
  alternateData: jsonb("alternate_data").notNull(),      // Full alternate JSON
  createdAt:     timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ modelIdx: index("est_alt_model_idx").on(t.modelId) }));

export const insertEstimateAlternateSchema = createInsertSchema(estimateAlternates).omit({ id: true, createdAt: true });
export type InsertEstimateAlternate = z.infer<typeof insertEstimateAlternateSchema>;
export type EstimateAlternateRow = typeof estimateAlternates.$inferSelect;

// ─── Est-3: Estimate RFIs (estimator module, distinct from project rfis) ─────
export const estimateRfis = pgTable("estimate_rfis", {
  id:          varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  modelId:     varchar("model_id").notNull(),
  rfiNumber:   integer("rfi_number").notNull(),
  subject:     text("subject").notNull(),
  priority:    varchar("priority", { length: 20 }).notNull().default("normal"),
  status:      varchar("status", { length: 30 }).notNull().default("draft"),
  rfiData:     jsonb("rfi_data").notNull(),              // Full RFI JSON
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ modelIdx: index("est_rfi_model_idx").on(t.modelId) }));

export const insertEstimateRfiSchema = createInsertSchema(estimateRfis).omit({ id: true, createdAt: true });
export type InsertEstimateRfi = z.infer<typeof insertEstimateRfiSchema>;
export type EstimateRfiRow = typeof estimateRfis.$inferSelect;

// ─── Construction Sequence (AI-proposed → QS-confirmed → P6 export) ──────────
//
// Lifecycle:
//   proposed  → AI has generated activities; awaiting QS review
//   confirmed → QS has reviewed, edited, and approved; ready for P6 export
//   exported  → XER / MS-Project XML has been generated and downloaded
//   rejected  → QS rejected the proposal; a new one must be regenerated
//
// One sequence per model. Superseding proposal replaces the previous one.
// ─────────────────────────────────────────────────────────────────────────────
export const constructionSequences = pgTable("construction_sequences", {
  id:            varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId:     varchar("project_id").notNull(),
  modelId:       varchar("model_id").notNull(),

  // Lifecycle status
  status:        varchar("status", { length: 20 }).notNull().default("proposed"),
  //   proposed | confirmed | exported | rejected

  // AI proposal — full structured sequence JSON
  // Shape: { activities: SequenceActivity[], rationale: string, warnings: string[] }
  proposedData:  jsonb("proposed_data").notNull(),

  // QS-edited version — null until the QS confirms
  // Shape: same as proposedData but may have reordered/edited activities
  confirmedData: jsonb("confirmed_data"),

  // Who confirmed and when
  confirmedBy:   varchar("confirmed_by"),
  confirmedAt:   timestamp("confirmed_at"),

  // QS notes attached at confirmation time
  qsNotes:       text("qs_notes"),

  // Export audit trail
  lastExportedAt: timestamp("last_exported_at"),
  lastExportFormat: varchar("last_export_format", { length: 20 }),
  //   xer | ms-project-xml | json

  // AI rationale summary (surfaced in UI)
  aiRationale:   text("ai_rationale"),
  aiWarnings:    jsonb("ai_warnings"),  // string[]

  // Project calendar basis
  projectStartDate: varchar("project_start_date"),  // ISO date
  workingDaysPerWeek: integer("working_days_per_week").default(5),
  holidays: jsonb("holidays"),  // string[] of ISO dates

  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  projectIdx: index("cs_project_idx").on(t.projectId),
  modelIdx:   index("cs_model_idx").on(t.modelId),
  statusIdx:  index("cs_status_idx").on(t.status),
}));

export const insertConstructionSequenceSchema = createInsertSchema(constructionSequences).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertConstructionSequence = z.infer<typeof insertConstructionSequenceSchema>;
export type ConstructionSequenceRow = typeof constructionSequences.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// ESTIMATION RATE TABLES — Database-backed rates (replaces hardcoded CSI_RATES)
// ═══════════════════════════════════════════════════════════════════════════════

export const rateSourceEnum = pgEnum("rate_source", [
  "system_default",    // Seeded from hardcoded CSI_RATES baseline
  "user_override",     // Manually edited by user/admin
  "vendor_quote",      // From a vendor quote
  "rsmeans",           // From RSMeans API
]);

// ── Unit Rates table — replaces CSI_RATES constant in estimate-engine.ts ──
export const unitRates = pgTable("unit_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  csiCode: varchar("csi_code", { length: 50 }).notNull(),
  description: text("description").notNull(),
  unit: varchar("unit", { length: 20 }).notNull(),
  materialRate: decimal("material_rate", { precision: 12, scale: 2 }).notNull().default("0.00"),
  laborRate: decimal("labor_rate", { precision: 12, scale: 2 }).notNull().default("0.00"),
  equipmentRate: decimal("equipment_rate", { precision: 12, scale: 2 }).notNull().default("0.00"),
  crewSize: decimal("crew_size", { precision: 5, scale: 1 }).notNull().default("1"),
  productivityRate: decimal("productivity_rate", { precision: 8, scale: 3 }).notNull().default("1.000"),
  source: rateSourceEnum("source").notNull().default("system_default"),
  region: varchar("region", { length: 100 }),  // null = global baseline
  effectiveDate: timestamp("effective_date").defaultNow(),
  expiryDate: timestamp("expiry_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  csiCodeIdx: index("unit_rates_csi_code_idx").on(t.csiCode),
  regionIdx: index("unit_rates_region_idx").on(t.region),
  csiRegionUniq: unique("unit_rates_csi_region_uniq").on(t.csiCode, t.region),
}));

export const insertUnitRateSchema = createInsertSchema(unitRates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUnitRate = z.infer<typeof insertUnitRateSchema>;
export type UnitRate = typeof unitRates.$inferSelect;

// ── MEP Rates table — replaces hardcoded ontario-mep-rates arrays ──
export const mepRates = pgTable("mep_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  csiCode: varchar("csi_code", { length: 50 }).notNull(),
  division: varchar("division", { length: 10 }).notNull(),  // "21", "22", "23", "26", "27", "28"
  description: text("description").notNull(),
  unit: varchar("unit", { length: 20 }).notNull(),
  materialRate: decimal("material_rate", { precision: 12, scale: 2 }).notNull().default("0.00"),
  labourRate: decimal("labour_rate", { precision: 12, scale: 2 }).notNull().default("0.00"),
  unitRate: decimal("unit_rate", { precision: 12, scale: 2 }).notNull().default("0.00"),
  labourHoursPerUnit: decimal("labour_hours_per_unit", { precision: 8, scale: 3 }).notNull().default("1.000"),
  tradeLocal: varchar("trade_local", { length: 100 }),  // e.g., "UA Local 46"
  collectiveAgreementYear: integer("collective_agreement_year"),
  source: rateSourceEnum("source").notNull().default("system_default"),
  region: varchar("region", { length: 100 }),
  effectiveDate: timestamp("effective_date").defaultNow(),
  expiryDate: timestamp("expiry_date"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  csiCodeIdx: index("mep_rates_csi_code_idx").on(t.csiCode),
  divisionIdx: index("mep_rates_division_idx").on(t.division),
  csiRegionUniq: unique("mep_rates_csi_region_uniq").on(t.csiCode, t.region),
}));

export const insertMepRateSchema = createInsertSchema(mepRates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMepRate = z.infer<typeof insertMepRateSchema>;
export type MepRate = typeof mepRates.$inferSelect;

// ── Regional Factors table — replaces CANADIAN_PROVINCIAL_FACTORS constant ──
export const regionalFactors = pgTable("regional_factors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  regionKey: varchar("region_key", { length: 100 }).notNull(),
  regionLabel: varchar("region_label", { length: 200 }).notNull(),
  province: varchar("province", { length: 50 }).notNull(),
  compositeIndex: decimal("composite_index", { precision: 5, scale: 3 }).notNull().default("1.000"),
  materialIndex: decimal("material_index", { precision: 5, scale: 3 }).notNull().default("1.000"),
  laborIndex: decimal("labor_index", { precision: 5, scale: 3 }).notNull().default("1.000"),
  equipmentIndex: decimal("equipment_index", { precision: 5, scale: 3 }).notNull().default("1.000"),
  transportFactor: decimal("transport_factor", { precision: 5, scale: 3 }).notNull().default("1.000"),
  remoteFactor: decimal("remote_factor", { precision: 5, scale: 3 }).notNull().default("1.000"),
  hstGstRate: decimal("hst_gst_rate", { precision: 5, scale: 3 }).notNull().default("0.130"),
  pstRate: decimal("pst_rate", { precision: 5, scale: 3 }).notNull().default("0.000"),
  taxDescription: varchar("tax_description", { length: 100 }),
  source: varchar("source", { length: 255 }),
  effectiveDate: timestamp("effective_date").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  regionKeyUniq: unique("regional_factors_region_key_uniq").on(t.regionKey),
}));

export const insertRegionalFactorSchema = createInsertSchema(regionalFactors).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRegionalFactor = z.infer<typeof insertRegionalFactorSchema>;
export type RegionalFactor = typeof regionalFactors.$inferSelect;

// ── Project OH&P Configuration — replaces in-memory Map in ohp-configuration.ts ──
export const projectOhpConfigs = pgTable("project_ohp_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  overheadPct: decimal("overhead_pct", { precision: 5, scale: 3 }).notNull().default("0.150"),
  overheadSource: varchar("overhead_source", { length: 30 }).notNull().default("SYSTEM_FALLBACK"),
  overheadConfidence: varchar("overhead_confidence", { length: 10 }).notNull().default("LOW"),
  profitPct: decimal("profit_pct", { precision: 5, scale: 3 }).notNull().default("0.100"),
  profitSource: varchar("profit_source", { length: 30 }).notNull().default("SYSTEM_FALLBACK"),
  profitConfidence: varchar("profit_confidence", { length: 10 }).notNull().default("LOW"),
  contingencyPct: decimal("contingency_pct", { precision: 5, scale: 3 }).notNull().default("0.050"),
  contingencySource: varchar("contingency_source", { length: 30 }).notNull().default("SYSTEM_FALLBACK"),
  contingencyConfidence: varchar("contingency_confidence", { length: 10 }).notNull().default("LOW"),
  applyToSubcontractorCosts: boolean("apply_to_subcontractor_costs").notNull().default(true),
  applyToEquipmentCosts: boolean("apply_to_equipment_costs").notNull().default(true),
  projectNotes: text("project_notes"),
  updatedBy: varchar("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  projectIdUniq: unique("project_ohp_project_uniq").on(t.projectId),
}));

export const insertProjectOhpConfigSchema = createInsertSchema(projectOhpConfigs).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectOhpConfig = z.infer<typeof insertProjectOhpConfigSchema>;
export type ProjectOhpConfig = typeof projectOhpConfigs.$inferSelect;

// ── Rate Audit Log — tracks who changed which rates and when ──
export const rateAuditLog = pgTable("rate_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tableName: varchar("table_name", { length: 50 }).notNull(), // "unit_rates", "mep_rates", "regional_factors", "project_ohp_configs"
  recordId: varchar("record_id").notNull(),
  action: varchar("action", { length: 20 }).notNull(), // "create", "update", "delete", "import"
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  userName: varchar("user_name", { length: 100 }),
  fieldChanges: jsonb("field_changes"), // { field: { old: val, new: val } }
  metadata: jsonb("metadata"), // extra context: import source, CSV filename, etc.
  ipAddress: varchar("ip_address", { length: 45 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  tableNameIdx: index("rate_audit_table_name_idx").on(t.tableName),
  recordIdIdx: index("rate_audit_record_id_idx").on(t.recordId),
  userIdIdx: index("rate_audit_user_id_idx").on(t.userId),
  createdAtIdx: index("rate_audit_created_at_idx").on(t.createdAt),
}));

export const insertRateAuditLogSchema = createInsertSchema(rateAuditLog).omit({ id: true, createdAt: true });
export type InsertRateAuditLog = z.infer<typeof insertRateAuditLogSchema>;
export type RateAuditLog = typeof rateAuditLog.$inferSelect;

// ── Rate Versions — full snapshot of rate before each change ──
export const rateVersions = pgTable("rate_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tableName: varchar("table_name", { length: 50 }).notNull(),
  recordId: varchar("record_id").notNull(),
  version: integer("version").notNull().default(1),
  snapshot: jsonb("snapshot").notNull(), // full row data at this version
  changedBy: varchar("changed_by").references(() => users.id, { onDelete: "set null" }),
  changedByName: varchar("changed_by_name", { length: 100 }),
  changeReason: text("change_reason"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  tableRecordIdx: index("rate_versions_table_record_idx").on(t.tableName, t.recordId),
  versionIdx: index("rate_versions_version_idx").on(t.version),
  tableRecordVersionUniq: unique("rate_versions_table_record_version_uniq").on(t.tableName, t.recordId, t.version),
}));

export const insertRateVersionSchema = createInsertSchema(rateVersions).omit({ id: true, createdAt: true });
export type InsertRateVersion = z.infer<typeof insertRateVersionSchema>;
export type RateVersion = typeof rateVersions.$inferSelect;

// ── BIM Transaction History — undo/redo audit trail ──
export const bimTransactions = pgTable("bim_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  modelId: varchar("model_id").notNull(),
  projectId: varchar("project_id").notNull(),
  description: text("description").notNull(),
  changes: jsonb("changes").notNull(), // PropertyChange[] — elementId, property, oldValue, newValue
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  userName: varchar("user_name", { length: 100 }),
  undone: boolean("undone").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  modelIdIdx: index("bim_tx_model_id_idx").on(t.modelId),
  projectIdIdx: index("bim_tx_project_id_idx").on(t.projectId),
  createdAtIdx: index("bim_tx_created_at_idx").on(t.createdAt),
}));

export const insertBimTransactionSchema = createInsertSchema(bimTransactions).omit({ id: true, createdAt: true });
export type InsertBimTransaction = z.infer<typeof insertBimTransactionSchema>;
export type BimTransaction = typeof bimTransactions.$inferSelect;

// ── BIM Sheets — 2D drawing sheet metadata ──
export const bimSheets = pgTable("bim_sheets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  modelId: varchar("model_id").notNull(),
  projectId: varchar("project_id").notNull(),
  sheetNumber: varchar("sheet_number", { length: 20 }).notNull(),
  sheetTitle: varchar("sheet_title", { length: 200 }).notNull(),
  paperSize: varchar("paper_size", { length: 10 }).notNull().default("A1"),
  orientation: varchar("orientation", { length: 10 }).notNull().default("landscape"),
  scale: integer("scale").notNull().default(100),
  svgContent: text("svg_content"), // full SVG markup
  titleBlock: jsonb("title_block"), // title block metadata
  viewConfigs: jsonb("view_configs"), // array of view configurations
  status: varchar("status", { length: 20 }).notNull().default("draft"), // draft, issued, superseded
  revision: varchar("revision", { length: 10 }).notNull().default("A"),
  issuedAt: timestamp("issued_at"),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  modelIdIdx: index("bim_sheets_model_id_idx").on(t.modelId),
  projectIdIdx: index("bim_sheets_project_id_idx").on(t.projectId),
  sheetNumberIdx: index("bim_sheets_number_idx").on(t.sheetNumber),
}));

export const insertBimSheetSchema = createInsertSchema(bimSheets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBimSheet = z.infer<typeof insertBimSheetSchema>;
export type BimSheet = typeof bimSheets.$inferSelect;

// ── BIM Model Revisions — revision tracking for AI refinement loop ──
export const bimRevisions = pgTable("bim_revisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  modelId: varchar("model_id").notNull(),
  projectId: varchar("project_id").notNull(),
  revisionNumber: integer("revision_number").notNull().default(1),
  description: text("description"),
  changesSummary: jsonb("changes_summary"), // { added, modified, deleted, moved counts + details }
  baseRevisionId: varchar("base_revision_id"), // parent revision
  mergeConflicts: jsonb("merge_conflicts"), // any unresolved merge conflicts
  status: varchar("status", { length: 20 }).notNull().default("draft"), // draft, approved, merged, superseded
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  modelIdIdx: index("bim_rev_model_id_idx").on(t.modelId),
  projectIdIdx: index("bim_rev_project_id_idx").on(t.projectId),
  revisionNumberIdx: index("bim_rev_number_idx").on(t.revisionNumber),
  modelRevisionUniq: unique("bim_rev_model_revision_uniq").on(t.modelId, t.revisionNumber),
}));

export const insertBimRevisionSchema = createInsertSchema(bimRevisions).omit({ id: true, createdAt: true });
export type InsertBimRevision = z.infer<typeof insertBimRevisionSchema>;
export type BimRevision = typeof bimRevisions.$inferSelect;

// ── BIM Clash Resolutions — approved resolution records ──
export const bimClashResolutions = pgTable("bim_clash_resolutions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  modelId: varchar("model_id").notNull(),
  projectId: varchar("project_id").notNull(),
  clashId: varchar("clash_id").notNull(),
  elementAId: varchar("element_a_id").notNull(),
  elementBId: varchar("element_b_id").notNull(),
  strategy: varchar("strategy", { length: 30 }).notNull(), // reroute, move, resize, etc.
  modifications: jsonb("modifications"), // changes applied
  confidence: decimal("confidence", { precision: 5, scale: 4 }),
  riskLevel: varchar("risk_level", { length: 10 }), // low, medium, high
  costEstimate: decimal("cost_estimate", { precision: 12, scale: 2 }),
  approvedBy: varchar("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  modelIdIdx: index("bim_clash_res_model_id_idx").on(t.modelId),
  clashIdIdx: index("bim_clash_res_clash_id_idx").on(t.clashId),
}));

export const insertBimClashResolutionSchema = createInsertSchema(bimClashResolutions).omit({ id: true, createdAt: true });
export type InsertBimClashResolution = z.infer<typeof insertBimClashResolutionSchema>;
export type BimClashResolution = typeof bimClashResolutions.$inferSelect;

// ── BIM Constraints — parametric constraint definitions ──
export const bimConstraints = pgTable("bim_constraints", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  modelId: varchar("model_id").notNull(),
  constraintType: varchar("constraint_type", { length: 20 }).notNull(), // fixed, coincident, parallel, perpendicular, distance, aligned, hosted, tangent
  elementIds: jsonb("element_ids").notNull(), // array of element IDs involved
  parameters: jsonb("parameters"), // type-specific params (distance value, axis, etc.)
  priority: integer("priority").notNull().default(1),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  modelIdIdx: index("bim_constraints_model_id_idx").on(t.modelId),
  typeIdx: index("bim_constraints_type_idx").on(t.constraintType),
}));

export const insertBimConstraintSchema = createInsertSchema(bimConstraints).omit({ id: true, createdAt: true });
export type InsertBimConstraint = z.infer<typeof insertBimConstraintSchema>;
export type BimConstraint = typeof bimConstraints.$inferSelect;
