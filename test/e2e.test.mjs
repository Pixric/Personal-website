/**
 * 端到端测试：在 Node 中直接执行 Worker，
 * 用内存实现模拟 D1（SQL 子集）与 R2，验证真实请求/响应行为。
 *
 * 运行：node test/e2e.test.mjs
 */

import worker from '../src/worker.js';

/* ============================================================
   极简 D1 模拟
   ============================================================ */

/**
 * 把一次 UPDATE 应用到内存表。
 * 返回值遵循真实 D1Result 结构：changes 位于 meta 之下
 * （见 https://developers.cloudflare.com/d1/worker-api/return-object/）。
 */
function applyUpdate(table, sql, params) {
  const up = sql.toUpperCase();
  const body = sql.slice(up.indexOf(' SET ') + 5, up.indexOf(' WHERE '));
  const cols = [...body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\?/g)].map((m) => m[1]);
  const key = params[params.length - 1];
  const row = table.get(key);
  if (!row) return { success: true, meta: { changes: 0 }, results: [] };
  cols.forEach((c, i) => { row[c] = params[i]; });
  return { success: true, meta: { changes: 1 }, results: [] };
}

/** 统一的写入结果（插入/更新/删除），changes 放在 meta 里 */
function writeResult(changes) {
  return { success: true, meta: { changes }, results: [] };
}

class MockD1 {
  constructor() {
    this.tables = {
      settings: new Map(),
      admins: new Map(),
      sessions: new Map(),
      tracks: new Map(),
      socials: new Map(),
      assets: new Map(),
    };
    this.seq = { admins: 0, tracks: 0, socials: 0 };
  }

  prepare(sql) { return new MockStmt(this, sql.trim()); }

  async batch(stmts) {
    const out = [];
    for (const s of stmts) out.push(await s.run());
    return out;
  }

