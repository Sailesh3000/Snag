import { motion } from "framer-motion";
import type { UseAuthReturn } from "../hooks/useAuth";

// Blocking sign-in / subscription screens (plan B4): rendered INSTEAD of the
// field-fill UI until the user is signed in with an active subscription.
// The header and footer (with the status badge) stay visible around it.

const BENEFITS = [
  "Use your own AI provider key to draft answers",
  "Static fields auto-filled instantly",
  "Smarter matching against your remembered answers",
];

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

function BenefitRow({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <svg className="w-3 h-3 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      <span className="text-[10px] text-gray-400">{text}</span>
    </div>
  );
}

export default function SubscriptionGate({ auth }: { auth: UseAuthReturn }) {
  const { ready, signedIn, subscription, error, signIn, signOut, checkout, refresh } = auth;

  // Signed in but the subscription status hasn't come back yet (first
  // /api/me call in flight, or it failed) — don't block on a spinner, offer
  // a retry instead of guessing.
  const checking = ready && signedIn && !subscription;

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3">
      {!ready ? (
        <div className="flex items-center gap-2 py-6 justify-center text-gray-500">
          <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          <span className="text-[11px]">Loading...</span>
        </div>
      ) : !signedIn ? (
        <GateCard>
          <div className="space-y-1.5">
            <h2 className="text-[13px] font-bold text-white">Sign in to Snag</h2>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              One account for your profile, your past answers, and your subscription. Your data stays on this
              device.
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
      ) : checking ? (
        <GateCard>
          <div className="flex items-center gap-2 py-2">
            <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            <span className="text-[11px] text-gray-400">Checking your subscription...</span>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={refresh}
              className="flex-1 text-[10px] font-semibold px-2 py-1.5 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 transition-all"
            >
              Check again
            </button>
            <button
              onClick={signOut}
              className="flex-1 text-[10px] font-semibold px-2 py-1.5 rounded-lg bg-gray-500/10 text-gray-400 hover:bg-gray-500/20 transition-all"
            >
              Sign out
            </button>
          </div>
        </GateCard>
      ) : (
        <GateCard>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <svg className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l2.4 7.2H22l-6 4.6 2.3 7.2-6.3-4.5-6.3 4.5L8 13.8 2 9.2h7.6z" />
              </svg>
              <h2 className="text-[13px] font-bold text-white">Snag Pro — $5/month</h2>
            </div>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Signed in as <span className="text-gray-300 font-mono">{auth.session?.email}</span>. Subscribe to
              unlock Snag — bring your own AI provider key (or a local Ollama model) to generate answers.
            </p>
          </div>

          <div className="space-y-0.5 py-1">
            {BENEFITS.map((b) => (
              <BenefitRow key={b} text={b} />
            ))}
          </div>

          <button
            onClick={checkout}
            className="w-full flex items-center justify-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-lg bg-accent text-white hover:opacity-90 transition-all shadow-glow"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            Subscribe for $5/month
          </button>
          <p className="text-[9px] text-gray-600 text-center leading-relaxed">
            Opens Paddle checkout in a new tab. Your subscription status updates automatically once payment
            confirms — no need to come back here.
          </p>

          <button
            onClick={signOut}
            className="w-full text-[9px] font-semibold px-2 py-1 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/[0.04] transition-all"
          >
            Sign out
          </button>
        </GateCard>
      )}
    </div>
  );
}
