// src/showrunner/ShowrunnerPanel.jsx
import { useEffect, useState } from "react";
import { H1, InfoText, Label, Input, Button, GhostButton, DangerButton, ErrorText, Row } from "components/ui";
import ShowCalendarPanel from "./components/ShowCalendarPanel";
import { listMySeries, createSeries, renameSeriesRPC, deleteSeriesRPC } from "./shows.api";

export default function ShowrunnerPanel() {
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const [selected, setSelected] = useState(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      setErr(""); setMsg(""); setLoading(true);
      try { setSeries(await listMySeries()); }
      catch (e) { setErr(e.message || "Failed to load productions"); }
      finally { setLoading(false); }
    })();
  }, []);

  const createNew = async () => {
    if (!newName.trim()) return;
    setCreating(true); setErr(""); setMsg("");
    try {
      const s = await createSeries(newName.trim());
      setSeries((xs)=>[s, ...xs]); setNewName(""); setSelected(s);
      setMsg("Production created.");
    } catch (e) { setErr(e.message || "Failed to create production"); }
    finally { setCreating(false); }
  };

  const backToList = () => { setSelected(null); setMsg(""); setErr(""); };

  const rename = async () => {
    const name = window.prompt("Rename production", selected?.name || "");
    if (!name || !name.trim()) return;
    try {
      await renameSeriesRPC(selected.id, name.trim());
      setSelected({ ...selected, name: name.trim() });
      setSeries(xs => xs.map(s => s.id === selected.id ? { ...s, name: name.trim() } : s));
      setMsg("Production renamed.");
    } catch (e) { setErr(e.message || "Failed to rename"); }
  };

  const remove = async () => {
    if (!window.confirm("Delete this production? This cannot be undone.")) return;
    try {
      await deleteSeriesRPC(selected.id);
      setSeries(xs => xs.filter(s => s.id !== selected.id));
      backToList(); setMsg("Production deleted.");
    } catch (e) { setErr(e.message || "Failed to delete production"); }
  };

  if (loading) return <p style={{ opacity: 0.8 }}>Loading…</p>;

  return (
    <div>
      <H1>Showrunner</H1>
      {err && <ErrorText>{err}</ErrorText>}
      {msg && <InfoText>{msg}</InfoText>}

      {!selected ? (
        <>
          <Label>
            Create new production
            <Row>
              <Input placeholder="Production name" value={newName} onChange={(e)=>setNewName(e.target.value)} style={{ minWidth: 260 }} />
              <Button disabled={creating || !newName.trim()} onClick={createNew}>{creating ? "Creating…" : "Create"}</Button>
            </Row>
          </Label>
          <div style={{ marginTop: 20 }}>
            <h3 style={{ margin: "8px 0 8px", fontSize: 16 }}>Your productions</h3>
            {series.length === 0 ? (
              <p style={{ opacity: 0.8 }}>No productions yet. Create one above.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {series.map((s) => (
                  <li key={s.id} style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 12, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{s.name}</div>
                      <div style={{ opacity: 0.7, fontSize: 12 }}>{s.display_id}</div>
                    </div>
                    <Row>
                      <GhostButton onClick={()=>setSelected(s)}>Open</GhostButton>
                    </Row>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <>
          <Row>
            <GhostButton onClick={backToList}>← Back</GhostButton>
            <div style={{ flex: 1 }} />
            <GhostButton onClick={rename}>Rename</GhostButton>
            <DangerButton onClick={remove}>Delete production</DangerButton>
          </Row>
          <div style={{ marginTop: 16 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 18 }}>{selected.name}</h3>
            <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 12 }}>{selected.display_id}</div>
            <ShowCalendarPanel series={selected} />
          </div>
        </>
      )}
    </div>
  );
}
