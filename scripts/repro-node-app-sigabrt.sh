#!/bin/sh
# Minimal repro: Node 22 SIGABRTs in InitializeOncePerProcessInternal when a
# backgrounded `#!/usr/bin/env node` shebang script has BOTH its own path AND
# its stdout/stderr redirect target inside a directory whose final path
# component ends in ".app".
#
# Trigger matrix (all confirmed on macOS 27.0 26A5421a + Node v22.23.2):
#   shebang script | redirect target | mode       | result
#   under *.app    | under *.app     | background | SIGABRT (Abort trap: 6)
#   under *.app    | under *.app     | foreground | survives
#   under *.app    | elsewhere       | background | survives
#   elsewhere      | under *.app     | background | survives
#   direct `node` (no shebang) under *.app | under *.app | background | survives
#
# bb impact: apps/server/src/assets/install-machine.sh launches the joined
# host daemon as `nohup "$bb_app" host-daemon join ... > "$join_log" 2>&1 &`
# with the default data dir `$HOME/.bb-machines/<server-host>`. For servers
# on the getbb.app domain the server-host ends in ".app", so both the bb-app
# binary path and install-join.log land under a *.app directory and the
# daemon child aborts before any JS runs.
#
# Usage: sh scripts/repro-node-app-sigabrt.sh [node-binary]
# Exit 0 when the environment reproduces as documented (crash case dies,
# control survives); exit 1 otherwise.
set -u

node_bin=${1:-node}
if ! "$node_bin" --version >/dev/null 2>&1; then
  echo "node not found at '$node_bin'" >&2
  exit 2
fi
echo "node: $("$node_bin" --version)  os: $(uname -srm)  macos: $(sw_vers -productVersion 2>/dev/null || echo n/a)"

base=$(mktemp -d "${TMPDIR:-/tmp}/node-app-sigabrt.XXXXXX")
cleanup() {
  for pidfile in "$base"/*.pid; do
    [ -f "$pidfile" ] || continue
    kill "$(cat "$pidfile")" 2>/dev/null || true
  done
  rm -rf "$base"
}
trap cleanup EXIT INT TERM

write_fixture() {
  dir=$1
  mkdir -p "$dir/npm"
  cat >"$dir/npm/bb-app" <<'EOF'
#!/usr/bin/env node
const fs = require("node:fs");
setInterval(() => {
  fs.appendFileSync(process.env.BB_DATA_DIR + "/beat.log", "beat\n");
}, 200);
EOF
  chmod +x "$dir/npm/bb-app"
}

# 1) crash case: shebang script + redirect target both under a *.app dir
app_case="$base/machine.getbb.app"
write_fixture "$app_case"
BB_DATA_DIR="$app_case" nohup "$app_case/npm/bb-app" host-daemon join \
  --host-daemon-port 39101 >"$app_case/install-join.log" 2>&1 &
crash_pid=$!
echo "$crash_pid" >"$base/crash.pid"
sleep 2
if kill -0 "$crash_pid" 2>/dev/null; then
  echo "[crash case] daemon SURVIVED (did not reproduce)"
  crash_result=survived
else
  echo "[crash case] daemon DIED (reproduced: check ~/Library/Logs/DiagnosticReports/node-*.ips)"
  crash_result=died
fi

# 2) control: identical shape, but the directory does not end in .app
control_case="$base/machine-getbb-app"
write_fixture "$control_case"
BB_DATA_DIR="$control_case" nohup "$control_case/npm/bb-app" host-daemon join \
  --host-daemon-port 39102 >"$control_case/install-join.log" 2>&1 &
control_pid=$!
echo "$control_pid" >"$base/control.pid"
sleep 2
if kill -0 "$control_pid" 2>/dev/null; then
  echo "[control]  daemon SURVIVED (expected)"
  control_result=survived
else
  echo "[control]  daemon DIED (unexpected)"
  control_result=died
fi

echo
echo "crash case beat.log: $(cat "$app_case/beat.log" 2>/dev/null | wc -l | tr -d ' ') lines"
echo "control  beat.log: $(cat "$control_case/beat.log" 2>/dev/null | wc -l | tr -d ' ') lines"

if [ "$crash_result" = died ] && [ "$control_result" = survived ]; then
  echo
  echo "REPRODUCED: backgrounded *.app-dir shebang script aborts; control survives."
  exit 0
fi
echo
echo "NOT reproduced on this environment (behavior differs from the matrix above)."
exit 1