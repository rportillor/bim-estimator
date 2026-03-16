// server/pipeline/view-classifier.ts
// Classifies drawing documents by view type (plan, section, elevation, detail)
// so each can be processed with view-specific logic in Stage 5A.

import type { Document } from '@shared/schema';
import type { ViewType } from './view-projection';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ClassifiedDocument {
  document: Document;
  viewType: ViewType;
  level?: string;        // e.g. "Ground Floor" for plan views
  sectionMark?: string;  // e.g. "A-A" for section views
  elevation?: string;    // e.g. "North" for elevation views
  scale?: string;        // e.g. "1:100"
  confidence: 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Classification patterns
// ---------------------------------------------------------------------------

const PLAN_FILENAME_PATTERN = /floor\s*plan|plan\s*view|A[12]\d{2}|level\s*plan|parking\s*plan|ground\s*(?:floor|plan)|basement\s*plan|roof\s*plan|typical\s*plan|mezzanine\s*plan/i;
const SECTION_FILENAME_PATTERN = /section|building\s*section|wall\s*section|A[34]\d{2}|cross[\s-]?section|long[\s-]?section/i;
const ELEVATION_FILENAME_PATTERN = /elevation|A3\d{2}|facade|exterior\s*view/i;
const DETAIL_FILENAME_PATTERN = /detail|typical\s*detail|A5\d{2}|construction\s*assembl|assembly\s*detail|wall\s*type|stair\s*detail/i;

const PLAN_CONTENT_KEYWORDS = [
  'FLOOR PLAN', 'PLAN VIEW', 'GROUND FLOOR', 'LEVEL PLAN',
  'PARKING PLAN', 'BASEMENT PLAN', 'ROOF PLAN', 'TYPICAL FLOOR',
  'UPPER FLOOR', 'MEZZANINE', 'FIRST FLOOR', 'SECOND FLOOR',
  'THIRD FLOOR', 'PENTHOUSE',
];
const SECTION_CONTENT_KEYWORDS = [
  'SECTION A-A', 'SECTION B-B', 'SECTION C-C', 'SECTION D-D',
  'BUILDING SECTION', 'WALL SECTION', 'CROSS SECTION',
  'LONGITUDINAL SECTION', 'TRANSVERSE SECTION',
  'SECTION 1', 'SECTION 2', 'SECTION 3',
];
const ELEVATION_CONTENT_KEYWORDS = [
  'NORTH ELEVATION', 'SOUTH ELEVATION', 'EAST ELEVATION', 'WEST ELEVATION',
  'FRONT ELEVATION', 'REAR ELEVATION', 'SIDE ELEVATION',
  'EXTERIOR ELEVATION', 'INTERIOR ELEVATION',
];
const DETAIL_CONTENT_KEYWORDS = [
  'DETAIL', 'TYPICAL DETAIL', 'CONSTRUCTION ASSEMBLY',
  'WALL TYPE', 'ASSEMBLY DETAIL', 'STAIR DETAIL',
  'WINDOW DETAIL', 'DOOR DETAIL', 'CONNECTION DETAIL',
];

// ---------------------------------------------------------------------------
// Helpers: extract metadata from filename and content
// ---------------------------------------------------------------------------

function extractLevel(filename: string, content: string): string | undefined {
  // Try to extract level/floor designation
  const patterns = [
    /(?:level|floor|storey)\s*(\d+|[A-Z])/i,
    /(?:ground|basement|mezzanine|penthouse)\s*(?:floor)?/i,
    /([A-Z]?\d+)\s*(?:st|nd|rd|th)\s*floor/i,
    /L(\d+)/i,
    /F(\d+)/i,
    /P(\d+)/i,  // Parking levels
  ];

  for (const text of [filename, content.substring(0, 2000)]) {
    for (const pat of patterns) {
      const match = text.match(pat);
      if (match) return match[0].trim();
    }
  }

  return undefined;
}

function extractSectionMark(filename: string, content: string): string | undefined {
  const patterns = [
    /section\s*([A-Z])\s*-\s*([A-Z])/i,
    /section\s*(\d+)/i,
    /([A-Z])-([A-Z])\s*section/i,
  ];

  for (const text of [filename, content.substring(0, 2000)]) {
    for (const pat of patterns) {
      const match = text.match(pat);
      if (match) return match[0].trim();
    }
  }

  return undefined;
}

function extractElevationDirection(filename: string, content: string): string | undefined {
  const directions = ['NORTH', 'SOUTH', 'EAST', 'WEST', 'FRONT', 'REAR', 'SIDE'];
  const combined = (filename + ' ' + content.substring(0, 2000)).toUpperCase();

  for (const dir of directions) {
    if (combined.includes(dir + ' ELEVATION') || combined.includes(dir + ' ELEV')) {
      return dir.charAt(0) + dir.slice(1).toLowerCase();
    }
  }

  return undefined;
}

function extractScale(content: string): string | undefined {
  const scalePatterns = [
    /(?:scale|sc)[:\s]*(\d+\s*:\s*\d+)/i,
    /(\d+\s*:\s*\d+)/,
    /1\/(\d+)/,
  ];

  const text = content.substring(0, 3000);
  for (const pat of scalePatterns) {
    const match = text.match(pat);
    if (match) return match[1] || match[0];
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Content keyword scoring
// ---------------------------------------------------------------------------

function scoreContentKeywords(content: string, keywords: string[]): number {
  if (!content) return 0;
  const upper = content.substring(0, 5000).toUpperCase();
  let hits = 0;
  for (const kw of keywords) {
    if (upper.includes(kw)) hits++;
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Core: classify a single document
// ---------------------------------------------------------------------------

function classifyDocument(doc: Document): ClassifiedDocument {
  const filename = doc.filename || '';
  const content = (doc as Record<string, unknown>).textContent as string || '';

  // Score each view type by filename pattern + content keywords
  const scores: Record<ViewType, { filenameMatch: boolean; contentHits: number }> = {
    plan: {
      filenameMatch: PLAN_FILENAME_PATTERN.test(filename),
      contentHits: scoreContentKeywords(content, PLAN_CONTENT_KEYWORDS),
    },
    section: {
      filenameMatch: SECTION_FILENAME_PATTERN.test(filename),
      contentHits: scoreContentKeywords(content, SECTION_CONTENT_KEYWORDS),
    },
    elevation: {
      filenameMatch: ELEVATION_FILENAME_PATTERN.test(filename),
      contentHits: scoreContentKeywords(content, ELEVATION_CONTENT_KEYWORDS),
    },
    detail: {
      filenameMatch: DETAIL_FILENAME_PATTERN.test(filename),
      contentHits: scoreContentKeywords(content, DETAIL_CONTENT_KEYWORDS),
    },
  };

  // Compute weighted score for each type
  const weighted: Array<{ type: ViewType; score: number }> = [];
  for (const [type, info] of Object.entries(scores) as Array<[ViewType, typeof scores[ViewType]]>) {
    const filenameWeight = info.filenameMatch ? 3 : 0;
    const contentWeight = info.contentHits;
    weighted.push({ type, score: filenameWeight + contentWeight });
  }

  // Sort by score descending
  weighted.sort((a, b) => b.score - a.score);

  const best = weighted[0];
  const bestScore = best.score;

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low';
  if (bestScore >= 4) {
    confidence = 'high';
  } else if (bestScore >= 2) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  // Default to 'plan' if no signal at all (most drawings are plans)
  const viewType = bestScore > 0 ? best.type : 'plan';

  // Extract metadata based on classified type
  const result: ClassifiedDocument = {
    document: doc,
    viewType,
    confidence,
  };

  switch (viewType) {
    case 'plan':
      result.level = extractLevel(filename, content);
      break;
    case 'section':
      result.sectionMark = extractSectionMark(filename, content);
      break;
    case 'elevation':
      result.elevation = extractElevationDirection(filename, content);
      break;
    case 'detail':
      // details are generic
      break;
  }

  result.scale = extractScale(content);

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify all documents by their drawing view type.
 */
export function classifyDocuments(documents: Document[]): ClassifiedDocument[] {
  return documents.map(doc => classifyDocument(doc));
}

/**
 * Filter classified documents by view type.
 */
export function getDocsByViewType(
  classified: ClassifiedDocument[],
  type: ViewType,
): Document[] {
  return classified
    .filter(c => c.viewType === type)
    .map(c => c.document);
}
