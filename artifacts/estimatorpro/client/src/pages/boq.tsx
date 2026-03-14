import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import BoqSummary from "@/components/boq/boq-summary";
import BoqTable from "@/components/boq/boq-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Filter, Download, Search, X, BarChart2, Zap, CheckCircle, Building2, Clock, TrendingUp } from "lucide-react";
import { useState, useMemo } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { BoqItem } from "@shared/schema";

type RateSystem = "ciqs" | "quicktakeoff";

interface FloorBreakdown {
  floor: string;
  floorLabel: string;
  subtotal: number;
  materialTotal: number;
  laborTotal: number;
  equipmentTotal: number;
  costPerM2?: number;
  totalLaborHours?: number;
  lineItemCount: number;
}

interface BoqWithCosts {
  rateSystem: RateSystem;
  elements: BoqItem[];
  summary: {
    totalElements: number;
    boqItems: number;
    totalValue: number;
    budgetGrandTotal?: number;
    incompleteItems: number;
    hasIncompleteData: boolean;
    costPerM2?: number;
    totalLaborHours?: number;
    regionalFactor?: number;
    csiDivisionsUsed?: number;
  };
  comparison: {
    ciqs: {
      label: string;
      description: string;
      grandTotal: number;
      budgetGrandTotal: number;
      lineItems: number;
      materialTotal: number;
      laborTotal: number;
      equipmentTotal: number;
      incompleteItems: number;
      active: boolean;
    };
    quicktakeoff: {
      label: string;
      description: string;
      grandTotal: number;
      lineItems: number;
      incompleteItems: number;
      note: string;
      active: boolean;
    };
  } | null;
  calculation: {
    method: string;
    standards: string[];
    region: string;
    confidence: string;
    aaceClass: number | null;
  };
  sanityCheck?: {
    passed: boolean;
    warnings: string[];
  };
  floors?: FloorBreakdown[];
}

