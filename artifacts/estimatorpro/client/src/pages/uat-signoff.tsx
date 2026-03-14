// client/src/pages/uat-signoff.tsx
// ═══════════════════════════════════════════════════════════════════════════
// QA/QC Master Plan §12 User Acceptance Testing
// §12.1 UAT Execution Framework, §12.2 UAT Sign-Off Form
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react';

interface UATScenario {
  id: string;
  scenario: string;
  steps: string;
  expectedResult: string;
  actualResult: string;
  status: 'Not Started' | 'In Progress' | 'Passed' | 'Failed' | 'Blocked';
  tester: string;
  notes: string;
}

interface UATSignOff {
  projectName: string;
  releaseVersion: string;
  uatStartDate: string;
  uatEndDate: string;
  totalScenarios: number;
  scenariosPassed: number;
  scenariosFailed: number;
  openDefectsCritHigh: number;
  openDefectsMedLow: number;
  decision: 'GO' | 'NO-GO' | 'PENDING';
  approverName: string;
  approvalDate: string;
  comments: string;
}

const defaultScenarios: UATScenario[] = [
  { id: 'UAT-001', scenario: 'Document Upload & Processing', steps: 'Upload PDF drawings → verify extraction → check page count', expectedResult: 'Documents processed, text extracted, pages parsed', actualResult: '', status: 'Not Started', tester: '', notes: '' },
  { id: 'UAT-002', scenario: 'BIM Model Generation', steps: 'Select project → Generate BIM → verify elements → check storeys', expectedResult: 'BIM model created with correct element counts per storey', actualResult: '', status: 'Not Started', tester: '', notes: '' },
  { id: 'UAT-003', scenario: 'BOQ/Cost Estimation', steps: 'Generate estimate → verify CSI divisions → check totals → export', expectedResult: 'Complete BOQ with labor/material/equipment per CSI division', actualResult: '', status: 'Not Started', tester: '', notes: '' },
  { id: 'UAT-004', scenario: 'Compliance Check', steps: 'Run compliance → verify NBC/OBC codes → check violations → review RFIs', expectedResult: 'Compliance report with clause citations, RFIs generated', actualResult: '', status: 'Not Started', tester: '', notes: '' },
  { id: 'UAT-005', scenario: 'Report Generation', steps: 'Generate BOQ Full → Bid-Level → Executive Summary → verify exports', expectedResult: 'All 7 report types generated correctly', actualResult: '', status: 'Not Started', tester: '', notes: '' },
  { id: 'UAT-006', scenario: '3D BIM Viewer', steps: 'Load model → rotate → zoom → select element → verify properties', expectedResult: 'Smooth 3D navigation, properties display on selection', actualResult: '', status: 'Not Started', tester: '', notes: '' },
  { id: 'UAT-007', scenario: 'Clash Detection', steps: 'Run clash detection → review results → assign responsibility → resolve', expectedResult: 'Clashes identified with severity, responsibility tracking', actualResult: '', status: 'Not Started', tester: '', notes: '' },
  { id: 'UAT-008', scenario: 'Standards Navigator', steps: 'Browse codes → search NBC → filter CSA → view requirements', expectedResult: 'Navigate code library, view clause details', actualResult: '', status: 'Not Started', tester: '', notes: '' },
  { id: 'UAT-009', scenario: 'Multi-Project Management', steps: 'Create project → upload docs → switch projects → verify isolation', expectedResult: 'Data isolation between projects, correct project switching', actualResult: '', status: 'Not Started', tester: '', notes: '' },
  { id: 'UAT-010', scenario: 'Error Recovery', steps: 'Upload invalid file → trigger error → verify recovery → retry', expectedResult: 'Graceful error messages, no data corruption, retry works', actualResult: '', status: 'Not Started', tester: '', notes: '' },
];

