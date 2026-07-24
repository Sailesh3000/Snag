import { motion } from "framer-motion";

export interface FieldClassification {
  fieldId: string;
  selector: string;
  category: string;
  confidence: number;
  subcategory: string | null;
  questionType: string | null;
  label: string;
}

interface FieldListProps {
  fields: FieldClassification[];
}

const CATEGORY_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  static:     { bg: "bg-emerald-500/10",  text: "text-emerald-400",  dot: "bg-emerald-400" },
  file_upload:{ bg: "bg-blue-500/10",     text: "text-blue-400",     dot: "bg-blue-400" },
  select:     { bg: "bg-amber-500/10",    text: "text-amber-400",    dot: "bg-amber-400" },
  checkbox:   { bg: "bg-violet-500/10",   text: "text-violet-400",   dot: "bg-violet-400" },
  long_answer:{ bg: "bg-rose-500/10",     text: "text-rose-400",     dot: "bg-rose-400" },
  unknown:    { bg: "bg-gray-500/10",     text: "text-gray-400",     dot: "bg-gray-400" },
};

const CATEGORY_LABELS: Record<string, string> = {
  static: "Auto",
  file_upload: "File",
  select: "Select",
  checkbox: "Check",
  long_answer: "Answer",
  unknown: "?",
};

export default function FieldList({ fields }: FieldListProps) {
  if (!fields || fields.length === 0) {
    return (
      <div className="flex items-center gap-2 py-3 text-gray-500">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span className="text-[11px]">No fields detected</span>
      </div>
    );
  }

  const grouped = fields.reduce<Record<string, FieldClassification[]>>((acc, f) => {
    (acc[f.category] = acc[f.category] || []).push(f);
    return acc;
  }, {});

  return (
    <div className="space-y-2">
      {Object.entries(grouped).map(([category, items]) => {
        const style = CATEGORY_STYLES[category] || CATEGORY_STYLES.unknown;
        return (
          <div key={category}>
            <div className="flex items-center gap-1.5 mb-1">
              <div className={`w-1 h-1 rounded-full ${style.dot}`} />
              <span className={`text-[9px] font-bold uppercase tracking-wider ${style.text}`}>
                {CATEGORY_LABELS[category] || category} ({items.length})
              </span>
            </div>
            <div className="space-y-0.5">
              {items.map((f, i) => (
                <motion.div
                  key={f.fieldId}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.02, duration: 0.15 }}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.02] transition-colors group"
                >
                  <span className="flex-1 text-[11px] text-gray-300 truncate group-hover:text-gray-100 transition-colors" title={f.label}>
                    {f.label}
                  </span>
                  <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                    <div className={`w-1 h-1 rounded-full ${style.dot}`} />
                    <span className="text-[9px] text-gray-500 font-mono">
                      {Math.round(f.confidence * 100)}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
