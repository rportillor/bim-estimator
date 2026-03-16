import { useState, useEffect, useRef, useCallback } from 'react';

interface ProgressData {
  ts: number;
  status: string;
  progress: number;
  message?: string;
  error?: string;
  documentsProcessed?: number;
  totalDocuments?: number;
  pct?: number;
  phase?: string;
  details?: {
    productsFound?: number;
    currentChunk?: number;
    totalChunks?: number;
    currentBatch?: number;
    totalBatches?: number;
    assembliesCreated?: number;
    elementsBuilt?: number;
  };
}

const MIN_RETRY_MS = 1_500;
const MAX_RETRY_MS = 15_000;

export function useSSEProgress(modelId: string | null, enabled: boolean = true) {
  const [data, setData] = useState<ProgressData | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const esRef      = useRef<EventSource | null>(null);
  const retryRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(MIN_RETRY_MS);
  const mountedRef = useRef(true);

  const clearRetry = () => {
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
  };

  const connect = useCallback(() => {
    if (!modelId || !enabled || !mountedRef.current) return;

    esRef.current?.close();
    const url = `/api/bim/models/${modelId}/progress/stream`;
    const es  = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      if (!mountedRef.current) return;
      setIsConnected(true);
      retryDelay.current = MIN_RETRY_MS;
    };

    es.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const raw = JSON.parse(event.data);
        const pd: ProgressData = {
          ts:       Date.now(),
          status:   raw.phase === 'error'    ? 'failed'     :
                    raw.phase === 'complete' ? 'completed'  : 'generating',
          progress: raw.pct != null ? raw.pct / 100 : (raw.progress ?? 0),
          message:  raw.message || `${raw.phase || 'Processing'}...`,
          error:    raw.phase === 'error' ? raw.message : undefined,
          documentsProcessed: raw.documentsProcessed,
          totalDocuments:     raw.totalDocuments,
          details:  raw.details,
        };
        console.log(`📊 SSE Progress: ${Math.round(pd.progress * 100)}% - ${pd.message}`);
        setData(pd);
      } catch {
        console.warn('Failed to parse SSE message:', event.data);
      }
    };

    es.onerror = () => {
      if (!mountedRef.current) return;
      setIsConnected(false);
      es.close();
      esRef.current = null;

      if (!enabled) return;

      clearRetry();
      const delay = retryDelay.current;
      retryDelay.current = Math.min(delay * 2, MAX_RETRY_MS);
      console.debug(`[SSE] Connection lost — retrying in ${delay}ms`);
      retryRef.current = setTimeout(() => {
        if (mountedRef.current && enabled) connect();
      }, delay);
    };
  }, [modelId, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    retryDelay.current = MIN_RETRY_MS;

    if (modelId && enabled) {
      connect();
    } else {
      clearRetry();
      esRef.current?.close();
      esRef.current = null;
      setIsConnected(false);
    }

    return () => {
      mountedRef.current = false;
      clearRetry();
      esRef.current?.close();
      esRef.current = null;
      setIsConnected(false);
    };
  }, [modelId, enabled, connect]);

  return { data, isConnected };
}
