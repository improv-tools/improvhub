// src/profile/ProfilePanel.jsx
import { useEffect, useState } from "react";
import { useAuth } from "auth/AuthContext";
import { supabase } from "lib/supabaseClient";
import { H1, Label, Input, Button, ErrorText, InfoText } from "components/ui";

export default function ProfilePanel() {
  const { session } = useAuth();
  const user = session?.user;

  // Source of truth = Auth display name (raw_user_meta_data.display_name)
  const currentDisplayName =
    user?.user_metadata?.display_name ||
    (user?.email ? user.email.split("@")[0] : "");

  const [name, setName] = useState(currentDisplayName);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setName(currentDisplayName);
  }, [currentDisplayName]);

  const save = async () => {
    const next = (name || "").trim();
    if (!next) return;
    setSaving(true);
    setErr("");
    setMsg("");
    try {
      // ✅ Update Auth display name (NOT profiles)
      const { error } = await supabase.auth.updateUser({
        data: { display_name: next },
      });
      if (error) throw error;

      // Nudge session to refresh so other screens see the new name
      await supabase.auth.getUser();

      setMsg("Saved ✓");
      setTimeout(() => setMsg(""), 1500);
    } catch (e) {
      setErr(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <H1>Profile</H1>

      <Label>
        Display name
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
      </Label>

      <Button onClick={save} disabled={saving || !name.trim()}>
        {saving ? "Saving…" : "Save"}
      </Button>

      {err && <ErrorText style={{ marginTop: 8 }}>{err}</ErrorText>}
      {msg && <InfoText style={{ marginTop: 8 }}>{msg}</InfoText>}

      <p style={{ opacity: 0.7, marginTop: 12, fontSize: 12 }}>
        This updates your Auth display name. We no longer use <code>profiles.full_name</code>.
      </p>
    </div>
  );
}
