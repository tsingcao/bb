# Issue: host daemon child aborts with SIGABRT ("Abort trap: 6") during install when the data dir ends in `.app` (macOS 27 + Node 22)

Draft for the get-bb/bb issue tracker. Fills the `.github/ISSUE_TEMPLATE/bug.yml`
fields and follows `docs/filing-issues.md`. Once a fix or triage note lands, this
file can be dropped or linked from the issue.

## Summary

Running `install.sh` (the machine-install script in `apps/server/src/assets/install-machine.sh`)
with the default per-server data dir fails on macOS 27 with Node 22: the joined
host daemon child aborts with `SIGABRT` ("Abort trap: 6") during Node process
initialization, before any JavaScript runs, so the enrollment always fails with
"bb host daemon exited before it connected to <server>". The same enrollment
succeeds when `BB_DATA_DIR` points anywhere that does not end in `.app`.

Root cause lives outside the installer: a **backgrounded** `#!/usr/bin/env node`
shebang script whose own path **and** stdout/stderr redirect target both sit
inside a directory whose final component ends in `.app` makes Node 22.23.2 abort
in `node::InitializeOncePerProcessInternal` (`node::Assert`). bb trips this
because the default data dir is `$HOME/.bb-machines/<server-host>` and bb server
hostnames are on the `getbb.app` domain — so `server-host` (e.g.
`machine.getbb.app`) ends in `.app` and both the daemon binary
(`…/machine.getbb.app/npm/bin/bb-app`) and its log
(`…/machine.getbb.app/install-join.log`) land under a `*.app` directory.

## Versions and environment

- bb: from source at `a2904348a` (the repo this report ships with), running the
  machine-install script through the `apps/server` integration test
  (`apps/server/test/app/install-machine-script.test.ts`, "defaults the data dir…").
