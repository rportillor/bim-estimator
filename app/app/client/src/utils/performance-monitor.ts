/**
 * ⚡ PERFORMANCE MONITORING SYSTEM
 * Track page loads, API calls, file uploads, and user interactions
 */

interface PerformanceMetric {
  id: string;
  name: string;
  value: number;
  unit: 'ms' | 'bytes' | 'count' | 'percent';
  timestamp: Date;
  category: 'page-load' | 'api' | 'file-upload' | 'user-interaction' | 'rendering';
  metadata?: Record<string, any>;
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private maxMetrics = 2000;
  private observerEnabled = true;

  constructor() {
    this.setupPerformanceObserver();
    this.setupNavigationTiming();
  }

  private setupPerformanceObserver() {
    if (typeof window !== 'undefined' && 'PerformanceObserver' in window && this.observerEnabled) {
      // Monitor navigation timing
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.processPerformanceEntry(entry);
        }
      });

      observer.observe({ entryTypes: ['navigation', 'measure', 'mark'] });
    }
  }

  private setupNavigationTiming() {
    if (typeof window !== 'undefined') {
      window.addEventListener('load', () => {
        // Record page load metrics
        setTimeout(() => {
          this.recordPageLoadMetrics();
        }, 100);
      });
    }
  }

  private processPerformanceEntry(entry: PerformanceEntry) {
    if (entry.entryType === 'navigation') {
      const navEntry = entry as PerformanceNavigationTiming;
      
      this.recordMetric({
        name: 'Page Load Time',
        value: navEntry.loadEventEnd - navEntry.fetchStart,
        unit: 'ms',
        category: 'page-load',
        metadata: {
          type: 'full-page-load',
          url: typeof window !== 'undefined' ? window.location.href : ''
        }
      });

      this.recordMetric({
        name: 'DOM Content Loaded',
        value: navEntry.domContentLoadedEventEnd - navEntry.fetchStart,
        unit: 'ms',
        category: 'page-load',
        metadata: {
          type: 'dom-ready',
          url: typeof window !== 'undefined' ? window.location.href : ''
        }
      });
    }
  }

  private recordPageLoadMetrics() {
    if (typeof performance === 'undefined') return;
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    
    if (navigation) {
      // Time to First Byte (TTFB)
      this.recordMetric({
        name: 'Time to First Byte',
        value: navigation.responseStart - navigation.requestStart,
        unit: 'ms',
        category: 'page-load',
        metadata: { type: 'ttfb' }
      });

      // DNS Lookup Time
      this.recordMetric({
        name: 'DNS Lookup Time',
        value: navigation.domainLookupEnd - navigation.domainLookupStart,
        unit: 'ms',
        category: 'page-load',
        metadata: { type: 'dns' }
      });

      // Connection Time
      this.recordMetric({
        name: 'Connection Time',
        value: navigation.connectEnd - navigation.connectStart,
        unit: 'ms',
        category: 'page-load',
        metadata: { type: 'connection' }
      });
    }
  }

  public recordMetric(metric: Omit<PerformanceMetric, 'id' | 'timestamp'>) {
    const fullMetric: PerformanceMetric = {
      ...metric,
      id: this.generateMetricId(),
      timestamp: new Date()
    };

    this.metrics.unshift(fullMetric);
    
    // Keep only recent metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(0, this.maxMetrics);
    }

    // Log slow operations in development
    if (import.meta.env.DEV && this.isSlowOperation(fullMetric)) {
      console.warn('⚡ Slow operation detected:', fullMetric);
    }
  }

  public startTimer(name: string): () => number {
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    
    return () => {
      const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const duration = endTime - startTime;
      
      this.recordMetric({
        name,
        value: duration,
        unit: 'ms',
        category: 'user-interaction'
      });
      
      return duration;
    };
  }

  public measureAPICall(url: string, method: string = 'GET') {
    const timer = this.startTimer(`API ${method} ${url}`);
    
    return {
      finish: (status: number, responseSize?: number) => {
        const duration = timer();
        
        this.recordMetric({
          name: 'API Response Time',
          value: duration,
          unit: 'ms',
          category: 'api',
          metadata: {
            url,
            method,
            status,
            responseSize
          }
        });
        
        if (responseSize) {
          this.recordMetric({
            name: 'API Response Size',
            value: responseSize,
            unit: 'bytes',
            category: 'api',
            metadata: { url, method }
          });
        }
      }
    };
  }

  public measureFileUpload(fileName: string, fileSize: number) {
    const timer = this.startTimer(`File Upload ${fileName}`);
    
    return {
      progress: (loaded: number) => {
        const percentage = (loaded / fileSize) * 100;
        this.recordMetric({
          name: 'Upload Progress',
          value: percentage,
          unit: 'percent',
          category: 'file-upload',
          metadata: { fileName, loaded, total: fileSize }
        });
      },
      
      finish: (success: boolean) => {
        const duration = timer();
        
        this.recordMetric({
          name: success ? 'File Upload Success' : 'File Upload Failed',
          value: duration,
          unit: 'ms',
          category: 'file-upload',
          metadata: {
            fileName,
            fileSize,
            success,
            throughput: success ? fileSize / (duration / 1000) : 0 // bytes per second
          }
        });
      }
    };
  }

  public measureDocumentProcessing(documentId: string, operation: string) {
    const timer = this.startTimer(`Document ${operation}`);
    
    return {
      finish: (elementsFound?: number, success: boolean = true) => {
        const duration = timer();
        
        this.recordMetric({
          name: `Document ${operation}`,
          value: duration,
          unit: 'ms',
          category: 'rendering',
          metadata: {
            documentId,
            operation,
            elementsFound,
            success
          }
        });
      }
    };
  }

  public measureBIMRender(modelId: string, elementCount: number) {
    const timer = this.startTimer(`BIM Render ${modelId}`);
    
    return {
      finish: () => {
        const duration = timer();
        
        this.recordMetric({
          name: 'BIM Model Render',
          value: duration,
          unit: 'ms',
          category: 'rendering',
          metadata: {
            modelId,
            elementCount,
            elementsPerSecond: elementCount / (duration / 1000)
          }
        });
      }
    };
  }

  public getMetrics(category?: string, limit: number = 100): PerformanceMetric[] {
    let filtered = this.metrics;
    
    if (category) {
      filtered = this.metrics.filter(m => m.category === category);
    }
    
    return filtered.slice(0, limit);
  }

  public getAverageMetric(name: string, timeWindowMs: number = 300000): number | null {
    const cutoff = new Date(Date.now() - timeWindowMs);
    const relevantMetrics = this.metrics.filter(m => 
      m.name === name && m.timestamp > cutoff
    );
    
    if (relevantMetrics.length === 0) return null;
    
    const sum = relevantMetrics.reduce((total, metric) => total + metric.value, 0);
    return sum / relevantMetrics.length;
  }

  public getPerformanceReport() {
    const categories = ['page-load', 'api', 'file-upload', 'user-interaction', 'rendering'] as const;
    
    const report = categories.reduce((acc, category) => {
      const categoryMetrics = this.metrics.filter(m => m.category === category);
      
      if (categoryMetrics.length > 0) {
        const values = categoryMetrics.map(m => m.value);
        const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
        const max = Math.max(...values);
        const min = Math.min(...values);
        
        acc[category] = {
          count: categoryMetrics.length,
          average: Math.round(avg * 100) / 100,
          max,
          min,
          unit: categoryMetrics[0].unit
        };
      }
      
      return acc;
    }, {} as Record<string, any>);
    
    return report;
  }

  public getSlowOperations(thresholdMs: number = 1000): PerformanceMetric[] {
    return this.metrics.filter(m => 
      m.unit === 'ms' && m.value > thresholdMs
    );
  }

  private isSlowOperation(metric: PerformanceMetric): boolean {
    const thresholds = {
      'page-load': 3000,
      'api': 2000,
      'file-upload': 10000,
      'user-interaction': 100,
      'rendering': 1000
    };
    
    return metric.unit === 'ms' && metric.value > thresholds[metric.category];
  }

  private generateMetricId(): string {
    return `metric_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Create global performance monitor
export const performanceMonitor = new PerformanceMonitor();

// React hook for performance monitoring
export const usePerformanceMonitor = () => {
  return {
    startTimer: performanceMonitor.startTimer.bind(performanceMonitor),
    measureAPICall: performanceMonitor.measureAPICall.bind(performanceMonitor),
    measureFileUpload: performanceMonitor.measureFileUpload.bind(performanceMonitor),
    measureDocumentProcessing: performanceMonitor.measureDocumentProcessing.bind(performanceMonitor),
    measureBIMRender: performanceMonitor.measureBIMRender.bind(performanceMonitor),
    getMetrics: performanceMonitor.getMetrics.bind(performanceMonitor),
    getPerformanceReport: performanceMonitor.getPerformanceReport.bind(performanceMonitor),
    getSlowOperations: performanceMonitor.getSlowOperations.bind(performanceMonitor)
  };
};