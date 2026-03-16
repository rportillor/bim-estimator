import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  X,
  FileText,
  Layers,
  Search,
  Box,
  ClipboardList,
  Loader2,
  AlertCircle,
  CheckCircle,
  Clock,
} from 'lucide-react';

interface DocumentAnalysisPanelProps {
  documentId: string;
  documentName: string;
  onClose: () => void;
}

interface CsiDivision {
  code: string;
  name: string;
  itemCount: number;
}

interface ExtractedItem {
  name: string;
  csiCode: string;
  category: string;
  quantity?: string;
}

interface SheetInfo {
  pageNumber: number;
  sheetNumber: string | null;
  sheetTitle: string | null;
}

interface BimElement {
  id: string;
  type: string;
  name: string | null;
  category: string | null;
  material: string | null;
  storey: string | null;
}

interface AnalysisData {
  documentId: string;
  filename: string;
  fileType: string;
  fileSize: number;
  analysisStatus: string;
  uploadedAt: string;
  summary: {
    pageCount: number;
    wordCount: number;
    csiDivisions: CsiDivision[];
    sheetCount: number;
  };
  extractedItems: ExtractedItem[];
  textPreview: string;
  sheets: SheetInfo[];
  linkedBimElements: BimElement[];
  hasAnalysisResult: boolean;
}

