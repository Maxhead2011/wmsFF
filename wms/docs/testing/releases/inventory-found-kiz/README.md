# Physically rediscovered inventory KIZ

An earlier confirmed box count detached missing AVAILABLE/RESERVED marks and changed their
status to BLOCKED while retaining the original receipt sourceDocument. Subsequent physical
scans in another box could not pass administrator confirmation because the old recovery
guard only recognized specific administrative sourceDocument prefixes.

WMS_INVENTORY_FOUND_KIZ_RESTORE_ENABLED is opt-in (default false, our VM only). The existing
administrator confirmation validates the current scans, quantities, scope and unchanged
round. Recovery additionally requires the previous composition-confirmation audit: exact
mark ID, exclusion reason, client, warehouse, SKU, physical identity, old source box,
receipt linkage and timestamps. Any FBS/FBO picking, printing, circulation or WB shipment
evidence rejects this recovery and retains the separate review requirement. Stock is
adjusted by the existing inventory decision only; mark recovery does not credit it again.
The new audit records exclusionProofId for every rediscovered mark, preserving old history.

Shared API modules affected: inventory confirmed composition and the new rediscovery helper.
Sold VM retains its existing behavior with the flag absent or false. No schema or TSD changes.

Validation (2026-09-21): the reproduction failed with the original user-visible error before
the fix. Full local API suite: 2769 passed, 60 skipped. TypeScript check passed. Exact server
overlay: TypeScript and 98 composition tests passed. Image manifest confirms only the two
inventory modules changed. Existing return, alias reconciliation and shortage protections
were retained; the single overlapping return/rediscovery insertion was combined with explicit
user approval. Exact production delta is published-source.patch.

A real-data preview ran the standard administrator resolveBox operation for FFL_LKBBOX_0130
inside a Serializable transaction, verified 2 blue + 1 graphite units, 3 AVAILABLE KIZs,
RESOLVED audit, and an idempotent retry. It was explicitly rolled back and unchanged state
was verified afterward. Operational commit is separate and adds an assisted-action audit.
