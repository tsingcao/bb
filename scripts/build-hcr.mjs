import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import {
  buildPluginApp,
  buildPluginServer,
  resolvePluginBuildToolchain,
} from "../packages/plugin-build/src/index.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const plugin = "harness-control-room";
const rootDirectory = resolve(repoRoot, "plugins", plugin);
const bbPackage = JSON.parse(
  await readFile(resolve(repoRoot, "packages/bb-app/package.json"), "utf8"),
);
const toolchain = await resolvePluginBuildToolchain(
  resolve(repoRoot, "node_modules/.bb-toolchain"),
);
const server = await buildPluginServer(rootDirectory, bbPackage.version, toolchain);
const app = await buildPluginApp(rootDirectory, bbPackage.version, toolchain);
console.log("built:", server.jsPath, "|", app.jsPath, app.cssPath, app.metaPath);
