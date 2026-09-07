#!/bin/bash
set -uo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Stopping Snag..."
if [ -f "$ROOT/runtime/backend.pid" ]; then
    PID="$(cat "$ROOT/runtime/backend.pid")"
    if kill "$PID" >/dev/null 2>&1; then
        echo "Snag backend stopped."
    else
        echo "Snag wasn't running."
    fi
    rm -f "$ROOT/runtime/backend.pid"
else
    echo "Snag wasn't running."
fi
echo
read -r -p "Press Return to close this window..." _
