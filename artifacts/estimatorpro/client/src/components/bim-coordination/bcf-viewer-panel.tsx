// client/src/components/bim-coordination/bcf-viewer-panel.tsx
// =============================================================================
// BCF VIEWER PANEL — SOP Part 9 Frontend
// =============================================================================
//
// BCF 2.1 viewer and export interface:
//   - Topic list from BCF export (POST /api/bim-coordination/bcf-export)
//   - Viewpoint navigation per clash group (GET /viewpoints/:groupId)
//   - ISO / SEC / PLAN viewpoint tabs with camera info
//   - Export controls: BCF XML, Issue CSV, HTML meeting summary
//   - Component/element detail view per topic
//
// Pattern: @tanstack/react-query + shadcn/ui + lucide-react
// =============================================================================

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Eye,
  FileText,
  Camera,
  Box,
  Crosshair,
  Loader2,
  FileCode,
  FileSpreadsheet,
  Globe,
  ChevronRight,
  Layers,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface BCFExportResult {
  topicCount: number;
  files: Record<string, string>;
  issueCSV: string;
  format: string;
}

interface ViewpointSet {
  groupId: string;
  groupDescription: string;
  viewpoints: Viewpoint[];
}

interface Viewpoint {
  id: string;
  type: "ISO" | "SEC" | "PLAN";
  name: string;
  camera: {
    position: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
    fieldOfView: number;
  };
  sectionPlane: any | null;
  colorOverrides: Array<{
    elementId: string;
    color: string;
    transparency: number;
  }>;
  description: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIEWPOINT TYPE CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const VP_CONFIG: Record<string, { icon: any; color: string; bg: string; label: string; desc: string }> = {
  ISO: { icon: Box, color: "text-blue-700", bg: "bg-blue-100 border-blue-300", label: "Isometric", desc: "3D perspective view of clash area" },
  SEC: { icon: Layers, color: "text-purple-700", bg: "bg-purple-100 border-purple-300", label: "Section", desc: "Cross-section cut through clash point" },
  PLAN: { icon: Crosshair, color: "text-green-700", bg: "bg-green-100 border-green-300", label: "Plan", desc: "Top-down plan view at clash elevation" },
};

// ═══════════════════════════════════════════════════════════════════════════════
// FILE DOWNLOAD HELPER
// ═══════════════════════════════════════════════════════════════════════════════

function downloadTextFile(content: string, filename: string, mimeType: string = "text/plain") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIEWPOINT CARD
// ═══════════════════════════════════════════════════════════════════════════════

function ViewpointCard({ vp }: { vp: Viewpoint }) {
  const config = VP_CONFIG[vp.type] || VP_CONFIG.ISO;
  const Icon = config.icon;

  return (
    <div className={`p-3 rounded-md border ${config.bg}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${config.color}`} />
        <span className={`text-xs font-bold ${config.color}`}>{config.label}</span>
      </div>
      <p className="text-[10px] text-muted-foreground mb-2">{vp.description || config.desc}</p>

      {/* Camera info */}
      <div className="space-y-1 text-[9px] font-mono text-muted-foreground">
        <div className="flex justify-between">
          <span>Position:</span>
          <span>{vp.camera.position.x.toFixed(2)}, {vp.camera.position.y.toFixed(2)}, {vp.camera.position.z.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span>Direction:</span>
          <span>{vp.camera.direction.x.toFixed(2)}, {vp.camera.direction.y.toFixed(2)}, {vp.camera.direction.z.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span>FOV:</span>
          <span>{vp.camera.fieldOfView}°</span>
        </div>
      </div>

      {/* Color overrides */}
      {vp.colorOverrides.length > 0 && (
        <div className="mt-2 pt-2 border-t border-dashed">
          <p className="text-[9px] font-medium mb-1">Color Overrides ({vp.colorOverrides.length})</p>
          <div className="flex gap-1 flex-wrap">
            {vp.colorOverrides.slice(0, 6).map((co, idx) => (
              <div
                key={idx}
                className="w-4 h-4 rounded-sm border"
                style={{ backgroundColor: co.color, opacity: 1 - co.transparency }}
                title={`${co.elementId}: ${co.color}`}
              />
            ))}
            {vp.colorOverrides.length > 6 && (
              <span className="text-[9px] text-muted-foreground self-center">+{vp.colorOverrides.length - 6}</span>
            )}
          </div>
        </div>
      )}

      {/* Section plane */}
      {vp.sectionPlane && (
        <div className="mt-2 pt-2 border-t border-dashed">
          <p className="text-[9px] font-medium">Section Plane Active</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIEWPOINT DIALOG
// ═══════════════════════════════════════════════════════════════════════════════

function ViewpointDialog({ groupId, open, onClose }: {
  groupId: string;
  open: boolean;
  onClose: () => void;
}) {
  const vpQuery = useQuery<ViewpointSet>({
    queryKey: ["bim-viewpoints", groupId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/bim-coordination/viewpoints/${groupId}`, { headers, credentials: "include" });
      if (!res.ok) throw new Error("Failed to load viewpoints");
      return res.json();
    },
    enabled: open && !!groupId,
  });

  const vpSet = vpQuery.data;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Camera className="w-4 h-4" />
            Viewpoints — {groupId.substring(0, 20)}
          </DialogTitle>
        </DialogHeader>
        {vpQuery.isLoading && (
          <div className="py-8 text-center">
            <Loader2 className="w-6 h-6 mx-auto animate-spin text-muted-foreground" />
          </div>
        )}
        {vpSet && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{vpSet.groupDescription}</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {vpSet.viewpoints.map(vp => (
                <ViewpointCard key={vp.id} vp={vp} />
              ))}
            </div>
            {vpSet.viewpoints.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No viewpoints generated for this group</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function BCFViewerPanel() {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [vpDialogOpen, setVpDialogOpen] = useState(false);

  // ── BCF Export mutation ──────────────────────────────────────────────
  const bcfMutation = useMutation<BCFExportResult>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/bim-coordination/bcf-export");
      if (!res.ok) throw new Error("Failed to generate BCF export");
      return res.json();
    },
  });

  const bcfData = bcfMutation.data;

  // ── Export handlers ──────────────────────────────────────────────────
  function handleDownloadBCF() {
    if (!bcfData?.files) return;
    const allXml = Object.entries(bcfData.files)
      .map(([name, content]) => `<!-- FILE: ${name} -->\n${content}`)
      .join("\n\n");
    downloadTextFile(allXml, `bcf-export-${new Date().toISOString().substring(0, 10)}.xml`, "application/xml");
  }

  function handleDownloadCSV() {
    if (!bcfData?.issueCSV) return;
    downloadTextFile(bcfData.issueCSV, `issues-${new Date().toISOString().substring(0, 10)}.csv`, "text/csv");
  }

  // ── Parse topic data from BCF files ──────────────────────────────────
  const topics = bcfData?.files
    ? Object.entries(bcfData.files).map(([filename, xml]) => {
        const guidMatch = xml.match(/<Topic[^>]*Guid="([^"]+)"/);
        const titleMatch = xml.match(/<Title>([^<]+)<\/Title>/);
        const descMatch = xml.match(/<Description>([^<]*)<\/Description>/);
        const priorityMatch = xml.match(/<Priority>([^<]*)<\/Priority>/);
        const statusMatch = xml.match(/<TopicStatus>([^<]*)<\/TopicStatus>/);
        const typeMatch = xml.match(/<TopicType>([^<]*)<\/TopicType>/);
        const assignedMatch = xml.match(/<AssignedTo>([^<]*)<\/AssignedTo>/);
        return {
          filename,
          guid: guidMatch?.[1] || filename,
          title: titleMatch?.[1] || "Untitled",
          description: descMatch?.[1] || "",
          priority: priorityMatch?.[1] || "Normal",
          status: statusMatch?.[1] || "Active",
          type: typeMatch?.[1] || "Clash",
          assignedTo: assignedMatch?.[1] || "Unassigned",
        };
      })
    : [];

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">BCF Viewer & Export</h2>
          <p className="text-sm text-muted-foreground">
            SOP Part 9 — BCF 2.1 topics, viewpoints, issue CSV, meeting summaries
          </p>
        </div>
        <Button
          onClick={() => bcfMutation.mutate()}
          disabled={bcfMutation.isPending}
          className="gap-1 h-8 text-xs"
        >
          {bcfMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
          Generate BCF Export
        </Button>
      </div>

      {/* ── Export Summary + Download ───────────────────────────────── */}
      {bcfData && (
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-medium">{bcfData.topicCount} BCF Topics Generated</p>
                <p className="text-xs text-muted-foreground">Format: {bcfData.format}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-1 h-7 text-[10px]" onClick={handleDownloadBCF}>
                  <FileCode className="w-3 h-3" /> BCF XML
                </Button>
                <Button variant="outline" size="sm" className="gap-1 h-7 text-[10px]" onClick={handleDownloadCSV}>
                  <FileSpreadsheet className="w-3 h-3" /> Issue CSV
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Topic Table ─────────────────────────────────────────────── */}
      {topics.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">BCF Topics ({topics.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>GUID</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead className="w-20">Viewpoints</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topics.map((topic, idx) => (
                    <TableRow key={topic.guid} className="text-xs">
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-mono text-[10px] truncate max-w-[100px]">{topic.guid}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{topic.title}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[9px]">{topic.type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`text-[9px] ${
                            topic.priority === "Critical" ? "bg-red-600 text-white" :
                            topic.priority === "Major" ? "bg-orange-500 text-white" :
                            "bg-gray-200 text-gray-700"
                          }`}
                        >
                          {topic.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[9px]">{topic.status}</Badge>
                      </TableCell>
                      <TableCell className="truncate max-w-[80px]">{topic.assignedTo}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px] gap-1"
                          onClick={() => {
                            setSelectedGroupId(topic.guid);
                            setVpDialogOpen(true);
                          }}
                        >
                          <Eye className="w-3 h-3" /> View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── BCF File Preview ────────────────────────────────────────── */}
      {bcfData?.files && Object.keys(bcfData.files).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileCode className="w-4 h-4" /> BCF File Preview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(bcfData.files).slice(0, 5).map(([filename, xml]) => (
                <details key={filename} className="group">
                  <summary className="flex items-center gap-2 cursor-pointer text-xs p-2 rounded bg-muted/30 hover:bg-muted/50">
                    <ChevronRight className="w-3 h-3 transition-transform group-open:rotate-90" />
                    <FileCode className="w-3 h-3 text-muted-foreground" />
                    <span className="font-mono">{filename}</span>
                    <span className="text-muted-foreground ml-auto">{xml.length} chars</span>
                  </summary>
                  <pre className="mt-1 p-3 bg-gray-950 text-gray-200 rounded text-[10px] font-mono overflow-x-auto max-h-48">
                    {xml.substring(0, 2000)}
                    {xml.length > 2000 && "\n... (truncated)"}
                  </pre>
                </details>
              ))}
              {Object.keys(bcfData.files).length > 5 && (
                <p className="text-[10px] text-muted-foreground text-center py-2">
                  Showing 5 of {Object.keys(bcfData.files).length} files
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Empty State ─────────────────────────────────────────────── */}
      {!bcfData && !bcfMutation.isPending && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Globe className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No BCF Data</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Generate a BCF export to view topics, viewpoints, and download files.
            </p>
            <Button onClick={() => bcfMutation.mutate()} className="gap-1">
              <FileText className="w-4 h-4" /> Generate BCF Export
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Viewpoint Dialog ────────────────────────────────────────── */}
      {selectedGroupId && (
        <ViewpointDialog
          groupId={selectedGroupId}
          open={vpDialogOpen}
          onClose={() => { setVpDialogOpen(false); setSelectedGroupId(null); }}
        />
      )}
    </div>
  );
}
