// 🛡️ ENTERPRISE SECURITY: Short-lived JWT + Refresh Token Rotation System
// Implements the blueprint's recommendation: 15-minute access tokens + refresh rotation

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { storage } from "../storage";
import { BimError } from "./error-handler";
import type { User } from "@shared/schema";
import { JWT_SECRET } from "../config/jwt-secret";

// Security configuration
const ACCESS_TOKEN_LIFETIME = '15m';  // Short-lived access tokens
const REFRESH_TOKEN_LIFETIME = '7d';  // Longer-lived refresh tokens
const REFRESH_TOKEN_ROTATION_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours

const REFRESH_SECRET = process.env.REFRESH_SECRET || JWT_SECRET + '_refresh';

// In-memory refresh token store (in production, use Redis or database)
// Format: { tokenFamily: { tokens: Set<hashedToken>, userId, createdAt, deviceInfo } }
const refreshTokenStore = new Map<string, {
  tokens: Set<string>;
  userId: string;
  createdAt: number;
  deviceInfo: {
    userAgent: string;
    ip: string;
    fingerprint?: string;
  };
  lastUsed: number;
}>();

interface AccessTokenPayload {
  userId: string;
  username: string;
  role: string;
  companyId: string | null;
  tokenFamily: string;
  type: 'access';
}

interface RefreshTokenPayload {
  userId: string;
  tokenFamily: string;
  tokenHash: string;
  type: 'refresh';
}

/**
 * 🔐 Generate access and refresh token pair
 */
export function generateTokenPair(user: User, deviceInfo: { userAgent: string; ip: string }): {
  accessToken: string;
  refreshToken: string;
  tokenFamily: string;
} {
  const tokenFamily = crypto.randomUUID();
  const refreshTokenValue = crypto.randomBytes(32).toString('hex');
  const refreshTokenHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');

  // Create access token (short-lived)
  const accessPayload: AccessTokenPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    companyId: user.companyId,
    tokenFamily,
    type: 'access'
  };

  const accessToken = jwt.sign(accessPayload, JWT_SECRET, { 
    expiresIn: ACCESS_TOKEN_LIFETIME,
    issuer: 'EstimatorPro',
    audience: 'EstimatorPro-API'
  });

  // Create refresh token (longer-lived)
  const refreshPayload: RefreshTokenPayload = {
    userId: user.id,
    tokenFamily,
    tokenHash: refreshTokenHash,
    type: 'refresh'
  };

  const refreshToken = jwt.sign(refreshPayload, REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_LIFETIME,
    issuer: 'EstimatorPro',
    audience: 'EstimatorPro-Refresh'
  });

  // Store refresh token family
  refreshTokenStore.set(tokenFamily, {
    tokens: new Set([refreshTokenHash]),
    userId: user.id,
    createdAt: Date.now(),
    deviceInfo,
    lastUsed: Date.now()
  });

  console.log(`🔐 Generated token pair for user ${user.username}: family ${tokenFamily.slice(0, 8)}...`);

  return { accessToken, refreshToken, tokenFamily };
}

