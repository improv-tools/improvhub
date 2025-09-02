import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function ProtectedRoute() {
  const { session, loading } = useAuth();
  if (loading) return <div>Loading...</div>; // Prevents redirect loop and blank page
  return session ? <Outlet /> : <Navigate to="/improvhub/auth/signin" replace />;
}