#!/usr/bin/env python3
"""dshell 终端画布颜色实测审计。

在运行中的 bb（dev server / harness 通用）里用 Playwright 打开真实终端，
对 xterm 渲染结果做像素级采样（WebGL 渲染器不可读 canvas 2d，改用合成截图）：

  * ANSI 亮青文本（printf '\\033[96m…'）  —— 断言 ≈ --dsh-ansi-14
  * 光标块（textarea 定位格 + 抗闪烁）     —— 断言 ≈ --dsh-term-cursor
  * 选区（双击选中亮青词）                —— 断言 ≈ --dsh-term-selection
                                           0.4 透明度叠到画布底上的合成色

期望值来自 dshell.css 第 12 段令牌（oklch → sRGB 换算），暗/亮外观各跑一遍。

用法：
  BB_E2E_THREAD=/projects/<proj>/threads/<thr> \
    python3 scripts/dshell-term-color-audit.py [--url http://127.0.0.1:18154]

退出码：0 = 全部 PASS；1 = 任一 FAIL（可直接接 CI/门禁）。
"""

import argparse
import math
import re
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parent.parent
DSHELL_CSS = REPO / "apps/app/src/components/ui/dshell/dshell.css"
THREAD = None  # 由 BB_E2E_THREAD 提供
BASE = "http://127.0.0.1:18154"

failures: list[str] = []
passed: list[str] = []


# ---------------------------------------------------------------- oklch → sRGB
def oklch_to_srgb(l: float, c: float, h: float, alpha: float = 1.0) -> tuple[int, int, int, int]:
    """oklch → sRGB 8bit（含可选 alpha）。标准 OKLab 矩阵逆变换。"""
    a = c * math.cos(math.radians(h))
    b = c * math.sin(math.radians(h))
    ll = l + 0.3963377774 * a + 0.2158037573 * b
    mm = l - 0.1055613458 * a - 0.0638541728 * b
    ss = l - 0.0894841775 * a - 1.2914855480 * b
    ll, mm, ss = ll ** 3, mm ** 3, ss ** 3
    r = 4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss
    g = -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss
    bch = -0.0041960863 * ll - 0.7034186147 * mm + 1.7076147010 * ss

    def enc(x: float) -> int:
        x = min(max(x, 0.0), 1.0)
        v = 12.92 * x if x <= 0.0031308 else 1.055 * (x ** (1 / 2.4)) - 0.055
        return round(v * 255)

    return enc(r), enc(g), enc(bch), round(alpha * 255)


OKLCH_RE = re.compile(r"oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*/\s*([\d.]+))?\s*\)")


def parse_oklch(raw: str) -> tuple[float, float, float, float]:
    m = OKLCH_RE.search(raw)
    if not m:
        raise ValueError(f"无法解析 oklch: {raw}")
    return float(m.group(1)), float(m.group(2)), float(m.group(3)), float(m.group(4) or "1")


def css_block(css: str, selector: str, first: bool = False) -> str:
    """按选择器取大括号块（无嵌套），找不到返回 ''。同名选择器：first=True 取第一次
    （环境令牌段），否则取最后一次（第 12 段 xterm 令牌段）。"""
    idx = css.find(selector) if first else css.rfind(selector)
    if idx < 0:
        return ""
    open_b = css.find("{", idx)
    depth = 0
    for i in range(open_b, len(css)):
        if css[i] == "{":
            depth += 1
        elif css[i] == "}":
            depth -= 1
            if depth == 0:
                return css[open_b + 1 : i]
    return ""


def var_in(block: str, name: str) -> str | None:
    m = re.search(rf"{re.escape(name)}:\s*([^;]+);", block)
    return m.group(1).strip() if m else None


