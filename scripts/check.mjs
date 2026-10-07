/**
 * 部署前自检：确认代码结构完整、能被 Cloudflare 正确构建。
 *
 * 用法（在项目文件夹里执行）：
 *   npm run check
 *
 * 如果你是在网页上手动上传代码的，上传完可以先在 GitHub 网页上
 * 对照本脚本输出的文件清单看一眼，确认没有漏文件。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** 部署真正需要的文件（缺任何一个都会构建失败或功能缺失） */
const REQUIRED = [
  'package.json',
  'wrangler.toml',
  'src/worker.js',
  'src/lib.js',
  'src/migrate.js',
  'src/routes/public.js',
  'src/routes/setup.js',
  'src/routes/admin.js',
  'public/index.html',
  'public/backstage.html',
  'public/assets/style.css',
  'public/assets/app.js',
  'public/assets/backstage.css',
  'public/assets/backstage.js',
  'public/assets/icons.js',
];

/** 可选文件（没有也能跑） */
const OPTIONAL = [
  'README.md',
  'UPLOAD.md',
  'schema.sql',
  'test/migrate.test.mjs',
  'test/requirements.test.mjs',
  'test/flow.test.mjs',
  'test/e2e.test.mjs',
  'test/edge.test.mjs',
];

let pass = 0;
let fail = 0;

function ok(msg) { pass++; console.log('  \u2713 ' + msg); }
function bad(msg, hint) {
  fail++;
  console.log('  \u2717 ' + msg);
  if (hint) console.log('      → ' + hint);
}

async function exists(rel) {
  try {
    const st = await fs.stat(path.join(root, rel));
    return st.isFile();
  } catch {
    return false;
  }
}

async function isDir(rel) {
  try {
    const st = await fs.stat(path.join(root, rel));
    return st.isDirectory();
  } catch {
    return false;
  }
}

console.log('\n=== 部署前自检 ===\n');

/* ---------- 1. 关键文件是否齐全 ---------- */
console.log('[1] 关键文件');

for (const rel of REQUIRED) {
  if (await exists(rel)) ok(rel);
  else bad(rel + ' 缺失', '这个文件必须在，否则 Cloudflare 构建会失败');
}

/* ---------- 2. 关键目录 ---------- */
console.log('\n[2] 关键目录');

for (const dir of ['src', 'src/routes', 'public', 'public/assets']) {
  if (await isDir(dir)) ok(dir + '/');
  else bad(dir + '/ 缺失', '文件夹必须一起上传，不要只上传里面的文件');
}

/* ---------- 3. wrangler.toml 的入口配置 ---------- */
console.log('\n[3] wrangler.toml 配置');

if (await exists('wrangler.toml')) {
  const cfg = await fs.readFile(path.join(root, 'wrangler.toml'), 'utf8');

  const mainMatch = /^\s*main\s*=\s*"([^"]+)"/m.exec(cfg);
  if (!mainMatch) {
    bad('没有配置 main 入口');
  } else {
    const entry = mainMatch[1];
    if (await exists(entry)) ok('main = "' + entry + '" 指向的文件存在');
    else bad('main = "' + entry + '" 指向的文件不存在',
      '这正是构建报 "entry-point file was not found" 的原因');
  }

  if (/^\s*directory\s*=\s*"\.\/public"/m.test(cfg)) ok('静态资源目录指向 ./public');
  else bad('静态资源目录配置异常', '应为 directory = "./public"');

  if (/\[\[d1_databases\]\]/.test(cfg)) ok('已配置 D1 数据库绑定');
  else bad('缺少 D1 绑定', '前台和后台都要用数据库');

  if (/\[\[r2_buckets\]\]/.test(cfg)) {
    console.log('  \u2139 已配置 R2（首次部署可能因存储桶不存在而失败）');
    console.log('      如果报错找不到 bucket，把 wrangler.toml 里')
    console.log('      [[r2_buckets]] 那三行注释掉再试');
  }
} else {
  bad('wrangler.toml 不存在');
}

/* ---------- 4. 源码能否正常加载 ---------- */
console.log('\n[4] 源码可加载性');

try {
  await import(new URL('../src/worker.js', import.meta.url).href);
  ok('src/worker.js 可以被加载（语法正确、依赖完整）');
} catch (err) {
  bad('src/worker.js 加载失败: ' + err.message,
    '通常是缺少依赖文件，或上传时内容被截断');
}

try {
  await import(new URL('../src/migrate.js', import.meta.url).href);
  ok('src/migrate.js 可以被加载');
} catch (err) {
  bad('src/migrate.js 加载失败: ' + err.message);
}

/* ---------- 5. 不该上传的东西 ---------- */
console.log('\n[5] 不该上传的内容');

for (const junk of ['node_modules', '.wrangler', '.git', '.dev.vars']) {
  if (await exists(junk) || await isDir(junk)) {
    console.log('  \u2139 本地存在 ' + junk + '（不要上传到 GitHub）');
  }
}

/* ---------- 6. 可选文件 ---------- */
console.log('\n[6] 可选文件（缺失不影响部署）');
const missingOptional = [];
for (const rel of OPTIONAL) {
  if (!(await exists(rel))) missingOptional.push(rel);
}
if (missingOptional.length === 0) ok('全部齐全');
else console.log('  \u2139 缺少：' + missingOptional.join('、') + '（不影响部署）');

/* ---------- 7. 隐藏文件检查 ---------- */
console.log('\n[7] 隐藏文件检查');
const dotfiles = [];
async function walk(dir, prefix = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (['node_modules', '.wrangler', '.git'].includes(e.name)) continue;
    const rel = prefix ? prefix + '/' + e.name : e.name;
    if (e.name.startsWith('.')) dotfiles.push(rel);
    if (e.isDirectory()) await walk(path.join(dir, e.name), rel);
  }
}
await walk(root);
if (dotfiles.length === 0) ok('没有点开头的隐藏文件（网页上传不会漏）');
else bad('发现隐藏文件：' + dotfiles.join('、'), '网页上传不认这类文件，建议删掉');

/* ---------- 结果 ---------- */
console.log('\n' + '='.repeat(50));
if (fail === 0) {
  console.log('自检通过（' + pass + ' 项）。可以部署了。');
  console.log('');
  console.log('上传到 GitHub 后，请到 GitHub 网页确认这三个文件夹都在：');
  console.log('  src/    public/    （test/ 可选）');
} else {
  console.log('自检发现 ' + fail + ' 个问题，请先修复再部署。');
}
console.log('='.repeat(50) + '\n');

process.exit(fail ? 1 : 0);
