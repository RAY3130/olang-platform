# 给 DEEPSEEKHARNESS 的部署执行提示词（自包含 · 可直接粘贴）

> 把下面分隔线以内的全部内容，一次性发给具备「终端执行 + 文件读写」能力的 Agent。
> Agent 会自己判断缺什么、自己跑完 GitHub 建仓 → 推送 → Render 建服务 → 部署 → 验证。
> 你唯一需要做的，是在它索要令牌时花 3 分钟创建两个令牌（其余全自动）。

---

## 你的任务

在仓库 `olang-intl/platform`（Node/Express + SQLite）上，独立完成一次**可复现的线上部署**，最终交付一个可访问的 HTTPS 站点，并给出证据。

执行顺序固定为：**本地检查 → 建 GitHub 仓库 → 推送 → 建 Render 服务 → 部署 → 冒烟验证 → 出报告**。不要跳步，不要凭想象填写结果。

## 工作目录与已知事实（不要重新猜）

- 应用根目录：`C:\Users\53688\Desktop\international finance\智能贸易\olang-intl\platform`
  （`platform/` 就是仓库根目录，`render.yaml`、`package.json`、`server.js` 都在这一层）
- 启动方式：`node server.js`，监听 `process.env.PORT`，健康检查 `GET /healthz`
- 构建：`npm ci --omit=dev`（`package-lock.json` 已存在，不要改成 `npm install`）
- 运行环境：Node 22（`package.json` 要求 `>=22.13`）
- 数据：SQLite，路径由 `DB_PATH` 决定；生产建议挂持久磁盘到 `/var/data`
- 本机可用工具：`git`、`curl`、`python3`、`node`；**没有 `gh`，没有 `jq`**，不要调用它们
- 本机**没有**配置 git 全局身份，脚本会自动写入仓库级 `user.name/user.email`
- 上级目录 `olang-intl/` 有 2.3GB 素材，**绝不能整体推送**；只推 `platform/`
- `public/` 有约 2000 个文件、137MB，单个文件均小于 40MB，可正常推送

## 硬性约束（违反即失败）

1. **不得**尝试用浏览器登录 GitHub 或 Render 账号，也不得索取账号密码。账号授权只能通过令牌完成。
2. **不得**把令牌写进任何被 git 跟踪的文件、提交信息、远程 URL 或报告。令牌只能存在于 `deploy/.deploy.env`（已 ignore）。
3. **不得** `git push --force`，不得 `git reset --hard`，不得删除用户文件。
4. **不得**伪造部署结果。没拿到 `live` 状态、没拿到 HTTP 200，就必须写“失败”并附原始报错。
5. **不得**把 Render 免费实例描述成“生产可用”。free 计划会休眠、数据不持久，必须如实说明。
6. **不得**修改业务代码来“绕过”部署错误；如需改配置（如 `NODE_VERSION`），只改环境变量并在报告中说明。
7. **不得**编造访问量、排名、询盘数等数据。本次只验证“站点可访问、核心功能正常”。
8. 单次任务内**最多重试 3 轮**；仍失败就停止并输出诊断，不要无限循环。

## 执行步骤

### 第 0 步：判断凭据是否就绪

依次检查两处（脚本会自动合并，项目级覆盖用户级）：

1. **用户级长期凭据**：`C:\Users\53688\.workbuddy\deploy\credentials.env`
2. 项目级覆盖：`platform/deploy/.deploy.env`

只要 `GH_TOKEN` 有值即可继续；`RENDER_API_KEY` 仅在首次创建 Render 服务时需要（已有服务 push 即自动部署）。

- **若两处都没有**：不要继续，不要自己想办法。向用户输出下面这段（原样，不要改写），然后结束本轮：

  > 长期权限已经配置好了，只差把令牌填进用户级凭据文件：
  > `C:\Users\53688\.workbuddy\deploy\credentials.env`
  > 1) GitHub 令牌：https://github.com/settings/personal-access-tokens/new → Resource owner 选自己 → Repository access 选 **All repositories** → 权限勾 Contents RW、**Administration RW**、Workflows RW → 生成 `github_pat_...`
  > 2) Render Key（仅新建服务需要）：https://dashboard.render.com/u/settings#api-keys → 复制 `rnd_...`
  > 填好后回我一句"继续"，我会自动完成建仓、推送、部署和验证。这份凭据今后所有项目共用，不用再配第二次。

- **若有值**：继续第 1 步。**不要再输出"我无法登录 GitHub/Render"这类话**，也不要再索要授权。

### 第 1 步：本地预检（不联网）

```bash
cd "C:/Users/53688/Desktop/international finance/智能贸易/olang-intl/platform"
bash deploy/auto_deploy.sh --check
```

要求：输出包含“前置条件齐备”。若提示有大文件超过 50MB，先报告文件名并停止（GitHub 单文件上限 100MB）。

### 第 2 步：执行全自动部署

```bash
bash deploy/auto_deploy.sh
```

这条命令会依次完成：校验令牌 → `git init/add/commit` → 建 GitHub 仓库 → 推送 → 建 Render 服务 → 挂磁盘（付费计划）→ 触发部署 → 每 10 秒轮询状态 → 8 项冒烟验证 → 写报告。

