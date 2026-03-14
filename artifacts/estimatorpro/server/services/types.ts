/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  Re-export barrel for SOP modules (Parts 3–8, Appendix A)
 *  
 *  SOP modules import from './types' — this re-exports from './shared-types'
 *  which contains Gap, EvidenceReference, Discipline, formatEvidenceRef, etc.
 * ══════════════════════════════════════════════════════════════════════════════
 */
export * from './shared-types';
