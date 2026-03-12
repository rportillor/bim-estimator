// server/estimator/construction-sequence-generator.ts
// =============================================================================
// CONSTRUCTION SEQUENCE GENERATOR — AI Proposal Engine
// =============================================================================
//
// Purpose:
//   Given a confirmed BIM model + estimate, ask Claude to propose a realistic
//   construction sequence as a list of P6-compatible activities with:
//     - P6 Activity IDs (A1010 format)
//     - WBS codes (aligned to wbs-cbs.ts standard phases)
//     - Predecessors (finish-to-start by default)
//     - Durations in working days
//     - CSI division mapping
//     - Floor/zone scope
//     - Rationale for each activity placement
//     - Long-lead procurement flags
//     - Critical path candidates
//
//   The QS reviews and confirms (or edits) before any P6 export.
//   Nothing is written to P6 until the QS explicitly confirms.
//
// Standards: AACE 18R-97, P6 XER schema, CCDC 2 schedule requirements,
//            Ontario construction season constraints
// =============================================================================

import Anthropic from '@anthropic-ai/sdk';
import type { EstimateSummary } from './estimate-engine';

// ─── Core Types ──────────────────────────────────────────────────────────────

export interface SequenceActivity {
  // P6 identifiers
  activityId:    string;   // e.g. A1010, A1020 — P6 format, increments by 10
  wbsCode:       string;   // e.g. 1.3.2 — aligns to wbs-cbs.ts phases
  wbsName:       string;   // human-readable WBS phase name

  // Description
  name:          string;   // Activity name (≤48 chars, P6 convention)
  description:   string;   // Longer description for BoE

  // CSI linkage
  csiDivisions:  string[]; // CSI division codes this activity covers
  csiCodes:      string[]; // Specific CSI rate codes from estimate

  // Scope
  floors:        string[]; // Floor labels this activity covers (e.g. ['P1','1st','2nd'])
  zone:          string;   // Zone description (e.g. 'Parkade Level', 'Core', 'Full Floor Plate')

  // Schedule
  durationDays:  number;   // Working days
  lagDays:       number;   // Lag from start of predecessor (0 = FS no lag)
  predecessors:  string[]; // Activity IDs, finish-to-start unless noted
  dependencyType: 'FS' | 'SS' | 'FF' | 'SF'; // P6 relationship type

  // Resource / cost
  crewType:      string;   // e.g. 'CIP Concrete Crew', 'MEP Rough-In Crew'
  crewSize:      number;   // Workers
  estimatedCost: number;   // $ from estimate line items rolled up to this activity
  costMaterial:  number;
  costLabour:    number;
  costEquipment: number;

  // Flags
  isCriticalPath: boolean;     // AI-assessed critical path candidate
  isLongLead:    boolean;      // Procurement lead > 8 weeks
  longLeadItem:  string | null; // e.g. 'Elevator equipment — 16 weeks'
  isMilestone:   boolean;      // Key project milestone

  // AI reasoning — shown to QS during review
  rationale:     string;   // Why this activity is here, in this sequence
  assumptions:   string[]; // What the AI assumed (for QS to verify)
  risks:         string[];  // Schedule risks flagged by AI

  // QS edit tracking
  qsEdited:      boolean;  // True if QS changed this activity
  qsComment:     string;   // QS note on this activity
}

export interface ConstructionSequenceProposal {
  // Identity
  projectId:     string;
  modelId:       string;
  projectName:   string;

  // Activities in proposed sequence order (= sort order for Gantt)
  activities:    SequenceActivity[];

  // Overall schedule
  totalDurationDays:  number;
  estimatedStartDate: string | null;  // ISO — from project settings or null
  estimatedEndDate:   string | null;

  // AI summary
  rationale:          string;   // Overall sequencing rationale
  constructionMethod: string;   // e.g. 'CIP concrete, bottom-up, 5-storey'
  keyAssumptions:     string[]; // Project-level assumptions
  warnings:           string[]; // Issues the QS must resolve before confirming
  criticalPath:       string[]; // Activity IDs on the critical path

