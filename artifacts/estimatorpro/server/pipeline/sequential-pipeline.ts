// server/pipeline/sequential-pipeline.ts
// Sequential BIM extraction pipeline: 5 stages that run in order,
// each feeding results to the next. Pauses at GRID_CONFIRMATION for user review.

import Anthropic from '@anthropic-ai/sdk';
import { PDFDocument } from 'pdf-lib';
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
      // Try multiple text sources — pageText has per-page detail, textContent is full document
      let text = '';
      const pageText = (d as any).pageText;
      if (Array.isArray(pageText) && pageText.length > 0) {
        // Per-page text is richer — includes page-by-page extraction
        text = pageText.map((p: any) => p.text || '').join('\n--- PAGE BREAK ---\n');
      }
      if (!text) {
        text = (d as any).textContent || '';
      }
      return text ? `--- Document: ${d.filename} ---\n${text}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Calls Claude via streaming with text-only content.
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

/**
 * Load PDF buffers for documents from storage.
 * Returns array of { filename, buffer } for documents that could be loaded.
 */
async function loadPdfBuffers(docs: Document[]): Promise<Array<{ filename: string; buffer: Buffer }>> {
  const { loadFileBuffer } = await import('../services/storage-file-resolver');
  const results: Array<{ filename: string; buffer: Buffer }> = [];
  for (const doc of docs) {
    const fileType = (doc.fileType || '').toLowerCase();
    if (!fileType.includes('pdf')) continue;
    const key = (doc as any).storageKey || doc.filename;
    try {
      const buf = await loadFileBuffer(key);
      if (buf) results.push({ filename: doc.filename, buffer: buf });
    } catch {
      logger.warn(`Could not load PDF buffer for ${doc.filename}`);
    }
  }
  return results;
}

/**
 * Split a PDF buffer into chunks of at most `maxPages` pages each.
 * Returns an array of Buffer chunks (may be just [original] if within limit).
 */
async function splitPdfIntoChunks(
  filename: string,
  buffer: Buffer,
  maxPages: number = 100,
): Promise<Array<{ filename: string; buffer: Buffer }>> {
  try {
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const totalPages = pdfDoc.getPageCount();

    if (totalPages <= maxPages) {
      return [{ filename, buffer }];
    }

    const chunks: Array<{ filename: string; buffer: Buffer }> = [];
    const numChunks = Math.ceil(totalPages / maxPages);
    logger.info(`Splitting large PDF into ${numChunks} chunks`, { filename, totalPages, maxPages });

    for (let c = 0; c < numChunks; c++) {
      const startPage = c * maxPages;
      const endPage = Math.min(startPage + maxPages, totalPages);
      const pageIndices = Array.from({ length: endPage - startPage }, (_, i) => startPage + i);

      const chunkDoc = await PDFDocument.create();
      const copiedPages = await chunkDoc.copyPages(pdfDoc, pageIndices);
      copiedPages.forEach(p => chunkDoc.addPage(p));

      const chunkBytes = await chunkDoc.save();
      const chunkBuffer = Buffer.from(chunkBytes);
      const chunkName = `${filename} [pages ${startPage + 1}–${endPage}]`;
      chunks.push({ filename: chunkName, buffer: chunkBuffer });
      logger.info(`  Chunk ${c + 1}/${numChunks}: pages ${startPage + 1}–${endPage} (${chunkBuffer.length} bytes)`);
    }

    return chunks;
  } catch (err: any) {
    logger.warn(`splitPdfIntoChunks: could not split "${filename}" — sending as-is`, { error: err?.message });
    return [{ filename, buffer }];
  }
}

async function callClaudeWithDocuments(
  anthropic: Anthropic,
  systemPrompt: string,
  userPrompt: string,
  pdfBuffers: Array<{ filename: string; buffer: Buffer }>,
  textContext: string,
  maxTokens: number = 16000,
): Promise<string> {
  // If no PDFs available, fall back to text-only
  if (pdfBuffers.length === 0) {
    return callClaude(anthropic, systemPrompt, userPrompt + '\n\n' + textContext, maxTokens);
  }

  // Expand any PDF that exceeds the 100-page Anthropic limit into ≤100-page chunks.
  const expandedBuffers: Array<{ filename: string; buffer: Buffer }> = [];
  for (const pdf of pdfBuffers) {
    const chunks = await splitPdfIntoChunks(pdf.filename, pdf.buffer, 100);
    expandedBuffers.push(...chunks);
  }

  // Batch chunks (max 4 per call to avoid 413 errors)
  const BATCH_SIZE = 4;
  const allResponses: string[] = [];
  const totalBatches = Math.ceil(expandedBuffers.length / BATCH_SIZE);

  for (let i = 0; i < expandedBuffers.length; i += BATCH_SIZE) {
    const batch = expandedBuffers.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batchLabel = `batch ${batchNum}/${totalBatches}`;

    const content: any[] = [
      // Send actual PDF files so Claude can see the drawings
      ...batch.map(({ buffer }) => ({
        type: "document" as const,
        source: { type: "base64" as const, media_type: "application/pdf", data: buffer.toString('base64') },
      })),
      // Text prompt with context from prior stages
      {
        type: "text" as const,
        text: userPrompt + '\n\n' + textContext +
          `\n\nDocuments in this batch (${batch.length}, ${batchLabel}):\n` +
          batch.map((b, idx) => `  ${idx + 1}. ${b.filename}`).join('\n'),
      },
    ];

    logger.info(`Calling Claude with ${batch.length} PDF documents (${batchLabel})`);

    const stream = anthropic.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content }],
    });

    const finalMessage = await stream.finalMessage();
    const responseText = finalMessage.content
      .map((block: any) => (block.type === 'text' ? block.text : ''))
      .join('');

    allResponses.push(responseText);
    logger.info(`Claude response for ${batchLabel}: ${responseText.length} chars`);
  }

  // If multiple batches, return all responses concatenated
  // The caller will parse JSON from each
  return allResponses.join('\n---BATCH_SEPARATOR---\n');
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
   */
  async resume(
    confirmedGrid: GridData,
    statusCallback?: StatusCallback,
  ): Promise<PipelineState> {
    const notify = statusCallback || (async () => {});

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
   */
  async enrichExistingElements(
    statusCallback?: StatusCallback,
  ): Promise<{ updated: number; rfis: number }> {
    const notify = statusCallback || (async () => {});
    this.documents = await storage.getDocuments(this.projectId);
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

      // Match elements to schedule/section data and update BOTH properties AND geometry
      for (const elem of existingElements) {
        const etype = (elem.elementType || '').toLowerCase();
        const props = typeof elem.properties === 'string'
          ? JSON.parse(elem.properties || '{}')
          : (elem.properties || {});
        let geom = typeof elem.geometry === 'string'
          ? JSON.parse(elem.geometry || '{}')
          : (elem.geometry || {});
        if (!geom.dimensions) geom.dimensions = {};

        let didUpdate = false;

        // Extract mark from multiple sources — existing elements use various patterns
        const extractMark = (): string => {
          // Try explicit mark fields
          const explicit = props.mark || props.doorMark || props.windowMark || props.wallType;
          if (explicit) return String(explicit).toUpperCase();
          // Try element name patterns like "P1-D118", "F2-W201", "D-101"
          const name = String(elem.name || elem.elementId || '').toUpperCase();
          // Extract door/window mark: match D101, D-101, D118, W201, etc.
          const markMatch = name.match(/[DW]-?(\d{2,4})/);
          if (markMatch) return markMatch[0].replace('-', '');
          // Try the full name as mark
          return name;
        };

        // Match doors by mark — update properties AND geometry dimensions
        if (etype.includes('door') && schedules) {
          const mark = extractMark();
          // Try exact match first, then partial matches
          let doorEntry = doorByMark.get(mark);
          if (!doorEntry) {
            // Try matching just the number portion (D118 → 118)
            const numMatch = mark.match(/\d+/);
            if (numMatch) {
              for (const [k, v] of doorByMark) {
                if (k.includes(numMatch[0])) { doorEntry = v; break; }
              }
            }
          }
          if (doorEntry) {
            props.width_mm = doorEntry.width_mm;
            props.height_mm = doorEntry.height_mm;
            props.fire_rating = doorEntry.fire_rating || props.fire_rating;
            props.hardware = doorEntry.hardware || props.hardware;
            props.enriched = true;
            props.enrichSource = 'schedule';
            // Update GEOMETRY so the 3D model renders with real dimensions
            if (doorEntry.width_mm) geom.dimensions.length = doorEntry.width_mm / 1000;
            if (doorEntry.height_mm) geom.dimensions.height = doorEntry.height_mm / 1000;
            if (doorEntry.thickness_mm) geom.dimensions.width = doorEntry.thickness_mm / 1000;
            didUpdate = true;
          } else {
            rfis++;
            props.rfiNeeded = true;
            props.rfiReason = `Door mark "${mark}" not found in schedule`;
          }
        }

        // Match windows by mark — update properties AND geometry
        if (etype.includes('window') && schedules) {
          const mark = extractMark();
          let windowEntry = windowByMark.get(mark);
          if (!windowEntry) {
            const numMatch = mark.match(/\d+/);
            if (numMatch) {
              for (const [k, v] of windowByMark) {
                if (k.includes(numMatch[0])) { windowEntry = v; break; }
              }
            }
          }
          if (windowEntry) {
            props.width_mm = windowEntry.width_mm;
            props.height_mm = windowEntry.height_mm;
            props.glazing = windowEntry.glazing || props.glazing;
            props.sill_height_mm = windowEntry.sill_height_mm;
            props.enriched = true;
            props.enrichSource = 'schedule';
            if (windowEntry.width_mm) geom.dimensions.length = windowEntry.width_mm / 1000;
            if (windowEntry.height_mm) geom.dimensions.height = windowEntry.height_mm / 1000;
            didUpdate = true;
          } else {
            rfis++;
            props.rfiNeeded = true;
            props.rfiReason = `Window mark "${mark}" not found in schedule`;
          }
        }

        // Match walls to assembly types — update properties AND geometry
        if (etype.includes('wall') && sections) {
          // props.assembly stores values like "EW1a (extracted)" or "IW2f (extracted)".
          // Strip the " (extracted)" suffix before looking up in the wallTypes map.
          const rawAssembly = props.assembly || props.wallType || props.assemblyCode || props.wall_type || props.type || '';
          const wallCode = rawAssembly.replace(/\s*\(extracted\)\s*/gi, '').trim().toUpperCase();
          const assembly = wallCode ? sections.wallTypes[wallCode] : undefined;
          if (assembly) {
            props.totalThickness_mm = assembly.totalThickness_mm;
            props.layers = assembly.layers;
            props.fire_rating = assembly.fire_rating || props.fire_rating;
            props.acoustic_rating = assembly.acoustic_rating;
            props.enriched = true;
            props.enrichSource = 'section';
            // Update GEOMETRY thickness
            if (assembly.totalThickness_mm) {
              geom.dimensions.width = assembly.totalThickness_mm / 1000;
            }
            didUpdate = true;
          }
          // Also check storey height for wall height if missing
          if (!geom.dimensions.height || geom.dimensions.height <= 0.01) {
            const storeyName = (elem.storeyName || props.floor_level || '').toLowerCase();
            // Find storey elevation data
            const models = await storage.getBimModels(this.projectId);
            if (models?.[0]?.id) {
              try {
                const storeys = await (storage as any).getBimStoreys?.(models[0].id) || [];
                const matchedStorey = storeys.find((s: any) =>
                  String(s.name || '').toLowerCase().includes(storeyName) ||
                  storeyName.includes(String(s.name || '').toLowerCase())
                );
                if (matchedStorey?.floorToFloorHeight || matchedStorey?.ceiling_height) {
                  const h = Number(matchedStorey.floorToFloorHeight || matchedStorey.ceiling_height);
                  if (h > 0) {
                    geom.dimensions.height = h;
                    props.height_source = 'derived_from_storey';
                    didUpdate = true;
                  }
                }
              } catch { /* non-fatal */ }
            }
          }
        }

        if (didUpdate) {
          await storage.updateBimElement(elem.id, {
            properties: JSON.stringify(props),
            geometry: JSON.stringify(geom),
          } as any);
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
    const docsToUse = scheduleDocs.length > 0 ? scheduleDocs : this.documents;
    const text = collectText(docsToUse);

    // Load actual PDFs — schedule tables are often graphical (drawn tables, not text)
    const pdfBuffers = await loadPdfBuffers(docsToUse);
    logger.info(`Stage 1: ${docsToUse.length} docs, ${pdfBuffers.length} PDFs loaded for schedule reading`);

    if (!text.trim() && pdfBuffers.length === 0) {
      logger.warn('Stage 1: No content found for schedule extraction', { modelId: this.modelId });
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
      pdfCount: pdfBuffers.length,
    });

    // Send actual PDFs — schedule tables are graphical and need visual reading
    const response = await callClaudeWithDocuments(
      this.anthropic, systemPrompt, userPrompt, pdfBuffers,
      text.substring(0, 200000), 16000
    );
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

    // Include section docs AND construction assembly docs — both contain wall/slab details
    const sectionDocs = this.documents.filter(isSectionDoc);
    const assemblyDocs = this.documents.filter(d =>
      /assembl|detail|wall.*section|typical/i.test(d.filename)
    );
    const uniqueDocs = [...new Map([...sectionDocs, ...assemblyDocs].map(d => [d.id, d])).values()];
    const docsToUse = uniqueDocs.length > 0 ? uniqueDocs : this.documents;
    const text = collectText(docsToUse);

    // Load actual PDF files so Claude can SEE the assembly detail drawings
    const pdfBuffers = await loadPdfBuffers(docsToUse);
    logger.info(`Stage 2: ${docsToUse.length} docs, ${pdfBuffers.length} PDFs loaded for visual analysis`);

    if (!text.trim() && pdfBuffers.length === 0) {
      logger.warn('Stage 2: No content found for section extraction', { modelId: this.modelId });
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
      pdfCount: pdfBuffers.length,
    });

    // Send actual PDFs so Claude can read dimension lines and layer details from drawings
    const response = await callClaudeWithDocuments(
      this.anthropic, systemPrompt, userPrompt, pdfBuffers,
      text.substring(0, 200000), 16000
    );
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

    // Specifications are text-heavy — skip PDF sending entirely and use extracted text.
    // Split the text into 4 equal packages so large specs stay within Claude's limits.
    logger.info(`Stage 3: ${docsToUse.length} spec docs, ${text.length} chars — text-only, 4 packages`);

    if (!text.trim()) {
      logger.warn('Stage 3: No text found for spec extraction', { modelId: this.modelId });
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
    const priorContextStr = priorContext.join('\n\n');

    const systemPrompt = `You are a construction document analyst specializing in reading project specifications. Extract material specifications, CSI division codes, and referenced standards. Return valid JSON only.`;

    // Split spec text into 4 equal packages
    const NUM_PACKAGES = 4;
    const chunkSize = Math.ceil(text.length / NUM_PACKAGES);
    const allProducts: any[] = [];
    const allStandards: any[] = [];

    for (let pkg = 0; pkg < NUM_PACKAGES; pkg++) {
      const chunkStart = pkg * chunkSize;
      const chunkEnd = Math.min(chunkStart + chunkSize, text.length);
      const chunk = text.slice(chunkStart, chunkEnd);
      if (!chunk.trim()) continue;

      const userPrompt = `Here are the assemblies and schedules already extracted from the drawings:

