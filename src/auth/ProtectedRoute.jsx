import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function ProtectedRoute() {
  const { session, loading } = useAuth();
  if (loading) return null; // or a spinner
  return session ? <Outlet /> : <Navigate to="/improvhub/auth/signin" replace />;
}
