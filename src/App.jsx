import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

function App() {
  const supabase = useMemo(
    () => createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } }),
    []
  );

  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [recovering, setRecovering] = useState(false); // true when PASSWORD_RECOVERY event fires

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session ?? null);
      setLoadingSession(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecovering(true);
      }
      setSession(newSession);
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

function AuthPanel({ supabase }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const clear = () => { setMsg(""); setErr(""); };

  const signInWithPassword = async (e) => {
    e.preventDefault();
    clear();
