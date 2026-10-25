import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as store from './src/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(ROOT, 'data', 'uploads');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_UPLOAD = 100 * 1024 * 1024;
const SESSION_TTL = 14 * 24 * 3600 * 1000;
const PBKDF2_ITER = 120000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif', '.ico']);
const FONT_EXT = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const AUDIO_MIME = new Set(['.mp3', '.m4a', '.wav', '.flac', '.ogg', '.opus', '.aac']);

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(pw, salt, PBKDF2_ITER, 32, 'sha256');
  return 'pbkdf2$' + PBKDF2_ITER + '$' + salt.toString('hex') + '$' + hash.toString('hex');
}

function verifyPassword(pw, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    const iter = parseInt(parts[1], 10);
    const salt = Buffer.from(parts[2], 'hex');
    const expected = Buffer.from(parts[3], 'hex');
    const actual = crypto.pbkdf2Sync(pw, salt, iter, expected.length, 'sha256');
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function currentAdmin(req) {
  const token = parseCookies(req).website_session;
  if (!token) return null;
  const sess = store.findSession(token);
  if (!sess) return null;
  return { id: sess.admin.id, username: sess.admin.username, token: sess.token };
}

function createSession(adminId, req) {
  const token = b64url(crypto.randomBytes(32));
  const now = Date.now();
  store.createSession({
    token: token,
    admin_id: adminId,
    created_at: now,
    expires_at: now + SESSION_TTL,
    ip: req.socket.remoteAddress || '',
    user_agent: String(req.headers['user-agent'] || '').slice(0, 200),
  });
  return token;
}

function sessionCookie(token, maxAge) {
  return 'website_session=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge;
}

function clearCookie() {
  return 'website_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function sendJson(res, data, status, headers) {
  res.writeHead(status || 200, Object.assign({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  }, headers || {}));
  res.end(JSON.stringify(data));
}

function sendText(res, text, status) {
  res.writeHead(status || 200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function readBody(req, limit) {
  const max = limit || MAX_UPLOAD;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        const err = new Error('body too large');
        err.code = 'TOO_LARGE';
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, 2 * 1024 * 1024);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { return {}; }
}

function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return null;
  const boundary = '--' + (m[1] || m[2]).trim();
  const parts = [];
  const bBuf = Buffer.from(boundary);
  let pos = buf.indexOf(bBuf);
  if (pos === -1) return null;
  pos += bBuf.length;

  for (;;) {
    if (buf.slice(pos, pos + 2).toString() === '--') break;
    if (buf.slice(pos, pos + 2).toString() === '\r\n') pos += 2;
    const next = buf.indexOf(bBuf, pos);
    if (next === -1) break;
    const chunk = buf.slice(pos, next - 2);
    const sep = chunk.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const head = chunk.slice(0, sep).toString('utf8');
      const data = chunk.slice(sep + 4);
      const nameM = /name="([^"]*)"/.exec(head);
      const fileM = /filename="([^"]*)"/.exec(head);
      const typeM = /Content-Type:\s*([^\r\n]+)/i.exec(head);
      parts.push({
        name: nameM ? nameM[1] : '',
        filename: fileM ? fileM[1] : null,
        type: typeM ? typeM[1].trim() : 'application/octet-stream',
        data: data,
      });
    }
    pos = next + bBuf.length;
  }
  return parts;
}

const buckets = [];

