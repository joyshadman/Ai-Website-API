import { PRODUCTION_API, PRODUCTION_FRONTEND } from "./cors.js";

export function getBetterAuthUrl(): string {
  if (process.env.BETTER_AUTH_URL?.trim()) {
    return process.env.BETTER_AUTH_URL.trim().replace(/\/$/, "");
  }
  if (process.env.VERCEL) return PRODUCTION_API;
  return "http://localhost:5173";
}

export function getBetterAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required");
  }
  return secret;
}

export { PRODUCTION_FRONTEND, PRODUCTION_API };
