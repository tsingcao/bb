#!/usr/bin/env node
/**
 * Optional CPU-contention harness for the machine-install script suite.
 *
 * The suite spawns the real `install-machine.sh`, which spawns a joined host
 * daemon and waits for it to connect. Under CPU contention (parallel CI
 * workers, a loaded dev machine) each spawn+handshake can take several
 * seconds; vitest's default per-test deadline is 5000ms, so tests that are
 * "fast enough" on an idle machine blow past the deadline under load and the
 * suite fails spuriously. That was the original "6 timeouts" failure mode;
 * the suite now carries explicit 30s deadlines (`describe(..., 30_000)`).
 *
 * This script re-runs the suite while N busy-loop node processes peg the CPU,
 * so deadline fragility shows up on a dev machine instead of first in CI.
 *
 * Usage (from anywhere; the script resolves the package root):
 *   node apps/server/scripts/install-machine-load-check.mjs [options]
 *
 * Options:
 *   --load N            busy-loop processes to spawn (default: ceil(ncpu/2),
 *                       min 2). 0 disables load.
 *   --workers N         vitest --maxWorkers (default: 2, mimicking a
 *                       constrained CI worker slot).
 *   --test-timeout MS   vitest --test-timeout (default: 30_000, the suite's
 *                       documented robust deadline).
 *   --probe MS          informational mode: run once with the given deadline
 *                       and report pass/fail, but always exit 0. Note that
 *                       describe-level deadlines (`describe(..., 30_000)`)
 *                       take precedence over vitest's --test-timeout, so a
 *                       probe below the suite's own deadline is a no-op
 *                       against it — it only reproduces fragility in suites
 *                       that rely on vitest's 5000ms default (i.e. the
 *                       original failure mode on pre-fix code).
 *   --keep-load         leave the load generators running after the run
 *                       (debugging; you must kill them yourself).
 *   --help              show this text.
 *
 * Exit codes (gate mode, the default):
 *   0  suite green under the configured load+deadline
 *   1  one or more tests failed/timed out under load
 *   2  usage or environment error (vitest missing, bad option)
 *
 * Optional by design: not wired into default CI. Add a CI step calling this
 * (gate mode) when touching install-machine.sh or its test suite, so a
 * regression to tight deadlines is caught under contention before merge.
 */
import { spawn, spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(scriptDir, "..");
const repoRoot = join(pkgDir, "..", "..");

const args = process.argv.slice(2);
function optionValue(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const raw = args[index + 1];
  if (raw === undefined) {
    console.error(`error: ${name} requires a value`);
    process.exit(2);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    console.error(
      `error: ${name} expects a non-negative integer, got "${raw}"`,
    );
    process.exit(2);
  }
  return value;
}

if (args.includes("--help") || args.includes("-h")) {
  const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const doc = /\/\*\*([\s\S]*?)\*\//.exec(source)?.[1] ?? "";
  console.log(doc.trim());
  process.exit(0);
}

const cpuCount =
  Number(
    spawnSync("sysctl", ["-n", "hw.ncpu"], { encoding: "utf8" }).stdout.trim(),
  ) || 4;
const load = args.includes("--load")
  ? optionValue("--load", 0)
  : Math.max(2, Math.ceil(cpuCount / 2));
const workers = optionValue("--workers", 2);
const testTimeout = optionValue("--test-timeout", 30_000);
const probe = args.includes("--probe") ? optionValue("--probe", 0) : null;
const keepLoad = args.includes("--keep-load");

const vitestBin = join(repoRoot, "node_modules", ".bin", "vitest");
try {
  statSync(vitestBin);
} catch {
  console.error(
    `error: vitest not found at ${vitestBin} — run \`pnpm install\` first`,
  );
  process.exit(2);
}

const loadChildren = [];
function startLoad() {
  for (let index = 0; index < load; index += 1) {
    const child = spawn(process.execPath, ["-e", "while (true) {}"], {
      stdio: "ignore",
    });
    loadChildren.push(child);
  }
}

function stopLoad() {
  for (const child of loadChildren) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
  loadChildren.length = 0;
}

const deadline = probe ?? testTimeout;
const mode = probe === null ? "gate" : `probe(${probe}ms)`;

console.log(
  `[install-machine-load-check] mode=${mode} load=${load} workers=${workers} test-timeout=${deadline}ms cpu=${cpuCount}`,
);
startLoad();
try {
  const result = spawnSync(
    vitestBin,
    [
      "run",
      "--config",
      "vitest.config.ts",
      "test/app/install-machine-script.test.ts",
      "--test-timeout",
      String(deadline),
      "--maxWorkers",
      String(workers),
    ],
    {
      cwd: pkgDir,
      stdio: "inherit",
      env: { ...process.env, BB_LOAD_CHECK: "1" },
    },
  );
  const status = result.status ?? 1;
  console.log(
    `[install-machine-load-check] vitest exit=${status} (${deadline}ms deadline, ${load} load generators)`,
  );

  if (probe !== null) {
    // Informational: report the outcome, never fail the caller.
    console.log(
      status === 0
        ? `[install-machine-load-check] probe ok: suite passed at ${probe}ms under load`
        : `[install-machine-load-check] probe reproduced: suite failed at ${probe}ms under load`,
    );
    process.exit(0);
  }

  if (status !== 0) {
    console.error(
      `[install-machine-load-check] FAIL: suite is not robust at ${deadline}ms under ${load}-core contention. ` +
        `If a test timed out, it crossed its deadline — check the per-test timeouts in ` +
        `test/app/install-machine-script.test.ts (the suite should carry an explicit ` +
        `describe(..., 30_000) deadline, not rely on vitest's 5000ms default).`,
    );
    process.exit(1);
  }
  console.log(
    `[install-machine-load-check] PASS: suite green at ${deadline}ms under ${load}-core contention.`,
  );
  process.exit(0);
} finally {
  if (!keepLoad) stopLoad();
  else if (loadChildren.length > 0) {
    console.log(
      `[install-machine-load-check] --keep-load: ${loadChildren.length} load generators left running`,
    );
  }
}