-- Notify the original approver after an administrator confirms provisioning.
-- This is a separate type so requester activation notifications remain in the
-- requester stream and cannot be accidentally filtered as staff messages.

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
      'activation_ready',
      'activation_succeeded_for_approver'
    )
  );
