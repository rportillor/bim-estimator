/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  BCF EXPORT — SOP Part 8
 *  EstimatorPro v14.35 — Project-agnostic; projectName must be passed by caller
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Generates BIM Collaboration Format (BCF) 2.1 output:
 *    1. BCF 2.1 XML topics from issue log records
 *    2. Viewpoint references (ISO/SEC/PLAN per clash group)
 *    3. Component lists with IFC GlobalIds
 *    4. CSV export of clash/issue data
 *    5. HTML meeting summary (by test/status/owner/priority, top 10 risks)
 *
 *  Standards: BCF 2.1 (buildingSMART), ISO 19650, CIQS
 *  Consumed by: bim-coordination-router.ts, report-generator.ts
 *  Depends on:  issue-log.ts, dedup-engine.ts
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { IssueRecord, IssueStatus, IssuePriority, RFIRecord } from './issue-log';
import type { ClashGroup } from './dedup-engine';
import type { RawClash } from './spatial-clash-engine';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. BCF 2.1 XML GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

/** BCF Topic (one per issue) */
export interface BCFTopic {
  guid: string;
  topicType: string;
  topicStatus: string;
  title: string;
  description: string;
  priority: string;
  creationDate: string;
  modifiedDate: string;
  assignedTo: string;
  dueDate: string;
  referenceLinks: string[];
  labels: string[];
  components: BCFComponent[];
  viewpoints: BCFViewpointRef[];
}

/** BCF Component reference */
export interface BCFComponent {
  ifcGuid: string;
  originatingSystem: string;
  authoringToolId: string;
  selected: boolean;
  visible: boolean;
  color: string;            // Hex color for visualization
}

/** BCF Viewpoint reference */
export interface BCFViewpointRef {
  guid: string;
  viewpointType: 'ISO' | 'SEC' | 'PLAN';
  snapshot: string;          // Filename reference
}

/**
 * Convert issue status to BCF status vocabulary.
 */
function toBCFStatus(status: IssueStatus): string {
  const map: Record<IssueStatus, string> = {
    OPEN: 'Open',
    IN_REVIEW: 'Active',
    DECISION_REQUIRED: 'Active',
    IN_PROGRESS: 'Active',
    READY_FOR_VERIFY: 'Active',
    RESOLVED: 'Resolved',
    DEFERRED: 'Deferred',
    WONT_FIX: 'Closed',
    DUPLICATE: 'Closed',
  };
  return map[status] || 'Open';
}

/**
 * Convert issue type to BCF topic type vocabulary.
 */
function toBCFTopicType(type: string): string {
  const map: Record<string, string> = {
    hard_clash: 'Clash',
    soft_clash: 'Clearance',
    code_violation: 'Request',
    coordination: 'Information',
    rfi: 'Request',
  };
  return map[type] || 'Information';
}

/**
 * Generate BCF 2.1 topics from issue records.
 */
export function generateBCFTopics(
  issues: IssueRecord[],
  clashGroups?: Map<string, ClashGroup>,
): BCFTopic[] {
  return issues.map(issue => {
    const group = issue.clashGroupId && clashGroups
      ? clashGroups.get(issue.clashGroupId)
      : undefined;

    // Build component list from element IDs
    const components: BCFComponent[] = issue.elementIds.map((elId, idx) => ({
      ifcGuid: elId,
      originatingSystem: 'EstimatorPro',
      authoringToolId: elId,
      selected: idx === 0,  // First element is selected (offender)
      visible: true,
      color: idx === 0 ? 'FF0000' : (idx <= 1 ? 'FF8C00' : '808080'), // Red=offender, Amber=victim, Gray=context
    }));

    // Viewpoint references (3 per group: ISO, SEC, PLAN)
    const viewpoints: BCFViewpointRef[] = [];
    if (group) {
      const baseId = group.groupId;
      viewpoints.push(
        { guid: `${baseId}__ISO`, viewpointType: 'ISO', snapshot: `${baseId}__ISO.png` },
        { guid: `${baseId}__SEC`, viewpointType: 'SEC', snapshot: `${baseId}__SEC.png` },
        { guid: `${baseId}__PLAN`, viewpointType: 'PLAN', snapshot: `${baseId}__PLAN.png` },
      );
    }

    return {
      guid: issue.id,
      topicType: toBCFTopicType(issue.type),
      topicStatus: toBCFStatus(issue.status),
      title: issue.name,
      description: issue.description,
      priority: issue.priority,
      creationDate: issue.createdDate,
      modifiedDate: issue.statusHistory.length > 0
        ? issue.statusHistory[issue.statusHistory.length - 1].date
        : issue.createdDate,
      assignedTo: issue.assignedTo || issue.owner,
      dueDate: issue.targetDate,
      referenceLinks: issue.codeReferences,
      labels: issue.tags,
      components,
      viewpoints,
    };
  });
}

