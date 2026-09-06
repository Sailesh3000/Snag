import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface AnswerDraft {
  question: string;
  draft: string;
  error?: string | null;
  questionType: string;
  company: string;
  role: string;
  confidence: number;
  profileUsed: string[];
  memoryCount: number;
}

interface AnswerCardsProps {
  answers: AnswerDraft[];
  send: (msg: object) => void;
  fieldMap?: Map<string, { selector: string; fieldId: string }>;
  onRegenerate?: (question: string) => void;
  regeneratingQuestion?: string | null;
}

export default function AnswerCards({ answers, send, fieldMap, onRegenerate, regeneratingQuestion }: AnswerCardsProps) {
  if (!answers || answers.length === 0) return null;

  return (
    <div className="space-y-2">
      <AnimatePresence>
        {answers.map((a) => (
          <AnswerCard
            key={a.question}
            answer={a}
            send={send}
            fieldMap={fieldMap}
            onRegenerate={onRegenerate}
            regenerating={regeneratingQuestion === a.question}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

function AnswerCard({
  answer,
  send,
  fieldMap,
  onRegenerate,
  regenerating,
}: {
  answer: AnswerDraft;
  send: (msg: object) => void;
  fieldMap?: Map<string, { selector: string; fieldId: string }>;
  onRegenerate?: (question: string) => void;
  regenerating?: boolean;
}) {
  const [draft, setDraft] = useState(answer.draft);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"draft" | "approved" | "rejected">("draft");

  // A regenerate produces a new draft for the same question (same card, same
  // key) — reset local edit/approve state whenever the underlying draft text
  // actually changes, rather than only on first mount.
  useEffect(() => {
    setDraft(answer.draft);
    setStatus("draft");
    setEditing(false);
  }, [answer.draft]);

  const acceptAnswer = useCallback((finalText: string, wasEdited: boolean) => {
    setStatus("approved");
    const fieldInfo = fieldMap?.get(answer.question);
    const selector = fieldInfo?.selector || "";
    const fieldId = fieldInfo?.fieldId || answer.question;
    send({ type: "fill:preview", payload: { value: finalText, question: answer.question, label: answer.question, selector, fieldId } });
    setTimeout(() => {
      send({
        type: "fill:approve",
        payload: {
          value: finalText,
          question: answer.question,
          selector,
          fieldId,
          company: answer.company,
          role: answer.role,
          ...(wasEdited ? { original: answer.draft } : {}),
        },
      });
    }, 300);
  }, [answer.question, answer.draft, answer.company, answer.role, send, fieldMap]);

  const handleApprove = useCallback(() => {
    acceptAnswer(draft, false);
  }, [draft, acceptAnswer]);

  const handleReject = useCallback(() => {
    setStatus("rejected");
    send({ type: "fill:reject", payload: {} });
  }, [send]);

  const handleSaveEdit = useCallback(() => {
    acceptAnswer(draft, draft !== answer.draft);
  }, [draft, answer.draft, acceptAnswer]);

  const handleRegenerate = useCallback(() => {
    onRegenerate?.(answer.question);
  }, [answer.question, onRegenerate]);

  if (status === "approved") {
    return (
      <motion.div
        initial={{ opacity: 1, scale: 1 }}
        animate={{ opacity: 0, scale: 0.95, height: 0 }}
        transition={{ duration: 0.3 }}
        className="overflow-hidden"
      >
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-[11px] text-emerald-400 font-medium">Filled & Saved</span>
        </div>
      </motion.div>
    );
  }

  if (status === "rejected") return null;

  const confidenceColor =
    answer.confidence >= 0.8 ? "text-emerald-400" : answer.confidence >= 0.6 ? "text-amber-400" : "text-rose-400";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4, height: 0 }}
      transition={{ duration: 0.25 }}
      className="glass rounded-xl p-3 gradient-border"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider bg-accent/10 text-accent rounded">
            {answer.questionType || "general"}
          </span>
          {answer.company && (
            <span className="text-[9px] text-gray-500 truncate max-w-[100px]">{answer.company}</span>
          )}
        </div>
        <span className={`text-[10px] font-bold font-mono ${confidenceColor}`}>
          {Math.round(answer.confidence * 100)}%
        </span>
      </div>

      <p className="text-[10px] text-gray-500 mb-2 leading-relaxed">{answer.question}</p>

      {regenerating ? (
        <div className="flex items-center gap-2 py-3 justify-center">
          <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          <span className="text-[10px] text-gray-500">Regenerating...</span>
        </div>
      ) : editing ? (
        <textarea
          className="w-full text-[11px] bg-surface/60 rounded-lg border border-surface-border p-2.5 text-gray-200 resize-none focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all font-mono leading-relaxed"
          rows={5}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
      ) : (
        <div className="bg-surface/40 rounded-lg p-2.5 border border-white/[0.02]">
          <p className="text-[11px] text-gray-300 leading-relaxed whitespace-pre-wrap">
            {draft}
          </p>
        </div>
      )}

      {!regenerating && (
        <div className="flex items-center gap-1.5 mt-2.5">
          {editing ? (
            <>
              <button
                onClick={handleSaveEdit}
                className="flex-1 flex items-center justify-center gap-1 text-[10px] font-semibold px-2 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-all"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Accept
              </button>
              <button
                onClick={() => { setEditing(false); setDraft(answer.draft); }}
                className="flex-1 flex items-center justify-center gap-1 text-[10px] font-semibold px-2 py-1.5 rounded-lg bg-gray-500/10 text-gray-400 hover:bg-gray-500/20 transition-all"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleApprove}
                className="flex-1 flex items-center justify-center gap-1 text-[10px] font-semibold px-2 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 hover:shadow-[0_0_12px_rgba(52,211,153,0.15)] transition-all"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Accept
              </button>
              <button
                onClick={() => setEditing(true)}
                className="flex items-center justify-center gap-1 text-[10px] font-semibold px-2 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all"
                title="Edit"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                onClick={handleRegenerate}
                disabled={!onRegenerate}
                className="flex items-center justify-center gap-1 text-[10px] font-semibold px-2 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-all disabled:opacity-30"
                title="Regenerate"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                onClick={handleReject}
                className="flex items-center justify-center gap-1 text-[10px] font-semibold px-2 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                title="Skip"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </>
          )}

          {answer.memoryCount > 0 && (
            <span className="ml-auto text-[9px] text-gray-600 font-mono">
              {answer.memoryCount} memory
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}
