# PRIME STORE CS rollout

Owner approved replacement of the Sekolapro-only bot with PRIME STORE on 19 October 2026 (Asia/Jakarta), including continuity through existing per-contact memory.

- `036_prime_store_memory.sql` installs the official catalog, approved service knowledge, order-specific trusted verification, and per-contact context. It archives the previous settings and catalog in the existing restricted settings store; it does not delete messages, memories, contacts, orders, or owner notes.
- Five apps and one bundle are active. October offer amounts are documented but **not activated** because the owner did not specify the active promotion period or allowed bundle combinations. Use normal prices until confirmed.
- APK and member-group links are internal references in the owner playbook. Runtime knowledge omits them. Automatic replies containing access URLs or unsupported payment confirmations are cancelled at the outbound queue boundary. Manual Admin messages remain available.
- Trusted verification requires the latest order for this contact and product to be PAID/FULFILLED with an APPROVED verification, an owner identity and approval timestamp. A previous paid order cannot validate a newer pending order. LID identifiers are not interpreted as telephone numbers.
- The existing context stack and raw transcript memory remain intact. The new layer resolves product mentions/aliases from the same contact only and makes recent sourced excerpts available. It does not infer payment, consent, ownership, or successful troubleshooting from a model guess.
- `workflows/code/prime-store-input.js` limits the model input to current product details, relevant FAQ, recent history, durable customer memory, owner guidance and trusted order metadata. Credential slots, workflow connections, transport and WAHA sessions must be preserved when editing the existing n8n workflow.
- Rollout keeps bot_enabled, ai_auto_reply and followup_enabled OFF and cancels stale automated decisions/followups. Reconnection and activation are separate owner actions.

Validation: database behavior tests cover catalog scope, contact isolation, alias switches, amount ambiguity, manual access delivery, payment evidence vs verification, and a new pending order after an old approved one. Workflow tests cover all four model prompts and agent input propagation. No WhatsApp messages are sent by these tests.

## Multi-product update — 19 October 2026

- Migration 038 replaces all 67 FAQ sections using strictly increasing main headings, preserving nested installation steps.
- The active catalog adds Sekolapro SP001 with monthly Rp99,000 and lifetime Rp299,000 checkout plans. Five APK products remain eligible for the two-distinct-app bundle; Sekolapro is excluded.
- Payment forms and bank transfers are checked manually by Admin against identity, order and actual incoming payment. Form completion, screenshots, forwarded messages and conversational claims never approve payment. All product delivery and school-account activation remain manual.
- The outbound database guard blocks automatic access URLs and AI attachments, even after payment. Only allowlisted public demo/site/checkout URLs can be generated. Manual Admin delivery remains available. This does not prevent a human Admin from sharing an incorrect link or prevent redistribution of public APK URLs.
- Existing approved orders remain valid only for their exact contact/product/latest order; no approval command is inferred from WhatsApp chat.
- Compact context preserves scoped memory and recent transcript, adds seven-product routing, school plans and complete topic-specific FAQ.
- Activation is a separate final operational step: verify that WAHA session me.id is exactly 6285167465305, publish the existing n8n workflow with matching edits, clear stale automated jobs, then enable bot and ai_auto_reply. Keep followup disabled unless separately requested. Never enable another account or infer the number from a session label.

Verified WAHA activation target: `session_01m51sr28e6ytwpjrgyk15aecr`, `me.id=6285167465305@c.us`, WORKING, inspected through the existing read-only n8n status node. Stopped session CS2 belongs to another account and must not be used. Inbound and outbound gates now require the exact selected session and account; missing identity is rejected.