def resolve_theme_tokens(theme: str) -> dict[str, tuple[int, int, int, int]]:
    """解析第 12 段令牌 + --dsh-cyan，返回名字 → sRGB(A)。"""
    css = DSHELL_CSS.read_text()
    base12 = css_block(css, "html.dshell {")          # 第 12 段（fg/ansi）
    env1 = css_block(css, "html.dshell {", first=True)  # 第 1 段（--dsh-cyan 暗色）
    dark12 = css_block(css, "html.dshell.dark {")
    light12 = css_block(css, "html.dshell:not(.dark) {")          # 第 12 段（亮）
    light3 = css_block(css, "html.dshell:not(.dark) {", first=True)  # 第 3 段（亮 --dsh-cyan）

    # --dsh-cyan：暗色在环境段；亮色在第 3 段
    cyan_raw = var_in(env1 if theme == "dark" else light3, "--dsh-cyan")
    cursor_raw = var_in(dark12 if theme == "dark" else light12, "--dsh-term-cursor")

    def to_rgba(raw: str | None) -> tuple[int, int, int, int]:
        if raw is None:
            raise ValueError(f"缺少令牌原始值: {raw}")
        if raw.startswith("var("):
            inner = re.match(r"var\(--([\w-]+)\)", raw)
            resolved = (
                var_in(env1, f"--{inner.group(1)}")
                or var_in(base12, f"--{inner.group(1)}")
                or var_in(light3, f"--{inner.group(1)}")
                if inner
                else None
            )
            if resolved is None:
                raise ValueError(f"无法解析 var 引用: {raw}")
            raw = resolved
        return oklch_to_srgb(*parse_oklch(raw))

    # 区块归属：term-* 在 dark/light 块；fg/ansi 在第 12 段
    term_block = dark12 if theme == "dark" else light12
    fg_raw = var_in(base12, "--dsh-term-fg")
    ansi14_raw = var_in(base12, "--dsh-ansi-14")
    assert fg_raw and ansi14_raw, "第 12 段缺 --dsh-term-fg / --dsh-ansi-14"

    tokens = {
        "bg": to_rgba(var_in(term_block, "--dsh-term-bg")),
        "fg": to_rgba(fg_raw),
        "cursor": to_rgba(cursor_raw),
        "cursor_accent": to_rgba(var_in(term_block, "--dsh-term-cursor-accent")),
        "selection": to_rgba(var_in(term_block, "--dsh-term-selection")),
        "ansi14": to_rgba(ansi14_raw),
        "cyan": to_rgba(cyan_raw),
    }
    return tokens


def hex4(c: tuple[int, int, int, int]) -> str:
    r, g, b, a = c
    return f"#{r:02x}{g:02x}{b:02x}" + ("" if a == 255 else f"@{a / 255:.2f}")


def drgb(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    return max(abs(a[i] - b[i]) for i in range(3))


# ------------------------------------------------------------------ Playwright
def boot(page, mode: str, theme: str, route: str) -> None:
    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=60000)
    page.evaluate(
        """([m]) => {
          try { localStorage.setItem("bb.dshell.enabled", m); } catch {}
          document.documentElement.classList.remove("dark", "light", "dshell");
        }""",
        [mode],
    )
    page.goto(BASE + route, wait_until="domcontentloaded", timeout=60000)
    try:
        page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass
    page.wait_for_timeout(3500)
    page.evaluate(
        """(t) => { const h = document.documentElement; h.classList.remove("dark","light"); h.classList.add(t); }""",
        theme,
    )
    page.wait_for_timeout(900)


PANEL_FIND_JS = """() => {
  const vw = innerWidth;
  return [...document.querySelectorAll('[data-panel-id="thread-detail-secondary-panel"] aside')]
    .find(a => { const r = a.getBoundingClientRect(); return r.width > 150 && r.right > 80 && r.left < vw && r.bottom > 50; }) || null;
}"""


def ensure_panel_open(page) -> bool:
    for _ in range(8):
        if page.evaluate(PANEL_FIND_JS):
            return True
        page.keyboard.press("Meta+J")
        page.wait_for_timeout(800)
    return False


def open_terminal(page) -> bool:
    if not ensure_panel_open(page):
        return False
    for _ in range(3):  # 整体重试：面板状态偶尔残留导致 Start terminal 入口不出现
        ok = _open_terminal_once(page)
        if ok:
            return True
        # 复位面板再试：收起再展开，清掉残留的新建 tab 视图
        try:
            page.keyboard.press("Escape")
        except Exception:
            pass
        page.wait_for_timeout(800)
        page.keyboard.press("Meta+J")
        page.wait_for_timeout(1200)
        page.keyboard.press("Meta+J")
        page.wait_for_timeout(1200)
    return False


