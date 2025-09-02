import { useEffect, useState } from "react";
import { useAuth } from "auth/AuthContext";
import { useProfile } from "profiles/useProfile";
import { upsertProfile } from "profiles/profiles.api";
import { updateUserMetadata } from "auth/auth.api";
import { Label, Input, Button, InfoText, Row } from "components/ui";

export default function ProfilePanel() {
  const { session } = useAuth();
  const user = session?.user;
  const { name, setName, loading } = useProfile(user);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState("");

  useEffect(() => {
    if (info) {
      const t = setTimeout(() => setInfo(""), 2000);
      return () => clearTimeout(t);
    }
  }, [info]);

  const saveName = async () => {
    try {
      setSaving(true);
      await upsertProfile(user.id, name);
      await updateUserMetadata({ full_name: name });
      setInfo("Saved ✓");
    } catch (e) {
      alert(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p>Loading profile…</p>;

  return (
    <>
      <Label> Name <Input value={name} onChange={(e)=>setName(e.target.value)} /> </Label>
      <Row>
        <Button onClick={saveName} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </Row>
      {info && <InfoText aria-live="polite">{info}</InfoText>}
    </>
  );
}
