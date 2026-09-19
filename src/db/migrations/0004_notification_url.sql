-- Notifications remember where they point
--
-- Phase 1.9. A deal alert is only useful if tapping it lands on the trip it is
-- about. The destination is decided when the alert is written - from the saved
-- search that found it - so it is stored with the alert rather than rebuilt at
-- delivery time from state that may have moved on since.

BEGIN;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS url TEXT;

COMMIT;
