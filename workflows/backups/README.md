# Production workflow backups

Read-only rollback evidence. DO NOT IMPORT OR ACTIVATE as a new workflow.

`2026-10-24-KENDALIKU-before-CS2-DO-NOT-IMPORT.json` is the exact export taken from existing workflow `sBxYeXeIGD2OvaLV` before recovery. Original active status was true; original version ID was `2f6bcdbe-873e-45c7-8132-dc3879f46841`. It retains credential references (no API key values), node IDs, webhook ID and the old CSNEW2 routing for diagnosis. Restoring it would undo CS2 recovery, so use only as an audited source of rollback fields, not a new live sender.

The CS2 recovery version was later published as `CS2 recovery — verified identity`. Subsequent dynamic-session graph changes remain unverified in the editor draft; see the staged session-manager README before publishing anything.
