#!/bin/bash
set -e

bash scripts/start-tailscale.sh

exec node ./dist/index.cjs
