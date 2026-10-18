-- Permora Stage 2D: staff (approver/admin) in-app notifications.
--
-- The existing user_notification table stores requester notifications keyed by
-- recipient_user_id. The schema already permits any user as a recipient; the
-- CHECK constraint and the UNIQUE on request_event_id were the only blockers
-- for multi-recipient notifications from a single event.
--
-- This migration:
-- 1. Replaces the single-recipient UNIQUE(request_event_id) with a
--    composite UNIQUE(request_event_id, recipient_user_id) so the same
--    lifecycle event can notify both the requester and the assigned approver.
-- 2. Widens the notification_type CHECK to include staff notification types.
-- 3. Adds a covering index for unread staff notification counts.

-- Allow multiple notifications per event (one per recipient).
ALTER TABLE user_notification
  DROP CONSTRAINT user_notification_request_event_id_key;

ALTER TABLE user_notification
  ADD CONSTRAINT user_notification_event_recipient_unique
  UNIQUE (request_event_id, recipient_user_id);

-- Widen notification_type to include staff notifications.
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
      'routing_unavailable'
    )
  );
