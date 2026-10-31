/**
 * Centralised Smile Coin pricing logic.
 * Every price shown to a customer, stored on an order, or previewed in the
 * admin panel goes through these helpers — never duplicate the formulas.
 */

export type CoinRate = {
  id: string;
  money_spent: number;
  coins_received: number;
  coin_rate: number;
  profit_percent: number;
  is_active: boolean;
  note: string | null;
  created_at: string;
};

export type PricedPack = {
  price: number;
  smile_coin_cost: number;
};

export type Pricing = {
  smile_coin_cost: number;
  coin_rate: number;
  real_cost: number;
  profit_percent: number;
  selling_price: number;
  profit: number;
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const coinRateOf = (moneySpent: number, coinsReceived: number) =>
  coinsReceived > 0 ? moneySpent / coinsReceived : 0;

/** A positive manual price is the package's exact customer-facing price. */
export const hasFallbackPrice = (pack: PricedPack) => Number(pack.price) > 0;

export function computePricing(pack: PricedPack, rate?: CoinRate | null): Pricing {
  const manualPrice = round2(Number(pack.price) || 0);
  const coins = Number(pack.smile_coin_cost) || 0;
  const coinRate = rate ? Number(rate.coin_rate) || 0 : 0;

  // Custom/fallback price takes precedence whenever it is configured.
  if (manualPrice > 0) {
    const realCost = coins > 0 && coinRate > 0 ? round2(coins * coinRate) : 0;
    const profit = round2(manualPrice - realCost);
    const profitPercent = realCost > 0 ? round2((profit / realCost) * 100) : 0;

    return {
      smile_coin_cost: coins,
      coin_rate: coinRate,
      real_cost: realCost,
      profit_percent: profitPercent,
      selling_price: manualPrice,
      profit,
    };
  }

  // No manual price: retain the existing Smile Coin pricing behavior.
  if (coins <= 0 || coinRate <= 0) {
    return {
      smile_coin_cost: coins,
      coin_rate: coinRate,
      real_cost: 0,
      profit_percent: 0,
      selling_price: 0,
      profit: 0,
    };
  }

  const realCost = round2(coins * coinRate);
  const profitPercent = rate ? Number(rate.profit_percent) || 0 : 0;
  const sellingPrice = round2(realCost * (1 + profitPercent / 100));

  return {
    smile_coin_cost: coins,
    coin_rate: coinRate,
    real_cost: realCost,
    profit_percent: profitPercent,
    selling_price: sellingPrice,
    profit: round2(sellingPrice - realCost),
  };
}

/**
 * Fallback/custom prices are exact customer prices, so the global site
 * discount is deliberately not applied to them.
 */
export function customerPrice(
  pack: PricedPack,
  rate: CoinRate | null | undefined,
  discountPercent = 0,
): number {
  const base = computePricing(pack, rate).selling_price;

  if (hasFallbackPrice(pack)) {
    return base;
  }

  const pct = Math.min(Math.max(Number(discountPercent) || 0, 0), 100);
  return round2(base * (1 - pct / 100));
}

/** Pricing snapshot stored on an order. */
export function orderPricing(
  pack: PricedPack,
  rate: CoinRate | null | undefined,
  discountPercent = 0,
): Pricing & { amount: number } {
  const p = computePricing(pack, rate);
  const amount = customerPrice(pack, rate, discountPercent);

  return {
    ...p,
    selling_price: amount,
    profit: round2(amount - p.real_cost),
    amount,
  };
}

/**
 * Applies a coupon only against the markup added by the currently active
 * Smile Coin rate. The requested percentage is capped at that live markup
 * percentage, then capped again at the remaining profit after any site-wide
 * discount. The final price can therefore never fall below real_cost.
 *
 * The requested discount is a percentage of the customer-facing selling
 * price, but the actual discount is capped by remaining profit so the final
 * price never falls below real_cost.
 */
export function profitCappedCoupon(
  pricing: Pricing & { amount: number },
  couponPercent: number,
  liveRateProfitPercent: number,
) {
  const configuredCouponPercent = Math.min(Math.max(Number(couponPercent) || 0, 0), 100);
  const liveProfitPercent = Math.min(Math.max(Number(liveRateProfitPercent) || 0, 0), 100);
  const effectivePercent = Math.min(configuredCouponPercent, liveProfitPercent);
  const availableProfit = round2(Math.max(
    0,
    Math.min(
      Number(pricing.profit) || 0,
      Number(pricing.selling_price) - Number(pricing.real_cost),
    ),
  ));
  // Apply the coupon percentage to the current customer-facing price
  // (after any site-wide discount), not to the internal Smile Coin cost.
  const currentSellingPrice = Math.max(0, Number(pricing.selling_price) || 0);
  const requestedDiscount = round2(currentSellingPrice * effectivePercent / 100);
  // Never discount more than the real profit still available on this package.
  const discountAmount = round2(Math.min(requestedDiscount, availableProfit));
  const finalPrice = round2(Math.max(
    Number(pricing.real_cost) || 0,
    currentSellingPrice - discountAmount,
  ));
  const actualDiscount = round2(currentSellingPrice - finalPrice);
  const actualDiscountPercent = currentSellingPrice > 0
    ? round2((actualDiscount / currentSellingPrice) * 100)
    : 0;
  return {
    effectivePercent,
    actualDiscountPercent,
    requestedDiscount,
    availableProfit,
    discountAmount: actualDiscount,
    finalPrice,
  };
}

