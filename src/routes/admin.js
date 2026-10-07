/**
 * 后台接口（全部需要登录会话）。
 *   /api/admin/*        —— 资料、设置、社交、音乐
 *   /api/admin/upload   —— 文件上传（头像 / 背景 / 音乐 / 自定义图标）
 */

import {
  json,
  fail,
  ok,
  getSettings,
  setSettings,
  setSetting,
  publicAssetUrl,
  putObject,
  deleteObject,
  deletePrefix,
  safeExt,
  guessMime,
  MAX_UPLOAD_BYTES,
  storageReady,
  verifyPassword,
  hashPassword,
  validateUsername,
  validatePassword,
  LIMITS,
} from '../lib.js';
import { readJson } from './setup.js';

/* ------------------------------------------------------------------ */
/* GET /api/admin/me                                                    */
/* ------------------------------------------------------------------ */

export async function me(request, env, admin) {
  const s = await getSettings(env);
  return json({
    ok: true,
    admin: { id: admin.id, username: admin.username },
    security_entry: s.security_entry || '',
    site_url: s.site_url || new URL(request.url).origin,
  });
}

/* ------------------------------------------------------------------ */
/* GET /api/admin/state —— 后台一次性拉取全部配置                        */
/* ------------------------------------------------------------------ */

const EDITABLE_KEYS = [
  'site_name', 'nickname', 'about_text', 'avatar_key', 'bg_key',
  'music_enabled', 'music_mode',
  'github_user', 'github_show_repos', 'github_show_chart',
  'anim_intro', 'anim_bg', 'anim_reveal', 'anim_avatar', 'anim_player',
  'footer_text', 'footer_opacity', 'footer_color', 'footer_link',
  'tg_enabled', 'tg_title', 'tg_sub', 'tg_url',
  'security_entry', 'site_url',
];

export async function state(env) {
  const s = await getSettings(env);

  const settings = {};
  for (const k of EDITABLE_KEYS) settings[k] = s[k] ?? '';

  const { results: tracks } = await env.DB.prepare(
    `SELECT id, title, artist, r2_key, cover_key, size, mime, duration, sort_order
       FROM tracks ORDER BY sort_order ASC, id ASC`
  ).all();

  const { results: socials } = await env.DB.prepare(
    `SELECT id, label, url, icon, icon_key, sort_order, enabled
       FROM socials ORDER BY sort_order ASC, id ASC`
  ).all();

  const { results: files } = await env.DB.prepare(
    `SELECT key, size, uploaded_at FROM assets ORDER BY uploaded_at DESC`
  ).all();

  return json({
    ok: true,
    settings: {
      ...settings,
      avatar_url: publicAssetUrl(s.avatar_key),
      bg_url: publicAssetUrl(s.bg_key),
    },
    tracks: (tracks || []).map((t) => ({
      ...t,
      url: publicAssetUrl(t.r2_key),
      cover_url: publicAssetUrl(t.cover_key),
    })),
    socials: (socials || []).map((x) => ({
      ...x,
      enabled: x.enabled === 1,
      icon_url: x.icon === 'custom' ? publicAssetUrl(x.icon_key) : '',
    })),
    files: files || [],
    limits: {
      maxUploadBytes: MAX_UPLOAD_BYTES,
      tracksMax: LIMITS.tracksMax,
      socialsSoftMax: LIMITS.socialsSoftMax,
    },
    storage_ready: storageReady(env),
    visits: parseInt(s.visits || '0', 10),
  });
}

/* ------------------------------------------------------------------ */
/* PUT /api/admin/settings                                              */
/* ------------------------------------------------------------------ */

const BOOL_KEYS = new Set([
  'music_enabled', 'github_show_repos', 'github_show_chart',
  'anim_intro', 'anim_bg', 'anim_reveal', 'anim_avatar', 'anim_player',
  'tg_enabled',
]);

