-- SUKI SUB 完整初始化结构：持久数据与通知限频状态使用 D1，资源缓存使用 KV。
-- 面向全新实例，可重复执行；不清空数据，不负责修复已有表的字段差异。

CREATE TABLE IF NOT EXISTS subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,
  url          TEXT,
  user_agent   TEXT,
  -- 多源合并策略，以 JSON 字符串保存 mergeSources
  merge_sources TEXT,
  -- 官方 process:操作符数组(每项 {type, ...params}),天然非关系数据
  process      TEXT,
  -- 官方其余低频字段的 JSON(displayName/ua/img/content/source/subUserinfo/
  -- proxy/noFlow/ignoreFailedRemoteSub/agePublicKey/subscribeMetadata 等),
  -- 保证与官方数据形状对齐、字段演进不丢数据
  extra        TEXT,
  position     REAL NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,
  -- 官方 process 同 subscriptions.process
  process      TEXT,
  extra        TEXT,
  position     REAL NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- 官方 collection.subscriptions 是「订阅名 / 远程 URL」混排数组,拆成带类型和次序的行
CREATE TABLE IF NOT EXISTS collection_sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  position      REAL NOT NULL DEFAULT 0,
  kind          TEXT NOT NULL CHECK (kind IN ('subscription', 'url')),
  value         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collection_sources_collection ON collection_sources(collection_id, position);

-- 脚本模块
CREATE TABLE IF NOT EXISTS modules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  content    TEXT NOT NULL,
  extra      TEXT,
  position   REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 设置:官方 settings 是嵌套 JSON,按顶层键分行存
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 运行日志:details 为 JSON 详情(写入前已脱敏)
CREATE TABLE IF NOT EXISTS runtime_logs (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  time    TEXT NOT NULL,
  level   TEXT NOT NULL,
  message TEXT NOT NULL,
  details TEXT
);

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

-- 通知去重窗口，仅保存事件摘要的哈希，不保存资源名称和分享凭据。
CREATE TABLE IF NOT EXISTS notification_cooldowns (
  key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
