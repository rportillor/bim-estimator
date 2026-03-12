// client/src/pages/test-dashboard.tsx
// ═══════════════════════════════════════════════════════════════════════════
// QA/QC Master Plan §14 Test Metrics & Reporting, §16 Deployment Authorization
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react';

interface MetricCard { label: string; value: string | number; target: string; met: boolean; }

export default function TestDashboard() {
  const [release, setRelease] = useState('v14.4');
  const [dashboard, setDashboard] = useState<any>(null);
  const [exitCriteria, setExitCriteria] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};
      const [dashRes, exitRes] = await Promise.all([
        fetch(`/api/qa/dashboard/${release}`, { headers: authHeaders, credentials: 'include' }),
        fetch(`/api/qa/exit-criteria/${release}`, { headers: authHeaders, credentials: 'include' })
      ]);
      if (dashRes.ok) setDashboard(await dashRes.json());
      if (exitRes.ok) setExitCriteria(await exitRes.json());
    } catch (e) { console.error('Failed to fetch QA data:', e); }
    setLoading(false);
  }, [release]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const metrics: MetricCard[] = dashboard ? [
    { label: 'Test Execution Rate', value: `${dashboard.executionRate?.toFixed(1)}%`, target: '≥ 95%', met: dashboard.executionRate >= 95 },
    { label: 'Test Pass Rate', value: `${dashboard.passRate?.toFixed(1)}%`, target: '≥ 90%', met: dashboard.passRate >= 90 },
    { label: 'Defect Density', value: `${dashboard.defectDensity?.toFixed(2)}/KLOC`, target: '< 5/KLOC', met: dashboard.defectDensity < 5 },
    { label: 'Defect Leakage', value: `${dashboard.defectLeakage?.toFixed(1)}%`, target: '< 5%', met: dashboard.defectLeakage < 5 },
    { label: 'Open Defect Aging (S1/S2)', value: `${dashboard.openDefectAging?.toFixed(1)} days`, target: '< 3 days', met: dashboard.openDefectAging < 3 },
    { label: 'Automation Coverage', value: `${dashboard.automationCoverage?.toFixed(1)}%`, target: '≥ 60%', met: dashboard.automationCoverage >= 60 },
    { label: 'Code Coverage', value: `${dashboard.codeCoverage?.toFixed(1)}%`, target: '≥ 80%', met: dashboard.codeCoverage >= 80 },
    { label: 'Requirements Coverage', value: `${dashboard.requirementsCoverage?.toFixed(1)}%`, target: '100%', met: dashboard.requirementsCoverage >= 100 },
  ] : [];

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">QA/QC Metrics Dashboard</h1>
          <p className="text-gray-600">QA/QC Master Plan §14 — Release: {release}</p>
        </div>
        <div className="flex gap-2">
          <input value={release} onChange={e => setRelease(e.target.value)} className="border rounded-md px-3 py-2 text-sm" placeholder="Release version" />
          <button onClick={fetchData} disabled={loading} className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm hover:bg-blue-700 disabled:opacity-50">Refresh</button>
        </div>
      </div>

      {/* §14.1 Key Metrics Grid */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {metrics.map((m, i) => (
          <div key={i} className={`rounded-lg border p-4 ${m.met ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <div className="text-sm text-gray-500">{m.label}</div>
            <div className={`text-2xl font-bold ${m.met ? 'text-green-700' : 'text-red-700'}`}>{m.value}</div>
            <div className="text-xs text-gray-400 mt-1">Target: {m.target} {m.met ? '✅' : '❌'}</div>
          </div>
        ))}
      </div>

      {/* §16.1 Go/No-Go Checklist */}
      {exitCriteria && (
        <div className="bg-white rounded-lg border mb-8">
          <div className={`px-6 py-4 rounded-t-lg ${exitCriteria.passed ? 'bg-green-600' : 'bg-red-600'}`}>
            <h2 className="text-xl font-bold text-white">§16 Deployment Authorization: {exitCriteria.passed ? '✅ GO' : '❌ NO-GO'}</h2>
          </div>
          <div className="p-6">
            <table className="min-w-full divide-y divide-gray-200">
              <thead><tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Criterion</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Detail</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-200">
                {(exitCriteria.checks || []).map((c: any, i: number) => (
                  <tr key={i} className={c.met ? '' : 'bg-red-50'}>
                    <td className="px-4 py-3 text-sm">{c.criterion}</td>
                    <td className="px-4 py-3 text-sm font-medium">{c.met ? '✅ Met' : '❌ Not Met'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Defect Summary */}
      {dashboard?.defects && (
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-white rounded-lg border p-6">
            <h3 className="text-lg font-bold mb-3">§13 Defects by Severity</h3>
            {Object.entries(dashboard.defects.bySeverity || {}).map(([sev, count]) => (
              <div key={sev} className="flex justify-between py-1 border-b">
                <span className="text-sm font-medium">{sev}</span>
                <span className={`text-sm font-bold ${sev === 'S1' || sev === 'S2' ? 'text-red-600' : 'text-gray-600'}`}>{count as number}</span>
              </div>
            ))}
            <div className="flex justify-between py-1 mt-2 font-bold">
              <span>Total</span><span>{dashboard.defects.total}</span>
            </div>
          </div>
          <div className="bg-white rounded-lg border p-6">
            <h3 className="text-lg font-bold mb-3">Defects by Status</h3>
            {Object.entries(dashboard.defects.byStatus || {}).map(([status, count]) => (
              <div key={status} className="flex justify-between py-1 border-b">
                <span className="text-sm">{status}</span>
                <span className="text-sm font-medium">{count as number}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Test Run History */}
      {dashboard?.testRuns?.length > 0 && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="px-6 py-4 border-b"><h3 className="text-lg font-bold">§14.2 Test Run History</h3></div>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50"><tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Suite</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Env</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Pass/Fail</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-200">
              {dashboard.testRuns.slice(0, 20).map((r: any) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-sm">{new Date(r.timestamp).toLocaleDateString()}</td>
                  <td className="px-4 py-2 text-sm font-medium">{r.suiteType}</td>
                  <td className="px-4 py-2 text-sm">{r.environment}</td>
                  <td className="px-4 py-2 text-sm"><span className="text-green-600">{r.passed}</span> / <span className="text-red-600">{r.failed}</span></td>
                  <td className="px-4 py-2 text-sm">{(r.durationMs / 1000).toFixed(1)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
