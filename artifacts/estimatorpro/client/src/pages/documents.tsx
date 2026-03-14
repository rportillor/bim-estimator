import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Search, Filter, FileText, Calendar, FolderOpen, Download, Eye,
  AlertTriangle, History, Grid, List, SortAsc, SortDesc,
  Cpu, UserCheck, Users, X, MessageSquare, ChevronDown, ChevronUp,
  CheckCheck, HelpCircle, AlertCircle, Send, ArrowUpCircle, FileSearch,
} from 'lucide-react';

import { UserAccessPanel } from '@/components/documents/UserAccessPanel';
import { useToast } from '@/hooks/use-toast';
import { logDocumentError, logAuthError } from '@/utils/error-monitoring';
import { mobileLog } from '@/utils/mobile-console';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Document {
  id: string;
  name: string;
  originalName: string;
  projectId: string;
  projectName: string;
  type: string;
  size: number;
  uploadedAt: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  analysisStatus?: string;
  pageCount?: number;
  isSuperseded: boolean;        // server field, may be stale — we recompute below
  revisionNumber: string;
  tags: string[];
  disciplineName?: string;
  assignedReviewerId?: string | null;
  assignedReviewerNote?: string | null;
}

interface AppUser { id: string; username: string; name: string; role: string; }

interface DocumentComment {
  id: string; documentId: string; authorId: string | null; authorName: string;
  body: string; commentType: 'comment' | 'question' | 'issue' | 'approval_note';
  resolved: boolean; resolvedAt: string | null; resolvedByName: string | null; createdAt: string;
}

// ─── Revision helpers ─────────────────────────────────────────────────────────

/** Parse the label shown in the UI — "R1", "R2.1", or null */
function parseRevisionLabel(filename: string): string | null {
  const patterns = [
    /[_\-\s]R(\d+[\._]\d+)[_\-\s\.]/i,
    /[_\-\s]R(\d+)[_\-\s\.]/i,
    /[_\-\s]Rev[\._\-]?(\d+[\._]?\d*)[_\-\s\.]/i,
    /[_\-\s]Revision[\._\-]?(\d+)[_\-\s\.]/i,
  ];
  for (const pat of patterns) {
    const m = filename.match(pat);
    if (m) return `R${m[1].replace('_', '.')}`;
  }
  return null;
}

/** Extract a numeric revision for sorting (R1 → 1, R2.1 → 2.1) */
function parseRevisionNumeric(filename: string): number {
  const m = filename.match(/_R(\d+(?:[._]\d+)?)/i);
  if (!m) return 0;
  return parseFloat(m[1].replace('_', '.'));
}

/**
 * Extract the base drawing key — the part that is shared across revisions.
 * e.g.  A003_R1_Fire_Separation_20_Dec_21.pdf  →  "a003"
 *        Specifications_R1_1_CSI_2024.pdf       →  "specifications"
 */
function extractBaseDrawingKey(filename: string): string {
  // Standard drawing number prefix: A003, S101, M201, E301…
  const drawingMatch = filename.match(/^([A-Za-z]\d{2,3})[_\-\s]/);
  if (drawingMatch) return drawingMatch[1].toLowerCase();
  // Spec/other: strip revision suffix
  const revMatch = filename.match(/^(.+?)_R\d+/i);
  if (revMatch) return revMatch[1].toLowerCase().trim();
  // Last resort
  return filename.replace(/\.[^.]+$/, '').toLowerCase();
}

/**
 * For each group of documents that share the same base drawing key within a project,
 * mark all but the highest revision as superseded.
 * Returns a Set of document IDs that are superseded.
 */
function computeSupersededSet(docs: Document[]): Set<string> {
  const superseded = new Set<string>();
  const groups = new Map<string, Document[]>();

  for (const doc of docs) {
    const key = `${doc.projectId}::${extractBaseDrawingKey(doc.name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(doc);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Sort descending by revision number
    const sorted = [...group].sort(
      (a, b) => parseRevisionNumeric(b.name) - parseRevisionNumeric(a.name)
    );
    // Everything after the first (highest revision) is superseded
    for (let i = 1; i < sorted.length; i++) superseded.add(sorted[i].id);
  }

  return superseded;
}

/** Get the revision label of the document that supersedes a given doc */
function getNewerRevisionLabel(doc: Document, allDocs: Document[], supersededSet: Set<string>): string | null {
  if (!supersededSet.has(doc.id)) return null;
  const baseKey = extractBaseDrawingKey(doc.name);
  const newer = allDocs.find(
    d => d.projectId === doc.projectId &&
         extractBaseDrawingKey(d.name) === baseKey &&
         !supersededSet.has(d.id)
  );
  if (!newer) return null;
  return parseRevisionLabel(newer.name) || 'newer revision';
}

// ─── Comment thread helpers ───────────────────────────────────────────────────

function CommentTypeBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    comment:       { label: 'Comment',       cls: 'bg-gray-100 text-gray-700' },
    question:      { label: 'Question',      cls: 'bg-blue-100 text-blue-700' },
    issue:         { label: 'Issue',         cls: 'bg-red-100 text-red-700' },
    approval_note: { label: 'Approval Note', cls: 'bg-green-100 text-green-700' },
  };
  const { label, cls } = map[type] || map.comment;
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${cls}`}>{label}</span>;
}