  // Long-lead register
  longLeadItems: Array<{
    activityId:   string;
    item:         string;
    leadWeeks:    number;
    orderByDate:  string | null; // ISO — based on estimated start
  }>;

  // Metadata
  generatedAt:    string;  // ISO
  modelFloors:    string[];
  constructionType: string;
}

// ─── WBS Phase Map (must match wbs-cbs.ts) ───────────────────────────────────

const WBS_PHASES: Record<string, { code: string; name: string }> = {
  'pre-construction':   { code: '1.1',  name: 'Pre-Construction' },
  'site-prep':          { code: '1.2',  name: 'Site Preparation' },
  'foundations':        { code: '1.3',  name: 'Foundations & Substructure' },
  'superstructure':     { code: '1.4',  name: 'Superstructure' },
  'envelope':           { code: '1.5',  name: 'Building Envelope' },
  'interior':           { code: '1.6',  name: 'Interior Construction' },
  'mechanical':         { code: '1.7',  name: 'Mechanical Systems' },
  'electrical':         { code: '1.8',  name: 'Electrical Systems' },
  'conveying':          { code: '1.9',  name: 'Conveying Systems' },
  'sitework':           { code: '1.10', name: 'Site Work & Landscaping' },
  'commissioning':      { code: '1.11', name: 'Commissioning & Closeout' },
};

// ─── Generator Class ─────────────────────────────────────────────────────────

export class ConstructionSequenceGenerator {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  /**
   * Propose a construction sequence from BIM model data and estimate summary.
   * Returns a structured proposal for QS review — nothing is saved here.
   */
  async propose(params: {
    projectId:        string;
    modelId:          string;
    projectName:      string;
    constructionType: string;    // from geometryData.constructionType
    floors:           string[];  // ordered floor list from BIM storeys
    floorCount:       number;
    gfa:              number;    // m²
    estimate:         EstimateSummary;
    projectStartDate: string | null;
    occupancyGroup:   string | null;
    seismicZone:      string | null;
    geometryData:     Record<string, any>;
  }): Promise<ConstructionSequenceProposal> {

    const { projectId, modelId, projectName, constructionType, floors,
            floorCount, gfa, estimate, projectStartDate, occupancyGroup,
            geometryData } = params;

    // Build a concise project summary for the prompt
    const divisionSummary = this.buildDivisionSummary(estimate);
    const floorCosts = this.buildFloorCostSummary(estimate);

    const prompt = this.buildPrompt({
      projectName, constructionType, floors, floorCount, gfa,
      divisionSummary, floorCosts, projectStartDate, occupancyGroup,
      geometryData,
    });

    const response = await this.anthropic.messages.create({
      model:      'claude-opus-4-5',
      max_tokens: 8000,
      messages:   [{ role: 'user', content: prompt }],
    });

    const rawText = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    const parsed = this.parseResponse(rawText);
    return this.buildProposal(parsed, params);
  }

  // ─── Prompt Builder ─────────────────────────────────────────────────────────

