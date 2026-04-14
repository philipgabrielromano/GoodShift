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

echo "[Tailscale] Starting MySQL TCP proxy on localhost:$LOCAL_MYSQL_PORT -> replitproxy:3306..."
socat TCP-LISTEN:$LOCAL_MYSQL_PORT,fork,reuseaddr EXEC:"tailscale --socket=$TAILSCALE_SOCK nc replitproxy 3306" &
sleep 1

echo "[Tailscale] MySQL proxy ready on localhost:$LOCAL_MYSQL_PORT"
echo "[Tailscale] Setup complete"
