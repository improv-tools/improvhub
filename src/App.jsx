import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Helpful dev-time guard so you don't silently get undefined errors
  // eslint-disable-next-line no-console
  console.warn(
    "Missing REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_ANON_KEY. " +
      "Set them in a .env file and restart the dev server."
  );
}

function App() {
  // createClient is cheap but keep a single instance per app render tree
  const supabase = useMemo(
    () => createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } }),
    []
  );

  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    let isMounted = true;

    // Get initial session on mount
    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!isMounted) return;
      if (error) {
        setAuthError(error.message);
      } else {
        setSession(data.session ?? null);
      }
      setLoadingSession(false);
    })();

    // Listen for auth changes (login / logout / token refresh)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      isMounted = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  if (loadingSession) {
    return (
      <div style={styles.centerWrap}>
        <div style={styles.card}>
          <p style={{ margin: 0 }}>Checking session…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      {!session ? (
        <AuthPanel supabase={supabase} authError={authError} />
      ) : (
        <Dashboard supabase={supabase} session={session} />
      )}
    </div>
  );
}

function AuthPanel({ supabase, authError }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const signInWithPassword = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err) {
      setMessage(err.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  const signUp = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      setMessage("Check your inbox to confirm your account.");
    } catch (err) {
      setMessage(err.message || "Sign-up failed");
    } finally {
      setSubmitting(false);
    }
  };

  const signInWithGithub = async () => {
    setSubmitting(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: {
          // For GitHub Pages, use redirect-based OAuth
          redirectTo: window.location.origin + window.location.pathname,
        },
      });
      if (error) throw error;
    } catch (err) {
      setMessage(err.message || "GitHub sign-in failed");
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.centerWrap}>
      <div style={styles.card}>
        <h1 style={styles.h1}>improvhub — sign in</h1>
        {authError && <p style={styles.error}>{authError}</p>}
        {message && <p style={styles.info}>{message}</p>}

        <form onSubmit={signInWithPassword} style={{ display: "grid", gap: 12 }}>
          <label style={styles.label}>
            <span>Email</span>
            <input
              style={styles.input}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label style={styles.label}>
            <span>Password</span>
            <input
              style={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          <button style={styles.button} disabled={submitting} type="submit">
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div style={styles.row}>
          <button style={styles.linkButton} disabled={submitting} onClick={signUp}>
            Create account
          </button>
          <button style={styles.linkButton} disabled={submitting} onClick={signInWithGithub}>
            Continue with GitHub
          </button>
        </div>
      </div>
    </div>
  );
}

function Dashboard({ supabase, session }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const user = session?.user;

  useEffect(() => {
    let isMounted = true;
    (async () => {
      // Example: fetch a profile row; replace with your own table or remove this block
      try {
        // const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
        // if (error) throw error;
        // if (isMounted) setProfile(data);
        if (isMounted) setProfile({ id: user.id, email: user.email });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [supabase, user]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div style={styles.centerWrap}>
      <div style={styles.card}>
        <h1 style={styles.h1}>improvhub</h1>
        <p style={{ marginTop: 4, opacity: 0.8 }}>Signed in as <strong>{user?.email}</strong></p>

        {loading ? (
          <p>Loading…</p>
        ) : (
          <pre style={styles.pre}>{JSON.stringify(profile, null, 2)}</pre>
        )}

        <div style={styles.row}>
          <button style={styles.button} onClick={signOut}>Sign out</button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  app: { minHeight: "100vh", background: "#0b0b0e", color: "white" },
  centerWrap: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: 16,
  },
  card: {
    width: "100%",
    maxWidth: 520,
    background: "#14141a",
    borderRadius: 16,
    padding: 20,
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
    border: "1px solid rgba(255,255,255,0.06)",
  },
  h1: { fontSize: 20, margin: 0, marginBottom: 16, letterSpacing: 0.3 },
  label: { display: "grid", gap: 6, fontSize: 14 },
  input: {
    background: "#0f0f14",
    color: "white",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10,
    padding: "10px 12px",
    outline: "none",
  },
  button: {
    background: "white",
    color: "black",
    border: "none",
    padding: "10px 14px",
    borderRadius: 10,
    cursor: "pointer",
    fontWeight: 600,
  },
  linkButton: {
    background: "transparent",
    color: "white",
    border: "1px solid rgba(255,255,255,0.2)",
    padding: "10px 14px",
    borderRadius: 10,
    cursor: "pointer",
  },
  row: { display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" },
  error: { color: "#ff6b6b", margin: "0 0 12px" },
  info: { color: "#a0e7ff", margin: "0 0 12px" },
  pre: {
    background: "#0f0f14",
    border: "1px solid rgba(255,255,255,0.1)",
    padding: 12,
    borderRadius: 10,
    overflowX: "auto",
    marginTop: 12,
  },
};

export default App;
