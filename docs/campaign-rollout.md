# Campaigns, Contacts and CRM — release and activation

This release extends the existing My Control app and database. No customer blast is launched by deployment or migration. All campaign exports remain inactive until installed and tested.

## Included
- `/campaigns`: draft wizard, up to 1,000 recipients, one/two text or video parts, owner test send, start/schedule in WIB, pause/resume/cancel, global campaign pause, recipient-level accepted/delivered/read/unknown results.
- `/contacts`: CSV/XLSX import preview, duplicate/invalid report, consent/source, persistent opt-out, server search and pagination.
- `/crm`: per-contact/product opportunities, owner notes and follow-up reminders, audited owner stage changes. WON here does not make a payment PAID. Existing `/sales` is retained.
- Private MP4 storage with signed direct uploads (25 MB), signed read URLs created immediately before sending. Codec/playability still requires an actual owner-number test.
- Campaign-aware AI context and sourced historical customer excerpts, bot gate, takeover/freshness checks, opt-out and campaign follow-up suppression, delivery acknowledgment ingestion.

## Database rollout
Apply `database/005_campaigns.sql` once after 001–004. It creates new tables and private bucket, extends outbound columns, wraps existing AI functions and preserves old text-worker contract. Inspect production migration history before applying. Existing business records are not overwritten. Old contact identity is not changed by test sends.

Before migration capture schema/function metadata and row counts; after migration compare products/customers/conversations/messages/inbound/outbound counts. The migration is transactional and additive. Do not re-run it: table/function renames are intentionally one-time. Rollback deployment may retain these new objects; disable campaigns first and keep accepted/UNKNOWN jobs for reconciliation. Never drop history or blindly requeue.

## n8n activation
1. Use the existing n8n instance and encryption key. Export current workflows as rollback copies.
2. Replace old **03 outbound** with `workflows/production/03-outbound.json`. Do not run both versions. Runtime JSON download is available from authenticated Campaigns page.
3. Set existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WAHA_BASE_URL`, `WAHA_API_KEY`, `WAHA_SESSION=default`, `N8N_WORKER_ID`. Secrets stay in server credentials/environment, not workflow JSON or Git.
4. Probe the real WAHA session and send a test video manually to an owner test number. Set `WAHA_VIDEO_VERIFIED=true` only after that test succeeds. Without it text-only campaigns can run but video launch is blocked.
5. Enable v2 outbound. It checks WAHA WORKING before heartbeat/claim, signs private media and rechecks send authorization before transport. Confirm runtime last_seen updates in My Control. The poll is 5 seconds and handles one job per execution; adjust deployment capacity only after measuring provider/server limits. This is not a promise of instant 1,000-message delivery.
6. Replace **01 inbound** with the new export. Configure existing Header Auth credential and identical WAHA custom header; subscribe to `message` and `message.ack`. ACKs update delivery only. Do not run the combined legacy workflow in parallel.
7. Replace **02 AI worker** with the Groq export. Select actual `groqApi` credentials for the four model nodes and a currently available `GROQ_MODEL`; verify provider quota and structured output. Do not confuse Groq with Grok/xAI. Model failover does not remove account quota.
8. Keep **04 follow-up** compatible; campaign customers' proactive follow-up is suppressed in SQL by default. CRM reminder dates do not send messages.
9. Test owner contact: text, video, two-step order, reply→CRM→bot, bot-off, takeover, STOP, receipt, restart and timeout. Only after these pass, prepare a real audience with permission and manually launch from My Control.

## Operational limitations to disclose
- WAHA transport is distinct from the official WhatsApp Business Platform. This release implements WAHA, not a Cloud API connector or Meta template manager.
- UI deployment READY proves web deployment, not active n8n credentials or WhatsApp delivery. Last-seen heartbeat is required for launch; stale heartbeat disables new scheduling. An already in-flight provider request cannot be recalled.
- Source external HTTPS videos must remain accessible; test send checks acceptance but admin must inspect playback. Private uploaded videos are signed per-send.
- Long-term memory is a sourced rolling excerpt (8,000 chars), not an independently verified fact model. Recent history and product/order state remain separate.
- Owner single-workspace/session `default` only; reject other sessions instead of conflating identities. Full multi-account identity mapping and LID resolution need separate migration before enabling more numbers.
- Existing business-table public policies are a historical security issue outside this new private subsystem; do not claim the entire application's authorization has been audited. New campaign/memory tables and functions deny anon/authenticated access and use owner-session API.
- Tests use 1,000 synthetic recipients and a PostgreSQL simulator. They never send 1,000 real WhatsApp messages.
