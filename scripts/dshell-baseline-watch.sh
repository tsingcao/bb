#!/bin/bash
# dshell 基线自动重拍看门狗 —— 等 sidebar/nav 流提交落地后自动跑线程无关基线重生成。
#
# 触发条件：bb-fork HEAD 上出现**新的**、触碰 sidebar/nav 相关文件的提交
# （apps/app/src/components/sidebar|layout、ui/sidebar.tsx、ThreadRow 等）。
# 每次 HEAD 前进只触发一次（处理完才更新水位线；处理失败时保留水位线，下轮重试）。
#
# 流程：
#   1. 每 60s 轮询 git HEAD；
#   2. 触发时：清掉旧 harness → 起 e2e harness（turbo e2e:mobile-backend，等 serverUrl）；
#   3. 对三个线程无关场景前缀跑 --update（final_ / dshell_settings_ / rail_）；
#   4. 关 harness；再跑一次完整 --check --ci（无线程，玻璃/终端场景自动 skip）；
#   5. 结果写 <repo>/e2e-artifacts/baseline-watch-report.md + latest-report.md，
#      nav 流 owner 拿报告决定 --update 产物是否入库。
#
# 设计要点：
#   - 只重拍 nav 拥有的场景（见 docs/dshell-skin-shots/WORKSTREAMS.md 基线所有权表），
#     不碰 rail 流 / glass 流 / 终端流的基线，避免流间互相追赶；
#   - 触发后 diff 出触发的提交清单写进报告（可审计：哪次 HEAD 前进导致的重拍）；
#   - harness 原生模块重建可能耗时数分钟，脚本整体幂等，可被 launchd 反复拉起。
#
# 用法：launchctl submit -l com.codebuff.dshell-basewatch -- /bin/bash \
#         <repo>/scripts/dshell-baseline-watch.sh
#       日志：/tmp/dshell-basewatch.log；报告：e2e-artifacts/latest-report.md

set -u

REPO="/Users/timcao/workspace/nextloop/bb-fork"
WATERMARK_FILE="/tmp/dshell-basewatch.watermark"
LOG_TAG="[basewatch]"
REPORT_DIR="$REPO/e2e-artifacts"
LATEST="$REPORT_DIR/latest-report.md"

# nav/sidebar 流拥有的文件特征（触碰任一 → 认定为该流的提交）
NAV_PATHS=(
  "apps/app/src/components/sidebar/"
  "apps/app/src/components/layout/"
  "apps/app/src/components/ui/sidebar"
  "apps/app/src/components/sidebar-messages"
  "apps/app/src/components/ThreadRow"
)

log() { echo "$(date '+%m-%d %H:%M:%S') $LOG_TAG $*"; }

is_nav_commit() {
  local sha="$1"
  local touched
  touched=$(git -C "$REPO" show --name-only --format= "$sha" 2>/dev/null)
  for p in "${NAV_PATHS[@]}"; do
    if echo "$touched" | grep -q "$p"; then
      return 0
    fi
  done
  return 1
}

wait_for_harness() {
  local backend_log="$REPO/e2e-artifacts/backend.log"
  for _ in $(seq 1 90); do
    if grep -q '"serverUrl"' "$backend_log" 2>/dev/null; then
      grep -m1 '"serverUrl"' "$backend_log" | sed -E 's/^.*(\{[^}]*"serverUrl"[^}]*\})/\1/'
      return 0
    fi
    sleep 5
  done
  return 1
}

