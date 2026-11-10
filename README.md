# AI Website Builder — Backend API

Express + TypeScript API for the AI-powered website builder. Handles authentication, AI code generation via OpenRouter, project versioning, and the visual editor's data layer.

## Tech Stack

- **Express 5** with TypeScript
- **Prisma 7** ORM with PostgreSQL (Neon via `@prisma/adapter-pg`)
- **Better Auth** — authentication (email OTP + Google OAuth)
- **OpenAI SDK** (OpenRouter) — AI code generation (free models, see `config/aiModels.ts`)
- **JSDOM** — HTML-to-component schema parsing
- **Nodemailer** — transactional emails (OTP via Gmail SMTP)
- **dotenv** — environment configuration

## Requirements

- Node.js >= 20
- npm or yarn
- PostgreSQL database (Neon recommended)

## Environment Variables

```env
# Server
PORT=5000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@host:port/db?sslmode=require

# Authentication
BETTER_AUTH_SECRET=your-secret-key
BETTER_AUTH_URL=http://localhost:5173

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Email OTP (Gmail SMTP — use an App Password, not your regular password)
SMTP_USER=you@gmail.com
SMTP_PASS=your-gmail-app-password

# AI / OpenRouter
AI_API_KEY=sk-or-v1-your-key
OPENAI_API_KEY=sk-or-v1-your-key
# Optional comma separated list; only ids ending in :free are used
AI_MODELS=

# CORS / URLs
FRONTEND_URL=https://your-frontend.com
API_URL=https://your-api.com
TRUSTED_ORIGINS=http://localhost:5173,http://localhost:3000
```

## Quick Start

> **Note:** This is the backend API. The frontend (`Ai-Website/`) must also be running for a full dev environment.

### 1. Configure environment

Create `.env` in this directory with the variables listed below. At minimum set:
- `DATABASE_URL` — PostgreSQL connection string
- `AI_API_KEY` — OpenRouter API key
- `BETTER_AUTH_SECRET` — any random string (run `openssl rand -hex 32`)

### 2. Install dependencies

```bash
npm install
```

The `postinstall` hook runs `prisma generate` automatically.

### 3. Sync database schema

```bash
npx prisma db push
```

### 4. Start the server

```bash
npm run dev
```

Runs at **http://localhost:5000**.

### 5. Start the frontend (separate terminal)

```bash
cd ../Ai-Website
npm install
npm run dev                  # http://localhost:5173
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Nodemon + tsx watch mode (auto-restarts on changes) |
| `npm run build` | Prisma generate + TypeScript compilation |
| `npm start` | Run compiled JS from `dist/server.js` |
| `npm test` | Placeholder (no tests configured) |
| `npm run vercel-build` | Prisma generate (used by Vercel) |

## Project Structure

```
├── server.ts              # Entry point — starts Express
├── lib/
│   ├── app.ts             # Express app setup, CORS, routes
│   ├── auth.ts            # Better Auth configuration
│   ├── cors.ts            # CORS origin management
│   ├── env.ts             # Environment helpers
│   ├── prisma.ts          # Prisma client (PostgreSQL adapter)
│   └── htmlToSchema.ts    # HTML → editor component parser
├── config/
│   └── openai.ts          # OpenAI / OpenRouter client
├── controller/            # Route handler functions
│   ├── userController.ts
│   ├── projectController.ts
│   ├── websiteController.ts
│   └── editingController.ts
├── routes/                # Express route definitions
│   ├── userRoutes.ts
│   ├── ProjectRoutes.ts
│   ├── websiteRoutes.ts
│   └── editingRoutes.ts
├── middlewares/
│   └── auth.ts            # Auth middleware (protect)
├── types/
│   └── express.d.ts       # Express type extensions
└── prisma/
    ├── schema.prisma       # Database schema
    └── migrations/         # Migration history
```

## API

**Base URL:** `http://localhost:5000` (dev)

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Server health + env status |
| GET | `/api/health` | Detailed health check |
| GET | `/api/ai-test` | AI provider/model/config status (no secrets) |
| POST | `/api/ai-test` | Run a single live AI request (`{"prompt": "..."}`) for diagnostics |
| ALL | `/api/auth/*` | Better Auth routes (sign-in, sign-up, OTP, OAuth) |
| GET | `/api/project/published` | List published community websites |
| GET | `/api/project/project/:projectId` | Get published project code |
| GET | `/api/editing/public/:projectId` | Get public editor page data |

### Protected Endpoints

All protected routes require a valid session cookie (handled by Better Auth).

