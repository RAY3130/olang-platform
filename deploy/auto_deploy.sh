#!/usr/bin/env bash
# =============================================================================
# OLANG platform — 全自动部署脚本
#   GitHub 建仓 -> 推送代码 -> Render 建服务 -> 挂磁盘 -> 部署 -> 冒烟验证
#
# 依赖：git / curl / python3（Windows 请在 Git Bash 中运行）
# 用法：
#   bash deploy/auto_deploy.sh              # 完整执行（需要凭据）
#   bash deploy/auto_deploy.sh --check      # 只做本地检查，不联网、不改动仓库
#   bash deploy/auto_deploy.sh --env-file deploy/.deploy.env
#
# 退出码：0 成功 / 2 凭据或前置条件缺失 / 3 构建或部署失败 / 4 冒烟验证未全通过
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR" || exit 2

LOG_FILE="$SCRIPT_DIR/deploy.log"
: > "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

step() { printf '\n=== %s ===\n' "$*"; }
info() { printf '  - %s\n' "$*"; }
ok()   { printf '  [OK]   %s\n' "$*"; }
warn() { printf '  [WARN] %s\n' "$*"; }
die()  { printf '\n[FAIL] %s\n' "$*"; exit "${2:-2}"; }

MODE="deploy"
ENV_FILE="$SCRIPT_DIR/.deploy.env"
CHECKS="$SCRIPT_DIR/.checks.tsv"

while [ $# -gt 0 ]; do
  case "$1" in
    --check)    MODE="check"; shift ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    -h|--help)  sed -n '2,14p' "$0"; exit 0 ;;
    *)          die "未知参数：$1" ;;
  esac
done

# ---------------------------------------------------------------- 读取配置
load_env() {
  local f="$1" line k v
  [ -f "$f" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in ''|\#*) continue ;; esac
    case "$line" in *=*) ;; *) continue ;; esac
    k="${line%%=*}"; v="${line#*=}"
    k="$(printf '%s' "$k" | tr -d '[:space:]')"
    case "$v" in \"*\") v="${v%\"}"; v="${v#\"}" ;; \'*\') v="${v%\'}"; v="${v#\'}" ;; esac
    [ -n "$k" ] && export "$k=$v"
  done < "$f"
}

load_env_soft() { # 只补空变量：用户级长期凭据作为回退，不覆盖项目级配置
  local f="$1" line k v current
  [ -f "$f" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in *=*) ;; *) continue ;; esac
    k="${line%%=*}"; v="${line#*=}"
    k="$(printf '%s' "$k" | tr -d '[:space:]')"
    case "$k" in [A-Za-z_][A-Za-z0-9_]*) ;; *) continue ;; esac
    case "$v" in \"*\") v="${v%\"}"; v="${v#\"}" ;; \'*\') v="${v%\'}"; v="${v#\'}" ;; esac
    current="$(printenv "$k" 2>/dev/null || true)"
    [ -z "$current" ] && export "$k=$v"
  done < "$f"
}
load_env "$ENV_FILE"

# 回退到用户级长期凭据：一次配置，今后所有项目共用
USER_CRED="${HOME:-/c/Users/53688}/.workbuddy/deploy/credentials.env"
[ -f "$USER_CRED" ] || USER_CRED="/c/Users/53688/.workbuddy/deploy/credentials.env"
USER_CRED_USED=""
if [ -f "$USER_CRED" ]; then
  load_env_soft "$USER_CRED"
  USER_CRED_USED="$USER_CRED"
fi

GH_TOKEN="${GH_TOKEN:-}"
RENDER_API_KEY="${RENDER_API_KEY:-}"
REPO_NAME="${REPO_NAME:-olang-platform}"
SERVICE_NAME="${SERVICE_NAME:-olang-platform}"
BRANCH="${BRANCH:-main}"
RENDER_PLAN="${RENDER_PLAN:-free}"
RENDER_REGION="${RENDER_REGION:-singapore}"
REPO_VISIBILITY="${REPO_VISIBILITY:-public}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

GH_API="https://api.github.com"
RENDER_API="https://api.render.com/v1"

