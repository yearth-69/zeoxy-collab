import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const notificationType = z.enum(["offer", "announcement", "update"]);

function validatePublicLink(value: string | null | undefined) {
  if (!value) return true;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Forbidden: admin access required");
  return supabaseAdmin as any;
}

/** Public, deliberately limited payload used by the first-visit welcome modal. */
export const getPublicWelcomeContent = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const [{ data: settings, error: settingsError }, { data: couponRows, error: couponError }] = await Promise.all([
    db.from("welcome_settings")
      .select("is_enabled, title, subtitle, community_url, community_label")
      .eq("id", 1)
      .maybeSingle(),
    db.from("coupons")
      .select("code, discount_percent, max_uses, uses_count, is_active")
      .eq("is_active", true)
      .order("discount_percent", { ascending: false })
      .limit(30),
  ]);
  if (settingsError) throw settingsError;
  if (couponError) throw couponError;

  const activeCoupon = (couponRows ?? []).find((coupon: any) =>
    coupon.is_active && (coupon.max_uses == null || Number(coupon.uses_count) < Number(coupon.max_uses)),
  );

  return {
    isEnabled: settings?.is_enabled ?? true,
    title: String(settings?.title ?? "Welcome to Zeoxy Store"),
    subtitle: String(settings?.subtitle ?? "Your game top-ups, store offers and important updates — all in one place."),
    communityUrl: settings?.community_url ? String(settings.community_url) : null,
    communityLabel: String(settings?.community_label ?? "Join our community"),
    coupon: activeCoupon
      ? { code: String(activeCoupon.code), discountPercent: Number(activeCoupon.discount_percent) }
      : null,
  };
});

export const getAdminNotificationData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await assertAdmin(context.userId);
    const [{ data: notifications, error: notificationsError }, { data: welcomeSettings, error: settingsError }] = await Promise.all([
      db.from("notifications").select("id, title, message, type, link_url, is_active, created_at, updated_at").order("created_at", { ascending: false }).limit(100),
      db.from("welcome_settings").select("is_enabled, title, subtitle, community_url, community_label").eq("id", 1).maybeSingle(),
    ]);
    if (notificationsError) throw notificationsError;
    if (settingsError) throw settingsError;
    return {
      notifications: notifications ?? [],
      welcomeSettings: welcomeSettings ?? {
        is_enabled: true,
        title: "Welcome to Zeoxy Store",
        subtitle: "Your game top-ups, store offers and important updates — all in one place.",
        community_url: null,
        community_label: "Join our community",
      },
    };
  });

const saveNotificationSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(3).max(90),
  message: z.string().trim().min(3).max(500),
  type: notificationType,
  linkUrl: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().default(true),
}).refine((value) => validatePublicLink(value.linkUrl), {
  message: "Link must be a relative website path or a secure https:// URL",
  path: ["linkUrl"],
});

export const saveAdminNotification = createServerFn({ method: "POST" })
  .inputValidator((data) => saveNotificationSchema.parse(data))
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const db = await assertAdmin(context.userId);
    const row = {
      title: data.title,
      message: data.message,
      type: data.type,
      link_url: data.linkUrl || null,
      is_active: data.isActive,
      updated_at: new Date().toISOString(),
    };
    const result = data.id
      ? await db.from("notifications").update(row).eq("id", data.id).select("id").single()
      : await db.from("notifications").insert({ ...row, created_by: context.userId }).select("id").single();
    if (result.error) throw result.error;
    return { ok: true as const, id: result.data.id };
  });

const deleteNotificationSchema = z.object({ id: z.string().uuid() });
export const deleteAdminNotification = createServerFn({ method: "POST" })
  .inputValidator((data) => deleteNotificationSchema.parse(data))
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const db = await assertAdmin(context.userId);
    const { error } = await db.from("notifications").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true as const };
  });

const saveWelcomeSettingsSchema = z.object({
  isEnabled: z.boolean(),
  title: z.string().trim().min(3).max(90),
  subtitle: z.string().trim().min(3).max(240),
  communityUrl: z.string().trim().max(500).nullable().optional(),
  communityLabel: z.string().trim().min(2).max(40),
}).refine((value) => validatePublicLink(value.communityUrl), {
  message: "Community link must be a relative website path or a secure https:// URL",
  path: ["communityUrl"],
});

export const saveWelcomeSettings = createServerFn({ method: "POST" })
  .inputValidator((data) => saveWelcomeSettingsSchema.parse(data))
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const db = await assertAdmin(context.userId);
    const { error } = await db.from("welcome_settings").upsert({
      id: 1,
      is_enabled: data.isEnabled,
      title: data.title,
      subtitle: data.subtitle,
      community_url: data.communityUrl || null,
      community_label: data.communityLabel,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (error) throw error;
    return { ok: true as const };
  });
