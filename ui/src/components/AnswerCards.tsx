import { useState, useCallback } from "react";
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
}

export default function AnswerCards({ answers, send, fieldMap }: AnswerCardsProps) {
  if (!answers || answers.length === 0) return null;

  return (
    <div className="space-y-2">
      <AnimatePresence>
        {answers.map((a, i) => (
          <AnswerCard key={`${a.question}-${i}`} answer={a} send={send} index={i} fieldMap={fieldMap} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function AnswerCard({
  answer,
  send,
  index,
  fieldMap,
}: {
  answer: AnswerDraft;
  send: (msg: object) => void;
  index: number;
  fieldMap?: Map<string, { selector: string; fieldId: string }>;
}) {
  const [draft, setDraft] = useState(answer.draft);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"draft" | "approved" | "rejected">("draft");

  const handleApprove = useCallback(() => {
    setStatus("approved");
    const fieldInfo = fieldMap?.get(answer.question);
    const selector = fieldInfo?.selector || "";
    const fieldId = fieldInfo?.fieldId || answer.question;
    send({ type: "fill:preview", payload: { value: draft, question: answer.question, label: answer.question, selector, fieldId } });
    setTimeout(() => {
      send({ type: "fill:approve", payload: { value: draft, question: answer.question, selector, fieldId } });
    }, 300);
  }, [draft, answer.question, send, fieldMap]);

  const handleReject = useCallback(() => {
    setStatus("rejected");
    send({ type: "fill:reject", payload: {} });
  }, [send]);

  const handleSaveEdit = useCallback(() => {
    setEditing(false);
    send({ type: "answer:edit", payload: { question: answer.question, edited: draft, original: answer.draft } });
  }, [draft, answer.question, answer.draft, send]);

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
      transition={{ delay: index * 0.05, duration: 0.25 }}
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

      {editing ? (
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
              Save
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
              Fill
            </button>
            <button
              onClick={() => setEditing(true)}
              className="flex-1 flex items-center justify-center gap-1 text-[10px] font-semibold px-2 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </button>
            <button
              onClick={handleReject}
              className="flex items-center justify-center gap-1 text-[10px] font-semibold px-2 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
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
    </motion.div>
  );
}
