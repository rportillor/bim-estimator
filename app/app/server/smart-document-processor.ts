/**
 * SmartDocumentProcessor — intelligent grouped BIM document processing.
 *
 * N-5 FIX: Removed all filename pattern matching from groupRelatedDocuments().
 *   Documents are now grouped using explicit metadata fields: documentType,
 *   discipline, drawingType, drawingCategory. If those fields are absent the
 *   document is placed in 'uncategorised' and an RFI is raised — never guessed
 *   from filename.
 *
 * N-6 FIX: Removed hardcoded "4-story, Fenelon Falls", "numberOfFloors": 4,
 *   "floorToFloorHeight": 5 from createGroupSpecificPrompt(). The prompt now
 *   receives a ProjectContext object built from real database data. Where a
 *   field is unknown, the prompt explicitly states UNKNOWN and instructs Claude
 *   to extract the value from the drawings — never to assume it.
 *
 * N-7 FIX: `floorData.floors?.length || 4` replaced with
 *   `floorData.floors?.length ?? null`. Null propagates to the prompt; Claude
 *   is asked to determine floor count from the drawings.
 *
 * N-8 FIX: Removed broken dynamic import of "./helpers/rfi-generator" (file does
 *   not exist). RFI registration now uses MissingDataTracker.getOrCreate() and
 *   registerDocumentGap() — the canonical no-defaults RFI pipeline.
 */

import { storage } from "./storage";
import Anthropic from "@anthropic-ai/sdk";
import { MissingDataTracker } from "./services/missing-data-tracker";

const logger = {
  info:  (msg: string, data?: any) => console.log(`[INFO] ${msg}`, data ?? ""),
  warn:  (msg: string, data?: any) => console.log(`[WARN] ${msg}`, data ?? ""),
  error: (msg: string, data?: any) => console.error(`[ERROR] ${msg}`, data ?? ""),
};

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface DocumentGroup {
  category: string;
  documents: any[];
  priority: number;
}

/** Real project data passed into prompt generation. All fields nullable —
 *  unknown values must never be substituted with hardcoded assumptions. */
interface ProjectContext {
  projectName: string | null;
  location: string | null;
  /** Floor count from DB storey records. null = not yet determined. */
  floorCount: number | null;
  /** Floor-to-floor height in metres from drawings. null = not yet determined. */
  floorToFloorHeight: number | null;
  /** Storey names in order, e.g. ["Ground", "Level 2", "Level 3", "Roof"] */
  storeyNames: string[];
}

// ─── CLASS ───────────────────────────────────────────────────────────────────

export class SmartDocumentProcessor {
  private anthropic: Anthropic;
  private knowledgeBase: Map<string, any> = new Map();
  private processedCache: Map<string, any> = new Map();

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  // ─── PUBLIC ────────────────────────────────────────────────────────────────

  async processDocumentsIntelligently(
    projectId: string,
    documents: any[]
  ): Promise<any> {
    logger.info(`Starting intelligent processing of ${documents.length} documents`);

    // Skip re-processing if elements already exist
    const existingElements = await storage.getBimElements(projectId);
    if (existingElements && existingElements.length > 0) {
      logger.info(
        `Found ${existingElements.length} existing elements — skipping re-processing`
      );
      return {
        elements: existingElements,
        buildingAnalysis: { totalElements: existingElements.length, cached: true },
      };
    }

    // Build real project context from database — no hardcoded values
    const projectContext = await this.buildProjectContext(projectId);

    const groups = this.groupRelatedDocuments(documents, projectId);

    let allElements: any[] = [];
    let buildingPerimeter: any = null;
    let floors: any[] = [];

    for (const group of groups.sort((a, b) => a.priority - b.priority)) {
      logger.info(
        `Processing ${group.category} group with ${group.documents.length} documents`
      );

      const groupResult = await this.processDocumentGroup(
        group,
        this.knowledgeBase,
        projectContext
      );

      if (groupResult.elements) {
        allElements.push(...groupResult.elements);

        try {
          logger.info(
            `Saving ${groupResult.elements.length} elements from ${group.category}`
          );
          for (const element of groupResult.elements) {
            await storage.createBimElement({
              modelId: projectId,
              elementId:
                element.id ||
                `${group.category}-${Date.now()}-${Math.random()
                  .toString(36)
                  .substr(2, 9)}`,
              elementType: element.type || "UNKNOWN",
              properties: JSON.stringify({
                ...((typeof element.properties === 'object' && element.properties) ? element.properties : {}),
                source: group.category,
                processed: new Date().toISOString(),
              }),
              geometry: element.geometry || {},
            });
          }
          logger.info(
            `Saved ${groupResult.elements.length} elements to database`
          );
        } catch (error) {
          logger.error(
            `Failed to save elements from ${group.category}:`,
            error
          );
        }
      }

      if (groupResult.buildingPerimeter)
        buildingPerimeter = groupResult.buildingPerimeter;
      if (groupResult.floors) floors = groupResult.floors;

      this.knowledgeBase.set(group.category, groupResult);
    }

    logger.info(
      `Processed all groups, extracted ${allElements.length} total elements`
    );

    return {
      elements: allElements,
      buildingAnalysis: {
        perimeter: buildingPerimeter,
        floors,
        totalElements: allElements.length,
      },
    };
  }

