#!/usr/bin/env bash
# Own the startup process group, including VPN/proxy helpers. A Node exit must
# terminate the deployment command, not leave an apparently live helper behind.
set -uo pipefail
cd "$(dirname "$0")/.."

group_pid=""
cleanup() {
  trap '' TERM INT
  if [[ -n "$group_pid" ]]; then
    kill -TERM -- "-$group_pid" 2>/dev/null || true
    sleep 1
    kill -KILL -- "-$group_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'echo "[lifecycle] shutdown requested"; exit 143' TERM
trap 'echo "[lifecycle] interrupt requested"; exit 130' INT

# Optional command arguments allow isolated tests without VPN/DB access.
if [[ $# -eq 0 ]]; then
  set -- bash -c 'bash scripts/start-tailscale.sh && exec node --unhandled-rejections=strict --require ./scripts/fatal-diagnostics.cjs dist/index.cjs'
fi
export NODE_ENV=production
setsid "$@" &
group_pid=$!
echo "[lifecycle] application group started pid=$group_pid"
wait "$group_pid"
status=$?
echo "[lifecycle] application exited status=$status; stopping helpers"
# A persistent web server exiting successfully is still an unexpected outage.
if [[ $status -eq 0 ]]; then status=1; fi
exit "$status"
