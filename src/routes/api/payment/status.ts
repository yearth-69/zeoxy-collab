import { createFileRoute } from "@tanstack/react-router";

const jsonHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function formatTxnDate(value?: string) {
  const date = value ? new Date(value) : new Date();

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("day")}-${get("month")}-${get("year")}`;
}

export const Route = createFileRoute("/api/payment/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const clientTxnId =
            url.searchParams.get("txn")?.trim() ?? "";

          if (!clientTxnId) {
            return Response.json(
              { ok: false, message: "txn is required" },
              { status: 400, headers: jsonHeaders },
            );
          }

          const authHeader = request.headers.get("authorization");

          if (!authHeader?.startsWith("Bearer ")) {
            return Response.json(
              { ok: false, message: "Unauthorized" },
              { status: 401, headers: jsonHeaders },
            );
          }

          const token = authHeader.slice(7).trim();

          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );

          const { data: claims, error: claimsError } =
            await supabaseAdmin.auth.getClaims(token);

          if (claimsError || !claims?.claims?.sub) {
            return Response.json(
              { ok: false, message: "Unauthorized" },
              { status: 401, headers: jsonHeaders },
            );
          }

          const db = supabaseAdmin as any;
          const userId = claims.claims.sub;

          const { data: order, error } = await db
            .from("orders")
            .select(
              "id, status, payment_status, payment_remark, selling_price, created_at, upiqrx_client_txn_id, upiqrx_upi_txn_id, smile_order_id",
            )
            .eq("user_id", userId)
            .eq("upiqrx_client_txn_id", clientTxnId)
            .maybeSingle();

          if (error) throw error;

          if (!order) {
            return Response.json(
              { ok: false, message: "Payment order not found" },
              { status: 404, headers: jsonHeaders },
            );
          }

          // Never downgrade a paid or completed order.
          if (
            order.payment_status === "paid" ||
            order.status === "processing" ||
            order.status === "completed"
          ) {
            return Response.json(
              {
                ok: true,
                orderId: order.id,
                status: order.status,
                paymentStatus: order.payment_status,
                paymentRemark: order.payment_remark,
                upiTxnId: order.upiqrx_upi_txn_id,
                smileOrderId: order.smile_order_id,
              },
              { headers: jsonHeaders },
            );
          }

          const key = process.env["UPIQ_RX_API_KEY"]?.trim();

          if (!key) {
            throw new Error("Missing UPI_RX_API_KEY");
          }

          // Ask UPIQRX for the real transaction status.
          const gatewayResponse = await fetch(
            "https://api.upiqrx.in/api/check_order_status",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                key,
                client_txn_id: clientTxnId,
                txn_date: formatTxnDate(order.created_at),
              }),
              signal: AbortSignal.timeout(10000),
            },
          );

          const gateway = await gatewayResponse
            .json()
            .catch(() => null);

          // A missing/unavailable gateway record is NOT proof of failure.
          if (!gatewayResponse.ok || !gateway?.status || !gateway?.data) {
            return Response.json(
              {
                ok: true,
                orderId: order.id,
                status: order.status,
                paymentStatus: order.payment_status,
                paymentRemark: "Waiting for gateway confirmation",
              },
              { headers: jsonHeaders },
            );
          }

          const transaction = gateway.data;
          const gatewayStatus = String(
            transaction.status ?? "",
          ).toLowerCase();

          const gatewayAmount = Number(transaction.amount);
          const expectedAmount = Number(order.selling_price);

          // Do not accept a successful status for a different amount.
          if (
            gatewayStatus === "success" &&
            (!Number.isFinite(gatewayAmount) ||
              Math.abs(gatewayAmount - expectedAmount) > 0.01)
          ) {
            return Response.json(
              {
                ok: false,
                message: "Payment amount could not be verified",
              },
              { status: 409, headers: jsonHeaders },
            );
          }

          if (gatewayStatus === "success") {
            // Reuse the existing webhook's amount verification,
            // payment update, and Smile One delivery logic.
            const webhookResponse = await fetch(
              new URL("/api/payment/webhook", url.origin),
              {
                method: "POST",
                headers: {
                  "Content-Type":
                    "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                  client_txn_id: clientTxnId,
                  txnAt: String(
                    transaction.txnAt ?? order.created_at ?? "",
                  ).slice(0, 10),
                }),
                signal: AbortSignal.timeout(20000),
              },
            );

            // The webhook may return a non-2xx response if delivery
            // needs attention. Read the order again instead of
            // assuming payment or delivery succeeded.
            if (!webhookResponse.ok) {
              console.error(
                "[Payment status] Webhook processing returned",
                webhookResponse.status,
              );
            }
          } else if (gatewayStatus === "failed") {
            // Only mark a still-pending payment as failed.
            // Never overwrite an order that has already been paid.
            const { error: updateError } = await db
              .from("orders")
              .update({
                status: "failed",
                payment_status: "failed",
                payment_remark: String(
                  transaction.remark ?? "Payment failed",
                ).slice(0, 500),
              })
              .eq("id", order.id)
              .eq("payment_status", "pending");

            if (updateError) throw updateError;
          }

          // Read the latest DB state after gateway verification.
          const { data: latest, error: latestError } = await db
            .from("orders")
            .select(
              "id, status, payment_status, payment_remark, upiqrx_upi_txn_id, smile_order_id",
            )
            .eq("id", order.id)
            .maybeSingle();

          if (latestError) throw latestError;

          return Response.json(
            {
              ok: true,
              orderId: latest?.id ?? order.id,
              status: latest?.status ?? order.status,
              paymentStatus:
                latest?.payment_status ?? order.payment_status,
              paymentRemark: latest?.payment_remark ?? null,
              upiTxnId: latest?.upiqrx_upi_txn_id ?? null,
              smileOrderId: latest?.smile_order_id ?? null,
            },
            { headers: jsonHeaders },
          );
        } catch (error) {
          console.error("[Payment status]", error);

          return Response.json(
            {
              ok: false,
              message: "Could not verify payment status. Please wait.",
            },
            { status: 500, headers: jsonHeaders },
          );
        }
      },
    },
  },
});
