-- Performance Indexes for Production Scale
-- 
-- This migration adds indexes to improve query performance as the database grows.
-- All indexes are created CONCURRENTLY to avoid locking tables during deployment.
-- 
-- Run with: psql $DATABASE_URL < migrations/add-performance-indexes.sql
--
-- Estimated time: 1-5 minutes (depends on table size)

-- Note: CONCURRENTLY removed — cannot run inside a transaction block.

-- Index on meetings for user timeline queries
-- Pattern: SELECT * FROM meetings WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
CREATE INDEX IF NOT EXISTS idx_meetings_user_created
  ON meetings(user_id, created_at DESC);

-- Index on meetings for workspace filtering
-- Pattern: SELECT * FROM meetings WHERE workspace_id = ? AND status = 'completed'
CREATE INDEX IF NOT EXISTS idx_meetings_workspace_status
  ON meetings(workspace_id, status);

-- Index on usage_logs for quota checking
-- Pattern: SELECT SUM(...) FROM usage_logs WHERE user_id = ? AND period = '2026-05'
CREATE INDEX IF NOT EXISTS idx_usage_logs_period
  ON usage_logs(user_id, period, usage_type);

-- Index on embeddings for vector search
-- Pattern: SELECT * FROM embeddings WHERE meeting_id = ?
CREATE INDEX IF NOT EXISTS idx_embeddings_meeting
  ON embeddings(meeting_id);

-- Index on chat_messages for conversation history
-- Pattern: SELECT * FROM chat_messages WHERE meeting_id = ? ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_chat_messages_meeting
  ON chat_messages(meeting_id, created_at DESC);

-- Index on action_items for meeting queries
-- Pattern: SELECT * FROM action_items WHERE meeting_id = ? AND completed = false
CREATE INDEX IF NOT EXISTS idx_action_items_meeting
  ON action_items(meeting_id, completed);

-- Index on flashcards for meeting queries
-- Pattern: SELECT * FROM flashcards WHERE meeting_id = ?
CREATE INDEX IF NOT EXISTS idx_flashcards_meeting
  ON flashcards(meeting_id);

-- Index on subscriptions for tier lookups
-- Pattern: SELECT tier FROM subscriptions WHERE user_id = ? AND status = 'active'
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
  ON subscriptions(user_id, status);

-- Analyze tables to update query planner statistics
-- This helps PostgreSQL choose optimal query plans
ANALYZE meetings;
ANALYZE usage_logs;
ANALYZE embeddings;
ANALYZE chat_messages;
ANALYZE action_items;
ANALYZE flashcards;
ANALYZE subscriptions;



-- Verification: Check that indexes were created
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;