  exec(sql, params) {
    const s = sql.replace(/\s+/g, ' ');

    /* ---- settings ---- */
    if (/^INSERT INTO settings/i.test(s)) {
      this.tables.settings.set(params[0], {
        key: params[0], value: String(params[1]), updated_at: params[2],
      });
      return writeResult(1);
    }
    if (/^SELECT key, value FROM settings/i.test(s)) {
      return { results: [...this.tables.settings.values()] };
    }
    if (/^SELECT value FROM settings WHERE key = \?/i.test(s)) {
      const row = this.tables.settings.get(params[0]);
      return { results: row ? [row] : [], first: row || null };
    }
    if (/^SELECT COUNT\(\*\) AS n FROM admins/i.test(s)) {
      const n = this.tables.admins.size;
      return { results: [{ n }], first: { n } };
    }

    /* ---- admins ---- */
    if (/^INSERT INTO admins/i.test(s)) {
      const id = ++this.seq.admins;
      this.tables.admins.set(id, {
        id, username: params[0], password_hash: params[1], created_at: params[2],
      });
      return { success: true, meta: { changes: 1, last_row_id: id }, results: [] };
    }
    if (/^SELECT id, username, password_hash FROM admins WHERE username = \?/i.test(s)) {
      const row = [...this.tables.admins.values()].find((a) => a.username === params[0]);
      return { results: row ? [row] : [], first: row || null };
    }
    if (/^SELECT id FROM admins WHERE username = \? AND id <> \?/i.test(s)) {
      const row = [...this.tables.admins.values()]
        .find((a) => a.username === params[0] && a.id !== params[1]);
      return { results: row ? [row] : [], first: row || null };
    }
    if (/^SELECT id FROM admins WHERE username = \?/i.test(s)) {
      const row = [...this.tables.admins.values()].find((a) => a.username === params[0]);
      return { results: row ? [row] : [], first: row || null };
    }
    if (/^SELECT password_hash FROM admins WHERE id = \?/i.test(s)) {
      const row = this.tables.admins.get(params[0]);
      return { results: row ? [row] : [], first: row || null };
    }
    if (/^UPDATE admins SET/i.test(s)) return applyUpdate(this.tables.admins, s, params);

    /* ---- sessions ---- */
    if (/^INSERT INTO sessions/i.test(s)) {
      this.tables.sessions.set(params[0], {
        token: params[0], admin_id: params[1], created_at: params[2],
        expires_at: params[3], ip: params[4], user_agent: params[5],
      });
      return writeResult(1);
    }
    if (/^SELECT s\.token[\s\S]*FROM sessions s JOIN admins a/i.test(s)) {
      const sess = this.tables.sessions.get(params[0]);
      if (!sess) return { results: [], first: null };
      const admin = this.tables.admins.get(sess.admin_id);
      const row = admin
        ? { token: sess.token, expires_at: sess.expires_at, id: admin.id, username: admin.username }
        : null;
      return { results: row ? [row] : [], first: row || null };
    }
    if (/^DELETE FROM sessions WHERE token = \?/i.test(s)) {
      return writeResult(this.tables.sessions.delete(params[0]) ? 1 : 0);
    }
    if (/^DELETE FROM sessions WHERE admin_id = \? AND token NOT IN/i.test(s)) {
      const rows = [...this.tables.sessions.values()]
        .filter((x) => x.admin_id === params[0])
        .sort((a, b) => b.created_at - a.created_at);
      rows.slice(5).forEach((row) => this.tables.sessions.delete(row.token));
      return writeResult(0);
    }
    if (/^DELETE FROM sessions WHERE admin_id = \? AND token <> \?/i.test(s)) {
      let n = 0;
      for (const [k, v] of [...this.tables.sessions]) {
        if (v.admin_id === params[0] && v.token !== params[1]) {
          this.tables.sessions.delete(k); n++;
        }
      }
      return writeResult(n);
    }
    if (/^DELETE FROM sessions WHERE expires_at < \?/i.test(s)) {
      let n = 0;
      for (const [k, v] of [...this.tables.sessions]) {
        if (v.expires_at < params[0]) { this.tables.sessions.delete(k); n++; }
      }
      return writeResult(n);
    }

    /* ---- tracks ---- */
    if (/^INSERT INTO tracks/i.test(s)) {
      const id = ++this.seq.tracks;
      this.tables.tracks.set(id, {
        id, title: params[0], artist: params[1], r2_key: params[2], cover_key: params[3],
        size: params[4], mime: params[5], duration: params[6],
        sort_order: params[7], created_at: params[8],
      });
      return { success: true, meta: { changes: 1, last_row_id: id }, results: [] };
    }
    if (/^SELECT[\s\S]*FROM tracks ORDER BY sort_order/i.test(s)) {
      const rows = [...this.tables.tracks.values()]
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      return { results: rows, first: rows[0] || null };
    }
    if (/^SELECT COUNT\(\*\) AS n FROM tracks/i.test(s)) {
      const n = this.tables.tracks.size;
      return { results: [{ n }], first: { n } };
    }
    if (/^SELECT COALESCE\(MAX\(sort_order\), -1\) AS m FROM tracks/i.test(s)) {
      const m = Math.max(-1, ...[...this.tables.tracks.values()].map((t) => t.sort_order));
      return { results: [{ m }], first: { m } };
    }
    if (/^UPDATE tracks SET/i.test(s)) return applyUpdate(this.tables.tracks, s, params);
    if (/^SELECT r2_key, cover_key FROM tracks WHERE id = \?/i.test(s)) {
      const row = this.tables.tracks.get(params[0]);
      return { results: row ? [row] : [], first: row || null };
    }
    if (/^DELETE FROM tracks WHERE id = \?/i.test(s)) {
      return writeResult(this.tables.tracks.delete(params[0]) ? 1 : 0);
    }
    if (/^DELETE FROM tracks$/i.test(s)) {
      this.tables.tracks.clear();
      return writeResult(1);
    }

    /* ---- socials ---- */
    if (/^INSERT INTO socials/i.test(s)) {
      const id = ++this.seq.socials;
      this.tables.socials.set(id, {
        id, label: params[0], url: params[1], icon: params[2],
        icon_key: params[3], sort_order: params[4], enabled: 1,
      });
      return { success: true, meta: { changes: 1, last_row_id: id }, results: [] };
    }
    if (/^SELECT[\s\S]*FROM socials WHERE enabled = 1/i.test(s)) {
      const rows = [...this.tables.socials.values()]
        .filter((x) => x.enabled === 1)
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      return { results: rows, first: rows[0] || null };
    }
    if (/^SELECT[\s\S]*FROM socials ORDER BY sort_order/i.test(s)) {
      const rows = [...this.tables.socials.values()]
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      return { results: rows, first: rows[0] || null };
    }
    if (/^SELECT COUNT\(\*\) AS n FROM socials/i.test(s)) {
      const n = this.tables.socials.size;
      return { results: [{ n }], first: { n } };
    }
    if (/^SELECT COALESCE\(MAX\(sort_order\), -1\) AS m FROM socials/i.test(s)) {
      const m = Math.max(-1, ...[...this.tables.socials.values()].map((t) => t.sort_order));
      return { results: [{ m }], first: { m } };
    }
    if (/^DELETE FROM socials WHERE id = \?/i.test(s)) {
      return writeResult(this.tables.socials.delete(params[0]) ? 1 : 0);
    }
    if (/^SELECT icon_key FROM socials WHERE id = \?/i.test(s)) {
      const row = this.tables.socials.get(params[0]);
      return { results: row ? [row] : [], first: row || null };
    }
    if (/^UPDATE socials SET/i.test(s)) return applyUpdate(this.tables.socials, s, params);

    /* ---- assets ---- */
    if (/^INSERT INTO assets/i.test(s)) {
      this.tables.assets.set(params[0], {
        key: params[0], size: params[1], mime: params[2],
        original_name: params[3], kind: params[4], uploaded_at: params[5],
      });
      return writeResult(1);
    }
    if (/^SELECT key, size, uploaded_at FROM assets/i.test(s)) {
      return { results: [...this.tables.assets.values()] };
    }
    if (/^DELETE FROM assets WHERE key = \?/i.test(s)) {
      this.tables.assets.delete(params[0]);
      return writeResult(1);
    }
    if (/^DELETE FROM assets$/i.test(s)) {
      this.tables.assets.clear();
      return writeResult(1);
    }

    throw new Error('MockD1 unimplemented SQL: ' + s.slice(0, 120));
  }
}

