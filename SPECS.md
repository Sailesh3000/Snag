# Snag — High-Level Specification

## 1. System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Chrome Extension                          │
│  (Manifest V3, TypeScript)                                   │
│  ┌──────────┐  ┌───────────┐  ┌───────────────────────────┐ │
│  │ Site     │  │ DOM       │  │ Floating Sidebar (React)  │ │
│  │ Detector │  │ Extractor │  │ ┌───────────────────────┐ │ │
│  │          │  │           │  │ │ Job Info              │ │ │
│  │          │  │           │  │ │ Autofill Status       │ │ │
│  │          │  │           │  │ │ Questions             │ │ │
│  │          │  │           │  │ │ Generated Answers     │ │ │
│  │          │  │           │  │ │ Memory Suggestions    │ │ │
│  │          │  │           │  │ │ Feedback              │ │ │
│  └──────────┘  └───────────┘  └───────────────────────────┘ │
│  ┌──────────────────┐                                        │
│  │ Settings Page    │  API key + provider config             │
│  │ (options_page)   │  Stored in chrome.storage              │
│  └──────────────────┘                                        │
│                     │  WebSocket / REST                      │
└─────────────────────┼────────────────────────────────────────┘
                      │
┌─────────────────────┼────────────────────────────────────────┐
│              FastAPI Backend (Python)                        │
│  Binds to 127.0.0.1 only; every request below requires a     │
│  per-installation auth token (backend/auth.py) — see §6.     │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  WebSocket handler (backend/api/ws.py)                │   │
│  │  Field classification -> static autofill match ->     │   │
│  │  memory retrieval -> prompt/context assembly ->        │   │
│  │  fill-confirmation state machine -> save to memory     │   │
│  └──────────────────────────────────────────────────────┘   │
│         │                                                   │
│  ┌──────▼──────┐                                           │
│  │  SQLite     │  (unencrypted — see §6)                   │
│  │  (profile,  │                                           │
│  │  sessions,  │                                           │
│  │  answers,   │                                           │
│  │  embeddings)│                                           │
│  └─────────────┘                                           │
└─────────────────────────────────────────────────────────────┘
```

Note: the backend never calls an LLM itself. `/api/answer/prepare` returns the
assembled prompt/context; the **extension** calls whichever provider the user
configured (BYOK), directly from the browser — see the LLM Provider block above.
An earlier Strands-based multi-agent orchestrator (`backend/orchestrator.py`,
`backend/agents/`) was removed after this refactor; it's no longer part of the
live path.

---

## 2. Component Specifications

### 2.1 Chrome Extension (`extension/`)

| Module | Responsibility |
|---|---|
| **Site Detector** | Match current URL against supported job site patterns. |
| **DOM Extractor** | Traverse DOM to extract form fields: labels, placeholders, types, select/checkbox options. Return structured `Field[]`. |
| **Sidebar** | React SPA injected as floating panel. Toggle via toolbar icon. Sections: Profile (incl. resume import), Fields, Questions, Answers, Memory, Feedback. |
| **Settings Page** | Chrome extension options page. Configure LLM provider (Ollama/OpenAI/Anthropic/Groq/OpenAI-compatible), API key, backend URL. |
| **Connection Layer** | WebSocket ↔ Backend. Send page metadata, receive fill instructions. |

**Message Protocol (Extension → Backend):**

```typescript
// From extension
{ type: "page:update", payload: { url, fields: Field[], jobTitle?, company? } }
{ type: "field:changed", payload: { fieldId, value } }
{ type: "answer:approve", payload: { fieldId, answer } }
{ type: "answer:edit", payload: { fieldId, original, edited } }

