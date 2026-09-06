import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWebSocket } from "../hooks/useWebSocket";
import { useProvider } from "../hooks/useProvider";
import FieldList, { type FieldClassification } from "./FieldList";
import MemorySuggestions from "./MemorySuggestions";
import AnswerCards, { type FieldAnswerState } from "./AnswerCards";
import ProfileSettings from "./ProfileSettings";
import MemoryManager from "./MemoryManager";
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

interface StaticSuggestion {
  fieldId: string;
  selector: string;
  label: string;
  value: string;
  key: string;
}

// If the backend/LLM never responds at all (WS down, provider hung with no
// timeout ever firing upstream), don't leave the UI spinning forever. This
// is deliberately looser than the extension's own LLM_TIMEOUT_MS (45s) plus
// its one retry, so it only fires when something upstream failed silently.
const GENERATION_UI_TIMEOUT_MS = 100_000;

function newRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function Sidebar() {
  const { connectionStatus, messages, send } = useWebSocket();
  const provider = useProvider();
  const [fieldAnswers, setFieldAnswers] = useState<Map<string, FieldAnswerState>>(new Map());
  const [showFeedback, setShowFeedback] = useState(false);
  const [showMemoryManager, setShowMemoryManager] = useState(false);
  const timeoutHandles = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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

  const longAnswerFields = useMemo(
    () => classifications.filter((f) => f.category === "long_answer"),
    [classifications]
  );

  const answerList = useMemo(() => {
    const entries = Array.from(fieldAnswers.values());
    entries.sort((a, b) => b.updatedAt - a.updatedAt);
    return entries;
  }, [fieldAnswers]);

  const clearFieldTimeout = useCallback((fieldId: string) => {
    const handle = timeoutHandles.current.get(fieldId);
    if (handle) {
      clearTimeout(handle);
      timeoutHandles.current.delete(fieldId);
    }
  }, []);

  const armGenerationTimeout = useCallback((fieldId: string) => {
    clearFieldTimeout(fieldId);
    const handle = setTimeout(() => {
      setFieldAnswers((prev) => {
        const entry = prev.get(fieldId);
        if (!entry || entry.status !== "generating") return prev;
        const next = new Map(prev);
        next.set(fieldId, { ...entry, status: "error", error: "Timed out waiting for a response. Check the backend and your LLM provider are running.", updatedAt: Date.now() });
        return next;
      });
    }, GENERATION_UI_TIMEOUT_MS);
    timeoutHandles.current.set(fieldId, handle);
  }, [clearFieldTimeout]);

  useEffect(() => {
    return () => {
      for (const handle of timeoutHandles.current.values()) clearTimeout(handle);
    };
  }, []);

  // Sensitive static fields (work authorization, visa status, gender, DOB)
  // arrive as reviewable suggestions rather than being auto-filled — they
  // reuse the exact same Accept/Edit/Skip card as a generated answer.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.type !== "static:suggestions") return;
    const items = (last.payload?.suggestions as StaticSuggestion[]) || [];
    if (items.length === 0) return;

    setFieldAnswers((prev) => {
      const next = new Map(prev);
      for (const item of items) {
        if (next.has(item.fieldId)) continue; // don't clobber an in-progress card
        next.set(item.fieldId, {
          fieldId: item.fieldId,
          question: item.label,
          selector: item.selector,
          company: "",
          role: "",
          questionType: "profile_fact",
          confidence: 0.99,
          profileUsed: [item.key],
          memoryCount: 0,
          draft: item.value,
          streamingText: "",
          status: "ready",
          source: "static_suggestion",
          updatedAt: Date.now(),
        });
      }
      return next;
    });
  }, [messages]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;

    if (last.type === "answer:stream") {
      const fieldId = last.payload.fieldId as string | undefined;
      const partial = (last.payload.partial as string) || "";
      if (!fieldId) return;
      setFieldAnswers((prev) => {
        const entry = prev.get(fieldId);
        if (!entry) return prev;
        const next = new Map(prev);
        next.set(fieldId, { ...entry, streamingText: partial });
        return next;
      });
    }

    if (last.type === "answer:draft") {
      const payload = last.payload as unknown as {
        fieldId?: string; question: string; draft: string; error?: string | null;
        questionType: string; company: string; role: string; confidence: number;
        profileUsed: string[]; memoryCount: number;
      };
      const fieldId = payload.fieldId;
      if (!fieldId) return;
      clearFieldTimeout(fieldId);

      setFieldAnswers((prev) => {
        const entry = prev.get(fieldId);
        const next = new Map(prev);
        if (payload.error) {
          next.set(fieldId, {
            fieldId,
            question: payload.question,
            selector: entry?.selector || "",
            company: payload.company || "",
            role: payload.role || "",
            questionType: payload.questionType || "general",
            confidence: 0,
            profileUsed: [],
            memoryCount: 0,
            draft: "",
            streamingText: "",
            status: "error",
            error: payload.error,
            source: "generated",
            updatedAt: Date.now(),
          });
          return next;
        }
        next.set(fieldId, {
          fieldId,
          question: payload.question,
          selector: entry?.selector || "",
          company: payload.company || "",
          role: payload.role || "",
          questionType: payload.questionType || "general",
          confidence: payload.confidence,
          profileUsed: payload.profileUsed || [],
          memoryCount: payload.memoryCount || 0,
          draft: payload.draft,
          streamingText: "",
          status: "ready",
          source: "generated",
          updatedAt: Date.now(),
        });
        return next;
      });
    }

    if (last.type === "fill:executed") {
      const payload = last.payload as { fieldId?: string; success: boolean; reason?: string };
      const fieldId = payload.fieldId;
      if (!fieldId) return;
      setFieldAnswers((prev) => {
        const entry = prev.get(fieldId);
        if (!entry) return prev;
        const next = new Map(prev);
        next.set(fieldId, payload.success
          ? { ...entry, status: "filled", updatedAt: Date.now() }
          : { ...entry, status: "fill_failed", fillFailReason: payload.reason, updatedAt: Date.now() });
        return next;
      });
    }
  }, [messages, clearFieldTimeout]);

  const handleGenerate = useCallback(
    (field: FieldClassification) => {
      setFieldAnswers((prev) => {
        const next = new Map(prev);
        next.set(field.fieldId, {
          fieldId: field.fieldId,
          question: field.label,
          selector: field.selector || "",
          company: "",
          role: "",
          questionType: field.questionType || "general",
          confidence: 0,
          profileUsed: [],
          memoryCount: 0,
          draft: "",
          streamingText: "",
          status: "generating",
          source: "generated",
          updatedAt: Date.now(),
        });
        return next;
      });
      armGenerationTimeout(field.fieldId);
      send({
        type: "answer:generate",
        payload: {
          fieldId: field.fieldId,
          question: field.label,
          questionType: field.questionType || "general",
        },
      });
    },
    [send, armGenerationTimeout]
  );

  const handleRegenerate = useCallback(
    (fieldId: string, question: string) => {
      setFieldAnswers((prev) => {
        const entry = prev.get(fieldId);
        if (!entry) return prev;
        const next = new Map(prev);
        next.set(fieldId, { ...entry, status: "generating", streamingText: "", updatedAt: Date.now() });
        return next;
      });
      armGenerationTimeout(fieldId);
      send({ type: "answer:generate", payload: { fieldId, question } });
    },
    [send, armGenerationTimeout]
  );

  const handleAccept = useCallback(
    (fieldId: string, finalText: string, wasEdited: boolean) => {
      const entry = fieldAnswers.get(fieldId);
      if (!entry) return;
      const requestId = newRequestId();

      setFieldAnswers((prev) => {
        const next = new Map(prev);
        const current = prev.get(fieldId);
        if (!current) return prev;
        next.set(fieldId, { ...current, status: "filling", draft: finalText, updatedAt: Date.now() });
        return next;
      });

      send({
        type: "fill:preview",
        payload: { value: finalText, question: entry.question, label: entry.question, selector: entry.selector, fieldId },
      });
      setTimeout(() => {
        send({
          type: "fill:approve",
          payload: {
            requestId,
            value: finalText,
            question: entry.question,
            selector: entry.selector,
            fieldId,
            company: entry.company,
            role: entry.role,
            ...(wasEdited ? { original: entry.draft } : {}),
          },
        });
      }, 300);
    },
    [fieldAnswers, send]
  );

  const handleSkip = useCallback(
    (fieldId: string) => {
      clearFieldTimeout(fieldId);
      setFieldAnswers((prev) => {
        const entry = prev.get(fieldId);
        if (!entry) return prev;
        const next = new Map(prev);
        next.set(fieldId, { ...entry, status: "skipped", updatedAt: Date.now() });
        return next;
      });
      send({ type: "fill:reject", payload: { fieldId } });
    },
    [send, clearFieldTimeout]
  );

  const handleFillManually = useCallback(
    (fieldId: string) => {
      const entry = fieldAnswers.get(fieldId);
      if (entry) {
        send({ type: "fill:preview", payload: { selector: entry.selector, label: entry.question, fieldId } });
      }
      handleSkip(fieldId);
    },
    [fieldAnswers, send, handleSkip]
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
              onClick={() => setShowMemoryManager(true)}
              className="w-5 h-5 flex items-center justify-center rounded-md hover:bg-white/[0.06] text-gray-500 hover:text-gray-300 transition-colors"
              title="Manage learned answers"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </button>
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
            <StatusBadge status={connectionStatus} />
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
              {longAnswerFields.map((f, i) => {
                const isGenerating = fieldAnswers.get(f.fieldId)?.status === "generating";
                return (
                  <motion.button
                    key={f.fieldId}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    onClick={() => handleGenerate(f)}
                    disabled={isGenerating}
                    className="w-full text-left px-2.5 py-2 rounded-lg bg-surface/40 border border-white/[0.03] hover:border-accent/20 hover:bg-accent/5 transition-all disabled:opacity-40 disabled:cursor-wait group"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-md bg-accent/10 flex items-center justify-center shrink-0 group-hover:bg-accent/20 transition-colors">
                        {isGenerating ? (
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
                );
              })}
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

        <Section title="Answers" icon="file-text" badge={answerList.length || undefined}>
          <AnimatePresence>
            {answerList.length > 0 ? (
              <AnswerCards
                answers={answerList}
                onAccept={handleAccept}
                onSkip={handleSkip}
                onFillManually={handleFillManually}
                onRegenerate={handleRegenerate}
              />
            ) : (
              <div className="flex items-center gap-2 py-3 text-gray-600">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <span className="text-[11px]">
                  Click a question above to generate — using {provider.provider === "ollama" ? "local model" : provider.provider}
                </span>
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
              <div
                className={`w-1 h-1 rounded-full ${
                  connectionStatus === "connected"
                    ? "bg-emerald-400/60"
                    : connectionStatus === "reconnecting"
                    ? "bg-amber-400/60"
                    : "bg-red-500/70"
                }`}
              />
              <span className="text-[9px] text-gray-600">
                {connectionStatus === "connected"
                  ? "Connected"
                  : connectionStatus === "reconnecting"
                  ? "Reconnecting"
                  : "Offline"}
              </span>
            </div>
          </div>
        </div>
      </footer>

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
      {showMemoryManager && <MemoryManager onClose={() => setShowMemoryManager(false)} />}
    </motion.div>
  );
}
