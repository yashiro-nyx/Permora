-- Permora Stage 2B milestone 3: idempotent decision commands and
-- requester-visible in-app notifications. Approval still creates no access.

ALTER TABLE request_decision
  ADD COLUMN idempotency_key uuid;

-- Historical decisions predate externally supplied idempotency keys. Their
-- immutable decision IDs provide stable, collision-free legacy values.
UPDATE request_decision
SET idempotency_key = id
WHERE idempotency_key IS NULL;

ALTER TABLE request_decision
  ALTER COLUMN idempotency_key SET NOT NULL;

CREATE UNIQUE INDEX request_decision_actor_idempotency_idx
  ON request_decision (actor_user_id, idempotency_key);

CREATE TABLE user_notification (
  id uuid PRIMARY KEY,
  recipient_user_id uuid NOT NULL REFERENCES "user"(id),
  request_id uuid NOT NULL REFERENCES access_request(id),
  request_event_id uuid NOT NULL UNIQUE REFERENCES request_event(id),
  notification_type text NOT NULL CHECK (
    notification_type IN (
      'request_approved_pending_activation',
      'request_denied',
      'request_returned_for_revision'
    )
  ),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX user_notification_recipient_time_idx
  ON user_notification (recipient_user_id, created_at DESC, id DESC);
CREATE INDEX user_notification_request_idx
  ON user_notification (request_id, created_at, id);
