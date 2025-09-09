import { supabase } from "lib/supabaseClient";

export const signIn = (email, password) =>
  supabase.auth.signInWithPassword({ email, password });

// Sign up and set Auth user metadata.display_name
export const signUp = (email, password, displayName, redirectTo) =>
  supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName }, emailRedirectTo: redirectTo },
  });

export const resetPassword = (email, redirectTo) =>
  supabase.auth.resetPasswordForEmail(email, { redirectTo });

export const updateUserPassword = (password) =>
  supabase.auth.updateUser({ password });

// Update arbitrary user metadata (e.g., { display_name: "Alice" })
export const updateUserMetadata = (data) =>
  supabase.auth.updateUser({ data });

export const signOut = () => supabase.auth.signOut();

export const getSession = () => supabase.auth.getSession();

export const onAuthChange = (cb) => supabase.auth.onAuthStateChange(cb);
