ALTER TABLE user_profile
  ADD COLUMN deactivated_at timestamptz,
  ADD COLUMN deactivated_by uuid REFERENCES "user"(id) ON DELETE RESTRICT,
  ADD COLUMN deactivation_reason text,
  ADD CONSTRAINT user_profile_deactivation_metadata_check CHECK (
    num_nonnulls(deactivated_at, deactivated_by, deactivation_reason) IN (0, 3)
    AND (
      NOT active
      OR num_nonnulls(deactivated_at, deactivated_by, deactivation_reason) = 0
    )
  ),
  ADD CONSTRAINT user_profile_deactivation_reason_check CHECK (
    deactivation_reason IS NULL
    OR char_length(btrim(deactivation_reason)) BETWEEN 1 AND 2000
  );

CREATE TABLE account_invitation (
  id uuid PRIMARY KEY,
  target_user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX account_invitation_target_created_idx
  ON account_invitation (target_user_id, created_at DESC);
CREATE INDEX account_invitation_pending_target_expiry_idx
  ON account_invitation (target_user_id, expires_at)
  WHERE used_at IS NULL;