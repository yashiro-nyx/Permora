-- Administrator governance: delegation, notification preferences, provisional retention settings.

CREATE TABLE approver_delegation (
  id uuid PRIMARY KEY,
  delegator_user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  substitute_user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES "user"(id) ON DELETE RESTRICT,
  CHECK (valid_until > valid_from),
  CHECK (delegator_user_id <> substitute_user_id),
  CHECK (
    num_nonnulls(cancelled_at, cancelled_by) IN (0, 2)
  )
);

CREATE INDEX approver_delegation_active_delegator_idx
  ON approver_delegation (delegator_user_id, valid_from, valid_until)
  WHERE cancelled_at IS NULL;

CREATE INDEX approver_delegation_active_substitute_idx
  ON approver_delegation (substitute_user_id, valid_from, valid_until)
  WHERE cancelled_at IS NULL;

CREATE TABLE user_notification_preference (
  user_id uuid PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  in_app_enabled boolean NOT NULL DEFAULT true,
  external_email_enabled boolean NOT NULL DEFAULT false,
  external_sms_enabled boolean NOT NULL DEFAULT false,
  external_push_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE retention_policy_setting (
  record_class text PRIMARY KEY,
  label text NOT NULL,
  retention_days integer CHECK (retention_days IS NULL OR retention_days > 0),
  provisional boolean NOT NULL DEFAULT true,
  immutable boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES "user"(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO retention_policy_setting
  (record_class, label, retention_days, provisional, immutable) VALUES
('audit_event', 'Immutable audit events', NULL, true, true),
('request_decision', 'Request review decisions', NULL, true, true),
('request_event', 'Request lifecycle events', NULL, true, true),
('user_notification', 'In-app notifications (provisional)', 730, true, false),
('access_request_terminal', 'Terminal access requests (provisional)', 2555, true, false);

COMMENT ON TABLE retention_policy_setting IS
  'Provisional retention configuration until institutional policy is approved. Immutable classes cannot be archived by maintenance operations.';

ALTER TABLE request_event
  DROP CONSTRAINT request_event_event_type_check;

ALTER TABLE request_event
  ADD CONSTRAINT request_event_event_type_check CHECK (
    event_type IN (
      'request_routed',
      'request_routing_unavailable',
      'request_administrator_assigned',
      'review_approved',
      'review_denied',
      'review_returned_for_revision',
      'activation_succeeded',
      'activation_failed'
    )
  );
