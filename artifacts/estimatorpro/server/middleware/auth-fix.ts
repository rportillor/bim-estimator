// server/middleware/auth-fix.ts
// Enhanced authentication with comprehensive error handling + tenant security

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { storage } from "../storage";
import { BimError } from "./error-handler";
import { setTenantContext } from "./tenant-security";
import { JWT_SECRET } from "../config/jwt-secret";

export async function enhancedAuth(req: Request, res: Response, next: NextFunction) {
  try {
    // Token extraction from header or cookie only (no query string — tokens in URLs leak via logs/Referer)
    const authHeader = req.headers.authorization;
    const token =
      (authHeader?.startsWith("Bearer ")) ? authHeader.slice(7) :
      req.cookies?.token ||
      null;

    // Development bypass — only for explicit test-token, never for missing tokens
    if (process.env.NODE_ENV === 'development' && token === 'test-token') {
      (req as any).user = {
        id: "test-user-id",
        username: "testuser",
        name: "Test User",
        role: "Construction Manager",
        email: "test@example.com",
        plan: "enterprise",
        companyId: "test-company-id"
      };

      await setTenantContext(req, res, () => {
        return next();
      });
      return;
    }

    if (!token) {
      throw new BimError("Authentication required", 401, "AUTH_MISSING", {
        message: "No authentication token provided",
        hint: "Include token in Authorization header or cookie"
      });
    }

    // Verify token
    const payload = jwt.verify(token, JWT_SECRET) as any;
    const user = await storage.getUser(payload.userId);

    if (!user) {
      throw new BimError("User not found", 403, "AUTH_USER_NOT_FOUND", {
        userId: payload.userId
      });
    }

    (req as any).user = user;

    // Set tenant context for Row-Level Security
    await setTenantContext(req, res, () => {
      next();
    });

  } catch (error: any) {
    if (error instanceof BimError) {
      return next(error);
    }

    const authError = new BimError(
      "Authentication failed",
      403,
      "AUTH_INVALID",
      {
        originalError: error.message,
        path: req.path
      }
    );
    next(authError);
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!(req as any).user) {
    const error = new BimError("Authentication required", 401, "AUTH_REQUIRED");
    return next(error);
  }
  next();
}
