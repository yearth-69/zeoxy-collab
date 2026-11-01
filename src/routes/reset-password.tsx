import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Aurora } from "@/components/Aurora";
import { supabase } from "@/integrations/supabase/client";
import { PASSWORD_GUIDELINE, passwordProblem } from "@/lib/auth-rules";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset your password — ZEXY STORE" },
      {
        name: "description",
        content: "Choose a new password for your ZEXY STORE account.",
      },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const recoveryMarker =
      params.get("flow") === "recovery" ||
      window.location.hash.includes("type=recovery");

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;

      if (
        session &&
        (event === "PASSWORD_RECOVERY" ||
          (event === "SIGNED_IN" && recoveryMarker))
      ) {
        setRecoveryReady(true);
        setChecking(false);
      }
    });

    // Fallback for a recovery session established before the listener attached.
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;

      if (error) {
        console.error("[reset-password] Session check failed:", error);
      }

      if (data.session && recoveryMarker) {
        setRecoveryReady(true);
      }
      setChecking(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    if (!recoveryReady) {
      toast.error("Open the password reset link from your email first.");
      return;
    }

    const problem = passwordProblem(password, {});
    if (problem) {
      toast.error(problem);
      return;
    }

    if (password !== confirmPassword) {
      toast.error("The passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success("Password updated. Please log in with your new password.");

      // End the recovery session so the user returns to the normal login flow.
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        console.warn("[reset-password] Could not end recovery session:", signOutError);
      }

      navigate({ to: "/auth", replace: true });
    } catch (error) {
      console.error("[reset-password] Password update failed:", error);
      toast.error("Could not update your password. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "glass-panel w-full rounded-2xl px-3.5 py-3 text-sm outline-none placeholder:text-faint focus:border-violet/50";

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-10 font-body">
      <Aurora />
      <div className="glass-panel relative z-10 w-full max-w-sm rounded-3xl p-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="size-9 shrink-0 overflow-hidden rounded-xl">
            <img
              src="/logo.jpeg"
              alt="ZEXY STORE"
              className="h-full w-full object-contain"
            />
          </div>
          <p className="font-display text-base font-semibold leading-none">
            ZEXY STORE
          </p>
        </Link>

        <div className="mt-6">
          <h1 className="font-display text-xl font-semibold">
            Reset your password
          </h1>
          <p className="mt-1 text-xs text-faint">
            Choose a new password for your account.
          </p>
        </div>

        {checking ? (
          <p className="mt-6 text-sm text-subtle">Checking your reset link…</p>
        ) : recoveryReady ? (
          <form onSubmit={submitPassword} className="mt-5 space-y-3">
            <input
              type="password"
              value={password}
              autoComplete="new-password"
              required
              onChange={(event) => setPassword(event.target.value)}
              placeholder="New password"
              aria-label="New password"
              className={field}
            />

            <input
              type="password"
              value={confirmPassword}
              autoComplete="new-password"
              required
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm new password"
              aria-label="Confirm new password"
              className={field}
            />

            <p className="px-1 text-[10px] leading-relaxed text-faint">
              {PASSWORD_GUIDELINE}
            </p>

            <button
              type="submit"
              disabled={busy || !password || !confirmPassword}
              className="brand-gradient w-full rounded-2xl py-3.5 font-display text-sm font-semibold text-ink disabled:opacity-50"
            >
              {busy ? "Updating password…" : "Update password"}
            </button>
          </form>
        ) : (
          <div className="mt-5 space-y-3">
            <p className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2.5 text-xs leading-relaxed text-rose-200">
              This password reset link is invalid or has expired. Request a new
              one from the login page.
            </p>
            <Link
              to="/auth"
              className="brand-gradient block w-full rounded-2xl py-3.5 text-center font-display text-sm font-semibold text-ink"
            >
              Back to login
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
