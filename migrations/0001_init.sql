-- suki-sub 初始 schema
-- D1 只存真正持久化的数据;token / 资源缓存走 KV。

CREATE TABLE subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,
  url          TEXT,
  user_agent   TEXT,
  -- 官方 mergeSources:字符串数组,异构列表数据存 JSON
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

CREATE TABLE collections (
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
CREATE TABLE collection_sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  position      REAL NOT NULL DEFAULT 0,
  kind          TEXT NOT NULL CHECK (kind IN ('subscription', 'url')),
  value         TEXT NOT NULL
);
CREATE INDEX idx_collection_sources_collection ON collection_sources(collection_id, position);

-- 脚本模块
CREATE TABLE modules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  content    TEXT NOT NULL,
  extra      TEXT,
  position   REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 设置:官方 settings 是嵌套 JSON,按顶层键分行存
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 归档:删除资源时 ?mode=archive 的快照(对应官方 archives)
CREATE TABLE archives (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL CHECK (kind IN ('subscription', 'collection')),
  name       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_archives_kind_name ON archives(kind, name);

-- 运行日志:details 为 JSON 详情(写入前已脱敏)
CREATE TABLE runtime_logs (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  time    TEXT NOT NULL,
  level   TEXT NOT NULL,
  message TEXT NOT NULL,
  details TEXT
);
