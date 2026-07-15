import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { activeProfileStorageKey, type UserProfile } from "@/lib/profiles";

type ActiveProfileContextValue = {
  profiles: UserProfile[];
  activeProfileId: string | null;
  activeProfile: UserProfile | null;
  setActiveProfileId: (id: string) => void;
  refetch: () => Promise<void>;
  loading: boolean;
};

const ActiveProfileContext = createContext<ActiveProfileContextValue | null>(null);

/** Query keys that must refresh on profile change. */
const PROFILE_SCOPED_KEYS: readonly (readonly unknown[])[] = [
  ["warranties"],
  ["expenses"],
  ["agreements"],
  ["recurring_payments"],
  ["recurring_instances"],
  ["dashboard"],
  ["dashboard-installments"],
  ["overview-warranties"],
  ["overview-agreements"],
  ["overview-recurring"],
  ["overview-rp-instances"],
  ["search"],
];

export function ActiveProfileProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [activeProfileId, _setActiveProfileId] = useState<string | null>(null);

  // Track auth session so we can scope profiles + local storage per user.
  useEffect(() => {
    let mounted = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setUserId(data.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!mounted) return;
      setUserId(session?.user?.id ?? null);
      if (!session?.user) _setActiveProfileId(null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const { data: profiles = [], isLoading, refetch } = useQuery({
    queryKey: ["user_profiles", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("*")
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as UserProfile[];
    },
  });

  // Pick active profile: localStorage → default → first.
  useEffect(() => {
    if (!userId || profiles.length === 0) return;
    if (activeProfileId && profiles.some((p) => p.id === activeProfileId)) return;
    let chosen: string | null = null;
    try {
      const stored = localStorage.getItem(activeProfileStorageKey(userId));
      if (stored && profiles.some((p) => p.id === stored)) chosen = stored;
    } catch {
      // ignore
    }
    if (!chosen) chosen = (profiles.find((p) => p.is_default) ?? profiles[0]!).id;
    _setActiveProfileId(chosen);
  }, [profiles, userId, activeProfileId]);

  const setActiveProfileId = useCallback(
    (id: string) => {
      _setActiveProfileId(id);
      if (userId) {
        try {
          localStorage.setItem(activeProfileStorageKey(userId), id);
        } catch {
          // ignore
        }
      }
      // Invalidate every profile-scoped cache so all modules refetch under the new profile.
      for (const key of PROFILE_SCOPED_KEYS) {
        void qc.invalidateQueries({ queryKey: key as unknown[] });
      }
    },
    [qc, userId],
  );

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? null,
    [profiles, activeProfileId],
  );

  const value = useMemo<ActiveProfileContextValue>(
    () => ({
      profiles,
      activeProfileId,
      activeProfile,
      setActiveProfileId,
      refetch: async () => {
        await refetch();
      },
      loading: isLoading,
    }),
    [profiles, activeProfileId, activeProfile, setActiveProfileId, refetch, isLoading],
  );

  return <ActiveProfileContext.Provider value={value}>{children}</ActiveProfileContext.Provider>;
}

export function useActiveProfile(): ActiveProfileContextValue {
  const ctx = useContext(ActiveProfileContext);
  if (!ctx) {
    // Safe fallback when used outside the provider (e.g. public routes / SSR).
    return {
      profiles: [],
      activeProfileId: null,
      activeProfile: null,
      setActiveProfileId: () => {},
      refetch: async () => {},
      loading: false,
    };
  }
  return ctx;
}