class MockStmt {
  /**
   * 忠实模拟 D1 的 bind 语义：bind() 就地改写 statement 并返回自身。
   * 这样「复用同一个 statement 去 batch」的写法才会在测试里暴露出来
   * —— 真实 D1 也会因此只保留最后一次绑定的参数。
   */
  constructor(db, sql) { this.db = db; this.sql = sql; this.params = []; }
  bind(...p) { this.params = p; return this; }
  async run() { return this.db.exec(this.sql, this.params); }
  async first() { return this.db.exec(this.sql, this.params).first ?? null; }
  async all() { return this.db.exec(this.sql, this.params); }
}

/* ============================================================
   极简 R2 模拟
   ============================================================ */

class MockR2 {
  constructor() { this.store = new Map(); }

  async put(key, body, opts = {}) {
    let bytes;
    if (body instanceof ReadableStream) {
      const chunks = [];
      const reader = body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
      }
      bytes = Buffer.concat(chunks);
    } else if (typeof body === 'string') {
      bytes = Buffer.from(body);
    } else if (body && typeof body.arrayBuffer === 'function') {
      bytes = Buffer.from(await body.arrayBuffer());
    } else {
      bytes = Buffer.from(body || []);
    }
    this.store.set(key, { bytes, httpMetadata: opts.httpMetadata || {} });
    return { key };
  }

  async get(key, opts) {
    const o = this.store.get(key);
    if (!o) return null;
    let bytes = o.bytes;
    let range = null;
    if (opts && opts.range) {
      const r = opts.range;
      const offset = r.offset ?? Math.max(0, bytes.length - (r.suffix || 0));
      const length = r.length ?? bytes.length - offset;
      range = { offset, length };
      bytes = bytes.subarray(offset, offset + length);
    }
    return {
      body: new Response(bytes).body,
      size: bytes.length,
      range,
      httpEtag: '"' + key + '"',
      httpMetadata: o.httpMetadata,
    };
  }

  async delete(key) {
    if (Array.isArray(key)) key.forEach((k) => this.store.delete(k));
    else this.store.delete(key);
  }

  async list({ prefix = '' } = {}) {
    const objects = [...this.store.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((k) => ({ key: k }));
    return { objects, truncated: false };
  }
}

