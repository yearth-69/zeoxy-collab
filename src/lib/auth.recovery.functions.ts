import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  maskMobile,
  normalizeMobile,
  otpSchema,
  passwordProblem,
  phoneStorageForms,
} from "@/lib/auth-rules";

const startSchema = z.object({
  phoneCountry: z.string().min(2).max(4),
  phoneNumber: z.string().trim().min(4).max(25),
});
const recoveryIdSchema = z.object({ recoveryId: z.string().uuid() });
const verifySchema = z.object({
  recoveryId: z.string().uuid(),
  otp: otpSchema,
});
const finishSchema = z.object({
  recoveryId: z.string().uuid(),
  resetToken: z.string().uuid(),
  password: z.string().min(1).max(72),
});

const notFound = () => ({
  ok: false as const,
  code: "PHONE_NOT_FOUND" as const,
  message: "This number is not associated with any account.",
});

async function checkSendLimits(auth: typeof import("@/lib/auth.server"), phone: string) {
  const ipKey = auth.rateKey(`ip:${auth.clientIp()}`);
  const phoneKey = auth.rateKey(`phone:${phone}`);
  const [ipSends, phoneSends] = await Promise.all([
    auth.countRecent("otp_send_ip", ipKey, 3600),
    auth.countRecent("otp_send_phone", phoneKey, 3600),
  ]);
  if (
    ipSends >= auth.OTP_POLICY.maxSendsPerIpPerHour ||
    phoneSends >= auth.OTP_POLICY.maxSendsPerPhonePerHour
  ) {
    return { ok: false as const, message: "Too many codes requested. Please try again later." };
  }
  return { ok: true as const, ipKey, phoneKey };
}

export const startPhonePasswordRecovery = createServerFn({ method: "POST" })
  .inputValidator((data) => startSchema.parse(data))
  .handler(async ({ data }) => {
    const auth = await import("@/lib/auth.server");
    // Prune stale recovery records opportunistically; this table is server-only.
    void (auth.supabaseAdmin as any)
      .from("password_recovery_otps")
      .delete()
      .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const mobile = normalizeMobile(data.phoneCountry, data.phoneNumber);
    if (!mobile.ok) {
      return { ok: false as const, code: "INVALID_PHONE" as const, message: mobile.message };
    }

    const limits = await checkSendLimits(auth, mobile.e164);
    if (!limits.ok) return { ok: false as const, code: "RATE_LIMITED" as const, message: limits.message };

    // The profile table is the application's canonical link between a phone and auth user.
    const { data: profile, error: profileError } = await auth.supabaseAdmin
      .from("profiles")
      .select("id, display_name, phone")
      .in("phone", phoneStorageForms(mobile))
      .limit(1)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.id) return notFound();

    const { data: authUser, error: authUserError } = await auth.supabaseAdmin.auth.admin.getUserById(profile.id);
    if (authUserError || !authUser.user) return notFound();

    await Promise.all([
      auth.recordEvent("otp_send_ip", limits.ipKey),
      auth.recordEvent("otp_send_phone", limits.phoneKey),
    ]);

    const recoveryId = crypto.randomUUID();
    const code = auth.generateOtp();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + auth.OTP_POLICY.ttlSeconds * 1000).toISOString();

    const { error: insertError } = await (auth.supabaseAdmin as any)
      .from("password_recovery_otps")
      .insert({
        id: recoveryId,
        user_id: profile.id,
        phone: mobile.e164,
        code_hash: auth.hashOtp(recoveryId, code),
        expires_at: expiresAt,
      });
    if (insertError) throw insertError;

    try {
      await auth.sendOtpSms(mobile.e164, code, profile.display_name || "Zeoxy Customer");
    } catch (error) {
      await (auth.supabaseAdmin as any)
        .from("password_recovery_otps")
        .delete()
        .eq("id", recoveryId);
      console.error("[password-recovery] OTP send failed:", error instanceof Error ? error.message : "unknown");
      return {
        ok: false as const,
        code: "OTP_SEND_FAILED" as const,
        message: "We couldn't send the verification code. Please try again.",
      };
    }

    return {
      ok: true as const,
      recoveryId,
      maskedPhone: maskMobile(mobile.e164),
      resendIn: auth.OTP_POLICY.resendCooldownSeconds,
    };
  });

