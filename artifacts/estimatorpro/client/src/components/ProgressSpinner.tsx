import React from 'react';
import { useProgressTracking } from '../hooks/useProgressTracking';

interface ProgressSpinnerProps {
  modelId: string | null;
  size?: 'small' | 'medium' | 'large';
  showPercentage?: boolean;
  showMessage?: boolean;
}

export function ProgressSpinner({ 
  modelId, 
  size = 'medium', 
  showPercentage = true, 
  showMessage = true 
}: ProgressSpinnerProps) {
  const { 
    progress,
    message,
    isComplete, 
    hasError, 
    errorMessage,
    isStuck 
  } = useProgressTracking(modelId);
  
  const sizeConfig = {
    small: { diameter: 24, strokeWidth: 3 },
    medium: { diameter: 48, strokeWidth: 4 },
    large: { diameter: 72, strokeWidth: 6 }
  };
  
  const config = sizeConfig[size];
  const radius = (config.diameter - config.strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference - (progress / 100) * circumference;
  
  const getColor = () => {
    if (hasError) return '#ef4444';
    if (isComplete) return '#10b981';
    if (isStuck) return '#f59e0b';
    return '#3b82f6';
  };
  
  return (
    <div className="flex flex-col items-center space-y-2">
      <div className="relative" style={{ width: config.diameter, height: config.diameter }}>
        <svg width={config.diameter} height={config.diameter} className="transform -rotate-90">
          <circle
            cx={config.diameter / 2}
            cy={config.diameter / 2}
            r={radius}
            stroke="#e5e7eb"
            strokeWidth={config.strokeWidth}
            fill="transparent"
          />
          <circle
            cx={config.diameter / 2}
            cy={config.diameter / 2}
            r={radius}
            stroke={getColor()}
            strokeWidth={config.strokeWidth}
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeOffset}
            strokeLinecap="round"
            className={`transition-all duration-500 ${isStuck ? 'animate-spin' : ''}`}
          />
        </svg>
        
        {showPercentage && !isStuck && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-semibold text-sm">
              {hasError ? '!' : isComplete ? '✓' : `${Math.round(progress)}%`}
            </span>
          </div>
        )}
        
        {isStuck && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-orange-500">⟳</span>
          </div>
        )}
      </div>
      
      {showMessage && (
        <div className="text-center max-w-xs">
          <p className="text-sm text-gray-600">
            {hasError ? errorMessage || 'An error occurred' :
             isStuck ? 'Processing may be stuck...' :
             message}
          </p>
          {isStuck && (
            <p className="text-xs text-orange-500 mt-1">
              No progress in 2+ minutes
            </p>
          )}
        </div>
      )}
    </div>
  );
}