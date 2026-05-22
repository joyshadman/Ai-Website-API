import { PRODUCTION_API, PRODUCTION_FRONTEND } from "./cors.js";

export function getBetterAuthUrl(): string {
  if (process.env.BETTER_AUTH_URL?.trim()) {
    return process.env.BETTER_AUTH_URL.trim().replace(/\/$/, "");
  }
  if (process.env.NODE_ENV === "production") return PRODUCTION_API;
  return "http://localhost:3000"; 
}

export function getBetterAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is not set. Add it in Vercel → Settings → Environment Variables."
    );
  }
  return secret;
}

export function getEnvStatus() {
  return {
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL?.trim()),
    hasAuthSecret: Boolean(process.env.BETTER_AUTH_SECRET?.trim()),
    hasAuthUrl: Boolean(process.env.BETTER_AUTH_URL?.trim()),
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
    vercel: Boolean(process.env.VERCEL),
    nodeEnv: process.env.NODE_ENV ?? "unknown",
  };
}

export { PRODUCTION_FRONTEND, PRODUCTION_API };
