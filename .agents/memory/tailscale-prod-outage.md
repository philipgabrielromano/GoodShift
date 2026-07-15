---
name: Tailscale auth key expiry & secret propagation
description: Why production can go down when the Tailscale key expires, and why dev env checks of updated secrets can lie.
---

# Tailscale auth key lifecycle

- Tailscale auth keys expire (90 days max). Fresh production containers must re-auth with the key; dev usually reconnects from saved `tailscaled.state` without it — so prod can be down while dev looks fine.
- `tailscale up` with an invalid key retries forever. The startup script now uses `--timeout=60s` and exits 0 on failure so the app boots without the VPN (only MySQL/order features degrade). Keep that guard if the script is edited.
- **Why:** an expired key once blocked `node` from ever starting in prod (port 5000 never opened → sitewide "Server Error").
- **How to apply:** if prod shows healthcheck 500s + "invalid key" Tailscale logs, ask the user for a fresh auth key (Reusable ON, copied from the one-time popup — the keys list shows a truncated value that fails with "unable to validate API key") and republish.

# Secret update propagation in dev

- After a user updates a secret, the agent's bash shells AND restarted workflows can keep serving the OLD value for many minutes; it refreshes eventually. Production deploys always get the current value.
- **Why:** stale env checks produced a false "you pasted the old key" accusation once.
- **How to apply:** don't conclude a user-saved secret is wrong from dev env alone; verify via a fresh prod deploy log, or re-check env later (test key with a throwaway `tailscaled --state=/tmp/... ` instance once env shows the new value; `tailscale logout` on that socket afterwards).
- `pkill -f <pattern>` inside a bash tool call kills its own shell if the pattern text appears anywhere in the command line — bracket-trick the pattern AND avoid repeating the literal string elsewhere in the same command.
