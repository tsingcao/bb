#!/usr/bin/env python3
"""dshell 皮肤层 headless Playwright 快照回归测试。

用法:
  python3 scripts/dshell-skin-snapshot.py [--check|--update] [--scene NAME] [--url http://127.0.0.1:18154]

- 默认 --check：把当前渲染与 docs/dshell-skin-shots/auto/ 基线比对（区域像素 diff +
  终端画布颜色断言），回归时输出 .diff 报告并返回非 0。
- --update：把当前渲染写为新基线（皮肤有意改动后校准用）。
- 线程相关场景需要 BB_E2E_THREAD=<thread url>（如 /projects/.../threads/thr_xxx），
  未设置时自动跳过（home/settings/rail 场景不依赖线程）。
- glass_tab_* 逐 tab 玻璃 chrome 场景（info/diff/sidechat × dark/light）：驱动右面板
  到目标 tab 状态，只比对顶部 chrome 条（tab 行，内容区实时数据不做像素比对），
  另加确定性功能断言（根 backdrop-filter blur、chrome 0.58 / content 0.84·0.88 玻璃
  alpha、light 逐文本 WCAG 对比 0 失败、sidechat hasChat）。CSS 回归必现其一。

退出码: 0 全绿 / 1 渲染回归 / 2 基线缺失或环境错误
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

# --- 解释器自举：系统 python3 可能缺 playwright/Pillow，找有依赖的解释器重执行 ---
try:
    from PIL import Image, ImageChops, ImageStat  # noqa: F401
    import playwright  # noqa: F401

    _DEPS_OK = True
except ImportError:
    _DEPS_OK = False

if not _DEPS_OK:
    import shutil
    import subprocess

    candidates = [os.environ.get("BB_PY", "")] + ["python3", "python3.12", "python3.11", "python3.10"]
    for cand in candidates:
        if not cand:
            continue
        path = shutil.which(cand) or (cand if os.path.exists(cand) else None)
        if not path:
            continue
        try:
            probe = subprocess.run(
                [path, "-c", "import playwright, PIL"],
                capture_output=True, timeout=15,
            )
        except Exception:
            continue
        if probe.returncode == 0:
            os.execv(path, [path, *sys.argv])
    print(
        "需要带 playwright + Pillow 的 Python 解释器。"
        "设置 BB_PY 指定（如 BB_PY=/Users/timcao/.local/bin/python3 再跑）。",
        file=sys.stderr,
    )
    sys.exit(2)

REPO_ROOT = Path(__file__).resolve().parent.parent
AUTO_DIR = REPO_ROOT / "docs" / "dshell-skin-shots" / "auto"
DIFF_DIR = AUTO_DIR / ".diff"
GALLERY_DIR = REPO_ROOT / "docs" / "dshell-skin-shots"

THREAD = os.environ.get("BB_E2E_THREAD", "").strip()
BASE = os.environ.get("BB_URL", "http://127.0.0.1:18154")

# 皮肤自身的稳定表面（人工 gallery 的同名场景），见 docs/dshell-skin-shots/README.md
GALLERY_SCENES = [
    "final_dark_home", "final_light_home",
    "dshell_settings_original_dark", "dshell_settings_always_dark",
    "dshell_settings_auto_light", "dshell_settings_auto_dark",
    "rail_full", "rail_icon", "rail_peek",
    "glass_dark_terminal", "glass_light_terminal",
    "glass_tab_info", "glass_tab_diff", "glass_tab_terminal", "glass_tab_sidechat",
    "glass_tab_info_light", "glass_tab_diff_light", "glass_tab_sidechat_light",
    "term_canvas_dark", "term_canvas_light", "term_canvas_off",
]

MAX_DIFF_PCT = 0.5   # 差异像素(>12/255)占比上限 %
MAX_MEAN_DIFF = 1.5  # 平均绝对差上限 (0-255)
PASS = 0
FAIL_REGRESSION = 1
FAIL_MISSING = 2

failures: list[str] = []
skips: list[str] = []
missing_baselines: list[str] = []
UPDATE_MODE = False


def log(msg: str) -> None:
    print(msg, flush=True)


def boot(page, mode: str, theme: str, route: str) -> None:
    """先落盘皮肤偏好再整页 reload，保证 dshell.ts 启动即按偏好应用。"""
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


def element_rect(page, selector: str):
    return page.evaluate(
        """(sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)};
        }""",
        selector,
    )


def capture_region(page, shot_path: str, rect: dict, max_w: int = 1920, max_h: int = 1000) -> None:
    x = max(rect["x"], 0)
    y = max(rect["y"], 0)
    w = min(rect["w"], max_w - x)
    h = min(rect["h"], max_h - y)
    page.screenshot(
        path=shot_path,
        clip={"x": x, "y": y, "width": w, "height": h},
    )


def compare_region(scene: str, region: str, shot: Path) -> None:
    baseline = AUTO_DIR / f"{scene}__{region}.png"
    if UPDATE_MODE:
        AUTO_DIR.mkdir(parents=True, exist_ok=True)
        shot.replace(baseline)
        log(f"  [WRITE] {scene}/{region}")
        return
    if not baseline.exists():
        missing_baselines.append(f"{scene}/{region}: 基线缺失 {baseline.name}（用 --update 校准）")
        return
    a = Image.open(baseline).convert("RGB")
    b = Image.open(shot).convert("RGB")
    if a.size != b.size:
        failures.append(
            f"{scene}/{region}: 尺寸不一致 {a.size} vs {b.size}（布局回归？）"
        )
        return
    diff = ImageChops.difference(a, b)
    stat = ImageStat.Stat(diff)
    mean = float(stat.mean[0])
    gray = diff.convert("L")
    px = list(gray.getdata())
    diff_pct = 100.0 * sum(1 for v in px if v > 12) / len(px)
    ok = diff_pct <= MAX_DIFF_PCT and mean <= MAX_MEAN_DIFF
    mark = "PASS" if ok else "FAIL"
    log(f"  [{mark}] {scene}/{region}  mean={mean:.2f}  diffPx={diff_pct:.2f}%")
    if not ok:
        failures.append(f"{scene}/{region}: mean={mean:.2f} diffPx={diff_pct:.2f}%")
        DIFF_DIR.mkdir(parents=True, exist_ok=True)
        # 双图并排 + 差异高亮，便于人工定位
        canvas = Image.new("RGB", (a.width * 2, a.height), (18, 22, 34))
        canvas.paste(a, (0, 0))
        canvas.paste(b, (a.width, 0))
        heat = gray.point(lambda v: 0 if v <= 12 else min(255, 60 + v * 3))
        red = Image.merge("RGB", (heat, Image.new("L", heat.size, 30), Image.new("L", heat.size, 40)))
        canvas.paste(red, (a.width, 0))
        canvas.save(DIFF_DIR / f"{scene}__{region}.diff.png")


def check_skin_identity(page, theme: str, scene: str) -> None:
    """确定性功能断言：玻璃/终端令牌是否解析（不依赖像素内容）。"""
    info = page.evaluate(
        """() => {
          const cs = getComputedStyle(document.documentElement);
          const root = document.querySelector('[data-panel-id="thread-detail-secondary-panel"]');
          const rc = root ? getComputedStyle(root) : null;
          return {
            dshell: document.documentElement.classList.contains("dshell"),
            termBg: cs.getPropertyValue("--dsh-term-bg").trim(),
            panelBlur: rc ? rc.backdropFilter : null,
            panelTrans: rc ? rc.transitionProperty : null,
            panelDur: rc ? rc.transitionDuration.split(",")[0].trim() : null,
          };
        }"""
    )
    ok = True
    if not info["dshell"]:
        failures.append(f"{scene}: dshell 类未生效")
        ok = False
    if "blur" not in (info["panelBlur"] or ""):
        failures.append(f"{scene}: 面板根缺失 backdrop-filter（{info['panelBlur']}）")
        ok = False
    if "flex-basis" not in (info["panelTrans"] or ""):
        failures.append(f"{scene}: 面板过渡未含 flex-basis（{info['panelTrans']}）")
        ok = False
    if info["panelDur"] not in ("0.22s", "220ms"):
        failures.append(f"{scene}: 面板过渡时长未跟随 --panel-collapse-duration（{info['panelDur']}）")
        ok = False
    if theme == "dark" and info["termBg"] == "":
        failures.append(f"{scene}: --dsh-term-bg 未解析")
        ok = False
    log(f"  [{'PASS' if ok else 'FAIL'}] {scene}/identity  dshell={info['dshell']} panelBlur={info['panelBlur']} dur={info['panelDur']}")


def dominant_color(page, selector: str) -> tuple | None:
    rect = element_rect(page, selector)
    if not rect or rect["w"] < 10 or rect["h"] < 10:
        return None
    tmp = Path("/tmp") / f"dshell_dom_{int(time.time()*1000)}.png"
    capture_region(page, str(tmp), rect)
    img = Image.open(tmp).convert("RGB")
    px = list(img.getdata())
    from collections import Counter
    return Counter(px).most_common(1)[0][0]


def scene_home(theme: str) -> None:
    scene = "final_dark_home" if theme == "dark" else "final_light_home"
    with playwright_sync() as page:
        boot(page, "on", theme, "/")
        regions = {
            "sidebar": '[data-sidebar="panel"]',
            "dock": 'nav[data-testid="sidebar-navigation-region"]',
        }
        for region, sel in regions.items():
            rect = element_rect(page, sel)
            if not rect:
                failures.append(f"{scene}/{region}: 元素未找到 {sel}")
                continue
            shot = Path("/tmp") / f"{scene}__{region}.png"
            capture_region(page, str(shot), rect)
            compare_region(scene, region, shot)


def scene_settings(mode: str, theme: str) -> None:
    scene = {
        ("off", "dark"): "dshell_settings_original_dark",
        ("on", "dark"): "dshell_settings_always_dark",
        ("auto", "light"): "dshell_settings_auto_light",
        ("auto", "dark"): "dshell_settings_auto_dark",
    }[(mode, theme)]
    with playwright_sync() as page:
        boot(page, mode, theme, "/settings/appearance")
        rect = element_rect(page, '[data-testid="dshell-appearance-setting"]')
        if not rect:
            # 回退：按文本定位皮肤设置卡
            rect = page.evaluate(
                """() => {
                  const els = [...document.querySelectorAll("*")].filter(e =>
                    (e.textContent || "").includes("DSH / NEXTLoop skin") && e.children.length <= 2);
                  const el = els[els.length - 1];
                  if (!el) return null;
                  const r = el.getBoundingClientRect();
                  return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)};
                }"""
            )
        if not rect:
            failures.append(f"{scene}/card: 皮肤设置卡未找到")
        else:
            shot = Path("/tmp") / f"{scene}__card.png"
            capture_region(page, str(shot), rect)
            compare_region(scene, "card", shot)
        # 侧栏也是皮肤面
        rect = element_rect(page, '[data-sidebar="panel"]')
        if rect:
            shot = Path("/tmp") / f"{scene}__sidebar.png"
            capture_region(page, str(shot), rect)
            compare_region(scene, "sidebar", shot)


def scene_rail(state: str) -> None:
    scene = f"rail_{state}"
    with playwright_sync() as page:
        boot(page, "on", "dark", "/")
        toggle = page.locator('[data-testid="sidebar-rail-toggle"]')
        if state == "full":
            # 已折叠（icon rail）才展开
            if page.evaluate("() => !!document.querySelector('[data-collapsible=\"icon\"]')"):
                page.evaluate("() => document.querySelector('[data-testid=sidebar-rail-toggle]')?.click()")
                page.wait_for_timeout(700)
        elif state == "icon":
            page.evaluate("() => document.querySelector('[data-testid=sidebar-rail-toggle]')?.click()")
            page.wait_for_timeout(700)
        elif state == "peek":
            page.evaluate("() => document.querySelector('[data-testid=sidebar-rail-toggle]')?.click()")
            page.wait_for_timeout(600)
            rect = element_rect(page, '[data-sidebar="panel"]')
            if rect:
                page.mouse.move(12, rect["y"] + rect["h"] // 2)  # 先移出
                page.wait_for_timeout(250)
                page.mouse.move(rect["x"] + 20, rect["y"] + rect["h"] // 2)
                page.wait_for_timeout(500)
        rect = element_rect(page, '[data-sidebar="panel"]')
        if not rect:
            failures.append(f"{scene}/sidebar: 侧栏未找到")
        else:
            shot = Path("/tmp") / f"{scene}__sidebar.png"
            capture_region(page, str(shot), rect)
            compare_region(scene, "sidebar", shot)


def scene_panel_glass(theme: str, thread: str) -> None:
    scene = "glass_dark_terminal" if theme == "dark" else "glass_light_terminal"
    with playwright_sync() as page:
        boot(page, "on", theme, thread)
        if not open_terminal(page):
            skips.append(f"{scene}: 无法打开终端，跳过")
            return
        root_rect = element_rect(page, '[data-panel-id="thread-detail-secondary-panel"]')
        if not root_rect:
            failures.append(f"{scene}/root: 面板未找到")
            return
        # chrome 顶条（58% 玻璃，稳定）
        chrome = {**root_rect, "h": min(root_rect["h"], 56)}
        shot = Path("/tmp") / f"{scene}__chrome.png"
        capture_region(page, str(shot), chrome)
        compare_region(scene, "chrome", shot)
        # 面板左缘 40px 竖列（玻璃 tint + 青色发丝边框）
        edge = {"x": root_rect["x"], "y": root_rect["y"] + 56, "w": 40, "h": root_rect["h"] - 56}
        shot = Path("/tmp") / f"{scene}__edge.png"
        capture_region(page, str(shot), edge)
        compare_region(scene, "edge", shot)
        # 终端画布底色断言（画布逐格绘制，内容易变 → 断言色值）
        dom = dominant_color(page, ".terminal.xterm")
        expected = (8, 11, 18) if theme == "dark" else (9, 13, 20)
        if dom is None:
            failures.append(f"{scene}/canvas: 终端画布不可见")
        elif not all(abs(c - e) <= 7 for c, e in zip(dom, expected)):
            failures.append(f"{scene}/canvas: 画布底色 {dom} ≠ 预期 {expected}（主题回归？）")
        else:
            log(f"  [PASS] {scene}/canvas  dominant={dom}")


def open_terminal(page) -> bool:
    for _ in range(16):
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
              for (const pre of ["Show thread info panel", "Show diff panel"]) {
                const b = [...f.querySelectorAll("button")].find(x => (x.getAttribute("aria-label") || "").startsWith(pre));
                if (b && b.getAttribute("aria-pressed") === "true") b.click();
              }
            }"""
        )
        page.wait_for_timeout(1400)
        act = page.get_by_role("button", name=re.compile("Start terminal", re.I))
        if act.count():
            act.first.click()
        page.wait_for_timeout(1500)
    return False


