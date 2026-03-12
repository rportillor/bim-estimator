// server/helpers/error-handler.ts
// Standardized error handling across EstimatorPro

export type ErrorContext = {
  operation: string;
  userId?: string;
  projectId?: string;
  modelId?: string;
  details?: any;
};

export class EstimatorError extends Error {
  public readonly context: ErrorContext;
  public readonly timestamp: Date;
  
  constructor(message: string, context: ErrorContext, cause?: Error) {
    super(message);
    this.name = 'EstimatorError';
    this.context = context;
    this.timestamp = new Date();
    this.cause = cause;
  }
}

export function logError(error: Error | EstimatorError, context?: Partial<ErrorContext>) {
  const prefix = context?.operation ? `[${context.operation}]` : '[ERROR]';
  const timestamp = new Date().toISOString();
  
  if (error instanceof EstimatorError) {
    console.error(`${prefix} ${timestamp} - ${error.message}`, {
      context: error.context,
      stack: error.stack?.split('\n').slice(0, 3)
    });
  } else {
    console.error(`${prefix} ${timestamp} - ${error.message}`, {
      context: context || {},
      stack: error.stack?.split('\n').slice(0, 3)
    });
  }
}

export function handleApiError(error: any, operation: string, additionalContext?: any) {
  const context: ErrorContext = {
    operation,
    ...additionalContext
  };
  
  if (error instanceof EstimatorError) {
    logError(error);
    return error;
  }
  
  const estimatorError = new EstimatorError(
    error.message || 'Unknown error occurred',
    context,
    error
  );
  
  logError(estimatorError);
  return estimatorError;
}