#### User

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/user/credit` | Get current credit balance |
| POST | `/api/user/project` | Create a new AI website project |
| GET | `/api/user/project/:projectId` | Get project details |
| GET | `/api/user/projects` | List all user's projects |
| POST | `/api/user/purchase-credits` | Purchase credit package |

#### Projects

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/project/revision/:projectId` | AI revision (costs 5 credits) |
| POST | `/api/project/edit/:projectId` | AI edit by natural language prompt (costs 5 credits) |
| POST | `/api/project/rollback/:projectId/:versionId` | Rollback project to a specific version |
| PUT | `/api/project/save/:projectId` | Manually save project code |
| GET | `/api/project/preview/:projectId` | Get project preview data |
| PUT | `/api/project/published/:projectId` | Toggle published status |
| DELETE | `/api/project/:projectId` | Delete project and all versions |

#### Editing (Visual Editor)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/editing/tools` | List available editor tools/components |
| GET | `/api/editing/page/:projectId` | Get editor page component tree |
| PUT | `/api/editing/page/:projectId` | Save editor page layout |
| POST | `/api/editing/page/:projectId` | Update editor page |
| POST | `/api/editing/page/:projectId/publish` | Publish from editor |
| GET | `/api/editing/page/:projectId/history` | Get editor change history |

#### Websites

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/websites/:id` | Get website data |
| PUT | `/api/websites/:id` | Update website |
| DELETE | `/api/websites/:id` | Delete website |
| GET | `/api/editor/:websiteId` | Get editor data for a website |

## Authentication

Uses **Better Auth** with two methods:

- **Google OAuth** — Social sign-in via Google
- **Email OTP** — Passwordless codes delivered via SMTP (Gmail)

Sessions are managed with HTTP-only cookies: `httpOnly` always, plus `secure` and `sameSite: none` in production (needed for the Vercel frontend → Render API cross-site flow). In development they fall back to non-secure `sameSite: lax`.

The `protect` middleware (`middlewares/auth.ts`) validates the session on every protected route.

## Database

PostgreSQL schema managed via Prisma:

- **User** — accounts, credits, creation count
- **WebsiteProject** — AI-generated projects with code, version tracking, publish state
- **Version** — snapshots of project code at different points
- **Conversation** — chat history between user and AI assistant
- **Transaction** — credit purchase records
- **Session / Account / Verification** — Better Auth tables

## AI Integration

Uses the OpenAI SDK pointed at **OpenRouter** (`https://openrouter.ai/api/v1`).

- Models: free models only, from `AI_MODELS` or the default list in `config/aiModels.ts`. Each generation tries up to 3 in turn.
- `/api/ai-test` is available outside production only, because each POST spends a shared free request
- Prompt expansion is folded into the generation call (no separate enhancement request)
- Each AI revision/edit costs **5 credits**
- Credits are **auto-refunded** if the AI call fails
- URLs in user prompts are **scraped** and injected as design references

## Deployment

Deploy to Render (backend) — the frontend is a Vite SPA hosted on Vercel:

1. Set the root directory to `Ai-Website-API`
2. Build command: `npm run build`
3. Start command: `npm start`
4. Set all environment variables in the Render dashboard
5. **Important — production cookie behavior:** Better Auth uses `SameSite=None; Secure` only when running in production. Render injects `RENDER=true` automatically, but if `NODE_ENV` is overridden to `development` in the dashboard, cross-site sessions break (cookies are not persisted for Vercel → Render requests). Ensure `NODE_ENV=production` (or leave `RENDER=true` set by Render) so OTP/Google sessions work from the Vercel frontend.
6. Set `BETTER_AUTH_URL=https://ai-website-henna-eight.vercel.app` in production so auth callbacks point at the real frontend.

## Troubleshooting

- **`BETTER_AUTH_SECRET is not set`** — Add it to `.env`. Generate one with `openssl rand -hex 32`
- **Prisma connection error** — Verify `DATABASE_URL` and that the database accepts connections
- **AI calls fail** — Check `AI_API_KEY` is valid and has credits on OpenRouter; diagnose with `GET /api/ai-test` then `POST /api/ai-test` with a prompt
- **OTP emails not sent** — Verify `SMTP_USER` and `SMTP_PASS` (use a Gmail app password, not your regular password). If SMTP is not configured the OTP request fails fast (returns success but logs the error and sends nothing) — never rely on OTP without valid SMTP
- **Login works locally but not in production** — Check `/api/health` shows `nodeEnv` / `betterAuthUrl` matching production; if the cookie is missing cross-origin, confirm `NODE_ENV=production` and `RENDER=true` on Render so cookies are `SameSite=None; Secure`
- **CORS blocking requests** — Ensure the frontend origin is in `TRUSTED_ORIGINS`
