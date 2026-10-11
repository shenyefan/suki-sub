import { TOKEN_DDL } from './tokens'
/**
 * D1 存储层:资源对象 ↔ 规范化表的映射与读写。
 *
 * 映射约定(以 subscriptions 为例):
 * - 显式列:name / url / user_agent / merge_sources / process / position
 * - 其余字段整体存 extra JSON 列,读出时展开,字段演进不丢数据
 */
import type {
  Collection,
  ModuleItem,
  Settings,
  Subscription,
} from '#/shared/types'

const now = () => new Date().toISOString()

const parseJson = <T>(raw: string | null | undefined, fallback: T): T => {
  if (raw == null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** 每个资源提升为列的字段名集合(其余进 extra) */
const SPLIT: Record<string, readonly string[]> = {
  subscription: ['name', 'url', 'ua', 'mergeSources', 'process'],
  collection: ['name', 'process'],
  module: ['name', 'content'],
}

/** 把资源对象拆成 {列值, extra} */
function splitObject(
  kind: string,
  item: Record<string, unknown>,
): { cols: Record<string, unknown>; extra: Record<string, unknown> } {
  const cols: Record<string, unknown> = {}
  const extra: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(item)) {
    if (SPLIT[kind].includes(k)) cols[k] = v
    else extra[k] = v
  }
  return { cols, extra }
}

function mergeObject(
  kind: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = parseJson(
    row['extra'] as string | null,
    {},
  )
  for (const key of SPLIT[kind]) {
    const v = row[key]
    if (v !== undefined && v !== null) out[key] = v
  }
  return out
}

// ---------------------------------------------------------------------------
// subscriptions
// ---------------------------------------------------------------------------

interface SubRow {
  id: number
  name: string
  url: string | null
  user_agent: string | null
  merge_sources: string | null
  process: string | null
  extra: string | null
  position: number
  created_at: string
  updated_at: string
}

const SUB_DDL = `
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  url TEXT,
  user_agent TEXT,
  merge_sources TEXT,
  process TEXT,
  extra TEXT,
  position REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`

function rowToSub(row: SubRow): Subscription {
  const out = mergeObject('subscription', {
    name: row.name,
    url: row.url,
    ua: row.user_agent,
    mergeSources: parseJson(row.merge_sources, undefined),
    process: parseJson(row.process, undefined),
    extra: row.extra,
  }) as Subscription
  out.name = row.name
  if (row.url != null) out.url = row.url
  if (row.user_agent != null) out.ua = row.user_agent
  if (row.merge_sources != null)
    out.mergeSources = parseJson(row.merge_sources, undefined)
  if (row.process != null) out.process = parseJson(row.process, undefined)
  return out
}

function subToRow(name: string, sub: Subscription) {
  const { cols, extra } = splitObject('subscription', sub)
  return {
    name: name || String(cols['name']),
    url: (cols['url'] as string | undefined) ?? null,
    user_agent: (cols['ua'] as string | undefined) ?? null,
    merge_sources:
      cols['mergeSources'] != null
        ? JSON.stringify(cols['mergeSources'])
        : null,
    process: cols['process'] != null ? JSON.stringify(cols['process']) : null,
    extra: Object.keys(extra).length ? JSON.stringify(extra) : null,
  }
}

export async function listSubscriptions(
  db: D1Database,
): Promise<Subscription[]> {
  const { results } = await db
    .prepare('SELECT * FROM subscriptions ORDER BY position, id')
    .all<SubRow>()
  return results.map(rowToSub)
}

export async function getSubscription(
  db: D1Database,
  name: string,
): Promise<Subscription | null> {
  const row = await db
    .prepare('SELECT * FROM subscriptions WHERE name = ?1')
    .bind(name)
    .first<SubRow>()
  return row ? rowToSub(row) : null
}

async function nextPosition(db: D1Database, table: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next FROM ${table}`)
    .first<{ next: number }>()
  return row?.next ?? 0
}

export async function createSubscription(
  db: D1Database,
  sub: Subscription,
  position: 'top' | 'bottom' = 'bottom',
): Promise<Subscription> {
  const r = subToRow(sub.name, sub)
  const pos =
    position === 'top'
      ? (await minPosition(db, 'subscriptions')) - 1
      : await nextPosition(db, 'subscriptions')
  await db
    .prepare(
      'INSERT INTO subscriptions(name, url, user_agent, merge_sources, process, extra, position, created_at, updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8)',
    )
    .bind(
      r.name,
      r.url,
      r.user_agent,
      r.merge_sources,
      r.process,
      r.extra,
      pos,
      now(),
    )
    .run()
  return sub
}

async function minPosition(db: D1Database, table: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COALESCE(MIN(position), 1) - 1 AS m FROM ${table}`)
    .first<{ m: number }>()
  return row?.m ?? 0
}

