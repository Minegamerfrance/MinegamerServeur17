-- MNG FUT Full Cloud Save v2.1.0
CREATE TABLE IF NOT EXISTS mng_fut_full_saves (
  user_id INTEGER PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  save_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  byte_size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mng_fut_full_save_chunks (
  user_id INTEGER NOT NULL,
  save_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  PRIMARY KEY (user_id, save_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_mng_full_save_chunks_user
  ON mng_fut_full_save_chunks(user_id);

CREATE INDEX IF NOT EXISTS idx_mng_full_save_updated
  ON mng_fut_full_saves(updated_at);
