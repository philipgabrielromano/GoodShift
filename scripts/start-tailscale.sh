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

echo "[Tailscale] Starting tailscaled in userspace networking mode..."
tailscaled \
  --tun=userspace-networking \
  --state="$TAILSCALE_STATE_DIR/tailscaled.state" \
  --socket="$TAILSCALE_SOCK" \
  --no-logs-no-support \
  &
sleep 3

echo "[Tailscale] Connecting to tailnet..."
tailscale --socket="$TAILSCALE_SOCK" up \
  --auth-key="$TAILSCALE_AUTH_KEY" \
  --hostname="replit-goodshift" \
  --accept-routes

echo "[Tailscale] Connected. Status:"
tailscale --socket="$TAILSCALE_SOCK" status

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

echo "[Tailscale] Starting MySQL TCP proxy on localhost:$LOCAL_MYSQL_PORT -> $REPLITPROXY_HOST:3306..."
socat TCP-LISTEN:$LOCAL_MYSQL_PORT,fork,reuseaddr EXEC:"tailscale --socket=$TAILSCALE_SOCK nc $REPLITPROXY_HOST 3306" &
sleep 1

echo "[Tailscale] MySQL proxy ready on localhost:$LOCAL_MYSQL_PORT"
echo "[Tailscale] Setup complete"
