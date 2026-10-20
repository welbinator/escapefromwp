// Cloudflare Pages Function — POST /api/preview-feedback
// Handles the two preview modals:
//   action:'reject' → flip preview to dead (cleanup cron reaps it early)
//   action:'like'   → record lead (name/email/message), flip to 'liked' (exempt
//                     from cleanup), email James with a link to the liked variant,
//                     and push to the Command Center.

import { getPreview, markLiked, markVariantDead } from "./_lib/preview-store.js";
import { TEMPLATES, TEMPLATE_KEYS } from "./_lib/templates/index.js";
import { sendLeadLikedEmail } from "./_lib/send-email.js";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function notifyCC(env, { siteName, variantLabel, variantUrl, leadName, leadEmail, leadMessage }) {
  const secret = env.PUSH_NOTIFY_SECRET;
  if (!secret) return;
  const url = env.CC_NOTIFY_URL || "https://cc.crweb.design/api/push/notify";
  try {
    const ts = Math.floor(Date.now() / 1000);
    const message = `🔥 Preview lead: ${siteName} liked the ${variantLabel} look — ${leadMessage || "(no message)"} | ${variantUrl}`;
    const body = JSON.stringify({ name: leadName || leadEmail, email: leadEmail, site: "escapefromwp.com", message, ts });
    const sig = await hmacHex(secret, `v0:${ts}:${body}`);
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-CC-Signature": `t=${ts},v0=${sig}` }, body });
  } catch (_) { /* non-fatal */ }
}

export async function onRequestPost({ request, env }) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: "bad request" }, 400); }

  const id = (data.id || "").toString().toLowerCase();
  const action = (data.action || "").toString();
  const variant = TEMPLATE_KEYS.includes(data.variant) ? data.variant : "warm";
  if (!/^[0-9a-f]{32}$/.test(id)) return json({ ok: false, error: "bad id" }, 400);
  if (!env.DB) return json({ ok: false, error: "not configured" }, 500);

  const rec = await getPreview(env, id);
  if (!rec) return json({ ok: false, error: "not found" }, 404);

  if (action === "reject") {
    const { allDead } = await markVariantDead(env, id, variant, TEMPLATE_KEYS);
    return json({ ok: true, status: allDead ? "dead" : "live", variant_dead: variant, all_dead: allDead });
  }

  if (action === "like") {
    const name = (data.name || "").toString().trim().slice(0, 120);
    const email = (data.email || "").toString().trim().slice(0, 200);
    const message = (data.message || "").toString().trim().slice(0, 2000);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return json({ ok: false, error: "valid email required" }, 400);

    await markLiked(env, id, variant, { name, message });

    const origin = new URL(request.url).origin;
    const variantUrl = `${origin}/preview/${id}/${variant}`;
    const variantLabel = TEMPLATES[variant]?.label || variant;
    const siteName = rec.row.business_name || rec.model?.brand?.name || "a site";

    await Promise.all([
      sendLeadLikedEmail(env, { siteName, variantLabel, variantUrl, leadName: name, leadEmail: email, leadMessage: message }),
      notifyCC(env, { siteName, variantLabel, variantUrl, leadName: name, leadEmail: email, leadMessage: message }),
    ]);
    return json({ ok: true, status: "liked" });
  }

  return json({ ok: false, error: "unknown action" }, 400);
}
