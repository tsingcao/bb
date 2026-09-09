import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { keyboardSettingsMessages } from "./keyboard-settings-messages";

const SCRIPT_PATH = resolve(
  import.meta.dirname,
  "../../../../scripts/keyboard-rebind-e2e.py",
);

function scriptConstantLine(name: string): string {
  const source = readFileSync(SCRIPT_PATH, "utf8");
  const line = source
    .split("\n")
    .find((candidate) => candidate.startsWith(`${name} = `));
  if (line === undefined) {
    throw new Error(
      `keyboard-rebind-e2e.py no longer defines ${name}; update the script and this contract test together.`,
    );
  }
  return line;
}

function scriptRegex(name: "RECORD_ARIA_RE" | "RECORDER_BY_ROLE"): RegExp {
  const line = scriptConstantLine(name);
  const match = /re\.compile\(r"(.*)"\)\s*$/.exec(line);
  if (match === null) {
    throw new Error(
      `keyboard-rebind-e2e.py defines ${name} in an unparseable form; update the script and this contract test together.`,
    );
  }
  return new RegExp(match[1], "u");
}

function scriptString(name: "RESET_ALL_TEXT"): string {
  const line = scriptConstantLine(name);
  const match = /= "([^"]*)"\s*$/.exec(line);
  if (match === null) {
    throw new Error(
      `keyboard-rebind-e2e.py defines ${name} in an unparseable form; update the script and this contract test together.`,
    );
  }
  return match[1];
}

const RECORD_ARIA_RE = scriptRegex("RECORD_ARIA_RE");
const RECORDER_BY_ROLE = scriptRegex("RECORDER_BY_ROLE");
const RESET_ALL_TEXT = scriptString("RESET_ALL_TEXT");

describe("keyboardSettingsMessages ↔ keyboard-rebind-e2e.py 解析契约", () => {
  it("recordAriaLabel 产物匹配脚本实时解析的 RECORD_ARIA_RE 并能提取 label/shortcut", () => {
    const aria = keyboardSettingsMessages.recordAriaLabel(
      "Toggle icon rail",
      "⇧ ⌘ \\",
    );
    const match = RECORD_ARIA_RE.exec(aria);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("Toggle icon rail");
    expect(match?.[2]).toBe("⇧ ⌘ \\");
  });

  it("recordAriaLabel 对含逗号的快捷键文案仍可解析（group 边界是第一个逗号）", () => {
    const aria = keyboardSettingsMessages.recordAriaLabel(
      "New thread",
      "Ctrl + Shift + O",
    );
    const match = RECORD_ARIA_RE.exec(aria);
    expect(match?.[1]).toBe("New thread");
    expect(match?.[2]).toBe("Ctrl + Shift + O");
  });

  it("recordingAriaLabel 产物匹配脚本实时解析的 RECORDER_BY_ROLE（railToggle 行定位）", () => {
    const aria = keyboardSettingsMessages.recordingAriaLabel("Toggle icon rail");
    expect(RECORDER_BY_ROLE.test(aria)).toBe(true);
    expect(aria.startsWith("Recording shortcut for Toggle icon rail")).toBe(
      true,
    );
  });

  it("recordingAriaLabel 对其它命令也保持 Record|Recording 前缀结构", () => {
    const aria = keyboardSettingsMessages.recordingAriaLabel("New thread");
    expect(aria.startsWith("Recording shortcut for New thread")).toBe(true);
  });

  it("resetAllLabel 逐字等于脚本实时解析的 RESET_ALL_TEXT（finally 清理定位依赖）", () => {
    expect(keyboardSettingsMessages.resetAllLabel).toBe(RESET_ALL_TEXT);
  });

  it("recordAriaLabel 的 label 段不含逗号（脚本 [^,]+ 提取的前提）", () => {
    const samples = ["Toggle icon rail", "New thread", "Toggle sidebar"];
    for (const label of samples) {
      const aria = keyboardSettingsMessages.recordAriaLabel(label, "⌘ K");
      const match = RECORD_ARIA_RE.exec(aria);
      expect(match?.[1]).toBe(label);
    }
  });
});
