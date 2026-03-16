// server/pipeline/sequential-pipeline.ts
// Sequential BIM extraction pipeline: 5 stages that run in order,
// each feeding results to the next. Pauses at GRID_CONFIRMATION for user review.

import Anthropic from '@anthropic-ai/sdk';
let PDFDocument: any;
try { PDFDocument = require('pdf-lib').PDFDocument; } catch { /* pdf-lib optional */ }
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
  DrawingScaleInfo,
} from './stage-types';
import { computeScaleFactor } from '../bim/drawing-scale-extractor';
import {
  buildScheduleContext,
  buildAssemblyContext,
  buildSpecContext,
  buildGridContext,
  buildFullContext,
} from './prompt-builders';
import type { CandidateSet } from './candidate-types';
import { resolveParameters } from './parameter-resolver';
import { buildMeshes } from './mesh-builder';
import { collectUnresolved, generateReviewItems, buildReviewSummary } from './candidate-review';
import { computeAndStoreTransform } from './coordinate-transform';
import { classifyDocuments } from './view-classifier';
import { projectToPlan } from './view-projection';

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
      copiedPages.forEach((p: any) => chunkDoc.addPage(p));

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

      // Stage 5: IR pipeline — Claude classifies, code resolves, code builds meshes
      if (this.shouldRunStage('FLOOR_PLANS')) {
        if (this.state.stageResults.grid?.confirmed) {
          await notify(0.75, 'Stage 5A: Claude classifying elements from floor plans');
          await this.runStage5A_CandidateExtraction(notify);
        } else if (this.state.currentStage === 'GRID_CONFIRMATION') {
          return this.state;
        }
      }

      if ((this.state.currentStage as string) === 'FLOOR_PLANS_5B') {
        await notify(0.85, 'Stage 5B: Resolving dimensions from schedules/assemblies (no AI)');
        await this.runStage5B_ParameterResolution(notify);
      }

      if ((this.state.currentStage as string) === 'FLOOR_PLANS_5C') {
        await notify(0.92, 'Stage 5C: Building 3D meshes deterministically (no AI)');
        await this.runStage5C_MeshGeneration(notify);
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
      await notify(0.75, 'Resumed: Stage 5A — Claude classifying elements');
      await this.runStage5A_CandidateExtraction(notify);

      if ((this.state.currentStage as string) === 'FLOOR_PLANS_5B') {
        await notify(0.85, 'Stage 5B: Resolving dimensions from schedules/assemblies');
        await this.runStage5B_ParameterResolution(notify);
      }

      if ((this.state.currentStage as string) === 'FLOOR_PLANS_5C') {
        await notify(0.92, 'Stage 5C: Building 3D meshes deterministically');
        await this.runStage5C_MeshGeneration(notify);
      }

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

    const parsed = { products: uniqueProducts, standards: uniqueStandards } as any;

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

    const systemPrompt = `You are a structural engineer specializing in reading construction gridline systems from floor plans. Extract every gridline with precise positions and angles. Also identify the drawing scale. Return valid JSON only.`;

    const userPrompt = `Extract ALL gridlines from these structural floor plans. For each gridline report:
- label (letter or number)
- position in metres from the origin (bottom-left corner of the grid)
- angle in degrees (0 for orthogonal gridlines, non-zero for angled wings/bays)
- family: "alpha" for letter gridlines, "numeric" for number gridlines

Also determine:
- Which direction letters run (left_to_right or bottom_to_top)
- Which direction numbers run (left_to_right or bottom_to_top)
- The origin labels (first letter and first number)

DRAWING SCALE: Find the drawing scale from the title block (e.g. "1:100", "1/4" = 1'-0"", "Scale 1:50").
Report it as "drawing_scale_ratio" (e.g. "1:100") and where you found it ("drawing_scale_source").
If the sheet says "NTS" or "Not to Scale" or you cannot find a scale, set drawing_scale_ratio to null.

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
  "drawing_scale_ratio": "1:100",
  "drawing_scale_source": "title block bottom-right",
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

    // Extract drawing scale from Claude's response
    const rawScaleRatio = parsed.drawing_scale_ratio || null;
    if (rawScaleRatio && typeof rawScaleRatio === 'string') {
      const factor = computeScaleFactor(rawScaleRatio);
      if (factor !== null && factor > 0) {
        const scaleInfo: DrawingScaleInfo = {
          ratio: rawScaleRatio,
          factor,
          source: parsed.drawing_scale_source || 'title block',
          confidence: 'medium',
        };
        this.state.stageResults.drawingScale = scaleInfo;
        logger.info('Stage 4: Drawing scale extracted', {
          modelId: this.modelId,
          ratio: scaleInfo.ratio,
          factor: scaleInfo.factor,
          source: scaleInfo.source,
        });
      }
    }

    this.setStage('GRID_CONFIRMATION');
    this.state.pausedAt = new Date().toISOString();
    this.endTiming('GRID_EXTRACTION');
    await this.saveState();

    logger.info('Stage 4 complete - awaiting confirmation', {
      modelId: this.modelId,
      alphaGrids: gridData.alphaGridlines.length,
      numericGrids: gridData.numericGridlines.length,
      drawingScale: this.state.stageResults.drawingScale?.ratio || 'none',
    });

    await notify(0.70, `Grid extracted: ${gridData.alphaGridlines.length} alpha + ${gridData.numericGridlines.length} numeric gridlines. Awaiting confirmation.`);
  }

  /**
   * Stage 5: Place elements using grid coordinates with all prior stage data.
   * Requires confirmed grid. Writes elements to DB via storage.upsertBimElements.
   */
  // ──────────────────────────────────────────────────────────────────────────
  // Stage 5A: CANDIDATE EXTRACTION — Claude classifies elements, code resolves
  // ──────────────────────────────────────────────────────────────────────────
  private async runStage5A_CandidateExtraction(notify: StatusCallback): Promise<void> {
    this.setStage('FLOOR_PLANS' as PipelineStage);
    this.startTiming('FLOOR_PLANS_5A');
    await this.saveState();

    const docsToUse = this.documents;
    const text = collectText(docsToUse);
    const pdfBuffers = await loadPdfBuffers(docsToUse);

    logger.info(`Stage 5A: ${docsToUse.length} docs, ${pdfBuffers.length} PDFs for candidate extraction`);

    if (!text.trim() && pdfBuffers.length === 0) {
      logger.warn('Stage 5A: No content found', { modelId: this.modelId });
      this.state.stageResults.floorPlans = { elementCount: 0 };
      this.endTiming('FLOOR_PLANS_5A');
      await this.saveState();
      return;
    }

    const fullContext = buildFullContext(this.state.stageResults);

    const systemPrompt = `You are a senior Quantity Surveyor CLASSIFYING building elements from construction drawings.

YOUR JOB: Identify every element on the floor plans — report its TYPE, GRID LOCATION, TYPE CODE/MARK, and STOREY. The code will resolve actual dimensions from schedules and assembly data. You do NOT need to resolve dimensions.

For each element, report:
- TYPE: wall, door, window, column, beam, slab, stair, mep
- GRID REFERENCE: which grid intersection(s) the element is at or between (use the confirmed grid labels)
- TYPE CODE or MARK: wall assembly code (EW1, IW3D) or door/window mark (D101, W201) as shown on the plan
- STOREY: which floor level
- EVIDENCE: which document and what you observed

POSITIONING RULES:
- Use GRID REFERENCES (gridStart/gridEnd for walls/beams, gridNearest for doors/windows/columns)
- Wall gridStart/gridEnd refer to the GRID LINES that the wall runs along or between
- The offset_m field is the PERPENDICULAR OFFSET from the grid line to the wall CENTERLINE, in metres
  Example: if a wall runs along grid line A but its centerline is 150mm to the right of grid A,
  set gridStart.alpha = "A" and offset_m.x = 0.15
  Example: if a wall runs exactly on grid line A, offset_m = {"x": 0, "y": 0}
- For doors/windows/columns, offset_m is the offset from the nearest grid intersection to the element center
- Wall START is one end, wall END is the other end — the code will compute length, midpoint, and rotation
- The origin (0,0) is at the confirmed grid origin label shown in the grid data below

Leave dimension fields as null — the resolver will fill them from schedule/assembly data:
- thickness_mm, height_m, width_mm, height_mm → all null
- The code has the door schedule, window schedule, wall assemblies, and storey heights from prior stages

Return valid JSON only.`;

    const userPrompt = `Prior stage data (schedules, assemblies, specs, confirmed grid):

${fullContext}

CLASSIFY every element visible on the floor plans. Use the EXACT field names shown below.

Return JSON:
{
  "walls": [
    { "candidateId": "W-F1-001", "type": "wall", "storey": "FLOOR_NAME",
      "wall_type_code": "CODE_FROM_PLAN", "gridStart": {"alpha":"LETTER","numeric":"NUMBER"},
      "gridEnd": {"alpha":"LETTER","numeric":"NUMBER"}, "offset_m": {"x":0,"y":0},
      "start_m": null, "end_m": null, "thickness_mm": null, "height_m": null,
      "base_elevation_m": null, "material": null, "fire_rating": null,
      "extension_above_ceiling_mm": null, "status": "unresolved",
      "evidence_sources": [{"documentName":"SHEET","extractionMethod":"visual","confidence":"high","value_extracted":"WHAT_YOU_SAW"}],
      "review_notes": [] }
  ],
  "doors": [
    { "candidateId": "D-F1-001", "type": "door", "storey": "FLOOR_NAME",
      "mark": "MARK_FROM_PLAN", "gridNearest": {"alpha":"LETTER","numeric":"NUMBER"},
      "offset_m": {"x":0,"y":0}, "position_m": null,
      "width_mm": null, "height_mm": null, "thickness_mm": null,
      "host_wall_type": "WALL_CODE", "swing": "FROM_ARC",
      "fire_rating": null, "hardware_set": null, "status": "unresolved",
      "evidence_sources": [], "review_notes": [] }
  ],
  "windows": [
    { "candidateId": "WIN-F1-001", "type": "window", "storey": "FLOOR_NAME",
      "mark": "MARK_FROM_PLAN", "gridNearest": {"alpha":"LETTER","numeric":"NUMBER"},
      "offset_m": {"x":0,"y":0}, "position_m": null,
      "width_mm": null, "height_mm": null, "sill_height_mm": null,
      "glazing": null, "host_wall_type": null, "status": "unresolved",
      "evidence_sources": [], "review_notes": [] }
  ],
  "columns": [
    { "candidateId": "COL-F1-001", "type": "column", "storey": "FLOOR_NAME",
      "gridPosition": {"alpha":"LETTER","numeric":"NUMBER"}, "offset_m": {"x":0,"y":0},
      "position_m": null, "size_string": "FROM_PLAN_OR_SCHEDULE",
      "width_mm": null, "depth_mm": null, "height_m": null,
      "material": null, "reinforcement": null, "status": "unresolved",
      "evidence_sources": [], "review_notes": [] }
  ],
  "slabs": [], "beams": [], "stairs": [], "mep": [],
  "storeys": [
    { "name": "FLOOR_NAME", "elevation_m": 0, "floor_to_floor_height_m": null, "ceiling_height_m": null }
  ]
}

RULES:
- "type" MUST be set (wall/door/window/column/beam/slab/stair/mep)
- Use grid labels from the confirmed grid data above
- Leave ALL dimension fields null — the resolver fills them from schedules/assemblies
- Report wall_type_code and door/window mark EXACTLY as shown on drawings
- candidateId format: TYPE-FLOOR-NUMBER (W-F1-001, D-F2-003, etc.)
- TYPICAL FLOOR: create separate entries per floor (W-F2-001, W-F3-001, etc.)
- Be EXHAUSTIVE — hundreds of elements for a real building
- Return ONLY JSON, no other text

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

    // Parse multi-batch responses into CandidateSet
    const batchResponses = response.split('---BATCH_SEPARATOR---').filter(Boolean);
    const candidateSet: CandidateSet = {
      walls: [], doors: [], windows: [], columns: [],
      slabs: [], beams: [], stairs: [], mep: [],
      storeys: [],
      metadata: { extractedAt: new Date().toISOString(), documentCount: docsToUse.length, totalCandidates: 0 },
    };

    for (const batchResp of batchResponses) {
      const parsed = parseFirstJsonObject(batchResp);
      if (Array.isArray(parsed.walls)) candidateSet.walls.push(...parsed.walls);
      if (Array.isArray(parsed.doors)) candidateSet.doors.push(...parsed.doors);
      if (Array.isArray(parsed.windows)) candidateSet.windows.push(...parsed.windows);
      if (Array.isArray(parsed.columns)) candidateSet.columns.push(...parsed.columns);
      if (Array.isArray(parsed.slabs)) candidateSet.slabs.push(...parsed.slabs);
      if (Array.isArray(parsed.beams)) candidateSet.beams.push(...parsed.beams);
      if (Array.isArray(parsed.stairs)) candidateSet.stairs.push(...parsed.stairs);
      if (Array.isArray(parsed.mep)) candidateSet.mep.push(...parsed.mep);
      // Legacy: if Claude returns flat "elements" array, sort into typed arrays
      if (Array.isArray(parsed.elements)) {
        for (const el of parsed.elements) {
          const t = (el.type || '').toLowerCase();
          if (t.includes('wall')) candidateSet.walls.push({ ...el, type: 'wall' });
          else if (t.includes('door')) candidateSet.doors.push({ ...el, type: 'door', mark: el.mark || el.name });
          else if (t.includes('window')) candidateSet.windows.push({ ...el, type: 'window', mark: el.mark || el.name });
          else if (t.includes('column')) candidateSet.columns.push({ ...el, type: 'column' });
          else if (t.includes('slab')) candidateSet.slabs.push({ ...el, type: 'slab' });
          else if (t.includes('beam')) candidateSet.beams.push({ ...el, type: 'beam' });
          else if (t.includes('stair')) candidateSet.stairs.push({ ...el, type: 'stair' });
          else if (t.includes('mep') || t.includes('light') || t.includes('sprinkler') || t.includes('electrical'))
            candidateSet.mep.push({ ...el, type: 'mep', category: el.category || 'electrical', mep_type: el.mep_type || t });
        }
      }
      if (Array.isArray(parsed.storeys)) {
        for (const s of parsed.storeys) {
          if (!candidateSet.storeys.find(existing => existing.name === s.name)) {
            candidateSet.storeys.push(s);
          }
        }
      }
    }

    // Ensure base fields on all candidates
    const ensureBase = (c: any, prefix: string, idx: number) => {
      if (!c.candidateId) c.candidateId = `${prefix}-${idx}`;
      if (!c.storey) c.storey = 'Unknown';
      if (!c.status) c.status = 'unresolved';
      if (!Array.isArray(c.evidence_sources)) c.evidence_sources = [];
      if (!Array.isArray(c.review_notes)) c.review_notes = [];
      if (!c.offset_m) c.offset_m = { x: 0, y: 0 };
    };
    candidateSet.walls.forEach((c, i) => ensureBase(c, 'W', i));
    candidateSet.doors.forEach((c, i) => { ensureBase(c, 'D', i); if (!c.mark) c.mark = c.candidateId; });
    candidateSet.windows.forEach((c, i) => { ensureBase(c, 'WIN', i); if (!c.mark) c.mark = c.candidateId; });
    candidateSet.columns.forEach((c, i) => ensureBase(c, 'COL', i));
    candidateSet.slabs.forEach((c, i) => ensureBase(c, 'SLB', i));
    candidateSet.beams.forEach((c, i) => ensureBase(c, 'BM', i));
    candidateSet.stairs.forEach((c, i) => ensureBase(c, 'STR', i));
    candidateSet.mep.forEach((c, i) => { ensureBase(c, 'MEP', i); if (!c.category) c.category = 'electrical'; if (!c.mep_type) c.mep_type = 'device'; });

    const total = candidateSet.walls.length + candidateSet.doors.length + candidateSet.windows.length +
      candidateSet.columns.length + candidateSet.slabs.length + candidateSet.beams.length +
      candidateSet.stairs.length + candidateSet.mep.length;
    candidateSet.metadata.totalCandidates = total;

    // Save candidates for Stage 5B
    (this.state.stageResults as any).candidates = candidateSet;
    this.state.currentStage = 'FLOOR_PLANS_5B' as PipelineStage;
    this.endTiming('FLOOR_PLANS_5A');
    await this.saveState();

    logger.info('Stage 5A complete', { modelId: this.modelId, totalCandidates: total, storeys: candidateSet.storeys.length });
    await notify(0.82, `5A complete: ${total} candidates classified from ${candidateSet.storeys.length} storeys`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Stage 5B: PARAMETER RESOLUTION — deterministic, no AI
  // ──────────────────────────────────────────────────────────────────────────
  private async runStage5B_ParameterResolution(notify: StatusCallback): Promise<void> {
    this.startTiming('FLOOR_PLANS_5B');

    const candidateSet = (this.state.stageResults as any).candidates as CandidateSet | undefined;
    if (!candidateSet) {
      logger.warn('Stage 5B: No candidates from 5A', { modelId: this.modelId });
      this.state.currentStage = 'FLOOR_PLANS_5C' as PipelineStage;
      this.endTiming('FLOOR_PLANS_5B');
      await this.saveState();
      return;
    }

    const schedules = this.state.stageResults.schedules || { doors: [], windows: [], finishes: [], units: 'mm' as const };
    const sections = this.state.stageResults.sections || { wallTypes: {}, slabTypes: {}, roofTypes: {}, units: 'mm' as const };
    const grid = this.state.stageResults.grid || {
      alphaGridlines: [], numericGridlines: [],
      alphaDirection: 'left_to_right' as const, numericDirection: 'bottom_to_top' as const,
      originLabel: { letter: 'A', number: '1' }, notes: [], confirmed: false,
    };

    // Compute sheet→model coordinate transform from grid data
    try {
      const transform = computeAndStoreTransform(grid, grid);
      if (transform) {
        logger.info('Stage 5B: Coordinate transform computed', {
          scale: transform.scale, rotation: transform.rotation_deg, residual: transform.residual
        });
      }
    } catch (err) {
      logger.warn('Stage 5B: Transform computation failed (non-fatal)', { error: (err as Error).message });
    }

    // Run deterministic parameter resolution (pass drawing scale and units if available)
    const drawingScaleFactor = this.state.stageResults.drawingScale?.factor;
    // Determine drawing units from schedule data (populated by Stage 1 from actual drawings)
    const drawingUnits = this.state.stageResults.schedules?.units;
    const { candidates: resolved, stats } = resolveParameters(candidateSet, schedules, sections, grid, drawingScaleFactor, drawingUnits);

    (this.state.stageResults as any).candidates = resolved;
    (this.state.stageResults as any).resolutionStats = stats;
    this.state.currentStage = 'FLOOR_PLANS_5C' as PipelineStage;
    this.endTiming('FLOOR_PLANS_5B');
    await this.saveState();

    logger.info('Stage 5B complete', { modelId: this.modelId, ...stats });
    await notify(0.88, `5B complete: ${stats.resolved}/${stats.total} resolved, ${stats.unresolved} need review`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Stage 5C: MESH GENERATION — deterministic geometry, no AI
  // ──────────────────────────────────────────────────────────────────────────
  private async runStage5C_MeshGeneration(notify: StatusCallback): Promise<void> {
    this.startTiming('FLOOR_PLANS_5C');

    const candidateSet = (this.state.stageResults as any).candidates as CandidateSet | undefined;
    if (!candidateSet) {
      logger.warn('Stage 5C: No candidates', { modelId: this.modelId });
      this.state.stageResults.floorPlans = { elementCount: 0 };
      this.endTiming('FLOOR_PLANS_5C');
      await this.saveState();
      return;
    }

    // Build meshes deterministically from resolved candidates
    const meshElements = buildMeshes(candidateSet);

    // Transform to DB format
    const dbElements = meshElements.map((el, idx) => ({
      id: `ir_${this.modelId}_${idx}`,
      elementId: el.candidateId,
      type: el.elementType,
      elementType: el.elementType,
      name: el.name,
      category: el.category,
      storey: { name: el.storeyName },
      storeyName: el.storeyName,
      material: el.material,
      quantity: 1,
      properties: el.properties,
      geometry: el.geometry,
      location: el.location,
      rfiFlag: el.rfiFlag,
      needsAttention: el.needsAttention,
      attentionReason: el.attentionReason,
    }));

    // Write elements to DB
    if (dbElements.length > 0) {
      await storage.upsertBimElements(this.modelId, dbElements);
      logger.info('Stage 5C: Elements written to DB', { modelId: this.modelId, count: dbElements.length });
    }

    // Write storeys (guard confirmed)
    if (candidateSet.storeys.length > 0) {
      const dbStoreys = await storage.getBimStoreys(this.modelId);
      if (dbStoreys.length === 0) {
        await storage.upsertBimStoreys(this.modelId, candidateSet.storeys.map(s => ({
          name: s.name, elevation: s.elevation_m,
          floorToFloorHeight: s.floor_to_floor_height_m, ceilingHeight: s.ceiling_height_m,
        })));
      }
    }

    // Verification pass: project elements to plan view for audit logging.
    // This is non-blocking — purely for quality metrics.
    try {
      const storey0Elevation = candidateSet.storeys.length > 0
        ? candidateSet.storeys[0].elevation_m + 1.2  // cut at 1.2m above floor (standard plan cut)
        : 1.2;
      const projected = projectToPlan(dbElements, storey0Elevation, 1.5);
      const validProjections = projected.filter(p => p.outline.length >= 3).length;
      logger.info('Stage 5C verification: 2D plan projection audit', {
        modelId: this.modelId,
        totalElements: dbElements.length,
        validProjections,
        projectionCoverage: dbElements.length > 0
          ? `${Math.round((validProjections / dbElements.length) * 100)}%`
          : '0%',
      });
    } catch (projErr) {
      logger.warn('Stage 5C: Plan projection verification failed (non-fatal)', {
        error: (projErr as Error).message,
      });
    }

    // Generate RFIs for unresolved candidates
    const unresolved = collectUnresolved(candidateSet);
    let rfiCount = 0;
    if (unresolved.length > 0) {
      try {
        const model = await storage.getBimModel(this.modelId);
        if (model) rfiCount = await generateReviewItems(unresolved, model.projectId);
      } catch (err) {
        logger.warn('Stage 5C: RFI generation failed (non-fatal)', { error: (err as Error).message });
      }
    }

    await storage.updateBimModel(this.modelId, { status: 'completed' });

    this.state.stageResults.floorPlans = { elementCount: dbElements.length };
    this.endTiming('FLOOR_PLANS_5C');
    await this.saveState();

    const summary = buildReviewSummary(candidateSet);
    logger.info('Stage 5C complete', {
      modelId: this.modelId, meshElements: dbElements.length,
      unresolvedCount: unresolved.length, rfis: rfiCount,
      resolved: summary.resolved, total: summary.total,
    });

    await notify(0.95, `5C complete: ${dbElements.length} 3D elements, ${unresolved.length} unresolved, ${rfiCount} RFIs`);
  }

  // ------------------------------------------------------------------
  // Rebuild: re-run 5B + 5C from existing candidates (no AI calls)
  // ------------------------------------------------------------------

  /**
   * Re-run parameter resolution (5B) and mesh generation (5C) from
   * the existing candidate set. Used after manual candidate edits.
   * Does NOT call Claude again -- purely deterministic rebuild.
   */
  async rebuildFromCandidates(
    statusCallback?: StatusCallback,
  ): Promise<PipelineState> {
    const notify = statusCallback || (async () => {});

    try {
      const candidateSet = (this.state.stageResults as any)?.candidates as CandidateSet | undefined;
      if (!candidateSet) {
        throw new Error('No candidate data in pipeline state. Run the full pipeline first.');
      }

      // Re-run Stage 5B: parameter resolution
      await notify(0.10, 'Rebuild: re-running parameter resolution (5B)');
      this.state.currentStage = 'FLOOR_PLANS_5B' as PipelineStage;
      await this.saveState();
      await this.runStage5B_ParameterResolution(notify);

      // Re-run Stage 5C: mesh generation
      await notify(0.60, 'Rebuild: re-generating 3D meshes (5C)');
      await this.runStage5C_MeshGeneration(notify);

      if ((this.state.currentStage as string) !== 'FAILED') {
        this.setStage('COMPLETE');
        await this.saveState();
        await notify(1.0, 'Rebuild complete');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setError('REBUILD', msg);
      await this.saveState();
      logger.error('Rebuild failed', { modelId: this.modelId, error: msg });
      await notify(1.0, `Rebuild failed: ${msg}`);
    }

    return this.state;
  }
}
