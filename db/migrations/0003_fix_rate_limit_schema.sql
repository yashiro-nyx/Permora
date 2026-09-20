-- Better Auth 1.7.5 gives every database-backed model a text primary key
-- when advanced.database.generateId is a custom function. Preserve any
-- legacy rate-limit rows by using their existing unique keys as stable IDs.

ALTER TABLE "rateLimit" ADD COLUMN id text;

UPDATE "rateLimit"
SET id = key
WHERE id IS NULL;

ALTER TABLE "rateLimit"
  ALTER COLUMN id SET NOT NULL,
  DROP CONSTRAINT "rateLimit_pkey",
  ADD CONSTRAINT rate_limit_pkey PRIMARY KEY (id),
  ADD CONSTRAINT rate_limit_key_unique UNIQUE (key);
