import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function decimalToMinor(value: unknown): number {
  const input = String(value ?? "");
  if (!/^\d+(\.\d{1,2})?$/.test(input)) throw new Error("PayPal returned an invalid monetary amount.");
  const [whole, fraction = ""] = input.split(".");
  const minor = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (!Number.isSafeInteger(minor)) throw new Error("PayPal amount is outside the supported numeric range.");
  return minor;
}

async function getAccessToken(baseUrl: string, clientId: string, secret: string) {
  const response = await fetch(baseUrl + "/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(clientId + ":" + secret), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error("PayPal OAuth failed.");
  return String(data.access_token);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const rawBody = await request.text();
  if (rawBody.length > 1_000_000) return json({ error: "Webhook payload is too large." }, 413);

  let event: any;
  try { event = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON payload." }, 400); }
  if (!event?.id || !event?.event_type || !event?.resource) return json({ error: "Incomplete webhook event." }, 400);

  const headers = {
    transmission_id: request.headers.get("paypal-transmission-id"),
    transmission_time: request.headers.get("paypal-transmission-time"),
    cert_url: request.headers.get("paypal-cert-url"),
    auth_algo: request.headers.get("paypal-auth-algo"),
    transmission_sig: request.headers.get("paypal-transmission-sig"),
  };
  if (Object.values(headers).some((value) => !value)) return json({ error: "Missing PayPal signature headers." }, 400);

  let admin: any = null;
  let processingRecordId: string | null = null;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const paypalClientId = Deno.env.get("PAYPAL_CLIENT_ID");
    const paypalClientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
    const webhookId = Deno.env.get("PAYPAL_WEBHOOK_ID");
    if (!supabaseUrl || !serviceRoleKey || !paypalClientId || !paypalClientSecret || !webhookId) {
      return json({ error: "Webhook verification secrets are not configured." }, 503);
    }

    const paypalEnvironment = Deno.env.get("PAYPAL_ENVIRONMENT") ?? "sandbox";
    if (paypalEnvironment !== "sandbox") throw new Error("This AUREL build accepts PayPal Sandbox webhooks only.");
    const baseUrl = "https://api-m.sandbox.paypal.com";
    const accessToken = await getAccessToken(baseUrl, paypalClientId, paypalClientSecret);
    const verifyResponse = await fetch(baseUrl + "/v1/notifications/verify-webhook-signature", {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ ...headers, webhook_id: webhookId, webhook_event: event }),
    });
    const verification = await verifyResponse.json();
    if (!verifyResponse.ok || verification.verification_status !== "SUCCESS") {
      console.warn("Rejected unverified PayPal webhook:", event.id, verification.verification_status);
      return json({ error: "PayPal webhook signature verification failed." }, 401);
    }

    admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    let webhookRecord: any = null;
    const { data: insertedWebhook, error: insertWebhookError } = await admin.from("provider_webhook_events").insert({
      provider: "paypal",
      external_event_id: String(event.id),
      event_type: String(event.event_type),
      verification_status: "verified",
      processing_status: "received",
      raw_payload: event,
    }).select("id,processing_status,processing_attempts,processing_started_at").single();

    if (insertWebhookError?.code === "23505") {
      const { data: existingWebhook, error: lookupError } = await admin.from("provider_webhook_events")
        .select("id,processing_status,processing_attempts,processing_started_at")
        .eq("provider", "paypal").eq("external_event_id", String(event.id)).maybeSingle();
      if (lookupError || !existingWebhook) throw new Error("Could not load the previously received webhook event.");
      if (["processed","unmatched","ignored"].includes(existingWebhook.processing_status)) {
        return json({ received: true, duplicate: true, status: existingWebhook.processing_status });
      }
      webhookRecord = existingWebhook;
    } else if (insertWebhookError || !insertedWebhook) {
      throw new Error("Could not store verified webhook event.");
    } else {
      webhookRecord = insertedWebhook;
    }

    processingRecordId = webhookRecord.id;
    const staleBefore = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    let claim = admin.from("provider_webhook_events").update({
      processing_status: "processing",
      processing_attempts: Number(webhookRecord.processing_attempts || 0) + 1,
      processing_started_at: new Date().toISOString(),
      processing_error: null,
      processed_at: null,
    }).eq("id", webhookRecord.id);

    if (webhookRecord.processing_status === "processing") {
      claim = claim.eq("processing_status", "processing").lte("processing_started_at", staleBefore);
    } else {
      claim = claim.in("processing_status", ["received","failed"]);
    }

    const { data: claimedWebhook, error: claimError } = await claim.select("id").maybeSingle();
    if (claimError) throw new Error("Could not claim webhook processing: " + claimError.message);
    if (!claimedWebhook) return json({ received: true, duplicate: true, status: "processing" }, 202);

    const resource = event.resource;
    const relatedOrderId = resource?.supplementary_data?.related_ids?.order_id ?? resource?.related_ids?.order_id ?? null;
    const intentCandidate = resource?.custom_id ?? (String(resource?.invoice_id ?? "").startsWith("AUREL-") ? String(resource.invoice_id).slice(6) : null);
    const relatedCaptureId = resource?.supplementary_data?.related_ids?.capture_id ?? resource?.parent_payment ?? null;
    let intent: any = null;
    if (intentCandidate && /^[0-9a-f-]{36}$/i.test(String(intentCandidate))) {
      const { data } = await admin.from("payment_intents").select("*").eq("id", String(intentCandidate)).maybeSingle();
      intent = data;
    }
    if (!intent && relatedOrderId) {
      const { data } = await admin.from("payment_intents").select("*").eq("provider_order_id", String(relatedOrderId)).maybeSingle();
      intent = data;
    }
    if (!intent && resource?.id) {
      const { data } = await admin.from("payment_intents").select("*").eq("provider_capture_id", String(resource.id)).maybeSingle();
      intent = data;
    }
    if (!intent && relatedCaptureId) {
      const { data } = await admin.from("payment_intents").select("*").eq("provider_capture_id", String(relatedCaptureId)).maybeSingle();
      intent = data;
    }

    if (!intent) {
      await admin.from("provider_webhook_events").update({
        processing_status: "unmatched",
        processing_error: "No AUREL payment intent matched this verified PayPal event.",
        processing_started_at: null,
        processed_at: new Date().toISOString(),
      }).eq("id", webhookRecord.id);
      return json({ received: true, matched: false });
    }

    await admin.from("provider_webhook_events").update({
      organization_id: intent.organization_id,
      payment_intent_id: intent.id,
    }).eq("id", webhookRecord.id);

    const type = String(event.event_type);
    if (type === "PAYMENT.CAPTURE.PENDING") {
      const { error: pendingError } = await admin.from("payment_intents").update({ lifecycle_status: "approval_pending" })
        .eq("id", intent.id).in("lifecycle_status", ["created","approval_pending","approved"]);
      if (pendingError) throw new Error("Could not update pending payment intent: " + pendingError.message);
      await admin.from("provider_webhook_events").update({ processing_status: "processed", processing_started_at: null, processing_error: null, processed_at: new Date().toISOString() }).eq("id", webhookRecord.id);
      return json({ received: true, processed: true });
    }
    if (type === "PAYMENT.CAPTURE.DENIED") {
      const { error: deniedError } = await admin.from("payment_intents").update({ lifecycle_status: "failed" })
        .eq("id", intent.id).in("lifecycle_status", ["created","approval_pending","approved"]);
      if (deniedError) throw new Error("Could not update denied payment intent: " + deniedError.message);
      await admin.from("provider_webhook_events").update({ processing_status: "processed", processing_started_at: null, processing_error: null, processed_at: new Date().toISOString() }).eq("id", webhookRecord.id);
      return json({ received: true, processed: true });
    }

    const isCapture = type === "PAYMENT.CAPTURE.COMPLETED";
    const isRefund = type === "PAYMENT.CAPTURE.REFUNDED";
    const isReversal = type === "PAYMENT.CAPTURE.REVERSED";
    if (!isCapture && !isRefund && !isReversal) {
      await admin.from("provider_webhook_events").update({ processing_status: "ignored", processing_started_at: null, processed_at: new Date().toISOString() }).eq("id", webhookRecord.id);
      return json({ received: true, ignored: true });
    }

    const amountObject = resource?.amount ?? resource?.seller_receivable_breakdown?.gross_amount;
    if (!amountObject?.currency_code || amountObject?.value === undefined || amountObject?.value === null) {
      throw new Error("PayPal event is missing an explicit gross amount or currency.");
    }
    const currency = String(amountObject.currency_code).toUpperCase();
    if (currency !== String(intent.currency_code).toUpperCase()) throw new Error("Webhook currency does not match the stored payment intent.");
    const grossMinor = decimalToMinor(amountObject.value);
    if (grossMinor <= 0) throw new Error("PayPal event gross amount must be positive.");
    if (!resource?.id) throw new Error("PayPal event is missing its provider resource identifier.");
    if (isCapture && grossMinor !== Number(intent.amount_minor)) {
      throw new Error("PayPal capture amount does not match the stored payment intent amount.");
    }
    const feeMinor = isCapture ? decimalToMinor(resource?.seller_receivable_breakdown?.paypal_fee?.value ?? "0") : 0;
    if (feeMinor > grossMinor) throw new Error("PayPal fee exceeds gross transaction amount.");
    const netMinor = grossMinor - feeMinor;
    let originalEventId: string | null = null;
    if (isRefund || isReversal) {
      if (!relatedCaptureId) throw new Error("Refund/reversal event does not identify its original PayPal capture.");
      const { data: original, error: originalLookupError } = await admin.from("financial_events").select("id,gross_minor")
        .eq("organization_id", intent.organization_id).eq("source_system", "paypal")
        .eq("provider_event_id", "capture:" + String(relatedCaptureId)).maybeSingle();
      if (originalLookupError) throw new Error("Could not load the original PayPal capture: " + originalLookupError.message);
      originalEventId = original?.id ?? null;
      if (!originalEventId) throw new Error("Original PayPal capture is not in the AUREL ledger yet; retry this webhook after capture processing.");
    }

    let originalCaptureMinor = Number(intent.amount_minor);
    let priorRefundMinor = 0;
    if (originalEventId) {
      const { data: originalCapture, error: originalError } = await admin.from("financial_events")
        .select("gross_minor").eq("id", originalEventId).eq("organization_id", intent.organization_id).maybeSingle();
      if (originalError) throw new Error("Could not verify the original PayPal capture: " + originalError.message);
      if (originalCapture) originalCaptureMinor = Number(originalCapture.gross_minor || originalCaptureMinor);
      const { data: priorRefunds, error: priorRefundError } = await admin.from("financial_events")
        .select("gross_minor").eq("organization_id", intent.organization_id).eq("original_event_id", originalEventId)
        .in("event_category", ["refund","reversal"]);
      if (priorRefundError) throw new Error("Could not calculate prior PayPal refunds: " + priorRefundError.message);
      priorRefundMinor = (priorRefunds ?? []).reduce((sum:any,row:any)=>sum+Number(row.gross_minor||0),0);
    }

    if ((isRefund || isReversal) && grossMinor + priorRefundMinor > originalCaptureMinor) {
      throw new Error("PayPal refund/reversal total would exceed the original captured amount.");
    }
    const direction = isCapture ? "inflow" : "outflow";
    const category = isCapture ? "customer_receipt" : isRefund ? "refund" : "reversal";
    const lifecycle = isCapture ? "paid" : isRefund ? "refunded" : "reversed";
    const nextIntentStatus = isCapture
      ? (["partially_refunded","refunded","reversed"].includes(intent.lifecycle_status) ? intent.lifecycle_status : "captured")
      : isReversal
        ? "reversed"
        : (intent.lifecycle_status === "reversed" ? "reversed" : (priorRefundMinor + grossMinor >= originalCaptureMinor ? "refunded" : "partially_refunded"));
    const { error: financialEventError } = await admin.from("financial_events").insert({
      organization_id: intent.organization_id,
      client_id: intent.client_id,
      source_system: "paypal",
      source_external_id: String(event.id),
      idempotency_key: String(event.id),
      event_type: isCapture ? "capture" : isRefund ? "refund" : "reversal",
      cash_direction: direction,
      event_category: category,
      gross_minor: grossMinor,
      fee_minor: feeMinor,
      net_minor: netMinor,
      currency_code: currency,
      lifecycle_status: lifecycle,
      counterparty_name: resource?.payer?.name?.given_name ? [resource.payer.name.given_name, resource.payer.name.surname].filter(Boolean).join(" ") : "PayPal customer",
      description: "PayPal " + type,
      occurred_at: event.create_time || new Date().toISOString(),
      original_event_id: originalEventId,
      provider_event_id: (isCapture ? "capture:" : isRefund ? "refund:" : "reversal:") + String(resource.id),
    });
    if (financialEventError?.code === "23505") {
      if (isCapture && !["partially_refunded","refunded","reversed"].includes(intent.lifecycle_status)) {
        await admin.from("payment_intents").update({
          provider_capture_id: String(resource.id),
          lifecycle_status: "captured",
        }).eq("id", intent.id);
      }
      await admin.from("provider_webhook_events").update({ processing_status: "processed", processing_started_at: null, processing_error: null, processed_at: new Date().toISOString() }).eq("id", webhookRecord.id);
      return json({ received: true, duplicate_resource: true });
    }
    if (financialEventError) throw new Error("Financial event could not be recorded: " + financialEventError.message);

    const { error: intentUpdateError } = await admin.from("payment_intents").update({
      provider_capture_id: isCapture ? String(resource.id) : intent.provider_capture_id,
      lifecycle_status: nextIntentStatus,
    }).eq("id", intent.id);
    if (intentUpdateError) throw new Error("Financial event was recorded but the payment intent status could not be updated: " + intentUpdateError.message);

    await admin.from("provider_webhook_events").update({
      processing_status: "processed",
      processing_started_at: null,
      processing_error: null,
      processed_at: new Date().toISOString(),
    }).eq("id", webhookRecord.id);

    return json({ received: true, processed: true });
  } catch (error) {
    console.error("paypal-webhook processing error:", error);
    if (admin && processingRecordId) {
      const message = error instanceof Error ? error.message : "Webhook processing failed.";
      await admin.from("provider_webhook_events").update({
        processing_status: "failed",
        processing_error: message.slice(0, 2000),
        processing_started_at: null,
      }).eq("id", processingRecordId).eq("processing_status", "processing");
    }
    return json({ error: error instanceof Error ? error.message : "Webhook processing failed." }, 500);
  }
});
