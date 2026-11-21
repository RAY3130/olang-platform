# Render 完整功能部署（方案 B）

GitHub 只存代码，Render 运行 Node、SQLite、产品助手和询盘后台。最终链接：

```text
https://<service-name>.onrender.com/en-gb/
```

不是 `github.io`；GitHub Pages 不能运行 Node/SQLite。

---

## 第 1 步：安装 Git 并上传代码

当前电脑没有 Git。打开 PowerShell，执行：

```powershell
winget install --id Git.Git -e --source winget
```

安装完成后关闭 PowerShell，重新打开，确认：

```powershell
git --version
```

然后进入项目目录：

```powershell
cd "C:\Users\53688\Desktop\international finance\智能贸易\olang-intl\platform"
```

初始化并提交：

```powershell
git init
git add .
git commit -m "Initial OLANG website"
git branch -M main
```

连接你刚创建的 GitHub 仓库。你的仓库地址按截图是：

```powershell
git remote add origin https://github.com/RAY3130/-.git
```

> 如果已经在 GitHub 设置里把仓库改名成 `olang-platform`，把地址换成：
> `https://github.com/RAY3130/olang-platform.git`

远端目前只有一个自动生成的 README。首次推送直接覆盖它即可：

```powershell
git push -u origin main --force
```

第一次会弹出 GitHub 登录窗口，按提示在浏览器授权即可。

推送完成后刷新 GitHub 页面，应该能看到：

```text
render.yaml
package.json
server.js
src/
public/
```

而不是只有 README。

---

## 第 2 步：在 Render 部署

1. 打开 https://render.com/
2. 用 GitHub 登录并授权。
3. 点击 **New → Blueprint**。
4. 选择仓库 `RAY3130/-`（或改名后的 `olang-platform`）。
5. Render 读取 `render.yaml`，创建免费 Web Service。
6. 在环境变量提示里设置：
   ```text
   ADMIN_INITIAL_PASSWORD=至少12位的强密码
   ```
7. 点击 **Deploy**。

等待日志出现：

```text
OLANG platform listening on http://0.0.0.0:...
```

部署完成后打开：

```text
https://<service-name>.onrender.com/en-gb/
https://<service-name>.onrender.com/de-de/
https://<service-name>.onrender.com/ja-jp/
```

后台：

```text
https://<service-name>.onrender.com/admin
用户名：admin
密码：你设置的 ADMIN_INITIAL_PASSWORD
```

---

## 免费版的限制

当前 `render.yaml` 使用 `plan: free`，方便先拿到链接、不需要付费磁盘。

- 免费实例长时间无访问会休眠，第一次打开可能要等几十秒
- 重新部署/重启后，SQLite 和上传文件会重置
- 页面、助手、询盘、后台功能都能运行，但数据不长期保留

如果只是给老师/同学打开看，这已经够用。

---

## 升级为持久化（需要付费）

确认网站能打开后，如果询盘和后台数据需要保留：

1. Render → 你的 Service → Settings → Instance Type，升级为 **Starter** 或更高。
2. 添加 Persistent Disk：
   ```text
   Name: olang-data
   Mount Path: /var/data
   Size: 1 GB
   ```
3. 修改环境变量：
   ```dotenv
   DB_PATH=/var/data/olang.sqlite
   UPLOAD_DIR=/var/data/uploads
   ```
4. 重新部署。

或者把 `render.yaml` 改成：

```yaml
plan: starter
# ...
envVars:
  - key: DB_PATH
    value: /var/data/olang.sqlite
  - key: UPLOAD_DIR
    value: /var/data/uploads
disk:
  name: olang-data
  mountPath: /var/data
  sizeGB: 1
```

---

## 常见问题

### 1. `git push` 报 `rejected (fetch first)`

远端 README 和本地提交历史不一致。当前仓库只有 README，可以直接：

```powershell
git push -u origin main --force
```

### 2. Render 显示 `no such file render.yaml`

说明 GitHub 仓库根目录不是 `platform`。检查仓库首页是否直接能看到 `render.yaml`；如果代码在 `platform/` 子目录，Render 的 Root Directory 填 `platform`。

### 3. Render 构建失败

把 Render 的 Build Log 发给我，重点看：

```text
npm ci
node:sqlite
Cannot find module
```

### 4. 页面能开但助手/表单 404

检查日志里是否启动的是 `node server.js`，以及服务是否只有一个实例。

### 5. 服务名被占用

修改 `render.yaml`：

```yaml
name: olang-platform-demo
```

或 Render 创建时改名，链接会随之变化。

### 6. 邮件不发送

默认 `EMAIL_TRANSPORT=outbox`，询盘会入库但不发邮件。需要 SMTP 时在 Render Environment 添加：

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