# ---------------------------------------------------------------- 基础工具
http() { # http METHOD URL AUTH [JSON_BODY] -> HTTP_CODE / HTTP_BODY
  local method="$1" url="$2" auth="$3" body="${4:-}" out code
  out="$(mktemp)"
  if [ -n "$body" ]; then
    code=$(curl -sS -m 90 -o "$out" -w '%{http_code}' -X "$method" "$url" \
      -H "Authorization: $auth" -H 'Accept: application/json' \
      -H 'Content-Type: application/json' -H 'User-Agent: olang-deploy' \
      -d "$body" 2>/dev/null) || code=000
  else
    code=$(curl -sS -m 90 -o "$out" -w '%{http_code}' -X "$method" "$url" \
      -H "Authorization: $auth" -H 'Accept: application/json' \
      -H 'User-Agent: olang-deploy' 2>/dev/null) || code=000
  fi
  HTTP_CODE="$code"
  HTTP_BODY="$(cat "$out")"
  rm -f "$out"
}

jget() { # jget dotted.path < json
  python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(1)
for p in sys.argv[1].split("."):
    if p == "": continue
    if isinstance(d, list):
        try: d = d[int(p)]
        except Exception: sys.exit(1)
    elif isinstance(d, dict):
        d = d.get(p)
    else:
        sys.exit(1)
    if d is None: sys.exit(1)
print(d if not isinstance(d,(dict,list)) else json.dumps(d))
' "$1"
}

