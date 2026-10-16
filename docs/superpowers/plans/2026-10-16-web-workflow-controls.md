# Web workflow control implementation

Goal: My Control owns daily configuration while n8n remains the executor and credential manager. Owner explicitly requested direct implementation of the agreed division.

- [x] Inspect existing canonical settings and preserve old menus/data.
- [x] Add optimistic configuration versions, canonical save, worker ACK and service-only access; execute SQL behavior tests.
- [x] Replace Automation with web settings for model/instructions, bot, follow-up hours/cap, delay and public service addresses.
- [x] Connect health to configured addresses and provide worker version/last-seen feedback, errors and safe noncampaign FAILED retries.
- [x] Add Read Web Controls and Acknowledge Controls Version to separate AI/outbound/follow-up workflows; inject web model/instructions/address while retaining n8n secrets and graph.
- [x] Independent review; resolve atomic retry/campaign completion issue by rejecting campaign retries here.
- [ ] Apply additive 006 migration, release main, verify production SHA READY.

Constraints: no API key fields, no invented provider success, no UNKNOWN retry, no automatic live activation or customer messages. Inbound processing reads canonical bot settings directly in SQL; worker ACK is config receipt, not evidence of provider success. Campaign follow-up remains suppressed as in 005; global follow-up governs noncampaign sales.
