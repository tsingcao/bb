#!/usr/bin/env python3
"""键盘快捷键 rebind 真实流程 Playwright E2E（对运行中的 bb dev 栈）。

驱动真实 UI（vite app -> 真实 server /api）：在 Keyboard 设置页里录制新的快捷键 → 验证
(1) 命令真的被新按键触发（旧默认按键失效），(2) 覆盖已持久化到服务器设置（GET
/api/system/config 的 keybindingOverrides + 重载页面仍生效），然后一键 Reset all 恢复默认
并再次验证服务器回空、默认按键恢复。结束状态与开始一致，无残留。

依赖运行中的 dev 栈：BB_URL（app，默认 http://127.0.0.1:18154）代理到后端 server；
dev 模式下 origin 受信、免登录，Playwright 直接可用真实会话。

用法:
  python3 scripts/keyboard-rebind-e2e.py [--url http://127.0.0.1:18154] [--command sidebar.railToggle]

默认目标命令 sidebar.railToggle（默认 ⇧⌘\\），新绑 ⌥⌘\\。失败/中断都会在 finally 里尝试
Reset all，保证服务器设置净零残留。退出码: 0 全绿 / 1 断言失败 / 2 环境错误。
"""
from __future__ import annotations

import argparse
import re
import sys
import time

# --- 解释器自举（与 dshell-skin-snapshot.py 同款）：找带 playwright 的解释器 ---
try:
    import playwright  # noqa: F401
    _DEPS_OK = True
except ImportError:
    _DEPS_OK = False

if not _DEPS_OK:
    import os
    import shutil
    import subprocess

    candidates = [os.environ.get("BB_PY", "")] + [
        "python3",
        "python3.12",
        "python3.11",
        "python3.10",
    ]
    for cand in candidates:
        if not cand:
            continue
        path = shutil.which(cand) or (cand if os.path.exists(cand) else None)
        if not path:
            continue
        try:
            probe = subprocess.run(
                [path, "-c", "import playwright"],
                capture_output=True,
                timeout=15,
            )
        except Exception:
            continue
        if probe.returncode == 0:
            os.execv(path, [path, *sys.argv])

    print("error: no python interpreter with playwright found (try BB_PY=...)", file=sys.stderr)
    sys.exit(2)

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

RECORD_ARIA_RE = re.compile(r"Record shortcut for ([^,]+), current shortcut (.*)")
RESET_ALL_TEXT = "Reset all"
RECORDER_BY_ROLE = re.compile(r"^(Record|Recording) shortcut for Toggle icon rail")

BS = "\\"  # 反斜杠字符，用于拼可读的快捷键文案


def recorder_button(page):
    return page.get_by_role("button", name=RECORDER_BY_ROLE).first


def current_shortcut_label(page) -> str | None:
    try:
        aria = recorder_button(page).get_attribute("aria-label")
    except PlaywrightTimeoutError:
        return None
    if aria is None:
        return None
    match = RECORD_ARIA_RE.match(aria)
    return None if match is None else match.group(2)


def server_overrides(page, base_url: str):
    """直接向真实后端要当前 keybindingOverrides（页内 fetch，带真实会话）。"""
    data = page.evaluate(
        "fetch('/api/v1/system/config', {headers: {'accept': 'application/json'}})"
        ".then(r => { if (!r.ok) throw new Error('status ' + r.status); return r.json(); })",
    )
    return data.get("keybindingOverrides", [])


def wait_for_override(page, base_url: str, command: str, present: bool, timeout_ms: int = 8000):
    """轮询服务器配置直到 command 出现在/离开 keybindingOverrides。"""
    end = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < end:
        overrides = server_overrides(page, base_url)
        has = any(entry.get("command") == command for entry in overrides)
        if has == present:
            return overrides
        page.wait_for_timeout(250)
    overrides = server_overrides(page, base_url)
    has = any(entry.get("command") == command for entry in overrides)
    raise AssertionError(
        f"server keybindingOverrides did not become present={present}: {overrides}",
    )


def press_chord(page, meta: bool, alt: bool, shift: bool):
    """用真实键盘 API 按下反斜杠组合（避免只发合成事件到 window）。"""
    if meta:
        page.keyboard.down("Meta")
    if alt:
        page.keyboard.down("Alt")
    if shift:
        page.keyboard.down("Shift")
    page.keyboard.press("Backslash")
    if shift:
        page.keyboard.up("Shift")
    if alt:
        page.keyboard.up("Alt")
    if meta:
        page.keyboard.up("Meta")


def fail(message: str) -> None:
    raise AssertionError(message)


