import { useState } from "react";
import { useAuth } from "auth/AuthContext";
import ProfilePanel from "profiles/ProfilePanel";
import TeamsPanel from "teams/TeamsPanel";
import { signOut } from "auth/auth.api";
import { CenterWrap, Card, H1, Tabs, Tab, GhostButton } from "components/ui";

export default function Dashboard() {
  const { session } = useAuth();
  const user = session?.user;
  const [tab, setTab] = useState("home"); // 'home' | 'profile' | 'teams'

  const displayName =
    user?.user_metadata?.full_name || user?.email?.split("@")[0] || user?.email;

  return (
    <CenterWrap>
      <Card>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <H1>improvhub</H1>
          <GhostButton onClick={signOut}>Sign out</GhostButton>
        </div>
        <p style={{ marginTop: 4, opacity: 0.8 }}>Signed in as <strong>{user?.email}</strong></p>

        <Tabs>
          <Tab active={tab==="home"} onClick={()=>setTab("home")}>Home</Tab>
          <Tab active={tab==="profile"} onClick={()=>setTab("profile")}>Profile</Tab>
          <Tab active={tab==="teams"} onClick={()=>setTab("teams")}>Teams</Tab>
        </Tabs>

        {tab === "home" && (
          <div>
            <p style={{ marginTop: 8 }}>Welcome, <strong>{displayName}</strong> 👋</p>
            <p style={{ opacity: 0.8, marginTop: 8 }}>
              Use the <strong>Profile</strong> tab to update your name, or <strong>Teams</strong> to create/join teams.
            </p>
          </div>
        )}

        {tab === "profile" && <ProfilePanel />}
        {tab === "teams" && <TeamsPanel />}
      </Card>
    </CenterWrap>
  );
}