export async function updateSettings(request, env) {
  const body = await readJson(request);
  const patch = {};

  for (const [k, v] of Object.entries(body || {})) {
    if (!EDITABLE_KEYS.includes(k)) continue;
    if (BOOL_KEYS.has(k)) {
      patch[k] = v === true || v === '1' || v === 1 || v === 'true' ? '1' : '0';
    } else {
      patch[k] = String(v ?? '').slice(0, 5000);
    }
  }

  // 安全入口单独校验
  if ('security_entry' in patch) {
    const check = validateEntryLoose(patch.security_entry);
    if (!check.ok) return fail(check.error, 400);
    patch.security_entry = check.value;
  }

  if ('music_mode' in patch) {
    patch.music_mode = patch.music_mode === 'random' ? 'random' : 'default';
  }

  if ('footer_opacity' in patch) {
    const n = parseFloat(patch.footer_opacity);
    patch.footer_opacity = String(Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.55);
  }

  if ('footer_color' in patch && !/^#[0-9a-fA-F]{3,8}$/.test(patch.footer_color)) {
    patch.footer_color = '#8a8a8e';
  }

  if (!Object.keys(patch).length) return ok({ updated: 0 });

  await setSettings(env, patch);
  return ok({ updated: Object.keys(patch).length });
}

function validateEntryLoose(raw) {
  const v = String(raw || '').trim();
  if (v.length < 5) return { ok: false, error: '安全入口至少 5 位' };
  if (v.length > 64) return { ok: false, error: '安全入口最多 64 位' };
  if (!/^[A-Za-z0-9_-]+$/.test(v)) {
    return { ok: false, error: '安全入口只能包含字母、数字、下划线和中划线' };
  }
  const reserved = new Set(['api', 'assets', 'backstage', 'admin', 'login', 'logout', 'setup']);
  if (reserved.has(v.toLowerCase())) return { ok: false, error: `“${v}”是保留路径` };
  return { ok: true, value: v };
}

/* ------------------------------------------------------------------ */
/* 账号                                                                */
/* ------------------------------------------------------------------ */

export async function changeCredentials(request, env, admin) {
  const body = await readJson(request);

  const currentPw = String(body.current_password || '');
  const row = await env.DB.prepare('SELECT password_hash FROM admins WHERE id = ?').bind(admin.id).first();
  if (!row) return fail('账号不存在', 404);

  const valid = await verifyPassword(currentPw, row.password_hash);
  if (!valid) return fail('当前密码不正确', 401);

  const patch = {};

  if (body.new_username) {
    const u = validateUsername(body.new_username);
    if (!u.ok) return fail(u.error, 400);
    const dup = await env.DB.prepare('SELECT id FROM admins WHERE username = ? AND id <> ?')
      .bind(u.value, admin.id)
      .first();
    if (dup) return fail('该账号已被占用', 409);
    patch.username = u.value;
  }

  if (body.new_password) {
    const p = validatePassword(body.new_password);
    if (!p.ok) return fail(p.error, 400);
    if (body.new_password !== body.new_password_confirm) {
      return fail('两次输入的新密码不一致', 400);
    }
    patch.password_hash = await hashPassword(p.value);
  }

  if (!Object.keys(patch).length) return fail('没有需要更新的内容', 400);

  const sets = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
  await env.DB.prepare(`UPDATE admins SET ${sets} WHERE id = ?`)
    .bind(...Object.values(patch), admin.id)
    .run();

  // 改密码后清掉其他会话，只保留当前这个
  if (patch.password_hash) {
    await env.DB.prepare('DELETE FROM sessions WHERE admin_id = ? AND token <> ?')
      .bind(admin.id, admin.token)
      .run();
  }

  return ok({ message: '账号信息已更新' });
}

export async function logout(request, env, admin) {
  await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(admin.token).run();
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': 'grwz_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
    },
  });
}

