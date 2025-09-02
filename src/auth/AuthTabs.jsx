import { useEffect, useState } from "react";
import { useAuth } from "auth/AuthContext";
import { signIn, signUp, resetPassword, updateUserPassword } from "auth/auth.api";
import { CenterWrap, Card, H1, Tabs, Tab, Label, Input, Button, GhostButton, ErrorText, InfoText, Row } from "components/ui";

const DEFAULT_REDIRECT =
  process.env.REACT_APP_REDIRECT_URL ||
  (window.location.origin + window.location.pathname);

export default function AuthTabs() {
  const { recovering, setRecovering } = useAuth();
  const [tab, setTab] = useState("signin");
  useEffect(() => { if (recovering) setTab("newpass"); }, [recovering]);

  return (
    <CenterWrap>
      <Card>
        <Tabs>
          <Tab active={tab==="signin"} onClick={()=>setTab("signin")}>Sign in</Tab>
          <Tab active={tab==="signup"} onClick={()=>setTab("signup")}>Create account</Tab>
          <Tab active={tab==="forgot"} onClick={()=>setTab("forgot")}>Forgot password</Tab>
        </Tabs>

        {tab==="signin" && <SignIn />}
        {tab==="signup" && <SignUp />}
        {tab==="forgot" && <Forgot />}
        {tab==="newpass" && <NewPass onDone={()=>{ setRecovering(false); setTab("signin"); }} />}
      </Card>
    </CenterWrap>
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
      <H1>Sign in</H1>
      {err && <ErrorText>{err}</ErrorText>}
      <form onSubmit={submit} style={{ display:"grid", gap:12 }}>
        <Label> Email <Input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/> </Label>
        <Label> Password <Input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/> </Label>
        <Button disabled={submitting} type="submit">{submitting?"Signing in…":"Sign in"}</Button>
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
      <H1>Create account</H1>
      {err && <ErrorText>{err}</ErrorText>}
      {msg && <InfoText>{msg}</InfoText>}
      <form onSubmit={submit} style={{ display:"grid", gap:12 }}>
        <Label> Name <Input value={name} onChange={e=>setName(e.target.value)} required/> </Label>
        <Label> Email <Input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/> </Label>
        <Label> Password <Input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6}/> </Label>
        <Button disabled={submitting} type="submit">{submitting?"Creating…":"Create account"}</Button>
      </form>
    </>
  );
}

function Forgot() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(""); const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setMsg(""); setErr(""); setSubmitting(true);
    try { const { error } = await resetPassword(email, DEFAULT_REDIRECT); if (error) throw error; setMsg("Password reset email sent. Click the link to continue here."); }
    catch (e2) { setErr(e2.message || "Could not send reset email"); }
    finally { setSubmitting(false); }
  };

  return (
    <>
      <H1>Forgot password</H1>
      {err && <ErrorText>{err}</ErrorText>}
      {msg && <InfoText>{msg}</InfoText>}
      <form onSubmit={submit} style={{ display:"grid", gap:12 }}>
        <Label> Email <Input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/> </Label>
        <Button disabled={submitting} type="submit">{submitting?"Sending…":"Send reset email"}</Button>
      </form>
    </>
  );
}

function NewPass({ onDone }) {
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(""); const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setMsg(""); setErr(""); setSubmitting(true);
    try { const { error } = await updateUserPassword(password); if (error) throw error; setMsg("Password updated. You can now sign in."); onDone?.(); }
    catch (e2) { setErr(e2.message || "Could not update password"); }
    finally { setSubmitting(false); }
  };

  return (
    <>
      <H1>Set a new password</H1>
      {err && <ErrorText>{err}</ErrorText>}
      {msg && <InfoText>{msg}</InfoText>}
      <form onSubmit={submit} style={{ display:"grid", gap:12 }}>
        <Label> New password <Input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6}/> </Label>
        <Button disabled={submitting} type="submit">{submitting?"Updating…":"Update password"}</Button>
      </form>
    </>
  );
}
