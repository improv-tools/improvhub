import { AuthProvider } from "@/auth/AuthContext";
import AppRouter from "@/app/Router";

export default function App() {
  return (
    <AuthProvider>
      <div style={{ minHeight:"100vh", background:"#0b0b0e", color:"#fff", padding:16 }}>
        <AppRouter />
      </div>
    </AuthProvider>
  );
}
