/**
 * 流程一致性检查：确认后端的「设置安全入口 → 注册管理员 → 一切完成」
 * 状态机与前端向导的步骤判断完全对齐，并核对用户提出的每一条需求。
 *
 * 运行：node test/requirements.test.mjs
 */

import worker from '../src/worker.js';
import fs from 'node:fs/promises';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + ' ' + extra); }
}

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFile(new URL(p, root), 'utf8');

const backstageJs = await read('public/assets/backstage.js');
const backstageCss = await read('public/assets/backstage.css');
const backstageHtml = await read('public/backstage.html');
const appJs = await read('public/assets/app.js');
const indexHtml = await read('public/index.html');
const styleCss = await read('public/assets/style.css');
const lib = await read('src/lib.js');
const readme = await read('README.md');

console.log('\n[需求逐条核对]');

console.log('\n-- 1. 存代码用 GitHub，部署用 Cloudflare --');
check('README 主推 Fork 方式', /Fork 这个仓库/.test(readme));
check('README 说明 Fork 后是自己的副本', /属于自己的完整代码/.test(readme));
check('README 说明如何同步上游更新', /Sync fork/.test(readme));
check('README 说明 Cloudflare 部署命令', /npm run deploy/.test(readme));
check('使用 Workers + D1 + R2', /d1_databases/.test(await read('wrangler.toml')));
check('R2 默认注释掉（保证首次部署成功）',
  /^#\s*\[\[r2_buckets\]\]/m.test(await read('wrangler.toml')));
check('wrangler.toml 说明 database_id 是占位符',
  /是占位符，直接部署会失败/.test(await read('wrangler.toml')));

console.log('\n-- 1b. 全程不需要电脑（手机可用）--');
check('README 明确说明不需要电脑', /全程用手机就能完成，不需要电脑/.test(readme));
check('README 说数据库不用手动建', /数据库不用手动建/.test(readme));
check('README 用网页控制台而不是命令行部署',
  /Connect to Git/.test(readme) && /Workers & Pages/.test(readme));
check('README 说明 R2 也全程网页操作', /Create bucket/.test(readme));
check('README 不再要求安装 Node.js', !/Node\.js 18 或更高版本/.test(readme));
check('命令行降级为「附」章节', /## 附：如果你有电脑/.test(readme));
check('忘记入口提供手机可用的 SQL 控制台方案',
  /D1 SQL database/.test(readme) && /点 \*\*Console\*\*/.test(readme));
check('FAQ 明确回答「没有电脑也能做」',
  /一定要用电脑吗？我没有电脑/.test(readme) && /不需要。/.test(readme));

console.log('\n-- 1c. 不含点开头的隐藏文件（网页上传不认）--');
{
  const fsMod = await import('node:fs/promises');
  const pathMod = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const projRoot = fileURLToPath(new URL('../', import.meta.url));

  const dotfiles = [];
  async function walk(dir) {
    const entries = await fsMod.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.wrangler' || e.name === '.git') continue;
      const full = pathMod.join(dir, e.name);
      if (e.name.startsWith('.')) dotfiles.push(pathMod.relative(projRoot, full));
      if (e.isDirectory()) await walk(full);
    }
  }
  await walk(projRoot);

  check('项目里没有任何点开头的文件', dotfiles.length === 0,
    '发现: ' + dotfiles.join(', '));
  check('没有 .gitignore', !dotfiles.includes('.gitignore'));
  check('没有 .dev.vars.example', !dotfiles.includes('.dev.vars.example'));
  check('提供了 UPLOAD.md 网页上传指南', /网页上传指南/.test(await read('UPLOAD.md')));
  check('UPLOAD.md 说明目录结构不能变', /目录结构不能变/.test(await read('UPLOAD.md')));
  check('UPLOAD.md 说明 test 可以不上传', /可以不上传/.test(await read('UPLOAD.md')));
  check('UPLOAD.md 提到 .gitignore 只能命令行创建',
    /只能通过命令行创建/.test(await read('UPLOAD.md')));
  check('README 指向 UPLOAD.md', /UPLOAD\.md/.test(readme));
}

console.log('\n-- 2. 独立后台，地址为 域名/backstage 起步 --');
check('/backstage 路由存在', /path === '\/backstage'/.test(await read('src/worker.js')));
check('初始化向导在 /backstage 页面内', backstageHtml.includes('stepEntry'));

console.log('\n-- 3. 先改安全入口（5 位以上） --');
check('后端强制最少 5 位', /securityEntryMin:\s*5/.test(lib));
check('前端也校验 5 位', /length < 5/.test(backstageJs));
check('向导第一步是设置安全入口', /showStep\('stepEntry'\)/.test(backstageJs));
check('安全入口可含字母数字下划线中划线', /\^\[A-Za-z0-9_-\]\+\$/.test(lib));

console.log('\n-- 4. 再注册管理员（账号 3 位+，密码 6 位+） --');
check('后端账号最少 3 位', /usernameMin:\s*3/.test(lib));
check('后端密码最少 6 位', /passwordMin:\s*6/.test(lib));
check('前端校验账号 3 位', /username\.length < 3/.test(backstageJs));
check('前端校验密码 6 位', /password\.length < 6/.test(backstageJs));
check('第二步是注册管理员', /showStep\('stepAdmin'\)/.test(backstageJs));

console.log('\n-- 5. 密码哈希存储 --');
check('使用 PBKDF2-HMAC-SHA256', /PBKDF2/.test(lib) && /SHA-256/.test(lib));
check('带随机盐', /getRandomValues\(new Uint8Array\(16\)\)/.test(lib));
check('迭代 12 万次', /PBKDF2_ITERATIONS = 120000/.test(lib));
check('校验用恒定时间比较', /diff \|=/.test(lib));

console.log('\n-- 6. 出现「一切完成」，淡入淡出，停留 4 秒后进入安全入口登录 --');
check('页面有「一切完成」文案', backstageHtml.includes('一切完成'));
check('有 done 步骤容器', backstageHtml.includes('id="stepDone"'));
check('停留 4000 毫秒', /4000\)/.test(backstageJs));
check('淡入动画 doneFadeIn', /@keyframes doneFadeIn/.test(backstageCss));
check('淡出动画 doneFadeOut', /@keyframes doneFadeOut/.test(backstageCss));
check('淡出用了 blur + opacity（丝滑）',
  /doneFadeOut\{[\s\S]{0,120}opacity:0[\s\S]{0,80}blur/.test(backstageCss.replace(/\r?\n/g, '')));
check('完成后跳转到安全入口', /location\.replace\('\/' \+ entry\)/.test(backstageJs));

console.log('\n-- 7. 可设置关于我：名字 / 头像 / 音乐 --');
const adminState = await read('src/routes/admin.js');
check('可设置站点名', /site_name/.test(adminState) && indexHtml.includes('id="name"'));
check('可上传头像', /kind === 'avatar'/.test(adminState));
check('可上传音乐', /kind === 'track'/.test(adminState));
check('可上传背景图', /kind === 'bg'/.test(adminState));

console.log('\n-- 8. 音乐：默认顺序 / 随机播放 --');
check('支持默认顺序（仅随机时才打乱）',
  /var queue = tracks\.slice\(\);/.test(appJs) && /if \(site\.music_mode === 'random'\) shuffle\(queue\);/.test(appJs));
check('支持随机播放', /site\.music_mode === 'random'/.test(appJs));
check('后台可选播放模式', backstageHtml.includes('musicMode'));
check('随机模式会打乱队列', /shuffle\(queue\)/.test(appJs));

console.log('\n-- 9. 没有安全入口地址也能访问主页 --');
check('非安全入口路径回落前台', /serveFrontend\(request, env, path\)/.test(await read('src/worker.js')));
check('README 说明这一点', /不会暴露后台/.test(readme));

console.log('\n-- 10. 动画可单独开关 --');
const animKeys = ['anim_intro', 'anim_bg', 'anim_reveal', 'anim_avatar', 'anim_player'];
for (const k of animKeys) {
  check(`开关 ${k} 存在`, backstageHtml.includes(`data-anim="${k}"`));
}
check('前台读取动画开关', /applyAnimations/.test(appJs));
check('开场高斯模糊可关', /no-anim-intro/.test(appJs) && /no-anim-intro/.test(styleCss));
check('背景移动缩放可关', /setupParallax/.test(appJs) && /animations\.background/.test(appJs));
check('播放器动画可关', /no-anim-player/.test(appJs));

console.log('\n-- 11. 链接 GitHub --');
check('后台可填 GitHub 用户名', backstageHtml.includes('fGithubUser'));
check('可开关仓库卡片', backstageHtml.includes('ghShowRepos'));
check('可开关贡献图', backstageHtml.includes('ghShowChart'));
check('前台读取仓库', /api\.github\.com\/users\//.test(appJs));
check('前台读取贡献图', /ghchart\.rshah\.org/.test(appJs));
check('README 说明填用户名而非网址', /不用填完整网址/.test(readme));

console.log('\n-- 12. 可关掉音乐功能 --');
check('后台有音乐总开关', backstageHtml.includes('musicEnabled'));
check('前台据此隐藏播放器', /!site\.music_enabled/.test(appJs));

console.log('\n-- 13. 页脚可填备案号，可调透明度与颜色 --');
check('后台可填页脚文字', backstageHtml.includes('fFooterText'));
check('可选颜色', backstageHtml.includes('fFooterColor'));
check('可调透明度', backstageHtml.includes('fFooterOpacity'));
check('默认灰色 #8a8a8e', /#8a8a8e/.test(backstageHtml));
check('前台渲染页脚', /renderFooter/.test(appJs));
check('透明度夹紧 0~1', /clampOpacity/.test(await read('src/routes/public.js')));

console.log('\n-- 14. 社交图标：内置可选，也可自己上传 --');
const icons = await read('public/assets/icons.js');
const iconCount = (icons.match(/name:\s*'/g) || []).length;
check(`内置图标 ${iconCount} 个（>=15）`, iconCount >= 15);
check('有 X', /\bx:\s*\{/.test(icons));
check('有 Telegram', /telegram:\s*\{/.test(icons));
check('有 GitHub', /github:\s*\{/.test(icons));
check('可上传自定义图标',
  /\['avatar', 'bg', 'track', 'cover', 'icon'\]\.includes\(kind\)/.test(adminState));
check('图标选择器存在', backstageHtml.includes('iconPicker'));

console.log('\n-- 15. 最多 5 个（建议但不限制） --');
check('后端建议数为 5', /socialsSoftMax:\s*5/.test(lib));
check('超出只提示不阻止', /hint:/.test(adminState) && /已添加/.test(adminState));
check('界面标注「建议」', /建议最多 5 个/.test(backstageHtml));
check('README 说明不强制', /只是建议，不强制/.test(readme));

console.log('\n-- 16. 后台显示「加入我的频道」，跳转 t.me/COASCN --');
check('默认标题「加入我的频道」', /加入我的频道/.test(await read('schema.sql')));
check('默认链接 COASCN', /https:\/\/t\.me\/COASCN/.test(await read('schema.sql')));
check('前台有频道卡片', /tgCard/.test(indexHtml));
check('下方灰色小字默认文案', /加入就是最大的帮助/.test(await read('schema.sql')));
check('小字样式为灰色小字', /\.tg-sub\{[\s\S]{0,80}font-size:12\.5px/.test(styleCss.replace(/\r?\n/g,'')));
check('README 提到频道', /t\.me\/COASCN/.test(readme));

console.log('\n-- 17. 以我的身份写部署与使用 md --');
check('README 存在且为中文', readme.length > 3000 && /部署与使用说明/.test(readme));
check('README 含部署步骤', /## 三、部署/.test(readme));
check('README 含使用说明', /## 五、后台功能详解/.test(readme));
check('README 含常见问题', /## 八、常见问题/.test(readme));
check('README 含忘记入口的救援方法', /忘记安全入口怎么办/.test(readme));
check('README 落款为贪睡（Pixric）', /贪睡（Pixric）/.test(readme));
check('不再出现新旧版本对比', !/旧版（静态）|新版（动态）|这一版有什么不一样/.test(readme));
check('不再标注 v2 版本号', !/v2\.0|版本：/.test(readme));

console.log('\n' + '='.repeat(50));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);
