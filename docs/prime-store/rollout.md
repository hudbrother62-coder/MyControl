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