def run(base_url: str, command: str = "sidebar.railToggle") -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context()
        page = context.new_page()
        try:
            # --- 进入 Keyboard 设置 ---
            page.goto(f"{base_url}/settings/keyboard", wait_until="domcontentloaded")
            recorder = recorder_button(page)
            recorder.wait_for(state="visible", timeout=20000)

            initial_label = current_shortcut_label(page)
            if initial_label is None:
                fail("could not read the railToggle recorder aria-label")
            print(f"[1/7] 初始录制按钮: 「Record shortcut ... {initial_label}」")

            before_overrides = server_overrides(page, base_url)
            if any(e.get("command") == command for e in before_overrides):
                fail(f"server already has an override for {command}; refusing to run on a dirty state")

            # --- 录制新快捷键 ⌥⌘\ ---
            recorder.click()
            pressed = recorder_button(page).get_attribute("aria-pressed")
            if pressed != "true":
                fail(f"recorder did not enter recording state (aria-pressed={pressed})")
            print("[2/7] 已进入录制态（aria-pressed=true）；按下 ⌥⌘\\")
            press_chord(page, meta=True, alt=True, shift=False)

            page.wait_for_timeout(1500)
            overrides = wait_for_override(page, base_url, command, present=True)
            entry = next(e for e in overrides if e.get("command") == command)
            shortcut = entry.get("shortcut", {})
            print(f"[3/7] 服务器已收到 override: {shortcut}")

            # 设置页 UI：录制按钮应显示新组合 + Custom 徽标
            new_label = current_shortcut_label(page)
            if new_label is None or new_label == initial_label or "⇧" in new_label:
                fail(f"recorder label did not update to the new chord: {new_label!r}")
            print(f"[4/7] 设置页录制按钮更新为: {new_label!r}")

            # --- 验证真实按键生效（回首页按 ⌥⌘\ 应触发 railToggle）---
            page.goto(f"{base_url}/", wait_until="domcontentloaded")
            toggle = page.get_by_test_id("sidebar-rail-toggle").first
            toggle.wait_for(state="visible", timeout=20000)
            aria0 = toggle.get_attribute("aria-label")
            if "icon rail" not in (aria0 or ""):
                fail(f"rail toggle not found on home: {aria0!r}")

            # 新组合 ⌥⌘\ 生效
            press_chord(page, meta=True, alt=True, shift=False)
            page.wait_for_timeout(600)
            aria1 = toggle.get_attribute("aria-label")
            state_flipped = ("Collapse" in (aria0 or "")) != ("Collapse" in (aria1 or ""))
            if not state_flipped:
                fail(f"new chord ⌥⌘{BS} did not toggle the rail: {aria0!r} -> {aria1!r}")
            print(f"[5/7] ⌥⌘{BS} 触发生效：rail 状态翻转（{aria0.split('(')[0].strip()} -> {aria1.split('(')[0].strip()}）")

            # 旧默认 ⇧⌘\ 失效
            press_chord(page, meta=True, alt=False, shift=True)
            page.wait_for_timeout(600)
            aria2 = toggle.get_attribute("aria-label")
            if ("Collapse" in (aria1 or "")) != ("Collapse" in (aria2 or "")):
                fail(f"old default ⇧⌘{BS} still toggles the rail after rebind: {aria1!r} -> {aria2!r}")
            print(f"[5b] 旧默认 ⇧⌘{BS} 已失效（override 生效，rail 状态不变）")

            # --- 持久化：重载后仍在 ---
            page.goto(f"{base_url}/settings/keyboard", wait_until="domcontentloaded")
            reloaded_label = current_shortcut_label(page)
            if reloaded_label is None or reloaded_label != new_label:
                fail(f"override did not survive reload: {new_label!r} -> {reloaded_label!r}")
            print(f"[6/7] 重载后设置仍显示新组合 {reloaded_label!r}（服务器持久化确认）")

            # --- 一键恢复默认 ---
            reset_all = page.get_by_role("button", name=re.compile(rf"^{RESET_ALL_TEXT}$"))
            reset_all.first.wait_for(state="visible", timeout=10000)
            reset_all.first.click()
            page.wait_for_timeout(1500)
            wait_for_override(page, base_url, command, present=False)
            # 等设置页录制按钮回到默认组合，确认客户端已应用 Reset（避免带着旧 override 离开本页）
            restored_label = current_shortcut_label(page)
            end = time.monotonic() + 8
            while (restored_label is None or "⇧" not in restored_label) and time.monotonic() < end:
                page.wait_for_timeout(250)
                restored_label = current_shortcut_label(page)
            print(f"[7/7] Reset all 后服务器 overrides 已清空，录制按钮恢复: {restored_label!r}")

            # 恢复后验证：默认组合重新生效、新组合失效
            page.goto(f"{base_url}/", wait_until="domcontentloaded")
            toggle = page.get_by_test_id("sidebar-rail-toggle").first
            toggle.wait_for(state="visible", timeout=20000)
            # 客户端 config 若仍竞态持有旧 override，默认键会空按——轮询重按直到生效或超时
            flipped = False
            r0 = toggle.get_attribute("aria-label")
            r1 = r0
            end = time.monotonic() + 8
            while time.monotonic() < end:
                r0 = toggle.get_attribute("aria-label")
                press_chord(page, meta=True, alt=False, shift=True)
                page.wait_for_timeout(450)
                r1 = toggle.get_attribute("aria-label")
                if ("Collapse" in (r0 or "")) != ("Collapse" in (r1 or "")):
                    flipped = True
                    break
            if not flipped:
                fail(f"default chord not restored after Reset all (no flip): {r0!r} -> {r1!r}")
            # 新组合应已失效
            press_chord(page, meta=True, alt=True, shift=False)
            page.wait_for_timeout(450)
            r2 = toggle.get_attribute("aria-label")
            if ("Collapse" in (r1 or "")) != ("Collapse" in (r2 or "")):
                fail(f"rebound chord still active after Reset all: {r1!r} -> {r2!r}")
            print("[7b] 默认组合已恢复并重新生效，新组合已失效 —— 服务器设置净零残留")

            print()
            print(f"ALL GREEN: rebind -> 生效 -> 服务器持久化 -> 一键恢复默认 全链路通过 (command={command})")
            return 0
        finally:
            # 保证服务器设置净零：无论如何尝试 Reset all
            try:
                page.goto(f"{base_url}/settings/keyboard", wait_until="domcontentloaded")
                reset_all = page.get_by_role("button", name=re.compile(rf"^{RESET_ALL_TEXT}$"))
                if reset_all.count() > 0 and reset_all.first.is_enabled():
                    reset_all.first.click()
                    page.wait_for_timeout(1500)
            except Exception:
                pass
            browser.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:18154")
    args = parser.parse_args()
    try:
        return run(args.url)
    except PlaywrightTimeoutError as exc:
        print(f"FAIL: playwright timeout — {exc}", file=sys.stderr)
        return 1
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