  // ─── PROJECT CONTEXT ──────────────────────────────────────────────────────

  /**
   * Build a ProjectContext from real database records.
   * Every field defaults to null — callers must handle null and register RFIs
   * when values are required but absent. No hardcoded fallbacks permitted.
   */
  private async buildProjectContext(projectId: string): Promise<ProjectContext> {
    let projectName: string | null = null;
    let location: string | null = null;
    let floorCount: number | null = null;
    let floorToFloorHeight: number | null = null;
    let storeyNames: string[] = [];

    try {
      const project = await storage.getProject(projectId);
      if (project) {
        projectName = project.name ?? null;
        location = project.location ?? null;
      }
    } catch {
      logger.warn("Could not load project record for context");
    }

    try {
      const storeys = await storage.getBimStoreys?.(projectId);
      if (storeys && storeys.length > 0) {
        floorCount = storeys.length;
        storeyNames = storeys.map((s: any) => s.name ?? s.level ?? "Unknown");

        const elevations: number[] = storeys
          .map((s: any) => s.elevation_m ?? s.elevation ?? null)
          .filter((e: any): e is number => typeof e === "number");

        if (elevations.length >= 2) {
          elevations.sort((a, b) => a - b);
          const gaps = elevations
            .slice(1)
            .map((e, i) => e - elevations[i])
            .filter((g) => g > 0);
          if (gaps.length > 0) {
            gaps.sort((a, b) => a - b);
            floorToFloorHeight = gaps[Math.floor(gaps.length / 2)];
          }
        }
      }
    } catch {
      logger.warn("Could not load storey records for context");
    }

    return { projectName, location, floorCount, floorToFloorHeight, storeyNames };
  }

  // ─── DOCUMENT GROUPING ────────────────────────────────────────────────────

  /**
   * Group documents using explicit metadata fields only.
   *
   * N-5 FIX: The original implementation used filename regex patterns
   * (/ground|first.*floor|level.*1|GF/i etc.) to assign floor levels and
   * drawing categories. This is the same defect class as WP-R10 (floor-analyzer
   * filename fallback). Filename patterns are brittle, project-specific, and
   * silently produce wrong groupings — errors that propagate into BIM element
   * placement.
   *
   * Documents are now grouped by: documentType → discipline → drawingType →
   * drawingCategory (in that precedence order). If none of those fields are
   * populated the document is placed in 'uncategorised' and an RFI is logged
   * so the user knows metadata is missing. No filename pattern is ever used.
   */
  private groupRelatedDocuments(
    documents: any[],
    projectId: string
  ): DocumentGroup[] {
    const categoryPriority: Record<string, number> = {
      specifications_assemblies: 1,
      schedules:                  2,
      sections:                   3,
      elevations:                 4,
      foundation_site:            5,
      structural:                 6,
      architectural_plans:        7,
      mep_systems:                8,
      details:                    9,
      uncategorised:              99,
    };

    const buckets = new Map<string, any[]>();

    for (const doc of documents) {
      const category = this.resolveCategoryFromMetadata(doc);

      if (category === "uncategorised") {
        logger.warn(
          `Document "${doc.originalName ?? doc.filename ?? doc.id}" has no ` +
          `documentType/discipline/drawingType/drawingCategory metadata. ` +
          `Placed in uncategorised group. ` +
          `RFI required: populate document metadata before re-processing.`
        );
        // Register RFI asynchronously — do not await (non-blocking)
        this.registerMissingMetadataRFI(projectId, doc).catch(() => {});
      }

      const arr = buckets.get(category) ?? [];
      arr.push(doc);
      buckets.set(category, arr);
    }

    const groups: DocumentGroup[] = [];
    for (const [category, docs] of buckets.entries()) {
      groups.push({
        category,
        documents: docs,
        priority: categoryPriority[category] ?? 50,
      });
    }

    const validGroups = groups.filter((g) => g.documents.length > 0);
    logger.info(
      `Document organisation: ${validGroups
        .map((g) => `${g.category}(${g.documents.length})`)
        .join(", ")}`
    );

    return validGroups;
  }