export function DocumentAnalysisPanel({ documentId, documentName, onClose }: DocumentAnalysisPanelProps) {
  const [textSearch, setTextSearch] = useState('');
  const [itemSearch, setItemSearch] = useState('');

  const { data: analysis, isLoading, error } = useQuery<AnalysisData>({
    queryKey: [`/api/documents/${documentId}/analysis`],
    enabled: !!documentId,
  });

  const formatFileSize = (bytes: number) => {
    if (!bytes) return 'Unknown';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'processing':
        return <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />;
      case 'failed':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      default:
        return <Clock className="w-4 h-4 text-yellow-600" />;
    }
  };

  const filteredItems = analysis?.extractedItems?.filter(item =>
    !itemSearch ||
    item.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
    item.csiCode.toLowerCase().includes(itemSearch.toLowerCase()) ||
    item.category.toLowerCase().includes(itemSearch.toLowerCase())
  ) || [];

  const highlightText = (text: string, search: string) => {
    if (!search.trim()) return text;
    const parts = text.split(new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === search.toLowerCase()
        ? <mark key={i} className="bg-yellow-200 px-0.5 rounded">{part}</mark>
        : part
    );
  };

  if (isLoading) {
    return (
      <Card className="border-l-4 border-l-blue-500">
        <CardContent className="p-6">
          <div className="flex items-center justify-center gap-2 py-8">
            <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
            <span className="text-gray-600">Loading analysis...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !analysis) {
    return (
      <Card className="border-l-4 border-l-red-500">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              <span>Failed to load analysis</span>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}><X className="w-4 h-4" /></Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-l-4 border-l-blue-500">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            Document Analysis: {documentName}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-blue-600">{analysis.summary.pageCount}</p>
            <p className="text-xs text-gray-500">Pages</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{analysis.summary.wordCount.toLocaleString()}</p>
            <p className="text-xs text-gray-500">Words</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-purple-600">{analysis.summary.csiDivisions.length}</p>
            <p className="text-xs text-gray-500">CSI Divisions</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1">
              {getStatusIcon(analysis.analysisStatus)}
              <p className="text-sm font-semibold capitalize">{analysis.analysisStatus}</p>
            </div>
            <p className="text-xs text-gray-500">Analysis Status</p>
          </div>
        </div>

        {/* File info */}
        <div className="flex flex-wrap gap-2 text-sm text-gray-500">
          <Badge variant="outline">{analysis.fileType?.toUpperCase()}</Badge>
          <Badge variant="outline">{formatFileSize(analysis.fileSize)}</Badge>
          {analysis.summary.sheetCount > 0 && (
            <Badge variant="outline">{analysis.summary.sheetCount} Sheets</Badge>
          )}
          {analysis.linkedBimElements.length > 0 && (
            <Badge variant="outline" className="bg-blue-50">{analysis.linkedBimElements.length} BIM Elements</Badge>
          )}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="csi" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="csi" className="text-xs">
              <Layers className="w-3 h-3 mr-1" /> CSI
            </TabsTrigger>
            <TabsTrigger value="items" className="text-xs">
              <ClipboardList className="w-3 h-3 mr-1" /> Items
            </TabsTrigger>
            <TabsTrigger value="text" className="text-xs">
              <FileText className="w-3 h-3 mr-1" /> Text
            </TabsTrigger>
            <TabsTrigger value="bim" className="text-xs">
              <Box className="w-3 h-3 mr-1" /> BIM
            </TabsTrigger>
          </TabsList>

          {/* CSI Divisions Tab */}
          <TabsContent value="csi" className="mt-3">
            {analysis.summary.csiDivisions.length > 0 ? (
              <div className="space-y-2">
                {analysis.summary.csiDivisions.map(div => (
                  <div key={div.code} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="font-mono text-xs">
                        Div {div.code}
                      </Badge>
                      <span className="text-sm">{div.name}</span>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {div.itemCount} {div.itemCount === 1 ? 'item' : 'items'}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 py-4 text-center">
                {analysis.analysisStatus === 'Pending' ? 'Analysis not yet started' : 'No CSI divisions detected'}
              </p>
            )}
          </TabsContent>

          {/* Extracted Items Tab */}
          <TabsContent value="items" className="mt-3">
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Search items..."
                  value={itemSearch}
                  onChange={e => setItemSearch(e.target.value)}
                  className="pl-9 h-8 text-sm"
                />
              </div>
              {filteredItems.length > 0 ? (
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {filteredItems.map((item, i) => (
                    <div key={i} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded text-sm">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{item.name}</p>
                        <p className="text-xs text-gray-500">{item.category}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {item.quantity && (
                          <span className="text-xs text-gray-600">{item.quantity}</span>
                        )}
                        {item.csiCode && (
                          <Badge variant="outline" className="font-mono text-xs">{item.csiCode}</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 py-4 text-center">
                  {itemSearch ? 'No matching items' : analysis.analysisStatus === 'Pending' ? 'Analysis not yet started' : 'No items extracted'}
                </p>
              )}
              {filteredItems.length > 0 && (
                <p className="text-xs text-gray-400 text-right">{filteredItems.length} items</p>
              )}
            </div>
          </TabsContent>

          {/* Text Preview Tab */}
          <TabsContent value="text" className="mt-3">
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Search text..."
                  value={textSearch}
                  onChange={e => setTextSearch(e.target.value)}
                  className="pl-9 h-8 text-sm"
                />
              </div>
              {analysis.textPreview ? (
                <div className="max-h-64 overflow-y-auto bg-gray-50 rounded p-3">
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
                    {highlightText(analysis.textPreview, textSearch)}
                  </pre>
                </div>
              ) : (
                <p className="text-sm text-gray-500 py-4 text-center">
                  No text content extracted
                </p>
              )}
            </div>

            {/* Sheets list */}
            {analysis.sheets.length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-medium mb-2">Sheets</p>
                <div className="flex flex-wrap gap-1">
                  {analysis.sheets.map(sheet => (
                    <Badge key={sheet.pageNumber} variant="outline" className="text-xs">
                      {sheet.sheetNumber || `Page ${sheet.pageNumber}`}
                      {sheet.sheetTitle && ` - ${sheet.sheetTitle}`}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* BIM Elements Tab */}
          <TabsContent value="bim" className="mt-3">
            {analysis.linkedBimElements.length > 0 ? (
              <div className="max-h-64 overflow-y-auto space-y-1">
                {analysis.linkedBimElements.map(el => (
                  <div key={el.id} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{el.name || el.type}</p>
                      <p className="text-xs text-gray-500">
                        {[el.category, el.material, el.storey].filter(Boolean).join(' / ')}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-xs capitalize flex-shrink-0">
                      {el.type}
                    </Badge>
                  </div>
                ))}
                <p className="text-xs text-gray-400 text-right pt-1">
                  {analysis.linkedBimElements.length} elements linked
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-500 py-4 text-center">
                {analysis.analysisStatus === 'Completed'
                  ? 'No BIM elements linked to this project yet'
                  : 'BIM elements will appear after analysis completes'}
              </p>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}