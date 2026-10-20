# Preview migration safety procedure

This procedure is for the isolated Vercel Preview/Neon target only. It does not
change application environment variables and it does not select development,
test, or production credentials.

## Required Preview configuration

Provide these values to the shell through the approved secret manager. Do not
put URLs in shell history, source files, logs, screenshots, or commits:

```text
PREVIEW_DATABASE_URL
PREVIEW_DATABASE_MIGRATION_URL
PREVIEW_DATABASE_NAME
PREVIEW_NEON_PROJECT_ID
PREVIEW_NEON_BRANCH_ID
PREVIEW_NEON_ENDPOINT_ID
```

`PREVIEW_DATABASE_URL` and `PREVIEW_DATABASE_MIGRATION_URL` must refer to the
same database and endpoint. The runner does not load `.env.local` for Preview,
rejects reuse of configured development/test endpoints, and verifies the
database name plus Neon project, branch, and endpoint before opening its
migration transaction.

## Read-only preflight

From a shell containing only the explicit Preview variables, run:

```sh
npm run db:preview:preflight -- --database-target preview
```

The command performs SELECT-only checks. It reports the observed identity,
schema-migration state, pending local migrations, and duplicate open-assignment
or notification-pair anomalies. It must report `mode: "read-only"` and the
expected identity before any migration is considered.

## Backup and recovery

Before approval to migrate, create a custom-format dump using the secret
manager's protected environment injection. Do not paste a password-bearing URL
into a command or persist it in a file:

```sh
pg_dump --format=custom --no-owner --no-acl --file="$PREVIEW_BACKUP_FILE" "$PREVIEW_DATABASE_URL"
pg_restore --list "$PREVIEW_BACKUP_FILE"
```

The dump must be stored in approved encrypted storage with restricted access.
Validate restoration only into a disposable replacement database, never into
development, test, or production. Keep the dump until the Preview acceptance
test is complete.

The migration runner wraps all pending migrations in one transaction and takes
the existing advisory lock. A failure before commit rolls back the transaction.
After a successful commit there are no automatic down migrations; recovery is
to restore the backup into a new isolated Preview database, verify it, and
switch Preview configuration only after explicit approval.

## Approval-time execution and verification

Only after the Preview identity and backup have been independently verified:

```sh
npm run db:migrate -- --database-target preview
```

Then rerun the read-only preflight and verify that migrations 0011, 0012, 0013,
and 0014 appear in `schema_migration`, the expected notification constraint
values exist, and no duplicate active assignment exists. No existing request
or notification records are imported or rewritten by this preparation.
