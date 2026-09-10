// Local-first data layer. All durable user data (profile, resumes, answer
// memory) lives in the extension's IndexedDB and never leaves the machine —
// this restores the pilot's "nothing leaves your machine" promise. Only
// subscription status and usage counters are authoritative server-side.
//
// Ported from the backend's SQLite schema (backend/memory/sqlite_store.py):
//   profile (key/value/verified)  -> single "profile" record
//   resumes (id, name, path, ...) -> "resumes" store (blob + extracted text)
//   answers (...)                 -> "answers" store (with embedding vector)
// sessions / pending_fills        -> in-memory, tab-scoped (cleared on close)

const DB_NAME = "snag";
const DB_VERSION = 1;

const PROFILE_KEY = "profile";

export interface ProfileRecord {
  key: string; // always PROFILE_KEY
  fields: Record<string, string>;
  verified: Record<string, boolean>;
  updatedAt: number;
}

export interface ResumeRecord {
  id: string;
  filename: string;
  blob: Blob;
  extractedText?: string;
  createdAt: number;
}

export interface AnswerRecord {
  id: string;
  question: string;
  answer: string;
  company: string;
  role: string;
  embedding: number[] | null;
  questionType?: string;
  originalAnswer?: string;
  approved: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SaveAnswerArgs {
  question: string;
  answer: string;
  company?: string;
  role?: string;
  originalAnswer?: string;
  questionType?: string;
  embedding?: number[] | null;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("profile")) {
          db.createObjectStore("profile", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("resumes")) {
          db.createObjectStore("resumes", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("answers")) {
          const store = db.createObjectStore("answers", { keyPath: "id" });
          store.createIndex("by_embedding_id", "embeddingId", { unique: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

// Runs a single request inside its own transaction and resolves with the
// request's result. Each call is a discrete, auto-committing transaction.
async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const req = fn(s);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Deterministic 64-bit FNV-1a over "question|company|role" — a stable dedup
// key for answer memory (mirrors the backend's md5-based embedding_id). Not
// cryptographic; just needs to be stable and collision-resistant at a few
// thousand rows.
export function embeddingIdFor(question: string, company: string, role: string): string {
  const raw = `${question}|${company}|${role}`;
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = (1n << 64n) - 1n;
  for (let i = 0; i < raw.length; i++) {
    h ^= BigInt(raw.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

// ---------------------------------------------------------------------------
// Profile (single record)
// ---------------------------------------------------------------------------

// Verified fields only — what the fill/classify logic actually uses.
export async function getProfile(): Promise<Record<string, string>> {
  const rec = await withStore<ProfileRecord | undefined>("profile", "readonly", (s) => s.get(PROFILE_KEY));
  if (!rec) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec.fields)) {
    if (rec.verified[k]) out[k] = v;
  }
  return out;
}

export async function getAllProfileFields(): Promise<Record<string, { value: string; verified: boolean }>> {
  const rec = await withStore<ProfileRecord | undefined>("profile", "readonly", (s) => s.get(PROFILE_KEY));
  const out: Record<string, { value: string; verified: boolean }> = {};
  if (rec) {
    for (const [k, v] of Object.entries(rec.fields)) {
      out[k] = { value: v, verified: !!rec.verified[k] };
    }
  }
  return out;
}

export async function setProfileField(key: string, value: string, verified = true): Promise<void> {
  const rec = await withStore<ProfileRecord | undefined>("profile", "readwrite", (s) => s.get(PROFILE_KEY));
  const next: ProfileRecord = {
    key: PROFILE_KEY,
    fields: { ...(rec?.fields || {}), [key]: value },
    verified: { ...(rec?.verified || {}), [key]: verified },
    updatedAt: Date.now(),
  };
  await withStore<IDBValidKey>("profile", "readwrite", (s) => s.put(next));
}

export async function deleteProfileField(key: string): Promise<void> {
  const rec = await withStore<ProfileRecord | undefined>("profile", "readwrite", (s) => s.get(PROFILE_KEY));
  if (!rec) return;
  const fields = { ...rec.fields };
  const verified = { ...rec.verified };
  delete fields[key];
  delete verified[key];
  await withStore<IDBValidKey>("profile", "readwrite", (s) =>
    s.put({ key: PROFILE_KEY, fields, verified, updatedAt: Date.now() }),
  );
}

// ---------------------------------------------------------------------------
// Resumes
// ---------------------------------------------------------------------------

export async function addResume(filename: string, blob: Blob, extractedText?: string): Promise<string> {
  const id = newId("res");
  const rec: ResumeRecord = { id, filename, blob, extractedText, createdAt: Date.now() };
  await withStore<IDBValidKey>("resumes", "readwrite", (s) => s.put(rec));
  return id;
}

// Metadata only (no blob) — for listing UIs.
export async function getResumes(): Promise<Omit<ResumeRecord, "blob">[]> {
  const all = await withStore<ResumeRecord[]>("resumes", "readonly", (s) => s.getAll());
  return all.map(({ blob, ...rest }) => rest);
}

export async function getResume(id: string): Promise<ResumeRecord | undefined> {
  return withStore<ResumeRecord | undefined>("resumes", "readonly", (s) => s.get(id));
}

export async function deleteResume(id: string): Promise<void> {
  await withStore<undefined>("resumes", "readwrite", (s) => s.delete(id));
}

// ---------------------------------------------------------------------------
// Answer memory
// ---------------------------------------------------------------------------

export async function saveAnswer(args: SaveAnswerArgs): Promise<AnswerRecord> {
  const { question, answer, company = "", role = "", originalAnswer, questionType, embedding = null } = args;
  const embeddingId = embeddingIdFor(question, company, role);
  const now = Date.now();

  // Upsert by embeddingId so repeated accepts of the same (question, company,
  // role) refresh a single memory instead of piling up duplicates.
  const existing = await withStore<AnswerRecord | undefined>(
    "answers",
    "readonly",
    (s) => s.index("by_embedding_id").get(embeddingId),
  );

  const rec: AnswerRecord = existing
    ? { ...existing, answer, originalAnswer, questionType, embedding, updatedAt: now }
    : {
        id: newId("ans"),
        question,
        answer,
        company,
        role,
        embedding,
        questionType,
        originalAnswer,
        approved: true,
        createdAt: now,
        updatedAt: now,
      };
  (rec as AnswerRecord & { embeddingId: string }).embeddingId = embeddingId;
  await withStore<IDBValidKey>("answers", "readwrite", (s) => s.put(rec));
  return rec;
}

export async function getAnswers(): Promise<AnswerRecord[]> {
  return withStore<AnswerRecord[]>("answers", "readonly", (s) => s.getAll());
}

export async function updateAnswer(id: string, answer: string): Promise<boolean> {
  const existing = await withStore<AnswerRecord | undefined>("answers", "readonly", (s) => s.get(id));
  if (!existing) return false;
  await withStore<IDBValidKey>("answers", "readwrite", (s) =>
    s.put({ ...existing, answer, updatedAt: Date.now() }),
  );
  return true;
}

export async function deleteAnswer(id: string): Promise<boolean> {
  const existing = await withStore<AnswerRecord | undefined>("answers", "readonly", (s) => s.get(id));
  if (!existing) return false;
  await withStore<undefined>("answers", "readwrite", (s) => s.delete(id));
  return true;
}

// ---------------------------------------------------------------------------
// Ephemeral, tab-scoped state (in-memory; cleared on tab close / reload)
// ---------------------------------------------------------------------------

export interface SessionState {
  id: string;
  company: string;
  role: string;
  url: string;
  jobDescription: string;
}

export interface PendingFill {
  sessionId: string;
  question: string;
  finalAnswer: string;
  company: string;
  role: string;
  originalAnswer?: string;
}

const sessions = new Map<string, SessionState>();
const pendingFills = new Map<string, PendingFill>();

export function upsertSession(s: SessionState): void {
  sessions.set(s.id, s);
}

export function getSession(id: string): SessionState | undefined {
  return sessions.get(id);
}

export function deleteSession(id: string): void {
  sessions.delete(id);
  clearPendingFillsForSession(id);
}

export function setPendingFill(requestId: string, pf: PendingFill): void {
  pendingFills.set(requestId, pf);
}

// Pops the pending fill (called once the content script confirms the DOM
// write actually succeeded — that's the only moment an answer is saved).
export function takePendingFill(requestId: string): PendingFill | undefined {
  const pf = pendingFills.get(requestId);
  if (pf) pendingFills.delete(requestId);
  return pf;
}

export function clearPendingFillsForSession(sessionId: string): void {
  for (const [rid, pf] of pendingFills) {
    if (pf.sessionId === sessionId) pendingFills.delete(rid);
  }
}
