export const PRODUCTION_FRONTEND = process.env.FRONTEND_URL?.trim() || "https://ai-website-henna-eight.vercel.app";
export const PRODUCTION_API = process.env.API_URL?.trim() || "https://ai-website-api.onrender.com";

// Same rule as isProduction() in env.ts (kept local: env.ts imports this file).
const IS_PRODUCTION = process.env.RENDER === "true" || process.env.NODE_ENV === "production";

// Local development origins are trusted only outside production (spec 0034).
const LOCAL_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3000",
  "http://localhost:4173",
  "http://localhost:5000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:3000",
];

const DEFAULT_ORIGINS = IS_PRODUCTION ? [PRODUCTION_FRONTEND] : [...LOCAL_ORIGINS, PRODUCTION_FRONTEND];

export function getTrustedOrigins(): string[] {
  const fromEnv = (process.env.TRUSTED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  return [...new Set([...DEFAULT_ORIGINS, ...fromEnv])];
}
