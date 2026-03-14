/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  ANALYSIS DASHBOARD — Structural & Energy analysis results page
 *  Displays FEA results, member utilization, thermal performance, and
 *  code compliance status from the BIM model analysis engine.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect } from 'react';
import { useParams, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ArrowLeft, Activity, Thermometer, AlertTriangle, CheckCircle,
  XCircle, BarChart3, Loader2,
} from 'lucide-react';

interface StructuralData {
  nodes: number;
  members: number;
  maxUtilization: number;
  maxDisplacement: number;
  isStable: boolean;
  memberForces: Array<{
    memberId: string;
    axial: number;
    shearY: number;
    momentZ: number;
    maxStress: number;
    utilizationRatio: number;
  }>;
  warnings: string[];
}

interface EnergyData {
  totalEnvelopeArea: number;
  averageUValue: number;
  peakHeatingLoad: number;
  annualHeatingEnergy: number;
  annualCoolingEnergy: number;
  complianceStatus: 'pass' | 'fail' | 'marginal';
  complianceNotes: string[];
  elements: Array<{
    elementId: string;
    elementType: string;
    area: number;
    uValue: number;
    heatLoss: number;
  }>;
}

interface AnalysisReport {
  summary: string;
  structuralStatus: 'pass' | 'fail';
  energyStatus: 'pass' | 'fail' | 'marginal';
  criticalIssues: string[];
  recommendations: string[];
}

export default function AnalysisDashboard() {
  const params = useParams<{ projectId: string; modelId: string }>();
  const { projectId, modelId } = params;
  const [loading, setLoading] = useState(false);
  const [structural, setStructural] = useState<StructuralData | null>(null);
  const [energy, setEnergy] = useState<EnergyData | null>(null);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [climateZone, setClimateZone] = useState('zone6');
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = async () => {
    if (!modelId) return;
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/bim/models/${modelId}/analyze/full`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ climateZone }),
      });

      if (!res.ok) throw new Error(`Analysis failed: ${res.statusText}`);
      const data = await res.json();

      setStructural(data.structural);
      setEnergy(data.energy);
      setReport(data.report);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const statusIcon = (status: string) => {
    if (status === 'pass') return <CheckCircle className="h-5 w-5 text-green-600" />;
    if (status === 'fail') return <XCircle className="h-5 w-5 text-red-600" />;
    return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
  };

  const utilizationColor = (ratio: number) => {
    if (ratio > 1.0) return 'bg-red-500';
    if (ratio > 0.85) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/projects/${projectId}/bim`}>
              <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
            </Link>
            <h1 className="text-2xl font-bold">Structural & Energy Analysis</h1>
          </div>
          <div className="flex items-center gap-3">
            <Select value={climateZone} onValueChange={setClimateZone}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Climate Zone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zone4">Zone 4 (Mild)</SelectItem>
                <SelectItem value="zone5">Zone 5</SelectItem>
                <SelectItem value="zone6">Zone 6 (Ontario)</SelectItem>
                <SelectItem value="zone7">Zone 7 (Cold)</SelectItem>
                <SelectItem value="zone8">Zone 8 (Arctic)</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={runAnalysis} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <BarChart3 className="h-4 w-4 mr-1" />}
              {loading ? 'Analyzing...' : 'Run Analysis'}
            </Button>
          </div>
        </div>

        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="py-3">
              <p className="text-red-700 text-sm">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        {report && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4 flex items-center gap-3">
                <Activity className="h-8 w-8 text-blue-600" />
                <div>
                  <p className="text-xs text-gray-500">Structural Status</p>
                  <div className="flex items-center gap-2">
                    {statusIcon(report.structuralStatus)}
                    <span className="font-bold text-lg uppercase">{report.structuralStatus}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 flex items-center gap-3">
                <Thermometer className="h-8 w-8 text-orange-600" />
                <div>
                  <p className="text-xs text-gray-500">Energy Status</p>
                  <div className="flex items-center gap-2">
                    {statusIcon(report.energyStatus)}
                    <span className="font-bold text-lg uppercase">{report.energyStatus}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-gray-500">Critical Issues</p>
                <p className="font-bold text-2xl">{report.criticalIssues.length}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {report.recommendations.length} recommendations
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Structural Results */}
        {structural && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" /> Structural Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Nodes</p>
                  <p className="font-bold text-lg">{structural.nodes}</p>
                </div>
                <div>
                  <p className="text-gray-500">Members</p>
                  <p className="font-bold text-lg">{structural.members}</p>
                </div>
                <div>
                  <p className="text-gray-500">Max Utilization</p>
                  <p className={`font-bold text-lg ${structural.maxUtilization > 1 ? 'text-red-600' : 'text-green-600'}`}>
                    {(structural.maxUtilization * 100).toFixed(0)}%
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Max Deflection</p>
                  <p className="font-bold text-lg">{(structural.maxDisplacement * 1000).toFixed(1)}mm</p>
                </div>
              </div>

              {/* Member utilization bars */}
              {structural.memberForces.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-gray-700">Member Utilization</p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {structural.memberForces.slice(0, 20).map((mf, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="w-24 truncate text-gray-600">{mf.memberId.replace('member_', '')}</span>
                        <div className="flex-1 bg-gray-200 rounded-full h-3">
                          <div
                            className={`h-3 rounded-full ${utilizationColor(mf.utilizationRatio)}`}
                            style={{ width: `${Math.min(100, mf.utilizationRatio * 100)}%` }}
                          />
                        </div>
                        <span className="w-12 text-right">{(mf.utilizationRatio * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {structural.warnings.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-yellow-700">Warnings</p>
                  {structural.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-yellow-700 bg-yellow-50 p-2 rounded">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Energy Results */}
        {energy && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Thermometer className="h-5 w-5" /> Envelope Energy Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Envelope Area</p>
                  <p className="font-bold text-lg">{energy.totalEnvelopeArea.toFixed(0)} m²</p>
                </div>
                <div>
                  <p className="text-gray-500">Average U-Value</p>
                  <p className="font-bold text-lg">{energy.averageUValue.toFixed(3)} W/(m²K)</p>
                </div>
                <div>
                  <p className="text-gray-500">Peak Heating Load</p>
                  <p className="font-bold text-lg">{energy.peakHeatingLoad.toFixed(0)} kW</p>
                </div>
                <div>
                  <p className="text-gray-500">Annual Heating</p>
                  <p className="font-bold text-lg">{(energy.annualHeatingEnergy / 1000).toFixed(0)} MWh</p>
                </div>
              </div>

              {/* Compliance notes */}
              {energy.complianceNotes.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-red-700">Code Compliance Issues</p>
                  {energy.complianceNotes.map((note, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-red-700 bg-red-50 p-2 rounded">
                      <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                      <span>{note}</span>
                    </div>
                  ))}
                </div>
              )}

              {energy.complianceStatus === 'pass' && (
                <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded">
                  <CheckCircle className="h-5 w-5" />
                  <span className="text-sm font-medium">All envelope elements comply with {climateZone} prescriptive U-value limits</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Recommendations */}
        {report && report.recommendations.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recommendations</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {report.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-blue-500 mt-0.5">•</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Empty state */}
        {!structural && !energy && !loading && (
          <Card className="bg-white">
            <CardContent className="py-16 text-center">
              <BarChart3 className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-700">No analysis results yet</h3>
              <p className="text-gray-500 mt-1">Select a climate zone and click "Run Analysis" to perform structural and energy analysis on this model.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