add_check() { printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$CHECKS"; }

# ---------------------------------------------------------------- 1 预检
step "1/7 预检"
[ -n "$USER_CRED_USED" ] && info "长期凭据：$USER_CRED_USED（项目文件可留空）"
for t in git curl python3; do
  command -v "$t" >/dev/null 2>&1 || die "缺少命令：$t"
  ok "$t 可用"
done
info "应用目录：$APP_DIR"
info "配置文件：$ENV_FILE（$( [ -f "$ENV_FILE" ] && echo 存在 || echo 不存在 )）"

if [ "$MODE" = "check" ]; then
  step "本地检查（不联网）"
  [ -f "$APP_DIR/.gitignore" ] || die "缺少 .gitignore，拒绝继续"
  for pat in 'node_modules/' '\.env' 'storage/'; do
    grep -qE "$pat" "$APP_DIR/.gitignore" || warn ".gitignore 可能缺少规则：$pat"
  done
  BIG="$(find "$APP_DIR" -path "$APP_DIR/node_modules" -prune -o -path "$APP_DIR/.git" -prune -o -type f -size +50M -print 2>/dev/null | head -5)"
  if [ -n "$BIG" ]; then
    warn "存在大于 50MB 的文件（GitHub 单文件上限 100MB）："
    printf '         %s\n' $BIG
  else
    ok "无超过 50MB 的文件"
  fi
  if [ -d "$APP_DIR/.git" ]; then
    info "已跟踪文件：$(git -C "$APP_DIR" ls-files | wc -l) 个；待提交变更：$(git -C "$APP_DIR" status --porcelain | wc -l) 项"
    info ".git 体积：$(du -sh "$APP_DIR/.git" 2>/dev/null | cut -f1)"
  else
    FILES="$(find "$APP_DIR" -path "$APP_DIR/node_modules" -prune -o -type f -print 2>/dev/null | wc -l)"
    info "尚未初始化 git；预计提交约 ${FILES} 个文件（不含 node_modules）"
  fi
  if [ -z "$GH_TOKEN" ] || [ -z "$RENDER_API_KEY" ]; then
    warn "缺少 GH_TOKEN 或 RENDER_API_KEY —— 仅能执行本地检查"
    printf '\n结论：本地检查完成，尚不可自动部署。补齐凭据后再运行：bash deploy/auto_deploy.sh\n'
    exit 0
  fi
  ok "凭据已填写（未校验有效性，正式运行时会验证）"
  printf '\n结论：前置条件齐备，可以执行 bash deploy/auto_deploy.sh\n'
  exit 0
fi

if [ -z "$GH_TOKEN" ]; then
  cat <<'MSG'

[需要你的账号授权] 缺少 GH_TOKEN。
AI 不能替你登录 GitHub，但拿到令牌后其余步骤可以全自动完成。

  1. 打开 https://github.com/settings/tokens/new
  2. Note 填 "olang-deploy"，Expiration 选 30 days
  3. 勾选 repo（整块）与 workflow（可选）
  4. 生成后复制 ghp_ 开头的字符串，写入 deploy/.deploy.env 的 GH_TOKEN=

MSG
  die "缺少 GH_TOKEN"
fi

if [ -z "$RENDER_API_KEY" ]; then
  cat <<'MSG'

[需要你的账号授权] 缺少 RENDER_API_KEY。
AI 不能替你登录 Render，但拿到 API Key 后建服务、挂磁盘、部署都能全自动完成。

  1. 打开 https://dashboard.render.com/u/settings#api-keys
  2. 点击 Create API Key，名称填 "olang-deploy"
  3. 复制 rnd_ 开头的字符串，写入 deploy/.deploy.env 的 RENDER_API_KEY=

MSG
  die "缺少 RENDER_API_KEY"
fi

# ---------------------------------------------------------------- 2 校验凭据
step "2/7 校验凭据"
http GET "$GH_API/user" "Bearer $GH_TOKEN"
[ "$HTTP_CODE" = "200" ] || die "GitHub 令牌无效（HTTP $HTTP_CODE）：$HTTP_BODY"
GH_OWNER="$(printf '%s' "$HTTP_BODY" | jget login)" || die "无法读取 GitHub 用户名"
ok "GitHub 账号：$GH_OWNER"

http GET "$RENDER_API/owners?limit=1" "Bearer $RENDER_API_KEY"
[ "$HTTP_CODE" = "200" ] || die "Render API Key 无效（HTTP $HTTP_CODE）：$HTTP_BODY"
RENDER_OWNER="$(printf '%s' "$HTTP_BODY" | jget 0.owner.id)" || die "无法读取 Render 工作区 ID"
ok "Render 工作区：$RENDER_OWNER"

# ---------------------------------------------------------------- 3 仓库准备
step "3/7 仓库准备"
if [ ! -d "$APP_DIR/.git" ]; then
  git init -q -b "$BRANCH" "$APP_DIR" || die "git init 失败"
  ok "已初始化本地仓库（分支 $BRANCH）"
fi
git config core.autocrlf false
git config core.longpaths true
git config core.quotepath false
[ -n "$(git config user.name || true)" ]  || git config user.name "OLANG Deploy Bot"
[ -n "$(git config user.email || true)" ] || git config user.email "deploy-bot@users.noreply.github.com"

git check-ignore -q .env || die ".env 未被忽略，停止以防泄漏配置"
git check-ignore -q node_modules || die "node_modules 未被忽略，停止以防提交依赖"
ok "忽略规则有效（.env / node_modules 均被排除）"

git add -A
if git diff --cached --quiet; then
  info "没有新的改动需要提交"
else
  git commit -q -m "chore: deploy snapshot $(date '+%Y-%m-%d %H:%M')" || die "git commit 失败"
  ok "已提交 $(git diff-tree --no-commit-id --name-only -r HEAD | wc -l) 个文件"
fi
git branch -M "$BRANCH" 2>/dev/null || true

if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  die ".env 已被纳入版本控制，请执行 git rm --cached .env 后重试"
fi
TRACKED_COUNT="$(git ls-files | wc -l)"
GIT_SIZE="$(du -sh .git 2>/dev/null | cut -f1)"
info "已跟踪文件数：$TRACKED_COUNT，.git 体积：${GIT_SIZE:-未知}"

# ---------------------------------------------------------------- 4 GitHub 建仓
step "4/7 GitHub 建仓"
http GET "$GH_API/repos/$GH_OWNER/$REPO_NAME" "Bearer $GH_TOKEN"
if [ "$HTTP_CODE" = "200" ]; then
  ok "仓库已存在，复用：https://github.com/$GH_OWNER/$REPO_NAME"
elif [ "$HTTP_CODE" = "404" ]; then
  BODY="$(python3 -c 'import json,sys; print(json.dumps({"name":sys.argv[1],"private":sys.argv[2]=="private","description":"OLANG international B2B platform (deploy snapshot)","has_issues":False,"has_wiki":False,"auto_init":False}))' "$REPO_NAME" "$REPO_VISIBILITY")"
  http POST "$GH_API/user/repos" "Bearer $GH_TOKEN" "$BODY"
  case "$HTTP_CODE" in
    201) ok "已创建仓库：https://github.com/$GH_OWNER/$REPO_NAME" ;;
    422) die "仓库名冲突或参数被拒（HTTP 422）：$HTTP_BODY" ;;
    *)   die "创建仓库失败（HTTP $HTTP_CODE）：$HTTP_BODY" ;;
  esac