export default function UATSignOffPage() {
  const [scenarios, setScenarios] = useState<UATScenario[]>(defaultScenarios);
  const [signOff, setSignOff] = useState<UATSignOff>({
    projectName: '', releaseVersion: 'v14.35',
    uatStartDate: '', uatEndDate: '', totalScenarios: defaultScenarios.length,
    scenariosPassed: 0, scenariosFailed: 0, openDefectsCritHigh: 0,
    openDefectsMedLow: 0, decision: 'PENDING', approverName: '',
    approvalDate: '', comments: '',
  });
  const [phase, setPhase] = useState<'preparation' | 'execution' | 'review' | 'signoff'>('preparation');

  const updateScenario = useCallback((id: string, field: keyof UATScenario, value: string) => {
    setScenarios(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  }, []);

  useEffect(() => {
    const p = scenarios.filter(s => s.status === 'Passed').length;
    const f = scenarios.filter(s => s.status === 'Failed').length;
    setSignOff(prev => ({ ...prev, scenariosPassed: p, scenariosFailed: f, totalScenarios: scenarios.length }));
  }, [scenarios]);

  const statusColor = (s: string) => {
    const map: Record<string, string> = { 'Passed': 'bg-green-100 text-green-800', 'Failed': 'bg-red-100 text-red-800', 'In Progress': 'bg-blue-100 text-blue-800', 'Blocked': 'bg-yellow-100 text-yellow-800', 'Not Started': 'bg-gray-100 text-gray-600' };
    return map[s] || 'bg-gray-100';
  };

  const canApprove = signOff.scenariosFailed === 0 && signOff.openDefectsCritHigh === 0 && signOff.scenariosPassed >= signOff.totalScenarios * 0.9;

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">UAT Sign-Off</h1>
        <p className="text-gray-600 mt-1">QA/QC Master Plan §12 — User Acceptance Testing</p>
      </div>

      {/* Phase Indicator */}
      <div className="flex gap-2 mb-6">
        {(['preparation', 'execution', 'review', 'signoff'] as const).map(p => (
          <button key={p} onClick={() => setPhase(p)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize ${phase === p ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            {p === 'signoff' ? 'Sign-Off' : p}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4 text-center">
          <div className="text-2xl font-bold">{signOff.totalScenarios}</div>
          <div className="text-sm text-gray-500">Total Scenarios</div>
        </div>
        <div className="bg-green-50 rounded-lg border border-green-200 p-4 text-center">
          <div className="text-2xl font-bold text-green-700">{signOff.scenariosPassed}</div>
          <div className="text-sm text-green-600">Passed</div>
        </div>
        <div className="bg-red-50 rounded-lg border border-red-200 p-4 text-center">
          <div className="text-2xl font-bold text-red-700">{signOff.scenariosFailed}</div>
          <div className="text-sm text-red-600">Failed</div>
        </div>
        <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-4 text-center">
          <div className="text-2xl font-bold text-yellow-700">{signOff.openDefectsCritHigh}</div>
          <div className="text-sm text-yellow-600">Open S1/S2</div>
        </div>
        <div className={`rounded-lg border p-4 text-center ${canApprove ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
          <div className={`text-2xl font-bold ${canApprove ? 'text-green-700' : 'text-red-700'}`}>{canApprove ? 'GO' : 'NO-GO'}</div>
          <div className="text-sm text-gray-600">Decision</div>
        </div>
      </div>

      {/* Scenario Table */}
      {(phase === 'preparation' || phase === 'execution') && (
        <div className="bg-white rounded-lg border overflow-hidden mb-6">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scenario</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tester</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {scenarios.map(s => (
                <tr key={s.id}>
                  <td className="px-4 py-3 text-sm font-mono">{s.id}</td>
                  <td className="px-4 py-3 text-sm">{s.scenario}<br /><span className="text-xs text-gray-500">{s.steps}</span></td>
                  <td className="px-4 py-3">
                    <select value={s.status} onChange={e => updateScenario(s.id, 'status', e.target.value)} className={`px-2 py-1 rounded text-xs font-medium ${statusColor(s.status)}`}>
                      {['Not Started', 'In Progress', 'Passed', 'Failed', 'Blocked'].map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3"><input type="text" value={s.tester} onChange={e => updateScenario(s.id, 'tester', e.target.value)} className="border rounded px-2 py-1 text-sm w-24" placeholder="Name" /></td>
                  <td className="px-4 py-3"><input type="text" value={s.notes} onChange={e => updateScenario(s.id, 'notes', e.target.value)} className="border rounded px-2 py-1 text-sm w-full" placeholder="Notes..." /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Sign-Off Form */}
      {phase === 'signoff' && (
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-xl font-bold mb-4">§12.2 UAT Sign-Off Form</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700">Project Name</label><input value={signOff.projectName} onChange={e => setSignOff({ ...signOff, projectName: e.target.value })} className="mt-1 block w-full border rounded-md px-3 py-2" /></div>
            <div><label className="block text-sm font-medium text-gray-700">Release Version</label><input value={signOff.releaseVersion} onChange={e => setSignOff({ ...signOff, releaseVersion: e.target.value })} className="mt-1 block w-full border rounded-md px-3 py-2" /></div>
            <div><label className="block text-sm font-medium text-gray-700">UAT Start Date</label><input type="date" value={signOff.uatStartDate} onChange={e => setSignOff({ ...signOff, uatStartDate: e.target.value })} className="mt-1 block w-full border rounded-md px-3 py-2" /></div>
            <div><label className="block text-sm font-medium text-gray-700">UAT End Date</label><input type="date" value={signOff.uatEndDate} onChange={e => setSignOff({ ...signOff, uatEndDate: e.target.value })} className="mt-1 block w-full border rounded-md px-3 py-2" /></div>
            <div><label className="block text-sm font-medium text-gray-700">Open Defects (Critical/High)</label><input type="number" value={signOff.openDefectsCritHigh} onChange={e => setSignOff({ ...signOff, openDefectsCritHigh: +e.target.value })} className="mt-1 block w-full border rounded-md px-3 py-2" /></div>
            <div><label className="block text-sm font-medium text-gray-700">Open Defects (Medium/Low)</label><input type="number" value={signOff.openDefectsMedLow} onChange={e => setSignOff({ ...signOff, openDefectsMedLow: +e.target.value })} className="mt-1 block w-full border rounded-md px-3 py-2" /></div>
            <div className="col-span-2"><label className="block text-sm font-medium text-gray-700">Approver Name</label><input value={signOff.approverName} onChange={e => setSignOff({ ...signOff, approverName: e.target.value })} className="mt-1 block w-full border rounded-md px-3 py-2" placeholder="Full name" /></div>
            <div className="col-span-2"><label className="block text-sm font-medium text-gray-700">Comments</label><textarea value={signOff.comments} onChange={e => setSignOff({ ...signOff, comments: e.target.value })} rows={3} className="mt-1 block w-full border rounded-md px-3 py-2" /></div>
          </div>
          <div className="mt-6 flex gap-4">
            <button onClick={() => setSignOff({ ...signOff, decision: 'GO', approvalDate: new Date().toISOString().split('T')[0] })} disabled={!canApprove} className={`px-6 py-2 rounded-lg font-medium ${canApprove ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}>Approve (GO)</button>
            <button onClick={() => setSignOff({ ...signOff, decision: 'NO-GO', approvalDate: new Date().toISOString().split('T')[0] })} className="px-6 py-2 rounded-lg font-medium bg-red-600 text-white hover:bg-red-700">Reject (NO-GO)</button>
          </div>
          {signOff.decision !== 'PENDING' && (
            <div className={`mt-4 p-4 rounded-lg ${signOff.decision === 'GO' ? 'bg-green-50 border border-green-300' : 'bg-red-50 border border-red-300'}`}>
              <strong>Decision: {signOff.decision}</strong> — {signOff.approverName} on {signOff.approvalDate}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
