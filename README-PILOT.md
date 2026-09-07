# Snag Pilot — Setup Guide

Thanks for helping test Snag. It's an AI job-application copilot: it detects
form fields on job sites, drafts answers using your profile, and learns from
the answers you approve so future similar questions get better over time.

**You run Snag entirely on your own computer.** There's no shared server or
account — your profile, your answers, and your auth token are all generated
locally, on your machine, the first time you start it. Nobody else (including
the person who gave you this) can see your data unless you tell them.

## Before you start

- Python 3.12+ and Node.js 20+ installed
- Google Chrome
- Either [Ollama](https://ollama.com) running locally with a model pulled (free,
  fully private), or an API key for OpenAI/Anthropic/Groq (your own account —
  Snag never sees or stores the key, but that provider does see your questions
  and profile when you use it)

If you're not sure how to install Python/Node, ask whoever gave you this pilot
build — that one-time setup is the only slightly technical part.

## Setup

1. **Install dependencies** (from the project folder, one time):
   ```bash
   pip install -r backend/requirements.txt
   cd ui && npm install && cd ..
   cd extension && npm install && cd ..
   ```

2. **Start Snag:**
   ```bash
   python start.py
   ```
   This builds the extension, runs a few safety checks, and starts the backend.
   Leave this window open while you use Snag.

3. **Find your auth token.** On this first run, the terminal (and
   `logs/snag.log`) prints something like:
   ```
   Snag auth token (paste into the extension's Settings page):
     <a long random string>
   ```
   This token is unique to your machine — generated just now, for you. Copy it.

4. **Load the extension in Chrome:**
   - Go to `chrome://extensions`, enable **Developer mode** (top right)
   - Click **Load unpacked** → select the `extension/` folder
   - The Snag icon should appear in your toolbar

5. **Pair the extension with your backend:**
   - Right-click the Snag icon → **Options**
   - Paste your auth token into **Backend Auth Token**
   - Pick your LLM provider (Ollama, or paste your API key for OpenAI/Anthropic/Groq)
   - Save

6. **Build your profile** — click the Snag icon on any page to open the sidebar:
   - Use **Import from resume** (Profile section) to upload a `.pdf`/`.txt` and
     auto-fill fields — review what it extracted before applying, nothing saves
     automatically
   - Fill in anything it missed by hand (work authorization, visa status, etc.
     are intentionally not auto-extracted from a resume — enter those yourself)

## Using Snag on a real application

1. Open a job application page, click the Snag icon to activate
2. The sidebar shows detected fields — simple ones (name, email, etc.) fill
   automatically; **sensitive fields** (work authorization, visa, gender, DOB)
   show up as a suggestion you have to approve, never auto-filled
3. Click a question under **Questions** to generate a draft answer
4. **Accept**, **Edit** (then Accept), **Regenerate**, or **Skip** — nothing is
   saved to memory until you Accept (edited or as-is)
5. Snag never submits the application for you — you still click Submit yourself

The more questions you accept across different applications, the better future
answers get — Snag looks for similar past questions (even worded differently,
even for a different company) and adapts them instead of starting from scratch.

## Please test with at least 3 real applications

Try a few different sites if you can, and note anything that felt off —
wrong answer, field it couldn't fill, something confusing. Then fill out
[FEEDBACK.md](./FEEDBACK.md).

## Privacy — what actually happens to your data

- Your profile, resume, and approved answers are stored **locally, unencrypted**
  (a SQLite file on your own machine). Anyone with access to this computer/OS
  account could read them — use it on a machine you trust.
- Nothing is sent to the person who built Snag, or to any Snag-run server —
  there isn't one.
- If you use a cloud LLM provider (OpenAI/Anthropic/Groq/anything other than
  Ollama), your questions, profile, and job context **are** sent to that
  provider's API to generate answers. Ollama is the only fully-local option.
- Snag never auto-submits an application.

## Troubleshooting

- **"Unauthorized"/401 errors**: your token doesn't match — re-check
  `logs/snag.log` for the current one and re-paste it into Settings.
- **Port already in use**: another Snag instance (or something else) is on
  port 8765 — close it or check `netstat` for what's holding it.
- **Ollama not reachable**: `start.py` warns but doesn't block — make sure
  `ollama serve` is running if you picked that provider.
- **Resume didn't extract anything**: only `.pdf`/`.txt`/`.md` are supported,
  and scanned/image-only PDFs won't extract text (no OCR).
- **A field/radio button didn't fill**: Snag doesn't yet reason about
  multi-choice questions rendered as several radio buttons as one decision —
  you may need to pick that one manually. Note it in your feedback either way.
- Something else broken: note the exact error/behavior for your feedback —
  that's exactly what this pilot is for.

## Checklist

- [ ] Backend running (`python start.py`), extension loaded, token pasted in
- [ ] Profile filled in (resume import or manual)
- [ ] Tested on at least 3 real applications
- [ ] Tried at least one Accept, one Edit→Accept, one Skip
- [ ] Filled out [FEEDBACK.md](./FEEDBACK.md)
