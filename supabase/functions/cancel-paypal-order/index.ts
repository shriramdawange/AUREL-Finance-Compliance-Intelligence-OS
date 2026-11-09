import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

function corsHeaders(origin: string | null) {
  const allowed = (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
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
    if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
      return json({ error: "Required Supabase server configuration is missing." }, 503, cors ?? {});
    }

    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "A signed-in user session is required." }, 401, cors ?? {});
    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Invalid or expired user session." }, 401, cors ?? {});

    const body = await request.json();
    const organizationId = String(body.organization_id ?? "");
    const intentId = String(body.payment_intent_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(organizationId) || !/^[0-9a-f-]{36}$/i.test(intentId)) {
      return json({ error: "Valid organisation_id and payment_intent_id are required." }, 400, cors ?? {});
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: membership, error: membershipError } = await admin.from("organization_members")
      .select("role,member_status").eq("organization_id", organizationId).eq("user_id", userData.user.id).maybeSingle();
    if (membershipError || !membership || membership.member_status !== "active" || !["owner","admin","manager"].includes(membership.role)) {
      return json({ error: "Your active organisation role cannot cancel checkout orders." }, 403, cors ?? {});
    }

    const { data: intent, error: intentError } = await admin.from("payment_intents").select("id,lifecycle_status")
      .eq("id", intentId).eq("organization_id", organizationId).maybeSingle();
    if (intentError || !intent) return json({ error: "Payment intent was not found in this organisation." }, 404, cors ?? {});
    if (intent.lifecycle_status === "cancelled") return json({ payment_intent_id: intent.id, status: "cancelled", duplicate: true }, 200, cors ?? {});
    if (!["created","approval_pending"].includes(intent.lifecycle_status)) {
      return json({ error: "Only an unpaid payment request can be cancelled." }, 409, cors ?? {});
    }

    const { error: updateError } = await admin.from("payment_intents").update({ lifecycle_status: "cancelled" })
      .eq("id", intent.id).eq("organization_id", organizationId)
      .in("lifecycle_status", ["created","approval_pending"]);
    if (updateError) throw new Error("Payment request could not be cancelled: " + updateError.message);

    return json({ payment_intent_id: intent.id, status: "cancelled" }, 200, cors ?? {});
  } catch (error) {
    console.error("paypal-cancel-order:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected cancellation error." }, 500, cors ?? {});
  }
});
