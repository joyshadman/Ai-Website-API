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
| `controller/userController.ts` | Project creation, credits |
| `lib/generationJobs.ts` | The in memory registry of running generations, the model call, credit deduction and refunds |
| `lib/designPrompt.ts` | Design rules for generated sites. `lib/designChecks.ts` checks the same names and limits, so change both together |
| `lib/plainCssPrompt.ts` | Output rules for plain CSS sites. The importer in `lib/cssResolve.ts` relies on that shape, so change both together |
| `lib/media.ts` | Object storage for uploads, plus upload size and rate limits |
| `controller/assetController.ts` | Project uploads: list, upload, alt text, delete |
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
- Generation never blocks the response: the controller deducts credits, sends `res.json(...)`, then starts the job with `void runGenerationJob(...)`. The frontend polls.
- If `extractHtmlCode` returns `null`, abort the operation and refund. Never save empty code over an existing version.
- The model id (`'gpt-oss-120b'`) is written in two places, `lib/generationJobs.ts` and `controller/aiTestController.ts`, not a shared constant. Change both together.
- `lib/links.ts`, `siteStyles.ts`, `animations.ts`, and `logo.ts` are copied by hand in `Ai-Website/src/lib/`. Change both copies together. The header comment in each file says what must match.
- Env vars: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AI_API_KEY` (or `OPENAI_API_KEY`), `SMTP_USER`, `SMTP_PASS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, optional `TRUSTED_ORIGINS` (comma list), `FRONTEND_URL`, `API_URL`. Uploads also need `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `MEDIA_BUCKET`.

## Gotchas

- The Better Auth handler (`/api/auth/*splat`) is registered before `express.json()`. Keep it there, because Better Auth reads the raw body itself.
- `isProduction()` is true when `RENDER=true`, even if `NODE_ENV` says development. Production means `secure` cookies with `sameSite: "none"`. Locally it is `lax`.
- `BETTER_AUTH_URL` must be the frontend URL, not the API URL. Auth runs through the frontend origin, and `/api/health` reports `authUrlMisconfigured` when this is wrong.
- `tsconfig.json` turns on `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` on top of `strict`, so optional fields and indexed reads need explicit handling.
- Prisma 7: the connection URL lives in `prisma.config.ts`, not in `schema.prisma`, and the client uses the `@prisma/adapter-pg` driver adapter.
- The `@/*` path alias in `tsconfig.json` points at a `src/` folder that does not exist here. Use relative imports with a `.js` extension.
- Running generations live in this process's memory (`lib/generationJobs.ts`), so the API assumes a single instance. Running several would need a shared store.
- `npm test` is only a placeholder that exits with an error. No test runner is set up yet.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
