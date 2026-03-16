import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

interface CandidateReviewPanelProps {
  modelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolved?: () => void;
}

interface EvidenceSource {
  documentName: string;
  pageNumber?: number;
  extractionMethod: string;
  confidence: string;
  value_extracted: string;
}

interface UnresolvedCandidate {
  candidateId: string;
  type: string;
  storey: string;
  status: string;
  evidence_sources: EvidenceSource[];
  review_notes: string[];
  // Common optional fields
  mark?: string;
  wall_type_code?: string;
  size_string?: string;
  thickness_mm?: number | null;
  height_m?: number | null;
  height_mm?: number | null;
  width_mm?: number | null;
  depth_mm?: number | null;
  position_m?: { x: number; y: number } | null;
  start_m?: { x: number; y: number } | null;
  end_m?: { x: number; y: number } | null;
}

interface ReviewResponse {
  ok: boolean;
  unresolved: UnresolvedCandidate[];
  stats: {
    total: number;
    resolved: number;
    needsReview: number;
    unresolved: number;
    byType: Record<string, { total: number; resolved: number; unresolved: number }>;
  };
  currentStage: string | null;
}

// Editable fields by element type
const EDITABLE_FIELDS: Record<string, Array<{ key: string; label: string; unit: string }>> = {
  wall: [
    { key: "thickness_mm", label: "Thickness", unit: "mm" },
    { key: "height_m", label: "Height", unit: "m" },
  ],
  door: [
    { key: "width_mm", label: "Width", unit: "mm" },
    { key: "height_mm", label: "Height", unit: "mm" },
    { key: "thickness_mm", label: "Thickness", unit: "mm" },
  ],
  window: [
    { key: "width_mm", label: "Width", unit: "mm" },
    { key: "height_mm", label: "Height", unit: "mm" },
  ],
  column: [
    { key: "width_mm", label: "Width", unit: "mm" },
    { key: "depth_mm", label: "Depth", unit: "mm" },
    { key: "height_m", label: "Height", unit: "m" },
  ],
  slab: [
    { key: "thickness_mm", label: "Thickness", unit: "mm" },
  ],
  beam: [
    { key: "width_mm", label: "Width", unit: "mm" },
    { key: "depth_mm", label: "Depth", unit: "mm" },
  ],
  stair: [
    { key: "width_mm", label: "Width", unit: "mm" },
  ],
  mep: [],
};

function statusBadgeVariant(status: string): "default" | "destructive" | "outline" | "secondary" {
  switch (status) {
    case "complete": return "default";
    case "needs_review": return "secondary";
    case "missing_thickness":
    case "missing_height":
    case "missing_width":
    case "missing_position":
      return "destructive";
    default: return "outline";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "missing_thickness": return "Missing Thickness";
    case "missing_height": return "Missing Height";
    case "missing_width": return "Missing Width";
    case "missing_position": return "Missing Position";
    case "needs_review": return "Needs Review";
    case "unresolved": return "Unresolved";
    case "complete": return "Complete";
    default: return status;
  }
}

function getMarkOrCode(c: UnresolvedCandidate): string {
  return c.mark || c.wall_type_code || c.size_string || c.candidateId;
}

