# Cloudflare Deployment Guide

ApplyFlow is now wired for a first real Cloudflare deployment target:

- Static assets from `public/`
- Worker runtime entry at `cloudflare/worker-entry.js`
- D1 schema at `cloudflare/d1/schema.sql`
- D1 seed export at `cloudflare/d1/seed.sql`

## Runtime split

- Frontend assets: served through the Worker static assets binding
- API routes: handled by the Worker `fetch()` entry
- Database: Cloudflare D1
- Local fallback: Node + SQLite

## Required setup

1. Authenticate:

```bash
wrangler login
```

or set a token:

```bash
set CLOUDFLARE_API_TOKEN=your_token
```

2. Create D1:

```bash
wrangler d1 create applyflow
```

3. Copy the returned `database_id` into `wrangler.jsonc`

4. Apply schema:

```bash
npm run cf:d1:execute:schema
```

5. Export and import data:

```bash
npm run export:d1-seed
npm run cf:d1:execute:seed
```

6. Set secrets:

```bash
wrangler secret put LLM_API_KEY
wrangler secret put SESSION_SECRET
```

7. Deploy:

```bash
npm run cf:deploy
```

8. Local Cloudflare preview:

```bash
npm run cf:dev
```

## Notes

- The Worker runtime uses a request-scoped in-memory bridge on top of D1 so the existing synchronous orchestrator/store flow can keep running during this deployment stage.
- This keeps the current product stable while allowing a real online test deployment.

## LLM provider configuration

ApplyFlow now reads a provider-agnostic OpenAI-compatible configuration surface.

Recommended Worker vars:

```bash
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

Secret:

```bash
wrangler secret put LLM_API_KEY
```

To switch the deployed app to GLM, keep the same API shape and update the vars:

```bash
wrangler secret put LLM_API_KEY
```

Then set these non-secret vars in `wrangler.jsonc` or your Cloudflare environment config and redeploy:

```bash
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4/
LLM_MODEL=glm-4.5-air
```
