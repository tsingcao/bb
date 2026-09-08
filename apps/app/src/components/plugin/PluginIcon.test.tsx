// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";

const { PluginIcon } = await import("./PluginIcon");

afterEach(() => {
  cleanup();
  resetPluginLogoStoreForTest();
});

it("uses branding.icon instead of the image logo or contribution hint", () => {
  setPluginLogoUrls(
    new Map([
      [
        "docs",
        {
          displayName: "Docs",
          icon: "FileText",
          compactIconUrl: null,
          logoUrl: "/api/v1/plugins/docs/assets/logo?h=abc",
          logoDarkUrl: "/api/v1/plugins/docs/assets/logo-dark?h=def",
          icons: new Map(),
        },
      ],
    ]),
  );

  const view = render(<PluginIcon pluginId="docs" icon="Layers" />);
  expect(view.container.querySelector("[data-icon=FileText]")).toBeTruthy();
  expect(view.container.querySelector("[data-icon=Layers]")).toBeNull();
  expect(view.container.querySelector("img")).toBeNull();
});

it("uses the contribution hint when branding.icon is omitted", () => {
  setPluginLogoUrls(
    new Map([
      [
        "github",
        {
          displayName: "GitHub",
          icon: null,
          compactIconUrl: null,
          logoUrl: "/api/v1/plugins/github/assets/logo?h=abc",
          logoDarkUrl: null,
          icons: new Map(),
        },
      ],
    ]),
  );

  const view = render(<PluginIcon pluginId="github" icon="Layers" />);
  expect(view.container.querySelector("[data-icon=Layers]")).toBeTruthy();
  expect(view.container.querySelector("img")).toBeNull();
});

it("uses Zap compactly when a logo-only plugin has no contribution hint", () => {
  setPluginLogoUrls(
    new Map([
      [
        "github",
        {
          displayName: "GitHub",
          icon: null,
          compactIconUrl: null,
          logoUrl: "/api/v1/plugins/github/assets/logo?h=abc",
          logoDarkUrl: null,
          icons: new Map(),
        },
      ],
    ]),
  );

  const view = render(<PluginIcon pluginId="github" icon={null} />);
  expect(view.container.querySelector("[data-icon=Zap]")).toBeTruthy();
  expect(view.container.querySelector("img")).toBeNull();
});

it("uses a plugin-owned compact SVG before named icon hints", () => {
  const compactIconUrl = "/api/v1/plugins/omega/assets/icon?h=abc";
  setPluginLogoUrls(
    new Map([
      [
        "omega",
        {
          displayName: "Omegacode",
          icon: "Workflow",
          compactIconUrl,
          logoUrl: null,
          logoDarkUrl: null,
          icons: new Map(),
        },
      ],
    ]),
  );

  const view = render(<PluginIcon pluginId="omega" icon="Layers" />);
  const asset = view.container.querySelector(
    `[data-plugin-icon-asset="${compactIconUrl}"]`,
  );
  expect(asset).toBeTruthy();
  expect(asset?.getAttribute("style")).toContain(compactIconUrl);
  expect(view.container.querySelector("[data-icon]")).toBeNull();
});

it("resolves every named branding.icon the shipped plugins declare", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const { dirname, join, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { pluginIconName } = await import("./PluginIcon");

  const pluginsDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../../plugins",
  );
  const entries = await readdir(pluginsDir, { withFileTypes: true });
  const declared: Array<[string, string]> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest: { bb?: { branding?: { icon?: string } } } = JSON.parse(
      await readFile(join(pluginsDir, entry.name, "package.json"), "utf8"),
    );
    const icon = manifest.bb?.branding?.icon;
    if (icon === undefined || icon.startsWith("./")) continue;
    declared.push([entry.name, icon]);
  }

  expect(declared.length).toBeGreaterThan(0);
  // 每个声明的命名图标都必须可解析：要么本身在图标集内，要么经共享规范注册表
  // （@bb/shared-ui/icon-registry 的 PLUGIN_ICON_ALIASES）映射到原生图标——
  // 绝不静默落回 Zap 兜底。解析不到 = review 期响亮失败：点名未登记的图标名。
  const unresolved = declared.filter(
    ([, icon]) => pluginIconName(icon) === "Zap" && icon !== "Zap",
  );
  if (unresolved.length > 0) {
    throw new Error(
      `插件图标未解析（在 @bb/shared-ui/icon-registry 的 PLUGIN_ICON_ALIASES 登记` +
        `或改用 ICON_NAMES 内的原生名）：` +
        unresolved.map(([plugin, icon]) => `${plugin} → ${icon}`).join(", "),
    );
  }
});

it("maps foreign plugin icon names to native icons", async () => {
  const { pluginIconName } = await import("./PluginIcon");

  expect(pluginIconName("MessagesSquare")).toBe("MessageSquare");
  expect(pluginIconName("LayoutDashboard")).toBe("GridView");
  expect(pluginIconName("Home")).toBe("AppWindow");
});

it("plugin icon registry aliases are consistent with ICON_NAMES", async () => {
  const { ICON_NAMES } = await import("@bb/shared-ui/icon");
  const { PLUGIN_ICON_ALIASES } = await import("@bb/shared-ui/icon-registry");
  const native = new Set(ICON_NAMES as readonly string[]);

  // 注册表的值必须是真实存在的原生图标（防别名表里写错目标名）
  const badValues = Object.entries(PLUGIN_ICON_ALIASES).filter(
    ([, target]) => !native.has(target),
  );
  if (badValues.length > 0) {
    throw new Error(
      `PLUGIN_ICON_ALIASES 目标不在 ICON_NAMES：` +
        badValues.map(([k, v]) => `${k} → ${v}`).join(", "),
    );
  }

  // 别名键不得与原生图标重名（重名说明该名已在图标集内，登记是多余的）
  const collisions = Object.keys(PLUGIN_ICON_ALIASES).filter((k) =>
    native.has(k),
  );
  if (collisions.length > 0) {
    throw new Error(
      `PLUGIN_ICON_ALIASES 键与 ICON_NAMES 重名（多余登记）：${collisions.join(", ")}`,
    );
  }
});