${priorContextStr}

Now extract material specifications, CSI division codes, and standards from this portion of the specification document (package ${pkg + 1}/${NUM_PACKAGES}, characters ${chunkStart}–${chunkEnd} of ${text.length}).

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
- Extract EVERY product specification and referenced standard in this package only.
- Use proper CSI MasterFormat codes (6-digit format like "04 21 13").
- Include manufacturer and standard references where shown.
- Return ONLY the JSON object, no other text.

SPECIFICATION TEXT (package ${pkg + 1}/${NUM_PACKAGES}):
${chunk}`;

      logger.info(`Stage 3: Calling Claude for spec package ${pkg + 1}/${NUM_PACKAGES}`, {
        modelId: this.modelId,
        chunkChars: chunk.length,
      });

      const response = await callClaude(this.anthropic, systemPrompt, userPrompt, 16000);
      const parsed = parseFirstJsonObject(response);

      if (Array.isArray(parsed.products)) allProducts.push(...parsed.products);
      if (Array.isArray(parsed.standards)) allStandards.push(...parsed.standards);

      logger.info(`Stage 3: Package ${pkg + 1} → ${parsed.products?.length ?? 0} products, ${parsed.standards?.length ?? 0} standards`);
    }

    // De-duplicate by CSI code / standard code
    const seenProducts = new Set<string>();
    const uniqueProducts = allProducts.filter(p => {
      const key = `${p.csiCode}|${p.description}`;
      if (seenProducts.has(key)) return false;
      seenProducts.add(key);
      return true;
    });
    const seenStandards = new Set<string>();
    const uniqueStandards = allStandards.filter(s => {
      if (seenStandards.has(s.code)) return false;
      seenStandards.add(s.code);
      return true;
    });

    const parsed = { products: uniqueProducts, standards: uniqueStandards };

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

    // Use floor plans AND structural plans — both show grid lines
    const planDocs = this.documents.filter(isFloorPlanDoc);
    const structDocs = this.documents.filter(d =>
      /structural|foundation|S\d{3}/i.test(d.filename)
    );
    const uniqueDocs = [...new Map([...planDocs, ...structDocs].map(d => [d.id, d])).values()];
    const docsToUse = uniqueDocs.length > 0 ? uniqueDocs : this.documents;
    const text = collectText(docsToUse);

    // Load PDFs — grid lines are graphical, can't be read from OCR text alone
    const pdfBuffers = await loadPdfBuffers(docsToUse);
    logger.info(`Stage 4: ${docsToUse.length} docs, ${pdfBuffers.length} PDFs loaded for grid extraction`);

    if (!text.trim() && pdfBuffers.length === 0) {
      logger.warn('Stage 4: No content found for grid extraction', { modelId: this.modelId });
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
      pdfCount: pdfBuffers.length,
    });

    // Send actual PDFs — grid lines are graphical elements that Claude must SEE
    const response = await callClaudeWithDocuments(
      this.anthropic, systemPrompt, userPrompt, pdfBuffers,
      text.substring(0, 200000), 16000
    );
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

    // Send ALL documents — Claude needs to cross-reference floor plans with
    // sections, assemblies, schedules, and specs to get real dimensions.
    const docsToUse = this.documents;
    const text = collectText(docsToUse);

    // Load ALL PDFs so Claude can see drawings, not just OCR text
    const pdfBuffers = await loadPdfBuffers(docsToUse);
    logger.info(`Stage 5: ${docsToUse.length} docs, ${pdfBuffers.length} PDFs loaded for element placement`);

    if (!text.trim() && pdfBuffers.length === 0) {
      logger.warn('Stage 5: No content found for floor plan extraction', { modelId: this.modelId });
      this.state.stageResults.floorPlans = { elementCount: 0 };
      this.endTiming('FLOOR_PLANS');
      await this.saveState();
      return;
    }

    // Build full context from all prior stages
    const fullContext = buildFullContext(this.state.stageResults);

    const systemPrompt = `You are a senior Quantity Surveyor building a BIM model from construction documents. ALL documents belong to ONE project and must be read TOGETHER. Information is spread across multiple document types — you must ASSEMBLE the full picture by cross-referencing.

