
import { useState, useEffect } from "react";
import { H1, Button, GhostButton, Input } from "components/ui";

export default function TeamHeader({ team, onBack, isAdmin, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(team?.name || "");

  useEffect(() => { setDraft(team?.name || ""); setEditing(false); }, [team?.id, team?.name]);

  return (
    <div style={styles.header}>
      <div style={styles.headerLeft}>
        {team && <GhostButton style={styles.backBtn} onClick={onBack}>← All teams</GhostButton>}
        {!team && <H1 style={{ margin: 0 }}>Teams</H1>}

        {team && !editing && (
          <div style={styles.titleWrap}>
            <H1 style={styles.titleH1}>{team.name}</H1>
            {isAdmin && (
              <button
                aria-label="Rename team"
                title="Rename team"
                onClick={() => setEditing(true)}
                style={styles.renameIcon}
              >✏️</button>
            )}
          </div>
        )}

        {team && editing && (
          <>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && draft.trim()) {
                  await onRename(draft.trim());
                  setEditing(false);
                }
                if (e.key === "Escape") setEditing(false);
              }}
              autoFocus
              style={{ minWidth: 220 }}
            />
            <Button onClick={async () => { if (draft.trim()) { await onRename(draft.trim()); setEditing(false); } }} disabled={!draft.trim()}>
              Save
            </Button>
            <GhostButton onClick={() => { setEditing(false); setDraft(team.name); }}>Cancel</GhostButton>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  header: { display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", marginBottom: 12 },
  headerLeft: { display: "flex", alignItems: "center", gap: 8 },
  backBtn: { height: 40, display: "inline-flex", alignItems: "center" },
  titleWrap: { display: "inline-flex", alignItems: "center", height: 40, gap: 8 },
  titleH1: { margin: 0, height: 40, lineHeight: "40px", display: "inline-flex", alignItems: "center" },
  renameIcon: {
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 8,
    padding: "6px 8px",
    cursor: "pointer",
    color: "white",
    height: 40,
    display: "inline-flex",
    alignItems: "center",
  },
};
