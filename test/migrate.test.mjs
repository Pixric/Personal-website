/**
 * 自动建表测试：模拟「全新部署、数据库完全空白」的场景，
 * 确认 Worker 无需人工执行任何 SQL 就能自己把表建好并正常工作。
 *
 * 运行：node test/migrate.test.mjs
 */

import worker from '../src/worker.js';
import { ensureSchema, __resetSchemaCache, SCHEMA_STATEMENTS, DEFAULT_SETTINGS }
  from '../src/migrate.js';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + ' ' + extra); }
}

/* ============================================================
   一个「真的什么都没有」的 D1：会执行 CREATE TABLE，
   但其他语句在表建好前一律报错 —— 模拟真实全新数据库。
   ============================================================ */

class BlankD1 {
  constructor() {
    this.tables = new Map();          // 表名 -> Map(主键, 行)
    this.executed = [];               // 记录执行过的 SQL
    this.failUntilCreated = true;
  }

  prepare(sql) { return new Stmt(this, sql.replace(/\s+/g, ' ').trim()); }

  async batch(stmts) {
    const out = [];
    for (const s of stmts) out.push(await s.run());
    return out;
  }

  /** 极简 SQL 执行：只实现本项目自动建表用到的语句 */
  exec(sql, params) {
    this.executed.push(sql.slice(0, 60));

    // CREATE TABLE / CREATE INDEX
    if (/^CREATE TABLE IF NOT EXISTS (\w+)/i.test(sql)) {
      const name = /^CREATE TABLE IF NOT EXISTS (\w+)/i.exec(sql)[1];
      if (!this.tables.has(name)) this.tables.set(name, new Map());
      return { success: true, meta: { changes: 0 }, results: [] };
    }
    if (/^CREATE INDEX IF NOT EXISTS/i.test(sql)) {
      return { success: true, meta: { changes: 0 }, results: [] };
    }

    // 判断 settings 表是否已存在，模拟真实数据库的行为
    if (/FROM sqlite_master/i.test(sql)) {
      const has = this.tables.has('settings');
      const row = has ? { name: 'settings' } : null;
      return { success: true, meta: {}, results: row ? [row] : [], first: row };
    }

    // 表不存在时，任何读写都报错（这就是真实 D1 的行为）
    const tableRef = /\b(?:INTO|FROM|UPDATE|DELETE FROM)\s+(\w+)/i.exec(sql);
    if (tableRef && !this.tables.has(tableRef[1])) {
      throw new Error('no such table: ' + tableRef[1]);
    }

    if (/^INSERT OR IGNORE INTO settings/i.test(sql)) {
      const table = this.tables.get('settings');
      if (!table.has(params[0])) {
        table.set(params[0], { key: params[0], value: params[1], updated_at: params[2] });
      }
      return { success: true, meta: { changes: 1 }, results: [] };
    }

    // setSetting 用的 UPSERT
    if (/^INSERT INTO settings/i.test(sql) && /ON CONFLICT\(key\) DO UPDATE/i.test(sql)) {
      const table = this.tables.get('settings');
      table.set(params[0], { key: params[0], value: params[1], updated_at: params[2] });
      return { success: true, meta: { changes: 1 }, results: [] };
    }

    if (/^INSERT INTO admins/i.test(sql)) {
      const table = this.tables.get('admins');
      const id = table.size + 1;
      table.set(id, { id, username: params[0], password_hash: params[1], created_at: params[2] });
      return { success: true, meta: { changes: 1, last_row_id: id }, results: [] };
    }

    if (/^INSERT INTO sessions/i.test(sql)) {
      const table = this.tables.get('sessions');
      table.set(params[0], {
        token: params[0], admin_id: params[1], created_at: params[2],
        expires_at: params[3], ip: params[4], user_agent: params[5],
      });
      return { success: true, meta: { changes: 1 }, results: [] };
    }
    if (/^DELETE FROM sessions WHERE expires_at < \?/i.test(sql)) {
      return { success: true, meta: { changes: 0 }, results: [] };
    }

    if (/^SELECT key, value FROM settings/i.test(sql)) {
      const results = [...this.tables.get('settings').values()];
      return { success: true, meta: {}, results };
    }

    if (/^SELECT id FROM admins WHERE username = \?/i.test(sql)) {
      const row = [...this.tables.get('admins').values()]
        .find((a) => a.username === params[0]);
      return { success: true, meta: {}, results: row ? [row] : [], first: row || null };
    }

    if (/^SELECT COUNT\(\*\) AS n FROM admins/i.test(sql)) {
      const n = this.tables.has('admins') ? this.tables.get('admins').size : 0;
      return { success: true, meta: {}, results: [{ n }], first: { n } };
    }

    if (/^SELECT[\s\S]*FROM tracks/i.test(sql)) {
      return { success: true, meta: {}, results: [] };
    }
    if (/^SELECT[\s\S]*FROM socials/i.test(sql)) {
      return { success: true, meta: {}, results: [] };
    }

    throw new Error('BlankD1 未实现: ' + sql.slice(0, 80));
  }
}

