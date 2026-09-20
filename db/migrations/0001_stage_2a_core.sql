-- Permora Stage 2A: authentication, policy, assignments, and requester-owned requests.
-- Apply with scripts/migrate.ts. This migration is additive and has no automatic down path.

CREATE TABLE "user" (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_email_unique ON "user" (lower(email));

CREATE TABLE "session" (
  id uuid PRIMARY KEY,
  "userId" uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  "expiresAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_user_id_idx ON "session" ("userId");
CREATE INDEX session_expires_at_idx ON "session" ("expiresAt");

CREATE TABLE account (
  id uuid PRIMARY KEY,
  "userId" uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("providerId", "accountId")
);
CREATE INDEX account_user_id_idx ON account ("userId");

CREATE TABLE verification (
  id uuid PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier_idx ON verification (identifier);

CREATE TABLE "rateLimit" (
  key text PRIMARY KEY,
  count integer NOT NULL,
  "lastRequest" bigint NOT NULL
);

CREATE TABLE user_role (
  user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('student', 'faculty', 'approver', 'admin')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES "user"(id),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE user_profile (
  user_id uuid PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  department text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  requester_role text CHECK (requester_role IN ('student', 'faculty')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE institutional_identifier (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  identifier_type text NOT NULL CHECK (identifier_type IN ('student_number', 'staff_number')),
  issuer text NOT NULL,
  normalized_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, identifier_type, normalized_value),
  UNIQUE (user_id, identifier_type, issuer)
);

CREATE TABLE catalog_resource (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  owner_name text NOT NULL,
  sensitivity text NOT NULL CHECK (sensitivity IN ('Low', 'Medium', 'High')),
  icon text NOT NULL,
  available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalog_policy_version (
  id uuid PRIMARY KEY,
  resource_id text NOT NULL REFERENCES catalog_resource(id),
  version integer NOT NULL CHECK (version > 0),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  default_days integer NOT NULL CHECK (default_days > 0),
  max_days integer NOT NULL CHECK (max_days >= default_days),
  renewable boolean NOT NULL,
  policy_note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_id, version),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE TABLE catalog_permission (
  id text PRIMARY KEY,
  resource_id text NOT NULL REFERENCES catalog_resource(id),
  label text NOT NULL,
  description text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE (resource_id, id)
);

CREATE TABLE catalog_permission_role (
  permission_id text NOT NULL REFERENCES catalog_permission(id) ON DELETE CASCADE,
  requester_role text NOT NULL CHECK (requester_role IN ('student', 'faculty')),
  PRIMARY KEY (permission_id, requester_role)
);

CREATE TABLE catalog_scope_field (
  resource_id text NOT NULL REFERENCES catalog_resource(id),
  field_name text NOT NULL CHECK (field_name IN ('courseSection', 'laboratory', 'software', 'researchProject')),
  label text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL,
  PRIMARY KEY (resource_id, field_name)
);

CREATE TABLE scope_option (
  id uuid PRIMARY KEY,
  resource_id text NOT NULL REFERENCES catalog_resource(id),
  field_name text NOT NULL,
  institutional_code text NOT NULL,
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  valid_from timestamptz,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_id, field_name, institutional_code),
  UNIQUE (resource_id, id),
  FOREIGN KEY (resource_id, field_name)
    REFERENCES catalog_scope_field(resource_id, field_name),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from)
);

CREATE TABLE requester_assignment (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  resource_id text NOT NULL REFERENCES catalog_resource(id),
  scope_option_id uuid REFERENCES scope_option(id),
  permission_id text REFERENCES catalog_permission(id),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'institutional_integration')),
  evidence text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  assigned_by uuid NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (resource_id, scope_option_id) REFERENCES scope_option(resource_id, id),
  FOREIGN KEY (resource_id, permission_id) REFERENCES catalog_permission(resource_id, id),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);
CREATE INDEX requester_assignment_lookup_idx
  ON requester_assignment (user_id, resource_id, scope_option_id, valid_from, valid_until);

CREATE TABLE ordinary_entitlement (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  resource_id text NOT NULL REFERENCES catalog_resource(id),
  permission_id text NOT NULL REFERENCES catalog_permission(id),
  scope_fingerprint text NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'institutional_integration')),
  evidence text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  recorded_by uuid NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (resource_id, permission_id) REFERENCES catalog_permission(resource_id, id),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);
CREATE INDEX ordinary_entitlement_lookup_idx
  ON ordinary_entitlement (user_id, resource_id, permission_id, scope_fingerprint);

CREATE TABLE approver_responsibility (
  id uuid PRIMARY KEY,
  approver_user_id uuid NOT NULL REFERENCES "user"(id),
  resource_id text NOT NULL REFERENCES catalog_resource(id),
  permission_id text REFERENCES catalog_permission(id),
  scope_option_id uuid REFERENCES scope_option(id),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  assigned_by uuid NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (resource_id, permission_id) REFERENCES catalog_permission(resource_id, id),
  FOREIGN KEY (resource_id, scope_option_id) REFERENCES scope_option(resource_id, id),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);
CREATE INDEX approver_responsibility_lookup_idx
  ON approver_responsibility (resource_id, permission_id, scope_option_id, valid_from, valid_until);

CREATE TABLE access_request (
  id uuid PRIMARY KEY,
  display_id text NOT NULL UNIQUE,
  requester_user_id uuid NOT NULL REFERENCES "user"(id),
  resource_id text NOT NULL REFERENCES catalog_resource(id),
  permission_id text NOT NULL REFERENCES catalog_permission(id),
  policy_version_id uuid NOT NULL REFERENCES catalog_policy_version(id),
  purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 20 AND 2000),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'denied', 'expired', 'cancelled')),
  scope_fingerprint text NOT NULL,
  renewal_of uuid REFERENCES access_request(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (resource_id, permission_id) REFERENCES catalog_permission(resource_id, id),
  CHECK (expires_at > starts_at)
);
CREATE SEQUENCE access_request_display_seq START WITH 1;
CREATE INDEX access_request_owner_idx ON access_request (requester_user_id, submitted_at DESC);
CREATE INDEX access_request_duplicate_idx
  ON access_request (requester_user_id, resource_id, permission_id, scope_fingerprint, status);

CREATE TABLE access_request_scope (
  request_id uuid NOT NULL REFERENCES access_request(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  scope_option_id uuid NOT NULL REFERENCES scope_option(id),
  display_snapshot text NOT NULL,
  PRIMARY KEY (request_id, field_name)
);

CREATE TABLE request_submission_history (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES access_request(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES "user"(id),
  event_type text NOT NULL CHECK (event_type IN ('submitted', 'renewal_submitted')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  detail text NOT NULL
);
CREATE INDEX request_submission_history_request_idx
  ON request_submission_history (request_id, occurred_at);

CREATE TABLE audit_event (
  id uuid PRIMARY KEY,
  actor_user_id uuid REFERENCES "user"(id),
  subject_user_id uuid REFERENCES "user"(id),
  request_id uuid REFERENCES access_request(id),
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_event_request_idx ON audit_event (request_id, occurred_at);
