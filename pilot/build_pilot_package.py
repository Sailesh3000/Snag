"""Build a reproducible, no-terminal Snag pilot package.

Run from the repo root:

    python pilot/build_pilot_package.py [--version 0.1.0-pilot1] [--skip-build]

Produces:
    dist/Snag-Pilot-v<version>/       (unzipped, for inspection)
    dist/Snag-Pilot-v<version>.zip    (what you actually send to testers)

--skip-build reuses whatever's already built in ui/build and extension/
(faster iteration on the packaging step itself); omit it for a real release
so the shipped extension matches the current source.

This is a build-time tool for the maintainer's own machine — it needs
Node/npm (to build the UI + extension) the same way the existing
`start.py` dev flow does. Pilot testers never run this; they only get its
output.
"""
import argparse
import re
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UI = ROOT / "ui"
EXT = ROOT / "extension"
PILOT_SRC = ROOT / "pilot"
DIST = ROOT / "dist"

DEFAULT_VERSION = "0.1.0-pilot1"

# Filenames that must NEVER end up in a shipped package — a secret, a real
# user's data, or a per-install credential. The build aborts if any of
# these show up anywhere under the assembled package directory.
FORBIDDEN_NAMES = {
    ".env", "auth_token.txt", "snag.db", "snag.db-shm", "snag.db-wal",
}
FORBIDDEN_SUFFIXES = {".pem", ".key"}
FORBIDDEN_DIR_NAMES = {"resumes", "__pycache__", ".pytest_cache", "node_modules", ".venv", ".git"}

# Crude heuristic secret scan over small text files — not a substitute for
# judgement, but catches an accidentally-committed key before it ships.
SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9]{20,}"),          # OpenAI-style
    re.compile(r"AKIA[0-9A-Z]{16}"),              # AWS access key
    re.compile(r"ghp_[A-Za-z0-9]{30,}"),          # GitHub token
    re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"),  # Slack token
]

EXTENSION_RUNTIME_ENTRIES = [
    "manifest.json", "background", "content", "icons", "llm", "settings", "shared", "sidebar",
]

BACKEND_EXCLUDE_DIRS = {"__pycache__", "tests", ".pytest_cache"}


def run(cmd: str, cwd: Path):
    print(f">>> {cmd}  ({cwd})")
    result = subprocess.run(cmd, shell=True, cwd=cwd)
    if result.returncode != 0:
        print(f"FAILED: {cmd}")
        sys.exit(1)


def build_ui_and_extension():
    run("npm run build", UI)
    sidebar_assets = EXT / "sidebar" / "assets"
    if sidebar_assets.exists():
        shutil.rmtree(sidebar_assets)
    shutil.copytree(UI / "build" / "assets", sidebar_assets)
    shutil.copy2(UI / "build" / "index.html", EXT / "sidebar" / "index.html")
    run("npm run build", EXT)


def copy_backend(dest: Path):
    def ignore(dir_path, names):
        return [n for n in names if n in BACKEND_EXCLUDE_DIRS]

    shutil.copytree(ROOT / "backend", dest / "backend", ignore=ignore)


def copy_extension_runtime(dest: Path):
    ext_dest = dest / "extension"
    ext_dest.mkdir(parents=True, exist_ok=True)
    for entry in EXTENSION_RUNTIME_ENTRIES:
        src = EXT / entry
        if not src.exists():
            continue
        if src.is_dir():
            shutil.copytree(src, ext_dest / entry)
        else:
            shutil.copy2(src, ext_dest / entry)


def _force_crlf(path: Path):
    """cmd.exe's batch parser can corrupt LF-only files (observed directly:
    it silently ate the first character of several lines). Whatever line
    endings the source happens to have on disk right now, the shipped copy
    must be CRLF."""
    text = path.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    path.write_bytes(text)


def _force_lf(path: Path):
    """The inverse for macOS shell scripts — a stray CR breaks the shebang
    line and can break heredoc-style comparisons in bash."""
    text = path.read_bytes().replace(b"\r\n", b"\n")
    path.write_bytes(text)


def copy_scripts_and_docs(dest: Path):
    shutil.copytree(PILOT_SRC / "windows", dest / "windows")
    shutil.copytree(PILOT_SRC / "mac", dest / "mac")
    for bat in (dest / "windows").glob("*.bat"):
        _force_crlf(bat)
    for cmd in (dest / "mac").glob("*.command"):
        _force_lf(cmd)
    for doc in ["README-PILOT.md", "START-HERE.txt", "FEEDBACK.md", "LICENSE"]:
        shutil.copy2(ROOT / doc, dest / doc)


def write_version_file(dest: Path, version: str):
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True
        ).strip()
    except Exception:
        commit = "unknown"
    built_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    (dest / "VERSION.txt").write_text(
        f"Snag Pilot v{version}\nBuilt: {built_at}\nSource commit: {commit}\n",
        encoding="utf-8",
    )


def security_scan(dest: Path):
    problems = []
    for path in dest.rglob("*"):
        if path.is_dir():
            if path.name in FORBIDDEN_DIR_NAMES:
                problems.append(f"forbidden directory present: {path.relative_to(dest)}")
            continue
        if path.name in FORBIDDEN_NAMES or path.suffix in FORBIDDEN_SUFFIXES:
            problems.append(f"forbidden file present: {path.relative_to(dest)}")
            continue
        # Only scan small text-ish files for secret patterns — skip binaries.
        if path.suffix in {".py", ".ts", ".js", ".json", ".md", ".txt", ".bat", ".command", ".html", ".css"}:
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            for pattern in SECRET_PATTERNS:
                if pattern.search(text):
                    problems.append(f"looks like a real credential in: {path.relative_to(dest)}")
                    break

    if problems:
        print("\n[SECURITY SCAN FAILED] Refusing to package. Found:")
        for p in problems:
            print(f"  - {p}")
        sys.exit(1)
    print("Security scan passed: no secrets, tokens, or user data found in the package.")


def zip_package(dest: Path, version: str) -> Path:
    zip_path = DIST / f"Snag-Pilot-v{version}.zip"
    if zip_path.exists():
        zip_path.unlink()

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(dest.rglob("*")):
            if path.is_dir():
                continue
            arcname = Path(dest.name) / path.relative_to(dest)
            info = zipfile.ZipInfo(str(arcname).replace("\\", "/"))
            info.compress_type = zipfile.ZIP_DEFLATED
            # Preserve the executable bit for the macOS .command scripts —
            # Python's zipfile doesn't do this by default, and an unzipped
            # .command without +x won't run from Finder.
            mode = 0o755 if path.suffix == ".command" else 0o644
            info.external_attr = (mode << 16)
            with open(path, "rb") as f:
                zf.writestr(info, f.read())
    return zip_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default=DEFAULT_VERSION)
    parser.add_argument("--skip-build", action="store_true", help="Reuse existing ui/build and extension/ build output")
    args = parser.parse_args()

    if not args.skip_build:
        build_ui_and_extension()
    else:
        print("Skipping npm build steps (--skip-build) — using whatever is already built on disk.")

    package_name = f"Snag-Pilot-v{args.version}"
    dest = DIST / package_name
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)

    print(f">>> Assembling {dest}")
    copy_backend(dest)
    copy_extension_runtime(dest)
    copy_scripts_and_docs(dest)
    write_version_file(dest, args.version)

    security_scan(dest)

    zip_path = zip_package(dest, args.version)
    print(f"\nDone: {zip_path}")
    print(f"Unzipped copy for inspection: {dest}")


if __name__ == "__main__":
    main()
