// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("../src/app"));

afterEach(cleanup);

describe("harness-control-room navPanel registration", () => {
  it("registers a single navPanel slot", () => {
    expect(app.navPanels).toHaveLength(1);
    expect(app.navPanels[0]?.id).toBe("harness-control-room");
    expect(app.navPanels[0]?.title).toBe("Control Room");
    expect(app.navPanels[0]?.path).toBe("control-room");
  });
});

describe("ControlRoomApp iframe + status badge", () => {
  it("renders an iframe pointing at the harness origin", async () => {
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" });
    expect(slot.container.querySelector("iframe")).not.toBeNull();
    const iframe = slot.container.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe.src).toContain("127.0.0.1:8765");
  });

  it("shows 在线/离线 based on the status route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, url: "http://127.0.0.1:8765", pending: 3 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" });
    // iframe 自身也会被 fetch 影响 —— 只断言状态徽章文案最终出现
    await vi.waitFor(() => {
      expect(slot.container.textContent).toContain("待处理 3");
    });
    fetchMock.mockRestore();
  });
});
