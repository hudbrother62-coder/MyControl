# Session manager — staged graph, not yet published

Do not use the n8n editor's Import from file on an occupied canvas: it appends and renames nodes. Never publish a graph containing duplicate triggers or names ending in unintended `1` suffixes.

The intended graph here is inactive. It preserves original IDs, credential references, webhook ID and all existing routes. It adds one inbound configuration read and makes session/identity validation dynamic. Apply only to the existing workflow `sBxYeXeIGD2OvaLV`, replacing its draft via the official workflow update API or targeted edits. Do not create another workflow.

Production checkpoint (24 October 2026): CS2 routing recovery was published successfully. CS2 and exact WhatsApp identity/LID were verified from WAHA. Real scheduled heartbeat recovered and one self text plus one self poster were SENT with provider IDs and one attempt each. Draft `3 tiga` remained DRAFT with 90 recipients.

The subsequent editor import appended draft nodes. It was NOT published. Cloud Browser timed out on undo and then reported that native credential state could not safely resume. Before any further publication, inspect the draft and restore the last published CS2 recovery graph or replace it with this validated intended graph. Do not assume undo succeeded.

After the one-time upgrade, confirm `mc_campaign_runtime.worker_contract = session-manager-v1`, a matching settings revision and heartbeat age <90s. Select CS2 in My Control to install/verify the inbound webhook and advance revision; wait for the worker's new heartbeat. Until then selection fails closed with WORKFLOW_UPGRADE_REQUIRED. Legacy recovered worker continues operating under migration 070; migration 071 prevents selecting a new sender before the dynamic contract is live.

No n8n API key was available in Vercel. No credentials or login secrets were copied into source.