else
  die "查询仓库失败（HTTP $HTTP_CODE）：$HTTP_BODY"
fi

git remote remove origin >/dev/null 2>&1 || true
git remote add origin "https://github.com/${GH_OWNER}/${REPO_NAME}.git"
# 用一次性 HTTP 头携带凭据，避免令牌出现在远程 URL、.git/config 或推送日志中
AUTH_B64="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\r\n')"
if ! git -c http.extraHeader="Authorization: Basic $AUTH_B64" -c credential.helper= push -u origin "$BRANCH"; then
  unset AUTH_B64
  die "推送失败。若远端已有其他提交，请人工确认后处理（脚本不会强制覆盖）"
fi
unset AUTH_B64
ok "代码已推送（令牌未写入仓库配置）"

# 确认远端可读，再交给 Render 拉取
for _ in 1 2 3 4 5; do
  http GET "$GH_API/repos/$GH_OWNER/$REPO_NAME/commits/$BRANCH" "Bearer $GH_TOKEN"
  [ "$HTTP_CODE" = "200" ] && break
  sleep 3
done
COMMIT_SHA="$(printf '%s' "$HTTP_BODY" | jget sha 2>/dev/null || echo unknown)"
ok "远端最新提交：${COMMIT_SHA:0:10}"

# ---------------------------------------------------------------- 5 Render 建服务
step "5/7 Render 建服务"
REPO_HTML_URL="https://github.com/$GH_OWNER/$REPO_NAME"
SITE_URL="https://${SERVICE_NAME}.onrender.com"

render_json() { # $1=service|env
  python3 - "$1" "$SERVICE_NAME" "$RENDER_OWNER" "$REPO_HTML_URL" "$BRANCH" \
    "$RENDER_PLAN" "$RENDER_REGION" "$ADMIN_USERNAME" "$ADMIN_PASSWORD" "$SITE_URL" <<'PY'
import json, sys
mode, name, owner, repo, branch, plan, region, admin_user, admin_pwd, site = sys.argv[1:11]
data_dir = "/tmp/data" if plan == "free" else "/var/data"
env = [
    {"key": "NODE_VERSION", "value": "24"},
    {"key": "NODE_ENV", "value": "production"},
    {"key": "HOST", "value": "0.0.0.0"},
    {"key": "SITE_MODE", "value": "production"},
    {"key": "SITE_URL", "value": site},
    {"key": "ALLOW_SEARCH_INDEXING", "value": "1"},
    {"key": "DB_PATH", "value": data_dir + "/olang.sqlite"},
    {"key": "UPLOAD_DIR", "value": data_dir + "/uploads"},
    {"key": "TRUST_PROXY", "value": "1"},
    {"key": "SESSION_COOKIE_SECURE", "value": "1"},
    {"key": "EMAIL_TRANSPORT", "value": "outbox"},
    {"key": "ADMIN_INITIAL_USERNAME", "value": admin_user},
    {"key": "ADMIN_INITIAL_PASSWORD", "value": admin_pwd},
]
if mode == "env":
    print(json.dumps(env))
else:
    print(json.dumps({
        "type": "web_service",
        "name": name,
        "ownerId": owner,
        "repo": repo,
        "branch": branch,
        "autoDeployTrigger": "commit",
        "rootDir": "",
        "serviceDetails": {
            "env": "node",
            "plan": plan,
            "region": region,
            "envSpecificDetails": {
                "buildCommand": "npm ci --omit=dev",
                "startCommand": "node server.js",
            },
            "healthCheckPath": "/healthz",
            "numInstances": 1,
            "envVars": env,
        },
    }))
PY
}

if [ -z "$ADMIN_PASSWORD" ]; then
  ADMIN_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(15))')"
  info "已生成管理员密码（保存在 deploy/.admin-credentials.local.txt）"
fi

SERVICE_ID=""
CREATED_NEW=0
http GET "$RENDER_API/services?name=$SERVICE_NAME&limit=50" "Bearer $RENDER_API_KEY"
if [ "$HTTP_CODE" = "200" ]; then
  SERVICE_ID="$(printf '%s' "$HTTP_BODY" | python3 -c '