export async function updateSubscriptionRow(
  db: D1Database,
  name: string,
  sub: Subscription,
  newName?: string,
): Promise<void> {
  const r = subToRow(newName ?? sub.name, sub)
  const statement = db
    .prepare(
      'UPDATE subscriptions SET name=?1, url=?2, user_agent=?3, merge_sources=?4, process=?5, extra=?6, updated_at=?7 WHERE name=?8',
    )
    .bind(
      r.name,
      r.url,
      r.user_agent,
      r.merge_sources,
      r.process,
      r.extra,
      now(),
      name,
    )
  // 名称、组合引用与分享绑定必须在同一事务中更新；名称冲突时整批回滚。
  await db.batch([
    statement,
    ...(r.name !== name
      ? [
          flowSourceRefStatement(db, name, r.name),
          db
            .prepare(
              'UPDATE collection_sources SET value=?1 WHERE kind=?2 AND value=?3',
            )
            .bind(r.name, 'subscription', name),
          db
            .prepare(
              'UPDATE share_tokens SET name=?1 WHERE type=?2 AND name=?3',
            )
            .bind(r.name, 'sub', name),
        ]
      : []),
  ])
}

export async function deleteSubscriptionRow(
  db: D1Database,
  name: string,
): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM subscriptions WHERE name=?1')
    .bind(name)
    .run()
  return res.meta.changes > 0
}

/** 流量选择保存在 extra，随成员名称变更在同一批数据库写入中更新。 */
function flowSourceRefStatement(
  db: D1Database,
  previous: string,
  next?: string,
) {
  return db
    .prepare(
      `
    UPDATE collections SET extra=json_set(extra, '$.flowSource.subscriptions', json((
      SELECT json_group_array(CASE WHEN value=?1 THEN ?2 ELSE value END)
      FROM json_each(collections.extra, '$.flowSource.subscriptions')
      WHERE value<>?1 OR ?2 IS NOT NULL
    )))
    WHERE json_type(extra, '$.flowSource.subscriptions')='array'
      AND EXISTS (SELECT 1 FROM json_each(collections.extra, '$.flowSource.subscriptions') WHERE value=?1)
  `,
    )
    .bind(previous, next ?? null)
}

/** 删除订阅 → 从组合成员中移除 */
export async function deleteSubscriptionRefs(
  db: D1Database,
  name: string,
): Promise<void> {
  await db.batch([
    db
      .prepare('DELETE FROM collection_sources WHERE kind=?1 AND value=?2')
      .bind('subscription', name),
    flowSourceRefStatement(db, name),
  ])
}

// ---------------------------------------------------------------------------
// collections(+ collection_sources)
// ---------------------------------------------------------------------------

const COL_DDL = `
CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  process TEXT,
  extra TEXT,
  position REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collection_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  kind TEXT NOT NULL CHECK (kind IN ('subscription', 'url')),
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collection_sources_collection ON collection_sources(collection_id, position)`

interface CollectionRow {
  id: number
  name: string
  process: string | null
  extra: string | null
  position: number
}

interface SourceRow {
  collection_id: number
  position: number
  kind: 'subscription' | 'url'
  value: string
}

const looksLikeUrl = (v: string) => /^(https?|data):/i.test(v)

