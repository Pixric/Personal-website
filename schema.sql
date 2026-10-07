-- ============================================================
--  grwz-cloud · D1 数据库结构
--  执行：npm run db:init:remote
-- ============================================================

-- 站点全局设置（键值对）----------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 管理员账号 ---------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,           -- PBKDF2-HMAC-SHA256，格式 pbkdf2$迭代次数$salt$hash
  created_at    INTEGER NOT NULL
);

-- 登录会话 -----------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  admin_id   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip         TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- 音乐库 -------------------------------------------------------
CREATE TABLE IF NOT EXISTS tracks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  artist      TEXT,
  r2_key      TEXT NOT NULL,             -- R2 中的音频对象键
  cover_key   TEXT,                      -- R2 中的封面对象键
  size        INTEGER NOT NULL DEFAULT 0,
  mime        TEXT,
  duration    REAL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracks_order ON tracks(sort_order, id);

-- 社交链接 -----------------------------------------------------
CREATE TABLE IF NOT EXISTS socials (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL,              -- 展示名称，例如 "X"
  url        TEXT NOT NULL,
  icon       TEXT NOT NULL,              -- 内置图标 id，或 "custom"
  icon_key   TEXT,                       -- icon = "custom" 时，R2 中的图标对象键
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_socials_order ON socials(sort_order, id);

-- 上传资产登记（用于后台展示占用与清理）------------------------
CREATE TABLE IF NOT EXISTS assets (
  key           TEXT PRIMARY KEY,
  size          INTEGER NOT NULL DEFAULT 0,
  mime          TEXT,
  original_name TEXT,
  kind          TEXT,
  uploaded_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_time ON assets(uploaded_at DESC);

-- 默认设置（部署后即为「未初始化」状态，首次访问 /backstage 进入初始化向导）
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('initialized',      '0',      strftime('%s','now') * 1000),
  ('security_entry',   '',       strftime('%s','now') * 1000),
  ('site_name',        '贪睡',    strftime('%s','now') * 1000),
  ('nickname',         '',       strftime('%s','now') * 1000),
  ('about_text',       '常年研究逆向工具软件，擅长搭建网站。', strftime('%s','now') * 1000),
  ('avatar_key',       '',       strftime('%s','now') * 1000),
  ('bg_key',           '',       strftime('%s','now') * 1000),
  ('music_enabled',    '1',      strftime('%s','now') * 1000),
  ('music_mode',       'default',strftime('%s','now') * 1000),
  ('github_user',      '',       strftime('%s','now') * 1000),
  ('github_show_repos','1',      strftime('%s','now') * 1000),
  ('github_show_chart','1',      strftime('%s','now') * 1000),
  ('anim_intro',       '1',      strftime('%s','now') * 1000),
  ('anim_bg',          '1',      strftime('%s','now') * 1000),
  ('anim_reveal',      '1',      strftime('%s','now') * 1000),
  ('anim_avatar',      '1',      strftime('%s','now') * 1000),
  ('anim_player',      '1',      strftime('%s','now') * 1000),
  ('footer_text',      '',       strftime('%s','now') * 1000),
  ('footer_opacity',   '0.55',   strftime('%s','now') * 1000),
  ('footer_color',     '#8a8a8e',strftime('%s','now') * 1000),
  ('footer_link',      '',       strftime('%s','now') * 1000),
  ('tg_enabled',       '1',      strftime('%s','now') * 1000),
  ('tg_title',         '加入我的频道', strftime('%s','now') * 1000),
  ('tg_sub',           '加入就是最大的帮助', strftime('%s','now') * 1000),
  ('tg_url',           'https://t.me/COASCN', strftime('%s','now') * 1000);
