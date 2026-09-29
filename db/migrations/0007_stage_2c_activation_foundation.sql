-- Permora Stage 2C activation foundation.
-- Approval status remains on access_request; activation state is separate.

ALTER TABLE request_decision
  ADD CONSTRAINT request_decision_id_request_id_unique UNIQUE (id, request_id);

ALTER TABLE request_event
  DROP CONSTRAINT request_event_event_type_check;

ALTER TABLE request_event
  ADD CONSTRAINT request_event_event_type_check CHECK (
    event_type IN (
      'request_routed',
      'request_routing_unavailable',
      'review_approved',
      'review_denied',
      'review_returned_for_revision',
      'activation_succeeded',
      'activation_failed'
    )
  );

ALTER TABLE user_notification
  DROP CONSTRAINT user_notification_notification_type_check;

ALTER TABLE user_notification
  ADD CONSTRAINT user_notification_notification_type_check CHECK (
    notification_type IN (
      'request_approved_pending_activation',
      'request_denied',
      'request_returned_for_revision',
      'activation_succeeded',
      'activation_failed'
    )
  );

CREATE TABLE request_activation (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE REFERENCES access_request(id),
  decision_id uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK (
    status IN ('activating', 'activated', 'failed', 'expired', 'revoked')
  ),
  adapter_name text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES "user"(id),
  idempotency_key uuid NOT NULL,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  expires_at timestamptz NOT NULL,
  external_reference text,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (decision_id, request_id)
    REFERENCES request_decision(id, request_id),
  CHECK (
    status NOT IN ('activated', 'expired', 'revoked') OR activated_at IS NOT NULL
  )
);

CREATE INDEX request_activation_stuck_idx
  ON request_activation (last_attempt_at, id)
  WHERE status = 'activating';
CREATE INDEX request_activation_expiry_idx
  ON request_activation (expires_at, id)
  WHERE status = 'activated';

CREATE TABLE activation_event (
  id uuid PRIMARY KEY,
  activation_id uuid NOT NULL REFERENCES request_activation(id),
  actor_user_id uuid REFERENCES "user"(id),
  event_type text NOT NULL CHECK (
    event_type IN (
      'activation_started',
      'activation_succeeded',
      'activation_failed',
      'activation_expired',
      'activation_revoked',
      'activation_reconciled'
    )
  ),
  idempotency_key uuid,
  adapter_name text,
  external_reference text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  detail text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX activation_event_activation_time_idx
  ON activation_event (activation_id, occurred_at, id);
CREATE UNIQUE INDEX activation_event_actor_idempotency_idx
  ON activation_event (actor_user_id, idempotency_key)
  WHERE event_type = 'activation_started' AND idempotency_key IS NOT NULL;

CREATE TRIGGER activation_event_immutable
  BEFORE UPDATE OR DELETE ON activation_event
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
