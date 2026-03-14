import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { 
  Search, 
  Filter, 
  FileText, 
  Calendar, 
  FolderOpen,
  Download,
  Eye,
  CheckCircle,
  AlertTriangle,
  History,
  Grid,
  List,
  SortAsc,
  SortDesc,
  ThumbsUp,
  ThumbsDown,
  Cpu,
  UserCheck,
  Users,
  X,
} from 'lucide-react';

import { UserAccessPanel } from '@/components/documents/UserAccessPanel';
import { useToast } from '@/hooks/use-toast';
import { logDocumentError, logAuthError } from '@/utils/error-monitoring';
import { runLiveErrorCheck } from '@/utils/live-error-check';
import { mobileLog } from '@/utils/mobile-console';

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
  reviewStatus: 'draft' | 'approved' | 'rejected';
  analysisStatus?: string;
  pageCount?: number;
  isSuperseded: boolean;
  revisionNumber: string;
  tags: string[];
  disciplineName?: string;
  visibilityLevel?: string;
  assignedReviewerId?: string | null;
  assignedReviewerNote?: string | null;
}

interface AppUser {
  id: string;
  username: string;
  name: string;
  role: string;
}

/** Parse revision number from filename. Returns e.g. "R1", "R2.1", or null. */
function parseRevisionFromFilename(filename: string): string | null {
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

function authHeaders() {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

export default function Documents() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const currentUserId: string | null = (() => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return null;
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.userId || payload.id || null;
    } catch {
      return null;
    }
  })();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterProject, _setFilterProject] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterDiscipline, setFilterDiscipline] = useState<string>('all');
  const [filterDrawingType, setFilterDrawingType] = useState<string>('all');
  const [filterAssigned, setFilterAssigned] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

  const [assignDialog, setAssignDialog] = useState<{ open: boolean; documentId: string; documentName: string } | null>(null);
  const [selectedReviewerId, setSelectedReviewerId] = useState<string>('');
  const [reviewerNote, setReviewerNote] = useState<string>('');

  const updateReviewStatus = useMutation({
    mutationFn: async ({ documentId, reviewStatus }: { documentId: string; reviewStatus: string }) => {
      const res = await fetch(`/api/documents/${documentId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ reviewStatus }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      return res.json();
    },
    onSuccess: (_data, { reviewStatus }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      const labels: Record<string, string> = { approved: 'Approved', rejected: 'Rejected', draft: 'Reset' };
      toast({ title: labels[reviewStatus] || 'Status updated', description: 'Document status has been saved.' });
    },
    onError: () => toast({ title: 'Update failed', description: 'Could not update document status.', variant: 'destructive' }),
  });

  const assignReviewer = useMutation({
    mutationFn: async ({ documentId, assignedReviewerId, assignedReviewerNote }: { documentId: string; assignedReviewerId: string | null; assignedReviewerNote: string }) => {
      const res = await fetch(`/api/documents/${documentId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ assignedReviewerId, assignedReviewerNote }),
      });
      if (!res.ok) throw new Error('Failed to assign reviewer');
      return res.json();
    },
    onSuccess: (_data, { assignedReviewerId }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      if (assignedReviewerId) {
        const reviewer = (users as AppUser[]).find(u => u.id === assignedReviewerId);
        toast({ title: 'Reviewer assigned', description: reviewer ? `${reviewer.name} has been assigned to review this document.` : 'Reviewer assigned.' });
      } else {
        toast({ title: 'Assignment removed', description: 'Reviewer assignment has been cleared.' });
      }
      setAssignDialog(null);
      setSelectedReviewerId('');
      setReviewerNote('');
    },
    onError: () => toast({ title: 'Assignment failed', description: 'Could not assign reviewer.', variant: 'destructive' }),
  });

  // Fetch all user documents across projects
  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['/api/documents'],
    gcTime: 0,
    staleTime: 0,
  });

  // Fetch users for reviewer picker
  const { data: users = [] } = useQuery({
    queryKey: ['/api/users'],
  });

  // Fetch projects for filter dropdown
  const { data: _projects = [] } = useQuery({
    queryKey: ['/api/projects'],
  });

  // Function to categorize documents by drawing type based on filename
  const getDrawingType = (filename: string): string => {
    const name = filename.toLowerCase();
    if (name.includes('floor_plan') || name.includes('ground_floor') || name.includes('second_floor') || name.includes('third_floor')) return 'Floor Plans';
    if (name.includes('elevation')) return 'Elevations';
    if (name.includes('roof_plan') || name.includes('roof')) return 'Roof Plans';
    if (name.includes('section') && !name.includes('wall_section')) return 'Building Sections';
    if (name.includes('wall_section')) return 'Wall Sections';
    if (name.includes('typical_details') || name.includes('details')) return 'Details';
    if (name.includes('schedule') || name.includes('door') || name.includes('window')) return 'Schedules';
    if (name.includes('construction_assembl') || name.includes('assembl')) return 'Construction Assemblies';
    if (name.includes('site_plan') || name.includes('site')) return 'Site Plans';
    if (name.includes('ceiling_plan') || name.includes('ceiling')) return 'Ceiling Plans';
    if (name.includes('stair') || name.includes('stair_detail')) return 'Stair Details';
    if (name.includes('fire') || name.includes('separation')) return 'Fire Protection';
    if (name.includes('mechanical_penthouse') || name.includes('penthouse')) return 'Mechanical Penthouse';
    if (name.includes('underground') || name.includes('parking')) return 'Underground/Parking';
    if (name.includes('specification')) return 'Specifications';
    return 'Other';
  };

  // Handle document viewing with proper authentication AND error monitoring
  const handleViewDocument = async (projectId: string, documentId: string, fileName: string) => {
    console.log('🔍 DOCUMENT VIEW ATTEMPT:', { projectId, documentId, fileName });
    mobileLog('📄 Viewing document', { fileName, projectId: projectId.substring(0, 8) });
    try {
      const token = localStorage.getItem("auth_token");
      console.log('🔑 Token from localStorage:', token ? 'EXISTS' : 'MISSING');
      if (!token) {
        const authError = new Error('No authentication token available');
        logAuthError(authError, 'View Document - Missing Token');
        toast({ title: "Authentication Required", description: "Please log in to view documents.", variant: "destructive" });
        return;
      }
      const fullUrl = `/api/projects/${projectId}/documents/${documentId}/view`;
      console.log('🔗 Generated document URL:', fullUrl);
      try {
        console.log('🧪 Fetching document with auth...');
        const response = await fetch(fullUrl, { headers: { 'Authorization': `Bearer ${token}` }, credentials: 'include' });
        if (!response.ok) throw new Error(`Document not accessible: HTTP ${response.status}`);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const newTab = window.open(blobUrl, '_blank');
        if (!newTab) {
          const a = document.createElement('a');
          a.href = blobUrl; a.download = fileName || 'document';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
        }
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      } catch (fetchError) {
        console.error('Document fetch failed:', fetchError);
        mobileLog('Document fetch failed', { error: (fetchError as Error).message });
        logDocumentError(fetchError as Error, projectId, documentId);
        toast({ title: "Document Access Error", description: `Cannot access document: ${(fetchError as Error).message}`, variant: "destructive" });
        return;
      }
      console.log('✅ Document view initiated successfully');
    } catch (error) {
      console.error('❌ Error viewing document:', error);
      mobileLog('❌ Document view error', { error: (error as Error).message });
      logDocumentError(error as Error, projectId, documentId);
      toast({ title: "Error", description: `Failed to open document: ${(error as Error).message}`, variant: "destructive" });
    }
  };

  // Handle document download with proper authentication AND error monitoring
  const handleDownloadDocument = async (projectId: string, documentId: string, fileName: string) => {
    console.log('⬇️ DOCUMENT DOWNLOAD ATTEMPT:', { projectId, documentId, fileName });
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        const authError = new Error('No authentication token available for download');
        logAuthError(authError, 'Download Document - Missing Token');
        toast({ title: "Authentication Required", description: "Please log in to download documents.", variant: "destructive" });
        return;
      }
      const url = `/api/projects/${projectId}/documents/${documentId}/download`;
      const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl; a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      console.log('✅ Document download initiated');
    } catch (error) {
      console.error('❌ Error downloading document:', error);
      logDocumentError(error as Error, projectId, documentId);
      toast({ title: "Error", description: `Failed to download document: ${(error as Error).message}`, variant: "destructive" });
    }
  };

  // Filter and sort documents
  const filteredDocuments = (documents as Document[])
    .filter((doc: Document) => {
      const matchesSearch = doc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           doc.projectName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesProject = filterProject === 'all' || doc.projectId === filterProject;
      const matchesStatus = filterStatus === 'all' || doc.reviewStatus === filterStatus;
      const matchesType = filterType === 'all' || doc.type === filterType;
      const matchesDiscipline = filterDiscipline === 'all' || doc.disciplineName === filterDiscipline;
      const drawingType = getDrawingType(doc.name);
      const matchesDrawingType = filterDrawingType === 'all' || drawingType === filterDrawingType;
      const matchesAssigned = filterAssigned === 'all' ||
        (filterAssigned === 'mine' && doc.assignedReviewerId === currentUserId) ||
        (filterAssigned === 'assigned' && !!doc.assignedReviewerId) ||
        (filterAssigned === 'unassigned' && !doc.assignedReviewerId);
      return matchesSearch && matchesProject && matchesStatus && matchesType && matchesDiscipline && matchesDrawingType && matchesAssigned;
    })
    .sort((a: Document, b: Document) => {
      let comparison = 0;
      switch (sortBy) {
        case 'name': {
          const extractDrawingNumber = (name: string) => {
            const match = name.match(/([A-Z])(\d{2,3})/);
            if (match) return { prefix: match[1], number: parseInt(match[2], 10), original: name };
            return { prefix: 'Z', number: 9999, original: name };
          };
          const aDrawing = extractDrawingNumber(a.name);
          const bDrawing = extractDrawingNumber(b.name);
          const prefixComparison = aDrawing.prefix.localeCompare(bDrawing.prefix);
          if (prefixComparison !== 0) { comparison = prefixComparison; } 
          else { comparison = aDrawing.number - bDrawing.number; }
          break;
        }
        case 'project': comparison = a.projectName.localeCompare(b.projectName); break;
        case 'uploadedAt': comparison = new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime(); break;
        case 'size': comparison = a.size - b.size; break;
        default: comparison = 0;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

  const getStatusIcon = (status: string, isSuperseded: boolean) => {
    if (isSuperseded) return <History className="w-4 h-4 text-gray-500" />;
    switch (status) {
      case 'approved':  return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'rejected':  return <AlertTriangle className="w-4 h-4 text-red-600" />;
      default:          return <FileText className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: string, isSuperseded: boolean) => {
    if (isSuperseded) return <Badge variant="secondary">Superseded</Badge>;
    switch (status) {
      case 'approved':
        return <Badge className="bg-green-100 text-green-800 border-green-300">&#10003; Approved by you</Badge>;
      case 'rejected':
        return <Badge className="bg-red-100 text-red-800 border-red-300">&#10005; Rejected by you</Badge>;
      default:
        return <Badge variant="outline" className="text-gray-500">Not reviewed yet</Badge>;
    }
  };

  const getAssignedReviewerName = (doc: Document): string | null => {
    if (!doc.assignedReviewerId) return null;
    const reviewer = (users as AppUser[]).find(u => u.id === doc.assignedReviewerId);
    return reviewer?.name || reviewer?.username || 'Unknown user';
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-CA', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  // Summary statistics
  const docList = documents as Document[];
  const stats = {
    total: docList.length,
    assignedToMe: docList.filter(d => d.assignedReviewerId === currentUserId).length,
    approved: docList.filter(d => d.reviewStatus === 'approved').length,
    recent: docList.filter(d => {
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
      return new Date(d.uploadedAt) > weekAgo;
    }).length,
  };

  const openAssignDialog = (doc: Document) => {
    setSelectedReviewerId(doc.assignedReviewerId || '');
    setReviewerNote(doc.assignedReviewerNote || '');
    setAssignDialog({ open: true, documentId: doc.id, documentName: doc.name });
  };

  return (
    <div>
      {/* Header */}
      <header className="bg-white p-6 border-b">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold text-gray-900">All Documents</h2>
            <p className="text-gray-600 mt-1">View and manage all your uploaded documents across projects</p>
          </div>
          <div className="flex gap-2">
            <Button variant={viewMode === 'list' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('list')} data-testid="view-list">
              <List className="h-4 w-4" />
            </Button>
            <Button variant={viewMode === 'grid' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('grid')} data-testid="view-grid">
              <Grid className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="p-6 space-y-6">
        {/* User Access Panel */}
        <UserAccessPanel />

        {/* Summary Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-blue-600" />
                <div>
                  <p className="text-2xl font-bold" data-testid="stat-total">{stats.total}</p>
                  <p className="text-sm text-gray-600">Total Documents</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <UserCheck className="w-5 h-5 text-yellow-600" />
                <div>
                  <p className="text-2xl font-bold" data-testid="stat-pending">{stats.assignedToMe}</p>
                  <p className="text-sm text-gray-600">Assigned to Me</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <div>
                  <p className="text-2xl font-bold" data-testid="stat-approved">{stats.approved}</p>
                  <p className="text-sm text-gray-600">Approved</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <Calendar className="w-5 h-5 text-purple-600" />
                <div>
                  <p className="text-2xl font-bold" data-testid="stat-recent">{stats.recent}</p>
                  <p className="text-sm text-gray-600">This Week</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Search & Filter
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="sm:col-span-2 lg:col-span-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                  <Input placeholder="Search documents..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" data-testid="search-input" />
                </div>
              </div>
              <Select value={filterDiscipline} onValueChange={setFilterDiscipline}>
                <SelectTrigger data-testid="filter-discipline"><SelectValue placeholder="All Disciplines" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Disciplines</SelectItem>
                  <SelectItem value="Architectural">Architectural</SelectItem>
                  <SelectItem value="Structural">Structural</SelectItem>
                  <SelectItem value="Mechanical">Mechanical</SelectItem>
                  <SelectItem value="Electrical">Electrical</SelectItem>
                  <SelectItem value="Plumbing">Plumbing</SelectItem>
                  <SelectItem value="Civil">Civil</SelectItem>
                  <SelectItem value="Fire_Protection">Fire Protection</SelectItem>
                  <SelectItem value="Landscape">Landscape</SelectItem>
                  <SelectItem value="Specifications">Specifications</SelectItem>
                  <SelectItem value="Contracts">Contracts</SelectItem>
                  <SelectItem value="Reports">Reports</SelectItem>
                  <SelectItem value="General">General</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterDrawingType} onValueChange={setFilterDrawingType}>
                <SelectTrigger data-testid="filter-drawing-type"><SelectValue placeholder="All Drawing Types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Drawing Types</SelectItem>
                  <SelectItem value="Floor Plans">Floor Plans</SelectItem>
                  <SelectItem value="Elevations">Elevations</SelectItem>
                  <SelectItem value="Roof Plans">Roof Plans</SelectItem>
                  <SelectItem value="Building Sections">Building Sections</SelectItem>
                  <SelectItem value="Wall Sections">Wall Sections</SelectItem>
                  <SelectItem value="Details">Details</SelectItem>
                  <SelectItem value="Schedules">Schedules</SelectItem>
                  <SelectItem value="Construction Assemblies">Construction Assemblies</SelectItem>
                  <SelectItem value="Site Plans">Site Plans</SelectItem>
                  <SelectItem value="Ceiling Plans">Ceiling Plans</SelectItem>
                  <SelectItem value="Stair Details">Stair Details</SelectItem>
                  <SelectItem value="Fire Protection">Fire Protection</SelectItem>
                  <SelectItem value="Mechanical Penthouse">Mechanical Penthouse</SelectItem>
                  <SelectItem value="Underground/Parking">Underground/Parking</SelectItem>
                  <SelectItem value="Specifications">Specifications</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Review Status Filter */}
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger data-testid="filter-status"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="draft">Not Reviewed</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>

              {/* Assignment Filter */}
              <Select value={filterAssigned} onValueChange={setFilterAssigned}>
                <SelectTrigger data-testid="filter-assigned"><SelectValue placeholder="All Assignments" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Assignments</SelectItem>
                  <SelectItem value="mine">Assigned to Me</SelectItem>
                  <SelectItem value="assigned">Any Assignee</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                </SelectContent>
              </Select>

              {/* File Type / Sort */}
              <Select
                value={filterType !== 'all' ? `type-${filterType}` : `sort-${sortBy}`}
                onValueChange={(value) => {
                  if (value.startsWith('type-')) { setFilterType(value.replace('type-', '')); }
                  else if (value.startsWith('sort-')) { setFilterType('all'); setSortBy(value.replace('sort-', '')); }
                }}
              >
                <SelectTrigger data-testid="filter-type-sort"><SelectValue placeholder="All File Types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="type-all">All File Types</SelectItem>
                  <SelectItem value="type-pdf">PDF Files</SelectItem>
                  <SelectItem value="type-dwg">DWG Files</SelectItem>
                  <SelectItem value="type-dxf">DXF Files</SelectItem>
                  <SelectItem value="type-ifc">IFC Files</SelectItem>
                  <SelectItem value="type-rvt">Revit Files</SelectItem>
                  <div className="border-t my-1"></div>
                  <SelectItem value="sort-uploadedAt">Sort by Upload Date</SelectItem>
                  <SelectItem value="sort-size">Sort by File Size</SelectItem>
                </SelectContent>
              </Select>

              {/* Sort Direction */}
              <Button
                variant="outline"
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                onTouchStart={(e) => { e.preventDefault(); setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'); }}
                data-testid="sort-order"
                className="flex items-center justify-center gap-2"
              >
                {sortOrder === 'asc' ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />}
                {sortOrder === 'asc' ? 'Ascending' : 'Descending'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Documents List/Grid */}
        {isLoading ? (
          <Card><CardContent className="p-6"><div className="text-center">Loading documents...</div></CardContent></Card>
        ) : viewMode === 'list' ? (
          <Card>
            <CardHeader>
              <CardTitle>Documents ({filteredDocuments.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {filteredDocuments.map((doc: Document) => {
                  const reviewerName = getAssignedReviewerName(doc);
                  const isAssignedToMe = doc.assignedReviewerId === currentUserId;
                  return (
                    <div key={doc.id} className={`p-5 border rounded-lg hover:bg-gray-50 space-y-4 bg-white ${isAssignedToMe ? 'border-yellow-300 bg-yellow-50/30' : ''}`} data-testid={`document-row-${doc.id}`}>
                      {/* Document name */}
                      <div className="flex items-start space-x-3">
                        <div className="flex items-center space-x-2 flex-shrink-0">
                          {getStatusIcon(doc.reviewStatus, doc.isSuperseded)}
                          <FileText className="w-6 h-6 text-blue-600" />
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <h3 className="font-semibold text-gray-900 text-sm sm:text-base leading-normal" style={{ wordBreak: 'normal', overflowWrap: 'anywhere', hyphens: 'auto' }} title={doc.name}>
                            {doc.name}
                          </h3>
                          {isAssignedToMe && (
                            <p className="text-xs text-yellow-700 mt-1 font-medium">Assigned to you for review</p>
                          )}
                        </div>
                      </div>

                      {/* Action buttons row */}
                      <div className="flex items-center justify-center space-x-3 pt-2">
                        <Button variant="outline" size="sm" onClick={() => handleViewDocument(doc.projectId, doc.id, doc.name)} data-testid={`view-${doc.id}`} className="flex-1 h-9">
                          <Eye className="w-4 h-4 mr-2" />View
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDownloadDocument(doc.projectId, doc.id, doc.name)} data-testid={`download-${doc.id}`} className="flex-1 h-9">
                          <Download className="w-4 h-4 mr-2" />Download
                        </Button>
                      </div>

                      {/* Project and metadata row */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-gray-100">
                        <div className="flex items-center text-sm text-gray-600">
                          <FolderOpen className="w-4 h-4 mr-2 text-gray-400" />
                          <span className="font-medium">{doc.projectName}</span>
                        </div>
                        <div className="flex items-center">
                          <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">{doc.disciplineName}</span>
                        </div>
                        <div className="text-sm text-gray-600">
                          <span className="font-medium">Size:</span> {formatFileSize(doc.size)}
                        </div>
                        <div className="text-sm text-gray-600">
                          <span className="font-medium">Uploaded:</span> {formatDate(doc.uploadedAt)}
                        </div>
                      </div>

                      {/* AI analysis + revision info row */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {doc.analysisStatus === 'Ready' || doc.status === 'completed' ? (
                          <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs gap-1">
                            <Cpu className="w-3 h-3" />AI Extracted{doc.pageCount ? ` · ${doc.pageCount} pages` : ''}
                          </Badge>
                        ) : doc.analysisStatus === 'Processing' ? (
                          <Badge className="bg-yellow-50 text-yellow-700 border-yellow-200 text-xs gap-1">
                            <Cpu className="w-3 h-3 animate-pulse" />Extracting text…
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-gray-400 text-xs gap-1">
                            <Cpu className="w-3 h-3" />Not yet extracted
                          </Badge>
                        )}
                        {(() => {
                          const rev = (doc.revisionNumber && doc.revisionNumber !== 'undefined') ? doc.revisionNumber : parseRevisionFromFilename(doc.name);
                          return rev ? <Badge variant="outline" className="text-xs font-mono">{rev}</Badge> : null;
                        })()}
                        <span className="text-xs text-gray-400">{getDrawingType(doc.name)}</span>
                        {reviewerName && (
                          <Badge className="bg-violet-50 text-violet-700 border-violet-200 text-xs gap-1">
                            <Users className="w-3 h-3" />Reviewer: {reviewerName}
                          </Badge>
                        )}
                      </div>

                      {/* Review status + action buttons */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100">
                        <div>{getStatusBadge(doc.reviewStatus, doc.isSuperseded)}</div>
                        {!doc.isSuperseded && (
                          <div className="flex items-center gap-1 flex-wrap">
                            {doc.reviewStatus !== 'approved' && (
                              <Button variant="outline" size="sm" className="h-7 text-xs bg-green-50 border-green-300 text-green-700 hover:bg-green-100"
                                onClick={() => updateReviewStatus.mutate({ documentId: doc.id, reviewStatus: 'approved' })}
                                disabled={updateReviewStatus.isPending}>
                                <ThumbsUp className="w-3 h-3 mr-1" />Approve
                              </Button>
                            )}
                            {doc.reviewStatus === 'approved' && (
                              <Button variant="outline" size="sm" className="h-7 text-xs bg-red-50 border-red-300 text-red-700 hover:bg-red-100"
                                onClick={() => updateReviewStatus.mutate({ documentId: doc.id, reviewStatus: 'rejected' })}
                                disabled={updateReviewStatus.isPending}>
                                <ThumbsDown className="w-3 h-3 mr-1" />Reject
                              </Button>
                            )}
                            {doc.reviewStatus !== 'draft' && (
                              <Button variant="ghost" size="sm" className="h-7 text-xs text-gray-500 hover:text-gray-700"
                                onClick={() => updateReviewStatus.mutate({ documentId: doc.id, reviewStatus: 'draft' })}
                                disabled={updateReviewStatus.isPending}>
                                Reset
                              </Button>
                            )}
                            <Button variant="outline" size="sm" className="h-7 text-xs bg-violet-50 border-violet-300 text-violet-700 hover:bg-violet-100"
                              onClick={() => openAssignDialog(doc)}>
                              <UserCheck className="w-3 h-3 mr-1" />
                              {doc.assignedReviewerId ? 'Reassign' : 'Assign for Review'}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {filteredDocuments.length === 0 && (
                  <div className="text-center py-8 text-gray-500">No documents found matching your criteria.</div>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredDocuments.map((doc: Document) => {
              const reviewerName = getAssignedReviewerName(doc);
              return (
                <Card key={doc.id} className="hover:shadow-md transition-shadow" data-testid={`document-card-${doc.id}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-2">
                        {getStatusIcon(doc.reviewStatus, doc.isSuperseded)}
                        <FileText className="w-6 h-6 text-gray-400" />
                      </div>
                      {getStatusBadge(doc.reviewStatus, doc.isSuperseded)}
                    </div>
                    <CardTitle className="text-sm font-medium truncate" title={doc.name}>{doc.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm text-gray-600">
                      <div className="flex items-center"><FolderOpen className="w-4 h-4 mr-2" /><span className="truncate">{doc.projectName}</span></div>
                      <div className="flex items-center mb-2">
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-md text-xs font-medium">{doc.disciplineName}</span>
                      </div>
                      {reviewerName && (
                        <div className="flex items-center gap-1 text-xs text-violet-700">
                          <Users className="w-3 h-3" />{reviewerName}
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span>{formatFileSize(doc.size)}</span>
                        <Badge variant="outline" className="text-xs">{doc.revisionNumber}</Badge>
                      </div>
                      <div className="text-xs">{formatDate(doc.uploadedAt)}</div>
                    </div>
                    <div className="flex justify-between mt-4 gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleViewDocument(doc.projectId, doc.id, doc.name)} data-testid={`view-${doc.id}`}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDownloadDocument(doc.projectId, doc.id, doc.name)} data-testid={`download-${doc.id}`}>
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openAssignDialog(doc)} className="text-violet-600">
                        <UserCheck className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {filteredDocuments.length === 0 && (
              <div className="col-span-full text-center py-8 text-gray-500">No documents found matching your criteria.</div>
            )}
          </div>
        )}
      </div>

      {/* Assign for Review Dialog */}
      <Dialog open={!!assignDialog?.open} onOpenChange={(open) => { if (!open) { setAssignDialog(null); setSelectedReviewerId(''); setReviewerNote(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-violet-600" />
              Assign for Review
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="text-sm text-gray-500 mb-3 break-all">{assignDialog?.documentName}</p>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Assign to</label>
              <Select value={selectedReviewerId} onValueChange={setSelectedReviewerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a team member..." />
                </SelectTrigger>
                <SelectContent>
                  {(users as AppUser[]).map(u => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name} <span className="text-gray-400 text-xs ml-1">({u.role})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Note to reviewer <span className="text-gray-400 font-normal">(optional)</span></label>
              <Textarea
                placeholder="e.g. Please check fire rating compliance on grid lines B and C"
                value={reviewerNote}
                onChange={(e) => setReviewerNote(e.target.value)}
                className="resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="flex gap-2 sm:gap-2">
            {assignDialog && (documents as Document[]).find(d => d.id === assignDialog.documentId)?.assignedReviewerId && (
              <Button variant="ghost" className="text-red-600 hover:text-red-700 mr-auto"
                onClick={() => assignReviewer.mutate({ documentId: assignDialog.documentId, assignedReviewerId: null, assignedReviewerNote: '' })}
                disabled={assignReviewer.isPending}>
                <X className="w-4 h-4 mr-1" />Remove assignment
              </Button>
            )}
            <Button variant="outline" onClick={() => { setAssignDialog(null); setSelectedReviewerId(''); setReviewerNote(''); }}>Cancel</Button>
            <Button
              className="bg-violet-600 hover:bg-violet-700 text-white"
              onClick={() => {
                if (!assignDialog || !selectedReviewerId) return;
                assignReviewer.mutate({ documentId: assignDialog.documentId, assignedReviewerId: selectedReviewerId, assignedReviewerNote: reviewerNote });
              }}
              disabled={!selectedReviewerId || assignReviewer.isPending}>
              <UserCheck className="w-4 h-4 mr-1" />
              {assignReviewer.isPending ? 'Assigning…' : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
