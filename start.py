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

    # 4. Start backend
    print("\n>>> Starting Snag backend...\n")
    subprocess.run(
        [sys.executable, "-m", "backend.app"],
        cwd=ROOT,
    )


if __name__ == "__main__":
    main()
