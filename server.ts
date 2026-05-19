import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { auth } from './lib/auth.js';
import { toNodeHandler } from 'better-auth/node';
import userRoutes from './routes/userRoutes.js';
import projectRoutes from './routes/ProjectRoutes.js';
import { getTrustedOrigins, PRODUCTION_API, PRODUCTION_FRONTEND } from './lib/cors.js';

const app = express();
const port = Number(process.env.PORT) || 3000;
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
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.all('/api/auth/*splat', toNodeHandler(auth));

app.use(express.json({ limit: '50mb' }));

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    message: 'Server is running',
    trustedOrigins,
    vercel: Boolean(process.env.VERCEL),
  });
});

/** Debug endpoint — check CORS / deployment from the browser or curl */
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    trustedOrigins,
    betterAuthUrl: process.env.BETTER_AUTH_URL || '(default)',
    frontend: PRODUCTION_FRONTEND,
    api: PRODUCTION_API,
    vercel: Boolean(process.env.VERCEL),
    nodeEnv: process.env.NODE_ENV,
  });
});

app.use('/api/user', userRoutes);
app.use('/api/project', projectRoutes);

app.use(
  (
    err: Error & { status?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    if (err.message?.startsWith('CORS blocked')) {
      return res.status(403).json({ error: err.message, trustedOrigins });
    }
    console.error(err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
);

export default app;

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log('Trusted origins:', trustedOrigins.join(', '));
  });
}