export default function BoQ() {
  const [location] = useLocation();
  const [searchFilter, setSearchFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const projectId = location.includes("/projects/")
    ? location.split("/projects/")[1]?.split("/")[0]
    : undefined;

  // ── Main BoQ query ─────────────────────────────────────────────────────────
  const { data: boqWithCosts, isLoading } = useQuery<BoqWithCosts>({
    queryKey: [`/api/projects/${projectId}/boq-with-costs`],
    enabled: !!projectId,
  });

  // ── Rate system mutation ───────────────────────────────────────────────────
  // Persists the choice to the project via PUT /api/projects/:id/settings
  // then invalidates the boq query so it refetches with the new engine.
  const { mutate: setRateSystem, isPending: isSwitching } = useMutation({
    mutationFn: async (system: RateSystem) => {
      if (!projectId) throw new Error("No project ID");
      return apiRequest("PUT", `/api/projects/${projectId}/settings`, { rateSystem: system });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/boq-with-costs`] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to switch rate system", description: error.message, variant: "destructive" });
    },
  });

  // CODE-7: Query code adder prescreen status — now returns real applicable adder list
  // from bim-generator auto-prescreen stored in model.geometryData.codeAdderPrescreen
  const { data: codeAdderStatus } = useQuery<{
    applied:          boolean;
    applicableCount:  number;
    appliedCount:     number;
    prescreenModelId: string | null;
    applicableAdders: Array<{ codeEntryId: string; code: string; requirement: string; description: string; reason: string; multiplier?: number }>;
    screenedAt:       string | null;
    notes:            string[];
  }>({
    queryKey: [`/api/projects/${projectId}/code-adders/status`],
    enabled: !!projectId,
    retry: false,
  });

  const codeAddersNotApplied =
    codeAdderStatus !== undefined &&
    (codeAdderStatus.applicableCount ?? 0) > (codeAdderStatus.appliedCount ?? 0);

  const [showAdderDetail, setShowAdderDetail] = useState(false);

  // ADV-2: QTO sanity check warnings from estimate
  const sanityWarnings: string[] = boqWithCosts?.sanityCheck?.warnings ?? [];
  const sanityFailed = sanityWarnings.length > 0;

  const activeSystem: RateSystem = boqWithCosts?.rateSystem ?? "ciqs";
  const allElements = boqWithCosts?.elements || [];
  const comparison = boqWithCosts?.comparison;

  // ── Filter logic ───────────────────────────────────────────────────────────
  const filteredElements = useMemo(() => {
    let filtered = allElements;
    if (searchFilter.trim()) {
      const s = searchFilter.toLowerCase();
      filtered = filtered.filter(item =>
        item.description?.toLowerCase().includes(s) ||
        item.itemCode?.toLowerCase().includes(s) ||
        item.category?.toLowerCase().includes(s)
      );
    }
    if (categoryFilter && categoryFilter !== "all") {
      filtered = filtered.filter(item =>
        item.category?.toLowerCase() === categoryFilter.toLowerCase()
      );
    }
    return filtered;
  }, [allElements, searchFilter, categoryFilter]);

  const categories = useMemo(() => {
    const cats = new Set(allElements.map(item => item.category).filter(Boolean));
    return Array.from(cats).sort();
  }, [allElements]);

  // ── Export handler — passes engine param ──────────────────────────────────
  const handleExport = () => {
    const _modelIdEl = (boqWithCosts?.elements?.[0] as any)?.modelId;
    // Fall back to CSV download of current data from boq-with-costs
    const rows = [
      ["Item Code", "Description", "Unit", "Quantity", "Rate", "Amount", "Floor", "Engine"],
      ...allElements.map(item => [
        item.itemCode, item.description, item.unit,
        item.quantity, item.rate, item.amount,
        (item as any).floor || "",
        activeSystem,
      ]),
    ];
    const csv = rows.map(r => r.map(v => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `boq-${activeSystem}-${projectId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fmtCAD = (n: number) =>
    n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

  return (
    <div>
      {/* ── CODE-7: Code Adder Warning Banner — shows real prescreen results ── */}
      {codeAddersNotApplied && (
        <div className="bg-amber-50 border-b border-amber-300 px-6 py-3">
          <div className="flex items-start gap-3">
            <span className="text-amber-600 text-lg leading-none mt-0.5">⚠</span>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <p className="text-amber-800 font-semibold text-sm">
                  {(codeAdderStatus?.applicableCount ?? 0) - (codeAdderStatus?.appliedCount ?? 0)} OBC/AODA/NECB code adders identified — not yet applied to this estimate
                </p>
                {(codeAdderStatus?.applicableAdders?.length ?? 0) > 0 && (
                  <button
                    onClick={() => setShowAdderDetail(v => !v)}
                    className="text-amber-700 text-xs underline ml-4 flex-shrink-0"
                  >
                    {showAdderDetail ? "Hide details" : "Show details"}
                  </button>
                )}
              </div>
              <p className="text-amber-700 text-xs mt-0.5">
                This estimate may understate direct costs. Go to <strong>Code &amp; Standards → Code Adders</strong> and confirm each applicable adder before issuing for tender.
                {codeAdderStatus?.screenedAt && (
                  <span className="ml-2 text-amber-600">Screened: {new Date(codeAdderStatus.screenedAt).toLocaleDateString("en-CA")}</span>
                )}
              </p>

              {/* Expandable adder list */}
              {showAdderDetail && (codeAdderStatus?.applicableAdders?.length ?? 0) > 0 && (
                <div className="mt-3 border border-amber-200 rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-amber-100">
                      <tr>
                        <th className="text-left px-3 py-1.5 text-amber-800 font-medium">Code Reference</th>
                        <th className="text-left px-3 py-1.5 text-amber-800 font-medium">Requirement</th>
                        <th className="text-left px-3 py-1.5 text-amber-800 font-medium">Applies Because</th>
                        <th className="text-right px-3 py-1.5 text-amber-800 font-medium">Cost Impact</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-100">
                      {codeAdderStatus!.applicableAdders.map(adder => (
                        <tr key={adder.codeEntryId} className="bg-white">
                          <td className="px-3 py-1.5 font-mono text-amber-700">{adder.code}</td>
                          <td className="px-3 py-1.5 text-gray-700">{adder.requirement}</td>
                          <td className="px-3 py-1.5 text-gray-500 italic">{adder.reason}</td>
                          <td className="px-3 py-1.5 text-right text-amber-700 font-medium">
                            {adder.multiplier ? `+${((adder.multiplier - 1) * 100).toFixed(1)}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(codeAdderStatus?.notes?.length ?? 0) > 0 && (
                    <div className="bg-amber-50 px-3 py-2 text-xs text-amber-700 border-t border-amber-200">
                      {codeAdderStatus!.notes.join(" • ")}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* ── ADV-2: QTO Sanity Warning Banner ── */}
      {sanityFailed && (
        <div className="bg-orange-50 border-b border-orange-300 px-6 py-3 flex items-start gap-3">
          <span className="text-orange-600 text-lg leading-none mt-0.5">⚠</span>
          <div>
            <p className="text-orange-800 font-semibold text-sm">
              QTO Sanity Check — {sanityWarnings.length} variance(s) detected
            </p>
            <ul className="text-orange-700 text-xs mt-1 list-disc list-inside space-y-0.5">
              {sanityWarnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        </div>
      )}
      {/* ── Header ── */}
      <header className="bg-white p-6 border-b">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold text-gray-900">Bill of Quantities</h2>
            <p className="text-gray-600 mt-1">
              {boqWithCosts?.calculation?.method || "Professional cost estimation"}
              {allElements.length > 0 && (
                <span className="font-semibold text-blue-600 ml-2">
                  ({allElements.length.toLocaleString()} elements)
                </span>
              )}
            </p>
            {boqWithCosts?.summary && (
              <p className="text-sm text-green-700 font-semibold mt-0.5">
                Direct Cost: {fmtCAD(boqWithCosts.summary.totalValue)}
                {boqWithCosts.summary.budgetGrandTotal && boqWithCosts.summary.budgetGrandTotal > 0 && (
                  <span className="text-gray-500 font-normal ml-2">
                    · Budget (incl. GC/OHP/HST): {fmtCAD(boqWithCosts.summary.budgetGrandTotal)}
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="hover:bg-gray-50"
              onClick={() => setShowFilters(!showFilters)}
              data-testid="button-filter"
            >
              <Filter className="mr-2 h-4 w-4" />
              Filter ({filteredElements.length.toLocaleString()})
            </Button>
            <Button
              className="bg-primary text-white hover:bg-blue-700"
              onClick={handleExport}
              data-testid="button-export"
            >
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </div>
      </header>

      {/* ── Rate System Selector ── */}
      {projectId && (
        <div className="bg-slate-50 border-b px-6 py-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Estimation Engine
          </p>
          <div className="flex gap-3 flex-wrap">

            {/* CIQS Professional */}
            <button
              onClick={() => activeSystem !== "ciqs" && setRateSystem("ciqs")}
              disabled={isSwitching}
              className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all min-w-[260px] max-w-xs
                ${activeSystem === "ciqs"
                  ? "border-blue-600 bg-blue-50 shadow-sm"
                  : "border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm"
                } ${isSwitching ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
              data-testid="engine-select-ciqs"
            >
              <div className={`mt-0.5 rounded-lg p-2 ${activeSystem === "ciqs" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-500"}`}>
                <BarChart2 className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-gray-900">CIQS Professional</span>
                  {activeSystem === "ciqs" && (
                    <span className="flex items-center gap-1 text-xs text-blue-700 font-medium">
                      <CheckCircle className="h-3 w-3" /> Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  218 CSI rates · Material + Labour + Equipment · AACE Class
                </p>
                {comparison?.ciqs && (
                  <p className="text-xs font-semibold text-blue-700 mt-1">
                    {fmtCAD(comparison.ciqs.grandTotal)} direct
                    <span className="text-gray-400 font-normal ml-1">
                      · {comparison.ciqs.lineItems} line items
                    </span>
                  </p>
                )}
              </div>
            </button>

            {/* Quick Takeoff */}
            <button
              onClick={() => activeSystem !== "quicktakeoff" && setRateSystem("quicktakeoff")}
              disabled={isSwitching}
              className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all min-w-[260px] max-w-xs
                ${activeSystem === "quicktakeoff"
                  ? "border-amber-500 bg-amber-50 shadow-sm"
                  : "border-gray-200 bg-white hover:border-amber-300 hover:shadow-sm"
                } ${isSwitching ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
              data-testid="engine-select-quicktakeoff"
            >
              <div className={`mt-0.5 rounded-lg p-2 ${activeSystem === "quicktakeoff" ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-500"}`}>
                <Zap className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-gray-900">Quick Takeoff</span>
                  {activeSystem === "quicktakeoff" && (
                    <span className="flex items-center gap-1 text-xs text-amber-700 font-medium">
                      <CheckCircle className="h-3 w-3" /> Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  60 keyword rules · Single all-in rate · Fast preliminary QTO
                </p>
                {comparison?.quicktakeoff && (
                  <p className="text-xs font-semibold text-amber-700 mt-1">
                    {fmtCAD(comparison.quicktakeoff.grandTotal)} total
                    <span className="text-gray-400 font-normal ml-1">
                      · {comparison.quicktakeoff.lineItems} line items
                    </span>
                  </p>
                )}
              </div>
            </button>

            {/* Variance badge — shown when both engines have data */}
            {comparison?.ciqs && comparison?.quicktakeoff &&
              comparison.ciqs.grandTotal > 0 && comparison.quicktakeoff.grandTotal > 0 && (
              <div className="flex items-center self-center px-4 py-2 bg-white border border-gray-200 rounded-xl shadow-sm">
                <div className="text-center">
                  <p className="text-xs text-gray-500 font-medium">Engine Variance</p>
                  <p className={`text-lg font-bold mt-0.5 ${
                    Math.abs(comparison.ciqs.grandTotal - comparison.quicktakeoff.grandTotal) / comparison.ciqs.grandTotal > 0.15
                      ? "text-red-600" : "text-green-600"
                  }`}>
                    {(Math.abs(comparison.ciqs.grandTotal - comparison.quicktakeoff.grandTotal) /
                      comparison.ciqs.grandTotal * 100).toFixed(1)}%
                  </p>
                  <p className="text-xs text-gray-400">CIQS vs QTO</p>
                </div>
              </div>
            )}
          </div>

          {/* AACE class + region note */}
          {boqWithCosts?.calculation && (
            <p className="text-xs text-slate-400 mt-3">
              {boqWithCosts.calculation.confidence && (
                <span className="mr-3">Class: {boqWithCosts.calculation.confidence}</span>
              )}
              {boqWithCosts.calculation.region && (
                <span className="mr-3">Region: {boqWithCosts.calculation.region}</span>
              )}
              {boqWithCosts.summary?.hasIncompleteData && (
                <span className="text-amber-600">
                  ⚠ {boqWithCosts.summary.incompleteItems} items flagged as estimated — verify dimensions
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {/* ── Filter Panel ── */}
      {showFilters && (
        <div className="bg-gray-50 border-b p-4">
          <div className="flex gap-4 items-center">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by description, item code, or category..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-filter"
                />
              </div>
            </div>
            <div className="w-48">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                data-testid="select-category-filter"
              >
                <option value="">All Categories</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            {(searchFilter || categoryFilter) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setSearchFilter(""); setCategoryFilter(""); }}
                data-testid="button-clear-filters"
              >
                <X className="h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── v15.20: CIQS Benchmark Metrics Banner ── */}
      {boqWithCosts?.summary?.costPerM2 != null && activeSystem === "ciqs" && (
        <div className="bg-slate-50 border-b px-6 py-3">
          <div className="flex gap-6 flex-wrap items-center">
            <div className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4 text-blue-600" />
              <span className="text-slate-500 font-medium">Cost/m²</span>
              <span className="font-semibold text-slate-800">
                {fmtCAD(boqWithCosts.summary.costPerM2!)} /m²
              </span>
            </div>
            {boqWithCosts.summary.totalLaborHours != null && (
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-green-600" />
                <span className="text-slate-500 font-medium">Labour Hours</span>
                <span className="font-semibold text-slate-800">
                  {boqWithCosts.summary.totalLaborHours.toLocaleString("en-CA", { maximumFractionDigits: 0 })} hrs
                </span>
              </div>
            )}
            {boqWithCosts.summary.csiDivisionsUsed != null && (
              <div className="flex items-center gap-2 text-sm">
                <Building2 className="h-4 w-4 text-purple-600" />
                <span className="text-slate-500 font-medium">CSI Divisions</span>
                <span className="font-semibold text-slate-800">{boqWithCosts.summary.csiDivisionsUsed}</span>
              </div>
            )}
            {boqWithCosts.summary.regionalFactor != null && boqWithCosts.summary.regionalFactor !== 1 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500 font-medium">Regional Factor</span>
                <span className="font-semibold text-slate-800">×{boqWithCosts.summary.regionalFactor.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── v15.20: Per-Floor Breakdown Table ── */}
      {boqWithCosts?.floors && boqWithCosts.floors.length > 0 && activeSystem === "ciqs" && (
        <div className="bg-white border-b px-6 py-4">
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
            Per-Floor Cost Summary
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 border border-slate-200">Floor</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-600 border border-slate-200">Material</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-600 border border-slate-200">Labour</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-600 border border-slate-200">Equipment</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-600 border border-slate-200">Subtotal</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-600 border border-slate-200">$/m²</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-600 border border-slate-200">Labour hrs</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-600 border border-slate-200">Items</th>
                </tr>
              </thead>
              <tbody>
                {boqWithCosts.floors.map((fl, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                    <td className="px-3 py-1.5 border border-slate-200 font-medium text-slate-700">{fl.floorLabel}</td>
                    <td className="px-3 py-1.5 border border-slate-200 text-right text-slate-600">{fmtCAD(fl.materialTotal)}</td>
                    <td className="px-3 py-1.5 border border-slate-200 text-right text-slate-600">{fmtCAD(fl.laborTotal)}</td>
                    <td className="px-3 py-1.5 border border-slate-200 text-right text-slate-600">{fmtCAD(fl.equipmentTotal)}</td>
                    <td className="px-3 py-1.5 border border-slate-200 text-right font-semibold text-slate-800">{fmtCAD(fl.subtotal)}</td>
                    <td className="px-3 py-1.5 border border-slate-200 text-right text-slate-600">
                      {fl.costPerM2 != null ? fmtCAD(fl.costPerM2) : "—"}
                    </td>
                    <td className="px-3 py-1.5 border border-slate-200 text-right text-slate-600">
                      {fl.totalLaborHours != null
                        ? fl.totalLaborHours.toLocaleString("en-CA", { maximumFractionDigits: 0 })
                        : "—"}
                    </td>
                    <td className="px-3 py-1.5 border border-slate-200 text-right text-slate-500">{fl.lineItemCount}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-blue-50 font-semibold">
                  <td className="px-3 py-2 border border-slate-200 text-slate-700">TOTAL</td>
                  <td className="px-3 py-2 border border-slate-200 text-right text-slate-700">
                    {fmtCAD(boqWithCosts.floors.reduce((s, f) => s + f.materialTotal, 0))}
                  </td>
                  <td className="px-3 py-2 border border-slate-200 text-right text-slate-700">
                    {fmtCAD(boqWithCosts.floors.reduce((s, f) => s + f.laborTotal, 0))}
                  </td>
                  <td className="px-3 py-2 border border-slate-200 text-right text-slate-700">
                    {fmtCAD(boqWithCosts.floors.reduce((s, f) => s + f.equipmentTotal, 0))}
                  </td>
                  <td className="px-3 py-2 border border-slate-200 text-right text-blue-700">
                    {fmtCAD(boqWithCosts.floors.reduce((s, f) => s + f.subtotal, 0))}
                  </td>
                  <td className="px-3 py-2 border border-slate-200 text-right text-blue-700">
                    {boqWithCosts.summary.costPerM2 != null ? fmtCAD(boqWithCosts.summary.costPerM2) + " avg" : "—"}
                  </td>
                  <td className="px-3 py-2 border border-slate-200 text-right text-slate-700">
                    {boqWithCosts.summary.totalLaborHours != null
                      ? boqWithCosts.summary.totalLaborHours.toLocaleString("en-CA", { maximumFractionDigits: 0 })
                      : "—"}
                  </td>
                  <td className="px-3 py-2 border border-slate-200 text-right text-slate-700">
                    {boqWithCosts.floors.reduce((s, f) => s + f.lineItemCount, 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── Main Content ── */}
      <div className="p-6 space-y-6">
        <BoqSummary boqItems={filteredElements} isLoading={isLoading} />
        <BoqTable boqItems={filteredElements} isLoading={isLoading} />
      </div>
    </div>
  );
}
