import { motion } from "framer-motion";

interface StatusBadgeProps {
  connected: boolean;
}

export default function StatusBadge({ connected }: StatusBadgeProps) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full glass">
      <motion.div
        animate={{
          scale: connected ? [1, 1.3, 1] : 1,
          opacity: connected ? [1, 0.6, 1] : 0.5,
        }}
        transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
        className={`w-1.5 h-1.5 rounded-full ${
          connected ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]" : "bg-gray-500"
        }`}
      />
      <span className={`text-[9px] font-semibold tracking-wider uppercase ${
        connected ? "text-emerald-400" : "text-gray-500"
      }`}>
        {connected ? "Live" : "Offline"}
      </span>
    </div>
  );
}
