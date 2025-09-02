import { useState } from "react";
import { signIn } from "../auth.api";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    const { error } = await signIn(email, password);
    if (error) setErr(error.message);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} />
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
      <button type="submit">Sign In</button>
      {err && <p>{err}</p>}
    </form>
  );
}
