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
  about_text: '常年研究逆向工具软件，擅长搭建网站。',
  avatar_key: '',
  bg_key: '',
  music_enabled: '1',
  music_mode: 'default',
  github_user: '',
  github_show_repos: '1',
  github_show_chart: '1',
  anim_intro: '1',
  anim_bg: '1',
  anim_reveal: '1',
  anim_avatar: '1',
  anim_player: '1',
  footer_text: '',
  footer_opacity: '0.55',
  footer_color: '#8b8b8b',
  footer_link: '',
  tg_enabled: '1',
  tg_title: '加入我的频道',
  tg_sub: '加入就是最大的帮助',
  tg_url: 'https://t.me/COASCN',
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
    seq: { admins: 0, tracks: 0, socials: 0 },
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
        seq: raw.seq || { admins: 0, tracks: 0, socials: 0 },
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

export { DATA_DIR, DB_FILE };
