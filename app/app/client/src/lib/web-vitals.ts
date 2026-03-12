import { onCLS, onFCP, onLCP, onINP, onTTFB } from 'web-vitals';

// Web Vitals collection for production monitoring
interface VitalsMetric {
  name: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  delta: number;
  id: string;
  attribution?: Record<string, unknown>;
}

function sendToAnalytics(metric: VitalsMetric) {
  // Only send metrics in production
  if (import.meta.env.PROD) {
    // Send to your analytics endpoint
    navigator.sendBeacon?.('/api/analytics/vitals', JSON.stringify({
      metric: metric.name,
      value: metric.value,
      rating: metric.rating,
      url: window.location.href,
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
      attribution: metric.attribution
    }));
    
    // Also log to console in development for debugging
    console.log('Web Vital:', metric);
  }
}

export function initWebVitals() {
  // Core Web Vitals
  onCLS(sendToAnalytics);
  onFCP(sendToAnalytics);
  onLCP(sendToAnalytics);
  onINP(sendToAnalytics);
  onTTFB(sendToAnalytics);
}

// BIM Viewer specific performance tracking
export function trackBIMPerformance(stats: {
  loadTime: number;
  modelSize: number;
  triangleCount: number;
  fps: number;
  memoryUsage?: number;
}) {
  if (import.meta.env.PROD) {
    navigator.sendBeacon?.('/api/analytics/bim-performance', JSON.stringify({
      ...stats,
      url: window.location.href,
      timestamp: Date.now()
    }));
  }
  
  console.log('BIM Performance:', stats);
}