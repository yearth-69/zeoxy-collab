import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Aurora } from "@/components/Aurora";
import { PASSWORD_GUIDELINE, passwordProblem } from "@/lib/auth-rules";
import { finishPhonePasswordRecovery } from "@/lib/auth.recovery.functions";
import { SiteLogo } from "@/components/SiteLogoProvider";

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
  const finishRecovery = useServerFn(finishPhonePasswordRecovery);
  const [checking, setChecking] = useState(true);
  const [recovery, setRecovery] = useState<{ recoveryId: string; resetToken: string } | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem("zeoxy_phone_password_recovery");
      if (raw) {
        const parsed = JSON.parse(raw) as { recoveryId?: unknown; resetToken?: unknown };
        if (typeof parsed.recoveryId === "string" && typeof parsed.resetToken === "string") {
          setRecovery({ recoveryId: parsed.recoveryId, resetToken: parsed.resetToken });
        }
      }
    } catch (error) {
      console.error("[reset-password] Could not read recovery session:", error);
    } finally {
      setChecking(false);
    }
  }, []);

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    if (!recovery) {
      toast.error("Verify your mobile number first to reset your password.");
      return;
    }

    const problem = passwordProblem(password);
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
      const result = await finishRecovery({
        data: {
          recoveryId: recovery.recoveryId,
          resetToken: recovery.resetToken,
          password,
        },
      });

      if (!result.ok) {
        toast.error(result.message);
        if (
          result.code === "RECOVERY_TOKEN_INVALID" ||
          result.code === "RECOVERY_TOKEN_USED" ||
          result.code === "PASSWORD_UPDATE_FAILED"
        ) {
          window.sessionStorage.removeItem("zeoxy_phone_password_recovery");
          setRecovery(null);
        }
        return;
      }

      window.sessionStorage.removeItem("zeoxy_phone_password_recovery");
      toast.success("Password updated successfully. Log in with your new password.");
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
            <SiteLogo alt="ZEXY STORE" className="h-full w-full object-contain" />
          </div>
          <p className="font-display text-base font-semibold leading-none">ZEXY STORE</p>
        </Link>

        <div className="mt-6">
          <h1 className="font-display text-xl font-semibold">Create a new password</h1>
          <p className="mt-1 text-xs text-faint">
            Your mobile number has been verified. Choose a new password for your account.
          </p>
        </div>

        {checking ? (
          <p className="mt-6 text-sm text-subtle">Preparing secure reset session…</p>
        ) : recovery ? (
          <form onSubmit={submitPassword} className="mt-5 space-y-3">
            <input
              type="password"
              value={password}
              autoComplete="new-password"
              required
              maxLength={72}
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
              maxLength={72}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm new password"
              aria-label="Confirm new password"
              className={field}
            />
            <p className="px-1 text-[10px] leading-relaxed text-faint">{PASSWORD_GUIDELINE}</p>
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
              Your recovery session is missing or expired. Request a new OTP from the login page.
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
