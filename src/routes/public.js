/**
 * 公开接口：前台网站读取配置、读取媒体文件、访问计数。
 */

import {
  json,
  fail,
  getSettings,
  publicAssetUrl,
  rateLimit,
  sha256Hex,
} from '../lib.js';

const PUBLIC_KEYS = [
  'site_name',
  'nickname',
  'about_text',
  'avatar_key',
  'bg_key',
  'music_enabled',
  'music_mode',
  'github_user',
  'github_show_repos',
  'github_show_chart',
  'anim_intro',
  'anim_bg',
  'anim_reveal',
  'anim_avatar',
  'anim_player',
  'footer_text',
  'footer_opacity',
  'footer_color',
  'footer_link',
  'tg_enabled',
  'tg_title',
  'tg_sub',
  'tg_url',
];

/** GET /api/site —— 前台首屏配置（不含任何敏感信息） */
export async function siteConfig(env) {
  let s;
  let tracks = [];
  let socials = [];

  try {
    s = await getSettings(env);
    tracks = (await env.DB.prepare(
      `SELECT id, title, artist, r2_key, cover_key, duration
         FROM tracks ORDER BY sort_order ASC, id ASC`
    ).all()).results;

    socials = (await env.DB.prepare(
      `SELECT id, label, url, icon, icon_key
         FROM socials WHERE enabled = 1 ORDER BY sort_order ASC, id ASC`
    ).all()).results;
  } catch (err) {
    // 还没建表（没执行 schema.sql）时给出明确提示，
    // 让前台显示「网站还在准备中」，而不是 500 白屏。
    console.error('site 配置读取失败:', err && err.message);
    return json({
      ok: true,
      initialized: false,
      database_ready: false,
      site: {},
      tracks: [],
      socials: [],
    });
  }

  const out = {};
  for (const k of PUBLIC_KEYS) out[k] = s[k] ?? '';

  return json({
    ok: true,
    database_ready: true,
    // 明确告知前台「尚未初始化」——前台据此隐藏内容、后台据此显示向导
    initialized: s.initialized === '1',
    site: {
      ...out,
      avatar_url: publicAssetUrl(s.avatar_key),
      bg_url: publicAssetUrl(s.bg_key),
      music_enabled: s.music_enabled === '1',
      music_mode: s.music_mode === 'random' ? 'random' : 'default',
      github_show_repos: s.github_show_repos === '1',
      github_show_chart: s.github_show_chart === '1',
      tg_enabled: s.tg_enabled !== '0',
      animations: {
        intro: s.anim_intro !== '0',
        background: s.anim_bg !== '0',
        reveal: s.anim_reveal !== '0',
        avatar: s.anim_avatar !== '0',
        player: s.anim_player !== '0',
      },
      footer: {
        text: s.footer_text || '',
        opacity: clampOpacity(s.footer_opacity),
        color: s.footer_color || '#8a8a8e',
        link: s.footer_link || '',
      },
    },
    tracks: (tracks || []).map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist || '',
      url: publicAssetUrl(t.r2_key),
      cover: publicAssetUrl(t.cover_key),
      duration: t.duration || 0,
    })),
    socials: (socials || []).map((s2) => ({
      id: s2.id,
      label: s2.label,
      url: s2.url,
      icon: s2.icon,
      icon_url: s2.icon === 'custom' ? publicAssetUrl(s2.icon_key) : '',
    })),
  });
}

function clampOpacity(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 0.55;
  return Math.min(1, Math.max(0, n));
}

/** GET /api/file/:key —— 从 R2 读取对象，带长缓存 + 条件请求 */
export async function serveFile(request, env, key) {
  if (!key) return fail('缺少文件', 400);
  const decoded = decodeURIComponent(key);

  // 防目录穿越
  if (decoded.includes('..') || decoded.startsWith('/')) {
    return fail('非法路径', 400);
  }

  // R2 未绑定时直接 404，让前台优雅降级（不显示占位图）
  if (!env.BUCKET || typeof env.BUCKET.get !== 'function') {
    return new Response('Not Found', { status: 404 });
  }

  const range = request.headers.get('Range');
  const obj = await env.BUCKET.get(decoded, range ? { range: parseRange(range) } : undefined);
  if (!obj) return new Response('Not Found', { status: 404 });

  const headers = new Headers();
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('accept-ranges', 'bytes');
  if (obj.httpMetadata?.contentType) {
    headers.set('content-type', obj.httpMetadata.contentType);
  }
  if (obj.size != null) headers.set('content-length', String(obj.size));
  if (obj.range) {
    const r = obj.range;
    const total = obj.size ?? 0;
    headers.set('content-range', `bytes ${r.offset}-${r.offset + r.length - 1}/${total}`);
  }

  return new Response(request.method === 'HEAD' ? null : obj.body, { headers });
}

function parseRange(header) {
  const m = /bytes=(\d*)-(\d*)/.exec(header);
  if (!m) return undefined;
  const offset = m[1] ? parseInt(m[1], 10) : undefined;
  const end = m[2] ? parseInt(m[2], 10) : undefined;
  if (offset == null) return { suffix: end };
  if (end == null) return { offset };
  return { offset, length: end - offset + 1 };
}

/** POST /api/visit —— 极简访问计数（可选，失败不影响前台） */
export async function visit(request, env) {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const key = await sha256Hex(ip);
    const rl = rateLimit(`visit:${key}`, 5, 60_000);
    if (!rl.allowed) return json({ ok: true, counted: false });

    await env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('visits', '1', ?)
       ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT),
                                     updated_at = excluded.updated_at`
    )
      .bind(Date.now())
      .run();

    const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'visits'`).first();
    return json({ ok: true, counted: true, visits: parseInt(row?.value || '0', 10) });
  } catch {
    return json({ ok: true, counted: false });
  }
}
