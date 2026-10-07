/**
 * grwz-cloud · Worker 入口
 *
 * 路由规则：
 *   /backstage              → 初始化向导 / 登录页（部署后没配置过就走向导）
 *   /<安全入口>              → 登录页（安全入口设置后，后台入口就变成这个地址）
 *   /api/...                → 接口
 *   /api/file/:key          → R2 文件
 *   /api/admin/*            → 需要登录
 *   其他一切路径             → 前台静态站点（SPA）
 *
 * 关键行为：如果访问的路径不是正确的安全入口，就当作普通前台请求处理，
 *          继续显示主内容 —— 不会泄露后台的存在。
 */

import {
  json,
  fail,
  getSettings,
  currentAdmin,
} from './lib.js';
import { ensureSchema } from './migrate.js';
import { siteConfig, serveFile, visit } from './routes/public.js';
import { setupStatus, setupEntry, setupAdmin, login } from './routes/setup.js';
import * as adminApi from './routes/admin.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    try {
      /* ---------------- 自动建表 ---------------- */
      // 让「点一下部署」就能用：首次请求时自动建表并写入默认设置。
      // 只对需要数据库的请求执行，静态资源不触发，也不阻塞静态页面。
      if (needsDatabase(path)) {
        await ensureSchema(env);
      }

      /* ---------------- API ---------------- */
      if (path.startsWith('/api/')) {
        return await handleApi(request, env, url, method);
      }

      /* ---------------- 后台入口 ---------------- */
      // /backstage 与 /backstage/... 都交给后台页面（前端自行判断显示向导还是登录）
      if (path === '/backstage' || path.startsWith('/backstage/')) {
        return env.ASSETS.fetch(withPath(request, '/backstage.html'));
      }

      /* ---------------- 安全入口 ---------------- */
      const entry = await getEntry(env);
      if (entry) {
        const seg = firstSegment(path);
        if (seg && seg === entry) {
          // 命中安全入口 → 后台页面（登录后即为后台面板）
          return env.ASSETS.fetch(withPath(request, '/backstage.html'));
        }
      }

      /* ---------------- 前台 ---------------- */
      // 先尝试命中真实静态资源，未命中一律回落到 index.html
      return await serveFrontend(request, env, path);
    } catch (err) {
      console.error('Unhandled error:', err && err.stack ? err.stack : err);
      return json({ ok: false, error: '服务器内部错误' }, { status: 500 });
    }
  },
};

/* ------------------------------------------------------------------ */
/* API 分发                                                            */
/* ------------------------------------------------------------------ */

