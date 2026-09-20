-- Keep already-migrated databases aligned with the final Stage 2B reason rule.
-- NOT VALID avoids a long initial table lock; VALIDATE verifies all existing rows.

ALTER TABLE request_decision
  ADD CONSTRAINT request_decision_reason_required_check CHECK (
    (
      action = 'approve'
      AND (
        reason IS NULL
        OR char_length(btrim(reason)) BETWEEN 1 AND 2000
      )
    )
    OR (
      action IN ('deny', 'return_for_revision')
      AND char_length(btrim(coalesce(reason, ''))) BETWEEN 1 AND 2000
    )
  ) NOT VALID;

ALTER TABLE request_decision
  VALIDATE CONSTRAINT request_decision_reason_required_check;