// From backend
{ type: "status:update", payload: { connected, sessionId } }
{ type: "profile:ready", payload: { fields: ProfileField[] } }
{ type: "answer:draft", payload: { fieldId, question, draft, confidence, sources } }
{ type: "fill:preview", payload: { fieldId, value } }
{ type: "fill:executed", payload: { fieldId, success } }
{ type: "backend:status", payload: { online: boolean } }  // from service-worker health ping
```

### 2.2 Backend (`backend/`)

| Module | Responsibility |
|---|---|
| **FastAPI Server** | REST endpoints + WebSocket handler. CORS for extension. |
| **Session Manager** | Track active sessions per tab/user. |
| **Strands Orchestrator** | Route tasks to agents, maintain workflow state. |
| **LLM Provider Router** | Abstract LLM calls across Ollama, OpenAI, Anthropic, Groq, OpenAI-compatible APIs. API key passed from frontend per-request. |
| **Memory Service** | SQLite-based semantic search using sentence-transformers embeddings + numpy cosine similarity. |

**API Endpoints:** (all except `/health`/`/api/health` require the auth token — see §6)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health check (no auth) |
| GET | `/api/profile` | Get profile fields |
| PUT | `/api/profile/{key}` | Update profile field |
| POST | `/api/profile/resume/upload` | Upload a resume (server generates the storage filename) |
| POST | `/api/answer/prepare` | Build the prompt/context for a question (backend never calls the LLM) |
| GET/PUT/DELETE | `/api/memory/answers[/{id}]` | List / edit / delete learned answers (memory management screen) |
| WS | `/ws/{session_id}?token=...` | Real-time bidirectional comm |

### 2.3 LLM Providers

| Provider | Default Model | API Key Required |
|---|---|---|
| **Ollama** | qwen3:8b | No (local) |
| **OpenAI** | gpt-4o-mini | Yes |
| **Anthropic** | claude-3-5-haiku-20241022 | Yes |
| **Groq** | llama-3.1-70b-versatile | Yes (free tier) |
| **OpenAI-Compatible** | configurable | Yes |

### 2.4 Data Flow (Answer Generation Pipeline)

```
Question text
    ↓
Page Agent classifies field type
    ↓
Profile Agent retrieves profile (name, email, etc.)
    ↓
Memory Agent queries SQLite for similar past Q&A (cosine similarity)
    ↓
Answer Agent constructs prompt:
    [System prompt] + [Profile] + [Similar answers] + [Job desc] + [Question]
    ↓
LLM Provider generates draft answer
    ↓
User reviews, edits, or approves
    ↓
Fill Agent fills DOM field
    ↓
