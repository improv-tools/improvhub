import { supabase } from "lib/supabaseClient";

export const signIn = (email, password) =>
  supabase.auth.signInWithPassword({ email, password });

export const signUp = (email, password, fullName, redirectTo) =>
  supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName }, redirectTo },
  });

export const resetPassword = (email, redirectTo) =>
  supabase.auth.resetPasswordForEmail(email, { redirectTo });

export const updateUserPassword = (password) =>
  supabase.auth.updateUser({ password });

export const updateUserMetadata = (data) =>
  supabase.auth.updateUser({ data });

export const signOut = () => supabase.auth.signOut();

export const getSession = () => supabase.auth.getSession();

export const onAuthChange = (cb) => supabase.auth.onAuthStateChange(cb);
