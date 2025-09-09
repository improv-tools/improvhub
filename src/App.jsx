import { AuthProvider, useAuth } from "auth/AuthContext";
import AuthTabs from "auth/AuthTabs";
import Dashboard from "pages/Dashboard";

function Shell() {
  const { session, loading } = useAuth();

  // If you arrive with #access_token, clean the URL
  if (typeof window !== "undefined" && window.location.hash.includes("access_token")) {
    const url = new URL(window.location.href);
    window.history.replaceState({}, document.title, url.origin + url.pathname);
  }

  if (loading) {
    return (
      <div style={{ minHeight:"100vh", display:"grid", placeItems:"center", color:"#fff", background:"#0b0b0e" }}>
        <div style={{ opacity: 0.8 }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight:"100vh", background:"#0b0b0e", color:"#fff" }}>
      {session ? <Dashboard /> : <AuthTabs />}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
