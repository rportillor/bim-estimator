// server/bim/drawing-scale-extractor.ts
// Extracts real drawing scale from construction documents using Claude's vision API.
// Replaces heuristic size-based guessing with actual scale annotation reading.

import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DrawingScaleResult {
  sheet_id: string;
  primary_scale: { ratio: string; factor: number } | null;
  detail_scales: { area: string; ratio: string; factor: number }[];
  scale_bar: { measured_length_mm: number; real_length_m: number } | null;
  confidence: "high" | "medium" | "low";
  source: string; // where on the sheet the scale was found
}

export interface ScaleValidation {
  consistent: boolean;
  dominant_scale: { ratio: string; factor: number } | null;
  outlier_sheets: string[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Prompt for Claude vision
// ---------------------------------------------------------------------------

const SCALE_EXTRACTION_PROMPT = `You are analysing a construction / architectural drawing image.
Your task is to find every scale annotation on this sheet and return structured JSON.

Look for:
1. **Title block** (usually bottom-right) – contains the primary sheet scale.
   Common formats: "Scale: 1:100", "1/4" = 1'-0"", "SCALE 1:50", "As Noted", "NTS".
2. **Detail / section scales** – individual details or sections may have their own
   scale callout (e.g. "DETAIL A  Scale 1:20").
3. **Graphical scale bar** – a graduated bar showing a known real-world length.
   If present, estimate the pixel length of one labelled division and note the
   real-world length it represents.

Return ONLY valid JSON matching this schema (no markdown fences):
{
  "primary_scale_ratio": "<string or null>",
  "detail_scales": [
    { "area": "<label>", "ratio": "<string>" }
  ],
  "scale_bar": {
    "division_pixels": <number>,
    "division_real_length_mm": <number>,
    "total_bar_real_length_mm": <number>
  } | null,
  "source": "<where on the sheet you found the scale, e.g. 'title block bottom-right'>",
  "notes": "<any caveats, e.g. 'NTS noted' or 'scale partially obscured'>"
}

If you cannot find any scale information, return:
{ "primary_scale_ratio": null, "detail_scales": [], "scale_bar": null, "source": "none", "notes": "No scale annotation found" }`;

// ---------------------------------------------------------------------------
// Scale string → numeric factor conversion
// ---------------------------------------------------------------------------

/**
 * Convert a scale string to a single multiplier that converts drawing
 * millimetres to real-world metres.
 *
 * Examples:
 *   "1:100"        → 0.01    (1 mm on drawing = 100 mm real → 0.1 m)
 *   "1:50"         → 0.02
 *   "1/4\" = 1'-0\"" → imperial conversion
 *   "NTS"          → null (not to scale)
 */
export function computeScaleFactor(scaleString: string): number | null {
  if (!scaleString || typeof scaleString !== 'string') return null;

  const s = scaleString.trim().toUpperCase();

  // Flag unreliable scales
  if (/^(NTS|NOT\s+TO\s+SCALE|AS\s+NOTED|NONE|N\/A)$/i.test(s)) {
    return null;
  }

  // ── Metric ratio  "1:N" or "1 : N" ──────────────────────────────────
  const metricMatch = s.match(/^1\s*:\s*([\d.]+)$/);
  if (metricMatch) {
    const denominator = parseFloat(metricMatch[1]);
    if (denominator > 0) {
      // 1 mm on paper = denominator mm real → denominator / 1000 m
      return denominator / 1000;
    }
  }

  // ── Imperial fraction  X/Y" = Z'-W" or X/Y" = Z' ──────────────────
  // e.g. 1/4" = 1'-0", 3/8" = 1'-0", 1" = 1'-0"
  const imperialMatch = s.match(
    /^([\d.]+)\s*\/?\s*([\d.]+)?\s*"?\s*=\s*([\d.]+)\s*'?\s*-?\s*([\d.]+)?\s*"?\s*$/
  );
  if (imperialMatch) {
    const drawingInches = imperialMatch[2]
      ? parseFloat(imperialMatch[1]) / parseFloat(imperialMatch[2])
      : parseFloat(imperialMatch[1]);
    const realFeet = parseFloat(imperialMatch[3]) || 0;
    const realInches = parseFloat(imperialMatch[4]) || 0;
    const realTotalInches = realFeet * 12 + realInches;

    if (drawingInches > 0 && realTotalInches > 0) {
      // ratio = realTotalInches / drawingInches (how many real inches per drawing inch)
      const ratio = realTotalInches / drawingInches;
      // Convert: 1 drawing mm → ratio mm real → ratio / 1000 m
      return ratio / 1000;
    }
  }

  // ── Simple imperial  1" = X' ────────────────────────────────────────
  const simpleImperial = s.match(/^1\s*"?\s*=\s*([\d.]+)\s*'$/);
  if (simpleImperial) {
    const realFeet = parseFloat(simpleImperial[1]);
    if (realFeet > 0) {
      const ratio = realFeet * 12; // real inches per drawing inch
      return ratio / 1000;
    }
  }

  // ── Fraction only  "1/4" or "3/8" (assumed per foot) ────────────────
  const fractionOnly = s.match(/^([\d.]+)\s*\/\s*([\d.]+)\s*"?$/);
  if (fractionOnly) {
    const drawingInches = parseFloat(fractionOnly[1]) / parseFloat(fractionOnly[2]);
    if (drawingInches > 0) {
      // Assume X" = 1'-0"
      const ratio = 12 / drawingInches;
      return ratio / 1000;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

export async function extractDrawingScale(
  anthropicClient: Anthropic,
  imageContent: any[],
  sheetId: string,
): Promise<DrawingScaleResult> {
  try {
    const response = await anthropicClient.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            ...imageContent,
            { type: 'text', text: SCALE_EXTRACTION_PROMPT },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b: any) => b.type === 'text');
    const raw = textBlock ? (textBlock as any).text : '';

    const parsed = parseClaudeResponse(raw);
    return buildResult(parsed, sheetId);
  } catch (err: any) {
    console.error(`[drawing-scale-extractor] Failed for sheet ${sheetId}:`, err?.message ?? err);
    return {
      sheet_id: sheetId,
      primary_scale: null,
      detail_scales: [],
      scale_bar: null,
      confidence: 'low',
      source: 'error',
    };
  }
}

// ---------------------------------------------------------------------------
// Response parsing helpers
// ---------------------------------------------------------------------------

interface ClaudeScaleResponse {
  primary_scale_ratio: string | null;
  detail_scales: { area: string; ratio: string }[];
  scale_bar: {
    division_pixels: number;
    division_real_length_mm: number;
    total_bar_real_length_mm: number;
  } | null;
  source: string;
  notes: string;
}

function parseClaudeResponse(raw: string): ClaudeScaleResponse {
  const defaults: ClaudeScaleResponse = {
    primary_scale_ratio: null,
    detail_scales: [],
    scale_bar: null,
    source: 'unknown',
    notes: '',
  };

  try {
    // Strip markdown code fences if Claude wraps them anyway
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    const obj = JSON.parse(cleaned);
    return {
      primary_scale_ratio: obj.primary_scale_ratio ?? null,
      detail_scales: Array.isArray(obj.detail_scales) ? obj.detail_scales : [],
      scale_bar: obj.scale_bar ?? null,
      source: obj.source ?? 'unknown',
      notes: obj.notes ?? '',
    };
  } catch {
    console.warn('[drawing-scale-extractor] Could not parse Claude response as JSON');
    return defaults;
  }
}

function buildResult(parsed: ClaudeScaleResponse, sheetId: string): DrawingScaleResult {
  // Primary scale
  const primaryFactor = parsed.primary_scale_ratio
    ? computeScaleFactor(parsed.primary_scale_ratio)
    : null;

  const primary_scale = parsed.primary_scale_ratio
    ? { ratio: parsed.primary_scale_ratio, factor: primaryFactor ?? 0 }
    : null;

  // Detail scales
  const detail_scales = parsed.detail_scales
    .map((d) => {
      const factor = computeScaleFactor(d.ratio);
      return { area: d.area, ratio: d.ratio, factor: factor ?? 0 };
    })
    .filter((d) => d.ratio);

  // Scale bar
  let scale_bar: DrawingScaleResult['scale_bar'] = null;
  if (parsed.scale_bar) {
    const { division_real_length_mm, total_bar_real_length_mm } = parsed.scale_bar;
    const realMm = total_bar_real_length_mm || division_real_length_mm || 0;
    if (realMm > 0) {
      scale_bar = {
        measured_length_mm: realMm,
        real_length_m: realMm / 1000,
      };
    }
  }

  // Confidence heuristic
  let confidence: DrawingScaleResult['confidence'] = 'low';
  const notesLower = (parsed.notes ?? '').toLowerCase();
  const isNTS = notesLower.includes('nts') || notesLower.includes('not to scale');

  if (isNTS) {
    confidence = 'low';
  } else if (primary_scale && primaryFactor !== null && primaryFactor > 0) {
    confidence = scale_bar ? 'high' : 'medium';
    // Boost to high if multiple consistent detail scales agree
    if (detail_scales.length > 0 && detail_scales.every((d) => d.factor === primaryFactor)) {
      confidence = 'high';
    }
  } else if (scale_bar) {
    confidence = 'medium';
  }

  return {
    sheet_id: sheetId,
    primary_scale,
    detail_scales,
    scale_bar,
    confidence,
    source: parsed.source || 'unknown',
  };
}

// ---------------------------------------------------------------------------
// Cross-sheet validation
// ---------------------------------------------------------------------------

export function validateScalesAcrossSheets(
  results: DrawingScaleResult[],
): ScaleValidation {
  if (results.length === 0) {
    return {
      consistent: true,
      dominant_scale: null,
      outlier_sheets: [],
      summary: 'No sheets to validate.',
    };
  }

  // Collect primary scale factors (ignore sheets with no detected scale)
  const withScale = results.filter(
    (r) => r.primary_scale && r.primary_scale.factor > 0,
  );

  if (withScale.length === 0) {
    return {
      consistent: false,
      dominant_scale: null,
      outlier_sheets: results.map((r) => r.sheet_id),
      summary: 'No sheets had a detectable primary scale.',
    };
  }

  // Find dominant scale by frequency
  const freq = new Map<number, { count: number; ratio: string }>();
  for (const r of withScale) {
    const f = r.primary_scale!.factor;
    const rounded = Math.round(f * 100000) / 100000; // avoid float noise
    const existing = freq.get(rounded);
    if (existing) {
      existing.count++;
    } else {
      freq.set(rounded, { count: 1, ratio: r.primary_scale!.ratio });
    }
  }

  let dominantFactor = 0;
  let dominantRatio = '';
  let maxCount = 0;
  for (const [factor, { count, ratio }] of freq) {
    if (count > maxCount) {
      maxCount = count;
      dominantFactor = factor;
      dominantRatio = ratio;
    }
  }

  // Identify outliers (sheets whose primary scale differs from dominant)
  const outlier_sheets: string[] = [];
  for (const r of withScale) {
    const rounded = Math.round(r.primary_scale!.factor * 100000) / 100000;
    if (rounded !== Math.round(dominantFactor * 100000) / 100000) {
      outlier_sheets.push(r.sheet_id);
    }
  }

  // Also flag sheets with no detected scale
  for (const r of results) {
    if (!r.primary_scale || r.primary_scale.factor <= 0) {
      outlier_sheets.push(r.sheet_id);
    }
  }

  const consistent = outlier_sheets.length === 0;

  const summary = consistent
    ? `All ${withScale.length} sheets use scale ${dominantRatio} (factor ${dominantFactor}).`
    : `Dominant scale is ${dominantRatio} (${maxCount}/${withScale.length} sheets). ` +
      `${outlier_sheets.length} sheet(s) differ or have no scale: ${outlier_sheets.join(', ')}.`;

  return {
    consistent,
    dominant_scale: { ratio: dominantRatio, factor: dominantFactor },
    outlier_sheets,
    summary,
  };
}
