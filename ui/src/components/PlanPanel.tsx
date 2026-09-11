import { motion } from "framer-motion";
import { PADDLE_PORTAL_URL } from "../lib/pricing";
import type { SubscriptionInfo } from "../hooks/useAuth";

interface PlanPanelProps {
  subscription: SubscriptionInfo;
  onSignOut: () => void;
  onClose: () => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// Shown from the "Pro · active" header pill: renewal date + the Paddle
// customer-portal link for managing the subscription (plan B4).
export default function PlanPanel({ subscription, onSignOut, onClose }: PlanPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="glass rounded-xl p-3 space-y-2"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2l2.4 7.2H22l-6 4.6 2.3 7.2-6.3-4.5-6.3 4.5L8 13.8 2 9.2h7.6z" />
          </svg>
          <span className="text-[11px] font-bold text-white">Snag Pro</span>
          <span className="px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 rounded">
            {subscription.status}
          </span>
        </div>
        <button
          onClick={onClose}
          className="w-4 h-4 flex items-center justify-center rounded-md hover:bg-white/[0.06] text-gray-500 hover:text-gray-300 transition-colors"
          title="Close"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface/50 border border-white/[0.03]">
        <span className="text-[9px] text-gray-500 font-medium">Renews</span>
        <span className="text-[10px] text-gray-300 font-mono">{formatDate(subscription.currentPeriodEnd)}</span>
      </div>
      <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface/50 border border-white/[0.03]">
        <span className="text-[9px] text-gray-500 font-medium">Price</span>
        <span className="text-[10px] text-gray-300 font-mono">$5/month</span>
      </div>

      <a
        href={PADDLE_PORTAL_URL}
        target="_blank"
        rel="noreferrer"
        className="w-full flex items-center justify-center gap-1 text-[10px] font-semibold px-2 py-1.5 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 transition-all"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573-1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543-.94-3.31.826-2.37 2.37a1.724 1.724 0 00-1.066 2.573c-1.756.426-1.756 2.924 0 3.35a1.724 1.724 0 002.573 1.066c.94 1.543-.826 3.31-2.37 2.37-.996-.608-2.296.07-2.572 1.065z" />
        </svg>
        Manage subscription
      </a>

      <button
        onClick={onSignOut}
        className="w-full text-[9px] font-semibold px-2 py-1 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/[0.04] transition-all"
      >
        Sign out
      </button>
    </motion.div>
  );
}
