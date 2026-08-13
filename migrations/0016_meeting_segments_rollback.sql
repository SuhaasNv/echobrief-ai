-- Rollback for 0016_meeting_segments.sql
--
-- Drops the record of which pieces of a segmented recording arrived. This is
-- destructive in a way the object storage is not: the segment objects
-- themselves survive in R2, but their keys live ONLY in this table, so
-- dropping it orphans every segment of every recording that has not yet been
-- joined — unreachable by the retention sweep and undeletable by the user,
-- because both find them through these rows. Dump the table before running
-- this if any meeting is mid-recording.
--
-- Meetings that were already joined are unaffected: the concatenated object is
-- on meetings.audio_key like any single-file upload, and playback, retention
-- and deletion all keep working from there.
--
-- Roll this back together with the code that reads it, or POST
-- /meetings/:id/segments and the worker's join step will fail on a missing
-- relation. Single-file uploads never touch this table and keep working
-- either way.

DROP TABLE IF EXISTS public.meeting_segments;
