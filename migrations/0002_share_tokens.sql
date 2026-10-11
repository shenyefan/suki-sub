-- 分享记录存入 D1，过期记录保留至手动删除。
CREATE TABLE IF NOT EXISTS share_tokens (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('sub', 'collection')),
  name TEXT NOT NULL,
  created_at INTEGER,
  end_at INTEGER,
  max_count INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  extra TEXT NOT NULL DEFAULT '{}'
);