  /**
   * Resolve drawing category from explicit document metadata fields.
   * Never inspects filename.
   */
  private resolveCategoryFromMetadata(doc: any): string {
    const raw: string =
      doc.drawingCategory ??
      doc.drawingType ??
      doc.discipline ??
      doc.documentType ??
      "";

    const val = raw.toLowerCase().trim();
    if (!val) return "uncategorised";

    if (/spec|assembly|assemblies|legend|general.*note/.test(val))
      return "specifications_assemblies";
    if (/schedule|door.*sched|window.*sched|finish|room.*data/.test(val))
      return "schedules";
    if (/section|cross.*section|building.*section|wall.*section/.test(val))
      return "sections";
    if (/elevation|facade|exterior.*view/.test(val))
      return "elevations";
    if (/foundation|site.*plan|parking|basement/.test(val))
      return "foundation_site";
    if (/structural|framing|column.*grid|beam|slab/.test(val))
      return "structural";
    if (/architectural|floor.*plan|level.*plan/.test(val))
      return "architectural_plans";
    if (/mechanical|electrical|plumbing|mep|hvac|fire.*protection|sprinkler/.test(val))
      return "mep_systems";
    if (/detail/.test(val))
      return "details";

    logger.warn(
      `Unrecognised metadata value "${raw}" on document "${
        doc.originalName ?? doc.id
      }". Placed in uncategorised.`
    );
    return "uncategorised";
  }

  /**
   * Register an RFI for a document missing drawing-category metadata.
   *
   * N-8 FIX: Previously attempted to dynamically import "./helpers/rfi-generator"
   * which does not exist (trackMissingData is not exported from any helpers file).
   * Now uses MissingDataTracker.getOrCreate() + registerDocumentGap() — the
   * canonical no-defaults RFI pipeline used throughout the codebase.
   */
  private async registerMissingMetadataRFI(
    projectId: string,
    doc: any
  ): Promise<void> {
    try {
      const tracker = MissingDataTracker.getOrCreate(projectId);
      tracker.registerDocumentGap({
        drawingRef: doc.originalName ?? doc.filename ?? doc.id ?? "unknown",
        parameter: "documentType / discipline / drawingCategory",
        severity: "HIGH",
        description:
          `Document "${doc.originalName ?? doc.filename ?? doc.id}" has no ` +
          `drawing category metadata. Cannot assign to a processing group without ` +
          `this information. Populate the document metadata fields and re-submit ` +
          `for BIM generation.`,
      });
    } catch (error) {
      // Log but do not surface — RFI failure must never block document processing
      logger.warn(`Could not register metadata RFI for document ${doc.id}:`, error);
    }
  }

  // ─── DOCUMENT GROUP PROCESSING ────────────────────────────────────────────

