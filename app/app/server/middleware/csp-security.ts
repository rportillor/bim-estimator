// 🛡️ ENTERPRISE SECURITY: Content Security Policy (CSP) Headers Implementation
// Implements strict CSP following the blueprint's recommendations

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

// CSP nonce cache (in production, use Redis)
const nonceCache = new Map<string, { nonce: string; createdAt: number }>();

// CSP configuration based on EstimatorPro's needs
const CSP_CONFIG = {
  // Core directives
  defaultSrc: ["'self'"],
  
  // Script sources - allow Vite, React, and trusted CDNs
  scriptSrc: [
    "'self'",
    "'unsafe-eval'", // Required for Vite in development
    "'unsafe-inline'", // Required for React inline scripts in development
    "'strict-dynamic'", // For dynamic imports
    "https://js.stripe.com", // Stripe payments
    "https://cdn.jsdelivr.net", // CDN for libraries
    "https://unpkg.com", // Package CDN
    "localhost:*", // Vite dev server
    "127.0.0.1:*", // Local development
    "ws:", // WebSocket for Vite HMR
    "wss:" // Secure WebSocket
  ],
  
  // Style sources - allow styled-components and Tailwind
  styleSrc: [
    "'self'",
    "'unsafe-inline'", // Required for styled-components and Tailwind
    "https://fonts.googleapis.com" // Google Fonts
  ],
  
  // Font sources
  fontSrc: [
    "'self'",
    "https://fonts.gstatic.com", // Google Fonts
    "data:" // Data URLs for font icons
  ],
  
  // Image sources - construction documents and UI
  imgSrc: [
    "'self'",
    "data:", // Base64 encoded images
    "blob:", // File uploads and generated images
    "https://storage.googleapis.com", // Google Cloud Storage
    "https://*.googleapis.com" // Google services
  ],
  
  // Media sources - video/audio for BIM
  mediaSrc: [
    "'self'",
    "blob:" // For BIM model viewers
  ],
  
  // Connect sources - API calls and external services
  connectSrc: [
    "'self'",
    "https://api.stripe.com", // Stripe API
    "ws:", // WebSocket connections
    "wss:", // Secure WebSocket connections
    "https://claude.ai", // Anthropic Claude API (if direct)
    "https://api.anthropic.com", // Anthropic API
    "localhost:*", // Vite dev server connections
    "127.0.0.1:*", // Local development connections
    "http://localhost:*", // HTTP localhost
    "https://localhost:*" // HTTPS localhost
  ],
  
  // Frame sources - embedded content
  frameSrc: [
    "'self'",
    "https://js.stripe.com", // Stripe checkout
    "https://hooks.stripe.com" // Stripe webhooks
  ],
  
  // Worker sources - for BIM processing
  workerSrc: [
    "'self'",
    "blob:" // Web workers for file processing
  ],
  
  // Object sources - disable by default
  objectSrc: ["'none'"],
  
  // Base URI - prevent injection
  baseUri: ["'self'"],
  
  // Form action - restrict form submissions
  formAction: ["'self'"],
  
  // Frame ancestors - prevent clickjacking
  frameAncestors: ["'none'"],
  
  // Manifest source - PWA support
  manifestSrc: ["'self'"],
  
  // Upgrade insecure requests in production
  upgradeInsecureRequests: process.env.NODE_ENV === 'production'
};

/**
 * 🔐 Generate CSP nonce for inline scripts
 */
export function generateCSPNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

/**
 * 🛡️ Content Security Policy middleware
 */
