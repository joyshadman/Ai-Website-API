import { PRODUCTION_API, PRODUCTION_FRONTEND } from "./cors.js";

function isApiHost(url: string): boolean {
  return url === PRODUCTION_API;
}

export function getBetterAuthUrl(): string {
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
    throw new Error("BETTER_AUTH_SECRET is not set.");
  }
  return secret;
}

export function getEnvStatus() {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  return {
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL?.trim()),
    hasAuthSecret: Boolean(process.env.BETTER_AUTH_SECRET?.trim()),
    hasAuthUrl: Boolean(configured),
    authUrlMisconfigured: configured ? isApiHost(configured.replace(/\/$/, "")) : false,
    betterAuthUrl: getBetterAuthUrl(),
    frontendUrl: PRODUCTION_FRONTEND,
    apiUrl: PRODUCTION_API,
    hasGoogleOAuth: Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()),
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
    nodeEnv: process.env.NODE_ENV ?? "unknown",
  };
}

export { PRODUCTION_FRONTEND, PRODUCTION_API } from "./cors.js";
