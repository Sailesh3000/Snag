import { motion } from "framer-motion";
import type { UseAuthReturn } from "../hooks/useAuth";

// Blocking sign-in screen: rendered INSTEAD of the field-fill UI until the
// user is signed in. Free product, no billing — signing in is the only
// gate. The header and footer (with the status badge) stay visible around it.

function GateCard({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="glass rounded-2xl p-4 gradient-border space-y-3"
    >
      {children}
    </motion.div>
  );
}

export default function SignInGate({ auth }: { auth: UseAuthReturn }) {
  const { ready, error, signIn } = auth;

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3">
      {!ready ? (
        <div className="flex items-center gap-2 py-6 justify-center text-gray-500">
          <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          <span className="text-[11px]">Loading...</span>
        </div>
      ) : (
        <GateCard>
          <div className="space-y-1.5">
            <h2 className="text-[13px] font-bold text-white">Sign in to Snag</h2>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              One account for your profile and your past answers. Snag is free — your data stays
              on this device.
            </p>
          </div>

          {error && (
            <div className="px-2.5 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-[10px] text-red-400">{error}</p>
            </div>
          )}

          <button
            onClick={signIn}
            className="w-full flex items-center justify-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-lg bg-accent text-white hover:opacity-90 transition-all shadow-glow"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v12" transform="scale(0.85)" />
            </svg>
            Sign in
          </button>
        </GateCard>
      )}
    </div>
  );
}
