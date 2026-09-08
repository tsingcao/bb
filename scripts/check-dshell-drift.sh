#!/usr/bin/env bash
# dshell 令牌漂移闸（fork 侧镜像，契约 §6）—— bb 皮肤改动不得让主仓 Control Room 漂移
#
# 方向：主仓 CI（make lint-dshell-tokens）从 fork raw 取 bb CSS 验 CR 侧；本闸在
# fork 侧反向跑同一契约 —— 按主仓（nextloop-net/nextloop）默认分支 HEAD 的 bb-fork
# 指针，从**同一提交**提取 dshell-cr.css 与 check_dshell_tokens.py（脚本不 vendor
# 副本，永远用主仓指针提交上的版本，避免双副本漂移），对本次 checkout 的 dshell.css
# 做 §2 锚点 ΔE 断言。语义：
#   * 主仓 bb-fork 指针 == 本次 fork HEAD（镜像 scripts/bb_gitlink_gate.sh：
#     「先推 fork 再升指针」，未对齐给双向修复步骤）；
#   * 指针对齐后 ΔE ≤ 阈值（默认 0.02，--delta-e 可调）。
# 两者任一不过即红（1）。
#
# 用法（CI 同款）：
#   NEXTLOOP_MAIN_TOKEN=<PAT，需 nextloop-net/nextloop 读权限> bash scripts/check-dshell-drift.sh
# 本地 / 测试（免 token 免网络）：
#   bash scripts/check-dshell-drift.sh --main-checkout /path/to/nextloop \
#     --fork-head "$(git rev-parse HEAD)"
#   bash scripts/check-dshell-drift.sh --main-checkout /path/to/nextloop --skip-pointer-check \
#     --gate-script /path/to/check_dshell_tokens.py --cr-css /tmp/dshell-cr.css
#
# 退出码契约（诊断走 stderr；机器调用方只依赖 rc）：
#   0 —— 通过：指针一致 + 锚点 ΔE ≤ 阈值
#   1 —— 漂移：主仓指针 ≠ fork HEAD，或某锚点 ΔE > 阈值 / 缺失 / 无法换算
#   2 —— 环境/调用错误：无 token 且无 --main-checkout、主仓克隆/提取失败、
#         gate 脚本自身 IO 错误（rc2 建议 workflow 降级为 ::warning:: 提示，不硬红）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MAIN_CHECKOUT=""
FORK_CSS=""
CR_CSS_OVERRIDE=""
GATE_SCRIPT_OVERRIDE=""
FORK_HEAD=""
SKIP_POINTER=0
DELTA_E=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --main-checkout) MAIN_CHECKOUT="$2"; shift 2 ;;
    --fork-css) FORK_CSS="$2"; shift 2 ;;
    --cr-css) CR_CSS_OVERRIDE="$2"; shift 2 ;;
    --gate-script) GATE_SCRIPT_OVERRIDE="$2"; shift 2 ;;
    --fork-head) FORK_HEAD="$2"; shift 2 ;;
    --skip-pointer-check) SKIP_POINTER=1; shift ;;
    --delta-e) DELTA_E="$2"; shift 2 ;;
    *) echo "❌ check-dshell-drift：未知参数 $1" >&2; exit 2 ;;
  esac
done

MAIN_REPO="${NEXTLOOP_MAIN_REPO:-https://github.com/nextloop-net/nextloop.git}"
FORK_CSS="${FORK_CSS:-$ROOT/apps/app/src/components/ui/dshell/dshell.css}"
[ -f "$FORK_CSS" ] || {
  echo "❌ check-dshell-drift：找不到本次 checkout 的 bb dshell.css（$FORK_CSS）" >&2
  exit 2
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1) 主仓来源：--main-checkout 复用本地 checkout（本地/测试）；CI 用 token 浅克隆
#    （nextloop-net/nextloop 是私有仓，必须 token；x-access-token 免额外配置）。
if [ -n "$MAIN_CHECKOUT" ]; then
  MAIN="$MAIN_CHECKOUT"
