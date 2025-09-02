import { supabase } from "@/lib/supabaseClient";

export const upsertProfile = (id, full_name) =>
  supabase.from("profiles").upsert({ id, full_name }, { onConflict: "id" });

export const getMyProfile = (id) =>
  supabase.from("profiles").select("full_name").eq("id", id).single();