import json,sys
try: arr=json.load(sys.stdin)
except Exception: sys.exit(0)
for item in arr:
    s=item.get("service",item)
    if s.get("name")==sys.argv[1]:
        print(s.get("id","")); break
' "$SERVICE_NAME" 2>/dev/null)"
fi

if [ -n "$SERVICE_ID" ]; then
  ok "服务已存在，复用：$SERVICE_ID"
else
  ATTEMPT=0
  while :; do
    ATTEMPT=$((ATTEMPT + 1))
    http POST "$RENDER_API/services" "Bearer $RENDER_API_KEY" "$(render_json service)"
    if [ "$HTTP_CODE" = "201" ]; then
      SERVICE_ID="$(printf '%s' "$HTTP_BODY" | jget service.id)"
      CREATED_NEW=1
      ok "已创建服务：$SERVICE_ID（plan=$RENDER_PLAN, region=$RENDER_REGION）"
      break
    fi
    if [ "$HTTP_CODE" = "402" ] && [ "$RENDER_PLAN" != "free" ]; then
      warn "该账号未绑定支付方式，自动降级为 free 计划（无持久磁盘）"
      RENDER_PLAN="free"
      continue
    fi
    if [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "409" ]; then
      if [ "$ATTEMPT" -lt 3 ]; then
        SERVICE_NAME="${SERVICE_NAME}-$ATTEMPT"
        SITE_URL="https://${SERVICE_NAME}.onrender.com"
        warn "服务名被占用，改用：$SERVICE_NAME"
        continue
      fi
    fi
    die "创建服务失败（HTTP $HTTP_CODE）：$HTTP_BODY"
  done
fi

http GET "$RENDER_API/services/$SERVICE_ID" "Bearer $RENDER_API_KEY"
[ "$HTTP_CODE" = "200" ] || die "读取服务信息失败（HTTP $HTTP_CODE）"
SLUG="$(printf '%s' "$HTTP_BODY" | jget service.slug 2>/dev/null || true)"
ACTUAL_URL="$(printf '%s' "$HTTP_BODY" | jget service.serviceDetails.url 2>/dev/null || true)"
[ -n "$ACTUAL_URL" ] || ACTUAL_URL="https://${SLUG:-$SERVICE_NAME}.onrender.com"
BASE_URL="${ACTUAL_URL%/}"
ok "站点地址：$BASE_URL"

if [ "$BASE_URL" != "$SITE_URL" ]; then
  if [ "$CREATED_NEW" = "1" ]; then
    info "实际地址与预测不同，回写 SITE_URL 环境变量"
    http PUT "$RENDER_API/services/$SERVICE_ID/env-vars" "Bearer $RENDER_API_KEY" "$(render_json env)"
    [ "$HTTP_CODE" = "200" ] && ok "SITE_URL 已更新" || warn "SITE_URL 更新失败（HTTP $HTTP_CODE），将回退使用 RENDER_EXTERNAL_URL"
  else
    warn "复用了已有服务，跳过环境变量改写（避免覆盖你已配置的 SMTP 等变量）"
    warn "如 canonical 地址不对，请在 Render Dashboard 手动设置 SITE_URL=$BASE_URL"
  fi
fi

if [ "$RENDER_PLAN" != "free" ]; then
  http GET "$RENDER_API/disks?serviceId=$SERVICE_ID&limit=10" "Bearer $RENDER_API_KEY"
  DISK_COUNT="$(printf '%s' "$HTTP_BODY" | python3 -c 'import json,sys
try: print(len(json.load(sys.stdin)))
except Exception: print(0)' 2>/dev/null)"
  if [ "${DISK_COUNT:-0}" -gt 0 ] 2>/dev/null; then
    ok "持久磁盘已存在"
  else
    http POST "$RENDER_API/disks" "Bearer $RENDER_API_KEY" \
      "$(printf '{"name":"olang-data","sizeGB":1,"mountPath":"/var/data","serviceId":"%s"}' "$SERVICE_ID")"
    if [ "$HTTP_CODE" = "201" ]; then
      ok "已挂载 1GB 持久磁盘到 /var/data"
    else
      warn "磁盘创建失败（HTTP $HTTP_CODE）：$HTTP_BODY —— 数据将在每次部署后重置"
    fi
  fi
