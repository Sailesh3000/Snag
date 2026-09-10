import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { isInIframe, postToBackground } from "../lib/channel";

interface MemoryAnswer {
  id: string;
  question: string;
  answer: string;
  company: string;
  role: string;
  createdAt: number;
}

interface MemoryManagerProps {
  onClose: () => void;
}

// Minimal "if Snag learned something incorrectly, fix it" screen — not a
// full memory browser/analytics product. List, edit, delete. That's it.
// Message-based: learned answers live in the extension's local IndexedDB and
// the background is the only thing that reads/writes it (plan B3).
export default function MemoryManager({ onClose }: MemoryManagerProps) {
  const [answers, setAnswers] = useState<MemoryAnswer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    postToBackground({ type: "memory:answers" });
  }, []);

  useEffect(() => {
    if (!isInIframe) {
      setLoading(false);
      return;
    }
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isInIframe) return;
    function onMessage(event: MessageEvent) {
      if (event.data?.source !== "snag" || !event.data?.msg) return;
      const msg = event.data.msg as { type: string; payload?: Record<string, unknown> };
      if (msg.type === "memory:answers:response") {
        setAnswers((msg.payload?.answers as MemoryAnswer[]) || []);
        setLoading(false);
      } else if (msg.type === "memory:updated") {
        if (!msg.payload?.ok) setError("Couldn't save the edit.");
        setEditingId(null);
      } else if (msg.type === "memory:deleted") {
        if (msg.payload?.ok) {
          setAnswers((prev) => prev.filter((a) => a.id !== msg.payload?.id));
        } else {
          setError("Couldn't delete the entry.");
        }
        setDeletingId(null);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const handleSaveEdit = useCallback(
    (id: string) => {
      postToBackground({ type: "memory:update", payload: { id, answer: editValue } });
      setAnswers((prev) => prev.map((a) => (a.id === id ? { ...a, answer: editValue } : a)));
    },
    [editValue],
  );

  const handleDelete = useCallback((id: string) => {
    postToBackground({ type: "memory:delete", payload: { id } });
  }, []);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
          className="w-[360px] max-h-[80vh] bg-[#111118] border border-white/[0.06] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        >
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-accent/15 flex items-center justify-center">
                <svg className="w-3 h-3 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <span className="text-[13px] font-semibold text-white">Learned Answers</span>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors p-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-3 overflow-y-auto flex-1 space-y-2">
            {loading ? (
              <div className="flex items-center gap-2 py-4 text-gray-500">
                <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                <span className="text-[11px]">Loading...</span>
              </div>
            ) : error ? (
              <p className="text-[11px] text-red-400 py-2">{error}</p>
            ) : answers.length === 0 ? (
              <p className="text-[11px] text-gray-500 py-4 text-center">
                No approved answers yet — accept a generated answer on an application to start building memory.
              </p>
            ) : (
              answers.map((a) => (
                <div key={a.id} className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-2.5">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    {a.company && (
                      <span className="px-1.5 py-0.5 text-[8px] font-bold bg-accent/10 text-accent rounded">{a.company}</span>
                    )}
                    {a.role && <span className="text-[9px] text-gray-500 truncate">{a.role}</span>}
                  </div>
                  <p className="text-[10px] text-gray-500 mb-1.5">{a.question}</p>

                  {editingId === a.id ? (
                    <>
                      <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        rows={4}
                        className="w-full text-[11px] bg-surface/60 rounded-lg border border-accent/30 p-2 text-gray-200 resize-none outline-none"
                        autoFocus
                      />
                      <div className="flex gap-1.5 mt-1.5">
                        <button
                          onClick={() => handleSaveEdit(a.id)}
                          className="flex-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="flex-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-gray-500/10 text-gray-400 hover:bg-gray-500/20"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : deletingId === a.id ? (
                    <>
                      <p className="text-[10px] text-red-400 mb-1.5">Delete this learned answer?</p>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleDelete(a.id)}
                          className="flex-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setDeletingId(null)}
                          className="flex-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-gray-500/10 text-gray-400 hover:bg-gray-500/20"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-[11px] text-gray-300 leading-relaxed whitespace-pre-wrap mb-1.5">{a.answer}</p>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => { setEditingId(a.id); setEditValue(a.answer); }}
                          className="flex-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeletingId(a.id)}
                          className="flex-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20"
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