/* ============================================================
   环境
   ============================================================ */

const DB = new MockD1();
const BUCKET = new MockR2();

/**
 * 载入 schema.sql 里的默认设置 —— 真实部署会先执行 schema.sql，
 * 这里让内存库保持同样的初始状态，避免测试与线上行为不一致。
 */
function seedDefaults(db) {
  const now = Date.now();
  const defaults = [
    ['initialized', '0'], ['security_entry', ''],
    ['site_name', '贪睡'], ['nickname', ''],
    ['about_text', '常年研究逆向工具软件，擅长搭建网站。'],
    ['avatar_key', ''], ['bg_key', ''],
    ['music_enabled', '1'], ['music_mode', 'default'],
    ['github_user', ''], ['github_show_repos', '1'], ['github_show_chart', '1'],
    ['anim_intro', '1'], ['anim_bg', '1'], ['anim_reveal', '1'],
    ['anim_avatar', '1'], ['anim_player', '1'],
    ['footer_text', ''], ['footer_opacity', '0.55'], ['footer_color', '#8a8a8e'],
    ['footer_link', ''],
    ['tg_enabled', '1'], ['tg_title', '加入我的频道'],
    ['tg_sub', '加入就是最大的帮助'], ['tg_url', 'https://t.me/COASCN'],
  ];
  for (const [key, value] of defaults) {
    db.tables.settings.set(key, { key, value, updated_at: now });
  }
}
seedDefaults(DB);

const env = {
  DB,
  BUCKET,
  ASSETS: {
    async fetch(request) {
      const url = new URL(request.url);
      return new Response('<!doctype html><title>' + url.pathname + '</title>', {
        headers: { 'content-type': 'text/html' },
      });
    },
  },
};

const BASE = 'https://me.coas.top';

function req(path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  headers.set('CF-Connecting-IP', opts.ip || '1.2.3.4');
  return new Request(BASE + path, { ...opts, headers });
}

async function call(path, opts) {
  const res = await worker.fetch(req(path, opts), env, {});
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

let pass = 0;
let fail = 0;

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + ' ' + extra); }
}

/** 成功 = HTTP 2xx 且响应体里没有 error 字段 */
function isOk(r) {
  return r.status >= 200 && r.status < 300
    && r.body && typeof r.body === 'object' && !r.body.error;
}

const post = (path, body, extra = {}) => call(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
  ...extra,
});

/* ============================================================
   1. 未初始化
   ============================================================ */

console.log('\n[1] 部署后未初始化');

let r = await call('/api/setup/status');
check('状态接口可用', r.status === 200 && r.body.ok === true);
check('initialized = false', r.body.initialized === false);
check('安全入口未设置', r.body.security_entry_set === false);

r = await call('/api/site');
check('前台配置可读取', r.status === 200 && r.body.ok === true);
check('前台被告知未初始化', r.body.initialized === false);

r = await call('/api/admin/state');
check('未登录访问后台被拒', r.status === 401, JSON.stringify(r.body));

r = await post('/api/auth/login', { username: 'admin', password: '123456' });
check('未初始化时不能登录', r.status === 400);

r = await call('/');
check('普通路径回落到前台', String(r.body).includes('<!doctype html'));

/* ============================================================
   2. 安全入口
   ============================================================ */