else
  warn "free 计划无持久磁盘：SQLite 与上传文件在重新部署后会重置"
fi

# ---------------------------------------------------------------- 6 部署
step "6/7 触发部署并等待"
http POST "$RENDER_API/services/$SERVICE_ID/deploys" "Bearer $RENDER_API_KEY" \
  '{"clearCache":"do_not_clear","deployMode":"build_and_deploy"}'
case "$HTTP_CODE" in
  201|202) DEPLOY_ID="$(printf '%s' "$HTTP_BODY" | jget id)" ;;
  *)       die "触发部署失败（HTTP $HTTP_CODE）：$HTTP_BODY" ;;
esac
ok "已触发部署：$DEPLOY_ID"

DEPLOY_STATUS="unknown"
for i in $(seq 1 72); do
  sleep 10
  http GET "$RENDER_API/services/$SERVICE_ID/deploys?limit=1" "Bearer $RENDER_API_KEY"
  DEPLOY_STATUS="$(printf '%s' "$HTTP_BODY" | jget 0.deploy.status 2>/dev/null || echo unknown)"
  printf '  [%02d] 状态：%s\n' "$i" "$DEPLOY_STATUS"
  case "$DEPLOY_STATUS" in
    live) break ;;
    build_failed|update_failed|canceled|pre_deploy_failed|deactivated) break ;;
  esac
done

if [ "$DEPLOY_STATUS" != "live" ]; then
  warn "部署未成功（最终状态：$DEPLOY_STATUS），抓取日志"
  http GET "$RENDER_API/services/$SERVICE_ID/logs?ownerId=$RENDER_OWNER&limit=100" "Bearer $RENDER_API_KEY"
  printf '%s\n' "$HTTP_BODY" > "$SCRIPT_DIR/render-logs.json"
  info "日志已保存：deploy/render-logs.json"
  add_check "deploy" "fail" "status=$DEPLOY_STATUS"
else
  ok "部署成功（live）"
  add_check "deploy" "pass" "status=live"
fi

# ---------------------------------------------------------------- 7 冒烟验证
step "7/7 冒烟验证"
BASE="$BASE_URL"
for i in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$BASE/healthz" 2>/dev/null)
  [ "$CODE" = "200" ] && break
  sleep 5
done

probe() { # probe path 期望状态码（可逗号分隔，如 "200,302"）
  local path="$1" expect="${2:-200}" code hit=0
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 25 "$BASE$path" 2>/dev/null)
  case ",$expect," in *",$code,"*) hit=1 ;; esac
  if [ "$hit" = "1" ]; then
    ok "$path -> $code"
    add_check "$path" "pass" "$code"
  else
    warn "$path -> $code（期望 $expect）"
    add_check "$path" "fail" "$code"
  fi
}

probe "/healthz"
probe "/en-gb/"
probe "/de-de/"
probe "/ja-jp/"
probe "/admin" "302,200"
probe "/admin/login" "200"
probe "/en-gb/inquiry"
probe "/en-gb/products/robe-hook-ol-1204"
probe "/robots.txt"

CANONICAL="$(curl -s -m 25 "$BASE/en-gb/" 2>/dev/null | grep -o 'rel="canonical"[^>]*' | head -1)"
if printf '%s' "$CANONICAL" | grep -q 'onrender.com\|http'; then
  if printf '%s' "$CANONICAL" | grep -q '127.0.0.1\|localhost'; then
    warn "canonical 仍指向本机：$CANONICAL"
    add_check "canonical" "fail" "$CANONICAL"
  else
    ok "canonical 正确：$CANONICAL"
    add_check "canonical" "pass" "$CANONICAL"
  fi
else
  warn "未找到 canonical 标签"
  add_check "canonical" "fail" "missing"
fi

HREFLANG="$(curl -s -m 25 "$BASE/en-gb/" 2>/dev/null | grep -c 'hreflang=' || true)"
if [ "${HREFLANG:-0}" -ge 3 ]; then
  ok "hreflang 标签数量：$HREFLANG"
  add_check "hreflang" "pass" "count=$HREFLANG"
else
  warn "hreflang 标签过少：$HREFLANG"
  add_check "hreflang" "fail" "count=$HREFLANG"
fi

