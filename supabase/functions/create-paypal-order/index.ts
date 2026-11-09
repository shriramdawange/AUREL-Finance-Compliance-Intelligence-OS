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

function minorToDecimal(minor: number) {
  return (minor / 100).toFixed(2);
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
  if (!response.ok || !data.access_token) throw new Error("PayPal OAuth failed: " + (data.error_description || response.status));
  return String(data.access_token);
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
    const clientId = body.client_id ? String(body.client_id) : null;
    const amountMinor = Number(body.amount_minor);
    const currencyCode = String(body.currency_code ?? "USD").toUpperCase();
    const description = String(body.description ?? "").trim().slice(0, 120);
    const returnUrl = String(body.return_url ?? "");
    const cancelUrl = String(body.cancel_url ?? "");

    if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return json({ error: "Invalid organisation identifier." }, 400, cors ?? {});
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 100 || amountMinor > 500000000) return json({ error: "Amount must be between USD 1.00 and USD 5,000,000.00." }, 400, cors ?? {});
    if (currencyCode !== "USD") return json({ error: "The first PayPal sandbox checkout supports USD only." }, 400, cors ?? {});
    if (!description) return json({ error: "A payment description is required." }, 400, cors ?? {});
    const validReturn = (value: string) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1";
      } catch { return false; }
    };
    if (!validReturn(returnUrl) || !validReturn(cancelUrl)) return json({ error: "Return and cancel URLs must be HTTPS (localhost is allowed for development)." }, 400, cors ?? {});

    const { data: membership, error: membershipError } = await admin
      .from("organization_members")
      .select("role, member_status")
      .eq("organization_id", organizationId)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (membershipError || !membership || membership.member_status !== "active" || !["owner", "admin", "manager"].includes(membership.role)) {
      return json({ error: "Your active organisation role cannot create checkout orders." }, 403, cors ?? {});
    }

    const { data: intent, error: intentError } = await admin.from("payment_intents").insert({
      organization_id: organizationId,
      client_id: clientId,
      provider: "paypal",
      amount_minor: amountMinor,
      currency_code: currencyCode,
      description,
      lifecycle_status: "created",
      created_by: userData.user.id,
    }).select("id").single();
    if (intentError || !intent) throw new Error("Could not create payment intent: " + (intentError?.message ?? "unknown error"));

    const isLive = Deno.env.get("PAYPAL_ENVIRONMENT") === "live";
    const baseUrl = isLive ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
    const accessToken = await paypalAccessToken(baseUrl, paypalClientId, paypalClientSecret);
    const orderResponse = await fetch(baseUrl + "/v2/checkout/orders", {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json", "PayPal-Request-Id": intent.id },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: intent.id,
          custom_id: intent.id,
          invoice_id: "AUREL-" + intent.id,
          description,
          amount: { currency_code: currencyCode, value: minorToDecimal(amountMinor) },
        }],
        application_context: {
          user_action: "PAY_NOW",
          return_url: returnUrl,
          cancel_url: cancelUrl,
          brand_name: "AUREL",
        },
      }),
    });
    const order = await orderResponse.json();
    if (!orderResponse.ok || !order.id) throw new Error("PayPal order creation failed: " + JSON.stringify(order));

    const { error: updateError } = await admin.from("payment_intents").update({
      provider_order_id: order.id,
      lifecycle_status: "approval_pending",
    }).eq("id", intent.id);
    if (updateError) throw new Error("PayPal order created but AUREL could not save its order reference.");

    const approvalUrl = (order.links ?? []).find((link: any) => link.rel === "approve")?.href;
    if (!approvalUrl) throw new Error("PayPal did not return an approval URL.");
    return json({ payment_intent_id: intent.id, order_id: order.id, approval_url: approvalUrl, environment: isLive ? "live" : "sandbox" }, 200, cors ?? {});
  } catch (error) {
    console.error("paypal-create-order:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected checkout error." }, 500, cors ?? {});
  }
});
