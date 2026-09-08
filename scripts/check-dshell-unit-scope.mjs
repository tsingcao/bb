#!/usr/bin/env node
/**
 * 校验 apps/app 的 test:dshell:unit 别名文件清单与 ci.yml @bb/app 分片覆盖一致。
 *
 * 背景：dshell 契约单测有两个入口——
 *   1. dshell-skin-snapshot.yml 的 unit 步骤（pnpm --filter=@bb/app run test:dshell:unit）
 *   2. ci.yml tests job 的 dshell-unit 分片（turbo run test:dshell:unit，同别名）
 * 而 ci.yml 的 @bb/app 分片（vitest run --config vitest.config.ts 无文件参数）会跑
 * apps/app/src/** 下全部测试文件。若别名文件清单漂移（漏加新文件 / 误删 / 引了
 * 非契约文件），快照 workflow 与 dshell-unit 分片会静默丢掉套件——但 @bb/app 分片
 * 仍然全量跑，回归只能靠那个分片兜底，本 gate 在提交时就拦下。
 *
 * 契约（dshell 契约范围 = 别名必须精确覆盖的集合）：
 *   * src/lib/dshell*.test.{ts,tsx}                    —— dshell lib 族（dshell / dshell-migration / dshell-panel-perf）
 *   * src/components/settings/Dshell*.test.{ts,tsx}    —— 设置卡 DSH 族（DshellAppearanceSetting / DshellMigrationBanner）
 *   * src/components/ui/sidebar.test.{ts,tsx}          —— sidebar 组件族（精确，ui/ 下其它 sidebar 测试不属契约）
 *   * src/components/sidebar/SidebarRailToggle.test.{ts,tsx} —— rail 族（精确；该目录还有 20+ 个非契约测试）
 *   * src/components/layout/AppLayout.sidebar-rail.test.{ts,tsx} —— rail 布局族（精确；sidebar-rail-keydown 不属契约）
 * 范围内任何文件都必须同时出现在别名里（丢套件即红）；别名里任何文件都必须落在
 * 范围内且被 @bb/app 分片覆盖（多引/悬空即红）。
 *
 * 提交树存在性：别名引用的每个测试路径还必须真实存在于当前提交树（git ls-tree），
 * 防止别名引用未提交/未合入的文件——磁盘上存在（如 untracked）但没进树一样红。
 * 本地（提交前）跑 = 校验「即将提交的别名 vs 已提交树」；CI（干净 checkout）跑 =
 * 校验「HEAD 的别名 vs HEAD 的树」，同一断言两个语义。
 *
 * 用法：node scripts/check-dshell-unit-scope.mjs   （exit 0 绿 / 1 红）
 * 可选：DSHELL_UNIT_TREE_REF=<ref> 指定树存在性检查的提交（默认 HEAD，测试用）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = path.join(ROOT, "apps", "app");
const SCRIPT_NAME = "test:dshell:unit";
const TREE_REF = process.env.DSHELL_UNIT_TREE_REF ?? "HEAD";

/** dshell 契约范围谓词（相对 apps/app 的路径）。 */
const SCOPE_EXACT = new Set([
  "src/components/ui/sidebar.test.tsx",
  "src/components/sidebar/SidebarRailToggle.test.tsx",
  "src/components/layout/AppLayout.sidebar-rail.test.tsx",
]);
function isDshellScope(rel) {
  if (SCOPE_EXACT.has(rel)) return true;
  return (
    /^src\/lib\/dshell.*\.test\.(ts|tsx)$/.test(rel) ||
    /^src\/components\/settings\/Dshell.*\.test\.(ts|tsx)$/.test(rel)
  );
}

/** 递归收集 apps/app 下 vitest include（src/**\/ *.test.{ts,tsx}）命中的相对路径。 */
function appCoveredFiles() {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else if (/\.test\.(ts|tsx)$/.test(entry.name)) {
        out.push(rel);
      }
    }
  };
  walk(path.join(APP_DIR, "src"), "src");
  return out;
}

