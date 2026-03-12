// server/helpers/enhanced-error-handler.ts  
// ✅ SYSTEM FIX: Transparent error messages for better UX

export interface DetailedError {
  code: string;
  message: string;
  userMessage: string;
  technicalDetails?: any;
  suggestions?: string[];
  timestamp: number;
}

export class EnhancedErrorHandler {
  
  static createDetailedError(error: any, context: string): DetailedError {
    const timestamp = Date.now();
    
    // Common error patterns with user-friendly messages
    if (error.message?.includes('foreign key constraint')) {
      return {
        code: 'DB_CONSTRAINT_VIOLATION',
        message: error.message,
        userMessage: 'Unable to delete this item because it\'s still being used by other components. Please remove dependent items first.',
        technicalDetails: { constraint: error.constraint, context },
        suggestions: [
          'Delete related BIM elements before removing the model',
          'Check for active references in other parts of the project'
        ],
        timestamp
      };
    }
    
    if (error.message?.includes('unauthorized') || error.status === 401) {
      return {
        code: 'AUTH_FAILED',
        message: error.message,
        userMessage: 'Your session has expired. Please log in again to continue.',
        suggestions: ['Click the login button to sign in again'],
        timestamp
      };
    }
    
    if (error.message?.includes('rate limit') || error.status === 429) {
      return {
        code: 'RATE_LIMITED',
        message: error.message, 
        userMessage: 'Too many requests. Please wait a moment before trying again.',
        suggestions: [
          'Wait 30 seconds before retrying',
          'Try processing fewer documents at once'
        ],
        timestamp
      };
    }
    
    if (error.message?.includes('timeout') || error.code === 'TIMEOUT') {
      return {
        code: 'OPERATION_TIMEOUT',
        message: error.message,
        userMessage: 'This operation is taking longer than expected. It may still be processing in the background.',
        suggestions: [
          'Check back in a few minutes',
          'Try breaking large tasks into smaller pieces',
          'Contact support if this persists'
        ],
        timestamp
      };
    }
    
    if (error.message?.includes('File too large') || error.code === 'LIMIT_FILE_SIZE') {
      return {
        code: 'FILE_TOO_LARGE',
        message: error.message,
        userMessage: 'The file you\'re trying to upload is too large. Please use a smaller file.',
        suggestions: [
          'Compress your file or reduce its size',
          'Break large drawings into separate files',
          'Contact support for assistance with large files'
        ],
        timestamp
      };
    }
    
    if (error.message?.includes('No BIM elements') || error.message?.includes('empty result')) {
      return {
        code: 'NO_ELEMENTS_GENERATED',
        message: error.message,
        userMessage: 'No building elements could be identified in your documents. The analysis may need more detailed drawings.',
        suggestions: [
          'Make sure your documents contain construction drawings',
          'Upload drawings that show building components clearly',
          'Include both plan views and detail drawings'
        ],
        timestamp
      };
    }
    
    // Claude API specific errors
    if (error.message?.includes('context_length_exceeded')) {
      return {
        code: 'DOCUMENT_TOO_COMPLEX',
        message: error.message,
        userMessage: 'Your documents contain too much information to process at once. Try uploading fewer or simpler documents.',
        suggestions: [
          'Upload documents one at a time',
          'Break complex drawings into separate files',
          'Remove unnecessary pages from PDF documents'
        ],
        timestamp
      };
    }
    
    // Generic fallback with helpful context
    return {
      code: 'UNKNOWN_ERROR',
      message: error.message || 'An unexpected error occurred',
      userMessage: `Something went wrong during ${context}. Our team has been notified and will investigate.`,
      technicalDetails: { originalError: error, context },
      suggestions: [
        'Try refreshing the page and attempting the operation again',
        'Check your internet connection',
        'Contact support if the problem persists'
      ],
      timestamp
    };
  }
  
  static logAndReturnError(error: any, context: string): DetailedError {
    const detailed = this.createDetailedError(error, context);
    
    // Log for developers
    console.error(`💥 [${detailed.code}] ${context}:`, {
      message: detailed.message,
      userMessage: detailed.userMessage,
      technicalDetails: detailed.technicalDetails,
      timestamp: new Date(detailed.timestamp).toISOString()
    });
    
    return detailed;
  }
}