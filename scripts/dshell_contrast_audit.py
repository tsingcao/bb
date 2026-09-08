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
  python3 scripts/dshell_contrast_audit.py --json -              # 汇总 JSON（每场景元素/失败/比率直方图）打 stdout
  python3 scripts/dshell_contrast_audit.py --json out.json       # 汇总写文件（红绿都写，作审计合规表记录）
  BB_URL=http://127.0.0.1:18154 python3 scripts/dshell_contrast_audit.py

汇总 JSON 合规表：每次审计都累计全部文本节点的对比度比率直方图（WCAG 分桶
<3 / 3-4.5 / 4.5-7 / >=7，见 HIST_BUCKETS），与每场景 elements/failures 一起
经 --json 导出（schema 2，与基线文件同构）。

排除清单审计账 + 场景契约：每个被 SKIP 规则排除的文本节点都记一笔原因（每场景
打印 skipped tooltip/svg/term/input/hidden/small/offscreen 计数）；场景断言约束
rail_peek 浮层行标签必须比 rail_icon 多 ≥3 个元素（防 peek 标签被 role=tooltip
之类规则吞掉），且任何场景 skipped.svg / skipped.tooltip > 0 即红（图标/徽章里
藏文字、静态场景开着的瞬时提示都是真实表面，不允许被无声排除）。

元素覆盖快照（防覆盖率悄悄下滑）：每次全量审计后把每场景 elements/failures 与
仓库基线 docs/dshell-skin-shots/contrast-summary.json 对比：
  * 基线里的场景本次没审计（SCENES 被删/改坏）→ 红；
  * 某场景 elements < 基线（文本节点变少 = 覆盖下滑）→ 红；
  * 新场景（SCENES 新增）→ 提示用 --update-snapshot 纳入基线，不红。
  * --update-snapshot    —— 全量绿跑（0 失败且每场景 ≥1 元素）后把本次汇总写成基线 JSON；
  * --no-snapshot-check  —— 跳过基线对比（对非 harness 实例做临时审计时用）；
  * --snapshot PATH      —— 覆盖基线路径（默认 docs/dshell-skin-shots/contrast-summary.json）。

退出码: 0 全绿（每场景都审计到 ≥1 元素、0 失败、且覆盖不低于基线） / 1 对比度失败、
场景加载失败或覆盖下滑（场景损坏/缺元素同样红——视图坏了与字不可读一样是回归）。