console.log('\n[2] 第 1 步：设置安全入口');

r = await post('/api/setup/entry', { entry: 'abc' });
check('拒绝 4 位以下入口', r.status === 400, JSON.stringify(r.body));

r = await post('/api/setup/entry', { entry: 'ab cd' });
check('拒绝含空格的入口', r.status === 400);

r = await post('/api/setup/entry', { entry: 'backstage' });
check('拒绝系统保留路径', r.status === 400);

r = await post('/api/setup/entry', { entry: 'coas2024' });
check('接受合法安全入口', isOk(r), JSON.stringify(r.body));

r = await call('/api/setup/status');
check('安全入口已记录', r.body.security_entry_set === true);
check('仍未初始化（未注册管理员）', r.body.initialized === false);

/* ============================================================
   3. 注册管理员
   ============================================================ */

console.log('\n[3] 第 2 步：注册管理员');

r = await post('/api/setup/admin', { username: 'ab', password: '123456', password_confirm: '123456' });
check('拒绝 2 位账号', r.status === 400, JSON.stringify(r.body));

r = await post('/api/setup/admin', { username: 'admin', password: '12345', password_confirm: '12345' });
check('拒绝 5 位密码', r.status === 400);

r = await post('/api/setup/admin', { username: 'admin', password: '123456', password_confirm: '654321' });
check('拒绝两次密码不一致', r.status === 400);

r = await post('/api/setup/admin', { username: 'admin', password: 'secret123', password_confirm: 'secret123' });
check('注册成功', isOk(r), JSON.stringify(r.body));
check('返回「一切完成」', r.body.message === '一切完成');
check('返回安全入口供跳转', r.body.entry === 'coas2024');
check('注册后直接签发会话', /grwz_session=/.test(r.headers.get('set-cookie') || ''));

const adminRow = [...DB.tables.admins.values()][0];
check('数据库中无明文密码', !JSON.stringify(adminRow).includes('secret123'));
check('密码为 PBKDF2 哈希', /^pbkdf2\$120000\$/.test(adminRow.password_hash));

r = await post('/api/setup/admin', { username: 'admin2', password: 'secret123', password_confirm: 'secret123' });
check('已注册后不能重复注册', r.status === 403);

r = await call('/api/setup/status');
check('站点已初始化', r.body.initialized === true);

/* ============================================================
   4. 路由
   ============================================================ */

console.log('\n[4] 安全入口路由');

r = await call('/coas2024');
check('安全入口显示后台页面', String(r.body).includes('/backstage.html'),
  String(r.body).slice(0, 60));

r = await call('/coas2024/anything');
check('安全入口子路径也进后台', String(r.body).includes('/backstage.html'));

r = await call('/backstage');
check('/backstage 是初始化与救援入口', String(r.body).includes('/backstage.html'));

r = await call('/coas2025');
check('错误入口继续显示主内容',
  String(r.body).includes('<!doctype html') && !String(r.body).includes('/backstage.html'));

r = await call('/me');
check('任意其他路径显示主内容',
  String(r.body).includes('<!doctype html') && !String(r.body).includes('/backstage.html'));

r = await call('/');
check('根路径显示主内容', !String(r.body).includes('/backstage.html'));

/* ============================================================
   5. 登录
   ============================================================ */

console.log('\n[5] 登录');

r = await post('/api/auth/login', { username: 'admin', password: 'wrong' });
check('错误密码被拒', r.status === 401);

r = await post('/api/auth/login', { username: 'nobody', password: 'secret123' });
check('不存在的账号被拒', r.status === 401);

r = await post('/api/auth/login', { username: 'admin', password: 'secret123' });
check('正确密码登录成功', isOk(r), JSON.stringify(r.body));
const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
check('下发会话 Cookie', /^grwz_session=.+/.test(cookie));

const auth = { headers: { cookie } };

r = await call('/api/admin/state', auth);
check('带会话可访问后台', r.status === 200 && r.body.ok === true);
check('返回设置项', r.body.settings && 'site_name' in r.body.settings);
check('音乐上限 50', r.body.limits.tracksMax === 50);
check('社交建议数 5', r.body.limits.socialsSoftMax === 5);

