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
  quota_used   INTEGER NOT NULL DEFAULT 0,
  verified_handle TEXT,                   -- X account that posted this feed's verification code
  verified_at     INTEGER,
  verify_code     TEXT,                   -- pending one-time code (never returned by public reads)
  verify_code_at  INTEGER
);
CREATE INDEX IF NOT EXISTS feeds_recent ON feeds(last_push_at DESC);
CREATE INDEX IF NOT EXISTS feeds_verified ON feeds(verified_handle COLLATE NOCASE);

-- One row per distinct copy of a tweet, keyed by a hash of the cleaned record, so a publisher can only
-- ever change their own copy. `n` is an explicit rowid so the search index can point at it stably.
CREATE TABLE IF NOT EXISTS tweets (
  n    INTEGER PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  id   TEXT NOT NULL,
  data TEXT NOT NULL
);

-- Full-text search over each copy: post text (incl. retweeted/quoted text) and the people in it.
-- rowid = tweets.n; kept in sync by the triggers below, so pushes, deletes and GC need no extra code.
CREATE VIRTUAL TABLE IF NOT EXISTS tweets_fts USING fts5(body, people, tokenize = 'unicode61 remove_diacritics 2');

CREATE TRIGGER IF NOT EXISTS tweets_fts_insert AFTER INSERT ON tweets BEGIN
  INSERT INTO tweets_fts (rowid, body, people) VALUES (new.n,
    coalesce(json_extract(new.data, '$.text'), '') || ' ' ||
    coalesce(json_extract(new.data, '$.retweeted.text'), '') || ' ' ||
    coalesce(json_extract(new.data, '$.quoted.text'), '') || ' ' ||
    coalesce(json_extract(new.data, '$.retweeted.quoted.text'), ''),
    coalesce(json_extract(new.data, '$.author.handle'), '') || ' ' ||
    coalesce(json_extract(new.data, '$.author.name'), '') || ' ' ||
    coalesce(json_extract(new.data, '$.retweeted.author.handle'), '') || ' ' ||
    coalesce(json_extract(new.data, '$.retweeted.author.name'), '') || ' ' ||
    coalesce(json_extract(new.data, '$.quoted.author.handle'), '') || ' ' ||
    coalesce(json_extract(new.data, '$.quoted.author.name'), '') || ' ' ||
    coalesce(json_extract(new.data, '$.retweeted.quoted.author.handle'), '') || ' ' ||
    coalesce(json_extract(new.data, '$.retweeted.quoted.author.name'), ''));
END;

CREATE TRIGGER IF NOT EXISTS tweets_fts_delete AFTER DELETE ON tweets BEGIN
  DELETE FROM tweets_fts WHERE rowid = old.n;
END;

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
