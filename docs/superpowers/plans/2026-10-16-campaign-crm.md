# Campaign CRM Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** Extend existing My Control with persistent contact import, two-step campaigns, delivery tracking and campaign-aware CRM/bot.
**Architecture:** Supabase is canonical. Campaigns enqueue into existing outbound queue; a versioned worker supports video and remains disabled until installation is verified. Existing bot and owner auth are retained.
**Tech Stack:** Next.js, TypeScript, PostgreSQL, n8n, WAHA.
**Spec:** docs/superpowers/specs/2026-10-16-campaign-crm-design.md

## Global Constraints
- Preserve old data, project and URLs; additive schema only.
- Never silently activate a campaign or bot; owner launches each campaign.
- No blind retry for UNKNOWN. Existing worker cannot claim campaign jobs.
- Consent and takeover rechecked at send time; reply stops remaining promotional steps.

## Review Focus
- Duplicate import never reverses opt-out.
- Two-step jobs never reverse order or continue after a reply.
- Expired worker heartbeat blocks scheduling, not contact management.
- Manual takeover and bot disabled remain authoritative.
- Unsupported video or malformed input fails visibly before launch.

### Task 1: Data and queue
Files: database/005_campaigns.sql, tests/campaigns.cjs.
Interfaces: mc_save_campaign(jsonb), mc_campaign_action(uuid,text), mc_claim_outbound_v2(text), mc_campaign_contact_import(jsonb).
- [x] Add behavioral SQL tests for dedupe/opt-out, 1,000 recipients, ordered steps, pause/cancel, new reply, UNKNOWN, permissions.
- [x] Run node --test tests/campaigns.cjs; observe missing-feature failures.
- [x] Implement additive schema and transactional functions; preserve old claim API but exclude campaign kind.
- [x] Run campaign and existing SQL tests.

### Task 2: API and UI
Files: lib/campaigns.ts, app/api/campaigns/route.ts, app/campaigns/page.tsx, app/contacts/page.tsx, components/Shell.tsx, app/globals.css.
Interfaces: authenticated same-origin business API; preview import and campaign draft before launch.
- [x] Test normalization, CSV quoting, template variables, request validation.
- [x] Implement contacts, editor, progress and detail; mobile five-item navigation.
- [x] Typecheck and production build.

### Task 3: Bot/worker and rollout
Files: workflows/production/03-outbound.json, database/005_campaigns.sql, docs/campaign-rollout.md.
Interfaces: v2 claim returns media/session/attempt; heartbeat explicitly reports worker version.
- [x] Exercise inbound cancellation, AI campaign context, receipt updates and per-product opportunity tracking in SQL tests.
- [x] Upgrade exported worker to sendText/sendVideo, heartbeat and preflight check, retaining UNKNOWN on ambiguity.
- [x] Run whole test suite and build; audit diff for exposed credentials.
- [ ] Apply verified additive migration, push GitHub and inspect production deployment SHA. (Migration applied; release verification next.)
- [ ] Install worker only if authenticated n8n access is available; otherwise report exact activation dependency and leave scheduling blocked. (Access unavailable; blocked.)

## Execution ledger
- Owner explicitly requested immediate execution. Native execution in fresh task checkout/feature branch; no extra approval loop.
- No customer messages will be sent as part of synthetic QA. Production activation remains a user action in app.

- Review: important concurrency/consent/preflight/test-contact issues fixed. Native SQL/workflow suites pass; local HTTP import/draft/auth tests pass. Live WAHA/n8n activation remains unverified and blocked without instance access.