/* ============================================================
   6. 设置
   ============================================================ */

console.log('\n[6] 站点设置');

r = await call('/api/admin/settings', {
  method: 'PUT',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({
    site_name: '贪睡',
    nickname: 'Pixric',
    about_text: '常年研究逆向工具软件，擅长搭建网站。',
    anim_intro: false,
    anim_bg: true,
    music_enabled: true,
    music_mode: 'random',
    github_user: 'Pixric',
    footer_text: '© 2024 贪睡',
    footer_opacity: 0.4,
    footer_color: '#999999',
    tg_enabled: true,
  }),
});
check('保存设置成功', isOk(r), JSON.stringify(r.body));

r = await call('/api/site');
check('前台读到站点名', r.body.site.site_name === '贪睡', r.body.site.site_name);
check('布尔项转为 false', r.body.site.animations.intro === false);
check('布尔项转为 true', r.body.site.animations.background === true);
check('播放模式为随机', r.body.site.music_mode === 'random');
check('页脚透明度生效', Math.abs(r.body.site.footer.opacity - 0.4) < 1e-6,
  String(r.body.site.footer.opacity));
check('页脚颜色生效', r.body.site.footer.color === '#999999', r.body.site.footer.color);
check('电报链接为 COASCN', r.body.site.tg_url === 'https://t.me/COASCN');
check('前台不泄露安全入口',
  !('security_entry' in r.body.site) && !JSON.stringify(r.body).includes('coas2024'));

r = await call('/api/admin/settings', {
  method: 'PUT',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ footer_opacity: 5, footer_color: 'not-a-color' }),
});
check('越界值可提交', isOk(r));

r = await call('/api/site');
check('透明度夹紧到 1', r.body.site.footer.opacity === 1, String(r.body.site.footer.opacity));
check('非法颜色回落默认灰', r.body.site.footer.color === '#8a8a8e');

/* ============================================================
   7. 上传
   ============================================================ */

console.log('\n[7] 文件上传');

function form(fields, file) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append('file', file, file.name);
  return fd;
}

const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' });

let res = await worker.fetch(req('/api/admin/upload', {
  method: 'POST', headers: { cookie }, body: form({ kind: 'avatar' }, png),
}), env, {});
let j = await res.json();
check('头像上传成功', res.status === 200 && j.ok === true, JSON.stringify(j));
const avatarKey = j.key;

res = await worker.fetch(req('/api/admin/upload', {
  method: 'POST', headers: { cookie },
  body: form({ kind: 'track', title: 'Maybe', artist: '测试歌手' },
    new File([new Uint8Array(2048)], 'maybe.mp3', { type: 'audio/mpeg' })),
}), env, {});
j = await res.json();
check('音乐上传成功', res.status === 200 && j.ok === true, JSON.stringify(j));

res = await worker.fetch(req('/api/admin/upload', {
  method: 'POST', headers: { cookie },
  body: form({ kind: 'track' },
    new File([new Uint8Array(10)], 'evil.exe', { type: 'application/x-msdownload' })),
}), env, {});
check('拒绝非音频文件', res.status === 415);

res = await worker.fetch(req('/api/admin/upload', {
  method: 'POST', headers: { cookie },
  body: form({ kind: 'avatar' }, new File([new Uint8Array(10)], 'x.mp3', { type: 'audio/mpeg' })),
}), env, {});
check('拒绝把音频当头像', res.status === 415);

res = await worker.fetch(req('/api/admin/upload', {
  method: 'POST', body: form({ kind: 'avatar' }, png),
}), env, {});
check('未登录不能上传', res.status === 401);

res = await worker.fetch(req('/api/file/' + encodeURIComponent(avatarKey)), env, {});
check('可读取已上传文件', res.status === 200);
check('文件带长缓存头', /immutable/.test(res.headers.get('cache-control') || ''));
check('文件类型正确', res.headers.get('content-type') === 'image/png');