class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.params = []; }
  bind(...p) { this.params = p; return this; }
  async run() { return this.db.exec(this.sql, this.params); }
  async first() { return this.db.exec(this.sql, this.params).first ?? null; }
  async all() { return this.db.exec(this.sql, this.params); }
}

/* ============================================================
   测试
   ============================================================ */

const DB = new BlankD1();
const env = {
  DB,
  BUCKET: { async get() { return null; }, async put() { return {}; }, async delete() {} },
  ASSETS: {
    async fetch() {
      return new Response('<!doctype html><title>assets</title>',
        { headers: { 'content-type': 'text/html' } });
    },
  },
};

async function call(path, opts = {}) {
  const res = await worker.fetch(new Request('https://x.dev' + path, opts), env, {});
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

console.log('\n[全新部署：数据库完全空白]');

check('开始前确实没有任何表', DB.tables.size === 0);

// 第一次请求就应触发自动建表
let r = await call('/api/setup/status');
check('首次访问状态接口成功', r.status === 200 && r.body.ok === true, 'status=' + r.status);
check('返回 database_ready=true', r.body.database_ready === true);
check('initialized=false（等待用户初始化）', r.body.initialized === false);

check('自动创建了 settings 表', DB.tables.has('settings'));
check('自动创建了 admins 表', DB.tables.has('admins'));
check('自动创建了 sessions 表', DB.tables.has('sessions'));
check('自动创建了 tracks 表', DB.tables.has('tracks'));
check('自动创建了 socials 表', DB.tables.has('socials'));
check('自动创建了 assets 表', DB.tables.has('assets'));
check(`共创建 ${DB.tables.size} 张表（期望 6）`, DB.tables.size === 6);

console.log('\n[默认设置已自动写入]');
check('写入了全部默认设置',
  DB.tables.get('settings').size >= DEFAULT_SETTINGS.length,
  '实际 ' + DB.tables.get('settings').size + ' / 期望 ' + DEFAULT_SETTINGS.length);
check('默认站点名为「贪睡」',
  DB.tables.get('settings').get('site_name')?.value === '贪睡');
check('默认未初始化',
  DB.tables.get('settings').get('initialized')?.value === '0');
check('默认电报链接为 COASCN',
  DB.tables.get('settings').get('tg_url')?.value === 'https://t.me/COASCN');

console.log('\n[完整初始化流程可跑通（全程无需手工 SQL）]');

r = await call('/api/site');
check('前台配置接口正常', r.status === 200 && r.body.database_ready === true);
check('前台为未初始化状态', r.body.initialized === false);

r = await call('/backstage');
check('后台页面可打开', r.status === 200);

r = await call('/api/setup/entry', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ entry: 'coas2024' }),
});
check('设置安全入口成功', r.status === 200 && !r.body.error, JSON.stringify(r.body));

