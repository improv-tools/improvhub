import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function ProtectedRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) return null; // or a spinner

  if (!session) {
    // Send unauthenticated users to Sign In, remembering where they came from
    return <Navigate to="/auth/signin" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
