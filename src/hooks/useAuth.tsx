import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const AUTH_INIT_TIMEOUT_MS = 3_500;
const ADMIN_ROLE_TIMEOUT_MS = 3_000;

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkedFor, setCheckedFor] = useState<string | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    let settled = false;

    const finishInitialSession = (nextSession: Session | null) => {
      if (cancelled) return;
      settled = true;
      window.clearTimeout(timeout);
      setSession(nextSession);
      setLoading(false);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      finishInitialSession(next);
    });

    const timeout = window.setTimeout(() => {
      if (settled || cancelled) return;
      console.warn(
        "[auth] Initial session lookup timed out; continuing with a signed-out state while auth events remain subscribed.",
      );
      finishInitialSession(null);
    }, AUTH_INIT_TIMEOUT_MS);

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn("[auth] Could not restore the session:", error.message);
        }
        finishInitialSession(data.session ?? null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.warn("[auth] Session restoration failed:", error);
        finishInitialSession(null);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      sub.subscription.unsubscribe();
    };
  }, []);

  const user: User | null = session?.user ?? null;
  const userId = user?.id ?? null;

  useEffect(() => {
    if (loading) return;

    if (!userId) {
      setIsAdmin(false);
      setCheckedFor(null);
      return;
    }

    let cancelled = false;
    setIsAdmin(false);
    setCheckedFor(undefined);

    // Profile creation is best-effort and must not block role verification.
    void supabase.rpc("ensure_profile").then(({ error }) => {
      if (error) {
        console.warn("[auth] Profile sync was deferred:", error.message);
      }
    }).catch((error: unknown) => {
      console.warn("[auth] Profile sync failed:", error);
    });

    const finishAsNonAdmin = (reason: string) => {
      if (cancelled) return;
      console.warn(`[auth] Admin role check ${reason}; using non-admin access until verified.`);
      setIsAdmin(false);
      setCheckedFor(userId);
    };

    const roleTimeout = window.setTimeout(() => {
      finishAsNonAdmin("timed out");
    }, ADMIN_ROLE_TIMEOUT_MS);

    void supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          finishAsNonAdmin("failed");
          return;
        }
        setIsAdmin(Boolean(data));
        setCheckedFor(userId);
      })
      .catch((error: unknown) => {
        console.warn("[auth] Admin role lookup failed:", error);
        finishAsNonAdmin("failed");
      })
      .finally(() => {
        window.clearTimeout(roleTimeout);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(roleTimeout);
    };
  }, [userId, loading]);

  const roleLoading = checkedFor !== userId;

  return {
    session,
    user,
    isAdmin,
    loading,
    roleLoading,
    ready: !loading && !roleLoading,
  };
}