CRITICAL — WHERE TO FIND EACH DIMENSION (no hardcoded values allowed):

WALLS:
- POSITION (x, y): from FLOOR PLANS — wall shown between grid intersections
- THICKNESS: from CONSTRUCTION ASSEMBLY DETAILS — look up the wall type code (e.g. EW1, IW3D) shown on the floor plan, then find that assembly's detail drawing which lists every layer and its thickness. Sum all layers = total wall thickness.
- HEIGHT: determined by combining multiple sources:
  * CEILING HEIGHT from reflected ceiling plan or building sections
  * WALL EXTENSION ABOVE CEILING from the construction assembly detail — it shows whether gypsum stops at ceiling level, continues to underside of slab above, or continues to underside of deck. Read this from the assembly detail, not assumed.
  * TOTAL WALL HEIGHT = ceiling height + extension above ceiling (both from drawings)
- MATERIAL: from the construction assembly detail layers

DOORS:
- POSITION: from FLOOR PLANS — arc symbol shows location and swing direction
- MARK: from FLOOR PLANS — label next to the door symbol (e.g. D101)
- WIDTH and HEIGHT: from DOOR SCHEDULE — look up the mark in the schedule table. The schedule has columns for width, height, type, fire rating, hardware set, frame material.
- If the schedule doesn't list a height, check the ELEVATION DRAWINGS for the door in its wall context.
- If NEITHER schedule nor elevation shows height, create an RFI — do NOT use any assumed value.

