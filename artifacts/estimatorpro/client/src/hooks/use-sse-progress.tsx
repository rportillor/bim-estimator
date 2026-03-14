import { useState, useEffect, useRef } from 'react';

interface ProgressData {
  ts: number;
  status: string;
  progress: number;
  message?: string;
  error?: string;
  documentsProcessed?: number;
  totalDocuments?: number;
  // Backend data format fields
  pct?: number;
  phase?: string;
}

export function useSSEProgress(modelId: string | null, enabled: boolean = true) {
  const [data, setData] = useState<ProgressData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!modelId || !enabled) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setIsConnected(false);
      return;
    }

    const url = `/api/bim/models/${modelId}/progress/stream`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const rawData = JSON.parse(event.data);
        
        // 🔧 FIX: Handle backend data format { pct, phase, message }
        const progressData: ProgressData = {
          ts: Date.now(),
          status: rawData.phase === "error" ? "failed" : 
                  rawData.phase === "complete" ? "completed" : "generating",
          progress: rawData.pct ? rawData.pct / 100 : (rawData.progress || 0),
          message: rawData.message || `${rawData.phase || 'Processing'}...`,
          error: rawData.phase === "error" ? rawData.message : undefined,
          documentsProcessed: rawData.documentsProcessed,
          totalDocuments: rawData.totalDocuments,
        };
        
        console.log(`📊 SSE Progress: ${Math.round(progressData.progress * 100)}% - ${progressData.message}`);
        setData(progressData);
      } catch {
        console.warn('Failed to parse SSE message:', event.data);
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
    };

    return () => {
      eventSource.close();
      setIsConnected(false);
    };
  }, [modelId, enabled]);

  return { data, isConnected };
}