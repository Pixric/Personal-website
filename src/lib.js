/**
 * 通用工具：JSON 响应、密码哈希、会话、R2 读写。
 * 全部基于 Web Crypto（Workers 原生，无需第三方依赖）。
 */

const PBKDF2_ITERATIONS = 120000;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 天

/* ------------------------------------------------------------------ */
/* HTTP 辅助                                                           */
/* ------------------------------------------------------------------ */

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers || {}),
    },
  });
}

export function ok(data = { ok: true }) {
  return json(data);
}

export function fail(message, status = 400) {
  return json({ ok: false, error: message }, { status });
}

/* ------------------------------------------------------------------ */
/* 编码辅助                                                            */
/* ------------------------------------------------------------------ */

const enc = new TextEncoder();

function toBase64Url(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** 恒定时间比较，避免时序侧信道 */
export function timingSafeEqual(a, b) {
  const ba = enc.encode(String(a));
  const bb = enc.encode(String(b));
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

/* ------------------------------------------------------------------ */
/* 密码哈希：PBKDF2-HMAC-SHA256                                        */
/* 存储格式：pbkdf2$<迭代次数>$<salt base64url>$<hash base64url>        */
/* ------------------------------------------------------------------ */

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    const iterations = parseInt(parts[1], 10);
    if (!Number.isFinite(iterations) || iterations <= 0) return false;
    const salt = fromBase64Url(parts[2]);
    const expected = fromBase64Url(parts[3]);
    const actual = await pbkdf2(password, salt, iterations, expected.length);
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}

async function pbkdf2(password, salt, iterations, length = 32) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(password)),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

/* ------------------------------------------------------------------ */
/* 简易内存限流（单实例有效，足以挡住暴力破解；多实例时请改用 D1/KV）  */
/* ------------------------------------------------------------------ */

const buckets = new Map();

export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || now > entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  entry.count += 1;
  if (entry.count > max) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

/* ------------------------------------------------------------------ */
/* 校验                                                                */
/* ------------------------------------------------------------------ */

export const LIMITS = {
  securityEntryMin: 5,
  securityEntryMax: 64,
  usernameMin: 3,
  usernameMax: 32,
  passwordMin: 6,
  passwordMax: 128,
  socialsSoftMax: 5,
  tracksMax: 50,
};

/** 安全入口只允许 URL 路径安全字符，避免破坏路由 */
export function validateSecurityEntry(raw) {
  const v = String(raw || '').trim();
  if (v.length < LIMITS.securityEntryMin) {
    return { ok: false, error: `安全入口至少 ${LIMITS.securityEntryMin} 位` };
  }
  if (v.length > LIMITS.securityEntryMax) {
    return { ok: false, error: `安全入口最多 ${LIMITS.securityEntryMax} 位` };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(v)) {
    return { ok: false, error: '安全入口只能包含字母、数字、下划线和中划线' };
  }
  // 避免和内置路由撞车
  const reserved = new Set(['api', 'assets', 'backstage', 'admin', 'login', 'logout', 'setup', 'favicon.ico']);
  if (reserved.has(v.toLowerCase())) {
    return { ok: false, error: `“${v}”是系统保留路径，请换一个` };
  }
  return { ok: true, value: v };
}

export function validateUsername(raw) {
  const v = String(raw || '').trim();
  if (v.length < LIMITS.usernameMin) return { ok: false, error: `账号至少 ${LIMITS.usernameMin} 位` };
  if (v.length > LIMITS.usernameMax) return { ok: false, error: `账号最多 ${LIMITS.usernameMax} 位` };
  if (!/^[A-Za-z0-9_.@-]+$/.test(v)) {
    return { ok: false, error: '账号只能包含字母、数字及 _ . @ - ' };
  }
  return { ok: true, value: v };
}

export function validatePassword(raw) {
  const v = String(raw || '');
  if (v.length < LIMITS.passwordMin) return { ok: false, error: `密码至少 ${LIMITS.passwordMin} 位` };
  if (v.length > LIMITS.passwordMax) return { ok: false, error: `密码最多 ${LIMITS.passwordMax} 位` };
  return { ok: true, value: v };
}