WINDOWS:
- POSITION: from FLOOR PLANS — parallel lines in wall
- MARK: from FLOOR PLANS — label
- WIDTH and HEIGHT: from WINDOW SCHEDULE — look up mark
- SILL HEIGHT: from WINDOW SCHEDULE "SILL" column, or from ELEVATION DRAWINGS
- If not in schedule or elevation, create an RFI — do NOT assume any sill height.

COLUMNS:
- POSITION: from ARCHITECTURAL PLANS and/or STRUCTURAL PLANS — both show column locations on the grid. Cross-check both — if positions differ, flag as RFI (coordination issue).
- SIZE: from ARCHITECTURAL PLANS (may show outline) and STRUCTURAL SCHEDULE/PLANS (shows exact dimensions and reinforcement). Use structural as primary source, verify against architectural.
- HEIGHT: from BUILDING SECTIONS — floor-to-floor height at the column location

SLABS:
- BOUNDARY: from ARCHITECTURAL FLOOR PLANS (floor plate outline) and/or STRUCTURAL PLANS (may show different edge conditions). Cross-check both.
- THICKNESS: from ARCHITECTURAL SECTIONS (shows slab in context) and/or STRUCTURAL DETAILS (shows exact depth, reinforcement, topping). Use whichever source provides the dimension — if both show it, verify they match.
- If neither shows it, create an RFI.

