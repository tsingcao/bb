"""dshell-host-compare —— 终端宿主导航级并排对比（右面板 vs compose/split-pane 宿主）。

验证 §12b 契约：`[data-app-terminal]` 通用终端 chrome（画布底色、圆角、青色发丝描边、
letterbox）在每个宿主都一致渲染；§11/§13 玻璃链用 `[data-panel-id^="thread-detail-secondary-panel"]`
前缀匹配，主面板（thread-detail-secondary-panel）与 split-pane（...-pane-N）都吃同一套玻璃。
脚本对两个宿主各截一张终端区 PNG，做像素级并排对比，产出：
  docs/dshell-skin-shots/host-compare/
    panel.png           右面板终端（§11+§12b 宿主）
    compose.png         compose/split-pane 终端（§11+§12b 宿主，前缀匹配后与主面板一致）
    side-by-side.png    并排合成图
    diff.png            差异高亮图（红色=差异像素）
    report.json         尺寸/锚点色/像素差异指标/bbox

退出码：0 = 背景一致且差异在阈值内；1 = 背景不一致（§12b 契约破坏，如画布色不同）
或差异超限。CI 可挂 --check。

用法：python scripts/dshell-host-compare.py [--theme dark|light]
  --theme light 走亮色外观（html.light），产出归档到 host-compare/light/ 子目录，
  与暗色基线互不覆盖；两外观各自成对，§12b 画布契约在两态下分别断言。

单一事实来源（避免两处维护）：种子上下文（boot）、右面板终端打开流程
（open_terminal）、compose 终端打开流程（open_compose_terminal）、宿主状态 JS、
像素对比实现（host_compare_metrics）与判定阈值全部复用
scripts/dshell-skin-snapshot.py —— 本脚本只做「运行两个宿主 + 归档产物 + 独立退出码」。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parent
OUT_DIR = _SCRIPTS_DIR.parent / "docs" / "dshell-skin-shots" / "host-compare"


def _load_snapshot():
    """importlib 加载 dshell-skin-snapshot.py（上线代码，非复制品）。

    该模块 import 时会做解释器自举（系统 python3 缺 playwright/Pillow 时 os.execv
    重执行）——execv 只发生在依赖缺失的解释器里，此处同解释器 import 等价于
    直接执行脚本的前置段。加载失败即明确报错退出，不静默降级。
    """
    path = _SCRIPTS_DIR / "dshell-skin-snapshot.py"
    spec = importlib.util.spec_from_file_location("dshell_skin_snapshot", path)
    if spec is None or spec.loader is None:
        print(f"FAIL: 无法加载 {path}", file=sys.stderr)
        sys.exit(2)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def log(msg: str) -> None:
    print(msg, flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description="dshell 终端宿主并排像素对比")
    ap.add_argument("--theme", choices=("dark", "light"), default="dark",
                    help="外观（默认 dark；light 归档到 host-compare/light/）")
    args = ap.parse_args()
    theme = args.theme

    snap = _load_snapshot()
    from PIL import Image

    thread = snap.THREAD
    if not thread:
        print("FAIL: 需 BB_E2E_THREAD（面板宿主要线程路由）", file=sys.stderr)
        return 2

    out_dir = OUT_DIR / theme if theme == "light" else OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    report: dict = {"base": snap.BASE, "thread": thread, "theme": theme, "hosts": {}}

    with snap.playwright_sync() as page:
        # --- 宿主 A：右面板终端（§11 + §12b）---
        snap.boot(page, "on", theme, thread)
        if not snap.open_terminal(page):
            log("FAIL: 右面板终端未能打开")
            return 1
        page.wait_for_timeout(2500)
        tA = page.evaluate(snap.HOST_COMPARE_STATE_JS)
        log(f"panel host: {tA}")
        if tA is None:
            return 1
        shotA = out_dir / "panel.png"
        snap.capture_region(page, str(shotA), tA["viewport"])
        report["hosts"]["panel"] = tA
        snap.close_terminal(page)

        # --- 宿主 B：root compose split-pane 终端（仅 §12b）---
        snap.boot(page, "on", theme, "/")
        if not snap.open_compose_terminal(page):
            log("FAIL: compose 终端未能打开")
            return 1
        page.wait_for_timeout(3000)
        tB = page.evaluate(snap.HOST_COMPARE_STATE_JS)
        log(f"compose host: {tB}")
        if tB is None:
            return 1
        shotB = out_dir / "compose.png"
        snap.capture_region(page, str(shotB), tB["viewport"])
        # 稳定性质检：3s 后再截一次，锚点色应不变（排除首帧未绘制）
        page.wait_for_timeout(3000)
        tB2 = page.evaluate(snap.HOST_COMPARE_STATE_JS)
        if tB2:
            probe = out_dir / "compose_probe2.png"
            snap.capture_region(page, str(probe), tB2["viewport"])
            px1 = Image.open(shotB).convert("RGB").load()
            px2 = Image.open(probe).convert("RGB").load()
            c1 = px1[tB["viewport"]["w"] // 2, tB["viewport"]["h"] // 2]
            c2 = px2[tB2["viewport"]["w"] // 2, tB2["viewport"]["h"] // 2]
            log(f"compose canvas center: t0={c1} t3s={c2}")
            probe.unlink()
        report["hosts"]["compose"] = tB

    # --- 像素级并排对比（与 snapshot 的 host_compare 场景同一实现、同一阈值）---
    cmp = snap.host_compare_metrics(shotA, shotB)
    report["compare"] = cmp
    log(f"compare: {cmp}")

    a = Image.open(shotA)
    b = Image.open(shotB)
    w = max(a.width, b.width)
    h = max(a.height, b.height)
    canvas = Image.new("RGB", (w * 2 + 8, h + 12), (18, 18, 28))
    canvas.paste(a, (0, 6))
    canvas.paste(b, (w + 8, 6))
    canvas.save(out_dir / "side-by-side.png")
    diff_img = a.convert("RGB")
    pa, pb = diff_img.load(), b.convert("RGB").load()
    for y in range(min(diff_img.height, b.height)):
        for x in range(min(diff_img.width, b.width)):
            ca, cb = pa[x, y], pb[x, y]
            if abs(ca[0] - cb[0]) + abs(ca[1] - cb[1]) + abs(ca[2] - cb[2]) > 36:
                pa[x, y] = (255, 40, 60)
    diff_img.save(out_dir / "diff.png")

    (out_dir / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
    log(f"archived → {out_dir}")

    # --- 判定（阈值与 snapshot 的 host_compare 场景同源）---
    bg_ok = cmp["anchorMaxAbsDiff"] <= snap.HOST_COMPARE_BG_TOL
    diff_ok = (
        cmp["diffPct"] <= snap.HOST_COMPARE_MAX_DIFF_PCT
        and cmp["meanAbsDiff"] <= snap.HOST_COMPARE_MAX_MEAN_DIFF
    )
    if not bg_ok:
        log(f"FAIL: 两宿主画布锚点色差 {cmp['anchorMaxAbsDiff']} > {snap.HOST_COMPARE_BG_TOL}（§12b 画布色契约破坏）")
        return 1
    if not diff_ok:
        log(
            f"FAIL: 差异 {cmp['diffPct']}% / meanAbs {cmp['meanAbsDiff']} 超限"
            f"（{snap.HOST_COMPARE_MAX_DIFF_PCT}% / {snap.HOST_COMPARE_MAX_MEAN_DIFF}）"
        )
        return 1
    log(f"PASS: 画布锚点一致（Δ={cmp['anchorMaxAbsDiff']}），差异 {cmp['diffPct']}% 在阈值内")
    return 0


if __name__ == "__main__":
    sys.exit(main())
