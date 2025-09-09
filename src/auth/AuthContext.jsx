import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "lib/supabaseClient";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);

  // initial load + subscribe to changes
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      setRecovering(false);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess ?? null);
      setLoading(false);
      setRecovering(event === "PASSWORD_RECOVERY");
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  const displayName = useMemo(() => {
    const u = session?.user;
    return (
      u?.user_metadata?.display_name ||
      (u?.email ? u.email.split("@")[0] : "") ||
      ""
    );
  }, [session]);

  const refreshUser = async () => {
    // Re-fetch the current session to get latest user metadata
    const { data, error } = await supabase.auth.getSession();
    if (!error) setSession(data.session ?? null);
    return { data, error };
  };

  const value = useMemo(
    () => ({
      session,
      user: session?.user || null,
      loading,
      recovering,
      setRecovering,
      displayName, // 👈 use this everywhere for names
      refreshUser,
    }),
    [session, loading, recovering, displayName]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}
