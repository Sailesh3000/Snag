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

echo "============================================"
echo "  Snag - Reset Local Data"
echo "============================================"
echo
echo "This will permanently delete your local Snag profile, resumes,"
echo "learned answers, and auth token from:"
echo "  $ROOT/data"
echo
echo "It will NOT affect Chrome, any resume files elsewhere on your"
echo "computer, or any other application."
echo
read -r -p "Type YES to continue: " CONFIRM
if [ "$CONFIRM" != "YES" ]; then
    echo "Cancelled - nothing was deleted."
    read -r -p "Press Return to close this window..." _
    exit 0
fi

if [ -f "$ROOT/runtime/backend.pid" ]; then
    kill "$(cat "$ROOT/runtime/backend.pid")" >/dev/null 2>&1 || true
    rm -f "$ROOT/runtime/backend.pid"
fi

rm -f "$ROOT/data/snag.db" "$ROOT/data/snag.db-shm" "$ROOT/data/snag.db-wal" "$ROOT/data/auth_token.txt"
rm -rf "$ROOT/data/resumes"

echo
echo "Done. Your Snag data has been reset."
echo "A new auth token will be generated next time you run Start-Snag.command"
echo "(you'll need to paste it into the extension's Options page again)."
echo
read -r -p "Press Return to close this window..." _
