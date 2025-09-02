import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const DEFAULT_REDIRECT =
  process.env.REACT_APP_REDIRECT_URL ||
  (window.location.origin + window.location.pathname);

function App() {
  const supabase = useMemo(
    () =>
      createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      }),
    []
  );

  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [recovering, setRecovering] = useState(false);

  // Clean long auth hash if present
  useEffect(() => {
    if (window.location.hash.includes("access_token")) {
      const url = new URL(window.location.href);
      window.history.replaceState({}, document.title, url.origin + url.pathname);
    }
  }, []);

  // Session + auth listener (also triggers profile upsert after sign-up/confirm)
  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session ?? null);
      setLoadingSession(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      setSession(newSession);

      // After first SIGNED_IN, upsert profile with stored/passed name
      if (event === "SIGNED_IN" && newSession?.user) {
        try {
          const metaName = newSession.user.user_metadata?.full_name || "";
          const pending = localStorage.getItem("pending_full_name") || "";
          const fullName = metaName || pending;
          if (fullName) {
            await upsertProfile(supabase, newSession.user.id, fullName);
            localStorage.removeItem("pending_full_name");
          }
        } catch (err) {
          console.error("Profile upsert failed:", err);
        }
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  if (loadingSession) {
    return (
      <div style={styles.centerWrap}>
        <div style={styles.card}><p style={{ margin: 0 }}>Checking session…</p></div>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      {!session ? (
        recovering ? (
          <NewPasswordForm supabase={supabase} onDone={() => setRecovering(false)} />
        ) : (
          <AuthSwitcher supabase={supabase} />
        )
      ) : (
        <Dashboard supabase={supabase} session={session} />
      )}
    </div>
  );
}

async function upsertProfile(supabase, userId, fullName) {
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, full_name: fullName }, { onConflict: "id" });
  if (error) throw error;
}

/** -------- Auth UI with three modes -------- */
function AuthSwitcher({ supabase }) {
  const [mode, setMode] = useState("signin"); // 'signin' | 'signup' | 'forgot'
  return (
    <div style={styles.centerWrap}>
      <div style={styles.card}>
        <div style={styles.tabs}>
          <button
            onClick={() => setMode("signin")}
            style={{ ...styles.tab, ...(mode === "signin" ? styles.tabActive : {}) }}
          >
            Sign in
          </button>
          <button
            onClick={() => setMode("signup")}
            style={{ ...styles.tab, ...(mode === "signup" ? styles.tabActive : {}) }}
          >
            Create account
          </button>
          <button
            onClick={() => setMode("forgot")}
            style={{ ...styles.tab, ...(mode === "forgot" ? styles.tabActive : {}) }}
          >
            Forgot password
          </button>
        </div>

        {mode === "signin" && <SignInForm supabase={supabase} />}
        {mode === "signup" && <SignUpForm supabase={supabase} />}
        {mode === "forgot" && <ForgotForm supabase={supabase} />}
      </div>
    </div>
  );
}

function SignInForm({ supabase }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setMsg(""); setErr("");
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // SIGNED_IN event will switch to Dashboard
    } catch (e2) {
      setErr(e2.message || "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <h1 style={styles.h1}>Sign in</h1>
      {err && <p style={styles.error}>{err}</p>}
      {msg && <p style={styles.info}>{msg}</p>}
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
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
    </>
  );
}

function SignUpForm({ supabase }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setMsg(""); setErr("");
    setSubmitting(true);
    try {
      // Keep name for post-confirm upsert
      localStorage.setItem("pending_full_name", name);

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name },    // store in auth user_metadata
          redirectTo: DEFAULT_REDIRECT, // dev+prod redirect
        },
      });
      if (error) throw error;

      if (!data.session) {
        setMsg("Check your email to confirm your account, then return here.");
      } else {
        setMsg("Account created and signed in.");
      }
    } catch (e2) {
      setErr(e2.message || "Sign up failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <h1 style={styles.h1}>Create account</h1>
      {err && <p style={styles.error}>{err}</p>}
      {msg && <p style={styles.info}>{msg}</p>}
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label style={styles.label}>
          <span>Name</span>
          <input
            style={styles.input}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
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
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </label>
        <button style={styles.button} disabled={submitting} type="submit">
          {submitting ? "Creating…" : "Create account"}
        </button>
      </form>
    </>
  );
}

function ForgotForm({ supabase }) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setMsg(""); setErr("");
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: DEFAULT_REDIRECT,
      });
      if (error) throw error;
      setMsg("Password reset email sent. Click the link in your inbox to continue here.");
    } catch (e2) {
      setErr(e2.message || "Could not send reset email");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <h1 style={styles.h1}>Forgot password</h1>
      {err && <p style={styles.error}>{err}</p>}
      {msg && <p style={styles.info}>{msg}</p>}
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
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
        <button style={styles.button} disabled={submitting} type="submit">
          {submitting ? "Sending…" : "Send reset email"}
        </button>
      </form>
    </>
  );
}

function NewPasswordForm({ supabase, onDone }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setMsg(""); setErr("");
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setMsg("Password updated. You can now sign in.");
      onDone?.();
    } catch (e2) {
      setErr(e2.message || "Could not update password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.centerWrap}>
      <div style={styles.card}>
        <h1 style={styles.h1}>Set a new password</h1>
        {err && <p style={styles.error}>{err}</p>}
        {msg && <p style={styles.info}>{msg}</p>}
        <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
          <label style={styles.label}>
            <span>New password</span>
            <input
              style={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>
          <button style={styles.button} disabled={submitting} type="submit">
            {submitting ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Dashboard({ supabase, session }) {
  const user = session?.user;
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(true);

  // Fetch profile name on load
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", user.id)
          .single();
        if (error && error.code !== "PGRST116") throw error; // ignore "not found"
        if (mounted) setFullName(data?.full_name || user.user_metadata?.full_name || "");
      } catch (e) {
        console.error(e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [supabase, user]);

  const saveName = async () => {
    try {
      await upsertProfile(supabase, user.id, fullName);
      await supabase.auth.updateUser({ data: { full_name: fullName } }); // keep metadata in sync
      alert("Saved.");
    } catch (e) {
      alert(e.message || "Save failed");
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div style={styles.centerWrap}>
      <div style={styles.card}>
        <h1 style={styles.h1}>improvhub</h1>
        <p style={{ marginTop: 4, opacity: 0.8 }}>Signed in as <strong>{user?.email}</strong></p>

        {loading ? (
          <p>Loading profile…</p>
        ) : (
          <>
            <label style={{ ...styles.label, marginTop: 12 }}>
              <span>Name</span>
              <input
                style={styles.input}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </label>
            <div style={styles.row}>
              <button style={styles.button} onClick={saveName}>Save</button>
              <button style={styles.linkButton} onClick={signOut}>Sign out</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** -------- styles -------- */
const styles = {
  app: { minHeight: "100vh", background: "#0b0b0e", color: "white" },
  centerWrap: { minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 },
  card: {
    width: "100%",
    maxWidth: 560,
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
  tabs: { display: "flex", gap: 6, marginBottom: 14, background: "#0f0f14", padding: 6, borderRadius: 10 },
  tab: { border: "1px solid rgba(255,255,255,0.2)", padding: "8px 10px", borderRadius: 8, background: "transparent", color: "white", cursor: "pointer" },
  tabActive: { background: "white", color: "black", borderColor: "white" },
  error: { color: "#ff6b6b", margin: "0 0 12px" },
  info: { color: "#a0e7ff", margin: "0 0 12px" },
};

export default App;
