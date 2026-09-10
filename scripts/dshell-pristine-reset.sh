#!/bin/bash
# dshell 基线重置：把工作区恢复到「全新 clone」等价状态后再跑线程无关 --check。
#
# 背景：e2e harness（tests/integration/helpers/harness.ts）每次启动都 mkdtemp
# 新的 bb-integration-* 数据目录（server/daemon/线程全部按种子重建），Playwright
# 也用全新浏览器 context —— 后端数据天然 pristine。真正的漂移源在 harness 之外：
#
#   1. apps/app/dist 过期 —— BB_MOBILE_E2E_SERVE_APP=1 服务的是**已构建产物**，
#      全新 clone 会先 build；本工作区 dist 停留在旧提交 → 像素漂移/布局回归假象；
#   2. 残留 harness 进程占用 41999 端口，新种子起不来或连到旧数据；
#   3. /tmp 里上一轮的场景截图（<scene>__<region>.png）与 auto/.diff/ 差异报告
#      —— 过期产物混进人工审阅。
#
# 本脚本按全新 clone 语义依次清掉这三类状态，然后：
#   build → 起 harness → 线程无关 --check --ci → 关 harness → 输出结论。
#
# 用法：
#   bash scripts/dshell-pristine-reset.sh              # 全流程
#   bash scripts/dshell-pristine-reset.sh --skip-build # 跳过 build（仅清态+check）
#
# 退出码：0 = check 绿；1 = check 有 FAIL/MISSING；2 = 环境（build/harness 失败）
set -u
cd "$(dirname "$0")/.." || exit 2

SKIP_BUILD=0
[ "${1:-}" = "--skip-build" ] && SKIP_BUILD=1

log() { echo "[pristine-reset] $(date '+%H:%M:%S') $*"; }

# ── 1) 停掉本仓的残留 harness / 桌面 dev（不动其他会话的服务）──
log "停止残留 harness 进程…"
pkill -f "e2e:mobile-backend" 2>/dev/null
sleep 2

# ── 2) 清 tmp 状态（harness 数据目录是 mkdtemp 的，本就一次性；这里清截图产物）──
log "清理 /tmp 场景截图与 bb-integration 残留目录…"
rm -rf /tmp/bb-integration-* 2>/dev/null
rm -f /tmp/final_*__*.png /tmp/rail_*__*.png /tmp/dshell_settings_*__*.png \
      /tmp/migration_banner_*__*.png /tmp/glass_*__*.png /tmp/app_terminal_*__*.png \
      /tmp/term_canvas_*__*.png /tmp/palette_*__*.png 2>/dev/null

# 过期差异报告（gitignore 的临时审阅产物，不属基线）
rm -rf docs/dshell-skin-shots/auto/.diff 2>/dev/null

# ── 3) 重建 app 产物（全新 clone 语义：dist 必须从当前源码构建）──
if [ "$SKIP_BUILD" != "1" ]; then
  log "重建 @bb/app dist（turbo build）…"
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
  if ! pnpm exec turbo run build --filter=@bb/app --output-logs=new-only > /tmp/pristine-reset-build.log 2>&1; then
    log "❌ build 失败（/tmp/pristine-reset-build.log 末 20 行）："
    tail -20 /tmp/pristine-reset-build.log
    exit 2
  fi
  log "build 完成"
else
  log "跳过 build（--skip-build）—— dist 若过期，结果不代表全新 clone 语义"
fi

# ── 4) 起 harness（前台后台化，等 serverUrl）──
log "启动 e2e harness…"
export BB_MOBILE_E2E_SERVE_APP=1
mkdir -p e2e-artifacts
pnpm exec turbo run e2e:mobile-backend --filter=@bb/integration-tests \
  --output-logs=full --log-order=stream > e2e-artifacts/backend.log 2>&1 &
HARNESS_PID=$!

READY=0
for _ in $(seq 1 90); do
  if grep -q '"serverUrl"' e2e-artifacts/backend.log 2>/dev/null; then READY=1; break; fi
  kill -0 "$HARNESS_PID" 2>/dev/null || { log "❌ harness 提前退出"; tail -20 e2e-artifacts/backend.log; exit 2; }
  sleep 5
done
[ "$READY" != "1" ] && { log "❌ harness 15 分钟未就绪"; tail -20 e2e-artifacts/backend.log; kill "$HARNESS_PID" 2>/dev/null; exit 2; }

INFO=$(grep -m1 '"serverUrl"' e2e-artifacts/backend.log | sed -E 's/^.*(\{[^}]*"serverUrl"[^}]*\})/\1/')
BB_URL_VALUE=$(printf '%s' "$INFO" | python3 -c 'import json,sys; print(json.load(sys.stdin)["serverUrl"])' 2>/dev/null)
log "harness 就绪：$BB_URL_VALUE"

# ── 5) 线程无关完整 --check --ci（无 BB_E2E_THREAD：玻璃/终端场景自动 skip）──
log "跑线程无关 --check --ci…"
BB_URL="$BB_URL_VALUE" python3 scripts/dshell-skin-snapshot.py --check --ci > /tmp/pristine-reset-check.log 2>&1
CHECK_RC=$?

# ── 6) 关 harness + 输出结论 ──
kill "$HARNESS_PID" 2>/dev/null; pkill -f "e2e:mobile-backend" 2>/dev/null
sleep 1

echo
echo "===== --check --ci 结果（pristine reset 后） ====="
grep -E "\[(PASS|FAIL)\]|MISSING|结果:|FAIL |MISSING |skip " /tmp/pristine-reset-check.log | head -40
echo "=================================================="
if [ "$CHECK_RC" = "0" ]; then
  log "✅ 绿：pristine 种子下线程无关基线全部通过（rc=0）"
else
  log "❌ 红（rc=$CHECK_RC）：完整日志 /tmp/pristine-reset-check.log；差异报告 docs/dshell-skin-shots/auto/.diff/"
fi
exit "$CHECK_RC"
