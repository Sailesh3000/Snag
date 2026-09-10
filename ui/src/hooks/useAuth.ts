import { useEffect, useState, useCallback } from "react";
import { isInIframe, postToBackground } from "../lib/channel";

// Sign-in / subscription state for the sidebar (plan B4). The UI never
// touches tokens: it asks the background for a reduced session view
// (sub/email only) plus the live subscription status from /api/me, and the
// background pushes updates (auth:updated) on sign-in, sign-out, checkout
// completion, and the 30s alarm re-poll.

export interface PublicSession {
  sub: string;
  email: string;
  expiresAt: number;
}

export interface SubscriptionInfo {
  status: string; // "active" | "past_due" | "cancelled" | "none"
  currentPeriodEnd: string | null;
}

export interface UseAuthReturn {
  /** True once the first auth:status / auth:updated reply has landed. */
  ready: boolean;
  session: PublicSession | null;
  subscription: SubscriptionInfo | null;
  /** Last sign-in error, if any (e.g. "sign-in failed: ..."). */
  error: string | null;
  signedIn: boolean;
  subscriptionActive: boolean;
  signIn: () => void;
  signOut: () => void;
  checkout: () => void;
  /** Re-poll auth:status (used by the "check again" affordances). */
  refresh: () => void;
}

interface AuthPayload {
  session?: PublicSession | null;
  subscription?: SubscriptionInfo | null;
  error?: string;
}

export function useAuth(): UseAuthReturn {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<PublicSession | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isInIframe) return; // no background in a plain dev preview
    postToBackground({ type: "auth:status" });
  }, []);

  useEffect(() => {
    if (!isInIframe) return;
    function onMessage(event: MessageEvent) {
      if (event.data?.source !== "snag" || !event.data?.msg) return;
      const msg = event.data.msg as { type: string; payload?: AuthPayload };
      if (msg.type !== "auth:status" && msg.type !== "auth:updated") return;
      const p = msg.payload || {};
      setSession(p.session ?? null);
      setSubscription(p.subscription ?? null);
      setError(p.error ?? null);
      setReady(true);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const signIn = useCallback(() => {
    setError(null);
    postToBackground({ type: "auth:signIn" });
  }, []);

  const signOut = useCallback(() => postToBackground({ type: "auth:signOut" }), []);
  const checkout = useCallback(() => postToBackground({ type: "auth:checkout" }), []);

  const refresh = useCallback(() => {
    setReady(false);
    postToBackground({ type: "auth:status" });
  }, []);

  return {
    ready,
    session,
    subscription,
    error,
    signedIn: !!session,
    subscriptionActive: subscription?.status === "active",
    signIn,
    signOut,
    checkout,
    refresh,
  };
}
