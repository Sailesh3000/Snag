import { motion } from "framer-motion";

// Connection-semantic badge replaced by auth/subscription semantics (plan B3):
// the "channel" is the extension itself, so the badge now tells the user
// whether they're signed in and whether a subscription is active.
export type AuthBadgeStatus = "active" | "inactive" | "signedOut" | "checking";

interface StatusBadgeProps {
  status: AuthBadgeStatus;
}

const STATUS_CONFIG = {
  active: {
    label: "Pro",
    dot: "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]",
    text: "text-emerald-400",
    animate: false,
  },
  inactive: {
    label: "No plan",
    dot: "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]",
    text: "text-amber-400",
    animate: false,
  },
  signedOut: {
    label: "Sign in",
    dot: "bg-gray-500",
    text: "text-gray-500",
    animate: false,
  },
  checking: {
    label: "…",
    dot: "bg-gray-500",
    text: "text-gray-500",
    animate: true,
  },
} as const;

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full glass">
      <motion.div
        animate={config.animate ? { scale: [1, 1.3, 1], opacity: [1, 0.6, 1] } : { opacity: 1 }}
        transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
        className={`w-1.5 h-1.5 rounded-full ${config.dot}`}
      />
      <span className={`text-[9px] font-semibold tracking-wider uppercase ${config.text}`}>
        {config.label}
      </span>
    </div>
  );
}
