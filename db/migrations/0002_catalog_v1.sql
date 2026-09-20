-- Proposed Permora catalog, policy version 1. These rows are configuration,
-- not a claim about any university's official policy.

INSERT INTO catalog_resource (id, name, description, owner_name, sensitivity, icon) VALUES
('r-lms', 'Learning Management System', 'Course-specific student participation or assigned teaching access.', 'Academic Technology', 'Medium', 'folder'),
('r-student-portal', 'Student Portal', 'Access to the requester''s own academic information.', 'Registrar and Student Services', 'High', 'database'),
('r-faculty-grading', 'Faculty Grading System', 'Grade encoding or submission for assigned sections.', 'Registrar and Academic Affairs', 'High', 'key'),
('r-library', 'Library E-Resources', 'Access to subscribed academic materials.', 'Library Services', 'Low', 'book'),
('r-lab', 'Computer Laboratory Systems', 'Access to designated lab accounts or course software.', 'Laboratory Operations', 'Medium', 'lab'),
('r-research-workspace', 'Research Project Workspace', 'Access to one project''s files or datasets.', 'Research Services', 'High', 'folder');

INSERT INTO catalog_policy_version
  (id, resource_id, version, effective_from, default_days, max_days, renewable, policy_note) VALUES
('10000000-0000-4000-8000-000000000001', 'r-lms', 1, '2026-01-01T00:00:00Z', 30, 90, true, 'Bound to verified enrollment or teaching assignment.'),
('10000000-0000-4000-8000-000000000002', 'r-student-portal', 1, '2026-01-01T00:00:00Z', 7, 30, false, 'Own-account exception only.'),
('10000000-0000-4000-8000-000000000003', 'r-faculty-grading', 1, '2026-01-01T00:00:00Z', 14, 60, true, 'Bound to assigned section and grading window.'),
('10000000-0000-4000-8000-000000000004', 'r-library', 1, '2026-01-01T00:00:00Z', 30, 90, true, 'Bound to affiliation and license terms.'),
('10000000-0000-4000-8000-000000000005', 'r-lab', 1, '2026-01-01T00:00:00Z', 14, 60, true, 'Bound to approved laboratory activity.'),
('10000000-0000-4000-8000-000000000006', 'r-research-workspace', 1, '2026-01-01T00:00:00Z', 30, 90, true, 'Bound to verified project membership and data-use period.');

INSERT INTO catalog_permission (id, resource_id, label, description) VALUES
('lms:course-participation', 'r-lms', 'Course participation', 'Participate in one assigned course section.'),
('lms:assigned-teaching', 'r-lms', 'Assigned teaching access', 'Manage learning activities for one assigned section.'),
('portal:view-own-academic-information', 'r-student-portal', 'View own academic information', 'Access only the signed-in student''s own record.'),
('grading:encode-assigned-section', 'r-faculty-grading', 'Encode grades for assigned section', 'Create and revise grade entries for one assigned section.'),
('grading:submit-assigned-section', 'r-faculty-grading', 'Submit grades for assigned section', 'Submit grades for registrar processing for one assigned section.'),
('library:subscribed-materials', 'r-library', 'Use subscribed academic materials', 'Use covered journals, ebooks, and databases.'),
('library:restricted-collections', 'r-library', 'Use restricted academic collections', 'Use approved controlled collections.'),
('lab:designated-account', 'r-lab', 'Use designated laboratory account', 'Use one assigned laboratory environment.'),
('lab:course-software', 'r-lab', 'Use approved course software', 'Use named software in an assigned laboratory.'),
('research:view-project', 'r-research-workspace', 'View project files and datasets', 'Read material within one assigned project.'),
('research:contribute-project', 'r-research-workspace', 'Contribute project files and datasets', 'Create and revise material within one assigned project.'),
('research:manage-project-files', 'r-research-workspace', 'Manage project files and membership', 'Manage files and membership within one assigned project.');

INSERT INTO catalog_permission_role (permission_id, requester_role) VALUES
('lms:course-participation', 'student'),
('lms:assigned-teaching', 'faculty'),
('portal:view-own-academic-information', 'student'),
('grading:encode-assigned-section', 'faculty'),
('grading:submit-assigned-section', 'faculty'),
('library:subscribed-materials', 'student'),
('library:subscribed-materials', 'faculty'),
('library:restricted-collections', 'faculty'),
('lab:designated-account', 'student'),
('lab:designated-account', 'faculty'),
('lab:course-software', 'student'),
('lab:course-software', 'faculty'),
('research:view-project', 'student'),
('research:view-project', 'faculty'),
('research:contribute-project', 'student'),
('research:contribute-project', 'faculty'),
('research:manage-project-files', 'faculty');

INSERT INTO catalog_scope_field (resource_id, field_name, label, sort_order) VALUES
('r-lms', 'courseSection', 'Course and section', 1),
('r-faculty-grading', 'courseSection', 'Course and section', 1),
('r-lab', 'laboratory', 'Laboratory', 1),
('r-lab', 'software', 'Software or environment', 2),
('r-research-workspace', 'researchProject', 'Research project', 1);
