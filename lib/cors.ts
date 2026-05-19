/** Frontend origins allowed to call the API (CORS + better-auth trustedOrigins). */
export const PRODUCTION_FRONTEND = "https://ai-website-henna-eight.vercel.app";
export const PRODUCTION_API = "https://ai-website-api.vercel.app";

const DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  PRODUCTION_FRONTEND,
];

export function getTrustedOrigins(): string[] {
  const fromEnv = (process.env.TRUSTED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  return [...new Set([...DEFAULT_ORIGINS, ...fromEnv])];
}