# ---------- 逐 tab 玻璃 chrome 场景（info/diff/sidechat × dark/light）----------
# 设计：内容区（git 文件清单、终端、聊天正文）是实时数据，不做像素比对；
# 只比对顶部 chrome 条（tab 行，稳定）+ 确定性功能断言（根 blur、玻璃 alpha、
# light 逐文本对比、hasChat/内容签名），CSS 回归必然体现其一。

GLASS_STATE_JS = r"""() => {
  const vw = innerWidth;
  const f = [...document.querySelectorAll('[data-panel-id="thread-detail-secondary-panel"] aside')]
    .find(a => { const r = a.getBoundingClientRect(); return r.width > 150 && r.right > 80 && r.left < vw && r.bottom > 50; });
  if (!f) return null;
  const chrome = f.querySelector('.shrink-0.select-none.bg-sidebar');
  const content = f.querySelector(':scope > div.flex.min-h-0.flex-1.flex-col.overflow-hidden.bg-sidebar');
  const cs = (el) => el ? getComputedStyle(el).backgroundColor : null;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  function sample(color) { ctx.clearRect(0,0,1,1); ctx.fillStyle = color; ctx.fillRect(0,0,1,1); const d = ctx.getImageData(0,0,1,1).data; return [d[0],d[1],d[2]]; }
  function effBg(el) {
    ctx.clearRect(0,0,1,1);
    const base = getComputedStyle(document.body).backgroundColor;
    if (base && base !== 'rgba(0, 0, 0, 0)' && base !== 'transparent') { ctx.fillStyle = base; ctx.fillRect(0,0,1,1); }
    const chain = []; let p = el;
    while (p && p !== document.body) { chain.push(p); p = p.parentElement; }
    for (const n of chain.reverse()) { const c = getComputedStyle(n).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { ctx.fillStyle = c; ctx.fillRect(0,0,1,1); } }
    const d = ctx.getImageData(0,0,1,1).data; return [d[0],d[1],d[2]];
  }
  function lum(c) { const f = c.map(v => { v/=255; return v <= 0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); });
    return 0.2126*f[0] + 0.7152*f[1] + 0.0722*f[2]; }
  function ratio(a,b) { const l1 = lum(a), l2 = lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); }
  let checked = 0; const fails = [];
  const root = content || f;
  if (root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode(n) {
      const t = (n.textContent || '').trim();
      if (!t) return NodeFilter.FILTER_REJECT;
      if (n.parentElement && n.parentElement.closest('.terminal.xterm,[contenteditable],textarea,pre,code')) return NodeFilter.FILTER_REJECT;
      const r = n.parentElement.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT; } });
    let node;
    while ((node = walker.nextNode()) && checked < 160) {
      const el = node.parentElement; if (!el) continue;
      const st = getComputedStyle(el); const fgC = st.color; if (!fgC) continue;
      const fs = parseFloat(st.fontSize) || 0; const bold = parseInt(st.fontWeight) || 400;
      const large = fs >= 24 || (fs >= 18.66 && bold >= 700);
      let fg, bg;
      try { fg = sample(fgC); } catch (e) { continue; }
      try { bg = effBg(el); } catch (e) { continue; }
      const r = ratio(fg, bg); checked++;
      if (r < (large ? 3.0 : 4.5) && fails.length < 6) fails.push({ ratio: Math.round(r*100)/100,
        txt: (node.textContent||'').trim().replace(/\s+/g,' ').slice(0, 30) });
    }
  }
  const txt = (content ? content.textContent : f.textContent || '').replace(/\s+/g,' ').trim().slice(0, 90);
  return {
    dshell: document.documentElement.classList.contains('dshell'),
    theme: [...document.documentElement.classList].filter(c => c === 'dark' || c === 'light').join(''),
    chromeBg: cs(chrome), contentBg: cs(content),
    hasChat: !!(content && content.querySelector('textarea,[contenteditable="true"],[contenteditable="plaintext-only"]')),
    contrast: { checked, fails },
    txt,
  };
}"""


