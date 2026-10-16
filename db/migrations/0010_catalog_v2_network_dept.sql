-- Proposed Permora catalog v2: two additive resources approved for the
-- prototype — Campus Network & Wi-Fi Access and Department Shared Resources.
-- These rows are prototype configuration, NOT a claim about any university's
-- official policy. This migration is additive only (no drops, no alters to
-- existing rows) and is safe to apply alongside migrations 0001-0009.

INSERT INTO catalog_resource (id, name, description, owner_name, sensitivity, icon) VALUES
('r-network-access', 'Campus Network & Wi-Fi Access', 'Managed campus network entitlements: eduroam, remote VPN, and device registration for a named zone.', 'Network Operations', 'Medium', 'key'),
('r-dept-shared', 'Department Shared Resources', 'Departmental shared drives and print services scoped to one named department.', 'Department Administration', 'Medium', 'folder');

INSERT INTO catalog_policy_version
  (id, resource_id, version, effective_from, default_days, max_days, renewable, policy_note) VALUES
('10000000-0000-4000-8000-000000000007', 'r-network-access', 1, '2026-01-01T00:00:00Z', 90, 180, true, 'Bound to current affiliation and network-use policy.'),
('10000000-0000-4000-8000-000000000008', 'r-dept-shared', 1, '2026-01-01T00:00:00Z', 60, 180, true, 'Bound to current department affiliation.');

INSERT INTO catalog_permission (id, resource_id, label, description) VALUES
('network:eduroam-account', 'r-network-access', 'Use campus eduroam network account', 'Authenticate to campus eduroam in one network zone.'),
('network:vpn-remote-access', 'r-network-access', 'Use remote VPN network access', 'Reach permitted campus services remotely through the managed VPN.'),
('network:device-registration', 'r-network-access', 'Register a device for network access', 'Register a device for network use in one network zone.'),
('dept:shared-drive-read', 'r-dept-shared', 'Read department shared drive', 'Read files on one department''s shared drive.'),
('dept:shared-drive-contribute', 'r-dept-shared', 'Contribute to department shared drive', 'Create and revise files on one department''s shared drive.'),
('dept:print-services', 'r-dept-shared', 'Use department print services', 'Use managed print services of one department.');

INSERT INTO catalog_permission_role (permission_id, requester_role) VALUES
('network:eduroam-account', 'student'),
('network:eduroam-account', 'faculty'),
('network:vpn-remote-access', 'faculty'),
('network:device-registration', 'student'),
('network:device-registration', 'faculty'),
('dept:shared-drive-read', 'student'),
('dept:shared-drive-read', 'faculty'),
('dept:shared-drive-contribute', 'faculty'),
('dept:print-services', 'student'),
('dept:print-services', 'faculty');

-- Widen the scope-field name allow-list to admit the two new scope fields.
-- Additive only: the new CHECK is a strict superset of the original set from
-- migration 0001, so every existing row remains valid.
ALTER TABLE catalog_scope_field
  DROP CONSTRAINT catalog_scope_field_field_name_check;
ALTER TABLE catalog_scope_field
  ADD CONSTRAINT catalog_scope_field_field_name_check
  CHECK (field_name IN (
    'courseSection', 'laboratory', 'software', 'researchProject',
    'networkZone', 'department'
  ));

INSERT INTO catalog_scope_field (resource_id, field_name, label, sort_order) VALUES
('r-network-access', 'networkZone', 'Network zone', 1),
('r-dept-shared', 'department', 'Department', 1);