  private buildPrompt(p: {
    projectName:      string;
    constructionType: string;
    floors:           string[];
    floorCount:       number;
    gfa:              number;
    divisionSummary:  string;
    floorCosts:       string;
    projectStartDate: string | null;
    occupancyGroup:   string | null;
    geometryData:     Record<string, any>;
  }): string {
    return `You are a senior construction scheduler with 25+ years of experience
scheduling CIP concrete residential/mixed-use buildings in Ontario, Canada.
You are fluent in Primavera P6 and AACE scheduling standards.

PROJECT: ${p.projectName}
Construction type: ${p.constructionType}
Floors: ${p.floors.join(', ')} (${p.floorCount} storeys)
GFA: ${p.gfa.toLocaleString()} m²
Occupancy: ${p.occupancyGroup || 'Residential Group C (assumed)'}
Project start: ${p.projectStartDate || 'TBD — assume Spring 2026'}
Province: Ontario, Canada (Factor in winter shutdown Dec–Feb for outdoor work)

ESTIMATE SUMMARY BY CSI DIVISION:
${p.divisionSummary}

ESTIMATE BY FLOOR:
${p.floorCosts}

TASK: Propose a complete, realistic construction sequence as a list of P6 activities.

RULES:
1. Activity IDs: A1010, A1020, A1030... (increment by 10)
2. Use WBS codes from this fixed list (must match exactly):
   1.1  Pre-Construction
   1.2  Site Preparation
   1.3  Foundations & Substructure
   1.3.1 Excavation & Shoring
   1.3.2 Footings
   1.3.3 Foundation Walls
   1.3.4 Slab on Grade
   1.3.5 Waterproofing
   1.4  Superstructure
   1.4.1 Structural Concrete per floor (repeat for each floor)
   1.5  Building Envelope
   1.6  Interior Construction
   1.7  Mechanical Systems
   1.8  Electrical Systems
   1.9  Conveying Systems
   1.10 Site Work & Landscaping
   1.11 Commissioning & Closeout
3. Durations: realistic working days for Ontario ICI construction
4. Predecessors: finish-to-start unless a different relationship is clearly needed (SS/FF/SF)
5. Mark isCriticalPath=true for activities on the anticipated critical path
6. Mark isLongLead=true for equipment/materials with >8 week procurement lead
7. Floors with CIP concrete: each floor slab is a separate activity with FS to previous floor
8. MEP rough-in follows structural concrete per floor (SS with lag = concrete cure time)
9. Include Ontario winter shutdown if the schedule spans Dec–Feb
10. Each activity MUST have a rationale (1–2 sentences explaining placement)
11. Each activity MUST list assumptions the QS must verify
12. Flag any risks (weather, permit, long-lead) in the risks array

RESPOND WITH ONLY VALID JSON — no preamble, no markdown fences, nothing else.

JSON schema:
{
  "rationale": "Overall sequencing approach in 2-3 sentences",
  "constructionMethod": "One sentence describing the construction method",
  "keyAssumptions": ["string"],
  "warnings": ["string — items QS must resolve before confirming this sequence"],
  "criticalPath": ["A1010","A1020",...],
  "totalDurationDays": 450,
  "longLeadItems": [
    { "activityId": "A1010", "item": "Elevator equipment", "leadWeeks": 16, "orderByDate": null }
  ],
  "activities": [
    {
      "activityId": "A1010",
      "wbsCode": "1.1",
      "wbsName": "Pre-Construction",
      "name": "Permits & Shop Drawings",
      "description": "Obtain building permit, structural shop drawings, MEP submittals",
      "csiDivisions": ["01"],
      "csiCodes": ["013200"],
      "floors": [],
      "zone": "Project-wide",
      "durationDays": 60,
      "lagDays": 0,
      "predecessors": [],
      "dependencyType": "FS",
      "crewType": "PM / Coordinator",
      "crewSize": 2,
      "estimatedCost": 0,
      "costMaterial": 0,
      "costLabour": 0,
      "costEquipment": 0,
      "isCriticalPath": true,
      "isLongLead": false,
      "longLeadItem": null,
      "isMilestone": true,
      "rationale": "All construction activities depend on permit issuance.",
      "assumptions": ["Permit submitted at project start"],
      "risks": ["City review backlog could extend by 4-6 weeks"],
      "qsEdited": false,
      "qsComment": ""
    }
  ]
}`;
  }

  // ─── Response Parser ─────────────────────────────────────────────────────────