res = await worker.fetch(req('/api/file/' + encodeURIComponent('../secret')), env, {});
check('拒绝目录穿越', res.status === 400);

res = await worker.fetch(req('/api/file/nope.png'), env, {});
check('不存在返回 404', res.status === 404);

res = await worker.fetch(req('/api/admin/upload', {
  method: 'POST', headers: { cookie },
  body: form({ kind: 'avatar' }, new File([new Uint8Array([1, 2, 3])], 'b.png', { type: 'image/png' })),
}), env, {});
j = await res.json();
check('替换头像返回旧 key', j.replaced === avatarKey);
check('旧头像已从 R2 删除', !BUCKET.store.has(avatarKey));
check('新头像存在', BUCKET.store.has(j.key));

r = await call('/api/site');
check('前台返回头像地址', /\/api\/file\/uploads%2Favatar%2F/.test(r.body.site.avatar_url),
  r.body.site.avatar_url);
check('前台返回音乐列表', r.body.tracks.length === 1 && r.body.tracks[0].title === 'Maybe');

/* ============================================================
   8. 音乐与社交
   ============================================================ */

console.log('\n[8] 音乐与社交链接');

r = await call('/api/admin/tracks', auth);
check('列出音乐', r.status === 200 && r.body.tracks.length === 1);

const trackId = r.body.tracks[0].id;

r = await call('/api/admin/tracks/' + trackId, {
  method: 'PUT',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ title: '新名字', artist: '新歌手' }),
});
check('修改音乐信息', isOk(r), JSON.stringify(r.body));

r = await call('/api/site');
check('前台看到新标题', r.body.tracks[0].title === '新名字');
check('前台看到新歌手', r.body.tracks[0].artist === '新歌手');

r = await post('/api/admin/socials', { label: 'X', url: 'https://x.com/me', icon: 'x' }, auth);
check('添加社交链接', isOk(r), JSON.stringify(r.body));
const socId = r.body.id;

r = await post('/api/admin/socials',
  { label: '电报', url: 'https://t.me/COASCN', icon: 'telegram' }, auth);
const socId2 = r.body.id;

r = await post('/api/admin/socials',
  { label: '坏链接', url: 'javascript:alert(1)', icon: 'link' }, auth);
check('拒绝非 http(s) 链接', r.status === 400);

r = await post('/api/admin/socials', { label: '', url: 'https://a.com', icon: 'link' }, auth);
check('拒绝空名称', r.status === 400);

for (let i = 0; i < 4; i++) {
  await post('/api/admin/socials',
    { label: 'S' + i, url: 'https://s' + i + '.com', icon: 'link' }, auth);
}
r = await post('/api/admin/socials', { label: 'S6', url: 'https://s6.com', icon: 'link' }, auth);
check('超过建议数仍可添加', isOk(r), JSON.stringify(r.body));
check('超过建议数给出提示', r.body.hint.length > 0, r.body.hint);
check('总数已超过 5', r.body.count > 5);

r = await call('/api/admin/socials/' + socId2, {
  method: 'PUT',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ enabled: false }),
});
check('可以隐藏社交链接', isOk(r), JSON.stringify(r.body));

r = await call('/api/site');
check('隐藏的链接不出现在前台', !r.body.socials.some((s) => s.id === socId2));
check('前台按顺序返回社交链接', r.body.socials[0].label === 'X');

r = await call('/api/admin/socials/' + socId, { method: 'DELETE', headers: { cookie } });
check('删除社交链接', isOk(r), JSON.stringify(r.body));

/* ============================================================
   9. 账号安全
   ============================================================ */

console.log('\n[9] 账号与安全');

r = await post('/api/admin/credentials', {
  current_password: 'wrong', new_password: 'newpass123', new_password_confirm: 'newpass123',
}, auth);
check('当前密码错误时拒绝修改', r.status === 401);

r = await post('/api/admin/credentials', {
  current_password: 'secret123', new_password: 'abc', new_password_confirm: 'abc',
}, auth);
check('新密码过短被拒绝', r.status === 400);