Learning Agent stores final answer + updates embeddings
```

---

## 3. Database Schema

### SQLite (`snag.db`)

```sql
CREATE TABLE profile (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE resumes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    embedding BLOB,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    company TEXT,
    role TEXT,
    url TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    question TEXT NOT NULL,
    original_answer TEXT,
    final_answer TEXT NOT NULL,
    company TEXT,
    role TEXT,
    embedding TEXT,          -- JSON array of floats for cosine similarity
    embedding_id TEXT,
    approved INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
```

---

## 4. Supported Job Sites (Initial)

| Platform | Detection Pattern |
|---|---|
| Workday | `*.myworkdayjobs.com/*`, `*.wd5.myworkdayjobs.com/*` |
| Greenhouse | `boards.greenhouse.io/*`, `app.greenhouse.io/*` |
| Lever | `jobs.lever.co/*` |
| Ashby | `jobs.ashbyhq.com/*` |
| Breezy | `breezy.hr/*` |
| SmartRecruiters | `jobs.smartrecruiters.com/*` |
| LinkedIn Easy Apply | `linkedin.com/jobs/*` |

---

## 5. Profile Fields

| Key | Type | Required |
|---|---|---|
| `first_name` | string | Y |
| `last_name` | string | Y |
| `email` | string | Y |
| `phone` | string | N |
| `gender` | string | N |
| `date_of_birth` | string | N |
| `city` | string | N |
| `state` | string | N |
| `zip_code` | string | N |
| `country` | string | N |
| `address` | string | N |
| `linkedin` | string | N |
| `github` | string | N |
| `portfolio` | string | N |
| `work_authorization` | string | N |
| `visa_status` | string | N |
| `willing_to_relocate` | string | N |
| `education` | JSON array | N |
| `experience` | JSON array | N |
| `skills` | JSON array | N |

---

## 6. Security & Constraints

- **BYO API Key**: Users provide their own API keys. Keys stored in `chrome.storage.local` (not synced to the user's Google account). Backend never stores or sees API keys — the extension calls the LLM provider directly.
- No cloud LLM calls unless user configures a cloud provider
- User must explicitly approve each field fill (no auto-submit)
- Extension only injects on supported job sites (click to activate)
- **Backend auth**: binds to `127.0.0.1` only; every REST/WS request requires a
  per-installation token (`backend/auth.py`, generated on first run, persisted to
  `data/auth_token.txt`, pasted into the extension's Settings page once). This is
  the actual access-control boundary — CORS is left permissive and is *not* relied
  on for security, since loopback binding alone doesn't stop another page open in
  the same browser from reaching the backend.
- **Sensitive fields** (work authorization, visa status, gender, date of birth) are
  never silently auto-filled — they're surfaced as a reviewable suggestion.
- **Not implemented**: encryption at rest for `data/snag.db` or `data/auth_token.txt`
  (both are plain files), and WebSocket message rate-limiting. Both are honest gaps,
  not silent ones — see the README's Security/Known Limitations sections.
- Minimal permissions: `activeTab`, `storage`, `scripting`, `alarms`; `host_permissions` limited to `http://127.0.0.1:8765/*`

## 7. Reliability & Always-On Operation

| Concern | Mechanism |
|---|---|
| Concurrent DB access | SQLite **WAL mode** + `busy_timeout=5000` on every connection |
| Crash diagnostics | `logs/snag.log` via `RotatingFileHandler` (5MB × 5 backups, INFO) + console WARNING |
| LLM outages | Extension-side (`extension/src/llm/*.ts`): every provider call capped at 90s via `AbortSignal.timeout`, one retry (1s backoff) on timeout/network error only |
| LLM failure UX | `answer:draft` payload carries `error`; the Answers card shows it with Retry/Skip/Fill-manually — never a silent hang |
| Fill confirmation | Accept doesn't report/save success until the content script confirms the DOM write; failure shows Retry/Edit/Skip/Fill-manually |
| Startup safety | `start.py` preflight: hard-fails if the port is in use; warns (non-fatal) if Ollama is unreachable |
| Backend goes down | Sidebar WebSocket reconnect with exponential backoff (1s → 30s cap), statuses `Live` / `Reconnecting` / `Offline` |
| Silent backend death | Service worker pings `/health` every 30s (`alarms`), broadcasts `backend:status` to open sidebars |
| Always-on on Windows | `setup_service.ps1` installs `SnagBackend` via NSSM: auto-start, restart-on-failure (5s delay), logs to `logs/service_*.log` |

### Answer Prompts

The prompt builder (`backend/prompts/templates.py`) never substitutes a canned
question — the user's actual question text is always injected. Every prompt
receives the profile, past approved answers (style guide), and job description
(if provided). Prompts are kept deliberately lean; per-type guidance is a single
one-line hint (e.g. STAR format for behavioral questions).

---

## 8. Deployment

### Local Development
```bash
python start.py  # Builds UI + Extension + preflight checks + starts backend
```

### Windows Service (always-on)
```powershell
.\setup_service.ps1              # NSSM: install + start SnagBackend
.\setup_service.ps1 -Uninstall   # remove the service
```
Run as Administrator. Auto-installs NSSM via winget if missing.

### Docker
```bash
docker compose up --build
```

### Chrome Web Store
1. Build extension: `cd extension && npm run build`
2. Zip `extension/` directory
3. Upload to Chrome Web Store ($5 one-time fee)

---

## 9. Implementation Phases

| Phase | Deliverable | Status |
|---|---|---|
| **P1 — Foundation** | FastAPI + WebSocket + Extension scaffold + Sidebar + static autofill | Done |
| **P2 — Profile System** | SQLite profile/resume CRUD, multi-field static fill | Done |
| **P3 — Form Understanding** | Page Agent, DOM parser, field classification | Done |
| **P4 — Memory** | SQLite embeddings, semantic retrieval, no Qdrant | Done |
| **P5 — Answer Generation** | Answer Agent, multi-provider LLM support | Done |
| **P6 — Fill Engine** | Fill Agent, preview/approve workflow | Done |
| **P7 — Learning** | Learning Agent, edit tracking, embedding updates | Done |
| **P8 — Public Release** | Settings page, feedback, Docker, Chrome Web Store prep | Done |
