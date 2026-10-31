#!/bin/bash
set -e

TAILSCALE_STATE_DIR="$HOME/.tailscale"
TAILSCALE_SOCK="$TAILSCALE_STATE_DIR/tailscaled.sock"
LOCAL_MYSQL_PORT=13306

mkdir -p "$TAILSCALE_STATE_DIR"

if [ -z "$TAILSCALE_AUTH_KEY" ]; then
  echo "[Tailscale] No TAILSCALE_AUTH_KEY set, skipping Tailscale startup"
  exit 0
fi

pkill -f "tailscaled" 2>/dev/null || true
pkill -f "socat.*$LOCAL_MYSQL_PORT" 2>/dev/null || true
sleep 1

start_tailscaled() {
  tailscaled \
    --tun=userspace-networking \
    --state="$TAILSCALE_STATE_DIR/tailscaled.state" \
    --socket="$TAILSCALE_SOCK" \
    --no-logs-no-support \
    &
}

echo "[Tailscale] Starting tailscaled in userspace networking mode..."
start_tailscaled
sleep 3

echo "[Tailscale] Connecting to tailnet..."
# --timeout keeps an invalid/expired auth key from hanging forever. If the
# connection fails we continue WITHOUT the VPN instead of blocking the app:
# the site stays up and only the MySQL-backed order features are degraded.
if ! tailscale --socket="$TAILSCALE_SOCK" up \
  --auth-key="$TAILSCALE_AUTH_KEY" \
  --hostname="replit-goodshift" \
  --accept-routes \
  --timeout=60s; then
  echo "[Tailscale] ERROR: could not join the tailnet (auth key expired or revoked?)."
  echo "[Tailscale] Continuing WITHOUT the VPN so the app can still start."
  echo "[Tailscale] Order form / MySQL features will be unavailable until the key is fixed."
  exit 0
fi

echo "[Tailscale] Connected. Status:"
# Informational only: under `set -e` a failing status call here used to stop
# the script before the app started.
tailscale --socket="$TAILSCALE_SOCK" status || true

REPLITPROXY_HOST="${REPLITPROXY_HOST:-}"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if [ -n "$REPLITPROXY_HOST" ]; then break; fi
  REPLITPROXY_HOST=$(tailscale --socket="$TAILSCALE_SOCK" status 2>/dev/null \
    | awk '/[[:space:]]replitproxy(\.|[[:space:]])/ {print $2; exit}')
  if [ -z "$REPLITPROXY_HOST" ]; then sleep 2; fi
done
if [ -z "$REPLITPROXY_HOST" ]; then
  echo "[Tailscale] WARNING: could not resolve replitproxy peer FQDN, falling back to short name"
  REPLITPROXY_HOST="replitproxy"
fi

start_socat() {
  socat TCP-LISTEN:$LOCAL_MYSQL_PORT,fork,reuseaddr EXEC:"tailscale --socket=$TAILSCALE_SOCK nc $REPLITPROXY_HOST 3306" &
}

echo "[Tailscale] Starting MySQL TCP proxy on localhost:$LOCAL_MYSQL_PORT -> $REPLITPROXY_HOST:3306..."
start_socat
sleep 1

echo "[Tailscale] MySQL proxy ready on localhost:$LOCAL_MYSQL_PORT"

# Watchdog: if tailscaled or socat dies after startup, every MySQL-backed
# page fails until a redeploy. Check every 30s and restart whichever is down.
# tailscaled keeps its node key in the state file, so a restart normally
# reconnects on its own; `tailscale up` is only retried with backoff, so an
# expired key can't spin.
(
  set +e
  up_failures=0
  next_up_attempt=0
  while true; do
    sleep 30
    if ! pgrep -x tailscaled >/dev/null 2>&1; then
      echo "[Tailscale] Watchdog: tailscaled is not running; restarting it"
      start_tailscaled
      sleep 5
    fi
    if ! tailscale --socket="$TAILSCALE_SOCK" status >/dev/null 2>&1; then
      now=$(date +%s)
      if [ "$now" -ge "$next_up_attempt" ]; then
        echo "[Tailscale] Watchdog: not connected to the tailnet; running tailscale up"
        if tailscale --socket="$TAILSCALE_SOCK" up \
          --auth-key="$TAILSCALE_AUTH_KEY" \
          --hostname="replit-goodshift" \
          --accept-routes \
          --timeout=60s; then
          echo "[Tailscale] Watchdog: reconnected"
          up_failures=0
          next_up_attempt=0
        else
          up_failures=$((up_failures + 1))
          delay=$((60 * (1 << (up_failures < 5 ? up_failures : 5))))
          next_up_attempt=$((now + delay))
          echo "[Tailscale] Watchdog: tailscale up failed ($up_failures in a row); next try in ${delay}s"
        fi
      fi
    fi
    if ! pgrep -f "socat TCP-LISTEN:$LOCAL_MYSQL_PORT" >/dev/null 2>&1; then
      echo "[Tailscale] Watchdog: MySQL proxy (socat) is not running; restarting it"
      start_socat
    fi
  done
) &

echo "[Tailscale] Setup complete"
