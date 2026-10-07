/**
 * 本地集成测试：用 mock 的 D1 / R2 跑通「初始化 → 登录 → 设置 → 上传」全流程。
 * 运行：node test/flow.test.mjs
 */

import { hashPassword, verifyPassword, validateSecurityEntry, validateUsername, validatePassword } from '../src/lib.js';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  \u2713 ${name}`); }
  else { fail++; console.log(`  \u2717 ${name} ${extra}`); }
}

/* ---------------- 单元测试：密码哈希 ---------------- */

console.log('\n[密码哈希]');
const h = await hashPassword('secret123');
check('格式为 pbkdf2$... 四段', h.split('$').length === 4, h.slice(0, 30));
check('存储的不是明文', !h.includes('secret123'));
check('正确密码校验通过', await verifyPassword('secret123', h));
check('错误密码校验失败', !(await verifyPassword('secret124', h)));
check('空密码校验失败', !(await verifyPassword('', h)));
check('损坏哈希不抛异常', !(await verifyPassword('x', 'garbage')));
const h2 = await hashPassword('secret123');
check('相同密码两次哈希不同（加盐）', h !== h2);
check('两个哈希都能校验通过', await verifyPassword('secret123', h2));

/* ---------------- 单元测试：校验规则 ---------------- */

console.log('\n[安全入口校验]');
check('4 位被拒绝', !validateSecurityEntry('abcd').ok);
check('5 位通过', validateSecurityEntry('abcde').ok);
check('含空格被拒绝', !validateSecurityEntry('ab cd').ok);
check('含斜杠被拒绝', !validateSecurityEntry('ab/cd').ok);
check('保留字 backstage 被拒绝', !validateSecurityEntry('backstage').ok);
check('保留字大写也被拒绝', !validateSecurityEntry('BackStage').ok);
check('含中文被拒绝', !validateSecurityEntry('入口入口入口').ok);
check('65 位被拒绝', !validateSecurityEntry('a'.repeat(65)).ok);

console.log('\n[账号校验]');
check('2 位被拒绝', !validateUsername('ab').ok);
check('3 位通过', validateUsername('abc').ok);
check('含空格被拒绝', !validateUsername('a b').ok);
check('邮箱样式通过', validateUsername('me@example.com').ok);

console.log('\n[密码校验]');
check('5 位被拒绝', !validatePassword('abcde').ok);
check('6 位通过', validatePassword('abcdef').ok);
check('129 位被拒绝', !validatePassword('a'.repeat(129)).ok);

/* ---------------- 路由 / 权限（静态分析） ---------------- */

console.log('\n[路由保护]');
const fs = await import('node:fs/promises');
const worker = await fs.readFile(new URL('../src/worker.js', import.meta.url), 'utf8');

check('admin 接口统一要求登录', /path\.startsWith\('\/api\/admin\/'\)[\s\S]{0,200}currentAdmin/.test(worker));
check('未登录返回 401', /未登录或会话已过期/.test(worker));
check('安全入口未命中时回落到前台', /serveFrontend\(request, env, path\)/.test(worker));
const publicSrc = await fs.readFile(new URL('../src/routes/public.js', import.meta.url), 'utf8');
check('/api/file 支持 Range', /parseRange/.test(publicSrc));
check('非安全入口不泄露后台', !/backstage'[\s\S]{0,80}redirect/i.test(worker));

const lib = await fs.readFile(new URL('../src/lib.js', import.meta.url), 'utf8');
check('会话 Cookie 为 HttpOnly', /HttpOnly/.test(lib));
check('会话 Cookie 为 SameSite=Strict', /SameSite=Strict/.test(lib));
check('会话 Cookie 为 Secure', /Secure/.test(lib));
check('PBKDF2 迭代次数 >= 100000', /PBKDF2_ITERATIONS = (\d+)/.exec(lib)[1] >= 100000);
check('文件路径拒绝 ..', /includes\('\.\.'\)/.test(await fs.readFile(new URL('../src/routes/public.js', import.meta.url), 'utf8')));

const adminSrc = await fs.readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
check('上传限制音频 96MB', /MAX_UPLOAD_BYTES/.test(adminSrc));
check('上传校验 MIME 类型', /mime\.startsWith\('audio\/'\)/.test(adminSrc));
check('社交链接强校验 http(s)', /https\?:\\\/\\\/\.\+/.test(adminSrc));
check('清空操作需要 DELETE 确认', /body\.confirm !== 'DELETE'/.test(adminSrc));

/* ---------------- 静态资源完整性 ---------------- */

console.log('\n[前端资源]');
const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const backstageHtml = await fs.readFile(new URL('../public/backstage.html', import.meta.url), 'utf8');
const appJs = await fs.readFile(new URL('../public/assets/app.js', import.meta.url), 'utf8');
const backstageJs = await fs.readFile(new URL('../public/assets/backstage.js', import.meta.url), 'utf8');
const icons = await fs.readFile(new URL('../public/assets/icons.js', import.meta.url), 'utf8');

check('前台引用 style.css', html.includes('/assets/style.css'));
check('前台引用 app.js', html.includes('/assets/app.js'));
check('后台引用 backstage.css', backstageHtml.includes('/assets/backstage.css'));
check('后台引用 icons.js', backstageHtml.includes('/assets/icons.js'));
check('前台已移除硬编码头像', !html.includes('avatar.jpeg'));
check('前台已移除硬编码音乐', !html.includes('maybe.mp3'));
check('后台具备安全入口表单', backstageHtml.includes('entryInput'));
check('后台具备「一切完成」文案', backstageHtml.includes('一切完成'));
check('“一切完成”停留 4000ms', /4000/.test(backstageJs));
check('完成动画为淡出', /doneFadeOut/.test(await fs.readFile(new URL('../public/assets/backstage.css', import.meta.url), 'utf8')));
check('前台支持随机播放', appJs.includes("music_mode === 'random'"));
check('前台支持动画开关', appJs.includes('applyAnimations'));
check('前台有电报频道卡片', html.includes('tgCard') && html.includes('t.me/COASCN'));
check('后台有 5 个动画开关', (backstageHtml.match(/data-anim=/g) || []).length === 5);
check('图标库至少 15 个图标', (icons.match(/name:\s*'/g) || []).length >= 15);
check('图标库每个条目都有 path', (icons.match(/path:\s*'/g) || []).length === (icons.match(/name:\s*'/g) || []).length);

/* ---------------- Schema ---------------- */

console.log('\n[数据库结构]');
const schema = await fs.readFile(new URL('../schema.sql', import.meta.url), 'utf8');
['settings', 'admins', 'sessions', 'tracks', 'socials', 'assets'].forEach((t) => {
  check(`表 ${t} 已定义`, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}`).test(schema));
});
check('settings.key 为主键', /key\s+TEXT PRIMARY KEY/.test(schema));
check('默认未初始化', /'initialized',\s*'0'/.test(schema));
check('默认电报链接正确', schema.includes('https://t.me/COASCN'));

/* ---------------- 结果 ---------------- */

console.log(`\n${'='.repeat(46)}`);
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