function colSourcesToRow(v: string): {
  kind: 'subscription' | 'url'
  value: string
} {
  return looksLikeUrl(v)
    ? { kind: 'url', value: v }
    : { kind: 'subscription', value: v }
}

export async function listCollections(db: D1Database): Promise<Collection[]> {
  const { results: rows } = await db
    .prepare('SELECT * FROM collections ORDER BY position, id')
    .all<CollectionRow>()
  if (rows.length === 0) return []
  const { results: sources } = await db
    .prepare(
      'SELECT collection_id, position, kind, value FROM collection_sources ORDER BY position, id',
    )
    .all<SourceRow>()
  const byCollection = new Map<number, string[]>()
  for (const s of sources) {
    const list = byCollection.get(s.collection_id) ?? []
    list.push(s.value)
    byCollection.set(s.collection_id, list)
  }
  return rows.map((row) => {
    const out = mergeObject('collection', {
      name: row.name,
      process: parseJson(row.process, undefined),
      extra: row.extra,
    }) as Collection
    out.name = row.name
    if (row.process != null) out.process = parseJson(row.process, undefined)
    out.subscriptions = byCollection.get(row.id) ?? []
    return out
  })
}

export async function getCollection(
  db: D1Database,
  name: string,
): Promise<Collection | null> {
  const row = await db
    .prepare('SELECT * FROM collections WHERE name=?1')
    .bind(name)
    .first<CollectionRow>()
  if (!row) return null
  const { results } = await db
    .prepare(
      'SELECT value FROM collection_sources WHERE collection_id=?1 ORDER BY position, id',
    )
    .bind(row.id)
    .all<{ value: string }>()
  const out = mergeObject('collection', {
    name: row.name,
    process: parseJson(row.process, undefined),
    extra: row.extra,
  }) as Collection
  out.name = row.name
  if (row.process != null) out.process = parseJson(row.process, undefined)
  out.subscriptions = results.map((s) => s.value)
  return out
}

async function writeCollectionSources(
  db: D1Database,
  collectionId: number,
  sources: string[],
): Promise<void> {
  const stmts = [
    db
      .prepare('DELETE FROM collection_sources WHERE collection_id=?1')
      .bind(collectionId),
  ]
  sources.forEach((v, i) => {
    const s = colSourcesToRow(v)
    stmts.push(
      db
        .prepare(
          'INSERT INTO collection_sources(collection_id, position, kind, value) VALUES(?1,?2,?3,?4)',
        )
        .bind(collectionId, i, s.kind, s.value),
    )
  })
  await db.batch(stmts)
}

export async function createCollection(
  db: D1Database,
  col: Collection,
  position: 'top' | 'bottom' = 'bottom',
): Promise<Collection> {
  const pos =
    position === 'top'
      ? (await minPosition(db, 'collections')) - 1
      : await nextPosition(db, 'collections')
  const res = await db
    .prepare(
      'INSERT INTO collections(name, process, extra, position, created_at, updated_at) VALUES(?1,?2,?3,?4,?5,?5)',
    )
    .bind(
      col.name,
      col.process != null ? JSON.stringify(col.process) : null,
      JSON.stringify(splitObject('collection', col).extra),
      pos,
      now(),
    )
    .run()
  const id = res.meta.last_row_id
  if (id) await writeCollectionSources(db, id, col.subscriptions)
  return col
}

export async function updateCollectionRow(
  db: D1Database,
  name: string,
  col: Collection,
  newName?: string,
): Promise<void> {
  const target = newName ?? col.name
  const statement = db
    .prepare(
      'UPDATE collections SET name=?1, process=?2, extra=?3, updated_at=?4 WHERE name=?5',
    )
    .bind(
      target,
      col.process != null ? JSON.stringify(col.process) : null,
      JSON.stringify(splitObject('collection', col).extra),
      now(),
      name,
    )
  await db.batch([
    statement,
    ...(target !== name
      ? [
          db
            .prepare(
              'UPDATE share_tokens SET name=?1 WHERE type=?2 AND name=?3',
            )
            .bind(target, 'collection', name),
        ]
      : []),
  ])
  const row = await db
    .prepare('SELECT id FROM collections WHERE name=?1')
    .bind(target)
    .first<{ id: number }>()
  if (row) await writeCollectionSources(db, row.id, col.subscriptions)
}

