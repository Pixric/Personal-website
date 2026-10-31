import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULTS = {
  initialized: '0',
  security_entry: '',
  site_name: '海岸线',
  nickname: '',
  about_text: '我很懒什么都没写。',
  avatar_key: '',
  bg_key: '',
  bg_url: '',
  bg_api_enabled: '0',
  bg_api_preset: '',
  bg_position: 'center center',
  bg_size_desktop: 'cover',
  bg_size_mobile: 'cover',
  font_key: '',
  font_family: '',
  font_scope: 'front',
  music_enabled: '1',
  music_mode: 'default',
  github_user: '',
  github_show_repos: '1',
  github_show_chart: '1',
  anim_intro: '1',
  anim_intro_duration: '1',
  anim_bg: '1',
  anim_bg_strength: '1',
  anim_reveal: '1',
  anim_reveal_distance: '18',
  anim_avatar: '1',
  anim_player: '1',
  dark_mode: '0',
  dark_bg_dim: '0',
  ui_round: '0',
  posts_enabled: '0',
  site_edition: '',
  footer_text: '',
  footer_opacity: '0.55',
  footer_color: '#8b8b8b',
  footer_link: '',
  tg_enabled: '1',
  tg_title: '加入我的频道',
  tg_sub: '加入就是最大的帮助',
  tg_url: 'https://t.me/COASCN',
  pay_enabled: '0',
  pay_api_url: 'https://paypro.youxi186.com',
  pay_pid: '',
  pay_key: '',
  pay_notify_url: '',
  pay_return_url: '',
  pay_entry_donate: '1',
  pay_entry_page: '1',
  pay_entry_post: '0',
  donate_title: '赞赏一下',
  donate_desc: '如果内容对你有帮助，可以请我喝杯咖啡',
  donate_presets: '5,10,20,50',
  kami_title: '购买卡密',
  kami_desc: '付款后自动发放卡密',
  pay_notify_secret: '',
};

let state = null;

function emptyState() {
  return {
    settings: { ...DEFAULTS },
    admins: [],
    sessions: [],
    tracks: [],
    socials: [],
    assets: [],
    seq: { admins: 0, tracks: 0, socials: 0, posts: 0 },
    stats: { days: {}, visitors: [], visits: 0 },
    posts: [],
    postLikes: {},
    payOrders: [],
    kamiStock: [],
    kamiIssued: [],
    seq: { admins: 0, tracks: 0, socials: 0, posts: 0, payOrders: 0, kamiStock: 0 },
  };
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
}

export function load() {
  ensureDir();
  if (state) return state;

  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      state = {
        settings: { ...DEFAULTS, ...(raw.settings || {}) },
        admins: Array.isArray(raw.admins) ? raw.admins : [],
        sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
        tracks: Array.isArray(raw.tracks) ? raw.tracks : [],
        socials: Array.isArray(raw.socials) ? raw.socials : [],
        assets: Array.isArray(raw.assets) ? raw.assets : [],
        seq: raw.seq || { admins: 0, tracks: 0, socials: 0, posts: 0 },
        stats: raw.stats || { days: {}, visitors: [], visits: 0 },
        posts: Array.isArray(raw.posts) ? raw.posts : [],
        postLikes: raw.postLikes || {},
        payOrders: Array.isArray(raw.payOrders) ? raw.payOrders : [],
        kamiStock: Array.isArray(raw.kamiStock) ? raw.kamiStock : [],
        kamiIssued: Array.isArray(raw.kamiIssued) ? raw.kamiIssued : [],
      };
    } catch {
      const bak = DB_FILE + '.corrupt-' + Date.now();
      try { fs.renameSync(DB_FILE, bak); } catch {}
      state = emptyState();
      save();
    }
  } else {
    state = emptyState();
    save();
  }

  return state;
}

