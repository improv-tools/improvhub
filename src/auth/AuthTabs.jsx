import { useEffect, useState } from "react";
import { useAuth } from "auth/AuthContext";
import { signIn, signUp, resetPassword, updateUserPassword } from "auth/auth.api";

const DEFAULT_REDIRECT =
  process.env.REACT_APP_REDIRECT_URL ||
  (window.location.origin + window.location.pathname);

export default function AuthTabs() {
  const { recovering, setRecovering } = useAuth();
  const [tab, setTab] = useState("signin"); // 'signin' | 'signup' | 'forgot' | 'newpass'

  // if Supabase sent PASSWORD_RECOVERY, jump to new password tab
  useEffect(() => {
    if (recovering) setTab("newpass");
  }, [recovering]);

  return (
    <div style={styles.centerWrap}>
      <div style={styles.card}>
        <div style={styles.tabs}>
          <Tab label="Sign in" active={tab==="signin"} onClick={()=>setTab("signin")} />
          <Tab label="Create account" active={tab==="signup"} onClick={()=>setTab("signup")} />
          <Tab label="Forgot password" active={tab==="forgot"} onClick={()=>setTab("forgot")} />
        </div>

        {tab==="signin" && <SignIn />}
        {tab==="signup" && <SignUp />}
        {tab==="forgot" && <Forgot />}
        {tab==="newpass" && <NewPass onDone={()=>{ setRecovering(false); setTab("signin"); }} />}
      </div>
    </div>
  );
}

function Tab({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{ ...styles.tab, ...(active ? styles.tabActive : {}) }}>
      {label}
    </button>
  );
}

function SignIn() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [err, setErr] = useState(""); const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setErr(""); setSubmitting(true);
    try { const { error } = await signIn(email, password); if (error) throw error; }
    catch (e2) { setErr(e2.message || "Sign in failed"); }
    finally { setSubmitting(false); }
  };

  return (
    <>
      <h1 style={styles.h1}>Sign in</h1>
      {err && <p style={styles.error}>{err}</p>}
      <form onSubmit={submit} style={{ display:"grid", gap:12 }}>
        <label style={styles.label}>Email <input style={styles.input} type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
        <label style={styles.label}>Password <input style={styles.input} type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
        <button style={styles.button} disabled={submitting} type="submit">{submitting?"Signing in…":"Sign in"}</button>
      </form>
    </>
  );
}

function SignUp() {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(""); const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setMsg(""); setErr(""); setSubmitting(true);
    try {
      localStorage.setItem("pending_full_name", name);
      const { data, error } = await signUp(email, password, name, DEFAULT_REDIRECT);
      if (error) throw error;
      setMsg(data.session ? "Account created and signed in." : "Check your email to confirm, then return here.");
    } catch (e2) { setErr(e2.message || "Sign up failed"); }
    finally { setSubmitting(false); }
  };

  return (
    <>
      <h1 style={styles.h1}>Create account</h1>
      {err && <p style={styles.error}>{err}</p>}
      {msg && <p style={styles.info}>{msg}</p>}
      <form onSubmit={submit} style={{ display:"grid", gap:12 }}>
        <label style={styles.label}>Name <input style={styles.input} value={name} onChange={e=>setName(e.target.value)} required/></label>
        <label style={styles.label}>Email <input style={styles.input} type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
        <label style={styles.label}>Password <input style={styles.input} type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6}/></label>
        <button style={styles.button} disabled={submitting} type="submit">{submitting?"Creating…":"Create account"}</button>
      </form>
    </>
  );
}

function Forgot() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(""); const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setMsg(""); setErr(""); setSubmitting(true);
    try { const { error } = await resetPassword(email, DEFAULT_REDIRECT); if (error) throw error;
      setMsg("Password reset email sent. Click the link to continue here."); }
    catch (e2) { setErr(e2.message || "Could not send reset email"); }
    finally { setSubmitting(false); }
  };

  return (
    <>
      <h1 style={styles.h1}>Forgot password</h1>
      {err && <p style={styles.error}>{err}</p>}
      {msg && <p style={styles.info}>{msg}</p>}
      <form onSubmit={submit} style={{ display:"grid", gap:12 }}>
        <label style={styles.label}>Email <input style={styles.input} type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
        <button style={styles.button} disabled={submitting} type="submit">{submitting?"Sending…":"Send reset email"}</button>
      </form>
    </>
  );
}

function NewPass({ onDone }) {
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(""); const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setMsg(""); setErr(""); setSubmitting(true);
    try { const { error } = await updateUserPassword(password); if (error) throw error;
      setMsg("Password updated. You can now sign in."); onDone?.(); }
    catch (e2) { setErr(e2.message || "Could not update password"); }
    finally { setSubmitting(false); }
  };

  return (
    <>
      <h1 style={styles.h1}>Set a new password</h1>
      {err && <p style={styles.error}>{err}</p>}
      {msg && <p style={styles.info}>{msg}</p>}
      <form onSubmit={submit} style={{ display:"grid", gap:12 }}>
        <label style={styles.label}>New password <input style={styles.input} type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6}/></label>
        <button style={styles.button} disabled={submitting} type="submit">{submitting?"Updating…":"Update password"}</button>
      </form>
    </>
  );
}

const styles = {
  centerWrap: { minHeight:"100vh", display:"grid", placeItems:"center", padding:16 },
  card: { width:"100%", maxWidth:560, background:"#14141a", color:"#fff", borderRadius:16, padding:20, boxShadow:"0 10px 30px rgba(0,0,0,0.35)", border:"1px solid rgba(255,255,255,0.06)" },
  tabs: { display:"flex", gap:6, marginBottom:14, background:"#0f0f14", padding:6, borderRadius:10, flexWrap:"wrap" },
  tab: { border:"1px solid rgba(255,255,255,0.2)", padding:"8px 10px", borderRadius:8, background:"transparent", color:"white", cursor:"pointer" },
  tabActive: { background:"white", color:"black", borderColor:"white" },
  h1: { fontSize:20, margin:0, marginBottom:16, letterSpacing:0.3 },
  label: { display:"grid", gap:6, fontSize:14 },
  input: { background:"#0f0f14", color:"white", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, padding:"10px 12px", outline:"none" },
  button: { background:"white", color:"black", border:"none", padding:"10px 14px", borderRadius:10, cursor:"pointer", fontWeight:600 },
  error: { color:"#ff6b6b", margin:"0 0 12px" },
  info: { color:"#a0e7ff", margin:"0 0 12px" },
};