r = await post('/api/admin/credentials', {
  current_password: 'secret123', new_password: 'newpass123', new_password_confirm: 'different',
}, auth);
check('两次新密码不一致被拒绝', r.status === 400);

r = await post('/api/admin/credentials', {
  current_password: 'secret123',
  new_username: 'owner',
  new_password: 'newpass123',
  new_password_confirm: 'newpass123',
}, auth);
check('修改账号密码成功', isOk(r), JSON.stringify(r.body));

r = await post('/api/auth/login', { username: 'admin', password: 'newpass123' });
check('旧账号无法登录', r.status === 401);

r = await post('/api/auth/login', { username: 'owner', password: 'secret123' });
check('旧密码无法登录', r.status === 401);

r = await post('/api/auth/login', { username: 'owner', password: 'newpass123' });
check('新账号新密码可登录', isOk(r), JSON.stringify(r.body));
const cookie2 = (r.headers.get('set-cookie') || '').split(';')[0];
const auth2 = { headers: { cookie: cookie2 } };

r = await call('/api/admin/state', auth2);
check('新会话可用', r.status === 200);

r = await call('/api/admin/settings', {
  method: 'PUT',
  headers: { 'content-type': 'application/json', cookie: cookie2 },
  body: JSON.stringify({ security_entry: 'newsecret99' }),
});
check('修改安全入口成功', isOk(r), JSON.stringify(r.body));

r = await call('/newsecret99');
check('新安全入口生效', String(r.body).includes('/backstage.html'));

r = await call('/coas2024');
check('旧安全入口已失效', !String(r.body).includes('/backstage.html'));

r = await call('/api/admin/settings', {
  method: 'PUT',
  headers: { 'content-type': 'application/json', cookie: cookie2 },
  body: JSON.stringify({ security_entry: 'abc' }),
});
check('后台也拒绝过短入口', r.status === 400);

/* ============================================================
   10. 会话
   ============================================================ */

console.log('\n[10] 会话');

r = await call('/api/admin/state', { headers: { cookie: 'grwz_session=totally-fake' } });
check('伪造会话被拒', r.status === 401);

r = await post('/api/admin/logout', {}, auth2);
check('退出登录成功', isOk(r), JSON.stringify(r.body));

r = await call('/api/admin/state', auth2);
check('退出后会话失效', r.status === 401);

/* ============================================================
   11. 删除与清空
   ============================================================ */

console.log('\n[11] 删除与清空');

r = await post('/api/auth/login', { username: 'owner', password: 'newpass123' });
const cookie3 = (r.headers.get('set-cookie') || '').split(';')[0];
const auth3 = { headers: { cookie: cookie3 } };
check('可重新登录', isOk(r));

const trackRow = [...DB.tables.tracks.values()][0];
r = await call('/api/admin/tracks/' + trackRow.id,
  { method: 'DELETE', headers: { cookie: cookie3 } });
check('删除音乐成功', isOk(r), JSON.stringify(r.body));
check('R2 中音频已删除', !BUCKET.store.has(trackRow.r2_key));
check('数据库记录已删除', DB.tables.tracks.size === 0);

r = await post('/api/admin/wipe-assets', { confirm: 'no' }, auth3);
check('清空需正确确认词', r.status === 400);

r = await post('/api/admin/wipe-assets', { confirm: 'DELETE' }, auth3);
check('清空上传成功', isOk(r), JSON.stringify(r.body));
check('R2 已清空', BUCKET.store.size === 0);

/* ============================================================
   12. 隐蔽性
   ============================================================ */

console.log('\n[12] 隐蔽性');

for (const p of ['/', '/about', '/gallery', '/newsecret9', '/BackStage', '/NEWSECRET99']) {
  const rr = await call(p);
  check(p + ' 不暴露后台', !String(rr.body).includes('/backstage.html'));
}

/* ============================================================ */

console.log('\n' + '='.repeat(50));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);
