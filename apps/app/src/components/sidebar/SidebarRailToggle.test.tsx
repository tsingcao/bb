// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { SidebarProvider } from "@/components/ui/sidebar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SIDEBAR_RAIL_COLLAPSE_LABEL,
  SIDEBAR_RAIL_EXPAND_LABEL,
  SidebarRailToggle,
} from "./SidebarRailToggle";

// ⌘⇧\ 命令（sidebar.railToggle）的快捷键提示：mock 掉 provider，
// 与 SidebarNavigationRegion.test 同一约定 —— 组件只消费 useAppCommandShortcut。
const mocks = vi.hoisted(() => ({
  shortcut: null as { label: string; ariaKeyshortcuts: string } | null,
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandShortcut: () => mocks.shortcut,
}));

function renderToggle(rail?: boolean, onRailChange?: (rail: boolean) => void) {
  render(
    <CompactViewportOverrideProvider isCompactViewport={false}>
      <SidebarProvider rail={rail} onRailChange={onRailChange}>
        <SidebarRailToggle />
      </SidebarProvider>
    </CompactViewportOverrideProvider>,
  );
  return screen.getByTestId("sidebar-rail-toggle");
}

function chevron(button: HTMLElement, name: string): boolean {
  return button.querySelector(`[data-icon="${name}"]`) !== null;
}

describe("SidebarRailToggle", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mocks.shortcut = null;
  });

  it("expanded state: aria-label announces the collapse action and chevron points left", () => {
    const button = renderToggle(false);
    expect(button.getAttribute("aria-label")).toBe(SIDEBAR_RAIL_COLLAPSE_LABEL);
    expect(chevron(button, "ChevronLeft")).toBe(true);
    expect(chevron(button, "ChevronRight")).toBe(false);
  });

  it("rail state: aria-label announces the expand action and chevron points right", () => {
    const button = renderToggle(true);
    expect(button.getAttribute("aria-label")).toBe(SIDEBAR_RAIL_EXPAND_LABEL);
    expect(chevron(button, "ChevronRight")).toBe(true);
    expect(chevron(button, "ChevronLeft")).toBe(false);
  });

  it("appends the command shortcut hint to label/title and exposes aria-keyshortcuts", () => {
    mocks.shortcut = { label: "⌘⇧\\", ariaKeyshortcuts: "Meta+Shift+\\" };
    const button = renderToggle(false);
    const hinted = `${SIDEBAR_RAIL_COLLAPSE_LABEL} (⌘⇧\\)`;
    expect(button.getAttribute("aria-label")).toBe(hinted);
    expect(button.getAttribute("title")).toBe(hinted);
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+Shift+\\");
  });

  it("rail state: shortcut hint composes onto the expand label the same way", () => {
    mocks.shortcut = { label: "⌘⇧\\", ariaKeyshortcuts: "Meta+Shift+\\" };
    const button = renderToggle(true);
    expect(button.getAttribute("aria-label")).toBe(`${SIDEBAR_RAIL_EXPAND_LABEL} (⌘⇧\\)`);
    expect(button.getAttribute("title")).toBe(`${SIDEBAR_RAIL_EXPAND_LABEL} (⌘⇧\\)`);
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+Shift+\\");
    expect(chevron(button, "ChevronRight")).toBe(true);
  });

  it("draws the shortcut pill next to the button while expanded", () => {
    mocks.shortcut = { label: "⌘⇧\\", ariaKeyshortcuts: "Meta+Shift+\\" };
    const button = renderToggle(false);
    const pill = button.nextElementSibling;
    expect(pill?.tagName).toBe("KBD");
    expect(pill?.textContent).toBe("⌘⇧\\");
    expect(pill?.getAttribute("aria-hidden")).toBe("false");
  });

  it("hides the shortcut pill in rail mode and without a shortcut", () => {
    mocks.shortcut = { label: "⌘⇧\\", ariaKeyshortcuts: "Meta+Shift+\\" };
    const railButton = renderToggle(true);
    expect(railButton.nextElementSibling).toBeNull();

    cleanup();
    mocks.shortcut = null;
    const plainButton = renderToggle(false);
    expect(plainButton.nextElementSibling).toBeNull();
  });

  it("click wires to toggleRail: rail=false reports true to onRailChange", () => {
    const onRailChange = vi.fn();
    fireEvent.click(renderToggle(false, onRailChange));
    expect(onRailChange).toHaveBeenCalledTimes(1);
    expect(onRailChange).toHaveBeenCalledWith(true);
  });

  it("click wires to toggleRail: rail=true reports false to onRailChange", () => {
    const onRailChange = vi.fn();
    fireEvent.click(renderToggle(true, onRailChange));
    expect(onRailChange).toHaveBeenCalledTimes(1);
    expect(onRailChange).toHaveBeenCalledWith(false);
  });

  it("uncontrolled mode: clicks toggle internal rail state and swap label + chevron together", () => {
    const button = renderToggle();
    expect(button.getAttribute("aria-label")).toBe(SIDEBAR_RAIL_COLLAPSE_LABEL);

    fireEvent.click(button);
    expect(button.getAttribute("aria-label")).toBe(SIDEBAR_RAIL_EXPAND_LABEL);
    expect(chevron(button, "ChevronRight")).toBe(true);

    fireEvent.click(button);
    expect(button.getAttribute("aria-label")).toBe(SIDEBAR_RAIL_COLLAPSE_LABEL);
    expect(chevron(button, "ChevronLeft")).toBe(true);
  });

  it("renders nothing on a compact viewport", () => {
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <SidebarProvider>
          <SidebarRailToggle />
        </SidebarProvider>
      </CompactViewportOverrideProvider>,
    );
    expect(screen.queryByTestId("sidebar-rail-toggle")).toBeNull();
  });
});
