import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "lib/supabaseClient";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  // initial load + subscribe to changes
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session ?? null);
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  // ✅ single source of truth for display name
  const displayName = useMemo(() => {
    const u = session?.user;
    if (!u) return "";
    return (
      u.user_metadata?.display_name ||
      u.user_metadata?.full_name ||
      u.user_metadata?.name ||
      (u.email ? u.email.split("@")[0] : "")
    );
  }, [session?.user]);

  // expose a helper to refetch user after updates
  const refreshUser = async () => {
    const { data, error } = await supabase.auth.getUser();
    if (!error) {
      // Merge back into session snapshot so consumers update immediately
      setSession((prev) =>
        prev ? { ...prev, user: data.user } : { user: data.user }
      );
    }
    return { data, error };
  };

  const value = useMemo(
    () => ({
      session,
      user: session?.user || null,
      loading,
      displayName, // 👈 use this everywhere for names
      refreshUser,
    }),
    [session, loading, displayName]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}
