// ✅ SECURITY: Enterprise-grade security middleware with enhanced protection
import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import path from "path";
import crypto from "crypto";

// File upload security middleware
export const createSecureFileFilter = (allowedExtensions: string[], allowedMimeTypes?: string[]) => {
  return (req: Request, file: Express.Multer.File, cb: any) => {
    // Check file extension
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    if (!allowedExtensions.includes(fileExtension)) {
      return cb(new Error(`File type not allowed. Allowed types: ${allowedExtensions.join(', ')}`));
    }
    
    // Check MIME type if provided
    if (allowedMimeTypes && !allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error('Invalid file MIME type'));
    }
    
    // Sanitize filename
    const sanitizedName = sanitizeFilename(file.originalname);
    file.originalname = sanitizedName;
    
    cb(null, true);
  };
};

// Sanitize filename to prevent path traversal
export function sanitizeFilename(filename: string): string {
  // Remove path components and dangerous characters
  const sanitized = filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.+/g, '.')
    .replace(/_+/g, '_')
    .slice(0, 255); // Limit filename length
  
  // Ensure filename doesn't start with a dot or underscore
  return sanitized.replace(/^[._]+/, 'file_');
}

// Generate unique filename with hash to prevent conflicts
export function generateSecureFilename(originalName: string): string {
  const ext = path.extname(originalName);
  const timestamp = Date.now();
  const randomHash = crypto.randomBytes(8).toString('hex');
  const sanitizedBase = path.parse(originalName).name.replace(/[^a-zA-Z0-9]/g, '_');
  
  return `${timestamp}_${randomHash}_${sanitizedBase}${ext}`;
}

// Content Security Policy middleware for file uploads - relaxed for development
export const fileUploadCSP = (req: Request, res: Response, next: NextFunction) => {
  // Don't override CSP for development - let the main helmet config handle it
  next();
};

// Enhanced rate limiter for file uploads
export const fileUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // limit each IP to 50 file uploads per hour
  message: {
    error: 'Too many file uploads from this IP, please try again later.',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// HTML entity encoding — defense-in-depth against XSS
function encodeHtmlEntities(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Input sanitization middleware
// SECURITY: Uses HTML entity encoding instead of regex stripping (which is bypassable)
export const sanitizeInput = (req: Request, res: Response, next: NextFunction) => {
  const sanitizeObject = (obj: any): any => {
    if (typeof obj === 'string') {
      // Encode HTML entities to neutralize XSS payloads
      let sanitized = encodeHtmlEntities(obj);
      // Also neutralize javascript: protocol and event handlers
      sanitized = sanitized.replace(/javascript:/gi, 'blocked:');
      sanitized = sanitized.replace(/on\w+=/gi, 'data-blocked=');
      return sanitized.trim();
    }

    if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    }

    if (typeof obj === 'object' && obj !== null) {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitizeObject(value);
      }
      return sanitized;
    }

    return obj;
  };

  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  if (req.query) {
    req.query = sanitizeObject(req.query);
  }

  next();
};

// Password strength validation
export function validatePasswordStrength(password: string): {
  isValid: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  
  if (password.length < 8) {
    issues.push('Password must be at least 8 characters long');
  }
  
  if (!/[a-z]/.test(password)) {
    issues.push('Password must contain at least one lowercase letter');
  }
  
  if (!/[A-Z]/.test(password)) {
    issues.push('Password must contain at least one uppercase letter');
  }
  
  if (!/\d/.test(password)) {
    issues.push('Password must contain at least one number');
  }
  
  if (!/[@$!%*?&]/.test(password)) {
    issues.push('Password must contain at least one special character (@$!%*?&)');
  }
  
  // Check for common weak passwords
  const commonPasswords = [
    'password', '123456', 'password123', 'admin', 'qwerty', 
    'letmein', 'welcome', 'monkey', '1234567890'
  ];
  
  if (commonPasswords.includes(password.toLowerCase())) {
    issues.push('Password is too common');
  }
  
  return {
    isValid: issues.length === 0,
    issues
  };
}

// Request logging for security monitoring
export const securityLogger = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  
  // Log suspicious activities
  const suspiciousPatterns = [
    /\.\./,  // Path traversal
    /<script/i,  // XSS attempts
    /union.*select/i,  // SQL injection
    /javascript:/i,  // JavaScript protocol
    /eval\(/i,  // Code execution
  ];
  
  const requestData = JSON.stringify(req.body || {}) + JSON.stringify(req.query || {});
  
  const isSuspicious = suspiciousPatterns.some(pattern => 
    pattern.test(requestData) || pattern.test(req.url)
  );
  
  if (isSuspicious) {
    console.warn(`[SECURITY] Suspicious request detected:`, {
      ip: req.ip,
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      body: req.body,
      query: req.query,
      timestamp: new Date().toISOString()
    });
  }
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    // Log failed authentication attempts
    if (req.url.includes('/auth/') && res.statusCode >= 400) {
      console.warn(`[SECURITY] Failed authentication attempt:`, {
        ip: req.ip,
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration,
        timestamp: new Date().toISOString()
      });
    }
  });
  
  next();
};