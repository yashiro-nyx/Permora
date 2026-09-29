# Activation lifecycle operations

Updated 2026-09-29. These procedures describe the current manual-adapter prototype. Permora does not connect to a university provisioning system and does not schedule these scripts automatically.

## Operating boundary

- Approval remains `access_request.status = 'approved_pending_activation'`; it is not rewritten by activation, failure, expiry, or revocation.
- `request_activation.status` is authoritative for lifecycle state: `activating`, `activated`, `failed`, `expired`, or `revoked`.
- Only an active administrator may record activation, and the requester and original approver are prohibited, including an original approver who also has an administrator role.
- The manual adapter reports success only after an administrator verifies that access has been granted in the target system and submits a reference or human-readable evidence.
- Success writes `ordinary_entitlement`, immutable events, the lifecycle state, and requester notification atomically. Failure writes events, state, and notification atomically; it never creates an entitlement.
- Reconciliation cannot inspect or replay a university system. Never treat a stale `activating` record as proof that downstream provisioning did or did not happen.

## Manual activation

1. Sign in using an active administrator account that is neither the requester nor the original approver.
2. Open `/admin/activations` and confirm the request ID, requester, resource, permission, requested validity, and current lifecycle state.
3. Verify or perform the grant in the resource's actual system using the institution's normal authorization process.
4. In the activation form, confirm provisioning and enter a ticket/system reference or specific human-readable evidence. Do not submit success based only on the approval decision.
5. Confirm the lifecycle displays `Active`. The requester should see the separate activation status and an in-app success notification. The approval status remains approved-pending-activation.

A validation/policy failure is not an operator override prompt. Stop and resolve eligibility through approved assignment/policy processes, then submit a new request when appropriate.

## Stuck `activating` records

Transaction 1 commits `activating` before the adapter call. A crash or timeout can therefore leave the record in that state. The default stuck threshold is 15 minutes.

Preview first:

```sh
npm run activations:reconcile -- --database-target development --confirm-database-name <exact-development-database-name>
```

Inspect a candidate without retrieving requester-sensitive payloads:

```sql
SELECT activation.id, request.display_id, activation.status,
       activation.adapter_name, activation.attempt_count,
       activation.started_at, activation.last_attempt_at,
       activation.idempotency_key
  FROM request_activation activation
  JOIN access_request request ON request.id = activation.request_id
 WHERE activation.status = 'activating'
   AND activation.last_attempt_at <= now() - interval '15 minutes'
 ORDER BY activation.last_attempt_at, activation.id;
```

For the candidate, inspect only recorded lifecycle outcomes and safe reason fields:

```sql
SELECT event.event_type, event.occurred_at,
       event.metadata ->> 'failureCode' AS failure_code,
       event.metadata ->> 'retryable' AS retryable,
       event.detail
  FROM activation_event event
 WHERE event.activation_id = '<activation-uuid>'
 ORDER BY event.occurred_at, event.id;
```

Then use `--apply` only after reviewing the preview and target:

```sh
npm run activations:reconcile -- --database-target development --confirm-database-name <exact-development-database-name> --apply
```

Apply behavior:

- If a durable success/failure event already exists for the same idempotency key, reconciliation restores that recorded result instead of creating a second result.
- If no result exists and current requester, policy, scope, date, and conflict checks pass, reconciliation records `activation_attempt_timeout` as retryable failure and notifies the requester. It does not repeat the manual provisioning side effect.
- If the request is no longer approved/eligible, its policy changed, or a conflict exists, reconciliation records a non-retryable failure with the reason and notification. That lifecycle cannot be retried with a new key.

A retryable timeout means “Permora has no durable outcome,” not “the target system failed.” Before retrying, an administrator must inspect the target system. If access is already present, use the admin UI retry action to record the verified grant with evidence; do not grant it again. If access is absent and still authorized, provision it through the target system's normal process, then use the retry action to record it. The UI creates a fresh idempotency key for that new attempt. Reuse/replay of an old key returns its prior result.

If the external state cannot be established, stop and escalate to the named system owner. Do not issue a speculative duplicate grant or edit lifecycle tables directly.

## Failed activation

- A retryable failure appears with a retry action in `/admin/activations`. Inspect the failure event, recheck the target system, and follow the stuck-record procedure before retrying.
- A definitive failure or policy/revalidation failure has no retry action. Resolve the underlying eligibility/policy issue and submit a new request if appropriate; do not reset the activation row or alter its events.
- Requester failure notifications are in-app only. No email, SMS, or push message is sent.
- Do not delete or update `activation_event`, `request_event`, `audit_event`, or notifications to conceal or repair an attempt. Use a new attempt/event or a forward code/migration correction.

## Expiration

Expiration is a separate script and is not yet scheduled by deployment infrastructure. Until a scheduler is deliberately configured and monitored, an authorized operator must run it on the agreed cadence.

Preview:

```sh
npm run activations:expire -- --database-target development --confirm-database-name <exact-development-database-name>
```

After reviewing the candidate count and due validity windows, apply explicitly:

```sh
npm run activations:expire -- --database-target development --confirm-database-name <exact-development-database-name> --apply
```

The script moves only `activated` lifecycle rows whose `expires_at` has passed to terminal `expired`, appends an immutable event, and does not rewrite the approval state. Repeated or stale runs do not overwrite expired/revoked rows. Renewal creates a new request linked to the expired source; it never extends or reactivates the old request in place.

## Revocation and manual recovery limits

The server-side revocation operation requires an active administrator and a non-empty reason, closes/removes the linked entitlement, and records a terminal immutable event. It is not currently exposed as an administrator UI or CLI command. If urgent downstream removal is required, follow the target system's established incident process immediately, retain its evidence, and escalate to the Permora owner for the reviewed revocation operation. Do not issue direct SQL updates/deletes to activation or event records.

If the Permora service fails after a downstream change, preserve the reference/evidence and activation/request IDs; retry only after checking the idempotency key and current lifecycle state. The transaction code is idempotent for the same attempt key. Escalate any mismatch between downstream access and the `ordinary_entitlement` record to the system owner and Permora maintainer before another provisioning change.

## Database-target safety

All examples above are dry-run-first. These scripts require an explicit database target, verify the connected database name, and use only `TEST_DATABASE_URL` for `test` (database name must end in `_test`). Never use fixtures or test credentials against development or production. Production additionally requires `--confirm-production` and both process-level database URLs; follow the controlled operator procedure in [HANDOFF.md](../HANDOFF.md).