def css_alpha(color) -> float | None:
    """取颜色串的显式 alpha；无显式 alpha 视为不透明。"""
    if not color:
        return None
    if "/ " in color:  # oklab()/oklch()/color() 形式
        m = re.search(r"/\s*([0-9.]+)\)\s*$", color)
        return float(m.group(1)) if m else 1.0
    return 1.0


def visible_aside_rect(page) -> dict | None:
    return page.evaluate(
        """() => {
          const vw = innerWidth;
          const a = [...document.querySelectorAll('[data-panel-id="thread-detail-secondary-panel"] aside')]
            .find(x => { const r = x.getBoundingClientRect(); return r.width > 150 && r.right > 80 && r.left < vw && r.bottom > 50; });
          if (!a) return null;
          const r = a.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        }"""
    )


def ensure_panel_open(page) -> bool:
    for _ in range(12):
        if visible_aside_rect(page):
            return True
        page.evaluate(
            """() => { const b = [...document.querySelectorAll('button')]
              .find(x => (x.getAttribute('aria-label') || '').startsWith('Show right panel'));
              if (b) b.click(); }"""
        )
        page.wait_for_timeout(1200)
    return False


def click_chrome_tab(page, label_prefix: str) -> bool:
    return page.evaluate(
        """(p) => {
          const vw = innerWidth;
          const a = [...document.querySelectorAll('[data-panel-id="thread-detail-secondary-panel"] aside')]
            .find(x => { const r = x.getBoundingClientRect(); return r.width > 150 && r.right > 80 && r.left < vw && r.bottom > 50; });
          if (!a) return false;
          const b = [...a.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '').startsWith(p));
          if (!b) return false; b.click(); return true;
        }""",
        label_prefix,
    )


