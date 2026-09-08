#!/usr/bin/env node
// check-plugin-icons.ts —  shipped-plugin 图标解析闸
//
// 扫描 plugins/*/package.json 中每个插件声明的 bb.branding.icon，
// 用与 App 完全相同的解析实现（@bb/shared-ui/icon-registry 的
// resolvePluginIconName + ICON_NAMES）检查是否落回 Zap 兜底。
//
// 退出码契约：
//   0  — 全部声明的命名图标都可解析（原生 ICON_NAMES 命中或经
//        PLUGIN_ICON_ALIASES 映射），无一落回 Zap
//   1  — 存在声明图标解析回退到 Zap（输出 ::error 注解，点名 插件 → 图标）
//        或 plugins/ 下没有任何声明命名图标的插件（视为配置漂移）
//   2  — plugins/ 目录缺失或读取失败（基础设施问题，非判定）
//
// 为什么需要它：PluginIcon.test.tsx 的 shipped-plugin 扫描只在 app 测试
// 分片里跑；本脚本是 CI checks job 里的独立快检，任何新插件声明一个未登记
// 的图标名都会让 CI 立刻红掉，而不是在 review 期靠人眼发现。
//
// 运行：pnpm run check:plugin-icons

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ICON_NAMES } from "@bb/shared-ui/icon";
import { resolvePluginIconName } from "@bb/shared-ui/icon-registry";

// 本文件位于 apps/app/scripts/，仓库根的 plugins/ 在上三级目录。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const pluginsDir = join(root, "plugins");

type Manifest = { bb?: { branding?: { icon?: string } } };

async function main(): Promise<number> {
  let entries;
  try {
    entries = await readdir(pluginsDir, { withFileTypes: true });
  } catch {
    console.error(`::error::读取插件目录失败：${pluginsDir}（退出码 2）`);
    return 2;
  }

  const declared: Array<[string, string]> = [];
  const unresolved: Array<[string, string]> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let manifest: Manifest;
    try {
      manifest = JSON.parse(
        await readFile(join(pluginsDir, entry.name, "package.json"), "utf8"),
      ) as Manifest;
    } catch {
      console.error(`::warning::${entry.name}/package.json 缺失或非法，跳过`);
      continue;
    }
    const icon = manifest.bb?.branding?.icon;
    if (icon === undefined || icon.startsWith("./")) continue;
    declared.push([entry.name, icon]);
    // 显式声明 "Zap" 不算回退（插件有意选用兜底图标）；其余解析到 Zap
    // 即未登记：要么本身不在 ICON_NAMES、要么不在 PLUGIN_ICON_ALIASES。
    if (icon !== "Zap" && resolvePluginIconName(icon, ICON_NAMES) === "Zap") {
      unresolved.push([entry.name, icon]);
    }
  }

  if (declared.length === 0) {
    console.error(
      "::error::plugins/ 下没有任何声明 bb.branding.icon 的插件——扫描空转，视为配置漂移",
    );
    return 1;
  }

  if (unresolved.length > 0) {
    console.error(
      "::error::插件声明的 branding.icon 解析回退到 Zap 兜底（需在 " +
        "@bb/shared-ui/icon-registry 的 PLUGIN_ICON_ALIASES 登记映射，或改用 " +
        "ICON_NAMES 内的原生名）：" +
        unresolved.map(([p, i]) => `${p} → ${i}`).join(", "),
    );
    return 1;
  }

  console.log(
    `✓ 全部 ${declared.length} 个声明图标可解析（无一落回 Zap 兜底）`,
  );
  return 0;
}

process.exitCode = await main();