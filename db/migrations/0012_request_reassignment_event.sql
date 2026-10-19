-- Permora workflow correction: immutable audit event for pending-review reassignment.
-- Additive only; existing request history remains unchanged.

-- Allow a completed assignment to remain in immutable history while a request
-- receives a replacement assignment. At most one assignment may be open.
ALTER TABLE request_review_assignment
  DROP CONSTRAINT request_review_assignment_request_id_key;

CREATE UNIQUE INDEX request_review_assignment_one_open_idx
  ON request_review_assignment (request_id)
  WHERE status = 'assigned';

ALTER TABLE request_event
  DROP CONSTRAINT request_event_event_type_check;

ALTER TABLE request_event
  ADD CONSTRAINT request_event_event_type_check CHECK (
    event_type IN (
      'request_routed',
      'request_routing_unavailable',
      'request_administrator_assigned',
      'request_reassigned',
      'review_approved',
      'review_denied',
      'review_returned_for_revision',
      'activation_succeeded',
      'activation_failed'
    )
  );
