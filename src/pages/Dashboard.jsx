// src/pages/Dashboard.jsx
import { useState } from "react";
import { useAuth } from "auth/AuthContext";
import ProfilePanel from "profiles/ProfilePanel";
import { signOut } from "auth/auth.api";
import { CenterWrap, Card, H1, Tabs, Tab, GhostButton } from "components/ui";

export default function Dashboard() {
  const { session, displayName } = useAuth();
  const [tab, setTab] = useState("home"); // 'home' | 'profile'

  return (
    <CenterWrap>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <H1 style={{ margin: 0 }}>ImprovHub</H1>
          <GhostButton onClick={signOut}>Sign out</GhostButton>
        </div>

        <Tabs value={tab} onChange={setTab}>
          <Tab value="home" label="Home">
            <p style={{ opacity: 0.9, marginTop: 4 }}>
              Hi <strong>{displayName || (session?.user?.email ?? "there")}</strong>!
            </p>
            <p style={{ opacity: 0.8, marginTop: 8 }}>
              Use the <strong>Profile</strong> tab to update your display name.
            </p>
          </Tab>
          <Tab value="profile" label="Profile">
            <ProfilePanel />
          </Tab>
        </Tabs>
      </Card>
    </CenterWrap>
  );
}
