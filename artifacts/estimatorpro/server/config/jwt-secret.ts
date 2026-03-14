// server/config/jwt-secret.ts
// Single source of truth for JWT_SECRET across the entire application.
// Previously, auth.ts, jwt-refresh-system.ts, and auth-fix.ts each generated
// their own random secret in dev mode, causing tokens to be unverifiable
// across modules.

import crypto from "crypto";

function resolveSecret(): string {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET environment variable is required in production");
  }
  // Single random secret shared across all modules for the lifetime of this process
  const devSecret = crypto.randomBytes(64).toString("hex");
  console.warn("[jwt] No JWT_SECRET set — using ephemeral dev secret");
  return devSecret;
}

export const JWT_SECRET: string = resolveSecret();