- OS: macOS 27.0 (build 26A5421a), Apple Silicon (M4, arm64).
- Node: v22.23.2 (Homebrew, `/opt/homebrew/bin/node`; Node 22.19+ is the
  installer's documented floor).
- Unusual setup: none. The failure reproduces on a stock Homebrew Node with a
  plain `mktemp -d` fixture; no bb Connect, no worktree, no custom ports.

## Steps to reproduce

Minimal repro, no bb code involved (full script:
`scripts/repro-node-app-sigabrt.sh`, exit 0 = reproduced):

```sh
base=$(mktemp -d)
mkdir -p "$base/machine.getbb.app/npm"
cat >"$base/machine.getbb.app/npm/bb-app" <<'EOF'
#!/usr/bin/env node
setInterval(() => {}, 200);
EOF
chmod +x "$base/machine.getbb.app/npm/bb-app"

# CRASH case: script path AND redirect target under a *.app dir, backgrounded
BB_DATA_DIR="$base/machine.getbb.app" nohup "$base/machine.getbb.app/npm/bb-app" \
  host-daemon join --host-daemon-port 39101 >"$base/machine.getbb.app/out.log" 2>&1 &
echo "pid $!"

# CONTROL case: identical, directory named without the .app suffix
mkdir -p "$base/machine-getbb-app/npm" && cp "$base/machine.getbb.app/npm/bb-app" "$base/machine-getbb-app/npm/"
BB_DATA_DIR="$base/machine-getbb-app" nohup "$base/machine-getbb-app/npm/bb-app" \
  host-daemon join --host-daemon-port 39102 >"$base/machine-getbb-app/out.log" 2>&1 &
```

The crash case dies within ~1 s with `Abort trap: 6`; the control keeps running
until killed.

To reproduce through the real installer (same failure the test suite hits):

```sh
cd apps/server && pnpm vitest run test/app/install-machine-script.test.ts -t "defaults the data dir"
```

Negative space (all verified **not** to reproduce on this machine):

- the same script path under `*.app` but redirect to a plain dir → survives
- the same redirect into `*.app` but script in a plain dir → survives
- both under `*.app` but launched in the **foreground** (no `&`) → survives
- `node <script>` invoked directly (no `#!/usr/bin/env node` shebang) → survives
- the entire scenario with the data dir anywhere not ending in `.app` → survives
- explicit `BB_DATA_DIR` to a sibling path such as `~/.bb-machines/machine-getbb-app` → works

## Expected vs actual

Expected: `install.sh` enrolls the host daemon and prints "bb machine is ready".

Actual (installer path):

```
/…/install-machine.sh: line 603: 84002 Abort trap: 6           BB_APP_NPM_PREFIX="…" BB_DATA_DIR="…/.bb-machines/machine.getbb.app" nohup "…/machine.getbb.app/npm/bin/bb-app" host-daemon join --auto-update --host-daemon-port 38888 --join-code … --host-id … --server-url https://machine.getbb.app > "…/machine.getbb.app/install-join.log" 2>&1
  ✗  bb host daemon exited before it connected to https://machine.getbb.app.
     See …/.bb-machines/machine.getbb.app/install-join.log
```

`install-join.log` is empty: the daemon aborts before Node runs any JavaScript
(no `auth.json` is written, nothing is logged).

Minimal-repro actual:

```
$ sh scripts/repro-node-app-sigabrt.sh
node: v22.23.2  os: Darwin 27.0.0 arm64  macos: 27.0
scripts/repro-node-app-sigabrt.sh: line 64: 12079 Abort trap: 6  BB_DATA_DIR="…" nohup "…/machine.getbb.app/npm/bb-app" host-daemon join --host-daemon-port 39101 > "…/machine.getbb.app/install-join.log" 2>&1
[crash case] daemon DIED (reproduced: check ~/Library/Logs/DiagnosticReports/node-*.ips)
[control]  daemon SURVIVED (expected)
crash case beat.log: 0 lines
control  beat.log: 8 lines
REPRODUCED: backgrounded *.app-dir shebang script aborts; control survives.
```

## Evidence

Crash reports: `~/Library/Logs/DiagnosticReports/node-2026-09-07-*.ips`
(one per reproduction). Faulting thread (main) stack:

```
__pthread_kill
pthread_kill
abort
node::Assert(node::AssertionInfo const&)
node::InitializeOncePerProcessInternal(std::__1::vector<…> const&, node::ProcessInitializationFlags::Flags)
node::Start(int, char**)
start
```

The register dump around the fault references `node::stdio` symbols, so the
CHECK is reached during Node's stdio/process initialization, before the
event loop starts.

Trigger matrix (10+ runs, all consistent on this machine; `*.app` = any
directory whose final component ends in `.app`):

| shebang script | redirect target | mode | result |
| --- | --- | --- | --- |
| under `*.app` | under `*.app` | background `&` | **SIGABRT** |
| under `*.app` | under `*.app` | foreground | survives |
| under `*.app` | plain dir | background | survives |
| plain dir | under `*.app` | background | survives |
| plain dir | plain dir | background | survives |
| `node script` direct (no shebang), under `*.app` | under `*.app` | background | survives |

Installer permalink (commit `a2904348a`):
`apps/server/src/assets/install-machine.sh#L599-L603` — the
`nohup "$bb_app" host-daemon join … > "$join_log" 2>&1 &` launch with
`join_log="$data_dir/install-join.log"` and the default
`data_dir=${BB_DATA_DIR:-"$HOME/.bb-machines/$server_host"}`.

The repo's own suite encodes the quirk: `apps/server/test/app/install-machine-script.test.ts`
("defaults the data dir to a per-server directory under ~/.bb-machines")
carries a degraded assertion for exactly this abort.

## What you ruled out

- Not installer logic: reproduced with a 6-line fixture and no bb code at all.
- Not `BB_DATA_DIR` emptiness: reproduced with an explicit `*.app` data dir.
- Not the `.bb-machines` parent: reproduced with `$HOME/whatever.app` and
  `/tmp/…/whatever.app`; control `$HOME/whatever` (no suffix) survives.
- Not a missing file or permission: the control case writes through the same
  directory modes, just without the `.app` suffix.
- Not a Vitest/spawn quirk: reproduced from a plain interactive shell.
- Not a port or arg issue: `node <script>` with identical args survives.
- Does happen on Node v22.23.2 / macOS 27.0 only in the exact combination
  above; we have not tested other Node majors or macOS versions.

## Suggested priority and effort

Priority: high for `host` — every default enrollment to a `*.getbb.app` server
on macOS 27 + Node 22 fails at install time (no workaround for users who don't
know to set `BB_DATA_DIR`; the failure is deterministic, data loss is none —
it is blocked before join). Effort: likely small in bb (e.g. document/sanitize
the data-dir suffix or redirect the daemon log outside the data dir), but the
underlying Node crash should be reported upstream (Node's
`InitializeOncePerProcessInternal` CHECK) since bb cannot fix the Node abort
itself.

> AGENT GENERATED