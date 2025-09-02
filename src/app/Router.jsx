import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import ProtectedRoute from "@/auth/ProtectedRoute";
import SignIn from "@/auth/AuthScreens/SignIn";
import SignUp from "@/auth/AuthScreens/SignUp";
import ForgotPassword from "@/auth/AuthScreens/ForgotPassword";
import NewPassword from "@/auth/AuthScreens/NewPassword";
import Dashboard from "@/pages/Dashboard";

export default function AppRouter() {
  const { recovering } = useAuth();

  return (
    <BrowserRouter basename="/improvhub">
      <Routes>
        {/* Auth flows */}
        <Route path="/auth/signin" element={<SignIn />} />
        <Route path="/auth/signup" element={<SignUp />} />
        <Route path="/auth/forgot" element={<ForgotPassword />} />
        {/* If Supabase fired PASSWORD_RECOVERY, show the new password screen */}
        {recovering && <Route path="/auth/new-password" element={<NewPassword />} />}

        {/* Protected area */}
        <Route element={<ProtectedRoute />}>
          <Route index element={<Dashboard />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
