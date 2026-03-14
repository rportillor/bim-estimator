/**
 * 🐛 DEBUG PANEL FOR DOCUMENT VIEWING ISSUES
 * Shows real-time debugging information
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Bug, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  RefreshCw,
  Eye,
} from 'lucide-react';
import { errorMonitor } from '@/utils/error-monitoring';
import { runLiveErrorCheck } from '@/utils/live-error-check';

export function DebugPanel() {
  const [errorStats, setErrorStats] = useState(errorMonitor.getErrorStats());
  const [recentErrors, setRecentErrors] = useState(errorMonitor.getRecentErrors(5));
  const [liveCheckResult, setLiveCheckResult] = useState<any>(null);
  const [isRunningCheck, setIsRunningCheck] = useState(false);

  const refreshData = () => {
    setErrorStats(errorMonitor.getErrorStats());
    setRecentErrors(errorMonitor.getRecentErrors(5));
  };

  const runCheck = async () => {
    setIsRunningCheck(true);
    try {
      const result = await runLiveErrorCheck();
      setLiveCheckResult(result);
    } catch (error) {
      setLiveCheckResult({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsRunningCheck(false);
      refreshData();
    }
  };

  const testDocumentView = async () => {
    try {
      // Extract project/document IDs from current URL context
      const pathParts = window.location.pathname.split('/');
      const projIdx = pathParts.indexOf('projects');
      const projectId = projIdx >= 0 ? pathParts[projIdx + 1] : null;
      if (!projectId) {
        console.warn('No project context available — open a project first');
        return;
      }
      const token = localStorage.getItem('auth_token');
      if (!token) {
        console.warn('No auth token available');
        return;
      }
      // Fetch the project's first document to test viewing
      const docsRes = await fetch(`/api/projects/${projectId}/documents`, {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include',
      });
      if (!docsRes.ok) throw new Error(`Failed to fetch documents: ${docsRes.status}`);
      const docs = await docsRes.json();
      if (!docs.length) {
        console.warn('No documents found in this project');
        return;
      }
      const testUrl = `/api/projects/${projectId}/documents/${docs[0].id}/view`;
      console.log('Testing document view URL:', testUrl);
      const resp = await fetch(testUrl, { headers: { 'Authorization': `Bearer ${token}` }, credentials: 'include' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (error) {
      console.error('Error testing document view:', error);
    }
  };

  useEffect(() => {
    const interval = setInterval(refreshData, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  // Show on mobile only if there are errors, or always in dev mode
  const shouldShow = import.meta.env.DEV || errorStats.total > 0 || recentErrors.length > 0;
  
  if (!shouldShow) {
    return null;
  }

  // Mobile-responsive positioning
  const isMobile = window.innerWidth < 768;
  
  return (
    <div className={`fixed z-50 ${isMobile ? 'bottom-2 left-2 right-2' : 'bottom-4 left-4 sm:max-w-sm md:max-w-md'}`} data-testid="debug-panel">
      <Card className="bg-gray-900 text-white border-gray-700 w-full sm:w-auto">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Bug className="h-4 w-4" />
            Debug Panel
          </CardTitle>
          <CardDescription className="text-gray-400 text-xs">
            Document viewing diagnostics
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-3">
          {/* Error Statistics */}
          <div>
            <h4 className="text-xs font-medium mb-1">Error Statistics</h4>
            <div className="flex gap-2 text-xs">
              <Badge variant="outline" className="text-red-400 border-red-400">
                {errorStats.total} Total
              </Badge>
              <Badge variant="outline" className="text-yellow-400 border-yellow-400">
                {errorStats.unresolved} Unresolved
              </Badge>
              <Badge variant="outline" className="text-red-600 border-red-600">
                {errorStats.critical} Critical
              </Badge>
            </div>
          </div>

          {/* Recent Errors */}
          {recentErrors.length > 0 && (
            <div>
              <h4 className="text-xs font-medium mb-1">Recent Errors</h4>
              <div className="space-y-1 max-h-20 overflow-y-auto">
                {recentErrors.map(error => (
                  <div key={error.id} className="text-xs bg-gray-800 p-1 rounded">
                    <div className="flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-yellow-400" />
                      <span className="truncate">{error.message}</span>
                    </div>
                    <div className="text-gray-500 text-xs">
                      {error.context.component} • {error.occurrenceCount}x
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live Check Result */}
          {liveCheckResult && (
            <div>
              <h4 className="text-xs font-medium mb-1">Last Check Result</h4>
              <Alert className="p-2">
                <div className="flex items-center gap-2">
                  {liveCheckResult.success ? (
                    <CheckCircle className="h-3 w-3 text-green-400" />
                  ) : (
                    <XCircle className="h-3 w-3 text-red-400" />
                  )}
                  <AlertDescription className="text-xs">
                    {liveCheckResult.success 
                      ? `Document fetch successful (${liveCheckResult.status})`
                      : `Failed: ${liveCheckResult.error}`
                    }
                  </AlertDescription>
                </div>
              </Alert>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => runCheck()}
              onTouchStart={(e) => { e.preventDefault(); runCheck(); }}
              disabled={isRunningCheck}
              className="text-xs bg-gray-800 border-gray-600 hover:bg-gray-700 text-white font-medium"
            >
              {isRunningCheck ? (
                <RefreshCw className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-3 w-3 mr-1" />
              )}
              🧪 Check
            </Button>
            
            <Button 
              size="sm" 
              variant="outline" 
              onClick={testDocumentView}
              onTouchEnd={testDocumentView}
              className="text-xs bg-gray-800 border-gray-600 hover:bg-gray-700 text-white font-medium"
            >
              <Eye className="h-3 w-3 mr-1" />
              👁️ Test View
            </Button>
          </div>

          {/* Current Auth Status */}
          <div className="text-xs">
            <h4 className="font-medium mb-1">Auth Status</h4>
            <div className="flex items-center gap-2">
              {localStorage.getItem('auth_token') ? (
                <>
                  <CheckCircle className="h-3 w-3 text-green-400" />
                  <span>Token Available</span>
                </>
              ) : (
                <>
                  <XCircle className="h-3 w-3 text-red-400" />
                  <span>No Token</span>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}