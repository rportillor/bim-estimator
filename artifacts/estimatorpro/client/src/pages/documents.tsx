import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Search, 
  Filter, 
  FileText, 
  Calendar, 
  FolderOpen,
  Download,
  Eye,
  CheckCircle,
  Clock,
  AlertTriangle,
  History,
  Grid,
  List,
  SortAsc,
  SortDesc,
  BarChart3
} from 'lucide-react';

import { UserAccessPanel } from '@/components/documents/UserAccessPanel';
import { DocumentAnalysisPanel } from '@/components/documents/DocumentAnalysisPanel';
import { useToast } from '@/hooks/use-toast';
import { logDocumentError, logAuthError } from '@/utils/error-monitoring';
import { runLiveErrorCheck } from '@/utils/live-error-check';
import { DebugPanel } from '@/components/debug-panel';
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
  reviewStatus: 'draft' | 'under_review' | 'approved' | 'rejected';
  isSuperseded: boolean;
  revisionNumber: string;
  tags: string[];
  disciplineName?: string;
  visibilityLevel?: string;
}

export default function Documents() {
  const { toast } = useToast();
  
  // Run live error check on component mount for debugging
  React.useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('🔍 Documents page loaded - running error diagnostics...');
      runLiveErrorCheck().then(result => {
        console.log('🧪 Live error check completed:', result);
      });
    }
  }, []);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterProject, _setFilterProject] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterDiscipline, setFilterDiscipline] = useState<string>('all');
  const [filterDrawingType, setFilterDrawingType] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [analysisDocId, setAnalysisDocId] = useState<string | null>(null);
  const [analysisDocName, setAnalysisDocName] = useState<string>('');

  // Handle document viewing with proper authentication AND error monitoring
  const handleViewDocument = async (projectId: string, documentId: string, fileName: string) => {
    console.log('🔍 DOCUMENT VIEW ATTEMPT:', { projectId, documentId, fileName });
    mobileLog('📄 Viewing document', { fileName, projectId: projectId.substring(0, 8) });
    
    try {
      // SECURITY FIX: Use Authorization header instead of token in URL query parameter
      // Tokens in URLs leak via server logs, browser history, and Referer headers
      const token = localStorage.getItem("auth_token");
      console.log('🔑 Token from localStorage:', token ? 'EXISTS' : 'MISSING');

      if (!token) {
        const authError = new Error('No authentication token available');
        logAuthError(authError, 'View Document - Missing Token');
        toast({
          title: "Authentication Required",
          description: "Please log in to view documents.",
          variant: "destructive",
        });
        return;
      }

      const fullUrl = `/api/projects/${projectId}/documents/${documentId}/view`;
      
      console.log('🔗 Generated document URL:', fullUrl);
      
      // Fetch document with auth header, then open as blob URL
      try {
        console.log('🧪 Fetching document with auth...');
        const response = await fetch(fullUrl, {
          headers: { 'Authorization': `Bearer ${token}` },
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error(`Document not accessible: HTTP ${response.status}`);
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        const newTab = window.open(blobUrl, '_blank');
        if (!newTab) {
          // Fallback: trigger download if popup blocked
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = fileName || 'document';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        // Clean up blob URL after a delay
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      } catch (fetchError) {
        console.error('Document fetch failed:', fetchError);
        mobileLog('Document fetch failed', { error: (fetchError as Error).message });
        logDocumentError(fetchError as Error, projectId, documentId);
        toast({
          title: "Document Access Error",
          description: `Cannot access document: ${(fetchError as Error).message}`,
          variant: "destructive",
        });
        return;
      }
      
      console.log('✅ Document view initiated successfully');
      
    } catch (error) {
      console.error('❌ Error viewing document:', error);
      mobileLog('❌ Document view error', { error: (error as Error).message });
      logDocumentError(error as Error, projectId, documentId);
      toast({
        title: "Error",
        description: `Failed to open document: ${(error as Error).message}`,
        variant: "destructive",
      });
    }
  };

  // Handle document download with proper authentication AND error monitoring
  const handleDownloadDocument = async (projectId: string, documentId: string, fileName: string) => {
    console.log('⬇️ DOCUMENT DOWNLOAD ATTEMPT:', { projectId, documentId, fileName });
    
    try {
      // SECURITY FIX: Use fetch with Authorization header instead of token in URL
      const token = localStorage.getItem("auth_token");

      if (!token) {
        const authError = new Error('No authentication token available for download');
        logAuthError(authError, 'Download Document - Missing Token');
        toast({
          title: "Authentication Required",
          description: "Please log in to download documents.",
          variant: "destructive",
        });
        return;
      }

      const url = `/api/projects/${projectId}/documents/${documentId}/download`;
      console.log('⬇️ Download URL:', url);

      // Fetch with Authorization header, then trigger download via blob URL
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      
      console.log('✅ Document download initiated');
      
    } catch (error) {
      console.error('❌ Error downloading document:', error);
      logDocumentError(error as Error, projectId, documentId);
      toast({
        title: "Error", 
        description: `Failed to download document: ${(error as Error).message}`,
        variant: "destructive",
      });
    }
  };

  // Function to categorize documents by drawing type based on filename
  const getDrawingType = (filename: string): string => {
    const name = filename.toLowerCase();
    
    if (name.includes('floor_plan') || name.includes('ground_floor') || name.includes('second_floor') || name.includes('third_floor')) {
      return 'Floor Plans';
    }
    if (name.includes('elevation')) {
      return 'Elevations';
    }
    if (name.includes('roof_plan') || name.includes('roof')) {
      return 'Roof Plans';
    }
    if (name.includes('section') && !name.includes('wall_section')) {
      return 'Building Sections';
    }
    if (name.includes('wall_section')) {
      return 'Wall Sections';
    }
    if (name.includes('typical_details') || name.includes('details')) {
      return 'Details';
    }
    if (name.includes('schedule') || name.includes('door') || name.includes('window')) {
      return 'Schedules';
    }
    if (name.includes('construction_assembl') || name.includes('assembl')) {
      return 'Construction Assemblies';
    }
    if (name.includes('site_plan') || name.includes('site')) {
      return 'Site Plans';
    }
    if (name.includes('ceiling_plan') || name.includes('ceiling')) {
      return 'Ceiling Plans';
    }
    if (name.includes('stair') || name.includes('stair_detail')) {
      return 'Stair Details';
    }
    if (name.includes('fire') || name.includes('separation')) {
      return 'Fire Protection';
    }
    if (name.includes('mechanical_penthouse') || name.includes('penthouse')) {
      return 'Mechanical Penthouse';
    }
    if (name.includes('underground') || name.includes('parking')) {
      return 'Underground/Parking';
    }
    if (name.includes('specification')) {
      return 'Specifications';
    }
    
    return 'Other';
  };

  // Fetch all user documents across projects
  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['/api/documents'],
    gcTime: 0,
    staleTime: 0,
  });

  // Fetch projects for filter dropdown
  const { data: _projects = [] } = useQuery({
    queryKey: ['/api/projects'],
  });

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
      
      return matchesSearch && matchesProject && matchesStatus && matchesType && matchesDiscipline && matchesDrawingType;
    })
    .sort((a: Document, b: Document) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'name': {
          // Smart numerical sort for construction drawings
          const extractDrawingNumber = (name: string) => {
            // Extract drawing number from various formats
            // Pattern: Find letter followed by 2-3 digits (A003, A412, etc.)
            const match = name.match(/([A-Z])(\d{2,3})/);
            if (match) {
              return {
                prefix: match[1],
                number: parseInt(match[2], 10),
                original: name
              };
            }
            // Fallback for non-drawing files
            return { prefix: 'Z', number: 9999, original: name };
          };

          const aDrawing = extractDrawingNumber(a.name);
          const bDrawing = extractDrawingNumber(b.name);

          // Sort by prefix first (A, S, M, etc.), then by number
          const prefixComparison = aDrawing.prefix.localeCompare(bDrawing.prefix);
          if (prefixComparison !== 0) {
            comparison = prefixComparison;
          } else {
            // Within same prefix, sort numerically: A003 → A004 → A101 → A412
            comparison = aDrawing.number - bDrawing.number;
          }
          break;
        }
        case 'project':
          comparison = a.projectName.localeCompare(b.projectName);
          break;
        case 'uploadedAt':
          comparison = new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime();
          break;
        case 'size':
          comparison = a.size - b.size;
          break;
        default:
          comparison = 0;
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });

  const getStatusIcon = (status: string, isSuperseded: boolean) => {
    if (isSuperseded) {
      return <History className="w-4 h-4 text-gray-500" />;
    }
    
    switch (status) {
      case 'approved':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'under_review':
        return <Clock className="w-4 h-4 text-yellow-600" />;
      case 'rejected':
        return <AlertTriangle className="w-4 h-4 text-red-600" />;
      default:
        return <FileText className="w-4 h-4 text-gray-600" />;
    }
  };

  const getStatusBadge = (status: string, isSuperseded: boolean) => {
    if (isSuperseded) {
      return <Badge variant="secondary">Superseded</Badge>;
    }
    
    switch (status) {
      case 'approved':
        return <Badge className="bg-green-100 text-green-800">Approved</Badge>;
      case 'under_review':
        return <Badge className="bg-yellow-100 text-yellow-800">Under Review</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="outline">Draft</Badge>;
    }
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
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Summary statistics calculated from real data
  const docList = documents as Document[];
  const stats = {
    total: docList.length,
    pending: docList.filter((doc: Document) => doc.reviewStatus === 'under_review').length,
    approved: docList.filter((doc: Document) => doc.reviewStatus === 'approved').length,
    recent: docList.filter((doc: Document) => {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return new Date(doc.uploadedAt) > weekAgo;
    }).length
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
            <Button
              variant={viewMode === 'list' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('list')}
              data-testid="view-list"
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'grid' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('grid')}
              data-testid="view-grid"
            >
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
                  <p className="text-2xl font-bold" data-testid="stat-total">
                    {stats.total}
                  </p>
                  <p className="text-sm text-gray-600">Total Documents</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <Clock className="w-5 h-5 text-yellow-600" />
                <div>
                  <p className="text-2xl font-bold" data-testid="stat-pending">
                    {stats.pending}
                  </p>
                  <p className="text-sm text-gray-600">Pending Review</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <div>
                  <p className="text-2xl font-bold" data-testid="stat-approved">
                    {stats.approved}
                  </p>
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
                  <p className="text-2xl font-bold" data-testid="stat-recent">
                    {stats.recent}
                  </p>
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
            {/* Row 1: Search and Primary Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Search */}
              <div className="sm:col-span-2 lg:col-span-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                  <Input
                    placeholder="Search documents..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                    data-testid="search-input"
                  />
                </div>
              </div>

              {/* Discipline Filter */}
              <Select value={filterDiscipline} onValueChange={setFilterDiscipline}>
                <SelectTrigger data-testid="filter-discipline">
                  <SelectValue placeholder="All Disciplines" />
                </SelectTrigger>
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

              {/* Drawing Type Filter */}
              <Select value={filterDrawingType} onValueChange={setFilterDrawingType}>
                <SelectTrigger data-testid="filter-drawing-type">
                  <SelectValue placeholder="All Drawing Types" />
                </SelectTrigger>
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
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Row 2: Secondary Filters and Sort */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Status Filter */}
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger data-testid="filter-status">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="under_review">Under Review</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>

              {/* Combined File Types & Sort Filter */}
              <Select 
                value={filterType !== 'all' ? `type-${filterType}` : `sort-${sortBy}`} 
                onValueChange={(value) => {
                  if (value.startsWith('type-')) {
                    setFilterType(value.replace('type-', ''));
                    // Keep current sort when filtering by type
                  } else if (value.startsWith('sort-')) {
                    setFilterType('all');
                    setSortBy(value.replace('sort-', ''));
                  }
                }}
              >
                <SelectTrigger data-testid="filter-type-sort">
                  <SelectValue placeholder="All File Types" />
                </SelectTrigger>
                <SelectContent>
                  {/* File Type Filters */}
                  <SelectItem value="type-all">All File Types</SelectItem>
                  <SelectItem value="type-pdf">PDF Files</SelectItem>
                  <SelectItem value="type-dwg">DWG Files</SelectItem>
                  <SelectItem value="type-dxf">DXF Files</SelectItem>
                  <SelectItem value="type-ifc">IFC Files</SelectItem>
                  <SelectItem value="type-rvt">Revit Files</SelectItem>
                  {/* Separator */}
                  <div className="border-t my-1"></div>
                  {/* Sort Options */}
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
          <Card>
            <CardContent className="p-6">
              <div className="text-center">Loading documents...</div>
            </CardContent>
          </Card>
        ) : viewMode === 'list' ? (
          <Card>
            <CardHeader>
              <CardTitle>Documents ({filteredDocuments.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {filteredDocuments.map((doc: Document) => (
                  <div
                    key={doc.id}
                    className="p-5 border rounded-lg hover:bg-gray-50 space-y-4 bg-white"
                    data-testid={`document-row-${doc.id}`}
                  >
                    {/* Document name - full width */}
                    <div className="flex items-start space-x-3">
                      <div className="flex items-center space-x-2 flex-shrink-0">
                        {getStatusIcon(doc.reviewStatus, doc.isSuperseded)}
                        <FileText className="w-6 h-6 text-blue-600" />
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <h3 className="font-semibold text-gray-900 text-sm sm:text-base leading-normal" 
                            style={{ 
                              wordBreak: 'normal',
                              overflowWrap: 'anywhere',
                              hyphens: 'auto'
                            }}
                            title={doc.name}>
                          {doc.name}
                        </h3>
                      </div>
                    </div>

                    {/* Action buttons row */}
                    <div className="flex items-center justify-center space-x-3 pt-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => handleViewDocument(doc.projectId, doc.id, doc.name)}
                        data-testid={`view-${doc.id}`}
                        className="flex-1 h-9"
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        View
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDownloadDocument(doc.projectId, doc.id, doc.name)}
                        data-testid={`download-${doc.id}`}
                        className="flex-1 h-9"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download
                      </Button>
                      <Button
                        variant={analysisDocId === doc.id ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => {
                          if (analysisDocId === doc.id) {
                            setAnalysisDocId(null);
                          } else {
                            setAnalysisDocId(doc.id);
                            setAnalysisDocName(doc.name);
                          }
                        }}
                        data-testid={`analyze-${doc.id}`}
                        className="flex-1 h-9"
                      >
                        <BarChart3 className="w-4 h-4 mr-2" />
                        Analysis
                      </Button>
                    </div>

                    {/* Project and metadata row */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-gray-100">
                      <div className="flex items-center text-sm text-gray-600">
                        <FolderOpen className="w-4 h-4 mr-2 text-gray-400" />
                        <span className="font-medium">{doc.projectName}</span>
                      </div>
                      <div className="flex items-center">
                        <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                          {doc.disciplineName}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600">
                        <span className="font-medium">Size:</span> {formatFileSize(doc.size)}
                      </div>
                      <div className="text-sm text-gray-600">
                        <span className="font-medium">Uploaded:</span> {formatDate(doc.uploadedAt)}
                      </div>
                    </div>

                    {/* Status and revision row */}
                    <div className="flex items-center justify-between pt-2">
                      <div className="flex items-center space-x-3">
                        {getStatusBadge(doc.reviewStatus, doc.isSuperseded)}
                        <Badge variant="outline" className="text-sm px-2 py-1">
                          Rev {doc.revisionNumber}
                        </Badge>
                      </div>
                      <div className="text-xs text-gray-500">
                        {getDrawingType(doc.name)}
                      </div>
                    </div>
                  </div>
                ))}
                
                {filteredDocuments.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    No documents found matching your criteria.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Document Analysis Panel */}
        {analysisDocId && (
          <DocumentAnalysisPanel
            documentId={analysisDocId}
            documentName={analysisDocName}
            onClose={() => setAnalysisDocId(null)}
          />
        )}

        {/* Grid View */}
        {!isLoading && viewMode === 'grid' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredDocuments.map((doc: Document) => (
              <Card key={doc.id} className="hover:shadow-md transition-shadow" data-testid={`document-card-${doc.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2">
                      {getStatusIcon(doc.reviewStatus, doc.isSuperseded)}
                      <FileText className="w-6 h-6 text-gray-400" />
                    </div>
                    {getStatusBadge(doc.reviewStatus, doc.isSuperseded)}
                  </div>
                  <CardTitle className="text-sm font-medium truncate" title={doc.name}>
                    {doc.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm text-gray-600">
                    <div className="flex items-center">
                      <FolderOpen className="w-4 h-4 mr-2" />
                      <span className="truncate">{doc.projectName}</span>
                    </div>
                    <div className="flex items-center mb-2">
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-md text-xs font-medium">
                        {doc.disciplineName}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>{formatFileSize(doc.size)}</span>
                      <Badge variant="outline" className="text-xs">{doc.revisionNumber}</Badge>
                    </div>
                    <div className="text-xs">
                      {formatDate(doc.uploadedAt)}
                    </div>
                  </div>
                  <div className="flex justify-between mt-4">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => handleViewDocument(doc.projectId, doc.id, doc.name)}
                      data-testid={`view-${doc.id}`}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={async () => {
                        try {
                          const token = localStorage.getItem("auth_token");
                          if (!token) { toast({ title: "Authentication Required", variant: "destructive" }); return; }
                          const resp = await fetch(`/api/projects/${doc.projectId}/documents/${doc.id}/download`, {
                            headers: { 'Authorization': `Bearer ${token}` }, credentials: 'include'
                          });
                          if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
                          const blob = await resp.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url; a.download = doc.name || "download";
                          document.body.appendChild(a); a.click();
                          document.body.removeChild(a); URL.revokeObjectURL(url);
                        } catch (err) { toast({ title: "Download Failed", description: (err as Error).message, variant: "destructive" }); }
                      }}
                      data-testid={`download-${doc.id}`}
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                    <Button
                      variant={analysisDocId === doc.id ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => {
                        if (analysisDocId === doc.id) {
                          setAnalysisDocId(null);
                        } else {
                          setAnalysisDocId(doc.id);
                          setAnalysisDocName(doc.name);
                        }
                      }}
                      data-testid={`analyze-grid-${doc.id}`}
                    >
                      <BarChart3 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            
            {filteredDocuments.length === 0 && (
              <div className="col-span-full text-center py-8 text-gray-500">
                No documents found matching your criteria.
              </div>
            )}
          </div>
        )}
      </div>

      
      {/* Debug Panel for Development */}
      <DebugPanel />
    </div>
  );
}