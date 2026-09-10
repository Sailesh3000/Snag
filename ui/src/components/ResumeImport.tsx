import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { UseProfileReturn } from "../hooks/useProfile";
import type { ChannelMessage } from "../hooks/useBackendChannel";

interface ExtractedFields {
  first_name: string; last_name: string; email: string; phone: string;
  city: string; state: string; country: string;
  linkedin: string; github: string; portfolio: string;
  education: string[]; experience: string[]; skills: string[];
}

// Which profile keys a resume can plausibly fill, and how to turn an
// extracted value into the plain string ProfileSettings/updateField expects.
const REVIEW_FIELDS: { key: keyof ExtractedFields; label: string; isList: boolean }[] = [
  { key: "first_name", label: "First Name", isList: false },
  { key: "last_name", label: "Last Name", isList: false },
  { key: "email", label: "Email", isList: false },
  { key: "phone", label: "Phone", isList: false },
  { key: "city", label: "City", isList: false },
  { key: "state", label: "State", isList: false },
  { key: "country", label: "Country", isList: false },
  { key: "linkedin", label: "LinkedIn", isList: false },
  { key: "github", label: "GitHub", isList: false },
  { key: "portfolio", label: "Portfolio", isList: false },
  { key: "education", label: "Education", isList: true },
  { key: "experience", label: "Experience", isList: true },
  { key: "skills", label: "Skills", isList: true },
];

type Status = "idle" | "uploading" | "extracting" | "review" | "applied" | "error";

interface ResumeImportProps {
  profile: UseProfileReturn;
  send: (msg: object) => void;
  messages: ChannelMessage[];
}

function toDisplayValue(value: string | string[], isList: boolean): string {
  if (isList) return Array.isArray(value) ? value.join("\n") : String(value ?? "");
  return String(value ?? "");
}

function fromDisplayValue(text: string, isList: boolean): string {
  if (!isList) return text.trim();
  return text.split("\n").map((s) => s.trim()).filter(Boolean).join("; ");
}

export default function ResumeImport({ profile, send, messages }: ResumeImportProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.type !== "resume:extracted") return;
    const payload = last.payload as { fields: ExtractedFields | null; error: string | null };
    if (payload.error || !payload.fields) {
      setStatus("error");
      setError(payload.error || "Extraction failed.");
      return;
    }

    const nextValues: Record<string, string> = {};
    const nextSelected = new Set<string>();
    for (const f of REVIEW_FIELDS) {
      const display = toDisplayValue(payload.fields[f.key], f.isList);
      nextValues[f.key] = display;
      if (display.trim()) nextSelected.add(f.key);
    }
    setValues(nextValues);
    setSelected(nextSelected);
    setStatus("review");
  }, [messages]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // allow re-selecting the same file later

    setStatus("uploading");
    setError(null);

    try {
      // The file is read LOCALLY (plan B3: nothing leaves the machine); only
      // the extracted-text round-trip for the LLM step goes through the
      // background, which currently parks it (resume extraction returns with
      // the local-model / BYOK mode).
      const isText = /\.(txt|md)$/i.test(file.name);
      const isPdf = /\.pdf$/i.test(file.name);
      let resumeText: string;
      if (isText) {
        resumeText = await file.text();
      } else if (isPdf) {
        throw new Error("PDF import needs the local-model mode — it's coming back in a later release. For now, export your resume to .txt and import that.");
      } else {
        throw new Error("Unsupported file type — use .txt, .md, or .pdf.");
      }
      if (!resumeText.trim()) throw new Error("Couldn't read any text from this file.");

      setStatus("extracting");
      send({ type: "resume:extract", payload: { resumeText } });
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [send]);

  const toggleSelected = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const handleApply = useCallback(async () => {
    for (const f of REVIEW_FIELDS) {
      if (!selected.has(f.key)) continue;
      const raw = values[f.key];
      const finalValue = f.isList ? fromDisplayValue(raw, true) : raw.trim();
      if (!finalValue) continue;
      await profile.updateField(f.key, finalValue);
    }
    setStatus("applied");
    setTimeout(() => setStatus("idle"), 2000);
  }, [selected, values, profile]);

  return (
    <div className="space-y-2">
      <input ref={fileInputRef} type="file" accept=".pdf,.txt,.md" className="hidden" onChange={handleFileChange} />

      {status === "idle" && (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold px-2.5 py-2 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
          </svg>
          Import from resume (.pdf, .txt)
        </button>
      )}

      {(status === "uploading" || status === "extracting") && (
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface/40 border border-white/[0.03]">
          <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          <span className="text-[10px] text-gray-400">
            {status === "uploading" ? "Reading file..." : "Extracting fields..."}
          </span>
        </div>
      )}

      {status === "error" && (
        <div className="px-2.5 py-2 rounded-lg bg-red-500/10 border border-red-500/20 space-y-1.5">
          <p className="text-[10px] text-red-400">{error}</p>
          <button
            onClick={() => setStatus("idle")}
            className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-gray-500/10 text-gray-400 hover:bg-gray-500/20"
          >
            Dismiss
          </button>
        </div>
      )}

      {status === "applied" && (
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-[11px] text-emerald-400 font-medium">Profile updated</span>
        </div>
      )}

      <AnimatePresence>
        {status === "review" && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-1.5 bg-surface/40 border border-white/[0.03] rounded-lg p-2.5"
          >
            <p className="text-[9px] text-gray-500 mb-1">
              Review before saving — nothing is applied until you click Apply. Uncheck anything wrong or not yours.
            </p>
            {REVIEW_FIELDS.filter((f) => values[f.key]?.trim()).map((f) => (
              <div key={f.key} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={selected.has(f.key)}
                  onChange={() => toggleSelected(f.key)}
                  className="mt-1 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <label className="text-[9px] text-gray-500 font-medium block mb-0.5">{f.label}</label>
                  {f.isList ? (
                    <textarea
                      value={values[f.key]}
                      onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      rows={Math.min(4, (values[f.key].match(/\n/g)?.length ?? 0) + 1)}
                      className="w-full text-[10px] bg-surface/60 rounded border border-surface-border p-1.5 text-gray-200 resize-none outline-none"
                    />
                  ) : (
                    <input
                      value={values[f.key]}
                      onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      className="w-full text-[10px] bg-surface/60 rounded border border-surface-border p-1.5 text-gray-200 outline-none"
                    />
                  )}
                </div>
              </div>
            ))}
            <div className="flex gap-1.5 pt-1">
              <button
                onClick={handleApply}
                className="flex-1 text-[10px] font-semibold px-2 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
              >
                Apply Selected
              </button>
              <button
                onClick={() => setStatus("idle")}
                className="flex-1 text-[10px] font-semibold px-2 py-1.5 rounded-lg bg-gray-500/10 text-gray-400 hover:bg-gray-500/20"
              >
                Discard
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
