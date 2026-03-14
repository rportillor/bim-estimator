// 🛡️ ENTERPRISE SECURITY: Authentication routes with short-lived tokens + refresh rotation
// Implements secure login/logout/refresh endpoints

import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { storage } from "../storage";
import { validate } from "../middleware/validate";
import { generateTokenPair, refreshAccessToken, invalidateTokenFamily, verifyAccessToken, getTokenStats } from "../middleware/jwt-refresh-system";
import { BimError } from "../middleware/error-handler";
import { setTenantContext } from "../middleware/tenant-security";

const router = Router();

// Login schema
const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().optional().default(false)
});

// Refresh token schema
const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required")
});

/**
 * 🔑 Login endpoint - generates short-lived access token + refresh token
 */
router.post('/login', validate({ body: loginSchema }), async (req, res, next) => {
  try {
    const { username, password } = req.body;
    
    // Get user
    const user = await storage.getUserByUsername(username);
    if (!user) {
      throw new BimError("Invalid credentials", 401, "INVALID_CREDENTIALS");
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      throw new BimError("Invalid credentials", 401, "INVALID_CREDENTIALS");
    }

    // Extract device info for token binding
    const deviceInfo = {
      userAgent: req.get('User-Agent') || 'unknown',
      ip: req.ip || req.connection.remoteAddress || 'unknown'
    };

    // Generate token pair
    const { accessToken, refreshToken, tokenFamily } = generateTokenPair(user, deviceInfo);

    // Set secure HTTP-only cookies
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict' as const,
      path: '/'
    };

    res.cookie('accessToken', accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000 // 15 minutes
    });

    res.cookie('refreshToken', refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    console.log(`✅ User ${user.username} logged in with token family ${tokenFamily.slice(0, 8)}...`);

    res.json({
      success: true,
      token: accessToken,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        email: user.email,
        companyId: user.companyId,
        plan: user.plan
      },
      tokenFamily: tokenFamily.slice(0, 8) + '...', // Partial for debugging
      expiresIn: 15 * 60 // 15 minutes in seconds
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 🔄 Refresh token endpoint - exchanges refresh token for new access token
 */
router.post('/refresh', validate({ body: refreshSchema }), async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    // Extract device info
    const deviceInfo = {
      userAgent: req.get('User-Agent') || 'unknown',
      ip: req.ip || req.connection.remoteAddress || 'unknown'
    };

    // Refresh access token
    const result = await refreshAccessToken(refreshToken, deviceInfo);

    // Update cookies
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict' as const,
      path: '/'
    };

    res.cookie('accessToken', result.accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000 // 15 minutes
    });

    // If refresh token was rotated, update refresh cookie
    if (result.rotated && result.refreshToken) {
      res.cookie('refreshToken', result.refreshToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });
    }

    res.json({
      success: true,
      accessToken: result.accessToken,
      rotated: result.rotated,
      expiresIn: 15 * 60 // 15 minutes in seconds
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 🔓 Logout endpoint - invalidates token family
 */
router.post('/logout', verifyAccessToken, async (req, res, next) => {
  try {
    // Extract token family from access token
    const authHeader = req.headers.authorization;
    const token = authHeader?.slice(7);
    
    if (token) {
      const payload = jwt.decode(token) as any;
      
      if (payload?.tokenFamily) {
        invalidateTokenFamily(payload.tokenFamily);
      }
    }

    // Clear cookies
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');

    console.log(`🔓 User logged out`);

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 👤 Get current user endpoint
 */
router.get('/user', verifyAccessToken, setTenantContext, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const fullUser = await storage.getUser(user.id);
    
    if (!fullUser) {
      throw new BimError("User not found", 404, "USER_NOT_FOUND");
    }

    res.json({
      id: fullUser.id,
      username: fullUser.username,
      name: fullUser.name,
      role: fullUser.role,
      email: fullUser.email,
      companyId: fullUser.companyId,
      plan: fullUser.plan,
      subscriptionTier: fullUser.subscriptionTier
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 📊 Token status endpoint (for debugging/monitoring)
 */
router.get('/token-status', verifyAccessToken, (req, res) => {
  const stats = getTokenStats();
  
  res.json({
    ...stats,
    currentUser: (req as any).user?.username
  });
});

export default router;