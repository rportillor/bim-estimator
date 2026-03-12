import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  MessageCircle, 
  Lightbulb, 
  TrendingUp, 
  Calendar,
  Send,
  Sparkles,
  ArrowRight,
  CheckCircle,
  AlertTriangle,
  Star,
  Brain,
  FileText,
  Plus,
  Shield,
  AlertCircle,
  Activity,
  Clock,
  CheckCircle2,
  X,
  Pause
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/queryClient';

interface CoachTip {
  id: string;
  category: string;
  title: string;
  content: string;
  actionable: boolean;
  relevanceScore: number;
  standards: string[];
  tags: string[];
  createdAt: string;
}

interface ProactiveFinding {
  id: string;
  category: 'Code Compliance' | 'Structural' | 'Fire Safety' | 'Accessibility' | 'Quality Control' | 'Cost Risk';
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  title: string;
  description: string;
  evidence: string[];
  recommendation: string;
  potentialImpact: string;
  canCreateRfi: boolean;
  suggestedRfiSubject?: string;
  status?: 'Open' | 'In Process' | 'Completed' | 'Cancelled' | 'On Hold';
  // 🚀 NEW: Enhanced for BIM integration and completion tracking
  affectedElements?: string[];
  location?: string;
}

interface ProactiveAnalysis {
  findings: ProactiveFinding[];
  summary: string;
}

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface AICoachProps {
  projectId?: string;
  context?: {
    projectType?: string;
    currentPhase?: string;
    buildingType?: string;
    location?: string;
  };
}