function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let e = buckets.find((x) => x.key === key);
  if (!e) {
    e = { key: key, count: 0, resetAt: 0 };
    buckets.push(e);
  }
  if (now > e.resetAt) {
    e.count = 1;
    e.resetAt = now + windowMs;
    return { allowed: true, retryAfter: 0 };
  }
  e.count++;
  if (e.count > max) {
    return { allowed: false, retryAfter: Math.ceil((e.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

function validateEntry(raw) {
  const v = String(raw || '').trim();
  if (v.length < 5) return { ok: false, error: '安全入口至少 5 位' };
  if (v.length > 64) return { ok: false, error: '安全入口最多 64 位' };
  if (!/^[A-Za-z0-9_-]+$/.test(v)) {
    return { ok: false, error: '只能包含字母、数字、下划线和中划线' };
  }
  const reserved = ['api', 'assets', 'backstage', 'admin', 'login', 'logout', 'setup', 'uploads'];
  if (reserved.includes(v.toLowerCase())) {
    return { ok: false, error: '“' + v + '”是系统保留路径，请换一个' };
  }
  return { ok: true, value: v };
}

function assetUrl(key) {
  if (!key) return '';
  return '/uploads/' + key.split('/').map(encodeURIComponent).join('/');
}

function normalizeUrl(raw) {
  const v = String(raw || '').trim();
  if (!v) return { ok: false, error: '请填写链接地址' };

  if (/^https?:\/\/.+/i.test(v)) return { ok: true, value: v, auto: false };

  const mailto = /^mailto:\s*(.+)$/i.exec(v);
  if (mailto) {
    const addr = mailto[1].trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      return { ok: false, error: '邮箱地址格式不正确' };
    }
    return { ok: true, value: 'mailto:' + addr, auto: false };
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v)) {
    return { ok: false, error: '只支持 http(s) 链接或 mailto: 邮箱' };
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    return { ok: true, value: 'mailto:' + v, auto: true };
  }

  const cleaned = v.replace(/^\/+/, '');
  if (!cleaned) return { ok: false, error: '请填写链接地址' };
  return { ok: true, value: 'https://' + cleaned, auto: true };
}

function clampOpacity(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 0.55;
  return Math.min(1, Math.max(0, n));
}

function publicSite() {
  const s = store.getSettings();
  const tracks = store.allTracks();
  const socials = store.enabledSocials();

  return {
    ok: true,
    initialized: s.initialized === '1',
    site: {
      site_name: s.site_name || '',
      nickname: s.nickname || '',
      about_text: s.about_text || '',
      avatar_url: assetUrl(s.avatar_key),
      bg_url: assetUrl(s.bg_key),
      bg_remote_url: s.bg_url || '',
      bg_position: s.bg_position || 'center center',
      bg_size_desktop: s.bg_size_desktop || 'cover',
      bg_size_mobile: s.bg_size_mobile || 'cover',
      font_url: assetUrl(s.font_key),
      font_family: s.font_family || '',
      music_enabled: s.music_enabled !== '0',
      music_mode: s.music_mode === 'random' ? 'random' : 'default',
      github_user: s.github_user || '',
      github_show_repos: s.github_show_repos !== '0',
      github_show_chart: s.github_show_chart !== '0',
      tg_enabled: s.tg_enabled !== '0',
      tg_title: s.tg_title || '加入我的频道',
      tg_sub: s.tg_sub || '加入就是最大的帮助',
      tg_url: s.tg_url || 'https://t.me/COASCN',
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
        color: s.footer_color || '#8b8b8b',
        link: s.footer_link || '',
      },
    },
    tracks: tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist || '',
      url: assetUrl(t.r2_key),
      cover: assetUrl(t.cover_key),
      duration: t.duration || 0,
    })),
    socials: socials.map((x) => ({
      id: x.id,
      label: x.label,
      url: x.url,
      icon: x.icon,
      icon_url: x.icon === 'custom' ? assetUrl(x.icon_key) : '',
    })),
  };
}

const EDITABLE = [
  'site_name', 'nickname', 'about_text', 'avatar_key', 'bg_key',
  'bg_url', 'bg_position', 'bg_size_desktop', 'bg_size_mobile',
  'font_key', 'font_family',
  'music_enabled', 'music_mode', 'github_user', 'github_show_repos', 'github_show_chart',
  'anim_intro', 'anim_bg', 'anim_reveal', 'anim_avatar', 'anim_player',
  'footer_text', 'footer_opacity', 'footer_color', 'footer_link',
  'tg_enabled', 'tg_title', 'tg_sub', 'tg_url', 'security_entry', 'site_url',
];

const BOOL_KEYS = [
  'music_enabled', 'github_show_repos', 'github_show_chart',
  'anim_intro', 'anim_bg', 'anim_reveal', 'anim_avatar', 'anim_player', 'tg_enabled',
];

