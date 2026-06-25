export const PRODUCTION_FRONTEND = process.env.FRONTEND_URL?.trim() || "https://ai-website-henna-eight.vercel.app";
export const PRODUCTION_API = process.env.API_URL?.trim() || "https://ai-website-api.onrender.com";

const DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:4173",
  "http://localhost:5000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
  PRODUCTION_FRONTEND,
];

export function getTrustedOrigins(): string[] {
  const fromEnv = (process.env.TRUSTED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  return [...new Set([...DEFAULT_ORIGINS, ...fromEnv])];
}
