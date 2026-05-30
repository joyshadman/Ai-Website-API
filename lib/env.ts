import { PRODUCTION_API, PRODUCTION_FRONTEND } from "./cors.js";

function isApiHost(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    url === PRODUCTION_API ||
    lower.includes("ai-website-api.onrender.com") ||
    lower.includes("ai-website-api.vercel.app")
  );
}

/** Public URL where users hit /api/auth (frontend + Vercel proxy, not the API host). */
export function getBetterAuthUrl(): string {
  const frontend =
    process.env.FRONTEND_URL?.trim() ||
    process.env.BETTER_AUTH_FRONTEND_URL?.trim();

  if (frontend) return frontend.replace(/\/$/, "");

  const fromEnv = process.env.BETTER_AUTH_URL?.trim();
  if (fromEnv) {
    const normalized = fromEnv.replace(/\/$/, "");
    if (!isApiHost(normalized)) return normalized;
  }

  if (process.env.NODE_ENV === "production") return PRODUCTION_FRONTEND;
  return "http://localhost:5173";
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
  const configuredAuthUrl = process.env.BETTER_AUTH_URL?.trim();
  return {
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL?.trim()),
    hasAuthSecret: Boolean(process.env.BETTER_AUTH_SECRET?.trim()),
    hasAuthUrl: Boolean(configuredAuthUrl),
    authUrlPointsAtApi: configuredAuthUrl
      ? isApiHost(configuredAuthUrl.replace(/\/$/, ""))
      : false,
    betterAuthUrl: getBetterAuthUrl(),
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
    vercel: Boolean(process.env.VERCEL),
    nodeEnv: process.env.NODE_ENV ?? "unknown",
  };
}

export { PRODUCTION_FRONTEND, PRODUCTION_API } from "./cors.js";
