import { useEffect, useState } from "react";
import { getMyProfile } from "./profiles.api";

export function useProfile(user) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    (async () => {
      if (!user) return;
      try {
        const { data, error } = await getMyProfile(user.id);
        if (error && error.code !== "PGRST116") throw error;
        if (on) setName(data?.full_name || user.user_metadata?.full_name || "");
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => { on = false; };
  }, [user]);

  return { name, setName, loading };
}