def glass_state(page) -> dict | None:
    return page.evaluate(GLASS_STATE_JS)


def scene_glass_tab(tab: str, theme: str) -> None:
    scene = f"glass_tab_{tab}" if theme == "dark" else f"glass_tab_{tab}_light"
    with playwright_sync() as page:
        boot(page, "on", theme, THREAD)
        if not ensure_panel_open(page):
            failures.append(f"{scene}/chrome: 右面板未能打开")
            return
        st = None
        if tab == "info":
            click_chrome_tab(page, "Show thread info panel")
            page.wait_for_timeout(1600)
        elif tab == "diff":
            ok = False
            for _ in range(12):
                click_chrome_tab(page, "Show diff panel")
                page.wait_for_timeout(1600)
                st = glass_state(page)
                if st and "changed files" in st.get("txt", ""):
                    ok = True
                    break
            if not ok:
                failures.append(f"{scene}: Diff 视图未就绪（txt 无 changed files）")
                return
        elif tab == "sidechat":
            opened = False
            for _ in range(20):
                loc = page.get_by_role("button", name=re.compile("Reply in side chat", re.I))
                if loc.count():
                    loc.first.click()
                page.wait_for_timeout(1000)
                st = glass_state(page)
                if st and st.get("hasChat"):
                    opened = True
                    break
            if not opened:
                failures.append(f"{scene}: Side chat 面板未打开（hasChat=false）")
                return
        if st is None:
            page.wait_for_timeout(900)
            st = glass_state(page)
        rect = visible_aside_rect(page)
        if not rect or rect["w"] < 50:
            failures.append(f"{scene}/chrome: 面板未找到")
            return
        chrome_rect = {**rect, "h": min(rect["h"], 48)}  # 顶部 chrome 条（tab 行），避开内容区
        shot = Path("/tmp") / f"{scene}__chrome.png"
        capture_region(page, str(shot), chrome_rect)
        compare_region(scene, "chrome", shot)
        # 确定性功能断言（不依赖内容像素）
        check_skin_identity(page, theme, scene)  # 根 blur / 过渡 / dshell 类
        st = st or glass_state(page)
        exp_content = 0.84 if theme == "dark" else 0.88
        ca = css_alpha((st or {}).get("chromeBg"))
        ba = css_alpha((st or {}).get("contentBg"))
        ok = True
        if ca is None or abs(ca - 0.58) > 0.02:
            ok = False
            failures.append(f"{scene}/glass-alpha: chromeBg={(st or {}).get('chromeBg')}")
        log(f"  [{'PASS' if ok else 'FAIL'}] {scene}/glass-alpha  chrome={ca} content={ba}")
        if (st or {}).get("contentBg"):
            ok = ba is not None and abs(ba - exp_content) <= 0.02
            if not ok:
                failures.append(f"{scene}/content-alpha: contentBg={(st or {}).get('contentBg')} 期望 {exp_content}")
            log(f"  [{'PASS' if ok else 'FAIL'}] {scene}/content-alpha  content={ba} 期望 {exp_content}")
        else:
            failures.append(f"{scene}/content-alpha: 内容容器未找到（contentBg=None）")
            log(f"  [FAIL] {scene}/content-alpha  contentBg=None")
        if theme == "light":
            c = (st or {}).get("contrast") or {}
            ok = c.get("checked", 0) >= 4 and not c.get("fails")
            if not ok:
                failures.append(f"{scene}/light-contrast: checked={c.get('checked')} fails={c.get('fails')}")
            log(f"  [{'PASS' if ok else 'FAIL'}] {scene}/light-contrast  checked={c.get('checked')} fails={c.get('fails')}")
        if tab == "sidechat":
            ok = bool((st or {}).get("hasChat"))
            if not ok:
                failures.append(f"{scene}/has-chat: hasChat={(st or {}).get('hasChat')}")
            log(f"  [{'PASS' if ok else 'FAIL'}] {scene}/has-chat")


