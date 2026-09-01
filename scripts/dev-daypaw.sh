#!/usr/bin/env bash
# Dev launcher for the daypaw product shell from this source checkout.
#
# Wraps the one flow the source state needs but the delivered `daypaw` command
# already owns: resolve the model key (flag > env > root .env), pick a free
# port, boot `packages/daypaw/cli/bin.mjs` in the background, and print the
# launch-token URL line. The ledger lands in ./daypaw/ (gitignored) relative to
# the working directory, so always run this from the repository root.
#
# Usage: pnpm dev:daypaw [--build] [--open] [--port N] [--key <DEEPSEEK_API_KEY>]
#   --build  run the root build first (daypaw packages execute from lib/)
#   --open   open the printed URL in the default browser (macOS `open`)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
port=3080
open=false
build=false
key="${DEEPSEEK_API_KEY:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --build) build=true; shift ;;
    --open) open=true; shift ;;
    --port) port="$2"; shift 2 ;;
    --key) key="$2"; shift 2 ;;
    *) echo "dev-daypaw: unknown flag $1" >&2; exit 2 ;;
  esac
done
cd "$root"

# Key resolution order: flag > inherited env > root .env (the repo's e2e
# convention). A missing key boots fine; model calls fail per request.
if [ -z "$key" ] && [ -f .env ]; then
  key="$(grep -E '^DEEPSEEK_API_KEY=' .env | head -1 | cut -d= -f2- || true)"
fi
if [ -z "$key" ]; then
  echo "dev-daypaw: warning: no DEEPSEEK_API_KEY (flag/env/root .env); model calls will fail per request" >&2
fi

if [ "$build" = true ]; then
  echo "dev-daypaw: building (daypaw packages execute from lib/)..."
  pnpm run build
fi

# The CLI delegate imports its own built lib; a missing one means the checkout
# was never built — fail loud instead of a confusing resolution error.
if [ ! -f packages/daypaw/cli/lib/index.js ]; then
  echo "dev-daypaw: packages/daypaw/cli/lib is missing; run with --build (or pnpm run build) first" >&2
  exit 2
fi

while lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do
  echo "dev-daypaw: port $port in use, trying the next one"
  port=$((port + 1))
done

log="/tmp/dev-daypaw-$port.log"
: >"$log"
DEEPSEEK_API_KEY="$key" nohup node packages/daypaw/cli/bin.mjs --port "$port" >"$log" 2>&1 &
pid=$!

url=""
for _ in $(seq 1 60); do
  url="$(grep -m1 -o 'daypaw web: http[^ ]*' "$log" 2>/dev/null | cut -d' ' -f3 || true)"
  [ -n "$url" ] && break
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "dev-daypaw: process exited during boot; log tail:" >&2
    tail -20 "$log" >&2
    exit 1
  fi
  sleep 0.5
done
if [ -z "$url" ]; then
  echo "dev-daypaw: no URL line within 30s; log tail:" >&2
  tail -20 "$log" >&2
  kill "$pid" 2>/dev/null || true
  exit 1
fi

echo "dev-daypaw: pid $pid, log $log"
echo "dev-daypaw: stop with: kill \$pid  # or: kill \$(lsof -tiTCP:$port -sTCP:LISTEN)"
echo "$url"
if [ "$open" = true ]; then
  open "$url"
fi