/**
 * 🔄 Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string, deviceInfo: { userAgent: string; ip: string }): Promise<{
  accessToken: string;
  refreshToken?: string; // New refresh token if rotation occurs
  rotated: boolean;
}> {
  try {
    // Verify refresh token
    const payload = jwt.verify(refreshToken, REFRESH_SECRET, {
      issuer: 'EstimatorPro',
      audience: 'EstimatorPro-Refresh'
    }) as RefreshTokenPayload;

    if (payload.type !== 'refresh') {
      throw new Error('Invalid token type for refresh operation');
    }

    // Check token family exists
    const tokenFamily = refreshTokenStore.get(payload.tokenFamily);
    if (!tokenFamily) {
      throw new Error('Token family not found - possible theft detected');
    }

    // Check if this specific token is valid
    if (!tokenFamily.tokens.has(payload.tokenHash)) {
      // Token theft detected - invalidate entire family
      refreshTokenStore.delete(payload.tokenFamily);
      throw new Error('Invalid refresh token - family invalidated due to security breach');
    }

    // Get user
    const user = await storage.getUser(payload.userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Update last used time
    tokenFamily.lastUsed = Date.now();

    // Check if device info matches (basic device binding)
    const deviceChanged = tokenFamily.deviceInfo.userAgent !== deviceInfo.userAgent ||
                         tokenFamily.deviceInfo.ip !== deviceInfo.ip;

    // Determine if we should rotate refresh token
    const shouldRotate = deviceChanged || 
                        (Date.now() - tokenFamily.createdAt) > REFRESH_TOKEN_ROTATION_THRESHOLD;

    if (shouldRotate) {
      // Generate new token pair (rotation)
      const newTokenPair = generateTokenPair(user, deviceInfo);
      
      // Invalidate old token family
      refreshTokenStore.delete(payload.tokenFamily);
      
      console.log(`🔄 Rotated tokens for user ${user.username}: ${payload.tokenFamily.slice(0, 8)}... → ${newTokenPair.tokenFamily.slice(0, 8)}...`);
      
      return {
        accessToken: newTokenPair.accessToken,
        refreshToken: newTokenPair.refreshToken,
        rotated: true
      };
    } else {
      // Just generate new access token
      const accessPayload: AccessTokenPayload = {
        userId: user.id,
        username: user.username,
        role: user.role,
        companyId: user.companyId,
        tokenFamily: payload.tokenFamily,
        type: 'access'
      };

      const accessToken = jwt.sign(accessPayload, JWT_SECRET, { 
        expiresIn: ACCESS_TOKEN_LIFETIME,
        issuer: 'EstimatorPro',
        audience: 'EstimatorPro-API'
      });

      return { accessToken, rotated: false };
    }

  } catch (error: any) {
    console.error('❌ Refresh token error:', error.message);
    throw new BimError('Invalid refresh token', 401, 'REFRESH_TOKEN_INVALID', {
      reason: error.message
    });
  }
}

/**
 * 🔓 Invalidate token family (logout)
 */
export function invalidateTokenFamily(tokenFamily: string): void {
  refreshTokenStore.delete(tokenFamily);
  console.log(`🔓 Invalidated token family: ${tokenFamily.slice(0, 8)}...`);
}

/**
 * 🔍 Verify access token middleware
 */
export function verifyAccessToken(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      throw new BimError("Access token required", 401, "ACCESS_TOKEN_MISSING");
    }

    const payload = jwt.verify(token, JWT_SECRET, {
      issuer: 'EstimatorPro',
      audience: 'EstimatorPro-API'
    }) as AccessTokenPayload;

    if (payload.type !== 'access') {
      throw new Error('Invalid token type for access operation');
    }

    // Check token family is still valid
    const tokenFamily = refreshTokenStore.get(payload.tokenFamily);
    if (!tokenFamily) {
      throw new Error('Token family invalidated');
    }

    // Add user info to request
    (req as any).user = {
      id: payload.userId,
      username: payload.username,
      role: payload.role,
      companyId: payload.companyId
    };

    next();

  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Access token expired',
        code: 'ACCESS_TOKEN_EXPIRED',
        hint: 'Use refresh token to obtain new access token'
      });
    }

    const authError = new BimError(
      "Invalid access token", 
      401, 
      "ACCESS_TOKEN_INVALID",
      { originalError: error.message }
    );
    next(authError);
  }
}

/**
 * 🧹 Cleanup expired token families (call periodically)
 */
export function cleanupExpiredTokens(): void {
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  for (const [tokenFamily, data] of Array.from(refreshTokenStore.entries())) {
    if (now - data.lastUsed > sevenDaysMs) {
      refreshTokenStore.delete(tokenFamily);
      console.log(`🧹 Cleaned up expired token family: ${tokenFamily.slice(0, 8)}...`);
    }
  }
}

/**
 * 📊 Get token statistics (for monitoring)
 */
export function getTokenStats(): {
  activeTokenFamilies: number;
  totalTokens: number;
  oldestTokenAge: number;
} {
  const now = Date.now();
  let totalTokens = 0;
  let oldestAge = 0;

  for (const data of Array.from(refreshTokenStore.values())) {
    totalTokens += data.tokens.size;
    const age = now - data.createdAt;
    if (age > oldestAge) oldestAge = age;
  }

  return {
    activeTokenFamilies: refreshTokenStore.size,
    totalTokens,
    oldestTokenAge: oldestAge
  };
}

// Cleanup expired tokens every hour
setInterval(cleanupExpiredTokens, 60 * 60 * 1000);