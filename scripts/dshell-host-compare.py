"""dshell-host-compare —— 终端宿主导航级并排对比（右面板 vs compose/split-pane 宿主）。

验证 §12b 契约：`[data-app-terminal]` 通用终端 chrome（画布底色、圆角、青色发丝描边、
letterbox）在每个宿主都一致渲染；§11/§13 玻璃链用 `[data-panel-id^="thread-detail-secondary-panel"]`
前缀匹配，主面板（thread-detail-secondary-panel）与 split-pane（...-pane-N）都吃同一套玻璃。
脚本对两个宿主各截一张终端区 PNG，做像素级并排对比，产出：
  docs/dshell-skin-shots/host-compare/
    panel.png           右面板终端（§11+§12b 宿主）
    compose.png         compose/split-pane 终端（§11+§12b 宿主，前缀匹配后与主面板一致）
    side-by-side.png    1920 并排合成图
    diff.png            差异高亮图（红色=差异像素）
    report.json         尺寸/锚点色/背景计算样式/像素差异指标/bbox

退出码：0 = 背景一致且差异在阈值内；1 = 背景不一致（§12b 契约破坏，如画布色不同）
或差异超限。CI 可挂 --check。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:18154"
THREAD = "/projects/proj_piv8e7jmz9/threads/thr_my785vjuev"
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "dshell-skin-shots" / "host-compare"

MAX_MEAN_DIFF = 6.0     # 平均绝对差上限（0-255）：文本/光标差异应远小于此
MAX_DIFF_PCT = 12.0     # 差异像素(>12/255)占比上限 %：两宿主画布底色一致时文本占比应远小于此
BG_TOL = 6              # 四角+中心锚点色差上限 /255

PANEL_ASIDE_JS = """() => {
  const vw = innerWidth;
  return [...document.querySelectorAll('[data-panel-id="thread-detail-secondary-panel"] aside')]
    .find(a => { const r = a.getBoundingClientRect(); return r.width > 150 && r.right > 80 && r.left < vw && r.bottom > 50; }) || null;
}"""


def log(msg: str) -> None:
    print(msg, flush=True)


def boot_thread(page) -> None:
    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=60000)
    page.evaluate(
        """() => {
          try { localStorage.setItem("bb.dshell.enabled", "on"); } catch {}
          document.documentElement.classList.remove("dark", "light", "dshell");
        }"""
    )
    page.goto(BASE + THREAD, wait_until="domcontentloaded", timeout=60000)
    try:
        page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass
    page.wait_for_timeout(3500)
    page.evaluate("""() => { const h = document.documentElement; h.classList.remove("dark","light"); h.classList.add("dark"); }""")
    page.wait_for_timeout(900)


def boot_compose(page) -> None:
    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=60000)
    try:
        page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass
    page.wait_for_timeout(3000)
    page.evaluate("""() => { const h = document.documentElement; h.classList.remove("dark","light"); h.classList.add("dark"); }""")
    page.wait_for_timeout(600)


def open_panel_terminal(page) -> bool:
    # 右面板常驻展开时直接走 shell/Start terminal 流程；若几次不成功，
    # 用 ⌘J 重置一次面板状态（面板默认宽度 1px 收合时必需）。
    for attempt in range(3):
        ok = _open_panel_terminal_once(page, rounds=14)
        if ok:
            return True
        page.keyboard.press("Meta+J")
        page.wait_for_timeout(1500)
    return False


def _open_panel_terminal_once(page, rounds: int) -> bool:
    for _ in range(rounds):
        has = page.evaluate(
            """() => {
              const vw = innerWidth;
              const f = [...document.querySelectorAll('[data-panel-id="thread-detail-secondary-panel"] aside')]
                .find(a => { const r = a.getBoundingClientRect(); return r.width > 150 && r.right > 80 && r.left < vw && r.bottom > 50; });
              return !!f && !!f.querySelector(".terminal.xterm");
            }"""
        )
        if has:
            return True
        page.evaluate(
            """() => {
              const vw = innerWidth;
              const f = [...document.querySelectorAll('[data-panel-id="thread-detail-secondary-panel"] aside')]
                .find(a => { const r = a.getBoundingClientRect(); return r.width > 150 && r.right > 80 && r.left < vw && r.bottom > 50; });
              if (!f) return;
              const vis = [...f.querySelectorAll("button")].filter(x => {
                const r = x.getBoundingClientRect(); const t = (x.textContent || "").trim();
                return /^(zsh|bash|fish|sh)$/.test(t) && r.width > 2 && r.height > 2;
              });
              if (vis.length) { vis[vis.length - 1].click(); return; }
              const nt = [...f.querySelectorAll("button")].find(x =>
                (x.getAttribute("aria-label") || "").startsWith("Open new tab"));
              if (nt) nt.click();
            }"""
        )
        page.wait_for_timeout(1400)
        act = page.get_by_role("button", name=re.compile("Start terminal", re.I))
        if act.count():
            act.first.click()
        page.wait_for_timeout(1500)
    return False


def find_terminal(page):
    """返回可见 xterm 的 rect + 宿主链信息，或 None。"""
    return page.evaluate(
        """() => {
          for (const xterm of [...document.querySelectorAll('.terminal.xterm')]) {
            const r = xterm.getBoundingClientRect();
            if (r.width < 20 || r.height < 20) continue;
            const vp = xterm.closest('.xterm-viewport') || xterm.querySelector('.xterm-viewport') || xterm;
            const v = vp.getBoundingClientRect();
            const panel = xterm.closest('[data-panel-id]');
            const cs = getComputedStyle(vp);
            const rootCs = panel ? getComputedStyle(panel) : null;
            return {
              xterm: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
              viewport: { x: Math.round(v.x), y: Math.round(v.y), w: Math.round(v.width), h: Math.round(v.height) },
              dataAppTerminal: !!xterm.closest('[data-app-terminal]'),
              htmlDshell: document.documentElement.classList.contains('dshell'),
              htmlDark: document.documentElement.classList.contains('dark'),
              panelId: panel ? panel.getAttribute('data-panel-id') : null,
              viewportBg: cs.backgroundColor,
              panelBackdrop: rootCs ? rootCs.backdropFilter : null,
            };
          }
          return null;
        }"""
    )


def capture(page, rect: dict, path: Path) -> None:
    page.screenshot(
        path=str(path),
        clip={
            "x": rect["x"],
            "y": rect["y"],
            "width": rect["w"],
            "height": rect["h"],
        },
    )


def compare(path_a: Path, path_b: Path):
    from PIL import Image

    a = Image.open(path_a).convert("RGB")
    b = Image.open(path_b).convert("RGB")
    if a.size != b.size:
        # 宿主间 1px 级差异（滚动条/亚像素）：归一化到公共区域再比
        w, h = min(a.width, b.width), min(a.height, b.height)
        a = a.crop((0, 0, w, h))
        b = b.crop((0, 0, w, h))
    pa, pb = a.load(), b.load()
    w, h = a.size
    total = w * h
    diff_px = 0
    sum_abs = 0
    min_x, min_y, max_x, max_y = w, h, -1, -1
    anchors_a, anchors_b = [], []
    for (ax, ay) in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, h // 2)]:
        anchors_a.append(pa[ax, ay])
        anchors_b.append(pb[ax, ay])
    for y in range(h):
        for x in range(w):
            ca, cb = pa[x, y], pb[x, y]
            d = abs(ca[0] - cb[0]) + abs(ca[1] - cb[1]) + abs(ca[2] - cb[2])
            sum_abs += d
            if d > 36:  # 单通道差>12 → 差异像素
                diff_px += 1
                if x < min_x:
                    min_x = x
                if x > max_x:
                    max_x = x
                if y < min_y:
                    min_y = y
                if y > max_y:
                    max_y = y
    anchor_max = max(
        max(abs(ca[i] - cb[i]) for i in range(3))
        for ca, cb in zip(anchors_a, anchors_b)
    )
    return {
        "size": list(a.size),
        "meanAbsDiff": round(sum_abs / (total * 3), 3),
        "diffPx": diff_px,
        "diffPct": round(diff_px / total * 100, 3),
        "bbox": None if max_x < 0 else [min_x, min_y, max_x - min_x + 1, max_y - min_y + 1],
        "anchorMaxAbsDiff": anchor_max,
        "anchorsA": [list(c) for c in anchors_a],
        "anchorsB": [list(c) for c in anchors_b],
    }


def draw_diff(path_a: Path, path_b: Path, out: Path) -> None:
    from PIL import Image

    a = Image.open(path_a).convert("RGB")
    b = Image.open(path_b).convert("RGB")
    pa, pb = a.load(), b.load()
    w, h = a.size
    for y in range(h):
        for x in range(w):
            ca, cb = pa[x, y], pb[x, y]
            if abs(ca[0] - cb[0]) + abs(ca[1] - cb[1]) + abs(ca[2] - cb[2]) > 36:
                pa[x, y] = (255, 40, 60)
    a.save(out)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    report: dict = {"base": BASE, "thread": THREAD, "hosts": {}}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # 同一 context 的两个页面：localStorage（皮肤偏好）天然共享，与真实多标签一致
        context = browser.new_context(viewport={"width": 1920, "height": 1000})
        # --- 宿主 A：右面板终端（§11 + §12b） ---
        page = context.new_page()
        boot_thread(page)
        if not open_panel_terminal(page):
            log("FAIL: 右面板终端未能打开")
            browser.close()
            return 1
        page.wait_for_timeout(2500)
        tA = find_terminal(page)
        log(f"panel host: {tA}")
        if tA is None:
            browser.close()
            return 1
        shotA = OUT_DIR / "panel.png"
        capture(page, tA["viewport"], shotA)
        report["hosts"]["panel"] = tA
        page.close()

        # --- 宿主 B：root compose split pane 终端（仅 §12b） ---
        page = context.new_page()
        boot_compose(page)
        stB = page.evaluate(
            """() => ({ stored: localStorage.getItem('bb.dshell.enabled'),
                        ds: document.documentElement.classList.contains('dshell'),
                        dark: document.documentElement.classList.contains('dark') })"""
        )
        log(f"compose boot state: {stB}")
        page.keyboard.press("Meta+Shift+Enter")
        page.wait_for_timeout(8000)
        tB = find_terminal(page)
        log(f"compose host: {tB}")
        if tB is None:
            browser.close()
            return 1
        shotB = OUT_DIR / "compose.png"
        capture(page, tB["viewport"], shotB)
        # 稳定性质检：3s 后再截一次，锚点色应不变（排除首帧未绘制）
        page.wait_for_timeout(3000)
        tB2 = find_terminal(page)
        if tB2:
            probe = OUT_DIR / "compose_probe2.png"
            capture(page, tB2["viewport"], probe)
            from PIL import Image as _I

            px1 = _I.open(shotB).convert("RGB").load()
            px2 = _I.open(probe).convert("RGB").load()
            c1 = px1[tB["viewport"]["w"] // 2, tB["viewport"]["h"] // 2]
            c2 = px2[tB2["viewport"]["w"] // 2, tB2["viewport"]["h"] // 2]
            log(f"compose canvas center: t0={c1} t3s={c2}")
            probe.unlink()
        report["hosts"]["compose"] = tB
        page.close()
        context.close()
        browser.close()

    # --- 像素级并排对比 ---
    cmp = compare(shotA, shotB)
    report["compare"] = cmp
    log(f"compare: {cmp}")
    if "error" in cmp:
        (OUT_DIR / "report.json").write_text(json.dumps(report, indent=2))
        return 1

    from PIL import Image

    a = Image.open(shotA)
    b = Image.open(shotB)
    w = max(a.width, b.width)
    h = max(a.height, b.height)
    canvas = Image.new("RGB", (w * 2 + 8, h + 12), (18, 18, 28))
    canvas.paste(a, (0, 6))
    canvas.paste(b, (w + 8, 6))
    canvas.save(OUT_DIR / "side-by-side.png")
    draw_diff(shotA, shotB, OUT_DIR / "diff.png")

    (OUT_DIR / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
    log(f"archived → {OUT_DIR}")

    # --- 判定 ---
    bg_ok = cmp["anchorMaxAbsDiff"] <= BG_TOL
    diff_ok = cmp["diffPct"] <= MAX_DIFF_PCT and cmp["meanAbsDiff"] <= MAX_MEAN_DIFF
    if not bg_ok:
        log(f"FAIL: 两宿主画布锚点色差 {cmp['anchorMaxAbsDiff']} > {BG_TOL}（§12b 画布色契约破坏）")
        return 1
    if not diff_ok:
        log(
            f"FAIL: 差异 {cmp['diffPct']}% / meanAbs {cmp['meanAbsDiff']} 超限"
            f"（{MAX_DIFF_PCT}% / {MAX_MEAN_DIFF}）"
        )
        return 1
    log(f"PASS: 画布锚点一致（Δ={cmp['anchorMaxAbsDiff']}），差异 {cmp['diffPct']}% 在阈值内")
    return 0


if __name__ == "__main__":
    sys.exit(main())