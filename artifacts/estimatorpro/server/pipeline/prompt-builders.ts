// server/pipeline/prompt-builders.ts
// Functions that format prior stage results into Claude prompt context.
// Each function produces structured text that Claude can reference when analyzing the next stage.

import type {
  ScheduleData,
  AssemblyData,
  AssemblyDefinition,
  SpecificationData,
  GridData,
} from './stage-types';

/**
 * Formats schedule data (doors, windows, finishes) as a text block for Claude.
 * Used as context in Stage 2 (Sections) and later stages.
 */
export function buildScheduleContext(data: ScheduleData): string {
  const lines: string[] = [];
  lines.push('=== SCHEDULE DATA (from prior extraction) ===');
  lines.push(`Units: ${data.units}`);

  if (data.doors.length > 0) {
    lines.push('');
    lines.push('-- Door Schedule --');
    for (const d of data.doors) {
      let entry = `  ${d.mark}: ${d.width_mm}x${d.height_mm}mm, type="${d.type}"`;
      if (d.fire_rating) entry += `, fire_rating="${d.fire_rating}"`;
      if (d.hardware) entry += `, hardware="${d.hardware}"`;
      if (d.thickness_mm) entry += `, thickness=${d.thickness_mm}mm`;
      lines.push(entry);
    }
  }

  if (data.windows.length > 0) {
    lines.push('');
    lines.push('-- Window Schedule --');
    for (const w of data.windows) {
      let entry = `  ${w.mark}: ${w.width_mm}x${w.height_mm}mm, type="${w.type}"`;
      if (w.glazing) entry += `, glazing="${w.glazing}"`;
      if (w.sill_height_mm != null) entry += `, sill_height=${w.sill_height_mm}mm`;
      lines.push(entry);
    }
  }

  if (data.finishes.length > 0) {
    lines.push('');
    lines.push('-- Finish Schedule --');
    for (const f of data.finishes) {
      let entry = `  Room "${f.room}": floor="${f.floor}", wall="${f.wall}", ceiling="${f.ceiling}"`;
      if (f.baseboard) entry += `, baseboard="${f.baseboard}"`;
      lines.push(entry);
    }
  }

  lines.push('=== END SCHEDULE DATA ===');
  return lines.join('\n');
}

/**
 * Formats wall/slab/roof assembly definitions for Claude.
 * Used as context in Stage 3 (Specifications) and later stages.
 */
export function buildAssemblyContext(data: AssemblyData): string {
  const lines: string[] = [];
  lines.push('=== ASSEMBLY DATA (from section/detail drawings) ===');
  lines.push(`Units: ${data.units}`);

  const formatAssembly = (label: string, record: Record<string, AssemblyDefinition>) => {
    const codes = Object.keys(record);
    if (codes.length === 0) return;
    lines.push('');
    lines.push(`-- ${label} --`);
    for (const code of codes) {
      const asm = record[code];
      lines.push(`  ${asm.code}: "${asm.description}", total_thickness=${asm.totalThickness_mm}mm`);
      if (asm.fire_rating) lines.push(`    fire_rating: ${asm.fire_rating}`);
      if (asm.acoustic_rating) lines.push(`    acoustic_rating: ${asm.acoustic_rating}`);
      if (asm.source_drawing) lines.push(`    source: ${asm.source_drawing}`);
      for (const layer of asm.layers) {
        lines.push(`    - ${layer.material} (${layer.thickness_mm}mm) [${layer.function}]`);
      }
    }
  };

  formatAssembly('Wall Types', data.wallTypes);
  formatAssembly('Slab Types', data.slabTypes);
  formatAssembly('Roof Types', data.roofTypes);

  lines.push('=== END ASSEMBLY DATA ===');
  return lines.join('\n');
}

/**
 * Formats material specifications and CSI codes for Claude.
 * Used as context in Stage 5 (Floor Plans).
 */
export function buildSpecContext(data: SpecificationData): string {
  const lines: string[] = [];
  lines.push('=== SPECIFICATION DATA (from spec documents) ===');
  lines.push(`Units: ${data.units}`);

  if (data.products.length > 0) {
    lines.push('');
    lines.push('-- Products & Materials --');
    for (const p of data.products) {
      let entry = `  CSI ${p.csiCode}: ${p.description}, material="${p.material}"`;
      if (p.standard) entry += `, standard="${p.standard}"`;
      if (p.manufacturer) entry += `, manufacturer="${p.manufacturer}"`;
      if (p.source_section) entry += `, section="${p.source_section}"`;
      lines.push(entry);
    }
  }

  if (data.standards.length > 0) {
    lines.push('');
    lines.push('-- Referenced Standards --');
    for (const s of data.standards) {
      lines.push(`  ${s.code}: "${s.title}" (applies to: ${s.applicableTo})`);
    }
  }

  lines.push('=== END SPECIFICATION DATA ===');
  return lines.join('\n');
}

/**
 * Formats the confirmed grid system for element placement in Stage 5.
 */
export function buildGridContext(data: GridData): string {
  const lines: string[] = [];
  lines.push('=== CONFIRMED GRID SYSTEM ===');
  lines.push(`Origin: ${data.originLabel.letter}-${data.originLabel.number}`);
  lines.push(`Alpha direction: ${data.alphaDirection}`);
  lines.push(`Numeric direction: ${data.numericDirection}`);
  lines.push(`Confirmed: ${data.confirmed}`);

  if (data.alphaGridlines.length > 0) {
    lines.push('');
    lines.push('-- Alpha Gridlines (letters) --');
    for (const g of data.alphaGridlines) {
      lines.push(`  ${g.label}: position=${g.position_m}m, angle=${g.angle_deg}deg`);
    }
  }

  if (data.numericGridlines.length > 0) {
    lines.push('');
    lines.push('-- Numeric Gridlines (numbers) --');
    for (const g of data.numericGridlines) {
      lines.push(`  ${g.label}: position=${g.position_m}m, angle=${g.angle_deg}deg`);
    }
  }

  if (data.notes.length > 0) {
    lines.push('');
    lines.push('-- Notes --');
    for (const n of data.notes) {
      lines.push(`  - ${n}`);
    }
  }

  lines.push('=== END GRID SYSTEM ===');
  return lines.join('\n');
}

/**
 * Combines all prior stage contexts into a single block for Stage 5 (Floor Plans).
 * This gives Claude the full picture: schedules, assemblies, specs, and grid.
 */
export function buildFullContext(stages: {
  schedules?: ScheduleData;
  sections?: AssemblyData;
  specifications?: SpecificationData;
  grid?: GridData;
}): string {
  const parts: string[] = [];

  if (stages.schedules) {
    parts.push(buildScheduleContext(stages.schedules));
  }
  if (stages.sections) {
    parts.push(buildAssemblyContext(stages.sections));
  }
  if (stages.specifications) {
    parts.push(buildSpecContext(stages.specifications));
  }
  if (stages.grid) {
    parts.push(buildGridContext(stages.grid));
  }

  return parts.join('\n\n');
}
