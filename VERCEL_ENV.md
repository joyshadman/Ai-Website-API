# Fix Vercel API 500 (ERR_INTERNAL_ASSERTION)

## What caused the crash

Two entry points were loading the same app:

1. `vercel.json` → `server.ts` via `@vercel/node` builds
2. `api/index.ts` → `lib/app.ts`

That double-import triggers: **"module imported again after being required"**.

## Fix (already in repo)

- **One entry:** `api/index.ts` only
- **App code:** `lib/app.ts`
- **Local dev:** `npm run dev` → `server.ts`
- **No** `builds` / `routes` / rewrites in `vercel.json`

## Required Vercel env vars

| Name | Value |
|------|--------|
| `DATABASE_URL` | Neon PostgreSQL URL |
| `BETTER_AUTH_SECRET` | Your secret string |
| `BETTER_AUTH_URL` | `https://ai-website-api.vercel.app` |
| `TRUSTED_ORIGINS` | `http://localhost:5173,https://ai-website-henna-eight.vercel.app` |
| `OPENAI_API_KEY` | Your key |

Redeploy, then open: https://ai-website-api.vercel.app/api/health
