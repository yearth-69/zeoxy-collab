import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { orderPricing, profitCappedCoupon, type CoinRate } from "@/lib/pricing";

const schema = z.object({
  code: z.string().trim().min(3).max(32).transform((v) => v.toUpperCase().replace(/\s+/g, "")),
  gameId: z.string().uuid(),
  packageId: z.string().uuid(),
});

type ValidateCouponResponse =
  | {
      valid: false;
      message: string;
    }
  | {
      valid: true;
      code: string;
      discountPercent: number;
      effectivePercent: number;
      actualDiscountPercent: number;
      originalPrice: number;
      requestedDiscountAmount: number;
      discountAmount: number;
      finalPrice: number;
      isProfitCapped: boolean;
      message: string;
    };

export const validateCoupon = createServerFn({ method: "POST" })
  .inputValidator((data) => schema.parse(data))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data }): Promise<ValidateCouponResponse> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const [{ data: coupon, error: couponError }, { data: pack, error: packError }, { data: rate }, { data: settings }] = await Promise.all([
      db.from("coupons")
        .select("id, code, discount_percent, max_uses, uses_count, is_active")
        .eq("code", data.code)
        .maybeSingle(),
      db.from("packages")
        .select("id, game_id, price, smile_coin_cost, package_type, is_active")
        .eq("id", data.packageId)
        .eq("game_id", data.gameId)
        .maybeSingle(),
      db.from("coin_rates").select("*").eq("is_active", true).maybeSingle(),
      db.from("site_settings").select("discount_percent").maybeSingle(),
    ]);
    if (couponError) throw couponError;
    if (packError) throw packError;
    if (!coupon || !coupon.is_active || (coupon.max_uses != null && Number(coupon.uses_count) >= Number(coupon.max_uses))) {
      return { valid: false as const, message: "Coupon invalid" };
    }
    if (!pack || !pack.is_active) {
      return { valid: false as const, message: "Select an available package first." };
    }

    let totalSmileCoinCost = Number(pack.smile_coin_cost ?? 0);
    if (pack.package_type === "bundle") {
      const { data: components, error } = await db.from("package_components")
        .select("smile_coin_cost, quantity")
        .eq("bundle_package_id", pack.id);
      if (error) throw error;
      if (!components?.length) return { valid: false as const, message: "This bundle has no configured Smile Coin components." };
      totalSmileCoinCost = components.reduce((sum: number, component: any) =>
        sum + Number(component.smile_coin_cost ?? 0) * Number(component.quantity ?? 1), 0);
    }

    const activeRate = rate ? ({
      ...rate,
      money_spent: Number(rate.money_spent),
      coins_received: Number(rate.coins_received),
      coin_rate: Number(rate.coin_rate),
      profit_percent: Number(rate.profit_percent),
    } as CoinRate) : null;
    const pricing = orderPricing(
      { price: Number(pack.price ?? 0), smile_coin_cost: totalSmileCoinCost },
      activeRate,
      Number(settings?.discount_percent ?? 0),
    );
    const couponResult = profitCappedCoupon(
      pricing,
      Number(coupon.discount_percent),
      Number(activeRate?.profit_percent ?? 0),
    );
    if (couponResult.discountAmount <= 0 || couponResult.finalPrice < Number(pricing.real_cost)) {
      return { valid: false as const, message: "Already applied — this package has no additional discount available." };
    }

    const originalPrice = Number(pricing.selling_price);
    const isProfitCapped = couponResult.discountAmount + 0.001 < couponResult.requestedDiscount;

    return {
      valid: true as const,
      code: coupon.code,
      discountPercent: Number(coupon.discount_percent),
      effectivePercent: couponResult.effectivePercent,
      actualDiscountPercent: couponResult.actualDiscountPercent,
      originalPrice,
      requestedDiscountAmount: couponResult.requestedDiscount,
      discountAmount: couponResult.discountAmount,
      finalPrice: couponResult.finalPrice,
      isProfitCapped,
      message: isProfitCapped
        ? `${coupon.code} applied. You save ₹${couponResult.discountAmount.toFixed(2)}; the discount is capped by this package's remaining Smile Coin profit.`
        : `${coupon.code} applied. You save ₹${couponResult.discountAmount.toFixed(2)} (${couponResult.actualDiscountPercent.toFixed(2)}% off).`,
    };
  });
