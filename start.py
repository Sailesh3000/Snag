"""Build UI + Extension, then start the backend server."""

import subprocess
import sys
import shutil
from pathlib import Path

ROOT = Path(__file__).parent
UI = ROOT / "ui"
EXT = ROOT / "extension"
SIDEBAR = EXT / "sidebar"


def run(cmd: str, cwd: Path = ROOT) -> int:
    print(f"\n>>> {cmd}  ({cwd})")
    r = subprocess.run(cmd, shell=True, cwd=cwd)
    if r.returncode != 0:
        print(f"FAILED: {cmd}")
        sys.exit(1)
    return r.returncode


def preflight_checks():
    """Verify port availability and provider reachability before starting."""
    from backend.config import settings
    import socket
    import urllib.request

    # 1. Port check
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        if s.connect_ex(("127.0.0.1", settings.port)) == 0:
            print(f"ERROR: Port {settings.port} is already in use.")
            print(f"  Another Snag instance or other process is running on that port.")
            print(f"  Run: netstat -ano | findstr :{settings.port}")
            sys.exit(1)

    # 2. Ollama reachability (only if configured as default provider)
    try:
        req = urllib.request.Request(f"{settings.ollama_url}/api/tags", method="GET")
        urllib.request.urlopen(req, timeout=5)
        print(f"  Ollama reachable at {settings.ollama_url}")
    except Exception as e:
        print(f"WARNING: Ollama not reachable at {settings.ollama_url} ({e})")
        print(f"  If you're using a different LLM provider, this is fine.")
        print(f"  If you need Ollama, start it first: 'ollama serve'")

    print("Preflight checks passed.\n")


def main():
    # 1. Build UI
    run("npm run build", UI)

    # 2. Copy UI build into extension sidebar
    assets = SIDEBAR / "assets"
    if assets.exists():
        shutil.rmtree(assets)
    shutil.copytree(UI / "build" / "assets", assets)
    shutil.copy2(UI / "build" / "index.html", SIDEBAR / "index.html")
    print(f">>> Copied UI build -> {SIDEBAR}")

    # 3. Build extension TS
    run("npm run build", EXT)

    # 4. Preflight checks
    preflight_checks()

    # 5. Start backend
    print("\n>>> Starting Snag backend...\n")
    subprocess.run(
        [sys.executable, "-m", "backend.app"],
        cwd=ROOT,
    )


if __name__ == "__main__":
    main()