async function handleApi(request, env, url, method) {
  const path = url.pathname;

  /* ---- 公开接口 ---- */
  if (path === '/api/site' && method === 'GET') {
    return siteConfig(env);
  }

  if (path.startsWith('/api/file/') && (method === 'GET' || method === 'HEAD')) {
    const key = path.slice('/api/file/'.length);
    return serveFile(request, env, key);
  }

  if (path === '/api/setup/status' && method === 'GET') {
    return setupStatus(env);
  }

  if (path === '/api/visit' && method === 'POST') {
    return visit(request, env);
  }

  /* ---- 初始化向导 ---- */
  if (path === '/api/setup/entry' && method === 'POST') {
    return setupEntry(request, env);
  }

  if (path === '/api/setup/admin' && method === 'POST') {
    return setupAdmin(request, env);
  }

  /* ---- 登录 ---- */
  if (path === '/api/auth/login' && method === 'POST') {
    return login(request, env);
  }

  /* ---- 需要登录的后台接口 ---- */
  if (path.startsWith('/api/admin/')) {
    const admin = await currentAdmin(request, env);
    if (!admin) return fail('未登录或会话已过期', 401);

    const rest = path.slice('/api/admin/'.length);

    if (rest === 'me' && method === 'GET') return adminApi.me(request, env, admin);
    if (rest === 'state' && method === 'GET') return adminApi.state(env);
    if (rest === 'settings' && method === 'PUT') return adminApi.updateSettings(request, env);
    if (rest === 'credentials' && method === 'POST') return adminApi.changeCredentials(request, env, admin);
    if (rest === 'logout' && method === 'POST') return adminApi.logout(request, env, admin);

    if (rest === 'upload' && method === 'POST') {
      // 上传体积大，不做额外的 JSON 预读
      return adminApi.upload(request, env);
    }

    // 音乐
    if (rest === 'tracks' && method === 'GET') return adminApi.listTracks(env);
    if (rest === 'tracks/reorder' && method === 'POST') return adminApi.reorderTracks(request, env);
    let m = /^tracks\/(\d+)$/.exec(rest);
    if (m) {
      const id = parseInt(m[1], 10);
      if (method === 'PUT' || method === 'PATCH') return adminApi.updateTrack(request, env, id);
      if (method === 'DELETE') return adminApi.deleteTrack(env, id);
    }

    // 社交链接
    if (rest === 'socials' && method === 'GET') return adminApi.listSocials(env);
    if (rest === 'socials' && method === 'POST') return adminApi.createSocial(request, env);
    if (rest === 'socials/reorder' && method === 'POST') return adminApi.reorderSocials(request, env);
    m = /^socials\/(\d+)$/.exec(rest);
    if (m) {
      const id = parseInt(m[1], 10);
      if (method === 'PUT' || method === 'PATCH') return adminApi.updateSocial(request, env, id);
      if (method === 'DELETE') return adminApi.deleteSocial(env, id);
    }

    if (rest === 'wipe-assets' && method === 'POST') return adminApi.wipeAssets(request, env);

    return fail('接口不存在', 404);
  }

  return fail('接口不存在', 404);
}

/* ------------------------------------------------------------------ */
/* 前台静态资源                                                        */
/* ------------------------------------------------------------------ */

async function serveFrontend(request, env, path) {
  const assetRes = await env.ASSETS.fetch(request);

  // SPA 回落：只要不是真正的静态文件，就交给 index.html
  if (assetRes.status === 404) {
    return env.ASSETS.fetch(withPath(request, '/index.html'));
  }
  return assetRes;
}

/* ------------------------------------------------------------------ */
/* 辅助                                                                */
/* ------------------------------------------------------------------ */

/**
 * 哪些请求需要数据库？
 *   - /api/*        ：全部接口都要读写 D1
 *   - /backstage    ：后台要判断初始化状态
 * 其余路径（css / js / 图片等静态资源）直接跳过，避免无谓开销。
 *
 * 注意：普通前台路径也要查安全入口（见 getEntry），
 * 但那次查询本身会走 ensureSchema，所以这里不必重复。
 */
function needsDatabase(path) {
  if (path.startsWith('/api/')) return true;
  if (path === '/backstage' || path.startsWith('/backstage/')) return true;
  return false;
}

/**
 * 读取安全入口。
 * 注意：不能用模块级变量做缓存 —— Worker 的模块作用域会在同一 isolate 的
 * 多个请求、多个 env（本地开发 / 不同部署）之间共享，既会串数据，
 * 也会让「刚改完安全入口但缓存还没过期」的情况出现。
 * 这里每次请求都读 D1；D1 的读取延迟很低，安全性优先。
 */
async function getEntry(env) {
  try {
    // 前台请求也要走这一步：数据库可能是全新的、还没建表
    await ensureSchema(env);
    const s = await getSettings(env);
    return s.security_entry || '';
  } catch {
    return '';
  }
}

function firstSegment(path) {
  const parts = path.split('/').filter(Boolean);
  return parts.length ? decodeURIComponent(parts[0]) : '';
}

function withPath(request, newPath) {
  const url = new URL(request.url);
  url.pathname = newPath;
  return new Request(url.toString(), request);
}
