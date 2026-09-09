import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { sidebarMessages } from "./sidebar-messages";

const scriptSource = readFileSync(
  resolve(import.meta.dirname, "../../../../scripts/keyboard-rebind-e2e.py"),
  "utf8",
);

function requireScriptAnchor(fragment: string): void {
  if (!scriptSource.includes(fragment)) {
    throw new Error(
      `keyboard-rebind-e2e.py no longer contains ${JSON.stringify(fragment)}; update the script and this contract test together.`,
    );
  }
}

describe("sidebarMessages ↔ keyboard-rebind-e2e.py aria-label 契约", () => {
  it("脚本仍通过 sidebar-rail-toggle 的 aria-label 子串判定 rail 状态翻转", () => {
    requireScriptAnchor('get_by_test_id("sidebar-rail-toggle")');
    requireScriptAnchor('"icon rail" not in');
    requireScriptAnchor("state_flipped");
    requireScriptAnchor('("Collapse" in (aria0 or ""))');
  });

  it("railCollapseLabel 同时含 icon rail 与 Collapse（aria0 基线定位依赖）", () => {
    expect(sidebarMessages.railCollapseLabel).toContain("icon rail");
    expect(sidebarMessages.railCollapseLabel).toContain("Collapse");
  });

  it("railExpandLabel 含 icon rail 与 Expand 且不含 Collapse（与 Collapse 标签构成 XOR 翻转）", () => {
    expect(sidebarMessages.railExpandLabel).toContain("icon rail");
    expect(sidebarMessages.railExpandLabel).toContain("Expand");
    expect(sidebarMessages.railExpandLabel).not.toContain("Collapse");
  });

  it("shortcutHint 保持 label 为前缀并用括号包快捷键（子串判定与日志 split 均依赖）", () => {
    const collapse = sidebarMessages.shortcutHint(
      sidebarMessages.railCollapseLabel,
      "⇧ ⌘ \\",
    );
    expect(collapse.startsWith(sidebarMessages.railCollapseLabel)).toBe(true);
    expect(collapse).toContain("(");
    expect(collapse).toContain("icon rail");
    expect(collapse).toContain("Collapse");

    const expand = sidebarMessages.shortcutHint(
      sidebarMessages.railExpandLabel,
      "Ctrl + Shift + \\",
    );
    expect(expand.startsWith(sidebarMessages.railExpandLabel)).toBe(true);
    expect(expand).not.toContain("Collapse");
  });
});