export async function deleteCollectionRow(
  db: D1Database,
  name: string,
): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM collections WHERE name=?1')
    .bind(name)
    .run()
  return res.meta.changes > 0
}

/** 重命名/删除组合:暂无需要级联的外部引用 */
export async function renameCollectionRefs(
  _db: D1Database,
  _oldName: string,
  _newName: string,
): Promise<void> {
  void _db
  void _oldName
  void _newName
}

export async function deleteCollectionRefs(
  _db: D1Database,
  _name: string,
): Promise<void> {
  void _db
  void _name
}

// ---------------------------------------------------------------------------
// modules / settings
// ---------------------------------------------------------------------------

const MODULE_DDL = `
CREATE TABLE IF NOT EXISTS modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  extra TEXT,
  position REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`

interface ModuleRow {
  id: number
  name: string
  content: string
  extra: string | null
}

function rowToModule(row: ModuleRow): ModuleItem {
  const out = parseJson<Record<string, unknown>>(row.extra, {})
  out.name = row.name
  out.content = row.content
  return out as ModuleItem
}

export async function listModules(db: D1Database): Promise<ModuleItem[]> {
  const { results } = await db
    .prepare('SELECT * FROM modules ORDER BY position, id')
    .all<ModuleRow>()
  return results.map(rowToModule)
}

export async function getModule(
  db: D1Database,
  name: string,
): Promise<ModuleItem | null> {
  const row = await db
    .prepare('SELECT * FROM modules WHERE name=?1')
    .bind(name)
    .first<ModuleRow>()
  return row ? rowToModule(row) : null
}

export async function createModule(
  db: D1Database,
  m: ModuleItem,
): Promise<void> {
  const { extra } = splitObject('module', m)
  await db
    .prepare(
      'INSERT INTO modules(name, content, extra, position, created_at, updated_at) VALUES(?1,?2,?3,?4,?5,?5)',
    )
    .bind(
      m.name,
      m.content,
      Object.keys(extra).length ? JSON.stringify(extra) : null,
      await nextPosition(db, 'modules'),
      now(),
    )
    .run()
}

export async function updateModuleRow(
  db: D1Database,
  name: string,
  m: ModuleItem,
  newName?: string,
): Promise<void> {
  const { extra } = splitObject('module', m)
  await db
    .prepare(
      'UPDATE modules SET name=?1, content=?2, extra=?3, updated_at=?4 WHERE name=?5',
    )
    .bind(
      newName ?? m.name,
      m.content,
      Object.keys(extra).length ? JSON.stringify(extra) : null,
      now(),
      name,
    )
    .run()
}

export async function deleteModuleRow(
  db: D1Database,
  name: string,
): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM modules WHERE name=?1')
    .bind(name)
    .run()
  return res.meta.changes > 0
}

const SETTINGS_DDL = `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`

export async function getAllSettings(db: D1Database): Promise<Settings> {
  const { results } = await db
    .prepare('SELECT key, value FROM settings')
    .all<{ key: string; value: string }>()
  const out: Settings = {}
  for (const row of results) out[row.key] = parseJson(row.value, undefined)
  return out
}

