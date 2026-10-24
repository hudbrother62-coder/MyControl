# WhatsApp Session Manager Implementation Plan

Goal: Recover the existing CS2 production worker and manage future sessions from My Control.
Architecture: Existing owner-authenticated Next.js backend proxies WAHA. Supabase cutover settings are canonical; the same n8n workflow reads them per poll and inbound event. Session transitions fail closed and never enqueue campaigns.

Constraints: Preserve draft 3 tiga (90 recipients), UNKNOWN jobs, contact exclusions and consent; AI and follow-up OFF. Never fabricate heartbeat. Preserve node IDs, webhook ID and credentials.

- [x] Backup live workflow and inspect routing, identity, heartbeat and queue.
- [x] Recover CS2 live routing; verify real worker heartbeat.
- [ ] Add tested identity/readiness policy, owner-only WAHA API, bounded read retry, session controls and audit.
- [ ] Add atomic selection RPC and configuration read wrapper; block running/scheduled campaigns and pending queue during switching.
- [ ] Make inbound/outbound workflow consume canonical session and identity; preserve webhook.
- [ ] Add responsive Settings → WhatsApp & Sesi and Blash sender selector.
- [ ] Verify tests, typecheck, build, commit/push main, deployment SHA and production UI.
- [ ] Send only owner-authorized self text/poster; verify gateway IDs and draft preservation.

Review focus: stale/future heartbeat, identity/LID mismatch, concurrent session change, partial webhook failure, uncertain send outcomes (no blind retry).