  private async processDocumentGroup(
    group: DocumentGroup,
    knowledgeBase: Map<string, any>,
    projectContext: ProjectContext
  ): Promise<any> {
    const MAX_CHARS_PER_REQUEST = 30_000;
    const allElements: any[] = [];
    const docsToProcess = group.documents.slice(0, 10);

    let currentBatch = "";
    let batchDocs: any[] = [];

    for (const doc of docsToProcess) {
      const docText = (
        doc.text ?? doc.content ?? doc.pageTexts ?? ""
      ).substring(0, 20_000);

      if (
        currentBatch.length + docText.length > MAX_CHARS_PER_REQUEST &&
        currentBatch.length > 0
      ) {
        logger.info(
          `Processing batch of ${batchDocs.length} documents from ${group.category}`
        );
        const batchResult = await this.processSingleBatch(
          group.category,
          currentBatch,
          knowledgeBase,
          projectContext
        );
        if (batchResult.elements) allElements.push(...batchResult.elements);

        currentBatch = docText;
        batchDocs = [doc];
      } else {
        currentBatch +=
          (currentBatch ? "\n\n--- NEXT DOCUMENT ---\n\n" : "") + docText;
        batchDocs.push(doc);
      }
    }

    if (currentBatch.length > 0) {
      logger.info(
        `Processing final batch of ${batchDocs.length} documents from ${group.category}`
      );
      const batchResult = await this.processSingleBatch(
        group.category,
        currentBatch,
        knowledgeBase,
        projectContext
      );
      if (batchResult.elements) allElements.push(...batchResult.elements);
    }

    return { elements: allElements };
  }

  private async processSingleBatch(
    category: string,
    batchText: string,
    knowledgeBase: Map<string, any>,
    projectContext: ProjectContext
  ): Promise<any> {
    let context = "";

    if (knowledgeBase.has("floor_plans")) {
      const floorData = knowledgeBase.get("floor_plans");
      if (floorData.buildingPerimeter) {
        context += `\nBuilding perimeter extracted: ${JSON.stringify(
          floorData.buildingPerimeter
        )}\n`;
      }
      // N-7 FIX: was `floorData.floors?.length || 4` — null when unknown
      const knownFloorCount: number | null =
        floorData.floors?.length ?? null;
      context +=
        knownFloorCount !== null
          ? `Number of floors confirmed: ${knownFloorCount}\n`
          : `Number of floors: UNKNOWN — extract from drawings\n`;
    }

    if (knowledgeBase.has("structural")) {
      const structData = knowledgeBase.get("structural");
      if (structData.columnCount != null) {
        context += `\nColumns found: ${structData.columnCount}\n`;
      }
    }

    const prompt = this.createGroupSpecificPrompt(
      category,
      context,
      batchText,
      projectContext
    );

    try {
      const response = await this.anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      });

