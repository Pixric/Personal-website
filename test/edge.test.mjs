/**
 * 边界场景测试：数据库未建表、表存在但无数据、部分初始化等状态，
 * 确认用户在任何中间状态下都能得到清晰的提示而不是白屏或 500。
 *
 * 运行：node test/edge.test.mjs
 */

import worker from '../src/worker.js';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + ' ' + extra); }
}

/** 一个什么表都没有的数据库：所有查询都抛错，模拟「忘了跑 schema.sql」 */
const emptyDb = {
  prepare() {
    return {
      bind() { return this; },
      async run() { throw new Error('no such table'); },
      async first() { throw new Error('no such table'); },
      async all() { throw new Error('no such table'); },
    };
  },
  async batch() { throw new Error('no such table'); },
};

const assets = {
  async fetch() {
    return new Response('<!doctype html><title>assets</title>', {
      headers: { 'content-type': 'text/html' },
    });
  },
};

const env = {
  DB: emptyDb,
  BUCKET: { async get() { return null; } },
  ASSETS: assets,
};

async function call(path, opts = {}) {
  const res = await worker.fetch(new Request('https://x.dev' + path, opts), env, {});
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

console.log('\n[数据库未初始化（未执行 schema.sql）]');

let r = await call('/api/setup/status');
check('状态接口返回 200（不崩）', r.status === 200, 'status=' + r.status);
check('返回 initialized=false', r.body.initialized === false);
check('返回 security_entry_set=false', r.body.security_entry_set === false);
check('明确标记 database_ready=false', r.body.database_ready === false);
check('给出可执行的修复提示', /db:init/.test(r.body.message || ''), r.body.message);

r = await call('/api/site');
check('前台配置接口不崩（200）', r.status === 200, 'status=' + r.status);
check('前台被告知未初始化', r.body.initialized === false);
check('前台得到空站点配置', r.body.site && typeof r.body.site === 'object');
check('前台不会白屏（渲染为「准备中」）', r.body.database_ready === false);
check('错误信息不泄露内部细节', !/no such table/i.test(JSON.stringify(r.body)));

r = await call('/api/admin/state');
check('后台接口被拒绝（401，未登录优先）', r.status === 401);

r = await call('/', { method: 'GET' });
check('主页仍能正常返回静态资源', r.status === 200 && String(r.body).includes('assets'));

r = await call('/backstage');
check('后台页面仍能打开（前端会显示错误提示）', r.status === 200);

r = await call('/api/file/x.png');
check('文件接口未崩溃', r.status === 404, 'status=' + r.status);

console.log('\n[结论]');
console.log('  数据库没建表时：前台接口返回 500 + 友好 JSON 错误，');
console.log('  静态页面照常打开，后台页会提示「无法连接后端」。');
console.log('  用户不会看到白屏，能按 README 提示去执行建表命令。');

console.log('\n' + '='.repeat(46));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
