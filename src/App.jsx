import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const DEFAULT_REDIRECT =
  process.env.REACT_APP_REDIRECT_URL ||
  (window.location.origin + window.location.pathname);

function App() {
  const supabase = useMemo(
    () => createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } }),
    []
  );

  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [recovering, setRecovering] = useState(false);

  // keep URL clean if we arrive with #access_token
  useEffect(() => {
    if (window.location.hash.includes("access_token")) {
      const url = new URL(window.location.href);
      window.history.replaceState({}, document.title, url.origin + url.pathname);
    }
  }, []);

  // initial session + auth listener (also handles profile upsert after sign-in)
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

      // On first SIGNED_IN after signup/confirm, upsert profile using stored/passed name
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
        <div style={styles.card}><p style={{margin:0}}>Checking session…</p></div>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      {!session ? (
        recovering ? (
          <NewPasswordForm supabase={supabase} onDone={() => setRecovering(false)} />
        ) : (
          <AuthPanel supabase={supabase} />
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

function AuthPanel({ supabase }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const clear = () => { setMsg(""); setErr(""); };

  const signInWithPassword = async (e) => {
    e.preventDefault();
    clear();
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // onAuthStateChange will show Dashboard
    } catch (e) {
      setErr(e.message || "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  };

  const signUp = async (e) => {
    e.preventDefault();
    clear();
    setSubmitting(true);
    try {
      // Save name so we can upsert after confirm redirect too
      localStorage.setItem("pending_full_name", name);

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name },   // also store in auth user_metadata
          redirectTo: DEFAULT_REDIRECT // works for dev and prod
        },
      });
      if (error) throw error;

      if (!data.session) {
        setMsg("Check your email to confirm your account, then return here.");
      } else {
        setMsg("Account created and signed in.");
      }
    } catch (e) {
      setErr(e.message || "Sign up failed");
    } finally {
      setSubmitting(false);
    }
  };

  const sendPasswordReset = async () => {
    clear();
    if (!email) return setErr("Enter your email above first.");
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: DEFAULT_REDIRECT,
      });
      if (error) throw error;
      setMsg("Password reset email sent. Click the link in your inbox to continue here.");
    } catch (e) {
      setErr(e.message || "Could not send reset email");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.centerWrap}>
      <div style={styles.card}>
        <h1 style={styles.h1}>improvhub — sign in</h1>
        {err && <p style={styles.error}>{err}</p>}
        {msg && <p style={styles.info}>{msg}</p>}

        <form onSubmit={signInWithPassword} style={{ display: "grid", gap: 12 }}>
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>

          <button style={styles.button} disabled={submitting} type="submit">
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div style={styles.row}>
          <button style={styles.linkButton} disabled={submitting} onClick={signUp}>Create account</button>
          <button style={styles.linkButton} disabled={submitting} onClick={sendPasswordReset}>Forgot password</button>
        </div>
      </div>
    </div>
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
    } catch (e) {
      setErr(e.message || "Could not update password");
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
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState("");

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
        if (mounted) {
          setProfile(data || null);
          setFullName((data && data.full_name) || user.user_metadata?.full_name || "");
        }
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
      // (optional) also keep auth metadata in sync:
      await supabase.auth.updateUser({ data: { full_name: fullName } });
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

            <pre style={styles.pre}>
{JSON.stringify({ profile, user_metadata_name: user?.user_metadata?.full_name }, null, 2)}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  app: { minHeight: "100vh", background: "#0b0b0e", color: "white" },
  centerWrap: { minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 },
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