  private parseResponse(raw: string): any {
    // Strip any accidental markdown fences
    const clean = raw.replace(/```json[\s\S]*?```|```/g, '').trim();
    const start = clean.indexOf('{');
    const end   = clean.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON object found in AI response');
    return JSON.parse(clean.slice(start, end + 1));
  }

  // ─── Proposal Builder ────────────────────────────────────────────────────────

  private buildProposal(
    parsed:  any,
    params:  Parameters<ConstructionSequenceGenerator['propose']>[0],
  ): ConstructionSequenceProposal {
    const { projectId, modelId, projectName, constructionType,
            floors, estimate, projectStartDate } = params;

    // Distribute estimate costs to activities by matching CSI divisions
    const activities: SequenceActivity[] = (parsed.activities || []).map((a: any) => {
      const cost = this.rollUpCost(a.csiDivisions || [], a.floors || [], estimate);
      return {
        activityId:     a.activityId     || '',
        wbsCode:        a.wbsCode        || '1.0',
        wbsName:        a.wbsName        || '',
        name:           (a.name || '').slice(0, 48),
        description:    a.description    || '',
        csiDivisions:   a.csiDivisions   || [],
        csiCodes:       a.csiCodes       || [],
        floors:         a.floors         || [],
        zone:           a.zone           || '',
        durationDays:   Number(a.durationDays)  || 1,
        lagDays:        Number(a.lagDays)       || 0,
        predecessors:   a.predecessors   || [],
        dependencyType: a.dependencyType || 'FS',
        crewType:       a.crewType       || '',
        crewSize:       Number(a.crewSize) || 1,
        estimatedCost:  cost.total,
        costMaterial:   cost.material,
        costLabour:     cost.labour,
        costEquipment:  cost.equipment,
        isCriticalPath: Boolean(a.isCriticalPath),
        isLongLead:     Boolean(a.isLongLead),
        longLeadItem:   a.longLeadItem   || null,
        isMilestone:    Boolean(a.isMilestone),
        rationale:      a.rationale      || '',
        assumptions:    a.assumptions    || [],
        risks:          a.risks          || [],
        qsEdited:       false,
        qsComment:      '',
      } as SequenceActivity;
    });

    const totalDays = Number(parsed.totalDurationDays) || this.sumDuration(activities);

    // Compute estimated end date if start is known
    let estimatedEndDate: string | null = null;
    if (projectStartDate) {
      const start = new Date(projectStartDate);
      // Working days → calendar days rough conversion (×1.4 for weekends)
      const calDays = Math.round(totalDays * 1.4);
      start.setDate(start.getDate() + calDays);
      estimatedEndDate = start.toISOString().split('T')[0];
    }

    return {
      projectId,
      modelId,
      projectName,
      activities,
      totalDurationDays:  totalDays,
      estimatedStartDate: projectStartDate,
      estimatedEndDate,
      rationale:          parsed.rationale          || '',
      constructionMethod: parsed.constructionMethod || constructionType,
      keyAssumptions:     parsed.keyAssumptions     || [],
      warnings:           parsed.warnings           || [],
      criticalPath:       parsed.criticalPath       || [],
      longLeadItems:      (parsed.longLeadItems || []).map((ll: any) => ({
        activityId:  ll.activityId  || '',
        item:        ll.item        || '',
        leadWeeks:   Number(ll.leadWeeks) || 0,
        orderByDate: ll.orderByDate || null,
      })),
      generatedAt:        new Date().toISOString(),
      modelFloors:        floors,
      constructionType,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private buildDivisionSummary(estimate: EstimateSummary): string {
    const byDiv = new Map<string, number>();
    for (const floor of estimate.floors) {
      for (const item of floor.lineItems) {
        const div = item.csiDivision || '00';
        byDiv.set(div, (byDiv.get(div) || 0) + item.totalCost);
      }
    }
    return [...byDiv.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([div, cost]) => `  Div ${div}: $${cost.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`)
      .join('\n');
  }

  private buildFloorCostSummary(estimate: EstimateSummary): string {
    return estimate.floors
      .map(f => `  ${f.floor}: $${f.subtotal.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`)
      .join('\n');
  }

  private rollUpCost(
    csiDivisions: string[],
    actFloors:    string[],
    estimate:     EstimateSummary,
  ): { total: number; material: number; labour: number; equipment: number } {
    let total = 0, material = 0, labour = 0, equipment = 0;
    const divSet   = new Set(csiDivisions.map(d => d.replace(/^0+/, '')));
    const floorSet = new Set(actFloors.map(f => f.toLowerCase()));
    const allFloors = actFloors.length === 0; // activity covers all floors

    for (const floorSummary of estimate.floors) {
      const floorMatch = allFloors || floorSet.has(floorSummary.floor.toLowerCase());
      if (!floorMatch) continue;
      for (const item of floorSummary.lineItems) {
        const itemDiv = (item.csiDivision || '').replace(/^0+/, '');
        if (divSet.size === 0 || divSet.has(itemDiv)) {
          total     += item.totalCost      || 0;
          material  += item.materialCost   || 0;
          labour    += item.laborCost      || 0;
          equipment += item.equipmentCost  || 0;
        }
      }
    }
    return { total, material, labour, equipment };
  }

  private sumDuration(activities: SequenceActivity[]): number {
    // Rough critical path: sum of activities with no successors on CP
    const cpIds = new Set(activities.filter(a => a.isCriticalPath).map(a => a.activityId));
    return activities
      .filter(a => cpIds.has(a.activityId))
      .reduce((sum, a) => sum + a.durationDays + a.lagDays, 0);
  }
}

// ─── P6 XER Export ───────────────────────────────────────────────────────────
//
// Primavera XER is a tab-delimited text format.
// Tables used here: CALENDAR, PROJECT, WBS, TASK, TASKPRED, RSRC, TASKRSRC
// Sufficient for P6 import of activities, WBS, and relationships.
// ─────────────────────────────────────────────────────────────────────────────

export function generateP6XER(
  proposal:    ConstructionSequenceProposal,
  projectCode: string,
  calendarId:  string = 'CAL-1',
): string {
  const lines: string[] = [];
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // ── Header ──────────────────────────────────────────────────────────────────
  lines.push('ERMHDR\t19.12\t' + now + '\tAdmin\t\tProject');
  lines.push('');

  // ── CALENDAR ────────────────────────────────────────────────────────────────
  lines.push('%T\tCALENDAR');
  lines.push('%F\tclndr_id\tclndr_name\tdefault_flag\tclndr_type\tday_hr_cnt\tweek_hr_cnt\tmonth_hr_cnt\tyear_hr_cnt');
  lines.push(`%R\t${calendarId}\tOntario ICI 5-Day\tY\tGlobal\t8\t40\t160\t1920`);
  lines.push('');

  // ── PROJECT ─────────────────────────────────────────────────────────────────
  lines.push('%T\tPROJECT');
  lines.push('%F\tproj_id\tproj_short_name\tproj_name\tplan_start_date\tplan_end_date\tcreate_date\tclndr_id');
  const startDate = proposal.estimatedStartDate || new Date().toISOString().split('T')[0];
  const endDate   = proposal.estimatedEndDate   || '';
  lines.push(`%R\t${projectCode}\t${projectCode}\t${proposal.projectName}\t${startDate}\t${endDate}\t${now}\t${calendarId}`);
  lines.push('');

  // ── WBS ─────────────────────────────────────────────────────────────────────
  lines.push('%T\tWBS');
  lines.push('%F\twbs_id\tproj_id\twbs_short_name\twbs_name\tparent_wbs_id\tseq_num');
  // Collect unique WBS codes from activities
  const wbsSeen = new Map<string, string>(); // code → name
  wbsSeen.set('1.0', proposal.projectName);
  for (const act of proposal.activities) {
    if (!wbsSeen.has(act.wbsCode)) wbsSeen.set(act.wbsCode, act.wbsName);
  }
  let wbsSeq = 10;
  for (const [code, name] of wbsSeen) {
    const parts = code.split('.');
    const parentCode = parts.length > 1 ? parts.slice(0, -1).join('.') : '';
    lines.push(`%R\t${projectCode}-${code}\t${projectCode}\t${code}\t${name}\t${parentCode ? projectCode + '-' + parentCode : ''}\t${wbsSeq}`);
    wbsSeq += 10;
  }
  lines.push('');

  // ── TASK (Activities) ────────────────────────────────────────────────────────
  lines.push('%T\tTASK');
  lines.push('%F\ttask_id\tproj_id\twbs_id\ttask_code\ttask_name\ttask_type\tduration_type\torig_duration\tremain_duration\tclndr_id\ttarget_start_date\ttarget_end_date\tcost_budget_units');
  let taskSeq = 1000;
  const taskIdMap = new Map<string, number>(); // activityId → internal task_id
  for (const act of proposal.activities) {
    taskIdMap.set(act.activityId, taskSeq);
    const taskType = act.isMilestone ? 'TT_Mile' : 'TT_Task';
    lines.push(
      `%R\t${taskSeq}\t${projectCode}\t${projectCode}-${act.wbsCode}\t` +
      `${act.activityId}\t${act.name}\t${taskType}\tDT_FixedDrtn\t` +
      `${act.durationDays}\t${act.durationDays}\t${calendarId}\t\t\t${act.estimatedCost.toFixed(2)}`
    );
    taskSeq += 10;
  }
  lines.push('');

  // ── TASKPRED (Predecessors) ──────────────────────────────────────────────────
  lines.push('%T\tTASKPRED');
  lines.push('%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt');
  let predId = 5000;
  for (const act of proposal.activities) {
    const succId = taskIdMap.get(act.activityId);
    if (!succId) continue;
    for (const predActId of act.predecessors) {
      const predId2 = taskIdMap.get(predActId);
      if (!predId2) continue;
      const lagHrs = act.lagDays * 8; // working hours
      const p6RelType = act.dependencyType === 'SS' ? 'PR_SS'
                       : act.dependencyType === 'FF' ? 'PR_FF'
                       : act.dependencyType === 'SF' ? 'PR_SF'
                       : 'PR_FS';
      lines.push(`%R\t${predId}\t${succId}\t${predId2}\t${p6RelType}\t${lagHrs}`);
      predId++;
    }
  }
  lines.push('');

  // ── End ──────────────────────────────────────────────────────────────────────
  lines.push('%E');

  return lines.join('\n');
}

// ─── MS Project XML (enhanced with confirmed sequence data) ──────────────────

export function generateSequenceMSProjectXML(
  proposal:    ConstructionSequenceProposal,
  projectCode: string,
): string {
  const startDate = proposal.estimatedStartDate || new Date().toISOString().split('T')[0];

  const taskXml = proposal.activities.map((act, idx) => {
    const uid   = idx + 1;
    const wbsId = act.wbsCode;
    const predXml = act.predecessors
      .map(predActId => {
        const predIdx = proposal.activities.findIndex(a => a.activityId === predActId);
        if (predIdx === -1) return '';
        const p6TypeMap: Record<string, number> = { FS: 1, SS: 2, FF: 3, SF: 4 };
        return `<PredecessorLink><PredecessorUID>${predIdx + 1}</PredecessorUID>` +
               `<Type>${p6TypeMap[act.dependencyType] || 1}</Type>` +
               `<LinkLag>${act.lagDays * 4800}</LinkLag></PredecessorLink>`;
      }).join('');

    return `  <Task>
    <UID>${uid}</UID>
    <ID>${uid}</ID>
    <Name>${escXml(act.name)}</Name>
    <Type>${act.isMilestone ? 1 : 0}</Type>
    <Duration>PT${act.durationDays * 8}H0M0S</Duration>
    <Work>PT${act.durationDays * act.crewSize * 8}H0M0S</Work>
    <Cost>${act.estimatedCost.toFixed(2)}</Cost>
    <WBS>${escXml(wbsId)}</WBS>
    <Notes>${escXml(act.rationale)}</Notes>
    <Milestone>${act.isMilestone ? 1 : 0}</Milestone>
    <Critical>${act.isCriticalPath ? 1 : 0}</Critical>
    ${predXml}
  </Task>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Name>${escXml(proposal.projectName)}</Name>
  <SaveVersion>14</SaveVersion>
  <StartDate>${startDate}T08:00:00</StartDate>
  <CalendarUID>1</CalendarUID>
  <Tasks>
${taskXml}
  </Tasks>
  <Calendars>
    <Calendar>
      <UID>1</UID>
      <Name>Ontario ICI 5-Day</Name>
      <IsBaseCalendar>1</IsBaseCalendar>
    </Calendar>
  </Calendars>
</Project>`;
}

function escXml(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