CROSS-DISCIPLINE VERIFICATION:
- Architectural and Structural drawings often show the SAME elements (columns, slabs, shear walls). Check BOTH.
- If dimensions differ between disciplines, flag as RFI with both values noted.
- The design INTENT comes from Architectural. The design IMPLEMENTATION comes from Structural. Both are needed for accurate modeling.

CEILINGS:
- CEILING HEIGHT: from REFLECTED CEILING PLANS (RCP) — shows height per room/zone
- CEILING TYPE: from RCP — suspended, direct-applied, exposed structure
- PLENUM SPACE: from BUILDING SECTIONS — gap between ceiling finish and slab above
- All of these affect wall height calculation

EVERY DIMENSION MUST COME FROM THE DRAWINGS. If a dimension is not found in any document, create an RFI listing which document type should contain it. NEVER substitute a "standard" or "typical" value.

Return valid JSON only.`;

    const userPrompt = `Here is all the data extracted from prior stages of this project:

${fullContext}

Now place EVERY element visible on these floor plans using grid coordinates.
For EACH element, you MUST cross-reference:
- Walls → get thickness from assembly data above, height from storey ceiling_height + spec extension
- Doors → get width/height from door schedule above, match by mark (D101, D102, etc.)
- Windows → get width/height from window schedule above, match by mark
- Columns → get size from structural data, height from floor-to-floor
- Slabs → get thickness from structural sections

