import { useState } from "react";
import { signIn } from "@/auth/auth.api";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setSubmitting(true);
    try {
      const { error } = await signIn(email, password);
      if (error) throw error;
    } catch (e2) {
      setErr(e2.message || "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <h1>Sign in</h1>
      {err && <p style={{color:"#ff6b6b"}}>{err}</p>}
      <form onSubmit={submit} style={{ display:"grid", gap:12 }}>
        <label>Email <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
        <label>Password <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
        <button disabled={submitting} type="submit">{submitting?"Signing in…":"Sign in"}</button>
      </form>
    </>
  );
}