export const resendPhonePasswordRecovery = createServerFn({ method: "POST" })
  .inputValidator((data) => recoveryIdSchema.parse(data))
  .handler(async ({ data }) => {
    const auth = await import("@/lib/auth.server");
    const db = auth.supabaseAdmin as any;
    const { data: row, error } = await db
      .from("password_recovery_otps")
      .select("id, user_id, phone, last_sent_at, send_count, consumed_at")
      .eq("id", data.recoveryId)
      .maybeSingle();
    if (error) throw error;
    if (!row || row.consumed_at) {
      return { ok: false as const, code: "NOT_FOUND" as const, message: "This recovery request has expired. Start again." };
    }

    const wait = auth.OTP_POLICY.resendCooldownSeconds - Math.floor((Date.now() - new Date(row.last_sent_at).getTime()) / 1000);
    if (wait > 0) {
      return { ok: false as const, code: "COOLDOWN" as const, message: `Please wait ${wait} seconds before requesting another code.` };
    }
    if (row.send_count >= auth.OTP_POLICY.maxSendsPerRegistration) {
      return { ok: false as const, code: "RATE_LIMITED" as const, message: "Too many codes requested. Please start again later." };
    }

    const limits = await checkSendLimits(auth, row.phone);
    if (!limits.ok) return { ok: false as const, code: "RATE_LIMITED" as const, message: limits.message };

    const code = auth.generateOtp();
    const { data: profile, error: profileError } = await auth.supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", row.user_id)
      .maybeSingle();
    if (profileError) throw profileError;

    await Promise.all([
      auth.recordEvent("otp_send_ip", limits.ipKey),
      auth.recordEvent("otp_send_phone", limits.phoneKey),
    ]);

    try {
      await auth.sendOtpSms(row.phone, code, profile?.display_name || "Zeoxy Customer");
    } catch (error) {
      console.error("[password-recovery] OTP resend failed:", error instanceof Error ? error.message : "unknown");
      return { ok: false as const, code: "OTP_SEND_FAILED" as const, message: "We couldn't send another code. Please try again." };
    }

    const now = new Date();
    const { error: updateError } = await db
      .from("password_recovery_otps")
      .update({
        code_hash: auth.hashOtp(row.id, code),
        attempts: 0,
        expires_at: new Date(now.getTime() + auth.OTP_POLICY.ttlSeconds * 1000).toISOString(),
        last_sent_at: now.toISOString(),
        send_count: row.send_count + 1,
        verified_at: null,
        reset_token_hash: null,
        reset_token_expires_at: null,
      })
      .eq("id", row.id);
    if (updateError) throw updateError;

    return { ok: true as const, maskedPhone: maskMobile(row.phone), resendIn: auth.OTP_POLICY.resendCooldownSeconds };
  });

export const verifyPhonePasswordRecovery = createServerFn({ method: "POST" })
  .inputValidator((data) => verifySchema.parse(data))
  .handler(async ({ data }) => {
    const auth = await import("@/lib/auth.server");
    const db = auth.supabaseAdmin as any;
    const { data: row, error } = await db
      .from("password_recovery_otps")
      .select("id, code_hash, attempts, expires_at, consumed_at, verified_at")
      .eq("id", data.recoveryId)
      .maybeSingle();
    if (error) throw error;
    if (!row || row.consumed_at) {
      return { ok: false as const, code: "NOT_FOUND" as const, message: "This recovery request has expired. Start again." };
    }
    if (row.verified_at) {
      return { ok: false as const, code: "ALREADY_VERIFIED" as const, message: "This code has already been verified. Continue to the password reset page." };
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return { ok: false as const, code: "OTP_EXPIRED" as const, message: "The verification code has expired. Request a new code." };
    }
    if (row.attempts >= auth.OTP_POLICY.maxAttempts) {
      return { ok: false as const, code: "OTP_ATTEMPTS" as const, message: "Too many incorrect attempts. Request a new code." };
    }

    if (!auth.otpMatches(row.id, data.otp, row.code_hash)) {
      const attempts = row.attempts + 1;
      await db.from("password_recovery_otps").update({ attempts }).eq("id", row.id);
      return {
        ok: false as const,
        code: attempts >= auth.OTP_POLICY.maxAttempts ? "OTP_ATTEMPTS" as const : "OTP_INVALID" as const,
        message: attempts >= auth.OTP_POLICY.maxAttempts
          ? "Too many incorrect attempts. Request a new code."
          : `Incorrect code. ${auth.OTP_POLICY.maxAttempts - attempts} attempts remaining.`,
      };
    }

    const resetToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error: updateError } = await db
      .from("password_recovery_otps")
      .update({
        verified_at: new Date().toISOString(),
        reset_token_hash: auth.hashOtp(row.id, resetToken),
        reset_token_expires_at: expiresAt,
      })
      .eq("id", row.id)
      .is("consumed_at", null);
    if (updateError) throw updateError;

    return { ok: true as const, resetToken };
  });

export const finishPhonePasswordRecovery = createServerFn({ method: "POST" })
  .inputValidator((data) => finishSchema.parse(data))
  .handler(async ({ data }) => {
    const problem = passwordProblem(data.password);
    if (problem) return { ok: false as const, code: "PASSWORD_INVALID" as const, message: problem };

    const auth = await import("@/lib/auth.server");
    const db = auth.supabaseAdmin as any;
    const { data: row, error } = await db
      .from("password_recovery_otps")
      .select("id, user_id, reset_token_hash, reset_token_expires_at, verified_at, consumed_at")
      .eq("id", data.recoveryId)
      .maybeSingle();
    if (error) throw error;

    if (
      !row ||
      row.consumed_at ||
      !row.verified_at ||
      !row.reset_token_hash ||
      !row.reset_token_expires_at ||
      new Date(row.reset_token_expires_at).getTime() <= Date.now() ||
      !auth.otpMatches(data.recoveryId, data.resetToken, row.reset_token_hash)
    ) {
      return { ok: false as const, code: "RECOVERY_TOKEN_INVALID" as const, message: "Your password reset session is invalid or expired. Request a new OTP." };
    }

    // Claim the one-time token before changing the password, preventing reuse.
    const { data: claimed, error: claimError } = await db
      .from("password_recovery_otps")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", data.recoveryId)
      .is("consumed_at", null)
      .select("user_id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed?.user_id) {
      return { ok: false as const, code: "RECOVERY_TOKEN_USED" as const, message: "This password reset link has already been used. Request a new OTP." };
    }

    const { error: passwordError } = await auth.supabaseAdmin.auth.admin.updateUserById(
      claimed.user_id,
      { password: data.password },
    );
    if (passwordError) {
      console.error("[password-recovery] Password update failed:", passwordError.message);
      return { ok: false as const, code: "PASSWORD_UPDATE_FAILED" as const, message: "Could not update your password. Request a new OTP and try again." };
    }

    return { ok: true as const };
  });