Return a JSON object with this structure (ALL values must come from the drawings — these are FORMAT EXAMPLES ONLY, not real values):

{
  "elements": [
    {
      "type": "wall",
      "name": "EXTRACT_FROM_DRAWINGS",
      "category": "Architectural",
      "assemblyCode": "WALL_TYPE_CODE_FROM_PLAN",
      "storey": "FLOOR_NAME_FROM_DRAWINGS",
      "gridStart": { "alpha": "GRID_LETTER", "numeric": "GRID_NUMBER" },
      "gridEnd": { "alpha": "GRID_LETTER", "numeric": "GRID_NUMBER" },
      "offset_m": { "x": 0.0, "y": 0.0 },
      "length_m": "MEASURE_FROM_GRID_SPACING",
      "height_m": "CEILING_HEIGHT_FROM_RCP_PLUS_EXTENSION_FROM_ASSEMBLY",
      "thickness_mm": "SUM_ALL_LAYERS_FROM_ASSEMBLY_DETAIL",
      "material": "FROM_ASSEMBLY_DETAIL",
      "fire_rating": "FROM_ASSEMBLY_DETAIL_OR_SPECS",
      "properties": { "extension_above_ceiling_mm": "FROM_ASSEMBLY_DETAIL", "layers": "FROM_ASSEMBLY_DETAIL" }
    },
    {
      "type": "door",
      "name": "DOOR_MARK_FROM_PLAN",
      "category": "Architectural",
      "mark": "DOOR_MARK_FROM_PLAN",
      "storey": "FLOOR_NAME",
      "gridNearest": { "alpha": "NEAREST_GRID", "numeric": "NEAREST_GRID" },
      "offset_m": { "x": "DISTANCE_FROM_GRID", "y": "DISTANCE_FROM_GRID" },
      "width_mm": "FROM_DOOR_SCHEDULE",
      "height_mm": "FROM_DOOR_SCHEDULE_OR_ELEVATION",
      "hostWall": "WALL_TYPE_CONTAINING_DOOR",
      "swing": "FROM_PLAN_ARC_SYMBOL",
      "properties": { "fire_rating": "FROM_DOOR_SCHEDULE", "hardware_set": "FROM_DOOR_SCHEDULE" }
    }
  ],
  "storeys": [
    { "name": "FROM_SECTIONS", "elevation": "FROM_SECTIONS", "floor_to_floor_height_m": "FROM_SECTIONS", "ceiling_height_m": "FROM_RCP_OR_SECTIONS" }
  ]
}

