# Kendaliku / MyControl — Windows local activation (13 Oct 2026)

**State intentionally PAUSED.** Supabase My Control `vpneonfehqfsxclqcman` is ACTIVE_HEALTHY and has queue/reliability/knowledge migrations applied. The bot master switch was deliberately set to **OFF** (verified `bot_settings.bot_enabled=false` and synced `mc_runtime_knowledge`), pending customer-endpoint acceptance tests. **Do not re-run migrations or rebuild legacy customer/order tables.**

## What's prepared
- Main Vercel dashboard: https://my-control-snowy.vercel.app
- Source n8n files: [4 inactive workflows](../../workflows/production/README.md), pinned to prior tested commit `05216cde0efd26e81ad1e348579e00d7eeaa7042`.
- Legacy `workflows/mycontrol.json` remains untouched for recovery. **Never activate old + new inbound concurrently.**
- A separate self-contained **Windows launcher ZIP** was produced in the ChatGPT conversation with 6 PowerShell scripts (health check; download pinned workflows; optional n8n API import; optional create missing WAHA session; final health; cryptographic webhook-secret generation), templates and acceptance checklist. It is a separate conversation attachment, not automatically installed or hosted by this repository. Do not mistake the repo for that ZIP.

## Start sequence (Windows Docker Desktop + n8n)
1. Start Docker Desktop and confirm WAHA `http://localhost:3000/dashboard/`, n8n `http://localhost:5678/`.
2. WAHA Workers: edit API address/key, **Connect**. API authorization is via `X-Api-Key`, not dashboard password. Verify `GET /api/sessions`.
3. Create session `default` only if missing; scan WhatsApp linked-device QR until `WORKING`. Avoid logout/reset of existing session.
4. Import `01-waha-inbound.json`, `02-ai-worker.json`, `03-outbound.json`, `04-followup.json` as **inactive**, either via n8n UI **Import from File** or public API `POST /api/v1/workflows` with `X-N8N-API-KEY`. Never overwrite similarly named workflows automatically.
5. Configure server-side n8n env: `SUPABASE_URL=https://vpneonfehqfsxclqcman.supabase.co`, `SUPABASE_SERVICE_ROLE_KEY`, `WAHA_API_KEY`, `WAHA_SESSION=default`, `N8N_WORKER_ID`, Gemini models currently accessible to the configured API key, and `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` only if the instance's access policy permits environment expressions. Keep `N8N_ENCRYPTION_KEY` unchanged.
6. For n8n running **on Windows** and WAHA in Docker exposed on port 3000: `WAHA_BASE_URL=http://127.0.0.1:3000`. For n8n Docker and WAHA on shared Docker network use `http://waha:3000`, or `http://host.docker.internal:3000` for separately published host port.
7. Select Gemini credentials in **each** n8n model node, and on the n8n inbound webhook configure Header Auth `X-MyControl-Secret` with a generated strong secret. WAHA `default` session config should have a **single** `message` webhook and custom header of the same name/value:
   - WAHA **container** → n8n **Windows host**: `http://host.docker.internal:5678/webhook/mycontrol/waha/inbound`
   - Same Docker network: `http://n8n:5678/webhook/mycontrol/waha/inbound`
8. Use test numbers and verify inbound/dedupe, AI reply/receipt, human takeover, owner payment approval, opt-out/follow-up cancellation, provider errors/429, and restart persistence. Start components gradually; only after tests pass set **master bot ON** from dashboard Automation.

## Production control-plane limitation
Vercel cannot contact a local Windows `localhost` WAHA or n8n instance. Supabase-backed features can run remotely, but WhatsApp real-time health/manual outbound from Vercel require an authenticated, secure **public HTTPS endpoint/private tunnel** or an always-on hosted worker. Do not put WAHA/ n8n API unsecured on the public internet.

## Safety contract
- Keep all secrets in n8n credentials, server environment variables, or private local configuration (never GitHub/frontend/console screenshots).
- Do not delete Docker session/n8n data volumes, change n8n encryption key, or overwrite old webhook config without backup.
- WhatsApp WAHA is unofficial and can cause account restrictions; use a dedicated test/support number initially.
- Do not claim production-ready solely because Vercel shows READY or a WAHA API send returns `SENT`.
- Current local n8n import, WhatsApp QR session and end-to-end delivery remain **unverified** until the owner runs the installer.

References: [WAHA sessions](https://waha.devlike.pro/docs/how-to/sessions/), [WAHA webhook headers](https://waha.devlike.pro/docs/how-to/events/), [n8n API documentation](https://docs.n8n.io/api/).
