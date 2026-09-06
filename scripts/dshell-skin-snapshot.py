#!/usr/bin/env python3
"""dshell 皮肤层 headless Playwright 快照回归测试。

用法:
  python3 scripts/dshell-skin-snapshot.py [--check|--update] [--scene NAME] [--url http://127.0.0.1:18154]

- 默认 --check：把当前渲染与 docs/dshell-skin-shots/auto/ 基线比对（区域像素 diff +
  终端画布颜色断言），回归时输出 .diff 报告并返回非 0。
- --update：把当前渲染写为新基线（皮肤有意改动后校准用）。
- --ci：只跑 CI 场景集（见 CI_SCENES）——该集合在 bb 的 e2e harness（fake provider +
  固定种子项目/线程）下可确定性验证；glass_dark_terminal/glass_light_terminal 已纳入
  （harness 的 host daemon 能开真实终端），glass_tab_diff/sidechat 需要真实线程内容
  （changed files / 侧栏会话），留在本地 dev server 跑。
- 线程相关场景需要 BB_E2E_THREAD=<thread url>（如 /projects/.../threads/thr_xxx），
  未设置时自动跳过（home/settings/rail 场景不依赖线程）。
- glass_tab_* 逐 tab 玻璃 chrome 场景（info/diff/sidechat × dark/light）：驱动右面板
  到目标 tab 状态，只比对顶部 chrome 条（tab 行，内容区实时数据不做像素比对），
  另加确定性功能断言（根 backdrop-filter blur、chrome 0.58 / content 0.84·0.88 玻璃
  alpha、light 逐文本 WCAG 对比 0 失败、sidechat hasChat）。CSS 回归必现其一。
- migration_banner_dark/light：一次性迁移横幅场景——seed legacy "1" + 清 dismissed，
  横幅条区域入基线，点 ✕ 后断言横幅消失且 bb.dshell.migration.dismissed="1"
  （一次性语义的确定性断言，不依赖像素）。
- glass_anim ⌘J 折叠/展开 + 分栏拖拽帧采样场景（无像素基线）：动画期间每个 rAF 帧
  采样面板根 [data-panel-id=thread-detail-secondary-panel] 的计算样式，断言
  (a) backdrop-filter 自始至终含 blur（拖拽中被性能护栏降到 6px 也算持有），
  (b) transition-duration 每个采样帧都等于 --panel-collapse-duration 的解析值
  （220ms→0.22s；拖拽时该变量被置 0ms→0s，变量移除回退 0.22s），
  (c) 确实采到中间帧（宽度在起止之间单调变化），证明动画真的按该时长在跑。

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

# CI 场景集（--ci）：bb e2e harness 种子下可确定性验证的场景前缀。
#   * home/settings/rail 的 sidebar/dock 基线在 harness 种子（固定项目名/线程标题）下
#     生成，CI 每次重铺同一份种子 → 数据指纹恒定，像素只随皮肤代码变化；
#   * glass_tab_info(_light) 只比顶部 chrome 条 + 确定性功能断言（不依赖线程内容）；
#   * glass_anim 是纯功能帧采样（无像素基线）。
# 排除：glass_tab_diff/sidechat（需线程有 changed files / 侧栏会话）——harness 提供不了，
# 由本地 dev server + 真实线程覆盖。
# glass_dark_terminal/glass_light_terminal 已纳入：harness 跑真实 host daemon，能开真实终端
# （右面板 → Open new tab → Start terminal）；chrome 条拆成左/右子区比对，避开中间的
# shell 标题 tab（zsh/bash 随宿主平台不同），画布底色只做色值断言 → 跨平台确定性成立。
# migration_banner（dark/light）：一次性迁移横幅只依赖 localStorage（legacy "1" + 无
# dismissed 键），不依赖线程内容 → harness 种子下确定性成立，纳入 CI。
CI_SCENES = (
    "final_dark_home", "final_light_home", "dshell_settings", "rail",
    "migration_banner",
    "glass_tab_info", "glass_dark_terminal", "glass_light_terminal", "glass_anim",
)

# 皮肤自身的稳定表面（人工 gallery 的同名场景），见 docs/dshell-skin-shots/README.md
GALLERY_SCENES = [
    "final_dark_home", "final_light_home",
    "dshell_settings_original_dark", "dshell_settings_always_dark",
    "dshell_settings_auto_light", "dshell_settings_auto_dark",
    "rail_full", "rail_icon", "rail_peek",
    "glass_dark_terminal", "glass_light_terminal",
    "migration_banner_dark", "migration_banner_light",
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


def scene_migration_banner(theme: str) -> None:
    """一次性迁移横幅（legacy 布尔值 → 三态）场景。

    契约（见 lib/dshell-migration.ts）：存储里仍是旧布尔启用值（"1"/"true"）且
    bb.dshell.migration.dismissed 未写时，首页顶栏出现可关闭横幅；仅点 ✕ 关闭
    写入 dismissed 永久不再展示，「Open settings」只导航不写标记。
    - 像素基线：横幅条区域（[data-testid="dshell-migration-banner"] bbox）。
    - 确定性断言（不依赖像素）：横幅出现 → 点 ✕ 关闭 → 元素消失 →
      localStorage.bb.dshell.migration.dismissed === "1"。
    """
    scene = f"migration_banner_{theme}"
    with playwright_sync() as page:
        # legacy "1"：dshell.ts 内存迁移为 on（皮肤生效），存储仍是 "1" → 横幅触发
        boot(page, "1", theme, "/")
        # 自包含：清掉 dismissed 再 reload，保证横幅必然出现（不依赖 context 新鲜度）
        page.evaluate(
            """() => { try { localStorage.removeItem("bb.dshell.migration.dismissed"); } catch {} }"""
        )
        page.reload(wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(1500)
        page.evaluate(
            """(t) => { const h = document.documentElement; h.classList.remove("dark","light"); h.classList.add(t); }""",
            theme,
        )
        page.wait_for_timeout(900)

        banner = page.locator('[data-testid="dshell-migration-banner"]')
        if banner.count() == 0:
            failures.append(f"{scene}/banner: 横幅未出现（legacy '1' 未触发迁移提示）")
            return
        rect = page.evaluate(
            """() => {
              const el = document.querySelector('[data-testid="dshell-migration-banner"]');
              if (!el) return null;
              const r = el.getBoundingClientRect();
              return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)};
            }"""
        )
        if not rect:
            failures.append(f"{scene}/banner: 横幅元素无几何")
            return
        shot = Path("/tmp") / f"{scene}__banner.png"
        capture_region(page, str(shot), rect)
        compare_region(scene, "banner", shot)

        # 一次性语义：点 ✕ 关闭 → 横幅消失 + dismissed 落盘。
        # 应用里固定 z-40 的「Show right panel」钮浮在横幅 ✕ 正上方（同一坐标），
        # Playwright 的坐标点击（含 force=True，仍按命中测试派发）都会落到那个
        # 钮上 → 用 DOM 级 .click() 直接触发横幅 ✕ 的 React onClick，确定性验证
        # dismiss 处理链（写盘 + 卸载）。
        page.evaluate(
            """() => document.querySelector('button[aria-label="Dismiss DSH skin notice"]')?.click()"""
        )
        page.wait_for_timeout(500)
        if banner.count() != 0:
            failures.append(f"{scene}/dismiss: 关闭后横幅仍在")
        dismissed = page.evaluate(
            """() => { try { return localStorage.getItem("bb.dshell.migration.dismissed"); } catch { return null; } }"""
        )
        if dismissed != "1":
            failures.append(f"{scene}/dismiss: dismissed={dismissed!r}（应为 '1'）")
        log(f"  [OK] {scene}/dismiss: 横幅消失 + dismissed 落盘")


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


RAIL_PUSH_JS = r"""() => {
  const gap = document.querySelector('[data-sidebar="gap"]');
  const inset = document.querySelector('[data-sidebar="inset"]');
  const root = document.querySelector('[data-variant="sidebar"]');
  if (!gap || !inset || !root) return { error: "gap/inset/root 缺失" };
  const gr = gap.getBoundingClientRect();
  const ir = inset.getBoundingClientRect();
  return {
    peek: root.getAttribute("data-rail-peek"),
    gapW: Math.round(gr.width),
    insetX: Math.round(ir.x),
  };
}"""


def assert_peek_no_push(page, scene: str, icon_metrics: dict) -> None:
    """peek 浮层不推挤内容区的确定性断言（像素层可能漏检的布局回归）。

    dshell.css 4b 契约：peek 期间 data-rail-peek=true 时 gap 被钉在
    --sidebar-width-icon（3rem=48px），面板以全宽浮在内容上方（fixed z-10），
    内容容器（[data-sidebar="inset"]，随 gap 流式排布）x 不动。若 CSS 选择器
    漂移（gap 不钉、面板不再 fixed/absolute），内容会被推挤——但 rail_peek 的
    像素基线只截侧栏区域，可能漏检 → 这里直接量 DOM 几何。

    icon_metrics: 移出 rail 回到 icon 态时量到的 {gapW, insetX} 基准。
    """
    info = page.evaluate(RAIL_PUSH_JS)
    if "error" in info:
        failures.append(f"{scene}/no-push: {info['error']}")
        return
    if info["peek"] != "true":
        failures.append(f"{scene}/no-push: peek 未激活（data-rail-peek={info['peek']}）")
        return
    ok = True
    if abs(info["gapW"] - icon_metrics["gapW"]) > 1:
        ok = False
        failures.append(
            f"{scene}/no-push: peek 期间 gap 宽 {info['gapW']}px ≠ icon 态 {icon_metrics['gapW']}px"
        )
    if abs(info["insetX"] - icon_metrics["insetX"]) > 1:
        ok = False
        failures.append(
            f"{scene}/no-push: peek 期间内容 x {info['insetX']}px ≠ icon 态 {icon_metrics['insetX']}px（推挤回归）"
        )
    if icon_metrics["gapW"] <= 0:
        ok = False
        failures.append(f"{scene}/no-push: icon 态 gap 宽异常 {icon_metrics['gapW']}px")
    log(
        f"  [{'PASS' if ok else 'FAIL'}] {scene}/no-push  "
        f"gap={info['gapW']}px(icon {icon_metrics['gapW']}px)  "
        f"insetX={info['insetX']}px(icon {icon_metrics['insetX']}px)"
    )


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
                # 1) 先移出 rail → 回到 icon 态，量 gap/内容 x 基准（等 350ms 防抖 + 200ms 过渡）
                page.mouse.move(700, rect["y"] + rect["h"] // 2)
                page.wait_for_timeout(900)
                icon_metrics = page.evaluate(RAIL_PUSH_JS)
                # 2) 移入 rail → peek 激活，量同一组几何并断言不推挤
                page.mouse.move(rect["x"] + 20, rect["y"] + rect["h"] // 2)
                page.wait_for_timeout(500)
                if "error" in icon_metrics:
                    failures.append(f"{scene}/no-push: icon 态基准 {icon_metrics.get('error')}")
                else:
                    assert_peek_no_push(page, scene, icon_metrics)
        rect = element_rect(page, '[data-sidebar="panel"]')
        if not rect:
            failures.append(f"{scene}/sidebar: 侧栏未找到")
        else:
            shot = Path("/tmp") / f"{scene}__sidebar.png"
            capture_region(page, str(shot), rect)
            compare_region(scene, "sidebar", shot)


def close_terminal(page) -> None:
    """关掉面板里当前打开的终端会话（点 tab 的 Close 钮）。

    会话按线程持久化在服务端：不清理的话，同一次运行里后续的 glass_tab_* 场景
    会在 tab 行看到残留的 shell tab，基线错位。失败时静默——下次运行靠新 harness
    种子兜底。"""
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
    page.wait_for_timeout(1500)


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
        # chrome 顶条（58% 玻璃，稳定）拆成左/右子区：中间的 tab 行含 shell 标题 tab
        # （zsh/bash/fish 由宿主 shell 的 OSC 标题决定，随平台/机器不同），不做像素比对。
        # 左区只取 rel x 0–84（px-4 内边距 + info/diff 两个图标钮 + 玻璃底）——终端 tab
        # 从 rel x≈80 起，收窄到 84 保证任何平台/标题宽度都不入画；右区取 maximize/hide
        # 图标钮（rel w-220–w）。两区都是纯皮肤面，跨 macOS/CI-Ubuntu 确定性成立。
        chrome_h = min(root_rect["h"], 56)
        chrome_left = {"x": root_rect["x"], "y": root_rect["y"], "w": min(root_rect["w"], 84), "h": chrome_h}
        shot = Path("/tmp") / f"{scene}__chrome_left.png"
        capture_region(page, str(shot), chrome_left)
        compare_region(scene, "chrome_left", shot)
        if root_rect["w"] > 560:
            chrome_right = {"x": root_rect["x"] + root_rect["w"] - 220, "y": root_rect["y"], "w": 220, "h": chrome_h}
            shot = Path("/tmp") / f"{scene}__chrome_right.png"
            capture_region(page, str(shot), chrome_right)
            compare_region(scene, "chrome_right", shot)
        # 面板左缘 40px 竖列（玻璃 tint + 青色发丝边框）
        edge = {"x": root_rect["x"], "y": root_rect["y"] + chrome_h, "w": 40, "h": root_rect["h"] - chrome_h}
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
        # 收尾：关掉本场景开的终端会话。终端会话挂在线程上跨页面持久，若不清理，
        # 后续场景（glass_tab_*）在同一线程上会看到残留的 shell tab，污染 tab 行基线。
        close_terminal(page)


def open_terminal(page) -> bool:
    """在右面板打开真实终端（harness / dev server 通用）。

    本地 dev server 的右面板常驻展开，旧版直接找 aside 里的 shell 按钮即可；
    harness 下面板默认收合（宽度 1px），必须先开面板再走 "Open new tab →
    Start terminal" 流程（NewTabFileSearch 的入口按钮）。
    """
    if not ensure_panel_open(page):
        return False
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
              // 无 shell 按钮：切到 new-tab 视图找 Start terminal 入口
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


# ---------- glass_anim：⌘J 折叠/展开 + 分栏拖拽 帧采样回归（无像素基线） ----------
# 设计：皮肤第 11 段把毛玻璃挂在面板根并让 skin 过渡跟随 --panel-collapse-duration
# （panelTransitionTokens.ts / usePanelResizeSnap.ts 在拖拽分栏时把它临时置 0ms）。
# 帧采样在页面内用 requestAnimationFrame 持续记录计算样式，Python 端对"每个采样帧"
# 做断言，CSS 若把玻璃从根上摘掉、或把时长写死不再跟随变量、或动画根本没在跑，
# 本场景必然红。
ANIM_JS = r"""() => {
  const root = document.querySelector('[data-panel-id="thread-detail-secondary-panel"]');
  if (!root) return null;
  let stop = false;
  const grid = document.querySelector('[data-split-resize-grid-root]');
  window.__dshAnim = {
    frames: [],
    begin() { stop = false; this.frames = []; const loop = () => {
      if (stop) return;
      const cs = getComputedStyle(root);
      const r = root.getBoundingClientRect();
      const varVal = grid ? getComputedStyle(grid).getPropertyValue('--panel-collapse-duration') : '';
      window.__dshAnim.frames.push({
        w: Math.round(r.width),
        dur: cs.transitionDuration.split(',')[0].trim(),
        bf: cs.backdropFilter,
        varVal,
      });
      requestAnimationFrame(loop);
    }; requestAnimationFrame(loop); },
    end() { stop = true; },
  };
  return true;
}"""


def anim_reset(page) -> bool:
    ok = page.evaluate(ANIM_JS)
    page.evaluate("""() => { if (window.__dshAnim) { window.__dshAnim.frames = []; window.__dshAnim.end(); } }""")
    return ok


def expect_dur(var_val: str) -> str:
    """--panel-collapse-duration 解析值 → 计算 transition-duration 的第一段。"""
    return "0s" if var_val == "0ms" else "0.22s"


def click_panel_toggle(page, prefix: str) -> bool:
    """点当前可见的右面板开关（⌘J 等价）。1920px 桌面 chrome 下会同时存在
    窗口级与面板内两枚同名按钮，只取可见且未被 aria-hidden 的那枚。"""
    return page.evaluate(
        """(p) => {
          const vis = [...document.querySelectorAll('button')].filter(x =>
            (x.getAttribute('aria-label') || '').startsWith(p) &&
            x.getAttribute('aria-hidden') !== 'true');
          const b = vis[0];
          if (!b) return false;
          const r = b.getBoundingClientRect();
          if (r.width <= 1 || r.height <= 1 || getComputedStyle(b).visibility === 'hidden') return false;
          b.click(); return true;
        }""",
        prefix,
    )


def assert_anim_frames(scene: str, what: str, frames: list, w0: int, w1: int) -> None:
    """通用帧断言：每一帧都持 backdrop blur、时长跟随变量、并采到中间帧。"""
    if not frames:
        failures.append(f"{scene}/{what}: 未采到任何帧")
        return
    blur_ok = all("blur(" in (f.get("bf") or "") for f in frames)
    dur_bad = [f for f in frames if f["dur"] != expect_dur(f.get("varVal", ""))]
    mids = [f["w"] for f in frames if min(w0, w1) < f["w"] < max(w0, w1)]
    ok = True
    if not blur_ok:
        ok = False
        bad = [f["bf"] for f in frames if "blur(" not in (f.get("bf") or "")][:2]
        failures.append(f"{scene}/{what}: 存在无 backdrop blur 的帧（{bad}）")
    if dur_bad:
        ok = False
        bad = dur_bad[:2]
        failures.append(f"{scene}/{what}: transition-duration 未跟随变量（{bad}）")
    if len(mids) < 3:
        ok = False
        failures.append(f"{scene}/{what}: 采到中间帧过少（w0={w0} w1={w1} mids={mids[:6]}），动画可能未按 0.22s 跑")
    log(
        f"  [{'PASS' if ok else 'FAIL'}] {scene}/{what}  frames={len(frames)} "
        f"w:{w0}→{w1} mids={len(mids)} blurEveryFrame={blur_ok} durs={sorted({f['dur'] for f in frames})}"
    )


def root_width(page):
    return page.evaluate(
        """() => { const el = document.querySelector('[data-panel-id="thread-detail-secondary-panel"]');
          return el ? Math.round(el.getBoundingClientRect().width) : null; }"""
    )


def find_drag_handle(page):
    return page.evaluate(
        """() => {
          const h = [...document.querySelectorAll('[data-panel-resize-snap-handle]')]
            .find(x => { const r = x.getBoundingClientRect();
              return r.height > 40 && r.left >= 0 && r.left <= innerWidth && r.top < innerHeight; });
          if (!h) return null;
          const r = h.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y + r.height / 2) };
        }"""
    )


def scene_glass_anim() -> None:
    scene = "glass_anim"
    with playwright_sync() as page:
        boot(page, "on", "dark", THREAD)
        if not ensure_panel_open(page):
            failures.append(f"{scene}: 右面板未能打开")
            return
        if not anim_reset(page):
            failures.append(f"{scene}: 面板根未找到")
            return

        # ---- 阶段 A：⌘J 折叠 / 展开 ----
        # 先采样后触发：begin() 先挂 rAF 循环，再点开关，动画全程都在采样窗口内。
        def wait_open(width: int) -> None:
            for _ in range(10):
                if (root_width(page) or 0) >= width:
                    return
                click_panel_toggle(page, "Show right panel")
                page.wait_for_timeout(500)

        wait_open(200)
        # A1 折叠：展开态 → 收成 ~0
        page.evaluate("() => window.__dshAnim.begin()")
        if not click_panel_toggle(page, "Hide right panel"):
            failures.append(f"{scene}/collapse: 未找到 Hide right panel 按钮")
        page.wait_for_timeout(800)
        frames = page.evaluate("() => { window.__dshAnim.end(); return window.__dshAnim.frames; }")
        ws = [f["w"] for f in frames]
        start_w, end_w = (ws[0], ws[-1]) if ws else (0, 0)
        assert_anim_frames(scene, "collapse", frames, start_w, end_w)
        # 确认已收合（≤5px）再进 A2，避免状态漂移；并等 1.4s 让内容重挂载完成，
        # 否则 Show 落在 transitionsReady=false 的 0ms 窗口内会“瞬开”而非动画。
        if (root_width(page) or 0) > 5:
            click_panel_toggle(page, "Hide right panel")
            page.wait_for_timeout(900)
        page.wait_for_timeout(1400)
        # A2 展开：收合态 → 恢复
        page.evaluate("() => window.__dshAnim.begin()")
        if not click_panel_toggle(page, "Show right panel"):
            failures.append(f"{scene}/expand: 未找到 Show right panel 按钮")
        page.wait_for_timeout(800)
        frames = page.evaluate("() => { window.__dshAnim.end(); return window.__dshAnim.frames; }")
        ws = [f["w"] for f in frames]
        start_w, end_w = (ws[0], ws[-1]) if ws else (0, 0)
        assert_anim_frames(scene, "expand", frames, start_w, end_w)
        page.wait_for_timeout(500)

        # ---- 阶段 B：分栏拖拽 ----
        h = find_drag_handle(page)
        if not h:
            failures.append(f"{scene}/drag: 未找到可拖拽分栏 handle")
        else:
            engaged = False
            for attempt in range(3):
                page.evaluate("() => { if (window.__dshAnim) window.__dshAnim.frames = []; }")
                page.mouse.move(h["x"] - 8, h["y"])
                page.mouse.down()
                page.mouse.move(h["x"], h["y"], steps=2)
                page.evaluate("() => window.__dshAnim.begin()")
                page.mouse.move(h["x"] - 100, h["y"], steps=14)
                page.wait_for_timeout(200)
                page.mouse.up()
                page.wait_for_timeout(150)
                frames = page.evaluate("() => { window.__dshAnim.end(); return window.__dshAnim.frames; }")
                ws = [f["w"] for f in frames if f["w"] > 0]
                if len(ws) >= 3 and abs(ws[-1] - ws[0]) >= 25:
                    engaged = True
                    break
                if attempt < 2:
                    # 未咬合：恢复到已知展开宽再重试
                    click_panel_toggle(page, "Show right panel")
                    page.wait_for_timeout(700)
            if not engaged:
                failures.append(f"{scene}/drag: 拖拽未能改变面板宽度（handle={h}，未咬合？）")
            else:
                assert_anim_frames(scene, "drag", frames, ws[0], ws[-1])

        # ---- 阶段 C：变量级联（确定性覆盖 snap 机制的 0ms 翻转）----
        grid_var_ok = page.evaluate(
            """() => {
              const root = document.querySelector('[data-panel-id="thread-detail-secondary-panel"]');
              const g = document.querySelector('[data-split-resize-grid-root]');
              if (!root) return { ok: false, why: 'no root' };
              const cs = () => getComputedStyle(root).transitionDuration.split(',')[0].trim();
              const gEl = g || root;  // snap 把变量写在 grid 上；无 grid 时直接在根上验证
              const prev = gEl.style.getPropertyValue('--panel-collapse-duration');
              gEl.style.setProperty('--panel-collapse-duration', '0ms');
              const dur0 = cs();
              gEl.style.removeProperty('--panel-collapse-duration');
              const dur1 = cs();
              if (prev !== '') gEl.style.setProperty('--panel-collapse-duration', prev);
              return { ok: dur0 === '0s' && dur1 === '0.22s', dur0, dur1 };
            }"""
        )
        if not grid_var_ok.get("ok"):
            failures.append(f"{scene}/var-cascade: 变量翻转未传导到 transition-duration（{grid_var_ok}）")
        log(f"  [{'PASS' if grid_var_ok.get('ok') else 'FAIL'}] {scene}/var-cascade  0ms→{grid_var_ok.get('dur0')} 移除→{grid_var_ok.get('dur1')}")


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
    parser.add_argument("--ci", action="store_true", help="只跑 CI 场景集（harness 种子下确定性可验证的场景）")
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
        if args.ci:
            return any(scene.startswith(ci) for ci in CI_SCENES)
        return args.scene is None or scene.startswith(args.scene)

    log(f"dshell 皮肤快照回归  url={BASE}  mode={'--update' if args.update else '--check'}")
    if args.ci:
        log(f"CI 场景集：{', '.join(CI_SCENES)}（diff/sidechat 需真实线程内容，CI 跳过）")
    if THREAD:
        log(f"线程场景启用（BB_E2E_THREAD={THREAD}）")
    else:
        log("未设置 BB_E2E_THREAD：线程相关场景（玻璃/终端）将跳过")

    if want("final_dark_home"):
        scene_home("dark")
    if want("final_light_home"):
        scene_home("light")
    for (mode, theme) in [("off", "dark"), ("on", "dark"), ("auto", "light"), ("auto", "dark")]:
        if want("dshell_settings"):
            scene_settings(mode, theme)
    for state in ("full", "icon", "peek"):
        # 传完整场景名：--scene rail_peek / --scene rail（前缀）都能精确命中对应状态
        if want(f"rail_{state}"):
            scene_rail(state)
    for theme in ("dark", "light"):
        if want(f"migration_banner_{theme}"):
            scene_migration_banner(theme)
    if THREAD:
        if want("glass_dark_terminal"):
            scene_panel_glass("dark", THREAD)
        if want("glass_light_terminal"):
            scene_panel_glass("light", THREAD)
        for (tab, theme, name) in [
            ("info", "dark", "glass_tab_info"),
            ("diff", "dark", "glass_tab_diff"),
            ("sidechat", "dark", "glass_tab_sidechat"),
            ("info", "light", "glass_tab_info_light"),
            ("diff", "light", "glass_tab_diff_light"),
            ("sidechat", "light", "glass_tab_sidechat_light"),
        ]:
            if want(name):
                scene_glass_tab(tab, theme)
    if want("glass_anim"):
        if THREAD:
            scene_glass_anim()
        else:
            skips.append("glass_anim ⌘J/拖拽帧采样（无线程）")
    elif not THREAD and (args.scene is None or args.scene.startswith("glass_")):
        # 无线程且命中 glass 前缀：补记依赖线程的其余玻璃场景
        skips.append("glass_dark_terminal / glass_light_terminal / glass_tab_*（无线程）")

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
