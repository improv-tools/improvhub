// src/teams/TeamsPanel.jsx
import { useState } from "react";
import { useAuth } from "auth/AuthContext";
import { ErrorText } from "components/ui";
import { useTeamsData } from "./hooks/useTeamsData";
import { useCalendarData } from "./hooks/useCalendarData";
import TeamHeader from "./components/TeamHeader";
import TeamsList from "./components/TeamsList";
import TeamMembers from "./components/TeamMembers";
import CalendarPanel from "./components/CalendarPanel";

export default function TeamsPanel() {
  const { session } = useAuth();
  const user = session?.user;

  const {
    teams, loading, err, setErr,
    selected, members,
    refreshTeams, openTeam, backToList,
    createNewTeam, changeRole, addMember, removeMember, renameTeam, deleteTeam,
  } = useTeamsData(user.id);

  const {
    err: calErr, setErr: setCalErr,
    occurrencesAll, upcomingOcc, pastOccDesc,
    refresh: refreshCalendar,
    createEvent, deleteSeries, deleteOccurrence, patchOccurrence,
  } = useCalendarData(selected?.id);

  // Past paging (25 per page)
  const [pastPage, setPastPage] = useState(1);
  const pastSlice = pastOccDesc.slice(0, pastPage * 25);
  const pastHasMore = pastOccDesc.length > pastSlice.length;

  // Subtabs
  const [subTab, setSubTab] = useState("members");

  const onLeaveTeam = async (teamId, userId) => {
    await removeMember(teamId, userId);
    if (userId === user.id) {
      backToList();
      await refreshTeams();
    }
  };

  return (
    <>
      <TeamHeader
        team={selected}
        onBack={backToList}
        isAdmin={selected?.role === "admin"}
        onRename={(next) => renameTeam(selected.id, next)}
      />

      {(err || calErr) && <ErrorText>{err || calErr}</ErrorText>}

      {!selected ? (
        <TeamsList
          teams={teams}
          loading={loading}
          onOpenTeam={openTeam}
          onCreateTeam={createNewTeam}
        />
      ) : (
        <>
          <p style={{ marginTop: 6, opacity: 0.8 }}>
            ID: <code>{selected.display_id}</code> · Your role: <strong>{selected.role}</strong>
          </p>

          {/* Sub-tabs */}
          <div style={{ display: "flex", gap: 8, margin: "8px 0 12px" }}>
            <button onClick={() => setSubTab("members")} style={subTab==="members" ? styles.subActive : styles.subBtn}>Members</button>
            <button onClick={() => setSubTab("calendar")} style={subTab==="calendar" ? styles.subActive : styles.subBtn}>Calendar</button>
          </div>

          {subTab === "members" ? (
            <TeamMembers
              team={selected}
              members={members}
              currentUserId={user.id}
              isAdmin={selected.role === "admin"}
              onChangeRole={changeRole}
              onAddMember={addMember}
              onRemoveMember={removeMember}
              onLeaveTeam={onLeaveTeam}
              onDeleteTeam={async (id) => {
                if (!window.confirm(`Delete “${selected.name}” permanently? This cannot be undone.`)) return;
                await deleteTeam(id);
              }}
            />
          ) : (
            <CalendarPanel
              team={selected}
              occurrencesAll={occurrencesAll}
              upcomingOcc={upcomingOcc}
              pastSlice={pastSlice}
              pastHasMore={pastHasMore}
              onPastMore={() => setPastPage(p => p + 1)}
              createEvent={createEvent}
              deleteSeries={deleteSeries}
              deleteOccurrence={deleteOccurrence}
              patchOccurrence={patchOccurrence}
              refreshCalendar={refreshCalendar}
            />
          )}
        </>
      )}
    </>
  );
}

const styles = {
  subBtn: {
    background: "transparent",
    color: "white",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 10,
    padding: "8px 12px",
    cursor: "pointer",
  },
  subActive: {
    background: "transparent",
    color: "white",
    border: "1px solid rgba(255,255,255,0.4)",
    borderRadius: 10,
    padding: "8px 12px",
    cursor: "pointer",
  },
};
