
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

    supabase.auth.getSession().then(({ data, error }) => {
      if (mounted) {
        setSession(data?.session ?? null);
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((evt, sess) => {
      setSession(sess ?? null);
      if (evt === "PASSWORD_RECOVERY") setRecovering(true);
      if (evt === "SIGNED_IN" || evt === "USER_UPDATED") setRecovering(false);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  const displayName =
    session?.user?.user_metadata?.display_name
    || (session?.user?.email ? session.user.email.split("@")[0] : "");

  async function refreshUser() {
    const { data, error } = await supabase.auth.getUser();
    if (!error) {
      const { data: sessData } = await supabase.auth.getSession();
      setSession(sessData?.session ?? null);
    }
  }

  const value = useMemo(
    () => ({
      session,
      user: session?.user || null,
      loading,
      recovering, setRecovering,
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
