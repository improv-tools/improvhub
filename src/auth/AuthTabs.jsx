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
        <H1>Welcome to ImprovHub</H1>
        <Tabs value={tab} onChange={setTab}>
          <Tab value="signin" label="Sign in">
            <SignIn />
            <Row>
              <GhostButton onClick={() => setTab("signup")}>Create account</GhostButton>
              <GhostButton onClick={() => setTab("reset")}>Forgot password?</GhostButton>
            </Row>
          </Tab>
          <Tab value="signup" label="Sign up">
            <SignUp onBack={() => setTab("signin")} />
          </Tab>
          <Tab value="reset" label="Reset password">
            <Reset />
          </Tab>
          <Tab value="newpass" label="Set new password">
            <NewPassword onDone={() => { setRecovering(false); setTab("signin"); }} />
          </Tab>
        </Tabs>
      </Card>
    </CenterWrap>
  );
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setSubmitting(true);
    const { error } = await signIn(email, password);
    setSubmitting(false);
    if (error) setErr(error.message || "Failed to sign in");
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
      {err && <ErrorText>{err}</ErrorText>}
      <Label> Email <Input type="email" value={email} onChange={e=>setEmail(e.target.value)} required /></Label>
      <Label> Password <Input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6} /></Label>
      <Button type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</Button>
    </form>
  );
}

function SignUp({ onBack }) {
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
      {err && <ErrorText>{err}</ErrorText>}
      {msg && <InfoText>{msg}</InfoText>}
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <Label> Name <Input value={name} onChange={e=>setName(e.target.value)} required /></Label>
        <Label> Email <Input type="email" value={email} onChange={e=>setEmail(e.target.value)} required /></Label>
        <Label> Password <Input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6} /></Label>
        <Row>
          <Button type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create account"}</Button>
          <GhostButton type="button" onClick={onBack}>Back</GhostButton>
        </Row>
      </form>
    </>
  );
}

function Reset() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setMsg("");
    setSubmitting(true);
    const { error } = await resetPassword(email, DEFAULT_REDIRECT);
    setSubmitting(false);
    if (error) setErr(error.message || "Failed to send reset email");
    else setMsg("If the email exists, a reset link has been sent.");
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
      {err && <ErrorText>{err}</ErrorText>}
      {msg && <InfoText>{msg}</InfoText>}
      <Label> Email <Input type="email" value={email} onChange={e=>setEmail(e.target.value)} required /></Label>
      <Button type="submit" disabled={submitting}>{submitting ? "Sending…" : "Send reset link"}</Button>
    </form>
  );
}

function NewPassword({ onDone }) {
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setMsg("");
    setSubmitting(true);
    const { error } = await updateUserPassword(password);
    setSubmitting(false);
    if (error) setErr(error.message || "Failed to update password");
    else { setMsg("Password updated."); onDone?.(); }
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
      {err && <ErrorText>{err}</ErrorText>}
      {msg && <InfoText>{msg}</InfoText>}
      <Label> New password <Input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6} /></Label>
      <Button type="submit" disabled={submitting}>{submitting ? "Updating…" : "Update password"}</Button>
    </form>
  );
}
