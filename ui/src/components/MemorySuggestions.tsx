import { motion } from "framer-motion";

interface MemoryMatch {
  id: string;
  score: number;
  payload: {
    question: string;
    answer: string;
    company: string;
    role: string;
  };
}

interface Suggestion {
  fieldLabel: string;
  matches: MemoryMatch[];
}

interface MemorySuggestionsProps {
  suggestions: Suggestion[];
}

function truncate(text: string, len: number): string {
  if (text.length <= len) return text;
  return text.slice(0, len) + "...";
}

export default function MemorySuggestions({ suggestions }: MemorySuggestionsProps) {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="space-y-2">
      {suggestions.map((s, i) => (
        <motion.div
          key={s.fieldLabel}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          className="glass rounded-lg p-2.5"
        >
          <div className="flex items-center gap-1.5 mb-2">
            <svg className="w-3 h-3 text-accent/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-[10px] text-gray-400 truncate flex-1">
              {truncate(s.fieldLabel, 40)}
            </p>
          </div>
          {s.matches.map((m, j) => (
            <div
              key={m.id}
              className="ml-1 pl-2 border-l border-accent/20 mb-1.5 last:mb-0"
            >
              <p className="text-[11px] text-gray-300 leading-relaxed line-clamp-2">
                {truncate(m.payload.answer, 120)}
              </p>
              <div className="flex items-center gap-1.5 mt-1">
                {m.payload.company && (
                  <span className="px-1 py-0.5 text-[8px] font-medium bg-surface-border/50 text-gray-500 rounded">
                    {m.payload.company}
                  </span>
                )}
                <span className={`text-[9px] font-mono ${
                  m.score >= 0.5 ? "text-emerald-400" : m.score >= 0.3 ? "text-amber-400" : "text-gray-500"
                }`}>
                  {(m.score * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
        </motion.div>
      ))}
    </div>
  );
}
