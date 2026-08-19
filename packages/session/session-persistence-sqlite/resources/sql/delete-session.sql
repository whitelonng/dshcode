-- Permanently delete one stored session; the events foreign key
-- (ON DELETE CASCADE) removes every event row with it.
DELETE FROM sessions WHERE id = ?
