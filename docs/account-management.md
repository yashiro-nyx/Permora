# Account management lifecycle

## Account activity

`user_profile.active` remains the sole source of truth for whether an account
is active. Migration `0008` adds no second status field and does not update
existing `active` values. New deactivations set `active = false` together with
`deactivated_at`, `deactivated_by`, and a non-empty `deactivation_reason`.
These three metadata fields are either all null or all populated. The schema
allows a legacy inactive profile to have all three null because its historical
actor and reason cannot be reconstructed. Reactivation sets `active = true`
and clears the current deactivation metadata; immutable audit events retain the
history.

Every account-management entry point must resolve an active administrator from
the Better Auth session and current database-backed Permora roles. Navigation,
client-provided actor IDs, and Better Auth plugin roles are not authorization
sources. The account state change and its immutable `audit_event` must commit in
the same database transaction. Audit metadata may contain safe event details,
but never credentials, hashes, tokens, or secrets.

## Invitations

`account_invitation` records the target user, a unique SHA-256 digest of a
high-entropy random token, expiry, optional use time, creator, and creation
time. Only the digest is persisted. The raw token is delivered once through a
separate non-cacheable secret result, never through reusable account DTOs, URLs,
logs, errors, or audit metadata. Invitation consumption must atomically mark an
unused, unexpired invitation as used before applying its account effect; a
replay or expiry fails closed. Multiple invitation records may exist for one
user, so a replacement does not rewrite prior evidence.

Invitation creation is an administrator action and its audit event commits in
the same transaction as the invitation row. Audit metadata may identify the
invitation row and target, but must not include either form of the token or its
digest. The digest column is binary and constrained to 32 bytes.
Invitation acceptance and password setup must use supported Better Auth
credential APIs; do not add custom password hashing or write password hashes
from account-management code.

## Session revocation and transaction boundary

Better Auth's core `auth.api.revokeSessions` revokes the calling user's
sessions only. The installed Better Auth version provides
`auth.api.revokeUserSessions` through its Admin plugin, but Permora does not
currently install that plugin. That endpoint authorizes against Better Auth's
`user.role` and calls the internal adapter; Permora instead treats
`user_role` plus `user_profile.active` as authoritative. The endpoint also
does not accept Permora's `PoolClient`, so its session deletion cannot share
the transaction that writes the profile change and audit event. Do not call
the self-only endpoint for another user, rely on the plugin role as Permora
authorization, or delete Better Auth session rows directly.

Before implementing account mutations, resolve a supported Better Auth
revocation path that preserves Permora's active-admin guard. Given the current
non-atomic boundary, the safest ordering is:

1. In one Permora transaction, set the profile inactive, write all deactivation
   metadata, and insert the immutable audit event; commit.
2. Invoke Better Auth's supported user-session revocation API.
3. If revocation fails, leave the account inactive and retry revocation. Do not
   reactivate while revocation is unresolved. Inactive-profile checks deny app
   access even while stale session rows remain.

This prioritizes immediate application lockout over an atomic session-row
deletion. It means audit proves the deactivation commit, not successful session
row deletion; that limitation and any retry outcome must be visible to
operators without exposing session tokens.

## Database and test boundary

Migrations are append-only; account management begins at `0008`. Do not apply a
migration or run database-backed checks against development or production. Any
database validation for this milestone must explicitly target the guarded
`_test` database with `--database-target test`.