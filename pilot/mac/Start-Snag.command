#!/bin/bash
set -uo pipefail

# Resolve the real script directory regardless of symlinks, and regardless
# of whether this was double-clicked from Finder or run from a terminal in
# some other working directory.
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

VENV="$ROOT/runtime/venv"
MARKER="$ROOT/runtime/.installed"
mkdir -p "$ROOT/runtime"

echo "============================================"
echo "  Snag - Starting"
echo "============================================"
echo

if curl -s -o /dev/null -m 2 http://127.0.0.1:8765/health; then
    echo "Snag is already running."
else
    PYTHON_BIN=""
    for candidate in python3.12 python3.13 python3.11 python3.10 python3; do
        if command -v "$candidate" >/dev/null 2>&1; then
            PYTHON_BIN="$candidate"
            break
        fi
    done

    if [ -z "$PYTHON_BIN" ]; then
        echo "[ERROR] Python was not found on this Mac."
        echo
        echo "Snag needs Python 3.12 or newer. Install it from:"
        echo "  https://www.python.org/downloads/"
        echo "Then double-click Start-Snag.command again."
        echo
        read -r -p "Press Return to close this window..." _
        exit 1
    fi

    if [ ! -f "$MARKER" ]; then
        echo "First-time setup - this can take a few minutes, please wait..."
        if [ ! -d "$VENV" ]; then
            "$PYTHON_BIN" -m venv "$VENV"
        fi
        "$VENV/bin/python" -m pip install --upgrade pip -q
        if ! "$VENV/bin/python" -m pip install -r "$ROOT/backend/requirements.txt" -q; then
            echo
            echo "[ERROR] Setup failed while installing dependencies."
            echo "Please contact whoever gave you this pilot build, with the message above."
            read -r -p "Press Return to close this window..." _
            exit 1
        fi
        touch "$MARKER"
        echo "Setup complete."
        echo
    fi

    echo "Starting Snag backend..."
    # Detached: keeps running even if this window is closed.
    nohup "$VENV/bin/python" -m backend.app > "$ROOT/runtime/backend.out" 2>&1 &
    echo $! > "$ROOT/runtime/backend.pid"

    READY=0
    for _ in $(seq 1 30); do
        if curl -s -o /dev/null -m 2 http://127.0.0.1:8765/health; then
            READY=1
            break
        fi
        sleep 1
    done

    if [ "$READY" -eq 0 ]; then
        echo
        echo "[ERROR] Snag backend did not start within 30 seconds."
        echo "Check $ROOT/runtime/backend.out for details."
        read -r -p "Press Return to close this window..." _
        exit 1
    fi

    echo
    echo "Snag backend started successfully."
fi

echo
echo "============================================"
echo "  Next steps"
echo "============================================"
echo "1. Open Chrome and go to:  chrome://extensions"
echo "2. Turn on \"Developer mode\" (top-right toggle)"
echo "3. Click \"Load unpacked\" and select the \"extension\" folder"
echo "   inside this Snag folder  (only needed the first time)"
echo "4. Click the Snag icon in Chrome's toolbar, then right-click it -> Options"
echo "5. Copy your auth token below and paste it into \"Backend Auth Token\", then Save"
echo
if [ -f "$ROOT/data/auth_token.txt" ]; then
    echo "Your auth token:"
    cat "$ROOT/data/auth_token.txt"
    echo
else
    echo "Your auth token will appear in: $ROOT/runtime/backend.out"
fi
echo "6. Open a job application page and start applying!"
echo
echo "(Snag keeps running in the background. Use Stop-Snag.command to stop it.)"
echo
read -r -p "Press Return to close this window..." _
