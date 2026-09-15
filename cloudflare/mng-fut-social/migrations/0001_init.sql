CREATE TABLE IF NOT EXISTS social_profiles (
  user_id INTEGER PRIMARY KEY,
  persona_id INTEGER NOT NULL DEFAULT 0,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  avatar_url TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined','cancelled')),
  created_at INTEGER NOT NULL,
  responded_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver_status ON friend_requests(receiver_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_friend_requests_sender_status ON friend_requests(sender_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS friendships (
  user_id INTEGER NOT NULL,
  friend_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, friend_id),
  CHECK(user_id <> friend_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_friend ON friendships(friend_id, user_id);

CREATE TABLE IF NOT EXISTS presence (
  user_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'offline',
  status_text TEXT NOT NULL DEFAULT '',
  last_seen_at INTEGER NOT NULL DEFAULT 0
);
