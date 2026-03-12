import { useState, useEffect, useCallback, useRef } from 'react';

interface ProgressState {
  progress: number;
  message: string;
  phase: string;
  isComplete: boolean;
  hasError: boolean;
  errorMessage?: string;
  isStuck?: boolean;
}

export function useProgressTracking(modelId: string | null) {
  const [progressState, setProgressState] = useState<ProgressState>({
    progress: 0,
    message: 'Initializing...',
    phase: 'waiting',
    isComplete: false,
    hasError: false
  });
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const fallbackTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastProgressRef = useRef<number>(0);
  const lastUpdateRef = useRef<number>(Date.now());
  
  const updateProgress = useCallback((newData: Partial<ProgressState>) => {
    setProgressState(prev => {
      const now = Date.now();
      const timeSinceLastUpdate = now - lastUpdateRef.current;
      const progressChanged = newData.progress !== lastProgressRef.current;
      
      if (progressChanged) {
        lastProgressRef.current = newData.progress || prev.progress;
        lastUpdateRef.current = now;
      }
      
      // Detect stuck progress (same percentage for >2 minutes)
      const isStuck = !progressChanged && timeSinceLastUpdate > 2 * 60 * 1000 && 
                     prev.progress > 0 && prev.progress < 100;
      
      const updatedState = {
        ...prev,
        ...newData,
        isStuck
      };
      
      if (updatedState.progress >= 100) {
        updatedState.isComplete = true;
        updatedState.message = 'Completed successfully';
        updatedState.phase = 'completed';
      }
      
      return updatedState;
    });
  }, []);
  
  useEffect(() => {
    if (!modelId) return;
    
    console.log(`🔄 Starting progress tracking for: ${modelId}`);
    
    // Try SSE first
    try {
      const eventSource = new EventSource(`/api/progress/${modelId}/stream`);
      eventSourceRef.current = eventSource;
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          updateProgress(data);
        } catch (error) {
          console.warn('Failed to parse progress data:', error);
        }
      };
      
      eventSource.onerror = () => {
        console.warn('SSE failed, switching to polling');
        eventSource.close();
        startPolling();
      };
      
    } catch (error) {
      console.warn('SSE not supported, using polling');
      startPolling();
    }
    
    function startPolling() {
      const poll = async () => {
        try {
          const token = localStorage.getItem('auth_token');
          const response = await fetch(`/api/progress/${modelId}`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            credentials: 'include'
          });
          const data = await response.json();
          updateProgress(data);
        } catch (error) {
          console.error('Polling failed:', error);
        }
      };
      
      poll();
      fallbackTimerRef.current = setInterval(poll, 3000);
    }
    
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (fallbackTimerRef.current) {
        clearInterval(fallbackTimerRef.current);
      }
    };
  }, [modelId, updateProgress]);
  
  return progressState;
}