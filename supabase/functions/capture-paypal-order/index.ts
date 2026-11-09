import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

function corsHeaders(origin: string | null) {
  const allowed = (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

async function paypalAccessToken(baseUrl: string, clientId: string, clientSecret: string) {
  const response = await fetch(baseUrl + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(clientId + ":" + clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error("PayPal OAuth failed.");
  return String(data.access_token);
}

function captureFromOrder(order: any) {
  for (const unit of order?.purchase_units ?? []) {
    for (const capture of unit?.payments?.captures ?? []) {
      if (capture?.id) return capture;
    }
  }
  return null;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin);
  if (origin && !cors) return json({ error: "Origin is not allow-listed." }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors ?? {} });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, cors ?? {});

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const paypalClientId = Deno.env.get("PAYPAL_CLIENT_ID");
    const paypalClientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
    if (!supabaseUrl || !publishableKey || !serviceRoleKey || !paypalClientId || !paypalClientSecret) {
      return json({ error: "Required server secrets are not configured." }, 503, cors ?? {});
    }

    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "A signed-in user session is required." }, 401, cors ?? {});
    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Invalid or expired user session." }, 401, cors ?? {});

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await request.json();
    const organizationId = String(body.organization_id ?? "");
    const intentId = String(body.payment_intent_id ?? "");
    const paypalOrderId = String(body.paypal_order_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(organizationId) || !/^[0-9a-f-]{36}$/i.test(intentId)) {
      return json({ error: "Valid organisation_id and payment_intent_id are required." }, 400, cors ?? {});
    }

    const { data: membership, error: membershipError } = await admin
      .from("organization_members").select("role,member_status")
      .eq("organization_id", organizationId).eq("user_id", userData.user.id).maybeSingle();
    if (membershipError || !membership || membership.member_status !== "active" || !["owner","admin","manager"].includes(membership.role)) {
      return json({ error: "Your active organisation role cannot capture checkout orders." }, 403, cors ?? {});
    }

    const { data: intent, error: intentError } = await admin.from("payment_intents").select("*")
      .eq("id", intentId).eq("organization_id", organizationId).maybeSingle();
    if (intentError || !intent) return json({ error: "Payment intent was not found in this organisation." }, 404, cors ?? {});
    if (intent.lifecycle_status === "captured" && intent.provider_capture_id) {
      return json({ payment_intent_id: intent.id, capture_id: intent.provider_capture_id, status: "captured", duplicate: true }, 200, cors ?? {});
    }
    if (!intent.provider_order_id || intent.provider_order_id !== paypalOrderId) {
      return json({ error: "The PayPal return token does not match this stored AUREL order." }, 409, cors ?? {});
    }
    if (!["approval_pending","approved"].includes(intent.lifecycle_status)) {
      return json({ error: "This payment intent has not reached the PayPal approval stage." }, 409, cors ?? {});
    }

    const paypalEnvironment = Deno.env.get("PAYPAL_ENVIRONMENT") ?? "sandbox";
    if (paypalEnvironment !== "sandbox") return json({ error: "This AUREL build accepts PayPal Sandbox captures only." }, 503, cors ?? {});
    const baseUrl = "https://api-m.sandbox.paypal.com";
    const accessToken = await paypalAccessToken(baseUrl, paypalClientId, paypalClientSecret);
    const response = await fetch(baseUrl + "/v2/checkout/orders/" + encodeURIComponent(intent.provider_order_id) + "/capture", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json",
        "PayPal-Request-Id": String(intent.id) + "-capture",
      },
      body: "{}",
    });
    const result = await response.json();
    if (!response.ok) {
      return json({ error: "PayPal capture was not completed.", provider_status: response.status, details: result?.message ?? result?.name ?? "See PayPal sandbox logs." }, 502, cors ?? {});
    }

    const capture = captureFromOrder(result);
    const status = String(capture?.status ?? result?.status ?? "UNKNOWN").toUpperCase();
    if (status === "COMPLETED" && capture?.id) {
      const { error: updateError } = await admin.from("payment_intents").update({
        provider_capture_id: String(capture.id),
        lifecycle_status: "captured",
      }).eq("id", intent.id).eq("organization_id", organizationId);
      if (updateError) throw new Error("PayPal captured the order but AUREL could not save the capture reference.");
    } else if (status === "PENDING") {
      await admin.from("payment_intents").update({ lifecycle_status: "approval_pending" })
        .eq("id", intent.id).eq("organization_id", organizationId);
    } else {
      return json({ payment_intent_id: intent.id, order_id: intent.provider_order_id, status, message: "Capture response is not completed. Wait for a verified webhook or review the PayPal order." }, 202, cors ?? {});
    }

    // The verified PayPal webhook is the canonical source for ledger-event creation.
    // This capture endpoint never inserts a financial event itself.
    return json({
      payment_intent_id: intent.id,
      order_id: intent.provider_order_id,
      capture_id: capture?.id ?? null,
      status,
      environment: "sandbox",
      ledger_event: "awaiting_verified_webhook",
    }, status === "COMPLETED" ? 200 : 202, cors ?? {});
  } catch (error) {
    console.error("paypal-capture-order:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected capture error." }, 500, cors ?? {});
  }
});
