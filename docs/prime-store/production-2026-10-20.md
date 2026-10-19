# PRIME STORE production repair — 20 October 2026

Baseline: `f30a0ab026a980aa8af98ac6343eb56033795122` on `main`.

## Applied and verified

- Existing n8n workflow `sBxYeXeIGD2OvaLV` was updated and published in place. Node IDs, credentials and webhook were preserved; no second sender or imported workflow was created.
- Authenticated session lookup from n8n returned CSNEW2, WORKING, the expected sender and LID, WEBJS / CONNECTED, and webhook subscriptions `message` and `message.ack`.
- A live CSNEW2 campaign-worker heartbeat appeared after publication. The old workflow acknowledged settings but had no fresh heartbeat for the intended sender.
- Successful void control ACK and heartbeat RPCs now always emit an execution item. Failures still stop the workflow.
- AI and outbound schedule intervals are two seconds. Node names/IDs are retained for compatibility.
- Migration 050 isolates transcripts, inbox, mutable memory, AI claims and outbound preflight by sender account. Existing data is classified from trusted WAHA `me.id`; the same account's renamed session keeps its history. Unknown historical ownership is never assigned to the new account by guesswork.
- Mutable state is archived before an account switch. Old transcripts are retained, not reused as current AI context. Contact exclusions/takeover safety remain effective.
- A 1.2-second quiet window merges adjacent pending bubbles into one durable claim. An eight-second bound prevents an indefinitely postponed reply during continuous typing. New bubbles during inference suppress the stale result and retain the unanswered batch. Duplicate events and stale attempts remain fenced.
- Inbox no longer merges the unscoped legacy conversation directory. Account changes clear the open transcript; old direct links and contact actions cannot bypass account scope. Delivery status is separate from gateway acceptance.
- Migration 051 supports an expiring, explicitly named owner test contact while global automation remains OFF. Transaction-local test context cannot authorize other contacts or subsequent HTTP transactions.

## Validation

`npm test`: 136 passing; TypeScript and production build passing. The regression suite executes PostgreSQL functions with PGlite, including account separation, retained archives, burst grouping, new-bubble suppression, pagination ties, paused global automation and restricted test contact behavior.

Real self-send through the published n8n worker produced gateway SENT and receipt READ/DELIVERED. Queue-to-gateway acceptance was approximately 0.87 seconds; receipt arrived approximately 2.74 seconds after enqueue. These timings are one observation, not a response-time guarantee. A message to the separately owner-selected test contact also produced DELIVERED.

These transport checks do not establish a real customer-inbound-to-AI round trip. Global bot, auto-reply, follow-up and route activation must remain OFF until that flow is demonstrated. Do not classify a manually injected webhook or database event as genuine WhatsApp inbound.

## Sheets reconciliation is pending

The Products sheet has the expected A:T headers but only one product row, with older Sekolapro content and a checkout link. The live database has seven ACTIVE products and newer owner-approved policy. Do not delete or deactivate database products because they are absent from the sheet. Do not blindly import this older row over the current web catalog.

Vercel's Google Sheets credentials were reported absent in the production handoff. No credentials were invented, requested in chat or committed. Secure credential configuration and owner approval of the reconciliation direction are still required before enabling automatic sync. Until then, the existing once-daily schedule is not evidence of successful synchronization.

## Operational restrictions

The three existing campaigns remain DRAFT. Do not start them during repair verification. Test media may be sent only to an explicitly approved owner test recipient, using separate idempotent manual jobs; this does not authorize starting a campaign. UNKNOWN sends require provider reconciliation, not blind retries.
