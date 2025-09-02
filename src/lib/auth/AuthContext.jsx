import { createContext, useContext, useEffect, useState } from "react";
import { getSession, onAuthChange } from "@/auth/auth.api";

const AuthCtx = createContext({ session: null, loading: true });

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await getSession();
      setSession(data.session ?? null);
      setLoading(false);
    })();

    const { data: sub } = onAuthChange((event, newSession) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // clean long hash if present
  useEffect(() => {
    if (window.location.hash.includes("access_token")) {
      const url = new URL(window.location.href);
      window.history.replaceState({}, document.title, url.origin + url.pathname);
    }
  }, []);

  return (
    <AuthCtx.Provider value={{ session, loading, recovering, setRecovering }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
