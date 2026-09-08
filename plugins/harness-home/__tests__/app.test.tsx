// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";

describe("harness-home plugin homepage sections", () => {
  it("registers homepageSection slots", async () => {
    const app = await loadPluginApp(() => import("../src/app"));

    // Verify hero slot is registered
    expect(app.homepageSections).toBeDefined();
    expect(app.homepageSections.length).toBe(3);

    const heroSection = app.homepageSections.find(
      (s) => s.id === "harness-hero",
    );
    expect(heroSection).toBeDefined();
    expect(heroSection?.title).toBe("任务概览");

    const secondarySection = app.homepageSections.find(
      (s) => s.id === "harness-secondary",
    );
    expect(secondarySection).toBeDefined();
    expect(secondarySection?.title).toBe("Agent 健康");

    const sidebarSection = app.homepageSections.find(
      (s) => s.id === "harness-sidebar",
    );
    expect(sidebarSection).toBeDefined();
    expect(sidebarSection?.title).toBe("成本计费");
  });
});