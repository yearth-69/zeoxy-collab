import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";

const jsonHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

type StringMap = Record<string, string>;

function smileSign(params: StringMap, key: string) {
  const source = Object.keys(params)
    .sort((a, b) => a.localeCompare(b))
    .map((k) => `${k}=${params[k]}&`)
    .join("") + key;
  const first = createHash("md5").update(source, "utf8").digest("hex");
  return createHash("md5").update(first, "utf8").digest("hex");
}

function smileProductName(slug: string) {
  const map: Record<string, string> = {
    "mobile-legends": "mobilelegends",
    "free-fire": "freefire",
    "pubg-mobile": "pubgmobile",
    "genshin-impact": "genshinimpact",
    bgmi: "pubgmobile",
  };
  return map[slug] ?? slug.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

async function smilePost(url: string, params: StringMap) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(params),
  });
  const raw = await response.text();
  let json: any = null;
  try { json = JSON.parse(raw); } catch { /* report below */ }
  if (!response.ok) {
    throw new Error(`Smile One HTTP ${response.status}: ${typeof json === "object" && json ? JSON.stringify(json) : raw.slice(0, 300)}`);
  }
  return json;
}

function dateToSmileFormat(value?: string) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}-${m}-${y}`;
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")}`;
}

async function verifyUpiqrxStatus(clientTxnId: string, txnDate?: string) {
  const key = process.env["UPIQ_RX_API_KEY"]?.trim();
  if (!key) throw new Error("Missing UPI_RX_API_KEY");
  const response = await fetch("https://api.upiqrx.in/api/check_order_status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, client_txn_id: clientTxnId, txn_date: dateToSmileFormat(txnDate) }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.status) throw new Error(data?.msg || "UPIQRX status verification failed");
  return data.data;
}

export const Route = createFileRoute("/api/payment/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
          if (!contentType.includes("application/x-www-form-urlencoded")) {
            return Response.json({ ok: false, message: "Expected form-urlencoded webhook" }, { status: 400, headers: jsonHeaders });
          }
          const form = new URLSearchParams(await request.text());
          const clientTxnId = form.get("client_txn_id")?.trim() || "";
          if (!clientTxnId) return Response.json({ ok: false, message: "client_txn_id is required" }, { status: 400, headers: jsonHeaders });

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const db = supabaseAdmin as any;
          const { data: order, error: orderError } = await db.from("orders")
            .select("id, game_id, package_id, player_ref, player_server, selling_price, status, payment_status, upiqrx_client_txn_id, smile_product_id")
            .eq("upiqrx_client_txn_id", clientTxnId).maybeSingle();
          if (orderError) throw orderError;
          if (!order) return Response.json({ ok: false, message: "Order not found" }, { status: 404, headers: jsonHeaders });
          if (order.status === "completed") return Response.json({ ok: true, duplicate: true, delivery: "completed" }, { headers: jsonHeaders });
          if (order.payment_status === "failed") return Response.json({ ok: true, payment: "failed" }, { headers: jsonHeaders });

          const gatewayTxn = await verifyUpiqrxStatus(clientTxnId, form.get("txnAt") ?? undefined);
          const gatewayAmount = Number(gatewayTxn?.amount);
          const expectedAmount = Number(order.selling_price);
          if (!Number.isFinite(gatewayAmount) || Math.abs(gatewayAmount - expectedAmount) > 0.01) {
            if (order.payment_status === "pending") await db.from("orders").update({ status: "failed", payment_status: "failed", payment_remark: "Payment amount mismatch" }).eq("id", order.id).eq("payment_status", "pending");
            return Response.json({ ok: false, message: "Payment amount mismatch" }, { status: 400, headers: jsonHeaders });
          }
          if (String(gatewayTxn?.status ?? "").toLowerCase() !== "success") {
            if (order.payment_status === "pending") await db.from("orders").update({ status: "failed", payment_status: "failed", payment_remark: String(gatewayTxn?.remark ?? "Payment failed").slice(0, 500) }).eq("id", order.id).eq("payment_status", "pending");
            return Response.json({ ok: true, payment: "failed" }, { headers: jsonHeaders });
          }

          // Atomically mark the order paid once. Paid+processing callbacks are allowed to resume unfinished deliveries.
          if (order.payment_status === "pending") {
            const { data: claimed, error: claimError } = await db.from("orders").update({
              status: "processing", payment_status: "paid",
              upiqrx_upi_txn_id: String(gatewayTxn?.upi_txn_id ?? "").trim() || null,
              payment_remark: String(gatewayTxn?.remark ?? "").slice(0, 500) || null,
              paid_at: new Date().toISOString(),
            }).eq("id", order.id).eq("payment_status", "pending").select("id").maybeSingle();
            if (claimError) throw claimError;
            if (!claimed) {
              const { data: latest } = await db.from("orders").select("payment_status,status").eq("id", order.id).maybeSingle();
              if (latest?.status === "completed") return Response.json({ ok: true, duplicate: true }, { headers: jsonHeaders });
              if (latest?.payment_status !== "paid") return Response.json({ ok: true, duplicate: true, payment: latest?.payment_status }, { headers: jsonHeaders });
            }
          }

          const [{ data: game, error: gameError }, { data: pack, error: packError }] = await Promise.all([
            db.from("games").select("slug").eq("id", order.game_id).maybeSingle(),
            db.from("packages").select("id, package_type, smile_product_id").eq("id", order.package_id).maybeSingle(),
          ]);
          if (gameError) throw gameError;
          if (packError) throw packError;
          if (!game?.slug || !pack) throw new Error("Missing game or package for delivery");

          type DeliverySpec = { delivery_key: string; package_component_id: string | null; component_label: string; smile_product_id: string; quantity: number };
          let specs: DeliverySpec[] = [];
          if (pack.package_type === "bundle") {
            const { data: components, error } = await db.from("package_components")
              .select("id, component_label, smile_product_id, quantity, sort_order")
              .eq("bundle_package_id", pack.id).order("sort_order", { ascending: true });
            if (error) throw error;
            if (!components?.length) throw new Error("Bundle has no configured components");
            for (const c of components as any[]) {
              if (!String(c.smile_product_id ?? "").trim()) throw new Error(`Missing Smile product ID for ${c.component_label}`);
              // Smile One calls are issued once per unit, so every unit has its own durable delivery row.
              for (let i = 0; i < Number(c.quantity); i++) specs.push({
                delivery_key: `${c.id}:${i + 1}`, package_component_id: c.id,
                component_label: `${c.component_label}${Number(c.quantity) > 1 ? ` (${i + 1}/${c.quantity})` : ""}`,
                smile_product_id: String(c.smile_product_id), quantity: 1,
              });
            }
          } else {
            const productId = String(order.smile_product_id ?? pack.smile_product_id ?? "").trim();
            if (!productId) throw new Error("Missing Smile One product ID for delivery");
            specs = [{ delivery_key: "single:1", package_component_id: null, component_label: "Package delivery", smile_product_id: productId, quantity: 1 }];
          }

          const { error: seedError } = await db.from("order_deliveries").upsert(
            specs.map((s) => ({ order_id: order.id, ...s, status: "pending" })),
            { onConflict: "order_id,delivery_key", ignoreDuplicates: true },
          );
          if (seedError) throw seedError;
          const { data: deliveries, error: deliveriesError } = await db.from("order_deliveries")
            .select("id, delivery_key, package_component_id, component_label, smile_product_id, quantity, status, attempt_count")
            .eq("order_id", order.id).order("delivery_key", { ascending: true });
          if (deliveriesError) throw deliveriesError;

          const email = process.env["SMILE_ONE_EMAIL"]?.trim();
          const uid = process.env["SMILE_ONE_UID"]?.trim();
          const key = process.env["SMILE_ONE_KEY"]?.trim();
          const baseUrl = (process.env["SMILE_ONE_API_URL"]?.trim() || "https://www.smile.one").replace(/\/$/, "");
          if (!email || !uid || !key) throw new Error("Smile One server configuration is incomplete");

          const failures: string[] = [];
          for (const delivery of (deliveries ?? []) as any[]) {
            if (delivery.status === "success") continue;
            // A row already marked processing may represent an in-flight request. Never blindly repeat it.
            if (delivery.status === "processing") { failures.push(`${delivery.component_label}: delivery is still processing; manual review may be needed`); continue; }
            const { data: claimed, error: deliveryClaimError } = await db.from("order_deliveries").update({
              status: "processing", attempt_count: Number(delivery.attempt_count ?? 0) + 1,
              error_message: null, updated_at: new Date().toISOString(),
            }).eq("id", delivery.id).in("status", ["pending", "failed"]).select("id").maybeSingle();
            if (deliveryClaimError) throw deliveryClaimError;
            if (!claimed) continue;

            try {
              const roleParams: StringMap = {
                email, uid, userid: String(order.player_ref), zoneid: String(order.player_server ?? ""),
                product: smileProductName(game.slug), productid: String(delivery.smile_product_id),
                time: String(Math.floor(Date.now() / 1000)),
              };
              const result = await smilePost(`${baseUrl}/smilecoin/api/createorder`, { ...roleParams, sign: smileSign(roleParams, key) });
              if (Number(result?.status) !== 200) throw new Error(String(result?.message || "Smile One delivery failed"));
              const { error: doneError } = await db.from("order_deliveries").update({
                status: "success", smile_order_id: result?.order_id != null ? String(result.order_id) : null,
                smile_status: String(result?.status ?? "success"), error_message: null,
                completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
              }).eq("id", delivery.id);
              if (doneError) throw doneError;
            } catch (error) {
              const message = error instanceof Error ? error.message : "Unknown Smile One error";
              await db.from("order_deliveries").update({ status: "failed", smile_status: "failed", error_message: message.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", delivery.id);
              failures.push(`${delivery.component_label}: ${message}`);
            }
          }

          const { data: finalRows, error: finalError } = await db.from("order_deliveries").select("status, component_label, error_message, smile_order_id").eq("order_id", order.id);
          if (finalError) throw finalError;
          const allSucceeded = (finalRows ?? []).length > 0 && (finalRows ?? []).every((r: any) => r.status === "success");
          if (allSucceeded) {
            await db.from("orders").update({ status: "completed", smile_status: "success", smile_order_id: (finalRows ?? []).find((r: any) => r.smile_order_id)?.smile_order_id ?? null, smile_remark: "All Smile One deliveries completed", completed_at: new Date().toISOString() }).eq("id", order.id);
            return Response.json({ ok: true, payment: "success", delivery: "completed", deliveries: finalRows.length }, { headers: jsonHeaders });
          }
          await db.from("orders").update({ status: "processing", smile_status: "partial", smile_remark: failures.join("; ").slice(0, 500) || "Some deliveries remain in progress" }).eq("id", order.id);
          // Non-2xx lets the gateway retry. Successful delivery rows are skipped on retry.
          return Response.json({ ok: false, payment: "paid", delivery: "partial", failures }, { status: 502, headers: jsonHeaders });
        } catch (error) {
          console.error("[UPIQRX webhook]", error);
          return Response.json({ ok: false, message: error instanceof Error ? error.message : "Webhook processing failed" }, { status: 500, headers: jsonHeaders });
        }
      },
    },
  },
});
