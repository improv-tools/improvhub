// src/profile/ProfilePanel.jsx
import { useEffect, useState } from "react";
import { useAuth } from "auth/AuthContext";
import { supabase } from "lib/supabaseClient";
import { H1, Label, Input, Button, ErrorText, InfoText, Row } from "components/ui";

export default function ProfilePanel() {
  const { session, refreshUser } = useAuth();
  const user = session?.user;

  // Source of truth = Auth display name (raw_user_meta_data.display_name)
  const currentDisplayName =
    user?.user_metadata?.display_name ||
    (user?.email ? user.email.split("@")[0] : "");

  const [name, setName] = useState(currentDisplayName);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // Email change UI
  const [email, setEmail] = useState(user?.email || "");
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");
  const [emailErr, setEmailErr] = useState("");

  // Password change UI
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");

  useEffect(() => {
    setName(currentDisplayName);
    setEmail(user?.email || "");
  }, [currentDisplayName]);

  const save = async () => {
    setErr(""); setMsg(""); setSaving(true);
    const { error } = await supabase.auth.updateUser({ data: { display_name: name.trim() } });
    setSaving(false);
    if (error) setErr(error.message || "Failed to save");
    else { setMsg("Saved!"); await refreshUser(); }
  };

  const DEFAULT_REDIRECT =
    process.env.REACT_APP_REDIRECT_URL ||
    (typeof window !== 'undefined' ? (window.location.origin + window.location.pathname) : "");

  const saveEmail = async () => {
    setEmailErr(""); setEmailMsg(""); setSavingEmail(true);
    try {
      const { error } = await supabase.auth.updateUser(
        { email: email.trim() },
        { emailRedirectTo: DEFAULT_REDIRECT }
      );
      setSavingEmail(false);
      if (error) setEmailErr(error.message || "Failed to update email");
      else {
        setEmailMsg("If required, check your inbox to confirm your new email.");
        await refreshUser();
      }
    } catch (e) {
      setSavingEmail(false);
      setEmailErr(e.message || "Failed to update email");
    }
  };

  const savePassword = async () => {
    setPwErr(""); setPwMsg("");
    if (!pw1 || pw1.length < 6) { setPwErr("Password must be at least 6 characters."); return; }
    if (pw1 !== pw2) { setPwErr("Passwords do not match."); return; }
    setSavingPw(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      setSavingPw(false);
      if (error) setPwErr(error.message || "Failed to update password");
      else {
        setPwMsg("Password updated.");
        setPw1(""); setPw2("");
      }
    } catch (e) {
      setSavingPw(false);
      setPwErr(e.message || "Failed to update password");
    }
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <H1>Profile</H1>

      <Label>
        Display name
        <Input value={name} onChange={(e)=>setName(e.target.value)} />
      </Label>

      <Button onClick={save} disabled={saving || !name.trim()}>
        {saving ? "Saving…" : "Save"}
      </Button>

      {err && <ErrorText style={{ marginTop: 8 }}>{err}</ErrorText>}
      {msg && <InfoText style={{ marginTop: 8 }}>{msg}</InfoText>}

      <p style={{ opacity: 0.7, marginTop: 12, fontSize: 12 }}>
        This updates your Auth display name. We no longer use <code>profiles.full_name</code>.
      </p>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '12px 0' }} />

      <h3 style={{ margin: 0, fontSize: 16 }}>Email</h3>
      <Label>
        Email address
        <Input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} />
      </Label>
      <Row>
        <Button onClick={saveEmail} disabled={savingEmail || !email.trim()}>
          {savingEmail ? "Updating…" : "Update email"}
        </Button>
      </Row>
      {emailErr && <ErrorText>{emailErr}</ErrorText>}
      {emailMsg && <InfoText>{emailMsg}</InfoText>}

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '12px 0' }} />

      <h3 style={{ margin: 0, fontSize: 16 }}>Password</h3>
      <Label>
        New password
        <Input type="password" value={pw1} onChange={(e)=>setPw1(e.target.value)} minLength={6} />
      </Label>
      <Label>
        Confirm new password
        <Input type="password" value={pw2} onChange={(e)=>setPw2(e.target.value)} minLength={6} />
      </Label>
      <Row>
        <Button onClick={savePassword} disabled={savingPw || !pw1 || !pw2}>
          {savingPw ? "Updating…" : "Update password"}
        </Button>
      </Row>
      {pwErr && <ErrorText>{pwErr}</ErrorText>}
      {pwMsg && <InfoText>{pwMsg}</InfoText>}
    </div>
  );
}
