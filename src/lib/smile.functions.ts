import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const listProductsSchema = z.object({
  product: z.string().trim().min(1).max(60),
});

const assignProductSchema = z.object({
  packageId: z.string().uuid(),
  smileProductId: z.string().trim().min(1).max(100),
});

export type SmileProduct = {
  id: string | number;
  spu: string;
  price: string | number;
};

async function makeSign(
  params: Record<string, string>,
  merchantKey: string,
): Promise<string> {
  const { createHash } = await import("node:crypto");

  const source =
    Object.keys(params)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => `${key}=${params[key]}&`)
      .join("") + merchantKey;

  const first = createHash("md5")
    .update(source, "utf8")
    .digest("hex");

  return createHash("md5")
    .update(first, "utf8")
    .digest("hex");
}

async function requireAdmin(userId: string) {
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (error) {
    console.error("[SmileAdmin] Admin role check failed:", error);
    throw error;
  }

  if (!data) {
    throw new Error("Forbidden");
  }

  return supabaseAdmin;
}

async function postForm(
  url: string,
  params: Record<string, string>,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(params),
  });

  const text = await response.text();

  let parsed: unknown = null;

  try {
    parsed = JSON.parse(text);
  } catch {
    // Keep the raw body for the HTTP error message below.
  }

  if (!response.ok) {
    throw new Error(
      `Smile One HTTP ${response.status}: ${
        typeof parsed === "object" && parsed !== null
          ? JSON.stringify(parsed)
          : text.slice(0, 300)
      }`,
    );
  }

  return parsed;
}

export const listSmileProducts = createServerFn({
  method: "POST",
})
  .inputValidator((data) =>
    listProductsSchema.parse(data),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const { userId } = context;

    await requireAdmin(userId);

    const email =
      process.env["SMILE_ONE_EMAIL"]?.trim();

    const uid =
      process.env["SMILE_ONE_UID"]?.trim();

    const key =
      process.env["SMILE_ONE_KEY"]?.trim();

    const baseUrl =
      process.env["SMILE_ONE_API_URL"]?.trim() ||
      "https://www.smile.one";

    if (!email || !uid || !key) {
      throw new Error(
        "Missing SMILE_ONE_EMAIL, SMILE_ONE_UID or SMILE_ONE_KEY",
      );
    }

    const params: Record<string, string> = {
      uid,
      email,
      product: data.product,
      time: String(Math.floor(Date.now() / 1000)),
    };

    const result = (await postForm(
      `${baseUrl}/smilecoin/api/productlist`,
      {
        ...params,
        sign: await makeSign(params, key),
      },
    )) as {
      status?: number;
      message?: string;
      data?: {
        product?: Array<{
          id?: string | number;
          spu?: string;
          price?: string | number;
        }>;
      };
    };

    if (result?.status !== 200) {
      throw new Error(
        result?.message ||
          "Smile One product list request failed",
      );
    }

    const products = (result.data?.product ?? [])
      .filter(
        (p) =>
          p.id !== undefined &&
          p.id !== null,
      )
      .map((p) => ({
        id: p.id!,
        spu: String(p.spu ?? ""),
        price: p.price ?? "",
      }));

    return { products };
  });

export const assignSmileProduct = createServerFn({
  method: "POST",
})
  .inputValidator((data) =>
    assignProductSchema.parse(data),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const { userId } = context;

    await requireAdmin(userId);

    const { supabaseAdmin } =
      await import(
        "@/integrations/supabase/client.server"
      );

    const { data: pack, error: packError } =
      await (supabaseAdmin as any)
        .from("packages")
        .select("id, label")
        .eq("id", data.packageId)
        .maybeSingle();

    if (packError) {
      throw packError;
    }

    if (!pack) {
      throw new Error(
        "Recharge package not found",
      );
    }

    const { error } =
      await (supabaseAdmin as any)
        .from("packages")
        .update({
          smile_product_id:
            data.smileProductId,
        })
        .eq("id", data.packageId);

    if (error) {
      throw error;
    }

    return {
      ok: true,
      packageId: pack.id,
      packageLabel: pack.label,
      smileProductId:
        data.smileProductId,
    };
  });