export async function saveSettings(
  db: D1Database,
  settings: Settings,
): Promise<void> {
  const stmts = Object.entries(settings).map(([k, v]) =>
    db
      .prepare(
        'INSERT INTO settings(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .bind(k, JSON.stringify(v)),
  )
  if (stmts.length) await db.batch(stmts)
}

/** 全量替换式写入(备份恢复 / replace 语义):先清后写 */
export async function replaceAllSettings(
  db: D1Database,
  settings: Settings,
): Promise<void> {
  const stmts = [db.prepare('DELETE FROM settings')]
  for (const [k, v] of Object.entries(settings))
    stmts.push(
      db
        .prepare('INSERT INTO settings(key, value) VALUES(?1,?2)')
        .bind(k, JSON.stringify(v)),
    )
  await db.batch(stmts)
}

// ---------------------------------------------------------------------------
// 排序与全量替换
// ---------------------------------------------------------------------------

/** /api/sort:按给定名字顺序重写 position */
export async function reorderTable(
  db: D1Database,
  table: string,
  names: string[],
): Promise<void> {
  const stmts = names.map((n, i) =>
    db.prepare(`UPDATE ${table} SET position=?1 WHERE name=?2`).bind(i, n),
  )
  if (stmts.length) await db.batch(stmts)
}

/** 备份恢复用:全量替换某资源的所有行 */
export async function replaceAll(
  db: D1Database,
  table: 'subscriptions' | 'modules',
  inserts: D1PreparedStatement[],
): Promise<void> {
  await db.batch([db.prepare(`DELETE FROM ${table}`), ...inserts])
}

/** 幂等建表(与 migrations/*.sql 一致;dev 首次运行兜底) */
export async function ensureSchema(db: D1Database): Promise<void> {
  const statements = [SUB_DDL, COL_DDL, MODULE_DDL, SETTINGS_DDL, TOKEN_DDL]
    .join(';')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  await db.batch(statements.map((s) => db.prepare(s)))
}

// ---------------------------------------------------------------------------
// 引擎回写:整 scope 同步(引擎 $.write 写整个数组;按名字 diff,保序)
// ---------------------------------------------------------------------------

export async function replaceSubscriptions(
  db: D1Database,
  subs: Subscription[],
): Promise<void> {
  const stmts = [db.prepare('DELETE FROM subscriptions')]
  subs.forEach((sub, i) => {
    const r = subToRow(sub.name, sub)
    stmts.push(
      db
        .prepare(
          'INSERT INTO subscriptions(name, url, user_agent, merge_sources, process, extra, position, created_at, updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8)',
        )
        .bind(
          r.name,
          r.url,
          r.user_agent,
          r.merge_sources,
          r.process,
          r.extra,
          i,
          now(),
        ),
    )
  })
  await db.batch(stmts)
}

export async function replaceCollections(
  db: D1Database,
  cols: Collection[],
): Promise<void> {
  const stmts = [db.prepare('DELETE FROM collections')]
  const sourceStmts: D1PreparedStatement[] = []
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i]
    const { extra } = splitObject('collection', col)
    const res = db
      .prepare(
        'INSERT INTO collections(id, name, process, extra, position, created_at, updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6)',
      )
      .bind(
        i + 1,
        col.name,
        col.process != null ? JSON.stringify(col.process) : null,
        Object.keys(extra).length ? JSON.stringify(extra) : null,
        i,
        now(),
      )
    stmts.push(res)
    col.subscriptions.forEach((v, j) => {
      const s = colSourcesToRow(v)
      sourceStmts.push(
        db
          .prepare(
            'INSERT INTO collection_sources(collection_id, position, kind, value) VALUES(?1,?2,?3,?4)',
          )
          .bind(i + 1, j, s.kind, s.value),
      )
    })
  }
  stmts.push(db.prepare('DELETE FROM collection_sources'))
  await db.batch([...stmts, ...sourceStmts])
}

export async function replaceModules(
  db: D1Database,
  modules: ModuleItem[],
): Promise<void> {
  const stmts = [db.prepare('DELETE FROM modules')]
  for (const [i, m] of modules.entries()) {
    const { extra } = splitObject('module', m)
    stmts.push(
      db
        .prepare(
          'INSERT INTO modules(name, content, extra, position, created_at, updated_at) VALUES(?1,?2,?3,?4,?5,?5)',
        )
        .bind(
          m.name,
          m.content,
          Object.keys(extra).length ? JSON.stringify(extra) : null,
          i,
          now(),
        ),
    )
  }
  await db.batch(stmts)
}

export const TABLE_FOR = {
  subs: 'subscriptions',
  collections: 'collections',
  modules: 'modules',
} as const
