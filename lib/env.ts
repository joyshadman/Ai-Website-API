import { PRODUCTION_API, PRODUCTION_FRONTEND } from "./cors.js";

function isApiHost(url: string): boolean {
  return url === PRODUCTION_API;
}

/**
 * Determines whether the API is running as a production deployment.
 *
 * Render automatically sets `RENDER=true` for every service. Some Render
 * dashboards also pin `NODE_ENV=development` for local-style builds, which
 * made the API treat production deployments as dev (SameSite=Lax, non-Secure
 * cookies) and silently broke cross-origin sessions on the Vercel frontend.
 * Treat Render deployments as production regardless of the NODE_ENV override.
 */
export function isProduction(): boolean {
  if (process.env.RENDER === "true") return true;
  return process.env.NODE_ENV === "production";
}

export function getBetterAuthUrl(): string {
  const fromEnv = process.env.BETTER_AUTH_URL?.trim();
  if (fromEnv) {
    const normalized = fromEnv.replace(/\/$/, "");
    if (!isApiHost(normalized)) return normalized;
  }
  if (isProduction()) return PRODUCTION_FRONTEND;
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
    hasSmtpUser: Boolean(process.env.SMTP_USER?.trim()),
    hasSmtpPass: Boolean(process.env.SMTP_PASS?.trim()),
    nodeEnv: process.env.NODE_ENV ?? "unknown",
  };
}

export { PRODUCTION_FRONTEND, PRODUCTION_API } from "./cors.js";
