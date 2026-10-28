-- X Feed Share: D1 schema. Apply with: wrangler d1 execute xfeeds --file schema.sql [--local|--remote]

CREATE TABLE IF NOT EXISTS feeds (
  id           TEXT PRIMARY KEY,          -- 10-char [a-z0-9] slug
  token_hash   TEXT NOT NULL,             -- sha256 of the publish token; the token itself is never stored
  label        TEXT NOT NULL,             -- self-described, <= 40 chars
  created_at   INTEGER NOT NULL,
  last_push_at INTEGER,
  foryou_at    INTEGER,                   -- last push per kind, for the directory badges
  following_at INTEGER,
  quota_day    INTEGER NOT NULL DEFAULT 0,
  quota_used   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS feeds_recent ON feeds(last_push_at DESC);

-- Keyed by a hash of the cleaned record, so a publisher can only ever change their own copy of a tweet.
CREATE TABLE IF NOT EXISTS tweets (
  hash TEXT PRIMARY KEY,
  id   TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  feed_id  TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('foryou', 'following')),
  tweet_id TEXT NOT NULL,
  hash     TEXT NOT NULL,
  session  INTEGER NOT NULL,              -- ms timestamp the browsing session started
  pos      INTEGER NOT NULL,              -- order within the session (top of feed first)
  PRIMARY KEY (feed_id, kind, tweet_id)
);
CREATE INDEX IF NOT EXISTS items_order ON items(feed_id, kind, session DESC, pos);
CREATE INDEX IF NOT EXISTS items_session ON items(session);
CREATE INDEX IF NOT EXISTS items_hash ON items(hash);
