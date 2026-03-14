// server/middleware/error-handler.ts
// Comprehensive error handling with detailed logging

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  details?: any;
  errorId?: string;
}

export class BimError extends Error implements AppError {
  statusCode: number;
  code: string;
  details?: any;
  errorId: string;

  constructor(message: string, statusCode = 500, code = "BIM_ERROR", details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.errorId = crypto.randomBytes(4).toString('hex');
    this.name = "BimError";
  }
}

export function createError(message: string, statusCode = 500, code = "INTERNAL_ERROR", details?: any): BimError {
  return new BimError(message, statusCode, code, details);
}

export function globalErrorHandler(err: AppError, req: Request, res: Response, _next: NextFunction) {
  const errorId = err.errorId || crypto.randomBytes(4).toString('hex');
  const statusCode = err.statusCode || 500;
  
  // Comprehensive error logging
  const errorDetails = {
    errorId,
    message: err.message,
    code: err.code || "UNKNOWN_ERROR",
    statusCode,
    path: req.path,
    method: req.method,
    userId: (req as any).user?.id,
    details: err.details,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    timestamp: new Date().toISOString()
  };

  console.error("🚨 [ERROR]", JSON.stringify(errorDetails, null, 2));

  // User-friendly error response
  const response: any = {
    error: true,
    message: statusCode === 500 ? "Internal server error" : err.message,
    code: err.code || "UNKNOWN_ERROR",
    errorId
  };

  if (process.env.NODE_ENV === 'development' && err.details) {
    response.details = err.details;
  }

  res.status(statusCode).json(response);
}

export function asyncHandler(fn: Function) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}