- 首次推送约 137MB，耗时可能 2–5 分钟；Render 首次构建约 3–8 分钟。**不要因为“没输出”就中断**，命令本身会打印进度。
- 若终端有超时限制，用后台方式运行并轮询日志：`bash deploy/auto_deploy.sh > /dev/null 2>&1 &`，然后读 `deploy/deploy.log`。

### 第 3 步：读取结果

```bash
cat deploy/report.json
tail -40 deploy/deploy.log
```

`report.json` 关键字段：`url`、`deploy_status`、`plan`、`persistence`、`checks[]`、`passed`、`failed`。
管理员密码在 `deploy/.admin-credentials.local.txt`（**不要打印到聊天里**，只告诉用户文件位置）。

### 第 4 步：独立复核（不要只信脚本）

自己再发 3 个请求确认，并把原始响应片段贴进报告：

```bash
curl -s -o /dev/null -w "healthz %{http_code}\n" https://<你的域名>/healthz
curl -s https://<你的域名>/en-gb/ | grep -o 'rel="canonical"[^>]*'
curl -s -X POST https://<你的域名>/api/assistant -H 'Content-Type: application/json' \
  -d '{"question":"What material is OL-1204?","market":"en-GB"}' | head -c 300
```

通过标准：`healthz` 为 200；`canonical` 指向 `https://<域名>` 而不是 `127.0.0.1`；助手返回 `sources` 数组。

### 第 5 步：输出报告（严格按此结构，不超过 40 行）

```
## 部署结果
状态：成功 / 部分成功 / 失败
站点：https://xxx.onrender.com
仓库：https://github.com/<owner>/<repo>
服务 ID：srv-xxx ｜ 部署 ID：dep-xxx ｜ 计划：free/starter

## 验证证据
| 检查项 | 结果 | 证据 |
|---|---|---|
| /healthz | 200 | ... |
| /en-gb/ /de-de/ /ja-jp/ | 200 | ... |
| /admin 登录页 | 200 | ... |
| canonical 指向线上域名 | 通过 | rel="canonical" href="..." |
| 产品助手返回来源 | 通过 | sources 数组长度 |
| 询盘表单含 CSRF | 通过 | ... |

## 管理员账号
用户名：admin ｜ 密码：见 deploy/.admin-credentials.local.txt（未在对话中显示）

## 已知限制（必须写）
- free 计划：闲置 15 分钟休眠，首次访问需 30–60 秒冷启动
- free 计划无持久磁盘：重新部署会重置 SQLite 与上传文件
- 本站为演示/评审用途，未接入真实支付与真实邮件通道（EMAIL_TRANSPORT=outbox）

## 失败项与下一步
（无失败则写“无”）
```

## 失败处置表

| 现象 | 原因 | 你的动作 |
|---|---|---|
| GitHub 401 | 令牌错误或过期 | 让用户重新生成，不要重试旧值 |
| GitHub 403 / 404 建仓 | 令牌缺 `repo` 权限 | 说明需要勾选 `repo`，给出重新生成步骤 |
| 创建仓库 422 | 同名仓库已存在但不可访问 | 改 `REPO_NAME`（加后缀）后重跑，不要删用户仓库 |
| 推送被拒（non-fast-forward） | 远端已有其他提交 | **停止**，报告远端地址，等用户确认；不要 force push |
| Render 402 | 未绑支付方式且计划为 starter | 自动降级 free 已内置；若仍报错，把 `RENDER_PLAN=free` 写进 `.deploy.env` 重跑 |
| Render 400/409 建服务 | 服务名被占用 | 脚本会自动加后缀重试；两次仍失败则改 `SERVICE_NAME` |
| Render 404 拉不到仓库 | 仓库私有，或 Render 工作区未安装 GitHub App | 先把 `REPO_VISIBILITY` 改为 `public` 重跑；仍失败则需在 Render 后台安装一次 GitHub App（这是唯一可能需要的点击操作，装好后可永久自动） |
| `build_failed` 且日志含 `npm ci` | lock 文件与 package.json 不一致 | 报告具体报错行，**不要**擅自改 lock，交用户决定 |
| `build_failed` 且日志含 `NODE_VERSION` | Node 版本不可用 | 把环境变量 `NODE_VERSION` 改为 `22`（脚本默认已是 22） |
| `build_failed` 且日志含 `no open ports` | 未监听 `process.env.PORT` | 报告此事实；当前 `server.js` 已正确读取，若出现说明代码被改动 |
| 部署 `live` 但 /healthz 503 | free 实例冷启动 | 等待 60–90 秒重试，最多 3 次，不要立即判失败 |
| 所有页面 200 但 canonical 是本机地址 | `SITE_URL` 未生效 | 在 Render 环境变量补 `SITE_URL=https://<域名>` 并重新部署 |

## 完成判定

同时满足才算成功：`deploy_status=live`、`/healthz`=200、三个语言首页均 200、`/admin` 200、canonical 指向线上域名、`report.json` 已生成。
任一项不满足，按上表处置或如实报告失败，不要用“应该可以了”这种表述收尾。