场景的确定性与 dshell-skin-snapshot.py 同源（boot 逻辑直接 import 复用），
基线/断言互不依赖：像素快照管「形状回归」，本审计管「玻璃化后文字可读」。
"""

from __future__ import annotations

import argparse
import importlib.util
import json
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
  const out = {
    elements: 0,
    hist: { "<3": 0, "3-4.5": 0, "4.5-7": 0, ">=7": 0 },
    skipped: { tooltip: 0, svg: 0, terminal: 0, input: 0, hidden: 0, small: 0, offscreen: 0 },
    failures: [],
  };
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
  // 排除清单审计账（防真实表面被规则悄悄吞掉）：每个被排除的文本节点记一笔原因。
  // 工具类/终端/输入是设计上不在皮肤断言范围；svg 内文本与 tooltip 里可见文本是
  // 潜在真实表面——场景断言（_assert_scene_contracts）对它们设上限：>0 即红。
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const t = (n.textContent || '').trim();
      if (!t) return NodeFilter.FILTER_REJECT;
      const el = n.parentElement;
      if (!el) return NodeFilter.FILTER_REJECT;
      const hit = el.closest(SKIP);
      if (hit) {
        if (hit.closest('[role="tooltip"]')) out.skipped.tooltip++;
        else if (hit.closest('svg')) out.skipped.svg++;
        else if (hit.closest('.terminal.xterm')) out.skipped.terminal++;
        else out.skipped.input++;
        return NodeFilter.FILTER_REJECT;
      }
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') {
        out.skipped.hidden++; return NodeFilter.FILTER_REJECT;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) {
        out.skipped.small++; return NodeFilter.FILTER_REJECT;
      }
      if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) {
        out.skipped.offscreen++; return NodeFilter.FILTER_REJECT;
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
    // 比率直方图（WCAG 阈值分桶：<3 连大号字都不够 / 3-4.5 只够大号 / 4.5-7 AA /
    // >=7 AAA）。每次审计都累计全部文本节点的比率分布，供合规表历史对比。
    if (rt < 3) out.hist["<3"]++;
    else if (rt < 4.5) out.hist["3-4.5"]++;
    else if (rt < 7) out.hist["4.5-7"]++;
    else out.hist[">=7"]++;
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
    """对当前页面做对比度审计，返回 {label, elements, hist, failures, lines}。"""
    res = page.evaluate(AUDIT_JS)
    failures = sorted(res["failures"], key=lambda f: f["ratio"])
    lines = [f"  {label}: 文本元素={res['elements']}  失败={len(failures)}"]
    h = res["hist"]
    lines.append(
        f"    hist <3:{h['<3']}  3-4.5:{h['3-4.5']}  4.5-7:{h['4.5-7']}  >=7:{h['>=7']}"
    )
    s = res["skipped"]
    lines.append(
        f"    skipped tooltip:{s['tooltip']} svg:{s['svg']} term:{s['terminal']} "
        f"input:{s['input']} hidden:{s['hidden']} small:{s['small']} offscreen:{s['offscreen']}"
    )
    for f in failures[:max_report]:
        lines.append(
            f"    FAIL {f['ratio']:>4}:1 (需 {f['need']}) {f['size']}px "
            f"<{f['tag']} .{f['cls'][:50]}> fg={f['fg']} bg={f['bg']}  “{f['text']}”"
        )
    if len(failures) > max_report:
        lines.append(f"    … 还有 {len(failures) - max_report} 条未列出")
    return {
        "label": label,
        "elements": res["elements"],
        "hist": res["hist"],
        "skipped": res["skipped"],
        "failures": failures,
        "lines": lines,
    }


# ---------------------------------------------------------------------------
# 元素覆盖快照（防覆盖率悄悄下滑）
# ---------------------------------------------------------------------------

DEFAULT_SNAPSHOT = Path(__file__).resolve().parent.parent / "docs" / "dshell-skin-shots" / "contrast-summary.json"

# 比率直方图分桶（WCAG 阈值）。键即 JSON 键，稳定可 diff。
HIST_BUCKETS = ("<3", "3-4.5", "4.5-7", ">=7")


def _empty_hist() -> dict[str, int]:
    return {b: 0 for b in HIST_BUCKETS}


def _summary_payload(stats: dict[str, dict], total_failures: int) -> dict:
    """本次审计的合规表 payload（schema 2）：每场景 elements/failures + 比率直方图。

    与 --update-snapshot 写的基线文件同构；场景级 error（加载失败）原样保留。
    运行期诊断字段（skipped 排除账、lines）不落盘。
    """
    totals_hist = _empty_hist()
    for s in stats.values():
        for b in HIST_BUCKETS:
            totals_hist[b] += s.get("hist", _empty_hist()).get(b, 0)
    scenes = {}
    for label, s in sorted(stats.items()):
        scene = {"elements": s["elements"], "failures": s["failures"]}
        if "hist" in s:
            scene["hist"] = s["hist"]
        if "error" in s:
            scene["error"] = s["error"]
        scenes[label] = scene
    return {
        "schema": 2,
        "histogram_buckets": HIST_BUCKETS,
        "scenes": scenes,
        "totals": {
            "scenes": len(stats),
            "elements": sum(s["elements"] for s in stats.values()),
            "failures": total_failures,
            "histogram": totals_hist,
        },
    }


def check_snapshot(run: dict[str, dict], path: Path) -> tuple[list[str], int]:
    """与仓库基线对比。返回 (lines, extra_rc)。

    * 基线场景本次缺失 → 红（SCENES 被删/场景改名 = 覆盖下滑）；
    * 场景 elements < 基线 → 红（文本节点变少）；
    * 新场景 → 提示纳入基线，不红。
    """
    if not path.exists():
        return [f"  [snapshot] 基线缺失：{path}（先全量绿跑后 --update-snapshot 生成并提交）"], 0
    try:
        base = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001 - 基线损坏按红处理
        return [f"  [snapshot] ✗ 基线解析失败：{e}"], 1
    lines = [f"  [snapshot] 与基线 {path} 对比："]
    red = 0
    for label, b in sorted(base.get("scenes", {}).items()):
        if label not in run:
            red += 1
            lines.append(f"    ✗ {label} 本次未审计（基线 elements={b['elements']}）—— 覆盖率下滑")
            continue
        cur = run[label]["elements"]
        if cur < b["elements"]:
            red += 1
            lines.append(f"    ✗ {label} 元素覆盖下滑 {b['elements']} → {cur}")
    for label in sorted(set(run) - set(base.get("scenes", {}))):
        lines.append(f"    + {label} 新场景（elements={run[label]['elements']}）—— 用 --update-snapshot 纳入基线")
    if red == 0:
        lines.append("    ✓ 覆盖无下滑（每场景 elements ≥ 基线）")
    return lines, 1 if red else 0


def _assert_scene_contracts(stats: dict[str, dict]) -> tuple[list[str], int]:
    """排除清单/覆盖契约的场景断言（防真实表面被 SKIP 规则悄悄吞掉）。

    * rail_peek 必须比 rail_icon 多审计到 ≥3 个文本元素——peek 浮层恢复的
      行标签是真实交互表面，若被 [role="tooltip"] 之类的规则排除，两者差距
      会消失（浮层标签审计不到）。
    * 任何场景 skipped.svg > 0 → 红：svg 内出现文本 = 图标/徽章里藏了文字，
      会被 `svg *` 规则无声排除（当前 8 场景实测 0）。
    * 任何场景 skipped.tooltip > 0 → 红：静态场景上可见的 tooltip 是真实表面
      （瞬时悬浮提示不应在无交互时打开）；出现即要求复核排除规则。
    """
    lines: list[str] = []
    red = 0
    if "scene:rail_peek" in stats and "scene:rail_icon" in stats:
        peek = stats["scene:rail_peek"]["elements"]
        icon = stats["scene:rail_icon"]["elements"]
        if peek < icon + 3:
            red += 1
            lines.append(
                f"  [contract] ✗ rail_peek({peek}) 应比 rail_icon({icon}) 多 ≥3 个元素——"
                "peek 浮层行标签疑似被排除规则（如 role=tooltip）吞掉，未审计"
            )
        else:
            lines.append(
                f"  [contract] ✓ peek 浮层标签已审计（rail_peek {peek} > rail_icon {icon}）"
            )
    for label, s in stats.items():
        sk = s.get("skipped", {})
        if sk.get("svg", 0) > 0:
            red += 1
            lines.append(
                f"  [contract] ✗ {label}: svg 内出现 {sk['svg']} 个文本节点——"
                "图标/徽章里藏了文字，被 `svg *` 规则无声排除，需改为显式审计"
            )
        if sk.get("tooltip", 0) > 0:
            red += 1
            lines.append(
                f"  [contract] ✗ {label}: 可见 tooltip 文本 {sk['tooltip']} 个——"
                "静态场景不该有瞬时提示开着；若为真实表面需移出 [role=tooltip] 排除"
            )
    return lines, red


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
    ap.add_argument("--snapshot", type=Path, default=None, help=f"元素覆盖基线 JSON 路径（默认 {DEFAULT_SNAPSHOT}）")
    ap.add_argument("--update-snapshot", action="store_true", help="全量绿跑后把本次每场景元素/失败数/比率直方图写成基线 JSON（纳入仓库）")
    ap.add_argument("--no-snapshot-check", action="store_true", help="跳过与基线对比（对非 harness 实例做临时审计时用）")
    ap.add_argument(
        "--json",
        type=Path,
        default=None,
        metavar="PATH",
        help="把本次汇总（每场景元素/失败数/比率直方图 + 总计）写成 JSON 合规表；"
        "'-' 输出到 stdout（无论红绿都写，作为审计记录；与 --update-snapshot 的"
        "基线文件同 schema）",
    )
    args = ap.parse_args()

    snapshot_path = args.snapshot or DEFAULT_SNAPSHOT
    snap.BASE = args.url.rstrip("/")
    want = [s for s in SCENES if args.scene is None or s[0].startswith(args.scene)]
    total_failures = 0
    zero_element: list[str] = []
    stats: dict[str, dict] = {}
    report: list[str] = []

    with snap.playwright_sync() as page:
        for name, mode, _theme, route, kind in want:
            themes = ("dark", "light") if kind == "banner" else (_theme,)
            for theme in themes:
                label = f"scene:{name}_{theme}" if kind == "banner" else f"scene:{name}"
                try:
                    snap.boot(page, mode, theme, route)
                    if kind == "rail":
                        _set_rail_state(page, name.split("_", 1)[1])
                    if kind == "banner":
                        _prepare_banner(page, theme)
                    r = audit_page(page, label, args.max_report)
                    total_failures += len(r["failures"])
                    stats[label] = {
                        "elements": r["elements"],
                        "failures": len(r["failures"]),
                        "hist": r["hist"],
                        "skipped": r["skipped"],
                    }
                    if r["elements"] == 0:
                        zero_element.append(label)
                    report.extend(r["lines"])
                except Exception as e:  # noqa: BLE001
                    total_failures += 1
                    stats[label] = {"elements": 0, "failures": 1, "error": str(e)}
                    report.append(f"  {label}: 加载/审计失败 {e}")

    print(f"bb dshell 对比度审计  url={snap.BASE}  场景={len(want)}")
    print("\n".join(report))
    if zero_element:
        print("  [zero] ✗ 审计到 0 文本元素的场景：" + ", ".join(zero_element) + "（页面未加载/选择器失效？）")
    print(f"\n总计: 失败对比度元素 = {total_failures}")

    # 排除清单/覆盖契约断言：rail_peek 浮层标签覆盖率、svg/tooltip 无声排除。
    contract_lines, contract_red = _assert_scene_contracts(stats)
    print("\n".join(contract_lines))

    rc = 1 if (total_failures > 0 or zero_element or contract_red) else 0

    # 汇总 JSON 合规表：--json 无论红绿都导出本次记录；--update-snapshot 仅在
    # 全量绿跑后把它写为仓库基线（同一 payload schema，schema 2 起含比率直方图）。
    if args.json is not None:
        payload = _summary_payload(stats, total_failures)
        text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
        if str(args.json) == "-":
            sys.stdout.write(text)
        else:
            try:
                args.json.write_text(text, encoding="utf-8")
            except OSError as e:
                print(f"  [json] ✗ 合规表写入失败：{e}（退出码 2）")
                return 2
            print(f"  [json] ✓ 合规表已写入 {args.json}")

    if args.update_snapshot:
        if args.scene:
            print("  [snapshot] ✗ --update-snapshot 需要全量审计（去掉 --scene）")
            return 1
        if rc != 0:
            print("  [snapshot] ✗ 失败/零元素状态下不更新基线（先修红再重拍）")
            return 1
        payload = _summary_payload(stats, total_failures)
        snapshot_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"  [snapshot] ✓ 基线已写入 {snapshot_path}（schema {payload['schema']}，纳入仓库供历史对比）")
    elif args.scene or args.no_snapshot_check:
        print("  [snapshot] 跳过基线对比（--scene 局部审计 / --no-snapshot-check）")
    else:
        lines, extra = check_snapshot(stats, snapshot_path)
        print("\n".join(lines))
        rc = rc or extra

    return rc


if __name__ == "__main__":
    sys.exit(main())
