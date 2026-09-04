// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";

// jsdom 不实现 scrollIntoView，打桩避免 chat tab 的滚动 effect 抛错
if (typeof HTMLElement !== "undefined") {
  HTMLElement.prototype.scrollIntoView = () => {};
}

const app = await loadPluginApp(() => import("../src/app"));

// renderSlot 不自带自动清理（vitest 未开 globals），显式清理避免跨测试 DOM 累积
afterEach(() => cleanup());

function mountPanel() {
  return renderSlot<PluginThreadPanelProps>(
    { component: app.threadPanelActions[0]!.component as never },
    { threadId: "t1", params: null },
    {
      rpc: {
        createSession: () => ({ session_id: "sess_test1234" }),
        history: () => ({ messages: [] }),
      },
    },
  );
}

describe("harness-chat threadPanelAction registration", () => {
  it("registers a threadPanelAction named harness-chat", () => {
    expect(app.threadPanelActions).toHaveLength(1);
    expect(app.threadPanelActions[0]?.id).toBe("harness-chat");
    expect(app.threadPanelActions[0]?.title).toBe("Harness 会话");
  });
});

describe("P2 监测 tab", () => {
  it("面板头部提供 对话/监控 两个 tab，默认在对话", () => {
    mountPanel();
    expect(screen.getByRole("button", { name: "对话" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "监控" })).toBeTruthy();
    expect(screen.getByPlaceholderText(/向 Harness 发消息/)).toBeTruthy();
  });

  it("切换到监控 tab 渲染会话态、episodes 区与右侧面板绑定指引", async () => {
    mountPanel();
    fireEvent.click(screen.getByRole("button", { name: "监控" }));
    await waitFor(() => {
      expect(screen.getByText("最近 Agent 运行")).toBeTruthy();
      expect(screen.getByText("经验信号")).toBeTruthy();
      expect(screen.getByText("右侧面板绑定")).toBeTruthy();
    });
  });

  it("监控 tab 在数据源全失败时显示离线态而非崩溃", async () => {
    mountPanel();
    fireEvent.click(screen.getByRole("button", { name: "监控" }));
    await waitFor(() => {
      expect(screen.getByText(/离线/)).toBeTruthy();
    });
  });
});
