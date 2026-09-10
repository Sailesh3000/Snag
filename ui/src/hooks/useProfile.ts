import { useState, useEffect, useCallback } from "react";
import { isInIframe, postToBackground } from "../lib/channel";

interface Profile {
  [key: string]: string;
}

export interface UseProfileReturn {
  profile: Profile;
  loading: boolean;
  updateField: (key: string, value: string) => Promise<void>;
  refresh: () => Promise<void>;
}

// Message-based local profile (plan B3): the profile lives in the
// extension's IndexedDB and is read/written by the background — the REST
// calls to the retired 127.0.0.1 backend are gone. Updates are applied
// optimistically; the background acks with profile:updated.
export function useProfile(): UseProfileReturn {
  const [profile, setProfile] = useState<Profile>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    postToBackground({ type: "profile:get" });
  }, []);

  useEffect(() => {
    if (!isInIframe) {
      setLoading(false);
      return;
    }
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isInIframe) return;
    function onMessage(event: MessageEvent) {
      if (event.data?.source !== "snag" || !event.data?.msg) return;
      const msg = event.data.msg as { type: string; payload?: Record<string, unknown> };
      if (msg.type === "profile:got") {
        setProfile((msg.payload?.profile as Profile) || {});
        setLoading(false);
      } else if (msg.type === "profile:updated") {
        setProfile((prev) => ({ ...prev, [String(msg.payload?.key)]: String(msg.payload?.value ?? "") }));
        setLoading(false);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const updateField = useCallback(async (key: string, value: string) => {
    setProfile((prev) => ({ ...prev, [key]: value })); // optimistic
    postToBackground({ type: "profile:set", payload: { key, value } });
  }, []);

  return { profile, loading, updateField, refresh };
}
