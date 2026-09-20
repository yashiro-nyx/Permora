-- Permora Stage 2B milestone 1: single-stage routing and approval records.
-- Existing pending requests are preserved as pending_routing until explicitly reconciled.

ALTER TABLE access_request
  DROP CONSTRAINT access_request_status_check;

ALTER TABLE access_request
  ALTER COLUMN status SET DEFAULT 'pending_routing',
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN revision_of uuid REFERENCES access_request(id);

UPDATE access_request SET status = 'pending_routing' WHERE status = 'pending';

ALTER TABLE access_request
  ADD CONSTRAINT access_request_status_check CHECK (
    status IN (
      'pending_routing',
      'pending_review',
      'approved_pending_activation',
      'denied',
      'returned_for_revision',
      'expired',
      'cancelled'
    )
  );

ALTER TABLE approver_responsibility
  ADD CONSTRAINT approver_responsibility_id_resource_unique UNIQUE (id, resource_id),
  ADD CONSTRAINT approver_responsibility_id_approver_unique UNIQUE (id, approver_user_id);

CREATE TABLE approver_responsibility_scope (
  responsibility_id uuid NOT NULL,
  resource_id text NOT NULL,
  scope_option_id uuid NOT NULL,
  PRIMARY KEY (responsibility_id, scope_option_id),
  FOREIGN KEY (responsibility_id, resource_id)
    REFERENCES approver_responsibility(id, resource_id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id, scope_option_id)
    REFERENCES scope_option(resource_id, id)
);
CREATE INDEX approver_responsibility_scope_option_idx
  ON approver_responsibility_scope (resource_id, scope_option_id, responsibility_id);

INSERT INTO approver_responsibility_scope (responsibility_id, resource_id, scope_option_id)
SELECT id, resource_id, scope_option_id
FROM approver_responsibility
WHERE scope_option_id IS NOT NULL;

COMMENT ON COLUMN approver_responsibility.scope_option_id IS
  'Legacy single-scope field retained for compatibility; Stage 2B routing uses approver_responsibility_scope.';

CREATE TABLE request_review_assignment (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE REFERENCES access_request(id),
  approver_user_id uuid NOT NULL REFERENCES "user"(id),
  responsibility_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'completed')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (responsibility_id, approver_user_id)
    REFERENCES approver_responsibility(id, approver_user_id),
  CHECK (
    (status = 'assigned' AND completed_at IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL)
  ),
  UNIQUE (id, approver_user_id)
);
CREATE INDEX request_review_assignment_open_approver_idx
  ON request_review_assignment (approver_user_id, assigned_at, request_id)
  WHERE status = 'assigned';

CREATE TABLE request_decision (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE REFERENCES access_request(id),
  assignment_id uuid NOT NULL UNIQUE,
  actor_user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('approve', 'deny', 'return_for_revision')),
  reason text,
  previous_status text NOT NULL CHECK (previous_status = 'pending_review'),
  resulting_status text NOT NULL CHECK (
    resulting_status IN ('approved_pending_activation', 'denied', 'returned_for_revision')
  ),
  previous_version integer NOT NULL CHECK (previous_version > 0),
  resulting_version integer NOT NULL CHECK (resulting_version = previous_version + 1),
  decided_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (assignment_id, actor_user_id)
    REFERENCES request_review_assignment(id, approver_user_id),
  CHECK (
    (action = 'approve' AND resulting_status = 'approved_pending_activation')
    OR (action = 'deny' AND resulting_status = 'denied')
    OR (action = 'return_for_revision' AND resulting_status = 'returned_for_revision')
  ),
  CHECK (
    (action = 'approve' AND (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 2000))
    OR (
      action IN ('deny', 'return_for_revision')
      AND char_length(btrim(coalesce(reason, ''))) BETWEEN 1 AND 2000
    )
  )
);
CREATE INDEX request_decision_actor_time_idx
  ON request_decision (actor_user_id, decided_at DESC);

CREATE TABLE request_event (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES access_request(id),
  actor_user_id uuid REFERENCES "user"(id),
  event_type text NOT NULL CHECK (
    event_type IN (
      'request_routed',
      'request_routing_unavailable',
      'review_approved',
      'review_denied',
      'review_returned_for_revision'
    )
  ),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  detail text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX request_event_request_time_idx
  ON request_event (request_id, occurred_at, id);

CREATE OR REPLACE FUNCTION reject_immutable_record_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'immutable record cannot be updated or deleted'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER request_decision_immutable
  BEFORE UPDATE OR DELETE ON request_decision
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();

CREATE TRIGGER request_event_immutable
  BEFORE UPDATE OR DELETE ON request_event
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();

CREATE TRIGGER audit_event_immutable
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();

CREATE INDEX access_request_review_queue_idx
  ON access_request (status, submitted_at, id)
  WHERE status IN ('pending_routing', 'pending_review');
