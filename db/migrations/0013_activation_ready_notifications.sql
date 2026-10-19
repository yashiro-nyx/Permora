-- Allow approval decisions to notify active administrators that activation is ready.
-- The approval transaction remains atomic: notification inserts occur before it
-- commits, so a failed insert rolls back the decision as well.

ALTER TABLE user_notification
  DROP CONSTRAINT user_notification_notification_type_check;

ALTER TABLE user_notification
  ADD CONSTRAINT user_notification_notification_type_check CHECK (
    notification_type IN (
      'request_approved_pending_activation',
      'request_denied',
      'request_returned_for_revision',
      'activation_succeeded',
      'activation_failed',
      'request_assigned_for_review',
      'routing_unavailable',
      'activation_ready'
    )
  );
