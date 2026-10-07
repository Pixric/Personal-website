# 网页上传指南（不用命令行）

如果你不打算用命令行，而是想把代码直接传到 GitHub 网页上，
看这份说明就行。整个过程在手机浏览器里就能完成。

---

## 怎么上传

1. 在 GitHub 上新建一个仓库（比如叫 `grwz`），**不要**勾选 "Add a README file"
2. 进入这个空仓库，点 **uploading an existing file**（或 **Add file → Upload files**）
3. 把本文件夹里的**所有内容**拖进去，或者点 "choose your files" 选择
4. 在页面下方填一句提交信息，点 **Commit changes**

这样代码就上传好了。

---

## 上传时要注意的三件事

### 1. 目录结构不能变

GitHub 网页上传要保留文件夹层级。请确保上传后的结构是这样的：

```
你的仓库/
├── README.md
├── UPLOAD.md          ← 本文件
├── package.json
├── schema.sql
├── wrangler.toml
├── scripts/
│   └── check.mjs
├── src/
│   ├── worker.js
│   ├── lib.js
│   ├── migrate.js
│   └── routes/
│       ├── public.js
│       ├── setup.js
│       └── admin.js
├── public/
│   ├── index.html
│   ├── backstage.html
│   └── assets/
│       ├── style.css
│       ├── app.js
│       ├── backstage.css
│       ├── backstage.js
│       └── icons.js
└── test/              ← 可以整包不上传
    ├── migrate.test.mjs
    ├── requirements.test.mjs
    ├── flow.test.mjs
    ├── e2e.test.mjs
    └── edge.test.mjs
```

**重点**：`scripts/`、`src/`、`public/`、`test/` 是文件夹，
必须先拖文件夹，不要只拖里面的文件——否则路径会错，Cloudflare 会构建失败。

### 传完一定要检查这一步

GitHub 网页上传文件夹时，**嵌套的子目录经常会被漏掉**，
而 Cloudflare 报出来的错误很难懂，比如：

```
✘ [ERROR] The entry-point file at "src/worker.js" was not found.
```

看到这个错误，八成就是 `src/` 没传上去。

所以传完之后，**回到你仓库的首页刷新**，逐个点进去确认：

- [ ] `src/` 里面有 `worker.js`、`lib.js`、`migrate.js`
- [ ] `src/` 里还有一个 **`routes/` 文件夹**（点进去应有 3 个文件）
- [ ] `public/` 里面有 `index.html`、`backstage.html`
- [ ] `public/` 里还有一个 **`assets/` 文件夹**（点进去应有 5 个文件）

任何一条不满足，就重新传那个文件夹。

### 2. `test/` 文件夹可以不上传

那里面是自动化测试，只在你本地开发时用得上，
部署到 Cloudflare 完全不需要。嫌麻烦的话跳过它，
或者整个删掉都不影响网站运行。

### 3. 传之前可以先自检一下

在项目文件夹里执行（需要电脑上有 Node.js）：

```bash
npm run check
```

它会逐个检查部署需要的 15 个文件、4 个文件夹是否齐全，
并且验证 `wrangler.toml` 的入口指向是否正确。
缺什么会直接告诉你，比部署失败后再猜省事得多。

### 4. 不要上传这些（如果有的话）

- `node_modules/` —— 依赖文件夹，几百 MB，网上重新装就行
- `.wrangler/` —— 本地缓存
- `.dev.vars` —— 你自己的密钥，**绝对不能传**

---

## 如果你用命令行

那就简单多了，在项目文件夹里执行：

```bash
git init
git add .
git commit -m "个人官网"
git branch -M main
git remote add origin https://github.com/你的用户名/grwz.git
git push -u origin main
```

用命令行的话，建议在项目根目录建一个 `.gitignore` 文件，内容如下，
这样上面第 3 条列的东西就不会被误传：

```
node_modules/
.wrangler/
.dev.vars
.DS_Store
Thumbs.db
*.log
```

> 注意：`.gitignore` 是以点开头的隐藏文件，
> **只能通过命令行创建**——GitHub 网页上传不认这类文件。
> 这也是为什么它没有随项目一起提供。

---

## 上传完成后

回到 [README.md](README.md) 的第三节，继续连接 Cloudflare 部署。
