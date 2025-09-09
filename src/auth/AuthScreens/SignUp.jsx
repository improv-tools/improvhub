import { useState } from "react";
import { signUp } from "auth/auth.api";

const DEFAULT_REDIRECT =
  process.env.REACT_APP_REDIRECT_URL ||
  (window.location.origin + window.location.pathname);

export default function SignUp() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setMsg("");
    setSubmitting(true);
    const { error } = await signUp(email, password, name, DEFAULT_REDIRECT);
    setSubmitting(false);
    if (error) setErr(error.message || "Failed to create account");
    else setMsg("Check your inbox to confirm your email.");
  };

  return (
    <>
      <h1>Create account</h1>
      {err && <p style={{color:"#ff6b6b"}}>{err}</p>}
      {msg && <p style={{color:"#a0e7ff"}}>{msg}</p>}
      <form onSubmit={submit} style={{ display:"grid", gap:12 }}>
        <label>Name <input value={name} onChange={e=>setName(e.target.value)} required/></label>
        <label>Email <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
        <label>Password <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6}/></label>
        <button disabled={submitting} type="submit">{submitting?"Creating…":"Create account"}</button>
      </form>
    </>
  );
}
