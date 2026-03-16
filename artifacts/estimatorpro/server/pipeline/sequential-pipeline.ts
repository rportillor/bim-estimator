// server/pipeline/sequential-pipeline.ts
// Sequential BIM extraction pipeline: 5 stages that run in order,
// each feeding results to the next. Pauses at GRID_CONFIRMATION for user review.

import Anthropic from '@anthropic-ai/sdk';
import { storage } from '../storage';
import { logger } from '../utils/enterprise-logger';
import { parseFirstJsonObject } from '../utils/anthropic-response';
import type { Document } from '@shared/schema';
import type {
  PipelineState,
  PipelineStage,
  ScheduleData,
  AssemblyData,
  SpecificationData,
  GridData,
} from './stage-types';
import {
  buildScheduleContext,
  buildAssemblyContext,
  buildSpecContext,
  buildGridContext,
  buildFullContext,
} from './prompt-builders';

type StatusCallback = (progress: number, message: string) => Promise<void>;

// Claude model to use for extraction calls
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// Document classification helpers (matches patterns from bim-generator.ts)
function isScheduleDoc(d: Document): boolean {
  return /schedule|door.*sched|window.*sched|finish.*sched/i.test(d.filename);
}

function isSectionDoc(d: Document): boolean {
  return /section|detail|wall.*type|assembly/i.test(d.filename);
}

function isSpecDoc(d: Document): boolean {
  return /spec|specification/i.test(d.filename);
}

function isFloorPlanDoc(d: Document): boolean {
  return /plan|floor|level|foundation|roof|structural/i.test(d.filename) &&
    !isScheduleDoc(d) && !isSectionDoc(d) && !isSpecDoc(d);
}

/**
 * Collects text content from documents, falling back to empty string.
 * Joins multiple documents with clear delimiters.
 */
