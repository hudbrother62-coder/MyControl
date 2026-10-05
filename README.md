# My Control — Bantu Beres Sales Center

Dashboard, owner Telegram bot and durable WhatsApp queue. This update prepares the integration contract. It does **not** apply Supabase migrations, import/activate n8n workflows, or modify WAHA sessions.

## Validation

Run `npm ci`, `npm test`, `npm run typecheck`, `npm run build`.

Tests execute PostgreSQL SQL using PGlite, workflow JavaScript, authentication/CSRF and Telegram failure isolation. Actual n8n import/runtime, Gemini, provider delivery and the existing Supabase business schema still require activation testing.

## Supabase — deferred installation

Existing business tables (`products`, `customers`, `leads`, `orders`, `payment_verifications`, `payment_evidence`, `conversations`, `messages`, `bot_settings`) and `login_mycontrol` remain required. No business data is replaced.

Back up, then apply `database/001_queue.sql`, `002_reliability.sql`, `003_business_sync.sql` in that order during a maintenance window. The queue is restricted to service-role access. Migration 003 transactionally mirrors product/settings edits into official AI knowledge. Review existing business-table RLS and payment triggers separately; this code change does not revoke old public database policies.

## Vercel configuration

See root `.env.example`. Existing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are accepted by login. Backend database access uses `SUPABASE_SERVICE_ROLE_KEY`. The browser uses authenticated same-origin APIs, not direct database keys.

Login calls the existing login RPC and issues a signed eight-hour HttpOnly session. All database endpoints require authentication; mutations require same-origin requests. Set a dedicated strong `SESSION_SECRET`; the service-role key is a compatibility fallback. This is an owner control center, not a new multi-user authorization system.

Existing `OWNER_TELEGRAM_CHAT_ID` is accepted as an alias for `TELEGRAM_OWNER_CHAT_ID`. Missing owner configuration denies bot commands. Missing backend configuration returns unavailable states rather than fake Connected labels.

The Git-connected `main` branch deploys automatically. With Supabase deferred, queue-backed inbox/Telegram features remain unavailable until migrations are applied. For health checks, Vercel must be able to reach the configured n8n/WAHA URL; localhost on a remote VPS is not reachable from Vercel.

## n8n / WAHA installation

Import `workflows/mycontrol.json` as inactive; do not run old and new My Control inbound workflows concurrently.

Set n8n env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WAHA_BASE_URL`, `WAHA_API_KEY`, `WAHA_SESSION`, `N8N_WORKER_ID`, `GEMINI_PRIMARY_MODEL`, `GEMINI_FALLBACK_MODEL`. Select four actual Gemini credentials. Use model IDs available in your Google project; historical Gemini 3.5 names are no longer hardcoded as assumed available models.

Configure inbound Header Auth credentials: `X-MyControl-Secret` with a generated secret. Add the identical custom header on the WAHA webhook, subscribe to `message`, and use production URL `/webhook/mycontrol/waha/inbound`. Verify custom-header support in your installed WAHA version. JSON contains no secret. Enable n8n environment access only as needed and restrict workflow editors. Node-version/import compatibility still needs runtime verification.

`infrastructure/compose.yaml` is an optional VPS template, not an applied configuration. Set tested, pinned image tags; preserve existing encryption key, workflow and WhatsApp session volumes. Configure HTTPS reverse proxy and protected administrative access. Docker-to-Docker WAHA URL is `http://waha:3000`, not localhost.

Bot defaults off. Authenticated owner manual sends remain allowed. Manual sends also enable persistent takeover, released through Return to AI. Unique keys guard enqueue retries. WAHA SENT means accepted by the gateway, not delivered to the customer. Ambiguous sends and expired send leases become UNKNOWN; inspect provider history before any requeue. Never blindly resend UNKNOWN messages. Takeover cannot recall a provider call already in flight.

## Telegram

Owner-authenticated webhook setup. `/status`, `/rekap`, `/pending`, `/closing`, `/payment` read health/business data. Update IDs are claimed durably in PostgreSQL; ambiguous outcomes are UNKNOWN and not automatically resent. Inspect these records before retrying. No automated daily/monthly report scheduler is added in this change.

`legacy/AsistenHarianTelegram.gs` is the separate personal Apps Script bot. It processes later messages even when one fails and records uncertain outcomes under `TELEGRAM_UNKNOWN_UPDATES`. GitHub/Vercel does not deploy this file to Apps Script.

## Activation checklist

Install migrations; verify business schema and payment triggers; populate official product/promo/FAQ; verify model/credentials and n8n import; link WAHA session if needed; test inbound/reply/manual/takeover/Telegram/restart with a test number and actual delivery receipts. Only then activate customer traffic. A successful code deployment alone is not end-to-end production approval.
