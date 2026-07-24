import { useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWebSocket } from "../hooks/useWebSocket";
import { useProvider, getProviderHeaders } from "../hooks/useProvider";
import FieldList, { type FieldClassification } from "./FieldList";
import MemorySuggestions from "./MemorySuggestions";
import AnswerCards, { type AnswerDraft } from "./AnswerCards";
import ProfileSettings from "./ProfileSettings";
import FeedbackModal from "./FeedbackModal";
import StatusBadge from "./StatusBadge";
import Section from "./Section";

interface StatusPayload {
  fieldCount?: number;
  staticMatchCount?: number;
  categoryCounts?: Record<string, number>;
}

interface Suggestion {
  fieldLabel: string;
  matches: Array<{
    id: string;
    score: number;
    payload: { question: string; answer: string; company: string; role: string };
  }>;
}

type DraftEntry = {
  question: string;
  answer: AnswerDraft;
  timestamp: number;
};

export default function Sidebar() {
  const { connected, messages, send, backendUrl } = useWebSocket();
  const provider = useProvider();
  const [selectedField, setSelectedField] = useState<FieldClassification | null>(null);
  const [draftMap, setDraftMap] = useState<Map<string, DraftEntry>>(new Map());
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);

  const apiBase = useMemo(
    () => backendUrl.replace(/^ws/, "http").replace(/\/$/, "") + "/api",
    [backendUrl]
  );

  const statusPayload = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === "status:update") {
        return (messages[i].payload || {}) as StatusPayload;
      }
    }
    return {} as StatusPayload;
  }, [messages]);

  const classifications = useMemo<FieldClassification[]>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === "fields:classified") {
        return (messages[i].payload?.classifications as FieldClassification[]) || [];
      }
    }
    return [];
  }, [messages]);

  const suggestions = useMemo<Suggestion[]>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === "memory:suggestions") {
        return (messages[i].payload?.suggestions as Suggestion[]) || [];
      }
    }
    return [];
  }, [messages]);

  const classifiedFieldMap = useMemo(() => {
    const map = new Map<string, { selector: string; fieldId: string }>();
    for (const c of classifications) {
      map.set(c.label, { selector: (c as any).selector || "", fieldId: c.fieldId });
    }
    return map;
  }, [classifications]);

  const longAnswerFields = useMemo(
    () => classifications.filter((f) => f.category === "long_answer"),
    [classifications]
  );

  const draftAnswers = useMemo(() => {
    const entries = Array.from(draftMap.values());
    entries.sort((a, b) => b.timestamp - a.timestamp);
    return entries.map((e) => e.answer);
  }, [draftMap]);

  const headers = useMemo(() => getProviderHeaders(provider), [provider]);

  const handleGenerate = useCallback(
    async (field: FieldClassification) => {
      setSelectedField(field);
      setGenerating(true);
      setGenerateError(null);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        const r = await fetch(`${apiBase}/answer/generate`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            question: field.label,
            questionType: field.questionType || "general",
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!r.ok) {
          const err = await r.json().catch(() => ({ detail: "Generation failed" }));
          setGenerateError(err.detail || `HTTP ${r.status}`);
          return;
        }
        const result = await r.json();
        if (result.error) {
          setGenerateError(result.error);
          return;
        }
        if (result.draft) {
          setDraftMap((prev) => {
            const next = new Map(prev);
            next.set(field.label, {
              question: field.label,
              answer: result,
              timestamp: Date.now(),
            });
            return next;
          });
        }
      } catch (e: any) {
        if (e.name === "AbortError") {
          setGenerateError("Request timed out. The model may be loading.");
        } else {
          setGenerateError("Cannot reach backend. Is it running?");
          console.error("[Snag] generate failed:", e);
        }
      } finally {
        setGenerating(false);
      }
    },
    [apiBase, headers]
  );

  const handleRegenerate = useCallback(
    async (question: string) => {
      setGenerating(true);
      setGenerateError(null);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        const r = await fetch(`${apiBase}/answer/generate`, {
          method: "POST",
          headers,
          body: JSON.stringify({ question }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!r.ok) {
          const err = await r.json().catch(() => ({ detail: "Generation failed" }));
          setGenerateError(err.detail || `HTTP ${r.status}`);
          return;
        }
        const result = await r.json();
        if (result.error) {
          setGenerateError(result.error);
          return;
        }
        if (result.draft) {
          setDraftMap((prev) => {
            const next = new Map(prev);
            next.set(question, {
              question,
              answer: result,
              timestamp: Date.now(),
            });
            return next;
          });
        }
      } catch (e: any) {
        if (e.name === "AbortError") {
          setGenerateError("Request timed out. The model may be loading.");
        } else {
          setGenerateError("Cannot reach backend. Is it running?");
          console.error("[Snag] regenerate failed:", e);
        }
      } finally {
        setGenerating(false);
      }
    },
    [apiBase, headers]
  );

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="h-full bg-surface/95 backdrop-blur-xl flex flex-col"
    >
      <header className="relative px-4 py-3 glass-strong">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent to-violet-500 flex items-center justify-center shadow-glow">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-surface" />
            </div>
            <div>
              <h1 className="text-[13px] font-bold text-white tracking-tight">Snag</h1>
              <p className="text-[9px] text-gray-500 font-medium">AI Job Copilot</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => { try { chrome.runtime.openOptionsPage(); } catch {} }}
              className="w-5 h-5 flex items-center justify-center rounded-md hover:bg-white/[0.06] text-gray-500 hover:text-gray-300 transition-colors"
              title="Extension Settings"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <StatusBadge connected={connected} />
          </div>
        </div>
        <div className="glow-line mt-3" />
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-3 gap-1.5"
        >
          {[
            { label: "Fields", value: statusPayload.fieldCount ?? 0, color: "text-accent", bg: "bg-accent/8" },
            { label: "Auto-fill", value: statusPayload.staticMatchCount ?? 0, color: "text-emerald-400", bg: "bg-emerald-400/8" },
            { label: "Questions", value: longAnswerFields.length, color: "text-amber-400", bg: "bg-amber-400/8" },
          ].map((stat) => (
            <div key={stat.label} className={`${stat.bg} rounded-xl px-2.5 py-2 text-center`}>
              <p className={`text-[14px] font-bold font-mono ${stat.color}`}>{stat.value}</p>
              <p className="text-[8px] text-gray-500 font-semibold uppercase tracking-wider mt-0.5">{stat.label}</p>
            </div>
          ))}
        </motion.div>

        <Section title="Profile" icon="user">
          <ProfileSettings />
        </Section>

        <Section title="Detected Fields" icon="list" badge={classifications.length || undefined}>
          <FieldList fields={classifications} />
        </Section>

        <Section title="Questions" icon="help-circle" badge={longAnswerFields.length || undefined}>
          {longAnswerFields.length > 0 ? (
            <div className="space-y-1">
              {longAnswerFields.map((f, i) => (
                <motion.button
                  key={f.fieldId}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => handleGenerate(f)}
                  disabled={generating}
                  className="w-full text-left px-2.5 py-2 rounded-lg bg-surface/40 border border-white/[0.03] hover:border-accent/20 hover:bg-accent/5 transition-all disabled:opacity-40 disabled:cursor-wait group"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-md bg-accent/10 flex items-center justify-center shrink-0 group-hover:bg-accent/20 transition-colors">
                      {generating && selectedField?.fieldId === f.fieldId ? (
                        <div className="w-2.5 h-2.5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-2.5 h-2.5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] text-gray-300 truncate block group-hover:text-gray-100 transition-colors">
                        {f.label}
                      </span>
                    </div>
                    {f.questionType && (
                      <span className="text-[8px] text-gray-600 font-mono shrink-0">{f.questionType}</span>
                    )}
                  </div>
                </motion.button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 py-3 text-gray-600">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
              </svg>
              <span className="text-[11px]">No questions to generate</span>
            </div>
          )}
        </Section>

        <Section title="Memory" icon="database" badge={suggestions.length || undefined}>
          {suggestions.length > 0 ? (
            <MemorySuggestions suggestions={suggestions} />
          ) : (
            <div className="flex items-center gap-2 py-3 text-gray-600">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <span className="text-[11px]">No past answers yet</span>
            </div>
          )}
        </Section>

        <Section title="Answers" icon="file-text" badge={draftAnswers.length || undefined}>
          <AnimatePresence>
            {generateError && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mb-2 px-2.5 py-2 rounded-lg bg-red-500/10 border border-red-500/20"
              >
                <p className="text-[10px] text-red-400 font-medium">{generateError}</p>
              </motion.div>
            )}
            {draftAnswers.length > 0 ? (
              <AnswerCards answers={draftAnswers} send={send} fieldMap={classifiedFieldMap} />
            ) : generating ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-2.5 py-4"
              >
                <div className="relative">
                  <div className="w-5 h-5 border-2 border-accent/20 border-t-accent rounded-full animate-spin" />
                </div>
                <div>
                  <p className="text-[11px] text-gray-300 font-medium">Generating answer...</p>
                  <p className="text-[9px] text-gray-600 mt-0.5">
                    Using {provider.provider === "ollama" ? "local model" : provider.provider}
                  </p>
                </div>
              </motion.div>
            ) : (
              <div className="flex items-center gap-2 py-3 text-gray-600">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <span className="text-[11px]">Click a question above to generate</span>
              </div>
            )}
          </AnimatePresence>
        </Section>
      </div>

      <footer className="relative px-4 py-2 glass-strong">
        <div className="glow-line mb-2" />
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-gray-600 font-mono">v0.2.0</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFeedback(true)}
              className="flex items-center gap-1 text-[9px] text-gray-500 hover:text-accent transition-colors"
              title="Send Feedback"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
              Feedback
            </button>
            <div className="w-px h-3 bg-gray-700" />
            <div className="flex items-center gap-1">
              <div className={`w-1 h-1 rounded-full ${connected ? "bg-emerald-400/60" : "bg-gray-600"}`} />
              <span className="text-[9px] text-gray-600">{connected ? "Connected" : "Offline"}</span>
            </div>
          </div>
        </div>
      </footer>

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </motion.div>
  );
}
