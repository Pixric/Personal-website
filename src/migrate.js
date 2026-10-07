/**
 * 自动建表（零配置部署的关键）
 *
 * 目的：让用户「点一下部署就能用」，完全不需要在电脑上跑 wrangler，
 *       也不需要去 D1 控制台手动粘贴 SQL。
 *
 * 做法：Worker 第一次收到请求时检查表是否存在，不存在就自动建表并写入默认设置。
 *       每个 isolate 只做一次检查，之后走内存标记，不增加额外开销。
 */

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS settings (
     key        TEXT PRIMARY KEY,
     value      TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS admins (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     username      TEXT NOT NULL UNIQUE,
     password_hash TEXT NOT NULL,
     created_at    INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS sessions (
     token      TEXT PRIMARY KEY,
     admin_id   INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     ip         TEXT,
     user_agent TEXT
   )`,

  `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,

  `CREATE TABLE IF NOT EXISTS tracks (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     title       TEXT NOT NULL,
     artist      TEXT,
     r2_key      TEXT NOT NULL,
     cover_key   TEXT,
     size        INTEGER NOT NULL DEFAULT 0,
     mime        TEXT,
     duration    REAL,
     sort_order  INTEGER NOT NULL DEFAULT 0,
     created_at  INTEGER NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS idx_tracks_order ON tracks(sort_order, id)`,

  `CREATE TABLE IF NOT EXISTS socials (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     label      TEXT NOT NULL,
     url        TEXT NOT NULL,
     icon       TEXT NOT NULL,
     icon_key   TEXT,
     sort_order INTEGER NOT NULL DEFAULT 0,
     enabled    INTEGER NOT NULL DEFAULT 1
   )`,

  `CREATE INDEX IF NOT EXISTS idx_socials_order ON socials(sort_order, id)`,

  `CREATE TABLE IF NOT EXISTS assets (
     key           TEXT PRIMARY KEY,
     size          INTEGER NOT NULL DEFAULT 0,
     mime          TEXT,
     original_name TEXT,
     kind          TEXT,
     uploaded_at   INTEGER NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS idx_assets_time ON assets(uploaded_at DESC)`,
];

/** 默认设置（与 schema.sql 保持一致） */
const DEFAULT_SETTINGS = [
  ['initialized', '0'],
  ['security_entry', ''],
  ['site_name', '贪睡'],
  ['nickname', ''],
  ['about_text', '常年研究逆向工具软件，擅长搭建网站。'],
  ['avatar_key', ''],
  ['bg_key', ''],
  ['music_enabled', '1'],
  ['music_mode', 'default'],
  ['github_user', ''],
  ['github_show_repos', '1'],
  ['github_show_chart', '1'],
  ['anim_intro', '1'],
  ['anim_bg', '1'],
  ['anim_reveal', '1'],
  ['anim_avatar', '1'],
  ['anim_player', '1'],
  ['footer_text', ''],
  ['footer_opacity', '0.55'],
  ['footer_color', '#8a8a8e'],
  ['footer_link', ''],
  ['tg_enabled', '1'],
  ['tg_title', '加入我的频道'],
  ['tg_sub', '加入就是最大的帮助'],
  ['tg_url', 'https://t.me/COASCN'],
];

/* ------------------------------------------------------------------ */

// 每个 isolate 记忆一次结果；失败时不缓存，下次请求会重试
let schemaReady = false;
let inFlight = null;

/**
 * 确保数据库结构就绪。
 * 返回 true 表示可用；返回 false 表示数据库未绑定或建表失败。
 */
export async function ensureSchema(env) {
  if (schemaReady) return true;
  if (!env || !env.DB) return false;

  // 并发请求只跑一次迁移
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      if (await tablesExist(env)) {
        schemaReady = true;
        return true;
      }
      await createTables(env);
      schemaReady = true;
      console.log('[grwz] 数据库结构已自动初始化完成');
      return true;
    } catch (err) {
      console.error('[grwz] 自动初始化数据库失败:', err && err.message);
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** 快速判断是否已经建过表 */
async function tablesExist(env) {
  try {
    const row = await env.DB
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'`)
      .first();
    return Boolean(row);
  } catch {
    // 连 sqlite_master 都读不到，说明数据库确实不可用
    return false;
  }
}

/** 建表 + 写入默认设置 */
async function createTables(env) {
  // D1 的 batch 在一个事务里顺序执行，建表失败会整体回滚
  await env.DB.batch(SCHEMA_STATEMENTS.map((sql) => env.DB.prepare(sql)));

  const now = Date.now();
  // INSERT OR IGNORE：已存在的键不会被覆盖，重复初始化是安全的
  await env.DB.batch(
    DEFAULT_SETTINGS.map(([key, value]) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`
      ).bind(key, value, now)
    )
  );
}

/** 供测试使用：重置记忆状态 */
export function __resetSchemaCache() {
  schemaReady = false;
  inFlight = null;
}

export { SCHEMA_STATEMENTS, DEFAULT_SETTINGS };
