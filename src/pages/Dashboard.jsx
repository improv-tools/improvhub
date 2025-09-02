// src/pages/Dashboard.jsx
import { useState, useEffect } from "react";
import { useAuth } from "auth/AuthContext";
import { useProfile } from "profiles/useProfile";
import { upsertProfile } from "profiles/profiles.api";
import { updateUserMetadata, signOut } from "auth/auth.api";

export default function Dashboard() {
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

  return (
    <div style={styles.centerWrap}>
      <div style={styles.card}>
        <h1 style={styles.h1}>improvhub</h1>
        <p style={{ marginTop: 4, opacity: 0.8 }}>
          Signed in as <strong>{user?.email}</strong>
        </p>

        {loading ? (
          <p>Loading profile…</p>
        ) : (
          <>
            <label style={{ ...styles.label, marginTop: 14 }}>
              <span>Name</span>
              <input
                style={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <div style={styles.row}>
              <button style={styles.button} onClick={saveName} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button style={styles.linkButton} onClick={signOut}>
                Sign out
              </button>
            </div>

            {info && <p style={styles.info} aria-live="polite">{info}</p>}
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  centerWrap: { minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 },
  card: {
    width: "100%",
    maxWidth: 560,
    background: "#14141a",
    color: "#fff",
    borderRadius: 16,
    padding: 20,
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
    border: "1px solid rgba(255,255,255,0.06)",
  },
  h1: { fontSize: 20, margin: 0, marginBottom: 16, letterSpacing: 0.3 },
  label: { display: "grid", gap: 6, fontSize: 14 },
  input: {
    background: "#0f0f14",
    color: "white",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10,
    padding: "10px 12px",
    outline: "none",
  },
  button: {
    background: "white",
    color: "black",
    border: "none",
    padding: "10px 14px",
    borderRadius: 10,
    cursor: "pointer",
    fontWeight: 600,
  },
  linkButton: {
    background: "transparent",
    color: "white",
    border: "1px solid rgba(255,255,255,0.2)",
    padding: "10px 14px",
    borderRadius: 10,
    cursor: "pointer",
  },
  row: { display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" },
  info: { color: "#a0e7ff", margin: "8px 0 0" },
};