function adminState() {
  const s = store.getSettings();
  const settings = {};
  for (const k of EDITABLE) settings[k] = s[k] == null ? '' : s[k];
  settings.avatar_url = assetUrl(s.avatar_key);
  settings.bg_url = assetUrl(s.bg_key);
  settings.bg_remote_url = s.bg_url || '';
  settings.font_url = assetUrl(s.font_key);

  return {
    ok: true,
    settings: settings,
    tracks: store.allTracks().map((t) => Object.assign({}, t, {
      url: assetUrl(t.r2_key),
      cover_url: assetUrl(t.cover_key),
    })),
    socials: store.allSocials().map((x) => Object.assign({}, x, {
      icon_url: x.icon === 'custom' ? assetUrl(x.icon_key) : '',
    })),
    files: store.allAssets(),
    limits: { maxUploadBytes: MAX_UPLOAD, tracksMax: 50, socialsSoftMax: 5 },
    storage_ready: true,
    visits: parseInt(s.visits || '0', 10),
  };
}

function secureExt(name, fallback) {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(String(name || ''));
  return m ? '.' + m[1].toLowerCase() : fallback;
}

function kindDir(kind) {
  const map = { avatar: 'avatar', bg: 'bg', track: 'track', cover: 'cover', icon: 'icon', font: 'font' };
  return map[kind] || null;
}

