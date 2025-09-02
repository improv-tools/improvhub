import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "auth/ProtectedRoute";
import SignIn from "auth/AuthScreens/SignIn";
import SignUp from "auth/AuthScreens/SignUp";
import ForgotPassword from "auth/AuthScreens/ForgotPassword";
import NewPassword from "auth/AuthScreens/NewPassword";
import Dashboard from "pages/Dashboard";

export default function AppRouter() {
  return (
    <BrowserRouter basename="/improvhub">
      <Routes>
        {/* PUBLIC AUTH ROUTES (no guard) */}
        <Route path="/auth/signin" element={<SignIn />} />
        <Route path="/auth/signup" element={<SignUp />} />
        <Route path="/auth/forgot" element={<ForgotPassword />} />
        <Route path="/auth/new-password" element={<NewPassword />} />

        {/* PRIVATE ROUTES (guarded) */}
        <Route element={<ProtectedRoute />}>
          {/* home/dashboard */}
          <Route path="/" element={<Dashboard />} />
          <Route index element={<Dashboard />} />
        </Route>

        {/* FALLBACK */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