export function save() {
  if (!state) return;
  ensureDir();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

export function nextId(kind) {
  const s = load();
  s.seq[kind] = (s.seq[kind] || 0) + 1;
  return s.seq[kind];
}

export function getSettings() {
  return { ...load().settings };
}

export function setSettings(patch) {
  const s = load();
  for (const [k, v] of Object.entries(patch || {})) s.settings[k] = String(v ?? '');
  save();
}

export function getRecoveryToken() {
  return load().settings.recovery_token || '';
}

export function ensureRecoveryToken(token) {
  const s = load();
  if (!s.settings.recovery_token && token) {
    s.settings.recovery_token = String(token);
    save();
  }
  return s.settings.recovery_token || '';
}

const MAX_DAY_KEYS = 400;
const MAX_VISITOR_IDS = 5000;

function dayKey(d) {
  const dt = d ? new Date(d) : new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

export function recordVisit(visitorId) {
  const s = load();
  if (!s.stats) s.stats = { days: {}, visitors: [], visits: 0 };

  const key = dayKey();
  const days = s.stats.days || (s.stats.days = {});
  if (!days[key]) days[key] = { visits: 0, uniques: 0, ids: [] };

  const bucket = days[key];
  bucket.visits = (bucket.visits || 0) + 1;
  s.stats.visits = (s.stats.visits || 0) + 1;

  let isNew = false;
  if (visitorId) {
    const ids = Array.isArray(bucket.ids) ? bucket.ids : (bucket.ids = []);
    if (!ids.includes(visitorId)) {
      ids.push(visitorId);
      if (ids.length > MAX_VISITOR_IDS) ids.splice(0, ids.length - MAX_VISITOR_IDS);
      bucket.uniques = ids.length;
      isNew = true;
    }
  }

  const keys = Object.keys(days).sort();
  if (keys.length > MAX_DAY_KEYS) {
    for (const k of keys.slice(0, keys.length - MAX_DAY_KEYS)) delete days[k];
  }

  save();
  return { isNew, visits: bucket.visits, uniques: bucket.uniques || 0, day: key };
}

export function visitStats(days1) {
  const s = load();
  const stats = s.stats || { days: {}, visits: 0 };
  const all = stats.days || {};

  const n = Math.max(1, Math.min(120, parseInt(days1, 10) || 14));
  const out = [];
  const today = new Date();

  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = dayKey(d);
    const bucket = all[key] || { visits: 0, uniques: 0 };
    out.push({ date: key, visits: bucket.visits || 0, uniques: bucket.uniques || 0 });
  }

  let totalVisits = 0;
  let totalUniques = 0;
  const seen = new Set();
  for (const k of Object.keys(all)) {
    const b = all[k];
    totalVisits += b.visits || 0;
    for (const id of (b.ids || [])) seen.add(id);
  }
  totalUniques = seen.size;

  const todayKey = dayKey();
  const t = all[todayKey] || { visits: 0, uniques: 0 };
  const yKey = dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
  const y = all[yKey] || { visits: 0, uniques: 0 };

  return {
    series: out,
    total: { visits: totalVisits, uniques: totalUniques },
    today: { visits: t.visits || 0, uniques: t.uniques || 0, date: todayKey },
    yesterday: { visits: y.visits || 0, uniques: y.uniques || 0, date: yKey },
  };
}

export function resetVisitStats() {
  const s = load();
  s.stats = { days: {}, visitors: [], visits: 0 };
  s.settings.visits = '0';
  save();
}

export function findAdminByName(username) {
  return load().admins.find((a) => a.username === username) || null;
}

export function findAdminById(id) {
  return load().admins.find((a) => a.id === id) || null;
}

export function insertAdmin(username, passwordHash) {
  const s = load();
  const row = { id: nextId('admins'), username, password_hash: passwordHash, created_at: Date.now() };
  s.admins.push(row);
  save();
  return row;
}

export function updateAdmin(id, patch) {
  const row = findAdminById(id);
  if (!row) return false;
  Object.assign(row, patch);
  save();
  return true;
}

export function adminCount() {
  return load().admins.length;
}

export function createSession(row) {
  const s = load();
  s.sessions.push(row);
  save();
  return row;
}

export function findSession(token) {
  const s = load();
  const sess = s.sessions.find((x) => x.token === token);
  if (!sess) return null;
  if (sess.expires_at < Date.now()) {
    s.sessions = s.sessions.filter((x) => x.token !== token);
    save();
    return null;
  }
  const admin = s.admins.find((a) => a.id === sess.admin_id);
  if (!admin) return null;
  return { ...sess, admin };
}

export function deleteSession(token) {
  const s = load();
  const before = s.sessions.length;
  s.sessions = s.sessions.filter((x) => x.token !== token);
  if (s.sessions.length !== before) save();
}

export function pruneSessions() {
  const s = load();
  const now = Date.now();
  const before = s.sessions.length;
  s.sessions = s.sessions.filter((x) => x.expires_at >= now);
  if (s.sessions.length !== before) save();
}

export function deleteOtherSessions(adminId, keepToken) {
  const s = load();
  s.sessions = s.sessions.filter((x) => x.admin_id !== adminId || x.token === keepToken);
  save();
}

export function allTracks() {
  return load().tracks.slice().sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
}

export function insertTrack(data) {
  const s = load();
  const maxOrder = s.tracks.reduce((m, t) => Math.max(m, t.sort_order), -1);
  const row = {
    id: nextId('tracks'),
    title: data.title,
    artist: data.artist || '',
    r2_key: data.r2_key,
    cover_key: data.cover_key || null,
    size: data.size || 0,
    mime: data.mime || '',
    duration: data.duration || null,
    sort_order: maxOrder + 1,
    created_at: Date.now(),
  };
  s.tracks.push(row);
  save();
  return row;
}

export function findTrack(id) {
  return load().tracks.find((t) => t.id === id) || null;
}

export function updateTrack(id, patch) {
  const row = findTrack(id);
  if (!row) return false;
  Object.assign(row, patch);
  save();
  return true;
}

export function deleteTrack(id) {
  const s = load();
  const before = s.tracks.length;
  s.tracks = s.tracks.filter((t) => t.id !== id);
  if (s.tracks.length === before) return false;
  save();
  return true;
}

export function reorderTracks(ids) {
  const s = load();
  ids.forEach((id, i) => {
    const t = s.tracks.find((x) => x.id === Number(id));
    if (t) t.sort_order = i;
  });
  save();
}

export function trackCount() {
  return load().tracks.length;
}

export function allSocials() {
  return load().socials.slice().sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
}

export function enabledSocials() {
  return allSocials().filter((x) => x.enabled);
}

export function insertSocial(data) {
  const s = load();
  const maxOrder = s.socials.reduce((m, t) => Math.max(m, t.sort_order), -1);
  const row = {
    id: nextId('socials'),
    label: data.label,
    url: data.url,
    icon: data.icon,
    icon_key: data.icon_key || null,
    sort_order: maxOrder + 1,
    enabled: true,
  };
  s.socials.push(row);
  save();
  return row;
}

export function findSocial(id) {
  return load().socials.find((x) => x.id === id) || null;
}

export function updateSocial(id, patch) {
  const row = findSocial(id);
  if (!row) return false;
  Object.assign(row, patch);
  save();
  return true;
}

export function deleteSocial(id) {
  const s = load();
  const before = s.socials.length;
  s.socials = s.socials.filter((x) => x.id !== id);
  if (s.socials.length === before) return false;
  save();
  return true;
}

export function reorderSocials(ids) {
  const s = load();
  ids.forEach((id, i) => {
    const x = s.socials.find((y) => y.id === Number(id));
    if (x) x.sort_order = i;
  });
  save();
}

export function socialCount() {
  return load().socials.length;
}

export function allAssets() {
  return load().assets.slice().sort((a, b) => b.uploaded_at - a.uploaded_at);
}

export function upsertAsset(row) {
  const s = load();
  s.assets = s.assets.filter((x) => x.key !== row.key);
  s.assets.push(row);
  save();
}

export function deleteAsset(key) {
  const s = load();
  s.assets = s.assets.filter((x) => x.key !== key);
  save();
}

export function clearAssets() {
  load().assets = [];
  save();
}

export function clearTracks() {
  load().tracks = [];
  save();
}

function slugify(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export function allPosts() {
  const list = load().posts || [];
  return list.slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
}

export function publishedPosts() {
  return allPosts().filter((p) => p.published !== '0');
}

export function findPostById(id) {
  return (load().posts || []).find((p) => p.id === Number(id)) || null;
}

export function findPostBySlug(slug) {
  return (load().posts || []).find((p) => p.slug === String(slug)) || null;
}

export function postSlugTaken(slug, exceptId) {
  return (load().posts || []).some(
    (p) => p.slug === String(slug) && p.id !== Number(exceptId)
  );
}

export function makeSlug(title, fallback) {
  let base = slugify(title);
  if (!base) base = 'post-' + (fallback || Date.now().toString(36));
  if (!postSlugTaken(base)) return base;
  let i = 2;
  while (postSlugTaken(base + '-' + i) && i < 500) i++;
  return base + '-' + i;
}

export function insertPost(data) {
  const s = load();
  if (!Array.isArray(s.posts)) s.posts = [];
  s.seq.posts = (s.seq.posts || 0) + 1;
  const row = {
    id: s.seq.posts,
    slug: data.slug,
    title: data.title || '',
    content: data.content || '',
    cover_key: data.cover_key || '',
    file_key: data.file_key || '',
    file_name: data.file_name || '',
    file_size: data.file_size || 0,
    file_icon_key: data.file_icon_key || '',
    published: data.published === '0' ? '0' : '1',
    likes: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  s.posts.push(row);
  save();
  return row;
}

export function updatePost(id, patch) {
  const s = load();
  const p = (s.posts || []).find((x) => x.id === Number(id));
  if (!p) return null;
  for (const k of ['slug', 'title', 'content', 'cover_key', 'file_key',
    'file_name', 'file_size', 'file_icon_key', 'published']) {
    if (k in patch) p[k] = patch[k];
  }
  p.updated_at = Date.now();
  save();
  return p;
}

export function deletePost(id) {
  const s = load();
  const before = (s.posts || []).length;
  s.posts = (s.posts || []).filter((p) => p.id !== Number(id));
  if (s.postLikes && s.postLikes[id]) delete s.postLikes[id];
  if (s.posts.length === before) return false;
  save();
  return true;
}

export function togglePostLike(id, visitorId) {
  const s = load();
  const p = (s.posts || []).find((x) => x.id === Number(id));
  if (!p) return null;
  if (!s.postLikes) s.postLikes = {};

  const key = String(id);
  if (!Array.isArray(s.postLikes[key])) s.postLikes[key] = [];
  const list = s.postLikes[key];
  const idx = list.indexOf(visitorId);

  let liked;
  if (idx >= 0) {
    list.splice(idx, 1);
    liked = false;
  } else {
    list.push(visitorId);
    liked = true;
  }
  p.likes = list.length;
  save();
  return { liked, likes: p.likes };
}

export function postLikedBy(id, visitorId) {
  const s = load();
  const list = (s.postLikes && s.postLikes[String(id)]) || [];
  return list.includes(visitorId);
}

export function clearPosts() {
  const s = load();
  s.posts = [];
  s.postLikes = {};
  save();
}

export { DATA_DIR, DB_FILE };
