# Ai-Website-API (backend)

## Overview

The Express 5 API behind Apexium AI. It handles auth (Better Auth), projects, versions, chat history, credits, and calls OpenRouter to generate website HTML. It deploys to Render and the frontend reaches it through a Vercel rewrite of `/api/*`.

## Key files

| File | Owns |
|---|---|
| `server.ts` | Entry point, loads dotenv and starts `lib/app.ts` on `PORT` (default 5000) |
| `lib/app.ts` | Express app: CORS, health routes, the Better Auth handler, route mounting, error handler |
| `lib/auth.ts` | Better Auth setup (email OTP over Gmail SMTP, Google OAuth, cookie attributes) |
| `lib/env.ts` | `isProduction()`, auth URL resolution, the env status used by `/api/health` |
| `lib/cors.ts` | Production URLs and the trusted origin list |
| `middlewares/auth.ts` | `protect`, sets `req.userId` or returns 401 |
| `config/openai.ts` | OpenAI SDK client pointed at `https://openrouter.ai/api/v1` |
| `lib/extractCode.ts` | Pulls a full HTML document out of an LLM reply, returns `null` if none |
| `lib/htmlToSchema.ts` | Converts between generated HTML and editor components |
| `controller/userController.ts` | Project creation and the background generation job, credits |
| `controller/projectController.ts` | Revisions, edits by prompt, rollback, publish list, saves |
| `controller/editingController.ts` | Visual editor page data (`pageData`) |

## Commands

```bash
npm run dev            # nodemon + tsx on :5000
npx tsc --noEmit       # typecheck
npm run build          # prisma generate && tsc into dist/
npm start              # node dist/server.js
npx prisma migrate dev --name <change>
```

`npm install` runs `prisma generate` on its own (postinstall).

## Conventions

- Routes are mounted in `lib/app.ts` under `/api/user`, `/api/project`, `/api/editing`. `websiteRoutes` is mounted with no prefix, so its routes spell out the full `/api/...` path.
- Generation never blocks the response: the controller deducts credits, sends `res.json(...)`, then starts the job with `void generateProjectWebsite(...)`. The frontend polls.
- If `extractHtmlCode` returns `null`, abort the operation and refund. Never save empty code over an existing version.
- The model id is a string literal in each controller (`'gpt-oss-120b'`), not a shared constant. Change all of them together.
- Env vars: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AI_API_KEY` (or `OPENAI_API_KEY`), `SMTP_USER`, `SMTP_PASS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, optional `TRUSTED_ORIGINS` (comma list), `FRONTEND_URL`, `API_URL`.

## Gotchas

- The Better Auth handler (`/api/auth/*splat`) is registered before `express.json()`. Keep it there, because Better Auth reads the raw body itself.
- `isProduction()` is true when `RENDER=true`, even if `NODE_ENV` says development. Production means `secure` cookies with `sameSite: "none"`. Locally it is `lax`.
- `BETTER_AUTH_URL` must be the frontend URL, not the API URL. Auth runs through the frontend origin, and `/api/health` reports `authUrlMisconfigured` when this is wrong.
- `tsconfig.json` turns on `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` on top of `strict`, so optional fields and indexed reads need explicit handling.
- Prisma 7: the connection URL lives in `prisma.config.ts`, not in `schema.prisma`, and the client uses the `@prisma/adapter-pg` driver adapter.
- The `@/*` path alias in `tsconfig.json` points at a `src/` folder that does not exist here. Use relative imports with a `.js` extension.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
