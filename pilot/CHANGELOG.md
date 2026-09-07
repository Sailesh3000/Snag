# Snag Pilot Build Changelog

## v0.1.0-pilot1 (unreleased)

First no-terminal pilot package:
- Pre-built Chrome extension (no Node/npm needed by testers)
- `windows/Start-Snag.bat` + `Stop-Snag.bat` + `Reset-Snag.bat`
- `mac/Start-Snag.command` + `Stop-Snag.command` + `Reset-Snag.command`
- Auto-creates a Python virtual environment and installs backend
  dependencies on first run; detects missing Python with a clear error
  instead of silently installing anything
- Per-tester auth token, generated locally on first start (nothing shared
  or hard-coded)
- `README-PILOT.md`, `START-HERE.txt`, `FEEDBACK.md` rewritten for this flow
