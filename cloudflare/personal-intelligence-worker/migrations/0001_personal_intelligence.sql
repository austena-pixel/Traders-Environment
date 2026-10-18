CREATE TABLE IF NOT EXISTS pi_preferences (
  user_id TEXT PRIMARY KEY CHECK(length(user_id) <= 64),
  preferences_json TEXT NOT NULL CHECK(json_valid(preferences_json)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pi_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL CHECK(length(user_id) <= 64),
  account_id TEXT NOT NULL CHECK(length(account_id) BETWEEN 1 AND 128),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  topic TEXT NOT NULL CHECK(topic IN ('statistics','edge','execution','psychology','general')),
  conversation_kind TEXT NOT NULL CHECK(conversation_kind IN ('user','observation')),
  observation_key TEXT,
  observation_priority INTEGER CHECK(observation_priority IS NULL OR observation_priority BETWEEN 1 AND 3),
  created_at TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  CHECK((conversation_kind='observation' AND observation_key IS NOT NULL) OR (conversation_kind='user' AND observation_key IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS pi_observation_dedupe
  ON pi_conversations(user_id,account_id,observation_key);
CREATE INDEX IF NOT EXISTS pi_conversations_recent
  ON pi_conversations(user_id,account_id,last_message_at DESC);
CREATE INDEX IF NOT EXISTS pi_observations_recent
  ON pi_conversations(user_id,account_id,conversation_kind,last_message_at DESC);

CREATE TABLE IF NOT EXISTS pi_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES pi_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL CHECK(length(user_id) <= 64),
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  source TEXT NOT NULL CHECK(source IN ('user','assistant','local_start','observation')),
  content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 6000),
  evidence_context TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(evidence_context)),
  feedback TEXT CHECK(feedback IS NULL OR feedback IN ('helpful','not_relevant')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS pi_messages_conversation_order
  ON pi_messages(user_id,conversation_id,created_at,id);