const pkg = JSON.parse(readFileSync(path.join(APP_DIR, "package.json"), "utf8"));
const script = pkg.scripts?.[SCRIPT_NAME] ?? "";
if (!script.startsWith("vitest run") || !script.includes("--config")) {
  console.error(`✗ ${SCRIPT_NAME} 命令形态变了（不再是 vitest run --config …）：\n   ${script}`);
  process.exit(1);
}
// 别名显式文件清单：命令里所有 *.test.ts(x) 参数。
const aliasFiles = script.split(/\s+/).filter((t) => /\.test\.(ts|tsx)$/.test(t));

const covered = appCoveredFiles();
const coveredSet = new Set(covered);
const scope = covered.filter(isDshellScope);
const scopeSet = new Set(scope);

const failures = [];

// 1) 别名里的文件必须真实存在且被 @bb/app 分片覆盖（防悬空/多引）。
for (const f of aliasFiles) {
  if (!existsSync(path.join(APP_DIR, f))) {
    failures.push(`别名引用了不存在的文件：${f}`);
  } else if (!coveredSet.has(f)) {
    failures.push(`别名引用了 @bb/app 分片未覆盖的文件（不在 src/**/*.test.{ts,tsx}）：${f}`);
  }
}
// 2) 别名不得含契约范围之外的文件。
for (const f of aliasFiles) {
  if (!scopeSet.has(f)) {
    failures.push(`别名含非 dshell 契约范围的文件：${f}`);
  }
}
// 3) 契约范围内被 app 分片覆盖的文件必须全部进别名（丢套件方向）。
for (const f of scope) {
  if (!aliasFiles.includes(f)) {
    failures.push(`@bb/app 分片覆盖的 dshell 契约文件未进别名（丢套件）：${f}`);
  }
}
// 4) 提交树存在性：每个被引用的测试路径必须存在于提交树（防引用未提交/未合入文件）。
//    别名从磁盘读（本地=即将提交的别名），存在性对着 git ls-tree 查（不信任磁盘）。
let committedTestFiles = null;
try {
  const tree = execFileSync(
    "git", ["ls-tree", "-r", "--name-only", TREE_REF, "--", "apps/app"],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  committedTestFiles = new Set(tree.split("\n").filter((l) => /\.test\.(ts|tsx)$/.test(l)));
} catch {
  failures.push(`无法读取提交树（git ls-tree ${TREE_REF}）——确认在 bb-fork git 仓库内运行`);
}
if (committedTestFiles) {
  try {
    execFileSync(
      "git", ["cat-file", "-e", `${TREE_REF}:apps/app/package.json`],
      { cwd: ROOT, stdio: "ignore" },
    );
  } catch {
    failures.push(`apps/app/package.json 不在提交树（${TREE_REF}）——别名尚未提交，树存在性无从谈起`);
  }
  for (const f of aliasFiles) {
    // ls-tree 输出带 apps/app/ 前缀，别名 token 是 app 相对路径 → 拼前缀再查。
    if (!committedTestFiles.has(`apps/app/${f}`)) {
      failures.push(`别名引用的测试文件不在提交树（${TREE_REF}，未提交/未合入）：${f}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`✗ ${SCRIPT_NAME} 文件清单与 @bb/app 分片覆盖不一致（${failures.length}）`);
  for (const f of failures) console.error(`   - ${f}`);
  console.error(`   别名现有 ${aliasFiles.length} 个文件；契约范围 ${scope.length} 个；提交树 ${TREE_REF}。`);
  process.exit(1);
}

console.log(
  `✓ ${SCRIPT_NAME} 文件清单与 @bb/app 分片覆盖一致：${aliasFiles.length} 个套件全在契约范围内、` +
    `全被 app 分片覆盖、全部存在于提交树（${TREE_REF}）`,
);