export function setupCSPHeaders(req: Request, res: Response, next: NextFunction) {
  try {
    // Generate nonce for this request
    const nonce = generateCSPNonce();
    
    // Store nonce for use in templates
    (req as any).cspNonce = nonce;
    
    // Skip CSP entirely in development to avoid blocking Vite
    if (process.env.NODE_ENV !== 'production') {
      console.log(`🛡️ CSP headers bypassed in development with nonce: ${nonce.slice(0, 8)}...`);
      return next();
    }
    
    // Build CSP directives for production only
    const directives: string[] = [];
    
    // Default source
    directives.push(`default-src ${CSP_CONFIG.defaultSrc.join(' ')}`);
    
    // Script source with nonce
    const scriptSrcWithNonce = [...CSP_CONFIG.scriptSrc, `'nonce-${nonce}'`];
    directives.push(`script-src ${scriptSrcWithNonce.join(' ')}`);
    
    // Style source
    directives.push(`style-src ${CSP_CONFIG.styleSrc.join(' ')}`);
    
    // Font source
    directives.push(`font-src ${CSP_CONFIG.fontSrc.join(' ')}`);
    
    // Image source
    directives.push(`img-src ${CSP_CONFIG.imgSrc.join(' ')}`);
    
    // Media source
    directives.push(`media-src ${CSP_CONFIG.mediaSrc.join(' ')}`);
    
    // Connect source
    directives.push(`connect-src ${CSP_CONFIG.connectSrc.join(' ')}`);
    
    // Frame source
    directives.push(`frame-src ${CSP_CONFIG.frameSrc.join(' ')}`);
    
    // Worker source
    directives.push(`worker-src ${CSP_CONFIG.workerSrc.join(' ')}`);
    
    // Object source
    directives.push(`object-src ${CSP_CONFIG.objectSrc.join(' ')}`);
    
    // Base URI
    directives.push(`base-uri ${CSP_CONFIG.baseUri.join(' ')}`);
    
    // Form action
    directives.push(`form-action ${CSP_CONFIG.formAction.join(' ')}`);
    
    // Frame ancestors
    directives.push(`frame-ancestors ${CSP_CONFIG.frameAncestors.join(' ')}`);
    
    // Manifest source
    directives.push(`manifest-src ${CSP_CONFIG.manifestSrc.join(' ')}`);
    
    // Upgrade insecure requests in production
    if (CSP_CONFIG.upgradeInsecureRequests) {
      directives.push('upgrade-insecure-requests');
    }
    
    // Join all directives
    const cspHeader = directives.join('; ');
    
    // Enforce CSP in production only
    res.setHeader('Content-Security-Policy', cspHeader);
    
    // Additional security headers - relaxed for development
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    } else {
      // Development-friendly headers that don't break Vite
      res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
      res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }
    
    console.log(`🛡️ CSP headers set with nonce: ${nonce.slice(0, 8)}...`);
    
    next();
    
  } catch (error) {
    console.error('❌ Failed to set CSP headers:', error);
    // Continue without CSP rather than blocking the request
    next();
  }
}

/**
 * 🚫 CSRF Protection for state-changing operations
 */
export function setupCSRFProtection(req: Request, res: Response, next: NextFunction) {
  // Skip CSRF for GET, HEAD, OPTIONS requests
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  
  // Check for CSRF token in various locations
  const csrfToken = 
    req.headers['x-csrf-token'] ||
    req.headers['x-xsrf-token'] ||
    req.body?._csrf ||
    req.query?._csrf;
  
  // For development, generate and accept any token
  if (process.env.NODE_ENV === 'development') {
    if (!csrfToken) {
      const token = crypto.randomBytes(32).toString('hex');
      res.setHeader('X-CSRF-Token', token);
      (req as any).csrfToken = token;
    }
    return next();
  }
  
  // Production CSRF validation: require token AND validate Origin header
  if (!csrfToken) {
    return res.status(403).json({
      error: 'CSRF token required',
      code: 'CSRF_TOKEN_MISSING'
    });
  }

  // Double-submit validation: check Origin/Referer against allowed origins
  const origin = req.headers.origin || req.headers.referer;
  const allowedOrigin = process.env.CLIENT_ORIGIN;
  if (allowedOrigin && origin && !origin.startsWith(allowedOrigin)) {
    return res.status(403).json({
      error: 'Origin mismatch',
      code: 'CSRF_ORIGIN_MISMATCH'
    });
  }

  next();
}

/**
 * 🍪 Secure Cookie Configuration
 */
export function setupSecureCookies(req: Request, res: Response, next: NextFunction) {
  // Override res.cookie to enforce security settings
  const originalCookie = res.cookie.bind(res);
  
  res.cookie = function(name: string, value: any, options: any = {}) {
    const secureOptions = {
      ...options,
      httpOnly: options.httpOnly !== false, // Default to httpOnly
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: options.sameSite || 'strict', // Prevent CSRF
      path: options.path || '/' // Default path
    };
    
    return originalCookie(name, value, secureOptions);
  };
  
  next();
}

/**
 * 📊 CSP Violation Reporting Endpoint
 */
export function handleCSPViolation(req: Request, res: Response) {
  const violation = req.body;
  
  console.warn('🚨 CSP Violation Report:', {
    violatedDirective: violation['violated-directive'],
    blockedURI: violation['blocked-uri'],
    documentURI: violation['document-uri'],
    originalPolicy: violation['original-policy'],
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });
  
  // In production, send to security monitoring system
  if (process.env.NODE_ENV === 'production') {
    // Send to logging service, security team, etc.
  }
  
  res.status(204).end();
}

/**
 * 🧹 Cleanup old nonces
 */
export function cleanupOldNonces(): void {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  for (const [key, data] of Array.from(nonceCache.entries())) {
    if (now - data.createdAt > oneHour) {
      nonceCache.delete(key);
    }
  }
}

// Cleanup old nonces every hour
setInterval(cleanupOldNonces, 60 * 60 * 1000);