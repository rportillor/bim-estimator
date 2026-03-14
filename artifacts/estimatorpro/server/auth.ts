import { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { insertUserSchema, type User } from "@shared/schema";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./config/jwt-secret";

// Auth schemas
export const loginSchema = z.object({
  username: z.string()
    .min(3, "Username must be at least 3 characters")
    .max(50, "Username must be less than 50 characters")
    .regex(/^[a-zA-Z0-9_-]+$/, "Username can only contain letters, numbers, hyphens, and underscores"),
  password: z.string()
    .min(8, "Password must be at least 8 characters") // SECURITY FIX: Match registration requirement
    .max(128, "Password must be less than 128 characters"),
});

export const registerSchema = insertUserSchema.extend({
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be less than 128 characters"),
  confirmPassword: z.string().min(8, "Please confirm your password"),
  username: z.string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be less than 30 characters")
    .regex(/^[a-zA-Z0-9_-]+$/, "Username can only contain letters, numbers, hyphens, and underscores"),
  email: z.string()
    .email("Please enter a valid email address")
    .max(255, "Email must be less than 255 characters")
    .optional()
    .or(z.literal("")),
  role: z.string().optional(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export type LoginRequest = z.infer<typeof loginSchema>;
export type RegisterRequest = z.infer<typeof registerSchema>;

// JWT payload interface
interface JWTPayload {
  userId: string;
  username: string;
  role: string;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

// Generate JWT token
export function generateToken(user: User): string {
  const payload: JWTPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
  };
  
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

// Verify JWT token
export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (_error) {
    return null;
  }
}

// Hash password
export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 12);
}

// Verify password
export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return await bcrypt.compare(password, hashedPassword);
}

// Authentication middleware
export async function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  // SECURITY: Only accept tokens from header or cookie — never from query string
  // (tokens in URLs leak via server logs, browser history, and Referer headers)
  const token =
    (authHeader && authHeader.startsWith("Bearer ")) ? authHeader.slice(7) :
    (req.cookies?.token) ? req.cookies.token :
    null;

  // DEVELOPMENT MODE: More secure test user handling
  if (process.env.NODE_ENV === 'development' && token === 'test-token') {
    // Only allow test-token, not missing tokens
    req.user = {
      id: "test-user-id",
      username: "testuser",
      name: "Test User",
      role: "Construction Manager",
      email: "test@example.com",
      password: "hashed-password",
      companyId: null,
      isCompanyAdmin: false,
      stripeCustomerId: null,
      subscriptionId: null,
      plan: "enterprise",
      subscriptionTier: "enterprise",
      subscriptionStatus: "active",
      trialEndsAt: null,
      subscriptionEndsAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    return next();
  }

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(403).json({ error: "Invalid or expired token" });
  }

  // Get user from database
  const user = await storage.getUser(payload.userId);
  if (!user) {
    return res.status(403).json({ error: "User not found" });
  }

  req.user = user;
  next();
}

// Optional authentication middleware (doesn't require auth)
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      const user = await storage.getUser(payload.userId);
      if (user) {
        req.user = user;
      }
    }
  }

  next();
}

// Auth route handlers
export async function register(req: Request, res: Response) {
  try {
    const validatedData = registerSchema.parse(req.body);
    
    // Check if user already exists
    const existingUser = await storage.getUserByUsername(validatedData.username);
    if (existingUser) {
      return res.status(400).json({ error: "Username already exists" });
    }

    // Hash password
    const hashedPassword = await hashPassword(validatedData.password);

    // Create user
    const newUser = await storage.createUser({
      username: validatedData.username,
      password: hashedPassword,
      name: validatedData.name,
      role: validatedData.role || "Construction Manager",
    });

    // Generate token
    const token = generateToken(newUser);

    // Return user data (without password) and token
    const { password: _password, ...userWithoutPassword } = newUser;
    
    res.status(201).json({
      message: "User registered successfully",
      user: userWithoutPassword,
      token,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error("Registration error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const validatedData = loginSchema.parse(req.body);
    
    // Find user
    const user = await storage.getUserByUsername(validatedData.username);
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Verify password
    const isValidPassword = await verifyPassword(validatedData.password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Generate token
    const token = generateToken(user);

    // Return user data (without password) and token
    const { password: _password, ...userWithoutPassword } = user;
    
    res.json({
      message: "Login successful",
      user: userWithoutPassword,
      token,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function getProfile(req: Request, res: Response) {
  const { password: _password, ...userWithoutPassword } = req.user!;
  res.json({ user: userWithoutPassword });
}

export async function refreshToken(req: Request, res: Response) {
  const token = generateToken(req.user!);
  res.json({ token });
}

// Socket authentication helper
export async function authenticateSocketToken(token: string): Promise<User | null> {
  try {
    const payload = verifyToken(token);
    if (!payload) {
      return null;
    }
    
    const user = await storage.getUser(payload.userId);
    return user || null;
  } catch (_error) {
    return null;
  }
}