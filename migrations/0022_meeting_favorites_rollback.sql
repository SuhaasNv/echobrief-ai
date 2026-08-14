-- Rollback for 0022_meeting_favorites.sql
DROP INDEX IF EXISTS meetings_favorite_idx;

ALTER TABLE public.meetings
  DROP COLUMN IF EXISTS is_favorite;
