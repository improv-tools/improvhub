import { useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useProfile } from "@/profiles/useProfile";
import { upsertProfile } from "@/profiles/profiles.api";
import { updateUserMetadata, signOut } from "@/auth/auth.api";

export default function Dashboard() {
  const { session } = useAuth();
  const user = session?.user;
  const { name, setName, loading } = useProfile(user);
  const [saving, setSaving] = useState(false);

  const saveName = async () => {
    try {
      setSaving(true);
      await upsertProfile(user.id, name);
      await updateUserMetadata({ full_name: name });
      alert("Saved.");
    } catch (e) {
      alert(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h1>improvhub</h1>
      <p>Signed in as <strong>{user?.email}</strong></p>
      {loading ? (
        <p>Loading profile…</p>
      ) : (
        <>
          <label>Name <input value={name} onChange={e=>setName(e.target.value)} /></label>
          <div style={{ display:"flex", gap:8, marginTop:10 }}>
            <button onClick={saveName} disabled={saving}>{saving?"Saving…":"Save"}</button>
            <button onClick={signOut}>Sign out</button>
          </div>
        </>
      )}
    </>
  );
}