      const responseText =
        response.content[0].type === "text" ? response.content[0].text : "";
      return this.parseGroupResponse(responseText, category);
    } catch (error) {
      logger.error(`Failed to process ${category} batch:`, error);
      return { elements: [] };
    }
  }

  // ─── PROMPT GENERATION ────────────────────────────────────────────────────

  /**
   * Build a drawing-category-specific extraction prompt.
   *
   * N-6 FIX: Removed hardcoded "4-story, Fenelon Falls", "numberOfFloors": 4,
   * "floorToFloorHeight": 5 from every prompt template. Project identity and
   * building parameters now come from the ProjectContext object built from real
   * database records. Where a field is null the prompt explicitly tells Claude
   * the value is UNKNOWN and asks it to extract the value from the drawings
   * rather than assume it.
   */
  private createGroupSpecificPrompt(
    category: string,
    context: string,
    documentText: string,
    pc: ProjectContext
  ): string {
    const projectLine = pc.projectName
      ? `Project: ${pc.projectName}${pc.location ? `, ${pc.location}` : ""}.`
      : "Project: UNKNOWN — do not assume project name or location.";

    const floorLine =
      pc.floorCount !== null
        ? `Confirmed floor count: ${pc.floorCount}.`
        : "Floor count: UNKNOWN — extract from drawings, do not assume.";

    const ftfLine =
      pc.floorToFloorHeight !== null
        ? `Confirmed floor-to-floor height: ${pc.floorToFloorHeight} m.`
        : "Floor-to-floor height: UNKNOWN — extract from section drawings, do not assume.";

    const storeyLine =
      pc.storeyNames.length > 0
        ? `Known storey names: ${pc.storeyNames.join(", ")}.`
        : "Storey names: UNKNOWN — extract from drawings.";

    const basePrompt =
      `Analysing ${category} drawings.\n` +
      `${projectLine}\n` +
      `${floorLine}\n` +
      `${ftfLine}\n` +
      `${storeyLine}\n` +
      (context ? `\nContext from previously processed groups:\n${context}\n` : "") +
      `\nExtract elements in JSON format:\n`;

    const unknownInstruction =
      `IMPORTANT: If a value is not explicitly shown in the drawings, ` +
      `set it to null — do not invent or assume any value.\n`;

    switch (category) {
      case "specifications_assemblies":
        return (
          basePrompt +
          unknownInstruction +
          `{\n` +
          `  "materials": {"concrete": null, "steel": null, "drywall": null},\n` +
          `  "assemblies": [\n` +
          `    {"id": null, "type": null, "layers": []}\n` +
          `  ],\n` +
          `  "buildingHeight_m": null,\n` +
          `  "numberOfFloors": null,\n` +
          `  "floorToFloorHeight_m": null\n` +
          `}\n\nDOCUMENTS:\n${documentText}\n\n` +
          `Extract materials, wall assemblies, and building parameters. ` +
          `Set any value not explicitly stated in the documents to null.`
        );

      case "sections":
        return (
          basePrompt +
          unknownInstruction +
          `{\n` +
          `  "buildingHeight_m": null,\n` +
          `  "floors": [\n` +
          `    {"level": null, "elevation_m": null, "height_m": null}\n` +
          `  ],\n` +
          `  "verticalElements": [\n` +
          `    {"type": null, "gridLine": null, "continuous": null, "floors": []}\n` +
          `  ]\n` +
          `}\n\nDOCUMENTS:\n${documentText}\n\n` +
          `Extract floor elevations and vertical element continuity from the section drawings. ` +
          `Every elevation_m and height_m value must come from a dimension or annotation — ` +
          `do not calculate or assume floor-to-floor height.`
        );

      case "architectural_plans":
      case "ground_floor":
      case "second_floor":
      case "third_floor":
      case "fourth_floor":
        return (
          basePrompt +
          unknownInstruction +
          `{\n` +
          `  "floorPlate": [],\n` +
          `  "walls": [{"id": null, "start": {"x": null, "y": null}, "end": {"x": null, "y": null}, "thickness_mm": null}],\n` +
          `  "columns": [{"id": null, "gridLocation": null, "x": null, "y": null, "size": null}],\n` +
          `  "doors": [{"id": null, "x": null, "y": null, "width_mm": null}],\n` +
          `  "windows": [{"id": null, "x": null, "y": null, "width_mm": null}],\n` +
          `  "rooms": [{"name": null, "area_m2": null, "boundary": []}]\n` +
          `}\n\nDOCUMENTS:\n${documentText}\n\n` +
          `Extract ALL elements from this floor plan. ` +
          `All coordinates and dimensions must come from the drawing annotations.`
        );

      case "structural":
        return (
          basePrompt +
          unknownInstruction +
          `{\n` +
          `  "gridLines": {\n` +
          `    "x": [{"name": null, "position_m": null}],\n` +
          `    "y": [{"name": null, "position_m": null}]\n` +
          `  },\n` +
          `  "columns": [{"id": null, "gridLocation": null, "x": null, "y": null, "size": null}],\n` +
          `  "beams":   [{"id": null, "start": null, "end": null, "size": null}],\n` +
          `  "slabs":   [{"id": null, "thickness_mm": null, "type": null}]\n` +
          `}\n\nDOCUMENTS:\n${documentText}\n\n` +
          `Extract structural grid and ALL structural elements. ` +
          `Grid positions must come from dimension annotations on the drawings.`
        );

      case "schedules":
        return (
          basePrompt +
          unknownInstruction +
          `{\n` +
          `  "doors":   [{"mark": null, "type": null, "width_mm": null, "height_mm": null, "quantity": null}],\n` +
          `  "windows": [{"mark": null, "type": null, "width_mm": null, "height_mm": null, "quantity": null}],\n` +
          `  "walls":   [{"type": null, "description": null, "area_m2": null}],\n` +
          `  "finishes":[{"room": null, "floor": null, "walls": null, "ceiling": null}]\n` +
          `}\n\nDOCUMENTS:\n${documentText}\n\n` +
          `Extract ALL scheduled items with marks, types, and quantities.`
        );

      case "elevations":
        return (
          basePrompt +
          unknownInstruction +
          `{\n` +
          `  "facades": [{"direction": null, "totalHeight_m": null, "openingRatio": null}],\n` +
          `  "storeyHeights": [{"level": null, "height_m": null}]\n` +
          `}\n\nDOCUMENTS:\n${documentText}\n\n` +
          `Extract facade dimensions and storey heights from elevation drawings.`
        );

      case "foundation_site":
        return (
          basePrompt +
          unknownInstruction +
          `{\n` +
          `  "footprint": [],\n` +
          `  "foundations": [{"type": null, "location": null, "size": null}],\n` +
          `  "siteArea_m2": null,\n` +
          `  "basementDepth_m": null\n` +
          `}\n\nDOCUMENTS:\n${documentText}\n\n` +
          `Extract building footprint and foundation elements.`
        );

      case "mep_systems":
        return (
          basePrompt +
          unknownInstruction +
          `{\n` +
          `  "mechanical": [{"type": null, "location": null, "size": null}],\n` +
          `  "electrical": [{"type": null, "location": null, "rating": null}],\n` +
          `  "plumbing":   [{"type": null, "location": null, "diameter_mm": null}],\n` +
          `  "fireProt":   [{"type": null, "location": null, "coverage_m2": null}]\n` +
          `}\n\nDOCUMENTS:\n${documentText}\n\n` +
          `Extract all MEP elements from the drawings.`
        );

      case "details":
        return (
          basePrompt +
          unknownInstruction +
          `{\n` +
          `  "assemblies": [{"id": null, "description": null, "layers": []}]\n` +
          `}\n\nDOCUMENTS:\n${documentText}\n\n` +
          `Extract construction assembly details.`
        );

      default:
        return (
          basePrompt +
          unknownInstruction +
          `Extract all relevant elements from these ${category} documents:\n${documentText}`
        );
    }
  }

  // ─── RESPONSE PARSING ────────────────────────────────────────────────────

  private parseGroupResponse(responseText: string, category: string): any {
    try {
      let jsonStr = responseText;

      const jsonMatch =
        responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
        responseText.match(/{[\s\S]*}/);

      if (jsonMatch) {
        jsonStr = jsonMatch[1] || jsonMatch[0];
      }

      jsonStr = jsonStr
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/([^"]),\s*,/g, "$1,")
        .replace(/\n\s*\n/g, "\n")
        .trim();

      let parsed: any;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        const validMatch = jsonStr.match(/{[^{}]*(?:{[^{}]*}[^{}]*)*}/);
        if (validMatch) {
          parsed = JSON.parse(validMatch[0]);
        } else {
          logger.warn("Could not extract valid JSON, returning empty result");
          return { elements: [], raw: responseText.substring(0, 500) };
        }
      }

      const elements: any[] = [];

      if (category === "floor_plans" && parsed.floors) {
        for (const floor of parsed.floors) {
          for (const wall of floor.walls ?? []) {
            elements.push({ type: "WALL", id: wall.id, floor: floor.level, geometry: wall });
          }
        }
        return {
          elements,
          buildingPerimeter: parsed.buildingPerimeter ?? null,
          floors: parsed.floors,
        };
      }

      if (category === "structural" && parsed.columns) {
        for (const col of parsed.columns) {
          elements.push({ type: "COLUMN", id: col.id, geometry: col });
        }
        return { elements, columnCount: parsed.columns.length };
      }

      if (category === "schedules") {
        for (const door of parsed.doors ?? []) {
          elements.push({
            type: "DOOR",
            id: door.mark ?? door.id ?? `D-${elements.length}`,
            properties: door,
          });
        }
        for (const win of parsed.windows ?? []) {
          elements.push({
            type: "WINDOW",
            id: win.mark ?? win.id ?? `W-${elements.length}`,
            properties: win,
          });
        }
        for (const wall of parsed.walls ?? []) {
          elements.push({
            type: "WALL",
            id: wall.type ?? `WALL-${elements.length}`,
            properties: wall,
          });
        }
        return { elements };
      }

      // Generic fallback: flatten all arrays in parsed object
      if (!elements.length) {
        for (const key of Object.keys(parsed)) {
          if (Array.isArray(parsed[key])) {
            for (const item of parsed[key]) {
              elements.push({
                type: key.toUpperCase().replace(/S$/, ""),
                id: item.id ?? item.mark ?? item.name ?? `${key}-${elements.length}`,
                properties: item,
              });
            }
          }
        }
      }

      logger.info(`Extracted ${elements.length} elements from ${category}`);
      return { elements };
    } catch (error) {
      logger.error("Failed to parse response:", error);
      return { elements: [] };
    }
  }
}
