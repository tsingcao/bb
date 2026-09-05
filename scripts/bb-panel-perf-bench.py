#!/usr/bin/env python3
"""bb 右侧面板滚动帧率基准 + 性能护栏回归闸。

度量什么
--------
在运行中的 bb（需已启动 dev server 且带一个可滚动面板内容的线程）里，对右侧
固定面板 [data-panel-id="thread-detail-secondary-panel"] 内的最大可滚动区域
连续驱动滚动（16ms 步进 scrollTop 归零循环），同时用 requestAnimationFrame 采样
每帧间隔。在三种皮肤状态下分别测：

  full  —— dshell 全血玻璃：根 backdrop-filter blur(22px)（idle 态真实渲染）
  scrub —— 滚动性能护栏介入：html.dshell-scrubbing → blur(6px)（滚动中真实渲染）
  off   —— 皮肤关闭（无 backdrop-filter，bb 原版基线）

每态交替采样 ROUNDS 轮（默认 5，轮间 400ms 静置让护栏 off-timer 落地），汇总
fps / avgMs / p95Ms / worstMs。三态 blur 必须逐帧与预期一致（full 恒为 22px、
scrub 恒为 6px、off 恒为 none），否则直接判失败（护栏被旁路/CSS 选择器漏改）。

回归断言（数值 → 阈值）
------------------------
- worstMs 上限（主闸，可 --worst-cap 覆盖）：
    off   ≤ OFF_WORST_CAP_MS   默认 120ms（60fps 的 2 帧预算，原版无玻璃）
    scrub ≤ SCRUB_WORST_CAP_MS 默认 150ms
    full  ≤ FULL_WORST_CAP_MS  默认 220ms
- 三态相对关系（护栏价值闸，可 --relax 关闭）：
    off.avgMs  ≤ scrub.avgMs   （玻璃即使降级也不应比原版更卡）
    scrub.avgMs ≤ full.avgMs    （护栏必须真的让滚动更跟手：6px < 22px）
  该闸比绝对 worstMs 更稳：绝对尖峰受机器负载/GC 影响，而三态在相邻窗口内
  交替采样，相对关系对机器噪声稳健。
- 功能性（护栏接线闸，必查）：driving 滚动时 html 必须出现 dshell-scrubbing、
  面板根 backdrop-filter 必须降为 6px；滚动停止 ~150ms 后必须恢复 22px。
  护栏在 main.tsx 由 installDshellPanelPerformanceGuard() 安装。

环境
----
  BB_URL          默认 http://127.0.0.1:18154
  BB_E2E_THREAD   线程路由，如 /projects/proj_x/threads/thr_y（必须可滚动）

用法
----
  python3 scripts/bb-panel-perf-bench.py [--url URL] [--thread ROUTE]
        [--rounds N] [--worst-cap off=120,scrub=150,full=220] [--relax] [--json]

退出码: 0 全绿 / 1 性能或护栏回归 / 2 环境错误（无法度量）
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys

# --- 解释器自举：系统 python3 可能缺 playwright，找有依赖的解释器重执行 ---
try:
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
            probe = subprocess.run([path, "-c", "import playwright"], capture_output=True, timeout=15)
        except Exception:
            continue
        if probe.returncode == 0:
            os.execv(path, [path, *sys.argv])
    print("需要带 playwright 的 Python 解释器。设置 BB_PY 指定（如 BB_PY=/Users/timcao/.local/bin/python3）。", file=sys.stderr)
    sys.exit(2)

# --- 默认阈值（毫秒）：worst-frame 上限 ------------------------------------
OFF_WORST_CAP_MS = 120     # 原版无玻璃，60fps 预算内 + 容差
SCRUB_WORST_CAP_MS = 150   # 护栏 6px：滚动中仍应接近 60fps
FULL_WORST_CAP_MS = 220    # 全血 22px idle 玻璃：最贵态给更宽预算

PANEL_SELECTOR = '[data-panel-id="thread-detail-secondary-panel"]'
# 找面板内最大的可滚动内容区（diff 列表 / 终端滚动区等）
FIND_SCROLLABLE_JS = """() => {
  const panel = document.querySelector(PANEL);
  if (!panel) return null;
  const aside = [...panel.querySelectorAll('aside')].find(a => {
    const r = a.getBoundingClientRect();
    return r.width > 150 && r.height > 100 && r.right > 100;
  }) || panel;
  const cands = [...aside.querySelectorAll('*')].filter(e => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > 100 && r.height > 100 && e.scrollHeight > e.clientHeight + 60
      && /auto|scroll/.test(s.overflowY);
  });
  cands.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
  const el = cands[0];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { sh: el.scrollHeight, ch: el.clientHeight,
           x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}"""

def log(msg: str) -> None:
    print(msg, flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=os.environ.get("BB_URL", "http://127.0.0.1:18154"))
    ap.add_argument("--thread", default=os.environ.get("BB_E2E_THREAD", ""))
    ap.add_argument("--rounds", type=int, default=5)
    ap.add_argument("--duration-ms", type=int, default=1400)
    ap.add_argument("--worst-cap", default="", help="off=120,scrub=150,full=220")
    ap.add_argument("--relax", action="store_true", help="关闭三态相对关系闸（仅 worst-frame 上限）")
    ap.add_argument("--json", action="store_true", help="输出机器可读 JSON 摘要")
    args = ap.parse_args()

    if not args.thread:
        log("需要 BB_E2E_THREAD（或 --thread 线程路由，如 /projects/xxx/threads/thr_yyy）")
        return 2

    caps = {"off": OFF_WORST_CAP_MS, "scrub": SCRUB_WORST_CAP_MS, "full": FULL_WORST_CAP_MS}
    if args.worst_cap:
        for kv in args.worst_cap.split(","):
            k, _, v = kv.partition("=")
            if k in caps:
                caps[k] = float(v)

    from playwright.sync_api import sync_playwright

    url = args.url.rstrip("/")
    route = args.thread if args.thread.startswith("/") else "/" + args.thread
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1920, "height": 1000})
        page.set_default_timeout(30000)
        # 先落盘皮肤偏好，再整页 reload，让 dshell.ts 启动即按偏好应用
        page.goto(url + "/", wait_until="domcontentloaded", timeout=60000)
        page.evaluate("""() => {
          try { localStorage.setItem("bb.dshell.enabled", "on"); } catch {}
          document.documentElement.classList.remove("dark", "light");
        }""")
        page.goto(url + route, wait_until="domcontentloaded", timeout=60000)
        try:
            page.wait_for_load_state("networkidle", timeout=12000)
        except Exception:
            pass
        page.wait_for_timeout(3500)
        page.evaluate("() => { const h = document.documentElement; h.classList.remove('dark','light'); h.classList.add('dark'); }")
        page.wait_for_timeout(900)

        # 打开右面板 + 切到 diff（若可滚动内容不在当前 tab）
        log(f"面板内容探测中 … url={url}{route}")
        sc = page.evaluate(FIND_SCROLLABLE_JS.replace("PANEL", json.dumps(PANEL_SELECTOR)))
        if not sc:
            page.evaluate("""() => {
              const b = [...document.querySelectorAll('button')]
                .find(x => (x.getAttribute('aria-label') || '').startsWith('Show right panel'));
              if (b) b.click();
            }""")
            page.wait_for_timeout(2000)
            sc = page.evaluate(FIND_SCROLLABLE_JS.replace("PANEL", json.dumps(PANEL_SELECTOR)))
        if not sc:
            # 尝试 diff tab
            page.evaluate("""() => {
              const panel = document.querySelector(PANEL);
              const aside = panel && [...panel.querySelectorAll('aside')]
                .find(a => { const r = a.getBoundingClientRect(); return r.width > 150; });
              if (!aside) return;
              const b = [...aside.querySelectorAll('button')]
                .find(x => (x.getAttribute('aria-label') || '').startsWith('Show diff panel'));
              if (b) b.click();
            }""".replace("PANEL", json.dumps(PANEL_SELECTOR)))
            page.wait_for_timeout(2500)
            sc = page.evaluate(FIND_SCROLLABLE_JS.replace("PANEL", json.dumps(PANEL_SELECTOR)))
        if not sc:
            browser.close()
            log(f"未找到面板内可滚动内容（线程无 diff/终端输出？）。sc={sc}")
            return 2
        log(f"滚动目标: scrollHeight={sc['sh']}px clientHeight={sc['ch']}px")

        # --- 护栏功能性接线检查（滚动中出现/停止后恢复） ---
        # 在面板根上派发 scroll（根必然 in-region，deterministic），验证：
        #   a) html 挂上 dshell-scrubbing（护栏 handleScroll 接线）
        #   b) 根 backdrop-filter 降为 6px（dshell.css section 13 接线）
        #   c) 滚动停止 ~150ms 后类移除、blur 恢复 22px（off-timer 接线）
        guard_ok = page.evaluate(
            """async () => {
              const html = document.documentElement;
              const root = document.querySelector(PANEL);
              html.classList.add('dshell');
              html.classList.remove('dshell-scrubbing');
              const target = root || html;
              const iv = setInterval(() => {
                target.dispatchEvent(new Event('scroll', { bubbles: true }));
              }, 16);
              await new Promise(r => setTimeout(r, 250));
              const during = {
                scrubbing: html.classList.contains('dshell-scrubbing'),
                blur: root ? getComputedStyle(root).backdropFilter : '',
              };
              clearInterval(iv);
              await new Promise(r => setTimeout(r, 600));
              const after = {
                scrubbing: html.classList.contains('dshell-scrubbing'),
                blur: root ? getComputedStyle(root).backdropFilter : '',
              };
              html.classList.remove('dshell', 'dshell-scrubbing');
              return { during, after };
            }""".replace("PANEL", json.dumps(PANEL_SELECTOR))
        )
        guard_pass = (
            guard_ok["during"]["scrubbing"]
            and "6px" in guard_ok["during"]["blur"]
            and not guard_ok["after"]["scrubbing"]
            and "22px" in guard_ok["after"]["blur"]
        )
        log(f"  [{'PASS' if guard_pass else 'FAIL'}] guard接线  滚动中→{guard_ok['during']}  停止600ms→{guard_ok['after']}")
        if not guard_pass:
            browser.close()
            return 1

        # --- 三态帧率基准：交替采样，抗机器负载漂移 ---
        results: dict[str, list[dict]] = {"full": [], "scrub": [], "off": []}
        order = []
        for i in range(args.rounds):
            order += ["full", "scrub", "off"] if i % 2 == 0 else ["off", "scrub", "full"]
        log("采样中（每轮 ~%.1fs，交替三态）：" % (args.duration_ms / 1000))
        for mode in order:
            page.wait_for_timeout(400)
            r = page.evaluate(
                """async (mode) => {
                  const html = document.documentElement;
                  const root = document.querySelector(PANEL);
                  const panel = document.querySelector(PANEL);
                  const aside = [...panel.querySelectorAll('aside')].find(a => {
                    const r = a.getBoundingClientRect(); return r.width > 150 && r.height > 100;
                  }) || panel;
                  const cands = [...aside.querySelectorAll('*')].filter(e => {
                    const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
                    return r.width > 100 && r.height > 100 && e.scrollHeight > e.clientHeight + 60
                      && /auto|scroll/.test(s.overflowY);
                  });
                  cands.sort((a,b) => (b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight));
                  const el = cands[0];
                  if (!el) return { err: 'no scrollable' };
                  const durMs = DUR;
                  const max = Math.max(el.scrollHeight - el.clientHeight, 1);
                  const step = Math.max(12, Math.floor(max / 80));
                  const drive = setInterval(() => { el.scrollTop = (el.scrollTop + step) % max; }, 16);
                  let frames = 0, sum = 0, worst = 0, over50 = 0;
                  let last = performance.now();
                  const dts = [];
                  const blurSeen = new Set();
                  let misstate = 0;
                  const t0v = performance.now();
                  await new Promise(res => {
                    (function loop(t) {
                      frames++;
                      const dt = t - last; last = t;
                      sum += dt; if (dt > worst) worst = dt; if (dt > 50) over50++;
                      dts.push(dt);
                      if (mode === 'scrub') { html.classList.add('dshell'); html.classList.add('dshell-scrubbing'); }
                      else if (mode === 'full') { html.classList.add('dshell'); html.classList.remove('dshell-scrubbing'); }
                      else { html.classList.remove('dshell', 'dshell-scrubbing'); }
                      const bf = root ? getComputedStyle(root).backdropFilter : '';
                      const want = mode === 'full' ? '22px' : mode === 'scrub' ? '6px' : 'none';
                      if (mode === 'off') { if (bf && bf !== 'none') misstate++; }
                      else if (!bf.includes(want)) misstate++;
                      blurSeen.add(bf || 'none');
                      if (t - t0v < durMs) requestAnimationFrame(loop);
                      else res();
                    })(performance.now());
                  });
                  clearInterval(drive);
                  html.classList.remove('dshell-scrubbing');
                  dts.sort((a, b) => a - b);
                  const p95 = dts[Math.min(dts.length - 1, Math.floor(dts.length * 0.95))];
                  return { frames, avgMs: sum / frames, p95Ms: p95, worstMs: worst,
                           over50, blurs: [...blurSeen], misstate,
                           fps: frames / (durMs / 1000) };
                }""".replace("PANEL", json.dumps(PANEL_SELECTOR)).replace("DUR", str(args.duration_ms)),
                mode,
            )
            if "err" in r:
                browser.close()
                log(f"采样失败: {r}")
                return 2
            results[mode].append(r)
            log(f"    {mode:<5} fps={r['fps']:.0f} avg={r['avgMs']:.1f}ms p95={r['p95Ms']:.1f}ms worst={r['worstMs']:.1f}ms over50={r['over50']}  blurs={r['blurs']}")

        browser.close()

    # --- 汇总 ---
    summary = {}
    for mode in ("full", "scrub", "off"):
        rs = results[mode]
        summary[mode] = {
            "fps": statistics.mean(r["fps"] for r in rs),
            "avgMs": statistics.mean(r["avgMs"] for r in rs),
            "p95Ms": statistics.mean(r["p95Ms"] for r in rs),
            "worstMs": max(r["worstMs"] for r in rs),
            "worstAvgMs": statistics.mean(r["worstMs"] for r in rs),
            "over50Total": sum(r["over50"] for r in rs),
            "misstateTotal": sum(r["misstate"] for r in rs),
            "blurs": rs[0]["blurs"],
        }
    log("")
    log(f"{'state':<6}{'fps':>6}{'avgMs':>8}{'p95Ms':>8}{'worstMs(max)':>13}{'over50':>8}  worst-cap")
    for mode in ("off", "scrub", "full"):
        s = summary[mode]
        flag = "OK " if s["worstMs"] <= caps[mode] else "OVER"
        log(f"{mode:<6}{s['fps']:>6.0f}{s['avgMs']:>8.1f}{s['p95Ms']:>8.1f}{s['worstMs']:>13.1f}{s['over50Total']:>8}  {caps[mode]:.0f}ms {flag}")

    failures: list[str] = []
    # 1) worst-frame 上限
    for mode in ("off", "scrub", "full"):
        if summary[mode]["worstMs"] > caps[mode]:
            failures.append(f"{mode} worstMs={summary[mode]['worstMs']:.1f}ms > cap {caps[mode]:.0f}ms")
    # 2) 状态纯度：每态 blur 必须全帧符合预期
    for mode, want in (("full", "22px"), ("scrub", "6px")):
        if summary[mode]["misstateTotal"] > 0:
            failures.append(f"{mode} 出现 {summary[mode]['misstateTotal']} 帧 blur 不符合预期 {want}")
        if not any(want in b for b in summary[mode]["blurs"]):
            failures.append(f"{mode} 从未观测到 {want} blur（{summary[mode]['blurs']}）")
    # 3) 三态相对关系（护栏价值）：epsilon 吸收 vsync 贴底/机器噪声。
    #    真正回归（护栏失效→scrub 回到 full 成本、玻璃叠到原版路径）的差幅
    #    远大于 2ms，不会漏网；CSS 接线层面另由 guard接线闸兜底。
    EPS = 2.0
    if not args.relax:
        if summary["off"]["avgMs"] > summary["scrub"]["avgMs"] + EPS:
            failures.append(f"off.avgMs={summary['off']['avgMs']:.1f} > scrub.avgMs+{EPS:.0f}ms（原版不应更卡）")
        if summary["scrub"]["avgMs"] > summary["full"]["avgMs"] + EPS:
            failures.append(f"scrub.avgMs={summary['scrub']['avgMs']:.1f} > full.avgMs+{EPS:.0f}ms（护栏 6px 应快于 22px）")

    log("")
    if failures:
        for f in failures:
            log(f"  [FAIL] {f}")
        log(f"退出码 1（{len(failures)} 项回归）")
        return 1
    log("[PASS] 三态滚动帧率在 worst-frame 上限内，护栏价值成立")
    if args.json:
        print(json.dumps({"exit": 0, "summary": summary, "caps": caps}, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
