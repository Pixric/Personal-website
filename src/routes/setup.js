/**
 * 初始化与登录：
 *   1. 首次访问 /backstage → 提示设置「安全入口」（≥5 位）
 *   2. 设置完 → 注册管理员（账号 ≥3 位，密码 ≥6 位，PBKDF2 哈希存储）
 *   3. 完成 → 返回「一切完成」（前台淡入展示 4 秒）
 *   4. 之后用 <域名>/<安全入口> 登录
 */

import {
  json,
  fail,
  ok,
  getSettings,
  setSetting,
  setSettings,
  hashPassword,
  createSession,
  sessionCookie,
  currentAdmin,
  verifyPassword,
  validateSecurityEntry,
  validateUsername,
  validatePassword,
  rateLimit,
  sha256Hex,
} from '../lib.js';

/* ------------------------------------------------------------------ */
/* GET /api/setup/status —— 向导每一步的状态                            */
/* ------------------------------------------------------------------ */

export async function setupStatus(env) {
  let s;
  let adminCount = 0;

  try {
    s = await getSettings(env);
    const adminCountRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first();
    adminCount = adminCountRow?.n || 0;
  } catch (err) {
    // 最常见的原因：还没执行 `npm run db:init:remote`，表不存在。
    // 这时不要把 500 抛给前端（会让向导白屏），而是明确告诉它「需要建表」。
    console.error('setup/status 读取数据库失败:', err && err.message);
    return json({
      ok: true,
      initialized: false,
      security_entry_set: false,
      admin_registered: false,
      database_ready: false,
      message: '数据库尚未初始化，请先执行 npm run db:init:remote',
    });
  }

  const entrySet = Boolean(s.security_entry);
  const initialized = s.initialized === '1' && adminCount > 0;

  return json({
    ok: true,
    initialized,
    security_entry_set: entrySet,
    admin_registered: adminCount > 0,
    database_ready: true,
    // 初始化完成后，前端不再回显安全入口（只告诉用户已设置）
    site_name: s.site_name || '',
    site_url: s.site_url || '',
  });
}

/* ------------------------------------------------------------------ */
/* POST /api/setup/entry —— 第 1 步：设置安全入口                        */
/* ------------------------------------------------------------------ */

export async function setupEntry(request, env) {
  const s = await getSettings(env);

  // 已完成初始化则只允许登录后的接口修改
  if (s.initialized === '1') {
    const admin = await currentAdmin(request, env);
    if (!admin) return fail('站点已初始化，无法重复设置', 403);

    const body = await readJson(request);
    const check = validateSecurityEntry(body.entry);
    if (!check.ok) return fail(check.error, 400);
    await setSetting(env, 'security_entry', check.value);
    return ok({ entry: check.value, message: '安全入口已更新' });
  }

  // 未初始化：允许设置，但限流防滥用
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rl = rateLimit(`setup-entry:${await sha256Hex(ip)}`, 20, 10 * 60_000);
  if (!rl.allowed) return fail(`操作过于频繁，请 ${rl.retryAfter} 秒后重试`, 429);

  const body = await readJson(request);
  const check = validateSecurityEntry(body.entry);
  if (!check.ok) return fail(check.error, 400);

  if (s.security_entry && s.security_entry !== check.value) {
    // 已经设置过安全入口、但还没注册管理员：允许覆写（用户可能刚部署想改）
    await setSetting(env, 'security_entry', check.value);
    return ok({ entry: check.value, message: '安全入口已更新' });
  }

  await setSetting(env, 'security_entry', check.value);
  return ok({ entry: check.value });
}

/* ------------------------------------------------------------------ */
/* POST /api/setup/admin —— 第 2 步：注册管理员                          */
/* ------------------------------------------------------------------ */

export async function setupAdmin(request, env) {
  const s = await getSettings(env);

  if (!s.security_entry) {
    return fail('请先设置安全入口', 400);
  }

  // 只允许注册一次（除非已登录管理员要新增账号）
  const countRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first();
  if ((countRow?.n || 0) > 0) {
    const admin = await currentAdmin(request, env);
    if (!admin) return fail('管理员已存在，请直接登录', 403);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rl = rateLimit(`setup-admin:${await sha256Hex(ip)}`, 15, 10 * 60_000);
  if (!rl.allowed) return fail(`操作过于频繁，请 ${rl.retryAfter} 秒后重试`, 429);

  const body = await readJson(request);

  const u = validateUsername(body.username);
  if (!u.ok) return fail(u.error, 400);

  const p = validatePassword(body.password);
  if (!p.ok) return fail(p.error, 400);

  if (body.password !== body.password_confirm) {
    return fail('两次输入的密码不一致', 400);
  }

  const exists = await env.DB.prepare('SELECT id FROM admins WHERE username = ?').bind(u.value).first();
  if (exists) return fail('该账号已存在', 409);

  const hash = await hashPassword(p.value);
  const info = await env.DB.prepare(
    'INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)'
  )
    .bind(u.value, hash, Date.now())
    .run();

  // 标记初始化完成
  await setSettings(env, { initialized: '1' });

  // 顺手写入当前访问域名，便于文档/回调展示
  const url = new URL(request.url);
  await setSetting(env, 'site_url', url.origin);

  // 直接签发会话，省去立刻再登录一次
  const session = await createSession(env, info.meta.last_row_id, request);

  return json(
    {
      ok: true,
      done: true,
      entry: s.security_entry,
      username: u.value,
      message: '一切完成',
    },
    {
      headers: {
        'set-cookie': sessionCookie(session.token, Math.floor((session.expiresAt - Date.now()) / 1000)),
      },
    }
  );
}

/* ------------------------------------------------------------------ */
/* POST /api/auth/login —— 登录（挂在安全入口路径下）                    */
/* ------------------------------------------------------------------ */

export async function login(request, env) {
  const s = await getSettings(env);
  if (!s.security_entry) return fail('站点尚未初始化', 400);

  const countRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first();
  if (!countRow?.n) return fail('尚未注册管理员，请先完成初始化', 400);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipKey = await sha256Hex(ip);
  const rl = rateLimit(`login:${ipKey}`, 8, 5 * 60_000);
  if (!rl.allowed) {
    return fail(`登录尝试过多，请 ${rl.retryAfter} 秒后再试`, 429);
  }

  const body = await readJson(request);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (!username || !password) return fail('请输入账号和密码', 400);

  const admin = await env.DB.prepare(
    'SELECT id, username, password_hash FROM admins WHERE username = ?'
  )
    .bind(username)
    .first();

  // 统一错误信息，避免暴露账号是否存在
  const badCreds = () => fail('账号或密码错误', 401);
  if (!admin) {
    // 空转一次哈希，减少时序差异
    await hashPassword(password);
    return badCreds();
  }

  const valid = await verifyPassword(password, admin.password_hash);
  if (!valid) return badCreds();

  // 清理该管理员的旧会话，保留最近 5 个
  await env.DB.prepare(
    `DELETE FROM sessions WHERE admin_id = ? AND token NOT IN (
       SELECT token FROM sessions WHERE admin_id = ? ORDER BY created_at DESC LIMIT 5
     )`
  )
    .bind(admin.id, admin.id)
    .run();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();

  const session = await createSession(env, admin.id, request);

  return json(
    { ok: true, username: admin.username },
    {
      headers: {
        'set-cookie': sessionCookie(session.token, Math.floor((session.expiresAt - Date.now()) / 1000)),
      },
    }
  );
}

/* ------------------------------------------------------------------ */
/* 辅助                                                                */
/* ------------------------------------------------------------------ */

export async function readJson(request) {
  try {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) return (await request.json()) || {};
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}