/**
 * Serialize BCF topics to BCF 2.1 XML format.
 * Returns an object of filename → XML content for bcfzip packaging.
 */
export function serializeBCFToXML(topics: BCFTopic[], projectName: string = ''): Map<string, string> {
  const files = new Map<string, string>();

  // bcf.version
  files.set('bcf.version', `<?xml version="1.0" encoding="UTF-8"?>
<Version VersionId="2.1" xsi:noNamespaceSchemaLocation="version.xsd"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <DetailedVersion>2.1</DetailedVersion>
</Version>`);

  // project.bcfp
  files.set('project.bcfp', `<?xml version="1.0" encoding="UTF-8"?>
<ProjectExtension>
  <Project ProjectId="EstimatorPro-BIMCoordination">
    <Name>${projectName || '[PROJECT NAME — RFI REQUIRED: projectId not supplied]'} — BIM Coordination</Name>
  </Project>
  <ExtensionSchema/>
</ProjectExtension>`);

  // Per-topic files
  for (const topic of topics) {
    const topicDir = topic.guid;

    // markup.bcf
    const componentsXml = topic.components.map(c => `
      <Component IfcGuid="${escapeXml(c.ifcGuid)}" Selected="${c.selected}" Visible="${c.visible}">
        <OriginatingSystem>${escapeXml(c.originatingSystem)}</OriginatingSystem>
        <AuthoringToolId>${escapeXml(c.authoringToolId)}</AuthoringToolId>
      </Component>`).join('');

    const viewpointsXml = topic.viewpoints.map(v => `
      <Viewpoint Guid="${escapeXml(v.guid)}">
        <Viewpoint>${escapeXml(v.guid)}.bcfv</Viewpoint>
        <Snapshot>${escapeXml(v.snapshot)}</Snapshot>
      </Viewpoint>`).join('');

    const labelsXml = topic.labels.map(l => `
      <Label>${escapeXml(l)}</Label>`).join('');

    const refLinksXml = topic.referenceLinks.map(r => `
      <ReferenceLink>${escapeXml(r)}</ReferenceLink>`).join('');

    const markupXml = `<?xml version="1.0" encoding="UTF-8"?>
<Markup>
  <Topic Guid="${escapeXml(topic.guid)}" TopicType="${escapeXml(topic.topicType)}" TopicStatus="${escapeXml(topic.topicStatus)}">
    <Title>${escapeXml(topic.title)}</Title>
    <Description>${escapeXml(topic.description)}</Description>
    <Priority>${escapeXml(topic.priority)}</Priority>
    <CreationDate>${escapeXml(topic.creationDate)}</CreationDate>
    <ModifiedDate>${escapeXml(topic.modifiedDate)}</ModifiedDate>
    <AssignedTo>${escapeXml(topic.assignedTo)}</AssignedTo>
    <DueDate>${escapeXml(topic.dueDate)}</DueDate>${refLinksXml}
    <Labels>${labelsXml}
    </Labels>
  </Topic>
  <Viewpoints>${viewpointsXml}
  </Viewpoints>
</Markup>`;

    files.set(`${topicDir}/markup.bcf`, markupXml);

    // viewpoint.bcfv files (camera positions)
    for (const vp of topic.viewpoints) {
      const vpXml = generateViewpointXML(vp, topic);
      files.set(`${topicDir}/${vp.guid}.bcfv`, vpXml);
    }
  }

  return files;
}