function safeAbs(key) {
  const abs = path.join(UPLOADS, key);
  const rel = path.relative(UPLOADS, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

function deleteKey(key) {
  if (!key) return;
  const abs = safeAbs(key);
  if (abs) {
    try { fs.unlinkSync(abs); } catch {}
  }
  store.deleteAsset(key);
}

async function handleCoverSearch(res, q) {
  const term = encodeURIComponent(q);
  const endpoints = [
    'https://itunes.apple.com/search?term=' + term + '&entity=song&limit=12',
    'https://itunes.apple.com/search?term=' + term + '&entity=song&limit=12&country=US',
  ];

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const resp = await fetch(endpoint, {
        headers: { 'User-Agent': 'Mozilla/5.0 personal-website' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) continue;

      const data = await resp.json();
      const items = (data.results || [])
        .filter((r) => r.artworkUrl100)
        .map((r) => ({
          title: r.trackName || '',
          artist: r.artistName || '',
          album: r.collectionName || '',
          cover: (r.artworkUrl100 || '').replace(/\/100x100bb\.jpg$/, '/600x600bb.jpg'),
          coverSmall: r.artworkUrl100 || '',
        }));

      if (items.length) return sendJson(res, { ok: true, items });
    } catch (err) {
      console.error('[cover-search]', err && err.message);
    }
  }

  return sendJson(res, { ok: true, items: [] });
}

async function handleCoverFetch(req, res, body) {
  const coverUrl = String(body.url || '').trim();
  const trackId = parseInt(body.track_id, 10);
  if (!Number.isInteger(trackId)) {
    return sendJson(res, { ok: false, error: '缺少歌曲 ID' }, 400);
  }
  if (!/^https:\/\/is\d+-ssl\.mzstatic\.com\//i.test(coverUrl)) {
    return sendJson(res, { ok: false, error: '只支持从 Apple 官方图片源获取封面' }, 400);
  }
  if (!store.findTrack(trackId)) {
    return sendJson(res, { ok: false, error: '音乐不存在' }, 404);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(coverUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return sendJson(res, { ok: false, error: '封面下载失败' }, 502);

    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > 5 * 1024 * 1024) {
      return sendJson(res, { ok: false, error: '封面图片过大' }, 413);
    }

    const key = 'cover/' + Date.now() + '-' + crypto.randomBytes(6).toString('hex') + '.jpg';
    const abs = safeAbs(key);
    if (!abs) return sendJson(res, { ok: false, error: '非法路径' }, 400);

    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, buf);

    store.upsertAsset({
      key, size: buf.length, mime: 'image/jpeg',
      original_name: 'album-cover.jpg', kind: 'cover', uploaded_at: Date.now(),
    });

    const old = store.findTrack(trackId).cover_key;
    store.updateTrack(trackId, { cover_key: key });
    if (old && old !== key) deleteKey(old);

    return sendJson(res, { ok: true, key, url: assetUrl(key) });
  } catch (err) {
    console.error('[cover-fetch]', err && err.message);
    return sendJson(res, { ok: false, error: '封面下载失败' }, 502);
  }
}


async function handleUpload(req, res) {
  const buf = await readBody(req, MAX_UPLOAD);
  const parts = parseMultipart(buf, req.headers['content-type']);
  if (!parts) return sendJson(res, { ok: false, error: '上传数据解析失败' }, 400);

  const field = (n) => {
    const p = parts.find((x) => x.name === n && x.filename === null);
    return p ? p.data.toString('utf8') : '';
  };
  const file = parts.find((x) => x.name === 'file' && x.filename !== null);
  const kind = field('kind').trim();
  const dir = kindDir(kind);

  if (!file) return sendJson(res, { ok: false, error: '没有收到文件' }, 400);
  if (!dir) return sendJson(res, { ok: false, error: '未知的上传类型' }, 400);
  if (!file.data.length) return sendJson(res, { ok: false, error: '文件为空' }, 400);

  const limit = kind === 'track' ? MAX_UPLOAD : 12 * 1024 * 1024;
  if (file.data.length > limit) {
    return sendJson(res, {
      ok: false,
      error: '文件过大（' + (file.data.length / 1048576).toFixed(1) + 'MB），上限 ' + Math.round(limit / 1048576) + 'MB',
    }, 413);
  }

  const ext = secureExt(file.filename, kind === 'track' ? '.mp3' : (kind === 'font' ? '.ttf' : '.png'));

  if (kind === 'track') {
    if (!AUDIO_EXT.has(ext)) {
      return sendJson(res, { ok: false, error: '音乐只支持 mp3 / m4a / wav / flac / ogg 等音频文件' }, 415);
    }
  } else if (kind === 'font') {
    if (!FONT_EXT.has(ext)) {
      return sendJson(res, { ok: false, error: '字体只支持 ttf / otf / woff / woff2' }, 415);
    }
  } else if (!IMAGE_EXT.has(ext)) {
    return sendJson(res, { ok: false, error: '这里只支持图片文件（png / jpg / webp / gif / svg）' }, 415);
  }

  if (kind === 'track' && store.trackCount() >= 50) {
    return sendJson(res, { ok: false, error: '音乐数量已达上限（50 首）' }, 409);
  }

  const name = Date.now() + '-' + crypto.randomBytes(6).toString('hex') + ext;
  const key = dir + '/' + name;
  const abs = safeAbs(key);
  if (!abs) return sendJson(res, { ok: false, error: '非法路径' }, 400);

  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, file.data);

  store.upsertAsset({
    key: key,
    size: file.data.length,
    mime: file.type,
    original_name: String(file.filename || '').slice(0, 200),
    kind: kind,
    uploaded_at: Date.now(),
  });

  if (kind === 'avatar' || kind === 'bg') {
    const keyName = kind === 'avatar' ? 'avatar_key' : 'bg_key';
    const old = store.getSettings()[keyName];
    store.setSettings({ [keyName]: key });
    if (old && old !== key) deleteKey(old);
    return sendJson(res, { ok: true, key: key, url: assetUrl(key), replaced: old || '' });
  }

  if (kind === 'font') {
    const old = store.getSettings().font_key;
    const family = 'CustomFont' + Date.now().toString(36);
    store.setSettings({ font_key: key, font_family: family });
    if (old && old !== key) deleteKey(old);
    return sendJson(res, {
      ok: true, key: key, url: assetUrl(key), font_family: family, replaced: old || '',
    });
  }

  if (kind === 'track') {
    const title = field('title').trim() || String(file.filename || '').replace(/\.[^.]+$/, '') || '未命名';
    const row = store.insertTrack({
      title: title.slice(0, 200),
      artist: field('artist').trim().slice(0, 200),
      r2_key: key,
      size: file.data.length,
      mime: file.type,
      duration: parseFloat(field('duration')) || null,
    });
    return sendJson(res, {
      ok: true, id: row.id, key: key, url: assetUrl(key), title: row.title, artist: row.artist,
    });
  }

  return sendJson(res, { ok: true, key: key, url: assetUrl(key) });
}

