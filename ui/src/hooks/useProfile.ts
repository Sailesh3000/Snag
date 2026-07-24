import { useState, useEffect, useCallback } from "react";

function getApiBase(): string {
  try {
    if (typeof chrome !== "undefined" && chrome.storage) {
      return "";
    }
  } catch {}
  return "http://127.0.0.1:8765/api";
}

interface Profile {
  [key: string]: string;
}

interface UseProfileReturn {
  profile: Profile;
  loading: boolean;
  updateField: (key: string, value: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useProfile(): UseProfileReturn {
  const [profile, setProfile] = useState<Profile>({});
  const [loading, setLoading] = useState(true);
  const [apiBase, setApiBase] = useState(getApiBase);

  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.sync.get("settings", (data) => {
        const s = data?.settings;
        if (s?.backendUrl) {
          setApiBase(s.backendUrl.replace(/^ws/, "http").replace(/\/$/, "") + "/api");
        }
      });
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!apiBase) return;
    try {
      const res = await fetch(`${apiBase}/profile`);
      if (res.ok) {
        setProfile(await res.json());
      }
    } catch {
      // Backend not available
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateField = useCallback(async (key: string, value: string) => {
    if (!apiBase) return;
    try {
      await fetch(`${apiBase}/profile/${key}?value=${encodeURIComponent(value)}`, {
        method: "PUT",
      });
      setProfile((prev) => ({ ...prev, [key]: value }));
    } catch {
      // ignore
    }
  }, [apiBase]);

  return { profile, loading, updateField, refresh };
}