/** Generate viewpoint XML based on type (ISO/SEC/PLAN) */
function generateViewpointXML(vp: BCFViewpointRef, topic: BCFTopic): string {
  // Camera positions vary by viewpoint type
  const cameras: Record<string, { eye: string; dir: string; up: string }> = {
    ISO: { eye: '10 10 10', dir: '-1 -1 -1', up: '0 0 1' },
    SEC: { eye: '0 10 5',   dir: '0 -1 0',   up: '0 0 1' },
    PLAN: { eye: '5 5 20',  dir: '0 0 -1',   up: '0 1 0' },
  };

  const cam = cameras[vp.viewpointType] || cameras.ISO;

  const componentVisibility = topic.components.map(c => {
    const color = c.selected ? ' Color="FF0000"' : '';
    return `        <Component IfcGuid="${escapeXml(c.ifcGuid)}"${color}/>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="${escapeXml(vp.guid)}">
  <PerspectiveCamera>
    <CameraViewPoint>${cam.eye}</CameraViewPoint>
    <CameraDirection>${cam.dir}</CameraDirection>
    <CameraUpVector>${cam.up}</CameraUpVector>
    <FieldOfView>60</FieldOfView>
  </PerspectiveCamera>
  <Components>
    <Visibility DefaultVisibility="false">
      <Exceptions>
${componentVisibility}
      </Exceptions>
    </Visibility>
  </Components>
</VisualizationInfo>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. CSV EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate CSV content from issue records (20 columns).
 */
export function generateIssueCSV(issues: IssueRecord[]): string {
  const headers = [
    'Issue Number', 'Name', 'Test ID', 'Type', 'Zone', 'Grid Ref',
    'Priority', 'Owner', 'Assigned To', 'Discipline', 'Status',
    'Created Date', 'Target Date', 'Resolved Date', 'Description',
    'Recommendation', 'Resolution', 'Clash Group', 'RFI Number', 'Element Count',
  ];

  const rows = issues.map(i => [
    i.issueNumber,
    csvEscape(i.name),
    i.testId,
    i.type,
    i.zone,
    i.gridRef,
    i.priority,
    csvEscape(i.owner),
    csvEscape(i.assignedTo),
    i.originDiscipline,
    i.status,
    i.createdDate.substring(0, 10),
    i.targetDate.substring(0, 10),
    i.resolvedDate?.substring(0, 10) || '',
    csvEscape(i.description),
    csvEscape(i.recommendation),
    csvEscape(i.resolution || ''),
    i.clashGroupId || '',
    i.rfiNumber || '',
    String(i.elementIds.length),
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

/**
 * Generate CSV content from raw clashes.
 */
export function generateClashCSV(clashes: RawClash[]): string {
  const headers = [
    'Clash ID', 'Test', 'Category', 'Severity', 'Element A', 'Type A',
    'Discipline A', 'Element B', 'Type B', 'Discipline B', 'Storey',
    'Overlap Volume (m3)', 'Clearance Required (mm)', 'Clearance Actual (mm)',
    'Penetration (mm)', 'Location X', 'Location Y', 'Location Z',
    'Description', 'Code References',
  ];

  const rows = clashes.map(c => [
    c.id.substring(0, 8),
    c.testId,
    c.category,
    c.severity,
    csvEscape(c.elementA.name),
    c.elementA.elementType,
    c.elementA.discipline,
    csvEscape(c.elementB.name),
    c.elementB.elementType,
    c.elementB.discipline,
    c.elementA.storey,
    String(c.overlapVolume_m3),
    String(c.clearanceRequired_mm),
    String(c.clearanceActual_mm),
    String(c.penetrationDepth_mm),
    String(c.location.x.toFixed(3)),
    String(c.location.y.toFixed(3)),
    String(c.location.z.toFixed(3)),
    csvEscape(c.description),
    c.codeReferences.join('; '),
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. HTML MEETING SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

export interface MeetingSummaryData {
  projectName: string;
  meetingDate: string;
  attendees: string[];
  issues: IssueRecord[];
  clashGroups: ClashGroup[];
  deltaHighlights?: string[];        // From delta-tracker
}

/**
 * Generate an HTML meeting summary for weekly coordination.
 */
export function generateHTMLMeetingSummary(data: MeetingSummaryData): string {
  const { projectName, meetingDate, issues, clashGroups, deltaHighlights } = data;

  // Summary statistics
  const openIssues = issues.filter(i => !['RESOLVED', 'WONT_FIX', 'DUPLICATE'].includes(i.status));
  const resolvedThisWeek = issues.filter(i =>
    i.status === 'RESOLVED' &&
    i.resolvedDate &&
    new Date(i.resolvedDate).getTime() > Date.now() - 7 * 86400000
  );
  const overdue = openIssues.filter(i => new Date(i.targetDate).getTime() < Date.now());

  // By status
  const byStatus: Record<string, number> = {};
  for (const i of issues) byStatus[i.status] = (byStatus[i.status] || 0) + 1;

  // By priority
  const byPriority: Record<string, number> = {};
  for (const i of openIssues) byPriority[i.priority] = (byPriority[i.priority] || 0) + 1;

  // By owner
  const byOwner: Record<string, number> = {};
  for (const i of openIssues) byOwner[i.owner] = (byOwner[i.owner] || 0) + 1;

  // Top 10 risks (highest priority open issues)
  const top10 = openIssues
    .sort((a, b) => a.priority.localeCompare(b.priority))
    .slice(0, 10);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>BIM Coordination Meeting — ${escapeHtml(projectName)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; color: #333; }
    h1 { color: #1a5276; border-bottom: 2px solid #1a5276; padding-bottom: 8px; }
    h2 { color: #2980b9; margin-top: 24px; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 13px; }
    th { background-color: #2980b9; color: white; }
    tr:nth-child(even) { background-color: #f9f9f9; }
    .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
    .stat-card { background: #ecf0f1; border-radius: 8px; padding: 16px; text-align: center; }
    .stat-card .number { font-size: 28px; font-weight: bold; color: #2c3e50; }
    .stat-card .label { font-size: 12px; color: #7f8c8d; text-transform: uppercase; }
    .p1 { background: #e74c3c; color: white; padding: 2px 8px; border-radius: 4px; }
    .p2 { background: #e67e22; color: white; padding: 2px 8px; border-radius: 4px; }
    .p3 { background: #f1c40f; color: #333; padding: 2px 8px; border-radius: 4px; }
    .overdue { color: #e74c3c; font-weight: bold; }
    .footer { margin-top: 40px; font-size: 11px; color: #999; border-top: 1px solid #ddd; padding-top: 8px; }
  </style>
</head>
<body>
  <h1>BIM Coordination Meeting Summary</h1>
  <p><strong>Project:</strong> ${escapeHtml(projectName)}<br>
     <strong>Date:</strong> ${escapeHtml(meetingDate)}<br>
     <strong>Generated:</strong> ${new Date().toISOString().substring(0, 19)}</p>

  <div class="stat-grid">
    <div class="stat-card"><div class="number">${issues.length}</div><div class="label">Total Issues</div></div>
    <div class="stat-card"><div class="number">${openIssues.length}</div><div class="label">Open</div></div>
    <div class="stat-card"><div class="number">${resolvedThisWeek.length}</div><div class="label">Resolved This Week</div></div>
    <div class="stat-card"><div class="number ${overdue.length > 0 ? 'overdue' : ''}">${overdue.length}</div><div class="label">Overdue</div></div>
  </div>

  <h2>Status Breakdown</h2>
  <table>
    <tr><th>Status</th><th>Count</th></tr>
    ${Object.entries(byStatus).map(([s, c]) => `<tr><td>${s}</td><td>${c}</td></tr>`).join('')}
  </table>

  <h2>Open Issues by Priority</h2>
  <table>
    <tr><th>Priority</th><th>Count</th></tr>
    ${Object.entries(byPriority).sort().map(([p, c]) => `<tr><td><span class="${p.toLowerCase()}">${p}</span></td><td>${c}</td></tr>`).join('')}
  </table>

  <h2>Open Issues by Owner</h2>
  <table>
    <tr><th>Owner</th><th>Open Issues</th></tr>
    ${Object.entries(byOwner).sort((a, b) => b[1] - a[1]).map(([o, c]) => `<tr><td>${escapeHtml(o)}</td><td>${c}</td></tr>`).join('')}
  </table>

  <h2>Top 10 Risks</h2>
  <table>
    <tr><th>#</th><th>Issue</th><th>Priority</th><th>Zone</th><th>Owner</th><th>Target</th><th>Status</th></tr>
    ${top10.map((i, idx) => `<tr>
      <td>${idx + 1}</td>
      <td>${escapeHtml(i.name)}</td>
      <td><span class="${i.priority.toLowerCase()}">${i.priority}</span></td>
      <td>${escapeHtml(i.zone)}</td>
      <td>${escapeHtml(i.owner)}</td>
      <td${new Date(i.targetDate).getTime() < Date.now() ? ' class="overdue"' : ''}>${i.targetDate.substring(0, 10)}</td>
      <td>${i.status}</td>
    </tr>`).join('')}
  </table>

  ${deltaHighlights && deltaHighlights.length > 0 ? `
  <h2>Delta Highlights (Since Last Drop)</h2>
  <ul>${deltaHighlights.map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` : ''}

  <div class="footer">
    Generated by EstimatorPro v3 — BIM Coordination Engine<br>
    Standards: CIQS Standard Method, BCF 2.1, ISO 19650
  </div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function csvEscape(str: string): string {
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