def _open_terminal_once(page) -> bool:
    for _ in range(10):
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
        # 等 .terminal.xterm 真正挂载（最长 ~4s），不再固定睡 1.5s
        for _ in range(8):
            page.wait_for_timeout(500)
            if page.evaluate(
                """() => !!document.querySelector('.terminal.xterm')"""
            ):
                page.wait_for_timeout(800)  # 等 prompt 首帧
                return True
    return False


def screen_shot(page) -> tuple[dict, "Image.Image"]:
    """截取 .xterm-screen 合成画面（WebGL 渲染器无法直接读 canvas 像素）。"""
    rect = page.evaluate(
        """() => {
          const s = document.querySelector('.terminal.xterm .xterm-screen');
          if (!s) return null;
          const r = s.getBoundingClientRect();
          return {x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height)};
        }"""
    )
    if not rect:
        return None, None
    png = page.screenshot(clip=rect)
    from io import BytesIO
    img = Image.open(BytesIO(png)).convert("RGB")
    return rect, img


def cursor_cell(page, rect) -> tuple[int, int, int, int] | None:
    """从 xterm 辅助 textarea 读光标格（left/top/width/height → 截图像素盒）。"""
    pos = page.evaluate(
        """() => {
          const t = document.querySelector('.xterm-helper-textarea');
          if (!t) return null;
          const s = t.style;
          const left = parseInt(s.left, 10), top = parseInt(s.top, 10);
          const w = parseInt(s.width, 10), h = parseInt(s.height, 10);
          if (isNaN(left) || isNaN(top) || w <= 0 || h <= 0) return null;
          return {left, top, w, h};
        }"""
    )
    if not pos:
        return None
    return (pos["left"], pos["top"], pos["left"] + pos["w"], pos["top"] + pos["h"])


def cell_modal(img, box) -> tuple[tuple[int, int, int], int]:
    """格内主色：全像素直方图取众数，返回 (color, 占比)。"""
    x0, y0, x1, y1 = box
    crop = img.crop((x0, y0, x1, y1))
    counts: dict[tuple[int, int, int], int] = {}
    for px in crop.getdata():
        counts[px] = counts.get(px, 0) + 1
    if not counts:
        return (0, 0, 0), 0
    top = max(counts, key=counts.get)
    total = crop.width * crop.height
    return top, counts[top] / total


