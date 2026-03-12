/**
 * 🔍 LIVE ERROR DETECTION & DEBUGGING
 * Check what's actually happening with document viewing in real-time
 */

import { errorMonitor } from './error-monitoring';

export const runLiveErrorCheck = () => {
  console.log('🔍 RUNNING LIVE ERROR CHECK...');
  
  // Check current error state
  const errorStats = errorMonitor.getErrorStats();
  console.log('📊 Current Error Stats:', errorStats);
  
  const recentErrors = errorMonitor.getRecentErrors(10);
  console.log('🚨 Recent Errors:', recentErrors);
  
  const documentErrors = errorMonitor.getErrorsByComponent('DocumentViewer');
  console.log('📄 Document Viewer Errors:', documentErrors);
  
  const authErrors = errorMonitor.getErrorsByComponent('Authentication');
  console.log('🔐 Authentication Errors:', authErrors);
  
  // Test document viewing authentication
  const testDocumentAccess = () => {
    try {
      console.log('🧪 Testing document access...');
      
      // Check localStorage
      const token = localStorage.getItem('auth_token');
      console.log('🔑 Auth token from localStorage:', token ? 'EXISTS' : 'MISSING');
      
      // Check if we're in dev mode
      const isDevMode = import.meta.env.DEV;
      console.log('🔧 Development mode:', isDevMode);
      
      // Test URL construction (no token in URL — use Authorization header)
      // Derive IDs from actual page context instead of hardcoding test values
      const pathParts = window.location.pathname.split('/');
      const projectIdx = pathParts.indexOf('projects');
      const testProjectId = projectIdx >= 0 ? pathParts[projectIdx + 1] : undefined;
      const testDocumentId = pathParts.indexOf('documents') >= 0 ? pathParts[pathParts.indexOf('documents') + 1] : undefined;

      if (!testProjectId) {
        console.log('⚠️ No project context available in URL — skipping URL construction test');
        return { hasToken: !!token, isDevMode, noProjectContext: true };
      }

      const viewUrl = `/api/projects/${testProjectId}/documents/${testDocumentId || 'unknown'}/view`;
      console.log('🔗 Generated view URL:', viewUrl);
      
      // Test with actual project data
      const projectElement = document.querySelector('[data-testid="project-dashboard"]');
      if (projectElement) {
        console.log('✅ Project dashboard found - user is authenticated');
      } else {
        console.log('❌ Project dashboard not found - potential auth issue');
      }
      
      return {
        hasToken: !!token,
        isDevMode,
        generatedUrl: viewUrl,
        projectDashboardFound: !!projectElement
      };
      
    } catch (error) {
      console.error('❌ Error during document access test:', error);
      errorMonitor.logDocumentViewingError(error as Error, 'test-project', 'test-doc');
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };
  
  const accessTest = testDocumentAccess();
  console.log('🧪 Document Access Test Results:', accessTest);
  
  // Test actual document URL fetch with real document ID
  const testDocumentFetch = async () => {
    try {
      console.log('🌐 Testing document fetch...');
      
      const token = localStorage.getItem('auth_token');
      if (!token) {
        console.log('❌ No auth token — skipping document fetch test');
        return { success: false, error: 'No auth token available' };
      }
      // SECURITY FIX: Use placeholder IDs, not real UUIDs; use Authorization header
      const testUrl = `/api/projects/test-project/documents/test-doc/view`;

      console.log('📡 Attempting fetch to:', testUrl);

      const response = await fetch(testUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(err => {
        console.error('Fetch failed:', err);
        throw err;
      });
      console.log('📡 Response status:', response.status);
      console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log('❌ Error response body:', errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      console.log('✅ Document fetch successful');
      return { success: true, status: response.status };
      
    } catch (error) {
      console.error('❌ Document fetch failed:', error);
      errorMonitor.logDocumentViewingError(error as Error, 'test-project', 'test-doc');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  
  // Return promise for async testing
  return testDocumentFetch();
};

// Make it available globally for console testing
(window as any).runLiveErrorCheck = runLiveErrorCheck;

// Auto-run on import in development
if (import.meta.env.DEV) {
  console.log('🔍 Live Error Check available. Run window.runLiveErrorCheck() to test document viewing.');
}