export function AICoach({ projectId, context = {} }: AICoachProps) {
  const [activeTab, setActiveTab] = useState<'analysis' | 'tips' | 'chat' | 'daily'>('analysis');
  const [findingStatuses, setFindingStatuses] = useState<Record<string, string>>({});
  const [currentPage, setCurrentPage] = useState(1);
  
  // Pagination settings
  const FINDINGS_PER_PAGE = 10;
  const [chatMessage, setChatMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch contextual tips with stable cache key to prevent duplicates
  const { data: tipsResponse, isLoading: tipsLoading } = useQuery({
    queryKey: ['/api/ai-coach/tips', projectId, JSON.stringify(context)],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch daily tip
  const { data: dailyTipResponse, isLoading: dailyLoading } = useQuery({
    queryKey: ['/api/ai-coach/daily-tip'],
    staleTime: 24 * 60 * 60 * 1000, // 24 hours
  });

  // 🚀 NEW: Fetch proactive analysis
  const { data: proactiveAnalysis, isLoading: analysisLoading, refetch: refetchAnalysis } = useQuery({
    queryKey: ['/api/ai-coach/analysis', projectId],
    enabled: !!projectId,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  const tips = (tipsResponse as any)?.tips || [];
  const dailyTip = dailyTipResponse as CoachTip;
  const analysis = proactiveAnalysis as ProactiveAnalysis;
  
  // Pagination calculations
  const totalFindings = analysis?.findings?.length || 0;
  const totalPages = Math.ceil(totalFindings / FINDINGS_PER_PAGE);
  const startIndex = (currentPage - 1) * FINDINGS_PER_PAGE;
  const endIndex = startIndex + FINDINGS_PER_PAGE;
  const paginatedFindings = analysis?.findings?.slice(startIndex, endIndex) || [];
  
  // Reset to page 1 when new analysis loads
  useEffect(() => {
    if (analysis && analysis.findings && analysis.findings.length > 0) {
      setCurrentPage(1);
    }
  }, [analysis?.findings?.length]);

  // 🚀 NEW: Check RFI completion to close issues
  const { data: rfis } = useQuery<any[]>({
    queryKey: projectId ? [`/api/rfis?projectId=${projectId}`] : ['/api/rfis'],
    enabled: !!projectId
  });

  // 🚀 NEW: Track RFI completion details for enhanced UI
  const [rfiCompletionInfo, setRfiCompletionInfo] = useState<Record<string, { rfiNumber: string; completedAt: string }>>({});

  // Auto-close findings when RFI is completed with enhanced tracking
  useEffect(() => {
    if (rfis && analysis?.findings) {
      const completedRfis = rfis.filter(rfi => rfi.status === 'Closed' || rfi.status === 'Responded');
      const updatedStatuses = { ...findingStatuses };
      const updatedCompletionInfo = { ...rfiCompletionInfo };
      let hasUpdates = false;
      let hasInfoUpdates = false;

      completedRfis.forEach(rfi => {
        // Check if RFI was created from a finding
        const relatedFinding = analysis.findings.find(f => 
          rfi.description?.includes(f.title.substring(0, 30)) || 
          rfi.subject?.includes(f.title.substring(0, 30)) ||
          f.suggestedRfiSubject?.includes(rfi.rfiNumber)
        );
        
        if (relatedFinding) {
          // Update status if not already completed
          if (updatedStatuses[relatedFinding.id] !== 'Completed') {
            updatedStatuses[relatedFinding.id] = 'Completed';
            hasUpdates = true;
          }
          
          // Track RFI completion info for UI display
          if (!updatedCompletionInfo[relatedFinding.id]) {
            updatedCompletionInfo[relatedFinding.id] = {
              rfiNumber: rfi.rfiNumber,
              completedAt: rfi.answeredAt || rfi.updatedAt
            };
            hasInfoUpdates = true;
          }
        }
      });

      if (hasUpdates) {
        setFindingStatuses(updatedStatuses);
      }
      if (hasInfoUpdates) {
        setRfiCompletionInfo(updatedCompletionInfo);
      }
    }
  }, [rfis, analysis?.findings, findingStatuses, rfiCompletionInfo]);

  // Chat with AI coach
  const chatMutation = useMutation({
    mutationFn: async (question: string) => {
      const conversationHistory = messages.map(m => m.content);
      const response = await apiRequest('POST', '/api/ai-coach/ask', {
        question,
        context,
        conversationHistory
      });
      return response.json();
    },
    onSuccess: (response) => {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        type: 'assistant',
        content: response.answer,
        timestamp: new Date()
      }]);
      setIsTyping(false);
    },
    onError: () => {
      setIsTyping(false);
    }
  });

  // 🚀 NEW: Create RFI from finding
  const createRfiMutation = useMutation({
    mutationFn: async ({ finding, customQuestion }: { finding: ProactiveFinding; customQuestion?: string }) => {
      const response = await apiRequest('POST', '/api/ai-coach/create-rfi', {
        projectId,
        findingId: finding.id,
        findingTitle: finding.title,
        findingDescription: finding.description,
        customQuestion,
        priority: finding.severity
      });
      return response.json();
    },
    onSuccess: (response) => {
      // 🚀 NEW: Enhanced success message with action guidance
      const rfiNumber = response.rfi.rfiNumber;
      alert(`✅ RFI ${rfiNumber} created successfully!\n\n📋 Next steps:\n• RFI will appear in RFI Dashboard\n• When answered/closed, this finding will auto-complete\n• Affected elements will be highlighted in BIM viewer`);
    },
    onError: (error) => {
      console.error('Failed to create RFI:', error);
      alert('❌ Failed to create RFI. Please try again.');
    }
  });

  const handleSendMessage = () => {
    if (!chatMessage.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: chatMessage,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsTyping(true);
    chatMutation.mutate(chatMessage);
    setChatMessage('');
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const getCategoryIcon = (category: string) => {
    const icons: { [key: string]: React.ReactNode } = {
      'Safety & Risk Management': <AlertTriangle className="h-4 w-4 text-red-500" />,
      'Code Compliance': <CheckCircle className="h-4 w-4 text-blue-500" />,
      'Cost Optimization': <TrendingUp className="h-4 w-4 text-green-500" />,
      'Quality Control': <Star className="h-4 w-4 text-yellow-500" />,
      'Daily Inspiration': <Sparkles className="h-4 w-4 text-purple-500" />,
      'Fire Safety': <Shield className="h-4 w-4 text-red-500" />,
      'Structural': <Activity className="h-4 w-4 text-orange-500" />,
      'Accessibility': <AlertCircle className="h-4 w-4 text-purple-500" />,
      'Cost Risk': <TrendingUp className="h-4 w-4 text-green-500" />
    };
    return icons[category] || <Lightbulb className="h-4 w-4 text-gray-500" />;
  };

  const getSeverityColor = (severity: string) => {
    const colors: { [key: string]: string } = {
      'Critical': 'bg-red-100 text-red-800 border-red-300',
      'High': 'bg-orange-100 text-orange-800 border-orange-300',
      'Medium': 'bg-yellow-100 text-yellow-800 border-yellow-300',
      'Low': 'bg-blue-100 text-blue-800 border-blue-300'
    };
    return colors[severity] || 'bg-gray-100 text-gray-800 border-gray-300';
  };

  const getStatusIcon = (status: string) => {
    const icons: { [key: string]: React.ReactNode } = {
      'Open': <AlertCircle className="h-3 w-3 text-red-500" />,
      'In Process': <Clock className="h-3 w-3 text-blue-500" />,
      'Completed': <CheckCircle2 className="h-3 w-3 text-green-500" />,
      'Cancelled': <X className="h-3 w-3 text-gray-500" />,
      'On Hold': <Pause className="h-3 w-3 text-yellow-500" />
    };
    return icons[status] || icons['Open'];
  };

  const getStatusColor = (status: string) => {
    const colors: { [key: string]: string } = {
      'Open': 'bg-red-50 text-red-700 border-red-200',
      'In Process': 'bg-blue-50 text-blue-700 border-blue-200',
      'Completed': 'bg-green-50 text-green-700 border-green-200',
      'Cancelled': 'bg-gray-50 text-gray-700 border-gray-200',
      'On Hold': 'bg-yellow-50 text-yellow-700 border-yellow-200'
    };
    return colors[status] || colors['Open'];
  };

  const handleStatusChange = (findingId: string, newStatus: string) => {
    setFindingStatuses(prev => ({
      ...prev,
      [findingId]: newStatus
    }));
  };


  const getCategoryColor = (category: string) => {
    const colors: { [key: string]: string } = {
      'Safety & Risk Management': 'bg-red-50 text-red-700 border-red-200',
      'Code Compliance': 'bg-blue-50 text-blue-700 border-blue-200',
      'Cost Optimization': 'bg-green-50 text-green-700 border-green-200',
      'Quality Control': 'bg-yellow-50 text-yellow-700 border-yellow-200',
      'Daily Inspiration': 'bg-purple-50 text-purple-700 border-purple-200'
    };
    return colors[category] || 'bg-gray-50 text-gray-700 border-gray-200';
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 sm:gap-3 p-3 sm:p-6 border-b bg-gradient-to-r from-blue-50 to-purple-50">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="p-1 sm:p-2 bg-blue-100 rounded-lg flex-shrink-0">
            <MessageCircle className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900 truncate">AI Construction Coach</h2>
            <p className="text-xs sm:text-sm text-gray-600 truncate">Expert guidance for your construction projects</p>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b bg-white px-2 sm:px-6 overflow-x-auto">
        <button
          onClick={() => setActiveTab('analysis')}
          className={cn(
            "px-2 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
            activeTab === 'analysis'
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          )}
        >
          <div className="flex items-center gap-1 sm:gap-2">
            <Brain className="h-3 w-3 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Proactive Analysis</span>
            <span className="sm:hidden">Analysis</span>
            {analysis?.findings && analysis.findings.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs sm:text-sm font-medium">
                {analysis.findings.length}
              </Badge>
            )}
          </div>
        </button>
        <button
          onClick={() => setActiveTab('tips')}
          className={cn(
            "px-2 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
            activeTab === 'tips'
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          )}
        >
          <div className="flex items-center gap-1 sm:gap-2">
            <Lightbulb className="h-3 w-3 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Smart Tips</span>
            <span className="sm:hidden">Tips</span>
          </div>
        </button>
        <button
          onClick={() => setActiveTab('chat')}
          className={cn(
            "px-2 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
            activeTab === 'chat'
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          )}
        >
          <div className="flex items-center gap-1 sm:gap-2">
            <MessageCircle className="h-3 w-3 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Ask Coach</span>
            <span className="sm:hidden">Chat</span>
          </div>
        </button>
        <button
          onClick={() => setActiveTab('daily')}
          className={cn(
            "px-2 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
            activeTab === 'daily'
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          )}
        >
          <div className="flex items-center gap-1 sm:gap-2">
            <Calendar className="h-3 w-3 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Daily Tip</span>
            <span className="sm:hidden">Tip</span>
          </div>
        </button>
      </div>

      {/* Content Area - Full height with proper scrolling */}
      <div className="flex-1 flex flex-col">
        {activeTab === 'analysis' && (
          <div className="flex-1 overflow-y-auto p-6 max-h-[calc(100vh-200px)]">
            <div className="space-y-4">
              {analysisLoading ? (
                <div className="space-y-4">
                  <Card className="bg-blue-50 border-blue-200">
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-center gap-3">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                        <div>
                          <p className="text-blue-900 font-medium">AI Analysis in Progress</p>
                          <p className="text-sm text-blue-700">Analyzing your project documents with Claude AI...</p>
                        </div>
                      </div>
                      <div className="mt-4 space-y-2 text-xs text-blue-600">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                          <span>Reading construction drawings and specifications</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                          <span>Checking building code compliance</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                          <span>Identifying potential issues and recommendations</span>
                        </div>
                      </div>
                      <div className="mt-4 p-3 bg-blue-100 rounded-lg">
                        <p className="text-xs text-blue-800">
                          ⚡ <strong>Analysis time varies</strong> based on document complexity | Future visits: <strong>instant</strong> (cached results)
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : analysis?.findings?.length > 0 ? (
                <>
                  {/* Summary Card */}
                  <Card className="bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 rounded-lg">
                          <Brain className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                          <CardTitle className="text-blue-900">AI Analysis Summary</CardTitle>
                          <p className="text-sm text-blue-700">
                            Found {analysis.findings.length} potential issues in your project documents
                          </p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-blue-800 leading-relaxed">{analysis.summary}</p>
                      <Button 
                        onClick={() => refetchAnalysis()}
                        variant="outline" 
                        size="sm" 
                        className="mt-3"
                        disabled={analysisLoading}
                      >
                        <ArrowRight className="h-4 w-4 mr-2" />
                        Refresh Analysis
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Pagination Controls - Top */}
                  {totalPages > 1 && (
                    <div className="flex justify-between items-center">
                      <p className="text-sm text-gray-600">
                        Showing {startIndex + 1}-{Math.min(endIndex, totalFindings)} of {totalFindings} findings
                      </p>
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                          disabled={currentPage === 1}
                        >
                          Previous
                        </Button>
                        <span className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded">
                          {currentPage} of {totalPages}
                        </span>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                          disabled={currentPage === totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Findings */}
                  {paginatedFindings.map((finding, index) => {
                    const currentStatus = findingStatuses[finding.id] || 'Open';
                    return (
                    <Card key={finding.id} className="hover:shadow-md transition-shadow">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <Badge variant="secondary" className="text-xs font-mono">
                                {startIndex + index + 1}/{totalFindings}
                              </Badge>
                              {getCategoryIcon(finding.category)}
                              <Badge variant="outline" className={`${getCategoryColor(finding.category)} text-xs`}>
                                {finding.category}
                              </Badge>
                              <Badge variant="outline" className={`${getSeverityColor(finding.severity)} text-xs`}>
                                {finding.severity}
                              </Badge>
                              {/* 🏢 NEW: Floor Badge - Shows which building level */}
                              {(finding as any).floor && (
                                <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 text-xs">
                                  📍 {(finding as any).floor}
                                </Badge>
                              )}
                              <div className="flex flex-wrap items-center gap-1 w-full sm:w-auto">
                                {getStatusIcon(currentStatus)}
                                <select
                                  value={currentStatus}
                                  onChange={(e) => handleStatusChange(finding.id, e.target.value)}
                                  className={`text-xs border rounded px-1 sm:px-2 py-1 max-w-[100px] sm:max-w-none ${getStatusColor(currentStatus)}`}
                                >
                                  <option value="Open">Open</option>
                                  <option value="In Process">In Process</option>
                                  <option value="Completed">Completed</option>
                                  <option value="Cancelled">Cancelled</option>
                                  <option value="On Hold">On Hold</option>
                                </select>
                                {/* 🚀 NEW: RFI Completion Badge */}
                                {rfiCompletionInfo[finding.id] && (
                                  <div className="bg-green-100 border border-green-200 rounded px-2 py-1 text-xs text-green-800 flex items-center gap-1 mt-1 sm:mt-0">
                                    <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                                    <span className="font-medium truncate max-w-[150px] sm:max-w-none">Resolved via {rfiCompletionInfo[finding.id].rfiNumber}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                            <CardTitle className="text-base">{finding.title}</CardTitle>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <p className="text-sm text-gray-700 leading-relaxed">{finding.description}</p>
                        
                        {finding.evidence.length > 0 && (
                          <div className="bg-gray-50 rounded-lg p-3">
                            <h4 className="text-sm font-medium text-gray-900 mb-2 flex items-center gap-2">
                              <FileText className="h-3 w-3" />
                              Evidence from Documents:
                            </h4>
                            <ul className="space-y-1">
                              {finding.evidence.map((evidence, i) => (
                                <li key={i} className="text-xs text-gray-600 flex items-start gap-2">
                                  <span className="text-blue-500 mt-1">•</span>
                                  <span>{evidence}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="bg-blue-50 rounded-lg p-3">
                          <h4 className="text-sm font-medium text-blue-900 mb-1">Recommendation:</h4>
                          <p className="text-xs text-blue-800">{finding.recommendation}</p>
                        </div>

                        <div className="bg-orange-50 rounded-lg p-3">
                          <h4 className="text-sm font-medium text-orange-900 mb-1">Potential Impact:</h4>
                          <p className="text-xs text-orange-800">{finding.potentialImpact}</p>
                        </div>

                        {/* 🏢 NEW: Floor Information Display */}
                        {(finding as any).floor && (
                          <div className="bg-purple-50 rounded-lg p-3">
                            <h4 className="text-sm font-medium text-purple-900 mb-1 flex items-center gap-2">
                              <Activity className="h-3 w-3" />
                              Building Level:
                            </h4>
                            <p className="text-xs text-purple-800 font-medium">{(finding as any).floor}</p>
                            <p className="text-xs text-purple-600 mt-1">
                              From Claude's analysis of construction drawings
                            </p>
                          </div>
                        )}

                        {finding.canCreateRfi && (
                          <div className="flex justify-end pt-4 border-t">
                            <Button
                              onClick={() => createRfiMutation.mutate({ finding })}
                              disabled={createRfiMutation.isPending}
                              size="sm"
                              className="bg-blue-600 hover:bg-blue-700"
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Create RFI
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                    );
                  })}

                  {/* Pagination Controls - Bottom */}
                  {totalPages > 1 && (
                    <div className="flex justify-center items-center gap-4 pt-4">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                        disabled={currentPage === 1}
                      >
                        Previous
                      </Button>
                      <div className="flex gap-1">
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                          <Button
                            key={page}
                            variant={page === currentPage ? "default" : "outline"}
                            size="sm"
                            onClick={() => setCurrentPage(page)}
                            className="w-8 h-8 p-0"
                          >
                            {page}
                          </Button>
                        ))}
                      </div>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                        disabled={currentPage === totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <Card>
                  <CardContent className="text-center py-8">
                    <Brain className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600 mb-2">No proactive analysis available yet.</p>
                    <p className="text-sm text-gray-500 mb-4">
                      Analysis will appear once your documents are processed.
                    </p>
                    <Button onClick={() => refetchAnalysis()} variant="outline">
                      <ArrowRight className="h-4 w-4 mr-2" />
                      Check for Analysis
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}

        {activeTab === 'tips' && (
          <div className="flex-1 overflow-y-auto p-6 max-h-[calc(100vh-200px)]">
            <div className="space-y-4">
              {tipsLoading ? (
                <div className="space-y-4">
                  {[...Array(3)].map((_, i) => (
                    <Card key={i} className="animate-pulse">
                      <CardHeader>
                        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                        <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="h-3 bg-gray-200 rounded"></div>
                          <div className="h-3 bg-gray-200 rounded w-5/6"></div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : tips?.tips?.length > 0 ? (
                tips.tips.map((tip: CoachTip) => (
                  <Card key={tip.id} className="hover:shadow-md transition-shadow">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            {getCategoryIcon(tip.category)}
                            <Badge variant="outline" className={getCategoryColor(tip.category)}>
                              {tip.category}
                            </Badge>
                            <div className="flex items-center gap-1">
                              <Star className="h-3 w-3 text-yellow-500 fill-current" />
                              <span className="text-xs text-gray-600">
                                {Math.round(tip.relevanceScore * 100)}% relevant
                              </span>
                            </div>
                          </div>
                          <CardTitle className="text-lg">{tip.title}</CardTitle>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-gray-700 leading-relaxed mb-4">{tip.content}</p>
                      
                      {tip.standards.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-medium text-gray-500 mb-2">RELEVANT STANDARDS:</p>
                          <div className="flex flex-wrap gap-1">
                            {tip.standards.map((standard, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">
                                {standard}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {tip.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {tip.tags.map((tag, i) => (
                            <Badge key={i} variant="outline" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {tip.actionable && (
                        <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                          <div className="flex items-center gap-2 text-blue-700">
                            <ArrowRight className="h-4 w-4" />
                            <span className="text-sm font-medium">Action Item</span>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card>
                  <CardContent className="text-center py-8">
                    <Lightbulb className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600">No tips available at the moment.</p>
                    <p className="text-sm text-gray-500">Tips will appear based on your project activity.</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}

        {activeTab === 'chat' && (
          <div className="h-full flex flex-col max-h-[calc(100vh-200px)]">
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-4">
                {messages.length === 0 && (
                  <Card className="bg-blue-50 border-blue-200">
                    <CardContent className="pt-6">
                      <div className="text-center">
                        <MessageCircle className="h-8 w-8 text-blue-500 mx-auto mb-2" />
                        <h3 className="font-medium text-blue-900 mb-2">Ask Your AI Construction Coach</h3>
                        <p className="text-sm text-blue-700 mb-4">
                          Get expert advice on construction practices, codes, safety, and project management.
                        </p>
                        <div className="grid grid-cols-1 gap-2 text-xs">
                          <button 
                            onClick={() => setChatMessage("What are the key safety considerations for concrete pouring?")}
                            className="text-left p-2 bg-white rounded border hover:bg-gray-50"
                          >
                            "What are the key safety considerations for concrete pouring?"
                          </button>
                          <button 
                            onClick={() => setChatMessage("How can I optimize costs for steel frame construction?")}
                            className="text-left p-2 bg-white rounded border hover:bg-gray-50"
                          >
                            "How can I optimize costs for steel frame construction?"
                          </button>
                          <button 
                            onClick={() => setChatMessage("What NBC requirements should I check for fire exits?")}
                            className="text-left p-2 bg-white rounded border hover:bg-gray-50"
                          >
                            "What NBC requirements should I check for fire exits?"
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex",
                      message.type === 'user' ? "justify-end" : "justify-start"
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[80%] p-3 rounded-lg",
                        message.type === 'user'
                          ? "bg-blue-500 text-white"
                          : "bg-gray-100 text-gray-900"
                      )}
                    >
                      <p className="text-sm leading-relaxed">{message.content}</p>
                      <p className="text-xs opacity-75 mt-1">
                        {message.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}

                {isTyping && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 p-3 rounded-lg">
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="p-4 border-t bg-white">
              <div className="flex gap-2">
                <Input
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  placeholder="Ask your construction coach anything..."
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  disabled={chatMutation.isPending}
                  className="flex-1"
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={!chatMessage.trim() || chatMutation.isPending}
                  size="icon"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'daily' && (
          <div className="flex-1 overflow-y-auto p-6 max-h-[calc(100vh-200px)]">
            {dailyLoading ? (
              <Card className="animate-pulse">
                <CardHeader>
                  <div className="h-5 bg-gray-200 rounded w-1/2"></div>
                  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="h-4 bg-gray-200 rounded"></div>
                    <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                    <div className="h-4 bg-gray-200 rounded w-4/5"></div>
                  </div>
                </CardContent>
              </Card>
            ) : dailyTip ? (
              <Card className="bg-gradient-to-br from-purple-50 to-blue-50 border-purple-200">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-100 rounded-lg">
                      <Calendar className="h-5 w-5 text-purple-600" />
                    </div>
                    <div>
                      <CardTitle className="text-purple-900">{dailyTip.title}</CardTitle>
                      <CardDescription className="text-purple-700">
                        {new Date().toLocaleDateString('en-US', { 
                          weekday: 'long', 
                          year: 'numeric', 
                          month: 'long', 
                          day: 'numeric' 
                        })}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-purple-800 leading-relaxed text-lg">{dailyTip.content}</p>
                  
                  <div className="mt-6 p-4 bg-white/70 rounded-lg">
                    <div className="flex items-center gap-2 text-purple-700 mb-2">
                      <Sparkles className="h-4 w-4" />
                      <span className="font-medium">Today's Focus</span>
                    </div>
                    <p className="text-sm text-purple-600">
                      Take this insight with you as you work on your projects today.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="text-center py-8">
                  <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">No daily tip available.</p>
                  <p className="text-sm text-gray-500">Check back tomorrow for fresh insights.</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}