MANDATORY RULES:
- "type" MUST be set for every element (wall, door, window, column, beam, slab, stair, mep) — never undefined
- Place EVERY wall, column, beam, slab, door, window, stair, and MEP element visible on each floor
- Use grid references (alpha + numeric) for positioning, with offsets in metres from the nearest grid intersection
- Door/window MARKS must match the schedule data — use the schedule dimensions, not plan-view line thickness
- Wall ASSEMBLY CODES must match the section data — use the assembly thickness, not plan-view line thickness
- Include BOTH ceiling_height_m AND floor_to_floor_height_m per storey
- TYPICAL FLOOR RULE: if drawings show "Typical Floor" for multiple levels, create SEPARATE element entries for each floor with unique IDs (F2-W1, F3-W1, etc.)
- This should produce HUNDREDS of elements for a real building — be exhaustive
- Return ONLY the JSON object, no other text

DOCUMENTS:
${text.substring(0, 300000)}`;

    logger.info('Stage 5: Calling Claude for floor plan element placement', {
      modelId: this.modelId,
      docCount: docsToUse.length,
      pdfCount: pdfBuffers.length,
    });

    // Send actual PDFs — Claude needs to SEE floor plans, sections, and assemblies
    // to read grid positions, dimension lines, and assembly layer details
    const response = await callClaudeWithDocuments(
      this.anthropic, systemPrompt, userPrompt, pdfBuffers,
      fullContext + '\n\n' + text.substring(0, 200000), 64000
    );

    // Handle multi-batch responses — merge elements and storeys from all batches
    const batchResponses = response.split('---BATCH_SEPARATOR---').filter(Boolean);
    let elements: any[] = [];
    let storeys: any[] = [];
    for (const batchResp of batchResponses) {
      const parsed = parseFirstJsonObject(batchResp);
      if (Array.isArray(parsed.elements)) elements.push(...parsed.elements);
      if (Array.isArray(parsed.storeys)) {
        for (const s of parsed.storeys) {
          if (!storeys.find((existing: any) => existing.name === s.name)) {
            storeys.push(s);
          }
        }
      }
    }
    logger.info(`Stage 5: Merged ${elements.length} elements and ${storeys.length} storeys from ${batchResponses.length} batch(es)`);

    // Enrich existing elements: match Claude's output to existing BIM elements by mark/type/storey/name.
    // This preserves the 886 existing elements and updates their grid positions + dimensions in-place.
    const existingElements = await storage.getBimElements(this.modelId);
    let enrichedCount = 0;
    let heightPassCount = 0;

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
        const exProps = typeof ex.properties === 'string'
          ? (() => { try { return JSON.parse(ex.properties as string); } catch { return {}; } })()
          : (ex.properties as any) || {};
        const exMark = (
          exProps.mark || exProps.tag || exProps.doorMark || exProps.windowMark || ex.elementId || ''
        ).toString().trim().toUpperCase();
        const exStoreyRaw = ex.storeyName || (typeof ex.storey === 'string' ? ex.storey : (ex.storey as any)?.name || '');
        const exStoreyName = exStoreyRaw.toLowerCase().replace(/\s+/g, '');
        const exTypeLower = (ex.elementType || '').toLowerCase();
        const typeMatch = elType.length > 0 && (exTypeLower === elType || exTypeLower.includes(elType) || elType.includes(exTypeLower));
        if (elMark && exMark) return exMark === elMark && typeMatch;
        return (
          typeMatch &&
          (!elStoreyNorm || exStoreyName.includes(elStoreyNorm) || elStoreyNorm.includes(exStoreyName)) &&
          (ex.name || '').toLowerCase() === elNameLower
        );
      });

      if (match) {
        const existingLoc = typeof match.location === 'string'
          ? (() => { try { return JSON.parse(match.location as string); } catch { return {}; } })()
          : (match.location as any) || {};

        const storeyInfo = storeyByName.get(elStoreyNorm) || null;
        const heightM: number | null = el.height_m ?? storeyInfo?.floor_to_floor_height_m ?? null;
        const thicknessM: number | null = el.thickness_mm ? el.thickness_mm / 1000 : null;

        const existingGeom = (() => {
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
        });
        enrichedCount++;
      }
    }

    logger.info('Stage 5: Elements enriched via Claude matching', {
      modelId: this.modelId,
      elementCount: enrichedCount,
    });

    // Height pass: assign floor-to-floor height from confirmed storeys for any
    // existing elements that still have placeholder height (≤5cm).
    const dbStoreys = await storage.getBimStoreys(this.modelId);
    for (const storey of dbStoreys) {
      const floorHeight = (storey as any).floor_to_floor_height_m || (storey as any).floorToFloorHeight || 0;
      if (!floorHeight) continue;
      const storeyEls = existingElements.filter((ex) => {
        const exStorey = ex.storeyName || '';
        return exStorey.toLowerCase().replace(/\s+/g, '') ===
          (storey.name || '').toLowerCase().replace(/\s+/g, '');
      });
      for (const ex of storeyEls) {
        const geom = (() => {
          try { return typeof ex.geometry === 'string' ? JSON.parse(ex.geometry as string) : (ex.geometry as any) || {}; }
          catch { return {}; }
        })();
        const curHeight = geom?.dimensions?.height ?? 0;
        if (curHeight > 0.05) continue; // already has real height — skip
        const updatedGeom = {
          ...geom,
          dimensions: { ...geom.dimensions, height: floorHeight },
        };
        await storage.updateBimElement(ex.id, {
          geometry: JSON.stringify(updatedGeom) as any,
          storeyName: storey.name,
          elevation: String((storey as any).elevation ?? 0),
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
