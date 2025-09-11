
import { useState } from "react";
import { GhostButton, Button, Input, InfoText } from "components/ui";

export default function TeamsList({ teams, loading, onOpenTeam, onCreateTeam }) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { await onCreateTeam(name.trim()); setShowCreate(false); setName(""); } finally { setBusy(false); }
  };

  return (
    <>
      {loading ? (
        <p>Loading teams…</p>
      ) : teams.length === 0 ? (
        <p style={{ opacity: 0.8 }}>You don’t belong to any teams yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
          {teams.map((t) => (
            <li key={t.id}
                style={{ padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", cursor: "pointer" }}
                onClick={() => onOpenTeam(t)}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
                <div><strong>{t.name}</strong> <span style={{ opacity:0.7 }}>· ID: {t.display_id}</span></div>
                <span style={{ opacity: 0.7 }}>{t.role}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: 12 }} />
      {!showCreate ? (
        <GhostButton onClick={() => setShowCreate(true)}>+ Create team</GhostButton>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Writers Room"
              onKeyDown={(e) => e.key === "Enter" && create()}
              style={{ minWidth: 220 }}
            />
            <Button onClick={create} disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create"}</Button>
            <GhostButton onClick={() => { setShowCreate(false); setName(""); }}>Cancel</GhostButton>
          </div>
          <InfoText style={{ marginTop: 6 }}>
            Duplicates allowed. A unique id like <code>Name#1</code> is generated.
          </InfoText>
        </>
      )}
    </>
  );
}