class PlaywrightSession:
    """轻量上下文：每个场景独立 browser/page，退出时关闭。"""

    def __init__(self) -> None:
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch()
        self.page = self._browser.new_page(viewport={"width": 1920, "height": 1000})
        self.page.set_default_timeout(30000)

    def __enter__(self):
        return self.page

    def __exit__(self, *exc) -> None:
        self._browser.close()
        self._pw.stop()


def playwright_sync() -> PlaywrightSession:
    return PlaywrightSession()


def main() -> int:
    global BASE
    parser = argparse.ArgumentParser()
    parser.add_argument("--update", action="store_true", help="把当前渲染写为新基线")
    parser.add_argument("--check", action="store_true", help="(默认) 校验模式：与基线比对并报告回归")
    parser.add_argument("--scene", default=None, help="只跑指定场景前缀")
    parser.add_argument("--url", default=BASE)
    args = parser.parse_args()
    global UPDATE_MODE
    UPDATE_MODE = args.update
    BASE = args.url

    AUTO_DIR.mkdir(parents=True, exist_ok=True)

    if not args.update:
        missing_gallery = [s for s in GALLERY_SCENES if not (GALLERY_DIR / f"{s}.png").exists()]
        if missing_gallery:
            log(f"人工 gallery 缺图（需要补拍或改名）：{missing_gallery}")

    def want(scene: str) -> bool:
        return args.scene is None or scene.startswith(args.scene)

    log(f"dshell 皮肤快照回归  url={BASE}  mode={'--update' if args.update else '--check'}")
    if THREAD:
        log(f"线程场景启用（BB_E2E_THREAD={THREAD}）")
    else:
        log("未设置 BB_E2E_THREAD：线程相关场景（玻璃/终端）将跳过")

    if not args.scene or args.scene.startswith("final_dark_home") or args.scene == "home":
        scene_home("dark")
    if not args.scene or args.scene.startswith("final_light_home"):
        scene_home("light")
    for (mode, theme) in [("off", "dark"), ("on", "dark"), ("auto", "light"), ("auto", "dark")]:
        if not args.scene or args.scene.startswith("dshell_settings"):
            scene_settings(mode, theme)
    for state in ("full", "icon", "peek"):
        if not args.scene or args.scene.startswith("rail"):
            scene_rail(state)
    if THREAD:
        if not args.scene or args.scene.startswith("glass_dark_terminal"):
            scene_panel_glass("dark", THREAD)
        if not args.scene or args.scene.startswith("glass_light_terminal"):
            scene_panel_glass("light", THREAD)
        for (tab, theme, name) in [
            ("info", "dark", "glass_tab_info"),
            ("diff", "dark", "glass_tab_diff"),
            ("sidechat", "dark", "glass_tab_sidechat"),
            ("info", "light", "glass_tab_info_light"),
            ("diff", "light", "glass_tab_diff_light"),
            ("sidechat", "light", "glass_tab_sidechat_light"),
        ]:
            if not args.scene or args.scene == name or name.startswith(args.scene):
                scene_glass_tab(tab, theme)
    else:
        skips.append("glass_dark_terminal / glass_light_terminal（无线程）")
        if not args.scene or args.scene.startswith("glass_tab_"):
            skips.append("glass_tab_* 逐 tab 玻璃 chrome（无线程）")

    # 汇总
    log("")
    log(f"结果: FAIL={len(failures)}  SKIP={len(skips)}")
    for s in skips:
        log(f"  skip {s}")
    for f in failures:
        log(f"  FAIL {f}")
    if not args.update:
        for f in missing_baselines:
            log(f"  MISSING {f}")
        if missing_baselines:
            return FAIL_MISSING
        if failures:
            log(f"差异报告: {DIFF_DIR}")
            return FAIL_REGRESSION
    else:
        log(f"基线已写入 {AUTO_DIR}")
    return PASS


if __name__ == "__main__":
    sys.exit(main())
