# Interrupted WB automatic assembly

Prepared on 2026-10-16 for `feature/wb-print-check`; publication pending.

Request 2082 was committed on 2026-10-15 at 12:01:40 UTC. Its scheduled run
remained RUNNING without groups. The previous recovery selected only groups with
`requestNumber` and `error`, so subsequent runs skipped the existing WMS request.
All five orders now belong to the manually created WB-GI-294262613; the candidate
confirmed that composition with read-only WB calls and a read-only DB transaction.

## Scope

The own-installation flag `WMS_AUTO_ASSEMBLY_DURABLE_ENABLED` defaults off.
`auto-assembly-durable.ts` implements durable checkpoints using existing SystemSetting.
No migration or stock/reservation transition is introduced. Manual assembly and
Ozon retain their existing external operations. The sold installation is outside
this release and does not enable the new flag.

The release changes exactly four API runtime modules:

- administration/auto-assembly.service: connection-level PostgreSQL lock and isolated run context;
- marketplace-connections.service: checkpoint inside request creation transaction, intent before
  supply POST, returned ID immediately, per-chunk intent, final composition verification and binding;
- auto-assembly-recovery: bounded interrupted-operation recovery, optional subgroup ownership,
  fresh route checks, remote supply discovery and missing-order verification;
- auto-assembly-durable: journal and recovery helpers.

The historical auto-assembly functions exist in production runtime but are absent
from the divergent TypeScript service. `scripts/releases/auto-assembly-interrupted/patch.cjs`
is the versioned call-site implementation. It checks exact preimage SHA256s, changes
only those methods and compiles the new typed helper. Do not deploy a full local build.
Source parity remains false. Base: PR625/626 shift-latency, API
`sha256:d4736fb76077e02f9dbf69036d848c69a121533b457f71b27719e48259d2f5b1`.

## Recovery and limits

Request ownership and run-group progress commit atomically with the WMS request.
Each supply group has a deterministic name and persisted CREATE_PENDING intent.
A lost POST response is resolved by that name; an unresolved intent never repeats POST.
Manual supply adoption requires a unique exact membership match, matching client,
current selected WB warehouse and execution route. Group bindings use the same
order locks as manual assembly. New order addition requires current status, a fresh
new-order listing and an unchanged supply composition. Only missing IDs are patched.

Legacy RUNNING older than 15 minutes is matched only to automatic creation events
in its bounded 10-minute creation window. Without evidence of the previous WB result,
it enters REVIEW_REQUIRED rather than creating another supply. Terminal requests are
retired from the recovery queue. Twenty operations per connection per run, oldest
attempt first, prevent starvation by persistent review cases. Supply discovery is
bounded to ten pages and at most 100 composition reads.

The existing conservative barriers remain: unknown/changed ownership, incompatible
groups, started physical picking of still-new WB orders, missing tasks, more than
100 new orders in a recovery group, and pickup-point cargo reconstruction require
manager review. These cases are not reported as completed. Recovery never rewrites
stock, quantities, KIZs, request status or reservation fields.

## Validation

- Old runtime reproduces 2082: interrupted RUNNING returns zero recovery candidates.
- Eleven source tests cover transaction checkpoint calls, unknown intents, per-group
  bindings, multi-supply completion, locks, flag-off/manual isolation, lookup and routes.
- Eight actual-runtime/container tests cover 2082, fresh interruption, unknown POST,
  competing run, excluded route, partial PATCH and durable checkpoints.
- Four PostgreSQL tests use a temporary isolated schema and independent connections:
  mutual exclusion, rollback atomicity, committed recovery evidence, lock release on failure.
- Full API3501/web445 passed (155/2 skipped; dedicated KIZ DB suites excluded), TypeScript and eight baseline tests passed. [Evidence](releases/auto-assembly-interrupted.json).

Publication uses release locks, fresh API/web image equality, exact four-file delta,
health/hash/flag checks and rollback to `logoff-api:before-auto-assembly-interrupted`.
No manual recreation or new WB supply is needed for request 2082.
