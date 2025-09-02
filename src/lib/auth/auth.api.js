import { supabase } from "../lib/supabaseClient";
export const signIn = (email, password) =>
  supabase.auth.signInWithPassword({ email, password });
export const signUp = (email, password, name, redirectTo) =>
  supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: name }, redirectTo }
  });
