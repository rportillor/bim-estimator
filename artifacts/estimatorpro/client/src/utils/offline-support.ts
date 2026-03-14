/**
 * 📱 OFFLINE SUPPORT SYSTEM
 * Enable basic functionality when internet connection is unavailable
 */

import { useState, useEffect } from 'react';

interface CachedDocument {
  id: string;
  name: string;
  projectId: string;
  type: string;
  size: number;
  content?: string; // Base64 encoded content for small files
  lastViewed: Date;
  cached: boolean;
}

interface OfflineData {
  documents: CachedDocument[];
  projectInfo: any;
  lastSync: Date;
  isOnline: boolean;
}

class OfflineManager {
  private storageKey = 'estimatorpro_offline_data';
  private maxCacheSize = 50 * 1024 * 1024; // 50MB limit
  private isOnline = navigator.onLine;

  constructor() {
    this.setupOnlineDetection();
  }

  private setupOnlineDetection() {
    // Listen for online/offline events
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.handleOnlineStatusChange(true);
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.handleOnlineStatusChange(false);
    });

    // Periodic connectivity check
    setInterval(() => {
      this.checkConnectivity();
    }, 30000); // Check every 30 seconds
  }

  private async checkConnectivity() {
    try {
      const response = await fetch('/api/health', {
        method: 'HEAD',
        cache: 'no-cache'
      }).catch(err => {
        console.error('Health check failed:', err);
        throw err;
      });
      
      const wasOnline = this.isOnline;
      this.isOnline = response.ok;
      
      if (wasOnline !== this.isOnline) {
        this.handleOnlineStatusChange(this.isOnline);
      }
    } catch (error) {
      console.error('Connectivity check failed:', error);
      const wasOnline = this.isOnline;
      this.isOnline = false;
      
      if (wasOnline !== this.isOnline) {
        this.handleOnlineStatusChange(false);
      }
    }
  }

  private handleOnlineStatusChange(isOnline: boolean) {
    // Dispatch custom event for components to listen to
    window.dispatchEvent(new CustomEvent('connectivity-change', {
      detail: { isOnline }
    }));

    if (isOnline) {
      console.log('🌐 Connection restored - syncing data...');
      this.syncWhenOnline();
    } else {
      console.log('📱 Offline mode activated - using cached data...');
    }
  }

  public async cacheDocument(document: CachedDocument, content?: string): Promise<void> {
    try {
      const offlineData = this.getOfflineData();
      
      // Remove existing entry if it exists
      offlineData.documents = offlineData.documents.filter(d => d.id !== document.id);
      
      // Add new cached document
      const cachedDoc: CachedDocument = {
        ...document,
        content,
        lastViewed: new Date(),
        cached: true
      };
      
      offlineData.documents.unshift(cachedDoc);
      
      // Enforce cache size limit
      await this.enforceStorageLimit(offlineData);
      
      this.saveOfflineData(offlineData);
      
      console.log(`📄 Document cached: ${document.name}`);
    } catch (error) {
      console.warn('Failed to cache document:', error);
    }
  }

  public getCachedDocument(documentId: string): CachedDocument | null {
    const offlineData = this.getOfflineData();
    const document = offlineData.documents.find(d => d.id === documentId);
    
    if (document) {
      // Update last viewed time
      document.lastViewed = new Date();
      this.saveOfflineData(offlineData);
    }
    
    return document || null;
  }

  public getCachedDocuments(projectId?: string): CachedDocument[] {
    const offlineData = this.getOfflineData();
    
    if (projectId) {
      return offlineData.documents.filter(d => d.projectId === projectId);
    }
    
    return offlineData.documents;
  }

  public async downloadForOffline(projectId: string, documentId: string): Promise<boolean> {
    if (!this.isOnline) {
      console.warn('Cannot download for offline - no internet connection');
      return false;
    }

    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const response = await fetch(`/api/projects/${projectId}/documents/${documentId}/view`, {
        headers, credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Get document metadata
      const metaHeaders: Record<string, string> = {};
      const metaToken = localStorage.getItem('auth_token');
      if (metaToken) metaHeaders['Authorization'] = `Bearer ${metaToken}`;
      const metaResponse = await fetch(`/api/projects/${projectId}/documents/${documentId}`, {
        headers: metaHeaders, credentials: 'include'
      });
      const metadata = await metaResponse.json();

      // For small files, cache the content
      let content: string | undefined;
      const fileSize = parseInt(response.headers.get('content-length') || '0');
      
      if (fileSize < 5 * 1024 * 1024) { // 5MB limit for content caching
        const blob = await response.blob();
        content = await this.blobToBase64(blob);
      }

      const document: CachedDocument = {
        id: documentId,
        name: metadata.name || 'Unknown Document',
        projectId,
        type: metadata.type || 'unknown',
        size: fileSize,
        content,
        lastViewed: new Date(),
        cached: true
      };

      await this.cacheDocument(document, content);
      return true;

    } catch (error) {
      console.error('Failed to download document for offline:', error);
      return false;
    }
  }

  public getOfflineCapabilities(): {
    isOnline: boolean;
    cachedDocuments: number;
    totalCacheSize: number;
    maxCacheSize: number;
    canViewOffline: boolean;
  } {
    const offlineData = this.getOfflineData();
    const totalSize = this.calculateTotalCacheSize(offlineData);
    
    return {
      isOnline: this.isOnline,
      cachedDocuments: offlineData.documents.length,
      totalCacheSize: totalSize,
      maxCacheSize: this.maxCacheSize,
      canViewOffline: offlineData.documents.length > 0
    };
  }

  public async clearOfflineCache(): Promise<void> {
    const emptyData: OfflineData = {
      documents: [],
      projectInfo: null,
      lastSync: new Date(),
      isOnline: this.isOnline
    };
    
    this.saveOfflineData(emptyData);
    console.log('🗑️ Offline cache cleared');
  }

  public async syncWhenOnline(): Promise<void> {
    if (!this.isOnline) return;

    try {
      // Sync project data
      const syncToken = localStorage.getItem('auth_token');
      const syncHeaders: Record<string, string> = {};
      if (syncToken) syncHeaders['Authorization'] = `Bearer ${syncToken}`;
      const response = await fetch('/api/projects', {
        headers: syncHeaders, credentials: 'include'
      });
      if (response && response.ok) {
        const projects = await response.json();
        const offlineData = this.getOfflineData();
        offlineData.projectInfo = projects;
        offlineData.lastSync = new Date();
        this.saveOfflineData(offlineData);
        
        console.log('📊 Project data synced');
      }
    } catch (error) {
      console.warn('Sync failed:', error);
    }
  }

  private getOfflineData(): OfflineData {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const data = JSON.parse(stored);
        // Convert date strings back to Date objects
        data.lastSync = new Date(data.lastSync);
        data.documents = data.documents.map((doc: any) => ({
          ...doc,
          lastViewed: new Date(doc.lastViewed)
        }));
        return data;
      }
    } catch (error) {
      console.warn('Failed to load offline data:', error);
    }

    return {
      documents: [],
      projectInfo: null,
      lastSync: new Date(),
      isOnline: this.isOnline
    };
  }

  private saveOfflineData(data: OfflineData): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save offline data:', error);
      // Storage might be full - try clearing old data
      this.clearOldCache();
    }
  }

  private async enforceStorageLimit(offlineData: OfflineData): Promise<void> {
    const totalSize = this.calculateTotalCacheSize(offlineData);
    
    if (totalSize > this.maxCacheSize) {
      // Sort by last viewed, remove oldest first
      offlineData.documents.sort((a, b) => 
        a.lastViewed.getTime() - b.lastViewed.getTime()
      );
      
      while (this.calculateTotalCacheSize(offlineData) > this.maxCacheSize && 
             offlineData.documents.length > 0) {
        offlineData.documents.shift(); // Remove oldest
      }
      
      console.log('🧹 Cache cleaned - removed old documents');
    }
  }

  private calculateTotalCacheSize(offlineData: OfflineData): number {
    return offlineData.documents.reduce((total, doc) => {
      if (doc.content) {
        // Base64 content size (roughly 33% larger than original)
        return total + (doc.content.length * 0.75);
      }
      return total + (doc.size || 0);
    }, 0);
  }

  private clearOldCache(): void {
    const offlineData = this.getOfflineData();
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    offlineData.documents = offlineData.documents.filter(doc => 
      doc.lastViewed > oneWeekAgo
    );
    
    this.saveOfflineData(offlineData);
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]); // Remove data URL prefix
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

