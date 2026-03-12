// shared/field-transforms.ts
// ✅ FIX: Standardized field transformation to handle database snake_case ↔ API camelCase

/**
 * Database stores in snake_case, API returns camelCase
 * This transformation layer ensures consistency across the application
 */

// Document field mappings
export const DOCUMENT_FIELD_MAP = {
  // Database snake_case → API camelCase
  original_name: 'originalName',
  file_size: 'fileSize', 
  file_type: 'fileType',
  storage_key: 'storageKey',
  page_count: 'pageCount',
  text_content: 'textContent',
  page_text: 'pageText',
  analysis_status: 'analysisStatus',
  analysis_result: 'analysisResult',
  upload_date: 'uploadDate',
  uploaded_at: 'uploadedAt',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  revision_number: 'revisionNumber',
  change_summary: 'changeSummary',
  vector_hints: 'vectorHints'
} as const;

// BIM Model field mappings
export const BIM_MODEL_FIELD_MAP = {
  // Database snake_case → API camelCase  
  project_id: 'projectId',
  model_type: 'modelType',
  geometry_data: 'geometryData',
  ifc_data: 'ifcData',
  file_url: 'fileUrl',
  file_size: 'fileSize',
  bounding_box: 'boundingBox',
  element_count: 'elementCount',
  created_at: 'createdAt',
  updated_at: 'updatedAt'
} as const;

// BIM Element field mappings
export const BIM_ELEMENT_FIELD_MAP = {
  // Database snake_case → API camelCase
  model_id: 'modelId',
  element_type: 'elementType',
  element_id: 'elementId',
  parent_id: 'parentId', 
  storey_name: 'storeyName',
  storey_guid: 'storeyGuid',
  quantity_metric: 'quantityMetric',
  quantity_imperial: 'quantityImperial',
  quantity_area: 'quantityArea',
  quantity_volume: 'quantityVolume',
  ifc_guid: 'ifcGuid',
  created_at: 'createdAt',
  updated_at: 'updatedAt'
} as const;

// Project field mappings
export const PROJECT_FIELD_MAP = {
  // Database snake_case → API camelCase
  user_id: 'userId',
  estimate_value: 'estimateValue',
  building_area: 'buildingArea',
  federal_code: 'federalCode',
  state_provincial_code: 'stateProvincialCode',
  municipal_code: 'municipalCode',
  created_at: 'createdAt',
  updated_at: 'updatedAt'
} as const;

// Generic transformation function
export function transformFieldNames<T extends Record<string, any>>(
  obj: T,
  fieldMap: Record<string, string>
): any {
  if (!obj || typeof obj !== 'object') return obj;
  
  const transformed: any = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const newKey = fieldMap[key] || key;
    transformed[newKey] = value;
  }
  
  return transformed;
}

// Reverse transformation (camelCase → snake_case)
export function reverseTransformFieldNames<T extends Record<string, any>>(
  obj: T,
  fieldMap: Record<string, string>
): any {
  if (!obj || typeof obj !== 'object') return obj;
  
  const reverseMap = Object.fromEntries(
    Object.entries(fieldMap).map(([snake, camel]) => [camel, snake])
  );
  
  return transformFieldNames(obj, reverseMap);
}

// Specific transform functions for each entity type
export const transformDocument = (doc: any) => 
  transformFieldNames(doc, DOCUMENT_FIELD_MAP);

export const transformBimModel = (model: any) => 
  transformFieldNames(model, BIM_MODEL_FIELD_MAP);

export const transformBimElement = (element: any) => 
  transformFieldNames(element, BIM_ELEMENT_FIELD_MAP);

export const transformProject = (project: any) => 
  transformFieldNames(project, PROJECT_FIELD_MAP);

// Array transformation helpers
export const transformDocuments = (docs: any[]) => 
  docs.map(transformDocument);

export const transformBimModels = (models: any[]) => 
  models.map(transformBimModel);

export const transformBimElements = (elements: any[]) => 
  elements.map(transformBimElement);

export const transformProjects = (projects: any[]) => 
  projects.map(transformProject);