else
  if [ -z "${NEXTLOOP_MAIN_TOKEN:-}" ]; then
    echo "❌ check-dshell-drift：未提供 NEXTLOOP_MAIN_TOKEN 且未用 --main-checkout" >&2
    echo "   主仓 ${MAIN_REPO} 是私有仓；配置带读权限的 PAT 后本闸才生效。" >&2
    exit 2
  fi
  MAIN="$TMP/main"
  if ! git -c credential.helper= clone --depth 1 \
    "https://x-access-token:${NEXTLOOP_MAIN_TOKEN}@${MAIN_REPO#https://}" "$MAIN" >/dev/null 2>&1; then
    echo "❌ check-dshell-drift：浅克隆主仓 ${MAIN_REPO} 失败（token 无读权限 / 网络）" >&2
    exit 2
  fi
fi

# 2) 主仓默认分支 HEAD 的 bb-fork 指针（gitlink 记录在树对象里，无需 .gitmodules）
if ! recorded="$(git -C "$MAIN" rev-parse HEAD:bb-fork 2>/dev/null)"; then
  echo "❌ check-dshell-drift：主仓 HEAD 没有 bb-fork gitlink 记录（主仓还没 git add bb-fork？）" >&2
  exit 2
fi

# 3) 指针对齐检查（PR 合并提交永远无法被主仓钉住 → --skip-pointer-check）
FORK_HEAD="${FORK_HEAD:-$(git rev-parse HEAD)}"
if [ "$SKIP_POINTER" != "1" ] && [ "$recorded" != "$FORK_HEAD" ]; then
  echo "❌ check-dshell-drift：指针漂移 —— 主仓 bb-fork 指针 ≠ 本次 fork HEAD" >&2
  echo "   主仓记录（HEAD:bb-fork）: $recorded" >&2
  echo "   本次 fork HEAD          : $FORK_HEAD" >&2
  echo "   修复（按漂移方向二选一）：" >&2
  echo "     A) fork 领先主仓（正常漏升）：在主仓执行 git add bb-fork &&" >&2
  echo "        git commit -m \"chore(deps): bump bb-fork gitlink to ${FORK_HEAD:0:9}\"" >&2
  echo "     B) 主仓领先 fork（忘了推）：git push fork nextloop/ide-base" >&2
  echo "        （推完主仓指针自动对齐；若仍不一致再按 A 升）" >&2
  exit 1
fi
[ "$SKIP_POINTER" != "1" ] && echo "✅ check-dshell-drift：指针一致（main gitlink == fork HEAD == $FORK_HEAD）"

# 4) 从主仓指针提交提取 CR css 与 gate 脚本（单份语义源；脚本不 vendor）
CR_CSS="$TMP/dshell-cr.css"
GATE="$TMP/check_dshell_tokens.py"
if [ -n "$CR_CSS_OVERRIDE" ]; then
  CR_CSS="$CR_CSS_OVERRIDE"
else
  git -C "$MAIN" show HEAD:src/nextloop/web/ui-src/src/dshell-cr.css >"$CR_CSS" 2>/dev/null || {
    echo "❌ check-dshell-drift：主仓指针提交没有 src/nextloop/web/ui-src/src/dshell-cr.css" >&2
    exit 2
  }
fi
if [ -n "$GATE_SCRIPT_OVERRIDE" ]; then
  GATE="$GATE_SCRIPT_OVERRIDE"
else
  git -C "$MAIN" show HEAD:scripts/check_dshell_tokens.py >"$GATE" 2>/dev/null || {
    echo "❌ check-dshell-drift：主仓指针提交没有 scripts/check_dshell_tokens.py" >&2
    echo "   主仓 drift-gate 流（check_dshell_tokens.py + ci.yml 步 + Makefile 目标）未落地？" >&2
    echo "   落地前本闸按环境错误处理（rc2，workflow 降级为 ::warning::）。" >&2
    exit 2
  }
fi

# 5) ΔE 断言：gate 脚本退出码即本闸退出码（0 绿 / 1 漂移 / 2 其自身 IO 错误）
PY="${PYTHON:-python3}"
args=(--bb "$FORK_CSS" --cr "$CR_CSS")
[ -n "$DELTA_E" ] && args+=(--delta-e "$DELTA_E")
echo "✅ check-dshell-drift：对比 fork dshell.css ↔ 主仓指针提交的 dshell-cr.css（ΔE ≤ ${DELTA_E:-0.02}）"
"$PY" "$GATE" "${args[@]}"
exit $?