// Create global offline manager
export const offlineManager = new OfflineManager();

// React hook for offline capabilities
export const useOfflineSupport = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [capabilities, setCapabilities] = useState(offlineManager.getOfflineCapabilities());

  useEffect(() => {
    const handleConnectivityChange = (event: any) => {
      setIsOnline(event.detail.isOnline);
      setCapabilities(offlineManager.getOfflineCapabilities());
    };

    window.addEventListener('connectivity-change', handleConnectivityChange);
    
    // Update capabilities periodically
    const interval = setInterval(() => {
      setCapabilities(offlineManager.getOfflineCapabilities());
    }, 10000);

    return () => {
      window.removeEventListener('connectivity-change', handleConnectivityChange);
      clearInterval(interval);
    };
  }, []);

  return {
    isOnline,
    capabilities,
    cacheDocument: offlineManager.cacheDocument.bind(offlineManager),
    getCachedDocument: offlineManager.getCachedDocument.bind(offlineManager),
    getCachedDocuments: offlineManager.getCachedDocuments.bind(offlineManager),
    downloadForOffline: offlineManager.downloadForOffline.bind(offlineManager),
    clearOfflineCache: offlineManager.clearOfflineCache.bind(offlineManager),
    syncWhenOnline: offlineManager.syncWhenOnline.bind(offlineManager)
  };
};