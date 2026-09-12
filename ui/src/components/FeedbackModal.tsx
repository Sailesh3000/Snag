import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

// Feedback delivery: the pilot's backend used to email the team's SMTP inbox
// server-side. The published build has no such endpoint, so feedback is
// composed as a pre-filled email in the user's own mail client.
const FEEDBACK_EMAIL = "chandrasailesh30@gmail.com";
const EXTENSION_VERSION = "0.4.0";

interface FeedbackModalProps {
  onClose: () => void;
}

const FEEDBACK_TYPES = [
  { value: "general", label: "General Feedback" },
  { value: "bug", label: "Bug Report" },
  { value: "feature", label: "Feature Request" },
  { value: "ux", label: "UX Improvement" },
];

export default function FeedbackModal({ onClose }: FeedbackModalProps) {
  const [type, setType] = useState<string>("general");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(() => {
    if (!message.trim()) return;
    setError(null);
    const typeLabel = FEEDBACK_TYPES.find((ft) => ft.value === type)?.label ?? type;
    const body = [
      `Type: ${typeLabel}`,
      `Extension version: ${EXTENSION_VERSION}`,
      email.trim() ? `Reply-to: ${email.trim()}` : "",
      "",
      message.trim(),
    ]
      .filter(Boolean)
      .join("\n");
    const subject = `[Snag] ${typeLabel}`;
    try {
      window.location.href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      setSubmitted(true);
    } catch {
      setError("Couldn't open your email client. Send this instead: " + FEEDBACK_EMAIL);
    }
  }, [type, message, email]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
          className="w-[340px] bg-[#111118] border border-white/[0.06] rounded-2xl shadow-2xl overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-accent/15 flex items-center justify-center">
                <svg className="w-3 h-3 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
              </div>
              <span className="text-[13px] font-semibold text-white">Send Feedback</span>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors p-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-4 space-y-3">
            {submitted ? (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="py-6 text-center"
              >
                <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-[13px] text-white font-medium">Your email app should open now</p>
                <p className="text-[11px] text-gray-500 mt-1">Send it when ready — it helps us improve Snag.</p>
                <button onClick={onClose} className="mt-4 px-4 py-1.5 bg-accent/20 rounded-lg text-accent text-[11px] font-semibold hover:bg-accent/30 transition-colors">
                  Close
                </button>
              </motion.div>
            ) : (
              <>
                <div>
                  <label className="text-[11px] text-gray-400 font-medium mb-1 block">Type</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {FEEDBACK_TYPES.map((ft) => (
                      <button
                        key={ft.value}
                        onClick={() => setType(ft.value)}
                        className={`px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-all ${
                          type === ft.value
                            ? "bg-accent/20 text-accent border border-accent/30"
                            : "bg-white/[0.03] text-gray-500 border border-transparent hover:bg-white/[0.06]"
                        }`}
                      >
                        {ft.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-gray-400 font-medium mb-1 block">Message *</label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Tell us what you think..."
                    rows={4}
                    className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-[11px] text-gray-200 outline-none focus:border-accent/30 resize-none placeholder:text-gray-600"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-gray-400 font-medium mb-1 block">Email (optional)</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="For follow-up"
                    className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-1.5 text-[11px] text-gray-200 outline-none focus:border-accent/30 placeholder:text-gray-600"
                  />
                </div>

                {error && (
                  <div className="px-2.5 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                    <p className="text-[10px] text-red-400">{error}</p>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={onClose}
                    className="px-3 py-1.5 rounded-lg text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!message.trim()}
                    className="px-4 py-1.5 bg-accent/20 rounded-lg text-accent text-[11px] font-semibold hover:bg-accent/30 transition-colors disabled:opacity-40"
                  >
                    Compose email
                  </button>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
