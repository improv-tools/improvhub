import { useState } from "react";
import { resetPassword } from "@/auth/auth.api";

const DEFAULT_REDIRECT =
  process.env.REACT_APP_REDIRECT_URL ||
  (window.location.origin + window.location.pathname);

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setMsg(""); setErr(""); setSubmitting(true);
    try {
      const { error } = await resetPassword(email, DEFAULT_REDIRECT);
      if (error) throw error;
      setMsg("Password reset email sent. Click the link to continue here.");
    } catch (e2) {
      setErr(e2.message || "Could not send reset email");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <h1>Forgot password</h1>
      {err && <p style={{color:"#ff6b6b"}}>{err}</p>}
      {msg && <p style={{color:"#a0e7ff"}}>{msg}</p>}
      <form onSubmit={submit} style={{ display:"grid", gap:12 }}>
        <label>Email <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
        <button disabled={submitting} type="submit">{submitting?"Sending…":"Send reset email"}</button>
      </form>
    </>
  );
}
