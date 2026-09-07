# Snag — Pilot Guide

## What is Snag?

Snag is a Chrome extension that helps you fill out job applications faster. It
runs on your own computer — there's no company server involved, and nobody
else can see your profile or answers.

## What Snag does

```
Your profile (name, resume, skills, experience)
        |
        v
Snag detects the questions on a job application
        |
        v
Snag looks up relevant info from your profile + past answers
        |
        v
Snag generates a draft answer
        |
        v
YOU review it — Accept, Edit, Regenerate, or Skip
        |
        v
Snag fills the field you approved
        |
        v
Your approved answer is remembered for next time
(so a similar question on a future application gets a better draft)
```

**Snag never submits an application for you.** It only fills in fields you've
approved — you always click Submit yourself.

## Before you start

- Google Chrome
- Python 3.12 or newer (the setup script will tell you clearly if it's
  missing, with a link to install it — see Troubleshooting if that happens)
- Optional: [Ollama](https://ollama.com) running locally with a model pulled,
  if you want to run the AI fully on your own computer instead of using a
  cloud provider's API key

## Windows setup

1. Unzip the Snag folder you were given, anywhere you like.
2. Open the `windows` folder and double-click **Start-Snag.bat**.
3. The first run takes a few minutes (one-time setup). After that it's quick.
4. When it says "Snag backend started successfully", keep reading — it'll
   show you your auth token and the next steps right there in the window.

## Mac setup

1. Unzip the Snag folder you were given, anywhere you like.
2. Open the `mac` folder and double-click **Start-Snag.command**.
   - If macOS says it can't verify the developer, right-click (or Control-click)
     the file, choose **Open**, then confirm — this is normal for any script
     downloaded outside the App Store, not a Snag-specific problem.
3. The first run takes a few minutes (one-time setup). After that it's quick.
4. When it says "Snag backend started successfully", keep reading — it'll
   show you your auth token and the next steps right there in the window.

## Chrome extension setup

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `extension` folder inside the Snag
   folder you were given
4. The Snag icon should appear in your Chrome toolbar

You only need to do this once.

## Token setup

Each person running Snag gets their **own** auth token, generated automatically
the first time you start it — nobody hands this out or shares it with you; it's
created fresh on your machine. It's shown in the "Snag Backend" window right
after it starts, and saved to `data/auth_token.txt` inside your Snag folder.

1. Right-click the Snag icon in Chrome → **Options**
2. Paste the token into **Backend Auth Token**
3. Pick your LLM provider (Ollama for fully-local, or paste an API key for
   OpenAI/Anthropic/Groq)
4. Click **Save**

To check it worked: open the Snag sidebar (click the icon) on any page — if
the status badge at the top says **Live**, you're connected.

## First application — step by step

1. Open a real job application page
2. Click the Snag icon — the sidebar opens and scans the page
3. Simple fields (name, email, etc.) fill in automatically
4. Under **Questions**, click one to generate a draft answer
5. Read it. Click **Accept** if it's good, **Edit** to fix it first, or
   **Regenerate** for a different draft, or **Skip** to leave it for later
6. Repeat for each question
7. Review the whole form yourself, then click **Submit** on the page — Snag
   does not do this step for you

## Using Snag

- **Detecting fields** happens automatically when you open the sidebar on a
  page with a form
- **Generating answers** happens when you click a question under Questions
- **Editing** an answer before accepting keeps your edit, not the original draft
- **Approving/filling** writes the field only after you click Accept (or
  Edit → Accept) — nothing is filled without your say-so
- **Memory**: once you Accept an answer, Snag remembers it. A similar question
  later — even worded differently, even for a different company — can reuse
  and adapt it instead of starting from scratch. You can view, edit, or delete
  anything Snag has learned from the memory icon (top of the sidebar)
- **Resume import**: in the Profile section, upload a resume (`.pdf`/`.txt`)
  to pre-fill fields — you still review and approve what it extracted before
  it's saved to your profile

## Important privacy note

- Your profile, resume, and approved answers are stored **locally on your own
  computer, and they are not encrypted**. Anyone with access to this computer
  (or this Windows/Mac user account) could read that data — only use Snag on
  a machine you trust.
- Nothing is sent to whoever gave you this pilot build, or to any Snag-run
  server — there isn't one.
- If you choose a cloud LLM provider (OpenAI, Anthropic, Groq — anything other
  than Ollama), your questions, profile, and job context **are sent to that
  provider's servers** to generate answers. Ollama is the only option that
  keeps everything fully on your own machine.
- The in-app "Feedback" button in the sidebar won't work in this pilot build
  (it's not configured with anywhere to send to) — please use `FEEDBACK.md`
  instead.

## Troubleshooting

**Backend won't start**
Check the "Snag Backend" window for the actual error and share it in your
feedback. Common cause: Python isn't installed — see the error message for
a link.

**Extension can't connect / status badge says "Offline"**
Make sure you ran Start-Snag (Windows) / Start-Snag.command (Mac) and it said
"started successfully" — the extension needs that running the whole time
you're using Snag.

**Token rejected**
Copy the token again from the "Snag Backend" window or `data/auth_token.txt`
— make sure there's no extra space before/after it, and paste the whole thing.

**Chrome extension not appearing**
Make sure you selected the `extension` folder itself (not a parent folder) in
"Load unpacked", and that Developer mode is on.

**Application fields not detected**
Some pages load slowly or use unusual form structures — try reloading the
page and reopening the sidebar. If a field is still never detected, note the
site and field in your feedback.

**AI answer generation fails / spins forever**
If you're using Ollama, make sure it's running (`ollama serve`) with a model
pulled. If using a cloud provider, double check the API key in Options. Note
the exact error message in your feedback.

**"Snag is already running" but nothing works**
Double-click Stop-Snag (bat/command), then Start-Snag again.

**Windows SmartScreen warning ("Windows protected your PC")**
Click "More info" → "Run anyway". This appears for any unsigned script from
an unknown publisher — it's expected for a pilot build, not a sign of a
problem with Snag specifically.

**macOS "cannot be opened because the developer cannot be verified"**
Right-click (or Control-click) the `.command` file → Open → confirm. Same
reason as the Windows warning above — normal for an unsigned script.

**Something else broke**
Note exactly what you did, what you expected, and what happened instead —
that's the most useful kind of feedback for this pilot.

## Feedback

Please fill out [FEEDBACK.md](./FEEDBACK.md) after trying Snag on a few real
applications, and send it back to whoever gave you this pilot build.
