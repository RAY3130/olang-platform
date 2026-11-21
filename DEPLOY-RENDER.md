# Render 完整功能部署（方案 B）

这个方案保留 Express、SQLite、产品助手、询盘和后台。GitHub 只存代码，Render 负责运行；最终链接是：

```text
https://<service-name>.onrender.com/en-gb/
```

不是 `github.io`，因为 GitHub Pages 不能运行 Node 服务。

## 1. 上传代码到 GitHub

项目当前没有安装 Git/gh。最简单的方法是用 **GitHub Desktop**：

1. 安装 GitHub Desktop：<https://desktop.github.com/>
2. 登录 GitHub。
3. `File → Add Local Repository`，选择：
   `C:\Users\53688\Desktop\international finance\智能贸易\olang-intl\platform`
4. 确认 `.env`、`storage/`、`node_modules/` 没有被勾选（`.gitignore` 已经排除）。
5. 点击 **Publish repository**。
   - 名称建议：`olang-platform`
   - 取消勾选 Private（Render 需要能读取；公开仓库最省事）
6. 发布后，仓库根目录应该能看到：
   `render.yaml`、`package.json`、`server.js`、`public/`、`src/`

如果仓库根目录是 `olang-intl` 而不是 `platform`，Render 的 Root Directory 要填 `platform`；本仓库建议直接把 `platform` 作为根目录。

## 2. 在 Render 创建服务

1. 登录 <https://render.com/>，连接 GitHub。
2. 点击 **New → Blueprint**。
3. 选择刚发布的 `olang-platform` 仓库。
4. Render 会读取 `render.yaml`，创建：
   - Node Web Service
   - `/var/data` 持久磁盘（1 GB）
   - `/healthz` 健康检查
5. 在环境变量提示中设置：
   - `ADMIN_INITIAL_PASSWORD`：设置一个强密码，至少 12 位
   - 其他变量已由 `render.yaml` 填好
6. 点击 **Deploy**。

首次部署会：

- 安装生产依赖
- 首次启动时自动建表
- 自动写入演示数据
- 在 `/var/data` 创建 SQLite 数据库和上传目录

## 3. 验证

部署完成后打开：

```text
https://<service-name>.onrender.com/en-gb/
https://<service-name>.onrender.com/de-de/
https://<service-name>.onrender.com/ja-jp/
https://<service-name>.onrender.com/admin
```

管理员账号：

```text
用户名：admin
密码：你在 Render 设置的 ADMIN_INITIAL_PASSWORD
```

产品助手、询价表单和后台都使用同一个 Node 服务，不需要额外配置。

## 4. 邮件（可选）

默认 `EMAIL_TRANSPORT=outbox`：询盘会保存到数据库，但不会真的发邮件。要发邮件，在 Render 的 Environment 中增加：

```dotenv
EMAIL_TRANSPORT=smtp
SMTP_HOST=...
SMTP_PORT=587
SMTP_SECURE=0
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM=OLANG Website <no-reply@your-domain.com>
INQUIRY_NOTIFICATION_EMAIL=you@your-domain.com
INQUIRY_REPLY_TO=you@your-domain.com
```

## 5. 自定义域名（可选）

Render → Service → Settings → Custom Domains，添加域名并按提示配置 DNS；然后在 Environment 中设置：

```dotenv
SITE_URL=https://你的域名
```

不设置也可以：代码会使用 Render 自动注入的 `RENDER_EXTERNAL_URL` 作为 canonical 地址。

## 6. 重要限制

- **只运行 1 个实例**：SQLite 不适合多实例同时写。
- **持久磁盘是付费能力**：免费 Web Service 没有持久磁盘，重启/重新部署会丢 SQLite 和上传文件。
- 数据库和上传文件在 Render 磁盘 `/var/data`；需要定期用 Render Shell 执行：
  ```bash
  npm run backup:full
  ```
  并把 `storage/backups/` 下载保存。
- 如果服务名 `olang-platform` 已被占用，Render 会让你改名；`render.yaml` 中的 `name` 也可以改。
- 如果不想用 GitHub，仍可以用 Render 的 Docker 部署，但同样需要一个 Git 仓库或镜像仓库。