async function api(req, res, pathname, method) {
  const url = new URL(req.url, 'http://localhost');

  if (pathname === '/api/site' && method === 'GET') return sendJson(res, publicSite());

  if (pathname === '/api/setup/status' && method === 'GET') {
    const s = store.getSettings();
    const n = store.adminCount();
    return sendJson(res, {
      ok: true,
      database_ready: true,
      security_entry_set: Boolean(s.security_entry),
      admin_registered: n > 0,
      initialized: s.initialized === '1' && n > 0,
      site_name: s.site_name || '',
    });
  }

  if (pathname === '/api/setup/entry' && method === 'POST') {
    const s = store.getSettings();
    const body = await readJson(req);
    const check = validateEntry(body.entry);
    if (!check.ok) return sendJson(res, { ok: false, error: check.error }, 400);
    if (s.initialized === '1' && !currentAdmin(req)) {
      return sendJson(res, { ok: false, error: '站点已初始化，无法重复设置' }, 403);
    }
    store.setSettings({ security_entry: check.value });
    return sendJson(res, { ok: true, entry: check.value });
  }

  if (pathname === '/api/setup/admin' && method === 'POST') {
    const s = store.getSettings();
    if (!s.security_entry) return sendJson(res, { ok: false, error: '请先设置安全入口' }, 400);
    if (store.adminCount() > 0 && !currentAdmin(req)) {
      return sendJson(res, { ok: false, error: '管理员已存在，请直接登录' }, 403);
    }

    const body = await readJson(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');

    if (username.length < 3) return sendJson(res, { ok: false, error: '账号至少 3 位' }, 400);
    if (username.length > 32) return sendJson(res, { ok: false, error: '账号最多 32 位' }, 400);
    if (!/^[A-Za-z0-9_.@-]+$/.test(username)) {
      return sendJson(res, { ok: false, error: '账号只能包含字母、数字及 _ . @ -' }, 400);
    }
    if (password.length < 6) return sendJson(res, { ok: false, error: '密码至少 6 位' }, 400);
    if (password !== body.password_confirm) {
      return sendJson(res, { ok: false, error: '两次输入的密码不一致' }, 400);
    }
    if (store.findAdminByName(username)) {
      return sendJson(res, { ok: false, error: '该账号已存在' }, 409);
    }

    const row = store.insertAdmin(username, hashPassword(password));
    store.setSettings({ initialized: '1', site_url: url.origin });
    const token = createSession(row.id, req);

    return sendJson(res, {
      ok: true, done: true, entry: s.security_entry, username: username, message: '一切完成',
    }, 200, { 'set-cookie': sessionCookie(token, Math.floor(SESSION_TTL / 1000)) });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    const rl = rateLimit('login:' + ip, 10, 5 * 60 * 1000);
    if (!rl.allowed) {
      return sendJson(res, { ok: false, error: '登录尝试过多，请 ' + rl.retryAfter + ' 秒后再试' }, 429);
    }
    const body = await readJson(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const row = store.findAdminByName(username);
    if (!row || !verifyPassword(password, row.password_hash)) {
      return sendJson(res, { ok: false, error: '账号或密码错误' }, 401);
    }
    store.pruneSessions();
    const token = createSession(row.id, req);
    return sendJson(res, { ok: true, username: row.username },
      200, { 'set-cookie': sessionCookie(token, Math.floor(SESSION_TTL / 1000)) });
  }

  if (pathname === '/api/visit' && method === 'POST') {
    const s = store.getSettings();
    store.setSettings({ visits: String((parseInt(s.visits || '0', 10) || 0) + 1) });
    return sendJson(res, { ok: true });
  }

  if (pathname.startsWith('/api/admin/')) {
    const admin = currentAdmin(req);
    if (!admin) return sendJson(res, { ok: false, error: '未登录或会话已过期' }, 401);

    const rest = pathname.slice('/api/admin/'.length);

    if (rest === 'me' && method === 'GET') {
      const s = store.getSettings();
      return sendJson(res, {
        ok: true,
        admin: { id: admin.id, username: admin.username },
        security_entry: s.security_entry || '',
        site_url: s.site_url || '',
      });
    }

    if (rest === 'state' && method === 'GET') return sendJson(res, adminState());
    if (rest === 'upload' && method === 'POST') return handleUpload(req, res);

    if (rest === 'cover-search' && method === 'GET') {
      const q = String(url.searchParams.get('q') || '').trim();
      if (!q) return sendJson(res, { ok: false, error: '请输入歌名' }, 400);
      return handleCoverSearch(res, q);
    }

    if (rest === 'cover-fetch' && method === 'POST') {
      const body = await readJson(req);
      return handleCoverFetch(req, res, body);
    }

    if (rest === 'settings' && method === 'PUT') {
      const body = await readJson(req);
      const patch = {};
      for (const entry of Object.entries(body || {})) {
        const k = entry[0];
        const v = entry[1];
        if (!EDITABLE.includes(k)) continue;
        if (BOOL_KEYS.includes(k)) patch[k] = (v === true || v === '1' || v === 1) ? '1' : '0';
        else patch[k] = String(v == null ? '' : v).slice(0, 5000);
      }
      if ('security_entry' in patch) {
        const c = validateEntry(patch.security_entry);
        if (!c.ok) return sendJson(res, { ok: false, error: c.error }, 400);
        patch.security_entry = c.value;
      }
      if ('music_mode' in patch) {
        patch.music_mode = patch.music_mode === 'random' ? 'random' : 'default';
      }
      if ('footer_opacity' in patch) {
        patch.footer_opacity = String(clampOpacity(patch.footer_opacity));
      }
      if ('footer_color' in patch && !/^#[0-9a-fA-F]{3,8}$/.test(patch.footer_color)) {
        patch.footer_color = '#8b8b8b';
      }
      store.setSettings(patch);
      return sendJson(res, { ok: true, updated: Object.keys(patch).length });
    }

    if (rest === 'credentials' && method === 'POST') {
      const body = await readJson(req);
      const row = store.findAdminById(admin.id);
      if (!row || !verifyPassword(String(body.current_password || ''), row.password_hash)) {
        return sendJson(res, { ok: false, error: '当前密码不正确' }, 401);
      }
      if (body.new_username) {
        const u = String(body.new_username).trim();
        if (u.length < 3) return sendJson(res, { ok: false, error: '账号至少 3 位' }, 400);
        if (!/^[A-Za-z0-9_.@-]+$/.test(u)) {
          return sendJson(res, { ok: false, error: '账号格式不正确' }, 400);
        }
        const dup = store.findAdminByName(u);
        if (dup && dup.id !== admin.id) {
          return sendJson(res, { ok: false, error: '该账号已被占用' }, 409);
        }
        store.updateAdmin(admin.id, { username: u });
      }
      if (body.new_password) {
        const p = String(body.new_password);
        if (p.length < 6) return sendJson(res, { ok: false, error: '新密码至少 6 位' }, 400);
        if (p !== body.new_password_confirm) {
          return sendJson(res, { ok: false, error: '两次输入的新密码不一致' }, 400);
        }
        store.updateAdmin(admin.id, { password_hash: hashPassword(p) });
        store.deleteOtherSessions(admin.id, admin.token);
      }
      return sendJson(res, { ok: true, message: '账号信息已更新' });
    }

    if (rest === 'logout' && method === 'POST') {
      store.deleteSession(admin.token);
      return sendJson(res, { ok: true }, 200, { 'set-cookie': clearCookie() });
    }

    if (rest === 'tracks' && method === 'GET') {
      return sendJson(res, {
        ok: true,
        tracks: store.allTracks().map((t) => Object.assign({}, t, {
          url: assetUrl(t.r2_key),
          cover_url: assetUrl(t.cover_key),
        })),
      });
    }

    if (rest === 'tracks/reorder' && method === 'POST') {
      const body = await readJson(req);
      store.reorderTracks(Array.isArray(body.order) ? body.order : []);
      return sendJson(res, { ok: true });
    }

    let m = /^tracks\/(\d+)$/.exec(rest);
    if (m) {
      const id = parseInt(m[1], 10);
      if (method === 'PUT' || method === 'PATCH') {
        const body = await readJson(req);
        const patch = {};
        if ('title' in body) patch.title = String(body.title || '').slice(0, 200) || '未命名';
        if ('artist' in body) patch.artist = String(body.artist || '').slice(0, 200);
        if ('cover_key' in body) patch.cover_key = String(body.cover_key || '') || null;
        if ('duration' in body) patch.duration = parseFloat(body.duration) || null;
        if (!Object.keys(patch).length) {
          return sendJson(res, { ok: false, error: '没有需要更新的字段' }, 400);
        }
        if (!store.updateTrack(id, patch)) {
          return sendJson(res, { ok: false, error: '音乐不存在' }, 404);
        }
        return sendJson(res, { ok: true });
      }
      if (method === 'DELETE') {
        const row = store.findTrack(id);
        if (!row) return sendJson(res, { ok: false, error: '音乐不存在' }, 404);
        store.deleteTrack(id);
        deleteKey(row.r2_key);
        if (row.cover_key) deleteKey(row.cover_key);
        return sendJson(res, { ok: true });
      }
    }

    if (rest === 'socials' && method === 'POST') {
      const body = await readJson(req);
      const label = String(body.label || '').trim();
      const u = normalizeUrl(body.url);
      if (!label) return sendJson(res, { ok: false, error: '请填写显示名称' }, 400);
      if (label.length > 40) return sendJson(res, { ok: false, error: '显示名称过长' }, 400);
      if (!u.ok) return sendJson(res, { ok: false, error: u.error }, 400);

      const icon = String(body.icon || 'link').slice(0, 40);
      const row = store.insertSocial({
        label: label,
        url: u.value,
        icon: icon,
        icon_key: icon === 'custom' ? String(body.icon_key || '') : null,
      });
      const count = store.socialCount();

      return sendJson(res, {
        ok: true,
        id: row.id,
        count: count,
        url: u.value,
        auto_fixed: Boolean(u.auto),
        hint: count > 5 ? '已添加 ' + count + ' 个，超过建议的 5 个，前台可能显得拥挤' : '',
      });
    }

    if (rest === 'socials/reorder' && method === 'POST') {
      const body = await readJson(req);
      store.reorderSocials(Array.isArray(body.order) ? body.order : []);
      return sendJson(res, { ok: true });
    }

    m = /^socials\/(\d+)$/.exec(rest);
    if (m) {
      const id = parseInt(m[1], 10);
      if (method === 'PUT' || method === 'PATCH') {
        const body = await readJson(req);
        const patch = {};
        if ('label' in body) {
          const label = String(body.label || '').trim();
          if (!label) return sendJson(res, { ok: false, error: '显示名称不能为空' }, 400);
          patch.label = label.slice(0, 40);
        }
        if ('url' in body) {
          const u = normalizeUrl(body.url);
          if (!u.ok) return sendJson(res, { ok: false, error: u.error }, 400);
          patch.url = u.value;
        }
        if ('icon' in body) patch.icon = String(body.icon || 'link').slice(0, 40);
        if ('icon_key' in body) patch.icon_key = String(body.icon_key || '') || null;
        if ('enabled' in body) patch.enabled = Boolean(body.enabled);
        if (!Object.keys(patch).length) {
          return sendJson(res, { ok: false, error: '没有需要更新的字段' }, 400);
        }
        if (!store.updateSocial(id, patch)) {
          return sendJson(res, { ok: false, error: '该链接不存在' }, 404);
        }
        return sendJson(res, { ok: true });
      }
      if (method === 'DELETE') {
        const row = store.findSocial(id);
        if (!row) return sendJson(res, { ok: false, error: '该链接不存在' }, 404);
        store.deleteSocial(id);
        if (row.icon_key) deleteKey(row.icon_key);
        return sendJson(res, { ok: true });
      }
    }

    if (rest === 'wipe-assets' && method === 'POST') {
      const body = await readJson(req);
      if (body.confirm !== 'DELETE') {
        return sendJson(res, { ok: false, error: '请输入 DELETE 以确认清空' }, 400);
      }
      for (const a of store.allAssets()) {
        const abs = safeAbs(a.key);
        if (abs) { try { fs.unlinkSync(abs); } catch {} }
      }
      store.clearAssets();
      store.clearTracks();
      store.setSettings({ avatar_key: '', bg_key: '' });
      return sendJson(res, { ok: true });
    }

    return sendJson(res, { ok: false, error: '接口不存在' }, 404);
  }

  return sendJson(res, { ok: false, error: '接口不存在' }, 404);
}

async function serveFile(req, res, filePath, immutable) {
  let st;
  try { st = await fsp.stat(filePath); } catch { return false; }
  if (!st.isFile()) return false;

  const ext = path.extname(filePath).toLowerCase();
  const etag = '"' + st.size + '-' + Math.floor(st.mtimeMs) + '"';
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag: etag });
    res.end();
    return true;
  }

  const type = MIME[ext] || 'application/octet-stream';
  const range = req.headers.range;

  if (range && AUDIO_MIME.has(ext)) {
    const mm = /bytes=(\d*)-(\d*)/.exec(range);
    if (mm) {
      const start = mm[1] ? parseInt(mm[1], 10) : 0;
      const end = mm[2] ? parseInt(mm[2], 10) : st.size - 1;
      res.writeHead(206, {
        'content-type': type,
        'content-range': 'bytes ' + start + '-' + end + '/' + st.size,
        'accept-ranges': 'bytes',
        'content-length': end - start + 1,
        etag: etag,
      });
      fs.createReadStream(filePath, { start: start, end: end }).pipe(res);
      return true;
    }
  }

  res.writeHead(200, {
    'content-type': type,
    'content-length': st.size,
    etag: etag,
    'accept-ranges': 'bytes',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { pathname = url.pathname; }
  const method = req.method.toUpperCase();

  try {
    if (pathname.startsWith('/api/')) return await api(req, res, pathname, method);

    if (pathname === '/backstage' || pathname === '/backstage/') {
      const ok = await serveFile(req, res, path.join(PUBLIC, 'backstage.html'));
      if (ok) return;
      return sendText(res, 'not found', 404);
    }

    if (pathname.startsWith('/uploads/')) {
      const rel = pathname.slice('/uploads/'.length);
      const abs = safeAbs(rel);
      if (!abs) return sendText(res, 'forbidden', 403);
      const ok = await serveFile(req, res, abs, true);
      if (!ok) return sendText(res, 'not found', 404);
      return;
    }

    const s = store.getSettings();
    const entry = s.security_entry || '';
    const first = pathname.split('/').filter(Boolean)[0] || '';
    if (entry && first === entry) {
      const ok = await serveFile(req, res, path.join(PUBLIC, 'backstage.html'));
      if (ok) return;
      return sendText(res, 'not found', 404);
    }

    const candidate = path.join(PUBLIC, pathname);
    const relCandidate = path.relative(PUBLIC, candidate);
    if (!relCandidate.startsWith('..') && !path.isAbsolute(relCandidate)) {
      const ok = await serveFile(req, res, candidate);
      if (ok) return;
    }

    if (pathname === '/' || !path.extname(pathname)) {
      const ok = await serveFile(req, res, path.join(PUBLIC, 'index.html'));
      if (ok) return;
      return sendText(res, 'not found', 404);
    }

    return sendText(res, 'not found', 404);
  } catch (err) {
    console.error('[personal-website]', err && err.stack ? err.stack : err);
    if (err && err.code === 'TOO_LARGE') {
      return sendJson(res, { ok: false, error: '上传内容过大' }, 413);
    }
    if (!res.headersSent) sendJson(res, { ok: false, error: '服务器内部错误' }, 500);
    else res.end();
  }
}

function main() {
  store.load();
  fs.mkdirSync(UPLOADS, { recursive: true });
  store.pruneSessions();

  const server = http.createServer(handler);
  server.listen(PORT, HOST, function () {
    console.log('');
    console.log('  Personal-website 已启动');
    console.log('  ----------------------------------');
    console.log('  前台:    http://localhost:' + PORT + '/');
    console.log('  后台:    http://localhost:' + PORT + '/backstage');
    console.log('  数据:    ' + path.join(ROOT, 'data'));
    console.log('');
  });
}

process.on('SIGINT', function () { process.exit(0); });
process.on('SIGTERM', function () { process.exit(0); });

main();