function DocumentCommentThread({ documentId, currentUserName }: { documentId: string; currentUserName: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newBody, setNewBody] = useState('');
  const [newType, setNewType] = useState('comment');

  const { data: comments = [], isLoading } = useQuery<DocumentComment[]>({
    queryKey: [`/api/documents/${documentId}/comments`],
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/documents/${documentId}/comments`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to load comments');
      return res.json();
    },
  });

  const addComment = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/documents/${documentId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ body: newBody.trim(), commentType: newType }),
      });
      if (!res.ok) throw new Error('Failed to save comment');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/documents/${documentId}/comments`] });
      setNewBody('');
    },
    onError: () => toast({ title: 'Could not save comment', variant: 'destructive' }),
  });

  const resolveComment = useMutation({
    mutationFn: async (commentId: string) => {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/documents/${documentId}/comments/${commentId}/resolve`, {
        method: 'PATCH',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to resolve');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/documents/${documentId}/comments`] });
      toast({ title: 'Comment marked as resolved' });
    },
    onError: () => toast({ title: 'Could not resolve comment', variant: 'destructive' }),
  });

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const open = (comments as DocumentComment[]).filter(c => !c.resolved);
  const resolved = (comments as DocumentComment[]).filter(c => c.resolved);

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
      {isLoading ? (
        <p className="text-xs text-gray-400">Loading comments…</p>
      ) : (
        <>
          {open.length === 0 && resolved.length === 0 && (
            <p className="text-xs text-gray-400 italic">No comments yet. Add a note, question, or flag an issue.</p>
          )}
          {open.map(c => (
            <div key={c.id} className="flex gap-2">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
                {c.authorName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 bg-gray-50 rounded-lg p-2.5 text-sm">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-semibold text-gray-800 text-xs">{c.authorName}</span>
                  <CommentTypeBadge type={c.commentType} />
                  <span className="text-xs text-gray-400 ml-auto">{fmt(c.createdAt)}</span>
                </div>
                <p className="text-gray-700 text-sm leading-snug">{c.body}</p>
                <button onClick={() => resolveComment.mutate(c.id)} disabled={resolveComment.isPending}
                  className="mt-1.5 text-xs text-gray-400 hover:text-green-600 flex items-center gap-1 transition-colors">
                  <CheckCheck className="w-3 h-3" />Mark resolved
                </button>
              </div>
            </div>
          ))}
          {resolved.length > 0 && (
            <details className="group">
              <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 list-none flex items-center gap-1">
                <ChevronDown className="w-3 h-3 group-open:rotate-180 transition-transform" />
                {resolved.length} resolved comment{resolved.length > 1 ? 's' : ''}
              </summary>
              <div className="mt-2 space-y-2 opacity-60">
                {resolved.map(c => (
                  <div key={c.id} className="flex gap-2">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-400">
                      {c.authorName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 bg-gray-50 rounded-lg p-2 text-sm border border-gray-100">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-medium text-gray-500 text-xs">{c.authorName}</span>
                        <CommentTypeBadge type={c.commentType} />
                        <span className="text-xs text-gray-300 ml-auto">{fmt(c.createdAt)}</span>
                      </div>
                      <p className="text-gray-500 text-xs line-through">{c.body}</p>
                      <p className="text-xs text-green-600 mt-0.5">Resolved by {c.resolvedByName}</p>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
      {/* New comment form */}
      <div className="flex gap-2 pt-1">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white">
          {currentUserName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 space-y-2">
          <Textarea placeholder="Add a comment, question, or flag an issue…" value={newBody}
            onChange={e => setNewBody(e.target.value)} className="resize-none text-sm min-h-[60px]"
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && newBody.trim()) addComment.mutate(); }} />
          <div className="flex items-center gap-2">
            <Select value={newType} onValueChange={setNewType}>
              <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="comment"><span className="flex items-center gap-1.5"><MessageSquare className="w-3 h-3" />Comment</span></SelectItem>
                <SelectItem value="question"><span className="flex items-center gap-1.5"><HelpCircle className="w-3 h-3 text-blue-500" />Question</span></SelectItem>
                <SelectItem value="issue"><span className="flex items-center gap-1.5"><AlertCircle className="w-3 h-3 text-red-500" />Issue</span></SelectItem>
                <SelectItem value="approval_note"><span className="flex items-center gap-1.5"><CheckCheck className="w-3 h-3 text-green-500" />Approval Note</span></SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" className="h-7 text-xs ml-auto" onClick={() => addComment.mutate()}
              disabled={!newBody.trim() || addComment.isPending}>
              <Send className="w-3 h-3 mr-1" />{addComment.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Extracted text renderer with search highlighting ────────────────────────

function ExtractedTextBody({ text, search }: { text: string; search: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Memoize the highlighted HTML so we're not re-computing on every render
  const html = useMemo(() => {
    if (!search.trim()) {
      // No search — just preserve whitespace safely
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br/>');
    }
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escaped})`, 'gi');
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>')
      .replace(re, '<mark class="bg-yellow-200 text-yellow-900 rounded-sm px-0.5">$1</mark>');
  }, [text, search]);

  // Scroll to first highlight whenever search changes
  useEffect(() => {
    if (!search || !containerRef.current) return;
    const first = containerRef.current.querySelector('mark');
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [html, search]);

  return (
    <div
      ref={containerRef}
      className="font-mono text-xs leading-relaxed text-gray-800 whitespace-pre-wrap break-words"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ─── Shared auth header helper ────────────────────────────────────────────────

function authHeaders() {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Documents() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const currentUserId: string | null = (() => {
    try { const p = JSON.parse(atob((localStorage.getItem('auth_token') || '').split('.')[1])); return p.userId || p.id || null; }
    catch { return null; }
  })();

  const currentUserName: string = (() => {
    try { const p = JSON.parse(atob((localStorage.getItem('auth_token') || '').split('.')[1])); return p.name || p.username || 'You'; }
    catch { return 'You'; }
  })();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterRevision, setFilterRevision] = useState<'all' | 'current' | 'superseded'>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterDiscipline, setFilterDiscipline] = useState<string>('all');
  const [filterDrawingType, setFilterDrawingType] = useState<string>('all');
  const [filterAssigned, setFilterAssigned] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [assignDialog, setAssignDialog] = useState<{ open: boolean; documentId: string; documentName: string } | null>(null);
  const [selectedReviewerId, setSelectedReviewerId] = useState<string>('');
  const [reviewerNote, setReviewerNote] = useState<string>('');
  const [textViewerDocId, setTextViewerDocId] = useState<string | null>(null);
  const [textSearch, setTextSearch] = useState<string>('');

  const toggleComments = (id: string) =>
    setExpandedComments(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: rawDocuments = [], isLoading } = useQuery({ queryKey: ['/api/documents'], gcTime: 0, staleTime: 0 });
  const { data: users = [] } = useQuery({ queryKey: ['/api/users'] });
  const { data: _projects = [] } = useQuery({ queryKey: ['/api/projects'] });

  // ── Extracted text viewer query (fires only when a doc is selected) ───────────
  const { data: extractedTextData, isLoading: textLoading } = useQuery<{
    documentId: string; fileName: string; analysisStatus: string;
    pageCount: number | null; characterCount: number; wordCount: number; textContent: string;
  }>({
    queryKey: [`/api/documents/${textViewerDocId}/extracted-text`],
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/documents/${textViewerDocId}/extracted-text`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to load extracted text');
      return res.json();
    },
    enabled: !!textViewerDocId,
    staleTime: 60000,
  });

  // ── Auto-supersede computation ────────────────────────────────────────────────

  const allDocs = rawDocuments as Document[];
  const supersededSet = computeSupersededSet(allDocs);

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const assignReviewer = useMutation({
    mutationFn: async ({ documentId, assignedReviewerId, assignedReviewerNote }: { documentId: string; assignedReviewerId: string | null; assignedReviewerNote: string }) => {
      const res = await fetch(`/api/documents/${documentId}`, {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ assignedReviewerId, assignedReviewerNote }),
      });
      if (!res.ok) throw new Error('Failed to assign reviewer');
      return res.json();
    },
    onSuccess: (_data, { assignedReviewerId }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      const reviewer = (users as AppUser[]).find(u => u.id === assignedReviewerId);
      toast({ title: assignedReviewerId ? 'Reviewer assigned' : 'Assignment removed',
        description: assignedReviewerId && reviewer ? `${reviewer.name} has been assigned.` : undefined });
      setAssignDialog(null); setSelectedReviewerId(''); setReviewerNote('');
    },
    onError: () => toast({ title: 'Assignment failed', variant: 'destructive' }),
  });

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const getDrawingType = (filename: string): string => {
    const n = filename.toLowerCase();
    if (n.includes('floor_plan') || n.includes('ground_floor') || n.includes('second_floor') || n.includes('third_floor')) return 'Floor Plans';
    if (n.includes('elevation')) return 'Elevations';
    if (n.includes('roof_plan') || n.includes('roof')) return 'Roof Plans';
    if (n.includes('section') && !n.includes('wall_section')) return 'Building Sections';
    if (n.includes('wall_section')) return 'Wall Sections';
    if (n.includes('typical_details') || n.includes('details')) return 'Details';
    if (n.includes('schedule') || n.includes('door') || n.includes('window')) return 'Schedules';
    if (n.includes('construction_assembl') || n.includes('assembl')) return 'Construction Assemblies';
    if (n.includes('site_plan') || n.includes('site')) return 'Site Plans';
    if (n.includes('ceiling_plan') || n.includes('ceiling')) return 'Ceiling Plans';
    if (n.includes('stair')) return 'Stair Details';
    if (n.includes('fire') || n.includes('separation')) return 'Fire Protection';
    if (n.includes('penthouse')) return 'Mechanical Penthouse';
    if (n.includes('underground') || n.includes('parking')) return 'Underground/Parking';
    if (n.includes('specification')) return 'Specifications';
    return 'Other';
  };

  const handleViewDocument = async (projectId: string, documentId: string, fileName: string) => {
    mobileLog('📄 Viewing document', { fileName, projectId: projectId.substring(0, 8) });
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) { toast({ title: 'Authentication Required', description: 'Please log in to view documents.', variant: 'destructive' }); return; }
      const res = await fetch(`/api/projects/${projectId}/documents/${documentId}/view`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const tab = window.open(url, '_blank');
      if (!tab) { const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      logDocumentError(err as Error, projectId, documentId);
      toast({ title: 'Document Access Error', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleDownloadDocument = async (projectId: string, documentId: string, fileName: string) => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) { toast({ title: 'Authentication Required', variant: 'destructive' }); return; }
      const res = await fetch(`/api/projects/${projectId}/documents/${documentId}/download`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (err) {
      logDocumentError(err as Error, projectId, documentId);
      toast({ title: 'Download Failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const getAssignedReviewerName = (doc: Document): string | null => {
    if (!doc.assignedReviewerId) return null;
    const u = (users as AppUser[]).find(u => u.id === doc.assignedReviewerId);
    return u?.name || u?.username || 'Unknown user';
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '—';
    const k = 1024; const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });

  // ── Filter + sort ─────────────────────────────────────────────────────────────

  const filteredDocuments = allDocs
    .filter(doc => {
      const isDocSuperseded = supersededSet.has(doc.id);
      const matchesSearch = doc.name.toLowerCase().includes(searchTerm.toLowerCase()) || doc.projectName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesRevision = filterRevision === 'all' || (filterRevision === 'current' && !isDocSuperseded) || (filterRevision === 'superseded' && isDocSuperseded);
      const matchesType = filterType === 'all' || doc.type === filterType;
      const matchesDiscipline = filterDiscipline === 'all' || doc.disciplineName === filterDiscipline;
      const matchesDrawingType = filterDrawingType === 'all' || getDrawingType(doc.name) === filterDrawingType;
      const matchesAssigned = filterAssigned === 'all' ||
        (filterAssigned === 'mine' && doc.assignedReviewerId === currentUserId) ||
        (filterAssigned === 'assigned' && !!doc.assignedReviewerId) ||
        (filterAssigned === 'unassigned' && !doc.assignedReviewerId);
      return matchesSearch && matchesRevision && matchesType && matchesDiscipline && matchesDrawingType && matchesAssigned;
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name': {
          const ex = (n: string) => { const m = n.match(/([A-Z])(\d{2,3})/); return m ? { p: m[1], n: parseInt(m[2]) } : { p: 'Z', n: 9999 }; };
          const ea = ex(a.name); const eb = ex(b.name);
          cmp = ea.p !== eb.p ? ea.p.localeCompare(eb.p) : ea.n - eb.n; break;
        }
        case 'project': cmp = a.projectName.localeCompare(b.projectName); break;
        case 'uploadedAt': cmp = new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime(); break;
        case 'size': cmp = a.size - b.size; break;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

  // ── Stats ─────────────────────────────────────────────────────────────────────

  const stats = {
    total: allDocs.length,
    current: allDocs.filter(d => !supersededSet.has(d.id)).length,
    superseded: supersededSet.size,
    assignedToMe: allDocs.filter(d => d.assignedReviewerId === currentUserId).length,
  };

  const openAssignDialog = (doc: Document) => {
    setSelectedReviewerId(doc.assignedReviewerId || '');
    setReviewerNote(doc.assignedReviewerNote || '');
    setAssignDialog({ open: true, documentId: doc.id, documentName: doc.name });
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div>
      <header className="bg-white p-6 border-b">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold text-gray-900">All Documents</h2>
            <p className="text-gray-600 mt-1">Revisions are automatically detected — newer revisions supersede older ones</p>
          </div>
          <div className="flex gap-2">
            <Button variant={viewMode === 'list' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('list')} data-testid="view-list"><List className="h-4 w-4" /></Button>
            <Button variant={viewMode === 'grid' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('grid')} data-testid="view-grid"><Grid className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>

      <div className="p-6 space-y-6">
        <UserAccessPanel />

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4 flex items-center gap-3">
            <FileText className="w-5 h-5 text-blue-600 shrink-0" />
            <div><p className="text-2xl font-bold" data-testid="stat-total">{stats.total}</p><p className="text-sm text-gray-600">Total Documents</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <ArrowUpCircle className="w-5 h-5 text-green-600 shrink-0" />
            <div><p className="text-2xl font-bold text-green-700" data-testid="stat-current">{stats.current}</p><p className="text-sm text-gray-600">Current Revisions</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <History className="w-5 h-5 text-amber-500 shrink-0" />
            <div><p className="text-2xl font-bold text-amber-700" data-testid="stat-superseded">{stats.superseded}</p><p className="text-sm text-gray-600">Superseded</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <UserCheck className="w-5 h-5 text-violet-600 shrink-0" />
            <div><p className="text-2xl font-bold" data-testid="stat-assigned">{stats.assignedToMe}</p><p className="text-sm text-gray-600">Assigned to Me</p></div>
          </CardContent></Card>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Filter className="h-5 w-5" />Search & Filter</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="relative sm:col-span-2 lg:col-span-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input placeholder="Search documents…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" data-testid="search-input" />
              </div>
              <Select value={filterDiscipline} onValueChange={setFilterDiscipline}>
                <SelectTrigger data-testid="filter-discipline"><SelectValue placeholder="All Disciplines" /></SelectTrigger>
                <SelectContent>
                  {['all','Architectural','Structural','Mechanical','Electrical','Plumbing','Civil','Fire_Protection','Landscape','Specifications','Contracts','Reports','General'].map(v =>
                    <SelectItem key={v} value={v}>{v === 'all' ? 'All Disciplines' : v}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterDrawingType} onValueChange={setFilterDrawingType}>
                <SelectTrigger data-testid="filter-drawing-type"><SelectValue placeholder="All Drawing Types" /></SelectTrigger>
                <SelectContent>
                  {['all','Floor Plans','Elevations','Roof Plans','Building Sections','Wall Sections','Details','Schedules','Construction Assemblies','Site Plans','Ceiling Plans','Stair Details','Fire Protection','Mechanical Penthouse','Underground/Parking','Specifications'].map(v =>
                    <SelectItem key={v} value={v}>{v === 'all' ? 'All Drawing Types' : v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Revision status — replaces manual review status */}
              <Select value={filterRevision} onValueChange={v => setFilterRevision(v as typeof filterRevision)}>
                <SelectTrigger data-testid="filter-revision"><SelectValue placeholder="All Revisions" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Revisions</SelectItem>
                  <SelectItem value="current">Current Only</SelectItem>
                  <SelectItem value="superseded">Superseded Only</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterAssigned} onValueChange={setFilterAssigned}>
                <SelectTrigger data-testid="filter-assigned"><SelectValue placeholder="All Assignments" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Assignments</SelectItem>
                  <SelectItem value="mine">Assigned to Me</SelectItem>
                  <SelectItem value="assigned">Any Assignee</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterType !== 'all' ? `type-${filterType}` : `sort-${sortBy}`}
                onValueChange={v => { if (v.startsWith('type-')) { setFilterType(v.slice(5)); } else { setFilterType('all'); setSortBy(v.slice(5)); } }}>
                <SelectTrigger data-testid="filter-type-sort"><SelectValue placeholder="File Type / Sort" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="type-all">All File Types</SelectItem>
                  <SelectItem value="type-pdf">PDF Files</SelectItem>
                  <SelectItem value="type-dwg">DWG Files</SelectItem>
                  <SelectItem value="type-ifc">IFC Files</SelectItem>
                  <div className="border-t my-1" />
                  <SelectItem value="sort-name">Sort by Drawing No.</SelectItem>
                  <SelectItem value="sort-uploadedAt">Sort by Upload Date</SelectItem>
                  <SelectItem value="sort-size">Sort by File Size</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => setSortOrder(s => s === 'asc' ? 'desc' : 'asc')} data-testid="sort-order" className="flex items-center justify-center gap-2">
                {sortOrder === 'asc' ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />}
                {sortOrder === 'asc' ? 'Ascending' : 'Descending'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Document list */}
        {isLoading ? (
          <Card><CardContent className="p-6 text-center text-gray-500">Loading documents…</CardContent></Card>
        ) : viewMode === 'list' ? (
          <Card>
            <CardHeader><CardTitle>Documents ({filteredDocuments.length})</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {filteredDocuments.map(doc => {
                  const isSuperseded = supersededSet.has(doc.id);
                  const newerRevLabel = getNewerRevisionLabel(doc, allDocs, supersededSet);
                  const revLabel = parseRevisionLabel(doc.name);
                  const reviewerName = getAssignedReviewerName(doc);
                  const isAssignedToMe = doc.assignedReviewerId === currentUserId;

                  return (
                    <div key={doc.id}
                      className={`p-5 border rounded-lg space-y-4 ${isSuperseded ? 'bg-amber-50/40 border-amber-200 opacity-80' : 'bg-white hover:bg-gray-50'} ${isAssignedToMe && !isSuperseded ? 'border-violet-300' : ''}`}
                      data-testid={`document-row-${doc.id}`}>

                      {/* Superseded banner */}
                      {isSuperseded && newerRevLabel && (
                        <div className="flex items-center gap-2 text-xs text-amber-800 bg-amber-100 rounded px-3 py-1.5 border border-amber-200">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>This drawing has been superseded — <strong>{newerRevLabel}</strong> is the current revision. Quantities taken from this version may be outdated.</span>
                        </div>
                      )}

                      {/* Name row */}
                      <div className="flex items-start gap-3">
                        <div className="flex items-center gap-2 shrink-0 pt-0.5">
                          {isSuperseded ? <History className="w-5 h-5 text-amber-500" /> : <FileText className="w-5 h-5 text-blue-600" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className={`font-semibold text-sm sm:text-base leading-snug break-all ${isSuperseded ? 'text-gray-500' : 'text-gray-900'}`}>{doc.name}</h3>
                          {isAssignedToMe && !isSuperseded && <p className="text-xs text-violet-700 mt-0.5 font-medium">Assigned to you for review</p>}
                        </div>
                        {/* Revision badge */}
                        {revLabel && (
                          <Badge className={`shrink-0 font-mono text-xs ${isSuperseded ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                            {revLabel}
                          </Badge>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleViewDocument(doc.projectId, doc.id, doc.name)} data-testid={`view-${doc.id}`} className="flex-1 h-9">
                          <Eye className="w-4 h-4 mr-2" />View
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDownloadDocument(doc.projectId, doc.id, doc.name)} data-testid={`download-${doc.id}`} className="flex-1 h-9">
                          <Download className="w-4 h-4 mr-2" />Download
                        </Button>
                        {(doc.analysisStatus === 'Ready' || doc.status === 'completed') && (
                          <Button variant="ghost" size="sm" onClick={() => { setTextViewerDocId(doc.id); setTextSearch(''); }} data-testid={`extracted-text-${doc.id}`} className="h-9 text-teal-700 hover:text-teal-800 hover:bg-teal-50 shrink-0">
                            <FileSearch className="w-4 h-4 mr-1.5" />Extracted Text
                          </Button>
                        )}
                      </div>

                      {/* Metadata row */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-gray-100 text-sm text-gray-600">
                        <div className="flex items-center gap-1.5"><FolderOpen className="w-3.5 h-3.5 text-gray-400 shrink-0" /><span className="truncate font-medium">{doc.projectName}</span></div>
                        <div>{doc.disciplineName && <span className="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">{doc.disciplineName}</span>}</div>
                        <div>{formatFileSize(doc.size)}</div>
                        <div className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-gray-400" />{formatDate(doc.uploadedAt)}</div>
                      </div>

                      {/* Badges row */}
                      <div className="flex flex-wrap gap-2">
                        {(doc.analysisStatus === 'Ready' || doc.status === 'completed') ? (
                          <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs gap-1"><Cpu className="w-3 h-3" />AI Extracted{doc.pageCount ? ` · ${doc.pageCount} pages` : ''}</Badge>
                        ) : doc.analysisStatus === 'Processing' ? (
                          <Badge className="bg-yellow-50 text-yellow-700 border-yellow-200 text-xs gap-1"><Cpu className="w-3 h-3 animate-pulse" />Extracting…</Badge>
                        ) : null}
                        <span className="text-xs text-gray-400 self-center">{getDrawingType(doc.name)}</span>
                        {reviewerName && (
                          <Badge className="bg-violet-50 text-violet-700 border-violet-200 text-xs gap-1"><Users className="w-3 h-3" />Reviewer: {reviewerName}</Badge>
                        )}
                      </div>

                      {/* Review actions */}
                      <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-100">
                        <Button variant="outline" size="sm" className="h-7 text-xs bg-violet-50 border-violet-300 text-violet-700 hover:bg-violet-100"
                          onClick={() => openAssignDialog(doc)}>
                          <UserCheck className="w-3 h-3 mr-1" />
                          {doc.assignedReviewerId ? 'Reassign' : 'Assign for Review'}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-gray-500 hover:text-gray-700 ml-auto"
                          onClick={() => toggleComments(doc.id)}>
                          <MessageSquare className="w-3 h-3 mr-1" />Comments
                          {expandedComments.has(doc.id) ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                        </Button>
                      </div>

                      {expandedComments.has(doc.id) && <DocumentCommentThread documentId={doc.id} currentUserName={currentUserName} />}
                    </div>
                  );
                })}
                {filteredDocuments.length === 0 && <div className="text-center py-8 text-gray-500">No documents match your filters.</div>}
              </div>
            </CardContent>
          </Card>
        ) : (
          /* Grid view */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredDocuments.map(doc => {
              const isSuperseded = supersededSet.has(doc.id);
              const newerRevLabel = getNewerRevisionLabel(doc, allDocs, supersededSet);
              const revLabel = parseRevisionLabel(doc.name);
              const reviewerName = getAssignedReviewerName(doc);
              return (
                <Card key={doc.id} className={`hover:shadow-md transition-shadow ${isSuperseded ? 'opacity-70 border-amber-200 bg-amber-50/30' : ''}`} data-testid={`document-card-${doc.id}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      {isSuperseded ? <History className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" /> : <FileText className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />}
                      {revLabel && <Badge className={`font-mono text-xs shrink-0 ${isSuperseded ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>{revLabel}</Badge>}
                    </div>
                    <CardTitle className="text-sm font-medium break-all leading-snug" title={doc.name}>{doc.name}</CardTitle>
                    {isSuperseded && newerRevLabel && <p className="text-xs text-amber-700 mt-1">Superseded by {newerRevLabel}</p>}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1.5 text-sm text-gray-600">
                      <div className="flex items-center gap-1"><FolderOpen className="w-4 h-4" /><span className="truncate">{doc.projectName}</span></div>
                      {doc.disciplineName && <div><span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">{doc.disciplineName}</span></div>}
                      {reviewerName && <div className="flex items-center gap-1 text-xs text-violet-700"><Users className="w-3 h-3" />{reviewerName}</div>}
                      <div className="text-xs text-gray-400">{formatFileSize(doc.size)} · {formatDate(doc.uploadedAt)}</div>
                    </div>
                    <div className="flex justify-between mt-3 gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleViewDocument(doc.projectId, doc.id, doc.name)} data-testid={`view-${doc.id}`}><Eye className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDownloadDocument(doc.projectId, doc.id, doc.name)} data-testid={`download-${doc.id}`}><Download className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => openAssignDialog(doc)} className="text-violet-600"><UserCheck className="w-4 h-4" /></Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {filteredDocuments.length === 0 && <div className="col-span-full text-center py-8 text-gray-500">No documents match your filters.</div>}
          </div>
        )}
      </div>

      {/* ── Extracted Text Viewer Dialog ────────────────────────────────────── */}
      <Dialog open={!!textViewerDocId} onOpenChange={open => { if (!open) { setTextViewerDocId(null); setTextSearch(''); } }}>
        <DialogContent className="max-w-4xl w-full h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileSearch className="w-5 h-5 text-teal-600" />
              Extracted Text — {extractedTextData?.fileName ?? '…'}
            </DialogTitle>
            {extractedTextData && (
              <div className="flex flex-wrap gap-3 mt-1.5">
                <span className="text-xs text-gray-500 bg-gray-100 rounded px-2 py-0.5">{extractedTextData.pageCount ? `${extractedTextData.pageCount} pages` : 'Unknown pages'}</span>
                <span className="text-xs text-gray-500 bg-gray-100 rounded px-2 py-0.5">{extractedTextData.wordCount.toLocaleString()} words</span>
                <span className="text-xs text-gray-500 bg-gray-100 rounded px-2 py-0.5">{extractedTextData.characterCount.toLocaleString()} characters</span>
                <span className={`text-xs rounded px-2 py-0.5 ${extractedTextData.analysisStatus === 'Ready' ? 'bg-teal-100 text-teal-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {extractedTextData.analysisStatus}
                </span>
              </div>
            )}
          </DialogHeader>

          {/* Search bar */}
          <div className="px-6 py-3 border-b shrink-0 bg-gray-50">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search within extracted text…"
                value={textSearch}
                onChange={e => setTextSearch(e.target.value)}
                className="pl-9 bg-white"
              />
              {textSearch && extractedTextData && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                  {(() => {
                    const count = (extractedTextData.textContent.match(new RegExp(textSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
                    return count > 0 ? `${count} match${count !== 1 ? 'es' : ''}` : 'No matches';
                  })()}
                </span>
              )}
            </div>
          </div>

          {/* Text content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {textLoading ? (
              <div className="flex items-center justify-center h-full text-gray-400">
                <Cpu className="w-5 h-5 animate-pulse mr-2" />Loading extracted text…
              </div>
            ) : !extractedTextData?.textContent ? (
              <div className="flex items-center justify-center h-full text-gray-400">
                No extracted text available for this document.
              </div>
            ) : (
              <ExtractedTextBody text={extractedTextData.textContent} search={textSearch} />
            )}
          </div>

          <DialogFooter className="px-6 py-3 border-t shrink-0 bg-gray-50">
            <p className="text-xs text-gray-400 mr-auto">This is the raw text the AI reads before generating BIM elements. Use it to verify the PDF was scanned correctly.</p>
            <Button variant="outline" size="sm" onClick={() => { setTextViewerDocId(null); setTextSearch(''); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign for Review Dialog */}
      <Dialog open={!!assignDialog?.open} onOpenChange={open => { if (!open) { setAssignDialog(null); setSelectedReviewerId(''); setReviewerNote(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserCheck className="w-5 h-5 text-violet-600" />Assign for Review</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-500 break-all">{assignDialog?.documentName}</p>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Assign to</label>
              <Select value={selectedReviewerId} onValueChange={setSelectedReviewerId}>
                <SelectTrigger><SelectValue placeholder="Select a team member…" /></SelectTrigger>
                <SelectContent>
                  {(users as AppUser[]).map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.name} <span className="text-gray-400 text-xs ml-1">({u.role})</span></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Note <span className="text-gray-400 font-normal">(optional)</span></label>
              <Textarea placeholder="e.g. Please check fire rating compliance on grid lines B and C" value={reviewerNote}
                onChange={e => setReviewerNote(e.target.value)} className="resize-none" rows={3} />
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            {assignDialog && allDocs.find(d => d.id === assignDialog.documentId)?.assignedReviewerId && (
              <Button variant="ghost" className="text-red-600 hover:text-red-700 mr-auto"
                onClick={() => assignReviewer.mutate({ documentId: assignDialog.documentId, assignedReviewerId: null, assignedReviewerNote: '' })}
                disabled={assignReviewer.isPending}>
                <X className="w-4 h-4 mr-1" />Remove assignment
              </Button>
            )}
            <Button variant="outline" onClick={() => { setAssignDialog(null); setSelectedReviewerId(''); setReviewerNote(''); }}>Cancel</Button>
            <Button className="bg-violet-600 hover:bg-violet-700 text-white"
              onClick={() => { if (!assignDialog || !selectedReviewerId) return; assignReviewer.mutate({ documentId: assignDialog.documentId, assignedReviewerId: selectedReviewerId, assignedReviewerNote: reviewerNote }); }}
              disabled={!selectedReviewerId || assignReviewer.isPending}>
              <UserCheck className="w-4 h-4 mr-1" />{assignReviewer.isPending ? 'Assigning…' : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
