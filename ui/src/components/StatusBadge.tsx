import { motion } from "framer-motion";
import type { ConnectionStatus } from "../hooks/useWebSocket";

interface StatusBadgeProps {
  status: ConnectionStatus;
}

const STATUS_CONFIG = {
  connected: {
    label: "Live",
    dot: "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]",
    text: "text-emerald-400",
    animate: true,
  },
  reconnecting: {
    label: "Reconnecting",
    dot: "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]",
    text: "text-amber-400",
    animate: true,
  },
  offline: {
    label: "Offline",
    dot: "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]",
    text: "text-red-400",
    animate: false,
  },
} as const;

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full glass">
      <motion.div
        animate={config.animate ? { scale: [1, 1.3, 1], opacity: [1, 0.6, 1] } : { opacity: 0.7 }}
        transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
        className={`w-1.5 h-1.5 rounded-full ${config.dot}`}
      />
      <span className={`text-[9px] font-semibold tracking-wider uppercase ${config.text}`}>
        {config.label}
      </span>
    </div>
  );
}
