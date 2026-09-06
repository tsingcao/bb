#!/usr/bin/env python3
"""bb 版对比度审计 —— 把 Control Room 审计器移植到 dshell 皮肤表面（契约 §6 补缺）。

背景（docs/design/dshell_skin_contract.md §6）：bb 侧此前只有像素快照回归，
弱化文本（secondary/边框文字等）靠肉眼 —— 玻璃面上文字对比度没有机器断言。
本脚本用与 scripts/control_room_contrast_audit.py 相同的 computed-style WCAG
审计逻辑，覆盖 dshell 快照的确定性主表面场景（不依赖真实线程内容，本地与 CI
同一可跑集）：

  1. home_dark      （final_dark_home    快照场景同款 boot）
  2. home_light     （final_light_home）
  3. settings_dark  （dshell_settings /settings/appearance，dshell=on）
  4. settings_light （同上，light 外观）
  5. rail_full      （侧栏展开态）
  6. rail_icon      （图标磁贴 rail）
  7. rail_peek      （hover-peek 浮层态）
  8. banner         （一次性迁移横幅 dark + light 两态，legacy "1" seed）

每个场景：boot 皮肤偏好 + 主题 → 注入 JS 遍历可见文本节点，把前景色沿祖先链
合成有效背景（透明逐层 alpha 混合；canvas 采样让浏览器自己解析 oklch/rgb，免去
两侧色彩空间手工换算），按 WCAG 相对亮度算对比度：普通文本 ≥4.5:1、大号文本
（≥24px，或 ≥18.66px 且 ≥700 字重）≥3.0:1。终端/输入/代码编辑区等非皮肤面
文本排除（其颜色由组件自己的主题决定，与 dshell 令牌无关）。

用法:
  python3 scripts/dshell_contrast_audit.py                       # 全场景（默认 http://127.0.0.1:18154）
  python3 scripts/dshell_contrast_audit.py --url http://127.0.0.1:18154
  python3 scripts/dshell_contrast_audit.py --scene home          # 只看某前缀（home/settings/rail/banner）
  python3 scripts/dshell_contrast_audit.py --max-report 10       # 每场景最多打印的失败条数
  BB_URL=http://127.0.0.1:18154 python3 scripts/dshell_contrast_audit.py

退出码: 0 全绿（每场景都审计到 ≥1 元素且 0 失败） / 1 对比度失败或场景加载失败
（场景损坏/缺元素同样红——视图坏了与字不可读一样是回归）。

场景的确定性与 dshell-skin-snapshot.py 同源（boot 逻辑直接 import 复用），
基线/断言互不依赖：像素快照管「形状回归」，本审计管「玻璃化后文字可读」。
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sys
from pathlib import Path

# 复用快照脚本的 boot/playwright_sync（文件名带连字符，不能普通 import，用 spec 加载）
_SCRIPTS = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("dshell_skin_snapshot", _SCRIPTS / "dshell-skin-snapshot.py")
snap = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
sys.modules["dshell_skin_snapshot"] = snap
_spec.loader.exec_module(snap)

BASE = os.environ.get("BB_URL", "http://127.0.0.1:18154")

# 非皮肤面文本排除：终端/输入/代码编辑区/画布/图标字体——颜色归各自主题管，与 dshell 无关。
AUDIT_JS = r"""
() => {
  const out = { elements: 0, failures: [] };
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const sample = (color) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const lum = (c) => {
    const f = c.map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  };
  // 有效背景 = 白底 + 沿 html→body→…→元素 由浅到深逐层 alpha 合成（canvas 源叠）
  const effBg = (el) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1, 1);
    const chain = []; let p = el;
    while (p && p !== document.documentElement.parentElement) { chain.push(p); p = p.parentElement; }
    for (const n of chain.reverse()) {
      const bg = getComputedStyle(n).backgroundColor;
      if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') continue;
      try { ctx.fillStyle = bg; ctx.fillRect(0, 0, 1, 1); } catch (e) { /* 忽略无法解析的背景 */ }
    }
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const SKIP = '.terminal.xterm, .xterm *, textarea, input, [contenteditable="true"], ' +
    '[contenteditable="plaintext-only"], canvas, svg, svg *, [role="tooltip"]';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const t = (n.textContent || '').trim();
      if (!t) return NodeFilter.FILTER_REJECT;
      const el = n.parentElement;
      if (!el) return NodeFilter.FILTER_REJECT;
      if (el.closest(SKIP)) return NodeFilter.FILTER_REJECT;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node, checked = 0;
  while ((node = walker.nextNode()) && checked < 1200) {
    const el = node.parentElement; if (!el) continue;
    const st = getComputedStyle(el);
    const fs = parseFloat(st.fontSize) || 0;
    const bold = parseInt(st.fontWeight, 10) || 400;
    const large = fs >= 24 || (fs >= 18.66 && bold >= 700);
    const need = large ? 3.0 : 4.5;
    let fg, bg;
    try { fg = sample(st.color); } catch (e) { continue; }
    try { bg = effBg(el); } catch (e) { continue; }
    const rt = ratio(fg, bg);
    checked++;
    if (rt < need) {
      const cls = (typeof el.className === 'string' ? el.className : '') || el.tagName.toLowerCase();
      out.failures.push({
        tag: el.tagName.toLowerCase(),
        cls: cls.slice(0, 90),
        text: (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
        fg: st.color, bg: 'rgb(' + bg.join(',') + ')',
        ratio: Math.round(rt * 100) / 100,
        size: Math.round(fs * 10) / 10, need,
      });
    }
  }
  out.elements = checked;
  return out;
}
"""


def audit_page(page, label: str, max_report: int) -> dict:
    """对当前页面做对比度审计，返回 {label, elements, failures, lines}。"""
    res = page.evaluate(AUDIT_JS)
    failures = sorted(res["failures"], key=lambda f: f["ratio"])
    lines = [f"  {label}: 文本元素={res['elements']}  失败={len(failures)}"]
    for f in failures[:max_report]:
        lines.append(
            f"    FAIL {f['ratio']:>4}:1 (需 {f['need']}) {f['size']}px "
            f"<{f['tag']} .{f['cls'][:50]}> fg={f['fg']} bg={f['bg']}  “{f['text']}”"
        )
    if len(failures) > max_report:
        lines.append(f"    … 还有 {len(failures) - max_report} 条未列出")
    return {"label": label, "elements": res["elements"], "failures": failures, "lines": lines}


# ---------------------------------------------------------------------------
# 场景清单（确定性主表面；与 dshell-skin-snapshot.py 同款 boot / rail / banner 驱动）
# ---------------------------------------------------------------------------
# (name, mode, theme, route, kind)  kind ∈ {None, rail, banner}
SCENES: tuple[tuple[str, str, str, str, str | None], ...] = (
    ("home_dark", "on", "dark", "/", None),
    ("home_light", "on", "light", "/", None),
    ("settings_dark", "on", "dark", "/settings/appearance", None),
    ("settings_light", "on", "light", "/settings/appearance", None),
    ("rail_full", "on", "dark", "/", "rail"),
    ("rail_icon", "on", "dark", "/", "rail"),
    ("rail_peek", "on", "dark", "/", "rail"),
    ("banner", "1", "dark", "/", "banner"),  # banner 场景对 dark + light 各审计一遍
)


def _set_rail_state(page, kind: str) -> None:
    """把侧栏置到 full / icon / peek 三态之一（与快照 scene_rail 同款驱动与等待）。"""
    toggle = '() => document.querySelector("[data-testid=sidebar-rail-toggle]")?.click()'
    icon_collapsed = page.evaluate("() => !!document.querySelector('[data-collapsible=\"icon\"]')")
    if kind == "full":
        if icon_collapsed:
            page.evaluate(toggle)
            page.wait_for_timeout(700)
    elif kind == "icon":
        if not icon_collapsed:
            page.evaluate(toggle)
            page.wait_for_timeout(700)
    elif kind == "peek":
        if not icon_collapsed:
            page.evaluate(toggle)
            page.wait_for_timeout(600)
        # hover rail 浮层：peek 期间审计浮层 + 内容区文字
        rect = page.evaluate(
            """() => { const el = document.querySelector('[data-sidebar="panel"]');
              if (!el) return null; const r = el.getBoundingClientRect();
              return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }"""
        )
        if rect and rect["w"] > 0:
            page.mouse.move(rect["x"] + 20, rect["y"] + rect["h"] // 2)
            page.wait_for_timeout(600)


def _prepare_banner(page, theme: str) -> None:
    """legacy "1" seed + 清 dismissed + reload，保证迁移横幅必然出现（快照场景同款）。"""
    page.evaluate("""() => { try { localStorage.removeItem("bb.dshell.migration.dismissed"); } catch {} }""")
    page.reload(wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(1500)
    page.evaluate(
        """(t) => { const h = document.documentElement; h.classList.remove("dark","light"); h.classList.add(t); }""",
        theme,
    )
    page.wait_for_timeout(900)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--url", default=BASE, help="bb 应用地址（默认取 BB_URL 或 http://127.0.0.1:18154）")
    ap.add_argument("--scene", default=None, help="只审计某前缀场景（home/settings/rail/banner）")
    ap.add_argument("--max-report", type=int, default=15, help="每场景最多打印的失败条数")
    args = ap.parse_args()

    snap.BASE = args.url.rstrip("/")
    want = [s for s in SCENES if args.scene is None or s[0].startswith(args.scene)]
    total_failures = 0
    report: list[str] = []

    with snap.playwright_sync() as page:
        for name, mode, _theme, route, kind in want:
            themes = ("dark", "light") if kind == "banner" else (_theme,)
            for theme in themes:
                try:
                    snap.boot(page, mode, theme, route)
                    if kind == "rail":
                        _set_rail_state(page, name.split("_", 1)[1])
                    if kind == "banner":
                        _prepare_banner(page, theme)
                    label = f"scene:{name}_{theme}" if kind == "banner" else f"scene:{name}"
                    r = audit_page(page, label, args.max_report)
                    total_failures += len(r["failures"])
                    report.extend(r["lines"])
                except Exception as e:  # noqa: BLE001
                    total_failures += 1
                    report.append(f"  scene:{name}_{theme}: 加载/审计失败 {e}")

    print(f"bb dshell 对比度审计  url={snap.BASE}  场景={len(want)}")
    print("\n".join(report))
    print(f"\n总计: 失败对比度元素 = {total_failures}")
    return 1 if total_failures > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
