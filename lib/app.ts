import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { getTrustedOrigins, PRODUCTION_API, PRODUCTION_FRONTEND } from "./cors.js";
import { getEnvStatus, getBetterAuthUrl } from "./env.js";
import userRoutes from "../routes/userRoutes.js";
import projectRoutes from "../routes/ProjectRoutes.js";
import editingRoutes from "../routes/editingRoutes.js";
import websiteRoutes from "../routes/websiteRoutes.js";

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

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "Server is running",
    trustedOrigins,
    env: getEnvStatus(),
  });
});

app.get("/api/health", (_req, res) => {
  const env = getEnvStatus();
  const ready = env.hasDatabaseUrl && env.hasAuthSecret;
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

app.all("/api/auth/*splat", async (req, res) => {
  try {
    const { getAuth } = await import("./auth.js");
    const auth = getAuth();
    if (!auth) {
      res.status(503).json({ error: "Auth not configured", env: getEnvStatus() });
      return;
    }
    return toNodeHandler(auth)(req, res);
  } catch (err) {
    console.error("Auth handler error:", err);
    const message = err instanceof Error ? err.message : "Auth not configured";
    res.status(503).json({ error: message, env: getEnvStatus() });
  }
});

app.use(express.json({ limit: "50mb" }));

app.use("/api/user", userRoutes);
app.use("/api/project", projectRoutes);
app.use("/api/editing", editingRoutes);
app.use(websiteRoutes);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

export default app;