export function CandidateReviewPanel({
  modelId,
  open,
  onOpenChange,
  onResolved,
}: CandidateReviewPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editValues, setEditValues] = useState<Record<string, Record<string, string>>>({});
  const [activeTab, setActiveTab] = useState("all");

  // Fetch unresolved candidates
  const { data, isLoading, error } = useQuery<ReviewResponse>({
    queryKey: ["/api/bim/pipeline", modelId, "review"],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const resp = await fetch(`/api/bim/pipeline/${modelId}/review`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      if (!resp.ok) throw new Error("Failed to fetch review data");
      return resp.json();
    },
    enabled: open && !!modelId,
  });

  // Resolve a single candidate
  const resolveMutation = useMutation({
    mutationFn: async ({ candidateId, values }: { candidateId: string; values: Record<string, number> }) => {
      const token = localStorage.getItem("auth_token");
      const resp = await fetch(`/api/bim/pipeline/${modelId}/review/${candidateId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify(values),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(errData.message);
      }
      return resp.json();
    },
    onSuccess: (_data, variables) => {
      toast({
        title: "Candidate resolved",
        description: `${variables.candidateId} has been updated.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/bim/pipeline", modelId, "review"] });
      // Clear edit values for this candidate
      setEditValues(prev => {
        const next = { ...prev };
        delete next[variables.candidateId];
        return next;
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Resolution failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Rebuild (re-run 5B + 5C)
  const rebuildMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("auth_token");
      const resp = await fetch(`/api/bim/pipeline/${modelId}/rebuild`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(errData.message);
      }
      return resp.json();
    },
    onSuccess: () => {
      toast({
        title: "Rebuild started",
        description: "Re-running parameter resolution and mesh generation. Check status for progress.",
      });
      onResolved?.();
    },
    onError: (err: Error) => {
      toast({
        title: "Rebuild failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleFieldChange = useCallback((candidateId: string, field: string, value: string) => {
    setEditValues(prev => ({
      ...prev,
      [candidateId]: {
        ...(prev[candidateId] || {}),
        [field]: value,
      },
    }));
  }, []);

  const handleSave = useCallback((candidate: UnresolvedCandidate) => {
    const edits = editValues[candidate.candidateId];
    if (!edits || Object.keys(edits).length === 0) {
      toast({
        title: "No changes",
        description: "Enter values before saving.",
        variant: "destructive",
      });
      return;
    }

    // Convert string values to numbers
    const numericValues: Record<string, number> = {};
    for (const [key, val] of Object.entries(edits)) {
      const num = parseFloat(val);
      if (isNaN(num) || num <= 0) {
        toast({
          title: "Invalid value",
          description: `"${key}" must be a positive number.`,
          variant: "destructive",
        });
        return;
      }
      numericValues[key] = num;
    }

    resolveMutation.mutate({ candidateId: candidate.candidateId, values: numericValues });
  }, [editValues, resolveMutation, toast]);

  // Filter candidates by type
  const unresolved = data?.unresolved || [];
  const elementTypes = [...new Set(unresolved.map(c => c.type))].sort();
  const filtered = activeTab === "all"
    ? unresolved
    : unresolved.filter(c => c.type === activeTab);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Candidate Review Panel</DialogTitle>
          <DialogDescription>
            {data?.stats
              ? `${data.stats.total} total candidates: ${data.stats.resolved} resolved, ${data.stats.unresolved + data.stats.needsReview} need attention`
              : "Loading candidate data..."}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        )}

        {error && (
          <div className="text-red-600 p-4 border border-red-200 rounded bg-red-50">
            Failed to load review data: {(error as Error).message}
          </div>
        )}

        {data && !isLoading && (
          <>
            {/* Stats summary */}
            {data.stats && (
              <div className="flex gap-2 flex-wrap mb-2">
                {Object.entries(data.stats.byType).map(([type, counts]) => (
                  <Badge key={type} variant={counts.unresolved > 0 ? "destructive" : "default"}>
                    {type}: {counts.resolved}/{counts.total}
                  </Badge>
                ))}
              </div>
            )}

            {/* Type filter tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="flex-shrink-0">
                <TabsTrigger value="all">All ({unresolved.length})</TabsTrigger>
                {elementTypes.map(t => (
                  <TabsTrigger key={t} value={t}>
                    {t} ({unresolved.filter(c => c.type === t).length})
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value={activeTab} className="flex-1 overflow-auto mt-2">
                {filtered.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No unresolved candidates{activeTab !== "all" ? ` of type "${activeTab}"` : ""}.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[80px]">Type</TableHead>
                        <TableHead className="w-[100px]">Mark/Code</TableHead>
                        <TableHead className="w-[100px]">Storey</TableHead>
                        <TableHead className="w-[130px]">Status</TableHead>
                        <TableHead>Missing Fields</TableHead>
                        <TableHead className="w-[80px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map(candidate => {
                        const fields = EDITABLE_FIELDS[candidate.type] || [];
                        const currentEdits = editValues[candidate.candidateId] || {};

                        return (
                          <TableRow key={candidate.candidateId}>
                            <TableCell>
                              <Badge variant="outline">{candidate.type}</Badge>
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {getMarkOrCode(candidate)}
                            </TableCell>
                            <TableCell className="text-sm">{candidate.storey}</TableCell>
                            <TableCell>
                              <Badge variant={statusBadgeVariant(candidate.status)}>
                                {statusLabel(candidate.status)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                {fields.map(field => {
                                  const existingValue = (candidate as unknown as Record<string, unknown>)[field.key];
                                  if (existingValue != null) return null;
                                  return (
                                    <div key={field.key} className="flex items-center gap-1">
                                      <span className="text-xs text-gray-500 w-20 flex-shrink-0">{field.label}:</span>
                                      <Input
                                        type="number"
                                        className="h-7 w-24 text-sm"
                                        placeholder={field.unit}
                                        value={currentEdits[field.key] || ""}
                                        onChange={e => handleFieldChange(candidate.candidateId, field.key, e.target.value)}
                                      />
                                      <span className="text-xs text-gray-400">{field.unit}</span>
                                    </div>
                                  );
                                })}
                                {/* Evidence sources */}
                                {candidate.evidence_sources.length > 0 && (
                                  <details className="mt-1">
                                    <summary className="text-xs text-blue-600 cursor-pointer">
                                      {candidate.evidence_sources.length} evidence source(s)
                                    </summary>
                                    <ul className="text-xs text-gray-600 mt-1 ml-2 space-y-1">
                                      {candidate.evidence_sources.map((ev, i) => (
                                        <li key={i}>
                                          <span className="font-medium">{ev.documentName}</span>
                                          {ev.pageNumber != null && <span> (p.{ev.pageNumber})</span>}
                                          {" - "}
                                          <span className="italic">{ev.value_extracted}</span>
                                          <Badge variant="outline" className="ml-1 text-[10px] py-0 h-4">
                                            {ev.confidence}
                                          </Badge>
                                        </li>
                                      ))}
                                    </ul>
                                  </details>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={resolveMutation.isPending}
                                onClick={() => handleSave(candidate)}
                              >
                                Save
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>
            </Tabs>

            {/* Action buttons */}
            <div className="flex justify-between items-center pt-3 border-t flex-shrink-0">
              <p className="text-xs text-gray-500">
                Resolve missing values, then click Rebuild to regenerate the model.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Close
                </Button>
                <Button
                  onClick={() => rebuildMutation.mutate()}
                  disabled={rebuildMutation.isPending}
                >
                  {rebuildMutation.isPending ? "Rebuilding..." : "Rebuild Model"}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
