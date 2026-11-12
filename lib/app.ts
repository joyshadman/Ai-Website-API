import express from "express";
import cors from "cors";
import { originCheck } from "../middlewares/originCheck.js";
import { securityHeaders } from "../middlewares/securityHeaders.js";
import { limits } from "../middlewares/rateLimit.js";
import { finalErrorHandler } from "./http.js";
import prisma from "./prisma.js";
import { toNodeHandler } from "better-auth/node";
import { getTrustedOrigins, PRODUCTION_API, PRODUCTION_FRONTEND } from "./cors.js";
import { getEnvStatus, getBetterAuthUrl, isProduction } from "./env.js";
import userRoutes from "../routes/userRoutes.js";
import projectRoutes from "../routes/ProjectRoutes.js";
import editingRoutes from "../routes/editingRoutes.js";
import websiteRoutes from "../routes/websiteRoutes.js";
import configRoutes from "../routes/ConfigRoutes.js";
import { aiTestGet, aiTestPost } from "../controller/aiTestController.js";
import { serveMedia } from "./media.js";

const app = express();
const trustedOrigins = getTrustedOrigins();

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (!origin || trustedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie", "X-Requested-With"],
};

app.disable("x-powered-by"); // spec 0032
// Client IPs for rate limits (spec 0033 AC-7): Vercel rewrite, then Render's proxy, in production.
app.set("trust proxy", isProduction() ? 2 : "loopback");
app.use("/api", limits.all);
app.use(securityHeaders);
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(originCheck(trustedOrigins)); // spec 0029: no state changes from untrusted origins

// Configuration details only outside production (spec 0034): they help setup, and help attackers too.
app.get("/", (_req, res) => {
  if (isProduction()) return void res.json({ ok: true });
  res.json({ ok: true, message: "Server is running", trustedOrigins, env: getEnvStatus() });
});

// Uploaded files (scope feature 13): a redirect to the public bucket, so the frontend needs no storage host.
app.get("/media/*splat", serveMedia);

// Uptime monitors call this (spec 0036): 200 only when the database answers within 3 s.
async function databaseAnswers(): Promise<boolean> {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
    ]);
    return true;
  } catch {
    return false;
  }
}

app.get("/api/health", async (_req, res) => {
  const env = getEnvStatus();
  const ready = env.hasDatabaseUrl && env.hasAuthSecret && (await databaseAnswers());
  if (isProduction()) return void res.status(ready ? 200 : 503).json({ ok: ready }); // spec 0034
  res.status(ready ? 200 : 503).json({
    ok: ready,
    trustedOrigins,
    betterAuthUrl: getBetterAuthUrl(),
    frontend: PRODUCTION_FRONTEND,
    api: PRODUCTION_API,
    env,
    hint: ready ? undefined : "Set DATABASE_URL and BETTER_AUTH_SECRET on the API, then redeploy.",
  });
});

// Dev only (spec 0010): each POST spends a request from the shared free AI limit.
if (!isProduction()) app.get("/api/ai-test", aiTestGet);

app.all("/api/auth/*splat", async (req, res) => {
  try {
    const { getAuth } = await import("./auth.js");
    const auth = getAuth();
    if (!auth) {
      res.status(503).json(isProduction() ? { error: "Sign in isn't available right now." } : { error: "Auth not configured", env: getEnvStatus() });
      return;
    }
    return toNodeHandler(auth)(req, res);
  } catch (err) {
    console.error("Auth handler error:", err);
    if (isProduction()) return void res.status(503).json({ error: "Sign in isn't available right now." }); // spec 0034
    const message = err instanceof Error ? err.message : "Auth not configured";
    res.status(503).json({ error: message, env: getEnvStatus() });
  }
});

app.use(express.json({ limit: "6mb" })); // spec 0033 AC-3

app.use("/api/user", userRoutes);
app.use("/api/project", projectRoutes);
app.use("/api/editing", editingRoutes);
app.use("/api/config", configRoutes); // public, no auth (spec 0021)
app.use(websiteRoutes);

if (!isProduction()) app.post("/api/ai-test", aiTestPost);

// Unknown API routes answer in JSON, not Express's HTML page (spec 0033 AC-6).
app.use("/api", (_req, res) => { res.status(404).json({ error: "Not found" }); });
app.use(finalErrorHandler); // spec 0033 AC-6: clear 4xx for bad JSON and size, a safe 500 otherwise

export default app;