r = await call('/api/setup/admin', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'secret123', password_confirm: 'secret123' }),
});
check('注册管理员成功', r.status === 200 && r.body.message === '一切完成', JSON.stringify(r.body));

r = await call('/api/setup/status');
check('站点已初始化', r.body.initialized === true);

check('管理员已写入 admins 表', DB.tables.get('admins').size === 1);
check('密码是哈希而非明文',
  !JSON.stringify([...DB.tables.get('admins').values()]).includes('secret123'));

console.log('\n[重复调用是安全的（幂等）]');
__resetSchemaCache();
const tablesBefore = DB.tables.size;
const settingsBefore = DB.tables.get('settings').size;

r = await call('/api/setup/status');
check('再次触发迁移不报错', r.status === 200);
check('表数量不变', DB.tables.size === tablesBefore, DB.tables.size + ' vs ' + tablesBefore);
check('设置数量不变（未覆盖已改的值）',
  DB.tables.get('settings').size === settingsBefore);
check('密码未被重置', DB.tables.get('admins').size === 1);

console.log('\n[并发请求只迁移一次]');
__resetSchemaCache();
const DB2 = new BlankD1();
const env2 = { ...env, DB: DB2 };
const results = await Promise.all(
  Array.from({ length: 10 }, () =>
    worker.fetch(new Request('https://x.dev/api/setup/status'), env2, {}))
);
check('10 个并发请求全部成功', results.every((x) => x.status === 200));
check('并发下仍只建了 6 张表', DB2.tables.size === 6, '实际 ' + DB2.tables.size);
check('并发下设置未重复写入',
  DB2.tables.get('settings').size === DEFAULT_SETTINGS.length,
  '实际 ' + DB2.tables.get('settings').size);

console.log('\n[数据库不可用时不崩溃]');
__resetSchemaCache();
const brokenEnv = {
  DB: { prepare() { throw new Error('D1 未绑定'); }, async batch() { throw new Error('x'); } },
  BUCKET: {},
  ASSETS: env.ASSETS,
};
const ok = await ensureSchema(brokenEnv);
check('ensureSchema 返回 false 而不是抛错', ok === false);

console.log('\n[未绑定 R2 时优雅降级]');
__resetSchemaCache();
const DB3 = new BlankD1();
const noR2Env = { DB: DB3, ASSETS: env.ASSETS }; // 故意不给 BUCKET

let r3 = await worker.fetch(
  new Request('https://x.dev/api/setup/status'), noR2Env, {});
check('没有 R2 也能完成自动建表', r3.status === 200);

r3 = await worker.fetch(new Request('https://x.dev/api/site'), noR2Env, {});
check('前台配置接口正常', r3.status === 200);

r3 = await worker.fetch(new Request('https://x.dev/api/file/x.png'), noR2Env, {});
check('读取文件返回 404 而非 500', r3.status === 404, 'status=' + r3.status);

const { storageReady } = await import('../src/lib.js');
check('storageReady 正确识别未绑定', storageReady(noR2Env) === false);
check('storageReady 正确识别已绑定', storageReady(env) === true);

console.log('\n[与 schema.sql 保持一致]');
const fs = await import('node:fs/promises');
const schemaSql = await fs.readFile(new URL('../schema.sql', import.meta.url), 'utf8');
for (const t of ['settings', 'admins', 'sessions', 'tracks', 'socials', 'assets']) {
  check(`schema.sql 中也有 ${t} 表`,
    new RegExp('CREATE TABLE IF NOT EXISTS ' + t + '\\b').test(schemaSql));
}
check('自动建表覆盖 6 张表', SCHEMA_STATEMENTS.filter(
  (s) => /^CREATE TABLE/.test(s)).length === 6);
check('默认设置与 schema.sql 键集合一致',
  DEFAULT_SETTINGS.every(([k]) => schemaSql.includes(`('${k}'`)));

console.log('\n' + '='.repeat(50));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);
