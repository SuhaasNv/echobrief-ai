-- Favorite (star) a meeting.
--
-- Server-side, not device-local, so a star set on the phone shows on the web
-- and survives a reinstall. Defaults FALSE: every existing meeting starts
-- un-favorited, which is the truthful state — nobody has starred anything yet.

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE;

-- The favorites section filters to a user's starred meetings on every list load.
-- Partial index: only the starred rows are indexed, which is the tiny set the
-- section reads, and it costs nothing on the common un-starred write path.
CREATE INDEX IF NOT EXISTS meetings_favorite_idx
  ON public.meetings (user_id, is_favorite)
  WHERE is_favorite = TRUE;