ASST_CODE=$(curl -s -o /tmp/asst.json -w '%{http_code}' -m 30 -X POST "$BASE/api/assistant" \
  -H 'Content-Type: application/json' \
  -d '{"question":"What material is robe hook OL-1204 and what are its dimensions?","market":"en-GB"}' 2>/dev/null)
if [ "$ASST_CODE" = "200" ] && grep -q '"sources"' /tmp/asst.json 2>/dev/null; then
  ok "产品助手可用且返回来源"
  add_check "assistant" "pass" "200+sources"
else
  warn "产品助手异常（HTTP $ASST_CODE）"
  add_check "assistant" "fail" "http=$ASST_CODE"
fi

CSRF_OK=$(curl -s -m 25 "$BASE/en-gb/inquiry" 2>/dev/null | grep -c '_csrf' || true)
if [ "${CSRF_OK:-0}" -ge 1 ]; then
  ok "询盘表单可渲染（含 CSRF 令牌）"
  add_check "inquiry_form" "pass" "csrf_present"
else
  warn "询盘表单未渲染出 CSRF 令牌"
  add_check "inquiry_form" "fail" "no_csrf"
fi

# ---------------------------------------------------------------- 收尾
PASS_COUNT=$(awk -F'\t' '$2=="pass"' "$CHECKS" 2>/dev/null | wc -l)
FAIL_COUNT=$(awk -F'\t' '$2=="fail"' "$CHECKS" 2>/dev/null | wc -l)

{
  printf 'OLANG 后台管理员（仅本机保存，勿提交、勿外发）\n'
  printf 'URL:      %s/admin\n' "$BASE"
  printf '用户名:   %s\n' "$ADMIN_USERNAME"
  printf '密码:     %s\n' "$ADMIN_PASSWORD"
  printf '生成时间: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  printf '提示:     首次部署后可在后台修改密码；如需重置，运行 npm run admin:reset\n'
} > "$SCRIPT_DIR/.admin-credentials.local.txt"

python3 - "$SCRIPT_DIR/report.json" "$REPO_HTML_URL" "$SERVICE_ID" "$BASE" "$DEPLOY_ID" \
  "$DEPLOY_STATUS" "$RENDER_PLAN" "$BRANCH" "$COMMIT_SHA" "$CHECKS" >> "$LOG_FILE" <<'PY'
import json, sys, datetime
out, repo, sid, url, dep, status, plan, branch, sha, checks = sys.argv[1:11]
rows = []
try:
    for line in open(checks, encoding="utf-8"):
        p = line.rstrip("\n").split("\t")
        if len(p) == 3:
            rows.append({"check": p[0], "result": p[1], "detail": p[2]})
except FileNotFoundError:
    pass
report = {
    "generated_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
    "repo": repo,
    "branch": branch,
    "commit": sha,
    "render_service_id": sid,
    "url": url,
    "deploy_id": dep,
    "deploy_status": status,
    "plan": plan,
    "persistence": "disk:/var/data" if plan != "free" else "ephemeral",
    "checks": rows,
    "passed": sum(1 for r in rows if r["result"] == "pass"),
    "failed": sum(1 for r in rows if r["result"] == "fail"),
}
json.dump(report, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY

printf '\n=============================================================\n'
printf ' 部署结果\n'
printf '=============================================================\n'
printf ' 仓库      : %s\n' "$REPO_HTML_URL"
printf ' 站点      : %s\n' "$BASE"
printf ' 后台      : %s/admin（凭据见 deploy/.admin-credentials.local.txt）\n' "$BASE"
printf ' 服务 ID   : %s\n' "$SERVICE_ID"
printf ' 部署状态  : %s\n' "$DEPLOY_STATUS"
printf ' 计划      : %s（%s）\n' "$RENDER_PLAN" "$( [ "$RENDER_PLAN" = free ] && echo '无持久磁盘，重部署会重置数据' || echo '带 1GB 持久磁盘' )"
printf ' 检查      : 通过 %s 项，失败 %s 项\n' "$PASS_COUNT" "$FAIL_COUNT"
printf ' 报告      : deploy/report.json\n'
printf '=============================================================\n'

if [ "$DEPLOY_STATUS" != "live" ]; then exit 3; fi
if [ "${FAIL_COUNT:-0}" -gt 0 ]; then exit 4; fi
exit 0