def scan_color(
    img,
    target: tuple[int, int, int],
    tol: int,
    exclude: tuple[int, int, int, int] | None = None,
) -> tuple[int, tuple[int, int, int] | None, tuple[int, int, int, int] | None]:
    """全图扫描接近 target 的像素（可排除光标格）：返回 (count, modal, bbox(x0,y0,x1,y1))。"""
    w, h = img.size
    px = img.load()
    hits: list[tuple[int, int, int]] = []
    xs: list[int] = []
    ys: list[int] = []
    for y in range(h):
        for x in range(w):
            if exclude and exclude[0] <= x <= exclude[2] and exclude[1] <= y <= exclude[3]:
                continue
            c = px[x, y]
            if drgb(c, target) <= tol:
                hits.append(c)
                xs.append(x)
                ys.append(y)
    if not hits:
        return 0, None, None
    med = tuple(sorted(v)[len(v) // 2] for v in zip(*hits))
    return len(hits), med, (min(xs), min(ys), max(xs), max(ys))


def close_terminal(page) -> None:
    """尽力关闭终端会话，避免后续 glass_tab_* 场景的 tab 残留。"""
    try:
        page.evaluate(
            """() => {
              const vw = innerWidth;
              const a = [...document.querySelectorAll('[data-panel-id="thread-detail-secondary-panel"] aside')]
                .find(x => { const r = x.getBoundingClientRect(); return r.width > 150 && r.right > 80 && r.left < vw && r.bottom > 50; });
              if (!a) return;
              const close = [...a.querySelectorAll("button")].find(x =>
                (x.getAttribute("aria-label") || "").startsWith("Close "));
              if (close) close.click();
            }"""
        )
        page.wait_for_timeout(1200)
    except Exception:
        pass


def probe(theme: str, tokens: dict) -> int:
    scene = f"term_{theme}"
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        boot(page, "on", theme, THREAD)
        if not open_terminal(page):
            failures.append(f"{scene}: 终端未能打开")
            browser.close()
            return 1

        # 聚焦终端并输入 ANSI 亮青文本 + 换行
        rect, _ = screen_shot(page)
        if not rect:
            failures.append(f"{scene}: 未找到 xterm-screen")
            browser.close()
            return 1
        page.mouse.click(rect["x"] + 60, rect["y"] + 60)
        page.wait_for_timeout(400)
        page.keyboard.type(r"printf '\033[96mBRIGHT_CYAN_MARKER\033[0m'")
        page.keyboard.press("Enter")

        # 轮询等待亮青文本出现（最多 ~8s）——自定位，不依赖输出行号；
        # 排除光标格（暗色光标==ansi-14，亮色光标在容差内，会抢先满足扫描）。
        exp_cyan = tokens["ansi14"]
        cnt, med, bbox = 0, None, None
        img = None
        cell = cursor_cell(page, rect)
        for _ in range(16):
            page.wait_for_timeout(500)
            rect, img = screen_shot(page)
            if img is None:
                continue
            cell = cell or cursor_cell(page, rect)
            cnt, med, bbox = scan_color(img, (exp_cyan[0], exp_cyan[1], exp_cyan[2]), 40, exclude=cell)
            if cnt > 30 and bbox and (bbox[2] - bbox[0]) >= 40:  # 真实文本跑，非光标块
                break
        if img is None:
            failures.append(f"{scene}: 未找到 xterm-screen")
            browser.close()
            return 1

        # T1 亮青文本断言
        if cnt <= 30:
            failures.append(f"{scene}/ansi-cyan: 亮青像素不足 cnt={cnt}")
        else:
            delta = drgb(med, exp_cyan[:3])
            if delta <= 14:
                passed.append(
                    f"{scene}/ansi-cyan 亮青文本 modal={hex4(med + (255,))} 期望={hex4(exp_cyan)} Δ={delta:.0f} cnt={cnt}"
                )
            else:
                failures.append(f"{scene}/ansi-cyan: modal={hex4(med + (255,))} 期望={hex4(exp_cyan)} Δ={delta:.0f}")

        # T2 光标块：textarea 定位格 + 多截图抗闪烁
        exp_cursor = tokens["cursor"]
        cell = cursor_cell(page, rect)
        cursor_modal = None
        cursor_fill = 0.0
        if cell:
            for _ in range(4):
                _r, imgc = screen_shot(page)
                if imgc is None:
                    continue
                m, fill = cell_modal(imgc, cell)
                cursor_modal, cursor_fill = m, fill
                if drgb(m, exp_cursor[:3]) <= 20 and fill > 0.3:
                    break
                page.wait_for_timeout(450)  # 等下一闪烁相位
        if cursor_modal is None:
            failures.append(f"{scene}/cursor: textarea 光标格未定位")
        else:
            delta = drgb(cursor_modal, exp_cursor[:3])
            if delta <= 14:
                passed.append(
                    f"{scene}/cursor 光标块 modal={hex4(cursor_modal + (255,))} 期望={hex4(exp_cursor)} Δ={delta:.0f} fill={cursor_fill:.0%}"
                )
            else:
                failures.append(
                    f"{scene}/cursor: modal={hex4(cursor_modal + (255,))} 期望={hex4(exp_cursor)} Δ={delta:.0f} fill={cursor_fill:.0%}"
                )

        # T3 选区：从亮青词起点拖到下方空行（选区带覆盖大片空 cell，合成色纯正）
        exp_sel = tokens["selection"]
        exp_bg = tokens["bg"]
        exp_comp = (
            round(exp_sel[0] * exp_sel[3] / 255 + exp_bg[0] * (1 - exp_sel[3] / 255)),
            round(exp_sel[1] * exp_sel[3] / 255 + exp_bg[1] * (1 - exp_sel[3] / 255)),
            round(exp_sel[2] * exp_sel[3] / 255 + exp_bg[2] * (1 - exp_sel[3] / 255)),
        )
        scnt, smed, sbbox = 0, None, None
        sel_modal = None  # 差分区内主色（实测选区带颜色，诊断用）
        if bbox:
            _r, s_before = screen_shot(page)
            x0 = rect["x"] + bbox[0]
            y0 = rect["y"] + bbox[1]
            x1 = min(rect["x"] + bbox[2] + 60, rect["x"] + rect["width"] - 4)
            y1 = min(rect["y"] + bbox[3] + 80, rect["y"] + rect["height"] - 4)
            page.mouse.move(x0, y0)
            page.mouse.down()
            page.mouse.move(x1, y1, steps=6)
            page.mouse.up()
            page.wait_for_timeout(600)
            _r, imgs = screen_shot(page)
            if imgs is not None:
                # 差分定位选区带，再在其内扫描合成色；差分区主色作为实测选区带颜色
                from PIL import ImageChops
                diff = ImageChops.difference(imgs, s_before)
                dbox = diff.getbbox()
                if dbox:
                    crop = imgs.crop(dbox)
                    sel_modal, _ = cell_modal(crop, (0, 0, crop.width, crop.height))
                    scnt, smed, sbbox = scan_color(crop, exp_comp, 25)
                    if sbbox:  # 坐标转回全图
                        sbbox = (sbbox[0] + dbox[0], sbbox[1] + dbox[1], sbbox[2] + dbox[0], sbbox[3] + dbox[1])
                else:
                    scnt, smed, sbbox = scan_color(imgs, exp_comp, 25)
        if scnt <= 60:
            hint = ""
            if sel_modal is not None:
                # xterm 默认选区 = 白 @~30% 叠底色；--dsh-term-selection 未生效时即此灰
                default = tuple(round(255 * 0.3 + exp_bg[i] * 0.7) for i in range(3))
                if drgb(sel_modal, default) <= 12:
                    hint = f" —— 选区实测为 xterm 默认灰白 {hex4(sel_modal + (255,))}≈white@30%，--dsh-term-selection 未生效（可能 xterm6-beta/WebGL 选区色路径问题）"
                else:
                    hint = f" —— 选区实测主色 {hex4(sel_modal + (255,))}，期望合成 {hex4(exp_comp + (255,))}"
            failures.append(f"{scene}/selection: 选区合成色像素不足 cnt={scnt}{hint}")
        else:
            delta = drgb(smed, exp_comp)
            if delta <= 12:
                passed.append(
                    f"{scene}/selection 选区合成 modal={hex4(smed + (255,))} 期望={hex4(exp_comp + (255,))} Δ={delta:.0f} cnt={scnt}"
                )
            else:
                failures.append(
                    f"{scene}/selection: modal={hex4(smed + (255,))} 期望={hex4(exp_comp + (255,))} Δ={delta:.0f} cnt={scnt}"
                )

        close_terminal(page)
        browser.close()

    return 0


def main() -> int:
    global THREAD, BASE
    ap = argparse.ArgumentParser(description="dshell 终端画布颜色实测审计")
    ap.add_argument("--url", default=BASE)
    ap.add_argument("--theme", choices=["dark", "light", "both"], default="both")
    args = ap.parse_args()
    BASE = args.url
    THREAD = __import__("os").environ.get("BB_E2E_THREAD")
    if not THREAD:
        print("需要 BB_E2E_THREAD=/projects/<proj>/threads/<thr> 指向真实线程", file=sys.stderr)
        return 2

    themes = ["dark", "light"] if args.theme == "both" else [args.theme]
    rc = 0
    for theme in themes:
        try:
            tokens = resolve_theme_tokens(theme)
        except Exception as e:  # noqa: BLE001
            failures.append(f"token 解析失败({theme}): {e}")
            rc = 1
            continue
        print(f"== {theme} 令牌（oklch→sRGB） ==")
        for k, v in tokens.items():
            print(f"   {k:16s} {hex4(v)}")
        rc |= probe(theme, tokens)
        print()

    print(f"结果: PASS={len(passed)}  FAIL={len(failures)}")
    for f in failures:
        print(f"  FAIL {f}")
    return 0 if rc == 0 and not failures else 1


if __name__ == "__main__":
    sys.exit(main())