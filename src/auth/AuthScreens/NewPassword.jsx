import { useState } from "react";
import { updateUserPassword } from "auth/auth.api";
import { useAuth } from "../AuthContext";

export default function NewPassword() {
  const { setRecovering } = useAuth();
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setMsg(""); setErr(""); setSubmitting(true);
    try {
      const { error } = await updateUserPassword(password);
      if (error) throw error;
      setMsg("Password updated. You can now sign in.");
      setRecovering(false);
    } catch (e2) {
      setErr(e2.message || "Could not update password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <h1>Set a new password</h1>
      {err && <p style={{color:"#ff6b6b"}}>{err}</p>}
      {msg && <p style={{color:"#a0e7ff"}}>{msg}</p>}
      <form onSubmit={submit} style={{ display:"grid", gap:12 }}>
        <label>New password <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6}/></label>
        <button disabled={submitting} type="submit">{submitting?"Updating…":"Update password"}</button>
      </form>
    </>
  );
}