run_regen() {
  local trigger_sha="$1"
  mkdir -p "$REPORT_DIR"
  local ts report
  ts=$(date '+%Y%m%d-%H%M%S')
  report="$REPORT_DIR/baseline-watch-report-$ts.md"

  log "触发：HEAD=$trigger_sha，启动重拍流程"

  # 0) 记录触发提交
  {
    echo "# dshell 基线自动重拍报告 — $ts"
    echo
    echo "**触发 HEAD**: \`$trigger_sha\`"
    echo
    echo "**触发提交**（sidebar/nav 相关）:"
    echo '```'
    git -C "$REPO" log --oneline "$WATERMARK_SHA..$trigger_sha" -- \
      "${NAV_PATHS[@]}" 2>/dev/null | head -20
    echo '```'
    echo
  } > "$report"

  # 1) 清旧 harness
  pkill -f "e2e:mobile-backend" 2>/dev/null
  sleep 2

  # 2) 起 harness（前台，等 serverUrl）
  log "启动 e2e harness…"
  (
    cd "$REPO"
    export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
    export BB_MOBILE_E2E_SERVE_APP=1
    pnpm exec turbo run e2e:mobile-backend --filter=@bb/integration-tests \
      --output-logs=full --log-order=stream > e2e-artifacts/backend.log 2>&1
  ) &
  HARNESS_PID=$!

  local info bb_url
  if ! info=$(wait_for_harness); then
    {
      echo "## 结果：❌ harness 未就绪（15 分钟超时）"
      echo
      echo '```'
      tail -20 "$REPO/e2e-artifacts/backend.log" 2>/dev/null
      echo '```'
    } >> "$report"
    cp "$report" "$LATEST"
    kill "$HARNESS_PID" 2>/dev/null
    return 1
  fi
  bb_url=$(echo "$info" | python3 -c 'import json,sys; print(json.load(sys.stdin)["serverUrl"])' 2>/dev/null)
  log "harness 就绪：$bb_url"

  # 3) 重拍线程无关基线（nav 流拥有）
  local update_rc=0
  {
    cd "$REPO"
    BB_URL="$bb_url" python3 scripts/dshell-skin-snapshot.py --update --scene final_
    BB_URL="$bb_url" python3 scripts/dshell-skin-snapshot.py --update --scene dshell_settings_
    BB_URL="$bb_url" python3 scripts/dshell-skin-snapshot.py --update --scene rail_
  } >> "$report" 2>&1 || update_rc=$?

  # 4) 关 harness
  pkill -f "e2e:mobile-backend" 2>/dev/null
  sleep 2

  # 5) 完整 --check --ci（无线程：玻璃/终端场景 skip，基线刚重拍应全绿）
  {
    echo
    echo "## --check --ci 结果（重拍后验证）"
    echo '```'
    (cd "$REPO" && BB_URL="http://127.0.0.1:1" python3 scripts/dshell-skin-snapshot.py --check --ci 2>&1 | tail -40)
    echo '```'
  } >> "$report"
  local check_rc=$?

  {
    echo
    echo "## 状态"
    echo "- regen rc: $update_rc"
    echo "- check rc: $check_rc（--check 无活 harness 时终端口场景 skip 属预期）"
    echo "- 重拍产物：\`git -C $REPO status docs/dshell-skin-shots/auto/\` 查看"
  } >> "$report"
  cp "$report" "$LATEST"
  log "完成：report=$LATEST regen_rc=$update_rc check_rc=$check_rc"
  return 0
}

# ── 主循环 ──
cd "$REPO" || exit 1
WATERMARK_SHA=$(cat "$WATERMARK_FILE" 2>/dev/null || echo "")
[ -z "$WATERMARK_SHA" ] && WATERMARK_SHA=$(git rev-parse HEAD) && echo "$WATERMARK_SHA" > "$WATERMARK_FILE"

log "看门狗启动，水位线 $WATERMARK_SHA"

while true; do
  sleep 60
  HEAD_SHA=$(git rev-parse HEAD 2>/dev/null)
  [ -z "$HEAD_SHA" ] && continue
  [ "$HEAD_SHA" = "$WATERMARK_SHA" ] && continue

  # HEAD 前进：检查区间内是否有 nav 提交
  if git rev-list "$WATERMARK_SHA..$HEAD_SHA" 2>/dev/null | while read -r sha; do
    if is_nav_commit "$sha"; then
      echo "$sha"
      break
    fi
  done | grep -q .; then
    # 有 nav 提交：跑重拍（成功才推进水位线）
    if run_regen "$HEAD_SHA"; then
      echo "$HEAD_SHA" > "$WATERMARK_FILE"
      WATERMARK_SHA="$HEAD_SHA"
    else
      log "重拍失败，水位线保留在 $WATERMARK_SHA（下轮重试）"
    fi
  else
    # 无 nav 提交：静默推进水位线（其他流的提交不触发重拍）
    echo "$HEAD_SHA" > "$WATERMARK_FILE"
    WATERMARK_SHA="$HEAD_SHA"
    log "HEAD 前进到 $HEAD_SHA（非 nav 流，跳过）"
  fi
done