function collectText(docs: Document[]): string {
  return docs
    .map((d) => {
      const text = (d as any).textContent || '';
      return text ? `--- Document: ${d.filename} ---\n${text}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Calls Claude via streaming and returns the concatenated text response.
 */
async function callClaude(
  anthropic: Anthropic,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 8000,
): Promise<string> {
  const stream = anthropic.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const finalMessage = await stream.finalMessage();
  return finalMessage.content
    .map((block: any) => (block.type === 'text' ? block.text : ''))
    .join('');
}

export class SequentialPipeline {
  private anthropic: Anthropic;
  private projectId: string;
  private modelId: string;
  private state: PipelineState;
  private documents: Document[];

  constructor(projectId: string, modelId: string) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.projectId = projectId;
    this.modelId = modelId;
    this.documents = [];
    this.state = {
      version: 2,
      currentStage: 'SCHEDULES',
      stageResults: {},
      stageTimings: {},
    };
  }

  // ------------------------------------------------------------------
  // State persistence — saves/loads from bim_models.metadata JSONB
  // ------------------------------------------------------------------

  async loadState(): Promise<void> {
    try {
      const model = await storage.getBimModel(this.modelId);
      if (!model) return;
      const meta =
        typeof model.metadata === 'string'
          ? JSON.parse(model.metadata)
          : model.metadata ?? {};
      if (meta.pipelineState && meta.pipelineState.version === 2) {
        this.state = meta.pipelineState as PipelineState;
        logger.info('Pipeline state loaded from DB', {
          modelId: this.modelId,
          stage: this.state.currentStage,
        });
      }
    } catch (err) {
      logger.warn('Could not load pipeline state, starting fresh', {
        modelId: this.modelId,
        error: (err as Error).message,
      });
    }
  }

  async saveState(): Promise<void> {
    try {
      await storage.updateBimModelMetadata(this.modelId, {
        pipelineState: this.state,
      });
    } catch (err) {
      logger.error('Failed to save pipeline state', {
        modelId: this.modelId,
        error: (err as Error).message,
      });
    }
  }

  getState(): PipelineState {
    return this.state;
  }

  // ------------------------------------------------------------------
  // Stage timing helpers
  // ------------------------------------------------------------------

  private startTiming(stage: string): void {
    this.state.stageTimings[stage] = { startedAt: new Date().toISOString() };
  }

  private endTiming(stage: string): void {
    const t = this.state.stageTimings[stage];
    if (t) {
      t.completedAt = new Date().toISOString();
      t.durationMs = new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime();
    }
  }

  private setStage(stage: PipelineStage): void {
    this.state.currentStage = stage;
  }

  private setError(stage: string, message: string): void {
    this.state.error = { stage, message, timestamp: new Date().toISOString() };
    this.state.currentStage = 'FAILED';
  }

  /**
   * Reset pipeline state back to the initial SCHEDULES stage, clearing all
   * previous stage results. Saves to DB so the next run() call starts fresh.
   * Required for Batch 2 re-runs when a previous COMPLETE state is saved.
   */
  async resetState(): Promise<void> {
    this.state = {
      version: 2,
      currentStage: 'SCHEDULES',
      stageResults: {},
      stageTimings: {},
    };
    await this.saveState();
    logger.info('Pipeline state reset to SCHEDULES', { modelId: this.modelId });
  }

  // ------------------------------------------------------------------
  // Main entry point
  // ------------------------------------------------------------------

  async run(
    documents: Document[],
    statusCallback?: StatusCallback,
  ): Promise<PipelineState> {
    this.documents = documents;
    await this.loadState();

    const notify = statusCallback || (async () => {});

    try {
      // Stage 1: Schedules
      if (this.shouldRunStage('SCHEDULES')) {
        await notify(0.05, 'Stage 1/5: Extracting schedules (doors, windows, finishes)');
        await this.runStage1_Schedules(notify);
      }

      // Stage 2: Sections
      if (this.shouldRunStage('SECTIONS')) {
        await notify(0.25, 'Stage 2/5: Extracting wall/slab assemblies from sections');
        await this.runStage2_Sections(notify);
      }

      // Stage 3: Specifications
      if (this.shouldRunStage('SPECIFICATIONS')) {
        await notify(0.45, 'Stage 3/5: Extracting material specifications and CSI codes');
        await this.runStage3_Specifications(notify);
      }

      // Stage 4: Grid extraction
      if (this.shouldRunStage('GRID_EXTRACTION')) {
        await notify(0.60, 'Stage 4/5: Extracting gridlines from structural plans');
        await this.runStage4_GridExtraction(notify);
        // Pipeline pauses here for grid confirmation
        if (this.state.currentStage === 'GRID_CONFIRMATION') {
          await notify(0.70, 'Paused: awaiting grid confirmation');
          return this.state;
        }
      }

      // Stage 5: Floor plans (only if grid confirmed)
      if (this.shouldRunStage('FLOOR_PLANS')) {
        if (this.state.stageResults.grid?.confirmed) {
          await notify(0.75, 'Stage 5/5: Placing elements on floor plans using grid coordinates');
          await this.runStage5_FloorPlans(notify);
        } else if (this.state.currentStage === 'GRID_CONFIRMATION') {
          // Still waiting for confirmation
          return this.state;
        }
      }

      if ((this.state.currentStage as string) !== 'FAILED') {
        this.setStage('COMPLETE');
        await this.saveState();
        await notify(1.0, 'Pipeline complete');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setError(this.state.currentStage, msg);
      await this.saveState();
      logger.error('Pipeline failed', { modelId: this.modelId, stage: this.state.currentStage, error: msg });
      await notify(1.0, `Pipeline failed at ${this.state.currentStage}: ${msg}`);
    }

    return this.state;
  }

  /**
   * Resume after grid confirmation. Called from the confirm-grid endpoint.
   * @param confirmedGrid - The confirmed grid data
   * @param statusCallback - Status update callback
   * @param documents - Project documents to use for Stage 5 (floor plan extraction)
   */
  async resume(
    confirmedGrid: GridData,
    statusCallback?: StatusCallback,
    documents?: Document[],
  ): Promise<PipelineState> {
    const notify = statusCallback || (async () => {});

    if (documents && documents.length > 0) {
      this.documents = documents;
    }

    this.state.stageResults.grid = confirmedGrid;
    this.state.currentStage = 'FLOOR_PLANS';
    this.state.resumedAt = new Date().toISOString();
    await this.saveState();

    try {
      await notify(0.75, 'Resumed: placing elements on floor plans using confirmed grid');
      await this.runStage5_FloorPlans(notify);

      if ((this.state.currentStage as string) !== 'FAILED') {
        this.setStage('COMPLETE');
        await this.saveState();
        await notify(1.0, 'Pipeline complete');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setError('FLOOR_PLANS', msg);
      await this.saveState();
      logger.error('Pipeline resume failed', { modelId: this.modelId, error: msg });
    }

    return this.state;
  }

  /**
   * Enrichment pass for existing elements (Path B -- The Moorings).
   * Runs stages 1-3 only, then matches existing elements to schedule/section data
   * and updates dimensions in DB.
   *
   * @param statusCallback  Optional progress callback
   * @param overrideDocs    If provided, use these documents instead of loading all project docs.
   *                        Pass the filtered Batch 1 documents here.
   */
  async enrichExistingElements(
    statusCallback?: StatusCallback,
    overrideDocs?: Document[],
  ): Promise<{ updated: number; rfis: number }> {
    const notify = statusCallback || (async () => {});
    this.documents = overrideDocs ?? await storage.getDocuments(this.projectId);
    let updated = 0;
    let rfis = 0;

    try {
      // Run extraction stages 1-3
      await notify(0.05, 'Enrichment: extracting schedules');
      await this.runStage1_Schedules(notify);

      await notify(0.25, 'Enrichment: extracting assemblies from sections');
      await this.runStage2_Sections(notify);

      await notify(0.45, 'Enrichment: extracting specifications');
      await this.runStage3_Specifications(notify);

      // Load existing BIM elements
      const existingElements = await storage.getBimElements(this.modelId);
      if (existingElements.length === 0) {
        logger.warn('Enrichment: no existing elements found', { modelId: this.modelId });
        return { updated: 0, rfis: 0 };
      }

      await notify(0.65, `Enrichment: matching ${existingElements.length} elements to extracted data`);

      const schedules = this.state.stageResults.schedules;
      const sections = this.state.stageResults.sections;

      // Build lookup maps for door/window schedule entries
      type DoorEntry = ScheduleData['doors'][number];
      type WindowEntry = ScheduleData['windows'][number];
      const doorByMark = new Map<string, DoorEntry>();
      const windowByMark = new Map<string, WindowEntry>();

      if (schedules) {
        for (const d of schedules.doors) {
          doorByMark.set(d.mark.toUpperCase(), d);
        }
        for (const w of schedules.windows) {
          windowByMark.set(w.mark.toUpperCase(), w);
        }
      }

      // Match elements to schedule/section data and update
      for (const elem of existingElements) {
        const etype = (elem.elementType || '').toLowerCase();
        const props = typeof elem.properties === 'string'
          ? JSON.parse(elem.properties || '{}')
          : (elem.properties || {});

        let didUpdate = false;

        // Match doors by mark
        if (etype.includes('door') && schedules) {
          const mark = (props.mark || props.doorMark || elem.name || '').toUpperCase();
          const doorEntry = doorByMark.get(mark);
          if (doorEntry) {
            props.width_mm = doorEntry.width_mm;
            props.height_mm = doorEntry.height_mm;
            props.fire_rating = doorEntry.fire_rating || props.fire_rating;
            props.hardware = doorEntry.hardware || props.hardware;
            props.enriched = true;
            props.enrichSource = 'schedule';
            didUpdate = true;
          } else {
            rfis++;
            props.rfiNeeded = true;
            props.rfiReason = `Door mark "${mark}" not found in schedule`;
          }
        }

        // Match windows by mark
        if (etype.includes('window') && schedules) {
          const mark = (props.mark || props.windowMark || elem.name || '').toUpperCase();
          const windowEntry = windowByMark.get(mark);
          if (windowEntry) {
            props.width_mm = windowEntry.width_mm;
            props.height_mm = windowEntry.height_mm;
            props.glazing = windowEntry.glazing || props.glazing;
            props.sill_height_mm = windowEntry.sill_height_mm;
            props.enriched = true;
            props.enrichSource = 'schedule';
            didUpdate = true;
          } else {
            rfis++;
            props.rfiNeeded = true;
            props.rfiReason = `Window mark "${mark}" not found in schedule`;
          }
        }

        // Match walls to assembly types
        if (etype.includes('wall') && sections) {
          const wallCode = (props.wallType || props.assemblyCode || '').toUpperCase();
          const assembly = sections.wallTypes[wallCode];
          if (assembly) {
            props.totalThickness_mm = assembly.totalThickness_mm;
            props.layers = assembly.layers;
            props.fire_rating = assembly.fire_rating || props.fire_rating;
            props.acoustic_rating = assembly.acoustic_rating;
            props.enriched = true;
            props.enrichSource = 'section';
            didUpdate = true;
          }
        }

        if (didUpdate) {
          await storage.updateBimElement(elem.id, {
            properties: JSON.stringify(props),
          });
          updated++;
        }
      }

      this.state.currentStage = 'COMPLETE';
      await this.saveState();
      await notify(1.0, `Enrichment complete: ${updated} elements updated, ${rfis} RFIs generated`);

      logger.info('Enrichment pass complete', { modelId: this.modelId, updated, rfis });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setError('ENRICHMENT', msg);
      await this.saveState();
      logger.error('Enrichment failed', { modelId: this.modelId, error: msg });
    }

    return { updated, rfis };
  }

  // ------------------------------------------------------------------
  // Stage implementations
  // ------------------------------------------------------------------

  private shouldRunStage(stage: PipelineStage): boolean {
    const order: PipelineStage[] = [
      'SCHEDULES', 'SECTIONS', 'SPECIFICATIONS', 'GRID_EXTRACTION',
      'GRID_CONFIRMATION', 'FLOOR_PLANS',
    ];
    const currentIdx = order.indexOf(this.state.currentStage);
    const stageIdx = order.indexOf(stage);

    // Run if current stage matches or we haven't reached this stage yet
    // Also run if the stage has no results (retry scenario)
    if (this.state.currentStage === stage) return true;
    if (currentIdx < stageIdx) return false;

    // Check if results exist for completed stages
    switch (stage) {
      case 'SCHEDULES': return !this.state.stageResults.schedules;
      case 'SECTIONS': return !this.state.stageResults.sections;
      case 'SPECIFICATIONS': return !this.state.stageResults.specifications;
      case 'GRID_EXTRACTION': return !this.state.stageResults.grid;
      case 'FLOOR_PLANS': return !this.state.stageResults.floorPlans;
      default: return false;
    }
  }

  /**
   * Stage 1: Extract door/window/finish schedules from schedule drawings.
   */
  private async runStage1_Schedules(notify: StatusCallback): Promise<void> {
    this.setStage('SCHEDULES');
    this.startTiming('SCHEDULES');
    await this.saveState();

    const scheduleDocs = this.documents.filter(isScheduleDoc);
    // If no dedicated schedule docs, look in all docs -- schedules are often embedded
    const docsToUse = scheduleDocs.length > 0 ? scheduleDocs : this.documents;
    const text = collectText(docsToUse);

    if (!text.trim()) {
      logger.warn('Stage 1: No text content found for schedule extraction', { modelId: this.modelId });
      this.state.stageResults.schedules = { doors: [], windows: [], finishes: [], units: 'mm' };
      this.setStage('SECTIONS');
      this.endTiming('SCHEDULES');
      await this.saveState();
      return;
    }

    const systemPrompt = `You are a construction document analyst specializing in reading schedule tables from architectural drawings. Extract data exactly as shown in the drawings. Do not invent or assume values. Return valid JSON only.`;

    const userPrompt = `Extract ALL schedule tables from these construction drawings. Return a JSON object with this exact structure:

{
  "doors": [
    { "mark": "D1", "width_mm": 914, "height_mm": 2134, "type": "Hollow Metal", "fire_rating": "1-hour", "hardware": "HW-1", "thickness_mm": 44 }
  ],
  "windows": [
    { "mark": "W1", "width_mm": 1500, "height_mm": 1200, "type": "Fixed", "glazing": "Double IGU", "sill_height_mm": 900 }
  ],
  "finishes": [
    { "room": "101 - Lobby", "floor": "Porcelain Tile", "wall": "GWB Paint", "ceiling": "ACT 2x4", "baseboard": "Rubber 100mm" }
  ],
  "units": "mm"
}

Rules:
- Extract EVERY door, window, and finish entry visible in the schedule tables.
- Use millimetres for all dimensions. Convert from feet-inches if needed (1 ft = 304.8 mm, 1 in = 25.4 mm).
- If a field is not visible in the schedule, omit it (do not guess).
- Return ONLY the JSON object, no other text.

DOCUMENTS:
${text.substring(0, 300000)}`;

    logger.info('Stage 1: Calling Claude for schedule extraction', {
      modelId: this.modelId,
      docCount: docsToUse.length,
      textLength: text.length,
    });

    const response = await callClaude(this.anthropic, systemPrompt, userPrompt, 16000);
    const parsed = parseFirstJsonObject(response);

    const scheduleData: ScheduleData = {
      doors: Array.isArray(parsed.doors) ? parsed.doors : [],
      windows: Array.isArray(parsed.windows) ? parsed.windows : [],
      finishes: Array.isArray(parsed.finishes) ? parsed.finishes : [],
      units: parsed.units || 'mm',
    };

    this.state.stageResults.schedules = scheduleData;
    this.setStage('SECTIONS');
    this.endTiming('SCHEDULES');
    await this.saveState();

    logger.info('Stage 1 complete', {
      modelId: this.modelId,
      doors: scheduleData.doors.length,
      windows: scheduleData.windows.length,
      finishes: scheduleData.finishes.length,
    });

    await notify(0.20, `Schedules extracted: ${scheduleData.doors.length} doors, ${scheduleData.windows.length} windows, ${scheduleData.finishes.length} finishes`);
  }

  /**
   * Stage 2: Extract wall assemblies, slab thicknesses from section/detail drawings.
   * Receives schedule data as context.
   */
  private async runStage2_Sections(notify: StatusCallback): Promise<void> {
    this.setStage('SECTIONS');
    this.startTiming('SECTIONS');
    await this.saveState();

    const sectionDocs = this.documents.filter(isSectionDoc);
    const docsToUse = sectionDocs.length > 0 ? sectionDocs : this.documents;
    const text = collectText(docsToUse);

    if (!text.trim()) {
      logger.warn('Stage 2: No text content found for section extraction', { modelId: this.modelId });
      this.state.stageResults.sections = { wallTypes: {}, slabTypes: {}, roofTypes: {}, units: 'mm' };
      this.setStage('SPECIFICATIONS');
      this.endTiming('SECTIONS');
      await this.saveState();
      return;
    }

    // Include Stage 1 context
    const scheduleContext = this.state.stageResults.schedules
      ? buildScheduleContext(this.state.stageResults.schedules)
      : '';

    const systemPrompt = `You are a construction document analyst specializing in reading wall sections, slab details, and roof assemblies from architectural and structural drawings. Extract data exactly as shown. Do not invent values. Return valid JSON only.`;

    const userPrompt = `Here are the door/window sizes from the schedules already extracted:

${scheduleContext}

Now extract ALL wall/slab/roof assembly definitions from these section and detail drawings.
For each assembly type (e.g. EW1, IW3D, SLAB-1, RF-1), list every layer with material and thickness.

Return a JSON object with this exact structure:

{
  "wallTypes": {
    "EW1": {
      "code": "EW1",
      "description": "Exterior Wall Type 1",
      "totalThickness_mm": 300,
      "layers": [
        { "material": "Face Brick", "thickness_mm": 90, "function": "exterior_finish" },
        { "material": "Air Gap", "thickness_mm": 25, "function": "drainage" },
        { "material": "Rigid Insulation", "thickness_mm": 50, "function": "insulation" },
        { "material": "Steel Stud", "thickness_mm": 92, "function": "structure" },
        { "material": "GWB Type X", "thickness_mm": 16, "function": "interior_finish" }
      ],
      "fire_rating": "1-hour",
      "acoustic_rating": "STC 55",
      "source_drawing": "A5.01"
    }
  },
  "slabTypes": {
    "SLAB-1": {
      "code": "SLAB-1",
      "description": "Typical Suspended Slab",
      "totalThickness_mm": 200,
      "layers": [
        { "material": "Concrete", "thickness_mm": 200, "function": "structure" }
      ],
      "source_drawing": "S3.01"
    }
  },
  "roofTypes": {},
  "units": "mm"
}

Rules:
- Extract EVERY assembly type shown in sections and details.
- Use millimetres for all thicknesses. Convert if needed.
- Include fire rating and acoustic rating if shown.
- Note the source drawing sheet number.
- Return ONLY the JSON object, no other text.

DOCUMENTS:
${text.substring(0, 300000)}`;

    logger.info('Stage 2: Calling Claude for section/assembly extraction', {
      modelId: this.modelId,
      docCount: docsToUse.length,
    });

    const response = await callClaude(this.anthropic, systemPrompt, userPrompt, 16000);
    const parsed = parseFirstJsonObject(response);

    const assemblyData: AssemblyData = {
      wallTypes: parsed.wallTypes && typeof parsed.wallTypes === 'object' ? parsed.wallTypes : {},
      slabTypes: parsed.slabTypes && typeof parsed.slabTypes === 'object' ? parsed.slabTypes : {},
      roofTypes: parsed.roofTypes && typeof parsed.roofTypes === 'object' ? parsed.roofTypes : {},
      units: parsed.units || 'mm',
    };

    this.state.stageResults.sections = assemblyData;
    this.setStage('SPECIFICATIONS');
    this.endTiming('SECTIONS');
    await this.saveState();

    const wallCount = Object.keys(assemblyData.wallTypes).length;
    const slabCount = Object.keys(assemblyData.slabTypes).length;
    const roofCount = Object.keys(assemblyData.roofTypes).length;

    logger.info('Stage 2 complete', {
      modelId: this.modelId,
      wallTypes: wallCount,
      slabTypes: slabCount,
      roofTypes: roofCount,
    });

    await notify(0.40, `Assemblies extracted: ${wallCount} wall types, ${slabCount} slab types, ${roofCount} roof types`);
  }

  /**
   * Stage 3: Extract materials, CSI codes from spec documents.
   * Receives schedule + section data as context.
   */
  private async runStage3_Specifications(notify: StatusCallback): Promise<void> {
    this.setStage('SPECIFICATIONS');
    this.startTiming('SPECIFICATIONS');
    await this.saveState();

    const specDocs = this.documents.filter(isSpecDoc);
    const docsToUse = specDocs.length > 0 ? specDocs : this.documents;
    const text = collectText(docsToUse);

    if (!text.trim()) {
      logger.warn('Stage 3: No text content found for spec extraction', { modelId: this.modelId });
      this.state.stageResults.specifications = { products: [], standards: [], units: 'mm' };
      this.setStage('GRID_EXTRACTION');
      this.endTiming('SPECIFICATIONS');
      await this.saveState();
      return;
    }

    // Include context from stages 1 and 2
    const priorContext: string[] = [];
    if (this.state.stageResults.schedules) {
      priorContext.push(buildScheduleContext(this.state.stageResults.schedules));
    }
    if (this.state.stageResults.sections) {
      priorContext.push(buildAssemblyContext(this.state.stageResults.sections));
    }

    const systemPrompt = `You are a construction document analyst specializing in reading project specifications. Extract material specifications, CSI division codes, and referenced standards. Return valid JSON only.`;

    const userPrompt = `Here are the assemblies and schedules already extracted from the drawings:

${priorContext.join('\n\n')}

Now extract material specifications, CSI division codes, and standards from these specification documents.
Match products to the assemblies above where possible.

Return a JSON object with this exact structure:

{
  "products": [
    {
      "csiCode": "04 21 13",
      "description": "Clay Face Brick - Standard Module",
      "material": "Clay Brick",
      "standard": "CSA A82",
      "manufacturer": "Hanson Brick",
      "source_section": "Section 04 21 13"
    }
  ],
  "standards": [
    {
      "code": "CSA A23.3",
      "title": "Design of Concrete Structures",
      "applicableTo": "All structural concrete"
    }
  ],
  "units": "mm"
}

Rules:
- Extract EVERY product specification and referenced standard.
- Use proper CSI MasterFormat codes (6-digit format like "04 21 13").
- Include manufacturer and standard references where shown.
- Return ONLY the JSON object, no other text.

DOCUMENTS:
${text.substring(0, 300000)}`;

    logger.info('Stage 3: Calling Claude for specification extraction', {
      modelId: this.modelId,
      docCount: docsToUse.length,
    });

    const response = await callClaude(this.anthropic, systemPrompt, userPrompt, 16000);
    const parsed = parseFirstJsonObject(response);

    const specData: SpecificationData = {
      products: Array.isArray(parsed.products) ? parsed.products : [],
      standards: Array.isArray(parsed.standards) ? parsed.standards : [],
      units: parsed.units || 'mm',
    };

    this.state.stageResults.specifications = specData;
    this.setStage('GRID_EXTRACTION');
    this.endTiming('SPECIFICATIONS');
    await this.saveState();

    logger.info('Stage 3 complete', {
      modelId: this.modelId,
      products: specData.products.length,
      standards: specData.standards.length,
    });

    await notify(0.55, `Specifications extracted: ${specData.products.length} products, ${specData.standards.length} standards`);
  }

  /**
   * Stage 4: Extract gridlines with angles from floor plans.
   * After extraction, the pipeline pauses at GRID_CONFIRMATION for user review.
   */
  private async runStage4_GridExtraction(notify: StatusCallback): Promise<void> {
    this.setStage('GRID_EXTRACTION');
    this.startTiming('GRID_EXTRACTION');
    await this.saveState();

    const planDocs = this.documents.filter(isFloorPlanDoc);
    const docsToUse = planDocs.length > 0 ? planDocs : this.documents;
    const text = collectText(docsToUse);

    if (!text.trim()) {
      logger.warn('Stage 4: No text content found for grid extraction', { modelId: this.modelId });
      // Set an empty unconfirmed grid so user can manually provide it
      this.state.stageResults.grid = {
        alphaGridlines: [],
        numericGridlines: [],
        alphaDirection: 'left_to_right',
        numericDirection: 'bottom_to_top',
        originLabel: { letter: 'A', number: '1' },
        notes: ['No text content found - grid must be entered manually'],
        confirmed: false,
      };
      this.setStage('GRID_CONFIRMATION');
      this.state.pausedAt = new Date().toISOString();
      this.endTiming('GRID_EXTRACTION');
      await this.saveState();
      return;
    }

    const systemPrompt = `You are a structural engineer specializing in reading construction gridline systems from floor plans. Extract every gridline with precise positions and angles. Return valid JSON only.`;

    const userPrompt = `Extract ALL gridlines from these structural floor plans. For each gridline report:
- label (letter or number)
- position in metres from the origin (bottom-left corner of the grid)
- angle in degrees (0 for orthogonal gridlines, non-zero for angled wings/bays)
- family: "alpha" for letter gridlines, "numeric" for number gridlines

Also determine:
- Which direction letters run (left_to_right or bottom_to_top)
- Which direction numbers run (left_to_right or bottom_to_top)
- The origin labels (first letter and first number)

Return a JSON object with this exact structure:

{
  "alphaGridlines": [
    { "label": "A", "position_m": 0.0, "angle_deg": 0, "family": "alpha" },
    { "label": "B", "position_m": 6.0, "angle_deg": 0, "family": "alpha" }
  ],
  "numericGridlines": [
    { "label": "1", "position_m": 0.0, "angle_deg": 0, "family": "numeric" },
    { "label": "2", "position_m": 7.2, "angle_deg": 0, "family": "numeric" }
  ],
  "alphaDirection": "left_to_right",
  "numericDirection": "bottom_to_top",
  "originLabel": { "letter": "A", "number": "1" },
  "notes": ["Gridline C.1 is a centerline between C and D", "Wing B is angled 15 degrees"]
}

Rules:
- Extract EVERY gridline visible on the plans, including sub-grids (e.g., A.1, 2.5).
- Positions must be in metres. Convert from feet-inches or mm if needed.
- Angle is measured from the horizontal axis. Most gridlines are 0 degrees (orthogonal).
- Include notes about any non-standard grid features (angled wings, radial grids, etc.).
- Return ONLY the JSON object, no other text.

DOCUMENTS:
${text.substring(0, 300000)}`;

    logger.info('Stage 4: Calling Claude for grid extraction', {
      modelId: this.modelId,
      docCount: docsToUse.length,
    });

    const response = await callClaude(this.anthropic, systemPrompt, userPrompt, 16000);
    const parsed = parseFirstJsonObject(response);

    const gridData: GridData = {
      alphaGridlines: Array.isArray(parsed.alphaGridlines) ? parsed.alphaGridlines : [],
      numericGridlines: Array.isArray(parsed.numericGridlines) ? parsed.numericGridlines : [],
      alphaDirection: parsed.alphaDirection || 'left_to_right',
      numericDirection: parsed.numericDirection || 'bottom_to_top',
      originLabel: parsed.originLabel || { letter: 'A', number: '1' },
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      confirmed: false, // Always starts unconfirmed
    };

    this.state.stageResults.grid = gridData;
    this.setStage('GRID_CONFIRMATION');
    this.state.pausedAt = new Date().toISOString();
    this.endTiming('GRID_EXTRACTION');
    await this.saveState();

    logger.info('Stage 4 complete - awaiting confirmation', {
      modelId: this.modelId,
      alphaGrids: gridData.alphaGridlines.length,
      numericGrids: gridData.numericGridlines.length,
    });

    await notify(0.70, `Grid extracted: ${gridData.alphaGridlines.length} alpha + ${gridData.numericGridlines.length} numeric gridlines. Awaiting confirmation.`);
  }

  /**
   * Stage 5: Place elements using grid coordinates with all prior stage data.
   * Requires confirmed grid. Writes elements to DB via storage.upsertBimElements.
   */
  private async runStage5_FloorPlans(notify: StatusCallback): Promise<void> {
    this.setStage('FLOOR_PLANS');
    this.startTiming('FLOOR_PLANS');
    await this.saveState();

    const planDocs = this.documents.filter(isFloorPlanDoc);
    // Also include any docs that weren't caught by other filters
    const otherDocs = this.documents.filter(
      (d) => !isScheduleDoc(d) && !isSectionDoc(d) && !isSpecDoc(d) && !isFloorPlanDoc(d),
    );
    const docsToUse = [...planDocs, ...otherDocs];
    const text = collectText(docsToUse.length > 0 ? docsToUse : this.documents);

    if (!text.trim()) {
      logger.warn('Stage 5: No text content found for floor plan extraction', { modelId: this.modelId });
      this.state.stageResults.floorPlans = { elementCount: 0 };
      this.endTiming('FLOOR_PLANS');
      await this.saveState();
      return;
    }

    // Build full context from all prior stages
    const fullContext = buildFullContext(this.state.stageResults);

    const systemPrompt = `You are a BIM modeler placing construction elements on floor plans. Use the provided grid system, door/window schedules, wall assemblies, and material specifications to accurately place and dimension every element. Return valid JSON only.`;

    const userPrompt = `Here is all the data extracted from prior stages:

${fullContext}

Now place EVERY element visible on these floor plans using grid coordinates.
For each element, cross-reference with the schedule/section data to get real dimensions.

Return a JSON object with this exact structure:

{
  "elements": [
    {
      "type": "wall",
      "name": "EW1 - Exterior Wall",
      "category": "Architectural",
      "assemblyCode": "EW1",
      "storey": "Level 1",
      "gridStart": { "alpha": "A", "numeric": "1" },
      "gridEnd": { "alpha": "A", "numeric": "5" },
      "offset_m": { "x": 0.0, "y": 0.0 },
      "length_m": 28.8,
      "height_m": 3.6,
      "thickness_mm": 300,
      "material": "See assembly EW1",
      "fire_rating": "1-hour",
      "properties": {}
    },
    {
      "type": "door",
      "name": "D101 - HM Door",
      "category": "Architectural",
      "mark": "D101",
      "scheduleMark": "D1",
      "storey": "Level 1",
      "gridNearest": { "alpha": "B", "numeric": "3" },
      "offset_m": { "x": 1.2, "y": 0.0 },
      "width_mm": 914,
      "height_mm": 2134,
      "hostWall": "IW2",
      "properties": {}
    }
  ],
  "storeys": [
    { "name": "Level 1", "elevation": 0.0, "floor_to_floor_height_m": 3.6 },
    { "name": "Level 2", "elevation": 3.6, "floor_to_floor_height_m": 3.6 }
  ]
}

Rules:
- Place EVERY wall, column, beam, slab, door, window, stair, and MEP element visible.
- Use grid references (alpha + numeric) for positioning, with offsets in metres.
- Cross-reference door/window marks with the schedule data for real dimensions.
- Cross-reference wall types with the assembly data for real thicknesses and layers.
- Include the storey (floor level) for each element.
- This should produce HUNDREDS of elements for a real building -- be thorough.
- Return ONLY the JSON object, no other text.

DOCUMENTS:
${text.substring(0, 300000)}`;

    logger.info('Stage 5: Calling Claude for floor plan element placement', {
      modelId: this.modelId,
      docCount: docsToUse.length,
    });

    const response = await callClaude(this.anthropic, systemPrompt, userPrompt, 64000);
    const parsed = parseFirstJsonObject(response);

    const elements: any[] = Array.isArray(parsed.elements) ? parsed.elements : [];
    const storeys: any[] = Array.isArray(parsed.storeys) ? parsed.storeys : [];

    // Enrich existing elements — do NOT delete/replace existing elements.
    // upsertBimElements does a full DELETE+INSERT so we never call it here.
    // Instead, load existing elements, match by mark/elementId/type/storey, update
    // location + geometry (height, thickness) + storeyName + elevation.
    const existingElements = await storage.getBimElements(this.modelId);
    let enrichedCount = 0;

    // Build a storey lookup from Claude's response for height data
    const storeyByName = new Map<string, any>();
    for (const s of storeys) {
      storeyByName.set((s.name || '').toLowerCase().replace(/\s+/g, ''), s);
    }

    for (const el of elements) {
      const elMark = (el.mark || el.scheduleMark || '').toString().trim().toUpperCase();
      const elType = (el.type || '').toLowerCase();
      const elStoreyRaw = typeof el.storey === 'string' ? el.storey : el.storey?.name || '';
      const elStoreyNorm = elStoreyRaw.toLowerCase().replace(/\s+/g, '');
      const elNameLower = (el.name || '').toLowerCase();

      const match = existingElements.find((ex) => {
        const exProps =
          typeof ex.properties === 'string'
            ? (() => { try { return JSON.parse(ex.properties as string); } catch { return {}; } })()
            : (ex.properties as any) || {};
        // FIX: also check ex.elementId and ex.name as mark sources
        const exMark = (
          exProps.mark ||
          exProps.tag ||
          exProps.doorMark ||
          exProps.windowMark ||
          ex.elementId ||
          ''
        )
          .toString()
          .trim()
          .toUpperCase();
        const exStoreyRaw = ex.storeyName || (typeof ex.storey === 'string' ? ex.storey : (ex.storey as any)?.name || '');
        const exStoreyName = exStoreyRaw.toLowerCase().replace(/\s+/g, '');
        const typeMatch = (ex.elementType || '').toLowerCase() === elType;
        if (elMark && exMark) return exMark === elMark && typeMatch;
        return (
          typeMatch &&
          (!elStoreyNorm || exStoreyName.includes(elStoreyNorm) || elStoreyNorm.includes(exStoreyName)) &&
          (ex.name || '').toLowerCase() === elNameLower
        );
      });

      if (match) {
        const existingLoc: any =
          typeof match.location === 'string'
            ? (() => { try { return JSON.parse(match.location as string); } catch { return {}; } })()
            : (match.location as any) || {};

        // FIX: resolve storey height from Claude's storey list
        const storeyInfo = storeyByName.get(elStoreyNorm) || null;
        const heightM: number | null = el.height_m ?? storeyInfo?.floor_to_floor_height_m ?? null;
        const thicknessM: number | null = el.thickness_mm ? el.thickness_mm / 1000 : null;

        // FIX: update geometry dimensions when height/thickness data is available
        const existingGeom: any = (() => {
          try {
            return typeof match.geometry === 'string'
              ? JSON.parse(match.geometry as string)
              : (match.geometry as any) || {};
          } catch { return {}; }
        })();
        const updatedGeom = (heightM !== null || thicknessM !== null) ? {
          ...existingGeom,
          dimensions: {
            ...existingGeom.dimensions,
            ...(heightM !== null ? { height: heightM } : {}),
            ...(thicknessM !== null ? { depth: thicknessM } : {}),
          },
        } : null;

        await storage.updateBimElement(match.id, {
          location: JSON.stringify({
            ...existingLoc,
            gridStart: el.gridStart,
            gridEnd: el.gridEnd,
            gridNearest: el.gridNearest,
            offset_m: el.offset_m,
          }) as any,
          ...(updatedGeom ? { geometry: JSON.stringify(updatedGeom) as any } : {}),
          ...(elStoreyRaw ? { storeyName: elStoreyRaw } : {}),
          ...(storeyInfo?.elevation !== undefined ? { elevation: String(storeyInfo.elevation) } : {}),
        });
        enrichedCount++;
      }
    }

    logger.info('Stage 5: Elements enriched via Claude matching', {
      modelId: this.modelId,
      elementCount: enrichedCount,
    });

    // ── Post-pass: assign storey heights to ALL elements with flat geometry ───
    // Elements generated by the old pipeline have height ≈ 0.01m (flat).
    // Use the bim_storeys table (with confirmed elevations) to assign proper
    // heights based on each element's prefix pattern in its elementId.
    // This does NOT call upsertBimElements — only individual updateBimElement calls.
    const dbStoreys = await storage.getBimStoreys(this.modelId);
    let heightPassCount = 0;

    if (dbStoreys.length > 0) {
      // Build prefix→storey map from actual storey names in the DB
      function inferStoreyFromElementId(elementId: string, allStoreys: typeof dbStoreys): typeof dbStoreys[0] | null {
        if (!elementId) return null;
        const prefix = (elementId.split('-')[0] || elementId.substring(0, 3)).toUpperCase();
        for (const s of allStoreys) {
          const n = s.name.toLowerCase();
          if (prefix === 'GF' && n.includes('ground')) return s;
          if ((prefix === '2F' || prefix === 'F2' || prefix === 'L2') && n.includes('second')) return s;
          if ((prefix === '3F' || prefix === 'F3' || prefix === 'L3') && n.includes('third')) return s;
          if ((prefix === 'MP' || prefix === 'DM') && (n.includes('mechanical') || n.includes('penthouse'))) return s;
          if ((prefix === 'B' || prefix === 'UG' || prefix === 'P1') && (n.includes('underground') || n.includes('parking'))) return s;
        }
        // Default to ground floor if no match
        return allStoreys.find(s => s.name.toLowerCase().includes('ground')) || allStoreys[0] || null;
      }

      for (const ex of existingElements) {
        // Only update elements that are still flat (height < 0.5m)
        const geom: any = (() => {
          try {
            return typeof ex.geometry === 'string' ? JSON.parse(ex.geometry as string) : (ex.geometry as any) || {};
          } catch { return {}; }
        })();
        const currentHeight = Number(geom?.dimensions?.height ?? 0);
        if (currentHeight >= 0.5) continue; // Already has real height — skip

        const storey = inferStoreyFromElementId(ex.elementId || '', dbStoreys);
        if (!storey) continue;

        const floorHeight = Number(storey.floorToFloorHeight ?? storey.floor_to_floor_height ?? 0);
        if (floorHeight <= 0) continue;

        const updatedGeom = {
          ...geom,
          dimensions: {
            ...geom.dimensions,
            height: floorHeight,
          },
        };

        await storage.updateBimElement(ex.id, {
          geometry: JSON.stringify(updatedGeom) as any,
          storeyName: storey.name,
          elevation: String(storey.elevation ?? 0),
        });
        heightPassCount++;
      }
    }

    logger.info('Stage 5: Elements written to DB', {
      modelId: this.modelId,
      elementCount: enrichedCount + heightPassCount,
      enrichedByClaudeMatch: enrichedCount,
      heightPassUpdated: heightPassCount,
    });

    // Write storeys to DB only if none exist yet.
    // If B1 already confirmed storeys for this model, Stage 5 must NOT overwrite them —
    // the DB storeys are the canonical source and Stage 5's Claude output may use
    // different naming conventions (e.g. "Level 1" vs "Ground Floor").
    if (dbStoreys.length === 0 && storeys.length > 0) {
      await storage.upsertBimStoreys(this.modelId, storeys);
    } else {
      logger.info('Stage 5: Skipping storey upsert — DB already has confirmed storeys', {
        modelId: this.modelId,
        existingStoreys: dbStoreys.length,
      });
    }

    // Update model status
    await storage.updateBimModel(this.modelId, { status: 'completed' });

    this.state.stageResults.floorPlans = { elementCount: enrichedCount + heightPassCount, claudeExtracted: elements.length };
    this.endTiming('FLOOR_PLANS');
    await this.saveState();

    logger.info('Stage 5 complete', {
      modelId: this.modelId,
      enriched: enrichedCount,
      heightPassUpdated: heightPassCount,
      claudeExtracted: elements.length,
      storeys: storeys.length,
    });

    await notify(0.95, `Floor plans complete: ${enrichedCount} elements grid-matched, ${heightPassCount} elements height-assigned from storeys, ${storeys.length} storeys`);
  }
}
