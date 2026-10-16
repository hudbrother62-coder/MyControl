# Verification — Campaign/CRM release, 16 October 2026

- Baseline GitHub main: `9154000ecf682d2f709eb9b257e399727038fd43`.
- Target: existing `hudbrother62-coder/MyControl`, existing Vercel `my-control`, existing Supabase `vpneonfehqfsxclqcman`.
- `npm run typecheck`: PASS.
- `npm test`: 41 tests PASS, including SQL campaign behavior for 1,000 synthetic recipients, opt-out, stale replies, ordered parts, bot gate, receipts and audit.
- `npm run build`: PASS (29 routes, including three new application pages and campaign APIs).
- `node --test tests/campaign-http.cjs`: 3 HTTP integration tests PASS against disposable PostgreSQL adapter. These exercise Next session/CSRF, import persistence/read and launch blocking without worker.
- Read-only independent review: Important findings fixed (stale preflight, consent, bot gate, terminal dependency cleanup, CRM audit, test contact preservation, worker transport health, media pre-send failures and completion reconciliation).
- Migration `mycontrol_005_campaign_crm_bot`: applied successfully on existing database.
- Before/after preserved counts: 3 products, 2 customers, 2 conversations, 9 messages, 0 inbound, 0 outbound.
- Migrated contacts: 2, with consent false. No promotional consent manufactured. Opportunities: 0 because legacy leads yielded none.
- Private media bucket created; anonymous campaign table SELECT and worker RPC EXECUTE denied.
- Actual campaigns created: 0. Actual messages sent: 0. Worker heartbeat rows: 0.

Production deployment is verified separately from the final deployment response/SHA. This file does not certify live WhatsApp delivery, configured Groq credentials, signed-in browser behavior or active n8n workflows. Those require access to the user's actual n8n/WAHA instance and an owner-number acceptance test. See `campaign-rollout.md`.
