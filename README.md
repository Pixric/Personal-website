# 个人官网

一个开箱即用的个人主页系统：自带后台管理、音乐播放器、社交链接、GitHub 展示。

**零依赖** —— 不需要 `npm install`，不需要数据库，不需要对象存储，不需要任何云服务。
解压，运行一条命令，打开后台即可使用。

界面是黑白灰风格，前台和后台都支持手机访问。

---

## 特点

### 前台

- 头像、名字、一句话简介、关于我
- 背景图（可上传，也可用内置渐变）
- 音乐播放器，右下角悬浮，显示封面、歌名、进度环
- 社交链接，顶栏图标 + 侧栏文字
- GitHub 开源项目卡片 + 贡献热力图
- 电报频道卡片
- 页脚，适合放备案号或版权信息

### 后台

- 所有内容可视化修改，保存后前台立刻生效
- 上传头像、背景图、音乐、自定义图标，带实时进度条
- 5 个动画效果独立开关
- 音乐顺序拖动排序，支持默认顺序 / 随机播放
- 20 个内置社交图标，也可以上传自己的
- 链接自动补全协议（填 `x.com/me` 自动变 `https://x.com/me`）
- 密码 PBKDF2 加盐哈希 + 会话管理
- 访客访问域名只看到主页，后台完全隐藏

### 技术

- 纯 Node.js 内置模块，**0 第三方依赖**
- 数据存单个 JSON 文件 + 上传目录，备份就是复制 `data/`
- 密码 PBKDF2-HMAC-SHA256，12 万次迭代
- 响应式，手机可用

---

## 快速开始

需要 **Node.js 18 或以上**（推荐 20 / 22 / 24）。

```bash
node server.js
```

看到这样就成功了：

```
  个人官网已启动
  ----------------------------------
  前台:    http://localhost:3000/
  后台:    http://localhost:3000/backstage
  数据:    /path/to/grwz/data
```

然后浏览器打开 `http://localhost:3000/backstage`，走三步向导：

1. **设置安全入口** —— 至少 5 位，以后就是你的后台地址
2. **注册管理员** —— 账号至少 3 位，密码至少 6 位
3. 看到「一切完成」，4 秒后自动进入登录页

登录进去就能改内容了。

### 换端口

```bash
PORT=8080 node server.js
```

Windows PowerShell：

```powershell
$env:PORT="8080"; node server.js
```

---

## 部署到服务器

### 用 systemd 常驻

`/etc/systemd/system/grwz.service`：

```
[Unit]
Description=Personal Website
After=network.target

[Service]
Type=simple
User=www
WorkingDirectory=/var/www/grwz
ExecStart=/usr/bin/node server.js
Environment=PORT=3000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now grwz
journalctl -u grwz -f
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

`client_max_body_size` 必须调大，否则上传音乐会被 Nginx 拦掉（默认只有 1MB）。

HTTPS 用 certbot：

```bash
certbot --nginx -d me.example.com
```

---

## 后台功能

| 菜单 | 能做什么 |
|---|---|
| 关于我 | 头像、背景图、网站名称、副标题、关于我正文 |
| 外观与动画 | 5 个动画开关、音乐总开关、播放顺序、电报频道 |
| 音乐 | 上传（可多选，带进度条）、改歌名歌手、传封面、拖排序、删除 |
| 社交链接 | 添加 / 编辑 / 隐藏 / 拖排序 / 删除、选内置图标或上传自定义 |
| GitHub | 填用户名，开关项目卡片和贡献图 |
| 页脚 / 备案 | 文字、跳转链接、颜色、透明度（带实时预览） |
| 安全与账号 | 改安全入口、改账号密码、查看占用、清空上传 |

上传限制：单文件最大 100MB，音乐最多 50 首，社交链接建议不超过 5 个（不强制）。

---

## 数据与备份

```
data/
├── db.json      所有内容、账号、设置
└── uploads/     上传的头像、背景图、音乐、图标
```

备份就是打包这个目录：

```bash
tar czf backup-$(date +%F).tar.gz data/
```

`db.json` 是可读的 JSON，忘记安全入口时直接改里面的 `security_entry` 就行。

---

## 常见问题

**Q：需要 `npm install` 吗？**
不需要。项目没有任何第三方依赖，只用 Node 内置模块。

**Q：需要数据库吗？**
不需要。数据存在 `data/db.json`。

**Q：Node 版本报错怎么办？**
需要 18 或以上。`node -v` 确认一下。

**Q：上传音乐失败 / 卡住？**
多半是 Nginx 的 `client_max_body_size` 没调大，见上面的配置。

**Q：音乐不自动播放？**
浏览器策略限制。访客第一次点击页面任意位置就会开始播放。

**Q：忘记安全入口了？**
停服务，编辑 `data/db.json`，把 `settings.security_entry` 改掉，重启。

**Q：连账号密码都忘了？**
在 `db.json` 里把 `admins` 和 `sessions` 改成 `[]`，`settings.initialized` 改成 `"0"`，
重启后访问 `/backstage` 重新初始化。上传的文件不会丢。

**Q：能传视频吗？**
不能，只接受音频和图片。

**Q：能开多个实例吗？**
不建议。数据在单个 JSON 文件里，多进程会互相覆盖。

---

## 安全说明

- 密码：PBKDF2-HMAC-SHA256，随机盐，12 万次迭代
- 会话：随机 token，HttpOnly Cookie，14 天过期
- 限流：登录同一 IP 5 分钟最多 10 次
- 上传校验：按扩展名限制音频 / 图片
- 路径安全：读取文件拒绝 `..`
- 隐蔽性：非安全入口路径一律返回前台页面

自己需要守住的是：安全入口地址、账号、密码。

---

## 目录结构

```
grwz/
├── server.js          服务主程序（HTTP 路由 + 后台接口）
├── package.json
├── README.md
├── LICENSE
├── data/              运行后自动生成
│   ├── db.json
│   └── uploads/
├── src/
│   └── store.js       数据读写
└── public/
    ├── index.html     前台
    ├── backstage.html 后台
    └── assets/
        ├── style.css
        ├── app.js
        ├── backstage.css
        ├── backstage.js
        └── icons.js   内置图标库
```

---

## License

[MIT](LICENSE)

---

## 联系

电报频道：<https://t.me/COASCN>

*加入就是最大的帮助。*