/** 把二进制/十六进制字符串哈希成短摘要（用于基于 IP 的限流键） */
export async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(String(input)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ */
/* 会话                                                                */
/* ------------------------------------------------------------------ */

export async function createSession(env, adminId, request) {
  const token = randomToken(32);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO sessions (token, admin_id, created_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      token,
      adminId,
      now,
      now + SESSION_TTL_MS,
      request.headers.get('CF-Connecting-IP') || '',
      (request.headers.get('User-Agent') || '').slice(0, 200)
    )
    .run();
  return { token, expiresAt: now + SESSION_TTL_MS };
}

export function sessionCookie(token, maxAgeSeconds) {
  // HttpOnly：JS 读不到；SameSite=Strict：防 CSRF；Secure：仅 HTTPS
  return `grwz_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function clearCookie() {
  return 'grwz_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
}

function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

/** 返回当前登录的管理员，未登录返回 null */
export async function currentAdmin(request, env) {
  const token = readCookie(request, 'grwz_session');
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT s.token, s.expires_at, a.id, a.username
       FROM sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.token = ?`
  )
    .bind(token)
    .first();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  return { id: row.id, username: row.username, token: row.token };
}

/* ------------------------------------------------------------------ */
/* 设置读写                                                            */
/* ------------------------------------------------------------------ */

export async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of results || []) out[r.key] = r.value;
  return out;
}

export async function setSetting(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )
    .bind(key, String(value), Date.now())
    .run();
}

export async function setSettings(env, patch) {
  const entries = Object.entries(patch || {});
  if (!entries.length) return;
  const now = Date.now();

  // 注意：每条语句都必须用全新的 prepare()。
  // D1 的 bind() 会就地修改 statement 并返回自身，若复用同一个对象，
  // 批次里所有语句最终都会带着最后一次绑定的参数执行。
  await env.DB.batch(
    entries.map(([k, v]) =>
      env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).bind(k, String(v ?? ''), now)
    )
  );
}

/* ------------------------------------------------------------------ */
/* R2 辅助                                                             */
/* ------------------------------------------------------------------ */

export function publicAssetUrl(key) {
  if (!key) return '';
  return `/api/file/${encodeURIComponent(key)}`;
}

/** R2 的 put 在 Workers 中最多接受 100MB 左右的分片；这里统一做容量保护 */
export const MAX_UPLOAD_BYTES = 96 * 1024 * 1024;

/** R2 是否已绑定（未绑定时网站仍可正常浏览，只是不能上传） */
export function storageReady(env) {
  return Boolean(env && env.BUCKET && typeof env.BUCKET.put === 'function');
}

export async function putObject(env, key, body, httpMetadata = {}) {
  if (!storageReady(env)) {
    throw new Error('尚未开通文件存储（R2），请先在 Cloudflare 控制台为 Worker 绑定 R2 bucket');
  }
  await env.BUCKET.put(key, body, { httpMetadata });
  return key;
}

export async function deleteObject(env, key) {
  if (!key || !storageReady(env)) return;
  try {
    await env.BUCKET.delete(key);
  } catch {
    /* 忽略：对象可能已不存在 */
  }
}

/** 删除某个前缀下的全部对象（用于替换整站备份等场景） */
export async function deletePrefix(env, prefix) {
  if (!storageReady(env)) return;
  let cursor;
  do {
    const list = await env.BUCKET.list({ prefix, cursor, limit: 200 });
    const keys = (list.objects || []).map((o) => o.key);
    if (keys.length) await env.BUCKET.delete(keys);
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}

/* ------------------------------------------------------------------ */
/* 文件名/类型辅助                                                     */
/* ------------------------------------------------------------------ */

export function safeExt(filename, fallback = 'bin') {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(String(filename || ''));
  return m ? m[1].toLowerCase() : fallback;
}

export function guessMime(filename, provided) {
  if (provided && provided !== 'application/octet-stream') return provided;
  const ext = safeExt(filename, '');
  const map = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    wav: 'audio/wav',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    ico: 'image/x-icon',
  };
  return map[ext] || 'application/octet-stream';
}
