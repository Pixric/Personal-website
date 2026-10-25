# Personal-website

> 一个零依赖、自托管个人官网系统，内置管理后台。

Personal-website 是一个用于搭建个人主页的轻量级 Web 应用。它提供前台展示页面与可视化后台管理，
所有内容均可通过浏览器配置，无需修改代码。

系统基于 Node.js 原生模块实现，不依赖任何第三方包，也不需要数据库或对象存储服务。
下载后执行一条命令即可运行。

---

## 特性

### 前台

| 模块 | 说明 |
|---|---|
| 个人信息 | 头像、昵称、副标题、个人简介 |
| 背景 | 支持上传自定义背景图，未上传时使用内置渐变 |
| 音乐播放器 | 右下角悬浮，展示封面、曲名、播放进度环，支持顺序与随机播放 |
| 社交链接 | 顶栏以图标形式展示，侧栏以「图标 + 名称」形式展示 |
| GitHub 集成 | 自动拉取公开仓库列表与贡献热力图 |
| 频道卡片 | 可配置标题、说明文字与跳转链接 |
| 页脚 | 支持自定义文字、跳转链接、颜色与透明度 |

### 后台

| 模块 | 能力 |
|---|---|
| 关于我 | 头像、背景图、站点名称、副标题、正文 |
| 外观与动画 | 5 项动画独立开关、音乐总开关、播放顺序、频道卡片 |
| 音乐管理 | 多文件上传（带进度反馈）、元信息编辑、封面设置、拖拽排序、删除 |
| 社交链接 | 增删改、显隐切换、拖拽排序、内置图标选择、自定义图标上传 |
| GitHub | 用户名配置，项目卡片与贡献图独立开关 |
| 页脚 / 备案 | 文字、链接、颜色、透明度，均带实时预览 |
| 安全与账号 | 安全入口修改、账号密码修改、存储占用查看、数据清空 |

### 技术特性

- **零第三方依赖**：仅使用 Node.js 内置模块
- **单文件存储**：全部数据保存于 `data/db.json`
- **内置认证**：PBKDF2-HMAC-SHA256 加盐哈希，会话基于 HttpOnly Cookie
- **后台隐藏**：非安全入口路径一律返回前台页面，不暴露管理入口
- **响应式布局**：桌面端与移动端均可正常使用

---

## 系统要求

- **Node.js 18 或更高版本**（推荐 20 / 22 / 24）
- 无需 `npm install`
- 无需数据库、缓存或对象存储服务
- 磁盘空间视上传内容而定，建议预留 1 GB 以上

---

## 快速开始

```bash
node server.js
```

启动成功后终端输出：

```
  Personal-website 已启动
  ----------------------------------
  前台:    http://localhost:3000/
  后台:    http://localhost:3000/backstage
  数据:    /path/to/personal-website/data
```

### 初始化

浏览器访问 `http://localhost:3000/backstage`，按向导完成三步配置：

1. **设置安全入口**（不少于 5 位）。该路径将成为后续的后台访问地址，
   例如填写 `mysite2026`，后台地址即为 `https://你的域名/mysite2026`。
2. **创建管理员账号**（账号不少于 3 位，密码不少于 6 位）。
3. 完成后进入登录页面，使用上述凭据登录。

### 修改监听端口

```bash
PORT=8080 node server.js
```

Windows PowerShell：

```powershell
$env:PORT="8080"; node server.js
```

---

## 部署

### systemd 常驻运行

创建 `/etc/systemd/system/personal-website.service`：

```ini
[Unit]
Description=Personal-website
After=network.target

[Service]
Type=simple
User=www
WorkingDirectory=/var/www/personal-website
ExecStart=/usr/bin/node server.js
Environment=PORT=3000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

启用服务：

```bash
systemctl daemon-reload
systemctl enable --now personal-website
journalctl -u personal-website -f
```

### Nginx 反向代理

```nginx
server {
    listen 80;
    server_name me.example.com;

    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_request_buffering off;
    }
}
```

> **注意**：`client_max_body_size` 必须调整。Nginx 默认限制为 1 MB，
> 未修改时音乐上传会失败。

### HTTPS

```bash
certbot --nginx -d me.example.com
```

---

## 配置项

系统通过环境变量配置，均为可选：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址，建议生产环境使用反向代理时设为 `127.0.0.1` |

其余内容配置均在后台界面完成。

---

## 数据与备份

```
data/
├── db.json      内容、账号、系统设置
└── uploads/     上传的头像、背景、音乐与图标
```

备份：

```bash
tar czf backup-$(date +%F).tar.gz data/
```

恢复时将该目录放回原位置并重启服务即可。

`db.json` 为纯文本 JSON，可直接编辑。忘记安全入口时修改 `settings.security_entry` 后重启即可。

### 上传限制

| 项目 | 限制 |
|---|---|
| 单文件大小（音乐） | 100 MB |
| 单文件大小（图片） | 12 MB |
| 音乐数量 | 50 首 |

---

## 常见问题

**需要执行 `npm install` 吗？**
不需要。系统仅使用 Node.js 内置模块。

**需要安装数据库吗？**
不需要。数据以 JSON 格式存储于 `data/db.json`。

**启动报错提示 Node 版本过低？**
请升级至 Node.js 18 或更高版本，可通过 `node -v` 查看当前版本。

**上传音乐失败或卡住？**
通常是 Nginx 的 `client_max_body_size` 未调整，参考「部署」一节的配置。

**音乐没有自动播放？**
受浏览器自动播放策略限制。访问者首次点击页面任意位置后将开始播放。

**忘记安全入口怎么办？**
停止服务，编辑 `data/db.json` 中的 `settings.security_entry`，重启服务。

**账号密码也忘记了怎么办？**
编辑 `data/db.json`，将 `admins` 与 `sessions` 设为空数组 `[]`，
并将 `settings.initialized` 改为 `"0"`。重启后访问 `/backstage` 重新初始化。
已上传的文件不受影响。

**支持上传视频吗？**
不支持。出于安全考虑，上传接口仅接受音频与图片。

**可以同时运行多个实例吗？**
不建议。数据存储于单个 JSON 文件，多进程会互相覆盖。

---

## 安全说明

- **密码存储**：PBKDF2-HMAC-SHA256，随机盐，120,000 次迭代
- **会话**：随机 Token，HttpOnly Cookie，有效期 14 天
- **登录限流**：同一 IP 5 分钟内最多 10 次尝试
- **上传校验**：按扩展名限制文件类型
- **路径安全**：文件读取接口拒绝路径穿越
- **入口隐藏**：非安全入口路径统一返回前台页面

请务必设置足够复杂的安全入口、账号与密码。

---

## 目录结构

```
personal-website/
├── server.js          服务主程序（路由与接口）
├── package.json
├── README.md
├── LICENSE
├── data/              首次运行自动生成
│   ├── db.json
│   └── uploads/
├── src/
│   └── store.js       数据读写
└── public/
    ├── index.html     前台页面
    ├── backstage.html 后台页面
    └── assets/
        ├── style.css
        ├── app.js
        ├── backstage.css
        ├── backstage.js
        └── icons.js   内置图标库
```

---

## 许可协议

本项目基于 [MIT License](LICENSE) 开源。

---

## 反馈

如遇问题或有功能建议，欢迎通过 Telegram 频道联系：

<https://t.me/COASCN>
