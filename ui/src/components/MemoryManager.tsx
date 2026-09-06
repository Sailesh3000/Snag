import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

const DEFAULT_API_BASE = "http://127.0.0.1:8765/api";

interface MemoryAnswer {
  id: number;
  question: string;
  final_answer: string;
  company: string | null;
  role: string | null;
  created_at: string;
}

interface MemoryManagerProps {
  onClose: () => void;
}

// Minimal "if Snag learned something incorrectly, fix it" screen — not a
// full memory browser/analytics product. List, edit, delete. That's it.
export default function MemoryManager({ onClose }: MemoryManagerProps) {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [authHeaders, setAuthHeaders] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<MemoryAnswer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get("settings", (data: Record<string, unknown>) => {
        const s = data?.settings as Record<string, string> | undefined;
        setApiBase(s?.backendUrl
          ? s.backendUrl.replace(/^ws/, "http").replace(/\/$/, "") + "/api"
          : DEFAULT_API_BASE);
        setAuthHeaders(s?.authToken ? { Authorization: `Bearer ${s.authToken}` } : {});
      });
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/memory/answers`, { headers: authHeaders });
      if (!res.ok) throw new Error(`${res.status}`);
      setAnswers(await res.json());
    } catch {
      setError("Couldn't load memory — is the backend running?");
    } finally {
      setLoading(false);
    }
  }, [apiBase, authHeaders]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSaveEdit = useCallback(async (id: number) => {
    try {
      const res = await fetch(`${apiBase}/memory/answers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ final_answer: editValue }),
      });
      if (!res.ok) throw new Error();
      setAnswers((prev) => prev.map((a) => (a.id === id ? { ...a, final_answer: editValue } : a)));
      setEditingId(null);
    } catch {
      setError("Couldn't save the edit.");
    }
  }, [apiBase, authHeaders, editValue]);

  const handleDelete = useCallback(async (id: number) => {
    try {
      const res = await fetch(`${apiBase}/memory/answers/${id}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error();
      setAnswers((prev) => prev.filter((a) => a.id !== id));
      setDeletingId(null);
    } catch {
      setError("Couldn't delete the entry.");
    }
  }, [apiBase, authHeaders]);

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
                      <p className="text-[11px] text-gray-300 leading-relaxed whitespace-pre-wrap mb-1.5">{a.final_answer}</p>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => { setEditingId(a.id); setEditValue(a.final_answer); }}
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