/* ------------------------------------------------------------------ */
/* 上传                                                                */
/* ------------------------------------------------------------------ */

/**
 * POST /api/admin/upload   (multipart/form-data)
 *   file  : 文件
 *   kind  : avatar | bg | track | cover | icon
 *   title / artist : kind=track 时可选
 */
export async function upload(request, env) {
  // R2 没绑定（一键部署的常见情况）时给出可操作的提示，而不是 500
  if (!storageReady(env)) {
    return fail(
      '尚未开通文件存储（R2）。请在 Cloudflare 控制台进入 Workers & Pages → ' +
      '你的 Worker → Settings → Bindings，添加一个 R2 bucket binding，' +
      '变量名填 BUCKET，然后回到这里重试。',
      503
    );
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return fail('上传数据解析失败，请确认使用的是表单上传', 400);
  }

  const file = form.get('file');
  const kind = String(form.get('kind') || '').trim();

  if (!file || typeof file === 'string') return fail('没有收到文件', 400);
  if (!['avatar', 'bg', 'track', 'cover', 'icon'].includes(kind)) {
    return fail('未知的上传类型', 400);
  }

  const size = file.size || 0;
  if (size <= 0) return fail('文件为空', 400);

  // 图片类限制 12MB，音频按 96MB（Workers 请求体上限 100MB）
  const limit = kind === 'track' ? MAX_UPLOAD_BYTES : 12 * 1024 * 1024;
  if (size > limit) {
    return fail(
      `文件过大（${formatBytes(size)}），${kind === 'track' ? '音频' : '图片'}上限为 ${formatBytes(limit)}`,
      413
    );
  }

  const originalName = file.name || 'upload';
  const mime = guessMime(originalName, file.type);

  // 校验类型，避免上传可执行内容
  if (kind === 'track' && !mime.startsWith('audio/') && !mime.startsWith('video/')) {
    return fail('音乐只支持音频文件（mp3 / m4a / wav / flac / ogg 等）', 415);
  }
  if (kind !== 'track' && !mime.startsWith('image/')) {
    return fail('这里只支持图片文件', 415);
  }

  const ext = safeExt(originalName, kind === 'track' ? 'mp3' : 'png');
  const rand = Math.random().toString(36).slice(2, 10);
  const key = `uploads/${kind}/${Date.now()}-${rand}.${ext}`;

  await putObject(env, key, file.stream(), { contentType: mime });

  // 记录资产，便于后台展示占用
  try {
    await env.DB.prepare(
      `INSERT INTO assets (key, size, mime, original_name, kind, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(key, size, mime, originalName.slice(0, 200), kind, Date.now())
      .run();
  } catch {
    /* assets 表缺失时不影响主流程 */
  }

  // 头像 / 背景是「替换型」：设好新值后删掉旧对象
  if (kind === 'avatar' || kind === 'bg') {
    const keyName = kind === 'avatar' ? 'avatar_key' : 'bg_key';
    const s = await getSettings(env);
    const old = s[keyName];
    await setSetting(env, keyName, key);
    if (old && old !== key) {
      await deleteObject(env, old);
      await env.DB.prepare('DELETE FROM assets WHERE key = ?').bind(old).run().catch(() => {});
    }
    return json({ ok: true, key, url: publicAssetUrl(key), replaced: old || '' });
  }

  if (kind === 'track') {
    const countRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM tracks').first();
    if ((countRow?.n || 0) >= LIMITS.tracksMax) {
      await deleteObject(env, key);
      return fail(`音乐数量已达上限（${LIMITS.tracksMax} 首）`, 409);
    }

    const title = String(form.get('title') || '').trim() || originalName.replace(/\.[^.]+$/, '');
    const artist = String(form.get('artist') || '').trim();
    const duration = parseFloat(form.get('duration')) || null;

    const maxRow = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM tracks').first();
    const sortOrder = (maxRow?.m ?? -1) + 1;

    const info = await env.DB.prepare(
      `INSERT INTO tracks (title, artist, r2_key, cover_key, size, mime, duration, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(title.slice(0, 200), artist.slice(0, 200), key, null, size, mime, duration, sortOrder, Date.now())
      .run();

    const id = info.meta?.last_row_id;
    return json({ ok: true, id, key, url: publicAssetUrl(key), title, artist });
  }

  // cover / icon：仅返回 key，由前端再调对应的保存接口绑定
  return json({ ok: true, key, url: publicAssetUrl(key) });
}

/* ------------------------------------------------------------------ */
/* 音乐管理                                                            */
/* ------------------------------------------------------------------ */

export async function listTracks(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, title, artist, r2_key, cover_key, size, mime, duration, sort_order
       FROM tracks ORDER BY sort_order ASC, id ASC`
  ).all();
  return json({
    ok: true,
    tracks: (results || []).map((t) => ({
      ...t,
      url: publicAssetUrl(t.r2_key),
      cover_url: publicAssetUrl(t.cover_key),
    })),
  });
}

export async function updateTrack(request, env, id) {
  const body = await readJson(request);
  const patch = {};

  if ('title' in body) patch.title = String(body.title || '').slice(0, 200) || '未命名';
  if ('artist' in body) patch.artist = String(body.artist || '').slice(0, 200);
  if ('cover_key' in body) patch.cover_key = String(body.cover_key || '');
  if ('duration' in body) patch.duration = parseFloat(body.duration) || null;
  if ('sort_order' in body) patch.sort_order = parseInt(body.sort_order, 10) || 0;

  if (!Object.keys(patch).length) return fail('没有需要更新的字段', 400);

  const sets = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
  const res = await env.DB.prepare(`UPDATE tracks SET ${sets} WHERE id = ?`)
    .bind(...Object.values(patch), id)
    .run();

  if (!res.meta?.changes) return fail('音乐不存在', 404);
  return ok({ message: '已保存' });
}

export async function deleteTrack(env, id) {
  const row = await env.DB.prepare('SELECT r2_key, cover_key FROM tracks WHERE id = ?').bind(id).first();
  if (!row) return fail('音乐不存在', 404);

  await env.DB.prepare('DELETE FROM tracks WHERE id = ?').bind(id).run();
  await deleteObject(env, row.r2_key);
  if (row.cover_key) await deleteObject(env, row.cover_key);
  await env.DB.prepare('DELETE FROM assets WHERE key IN (?, ?)')
    .bind(row.r2_key, row.cover_key || '')
    .run()
    .catch(() => {});

  return ok({ message: '已删除' });
}

export async function reorderTracks(request, env) {
  const body = await readJson(request);
  const order = Array.isArray(body.order) ? body.order : [];
  if (!order.length) return fail('排序数据为空', 400);

  // 每条语句都必须重新 prepare：D1 的 bind() 会就地改写 statement
  await env.DB.batch(
    order.map((id, i) =>
      env.DB.prepare('UPDATE tracks SET sort_order = ? WHERE id = ?')
        .bind(i, parseInt(id, 10))
    )
  );
  return ok({ message: '排序已更新' });
}

/* ------------------------------------------------------------------ */
/* 社交链接                                                            */
/* ------------------------------------------------------------------ */

export async function listSocials(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, label, url, icon, icon_key, sort_order, enabled
       FROM socials ORDER BY sort_order ASC, id ASC`
  ).all();
  return json({
    ok: true,
    socials: (results || []).map((x) => ({
      ...x,
      enabled: x.enabled === 1,
      icon_url: x.icon === 'custom' ? publicAssetUrl(x.icon_key) : '',
    })),
  });
}

export async function createSocial(request, env) {
  const body = await readJson(request);
  const label = String(body.label || '').trim();
  const url = String(body.url || '').trim();

  if (!label) return fail('请填写显示名称', 400);
  if (label.length > 40) return fail('显示名称过长', 400);
  if (!/^https?:\/\/.+/i.test(url)) return fail('链接需要以 http:// 或 https:// 开头', 400);

  const icon = String(body.icon || 'link').slice(0, 40);
  const iconKey = icon === 'custom' ? String(body.icon_key || '') : null;

  const maxRow = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM socials').first();
  const sortOrder = (maxRow?.m ?? -1) + 1;

  const info = await env.DB.prepare(
    `INSERT INTO socials (label, url, icon, icon_key, sort_order, enabled)
     VALUES (?, ?, ?, ?, ?, 1)`
  )
    .bind(label, url, icon, iconKey, sortOrder)
    .run();

  const countRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM socials').first();

  return json({
    ok: true,
    id: info.meta?.last_row_id,
    count: countRow?.n || 0,
    // 只在超出建议数量时提示，不阻止
    hint:
      (countRow?.n || 0) > LIMITS.socialsSoftMax
        ? `已添加 ${countRow.n} 个，超过建议的 ${LIMITS.socialsSoftMax} 个，前台可能显得拥挤`
        : '',
  });
}

export async function updateSocial(request, env, id) {
  const body = await readJson(request);
  const patch = {};

  if ('label' in body) {
    const label = String(body.label || '').trim();
    if (!label) return fail('显示名称不能为空', 400);
    patch.label = label.slice(0, 40);
  }
  if ('url' in body) {
    const url = String(body.url || '').trim();
    if (!/^https?:\/\/.+/i.test(url)) return fail('链接需要以 http:// 或 https:// 开头', 400);
    patch.url = url.slice(0, 500);
  }
  if ('icon' in body) patch.icon = String(body.icon || 'link').slice(0, 40);
  if ('icon_key' in body) patch.icon_key = String(body.icon_key || '');
  if ('sort_order' in body) patch.sort_order = parseInt(body.sort_order, 10) || 0;
  if ('enabled' in body) patch.enabled = body.enabled ? 1 : 0;

  if (!Object.keys(patch).length) return fail('没有需要更新的字段', 400);

  const sets = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
  const res = await env.DB.prepare(`UPDATE socials SET ${sets} WHERE id = ?`)
    .bind(...Object.values(patch), id)
    .run();

  if (!res.meta?.changes) return fail('该链接不存在', 404);
  return ok({ message: '已保存' });
}

export async function deleteSocial(env, id) {
  const row = await env.DB.prepare('SELECT icon_key FROM socials WHERE id = ?').bind(id).first();
  if (!row) return fail('该链接不存在', 404);

  await env.DB.prepare('DELETE FROM socials WHERE id = ?').bind(id).run();
  if (row.icon_key) await deleteObject(env, row.icon_key);
  return ok({ message: '已删除' });
}

export async function reorderSocials(request, env) {
  const body = await readJson(request);
  const order = Array.isArray(body.order) ? body.order : [];
  if (!order.length) return fail('排序数据为空', 400);

  await env.DB.batch(
    order.map((id, i) =>
      env.DB.prepare('UPDATE socials SET sort_order = ? WHERE id = ?')
        .bind(i, parseInt(id, 10))
    )
  );
  return ok({ message: '排序已更新' });
}

/* ------------------------------------------------------------------ */
/* 危险操作：清空所有上传                                                */
/* ------------------------------------------------------------------ */

export async function wipeAssets(request, env) {
  const body = await readJson(request);
  if (body.confirm !== 'DELETE') {
    return fail('请输入 DELETE 以确认清空', 400);
  }

  await deletePrefix(env, 'uploads/');
  await env.DB.prepare('DELETE FROM tracks').run();
  await env.DB.prepare('DELETE FROM assets').run();
  await setSettings(env, { avatar_key: '', bg_key: '' });

  return ok({ message: '已清空全部上传文件' });
}

/* ------------------------------------------------------------------ */

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
